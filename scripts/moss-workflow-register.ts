import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { readConfig } from '../apps/service/src/config.js';
import { SERVICE_DATABASE_MIGRATIONS, ServiceDatabase } from '../apps/service/src/database.js';
import { registerMossImageWorkflow } from '../apps/service/src/activities/moss-config.js';
import { buildMossImageWorkflow, MOSS_WORKFLOW_ID } from '../apps/service/src/activities/moss-workflow.js';

/**
 * MOSS-Image 工作流注册（DEV-024）。
 *
 *   node --import tsx scripts/moss-workflow-register.ts --check
 *   node --import tsx scripts/moss-workflow-register.ts --apply --confirm --engine-id <id>
 *
 * 默认只读：打印将注册的工作流摘要与现有版本数量。真实写入必须同时给出 --apply 与 --confirm，
 * 且数据库已升级到当前迁移版本；不创建预设、不改用途绑定，因此不会替换现有 Anima 路径。
 */

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string): string | null => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : null;
};

const apply = flag('--apply');
const confirm = flag('--confirm');
const engineId = value('--engine-id');
const config = readConfig();
const databasePath = config.databasePath;
const bundle = buildMossImageWorkflow();

if (!existsSync(databasePath)) {
  console.error(JSON.stringify({ error: 'database_missing', databasePath }, null, 2));
  process.exitCode = 1;
} else if (!apply) {
  const connection = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = connection.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get() as { version: number };
    const workflow = connection.prepare('SELECT id,latest_version FROM generation_workflows WHERE id=?').get(MOSS_WORKFLOW_ID) as
      { id: string; latest_version: number } | undefined;
    const engines = (connection.prepare("SELECT id,name FROM generation_engines WHERE kind='comfyui' AND enabled=1").all() as
      Array<{ id: string; name: string }>);
    console.log(JSON.stringify({ mode: 'check', databasePath, readOnly: true, schemaVersion: row.version,
      expectedSchemaVersion: SERVICE_DATABASE_MIGRATIONS.at(-1)?.version ?? 0,
      workflowId: bundle.id, workflowName: bundle.name, contentHash: bundle.contentHash,
      existingVersion: workflow?.latest_version ?? null, engines,
      note: '未写入任何数据。真实变更请使用 --apply --confirm --engine-id <id>。' }, null, 2));
  } finally { connection.close(); }
} else if (!confirm) {
  console.error(JSON.stringify({ error: 'confirmation_required', message: '真实变更必须同时给出 --apply 与 --confirm。' }, null, 2));
  process.exitCode = 1;
} else if (!engineId) {
  console.error(JSON.stringify({ error: 'engine_required', message: '必须显式给出 --engine-id。' }, null, 2));
  process.exitCode = 1;
} else {
  const expectedVersion = SERVICE_DATABASE_MIGRATIONS.at(-1)?.version ?? 0;
  const probe = new DatabaseSync(databasePath, { readOnly: true });
  let currentVersion = 0;
  try {
    const row = probe.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get() as { version: number };
    currentVersion = Number(row.version);
  } finally { probe.close(); }
  if (currentVersion !== expectedVersion) {
    console.error(JSON.stringify({ error: 'database_not_migrated',
      message: `数据库迁移版本为 ${currentVersion}，期望 ${expectedVersion}。请先备份并迁移。`, databasePath }, null, 2));
    process.exitCode = 1;
  } else {
    const database = new ServiceDatabase(databasePath);
    try {
      const result = registerMossImageWorkflow(database, engineId);
      console.log(JSON.stringify({ mode: 'apply', databasePath, result }, null, 2));
    } finally { database.close(); }
  }
}
