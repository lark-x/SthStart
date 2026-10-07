import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { SERVICE_DATABASE_MIGRATIONS, migrateDatabase, nowIso } from './database.js';

const LEGACY_VERSION = 48;

function legacyMigrations() {
  return SERVICE_DATABASE_MIGRATIONS.filter((migration) => migration.version <= LEGACY_VERSION);
}

function openLegacyDatabase(path: string) {
  const connection = new DatabaseSync(path);
  connection.exec('PRAGMA foreign_keys = ON');
  migrateDatabase(connection, legacyMigrations(), 'legacy-test');
  return connection;
}

function seedLegacyRows(connection: DatabaseSync) {
  connection.prepare(`INSERT INTO activities (id,title,type,created_at,updated_at) VALUES (?,?,?,?,?)`)
    .run('act-legacy', '旧活动', 'story', nowIso(), nowIso());
  connection.prepare(`INSERT INTO activity_image_prompt_policy_versions
    (workflow_id,workflow_version,revision,enabled,instructions,positive_suffix,negative_prompt,created_at)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run('wf-legacy', 1, 3, 1, 'legacy instructions', '@ebora, masterpiece', 'score_1', nowIso());
  connection.prepare(`INSERT INTO activity_prompt_optimization_runs
    (id,activity_id,idempotency_key,request_hash,trace_id,workflow_id,workflow_version,policy_revision,policy_snapshot_json,
     source_prompt,optimized_prompt,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('run-legacy', 'act-legacy', 'key-1', 'hash-1', 'trace-1', 'wf-legacy', 1, 3, '{"revision":3}',
      '一个中文来源', 'a legacy optimized prompt', 'succeeded', nowIso(), nowIso());
}

function columnNames(connection: DatabaseSync, table: string): string[] {
  return (connection.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

test('migration 49 adds structured prompt columns without rewriting old policy and run rows', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'sthstart-migration-'));
  const path = resolve(directory, 'legacy.db');
  const connection = openLegacyDatabase(path);
  try {
    assert.deepEqual(columnNames(connection, 'activity_image_prompt_policy_versions').includes('output_format'), false);
    seedLegacyRows(connection);

    migrateDatabase(connection, SERVICE_DATABASE_MIGRATIONS, 'legacy-test');

    const policyColumns = columnNames(connection, 'activity_image_prompt_policy_versions');
    assert.ok(policyColumns.includes('output_format'));
    assert.ok(policyColumns.includes('knowledge_mode'));
    const runColumns = columnNames(connection, 'activity_prompt_optimization_runs');
    assert.ok(runColumns.includes('slots_json'));
    assert.ok(runColumns.includes('compilation_snapshot_json'));
    assert.ok(runColumns.includes('request_hash_version'));

    // 旧行保留原值，新列取兼容默认值。
    const policy = connection.prepare(`SELECT * FROM activity_image_prompt_policy_versions
      WHERE workflow_id='wf-legacy' AND workflow_version=1 AND revision=3`).get() as Record<string, unknown>;
    assert.equal(policy.positive_suffix, '@ebora, masterpiece');
    assert.equal(policy.output_format, 'prose');
    assert.equal(policy.knowledge_mode, 'none');

    const run = connection.prepare(`SELECT * FROM activity_prompt_optimization_runs WHERE id='run-legacy'`).get() as Record<string, unknown>;
    assert.equal(run.source_prompt, '一个中文来源');
    assert.equal(run.optimized_prompt, 'a legacy optimized prompt');
    assert.equal(run.status, 'succeeded');
    assert.equal(run.slots_json, null);
    assert.equal(run.compilation_snapshot_json, null);
    assert.equal(run.request_hash_version, 1);

    // 约束实际生效，不接受未定义模式。
    assert.throws(() => connection.prepare(`INSERT INTO activity_image_prompt_policy_versions
      (workflow_id,workflow_version,revision,enabled,instructions,positive_suffix,negative_prompt,output_format,knowledge_mode,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run('wf-legacy', 1, 4, 1, '', '', '', 'bogus', 'none', nowIso()));

    assert.equal((connection.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
    assert.deepEqual(connection.prepare('PRAGMA foreign_key_check').all(), []);

    const applied = connection.prepare('SELECT COUNT(*) AS count, MAX(version) AS version FROM schema_migrations').get() as { count: number; version: number };
    assert.equal(applied.version, SERVICE_DATABASE_MIGRATIONS.at(-1)!.version);
    assert.equal(applied.count, SERVICE_DATABASE_MIGRATIONS.length);

    // 重复迁移是幂等的。
    migrateDatabase(connection, SERVICE_DATABASE_MIGRATIONS, 'legacy-test');
    const again = connection.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number };
    assert.equal(again.count, SERVICE_DATABASE_MIGRATIONS.length);
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
