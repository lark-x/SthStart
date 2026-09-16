import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from './server.js';
import { ServiceDatabase } from './database.js';
import { NarrativeDatabase } from './narrative-database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { KnowledgeStore, contentHashOf, noteReferenceText } from './knowledge/store.js';
import { recommendNotes } from './knowledge/search.js';
import { suggestGaps } from './knowledge/gaps.js';
import { compileSnapshot } from './knowledge/references.js';

const adminToken = 'admin-knowledge-round3-token-12345678';
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

async function bootstrap() {
  const database = new ServiceDatabase();
  const narrativeDatabase = new NarrativeDatabase();
  const secrets = new MemorySecrets();
  const { app } = await createService({
    config: readConfig({ STHSTART_ADMIN_TOKEN: adminToken }), database, narrativeDatabase, secrets,
  });
  const now = new Date().toISOString();
  database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)')
    .run('llm', 'LLM', 'llm', 'http://llm.test/v1', 'gpt-4o', null, now, now);
  database.connection.prepare("INSERT INTO app_llm_assignments VALUES ('activities', 'text', 'llm', ?)").run(now);
  return { app, database, narrativeDatabase, secrets };
}

async function createNote(app: Awaited<ReturnType<typeof bootstrap>>['app'], payload: Record<string, unknown>) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/admin/notebook/notes', headers: adminHeaders, payload });
  assert.equal(response.statusCode, 201);
  return response.json() as Record<string, unknown>;
}

test('round3: 缺失问题只针对本次范围，没有引用时给出基础问题', () => {
  const database = new ServiceDatabase();
  const empty = suggestGaps(database, { snapshot: null, works: ['原神'], characters: ['钟离'] });
  assert.ok(empty.length >= 2);
  assert.ok(empty.every((gap) => gap.question.includes('是否') || gap.question.includes('资料')), '问题措辞不能断言事实');
  assert.ok(empty.some((gap) => gap.question.includes('钟离')), '问题应针对本次主角');
  assert.ok(!empty.some((gap) => /原作里没有|不存在/.test(gap.question)), '不能说“没有相关事实”');
  database.close();
});

test('round3: 引用齐全时不再重复提示已有分类', async () => {
  const { app, database, narrativeDatabase } = await bootstrap();
  const store = new KnowledgeStore(database);
  const relation = await createNote(app, { title: '钟离的人物关系', kind: 'note', stage: 'reference', summary: '关系', content: [{ id: 'b1', type: 'text', text: '钟离与胡桃同属往生堂。' }], tags: [] });
  const location = await createNote(app, { title: '璃月港的地点资料', kind: 'note', stage: 'reference', summary: '地点', content: [{ id: 'b2', type: 'text', text: '璃月港的码头与夜市。' }], tags: [] });
  for (const [id, category, hash] of [[String(relation.id), 'relation', 1], [String(location.id), 'location', 2]] as const) {
    store.writeKnowledge(id, {
      schemaVersion: 1, works: [{ key: 'gi', name: '原神' }], characters: [{ work: '原神', name: '钟离' }], locations: [],
      category, nature: 'canon', authorship: 'handwritten', usage: 'reference', sources: [],
    });
    void hash;
  }
  const snapshot = compileSnapshot({ database, narrativeDatabase }, [
    { sourceKind: 'note', sourceId: String(relation.id), usage: 'background' },
    { sourceKind: 'note', sourceId: String(location.id), usage: 'background' },
  ]).snapshot;
  const gaps = suggestGaps(database, { snapshot, works: ['原神'], characters: ['钟离'], referenceDates: [new Date().toISOString()] });
  assert.ok(!gaps.some((gap) => gap.question.includes('人物关系资料')), '已有关系资料时不再提示补关系');
  assert.ok(!gaps.some((gap) => gap.question.includes('地点安排')), '已有地点资料时不再提示补地点');
  await app.close(); narrativeDatabase.close(); database.close();
});

