import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface DatabaseMigration {
  version: number;
  name: string;
  statements: readonly string[];
  /**
   * 需要重建表结构（例如删除被外键引用的列）时置为 true：
   * SQLite 的 DROP COLUMN 不能用于外键列，只能在关闭外键约束后重建表。
   * 迁移器会在事务外切换 PRAGMA foreign_keys，并在结束后恢复。
   */
  foreignKeysOff?: boolean;
  /**
   * 破坏性迁移的前置检查：在事务开始前执行，抛错即中止本次迁移（规划 9.4）。
   * 用于「必须先归档、否则不许删」的场景。
   */
  guard?: (connection: DatabaseSync) => void;
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
    task_id TEXT, provider_url TEXT,
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

/**
 * 迁移 20 会删除 character_outfits。本项目从不写入这张表，但别人升级过来的库里可能有行；
 * 直接 DROP 就是静默的数据丢失，所以先在事务外中止并指向归档入口（规划 7.5 / 9.4）。
 */
function guardCharacterOutfitsArchived(connection: DatabaseSync) {
  const table = connection.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='character_outfits'").get();
  if (!table) return;
  const row = connection.prepare('SELECT COUNT(*) AS count FROM character_outfits').get() as { count: number };
  if (row.count <= 0) return;
  throw new Error(
    `character_outfits 还有 ${row.count} 行数据，迁移 20 会删除该表。`
    + ' 请先运行 node scripts/character-model-migration.mjs apply 归档这些服装行（写入角色来源的迁移归档），再启动服务。',
  );
}

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
  { version: 5, name: 'artifact-2.0-central-media', statements: [
    "ALTER TABLE artifacts ADD COLUMN sha256 TEXT",
    "ALTER TABLE artifacts ADD COLUMN file_status TEXT NOT NULL DEFAULT 'ready'",
    "ALTER TABLE artifacts ADD COLUMN original_name TEXT",
    "ALTER TABLE artifacts ADD COLUMN media_type TEXT",
    "ALTER TABLE artifacts ADD COLUMN width INTEGER",
    "ALTER TABLE artifacts ADD COLUMN height INTEGER",
    "ALTER TABLE artifacts ADD COLUMN duration_ms INTEGER",
    "ALTER TABLE artifacts ADD COLUMN params_summary_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE artifacts ADD COLUMN updated_at TEXT",
    `CREATE TABLE IF NOT EXISTS artifact_references (
      id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
      app_id TEXT NOT NULL REFERENCES managed_apps(id) ON DELETE CASCADE,
      ref_type TEXT NOT NULL, ref_id TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(artifact_id, app_id, ref_type, ref_id)
    )`,
    `CREATE TABLE IF NOT EXISTS artifact_grants (
      id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
      owner_app_id TEXT NOT NULL REFERENCES managed_apps(id) ON DELETE CASCADE,
      grantee_app_id TEXT NOT NULL REFERENCES managed_apps(id) ON DELETE CASCADE,
      access TEXT NOT NULL CHECK(access IN ('read','reference')) DEFAULT 'read',
      expires_at TEXT, created_at TEXT NOT NULL,
      UNIQUE(artifact_id, grantee_app_id, access)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_artifacts_sha ON artifacts(sha256)',
    'CREATE INDEX IF NOT EXISTS idx_artifact_refs_artifact ON artifact_references(artifact_id)',
    'CREATE INDEX IF NOT EXISTS idx_artifact_refs_app ON artifact_references(app_id, ref_type, ref_id)',
    'CREATE INDEX IF NOT EXISTS idx_artifact_grants_grantee ON artifact_grants(grantee_app_id, artifact_id)',
  ] },
  { version: 6, name: 'generation-core-and-scheduler', statements: [
    `CREATE TABLE IF NOT EXISTS generation_engines (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('comfyui','worker','cloud')),
      base_url TEXT NOT NULL, credential_account TEXT, enabled INTEGER NOT NULL DEFAULT 1,
      concurrency_limit INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS generation_workflows (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      engine_kind TEXT NOT NULL CHECK(engine_kind IN ('comfyui','worker','cloud')),
      latest_version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS generation_workflow_versions (
      workflow_id TEXT NOT NULL REFERENCES generation_workflows(id) ON DELETE CASCADE,
      version INTEGER NOT NULL, engine_id TEXT REFERENCES generation_engines(id) ON DELETE SET NULL,
      input_schema_json TEXT NOT NULL DEFAULT '{}', node_bindings_json TEXT NOT NULL DEFAULT '{}',
      output_declarations_json TEXT NOT NULL DEFAULT '[]', definition_json TEXT NOT NULL,
      is_published INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
      PRIMARY KEY(workflow_id, version)
    )`,
    `CREATE TABLE IF NOT EXISTS app_generation_assignments (
      app_id TEXT NOT NULL REFERENCES managed_apps(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL, workflow_id TEXT NOT NULL REFERENCES generation_workflows(id) ON DELETE CASCADE,
      workflow_version INTEGER NOT NULL, engine_id TEXT NOT NULL REFERENCES generation_engines(id) ON DELETE CASCADE,
      updated_at TEXT NOT NULL, PRIMARY KEY(app_id, purpose)
    )`,
    `CREATE TABLE IF NOT EXISTS generation_tasks (
      id TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES managed_apps(id) ON DELETE CASCADE,
      engine_id TEXT NOT NULL REFERENCES generation_engines(id),
      workflow_id TEXT NOT NULL REFERENCES generation_workflows(id),
      workflow_version INTEGER NOT NULL, purpose TEXT NOT NULL DEFAULT 'default',
      idempotency_key TEXT, request_hash TEXT NOT NULL, request_params_json TEXT NOT NULL,
      workflow_snapshot_json TEXT NOT NULL, actual_seed INTEGER,
      status TEXT NOT NULL CHECK(status IN ('queued','submitting','accepted','running','succeeded','failed','cancelled','abandoned')) DEFAULT 'queued',
      provider_task_id TEXT, error_code TEXT, error_message TEXT,
      upstream_may_continue INTEGER NOT NULL DEFAULT 0,
      cancellation_scope TEXT NOT NULL DEFAULT 'none' CHECK(cancellation_scope IN ('none','queued','local-tracking')),
      retry_of TEXT REFERENCES generation_tasks(id) ON DELETE SET NULL,
      lease_owner TEXT, lease_expires_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT,
      UNIQUE(app_id, idempotency_key)
    )`,
    `CREATE TABLE IF NOT EXISTS generation_task_artifacts (
      task_id TEXT NOT NULL REFERENCES generation_tasks(id) ON DELETE CASCADE,
      artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
      output_name TEXT NOT NULL DEFAULT 'default', sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, PRIMARY KEY(task_id, artifact_id)
    )`,
    `CREATE TABLE IF NOT EXISTS generation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES generation_tasks(id) ON DELETE CASCADE,
      app_id TEXT NOT NULL REFERENCES managed_apps(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_gen_tasks_status ON generation_tasks(status, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_gen_tasks_app_created ON generation_tasks(app_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_gen_events_app_id ON generation_events(app_id, id)',
    'CREATE INDEX IF NOT EXISTS idx_gen_events_task_id ON generation_events(task_id, id)',
  ] },
  { version: 7, name: 'windows-worker-bridge', statements: [
    `CREATE TABLE IF NOT EXISTS generation_workers (
      engine_id TEXT PRIMARY KEY REFERENCES generation_engines(id) ON DELETE CASCADE,
      model TEXT NOT NULL DEFAULT '', temperature REAL NOT NULL DEFAULT 0.7,
      ip_allowlist_json TEXT NOT NULL DEFAULT '[]',
      disk_warning_bytes INTEGER NOT NULL DEFAULT 10737418240,
      disk_stop_bytes INTEGER NOT NULL DEFAULT 2147483648,
      last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_generation_workers_seen ON generation_workers(last_seen_at)',
  ] },
  { version: 8, name: 'generation-engine-request-options', statements: [
    `CREATE TABLE IF NOT EXISTS generation_engine_options (
      engine_id TEXT PRIMARY KEY REFERENCES generation_engines(id) ON DELETE CASCADE,
      headers_json TEXT NOT NULL DEFAULT '{}'
    )`,
  ] },
  { version: 9, name: 'generation-media-capabilities-and-progress', statements: [
    "ALTER TABLE generation_tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'",
    "ALTER TABLE generation_tasks ADD COLUMN progress_json TEXT NOT NULL DEFAULT '{}'",
    'ALTER TABLE generation_tasks ADD COLUMN started_at TEXT',
    `CREATE TABLE IF NOT EXISTS generation_workflow_media_versions (
      workflow_id TEXT NOT NULL REFERENCES generation_workflows(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('image','video','audio','transform')) DEFAULT 'image',
      input_capabilities_json TEXT NOT NULL DEFAULT '{}',
      output_media_types_json TEXT NOT NULL DEFAULT '["image/png"]',
      output_schema_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(workflow_id, version)
    )`,
    "ALTER TABLE generation_engine_options ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '{}'",
    'CREATE INDEX idx_gen_tasks_priority ON generation_tasks(priority, status, created_at)',
  ] },
  { version: 10, name: 'artifact-video-metadata', statements: [
    // Keep media capabilities on the canonical workflow records. The
    // compatibility table created in v9 is retained for databases upgraded
    // from the first implementation and is read only as a fallback.
    "ALTER TABLE generation_workflows ADD COLUMN category TEXT NOT NULL DEFAULT 'image' CHECK(category IN ('image','video','audio','transform'))",
    "ALTER TABLE generation_workflow_versions ADD COLUMN input_capabilities_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE generation_workflow_versions ADD COLUMN output_media_types_json TEXT NOT NULL DEFAULT '[\"image/png\"]'",
    "ALTER TABLE generation_workflow_versions ADD COLUMN output_schema_json TEXT NOT NULL DEFAULT '{}'",
    'ALTER TABLE artifacts ADD COLUMN fps REAL',
    'ALTER TABLE artifacts ADD COLUMN codec TEXT',
    'ALTER TABLE artifacts ADD COLUMN has_audio INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE artifacts ADD COLUMN thumbnail_artifact_id TEXT REFERENCES artifacts(id)',
    "ALTER TABLE artifacts ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'",
  ] },
  { version: 11, name: 'generation-consumer-links', statements: [
    'ALTER TABLE character_assets ADD COLUMN artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL',
    'CREATE INDEX IF NOT EXISTS idx_character_assets_artifact ON character_assets(artifact_id)',
    `CREATE TABLE IF NOT EXISTS generation_context_links (
      task_id TEXT NOT NULL REFERENCES generation_tasks(id) ON DELETE CASCADE,
      app_id TEXT NOT NULL REFERENCES managed_apps(id) ON DELETE CASCADE,
      context_type TEXT NOT NULL CHECK(context_type IN ('character','narrative')),
      context_id TEXT NOT NULL,
      artifact_id TEXT REFERENCES artifacts(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(task_id, context_type, context_id, role)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_generation_context_links_context ON generation_context_links(app_id, context_type, context_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_generation_context_links_artifact ON generation_context_links(artifact_id)',
  ] },
  { version: 12, name: 'notebook-local-first-sync', statements: [
    'ALTER TABLE creative_notes ADD COLUMN revision INTEGER NOT NULL DEFAULT 1',
  ] },
  { version: 13, name: 'activity-studio', statements: [
    `CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      theme TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      rules TEXT NOT NULL DEFAULT '',
      archived INTEGER NOT NULL DEFAULT 0,
      head_version INTEGER NOT NULL DEFAULT 1,
      current_content_revision_id TEXT,
      current_media_revision_id TEXT,
      current_playback_revision_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_activities_updated ON activities(updated_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_activities_archived ON activities(archived, updated_at DESC)',
    `CREATE TABLE IF NOT EXISTS activity_drafts (
      activity_id TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
      draft_version INTEGER NOT NULL DEFAULT 1,
      document_json TEXT NOT NULL,
      base_content_revision_id TEXT,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS activity_content_revisions (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      parent_id TEXT,
      document_json TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      hash TEXT NOT NULL,
      created_source TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_activity_content_revisions_act ON activity_content_revisions(activity_id, created_at DESC)',
    `CREATE TABLE IF NOT EXISTS activity_candidates (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      base_revision_id TEXT,
      draft_version INTEGER,
      scope_json TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      validation_json TEXT NOT NULL,
      adopted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_activity_candidates_act ON activity_candidates(activity_id, created_at DESC)',
    `CREATE TABLE IF NOT EXISTS activity_media_revisions (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      content_revision_id TEXT NOT NULL REFERENCES activity_content_revisions(id) ON DELETE CASCADE,
      slot_bindings_json TEXT NOT NULL,
      hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_activity_media_revisions_content ON activity_media_revisions(content_revision_id)',
    `CREATE TABLE IF NOT EXISTS activity_playback_revisions (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      content_revision_id TEXT NOT NULL REFERENCES activity_content_revisions(id) ON DELETE CASCADE,
      media_revision_id TEXT NOT NULL REFERENCES activity_media_revisions(id) ON DELETE CASCADE,
      document_json TEXT NOT NULL,
      hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_activity_playback_revisions_content ON activity_playback_revisions(content_revision_id)',
    `CREATE TABLE IF NOT EXISTS activity_checkpoints (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      head_version INTEGER NOT NULL,
      content_revision_id TEXT NOT NULL,
      media_revision_id TEXT,
      playback_revision_id TEXT,
      created_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_activity_checkpoints_act ON activity_checkpoints(activity_id, created_at DESC)',
    `CREATE TABLE IF NOT EXISTS activity_assets (
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      asset_key TEXT NOT NULL,
      artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
      source TEXT NOT NULL,
      type TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      duration_ms INTEGER,
      hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(activity_id, asset_key)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_activity_assets_artifact ON activity_assets(artifact_id)',
    `CREATE TABLE IF NOT EXISTS activity_jobs (
      id TEXT PRIMARY KEY,
      activity_id TEXT REFERENCES activities(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      idempotency_key TEXT,
      target_revision_id TEXT,
      result_candidate_ids_json TEXT NOT NULL DEFAULT '[]',
      error_message TEXT,
      model_metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_activity_jobs_act_status ON activity_jobs(activity_id, status)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_jobs_idempotency ON activity_jobs(activity_id, kind, idempotency_key) WHERE idempotency_key IS NOT NULL',
    `CREATE TABLE IF NOT EXISTS activity_job_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL REFERENCES activity_jobs(id) ON DELETE CASCADE,
      activity_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_activity_job_events_job ON activity_job_events(job_id, id)',
    `CREATE TABLE IF NOT EXISTS activity_media_job_links (
      task_id TEXT NOT NULL REFERENCES generation_tasks(id) ON DELETE CASCADE,
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      content_revision_id TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      slot_fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(task_id, slot_id)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_activity_media_job_links_act ON activity_media_job_links(activity_id, content_revision_id)',
  ] },
  { version: 14, name: 'activity-image-provenance', statements: [
    `CREATE TABLE IF NOT EXISTS activity_image_config_drafts (
      activity_id TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
      draft_version INTEGER NOT NULL DEFAULT 1,
      document_json TEXT NOT NULL,
      base_revision_id TEXT,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS activity_image_config_revisions (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      parent_id TEXT,
      document_json TEXT NOT NULL,
      hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_activity_image_config_revisions_act ON activity_image_config_revisions(activity_id, created_at DESC)',
    `CREATE TABLE IF NOT EXISTS activity_prompt_recipes (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      content_revision_id TEXT NOT NULL,
      image_config_revision_id TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      slot_fingerprint TEXT NOT NULL,
      source_refs_json TEXT NOT NULL,
      blocks_json TEXT NOT NULL,
      references_json TEXT NOT NULL,
      overrides_json TEXT NOT NULL DEFAULT '[]',
      recipe_hash TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_prompt_recipes_act_slot ON activity_prompt_recipes(activity_id, slot_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_prompt_recipes_hash ON activity_prompt_recipes(recipe_hash)',
    `CREATE TABLE IF NOT EXISTS activity_prompt_compilations (
      id TEXT PRIMARY KEY,
      recipe_id TEXT NOT NULL REFERENCES activity_prompt_recipes(id) ON DELETE CASCADE,
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      compiler_version TEXT NOT NULL,
      template_id TEXT NOT NULL,
      template_version TEXT NOT NULL,
      channels_json TEXT NOT NULL,
      effective_params_json TEXT NOT NULL,
      execution_plan_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_prompt_compilations_recipe ON activity_prompt_compilations(recipe_id)',
    'CREATE INDEX IF NOT EXISTS idx_prompt_compilations_plan ON activity_prompt_compilations(execution_plan_hash)',
    `CREATE TABLE IF NOT EXISTS activity_image_attempts (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      base_content_revision_id TEXT NOT NULL,
      image_config_revision_id TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      slot_fingerprint TEXT NOT NULL,
      recipe_id TEXT NOT NULL REFERENCES activity_prompt_recipes(id) ON DELETE RESTRICT,
      compilation_id TEXT NOT NULL REFERENCES activity_prompt_compilations(id) ON DELETE RESTRICT,
      recipe_hash TEXT NOT NULL,
      execution_plan_hash TEXT NOT NULL,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'preparing',
      actual_seed INTEGER NOT NULL,
      retry_of_attempt_id TEXT,
      parent_attempt_ids_json TEXT NOT NULL DEFAULT '[]',
      idempotency_key TEXT,
      business_request_hash TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_image_attempts_idempotency ON activity_image_attempts(activity_id, idempotency_key) WHERE idempotency_key IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_image_attempts_slot ON activity_image_attempts(activity_id, slot_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_image_attempts_task ON activity_image_attempts(task_id)',
    `CREATE TABLE IF NOT EXISTS activity_image_execution_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id TEXT NOT NULL REFERENCES activity_image_attempts(id) ON DELETE CASCADE,
      phase TEXT NOT NULL,
      actual_inputs_json TEXT NOT NULL,
      uploaded_file_mappings_json TEXT NOT NULL DEFAULT '{}',
      request_summary_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(attempt_id, phase)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_image_exec_snapshots_attempt ON activity_image_execution_snapshots(attempt_id)',
    `CREATE TABLE IF NOT EXISTS activity_image_attempt_outputs (
      attempt_id TEXT NOT NULL REFERENCES activity_image_attempts(id) ON DELETE CASCADE,
      artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
      asset_key TEXT NOT NULL,
      output_name TEXT NOT NULL DEFAULT 'default',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY(attempt_id, artifact_id)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_attempt_outputs_asset ON activity_image_attempt_outputs(asset_key)',
    `CREATE TABLE IF NOT EXISTS activity_image_lineage (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      child_asset_key TEXT NOT NULL,
      parent_asset_key TEXT NOT NULL,
      attempt_id TEXT REFERENCES activity_image_attempts(id) ON DELETE SET NULL,
      role TEXT NOT NULL DEFAULT 'init_image',
      transform_params_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_image_lineage_child ON activity_image_lineage(activity_id, child_asset_key)',
    'CREATE INDEX IF NOT EXISTS idx_image_lineage_parent ON activity_image_lineage(activity_id, parent_asset_key)',
    `CREATE TABLE IF NOT EXISTS activity_image_source_dependencies (
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      slot_id TEXT NOT NULL,
      recipe_id TEXT NOT NULL REFERENCES activity_prompt_recipes(id) ON DELETE CASCADE,
      entity_kind TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      field_path TEXT NOT NULL,
      value_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(activity_id, slot_id, entity_kind, entity_id, field_path)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_source_deps_lookup ON activity_image_source_dependencies(activity_id, entity_kind, entity_id, field_path)',
    'ALTER TABLE activity_media_revisions ADD COLUMN image_config_revision_id TEXT',
    'ALTER TABLE activity_checkpoints ADD COLUMN image_config_revision_id TEXT',
    'ALTER TABLE activity_media_job_links ADD COLUMN attempt_id TEXT',
  ] },
  { version: 15, name: 'activity-frozen-image-plans', statements: [
    "ALTER TABLE activity_prompt_compilations ADD COLUMN execution_plan_json TEXT NOT NULL DEFAULT 'null'",
  ] },
  { version: 16, name: 'character-library-remediation', statements: [
    "ALTER TABLE character_profiles ADD COLUMN draft_revision INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE character_profiles ADD COLUMN default_outfit_id TEXT",
    "ALTER TABLE character_versions ADD COLUMN draft_revision INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE character_versions ADD COLUMN appearance_snapshot_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE character_versions ADD COLUMN provenance_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE character_sources ADD COLUMN provider_id TEXT",
    "ALTER TABLE character_sources ADD COLUMN external_id TEXT",
    "ALTER TABLE character_sources ADD COLUMN payload_hash TEXT",
    "ALTER TABLE character_assets ADD COLUMN sha256 TEXT",
    "ALTER TABLE character_assets ADD COLUMN width INTEGER",
    "ALTER TABLE character_assets ADD COLUMN height INTEGER",
    "ALTER TABLE character_assets ADD COLUMN source_page TEXT",
    "ALTER TABLE character_assets ADD COLUMN source_url TEXT",
    "ALTER TABLE character_assets ADD COLUMN author_note TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE character_assets ADD COLUMN user_note TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE character_assets ADD COLUMN purposes_json TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE character_assets ADD COLUMN outfit_id TEXT",
    "ALTER TABLE character_assets ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE character_assets ADD COLUMN crop_json TEXT",
    `CREATE TABLE character_source_snapshots (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      external_id TEXT,
      source_url TEXT,
      author TEXT,
      remote_version TEXT,
      remote_updated_at TEXT,
      fetched_at TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      format TEXT NOT NULL,
      parser_version TEXT NOT NULL,
      raw_file_path TEXT,
      raw_payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(provider_id, external_id, payload_hash)
    )`,
    'CREATE INDEX idx_character_source_snapshots_external ON character_source_snapshots(provider_id, external_id, fetched_at DESC)',
    `CREATE TABLE character_import_sessions (
      id TEXT PRIMARY KEY,
      operator_scope TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('fetching','parsing','ready','committing','committed','failed','cancelled','expired')),
      expires_at TEXT NOT NULL,
      source_snapshot_id TEXT REFERENCES character_source_snapshots(id) ON DELETE SET NULL,
      preview_revision INTEGER NOT NULL DEFAULT 1,
      preview_hash TEXT NOT NULL,
      candidate_json TEXT NOT NULL DEFAULT '{}',
      compatibility_json TEXT NOT NULL DEFAULT '{}',
      target_character_id TEXT REFERENCES character_profiles(id) ON DELETE SET NULL,
      base_draft_revision INTEGER,
      commit_result_json TEXT,
      idempotency_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE UNIQUE INDEX idx_character_import_idempotency ON character_import_sessions(operator_scope, idempotency_key) WHERE idempotency_key IS NOT NULL',
    'CREATE INDEX idx_character_import_expiry ON character_import_sessions(status, expires_at)',
    `CREATE TABLE character_field_provenance (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL REFERENCES character_profiles(id) ON DELETE CASCADE,
      version INTEGER,
      field_path TEXT NOT NULL,
      value_hash TEXT NOT NULL,
      source_kind TEXT NOT NULL CHECK(source_kind IN ('source_extract','card_author','user_edit','ai_inferred','image_observed','legacy_unknown')),
      source_snapshot_id TEXT REFERENCES character_source_snapshots(id) ON DELETE SET NULL,
      source_pointer TEXT,
      evidence_json TEXT NOT NULL DEFAULT '{}',
      derived_from_json TEXT NOT NULL DEFAULT '[]',
      confirmed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
    'CREATE INDEX idx_character_field_provenance_lookup ON character_field_provenance(character_id, field_path, created_at DESC)',
    `CREATE TABLE character_outfits (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL REFERENCES character_profiles(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX idx_character_outfits_character ON character_outfits(character_id, updated_at DESC)',
    `CREATE TABLE character_visual_references (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL REFERENCES character_profiles(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES character_assets(id) ON DELETE RESTRICT,
      artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
      sha256 TEXT NOT NULL,
      purposes_json TEXT NOT NULL DEFAULT '[]',
      outfit_id TEXT REFERENCES character_outfits(id) ON DELETE SET NULL,
      source_page TEXT,
      original_url TEXT,
      author_note TEXT NOT NULL DEFAULT '',
      user_note TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      crop_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX idx_character_visual_refs_character ON character_visual_references(character_id, enabled, created_at DESC)',
    `CREATE TABLE character_model_assignments (
      character_id TEXT NOT NULL REFERENCES character_profiles(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('text','multimodal')),
      profile_id TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE RESTRICT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(character_id, role)
    )`,
    `CREATE TABLE character_ai_candidates (
      id TEXT PRIMARY KEY,
      character_id TEXT REFERENCES character_profiles(id) ON DELETE CASCADE,
      import_session_id TEXT REFERENCES character_import_sessions(id) ON DELETE CASCADE,
      reference_id TEXT REFERENCES character_visual_references(id) ON DELETE SET NULL,
      input_hash TEXT NOT NULL,
      output_json TEXT NOT NULL,
      model_profile_id TEXT,
      prompt_snapshot_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL CHECK(status IN ('ready','applied','rejected','failed')),
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE character_auditions (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL REFERENCES character_profiles(id) ON DELETE CASCADE,
      draft_revision INTEGER NOT NULL,
      scenario TEXT NOT NULL,
      output TEXT NOT NULL,
      feedback TEXT,
      suggestions_json TEXT NOT NULL DEFAULT '[]',
      compiler_version TEXT NOT NULL,
      model_profile_id TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE activity_character_asset_transfers (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      source_character_id TEXT NOT NULL REFERENCES character_profiles(id) ON DELETE RESTRICT,
      source_version INTEGER,
      source_reference_id TEXT REFERENCES character_visual_references(id) ON DELETE RESTRICT,
      source_artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
      target_artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
      asset_key TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(activity_id, idempotency_key),
      UNIQUE(activity_id, source_reference_id, sha256)
    )`,
    'CREATE INDEX idx_activity_character_transfers_activity ON activity_character_asset_transfers(activity_id, created_at DESC)',
  ] },
  { version: 17, name: 'character-source-snapshot-links', statements: [
    'ALTER TABLE character_sources ADD COLUMN source_snapshot_id TEXT REFERENCES character_source_snapshots(id) ON DELETE SET NULL',
    'CREATE INDEX idx_character_sources_snapshot ON character_sources(source_snapshot_id)',
  ] },
  { version: 18, name: 'character-library-organization', statements: [
    "ALTER TABLE character_profiles ADD COLUMN organization_json TEXT NOT NULL DEFAULT '{}'",
    `CREATE TABLE character_works(name TEXT PRIMARY KEY COLLATE NOCASE,aliases_json TEXT NOT NULL DEFAULT '[]',media_type TEXT NOT NULL DEFAULT '')`,
    `INSERT INTO character_works VALUES ('原神','["Genshin Impact"]','游戏'),('崩坏：星穹铁道','["星铁","崩坏星穹铁道","Honkai: Star Rail"]','游戏')`,
    'CREATE INDEX idx_character_browse_updated ON character_profiles(archived,updated_at DESC,id)',
    "CREATE INDEX idx_character_browse_work ON character_profiles(json_extract(draft_json,'$.work'))",
  ] },
  { version: 19, name: 'birthday-calendar-and-planning', statements: [
    `CREATE TABLE character_birthdays(
      character_id TEXT PRIMARY KEY REFERENCES character_profiles(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'unset',
      calendar TEXT NOT NULL DEFAULT 'unknown',
      month INTEGER,
      day INTEGER,
      raw_text TEXT,
      source TEXT,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX idx_character_birthdays_date ON character_birthdays(status,month,day)',
    'ALTER TABLE activities ADD COLUMN scheduled_date TEXT',
    'CREATE INDEX idx_activities_scheduled ON activities(archived,scheduled_date)',
    `CREATE TABLE activity_actor_characters(
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL,
      source_character_id TEXT NOT NULL,
      PRIMARY KEY(activity_id,actor_id)
    )`,
    'CREATE INDEX idx_activity_actor_characters_character ON activity_actor_characters(source_character_id,activity_id)',
    "ALTER TABLE activity_jobs ADD COLUMN request_json TEXT NOT NULL DEFAULT '{}'",
    `CREATE TABLE activity_planning_sessions(
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft',
      form_json TEXT NOT NULL DEFAULT '{}',
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      document_json TEXT,
      activity_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX idx_activity_planning_sessions_activity ON activity_planning_sessions(activity_id)',
    `CREATE TABLE activity_planning_jobs(
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES activity_planning_sessions(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      idempotency_key TEXT,
      request_json TEXT NOT NULL DEFAULT '{}',
      result_candidate_ids_json TEXT NOT NULL DEFAULT '[]',
      error_message TEXT,
      model_metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX idx_activity_planning_jobs_session ON activity_planning_jobs(session_id,created_at DESC)',
    `CREATE TABLE activity_planning_candidates(
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES activity_planning_sessions(id) ON DELETE CASCADE,
      session_version INTEGER,
      payload_json TEXT NOT NULL,
      validation_json TEXT NOT NULL DEFAULT '{}',
      adopted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
    'CREATE INDEX idx_activity_planning_candidates_session ON activity_planning_candidates(session_id,created_at DESC)',
  ] },
  { version: 20, name: 'character-media-column-convergence', foreignKeysOff: true, guard: guardCharacterOutfitsArchived, statements: [
    // 角色媒体元数据的权威位置收敛（规划第 7 节）：
    //   artifacts        —— 文件本身（路径、MIME、字节数、哈希、尺寸、原文件名）
    //   character_assets —— 某角色对一份文件的使用与来源（来源页面/URL、作者/用户备注）
    //   character_visual_references —— 作为生成参考的配置（用途、启用、裁剪）
    // 迁移 16 把同一批元数据同时写进 assets 与 references；这里删除 references 侧的副本，
    // 读取统一改为 JOIN character_assets。
    'CREATE TABLE character_visual_references_v2 ('
      + ' id TEXT PRIMARY KEY,'
      + ' character_id TEXT NOT NULL REFERENCES character_profiles(id) ON DELETE CASCADE,'
      + ' asset_id TEXT NOT NULL REFERENCES character_assets(id) ON DELETE RESTRICT,'
      + " purposes_json TEXT NOT NULL DEFAULT '[]',"
      + ' enabled INTEGER NOT NULL DEFAULT 1,'
      + ' crop_json TEXT,'
      + ' created_at TEXT NOT NULL,'
      + ' updated_at TEXT NOT NULL'
      + ')',
    'INSERT INTO character_visual_references_v2 (id,character_id,asset_id,purposes_json,enabled,crop_json,created_at,updated_at)'
      + ' SELECT id,character_id,asset_id,purposes_json,enabled,crop_json,created_at,updated_at FROM character_visual_references',
    // 参考图上的来源与备注统一由 character_assets 承载；资产侧为空时回填，避免信息丢失。
    "UPDATE character_assets SET source_page = COALESCE(NULLIF(source_page,''), (SELECT r.source_page FROM character_visual_references r WHERE r.asset_id = character_assets.id AND r.source_page IS NOT NULL LIMIT 1)), source_url = COALESCE(NULLIF(source_url,''), (SELECT r.original_url FROM character_visual_references r WHERE r.asset_id = character_assets.id AND r.original_url IS NOT NULL LIMIT 1)) WHERE id IN (SELECT asset_id FROM character_visual_references)",
    "UPDATE character_assets SET author_note = CASE WHEN author_note = '' THEN COALESCE((SELECT r.author_note FROM character_visual_references r WHERE r.asset_id = character_assets.id AND r.author_note <> '' LIMIT 1), '') ELSE author_note END, user_note = CASE WHEN user_note = '' THEN COALESCE((SELECT r.user_note FROM character_visual_references r WHERE r.asset_id = character_assets.id AND r.user_note <> '' LIMIT 1), '') ELSE user_note END WHERE id IN (SELECT asset_id FROM character_visual_references)",
    // 双写的哈希与 artifact 归属以 artifacts 为准；资产侧缺失时用参考图侧补齐线索。
    "UPDATE character_assets SET artifact_id = COALESCE(artifact_id, (SELECT r.artifact_id FROM character_visual_references r WHERE r.asset_id = character_assets.id AND r.artifact_id IS NOT NULL LIMIT 1)) WHERE artifact_id IS NULL",
    'DROP TABLE character_visual_references',
    'ALTER TABLE character_visual_references_v2 RENAME TO character_visual_references',
    'CREATE INDEX idx_character_visual_refs_character ON character_visual_references(character_id, enabled, created_at DESC)',
    // 资产表的参考配置与文件镜像列同样收敛：用途/启用/裁剪属于参考配置，哈希与尺寸属于 artifacts。
    'ALTER TABLE character_assets DROP COLUMN purposes_json',
    'ALTER TABLE character_assets DROP COLUMN enabled',
    'ALTER TABLE character_assets DROP COLUMN crop_json',
    'ALTER TABLE character_assets DROP COLUMN sha256',
    'ALTER TABLE character_assets DROP COLUMN width',
    'ALTER TABLE character_assets DROP COLUMN height',
    'ALTER TABLE character_assets DROP COLUMN outfit_id',
    // 本项目没有命名服装库业务；旧表为空壳，归档后移除。邻舍自身的换装表不在这个数据库。
    'DROP INDEX IF EXISTS idx_character_outfits_character',
    'DROP TABLE IF EXISTS character_outfits',
  ] },
  { version: 21, name: 'character-asset-file-mirror-cleanup', statements: [
    // 角色资产不再镜像文件信息：文件本身（路径、MIME、字节数、原文件名）只登记在 artifacts，
    // 读取统一走 artifact_id。迁移前实测 character_assets 为 0 行，旧文件也早已接入 artifacts。
    'ALTER TABLE character_assets DROP COLUMN local_path',
    'ALTER TABLE character_assets DROP COLUMN content_type',
    'ALTER TABLE character_assets DROP COLUMN byte_size',
    'ALTER TABLE character_assets DROP COLUMN original_name',
    // 默认穿着由 V2 的 appearance.defaultOutfitText 表达；这里的伪 ID 列数据全为 NULL。
    'ALTER TABLE character_profiles DROP COLUMN default_outfit_id',
  ] },
  { version: 22, name: 'character-version-compiler-version', statements: [
    // 发布版本记录生成提示词的编译器版本（规划 4.1 / 6.3）。
    // 历史版本留空：它们由旧编译器生成，不能回填成新版本号去冒充新产物。
    'ALTER TABLE character_versions ADD COLUMN compiler_version TEXT',
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
    migration.guard?.(connection);
    // PRAGMA foreign_keys 在事务内无效，必须在 BEGIN 之前切换。
    if (migration.foreignKeysOff) connection.exec('PRAGMA foreign_keys = OFF');
    connection.exec('BEGIN IMMEDIATE');
    try {
      for (const statement of migration.statements) connection.exec(statement);
      connection.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES (?,?,?)')
        .run(migration.version, migration.name, nowIso());
      connection.exec('COMMIT');
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    } finally {
      if (migration.foreignKeysOff) connection.exec('PRAGMA foreign_keys = ON');
    }
  }
  if (migrations.some((migration) => migration.foreignKeysOff)) {
    const violations = connection.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error(`${label} database has ${violations.length} foreign key violation(s) after migration`);
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
