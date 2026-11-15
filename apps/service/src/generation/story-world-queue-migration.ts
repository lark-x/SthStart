import type { DatabaseMigration } from '../database.js';

/**
 * Public image queue support for story worlds. `queue_slot_held` records that
 * a task was claimed under the shared image queue for audit/diagnostics; the
 * actual occupancy decision uses status plus `upstream_may_continue`.
 * The main agent registers this migration in database.ts; generation code can
 * run against older databases without the column (the hold is then best-effort
 * until the migration is applied).
 */
export const storyWorldQueueStatements = [
  'ALTER TABLE generation_tasks ADD COLUMN queue_slot_held INTEGER NOT NULL DEFAULT 0',
  "UPDATE generation_tasks SET queue_slot_held = 1 WHERE status IN ('submitting','accepted','running')",
  'CREATE INDEX IF NOT EXISTS idx_gen_tasks_queue_slot ON generation_tasks(queue_slot_held, status, engine_id)',
  'CREATE INDEX IF NOT EXISTS idx_gen_tasks_queue_fair ON generation_tasks(status, priority, created_at, id)',
] as const;

export function createStoryWorldQueueMigration(version: number): DatabaseMigration {
  return { version, name: 'generation-public-image-queue-slots', statements: storyWorldQueueStatements };
}
