import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from './server.js';
import { ServiceDatabase } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { KnowledgeStore, contentHashOf, noteReferenceText } from './knowledge/store.js';
import { recommendNotes, searchKnowledge, searchNotes } from './knowledge/search.js';
import { compileSnapshot } from './knowledge/references.js';

const adminToken = 'admin-knowledge-test-token-1234567890123';
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
  const secrets = new MemorySecrets();
  const { app } = await createService({ config: readConfig({ STHSTART_ADMIN_TOKEN: adminToken }), database, secrets });
  return { app, database, secrets };
}

/** 建一篇带正文的资料。 */
async function createNote(app: Awaited<ReturnType<typeof bootstrap>>['app'], payload: Record<string, unknown>) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/admin/notebook/notes', headers: adminHeaders, payload });
  assert.equal(response.statusCode, 201);
  return response.json() as Record<string, unknown>;
}

test('knowledge: 旧客户端保存正文不会清空已有元数据', async () => {
  const { app, database } = await bootstrap();
  const note = await createNote(app, {
    title: '钟离的人物关系', kind: 'note', stage: 'reference', summary: '与旅行者的关系',
    content: [{ id: 'b1', type: 'text', text: '钟离与旅行者在璃月相识。' }], tags: ['原神'],
  });
  // 用户设置元数据（模拟新前端）。
  const saved = await app.inject({
    method: 'PUT', url: '/api/v1/admin/knowledge/notes/' + note.id + '/knowledge', headers: adminHeaders,
    payload: { knowledge: {
      works: [{ key: 'gi', name: '原神' }],
      characters: [{ work: '原神', name: '钟离' }],
      locations: [{ work: '原神', name: '璃月港' }],
      category: 'relation', nature: 'canon', authorship: 'handwritten', usage: 'reference',
      sources: [{ id: 's1', kind: 'manual', title: '游戏内对话', excerpt: '钟离：我是往生堂的客卿。' }],
    } },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().knowledge.usage, 'reference');

  // 旧客户端只提交正文：元数据必须保留。
  const legacy = await app.inject({
    method: 'PUT', url: '/api/v1/admin/notebook/notes/' + note.id, headers: adminHeaders,
    payload: { title: '钟离的人物关系', kind: 'note', stage: 'reference', summary: '改过的摘要', content: [{ id: 'b1', type: 'text', text: '钟离与旅行者在璃月相识，后来一起过节。' }], tags: ['原神'], favorite: false },
  });
  assert.equal(legacy.statusCode, 200);
  const knowledge = legacy.json().knowledge;
  assert.equal(knowledge.usage, 'reference', '旧客户端保存不应清空参考状态');
  assert.equal(knowledge.nature, 'canon');
  assert.equal(knowledge.characters.length, 1);
  assert.equal(knowledge.sources.length, 1, '来源关联不应被旧客户端清空');
  // 内容标记跟着正文更新，供更新检查使用。
  assert.equal(knowledge.contentHash, contentHashOf(noteReferenceText({ title: '钟离的人物关系', summary: '改过的摘要', content: [{ type: 'text', text: '钟离与旅行者在璃月相识，后来一起过节。' }] })));

  // 显式 null 才清空。
  const cleared = await app.inject({ method: 'PUT', url: '/api/v1/admin/knowledge/notes/' + note.id + '/knowledge', headers: adminHeaders, payload: { knowledge: null } });
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.json().knowledge, null);
  await app.close(); database.close();
});

