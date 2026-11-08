import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { ServiceDatabase } from './database.js';
import { NarrativeDatabase } from './narrative-database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { KnowledgeStore } from './knowledge/store.js';
import { KnowledgeCollectionStore } from './knowledge/collections.js';
import { registerKnowledgeRoutes } from './knowledge/routes.js';
import { searchKnowledge, searchNarrative } from './knowledge/search.js';
import { compileSnapshot } from './knowledge/references.js';

const stamp = '2026-11-08T12:00:00.000Z';

function seedNotes(database: ServiceDatabase, count: number) {
  const knowledge = new KnowledgeStore(database);
  for (let index = 0; index < count; index++) {
    const id = 'note-' + String(index).padStart(3, '0');
    database.connection.prepare('INSERT INTO creative_notes(id,title,kind,summary,content_json,tags_json,stage,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, '分页资料 ' + index, 'note', index === 0 ? '独有关键词' : '分页', '[]', '[]', 'reference', stamp, stamp);
    knowledge.writeKnowledge(id, { schemaVersion: 1, usage: 'reference', nature: 'canon', authorship: 'handwritten', works: [{ key: 'work', name: '作品' }], characters: [{ work: '作品', name: '角色' }], locations: [], sources: [] });
  }
}

function seedNarrative(database: NarrativeDatabase, count: number) {
  const db = database.connection;
  db.prepare('INSERT INTO narrative_sources VALUES (?,?,?,?,?,?,?)').run('source', '来源', 'json', null, '[]', 'ready', stamp);
  db.prepare('INSERT INTO narrative_works VALUES (?,?,?,?,?,?,?,?)').run('work', 'source', 'work', '作品', '', 'zh-CN', stamp, stamp);
  db.prepare('INSERT INTO narrative_releases VALUES (?,?,?,?,?)').run('release', 'work', 'r1', '主线', stamp);
  db.prepare('INSERT INTO narrative_nodes VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('node', 'work', 'release', null, 'node', 'story', '章节', 1, '', '{}', stamp);
  db.prepare('INSERT INTO narrative_scenes VALUES (?,?,?,?,?,?,?,?)').run('scene', 'node', 'scene', '场景', 1, '', '{}', stamp);
  for (let index = 0; index < count; index++) {
    const id = 'utterance-' + String(index).padStart(3, '0');
    const text = '分页原文 长句检索 ' + index;
    db.prepare('INSERT INTO narrative_utterances VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, 'scene', id, index, 'dialogue', '角色', text, null, JSON.stringify({ sourceLine: index + 1 }), stamp);
    db.prepare('INSERT INTO narrative_fts(work_id,kind,ref_id,title,body) VALUES (?,?,?,?,?)').run('work', 'utterance', id, '角色', text);
  }
}

test('knowledge combined pagination reaches beyond 100 without duplicates and counts complete filtered data', () => {
  const database = new ServiceDatabase(':memory:');
  const narrativeDatabase = new NarrativeDatabase(':memory:');
  try {
    seedNotes(database, 125); seedNarrative(narrativeDatabase, 125);
    const dependencies = { database, narrativeDatabase };
    const all: string[] = [];
    for (let offset = 0; offset < 250; offset += 20) {
      const page = searchKnowledge(dependencies, { q: '分页', limit: 20, offset, kinds: ['note', 'narrative'] });
      assert.equal(page.total, 250);
      assert.equal(page.hasMore, offset + page.items.length < 250);
      all.push(...page.items.map(item => item.kind + ':' + item.id));
    }
    assert.equal(new Set(all).size, 250);
    assert.equal(all[0], 'note:note-124');
    assert.equal(all[124], 'note:note-000');
    assert.equal(all[125], 'narrative:utterance-000');
    assert.deepEqual(searchKnowledge(dependencies, { q: '独有关键词', limit: 20 }).items.map(item => item.id), ['note-000']);
    assert.equal(searchKnowledge(dependencies, { q: '角色', kinds: ['note'], limit: 20 }).total, 125);
    assert.equal(searchKnowledge(dependencies, { works: ['不存在'], kinds: ['note'], limit: 20 }).total, 0);
    const beyond = searchKnowledge(dependencies, { limit: 20, offset: 300, kinds: ['note'] });
    assert.equal(beyond.total, 125); assert.deepEqual(beyond.items, []); assert.equal(beyond.hasMore, false);
    // Both trigram FTS and the short-CJK fallback must page the full narrative set.
    for (const q of ['分页', '长句检索']) {
      const page = searchNarrative(narrativeDatabase, { q, offset: 100, limit: 20 });
      assert.equal(page.total, 125); assert.equal(page.items[0].id, 'utterance-100');
      assert.equal(page.items[0].locator?.lineKind, 'local');
    }
  } finally { database.close(); narrativeDatabase.close(); }
});

test('knowledge mixed sources preserve resolvable topic and collection version identities', () => {
  const database = new ServiceDatabase(':memory:');
  try {
    seedNotes(database, 1);
    database.connection.prepare('INSERT INTO topics(id,title,summary,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('topic', '分页灵感', '分页素材正文', stamp, stamp, stamp, stamp);
    const collections = new KnowledgeCollectionStore(database);
    const collection = collections.save({ name: '分页搜集' });
    const run = collections.createRun({ collectionId: collection.id, trigger: 'manual', settingsSnapshot: {} });
    const store = new KnowledgeStore(database);
    const source = store.upsertSource({ kind: 'web', title: '分页来源', url: 'https://fixture.test/knowledge', nature: 'community' });
    const version = store.recordSourceVersion(source, { title: '分页搜集结果', excerpt: '分页来源正文' });
    collections.addPending({ runId: run.id, collectionId: collection.id, sourceVersionId: version.versionId, characters: [], changeType: 'new' });
    // Duplicate findings from another run must not duplicate a source version.
    const otherRun = collections.createRun({ collectionId: collection.id, trigger: 'manual', settingsSnapshot: {} });
    collections.addPending({ runId: otherRun.id, collectionId: collection.id, sourceVersionId: version.versionId, characters: [], changeType: 'new' });
    const dependencies = { database, narrativeDatabase: null };
    const result = searchKnowledge(dependencies, { q: '分页', limit: 20 });
    assert.equal(result.total, 3);
    assert.deepEqual(result.items.map(item => item.kind), ['note', 'topic', 'collection']);
    assert.equal(result.items[2].id, version.versionId);
    const compiled = compileSnapshot(dependencies, result.items.map(item => ({ sourceKind: item.kind, sourceId: item.id, usage: 'background' })));
    assert.equal(compiled.unresolved.length, 0); assert.equal(compiled.snapshot.references.length, 3);
    assert.equal(searchKnowledge(dependencies, { kinds: ['topic'], limit: 1 }).total, 1);
    assert.equal(searchKnowledge(dependencies, { kinds: ['collection'], limit: 1 }).total, 1);
    database.connection.prepare('UPDATE topics SET ignored=1 WHERE id=?').run('topic');
    database.connection.prepare("UPDATE knowledge_pending_items SET state='ignored' WHERE source_version_id=?").run(version.versionId);
    assert.equal(searchKnowledge(dependencies, { q: '分页' }).total, 1, 'ignored source results must stay excluded');
  } finally { database.close(); }
});

test('knowledge search HTTP validates pagination and keeps no-offset callers compatible', async () => {
  const database = new ServiceDatabase(':memory:');
  const app = Fastify();
  try {
    seedNotes(database, 125);
    registerKnowledgeRoutes(app, { config: readConfig({}), database, narrativeDatabase: null, secrets: new SecretStore() });
    const page = await app.inject({ url: '/api/v1/admin/knowledge/search?kinds=note&offset=100&limit=20' });
    assert.equal(page.statusCode, 200);
    assert.equal(page.json().total, 125); assert.equal(page.json().items[0].id, 'note-024');
    assert.equal(page.json().offset, 100); assert.equal(page.json().hasMore, true);
    const legacy = await app.inject({ url: '/api/v1/admin/knowledge/search?kinds=note&limit=40' });
    assert.equal(legacy.statusCode, 200); assert.equal(legacy.json().items.length, 40);
    for (const query of ['offset=-1', 'offset=1.5', 'offset=no', 'limit=201', 'limit=0', 'kinds=bad']) {
      assert.equal((await app.inject({ url: '/api/v1/admin/knowledge/search?' + query })).statusCode, 400, query);
    }
    const empty = await app.inject({ url: '/api/v1/admin/knowledge/search?q=没有匹配' });
    assert.equal(empty.json().total, 0); assert.equal(empty.json().hasMore, false);
  } finally { await app.close(); database.close(); }
});
