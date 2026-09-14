import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from './server.js';
import { ServiceDatabase } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { TopicStore, normalizeTopicUrl } from './topics/store.js';
import { buildSearchKeywords, dedupeCandidates, type RawCandidate } from './topics/collection.js';
import { computeNextRunAt, describeInZone, parseDailyTime, normalizeTimezone } from './topics/time.js';
import { TopicScheduler } from './topics/scheduler.js';
import { applyPlanningOutput } from '@sthstart/contracts';

const adminToken = 'admin-topics-test-token-123456789012345';
const adminHeaders = { 'x-sthstart-admin-token': adminToken };

/** 测试用的批次视图：只声明断言需要的字段。 */
interface IdeaBatchView { status: string; ideas: Array<Record<string, unknown>> }
interface RunView { status: string; createdCount: number; mergedCount: number; failedCount: number; errorMessage?: string }

class MemorySecrets extends SecretStore {
  readonly values = new Map<string, string>();
  override async status() { return { available: true, backend: 'memory', envFallback: false }; }
  override async get(account: string) {
    const value = this.values.get(account);
    return value === undefined ? { value: null, source: 'none' as const } : { value, source: 'keyring' as const };
  }
  override async set(account: string, value: string) { this.values.set(account, value); }
  override async delete(account: string) { this.values.delete(account); }
}

/** 检索工具：返回两条指向同一事件的结果，用来验证来源合并。 */
function topicMcpFetch(options: { fail?: boolean; delayMs?: number } = {}) {
  return (async (_input: unknown, init?: { method?: string; body?: string }) => {
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    const method = init?.method ?? 'GET';
    if (method === 'GET') return new Response(null, { status: 405 });
    const body = init?.body ? JSON.parse(String(init.body)) as { id?: number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } } : {};
    if (body.method === 'initialize') {
      return Response.json({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'TopicMock', version: '1.0' } } });
    }
    if (body.method === 'tools/list') {
      return Response.json({ jsonrpc: '2.0', id: body.id, result: { tools: [
        { name: 'hot_search', description: '搜索近期社区讨论', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
      ] } });
    }
    if (body.method === 'tools/call') {
      if (options.fail) return Response.json({ jsonrpc: '2.0', id: body.id, result: { isError: true, content: [{ type: 'text', text: '来源暂时不可用' }] } });
      const keyword = String(body.params?.arguments?.query ?? '原神');
      return Response.json({ jsonrpc: '2.0', id: body.id, result: {
        content: [{ type: 'text', text: '近期讨论：' + keyword + ' 的新版本活动引发大量二创。' }],
        structuredContent: { results: [
          { url: 'https://community.example.com/post/1?utm_source=share', title: '新版本料理活动引发热议', publishedAt: '2026-09-10', excerpt: '玩家在社区讨论新版本的料理活动，' + keyword + '相关二创数量上升。' },
          { url: 'https://community.example.com/post/2', title: '新版本料理活动引发热议', publishedAt: '2026-09-11', excerpt: '同一事件的最新报道：料理活动细节补充。' },
          { url: 'https://community.example.com/post/3', title: '老话题：三年前的旧活动', excerpt: '与本次无关的旧内容。' },
        ] },
      } });
    }
    return Response.json({ jsonrpc: '2.0', id: body.id, result: {} });
  }) as unknown as typeof fetch;
}

function topicLlmFetch() {
  return (async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    if (!url.includes('/chat/completions')) return new Response(null, { status: 404 });
    const body = init?.body ? JSON.parse(String(init.body)) as { messages?: Array<{ content?: string }> } : {};
    const prompt = body.messages?.[body.messages.length - 1]?.content ?? '';
    let content: unknown;
    if (prompt.includes('actorRoles')) {
      // 企划生成：只引用提示词里出现的角色 ID，保证输出通过校验。
      const sessionActors = prompt.match(/actor_[0-9a-f]{8}/g) ?? [];
      const actorIds = sessionActors.length ? [...new Set(sessionActors)].slice(0, 3) : ['actor_1'];
      content = JSON.stringify({
        schemaVersion: 1,
        activity: { title: '钟离的料理之夜', theme: '轻松竞技', location: '璃月港', rules: '保持轻松愉快', overview: '用料理比赛把最近的热梗搬进活动。' },
        actorRoles: actorIds.map((actorId) => ({ actorId, activityRole: '受邀参与者' })),
        stages: [
          { clientId: 'plan_s1', title: '食材准备', actorIds, location: '璃月港', description: '分头采购食材。', requiredBeats: ['集合完成'], endCondition: '食材齐备' },
          { clientId: 'plan_s2', title: '料理对决', actorIds, location: '港口餐厅', description: '分组完成菜品并互评。', requiredBeats: ['合影留念'], endCondition: '圆满结束' },
        ],
      });
    } else if (prompt.includes('话题素材整理员')) {
      content = JSON.stringify({ topics: [{
        title: '新版本料理活动引发热议',
        summary: '新版本上线后，玩家在社区讨论料理活动的玩法与角色互动，相关二创数量明显上升，成为近期较容易改编成聚会类活动的话题。',
        works: ['原神'],
        characters: ['派蒙'],
        kind: 'meme',
        infoNature: 'community',
        adaptationTags: ['厨艺比赛', '旅行聚会'],
        itemIndexes: [1, 2],
      }] });
    } else if (prompt.includes('活动点子') || prompt.includes('点子')) {
      content = JSON.stringify({ ideas: [
        {
          name: '料理对决之夜', overview: '用料理比赛把最近的热梗搬进活动。', adaptation: '把社区讨论的料理活动做成两两对决的赛制。',
          recommendedCharacters: [{ name: '派蒙', work: '原神', reason: '热爱美食', relationshipNote: '同行伙伴，属于创作安排' }],
          location: '璃月港的餐厅', style: '轻松竞技',
          stages: [{ title: '食材准备', outline: '分头采购食材' }, { title: '料理对决', outline: '分组完成菜品并互评' }],
          expectedHighlights: ['互评时的吐槽', '合影留念'], assumptions: ['参赛角色之间的胜负关系属于建议'],
        },
        {
          name: '深夜食堂闲聊', overview: '以夜宵闲谈为主线的慢节奏活动。', adaptation: '把热梗当作聊天话题而不是比赛。',
          recommendedCharacters: [{ name: '琴', work: '原神', reason: '适合主持', relationshipNote: '同为活动参与者' }],
          location: '港口的夜宵摊', style: '温情日常',
          stages: [{ title: '集合', outline: '大家陆续到场' }, { title: '闲谈', outline: '聊起最近的新鲜事' }],
          expectedHighlights: ['夜宵照片'], assumptions: [],
        },
        {
          name: '主题摄影散步', overview: '以拍照为主的活动。', adaptation: '把热梗变成拍照主题。',
          recommendedCharacters: [{ name: '宵宫', work: '原神', reason: '擅长烟花与摄影', relationshipNote: '受邀参与者' }],
          location: '璃月港码头', style: '放松摄影',
          stages: [{ title: '选景', outline: '挑选拍摄地点' }, { title: '合影', outline: '完成主题合影' }],
          expectedHighlights: ['合影'], assumptions: [],
        },
      ] });
    } else {
      content = JSON.stringify({ topics: [] });
    }
    return Response.json({ choices: [{ message: { role: 'assistant', content: String(content) } }] });
  }) as unknown as typeof fetch;
}

