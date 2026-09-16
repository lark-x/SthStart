import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from './server.js';
import { ServiceDatabase } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { KnowledgeCollectionStore, buildCollectionKeywords, dedupeKnowledgeCandidates } from './knowledge/collections.js';
import { KnowledgeScheduler } from './knowledge/scheduler.js';
import { KnowledgeStore } from './knowledge/store.js';

const adminToken = 'admin-knowledge-collections-token-1234567';
const adminHeaders = { 'x-sthstart-admin-token': adminToken };

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

/** 模拟资料源：按来源主机返回不同结果，并统计真实调用次数。 */
function makeMcpFetch(state: { calls: number; excerpt: string; failHost?: string }) {
  return (async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'GET') return new Response(null, { status: 405 });
    const body = init?.body ? JSON.parse(String(init.body)) as { id?: number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } } : {};
    if (body.method === 'initialize') {
      return Response.json({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'KnowledgeMock', version: '1.0' } } });
    }
    if (body.method === 'tools/list') {
      return Response.json({ jsonrpc: '2.0', id: body.id, result: { tools: [
        { name: 'scene_search', description: '搜索设定资料', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
      ] } });
    }
    if (body.method === 'tools/call') {
      state.calls += 1;
      // 模拟某个来源整体不可用。
      if (state.failHost && url.includes(state.failHost)) {
        return Response.json({ jsonrpc: '2.0', id: body.id, result: { isError: true, content: [{ type: 'text', text: '来源暂时不可用' }] } });
      }
      const keyword = String(body.params?.arguments?.query ?? '设定');
      void keyword;
      return Response.json({ jsonrpc: '2.0', id: body.id, result: {
        content: [{ type: 'text', text: '设定资料' }],
        structuredContent: { results: [
          { url: 'https://wiki.example.com/zhongli', title: '钟离设定整理', publishedAt: '2026-01-05', excerpt: state.excerpt },
          { url: 'https://wiki.example.com/hutao', title: '胡桃与往生堂', excerpt: '胡桃是往生堂第七十七代堂主。' },
        ] },
      } });
    }
    return Response.json({ jsonrpc: '2.0', id: body.id, result: {} });
  }) as unknown as typeof fetch;
}

/** 模拟模型：分别处理「搜集整理」与「草稿整理」两类提示词。 */
function makeLlmFetch(state: { organizeWorks: boolean }) {
  return (async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    if (!url.includes('/chat/completions')) return new Response(null, { status: 404 });
    const body = init?.body ? JSON.parse(String(init.body)) as { messages?: Array<{ content?: string }> } : {};
    const prompt = body.messages?.[body.messages.length - 1]?.content ?? '';
    let content = '{}';
    if (prompt.includes('整理方向：')) {
      content = JSON.stringify({ title: '钟离与胡桃的关系整理', text: '钟离是往生堂的客卿，与胡桃同属往生堂。', assumptions: ['两人的日常相处细节属于推测'] });
    } else if (prompt.includes('搜集目标：')) {
      content = state.organizeWorks
        ? JSON.stringify({ items: [{ title: '钟离设定整理', summary: '钟离是往生堂的客卿，负责打理往生堂事务。', works: ['原神'], characters: ['钟离', '胡桃'], assumptions: [], itemIndexes: [1] }] })
        : '这不是 JSON';
    }
    return Response.json({ choices: [{ message: { role: 'assistant', content } }] });
  }) as unknown as typeof fetch;
}

function combined(mcp: typeof fetch, llm: typeof fetch): typeof fetch {
  return (async (input, init) => (String(input).includes('/chat/completions') ? llm(input, init) : mcp(input, init))) as typeof fetch;
}

