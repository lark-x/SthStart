import type { DatabaseMigration } from '../database.js';

/**
 * 故事世界的核心表。主代理在 database.ts 中按顺序追加这些 statement；
 * 本文件不包含 Sol 的 sw_run_steps / sw_run_calls，也不定义版本号。
 *
 * 约定：
 * - data_json 保存 contracts 中的完整公共对象，查询只使用下面显式索引列；
 * - 事件、记忆、故事线、干预允许历史 fork 保留同一业务 id，因此以
 *   (branch_id, id) 为复合主键；不同分支之间互不覆盖；
 * - 图片与采用记录只属于一个分支，不做 fork 复制。
 */
export const STORY_WORLD_MIGRATION_NAME = 'story-worlds-core';

export const STORY_WORLD_MIGRATION_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS sw_worlds (
    id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sw_branches (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES sw_worlds(id) ON DELETE CASCADE,
    parent_branch_id TEXT REFERENCES sw_branches(id) ON DELETE SET NULL,
    fork_tick INTEGER NOT NULL DEFAULT 0,
    current_tick INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL,
    source_revision INTEGER NOT NULL,
    definition_json TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sw_branch_definitions (
    branch_id TEXT NOT NULL REFERENCES sw_branches(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    effective_tick INTEGER NOT NULL,
    source_revision INTEGER NOT NULL,
    definition_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(branch_id, effective_tick, revision)
  )`,
  `CREATE TABLE IF NOT EXISTS sw_events (
    id TEXT NOT NULL,
    world_id TEXT NOT NULL,
    branch_id TEXT NOT NULL REFERENCES sw_branches(id) ON DELETE CASCADE,
    tick INTEGER NOT NULL,
    duration INTEGER NOT NULL DEFAULT 0,
    location_id TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(branch_id, id)
  )`,
  `CREATE TABLE IF NOT EXISTS sw_memories (
    id TEXT NOT NULL,
    world_id TEXT NOT NULL,
    branch_id TEXT NOT NULL REFERENCES sw_branches(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    source_event_id TEXT NOT NULL,
    learned_at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    data_json TEXT NOT NULL,
    PRIMARY KEY(branch_id, id)
  )`,
  `CREATE TABLE IF NOT EXISTS sw_story_lines (
    id TEXT NOT NULL,
    world_id TEXT NOT NULL,
    branch_id TEXT NOT NULL REFERENCES sw_branches(id) ON DELETE CASCADE,
    created_tick INTEGER NOT NULL,
    data_json TEXT NOT NULL,
    PRIMARY KEY(branch_id, id)
  )`,
  `CREATE TABLE IF NOT EXISTS sw_interventions (
    id TEXT NOT NULL,
    world_id TEXT NOT NULL,
    branch_id TEXT NOT NULL REFERENCES sw_branches(id) ON DELETE CASCADE,
    tick INTEGER NOT NULL,
    consumed INTEGER NOT NULL DEFAULT 0,
    data_json TEXT NOT NULL,
    PRIMARY KEY(branch_id, id)
  )`,
  `CREATE TABLE IF NOT EXISTS sw_images (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    branch_id TEXT NOT NULL REFERENCES sw_branches(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL,
    status TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sw_runs (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    branch_id TEXT NOT NULL REFERENCES sw_branches(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    data_json TEXT NOT NULL,
    idempotency_key TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(branch_id, idempotency_key)
  )`,
  `CREATE TABLE IF NOT EXISTS sw_adoptions (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    branch_id TEXT NOT NULL REFERENCES sw_branches(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(branch_id, idempotency_key)
  )`,
  `CREATE TABLE IF NOT EXISTS sw_actor_states (
    branch_id TEXT NOT NULL REFERENCES sw_branches(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    updated_tick INTEGER NOT NULL,
    data_json TEXT NOT NULL,
    PRIMARY KEY(branch_id, actor_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_sw_worlds_updated ON sw_worlds(updated_at DESC, id)',
  'CREATE INDEX IF NOT EXISTS idx_sw_branches_world ON sw_branches(world_id, created_at, id)',
  'CREATE INDEX IF NOT EXISTS idx_sw_branches_parent ON sw_branches(parent_branch_id, fork_tick)',
  'CREATE INDEX IF NOT EXISTS idx_sw_branch_definitions_window ON sw_branch_definitions(branch_id, effective_tick DESC, revision DESC)',
  'CREATE INDEX IF NOT EXISTS idx_sw_events_window ON sw_events(branch_id, tick, id)',
  'CREATE INDEX IF NOT EXISTS idx_sw_events_location ON sw_events(branch_id, location_id, tick)',
  'CREATE INDEX IF NOT EXISTS idx_sw_memories_actor ON sw_memories(branch_id, actor_id, learned_at, id)',
  'CREATE INDEX IF NOT EXISTS idx_sw_memories_source ON sw_memories(branch_id, source_event_id)',
  'CREATE INDEX IF NOT EXISTS idx_sw_story_lines_branch ON sw_story_lines(branch_id, created_tick, id)',
  'CREATE INDEX IF NOT EXISTS idx_sw_interventions_pending ON sw_interventions(branch_id, consumed, tick, id)',
  'CREATE INDEX IF NOT EXISTS idx_sw_images_event ON sw_images(branch_id, event_id, status, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_sw_images_status ON sw_images(branch_id, status, updated_at)',
  'CREATE INDEX IF NOT EXISTS idx_sw_runs_branch ON sw_runs(branch_id, updated_at DESC, id)',
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_sw_runs_active_branch ON sw_runs(branch_id)
    WHERE status IN ('queued','running','paused','uncertain')`,
  'CREATE INDEX IF NOT EXISTS idx_sw_adoptions_branch ON sw_adoptions(branch_id, created_at DESC, id)',
  'CREATE INDEX IF NOT EXISTS idx_sw_adoptions_project ON sw_adoptions(project_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_sw_actor_states_tick ON sw_actor_states(branch_id, updated_tick)',
];

/** 主代理决定版本号后可直接注册；statements 与上面的共享同一份 SQL。 */
export function storyWorldMigration(version: number): DatabaseMigration {
  return { version, name: STORY_WORLD_MIGRATION_NAME, statements: STORY_WORLD_MIGRATION_STATEMENTS };
}