function combinedFetch(mcp: typeof fetch, llm: typeof fetch): typeof fetch {
  return (async (input, init) => (String(input).includes('/chat/completions') ? llm(input, init) : mcp(input, init))) as typeof fetch;
}

async function bootstrap(options: { failSource?: boolean; delayMs?: number; fetcher?: typeof fetch } = {}) {
  const database = new ServiceDatabase();
  const secrets = new MemorySecrets();
  const fetcher = options.fetcher ?? combinedFetch(topicMcpFetch({ fail: options.failSource, delayMs: options.delayMs }), topicLlmFetch());
  const { app } = await createService({ config: readConfig({ STHSTART_ADMIN_TOKEN: adminToken }), database, secrets, fetcher });
  const now = new Date().toISOString();
  database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)')
    .run('llm', 'LLM', 'llm', 'http://llm.test/v1', 'gpt-4o', null, now, now);
  database.connection.prepare("INSERT INTO app_llm_assignments VALUES ('activities', 'text', 'llm', ?)").run(now);
  await app.inject({ method: 'POST', url: '/api/v1/admin/mcp-sources', headers: adminHeaders, payload: {
    id: 'community-source', name: '社区资料源', url: 'https://community.example.com/mcp', authMode: 'none',
    applicableWorks: ['原神'], universal: false, purpose: '近期社区讨论', allowedTools: ['hot_search'], timeoutMs: 30_000,
  } });
  const character = await app.inject({ method: 'POST', url: '/api/v1/admin/characters', headers: adminHeaders, payload: {
    displayName: '钟离',
    draft: { schemaVersion: 2, displayName: '钟离', work: '原神', identity: '往生堂客卿', personality: ['沉稳'], speech: { tone: '平稳' }, appearance: { description: '棕色长发' } },
    tags: ['原神'],
  } });
  return { app, database, secrets, characterId: character.json().id as string };
}

async function waitForRun(app: Awaited<ReturnType<typeof bootstrap>>['app'], runId: string): Promise<RunView> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const poll = await app.inject({ url: '/api/v1/admin/topic-collection/runs/' + runId, headers: adminHeaders });
    const run = poll.json() as RunView;
    if (!['queued', 'running'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('搜集任务未在预期时间内结束');
}

test('topics: 下次执行时间按设置时区计算，错过时间只顺延一次', () => {
  // 2026-09-14T00:30:00Z 是北京时间 08:30，还没到 09:00，应是当天。
  const next = computeNextRunAt(new Date('2026-09-14T00:30:00Z'), '09:00', 'Asia/Shanghai');
  assert.equal(next, '2026-09-14T01:00:00.000Z');
  // 北京时间 10:00 已过 09:00，顺延到次日 09:00。
  const tomorrow = computeNextRunAt(new Date('2026-09-14T02:00:00Z'), '09:00', 'Asia/Shanghai');
  assert.equal(tomorrow, '2026-09-15T01:00:00.000Z');
  // 时区不同，结果不同：同一时刻在 UTC 下还在当天。
  const utc = computeNextRunAt(new Date('2026-09-14T00:30:00Z'), '09:00', 'UTC');
  assert.equal(utc, '2026-09-14T09:00:00.000Z');
  assert.equal(describeInZone('2026-09-14T01:00:00.000Z', 'Asia/Shanghai'), '2026-09-14 09:00');
  assert.deepEqual(parseDailyTime('25:99'), { hour: 9, minute: 0 });
  assert.equal(normalizeTimezone('Not/AZone'), 'Asia/Shanghai');
  assert.deepEqual(parseDailyTime('07:05'), { hour: 7, minute: 5 });
});

test('topics: 链接去重保留信息量更大的条目', () => {

test('topics: 没有关注作品与关键词时退回通用检索词', () => {
  const settings = {
    enabled: true, works: [], keywords: [], sources: [], dailyTime: '09:00',
    timezone: 'Asia/Shanghai', nextRunAt: null, maxNewTopics: 20, updatedAt: '',
  };
  const keywords = buildSearchKeywords(settings, []);
  assert.ok(keywords.length > 0, '不能生成空关键词，否则搜集会静默什么都搜不到');
  assert.ok(keywords.includes('新版本'));
  // 有关注作品时仍然以作品为主。
  assert.ok(buildSearchKeywords(settings, ['原神']).some((keyword) => keyword.includes('原神')));
});
  const base: RawCandidate = { title: 'A', url: 'https://x.test/1', excerpt: '短', sourceId: 's', sourceName: 'S', documentLocator: '' };
  const deduped = dedupeCandidates([base, { ...base, excerpt: '更长的一段说明文字' }, { ...base, url: 'https://x.test/2', title: 'A' }]);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].excerpt, '更长的一段说明文字');
});

