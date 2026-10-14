import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ServiceDatabase, SERVICE_DATABASE_MIGRATIONS, migrateDatabase, nowIso } from '../database.js';
import type { SecretStore } from '../security.js';
import { retrieveHybridImageKnowledge, syncImageKnowledgeIndex } from './image-knowledge-index.js';

test('hybrid stays keyword before complete indexing, ignores stale vectors, falls back on failures', async () => {
  const database = new ServiceDatabase();
  const secrets = {} as SecretStore;
  try {
    const now = nowIso();
    database.connection.prepare("INSERT INTO provider_profiles(id,name,kind,base_url,model,enabled,created_at,updated_at) VALUES ('vector','vector','vector','http://vector.test',NULL,1,?,?)").run(now, now);
    let indexed: Array<{ chroma_id: string; metadata: Record<string, string> }> = [];
    let calls = 0;
    const fetcher: typeof fetch = async (url, init) => {
      calls++; const body = JSON.parse(String(init?.body));
      if (String(url).endsWith('/upsert-batch')) { indexed.push(...body.items); return Response.json({ count: body.items.length }); }
      return Response.json({ results: [{ id: indexed[0].chroma_id, score: 0.8, metadata: indexed[0].metadata }, { id: 'foreign', score: 1, metadata: {} }] });
    };
    const pending = await retrieveHybridImageKnowledge(database, secrets, 'night forest', 'standalone', fetcher);
    assert.equal(pending.actualMode, 'keyword'); assert.equal(calls, 0);
    await Promise.all([syncImageKnowledgeIndex(database, secrets, fetcher), syncImageKnowledgeIndex(database, secrets, fetcher)]);
    assert.equal(indexed.length, 141);
    const ready = await retrieveHybridImageKnowledge(database, secrets, 'night forest', 'standalone', fetcher);
    assert.equal(ready.actualMode, 'hybrid');
    const stale = await retrieveHybridImageKnowledge(database, secrets, 'night forest', 'standalone', async () => Response.json({ results: [{ id: indexed[0].chroma_id, score: 1, metadata: { sthstart_image_version: 'old' } }] }));
    assert.equal(stale.actualMode, 'keyword');
    for (let i = 0; i < 3; i++) await retrieveHybridImageKnowledge(database, secrets, 'night forest', 'standalone', async () => { throw new Error('offline'); });
    assert.equal((await retrieveHybridImageKnowledge(database, secrets, 'night', 'standalone', fetcher)).degraded, 'vector-cooldown');
  } finally { database.close(); }
});

test('migration 52 preserves every old policy and permits hybrid without rewriting history', () => {
  const connection = new DatabaseSync(':memory:');
  try {
    migrateDatabase(connection, SERVICE_DATABASE_MIGRATIONS.filter(item => item.version <= 51), 'test');
    connection.prepare("INSERT INTO activity_image_prompt_policy_versions VALUES ('wf',1,4,1,'rules','style','negative','date','tags','keyword')").run();
    migrateDatabase(connection, SERVICE_DATABASE_MIGRATIONS, 'test');
    const row = connection.prepare("SELECT * FROM activity_image_prompt_policy_versions WHERE revision=4").get();
    assert.equal(row?.knowledge_mode, 'keyword'); assert.equal(row?.instructions, 'rules');
    connection.prepare("INSERT INTO activity_image_prompt_policy_versions VALUES ('wf',1,5,1,'rules','','','date','tags','hybrid')").run();
    assert.equal(connection.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
    assert.equal(connection.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { connection.close(); }
});
