import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { readConfig } from '../apps/service/src/config.js';
import { SERVICE_DATABASE_MIGRATIONS, ServiceDatabase } from '../apps/service/src/database.js';
import { applyParityConfig, planParityConfig } from '../apps/service/src/activities/parity-config.js';
import { PARITY_HIRES_WORKFLOW_ID } from '../apps/service/src/activities/parity-workflows.js';

/**
 * 邻舍对齐配置注册（计划 §10.3）。
 *
 *   node --import tsx scripts/activity-image-parity-config.ts --check
 *   node --import tsx scripts/activity-image-parity-config.ts --apply --confirm [--engine-id <id>]
 *
 * 默认与 --check 只读：列出将创建的工作流、版本、策略、非默认预设、画风、引擎与缺项。
 * 真实变更必须同时给出 --apply 与 --confirm，并且数据库必须已经由 db:migrate 升级到当前版本。
 */

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string): string | null => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : null;
};

const apply = flag('--apply');
const confirm = flag('--confirm');
const check = flag('--check') || !apply;
const engineId = value('--engine-id');
const config = readConfig();
const databasePath = config.databasePath;

if (!existsSync(databasePath)) {
  console.error(JSON.stringify({ error: 'database_missing', databasePath }, null, 2));
  process.exitCode = 1;
} else if (check && !apply) {
  const connection = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const plan = planParityConfig({ connection }, { hiresWorkflowId: null });
    console.log(JSON.stringify({
      mode: 'check',
      databasePath,
      readOnly: true,
      plan,
      note: '未写入任何数据。真实变更请使用 --apply --confirm，并先完成 db:check / db:backup / db:migrate。',
    }, null, 2));
    if (plan.engineIssue) process.exitCode = 1;
  } finally {
    connection.close();
  }
} else if (apply && !confirm) {
  console.error(JSON.stringify({ error: 'confirmation_required', message: '真实变更必须同时给出 --apply 与 --confirm。' }, null, 2));
  process.exitCode = 1;
} else {
  // 真实写入：先确认数据库已升级，避免脚本顺带迁移真实数据。
  const expectedVersion = SERVICE_DATABASE_MIGRATIONS.at(-1)?.version ?? 0;
  const probe = new DatabaseSync(databasePath, { readOnly: true });
  let currentVersion = 0;
  try {
    const row = probe.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get() as { version: number } | undefined;
    currentVersion = Number(row?.version ?? 0);
  } finally {
    probe.close();
  }
  if (currentVersion !== expectedVersion) {
    console.error(JSON.stringify({
      error: 'database_not_migrated',
      message: `数据库迁移版本为 ${currentVersion}，期望 ${expectedVersion}。请先按顺序执行 npm run db:check / npm run db:backup / npm run db:migrate / npm run db:check / npm run db:integrity。`,
      databasePath,
    }, null, 2));
    process.exitCode = 1;
  } else {
    const database = new ServiceDatabase(databasePath);
    try {
      const result = applyParityConfig(database, { engineId, hiresWorkflowId: null });
      console.log(JSON.stringify({ mode: 'apply', databasePath, result, hiresWorkflowId: PARITY_HIRES_WORKFLOW_ID }, null, 2));
    } finally {
      database.close();
    }
  }
}