async function bootstrap(options: { failHost?: string; organizeWorks?: boolean } = {}) {
  const database = new ServiceDatabase();
  const secrets = new MemorySecrets();
  const mcpState = { calls: 0, excerpt: '钟离是往生堂的客卿。', failHost: options.failHost };
  const llmState = { organizeWorks: options.organizeWorks ?? true };
  const fetcher = combined(makeMcpFetch(mcpState), makeLlmFetch(llmState));
  const { app } = await createService({ config: readConfig({ STHSTART_ADMIN_TOKEN: adminToken }), database, secrets, fetcher });
  const now = new Date().toISOString();
  database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)')
    .run('llm', 'LLM', 'llm', 'http://llm.test/v1', 'gpt-4o', null, now, now);
  database.connection.prepare("INSERT INTO app_llm_assignments VALUES ('activities', 'text', 'llm', ?)").run(now);
  await app.inject({ method: 'POST', url: '/api/v1/admin/mcp-sources', headers: adminHeaders, payload: {
    id: 'wiki', name: '设定资料源', url: 'https://wiki.example.com/mcp', authMode: 'none',
    applicableWorks: ['原神'], universal: false, purpose: '角色与设定资料', allowedTools: ['scene_search'], timeoutMs: 30_000,
  } });
  return { app, database, secrets, mcpState, llmState };
}

async function createCollection(app: Awaited<ReturnType<typeof bootstrap>>['app'], payload: Record<string, unknown>) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/collections', headers: adminHeaders, payload });
  assert.equal(response.statusCode, 201, response.body);
  return response.json() as Record<string, unknown>;
}

async function waitForRun(app: Awaited<ReturnType<typeof bootstrap>>['app'], runId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const poll = await app.inject({ url: '/api/v1/admin/knowledge/collection-runs/' + runId, headers: adminHeaders });
    const data = poll.json() as {
      run: { id: string; status: string; trigger: string; newCount: number; changedCount: number; duplicateCount: number; errorMessage?: string };
      pending: Array<Record<string, unknown>>;
      findings: Array<Record<string, unknown>>;
    };
    if (!['queued', 'running'].includes(data.run.status)) return data;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('搜集执行未在预期时间内结束');
}

async function waitForDraft(app: Awaited<ReturnType<typeof bootstrap>>['app'], draftId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const poll = await app.inject({ url: '/api/v1/admin/knowledge/organize-drafts/' + draftId, headers: adminHeaders });
    const draft = poll.json() as { status: string; text: string; sources: unknown[]; baseRevision?: number };
    if (!['queued', 'running'].includes(draft.status)) return draft;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('整理草稿未在预期时间内结束');
}

test('collections: 专题关键词不使用热点词，仅按目标与作品生成', () => {
  const keywords = buildCollectionKeywords({
    goal: '整理钟离的人物关系', works: ['原神'], characters: ['钟离', '胡桃'], mode: 'topic',
  });
  assert.ok(keywords.includes('整理钟离的人物关系'));
  assert.ok(keywords.some((keyword) => keyword.includes('钟离')));
  assert.ok(keywords.some((keyword) => keyword.includes('原神')));
  // 长期资料任务不能强制加上“新梗/近七天”这类热点语境。
  assert.ok(!keywords.some((keyword) => /新梗|近七天|热点/.test(keyword)));
});

test('collections: 相同链接只保留信息量更大的一条', () => {
  const base = { title: 'A', url: 'https://x.test/1', excerpt: '短', sourceId: 's', sourceName: 'S' };
  const deduped = dedupeKnowledgeCandidates([base, { ...base, excerpt: '更长的一段说明文字' }, { ...base, url: 'https://x.test/2' }]);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].excerpt, '更长的一段说明文字');
});

test('collections: 一次性专题任务不绑定企划也不限最近七天', async () => {
  const { app, database } = await bootstrap();
  const collection = await createCollection(app, {
    name: '钟离资料整理', goal: '整理钟离的人物关系', works: ['原神'], characters: ['钟离'],
    mode: 'topic', sources: [{ sourceId: 'wiki', searchTool: 'scene_search' }], frequency: 'once',
  });
  assert.equal(collection.mode, 'topic');
  assert.equal(collection.sessionId, undefined, '长期搜集不应需要企划会话');
  assert.equal(collection.windowDays, 0, '专题模式默认不限时间');

  const started = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/collections/' + collection.id + '/run', headers: adminHeaders, payload: {} });
  assert.equal(started.statusCode, 202);
  const result = await waitForRun(app, started.json().run.id as string);
  assert.equal(result.run.status, 'succeeded', result.run.errorMessage ?? '');
  assert.equal(result.run.newCount, 2);
  assert.equal(result.pending.length, 2, '模型遗漏的来源也必须交付');

  const pending = result.pending.find(item => item.title === '钟离设定整理')! as Record<string, unknown>;
  assert.equal(pending.title, '钟离设定整理');
  assert.equal(pending.changeType, 'new');
  assert.equal(pending.state, 'pending');
  assert.equal(pending.work, '原神');
  assert.deepEqual(pending.characters, ['钟离', '胡桃']);
  assert.equal(pending.url, 'https://wiki.example.com/zhongli');
  assert.ok(pending.publishedAt, '来源发布时间应保留');

  // 一次性任务执行后不安排下一次。
  const detail = await app.inject({ url: '/api/v1/admin/knowledge/collections/' + collection.id, headers: adminHeaders });
  assert.equal(detail.json().collection.nextRunAt, undefined);
  await app.close(); database.close();
});

