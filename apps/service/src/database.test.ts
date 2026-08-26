import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { ServiceDatabase } from './database.js';

test('fresh databases record an explicit migration baseline', () => {
  const database = new ServiceDatabase();
  const migrations = database.connection.prepare('SELECT version,name FROM schema_migrations').all() as Array<{ version: number; name: string }>;
  assert.equal(migrations.length, 6);
  assert.equal(migrations[0].version, 1);
  assert.equal(migrations[0].name, 'initial');
  assert.equal(migrations[1].version, 2);
  assert.equal(migrations[1].name, 'llm-model-assignments');
  assert.equal(migrations[2].name, 'shared-character-library');
  assert.equal(migrations[3].name, 'version-character-relationships');
  assert.equal(migrations[4].name, 'artifact-2.0-central-media');
  assert.equal(migrations[5].name, 'generation-core-and-scheduler');
  const columns = database.connection.prepare('PRAGMA table_info(provider_profile_options)').all() as Array<{ name: string }>;
  assert.equal(columns.some((column) => column.name === 'capabilities_json'), true);
  database.close();
});

test('unversioned databases fail closed with an actionable reset command', () => {
  const path = resolve(mkdtempSync(resolve(tmpdir(), 'sthstart-db-')), 'legacy.db');
  const legacy = new DatabaseSync(path); legacy.exec('CREATE TABLE legacy_data(id TEXT)'); legacy.close();
  assert.throws(() => new ServiceDatabase(path), /npm run db:reset -- --confirm/);
});

test('version one databases migrate existing LLM profiles to text capability', () => {
  const path = resolve(mkdtempSync(resolve(tmpdir(), 'sthstart-db-v1-')), 'v1.db');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations VALUES (1,'initial','now');
    CREATE TABLE managed_apps(id TEXT PRIMARY KEY,name TEXT,token_hash TEXT,capabilities_json TEXT,enabled INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE provider_profiles(id TEXT PRIMARY KEY,name TEXT,kind TEXT,base_url TEXT,model TEXT,credential_account TEXT,enabled INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE provider_profile_options(profile_id TEXT PRIMARY KEY,thinking_mode TEXT,headers_json TEXT,extra_body_json TEXT);
    CREATE TABLE artifacts(id TEXT PRIMARY KEY, app_id TEXT, task_id TEXT, provider_url TEXT, local_path TEXT, content_type TEXT, byte_size INTEGER, pinned INTEGER, created_at TEXT);
    INSERT INTO provider_profiles VALUES ('old','Old','llm','https://example.test/v1','old-model',NULL,1,'now','now');
    INSERT INTO provider_profile_options VALUES ('old','omit','{}','{}');`);
  old.close();
  const migrated = new ServiceDatabase(path);
  const row = migrated.connection.prepare("SELECT capabilities_json FROM provider_profile_options WHERE profile_id='old'").get() as { capabilities_json: string };
  assert.deepEqual(JSON.parse(row.capabilities_json), ['text']);
  assert.equal(migrated.connection.prepare('SELECT MAX(version) version FROM schema_migrations').get()!.version, 6);
  migrated.close();
});

test('transaction helper rolls back all writes on failure', () => {
  const database = new ServiceDatabase();
  assert.throws(() => database.transaction(() => {
    database.connection.prepare("INSERT INTO runtime_settings VALUES ('one','{}','now')").run();
    throw new Error('stop');
  }));
  assert.equal(database.connection.prepare('SELECT COUNT(*) count FROM runtime_settings').get()!.count, 0);
  database.close();
});