test('topics: 手动补采写入素材，重复搜集不重复入库', async () => {
  const { app, database } = await bootstrap();
  const saved = await app.inject({ method: 'PUT', url: '/api/v1/admin/topic-collection/settings', headers: adminHeaders, payload: {
    enabled: true, works: ['原神'], keywords: ['料理梗'], sources: [{ sourceId: 'community-source', searchTool: 'hot_search' }],
    dailyTime: '09:00', timezone: 'Asia/Shanghai', maxNewTopics: 20,
  } });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().settings.enabled, true);
  assert.ok(saved.json().settings.nextRunAt, '开启后应计算下次执行时间');

  const started = await app.inject({ method: 'POST', url: '/api/v1/admin/topic-collection/runs', headers: adminHeaders, payload: {} });
  assert.equal(started.statusCode, 202);
  const run = await waitForRun(app, started.json().run.id);
  assert.equal(run.status, 'succeeded');
  assert.equal(run.createdCount, 1);
  // 同一事件的第二条报道合并进同一话题，不新增条目。
  assert.ok(run.mergedCount >= 1, '同一事件的其他报道应计入合并');

  const list = await app.inject({ url: '/api/v1/admin/topics', headers: adminHeaders });
  assert.equal(list.statusCode, 200);
  const topics = list.json() as { items: Array<Record<string, unknown>>; total: number; facets: { works: string[] } };
  assert.equal(topics.total, 1);
  // 同一事件的两条报道归并到一个话题，并保留两个来源链接。
  assert.equal(topics.items[0].sourceCount, 2, '同一话题应保留多个来源');
  assert.deepEqual(topics.items[0].adaptationTags, ['厨艺比赛', '旅行聚会']);
  // 跟踪参数被去掉，来源链接是标准化的。
  const detail = await app.inject({ url: '/api/v1/admin/topics/' + String(topics.items[0].id), headers: adminHeaders });
  const sourceUrls = (detail.json().sources as Array<{ url: string }>).map((source) => source.url);
  assert.ok(sourceUrls.includes('https://community.example.com/post/1'), '跟踪参数应被去掉');
  assert.ok(sourceUrls.includes('https://community.example.com/post/2'));
  assert.ok(topics.facets.works.includes('原神'));

  // 再跑一次：同一话题不再新增，执行记录记为合并。
  const again = await app.inject({ method: 'POST', url: '/api/v1/admin/topic-collection/runs', headers: adminHeaders, payload: {} });
  const secondRun = await waitForRun(app, again.json().run.id);
  assert.equal(secondRun.createdCount, 0);
  assert.ok(secondRun.mergedCount >= 1, '重复搜集的同一话题应计入合并');
  const after = await app.inject({ url: '/api/v1/admin/topics', headers: adminHeaders });
  assert.equal((after.json() as { total: number }).total, 1, '重复搜集不应产生重复素材');

 await app.close(); database.close();
});
test('topics: 调度器按设置补采一次并顺延下次执行时间', async () => {
  const { app, database, secrets } = await bootstrap();
  const store = new TopicStore(database);
  const config = readConfig({ STHSTART_ADMIN_TOKEN: adminToken });
  const scheduler = new TopicScheduler({ config, database, secrets, fetcher: undefined });

  await app.inject({ method: 'PUT', url: '/api/v1/admin/topic-collection/settings', headers: adminHeaders, payload: {
    enabled: true, works: ['原神'], sources: [{ sourceId: 'community-source', searchTool: 'hot_search' }],
    dailyTime: '09:00', timezone: 'Asia/Shanghai',
  } });
  // 把计划时间设成已经过去：模拟关机/停服期间错过计划。
  store.setNextRunAt(new Date(Date.now() - 3 * 60_000).toISOString());
  const before = store.getSettings().nextRunAt;

  const run = await scheduler.tick();
  assert.ok(run, '错过的计划应补采一次');
  assert.equal(run!.trigger, 'scheduled');
  const after = store.getSettings().nextRunAt;
  assert.notEqual(after, before, '补采后应重算下次执行时间');
  assert.ok(Date.parse(after!) > Date.now(), '下次执行时间应在未来');

  // 立刻再检查一次：还没到点，不重复启动。
  const second = await scheduler.tick();
  assert.equal(second, null, '未到点不应再次启动');

  // 有任务在运行时也不启动第二份。
  store.setNextRunAt(new Date(Date.now() - 60_000).toISOString());
  const blocked = await scheduler.tick();
  assert.equal(blocked, null, '已有运行中的任务时不应启动第二份');

  // 等补采任务真正结束再关库，否则后台任务会在测试结束后写库。
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const status = store.getRun(run!.id)?.status ?? 'finished';
    if (status !== 'queued' && status !== 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  scheduler.stop();
  await app.close(); database.close();
});

test('topics: 进程重启把未结束任务标记为中断', async () => {
  const { app, database } = await bootstrap();
  const store = new TopicStore(database);
  const run = store.createRun({ trigger: 'scheduled', settingsSnapshot: {} });
  assert.equal(store.getRun(run.id)?.status, 'queued');
  const interrupted = store.interruptDanglingRuns();
  assert.equal(interrupted, 1);
  assert.equal(store.getRun(run.id)?.status, 'interrupted');
  await app.close(); database.close();
});

test('topics: 全部来源失败明确标记失败', async () => {
  const { app, database } = await bootstrap({ failSource: true });
  await app.inject({ method: 'PUT', url: '/api/v1/admin/topic-collection/settings', headers: adminHeaders, payload: {
    enabled: true, works: ['原神'], sources: [{ sourceId: 'community-source', searchTool: 'hot_search' }],
  } });
  const started = await app.inject({ method: 'POST', url: '/api/v1/admin/topic-collection/runs', headers: adminHeaders, payload: {} });
  const run = await waitForRun(app, started.json().run.id);
  assert.equal(run.status, 'failed');
  assert.ok(run.failedCount >= 1);
  assert.ok(String(run.errorMessage).includes('社区资料源'));
  await app.close(); database.close();
});

test('topics: 忽略可以恢复，且再次搜集不会自动取消忽略', async () => {
  const { app, database } = await bootstrap();
  await app.inject({ method: 'PUT', url: '/api/v1/admin/topic-collection/settings', headers: adminHeaders, payload: {
    enabled: true, works: ['原神'], sources: [{ sourceId: 'community-source', searchTool: 'hot_search' }],
  } });
  const started = await app.inject({ method: 'POST', url: '/api/v1/admin/topic-collection/runs', headers: adminHeaders, payload: {} });
  await waitForRun(app, started.json().run.id);
  const list = await app.inject({ url: '/api/v1/admin/topics', headers: adminHeaders });
  const topicId = String((list.json() as { items: Array<{ id: string }> }).items[0].id);

  const ignored = await app.inject({ method: 'PATCH', url: '/api/v1/admin/topics/' + topicId, headers: adminHeaders, payload: { ignored: true } });
  assert.equal(ignored.json().ignored, true);
  const visible = await app.inject({ url: '/api/v1/admin/topics', headers: adminHeaders });
  assert.equal((visible.json() as { total: number }).total, 0, '默认列表隐藏已忽略素材');
  const ignoredView = await app.inject({ url: '/api/v1/admin/topics?view=ignored', headers: adminHeaders });
  assert.equal((ignoredView.json() as { total: number }).total, 1);

  // 收藏与已使用可以同时存在：忽略期间仍然可以收藏。
  const favorited = await app.inject({ method: 'PATCH', url: '/api/v1/admin/topics/' + topicId, headers: adminHeaders, payload: { favorite: true } });
  assert.equal(favorited.json().favorite, true);
  assert.equal(favorited.json().ignored, true);

  // 再次搜集到同一话题不会自动取消忽略。
  const rerun = await app.inject({ method: 'POST', url: '/api/v1/admin/topic-collection/runs', headers: adminHeaders, payload: {} });
  await waitForRun(app, rerun.json().run.id);
  const still = await app.inject({ url: '/api/v1/admin/topics/' + topicId, headers: adminHeaders });
  assert.equal(still.json().topic.ignored, true);

  const restored = await app.inject({ method: 'PATCH', url: '/api/v1/admin/topics/' + topicId, headers: adminHeaders, payload: { ignored: false } });
  assert.equal(restored.json().ignored, false);
  assert.equal(restored.json().favorite, true, '恢复忽略不影响收藏');
  await app.close(); database.close();
});

test('topics: 重复点击补采不会并行启动第二个任务', async () => {
  // 让来源响应慢一点，保证第二次点击时任务仍在运行。
  const { app, database } = await bootstrap({ delayMs: 400 });
  await app.inject({ method: 'PUT', url: '/api/v1/admin/topic-collection/settings', headers: adminHeaders, payload: {
    enabled: true, works: ['原神'], sources: [{ sourceId: 'community-source', searchTool: 'hot_search' }],
  } });
  const first = await app.inject({ method: 'POST', url: '/api/v1/admin/topic-collection/runs', headers: adminHeaders, payload: {} });
  assert.equal(first.statusCode, 202);
  const second = await app.inject({ method: 'POST', url: '/api/v1/admin/topic-collection/runs', headers: adminHeaders, payload: {} });
  assert.equal(second.statusCode, 202);
  assert.equal(second.json().reused, true);
  assert.equal(second.json().run.id, first.json().run.id, '重复点击应返回同一个任务');
  await waitForRun(app, first.json().run.id);
  await app.close(); database.close();
});

test('ideas: 生成三个点子、采用后建立企划会话并保存灵感来源', async () => {
  const { app, database, characterId } = await bootstrap();
  await app.inject({ method: 'PUT', url: '/api/v1/admin/topic-collection/settings', headers: adminHeaders, payload: {
    enabled: true, works: ['原神'], sources: [{ sourceId: 'community-source', searchTool: 'hot_search' }],
  } });
  const runStart = await app.inject({ method: 'POST', url: '/api/v1/admin/topic-collection/runs', headers: adminHeaders, payload: {} });
  await waitForRun(app, runStart.json().run.id);
  const topics = await app.inject({ url: '/api/v1/admin/topics', headers: adminHeaders });
  const topicId = String((topics.json() as { items: Array<{ id: string }> }).items[0].id);

  const batchResponse = await app.inject({ method: 'POST', url: '/api/v1/admin/activity-idea-batches', headers: adminHeaders, payload: {
    topicIds: [topicId], requirement: '用这几个梗给钟离办一场聚会', leadCharacterId: characterId, activityType: '聚会',
  } });
  assert.equal(batchResponse.statusCode, 202);
  const batchId = batchResponse.json().id as string;
  let batch: IdeaBatchView | null = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const poll = await app.inject({ url: '/api/v1/admin/activity-idea-batches/' + batchId, headers: adminHeaders });
    batch = poll.json() as IdeaBatchView;
    if (batch && batch.status !== 'queued' && batch.status !== 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(batch, '批次应存在');
  assert.equal(batch.status, 'succeeded');
  assert.equal(batch.ideas.length, 3, '默认生成三个点子');
  assert.ok(batch.ideas.every((idea) => String(idea.name).trim()));

  // 追加一批候选，保留前一批。
  const append = await app.inject({ method: 'POST', url: '/api/v1/admin/activity-idea-batches', headers: adminHeaders, payload: {
    topicIds: [topicId], appendToBatchId: batchId, ideaCount: 3,
  } });
  assert.equal(append.statusCode, 202);
  let appended: IdeaBatchView | null = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const poll = await app.inject({ url: '/api/v1/admin/activity-idea-batches/' + batchId, headers: adminHeaders });
    appended = poll.json() as IdeaBatchView;
    if (appended && appended.status !== 'queued' && appended.status !== 'running' && appended.ideas.length > 3) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(appended && appended.ideas.length > 3, '追加应保留前一批候选');

  const ideaId = String(appended.ideas[0].id);
  // 批次里带了主角：不带 sessionId 时应直接建立一份企划会话。
  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/activity-idea-batches/' + batchId + '/ideas/' + ideaId + '/apply', headers: adminHeaders, payload: {} });
  assert.equal(created.statusCode, 201, '批带有主角时应能建立企划会话');
  assert.equal(created.json().createdSession, true);
  const createdSessionId = created.json().sessionId as string;
  const repeated = await app.inject({ method: 'POST', url: '/api/v1/admin/activity-idea-batches/' + batchId + '/ideas/' + ideaId + '/apply', headers: adminHeaders, payload: {} });
  assert.equal(repeated.statusCode, 200);
  assert.equal(repeated.json().sessionId, createdSessionId, '重复采用不得创建重复会话');
  const createdDetail = await app.inject({ url: '/api/v1/admin/activity-planning-sessions/' + createdSessionId, headers: adminHeaders });
  assert.equal(createdDetail.json().session.document.actors.length, 1, '用批次主角建立会话');
  assert.equal(createdDetail.json().session.form.title, String(appended.ideas[0].name));
  // 没有主角的批次先建立企划草稿，进入向导后再选人物。
  const orphanBatch = await app.inject({ method: 'POST', url: '/api/v1/admin/activity-idea-batches', headers: adminHeaders, payload: { topicIds: [topicId] } });
  let orphan: IdeaBatchView | null = null;
  const orphanId = orphanBatch.json().id as string;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const poll = await app.inject({ url: '/api/v1/admin/activity-idea-batches/' + orphanId, headers: adminHeaders });
    orphan = poll.json() as IdeaBatchView;
    if (orphan && !['queued', 'running'].includes(orphan.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const orphanApply = await app.inject({ method: 'POST', url: '/api/v1/admin/activity-idea-batches/' + orphanId + '/ideas/' + String(orphan!.ideas[0].id) + '/apply', headers: adminHeaders, payload: {} });
  assert.equal(orphanApply.statusCode, 201, '没有主角时应允许先建立灵感企划，再选择人物');
  const emptySession = (await app.inject({ url: '/api/v1/admin/activity-planning-sessions/' + orphanApply.json().sessionId, headers: adminHeaders })).json().session;
  assert.equal(emptySession.document.actors.length, 0);

  // 建立带角色的会话，再应用点子。
  const session = await app.inject({ method: 'POST', url: '/api/v1/admin/activity-planning-sessions', headers: adminHeaders, payload: {
    form: {
      templateId: 'blank', title: '', type: '聚会', theme: '', location: '', rules: '', scheduledDate: '2026-09-20',
      characters: [{ characterId, activityRole: '主角' }], birthdayCharacterIds: [], leadCharacterId: characterId,
    },
  } });
  assert.equal(session.statusCode, 201);
  const sessionId = session.json().session.id as string;
  const withIdea = await app.inject({ method: 'POST', url: '/api/v1/admin/activity-idea-batches/' + batchId + '/ideas/' + ideaId + '/apply', headers: adminHeaders, payload: { sessionId } });
  assert.equal(withIdea.statusCode, 200);
  assert.equal(withIdea.json().createdSession, false);
  assert.equal(withIdea.json().sessionId, sessionId);

  const detail = await app.inject({ url: '/api/v1/admin/activity-planning-sessions/' + sessionId, headers: adminHeaders });
  const form = detail.json().session.form as Record<string, unknown>;
  assert.ok(form.inspiration, '表单应保存灵感来源快照');
  assert.equal((form.inspiration as { ideaId: string }).ideaId, ideaId);
  // 保留已有日期，不覆盖非空输入。
  assert.equal(form.scheduledDate, '2026-09-20');
  // 空标题用点子名称填入；日期等非空输入不被覆盖。
  assert.equal(form.title, String(appended.ideas[0].name));
  assert.ok(String(form.instruction).includes('本次企划必须采用的灵感'), '企划要求应包含点子内容');
  assert.ok(String(form.instruction).includes('只是候选提示'), '推荐人物应标明只是候选提示');
  assert.equal(detail.json().session.document.actors.length, 1, '推荐人物不应自动成为参与者');

  // 明确替换标题与主题：overrides 才覆盖已有输入，日期仍然保留。
  const replaced = await app.inject({ method: 'POST', url: '/api/v1/admin/activity-idea-batches/' + batchId + '/ideas/' + ideaId + '/apply', headers: adminHeaders, payload: {
    sessionId, overrides: { title: '钟离的料理之夜', theme: '轻松竞技的料理主题' },
  } });
  assert.equal(replaced.statusCode, 200);
  const afterReplace = await app.inject({ url: '/api/v1/admin/activity-planning-sessions/' + sessionId, headers: adminHeaders });
  assert.equal(afterReplace.json().session.form.title, '钟离的料理之夜');
  assert.equal(afterReplace.json().session.form.theme, '轻松竞技的料理主题');
 assert.equal(afterReplace.json().session.form.scheduledDate, '2026-09-20', '替换标题不应清掉已有日期');

  // 表单同步（不带灵感来源）不能把快照弄丢：来源是服务端持有的快照。
  const resynced = await app.inject({ method: 'PUT', url: '/api/v1/admin/activity-planning-sessions/' + sessionId, headers: adminHeaders, payload: {
    expectedVersion: afterReplace.json().session.version,
    form: { ...afterReplace.json().session.form, inspiration: undefined },
  } });
  assert.equal(resynced.statusCode, 200);
  assert.ok(resynced.json().session.form.inspiration, '表单同步后灵感来源仍应保留');
  assert.equal(resynced.json().session.form.inspiration.ideaId, ideaId);

  await app.close(); database.close();
});

test('ideas: 正式创建活动后才把素材标为已使用并记录灵感来源', async () => {
  const { app, database, characterId } = await bootstrap();
  await app.inject({ method: 'PUT', url: '/api/v1/admin/topic-collection/settings', headers: adminHeaders, payload: {
    enabled: true, works: ['原神'], sources: [{ sourceId: 'community-source', searchTool: 'hot_search' }],
  } });
  const started = await app.inject({ method: 'POST', url: '/api/v1/admin/topic-collection/runs', headers: adminHeaders, payload: {} });
  await waitForRun(app, started.json().run.id);
  const topics = await app.inject({ url: '/api/v1/admin/topics', headers: adminHeaders });
  const topicId = String((topics.json() as { items: Array<{ id: string }> }).items[0].id);

  const batchResponse = await app.inject({ method: 'POST', url: '/api/v1/admin/activity-idea-batches', headers: adminHeaders, payload: { topicIds: [topicId], leadCharacterId: characterId } });
  const batchId = batchResponse.json().id as string;
  let batch: IdeaBatchView | null = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const poll = await app.inject({ url: '/api/v1/admin/activity-idea-batches/' + batchId, headers: adminHeaders });
    batch = poll.json() as IdeaBatchView;
    if (batch && !['queued', 'running'].includes(batch.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const ideaId = String(batch!.ideas[0].id);

  const sessionResponse = await app.inject({ method: 'POST', url: '/api/v1/admin/activity-planning-sessions', headers: adminHeaders, payload: {
    form: {
      templateId: 'blank', title: '钟离的料理之夜', type: '聚会', theme: '轻松竞技', location: '璃月港', rules: '', scheduledDate: null,
      characters: [{ characterId, activityRole: '主角' }], birthdayCharacterIds: [], leadCharacterId: characterId,
    },
  } });
  const sessionId = sessionResponse.json().session.id as string;
  await app.inject({ method: 'POST', url: '/api/v1/admin/activity-idea-batches/' + batchId + '/ideas/' + ideaId + '/apply', headers: adminHeaders, payload: { sessionId } });

  const before = await app.inject({ url: '/api/v1/admin/topics/' + topicId, headers: adminHeaders });
  assert.equal(before.json().topic.usedActivityId, undefined, '只生成点子不算已使用');

  // 生成方案并创建活动。
  const sessionDetail = await app.inject({ url: '/api/v1/admin/activity-planning-sessions/' + sessionId, headers: adminHeaders });
  const job = await app.inject({ method: 'POST', url: '/api/v1/admin/activity-planning-sessions/' + sessionId + '/jobs', headers: adminHeaders, payload: { planCount: 1 } });
  const jobId = job.json().id as string;
  let candidates: Array<{ id: string; payload: unknown }> = [];
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const poll = await app.inject({ url: '/api/v1/admin/activity-planning-sessions/' + sessionId + '/jobs/' + jobId, headers: adminHeaders });
    const data = poll.json() as { job: { status: string }; candidates: Array<{ id: string; payload: unknown }> };
    if (!['queued', 'running'].includes(data.job.status)) { candidates = data.candidates; break; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(candidates.length, 1, '应生成一份方案');

  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/activity-planning-sessions/' + sessionId + '/create-activity', headers: adminHeaders, payload: {
    document: applyPlanningOutput(sessionDetail.json().session.document, candidates[0].payload as never),
    candidateId: candidates[0].id,
  } });
  assert.equal(created.statusCode, 201);

  const after = await app.inject({ url: '/api/v1/admin/topics/' + topicId, headers: adminHeaders });
  assert.equal(after.json().topic.usedActivityId, created.json().activity.id, '创建活动后素材应标记为已使用');

  const fetchActivity = await app.inject({ url: '/api/v1/admin/activities/' + created.json().activity.id, headers: adminHeaders });
  assert.ok(fetchActivity.statusCode === 200);
  const basis = (fetchActivity.json().currentContentRevision?.document ?? fetchActivity.json().draft?.document)?.activity?.planningBasis;
  assert.ok(basis?.inspiration, '活动依据应保留灵感来源');
  assert.equal(basis.inspiration.ideaId, ideaId);
  assert.ok(basis.inspiration.sources.length >= 2, '正式活动保留来源链接和摘录');
  assert.ok(basis.inspiration.sources[0].url.startsWith('https://'));
  assert.ok(basis.inspiration.recommendedCharacters.length > 0);

  await app.close(); database.close();
});

test('topics: 原始候选只保留最近 30 天，素材不受影响', async () => {
  const { app, database } = await bootstrap();
  const store = new TopicStore(database);
  await app.inject({ method: 'PUT', url: '/api/v1/admin/topic-collection/settings', headers: adminHeaders, payload: {
    enabled: true, works: ['原神'], sources: [{ sourceId: 'community-source', searchTool: 'hot_search' }],
  } });
  const started = await app.inject({ method: 'POST', url: '/api/v1/admin/topic-collection/runs', headers: adminHeaders, payload: {} });
  await waitForRun(app, started.json().run.id);
  assert.ok(store.getRunRawCandidates(started.json().run.id).length > 0);

  // 把任务时间提前 40 天，模拟过期记录。
  database.connection.prepare('UPDATE topic_collection_runs SET created_at=? WHERE id=?')
    .run(new Date(Date.now() - 40 * 86_400_000).toISOString(), started.json().run.id);
  const pruned = store.pruneRawCandidates(30);
  assert.equal(pruned, 1);
  assert.equal(store.getRunRawCandidates(started.json().run.id).length, 0);
  const topics = await app.inject({ url: '/api/v1/admin/topics', headers: adminHeaders });
  assert.equal((topics.json() as { total: number }).total, 1, '素材不随原始候选清理而删除');

  await app.close(); database.close();
});

test('topics: 素材的发布时间只取来源能确认的时间', async () => {
  const { app, database } = await bootstrap();
  const store = new TopicStore(database);
  // 来源没有发布时间时，素材不能凭空给出一个发布时间。
  const unknown = store.upsertTopic({
    title: '没有发布时间的讨论', summary: '摘要', works: ['原神'], characters: [],
    kind: 'meme', infoNature: 'unknown', adaptationTags: [], publishedAt: null,
    source: { sourceName: '社区资料源', url: 'https://community.example.com/post/unknown', documentLocator: '', title: '没有发布时间的讨论', excerpt: '正文' },
  });
  assert.equal(store.getTopic(unknown.topicId)!.latestPublishedAt, undefined);
  // 有发布时间时按最新的一条返回。
  const known = store.upsertTopic({
    title: '有发布时间的讨论', summary: '摘要', works: ['原神'], characters: [],
    kind: 'update', infoNature: 'official', adaptationTags: [], publishedAt: '2026-09-10T00:00:00.000Z',
    source: { sourceName: '社区资料源', url: 'https://community.example.com/post/known', documentLocator: '', title: '有发布时间的讨论', excerpt: '正文' },
  });
  store.upsertTopic({
    title: '有发布时间的讨论', summary: '摘要', works: ['原神'], characters: [],
    kind: 'update', infoNature: 'official', adaptationTags: [], publishedAt: '2026-09-12T00:00:00.000Z',
    source: { sourceName: '社区资料源', url: 'https://community.example.com/post/known-2', documentLocator: '', title: '有发布时间的讨论', excerpt: '另一条报道' },
  });
  assert.equal(store.getTopic(known.topicId)!.latestPublishedAt, '2026-09-12T00:00:00.000Z');
  await app.close(); database.close();
});


test('topics: 不按标题前缀误合并，保留无 URL 的独立来源和定位参数', () => {
  const database = new ServiceDatabase();
  try {
    const store = new TopicStore(database);
    const input = { title: '原神角色生日活动社区讨论的最新消息：料理', summary: '说明', works: ['原神'], characters: [], kind: 'meme' as const, infoNature: 'community' as const, adaptationTags: [], source: { sourceId: 'a', sourceName: 'A', url: 'https://x.test/article?id=1&from=chapter&utm_source=share#scene', documentLocator: 'one', title: '原文', excerpt: '说明' } };
    const first = store.upsertTopic(input);
    const other = store.upsertTopic({ ...input, title: '原神角色生日活动社区讨论的最新消息：摄影', source: { ...input.source, url: 'https://x.test/article?id=2' } });
    assert.notEqual(first.topicId, other.topicId);
    assert.equal(normalizeTopicUrl(input.source.url), 'https://x.test/article?id=1&from=chapter#scene');
    store.upsertTopic({ ...input, targetTopicId: first.topicId, source: { ...input.source, url: '', documentLocator: 'doc-a' } });
    store.upsertTopic({ ...input, targetTopicId: first.topicId, source: { ...input.source, url: '', documentLocator: 'doc-b' } });
    assert.equal(store.getTopicDetail(first.topicId)!.sources.length, 3);
    assert.equal(dedupeCandidates([{ ...input.source, sourceId: 'a' }, { ...input.source, sourceId: 'a', title: '另一标题', url: 'https://x.test/article?id=1&from=chapter&utm_source=other#scene' }]).length, 1);
  } finally { database.close(); }
});

test('topics: 不限时间筛选包含旧素材，作品筛选精确匹配', async () => {
  const { app, database } = await bootstrap();
  try {
    const store = new TopicStore(database);
    const saved = store.upsertTopic({ title: '旧素材', summary: '摘要', works: ['原神'], characters: [], kind: 'meme', infoNature: 'unknown', adaptationTags: [], source: { sourceName: '来源', url: 'https://x.test/old', documentLocator: '', title: '旧', excerpt: '' } });
    database.connection.prepare('UPDATE topics SET last_seen_at=? WHERE id=?').run(new Date(Date.now() - 60 * 86400000).toISOString(), saved.topicId);
    assert.equal((await app.inject({ url: '/api/v1/admin/topics', headers: adminHeaders })).json().total, 0);
    assert.equal((await app.inject({ url: '/api/v1/admin/topics?days=0', headers: adminHeaders })).json().total, 1);
    assert.equal(store.listTopics({ days: 0, works: ['原'] }).total, 0);
    assert.equal(store.listTopics({ days: 0, works: ['原神'] }).total, 1);
  } finally { await app.close(); database.close(); }
});

test('topics: 整理失败重试复用原始候选，无效引用不会被伪造来源', async () => {
  let broken = true;
  let invalidCitation = false;
  let searches = 0;
  const mcp = topicMcpFetch();
  const llm = topicLlmFetch();
  const fetcher: typeof fetch = async (url, init) => {
    if (!String(url).includes('/chat/completions')) {
      if (String(init?.body).includes('tools/call')) searches++;
      return mcp(url, init);
    }
    if (broken) return Response.json({ choices: [{ message: { content: 'invalid json' } }] });
    if (invalidCitation) return Response.json({ choices: [{ message: { content: JSON.stringify({ topics: [{ title: '凭空的话题', summary: '没有来源', itemIndexes: [999] }] }) } }] });
    return llm(url, init);
  };
  const { app, database } = await bootstrap({ fetcher });
  try {
    await app.inject({ method: 'PUT', url: '/api/v1/admin/topic-collection/settings', headers: adminHeaders, payload: { works: ['原神'], sources: [{ sourceId: 'community-source', searchTool: 'hot_search' }] } });
    const start = await app.inject({ method: 'POST', url: '/api/v1/admin/topic-collection/runs', headers: adminHeaders, payload: {} });
    const id = start.json().run.id;
    assert.equal((await waitForRun(app, id)).status, 'failed');
    assert.equal(new TopicStore(database).getRunRawCandidates(id).length, 3, '不能把结果截成两条');
    const before = searches;
    broken = false;
    const retry = await app.inject({ method: 'POST', url: '/api/v1/admin/topic-collection/runs', headers: adminHeaders, payload: { retryRunId: id } });
    assert.equal((await waitForRun(app, retry.json().run.id)).status, 'succeeded');
    assert.equal(searches, before, '已有原始候选时重试不再搜索');
    invalidCitation = true;
    const phantom = await app.inject({ method: 'POST', url: '/api/v1/admin/topic-collection/runs', headers: adminHeaders, payload: {} });
    assert.equal((await waitForRun(app, phantom.json().run.id)).status, 'failed');
    assert.equal(new TopicStore(database).listTopics({ q: '凭空' }).total, 0);
  } finally { await app.close(); database.close(); }
});

test('topics: 执行所选原文工具并遵守调用预算', async () => {
  let reads = 0;
  let calls = 0;
  const mcp = topicMcpFetch();
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).includes('/chat/completions')) return topicLlmFetch()(url, init);
    const body = JSON.parse(String(init?.body || '{}'));
    if (body.method === 'tools/list') return Response.json({ jsonrpc: '2.0', id: body.id, result: { tools: [
      { name: 'hot_search', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
      { name: 'hot_read', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false } },
    ] } });
    if (body.method === 'tools/call') {
      calls++;
      if (body.params.name === 'hot_read') {
        reads++;
        assert.ok(body.params.arguments.url.startsWith('https://community.example.com/post/'));
        return Response.json({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: '读取到可核对的原文。'.repeat(30) }] } });
      }
      assert.match(body.params.arguments.query, /after:\d{4}-\d{2}-\d{2}/);
    }
    return mcp(url, init);
  };
  const { app, database } = await bootstrap({ fetcher });
  try {
    database.connection.prepare('UPDATE mcp_sources SET allowed_tools_json=? WHERE id=?').run(JSON.stringify(['hot_search', 'hot_read']), 'community-source');
    await app.inject({ method: 'PUT', url: '/api/v1/admin/topic-collection/settings', headers: adminHeaders, payload: { works: ['原神'], sources: [{ sourceId: 'community-source', searchTool: 'hot_search', readTool: 'hot_read' }] } });
    const start = await app.inject({ method: 'POST', url: '/api/v1/admin/topic-collection/runs', headers: adminHeaders, payload: {} });
    const run = await waitForRun(app, start.json().run.id);
    assert.ok(['succeeded', 'partial'].includes(run.status));
    assert.ok(reads > 0);
    assert.ok(calls <= 12);
    const raw = new TopicStore(database).getRunRawCandidates(start.json().run.id) as RawCandidate[];
    assert.ok(raw.some(item => item.excerpt.includes('可核对的原文')));
  } finally { await app.close(); database.close(); }
});