test('collections: 每天/每周任务可保存、暂停、恢复，并保留历史与下次时间', async () => {
  const { app, database } = await bootstrap();
  const daily = await createCollection(app, {
    name: '每天搜集关系资料', goal: '钟离', works: ['原神'], characters: ['钟离'],
    mode: 'recent', windowDays: 7, sources: [{ sourceId: 'wiki', searchTool: 'scene_search' }],
    frequency: 'daily', dailyTime: '09:00', timezone: 'Asia/Shanghai',
  });
  assert.equal(daily.frequency, 'daily');
  assert.ok(daily.nextRunAt, '每天任务应安排下次执行时间');
  assert.equal(daily.windowDays, 7, '近期模式默认最近七天');

  const weekly = await createCollection(app, {
    name: '每周搜集', goal: '胡桃', mode: 'topic', sources: [{ sourceId: 'wiki', searchTool: 'scene_search' }],
    frequency: 'weekly', weekday: 3, dailyTime: '21:30',
  });
  assert.equal(weekly.frequency, 'weekly');
  assert.equal(weekly.weekday, 3);
  assert.ok(weekly.nextRunAt);

  // 暂停后不再安排下一次，恢复后重新安排。
  const paused = await app.inject({ method: 'PATCH', url: '/api/v1/admin/knowledge/collections/' + daily.id + '/enabled', headers: adminHeaders, payload: { enabled: false } });
  assert.equal(paused.json().enabled, false);
  assert.equal(paused.json().nextRunAt, undefined, '暂停应清掉下次执行时间');
  const resumed = await app.inject({ method: 'PATCH', url: '/api/v1/admin/knowledge/collections/' + daily.id + '/enabled', headers: adminHeaders, payload: { enabled: true } });
  assert.equal(resumed.json().enabled, true);
  assert.ok(resumed.json().nextRunAt, '恢复后应重新安排');

  // 执行一次后刷新可以同时看到历史与下次时间。
  const started = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/collections/' + daily.id + '/run', headers: adminHeaders, payload: {} });
  await waitForRun(app, started.json().run.id as string);
  const detail = await app.inject({ url: '/api/v1/admin/knowledge/collections/' + daily.id, headers: adminHeaders });
  assert.ok(detail.json().runs.length >= 1, '刷新后可看到执行历史');
  assert.ok(detail.json().collection.nextRunAt, '重复任务仍有下次执行时间');
  await app.close(); database.close();
});

test('collections: 没有资料源时保存为暂停任务并给出原因', async () => {
  const { app, database } = await bootstrap();
  const collection = await createCollection(app, { name: '待配置任务', goal: '钟离', frequency: 'once' });
  assert.equal((collection.sources as unknown[]).length, 0);
  assert.ok(String(collection.pausedReason).includes('资料源'), '应提示去配置资料源');
  // 保存不应意外产生联网调用。
  const started = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/collections/' + collection.id + '/run', headers: adminHeaders, payload: {} });
  assert.equal(started.statusCode, 400);
  assert.equal(started.json().error, 'sources_required');
  await app.close(); database.close();
});

