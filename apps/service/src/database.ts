import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface DatabaseMigration {
  version: number;
  name: string;
  statements: readonly string[];
}

const initialSchema = [
  `CREATE TABLE IF NOT EXISTS managed_apps (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
    capabilities_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS provider_profiles (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('llm','vector','image')),
    base_url TEXT NOT NULL, model TEXT, credential_account TEXT,
    enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS provider_profile_options (
    profile_id TEXT PRIMARY KEY REFERENCES provider_profiles(id) ON DELETE CASCADE,
    thinking_mode TEXT NOT NULL DEFAULT 'omit' CHECK(thinking_mode IN ('enabled','disabled','omit')),
    headers_json TEXT NOT NULL DEFAULT '{}', extra_body_json TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE TABLE IF NOT EXISTS namespace_grants (
    app_id TEXT NOT NULL REFERENCES managed_apps(id) ON DELETE CASCADE,
    namespace TEXT NOT NULL, access TEXT NOT NULL CHECK(access IN ('read','write')),
    PRIMARY KEY(app_id, namespace, access)
  )`,
  `CREATE TABLE IF NOT EXISTS storage_policies (
    app_id TEXT PRIMARY KEY REFERENCES managed_apps(id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK(mode IN ('keep','ttl','quota')) DEFAULT 'keep',
    ttl_days INTEGER, max_bytes INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS image_tasks (
    id TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES managed_apps(id) ON DELETE CASCADE,
    profile_id TEXT REFERENCES provider_profiles(id), provider_task_id TEXT,
    idempotency_key TEXT, status TEXT NOT NULL, request_json TEXT NOT NULL,
    error TEXT, upstream_may_continue INTEGER NOT NULL DEFAULT 0,
    cancellation_scope TEXT NOT NULL DEFAULT 'none', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(app_id, idempotency_key)
  )`,
  `CREATE TABLE IF NOT EXISTS image_workflows (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, profile_id TEXT REFERENCES provider_profiles(id) ON DELETE SET NULL,
    definition_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES managed_apps(id) ON DELETE CASCADE,
    task_id TEXT REFERENCES image_tasks(id) ON DELETE SET NULL, provider_url TEXT,
    local_path TEXT, content_type TEXT, byte_size INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS personas (
    id TEXT PRIMARY KEY, display_name TEXT NOT NULL, tags_json TEXT NOT NULL,
    source TEXT, latest_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS persona_versions (
    persona_id TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    version INTEGER NOT NULL, display_name TEXT NOT NULL, persona_prompt TEXT NOT NULL,
    appearance_prompt TEXT, avatar_artifact_id TEXT, metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL, PRIMARY KEY(persona_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS app_personas (
    app_id TEXT NOT NULL REFERENCES managed_apps(id) ON DELETE CASCADE,
    local_id TEXT NOT NULL, source_persona_id TEXT, source_version INTEGER,
    snapshot_json TEXT NOT NULL, published_persona_id TEXT, created_at TEXT NOT NULL,
    PRIMARY KEY(app_id, local_id)
  )`,
  `CREATE TABLE IF NOT EXISTS creative_notes (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL
      CHECK(kind IN ('diary','idea','note','story','character','world')),
    summary TEXT NOT NULL DEFAULT '', content_json TEXT NOT NULL, tags_json TEXT NOT NULL,
    stage TEXT NOT NULL CHECK(stage IN ('draft','reference','story-candidate')) DEFAULT 'draft',
    favorite INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS runtime_settings (
    key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS runtime_imports (
    source TEXT PRIMARY KEY, imported_at TEXT NOT NULL, snapshot_json TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS note_assets (
    id TEXT PRIMARY KEY, note_id TEXT REFERENCES creative_notes(id) ON DELETE SET NULL,
    local_path TEXT NOT NULL, content_type TEXT NOT NULL, byte_size INTEGER NOT NULL,
    original_name TEXT, created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_profiles_kind_enabled ON provider_profiles(kind, enabled)',
  'CREATE INDEX IF NOT EXISTS idx_tasks_app_created ON image_tasks(app_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_artifacts_app_created ON artifacts(app_id, created_at)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_task_source ON artifacts(task_id, provider_url) WHERE provider_url IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS idx_notes_kind_updated ON creative_notes(kind, updated_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_notes_stage_updated ON creative_notes(stage, updated_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_note_assets_note ON note_assets(note_id)',
];

export const SERVICE_DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  { version: 1, name: 'initial', statements: initialSchema },
  { version: 2, name: 'llm-model-assignments', statements: [
    `ALTER TABLE provider_profile_options ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '["text"]'`,
    `CREATE TABLE app_llm_assignments (
      app_id TEXT NOT NULL REFERENCES managed_apps(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('text','multimodal')),
      profile_id TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE RESTRICT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(app_id, role)
    )`,
    'CREATE INDEX idx_app_llm_assignments_profile ON app_llm_assignments(profile_id)',
  ] },
  { version: 3, name: 'shared-character-library', statements: [
    `CREATE TABLE character_profiles (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
      draft_json TEXT NOT NULL, tags_json TEXT NOT NULL DEFAULT '[]', avatar_asset_id TEXT,
      latest_version INTEGER, archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE character_versions (
      character_id TEXT NOT NULL REFERENCES character_profiles(id) ON DELETE CASCADE,
      version INTEGER NOT NULL, data_json TEXT NOT NULL, compiled_linshe_prompt TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY(character_id,version)
    )`,
    `CREATE TABLE character_sources (
      id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES character_profiles(id) ON DELETE CASCADE,
      title TEXT NOT NULL, url TEXT, excerpt TEXT NOT NULL DEFAULT '', source_type TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    )`,
    `CREATE TABLE character_relationships (
      id TEXT PRIMARY KEY, from_character_id TEXT NOT NULL REFERENCES character_profiles(id) ON DELETE CASCADE,
      to_character_id TEXT NOT NULL REFERENCES character_profiles(id) ON DELETE CASCADE,
      relation_type TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
      UNIQUE(from_character_id,to_character_id)
    )`,
    `CREATE TABLE character_assets (
      id TEXT PRIMARY KEY, character_id TEXT REFERENCES character_profiles(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('avatar','reference')), local_path TEXT NOT NULL,
      content_type TEXT NOT NULL, byte_size INTEGER NOT NULL, original_name TEXT, created_at TEXT NOT NULL
    )`,
    `CREATE TABLE app_character_links (
      app_id TEXT NOT NULL REFERENCES managed_apps(id) ON DELETE CASCADE,
      local_id TEXT NOT NULL, character_id TEXT NOT NULL REFERENCES character_profiles(id) ON DELETE CASCADE,
      source_version INTEGER NOT NULL, imported_hash TEXT NOT NULL, local_modified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(app_id,local_id)
    )`,
    'CREATE INDEX idx_character_profiles_updated ON character_profiles(archived,updated_at DESC)',
    'CREATE INDEX idx_character_sources_character ON character_sources(character_id)',
    'CREATE INDEX idx_character_relationships_from ON character_relationships(from_character_id)',
    'CREATE INDEX idx_app_character_links_character ON app_character_links(character_id)',
  ] },
  { version: 4, name: 'version-character-relationships', statements: [
    "ALTER TABLE character_versions ADD COLUMN relationships_json TEXT NOT NULL DEFAULT '[]'",
  ] },
];

function userTables(connection: DatabaseSync) {
  return (connection.prepare(`SELECT name FROM sqlite_schema
    WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'`).all() as { name: string }[])
    .map((row) => row.name);
}

export function migrateDatabase(connection: DatabaseSync, migrations: readonly DatabaseMigration[], label: string) {
  const migrationTable = connection.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='schema_migrations'").get();
  if (!migrationTable) {
    const existing = userTables(connection);
    if (existing.length > 0) {
      throw new Error(`${label} database has an unversioned schema (${existing.join(', ')}). Run npm run db:reset -- --confirm.`);
    }
  }
  connection.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
  )`);
  const applied = connection.prepare('SELECT version,name FROM schema_migrations ORDER BY version').all() as Array<{ version: number; name: string }>;
  const known = new Map(migrations.map((migration) => [migration.version, migration]));
  for (const row of applied) {
    const migration = known.get(row.version);
    if (!migration || migration.name !== row.name) throw new Error(`${label} database contains an unknown migration: ${row.version}/${row.name}`);
  }
  for (const migration of migrations) {
    if (applied.some((row) => row.version === migration.version)) continue;
    connection.exec('BEGIN IMMEDIATE');
    try {
      for (const statement of migration.statements) connection.exec(statement);
      connection.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES (?,?,?)')
        .run(migration.version, migration.name, nowIso());
      connection.exec('COMMIT');
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }
  const check = connection.prepare('PRAGMA quick_check').get() as { quick_check: string } | undefined;
  if (check?.quick_check !== 'ok') throw new Error(`${label} database quick_check failed: ${check?.quick_check ?? 'unknown'}`);
  connection.exec('PRAGMA optimize');
}

export class ServiceDatabase {
  readonly connection: DatabaseSync;

  constructor(path: string = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.connection = new DatabaseSync(path);
    this.connection.exec('PRAGMA foreign_keys = ON');
    this.connection.exec('PRAGMA journal_mode = WAL');
    migrateDatabase(this.connection, SERVICE_DATABASE_MIGRATIONS, 'service');
  }

  transaction<T>(operation: () => T): T {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.connection.exec('COMMIT');
      return result;
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  close() {
    this.connection.close();
  }
}

export function nowIso() {
  return new Date().toISOString();
}