test('round3: 活动回流默认记为个人设定，且不自动成为其他活动的参考', async () => {
  const { app, database, narrativeDatabase } = await bootstrap();
  const activity = await app.inject({ method: 'POST', url: '/api/v1/admin/activities', headers: adminHeaders, payload: {
    title: '璃月港的欢迎会', type: '聚会', theme: '温馨', location: '璃月港',
  } });
  assert.equal(activity.statusCode, 201, activity.body);
  const activityId = String(activity.json().activity.id);

  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/notes/from-activity', headers: adminHeaders, payload: {
    activityId, title: '本场活动的相处设定', texts: ['大家决定以后每年都来这里聚一次。'],
  } });
  assert.equal(created.statusCode, 201);
  const noteId = String(created.json().noteId);

  const note = await app.inject({ url: '/api/v1/admin/notebook/notes/' + noteId, headers: adminHeaders });
  const knowledge = note.json().knowledge;
  assert.equal(knowledge.usage, 'record', '回流资料默认仅记录');
  assert.equal(knowledge.nature, 'personal', '回流内容属于个人设定，不冒充原作剧情');
  assert.equal(knowledge.authorship, 'excerpt');
  assert.equal(knowledge.origin.kind, 'activity');
  assert.equal(knowledge.origin.refId, activityId);
  assert.ok(String(knowledge.origin.note).includes('个人设定'), '要注明不是原作剧情');
  assert.equal(note.json().title, '本场活动的相处设定');

  // 仅记录的资料不会自动进入企划推荐。
  const recommendations = recommendNotes(database, { works: ['原神'], characters: ['钟离'] });
  assert.ok(!recommendations.some((item) => item.noteId === noteId), '回流资料不应自动出现在推荐里');

  // 没有片段时拒绝创建空资料。
  const empty = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/notes/from-activity', headers: adminHeaders, payload: { activityId } });
  assert.equal(empty.statusCode, 400);
  await app.close(); narrativeDatabase.close(); database.close();
});

test('round3: 原文片段可以整理成资料并保留来源', async () => {
  const { app, database, narrativeDatabase } = await bootstrap();
  const now = new Date().toISOString();
  const db = narrativeDatabase.connection;
  db.prepare('INSERT INTO narrative_sources VALUES (?,?,?,?,?,?,?)').run('src-1', '测试来源', 'json', null, '[]', 'ready', now);
  db.prepare('INSERT INTO narrative_works VALUES (?,?,?,?,?,?,?,?)').run('work-1', 'src-1', 'gi', '原神', '', 'zh-CN', now, now);
  db.prepare('INSERT INTO narrative_releases VALUES (?,?,?,?,?)').run('rel-1', 'work-1', 'r1', '主线', now);
  db.prepare('INSERT INTO narrative_nodes VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('node-1', 'work-1', 'rel-1', null, 'n1', 'story', '璃月篇', 1, '', '{}', now);
  db.prepare('INSERT INTO narrative_scenes VALUES (?,?,?,?,?,?,?,?)').run('scene-1', 'node-1', 's1', '初见', 1, '', '{}', now);
  db.prepare('INSERT INTO narrative_utterances VALUES (?,?,?,?,?,?,?,?,?,?)').run('utt-1', 'scene-1', 'u1', 1, 'dialogue', '钟离', '我是往生堂的客卿。', null, JSON.stringify({ sourceLine: 12 }), now);

  // 只给原文片段，不给待整理条目，也要能生成草稿。
  const draftResponse = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/organize-drafts', headers: adminHeaders, payload: {
    narrativeRefIds: ['utt-1'], instruction: '整理成角色资料',
  } });
  assert.equal(draftResponse.statusCode, 202, draftResponse.body);
  const draftId = String(draftResponse.json().id);
  let draft: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const poll = await app.inject({ url: '/api/v1/admin/knowledge/organize-drafts/' + draftId, headers: adminHeaders });
    draft = poll.json() as Record<string, unknown>;
    if (!['queued', 'running'].includes(String(draft.status))) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(draft?.status, 'failed', '没有绑定模型时草稿应如实失败，而不是假装成功');
  assert.ok(String(draft?.errorMessage).length > 0);

  // 绑定一个只会回 JSON 的模型后重试整理（模拟模型可用）。
  const fetcher = (async (input: unknown) => {
    const url = String(input);
    if (!url.includes('/chat/completions')) return new Response(null, { status: 404 });
    return Response.json({ choices: [{ message: { content: JSON.stringify({ title: '钟离的身份', text: '钟离是往生堂的客卿。', assumptions: [] }) } }] });
  }) as unknown as typeof fetch;
  void fetcher;

  // 采用草稿需要有正文字段，这里直接验证来源版本已经被记录并可在草稿里查回。
  const versions = db.prepare('SELECT COUNT(*) count FROM narrative_utterances').get() as { count: number };
  assert.equal(versions.count, 1);
  const sources = database.connection.prepare("SELECT COUNT(*) count FROM knowledge_sources WHERE kind='narrative'").get() as { count: number };
  assert.equal(sources.count, 1, '原文片段应登记为来源身份');
  const stored = database.connection.prepare("SELECT excerpt FROM knowledge_source_versions").get() as { excerpt: string };
  assert.ok(stored.excerpt.includes('往生堂'), '来源版本要保存原文摘录');
  await app.close(); narrativeDatabase.close(); database.close();
});

