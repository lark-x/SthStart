import type { DatabaseMigration } from '../database.js';

export const STORY_WORLD_IMAGES_MIGRATION_NAME = 'story-worlds-images-run-submissions';

/**
 * 供主代理按需集成到数据库增量迁移（如版本 55）的语句。
 * sw_images 基础表由核心 migration.ts 创建；
 * 本迁移添加 run_id 列、索引、专门保证配图幂等锁与额度事务的 sw_image_submissions 表，
 * 以及独立的项目-分支绑定关系表 sw_project_bindings。
 */
export const STORY_WORLD_IMAGES_MIGRATION_STATEMENTS: readonly string[] = [
  `ALTER TABLE sw_images ADD COLUMN run_id TEXT`,
  `CREATE TABLE IF NOT EXISTS sw_image_submissions (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL REFERENCES sw_branches(id) ON DELETE CASCADE,
    image_id TEXT NOT NULL REFERENCES sw_images(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    run_id TEXT,
    status TEXT NOT NULL,
    task_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(branch_id, idempotency_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sw_images_run ON sw_images(branch_id, run_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_sw_image_submissions_image ON sw_image_submissions(branch_id, image_id, status)`,
  `CREATE TABLE IF NOT EXISTS sw_project_bindings (
    project_id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES sw_worlds(id) ON DELETE CASCADE,
    branch_id TEXT NOT NULL REFERENCES sw_branches(id) ON DELETE CASCADE,
    source_revision INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sw_project_bindings_branch ON sw_project_bindings(branch_id)`,
];

export function storyWorldImagesMigration(version: number): DatabaseMigration {
  return {
    version,
    name: STORY_WORLD_IMAGES_MIGRATION_NAME,
    statements: STORY_WORLD_IMAGES_MIGRATION_STATEMENTS,
  };
}
