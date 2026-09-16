import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readConfig } from '../apps/service/src/config.js';
import { createPortableBackup } from '../apps/service/src/portable-backup.js';

/**
 * 完整工作区恢复助手。
 *
 * 应用在服务运行时只能「准备」恢复：把已解密的文件放在隔离目录，
 * 因为正在运行的服务仍持有数据库连接，直接替换文件只会得到假成功。
 * 这个助手在服务停止后执行真正的替换，并先生成恢复前备份。
 */
export interface CloudRestorePlan {
  schemaVersion: number;
  type: string;
  restoreId: string;
  createdAt: string;
  artifactDirectory: string;
  databases: Array<{ sourcePath: string; targetPath: string; relativePath: string }>;
  artifacts: Array<{ sourcePath: string; fileName: string; artifactId: string | null }>;
  noteAssets: Array<{ sourcePath: string; fileName: string; assetId: string | null }>;
  preRestoreDirectory: string;
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function fail(message: string): never {
  console.error('恢复未执行：' + message);
  process.exit(1);
}

/** 服务仍在运行时不允许替换文件。 */
async function assertServiceStopped(healthUrl: string) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_500);
    const response = await fetch(healthUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (response.ok) fail('检测到服务仍在运行（' + healthUrl + '）。请先停止服务再执行恢复助手。');
  } catch {
    // 连不上说明服务已停止，正是我们要的状态。
  }
}

export async function applyCloudRestore(planPath: string): Promise<{ restoredDatabases: string[]; restoredArtifacts: number; preRestoreDirectory: string }> {
  if (!existsSync(planPath)) fail('找不到恢复计划文件：' + planPath);
  const plan = JSON.parse(readFileSync(planPath, 'utf8')) as CloudRestorePlan;
  if (plan.type !== 'sthstart-cloud-restore-plan') fail('恢复计划文件格式不正确。');
  const config = readConfig();
  await assertServiceStopped('http://' + config.host + ':' + config.port + '/api/v1/health');

  const preRestoreDirectory = plan.preRestoreDirectory || resolve(dirname(planPath), 'pre-restore-before-apply');
  if (!existsSync(resolve(preRestoreDirectory, 'backup-manifest.json'))) {
    // 应用准备阶段已生成恢复前备份；这里再兜底一次，保证替换前一定能回滚。
    await createPortableBackup({ config, destination: preRestoreDirectory });
  }

  const restoredDatabases: string[] = [];
  for (const database of plan.databases) {
    if (!existsSync(database.sourcePath)) fail('缺少待恢复的数据库文件：' + database.sourcePath);
    mkdirSync(dirname(database.targetPath), { recursive: true });
    for (const suffix of ['-wal', '-shm']) rmSync(database.targetPath + suffix, { force: true });
    copyFileSync(database.sourcePath, database.targetPath);
    restoredDatabases.push(database.targetPath);
  }

  mkdirSync(plan.artifactDirectory, { recursive: true });
  const pathByArtifactId = new Map<string, string>();
  const pathByAssetId = new Map<string, string>();
  let restoredArtifacts = 0;
  for (const artifact of plan.artifacts) {
    if (!existsSync(artifact.sourcePath)) fail('缺少待恢复的媒体文件：' + artifact.sourcePath);
    const targetPath = resolve(plan.artifactDirectory, artifact.fileName);
    copyFileSync(artifact.sourcePath, targetPath);
    if (artifact.artifactId) pathByArtifactId.set(artifact.artifactId, targetPath);
    restoredArtifacts += 1;
  }
  for (const asset of plan.noteAssets) {
    if (!existsSync(asset.sourcePath)) fail('缺少待恢复的笔记附件：' + asset.sourcePath);
    const targetPath = resolve(plan.artifactDirectory, asset.fileName);
    copyFileSync(asset.sourcePath, targetPath);
    if (asset.assetId) pathByAssetId.set(asset.assetId, targetPath);
    restoredArtifacts += 1;
  }

  // 重建本地路径：恢复后的数据库必须指向这台机器的媒体目录。
  const databasePath = plan.databases.find((database) => database.targetPath === config.databasePath)?.targetPath;
  if (databasePath && existsSync(databasePath)) {
    const connection = new DatabaseSync(databasePath, { readOnly: false });
    try {
      const update = (table: string, id: string, targetPath: string) => {
        connection.prepare('UPDATE ' + table + ' SET local_path=? WHERE id=?').run(targetPath, id);
      };
      for (const [id, targetPath] of pathByArtifactId) update('artifacts', id, targetPath);
      for (const [id, targetPath] of pathByAssetId) update('note_assets', id, targetPath);
      // 恢复后不让旧状态继续自动生效：定时备份默认暂停，目标要求重新验证，
      // 避免恢复回来的旧数据库向错误账号写入或清理历史（计划 §3.4）。
      const paused = connection.prepare("UPDATE backup_plans SET enabled=0,next_run_at=NULL,updated_at=? WHERE enabled=1").run(new Date().toISOString());
      const resetTargets = connection.prepare("UPDATE backup_targets SET connected=0,last_error=?,updated_at=? WHERE connected=1")
        .run('恢复工作区后需要重新验证连接与授权。', new Date().toISOString());
      const dangling = connection.prepare(
        "UPDATE backup_runs SET status='interrupted',phase='done',progress_label='恢复工作区后标记为中断',finished_at=?,updated_at=? WHERE status IN ('queued','running')",
      ).run(new Date().toISOString(), new Date().toISOString());
      console.log('已暂停 ' + Number(paused.changes) + ' 个备份计划、标记 ' + Number(resetTargets.changes) + ' 个目标需要重新验证、中断 ' + Number(dangling.changes) + ' 个未完成的运行。');
    } finally {
      connection.close();
    }
  }

  console.log('恢复完成：' + restoredDatabases.length + ' 个数据库、' + restoredArtifacts + ' 个媒体文件。');
  console.log('恢复前备份：' + preRestoreDirectory + '（如需回滚，请用便携备份恢复流程）。');
  console.log('请按平时的方式重启服务。备用文件：' + basename(planPath));
  return { restoredDatabases, restoredArtifacts, preRestoreDirectory };
}

const isDirectCli = process.argv[1] && (process.argv[1].endsWith('backup-apply-restore.ts') || process.argv[1].endsWith('backup-apply-restore.js'));
if (isDirectCli) {
  const planPath = argument('--plan');
  if (!planPath) fail('请用 --plan <恢复计划文件> 指定要执行的恢复计划。');
  if (!process.argv.includes('--confirm')) fail('这是一个破坏性操作，请加上 --confirm 明确确认。');
  if (!existsSync(planPath)) fail('找不到恢复计划文件：' + planPath);
  applyCloudRestore(planPath).catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
}
