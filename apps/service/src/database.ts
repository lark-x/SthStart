import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const schema = [
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
    error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
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

export class ServiceDatabase {
  readonly connection: DatabaseSync;

  constructor(path: string = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.connection = new DatabaseSync(path);
    this.connection.exec('PRAGMA foreign_keys = ON');
    this.connection.exec('PRAGMA journal_mode = WAL');
    for (const statement of schema) this.connection.prepare(statement).run();
    this.connection.exec('PRAGMA optimize');
  }

  close() {
    this.connection.close();
  }
}

export function nowIso() {
  return new Date().toISOString();
}