test('knowledge: 检索按元数据筛选且不受首批条数限制', async () => {
  const { app, database } = await bootstrap();
  const store = new KnowledgeStore(database);
  const first = await createNote(app, { title: '可参考的关系整理', kind: 'note', stage: 'reference', summary: '关系', content: [{ id: 'b1', type: 'text', text: '旅行者与派蒙。' }], tags: [] });
  const second = await createNote(app, { title: '仅记录的随想', kind: 'note', stage: 'draft', summary: '随想', content: [{ id: 'b2', type: 'text', text: '随手写的想法。' }], tags: [] });
  store.writeKnowledge(String(first.id), {
    schemaVersion: 1, works: [{ key: 'gi', name: '原神' }], characters: [{ work: '原神', name: '派蒙' }],
    locations: [], category: 'relation', nature: 'canon', authorship: 'handwritten', usage: 'reference', sources: [],
  });
  store.writeKnowledge(String(second.id), {
    schemaVersion: 1, works: [], characters: [], locations: [], nature: 'personal', authorship: 'handwritten', usage: 'record', sources: [],
  });

  // 默认只检索“可参考”。
  const defaultSearch = searchNotes(database, {});
  assert.equal(defaultSearch.items.length, 1);
  assert.equal(defaultSearch.items[0].id, first.id);

  // 显式要求时才带上仅记录内容。
  const withRecord = searchNotes(database, { includeRecord: true });
  assert.equal(withRecord.items.length, 2);

  // 按作品与角色筛选。
  const byWork = searchNotes(database, { works: ['原神'] });
  assert.equal(byWork.items.length, 1);
  const byCharacter = searchNotes(database, { characters: ['派蒙'] });
  assert.equal(byCharacter.items.length, 1);
  const byMissing = searchNotes(database, { characters: ['不存在的人'] });
  assert.equal(byMissing.items.length, 0);

  // 中文两字关键词走 LIKE 回退也能命中。
  const shortKeyword = searchNotes(database, { q: '派蒙' });
  assert.equal(shortKeyword.items.length, 1);
  // 服务端筛选：按参考状态直接过滤。
  const byUsage = searchNotes(database, { usage: 'record' });
  assert.equal(byUsage.items.length, 1);
  assert.equal(byUsage.items[0].id, second.id);
  await app.close(); database.close();
});

test('knowledge: 同源同内容不新增版本，内容变化保留新旧版本', async () => {
  const { app, database } = await bootstrap();
  const store = new KnowledgeStore(database);
  const sourceId = store.upsertSource({ kind: 'web', url: 'https://example.com/a', title: '社区帖' });
  const first = store.recordSourceVersion(sourceId, { title: '社区帖', excerpt: '第一版内容' });
  assert.equal(first.changeType, 'new');
  // 同源同内容：更新检查时间，不新增版本。
  const same = store.recordSourceVersion(sourceId, { title: '社区帖', excerpt: '第一版内容' });
  assert.equal(same.changeType, 'unchanged');
  assert.equal(same.versionId, first.versionId);
  // 内容变化：保留新旧版本。
  const changed = store.recordSourceVersion(sourceId, { title: '社区帖', excerpt: '第二版内容' });
  assert.equal(changed.changeType, 'changed');
  assert.notEqual(changed.versionId, first.versionId);
  const versions = database.connection.prepare('SELECT COUNT(*) count FROM knowledge_source_versions WHERE source_id=?').get(sourceId) as { count: number };
  assert.equal(versions.count, 2, '新旧版本都要保留');
  // 同一 URL 不会建出第二个来源身份。
  const again = store.upsertSource({ kind: 'web', url: 'https://example.com/a', title: '社区帖改名' });
  assert.equal(again, sourceId);
  await app.close(); database.close();
});

