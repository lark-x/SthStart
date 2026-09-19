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
  { version: 23, name: 'generation-configuration-workspace', statements: [
    // 配置工作台（规划 §11）：全部为加法迁移，旧字段与旧行为保持不变。
    // V1 旧版本 config_format_version=1，新编辑器保存的版本写入 2。
    "ALTER TABLE generation_workflow_versions ADD COLUMN config_format_version INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE generation_workflow_versions ADD COLUMN editor_config_json TEXT",
    // 工作流以归档替代删除，历史版本永远可追溯。
    "ALTER TABLE generation_workflows ADD COLUMN archived_at TEXT",
    // 单工作流一个管理草稿；多窗口用 revision 乐观锁。草稿是编辑状态，
    // 不是运行时第二份权威配置——执行永远读取不可变版本。
    `CREATE TABLE IF NOT EXISTS generation_workflow_drafts (
      workflow_id TEXT PRIMARY KEY REFERENCES generation_workflows(id) ON DELETE CASCADE,
      base_version INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1,
      draft_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    // 预设 = 确切工作流版本 + 连接 + 一组覆盖值 + 开放用途。
    // values_json 只存覆盖值，不复制 definition、字段 Schema 或模型库存。
    `CREATE TABLE IF NOT EXISTS generation_presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      app_id TEXT NOT NULL REFERENCES managed_apps(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL,
      workflow_id TEXT NOT NULL REFERENCES generation_workflows(id) ON DELETE RESTRICT,
      workflow_version INTEGER NOT NULL,
      engine_id TEXT REFERENCES generation_engines(id) ON DELETE RESTRICT,
      values_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_generation_presets_app_purpose ON generation_presets(app_id, purpose, enabled)',
    'CREATE INDEX IF NOT EXISTS idx_generation_presets_workflow ON generation_presets(workflow_id, workflow_version)',
    // 未填时完全沿用旧配置，保证迁移后的默认行为不变。
    'ALTER TABLE app_generation_assignments ADD COLUMN default_preset_id TEXT REFERENCES generation_presets(id)',
  ] },
  { version: 24, name: 'mcp-sources-and-planning-research', statements: [
    // MCP 资料源：连接配置、凭据引用、适用作品、工具允许列表。
    // 认证请求头只存 header 名称，值放凭据库（credential_account），不存明文。
    `CREATE TABLE IF NOT EXISTS mcp_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      auth_mode TEXT NOT NULL DEFAULT 'none' CHECK(auth_mode IN ('none','bearer','header')),
      auth_header_name TEXT,
      credential_account TEXT,
      applicable_works_json TEXT NOT NULL DEFAULT '[]',
      universal INTEGER NOT NULL DEFAULT 0,
      purpose TEXT NOT NULL DEFAULT '',
      allowed_tools_json TEXT NOT NULL DEFAULT '[]',
      discovered_tools_json TEXT NOT NULL DEFAULT '[]',
      timeout_ms INTEGER NOT NULL DEFAULT 45000,
      status TEXT NOT NULL DEFAULT 'enabled' CHECK(status IN ('enabled','disabled')),
      last_test_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_mcp_sources_status ON mcp_sources(status, updated_at DESC)',
    // 研究任务：输入快照、进度、证据、人物/地点候选、错误状态。
    `CREATE TABLE IF NOT EXISTS planning_research_tasks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES activity_planning_sessions(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued',
      input_snapshot_json TEXT NOT NULL DEFAULT '{}',
      progress_label TEXT,
      used_tool_calls INTEGER NOT NULL DEFAULT 0,
      budget_tool_calls INTEGER NOT NULL DEFAULT 12,
      incomplete_reason TEXT,
      error_message TEXT,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      character_candidates_json TEXT NOT NULL DEFAULT '[]',
      location_candidates_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_planning_research_tasks_session ON planning_research_tasks(session_id, created_at DESC)',
    // 研究修订：输入快照与用户约束在启动生成时冻结。
    `CREATE TABLE IF NOT EXISTS planning_research_revisions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES activity_planning_sessions(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES planning_research_tasks(id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 1,
      input_snapshot_json TEXT NOT NULL DEFAULT '{}',
      frozen INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_planning_research_revisions_session ON planning_research_revisions(session_id, version DESC)',
    // 企划会话表追加：研究修订引用。
    'ALTER TABLE activity_planning_sessions ADD COLUMN research_revision_id TEXT REFERENCES planning_research_revisions(id)',
  ] },
  // 话题素材库与活动点子：定时搜集、素材条目、来源记录、点子批次。
  // 素材列表分页只读 topics；原始检索结果留在 run 里，可单独清理而不影响素材。
  { version: 25, name: 'topic-library-and-activity-ideas', statements: [
    `CREATE TABLE IF NOT EXISTS topic_collection_settings (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      works_json TEXT NOT NULL DEFAULT '[]',
      keywords_json TEXT NOT NULL DEFAULT '[]',
      sources_json TEXT NOT NULL DEFAULT '[]',
      daily_time TEXT NOT NULL DEFAULT '09:00',
      timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      next_run_at TEXT,
      max_new_topics INTEGER NOT NULL DEFAULT 20,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS topic_collection_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','partial','failed','interrupted')),
      trigger TEXT NOT NULL DEFAULT 'manual' CHECK(trigger IN ('manual','scheduled','retry')),
      progress_label TEXT,
      used_tool_calls INTEGER NOT NULL DEFAULT 0,
      created_count INTEGER NOT NULL DEFAULT 0,
      merged_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      settings_snapshot_json TEXT NOT NULL DEFAULT '{}',
      raw_candidates_json TEXT NOT NULL DEFAULT '[]',
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_topic_collection_runs_created ON topic_collection_runs(created_at DESC)',
    `CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      works_json TEXT NOT NULL DEFAULT '[]',
      characters_json TEXT NOT NULL DEFAULT '[]',
      kind TEXT NOT NULL DEFAULT 'meme' CHECK(kind IN ('meme','character','update','occasion')),
      info_nature TEXT NOT NULL DEFAULT 'unknown' CHECK(info_nature IN ('official','community','unconfirmed','unknown')),
      adaptation_tags_json TEXT NOT NULL DEFAULT '[]',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0,
      ignored INTEGER NOT NULL DEFAULT 0,
      ignored_at TEXT,
      used_activity_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    // 已忽略的素材默认不进列表；收藏与已使用可以同时存在。
    'CREATE INDEX IF NOT EXISTS idx_topics_seen ON topics(ignored, last_seen_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_topics_used ON topics(used_activity_id)',
    `CREATE TABLE IF NOT EXISTS topic_sources (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      source_id TEXT,
      source_name TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      document_locator TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      published_at TEXT,
      excerpt TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_topic_sources_topic ON topic_sources(topic_id)',
    // 相同标准化 URL 更新已有来源，不新增条目。
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_topic_sources_unique_url ON topic_sources(topic_id, url)',
    `CREATE TABLE IF NOT EXISTS activity_idea_batches (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'queued',
      topics_json TEXT NOT NULL DEFAULT '[]',
      requirement TEXT NOT NULL DEFAULT '',
      lead_character_id TEXT,
      lead_character_name TEXT,
      activity_type TEXT NOT NULL DEFAULT '',
      ideas_json TEXT NOT NULL DEFAULT '[]',
      model_metadata_json TEXT NOT NULL DEFAULT '{}',
      error_message TEXT,
      session_id TEXT,
      activity_id TEXT,
      idempotency_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_activity_idea_batches_created ON activity_idea_batches(created_at DESC)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_idea_batches_idempotency ON activity_idea_batches(idempotency_key) WHERE idempotency_key IS NOT NULL',
    // 企划会话保存灵感来源快照，旧会话缺失该列内容时按原逻辑运行。
    'ALTER TABLE activity_planning_sessions ADD COLUMN inspiration_json TEXT',
  ] },
  // 活动媒体批次：记录批量生图范围、冻结输入、关联任务与协调状态。
  { version: 26, name: 'activity-media-batches', statements: [
    `CREATE TABLE IF NOT EXISTS activity_media_batches (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      content_revision_id TEXT NOT NULL,
      image_config_revision_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      idempotency_key TEXT,
      stop_requested INTEGER NOT NULL DEFAULT 0,
      options_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_activity_media_batches_act ON activity_media_batches(activity_id, created_at DESC)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_media_batches_idempotency ON activity_media_batches(activity_id, idempotency_key) WHERE idempotency_key IS NOT NULL',
    `CREATE TABLE IF NOT EXISTS activity_media_batch_items (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES activity_media_batches(id) ON DELETE CASCADE,
      slot_id TEXT NOT NULL,
      candidate_index INTEGER NOT NULL DEFAULT 0,
      slot_fingerprint TEXT NOT NULL,
      input_snapshot_json TEXT NOT NULL DEFAULT '{}',
      recipe_id TEXT REFERENCES activity_prompt_recipes(id) ON DELETE SET NULL,
      compilation_id TEXT REFERENCES activity_prompt_compilations(id) ON DELETE SET NULL,
      attempt_id TEXT REFERENCES activity_image_attempts(id) ON DELETE SET NULL,
      generation_task_id TEXT REFERENCES generation_tasks(id) ON DELETE SET NULL,
      state TEXT NOT NULL DEFAULT 'waiting' CHECK(state IN ('waiting','preparing','linked','skipped','failed')),
      error_json TEXT NOT NULL DEFAULT '{}',
      retry_of_item_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(batch_id, slot_id, candidate_index)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_media_batch_items_batch ON activity_media_batch_items(batch_id, slot_id)',
    'CREATE INDEX IF NOT EXISTS idx_media_batch_items_attempt ON activity_media_batch_items(attempt_id)',
    'CREATE INDEX IF NOT EXISTS idx_media_batch_items_task ON activity_media_batch_items(generation_task_id)',
  ] },
  // 活动复用预设：活动模板、生产预设与回放预设。
  { version: 27, name: 'activity-reusable-presets', statements: [
    `CREATE TABLE IF NOT EXISTS activity_reusable_presets (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('activity_template','production_preset','playback_preset')),
      name TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      schema_version INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_activity_presets_kind ON activity_reusable_presets(kind, updated_at DESC)',
  ] },
  { version: 28, name: 'activity-local-rework', statements: [
    `CREATE TABLE activity_review_items (
      id TEXT PRIMARY KEY, activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      change_key TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL,
      data_json TEXT NOT NULL, decision TEXT NOT NULL DEFAULT 'pending', execution_json TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(activity_id, change_key)
    )`,
    'CREATE INDEX idx_activity_review_decisions ON activity_review_items(activity_id,decision)',
    `CREATE TABLE activity_candidate_applications (
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      candidate_id TEXT NOT NULL, unit_id TEXT NOT NULL, request_key TEXT NOT NULL,
      content_revision_id TEXT NOT NULL, data_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
      PRIMARY KEY(activity_id,candidate_id,unit_id)
    )`,
    'ALTER TABLE activity_reusable_presets RENAME TO activity_reusable_presets_old',
    `CREATE TABLE activity_reusable_presets (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('activity_template','production_preset','playback_preset','creation_profile')),
      name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, schema_version INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
    'INSERT INTO activity_reusable_presets SELECT * FROM activity_reusable_presets_old',
    'DROP TABLE activity_reusable_presets_old',
    'CREATE INDEX idx_activity_presets_kind ON activity_reusable_presets(kind,updated_at DESC)',
  ] },

  // 创作资料库：资料元数据、来源版本、引用记录，以及搜集任务定义与执行记录。
  // 元数据单独建表，旧客户端的笔记 PUT 完全不触碰它，不会被同步重置。
  { version: 29, name: 'creative-knowledge-library', statements: [
    `CREATE TABLE IF NOT EXISTS note_knowledge (
      note_id TEXT PRIMARY KEY REFERENCES creative_notes(id) ON DELETE CASCADE,
      nature TEXT NOT NULL DEFAULT 'unconfirmed' CHECK(nature IN ('canon','community','personal','unconfirmed')),
      authorship TEXT NOT NULL DEFAULT 'handwritten' CHECK(authorship IN ('handwritten','excerpt','ai-organized','ai-inferred')),
      usage TEXT NOT NULL DEFAULT 'record' CHECK(usage IN ('record','pending','reference')),
      category TEXT,
      works_json TEXT NOT NULL DEFAULT '[]',
      characters_json TEXT NOT NULL DEFAULT '[]',
      locations_json TEXT NOT NULL DEFAULT '[]',
      sources_json TEXT NOT NULL DEFAULT '[]',
      origin_json TEXT,
      content_hash TEXT,
      content_revision INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_note_knowledge_usage ON note_knowledge(usage, updated_at DESC)',
    // 来源身份：同一身份 + 相同内容只更新最后检查时间，不新增待整理项。
    `CREATE TABLE IF NOT EXISTS knowledge_sources (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'manual',
      provider_id TEXT,
      work TEXT,
      external_key TEXT,
      url TEXT,
      title TEXT NOT NULL DEFAULT '',
      source_name TEXT NOT NULL DEFAULT '',
      nature TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    // 表达式索引把 NULL 归一成空串：SQLite 的唯一索引把 NULL 当彼此不同。
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_sources_identity
      ON knowledge_sources(kind, ifnull(provider_id,''), ifnull(external_key,''), ifnull(url,''))`,
    // 来源版本：内容变化时保留旧版本，被引用的版本不随运行日志清理删除。
    `CREATE TABLE IF NOT EXISTS knowledge_source_versions (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      excerpt TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL,
      published_at TEXT,
      retrieved_at TEXT NOT NULL,
      last_checked_at TEXT NOT NULL,
      truncated INTEGER NOT NULL DEFAULT 0,
      organized_text TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_source_versions_hash
      ON knowledge_source_versions(source_id, content_hash)`,
    'CREATE INDEX IF NOT EXISTS idx_knowledge_source_versions_source ON knowledge_source_versions(source_id, retrieved_at DESC)',
    // 引用记录：哪篇资料被哪个企划/活动引用过，用于详情页的“查看引用记录”。
    `CREATE TABLE IF NOT EXISTS knowledge_reference_log (
      id TEXT PRIMARY KEY,
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_version TEXT,
      title TEXT NOT NULL DEFAULT '',
      session_id TEXT,
      activity_id TEXT,
      content_hash TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_knowledge_reference_log_source ON knowledge_reference_log(source_kind, source_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_knowledge_reference_log_activity ON knowledge_reference_log(activity_id)',
    // 搜集任务定义：定义与运行状态分开，“每周搜集”不会一直显示成运行中。
    `CREATE TABLE IF NOT EXISTS knowledge_collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      goal TEXT NOT NULL DEFAULT '',
      works_json TEXT NOT NULL DEFAULT '[]',
      characters_json TEXT NOT NULL DEFAULT '[]',
      mode TEXT NOT NULL DEFAULT 'topic' CHECK(mode IN ('topic','recent')),
      window_days INTEGER NOT NULL DEFAULT 7,
      sources_json TEXT NOT NULL DEFAULT '[]',
      target_note_ids_json TEXT NOT NULL DEFAULT '[]',
      frequency TEXT NOT NULL DEFAULT 'once' CHECK(frequency IN ('once','daily','weekly')),
      daily_time TEXT NOT NULL DEFAULT '09:00',
      weekday INTEGER,
      timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      next_run_at TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      paused_reason TEXT,
      session_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_knowledge_collections_enabled ON knowledge_collections(enabled, next_run_at)',
    `CREATE TABLE IF NOT EXISTS knowledge_collection_runs (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL REFERENCES knowledge_collections(id) ON DELETE CASCADE,
      trigger TEXT NOT NULL DEFAULT 'manual' CHECK(trigger IN ('manual','scheduled','retry')),
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','partial','failed','cancelled','interrupted')),
      progress_label TEXT,
      used_tool_calls INTEGER NOT NULL DEFAULT 0,
      budget_tool_calls INTEGER NOT NULL DEFAULT 12,
      new_count INTEGER NOT NULL DEFAULT 0,
      changed_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      settings_snapshot_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_knowledge_collection_runs_collection ON knowledge_collection_runs(collection_id, created_at DESC)',
    // 待整理：结果与本次执行的关联不会被去重抹掉，同一资料可被多个任务发现。
    `CREATE TABLE IF NOT EXISTS knowledge_pending_items (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES knowledge_collection_runs(id) ON DELETE CASCADE,
      collection_id TEXT NOT NULL REFERENCES knowledge_collections(id) ON DELETE CASCADE,
      source_version_id TEXT NOT NULL REFERENCES knowledge_source_versions(id) ON DELETE CASCADE,
      work TEXT,
      characters_json TEXT NOT NULL DEFAULT '[]',
      change_type TEXT NOT NULL DEFAULT 'new' CHECK(change_type IN ('new','changed')),
      state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','kept','ignored','organized')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_pending_unique
      ON knowledge_pending_items(run_id, source_version_id)`,
    'CREATE INDEX IF NOT EXISTS idx_knowledge_pending_state ON knowledge_pending_items(state, created_at DESC)',
    // 整理草稿：来源集合与版本随草稿冻结，刷新后可继续采用。
    `CREATE TABLE IF NOT EXISTS knowledge_organize_drafts (
      id TEXT PRIMARY KEY,
      target_note_id TEXT,
      base_revision INTEGER,
      target_content_hash TEXT,
      source_version_ids_json TEXT NOT NULL DEFAULT '[]',
      source_item_ids_json TEXT NOT NULL DEFAULT '[]',
      instruction TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      title TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      sources_json TEXT NOT NULL DEFAULT '[]',
      error_message TEXT,
      adopted_note_id TEXT,
      model_metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_knowledge_organize_drafts_created ON knowledge_organize_drafts(created_at DESC)',
  ] },
  // 不改正文、不自动判定为原作事实；旧客户端继续正常读写。
  { version: 30, name: 'note-knowledge-backfill', statements: [
    `INSERT INTO note_knowledge
      (note_id,nature,authorship,usage,works_json,characters_json,locations_json,sources_json,created_at,updated_at)
      SELECT n.id,'unconfirmed','handwritten',
        CASE WHEN n.stage='reference' AND n.kind<>'diary' THEN 'reference' ELSE 'record' END,
        '[]','[]','[]','[]',n.created_at,n.updated_at
      FROM creative_notes n
      WHERE NOT EXISTS (SELECT 1 FROM note_knowledge k WHERE k.note_id=n.id)`,
  ] },
  // 执行结果关联：记录每次执行发现了哪些来源版本（含重复发现），
  // 使执行详情能如实例出“这次新增/变化/重复了什么”。待整理状态仍在 knowledge_pending_items。
  { version: 31, name: 'knowledge-run-findings', statements: [
    `CREATE TABLE IF NOT EXISTS knowledge_run_findings (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES knowledge_collection_runs(id) ON DELETE CASCADE,
      source_version_id TEXT NOT NULL REFERENCES knowledge_source_versions(id) ON DELETE CASCADE,
      change_type TEXT NOT NULL DEFAULT 'new' CHECK(change_type IN ('new','changed','duplicate')),
      created_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_run_findings_unique
      ON knowledge_run_findings(run_id, source_version_id)`,
    'CREATE INDEX IF NOT EXISTS idx_knowledge_run_findings_run ON knowledge_run_findings(run_id, created_at DESC)',
  ] },
  // 旧笔记回填资料元数据：stage=reference 且非日记默认“可参考”，其余默认“仅记录”。
  // 加密云备份：仓库、目标、计划、运行、版本、对象、每目标状态与恢复记录。
  // 加密只作用于上传到网盘的副本；本地媒体与数据库保持原样。
  { version: 32, name: 'encrypted-cloud-backup', statements: [
    // 仓库：只存可公开的 KDF 参数与「被包裹」的主密钥，不含主密钥明文。
    `CREATE TABLE IF NOT EXISTS backup_vaults (
      id TEXT PRIMARY KEY,
      format_version INTEGER NOT NULL DEFAULT 1,
      kdf_json TEXT NOT NULL,
      wrapped_master_key_json TEXT NOT NULL,
      recovery_wrap_json TEXT,
      unlock_policy TEXT NOT NULL DEFAULT 'manual' CHECK(unlock_policy IN ('manual','remember')),
      remembered INTEGER NOT NULL DEFAULT 0,
      credential_account TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    // 目标：凭据只存 SecretStore 引用（credential_account），不落明文 token。
    `CREATE TABLE IF NOT EXISTS backup_targets (
      id TEXT PRIMARY KEY,
      vault_id TEXT NOT NULL REFERENCES backup_vaults(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('local_test','google_drive','onedrive','quark')),
      account_label TEXT NOT NULL DEFAULT '',
      root_path TEXT NOT NULL DEFAULT '',
      local_directory TEXT,
      credential_account TEXT,
      connected INTEGER NOT NULL DEFAULT 1,
      capabilities_json TEXT NOT NULL DEFAULT '{}',
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_backup_targets_vault ON backup_targets(vault_id)',
    // 计划：启停与下次时间独立于运行状态。
    `CREATE TABLE IF NOT EXISTS backup_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('workspace','activities','knowledge')),
      activity_ids_json TEXT NOT NULL DEFAULT '[]',
      works_json TEXT NOT NULL DEFAULT '[]',
      target_ids_json TEXT NOT NULL DEFAULT '[]',
      frequency TEXT NOT NULL DEFAULT 'manual' CHECK(frequency IN ('manual','daily','weekly')),
      daily_time TEXT NOT NULL DEFAULT '03:00',
      weekday INTEGER,
      timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      next_run_at TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      retain_count INTEGER NOT NULL DEFAULT 10,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_backup_plans_due ON backup_plans(enabled, next_run_at)',
    // 版本：清单以对象形式加密保存，这里只记元数据与发布状态。
    `CREATE TABLE IF NOT EXISTS backup_snapshots (
      id TEXT PRIMARY KEY,
      vault_id TEXT NOT NULL REFERENCES backup_vaults(id) ON DELETE CASCADE,
      scope TEXT NOT NULL,
      scope_detail_json TEXT NOT NULL DEFAULT '{}',
      description TEXT NOT NULL DEFAULT '',
      object_count INTEGER NOT NULL DEFAULT 0,
      content_bytes INTEGER NOT NULL DEFAULT 0,
      uploaded_bytes INTEGER NOT NULL DEFAULT 0,
      missing_count INTEGER NOT NULL DEFAULT 0,
      retained INTEGER NOT NULL DEFAULT 0,
      /** 未发布任何目标前不进入可恢复列表。 */
      manifest_object_id TEXT,
      staged_directory TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_backup_snapshots_created ON backup_snapshots(vault_id, created_at DESC)',
    // 对象：同一仓库内相同明文内容复用一个密文对象。
    `CREATE TABLE IF NOT EXISTS backup_objects (
      id TEXT PRIMARY KEY,
      vault_id TEXT NOT NULL REFERENCES backup_vaults(id) ON DELETE CASCADE,
      content_hash TEXT NOT NULL,
      cipher_hash TEXT NOT NULL,
      plaintext_bytes INTEGER NOT NULL DEFAULT 0,
      cipher_bytes INTEGER NOT NULL DEFAULT 0,
      local_cipher_path TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_backup_objects_content
      ON backup_objects(vault_id, content_hash)`,
    // 每个目标对每个版本的状态独立记录，不能用单一 uploaded 标记表达多目标。
    `CREATE TABLE IF NOT EXISTS backup_target_runs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL REFERENCES backup_snapshots(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES backup_targets(id) ON DELETE CASCADE,
      state TEXT NOT NULL DEFAULT 'pending',
      uploaded_objects INTEGER NOT NULL DEFAULT 0,
      uploaded_bytes INTEGER NOT NULL DEFAULT 0,
      total_objects INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER NOT NULL DEFAULT 0,
      manifest_published INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(snapshot_id, target_id)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_backup_target_runs_snapshot ON backup_target_runs(snapshot_id)',
    // 对象在单个目标上的上传与验证结果；切账号或目录不能继承。
    `CREATE TABLE IF NOT EXISTS backup_target_objects (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL REFERENCES backup_targets(id) ON DELETE CASCADE,
      object_id TEXT NOT NULL REFERENCES backup_objects(id) ON DELETE CASCADE,
      vault_id TEXT NOT NULL,
      remote_key TEXT NOT NULL,
      uploaded INTEGER NOT NULL DEFAULT 0,
      verified INTEGER NOT NULL DEFAULT 0,
      /** 验证方式：remote_checksum 或 downloaded_hash。 */
      verify_method TEXT,
      remote_id TEXT,
      uploaded_bytes INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE(target_id, vault_id, object_id)
    )`,
    // 运行记录：阶段、进度与每目标摘要；结束即离开「运行中」。
    `CREATE TABLE IF NOT EXISTS backup_runs (
      id TEXT PRIMARY KEY,
      plan_id TEXT REFERENCES backup_plans(id) ON DELETE SET NULL,
      plan_name TEXT NOT NULL DEFAULT '',
      trigger TEXT NOT NULL CHECK(trigger IN ('manual','scheduled','retry')),
      status TEXT NOT NULL DEFAULT 'queued',
      phase TEXT NOT NULL DEFAULT 'waiting',
      snapshot_id TEXT,
      scope TEXT NOT NULL,
      config_snapshot_json TEXT NOT NULL DEFAULT '{}',
      progress_label TEXT,
      uploaded_bytes INTEGER NOT NULL DEFAULT 0,
      content_bytes INTEGER NOT NULL DEFAULT 0,
      object_count INTEGER NOT NULL DEFAULT 0,
      reused_object_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_backup_runs_created ON backup_runs(created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_backup_runs_plan ON backup_runs(plan_id, created_at DESC)',
    // 恢复记录：下载验证进度、方式、恢复前备份位置。
    `CREATE TABLE IF NOT EXISTS backup_restore_runs (
      id TEXT PRIMARY KEY,
      vault_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      phase TEXT NOT NULL DEFAULT 'waiting',
      progress_label TEXT,
      verified_bytes INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER NOT NULL DEFAULT 0,
      mode TEXT,
      pre_restore_backup_path TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_backup_restore_runs_created ON backup_restore_runs(created_at DESC)',
  ] },
  // 每个已发布版本在单个目标上引用的对象集合：清理时用于判断「独占对象」，
  // 不依赖读取加密清单。与 backup_target_runs 一一对应。
  { version: 33, name: 'backup-snapshot-objects', statements: [
    `CREATE TABLE IF NOT EXISTS backup_snapshot_objects (
      target_id TEXT NOT NULL REFERENCES backup_targets(id) ON DELETE CASCADE,
      snapshot_id TEXT NOT NULL REFERENCES backup_snapshots(id) ON DELETE CASCADE,
      vault_id TEXT NOT NULL,
      object_ids_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(target_id, snapshot_id)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_backup_snapshot_objects_object ON backup_snapshot_objects(target_id)',
  ] },
  // 研究总稿发布到创作资料库的去重键：同一专题 + 同一总稿内容只创建一篇资料。
  { version: 34, name: 'narrative-research-publications', statements: [
    `CREATE TABLE IF NOT EXISTS research_note_links (
      publish_key TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      note_id TEXT NOT NULL,
      run_id TEXT,
      draft_id TEXT,
      created_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_research_note_links_project ON research_note_links(project_id)',
    'CREATE INDEX IF NOT EXISTS idx_research_note_links_note ON research_note_links(note_id)',
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