test('ideas: 来源在生成时冻结，历史追加无须重新勾选且保留超过十二个点子', async () => {
  const { app, database, characterId } = await bootstrap();
  try {
    const store = new TopicStore(database);
    const seed = store.upsertTopic({ title: '原始素材', summary: '原始解释', works: ['原神'], characters: [], kind: 'meme', infoNature: 'community', adaptationTags: [], source: { sourceName: '社区', url: 'https://x.test/snapshot', documentLocator: 'doc', title: '原文', excerpt: '生成时的原文' } });
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/activity-idea-batches', headers: adminHeaders, payload: { topicIds: [seed.topicId], leadCharacterId: characterId } });
    const batchId = created.json().id;
    const waitBatch = async () => {
      for (let i = 0; i < 100; i++) {
        const batch = (await app.inject({ url: '/api/v1/admin/activity-idea-batches/' + batchId, headers: adminHeaders })).json();
        if (!['queued', 'running'].includes(batch.status)) { assert.equal(batch.status, 'succeeded', batch.errorMessage); return batch; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error('batch timed out');
    };
    let batch = await waitBatch();
    const firstId = batch.ideas[0].id;
    database.connection.prepare('UPDATE topic_sources SET excerpt=? WHERE topic_id=?').run('后来更新的原文', seed.topicId);
    for (let i = 0; i < 4; i++) {
      const append = await app.inject({ method: 'POST', url: '/api/v1/admin/activity-idea-batches', headers: adminHeaders, payload: { appendToBatchId: batchId } });
      assert.equal(append.statusCode, 202, append.body);
      batch = await waitBatch();
    }
    assert.equal(batch.ideas.length, 15);
    assert.equal(batch.ideas[0].id, firstId);
    const applied = await app.inject({ method: 'POST', url: '/api/v1/admin/activity-idea-batches/' + batchId + '/ideas/' + firstId + '/apply', headers: adminHeaders, payload: {} });
    const session = (await app.inject({ url: '/api/v1/admin/activity-planning-sessions/' + applied.json().sessionId, headers: adminHeaders })).json().session;
    assert.equal(session.form.inspiration.sources[0].excerpt, '生成时的原文');
    assert.equal(session.form.inspiration.stages.length, 2);
    assert.equal(session.document.actors.length, 1);
  } finally { await app.close(); database.close(); }
});