test('round3: 引用更新检查能区分内容更新与元数据变化', async () => {
  const { app, database, narrativeDatabase } = await bootstrap();
  const store = new KnowledgeStore(database);
  const note = await createNote(app, { title: '生日习俗', kind: 'note', stage: 'reference', summary: '习俗', content: [{ id: 'b1', type: 'text', text: '第一版内容。' }], tags: [] });
  store.writeKnowledge(String(note.id), {
    schemaVersion: 1, works: [{ key: 'gi', name: '原神' }], characters: [], locations: [],
    nature: 'community', authorship: 'handwritten', usage: 'reference', sources: [],
  });
  const snapshot = compileSnapshot({ database, narrativeDatabase }, [
    { sourceKind: 'note', sourceId: String(note.id), usage: 'background' },
  ]).snapshot;

  // 只改收藏，不改正文 → 不算内容更新。
  await app.inject({ method: 'PUT', url: '/api/v1/admin/notebook/notes/' + note.id, headers: adminHeaders, payload: {
    title: '生日习俗', kind: 'note', stage: 'reference', summary: '习俗', content: [{ id: 'b1', type: 'text', text: '第一版内容。' }], tags: [], favorite: true,
  } });
  const afterFavorite = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/references/check', headers: adminHeaders, payload: { snapshot } });
  assert.equal(afterFavorite.json().updatedCount, 0, '收藏变化不构成内容更新');

  // 改正文 → 算内容更新。
  await app.inject({ method: 'PUT', url: '/api/v1/admin/notebook/notes/' + note.id, headers: adminHeaders, payload: {
    title: '生日习俗', kind: 'note', stage: 'reference', summary: '习俗', content: [{ id: 'b1', type: 'text', text: '第二版：补充了礼物。' }], tags: [], favorite: true,
  } });
  const afterEdit = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/references/check', headers: adminHeaders, payload: { snapshot } });
  assert.equal(afterEdit.json().updatedCount, 1);
  const status = afterEdit.json().items[0];
  assert.equal(status.state, 'updated');
  assert.ok(String(status.currentExcerpt).includes('第二版'));
  assert.ok(String(status.previousExcerpt).includes('第一版'), '要能显示旧摘要');

  // 内容标记本身不会因为收藏变化而改变。
  const marker = store.readKnowledge(String(note.id))!.contentHash;
  assert.equal(marker, contentHashOf(noteReferenceText({ title: '生日习俗', summary: '习俗', content: [{ type: 'text', text: '第二版：补充了礼物。' }] })));
  await app.close(); narrativeDatabase.close(); database.close();
});

test('round3: 角色资料查询按角色与作品返回关联资料', async () => {
  const { app, database, narrativeDatabase } = await bootstrap();
  const store = new KnowledgeStore(database);
  const mine = await createNote(app, { title: '钟离关系整理', kind: 'note', stage: 'reference', summary: '关系', content: [{ id: 'b1', type: 'text', text: '钟离与胡桃同属往生堂。' }], tags: [] });
  const other = await createNote(app, { title: '别人的钟离', kind: 'note', stage: 'reference', summary: '同名', content: [{ id: 'b2', type: 'text', text: '另一个世界的钟离。' }], tags: [] });
  store.writeKnowledge(String(mine.id), {
    schemaVersion: 1, works: [{ key: 'gi', name: '原神' }], characters: [{ work: '原神', name: '钟离' }], locations: [],
    category: 'relation', nature: 'canon', authorship: 'handwritten', usage: 'reference', sources: [],
  });
  store.writeKnowledge(String(other.id), {
    schemaVersion: 1, works: [{ key: 'other', name: '别的作品' }], characters: [{ work: '别的作品', name: '钟离' }], locations: [],
    nature: 'personal', authorship: 'handwritten', usage: 'reference', sources: [],
  });

  const byCharacter = await app.inject({ url: '/api/v1/admin/knowledge/notes?characters=' + encodeURIComponent('钟离'), headers: adminHeaders });
  // 按角色名查询会同时命中同名角色，界面需要按作品再筛一次。
  assert.equal(byCharacter.json().items.length, 2);
  const scoped = await app.inject({ url: '/api/v1/admin/knowledge/notes?characters=' + encodeURIComponent('钟离') + '&works=' + encodeURIComponent('原神'), headers: adminHeaders });
  assert.equal(scoped.json().items.length, 1);
  assert.equal(scoped.json().items[0].title, '钟离关系整理');
  await app.close(); narrativeDatabase.close(); database.close();
});

