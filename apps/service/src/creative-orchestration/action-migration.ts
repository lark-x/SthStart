/** Migration exports only; the root migration registration creates this table. */
export const CREATIVE_ACTION_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS co_action_adoptions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES co_runs(id) ON DELETE CASCADE,
    artifact_id TEXT NOT NULL REFERENCES co_artifacts(id),
    approval_id TEXT NOT NULL REFERENCES co_approvals(id),
    action_index INTEGER NOT NULL CHECK(action_index >= 0),
    tool TEXT NOT NULL,
    preview_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('applied')),
    request_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(run_id,artifact_id,action_index)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_co_action_adoptions_run ON co_action_adoptions(run_id,created_at DESC,id)',
  'CREATE INDEX IF NOT EXISTS idx_co_action_adoptions_artifact ON co_action_adoptions(artifact_id)',
];
