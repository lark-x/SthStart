import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceDatabase } from './database.js';
import { KnowledgeStore, contentHashOf } from './knowledge/store.js';
import { checkReferences, compileSnapshot, referencePromptBlock } from './knowledge/references.js';
import { nextCollectionRun, dedupeKnowledgeCandidates } from './knowledge/collections.js';

test('knowledge review: weekly schedules use the selected local weekday, including Sunday', () => {
  const schedule = { frequency: 'weekly' as const, dailyTime: '09:00', timezone: 'Asia/Shanghai', weekday: 0 };
  assert.equal(nextCollectionRun(new Date('2026-09-16T10:00:00Z'), schedule), '2026-09-20T01:00:00.000Z');
  assert.equal(nextCollectionRun(new Date('2026-09-20T01:00:00Z'), schedule), '2026-09-27T01:00:00.000Z');
  assert.equal(nextCollectionRun(new Date('2026-09-19T23:00:00Z'), schedule), '2026-09-20T01:00:00.000Z');
});

test('knowledge review: document IDs are scoped to their MCP provider', () => {
  const base = { title: '角色资料', documentKey: 'same-id', url: '', excerpt: '原文', sourceName: 'source' };
  assert.equal(dedupeKnowledgeCandidates([{ ...base, sourceId: 'a' }, { ...base, sourceId: 'b' }]).length, 2);
});

test('knowledge review: truncated references retain their hash, prompt ID and explicitly frozen history', () => {
  const database = new ServiceDatabase();
  try {
    const store = new KnowledgeStore(database);
    const sourceId = store.upsertSource({ kind: 'web', title: '原文', url: 'https://example.test/source' });
    const first = store.recordSourceVersion(sourceId, { title: '原文', excerpt: '旧内容'.repeat(1500) });
    const dependencies = { database, narrativeDatabase: null };
    const snapshot = compileSnapshot(dependencies, [{ sourceKind: 'collection', sourceId: first.versionId, usage: 'background' }]).snapshot;
    const reference = snapshot.references[0];
    assert.ok(reference.truncated);
    assert.equal(reference.contentHash, contentHashOf(reference.excerpt));
    assert.equal(checkReferences(dependencies, snapshot).items[0].state, 'unchanged');
    assert.ok(referencePromptBlock(snapshot).includes('[' + reference.id + ']'));
    const second = store.recordSourceVersion(sourceId, { title: '原文', excerpt: '更新后的内容' });
    const checked = checkReferences(dependencies, snapshot).items[0];
    assert.equal(checked.state, 'updated');
    assert.equal(checked.currentSourceId, second.versionId);
    database.connection.prepare('DELETE FROM knowledge_source_versions WHERE source_id=?').run(sourceId);
    const frozen = compileSnapshot(dependencies, [{ sourceKind: 'collection', sourceId: first.versionId, usage: 'requirement', frozenReference: reference }]).snapshot;
    assert.equal(frozen.references[0].excerpt, reference.excerpt);
    assert.equal(frozen.references[0].id, reference.id);
    assert.equal(frozen.references[0].usage, 'requirement');
  } finally { database.close(); }
});
