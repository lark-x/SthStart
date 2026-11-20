/**
 * Migration 65 for the independent creative orchestration domain. The main
 * agent registers this array in database.ts; this module intentionally owns
 * no migration version.
 */
export const CREATIVE_ORCHESTRATION_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS co_roles (
    id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL CHECK(revision >= 1),
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS co_workflows (
    id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL CHECK(revision >= 1),
    published_version INTEGER NOT NULL DEFAULT 0 CHECK(published_version >= 0),
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS co_workflow_versions (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES co_workflows(id) ON DELETE RESTRICT,
    version INTEGER NOT NULL CHECK(version >= 1),
    document_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(workflow_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS co_runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES co_workflows(id) ON DELETE RESTRICT,
    workflow_version INTEGER NOT NULL CHECK(workflow_version >= 1),
    revision INTEGER NOT NULL CHECK(revision >= 1),
    status TEXT NOT NULL CHECK(status IN (
      'queued','running','waiting_approval','paused','uncertain','completed','failed','cancelled'
    )),
    scope_json TEXT NOT NULL,
    instruction TEXT NOT NULL,
    budget_json TEXT NOT NULL,
    usage_json TEXT NOT NULL,
    role_snapshot_json TEXT NOT NULL,
    input_json TEXT NOT NULL,
    parent_run_id TEXT REFERENCES co_runs(id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS co_run_keys (
    idempotency_key TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL,
    run_id TEXT NOT NULL UNIQUE REFERENCES co_runs(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS co_node_runs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES co_runs(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    attempt INTEGER NOT NULL CHECK(attempt >= 0),
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
    status TEXT NOT NULL CHECK(status IN (
      'pending','running','waiting','succeeded','skipped','failed','uncertain'
    )),
    input_json TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    output_artifact_id TEXT REFERENCES co_artifacts(id) ON DELETE SET NULL,
    external_task_id TEXT,
    trace_id TEXT NOT NULL,
    dispatched_at TEXT,
    error TEXT,
    lease_owner TEXT,
    lease_until INTEGER NOT NULL DEFAULT 0 CHECK(lease_until >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(run_id, node_id, attempt)
  )`,
  `CREATE TABLE IF NOT EXISTS co_artifacts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES co_runs(id) ON DELETE CASCADE,
    node_run_id TEXT NOT NULL REFERENCES co_node_runs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN (
      'context','plan','scene','review','visual-brief','image-prompt','image','decision','result'
    )),
    content_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    dependency_ids_json TEXT NOT NULL,
    dependency_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('candidate','accepted','superseded','stale')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(node_run_id, kind, content_hash, dependency_hash)
  )`,
  `CREATE TABLE IF NOT EXISTS co_approvals (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES co_runs(id) ON DELETE CASCADE,
    node_run_id TEXT NOT NULL REFERENCES co_node_runs(id) ON DELETE CASCADE,
    artifact_ids_json TEXT NOT NULL,
    bundle_hash TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision >= 1),
    status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','stale')),
    comment TEXT NOT NULL,
    created_at TEXT NOT NULL,
    decided_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS co_token_reservations (
    node_run_id TEXT PRIMARY KEY REFERENCES co_node_runs(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES co_runs(id) ON DELETE CASCADE,
    reserved INTEGER NOT NULL CHECK(reserved >= 0),
    actual INTEGER CHECK(actual IS NULL OR actual >= 0),
    lineage_json TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'reserved'
      CHECK(state IN ('reserved','settled','unknown','overage')),
    created_at TEXT NOT NULL,
    settled_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS co_scene_adoptions (
    artifact_id TEXT PRIMARY KEY REFERENCES co_artifacts(id),
    run_id TEXT NOT NULL REFERENCES co_runs(id),
    approval_id TEXT NOT NULL REFERENCES co_approvals(id),
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS co_scene_speculations (
    parent_artifact_id TEXT PRIMARY KEY REFERENCES co_artifacts(id),
    run_id TEXT NOT NULL UNIQUE REFERENCES co_runs(id),
    context_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_co_workflows_updated ON co_workflows(updated_at DESC,id)',
  'CREATE INDEX IF NOT EXISTS idx_co_workflow_versions_version ON co_workflow_versions(workflow_id,version DESC)',
  'CREATE INDEX IF NOT EXISTS idx_co_runs_status_updated ON co_runs(status,updated_at DESC,id)',
  'CREATE INDEX IF NOT EXISTS idx_co_runs_workflow ON co_runs(workflow_id,workflow_version,created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_co_run_keys_hash ON co_run_keys(request_hash)',
  'CREATE INDEX IF NOT EXISTS idx_co_node_runs_run ON co_node_runs(run_id,created_at,id)',
  'CREATE INDEX IF NOT EXISTS idx_co_node_runs_status_lease ON co_node_runs(status,lease_until,lease_owner)',
  'CREATE INDEX IF NOT EXISTS idx_co_artifacts_node ON co_artifacts(node_run_id,created_at,id)',
  'CREATE INDEX IF NOT EXISTS idx_co_artifacts_run_status ON co_artifacts(run_id,status,created_at,id)',
  'CREATE INDEX IF NOT EXISTS idx_co_approvals_node ON co_approvals(node_run_id,status,created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_co_approvals_run ON co_approvals(run_id,status,created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_co_token_reservations_run ON co_token_reservations(run_id,state,created_at)',
  'CREATE INDEX IF NOT EXISTS idx_co_token_reservations_state ON co_token_reservations(state,created_at)',
  'CREATE INDEX IF NOT EXISTS idx_co_scene_adoptions_run ON co_scene_adoptions(run_id,created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_co_scene_adoptions_approval ON co_scene_adoptions(approval_id)',
  'CREATE INDEX IF NOT EXISTS idx_co_scene_speculation_context ON co_scene_speculations(created_at DESC)',
  `CREATE TRIGGER IF NOT EXISTS co_workflow_versions_immutable
    BEFORE UPDATE OF workflow_id,version,document_json,content_hash,created_at
    ON co_workflow_versions
    BEGIN
      SELECT RAISE(ABORT, 'creative workflow versions are immutable');
    END`,
  `CREATE TRIGGER IF NOT EXISTS co_artifacts_immutable
    BEFORE UPDATE OF run_id,node_run_id,kind,content_json,content_hash,
      dependency_ids_json,dependency_hash,created_at
    ON co_artifacts
    BEGIN
      SELECT RAISE(ABORT, 'creative artifacts are immutable');
    END`,
];