test('knowledge: 引用快照冻结内容，源笔记更新后快照不变', async () => {
  const { app, database } = await bootstrap();
  const store = new KnowledgeStore(database);
  const note = await createNote(app, {
    title: '生日习俗整理', kind: 'note', stage: 'reference', summary: '习俗',
    content: [{ id: 'b1', type: 'text', text: '第一版：生日要准备蛋糕。' }], tags: [],
  });
  store.writeKnowledge(String(note.id), {
    schemaVersion: 1, works: [{ key: 'gi', name: '原神' }], characters: [], locations: [],
    nature: 'community', authorship: 'handwritten', usage: 'reference',
    sources: [{ id: 's1', kind: 'manual', title: '社区整理', excerpt: '生日要准备蛋糕。' }],
  });

  const compiled = compileSnapshot({ database, narrativeDatabase: null }, [
    { sourceKind: 'note', sourceId: String(note.id), usage: 'background' },
    { sourceKind: 'note', sourceId: String(note.id), usage: 'requirement' },
  ], { sessionId: 'session-1' });
  assert.equal(compiled.snapshot.references.length, 2);
  const frozen = compiled.snapshot.references[0];
  assert.equal(frozen.excerpt, '习俗\n第一版：生日要准备蛋糕。');
  assert.equal(frozen.evidence[0].title, '社区整理');
  assert.ok(frozen.contentHash);

  // 修改源笔记后，旧快照内容不变。
  await app.inject({
    method: 'PUT', url: '/api/v1/admin/notebook/notes/' + note.id, headers: adminHeaders,
    payload: { title: '生日习俗整理', kind: 'note', stage: 'reference', summary: '习俗', content: [{ id: 'b1', type: 'text', text: '第二版：还要准备礼物。' }], tags: [] },
  });
  assert.equal(frozen.excerpt, '习俗\n第一版：生日要准备蛋糕。', '快照不随源笔记更新');

  // 引用记录可查回这篇资料。
  const references = store.listReferencesFor('note', String(note.id));
  assert.equal(references.length, 2);
  assert.equal(references[0].sessionId, 'session-1');

  // 更新检查能指出内容已变化，并给出新旧摘要。
  const checked = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/references/check', headers: adminHeaders, payload: { snapshot: compiled.snapshot } });
  assert.equal(checked.statusCode, 200);
  assert.equal(checked.json().updatedCount, 2);
  const status = checked.json().items[0];
  assert.equal(status.state, 'updated');
  assert.ok(String(status.currentExcerpt).includes('第二版'));
  assert.ok(String(status.previousExcerpt).includes('第一版'));

  // 来源不可用时标记为 missing，历史快照仍然可读。
  database.connection.prepare('DELETE FROM creative_notes WHERE id=?').run(String(note.id));
  const missing = await app.inject({ method: 'POST', url: '/api/v1/admin/knowledge/references/check', headers: adminHeaders, payload: { snapshot: compiled.snapshot } });
  assert.equal(missing.json().items[0].state, 'missing');
  assert.ok(String(missing.json().items[0].previousExcerpt).includes('第一版'));
  await app.close(); database.close();
});