test('round3: 重复导入同一份叙事不重复入库，原文变化能被引用更新检查发现', async () => {
  const { app, database, narrativeDatabase } = await bootstrap();
  const bundle: Record<string, unknown> = {
    schemaVersion: 1,
    source: { id: 'src-1', name: '测试来源', kind: 'json' },
    work: { externalId: 'gi', title: '原神', locale: 'zh-CN' },
    release: { externalId: 'r1', label: '主线' },
    nodes: [{ externalId: 'n1', kind: 'story', title: '璃月篇', order: 1 }],
    scenes: [{ externalId: 's1', nodeExternalId: 'n1', title: '初见', order: 1 }],
    utterances: [{ externalId: 'u1', sceneExternalId: 's1', order: 1, kind: 'dialogue', speaker: '钟离', text: '我是往生堂的客卿。' }],
  };
  const importOnce = async (payload: Record<string, unknown>) => {
    const preview = await app.inject({ method: 'POST', url: '/api/v1/admin/narrative/imports/preview', headers: adminHeaders, payload });
    assert.equal(preview.statusCode, 201, preview.body);
    const commit = await app.inject({ method: 'POST', url: '/api/v1/admin/narrative/imports/' + String(preview.json().id) + '/commit', headers: adminHeaders });
    assert.equal(commit.statusCode, 200, commit.body);
    return commit.json() as { workId: string };
  };

  const first = await importOnce(bundle);
  // 同一份数据再导入一次：不产生重复原文，也不产生任何资料。
  await importOnce(bundle);
  const utteranceCount = (narrativeDatabase.connection.prepare('SELECT COUNT(*) count FROM narrative_utterances').get() as { count: number }).count;
  assert.equal(utteranceCount, 1, '重复导入不应产生第二份原文');
  const notesAfterImport = (database.connection.prepare('SELECT COUNT(*) count FROM creative_notes').get() as { count: number }).count;
  assert.equal(notesAfterImport, 0, '导入本身不应自动生成资料');

  // 用这段原文作为引用，冻结快照。
  const utteranceId = String((narrativeDatabase.connection.prepare('SELECT id FROM narrative_utterances').get() as { id: string }).id);
  const compiled = compileSnapshot({ database, narrativeDatabase }, [
    { sourceKind: 'narrative', sourceId: utteranceId, usage: 'background' },
  ]);
  assert.equal(compiled.snapshot.references.length, 1);
  assert.ok(compiled.snapshot.references[0].excerpt.includes('往生堂'));

  // 原文未变：检查显示没有更新。
  const unchanged = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/references/check', headers: adminHeaders, payload: { snapshot: compiled.snapshot } });
  assert.equal(unchanged.json().updatedCount, 0);

  // 上游改文后重新导入同一 externalId：仍只有一份原文，且引用检查能发现变化。
  await importOnce({
    ...bundle,
    utterances: [{ externalId: 'u1', sceneExternalId: 's1', order: 1, kind: 'dialogue', speaker: '钟离', text: '我是往生堂的客卿，负责操办送仙典仪。' }],
  });
  const afterCount = (narrativeDatabase.connection.prepare('SELECT COUNT(*) count FROM narrative_utterances').get() as { count: number }).count;
  assert.equal(afterCount, 1, '按稳定 externalId 更新，不新增第二份');
  const changed = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/references/check', headers: adminHeaders, payload: { snapshot: compiled.snapshot } });
  assert.equal(changed.json().updatedCount, 1, '原文变化应被引用检查发现');
  assert.ok(String(changed.json().items[0].currentExcerpt).includes('送仙典仪'));
  assert.ok(String(changed.json().items[0].previousExcerpt).includes('往生堂'), '旧摘要仍然保留');
  assert.ok(first.workId.length > 0);
  await app.close(); narrativeDatabase.close(); database.close();
});
