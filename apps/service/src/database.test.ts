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
  assert.equal(migrations.length, 12);
  assert.equal(migrations[0].version, 1);
  assert.equal(migrations[0].name, 'initial');
  assert.equal(migrations[1].version, 2);
  assert.equal(migrations[1].name, 'llm-model-assignments');
  assert.equal(migrations[2].name, 'shared-character-library');
  assert.equal(migrations[3].name, 'version-character-relationships');
  assert.equal(migrations[4].name, 'artifact-2.0-central-media');
  assert.equal(migrations[5].name, 'generation-core-and-scheduler');
  assert.equal(migrations[6].name, 'windows-worker-bridge');
  assert.equal(migrations[7].name, 'generation-engine-request-options');
  assert.equal(migrations[8].version, 9);
  assert.equal(migrations[8].name, 'generation-media-capabilities-and-progress');
  assert.equal(migrations[9].version, 10);
  assert.equal(migrations[9].name, 'artifact-video-metadata');
  assert.equal(migrations[10].version, 11);
  assert.equal(migrations[10].name, 'generation-consumer-links');
  assert.equal(migrations[11].version, 12);
  assert.equal(migrations[11].name, 'notebook-local-first-sync');
  const columns = database.connection.prepare('PRAGMA table_info(provider_profile_options)').all() as Array<{ name: string }>;
  assert.equal(columns.some((column) => column.name === 'capabilities_json'), true);
  const taskColumns = database.connection.prepare('PRAGMA table_info(generation_tasks)').all() as Array<{ name: string }>;
  assert.equal(taskColumns.some((column) => column.name === 'progress_json'), true);
  const workflowColumns = database.connection.prepare('PRAGMA table_info(generation_workflows)').all() as Array<{ name: string }>;
  assert.equal(workflowColumns.some((column) => column.name === 'category'), true);
  const workflowVersionColumns = database.connection.prepare('PRAGMA table_info(generation_workflow_versions)').all() as Array<{ name: string }>;
  assert.equal(workflowVersionColumns.some((column) => column.name === 'input_capabilities_json'), true);
  assert.equal(workflowVersionColumns.some((column) => column.name === 'output_media_types_json'), true);
  assert.equal(workflowVersionColumns.some((column) => column.name === 'output_schema_json'), true);
  const artifactColumns = database.connection.prepare('PRAGMA table_info(artifacts)').all() as Array<{ name: string }>;
  assert.equal(artifactColumns.some((column) => column.name === 'thumbnail_artifact_id'), true);
  const characterAssetColumns = database.connection.prepare('PRAGMA table_info(character_assets)').all() as Array<{ name: string }>;
  assert.equal(characterAssetColumns.some((column) => column.name === 'artifact_id'), true);
  const noteColumns = database.connection.prepare('PRAGMA table_info(creative_notes)').all() as Array<{ name: string }>;
  assert.equal(noteColumns.some((column) => column.name === 'revision'), true);
  assert.equal(database.connection.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='generation_context_links'").get() !== undefined, true);
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
    CREATE TABLE creative_notes(id TEXT PRIMARY KEY,title TEXT,kind TEXT,summary TEXT,content_json TEXT,tags_json TEXT,stage TEXT,favorite INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE artifacts(id TEXT PRIMARY KEY, app_id TEXT, task_id TEXT, provider_url TEXT, local_path TEXT, content_type TEXT, byte_size INTEGER, pinned INTEGER, created_at TEXT);
    INSERT INTO provider_profiles VALUES ('old','Old','llm','https://example.test/v1','old-model',NULL,1,'now','now');
    INSERT INTO provider_profile_options VALUES ('old','omit','{}','{}');`);
  old.close();
  const migrated = new ServiceDatabase(path);
  const row = migrated.connection.prepare("SELECT capabilities_json FROM provider_profile_options WHERE profile_id='old'").get() as { capabilities_json: string };
  assert.deepEqual(JSON.parse(row.capabilities_json), ['text']);
  assert.equal(migrated.connection.prepare('SELECT MAX(version) version FROM schema_migrations').get()!.version, 12);
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