test('knowledge: 叙事片段可以作为引用，并保留本地行号定位', async () => {
  const { app, database } = await bootstrap();
  const narrativeDatabase = (await import('./narrative-database.js')).NarrativeDatabase
    ? new (await import('./narrative-database.js')).NarrativeDatabase()
    : null;
  assert.ok(narrativeDatabase, '叙事库应可独立打开');
  // 直接写入一段原文，模拟已导入的叙事档案。
  const now = new Date().toISOString();
  const db = narrativeDatabase!.connection;
  db.prepare('INSERT INTO narrative_sources VALUES (?,?,?,?,?,?,?)').run('src-1', '测试来源', 'json', null, '[]', 'ready', now);
  db.prepare('INSERT INTO narrative_works VALUES (?,?,?,?,?,?,?,?)').run('work-1', 'src-1', 'gi', '原神', '', 'zh-CN', now, now);
  db.prepare('INSERT INTO narrative_releases VALUES (?,?,?,?,?)').run('rel-1', 'work-1', 'r1', '主线', now);
  db.prepare('INSERT INTO narrative_nodes VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('node-1', 'work-1', 'rel-1', null, 'n1', 'story', '璃月篇', 1, '', '{}', now);
  db.prepare('INSERT INTO narrative_scenes VALUES (?,?,?,?,?,?,?,?)').run('scene-1', 'node-1', 's1', '初见', 1, '', '{}', now);
  db.prepare('INSERT INTO narrative_utterances VALUES (?,?,?,?,?,?,?,?,?,?)').run('utt-1', 'scene-1', 'u1', 1, 'dialogue', '钟离', '我是往生堂的客卿。', null, JSON.stringify({ sourceLine: 12, pathHash: 'doc_abc' }), now);

  const found = searchKnowledge({ database, narrativeDatabase }, { q: '往生堂' });
  assert.equal(found.items.length, 1);
  assert.equal(found.items[0].kind, 'narrative');
  assert.equal(found.items[0].locator?.sourceLine, 12);
  assert.equal(found.items[0].locator?.lineKind, 'local', '行号必须标成本地行号');

  const compiled = compileSnapshot({ database, narrativeDatabase }, [
    { sourceKind: 'narrative', sourceId: 'utt-1', usage: 'background' },
  ]);
  assert.equal(compiled.snapshot.references.length, 1);
  assert.equal(compiled.snapshot.references[0].nature, 'canon');
  assert.equal(compiled.snapshot.references[0].authorship, 'excerpt');
  assert.ok(compiled.snapshot.references[0].excerpt.includes('往生堂'));

  narrativeDatabase!.close();
  await app.close(); database.close();
});

test('knowledge: 推荐按角色与作品给出可读原因，不跨作品混用同名角色', async () => {
  const { app, database } = await bootstrap();
  const store = new KnowledgeStore(database);
  const relation = await createNote(app, { title: '胡桃与钟离的关系', kind: 'note', stage: 'reference', summary: '关系', content: [{ id: 'b1', type: 'text', text: '胡桃是往生堂七十七代堂主。' }], tags: [] });
  const location = await createNote(app, { title: '璃月港的地点整理', kind: 'note', stage: 'reference', summary: '地点', content: [{ id: 'b2', type: 'text', text: '璃月港的夜市很热闹。' }], tags: [] });
  const otherWork = await createNote(app, { title: '别的作品里的钟离', kind: 'note', stage: 'reference', summary: '同名角色', content: [{ id: 'b3', type: 'text', text: '另一个世界的钟离。' }], tags: [] });
  store.writeKnowledge(String(relation.id), { schemaVersion: 1, works: [{ key: 'gi', name: '原神' }], characters: [{ work: '原神', name: '钟离' }], locations: [], category: 'relation', nature: 'canon', authorship: 'handwritten', usage: 'reference', sources: [] });
  store.writeKnowledge(String(location.id), { schemaVersion: 1, works: [{ key: 'gi', name: '原神' }], characters: [], locations: [{ work: '原神', name: '璃月港' }], category: 'location', nature: 'canon', authorship: 'handwritten', usage: 'reference', sources: [] });
  store.writeKnowledge(String(otherWork.id), { schemaVersion: 1, works: [{ key: 'other', name: '别的作品' }], characters: [{ work: '别的作品', name: '钟离' }], locations: [], nature: 'personal', authorship: 'handwritten', usage: 'reference', sources: [] });

  const items = recommendNotes(database, { works: ['原神'], characters: ['钟离'], locations: ['璃月港'] });
  const ids = items.map((item) => item.noteId);
  assert.ok(ids.includes(String(relation.id)), '同作品同角色应被推荐');
  assert.ok(ids.includes(String(location.id)), '同地点资料应被推荐');
  assert.ok(!ids.includes(String(otherWork.id)), '同名角色不能跨作品混用');
  const top = items[0];
  assert.ok(top.reasons.some((reason) => reason.includes('钟离')), '应给出关联角色的可读原因');
  assert.ok(top.score > 0);

  // 仅记录的资料不进入推荐。
  const recordOnly = await createNote(app, { title: '随手记', kind: 'note', stage: 'draft', summary: '随想', content: [{ id: 'b4', type: 'text', text: '钟离今天没来。' }], tags: [] });
  store.writeKnowledge(String(recordOnly.id), { schemaVersion: 1, works: [{ key: 'gi', name: '原神' }], characters: [{ work: '原神', name: '钟离' }], locations: [], nature: 'unconfirmed', authorship: 'handwritten', usage: 'record', sources: [] });
  const after = recommendNotes(database, { works: ['原神'], characters: ['钟离'] });
  assert.ok(!after.map((item) => item.noteId).includes(String(recordOnly.id)), '仅记录的资料不自动推荐');
  await app.close(); database.close();
});

test('knowledge: 引用超出预算时明确截断，未解析来源单独报告', async () => {
  const { app, database } = await bootstrap();
  const store = new KnowledgeStore(database);
  const long = await createNote(app, {
    title: '很长的资料', kind: 'note', stage: 'reference', summary: '长文',
    content: [{ id: 'b1', type: 'text', text: '甲'.repeat(5_000) }], tags: [],
  });
  store.writeKnowledge(String(long.id), { schemaVersion: 1, works: [], characters: [], locations: [], nature: 'canon', authorship: 'handwritten', usage: 'reference', sources: [] });
  const result = compileSnapshot({ database, narrativeDatabase: null }, [
    { sourceKind: 'note', sourceId: String(long.id), usage: 'background' },
    { sourceKind: 'note', sourceId: 'missing-note', usage: 'background' },
  ]);
  assert.equal(result.snapshot.references.length, 1);
  assert.equal(result.truncated, true, '超预算必须标记已截断');
  assert.ok(result.snapshot.references[0].excerpt.length <= 2_400);
  assert.equal(result.snapshot.references[0].truncated, true);
  assert.equal(result.unresolved.length, 1);
  assert.equal(result.unresolved[0].sourceId, 'missing-note');
  await app.close(); database.close();
});

test('knowledge: 资料库列表按元数据筛选并返回分面', async () => {
  const { app, database } = await bootstrap();
  const store = new KnowledgeStore(database);
  const note = await createNote(app, { title: '原神角色关系', kind: 'note', stage: 'reference', summary: '关系', content: [{ id: 'b1', type: 'text', text: '钟离与胡桃。' }], tags: [] });
  store.writeKnowledge(String(note.id), {
    schemaVersion: 1, works: [{ key: 'gi', name: '原神' }], characters: [{ work: '原神', name: '钟离' }],
    locations: [], category: 'relation', nature: 'canon', authorship: 'handwritten', usage: 'reference', sources: [],
  });
  const other = await createNote(app, { title: '星铁备忘', kind: 'note', stage: 'draft', summary: '备忘', content: [{ id: 'b2', type: 'text', text: '星铁的角色。' }], tags: [] });
  store.writeKnowledge(String(other.id), {
    schemaVersion: 1, works: [{ key: 'hsr', name: '崩坏：星穹铁道' }], characters: [], locations: [],
    nature: 'unconfirmed', authorship: 'handwritten', usage: 'record', sources: [],
  });

  const all = await app.inject({ url: '/api/v1/admin/notebook/notes?page=1&pageSize=10', headers: adminHeaders });
  assert.equal(all.statusCode, 200);
  assert.equal(all.json().total, 2);
  assert.ok(all.json().facets.works.includes('原神'));
  assert.ok(all.json().facets.works.includes('崩坏：星穹铁道'));

  const byWork = await app.inject({ url: '/api/v1/admin/notebook/notes?works=' + encodeURIComponent('原神'), headers: adminHeaders });
  assert.equal(byWork.json().total, 1);
  assert.equal(byWork.json().items[0].title, '原神角色关系');

  const byUsage = await app.inject({ url: '/api/v1/admin/notebook/notes?usage=reference', headers: adminHeaders });
  assert.equal(byUsage.json().total, 1);

  const byCharacter = await app.inject({ url: '/api/v1/admin/notebook/notes?characters=' + encodeURIComponent('钟离'), headers: adminHeaders });
  assert.equal(byCharacter.json().total, 1);

  // 关键词也能命中元数据里的作品名。
  const byKeyword = await app.inject({ url: '/api/v1/admin/notebook/notes?q=' + encodeURIComponent('星铁'), headers: adminHeaders });
  assert.equal(byKeyword.json().total, 1);
  await app.close(); database.close();
});
