import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { migrateDatabase, SERVICE_DATABASE_MIGRATIONS } from '../database.js';
import {
  hydrateWebSearchSettings,
  readStoredWebSearchSettings,
  writeStoredWebSearchSettings,
} from './settings.js';
import { ServiceDatabase } from '../database.js';
import { SecretStore } from '../security.js';

const NOW = '2026-11-14T08:00:00.000Z';

test('migration 59 upgrades a v58 database, preserves world data, and reopens cleanly', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sthstart-web-search-migration-'));
  const path = join(directory, 'service.db');
  let legacy: DatabaseSync | null = null;
  let upgraded: DatabaseSync | null = null;
  let reopened: DatabaseSync | null = null;

  try {
    legacy = new DatabaseSync(path);
    legacy.exec('PRAGMA foreign_keys = ON');
    migrateDatabase(
      legacy,
      SERVICE_DATABASE_MIGRATIONS.filter((migration) => migration.version <= 58),
      'web-search-migration',
    );
    assert.equal(
      (legacy.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version,
      58,
    );
    assert.equal(
      legacy.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='sw_authoring_settings'").get(),
      undefined,
    );

    const world = {
      id: 'world-v58', revision: 3,
      data_json: JSON.stringify({ id: 'world-v58', title: '雾港纪事', revision: 3 }),
      created_at: NOW, updated_at: NOW,
    };
    const branch = {
      id: 'branch-v58', world_id: world.id, parent_branch_id: null,
      fork_tick: 0, current_tick: 12, revision: 2, source_revision: 1,
      definition_json: JSON.stringify({ title: '雾港纪事', actors: [{ id: 'actor-a' }] }),
      data_json: JSON.stringify({ id: 'branch-v58', worldId: world.id, title: '主线', currentTick: 12 }),
      created_at: NOW, updated_at: NOW,
    };
    legacy.prepare(`INSERT INTO sw_worlds(id,revision,data_json,created_at,updated_at) VALUES (?,?,?,?,?)`)
      .run(world.id, world.revision, world.data_json, world.created_at, world.updated_at);
    legacy.prepare(`INSERT INTO sw_branches
      (id,world_id,parent_branch_id,fork_tick,current_tick,revision,source_revision,definition_json,data_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(branch.id, branch.world_id, branch.parent_branch_id, branch.fork_tick, branch.current_tick,
        branch.revision, branch.source_revision, branch.definition_json, branch.data_json,
        branch.created_at, branch.updated_at);
    legacy.prepare(`INSERT INTO sw_branch_definitions
      (branch_id,revision,effective_tick,source_revision,definition_json,created_at) VALUES (?,?,?,?,?,?)`)
      .run(branch.id, branch.revision, 0, branch.source_revision, branch.definition_json, NOW);
    legacy.prepare(`INSERT INTO sw_events
      (id,world_id,branch_id,tick,duration,location_id,data_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('event-v58', world.id, branch.id, 12, 5, 'loc-pier', JSON.stringify({ id: 'event-v58', summary: '雾中靠岸' }), NOW);
    legacy.prepare(`INSERT INTO sw_actor_states(branch_id,actor_id,updated_tick,data_json) VALUES (?,?,?,?)`)
      .run(branch.id, 'actor-a', 12, JSON.stringify({ mood: '警觉' }));
    legacy.prepare(`INSERT INTO runtime_settings(key,value_json,updated_at) VALUES (?,?,?)`)
      .run('migration-sentinel', '{"keep":true}', NOW);

    legacy.close();
    legacy = null;

    upgraded = new DatabaseSync(path);
    upgraded.exec('PRAGMA foreign_keys = ON');
    migrateDatabase(upgraded, SERVICE_DATABASE_MIGRATIONS, 'web-search-migration');
    assert.equal(
      (upgraded.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version,
      SERVICE_DATABASE_MIGRATIONS.at(-1)!.version,
    );
    assert.ok(upgraded.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='sw_authoring_settings'").get());
    assert.ok(upgraded.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='sw_creation_requests'").get());

    migrateDatabase(upgraded, SERVICE_DATABASE_MIGRATIONS, 'web-search-migration');
    upgraded.close();
    upgraded = null;

    reopened = new DatabaseSync(path);
    reopened.exec('PRAGMA foreign_keys = ON');

    // 迁移 68 起新增可空封面列，旧世界从 null 开始，其余字段原样保留。
    assert.deepEqual(
      { ...(reopened.prepare('SELECT * FROM sw_worlds WHERE id=?').get(world.id) as Record<string, unknown>) },
      { ...world, cover_artifact_id: null },
    );
    assert.deepEqual(
      { ...(reopened.prepare('SELECT * FROM sw_branches WHERE id=?').get(branch.id) as Record<string, unknown>) },
      branch,
    );
    assert.deepEqual(
      JSON.parse((reopened.prepare('SELECT data_json FROM sw_events WHERE branch_id=? AND id=?').get(branch.id, 'event-v58') as { data_json: string }).data_json),
      { id: 'event-v58', summary: '雾中靠岸' },
    );
    assert.deepEqual(
      JSON.parse((reopened.prepare('SELECT data_json FROM sw_actor_states WHERE branch_id=? AND actor_id=?').get(branch.id, 'actor-a') as { data_json: string }).data_json),
      { mood: '警觉' },
    );
    assert.equal(
      (reopened.prepare('SELECT value_json FROM runtime_settings WHERE key=?').get('migration-sentinel') as { value_json: string }).value_json,
      '{"keep":true}',
    );
    assert.equal(
      (reopened.prepare("SELECT COUNT(*) AS count FROM sw_authoring_settings WHERE id='tavily'").get() as { count: number }).count,
      0,
      'migration must not create a search row; default disabled comes from absence',
    );
    assert.deepEqual(reopened.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(
      (reopened.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check,
      'ok',
    );
  } finally {
    for (const connection of [legacy, upgraded, reopened]) {
      if (!connection) continue;
      try { connection.close(); } catch { }
    }
    if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
  }
});

test('web-search settings default to disabled and remain readable after a reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sthstart-web-search-settings-'));
  const path = join(directory, 'service.db');
  const secrets = new SecretStore({});
  let database: ServiceDatabase | null = null;
  try {
    database = new ServiceDatabase(path);
    assert.deepEqual(await hydrateWebSearchSettings(database, secrets), {
      enabled: false, hasCredential: false, credentialSource: 'none',
      provider: 'tavily', anonymous: false,
      providers: [
        { provider: 'anysearch', hasCredential: false },
        { provider: 'exa', hasCredential: false },
        { provider: 'tavily', hasCredential: false },
      ],
    });
    writeStoredWebSearchSettings(database, true);
    assert.deepEqual(readStoredWebSearchSettings(database), { enabled: true, provider: 'tavily', anonymous: false });
    database.close();
    database = null;

    database = new ServiceDatabase(path);
    assert.deepEqual(readStoredWebSearchSettings(database), { enabled: true, provider: 'tavily', anonymous: false });
    assert.deepEqual(database.connection.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(
      (database.connection.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check,
      'ok',
    );
  } finally {
    database?.close();
    if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy and corrupt stored settings normalize safely without rewriting rows', () => {
  const database = new ServiceDatabase();
  try {
    const upsert = database.connection.prepare(`INSERT INTO sw_authoring_settings (id,data_json,updated_at)
      VALUES ('tavily',?,'2026-11-14T00:00:00.000Z') ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json`);
    for (const [json, expected] of [
      ['{"enabled":true}', { enabled: true, provider: 'tavily', anonymous: false }],
      ['{"enabled":true,"provider":"unsupported","anonymous":true}', { enabled: true, provider: 'tavily', anonymous: false }],
      ['{"enabled":true,"provider":"exa","anonymous":true}', { enabled: true, provider: 'exa', anonymous: false }],
      ['{"enabled":true,"provider":"anysearch","anonymous":true}', { enabled: true, provider: 'anysearch', anonymous: true }],
      ['{"enabled":"true"}', { enabled: false, provider: 'tavily', anonymous: false }],
      ['invalid', { enabled: false, provider: 'tavily', anonymous: false }],
      ['[]', { enabled: false, provider: 'tavily', anonymous: false }],
      ['null', { enabled: false, provider: 'tavily', anonymous: false }],
    ] as const) {
      upsert.run(json);
      assert.deepEqual(readStoredWebSearchSettings(database), expected);
      const row = database.connection.prepare('SELECT data_json FROM sw_authoring_settings WHERE id=?').get('tavily') as { data_json: string };
      assert.equal(row.data_json, json, 'reading defaults must not mutate existing settings');
    }
  } finally {
    database.close();
  }
});
