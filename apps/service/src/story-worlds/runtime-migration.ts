/** Append after the core story-world tables in the service's single migration. */
export const WORLD_RUNTIME_MIGRATION_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS sw_run_steps (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES sw_runs(id) ON DELETE CASCADE,
    step_key TEXT NOT NULL, from_tick INTEGER NOT NULL, to_tick INTEGER NOT NULL,
    branch_revision INTEGER NOT NULL, status TEXT NOT NULL, snapshot_json TEXT NOT NULL,
    result_json TEXT, error TEXT NOT NULL DEFAULT '',
    lease_owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(run_id,step_key)
  )`,
  `CREATE TABLE IF NOT EXISTS sw_run_calls (
    id TEXT PRIMARY KEY, step_id TEXT NOT NULL REFERENCES sw_run_steps(id) ON DELETE CASCADE,
    stage_key TEXT NOT NULL, attempt INTEGER NOT NULL CHECK(attempt IN (0,1)),
    purpose TEXT NOT NULL, status TEXT NOT NULL, request_json TEXT NOT NULL,
    response_text TEXT, ai_call_id TEXT, error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(step_id,stage_key,attempt)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_sw_steps_run ON sw_run_steps(run_id,from_tick,status)',
  'CREATE INDEX IF NOT EXISTS idx_sw_calls_step ON sw_run_calls(step_id,status)',
];

/** Follow-up migration; do not append to the already-applied version 55.
 * Existing committed results are pending. Success advances status to notified. */
export const WORLD_RUNTIME_NOTIFICATION_MIGRATION_STATEMENTS: readonly string[] = [
  'CREATE INDEX IF NOT EXISTS idx_sw_steps_notification_pending ON sw_run_steps(lease_until,created_at,id) WHERE status=\'committed\' AND result_json IS NOT NULL',
];
