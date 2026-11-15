/** Register separately as service migration 57; never mutate the applied 55/56. */
export const WORLD_ROUTINE_MIGRATION_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS sw_actor_plans (
    id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES sw_worlds(id) ON DELETE CASCADE,
    branch_id TEXT NOT NULL REFERENCES sw_branches(id) ON DELETE CASCADE, actor_id TEXT NOT NULL,
    source_step_id TEXT NOT NULL REFERENCES sw_run_steps(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('pending','active','invalid','completed')),
    valid_until INTEGER NOT NULL, checkpoint_tick INTEGER NOT NULL,
    invalid_reason TEXT NOT NULL DEFAULT '', data_json TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(source_step_id,actor_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_sw_actor_plan_active ON sw_actor_plans(branch_id,actor_id) WHERE status='active'`,
  'CREATE INDEX IF NOT EXISTS idx_sw_actor_plan_scope ON sw_actor_plans(world_id,branch_id,actor_id,checkpoint_tick)',
  `CREATE TABLE IF NOT EXISTS sw_step_intents (
    step_id TEXT NOT NULL REFERENCES sw_run_steps(id) ON DELETE CASCADE, actor_id TEXT NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('model','reused','background')), plan_id TEXT REFERENCES sw_actor_plans(id),
    data_json TEXT NOT NULL, PRIMARY KEY(step_id,actor_id)
  )`,
  `CREATE TABLE IF NOT EXISTS sw_memory_summaries (
    world_id TEXT NOT NULL REFERENCES sw_worlds(id) ON DELETE CASCADE,
    branch_id TEXT NOT NULL REFERENCES sw_branches(id) ON DELETE CASCADE, actor_id TEXT NOT NULL,
    at_tick INTEGER NOT NULL, valid_until INTEGER NOT NULL, fingerprint TEXT NOT NULL,
    data_json TEXT NOT NULL, rebuilds INTEGER NOT NULL DEFAULT 1, reuse_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(branch_id,actor_id)
  )`,
];