test('collections: 同一任务重复运行不重复入待整理，新版本可辨认', async () => {
  const { app, database, mcpState } = await bootstrap();
  const collection = await createCollection(app, {
    name: '重复搜集', goal: '钟离', works: ['原神'], mode: 'topic', sources: [{ sourceId: 'wiki', searchTool: 'scene_search' }], frequency: 'once',
  });
  const first = await waitForRun(app, (await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/collections/' + collection.id + '/run', headers: adminHeaders, payload: {} })).json().run.id as string);
  assert.equal(first.run.newCount, 2);
  assert.equal(first.pending.length, 2);

  // 第二次运行：内容相同 → 不新增待整理。
  const second = await waitForRun(app, (await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/collections/' + collection.id + '/run', headers: adminHeaders, payload: {} })).json().run.id as string);
  assert.equal(second.run.newCount, 0, '相同内容不应再次入待整理');
  assert.equal(second.run.duplicateCount, 2);
  const pendingAfter = await app.inject({ url: '/api/v1/admin/knowledge/pending', headers: adminHeaders });
  assert.equal(pendingAfter.json().items.length, 2, '待整理列表保留两个不同来源，不应重复');
  const versionCount = (sourceUrl: string) => (database.connection.prepare(
    'SELECT COUNT(*) count FROM knowledge_source_versions v JOIN knowledge_sources s ON s.id=v.source_id WHERE s.url=?',
  ).get(sourceUrl) as { count: number }).count;
  assert.equal(versionCount('https://wiki.example.com/zhongli'), 1, '相同内容只保留一个版本');
  assert.equal(versionCount('https://wiki.example.com/hutao'), 1);

  // 内容变化 → 保留新版本并可辨认。
  mcpState.excerpt = '钟离是往生堂的客卿，负责操办送仙典仪。';
  const third = await waitForRun(app, (await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/collections/' + collection.id + '/run', headers: adminHeaders, payload: {} })).json().run.id as string);
  assert.equal(third.run.changedCount, 1, '内容变化应记为“有变化”');
  const changedItem = third.pending.find((item: Record<string, unknown>) => item.changeType === 'changed') as Record<string, unknown>;
  assert.ok(changedItem, '应能辨认出有变化的条目');
  assert.equal(versionCount('https://wiki.example.com/zhongli'), 2, '内容变化要保留新旧版本');
  assert.equal(versionCount('https://wiki.example.com/hutao'), 1, '未变化的来源不应新增版本');
  await app.close(); database.close();
});

test('collections: 多个任务发现同一来源时各留关联且不复制原文版本', async () => {
  const { app, database } = await bootstrap();
  const first = await createCollection(app, {
    name: '任务甲', goal: '钟离', works: ['原神'], mode: 'topic', sources: [{ sourceId: 'wiki', searchTool: 'scene_search' }], frequency: 'once',
  });
  const second = await createCollection(app, {
    name: '任务乙', goal: '胡桃', works: ['原神'], mode: 'topic', sources: [{ sourceId: 'wiki', searchTool: 'scene_search' }], frequency: 'once',
  });
  await waitForRun(app, (await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/collections/' + first.id + '/run', headers: adminHeaders, payload: {} })).json().run.id as string);
  await waitForRun(app, (await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/collections/' + second.id + '/run', headers: adminHeaders, payload: {} })).json().run.id as string);

  const pending = await app.inject({ url: '/api/v1/admin/knowledge/pending', headers: adminHeaders });
  const items = pending.json().items as Array<Record<string, unknown>>;
  assert.equal(items.length, 4, '两个任务各自保留两个来源');
  const collectionIds = new Set(items.map((item) => item.collectionId));
  assert.equal(collectionIds.size, 2, '任务关联要分别保留');
  assert.equal(new Set(items.map(item => item.sourceVersionId)).size, 2, '两个任务共享两个来源版本');
  const sources = database.connection.prepare('SELECT COUNT(*) count FROM knowledge_sources').get() as { count: number };
  assert.equal(sources.count, 2, '两个链接共两个来源身份');
  await app.close(); database.close();
});

test('collections: 来源失败仍可使用成功结果，重试整理不重新搜索', async () => {
  const { app, database, mcpState } = await bootstrap({ failHost: 'bad.example.com' });
  await app.inject({ method: 'POST', url: '/api/v1/admin/mcp-sources', headers: adminHeaders, payload: {
    id: 'bad', name: '不可用资料源', url: 'https://bad.example.com/mcp', authMode: 'none',
    applicableWorks: ['原神'], universal: false, purpose: '模拟失败来源', allowedTools: ['scene_search'], timeoutMs: 5_000,
  } });
  const collection = await createCollection(app, {
    name: '部分失败', goal: '钟离', works: ['原神'], mode: 'topic', frequency: 'once',
    sources: [{ sourceId: 'wiki', searchTool: 'scene_search' }, { sourceId: 'bad', searchTool: 'scene_search' }],
  });
  const first = await waitForRun(app, (await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/collections/' + collection.id + '/run', headers: adminHeaders, payload: {} })).json().run.id as string);
  assert.equal(first.run.status, 'partial', '部分来源失败应标记部分完成');
  assert.ok(String(first.run.errorMessage).includes('不可用资料源'));
  assert.equal(first.pending.length, 2, '成功来源的结果全部可用');

  // 整理在第一次失败：改由模型可用后重试整理，不重新访问资料源。
  const callsBefore = mcpState.calls;
  const retry = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/collections/' + collection.id + '/run', headers: adminHeaders, payload: { retryRunId: first.run.id } });
  assert.equal(retry.statusCode, 202);
  const retried = await waitForRun(app, retry.json().run.id as string);
  assert.equal(retried.run.trigger, 'retry');
  assert.equal(mcpState.calls, callsBefore, '重试整理不应重新搜索资料源');
  const pendingAfter = await app.inject({ url: '/api/v1/admin/knowledge/pending', headers: adminHeaders });
  assert.equal(pendingAfter.json().items.length, 2, '重试不应产生重复待整理');

  // 没有可复用来源的执行不能重试。
  const emptyRun = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/collections/' + collection.id + '/run', headers: adminHeaders, payload: { retryRunId: 'not-a-run' } });
  assert.equal(emptyRun.statusCode, 404);
  await app.close(); database.close();
});

test('collections: 整理不可用时保留原始来源并标记部分完成', async () => {
  const { app, database, llmState } = await bootstrap({ organizeWorks: false });
  llmState.organizeWorks = false;
  const collection = await createCollection(app, {
    name: '整理失败', goal: '钟离', works: ['原神'], mode: 'topic', sources: [{ sourceId: 'wiki', searchTool: 'scene_search' }], frequency: 'once',
  });
  const result = await waitForRun(app, (await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/collections/' + collection.id + '/run', headers: adminHeaders, payload: {} })).json().run.id as string);
  assert.equal(result.run.status, 'partial');
  assert.equal(result.pending.length, 2, '整理失败也要把原始来源交出来');
  assert.equal(result.pending[0].work, '原神', '回退时仍然带上关注作品');
  assert.deepEqual(result.pending[0].characters, [], '没有整理结果时不要编造角色');
  await app.close(); database.close();
});

test('collections: 取消与重启中断不会留下永久运行中的记录', async () => {
  const { app, database } = await bootstrap();
  const store = new KnowledgeCollectionStore(database);
  const collection = await createCollection(app, {
    name: '取消测试', goal: '钟离', mode: 'topic', sources: [{ sourceId: 'wiki', searchTool: 'scene_search' }], frequency: 'once',
  });

  const run = store.createRun({ collectionId: String(collection.id), trigger: 'manual', settingsSnapshot: {} });
  assert.equal(run.status, 'queued');
  const cancelled = store.cancelRun(run.id);
  assert.equal(cancelled?.status, 'cancelled');
  assert.equal(store.isCancelled(run.id), true, '取消后迟到的返回不能覆盖状态');
  const cancelledAgain = store.cancelRun(run.id);
  assert.equal(cancelledAgain?.status, 'cancelled', '已结束的执行不会再次变状态');

  const dangling = store.createRun({ collectionId: String(collection.id), trigger: 'scheduled', settingsSnapshot: {} });
  store.updateRun(dangling.id, { status: 'running' });
  assert.equal(store.interruptDanglingRuns(), 1, '重启应把未完成执行标记为中断');
  assert.equal(store.getRun(dangling.id)?.status, 'interrupted');
  assert.equal(store.interruptDanglingRuns(), 0, '没有运行中的执行时不重复标记');

  // 取消接口对外可用。
  const fresh = store.createRun({ collectionId: String(collection.id), trigger: 'manual', settingsSnapshot: {} });
  const response = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/collection-runs/' + fresh.id + '/cancel', headers: adminHeaders });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, 'cancelled');
  await app.close(); database.close();
});

test('collections: 调度器每个定义最多补跑一次并顺延下次时间', async () => {
  const { app, database, secrets } = await bootstrap();
  const store = new KnowledgeCollectionStore(database);
  const collection = await createCollection(app, {
    name: '定时任务', goal: '钟离', works: ['原神'], mode: 'recent', sources: [{ sourceId: 'wiki', searchTool: 'scene_search' }],
    frequency: 'daily', dailyTime: '09:00', timezone: 'Asia/Shanghai',
  });
  // 模拟停机期间错过计划时间。
  store.setNextRunAt(String(collection.id), new Date(Date.now() - 3 * 60_000).toISOString());
  const scheduler = new KnowledgeScheduler({ config: readConfig({ STHSTART_ADMIN_TOKEN: adminToken }), database, secrets });
  const started = await scheduler.tick();
  assert.equal(started.length, 1, '错过的计划应补跑一次');
  const after = store.get(String(collection.id))!;
  assert.ok(after.nextRunAt && Date.parse(after.nextRunAt) > Date.now(), '补跑后应顺延到未来');

  // 立刻再检查：不再重复启动。
  const second = await scheduler.tick();
  assert.equal(second.length, 0, '顺延后不应再次启动');
  // 有执行在运行时也不启动第二份。
  store.setNextRunAt(String(collection.id), new Date(Date.now() - 60_000).toISOString());
  const third = await scheduler.tick();
  assert.equal(third.length, 0, '已有运行中的执行时不启动第二份');

  // 暂停的定义不参与调度。
  await app.inject({ method: 'PATCH', url: '/api/v1/admin/knowledge/collections/' + collection.id + '/enabled', headers: adminHeaders, payload: { enabled: false } });
  store.setNextRunAt(String(collection.id), new Date(Date.now() - 60_000).toISOString());
  assert.equal((await scheduler.tick()).length, 0, '暂停的任务不调度');

  // 等执行结束再关库，避免后台任务在测试结束后写库。
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const active = store.findActiveRun();
    if (!active) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  scheduler.stop();
  await app.close(); database.close();
});

test('collections: 整理草稿可以新建资料，目标被编辑时拒绝静默覆盖', async () => {
  const { app, database } = await bootstrap();
  const store = new KnowledgeCollectionStore(database);
  const knowledge = new KnowledgeStore(database);
  const collection = await createCollection(app, {
    name: '整理到资料', goal: '钟离与胡桃', works: ['原神'], mode: 'topic', sources: [{ sourceId: 'wiki', searchTool: 'scene_search' }], frequency: 'once',
  });
  const run = await waitForRun(app, (await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/collections/' + collection.id + '/run', headers: adminHeaders, payload: {} })).json().run.id as string);
  const itemId = String(run.pending[0].id);

  // 新建资料：草稿采用后生成一篇带来源的新资料。
  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/organize-drafts', headers: adminHeaders, payload: { itemIds: [itemId], instruction: '整理成人物关系资料' } });
  assert.equal(created.statusCode, 202);
  const draft = await waitForDraft(app, created.json().id as string);
  assert.equal(draft.status, 'succeeded');
  assert.ok(draft.text.includes('往生堂'));
  assert.equal(draft.sources.length, 1, '草稿要展示实际使用的来源');
  const adopted = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/organize-drafts/' + created.json().id + '/adopt', headers: adminHeaders, payload: { mode: 'new-note', title: '钟离关系整理' } });
  assert.equal(adopted.statusCode, 201);
  const noteId = adopted.json().noteId as string;
  const note = await app.inject({ url: '/api/v1/admin/notebook/notes/' + noteId, headers: adminHeaders });
  assert.equal(note.json().title, '钟离关系整理');
  assert.ok(String(note.json().content[0].text).includes('往生堂'));
  assert.equal(note.json().knowledge.usage, 'record', '整理产生的新资料默认仅记录');
  assert.equal(note.json().knowledge.authorship, 'ai-organized');
  assert.equal(note.json().knowledge.sources.length, 1, '新资料要保留来源');
  assert.equal(note.json().knowledge.origin.kind, 'collection');
  assert.ok(note.json().knowledge.works.some((work: { name: string }) => work.name === '原神'), '整理资料继承来源作品，便于筛选');
  assert.equal(note.json().knowledge.sources[0].locator.sourceVersionId, (draft.sources[0] as { sourceVersionId: string }).sourceVersionId, '可回查整理时的原始版本');
  // 采用后待整理条目标记为已整理。
  const pendingAfter = await app.inject({ url: '/api/v1/admin/knowledge/pending?state=organized', headers: adminHeaders });
  assert.equal(pendingAfter.json().items.length, 1);

  // 追加到已有资料：先建立目标资料，再生成草稿。
  const target = await app.inject({ method: 'POST', url: '/api/v1/admin/notebook/notes', headers: adminHeaders, payload: {
    title: '既有关系资料', kind: 'note', stage: 'reference', summary: '既有内容',
    content: [{ id: 'b1', type: 'text', text: '原有正文：钟离与胡桃同属往生堂。' }], tags: [],
  } });
  knowledge.writeKnowledge(String(target.json().id), {
    schemaVersion: 1, works: [{ key: 'gi', name: '原神' }], characters: [], locations: [],
    nature: 'canon', authorship: 'handwritten', usage: 'reference', sources: [],
  });
  const run2 = await waitForRun(app, (await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/collections/' + collection.id + '/run', headers: adminHeaders, payload: {} })).json().run.id as string);
  assert.equal(run2.findings.length, 2, '执行详情列出全部发现');
  assert.equal(run2.findings[0].changeType, 'duplicate', '重复发现也要出现在结果关联里');
  assert.equal(Number(run2.run.duplicateCount), 2);
  const appendDraft = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/organize-drafts', headers: adminHeaders, payload: {
    itemIds: [itemId], targetNoteId: String(target.json().id), instruction: '补充关系',
  } });
  const draft2 = await waitForDraft(app, appendDraft.json().id as string);
  assert.equal(draft2.status, 'succeeded');

  // 生成期间目标被编辑 → 拒绝静默覆盖。
  await app.inject({ method: 'PUT', url: '/api/v1/admin/notebook/notes/' + target.json().id, headers: adminHeaders, payload: {
    title: '既有关系资料', kind: 'note', stage: 'reference', summary: '用户改过的内容',
    content: [{ id: 'b1', type: 'text', text: '用户自己改写的正文。' }], tags: [], favorite: false,
  } });
  const conflicted = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/organize-drafts/' + appendDraft.json().id + '/adopt', headers: adminHeaders, payload: {
    mode: 'append', targetNoteId: String(target.json().id), expectedRevision: draft2.baseRevision,
  } });
  assert.equal(conflicted.statusCode, 409);
  assert.equal(conflicted.json().error, 'target_edited');
  const untouched = await app.inject({ url: '/api/v1/admin/notebook/notes/' + target.json().id, headers: adminHeaders });
  assert.equal(untouched.json().summary, '用户改过的内容', '拒绝后不能改动用户正文');
  assert.equal(untouched.json().content.length, 1);
  assert.ok(store.getDraft(String(appendDraft.json().id))!.status === 'succeeded', '草稿仍然保留，等待重新预览');

  // 用最新 revision 重新采用：追加正文并合并来源，不覆盖用户改写。
  const current = await app.inject({ url: '/api/v1/admin/notebook/notes/' + target.json().id, headers: adminHeaders });
  const reAdopt = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/organize-drafts/' + appendDraft.json().id + '/adopt', headers: adminHeaders, payload: {
    mode: 'append', targetNoteId: String(target.json().id), expectedRevision: current.json().revision,
  } });
  assert.equal(reAdopt.statusCode, 409, '内容 hash 变化同样要拦住（防止旧草稿贴到新正文）');
  await app.close(); database.close();
});

test('collections: 待整理可以显式选入企划并保留未确认状态与来源', async () => {
  const { app, database } = await bootstrap();
  const store = new KnowledgeCollectionStore(database);
  const knowledge = new KnowledgeStore(database);
  const collection = await createCollection(app, {
    name: '用于企划', goal: '钟离', works: ['原神'], mode: 'topic', sources: [{ sourceId: 'wiki', searchTool: 'scene_search' }], frequency: 'once',
  });
  const run = await waitForRun(app, (await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/collections/' + collection.id + '/run', headers: adminHeaders, payload: {} })).json().run.id as string);
  const item = run.pending[0] as Record<string, unknown>;

  // 待整理条目本身不是资料，但它的来源版本可以直接作为企划引用。
  const preview = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/references/preview', headers: adminHeaders, payload: {
    selections: [{ sourceKind: 'collection', sourceId: item.sourceVersionId, usage: 'background' }],
  } });
  assert.equal(preview.statusCode, 200);
  const reference = preview.json().snapshot.references[0];
  assert.equal(reference.sourceKind, 'collection');
  assert.ok(reference.excerpt.includes('往生堂'), '引用内容来自实际保存的来源');
  assert.ok(reference.evidence.length >= 1, '引用要能查回原文');
  assert.equal(reference.nature, 'unconfirmed', '未确认内容不能冒充原作定论');
  assert.equal(preview.json().unresolved.length, 0);

  // 保留一个待整理条目后它仍可被检索到（保留 ≠ 生成重复笔记）。
  await app.inject({ method: 'PATCH', url: '/api/v1/admin/knowledge/pending', headers: adminHeaders, payload: { ids: [String(item.id)], state: 'kept' } });
  const kept = await app.inject({ url: '/api/v1/admin/knowledge/pending', headers: adminHeaders });
  assert.equal(kept.json().items.length, 2);
  assert.equal(kept.json().items.find((entry: { id: string }) => entry.id === item.id).state, 'kept');
  const notesCount = database.connection.prepare('SELECT COUNT(*) count FROM creative_notes').get() as { count: number };
  assert.equal(notesCount.count, 0, '“保留”不应自动生成笔记');

  // 忽略可以恢复。
  await app.inject({ method: 'PATCH', url: '/api/v1/admin/knowledge/pending', headers: adminHeaders, payload: { ids: [String(item.id)], state: 'ignored' } });
  const ignored = await app.inject({ url: '/api/v1/admin/knowledge/pending?state=ignored', headers: adminHeaders });
  assert.equal(ignored.json().items.length, 1);
  await app.inject({ method: 'PATCH', url: '/api/v1/admin/knowledge/pending', headers: adminHeaders, payload: { ids: [String(item.id)], state: 'pending' } });
  const restored = await app.inject({ url: '/api/v1/admin/knowledge/pending', headers: adminHeaders });
  assert.equal(restored.json().items[0].state, 'pending');
  assert.ok(knowledge.getSourceVersion(String(item.sourceVersionId)), '来源版本仍在');
  assert.ok(store.listRuns({ collectionId: String(collection.id) }).length >= 1);
  await app.close(); database.close();
});

test('collections: 收藏同一话题两次只得到一份关联资料', async () => {
  const { app, database } = await bootstrap();
  const now = new Date().toISOString();
  database.connection.prepare("INSERT INTO topics(id,title,summary,works_json,characters_json,kind,info_nature,adaptation_tags_json,first_seen_at,last_seen_at,favorite,ignored,created_at,updated_at) VALUES ('topic-1','新版本料理活动','社区讨论料理活动与角色互动。','[\"原神\"]','[\"派蒙\"]','meme','community','[\"厨艺比赛\"]',?,?,0,0,?,?)")
    .run(now, now, now, now);
  database.connection.prepare("INSERT INTO topic_sources(id,topic_id,source_id,source_name,url,document_locator,title,published_at,excerpt,content_hash,created_at,updated_at) VALUES ('ts-1','topic-1','wiki','社区资料源','https://community.example.com/post/1','','料理活动引发热议','2026-09-10','玩家在社区讨论料理活动。','hash-1',?,?)")
    .run(now, now);

  const first = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/topics/topic-1/save', headers: adminHeaders });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().created, true);
  const second = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/topics/topic-1/save', headers: adminHeaders });
  assert.equal(second.json().created, false, '重复收藏不复制第二份');
  assert.equal(second.json().noteId, first.json().noteId);

  const notes = database.connection.prepare('SELECT COUNT(*) count FROM creative_notes').get() as { count: number };
  assert.equal(notes.count, 1);
  const note = await app.inject({ url: '/api/v1/admin/notebook/notes/' + first.json().noteId, headers: adminHeaders });
  assert.equal(note.json().knowledge.origin.kind, 'topic');
  assert.equal(note.json().knowledge.origin.refId, 'topic-1');
  assert.equal(note.json().knowledge.usage, 'record', '收藏默认仅记录，不自动成为参考');
  assert.equal(note.json().knowledge.sources.length, 1, '话题原有来源要一起保留');
  assert.deepEqual(note.json().knowledge.characters, [{ work: '原神', name: '派蒙' }]);
  await app.close(); database.close();
});
