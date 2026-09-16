import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { BackupRestore, BackupRun } from '@sthstart/contracts';
import { createService } from './server.js';
import { ServiceDatabase } from './database.js';
import { NarrativeDatabase } from './narrative-database.js';
import { readConfig, type ServiceConfig } from './config.js';
import { SecretStore } from './security.js';
import { nextBackupRun } from './backup/scheduler.js';
import { parseManifest } from './backup/manifest.js';

const adminToken = 'admin-backup-cloud-token-1234567';
const adminHeaders = { 'x-sthstart-admin-token': adminToken };

class MemorySecrets extends SecretStore {
  readonly values = new Map<string, string>();
  override async status() { return { available: true, backend: 'memory', envFallback: false }; }
  override async get(account: string) {
    const value = this.values.get(account);
    return value === undefined ? { value: null, source: 'none' as const } : { value, source: 'keyring' as const };
  }
  override async set(account: string, value: string) { this.values.set(account, value); }
  override async delete(account: string) { this.values.delete(account); }
}

interface Harness {
  app: FastifyInstance;
  database: ServiceDatabase;
  config: ServiceConfig;
  artifactDirectory: string;
  targetDirectory: string;
  root: string;
  close: () => Promise<void>;
}

async function harness(label: string): Promise<Harness> {
  const root = resolve(tmpdir(), 'sthstart-backup-' + label + '-' + randomUUID());
  const artifactDirectory = resolve(root, 'artifacts');
  const logDirectory = resolve(root, 'logs');
  const targetDirectory = resolve(root, 'remote');
  mkdirSync(artifactDirectory, { recursive: true });
  mkdirSync(logDirectory, { recursive: true });
  const databasePath = resolve(root, 'sthstart.db');
  const narrativePath = resolve(root, 'narrative.db');
  const database = new ServiceDatabase(databasePath);
  const narrativeDatabase = new NarrativeDatabase(narrativePath);
  const config = readConfig({
    ...process.env,
    STHSTART_ADMIN_TOKEN: adminToken,
    STHSTART_ARTIFACT_DIR: artifactDirectory,
    STHSTART_DATABASE_PATH: databasePath,
    STHSTART_NARRATIVE_DATABASE_PATH: narrativePath,
    STHSTART_LOG_DIR: logDirectory,
    STHSTART_PORT: '4311',
  });
  const { app } = await createService({ config, database, narrativeDatabase, secrets: new MemorySecrets() });
  return { app, database, config, artifactDirectory, targetDirectory, root, close: () => app.close() };
}

function nowIso() {
  return new Date().toISOString();
}

/** 造一个媒体文件并登记为资源，模拟生图/活动媒体。 */
function seedMedia(database: ServiceDatabase, artifactDirectory: string, content: Buffer) {
  const artifactId = randomUUID();
  const filePath = resolve(artifactDirectory, artifactId + '.png');
  writeFileSync(filePath, content);
  const sha256 = createHash('sha256').update(content).digest('hex');
  database.connection.prepare(
    'INSERT INTO artifacts (id,app_id,local_path,content_type,byte_size,pinned,created_at,sha256,file_status) VALUES (?,?,?,?,?,0,?,?,?)',
  ).run(artifactId, 'linshe', filePath, 'image/png', content.length, nowIso(), sha256, 'ready');
  database.connection.prepare(
    'INSERT INTO artifact_references (id,artifact_id,app_id,ref_type,ref_id,created_at) VALUES (?,?,?,?,?,?)',
  ).run(randomUUID(), artifactId, 'linshe', 'activity_media', 'demo-activity', nowIso());
  return { artifactId, filePath };
}

/** 造一篇资料（含来源与附件），覆盖资料范围的备份与导入。 */
function seedNote(database: ServiceDatabase, artifactDirectory: string) {
  const noteId = randomUUID();
  const now = nowIso();
  database.connection.prepare(
    'INSERT INTO creative_notes (id,title,kind,summary,content_json,tags_json,stage,favorite,created_at,updated_at) VALUES (?,?,?,?,?,?,?,0,?,?)',
  ).run(noteId, '往生堂客卿记录', 'note', '关于钟离的资料', JSON.stringify([{ type: 'paragraph', text: '钟离是往生堂的客卿。' }]), JSON.stringify(['璃月']), 'reference', now, now);
  database.connection.prepare(
    'INSERT INTO knowledge_sources (id,kind,provider_id,work,external_key,url,title,source_name,nature,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run('source-backup-1', 'manual', null, '原神', null, null, '游戏内对话', '官方', 'canon', now, now);
  database.connection.prepare(
    'INSERT INTO note_knowledge (note_id,nature,authorship,usage,category,works_json,characters_json,locations_json,sources_json,origin_json,content_hash,content_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(noteId, 'canon', 'handwritten', 'record', null, JSON.stringify(['原神']), JSON.stringify(['钟离']), JSON.stringify(['璃月港']), JSON.stringify(['source-backup-1']), null, 'hash-backup-1', 1, now, now);
  const assetPath = resolve(artifactDirectory, 'note-asset-' + randomUUID() + '.txt');
  writeFileSync(assetPath, '附件正文内容');
  const assetId = randomUUID();
  database.connection.prepare(
    'INSERT INTO note_assets (id,note_id,local_path,content_type,byte_size,original_name,created_at) VALUES (?,?,?,?,?,?,?)',
  ).run(assetId, noteId, assetPath, 'text/plain', Buffer.byteLength('附件正文内容'), '附件.txt', now);
  return { noteId, assetId, assetPath };
}

async function createVault(app: FastifyInstance, password: string) {
  const response = await app.inject({
    method: 'POST', url: '/api/v1/admin/backups/vault', headers: adminHeaders,
    payload: { password, generateRecoveryKey: true },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as { vault: { id: string }; recoveryKey: string };
}

async function createTarget(app: FastifyInstance, input: { label: string; directory: string; rootPath?: string }) {
  const response = await app.inject({
    method: 'POST', url: '/api/v1/admin/backups/targets', headers: adminHeaders,
    payload: { kind: 'local_test', accountLabel: input.label, rootPath: input.rootPath ?? 'SthStart', localDirectory: input.directory },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().target as { id: string };
}

async function waitForRun(app: FastifyInstance, runId: string, timeoutMs = 60_000): Promise<BackupRun> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/backups/runs/' + runId, headers: adminHeaders });
    const run = response.json().run as BackupRun;
    if (run.status !== 'queued' && run.status !== 'running' && run.phase !== 'waiting_unlock') return run;
    if (Date.now() > deadline) throw new Error('等待备份结束超时：' + JSON.stringify(run));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
}

async function startRun(app: FastifyInstance, payload: Record<string, unknown>): Promise<BackupRun> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/admin/backups/runs', headers: adminHeaders, payload });
  assert.equal(response.statusCode, 200, response.body);
  const runId = String(response.json().run.id);
  return waitForRun(app, runId);
}

function objectFiles(targetDirectory: string, vaultId: string): string[] {
  const directory = resolve(targetDirectory, 'SthStart', vaultId, 'objects');
  return existsSync(directory) ? readdirSync(directory) : [];
}

async function waitForRestore(app: FastifyInstance, restoreId: string, timeoutMs = 60_000): Promise<BackupRestore> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/backups/restores/' + restoreId, headers: adminHeaders });
    const restore = response.json().restore as BackupRestore;
    if (restore.status !== 'queued' && restore.status !== 'running') return restore;
    if (Date.now() > deadline) throw new Error('等待恢复结束超时：' + JSON.stringify(restore));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
}

test('云备份：多目标部分完成、只重试失败目标与跨目标保留清理', async () => {
  const context = await harness('partial');
  try {
    const created = await createVault(context.app, 'my-secret-password-2');
    const good = await createTarget(context.app, { label: '正常网盘', directory: context.targetDirectory });
    // 用「父路径是一个文件」模拟目标网盘不可用：不是逻辑模拟，而是真实的 IO 失败。
    const blockedPath = resolve(context.root, 'blocked');
    writeFileSync(blockedPath, 'not a directory');
    const blocked = await createTarget(context.app, { label: '不可用网盘', directory: resolve(blockedPath, 'sub') });
    seedMedia(context.database, context.artifactDirectory, Buffer.from('共享媒体内容'));

    const run = await startRun(context.app, {});
    assert.equal(run.status, 'partial', JSON.stringify(run.targets));
    assert.equal(run.targets.length, 2);
    assert.equal(run.targets.find((target) => target.targetId === good.id)!.manifestPublished, true, '成功的目标应发布清单');
    const failedTarget = run.targets.find((target) => target.targetId === blocked.id)!;
    assert.equal(failedTarget.state, 'failed');
    assert.ok(failedTarget.errorCode, '失败目标必须记录结构化错误码');

    // 修好目标后重试：只处理失败目标，并且复用原快照。
    rmSync(blockedPath, { force: true });
    mkdirSync(resolve(blockedPath, 'sub'), { recursive: true });
    const retryResponse = await context.app.inject({ method: 'POST', url: '/api/v1/admin/backups/runs/' + run.id + '/retry', headers: adminHeaders });
    assert.equal(retryResponse.statusCode, 200, retryResponse.body);
    const retryRun = await waitForRun(context.app, String(retryResponse.json().run.id));
    assert.equal(retryRun.status, 'succeeded', JSON.stringify(retryRun.targets));
    assert.equal(retryRun.snapshotId, run.snapshotId, '重试必须继续使用原快照');
    assert.equal(retryRun.targets.find((target) => target.targetId === blocked.id)!.manifestPublished, true);

    // 再补两次备份，让两个目标上各有三个版本。
    assert.equal((await startRun(context.app, {})).status, 'succeeded');
    assert.equal((await startRun(context.app, {})).status, 'succeeded');

    const previewResponse = await context.app.inject({
      method: 'GET', url: '/api/v1/admin/backups/cleanup-preview?targetId=' + good.id + '&retainCount=1', headers: adminHeaders,
    });
    assert.equal(previewResponse.statusCode, 200, previewResponse.body);
    const preview = previewResponse.json().preview as { removableSnapshotIds: string[]; deletableObjectCount: number; notice: string };
    assert.equal(preview.removableSnapshotIds.length, 2, '保留最近 1 次，其余 2 个版本可以淘汰');
    // 另一个目标仍在引用这些对象：不能删除，否则那边已发布的清单会失效。
    assert.equal(preview.deletableObjectCount, 0);
    assert.match(preview.notice, /其它目标/);

    const objectsBefore = objectFiles(context.targetDirectory, created.vault.id).length;
    const cleanupResponse = await context.app.inject({ method: 'POST', url: '/api/v1/admin/backups/cleanup', headers: adminHeaders, payload: { targetId: good.id, retainCount: 1 } });
    assert.equal(cleanupResponse.statusCode, 200, cleanupResponse.body);
    const result = cleanupResponse.json().result as { expiredSnapshotIds: string[]; deletedObjectCount: number; physicalDelete: boolean };
    assert.equal(result.expiredSnapshotIds.length, 2);
    assert.equal(result.deletedObjectCount, 0, '被其它目标引用的对象不能删除');
    assert.equal(result.physicalDelete, true);
    assert.equal(objectFiles(context.targetDirectory, created.vault.id).length, objectsBefore, '对象文件不应减少');

    const versionOne = await context.app.inject({ method: 'GET', url: '/api/v1/admin/backups/snapshots/' + run.snapshotId, headers: adminHeaders });
    const remaining = versionOne.json().targets as Array<{ targetId: string; manifestPublished: boolean }>;
    assert.ok(remaining.some((target) => target.targetId === blocked.id && target.manifestPublished), '另一个目标的版本不受影响');
    assert.ok(!remaining.some((target) => target.targetId === good.id && target.manifestPublished), '淘汰的版本在该目标上退出可恢复集合');
  } finally {
    await context.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test('云备份：资料范围只含所选资料，导入不夹带完整数据库且重复导入会跳过', async () => {
  const context = await harness('knowledge');
  try {
    await createVault(context.app, 'my-secret-password-3');
    const target = await createTarget(context.app, { label: '资料网盘', directory: context.targetDirectory });
    const seeded = seedNote(context.database, context.artifactDirectory);

    const run = await startRun(context.app, { scope: 'knowledge' });
    assert.equal(run.status, 'succeeded', JSON.stringify(run.targets));
    // 资料逻辑包 + 笔记附件；不带整个业务数据库。
    assert.equal(run.objectCount, 2, '资料范围只应包含逻辑包与附件');

    const previewResponse = await context.app.inject({
      method: 'GET', url: '/api/v1/admin/backups/restore-preview?snapshotId=' + run.snapshotId + '&targetId=' + target.id, headers: adminHeaders,
    });
    const preview = previewResponse.json().preview as { knowledgeNoteCount: number; characterCount: number; mediaCount: number };
    assert.equal(preview.knowledgeNoteCount, 1);
    assert.equal(preview.characterCount, 1);
    assert.equal(preview.mediaCount, 1);

    // 模拟资料丢失：删掉笔记（资料元数据随之级联删除）。
    context.database.connection.prepare('DELETE FROM creative_notes WHERE id=?').run(seeded.noteId);
    assert.equal(context.database.connection.prepare('SELECT COUNT(*) AS count FROM note_knowledge').get()!.count, 0);

    const restoreResponse = await context.app.inject({
      method: 'POST', url: '/api/v1/admin/backups/restores', headers: adminHeaders,
      payload: { snapshotId: run.snapshotId, targetId: target.id, mode: 'knowledge_import' },
    });
    assert.equal(restoreResponse.statusCode, 200, restoreResponse.body);
    const restore = await waitForRestore(context.app, String(restoreResponse.json().restore.id));
    assert.equal(restore.status, 'succeeded', JSON.stringify(restore));
    const restoredNote = context.database.connection.prepare('SELECT id,title FROM creative_notes WHERE title=?').get('往生堂客卿记录') as { id: string } | undefined;
    assert.ok(restoredNote, '资料应被重新导入');
    // 来源引用要按新的映射改写，不能断链。
    const meta = context.database.connection.prepare('SELECT sources_json FROM note_knowledge WHERE note_id=?').get(restoredNote!.id) as { sources_json: string };
    const sources = JSON.parse(meta.sources_json) as string[];
    assert.equal(sources.length, 1);
    assert.ok(context.database.connection.prepare('SELECT id FROM knowledge_sources WHERE id=?').get(sources[0]), '导入的来源必须存在');
    const asset = context.database.connection.prepare('SELECT local_path FROM note_assets WHERE note_id=?').get(restoredNote!.id) as { local_path: string } | undefined;
    assert.ok(asset && existsSync(asset.local_path), '附件文件必须写回本机媒体目录');

    // 重复导入要识别并跳过，不产生第二份相同资料。
    const again = await context.app.inject({
      method: 'POST', url: '/api/v1/admin/backups/restores', headers: adminHeaders,
      payload: { snapshotId: run.snapshotId, targetId: target.id, mode: 'knowledge_import' },
    });
    const secondRestore = await waitForRestore(context.app, String(again.json().restore.id));
    assert.equal(secondRestore.status, 'succeeded');
    assert.match(String(secondRestore.progressLabel), /跳过重复 1 篇/);
    assert.equal(context.database.connection.prepare('SELECT COUNT(*) AS count FROM creative_notes WHERE title=?').get('往生堂客卿记录')!.count, 1);
  } finally {
    await context.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test('云备份：活动范围导出为工程包并恢复为新活动副本', async () => {
  const context = await harness('activity');
  try {
    await createVault(context.app, 'my-secret-password-4');
    const target = await createTarget(context.app, { label: '活动网盘', directory: context.targetDirectory });
    const activityResponse = await context.app.inject({
      method: 'POST', url: '/api/v1/admin/activities', headers: adminHeaders,
      payload: { title: '备份验证活动', type: '聚会', theme: '温馨', location: '璃月港' },
    });
    assert.ok(activityResponse.statusCode < 300, activityResponse.body);
    const activityId = String(activityResponse.json().activity.id);

    const run = await startRun(context.app, { scope: 'activities', activityIds: [activityId] });
    assert.equal(run.status, 'succeeded', JSON.stringify(run.targets));
    // 工程包与工程内媒体分别入对象仓库，不夹带整个业务数据库。
    assert.ok(run.objectCount >= 1);

    const previewResponse = await context.app.inject({
      method: 'GET', url: '/api/v1/admin/backups/restore-preview?snapshotId=' + run.snapshotId + '&targetId=' + target.id, headers: adminHeaders,
    });
    const preview = previewResponse.json().preview as { activities: Array<{ id: string; title: string }> };
    assert.equal(preview.activities.length, 1);
    assert.equal(preview.activities[0].title, '备份验证活动');
    assert.equal(preview.activities[0].id, activityId);

    const restoreResponse = await context.app.inject({
      method: 'POST', url: '/api/v1/admin/backups/restores', headers: adminHeaders,
      payload: { snapshotId: run.snapshotId, targetId: target.id, mode: 'activity_copy' },
    });
    assert.equal(restoreResponse.statusCode, 200, restoreResponse.body);
    const restore = await waitForRestore(context.app, String(restoreResponse.json().restore.id));
    assert.equal(restore.status, 'succeeded', JSON.stringify(restore));
    // 默认导入为副本：原活动保留，总数变成 2。
    const total = context.database.connection.prepare('SELECT COUNT(*) AS count FROM activities').get()!.count;
    assert.equal(Number(total), 2, '活动恢复默认新建副本，不覆盖原活动');
  } finally {
    await context.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test('云备份：完整工作区恢复需要确认，且只做可回滚的准备', async () => {
  const context = await harness('workspace-replace');
  try {
    await createVault(context.app, 'my-secret-password-5');
    const target = await createTarget(context.app, { label: '工作区网盘', directory: context.targetDirectory });
    seedMedia(context.database, context.artifactDirectory, Buffer.from('工作区媒体'));
    const run = await startRun(context.app, {});
    assert.equal(run.status, 'succeeded');

    const unconfirmed = await context.app.inject({
      method: 'POST', url: '/api/v1/admin/backups/restores', headers: adminHeaders,
      payload: { snapshotId: run.snapshotId, targetId: target.id, mode: 'workspace_replace' },
    });
    assert.equal(unconfirmed.statusCode, 400);
    assert.match(unconfirmed.body, /确认/);

    const restoreResponse = await context.app.inject({
      method: 'POST', url: '/api/v1/admin/backups/restores', headers: adminHeaders,
      payload: { snapshotId: run.snapshotId, targetId: target.id, mode: 'workspace_replace', confirm: true },
    });
    assert.equal(restoreResponse.statusCode, 200, restoreResponse.body);
    const restore = await waitForRestore(context.app, String(restoreResponse.json().restore.id));
    // 不能显示成「已恢复成功」：替换需要停止服务后由助手完成。
    assert.equal(restore.status, 'partial');
    assert.match(String(restore.progressLabel), /backup:apply-restore/);
    assert.ok(restore.preRestoreBackupPath, '必须先生成恢复前备份');
    assert.ok(existsSync(resolve(String(restore.preRestoreBackupPath), 'backup-manifest.json')), '恢复前备份必须可用');
    const planPath = resolve(context.root, 'backups', 'restore', restore.id, 'workspace', 'apply-restore.json');
    assert.ok(existsSync(planPath), '应生成可供恢复助手执行的计划文件');
    const plan = JSON.parse(readFileSync(planPath, 'utf8')) as { type: string; databases: unknown[]; artifacts: unknown[] };
    assert.equal(plan.type, 'sthstart-cloud-restore-plan');
    assert.equal(plan.databases.length, 2);
    assert.ok(plan.artifacts.length >= 1);
  } finally {
    await context.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test('云备份：调度按用户时区计算，未解锁不写明文而是等待解锁', async () => {
  const from = new Date('2026-09-16T00:00:00.000Z');
  const daily = nextBackupRun(from, { frequency: 'daily', dailyTime: '03:00', timezone: 'Asia/Shanghai' });
  assert.ok(daily, '每天频率必须给出下一次时间');
  assert.equal(new Date(String(daily)).toISOString(), '2026-09-16T19:00:00.000Z', '东八区 03:00 对应 UTC 19:00');
  const weekly = nextBackupRun(from, { frequency: 'weekly', dailyTime: '03:00', timezone: 'Asia/Shanghai', weekday: 5 });
  assert.ok(weekly);
  // 2026-09-16 是周三，下一个周五是 09-18；东八区 03:00 即 09-17T19:00Z。
  assert.equal(new Date(String(weekly)).toISOString(), '2026-09-17T19:00:00.000Z', '周五 03:00 的东八区时间');
  assert.equal(nextBackupRun(from, { frequency: 'manual', dailyTime: '03:00', timezone: 'Asia/Shanghai' }), null);

  const context = await harness('scheduler');
  try {
    await createVault(context.app, 'my-secret-password-6');
    await createTarget(context.app, { label: '定时网盘', directory: context.targetDirectory });
    seedMedia(context.database, context.artifactDirectory, Buffer.from('定时备份媒体'));
    const planResponse = await context.app.inject({
      method: 'POST', url: '/api/v1/admin/backups/plans', headers: adminHeaders,
      payload: { name: '每天备份', scope: 'workspace', frequency: 'daily', dailyTime: '03:00', timezone: 'Asia/Shanghai', retainCount: 3 },
    });
    assert.equal(planResponse.statusCode, 200, planResponse.body);
    const plan = planResponse.json().plan as { id: string; nextRunAt?: string };
    assert.ok(plan.nextRunAt, '保存计划后应计算下一次执行时间');

    // 锁定后执行：不能改用明文，也不能生成失败记录。
    await context.app.inject({ method: 'POST', url: '/api/v1/admin/backups/vault/lock', headers: adminHeaders });
    const lockedRun = await context.app.inject({ method: 'POST', url: '/api/v1/admin/backups/plans/' + plan.id + '/run', headers: adminHeaders });
    assert.equal(lockedRun.statusCode, 409);
    assert.match(lockedRun.body, /解锁/);

    // 解锁后补做一次。
    const unlocked = await context.app.inject({ method: 'POST', url: '/api/v1/admin/backups/vault/unlock', headers: adminHeaders, payload: { password: 'my-secret-password-6' } });
    assert.equal(unlocked.statusCode, 200, unlocked.body);
    const afterUnlock = await startRun(context.app, { planId: plan.id });
    assert.equal(afterUnlock.status, 'succeeded', JSON.stringify(afterUnlock.targets));

    // 任务中心能看到备份任务，且不把等待解锁当成失败。
    const tasks = await context.app.inject({ method: 'GET', url: '/api/v1/admin/tasks?domain=backup', headers: adminHeaders });
    assert.equal(tasks.statusCode, 200, tasks.body);
    const items = tasks.json().items as Array<{ domain: string; displayState: string }>;
    assert.ok(items.length >= 1);
    assert.equal(items[0].domain, 'backup');
    assert.ok(!['failed'].includes(items[0].displayState));
  } finally {
    await context.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test('云备份：换机只凭远端仓库与解锁材料找回版本，并能补传到新目标', async () => {
  const deviceA = await harness('device-a');
  let deviceB: Harness | null = null;
  try {
    // 设备 A：创建仓库、连接一个网盘、备份一份资料。
    const created = await createVault(deviceA.app, 'my-secret-password-7');
    const targetA = await createTarget(deviceA.app, { label: '共享网盘', directory: deviceA.targetDirectory });
    seedNote(deviceA.database, deviceA.artifactDirectory);
    const run = await startRun(deviceA.app, { scope: 'knowledge' });
    assert.equal(run.status, 'succeeded', JSON.stringify(run.targets));

    // 设备 B：全新的数据目录，没有任何本地索引。
    deviceB = await harness('device-b');
    assert.equal(Number(deviceB.database.connection.prepare('SELECT COUNT(*) AS count FROM creative_notes').get()!.count), 0);
    // 先建目标会被拒绝：目标必须引用一个已存在的仓库。
    const premature = await deviceB.app.inject({
      method: 'POST', url: '/api/v1/admin/backups/targets', headers: adminHeaders,
      payload: { kind: 'local_test', accountLabel: '共享网盘', rootPath: 'SthStart', localDirectory: deviceA.targetDirectory },
    });
    assert.equal(premature.statusCode, 400);

    // 用「网盘类型 + 目录 + 远端仓库 ID」连接已有仓库，本机随后可解锁。
    const connected = await deviceB.app.inject({
      method: 'POST', url: '/api/v1/admin/backups/vault/connect-remote', headers: adminHeaders,
      payload: { kind: 'local_test', rootPath: 'SthStart', localDirectory: deviceA.targetDirectory, vaultId: created.vault.id, import: true },
    });
    assert.equal(connected.statusCode, 200, connected.body);
    assert.equal(connected.json().remoteVault.id, created.vault.id);
    const targetB = String(connected.json().targetId);

    // 锁定状态下不能登记远端版本，也不会写出任何明文。
    // （解锁状态是进程内的：测试里两个「设备」共享同一进程，因此这里显式锁定。）
    await deviceB.app.inject({ method: 'POST', url: '/api/v1/admin/backups/vault/lock', headers: adminHeaders });
    const locked = await deviceB.app.inject({
      method: 'POST', url: '/api/v1/admin/backups/snapshots/adopt', headers: adminHeaders,
      payload: { targetId: targetB, snapshotId: run.snapshotId },
    });
    assert.equal(locked.statusCode, 409);

    const unlocked = await deviceB.app.inject({
      method: 'POST', url: '/api/v1/admin/backups/vault/unlock', headers: adminHeaders,
      payload: { password: 'my-secret-password-7' },
    });
    assert.equal(unlocked.statusCode, 200, unlocked.body);

    // 只凭远端清单文件名就能列出可恢复版本。
    const listed = await deviceB.app.inject({
      method: 'GET', url: '/api/v1/admin/backups/snapshots/remote?targetId=' + targetB, headers: adminHeaders,
    });
    assert.equal(listed.statusCode, 200, listed.body);
    const items = listed.json().items as Array<{ snapshotId: string; adopted: boolean }>;
    assert.ok(items.some((item) => item.snapshotId === run.snapshotId && !item.adopted), '应列出未登记的远端版本');

    const adopted = await deviceB.app.inject({
      method: 'POST', url: '/api/v1/admin/backups/snapshots/adopt', headers: adminHeaders,
      payload: { targetId: targetB, snapshotId: run.snapshotId },
    });
    assert.equal(adopted.statusCode, 200, adopted.body);
    assert.equal(adopted.json().result.adopted, true);
    assert.equal(adopted.json().snapshot.missingCount, 0);

    // 登记后可以直接恢复内容：资料与附件都要落到这台机器的媒体目录。
    const restoreResponse = await deviceB.app.inject({
      method: 'POST', url: '/api/v1/admin/backups/restores', headers: adminHeaders,
      payload: { snapshotId: run.snapshotId, targetId: targetB, mode: 'knowledge_import' },
    });
    assert.equal(restoreResponse.statusCode, 200, restoreResponse.body);
    const restore = await waitForRestore(deviceB.app, String(restoreResponse.json().restore.id));
    assert.equal(restore.status, 'succeeded', JSON.stringify(restore));
    const restored = deviceB.database.connection.prepare('SELECT id,title FROM creative_notes').get() as { id: string; title: string } | undefined;
    assert.equal(restored?.title, '往生堂客卿记录');
    const asset = deviceB.database.connection.prepare('SELECT local_path FROM note_assets').get() as { local_path: string } | undefined;
    assert.ok(asset && asset.local_path.startsWith(deviceB.artifactDirectory), '附件必须写回本机媒体目录：' + asset?.local_path);
    assert.ok(existsSync(asset!.local_path));

    // 设备 A 新增一个目标后，可以把同一个版本补传过去（不重新捕获工作区）。
    const extraDirectory = resolve(deviceA.root, 'remote-extra');
    const targetC = await createTarget(deviceA.app, { label: '第二网盘', directory: extraDirectory });
    const replicated = await deviceA.app.inject({
      method: 'POST', url: '/api/v1/admin/backups/snapshots/' + run.snapshotId + '/replicate', headers: adminHeaders,
      payload: { targetIds: [targetC.id] },
    });
    assert.equal(replicated.statusCode, 200, replicated.body);
    const replicatedRun = await waitForRun(deviceA.app, String(replicated.json().run.id));
    assert.equal(replicatedRun.status, 'succeeded', JSON.stringify(replicatedRun.targets));
    assert.equal(replicatedRun.snapshotId, run.snapshotId, '补传必须复用原快照');
    const snapshotAfter = await deviceA.app.inject({ method: 'GET', url: '/api/v1/admin/backups/snapshots/' + run.snapshotId, headers: adminHeaders });
    const published = snapshotAfter.json().snapshot.publishedTargetIds as string[];
    assert.ok(published.includes(targetA.id) && published.includes(targetC.id), '两个目标上都应可恢复');
  } finally {
    if (deviceB) { await deviceB.close(); rmSync(deviceB.root, { recursive: true, force: true }); }
    await deviceA.close();
    rmSync(deviceA.root, { recursive: true, force: true });
  }
});

test('云备份：淘汰早期版本后最新版本仍可恢复，共享媒体对象不被误删', async () => {
  const context = await harness('cleanup-single');
  try {
    const created = await createVault(context.app, 'my-secret-password-8');
    const target = await createTarget(context.app, { label: '唯一目标', directory: context.targetDirectory });
    seedMedia(context.database, context.artifactDirectory, Buffer.from('三个版本共享的媒体'));

    const first = await startRun(context.app, {});
    const second = await startRun(context.app, {});
    const third = await startRun(context.app, {});
    assert.equal(first.status, 'succeeded');
    assert.equal(second.status, 'succeeded');
    assert.equal(third.status, 'succeeded');
    assert.notEqual(first.snapshotId, third.snapshotId, '每次备份应产生新的版本');

    const previewResponse = await context.app.inject({
      method: 'GET', url: '/api/v1/admin/backups/cleanup-preview?targetId=' + target.id + '&retainCount=1', headers: adminHeaders,
    });
    const preview = previewResponse.json().preview as { removableSnapshotIds: string[]; deletableObjectCount: number };
    assert.equal(preview.removableSnapshotIds.length, 2);
    assert.ok(preview.removableSnapshotIds.includes(first.snapshotId!));
    assert.ok(preview.removableSnapshotIds.includes(second.snapshotId!));
    assert.ok(!preview.removableSnapshotIds.includes(third.snapshotId!), '最新版本不能被淘汰');
    // 早期版本的数据库快照只被自己引用，属于独占对象；共享媒体仍被最新版本引用。
    assert.ok(preview.deletableObjectCount > 0, '早期版本的独占对象应可删除');

    const objectsBefore = objectFiles(context.targetDirectory, created.vault.id).length;
    const cleanupResponse = await context.app.inject({
      method: 'POST', url: '/api/v1/admin/backups/cleanup', headers: adminHeaders,
      payload: { targetId: target.id, retainCount: 1 },
    });
    assert.equal(cleanupResponse.statusCode, 200, cleanupResponse.body);
    const result = cleanupResponse.json().result as { deletedObjectCount: number; reclaimedBytes: number; physicalDelete: boolean };
    assert.equal(result.physicalDelete, true);
    assert.equal(result.deletedObjectCount, preview.deletableObjectCount);
    assert.ok(result.reclaimedBytes > 0);
    const objectsAfter = objectFiles(context.targetDirectory, created.vault.id).length;
    assert.equal(objectsAfter, objectsBefore - result.deletedObjectCount, '只删除独占对象');

    // 最新版本仍然可恢复，而且还能读出共享媒体。
    const recoverable = await context.app.inject({ method: 'GET', url: '/api/v1/admin/backups/snapshots', headers: adminHeaders });
    const recoverableIds = (recoverable.json().recoverable as Array<{ id: string }>).map((item) => item.id);
    assert.ok(recoverableIds.includes(third.snapshotId!), '最新版本必须仍在可恢复列表');
    assert.ok(!recoverableIds.includes(first.snapshotId!), '被淘汰的版本退出可恢复列表');
    const restorePreview = await context.app.inject({
      method: 'GET', url: '/api/v1/admin/backups/restore-preview?snapshotId=' + third.snapshotId + '&targetId=' + target.id, headers: adminHeaders,
    });
    assert.equal(restorePreview.statusCode, 200, restorePreview.body);
    assert.equal((restorePreview.json().preview as { mediaCount: number }).mediaCount, 1);

    // 清理之后再做一次备份，共享媒体仍然可以复用（说明它的密文与索引都还在）。
    const fourth = await startRun(context.app, {});
    assert.ok(fourth.reusedObjectCount >= 1, '清理不应破坏仍然被引用的对象');
  } finally {
    await context.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test('云备份：一致快照、增量复用与远端不暴露明文', async () => {
  const context = await harness('workspace');
  try {
    const created = await createVault(context.app, 'my-secret-password-1');
    assert.match(created.recoveryKey, /^[A-Z0-9]{5}(-[A-Z0-9]{5})+$/, '恢复密钥应是分组可抄写的高熵字符串');
    assert.ok(!JSON.stringify(created.vault).includes('my-secret-password-1'), '仓库头不能包含密码明文');
    assert.ok(!JSON.stringify(created.vault).includes(created.recoveryKey), '仓库头不能包含恢复密钥明文');
    const target = await createTarget(context.app, { label: '本地测试网盘', directory: context.targetDirectory });

    seedMedia(context.database, context.artifactDirectory, Buffer.from('第一张参考图'));
    seedMedia(context.database, context.artifactDirectory, Buffer.from('第二张参考图'));
    seedNote(context.database, context.artifactDirectory);

    const run = await startRun(context.app, {});
    assert.equal(run.status, 'succeeded', JSON.stringify(run));
    assert.ok(run.snapshotId, '完成的运行应记录快照 ID');
    assert.equal(run.targets.length, 1);
    assert.equal(run.targets[0].manifestPublished, true);
    assert.equal(run.objectCount, 3 + 2, '3 个媒体/附件 + 2 个数据库快照');
    assert.equal(run.reusedObjectCount, 0);

    const objects = objectFiles(context.targetDirectory, created.vault.id);
    const snapshots = readdirSync(resolve(context.targetDirectory, 'SthStart', created.vault.id, 'snapshots'));
    assert.equal(snapshots.length, 1);
    // 远端对象名是不透明键：不能出现原始文件名或明文内容 hash。
    for (const name of objects) assert.match(name, /^[0-9a-f]{40}\.bin$/);
    // 密文里不能出现明文正文。
    const cipher = readFileSync(resolve(context.targetDirectory, 'SthStart', created.vault.id, 'snapshots', snapshots[0]));
    assert.ok(!cipher.includes(Buffer.from('往生堂', 'utf8')), '密文里不能出现资料正文');
    assert.ok(!cipher.includes(Buffer.from('钟离', 'utf8')));

    // 恢复预览能读出活动/资料数量与缺省项，且不修改当前数据。
    const preview = await context.app.inject({
      method: 'GET',
      url: '/api/v1/admin/backups/restore-preview?snapshotId=' + run.snapshotId + '&targetId=' + target.id,
      headers: adminHeaders,
    });
    assert.equal(preview.statusCode, 200, preview.body);
    const previewBody = preview.json().preview as { mediaCount: number; contentBytes: number; schemaVersion: number; supported: boolean };
    assert.equal(previewBody.supported, true);
    assert.ok(previewBody.mediaCount >= 3);
    assert.ok(previewBody.schemaVersion > 0);

    // 第二次只新增一张图：未变化的媒体不重复上传。
    seedMedia(context.database, context.artifactDirectory, Buffer.from('第三张参考图'));
    const secondRun = await startRun(context.app, {});
    assert.equal(secondRun.status, 'succeeded');
    assert.ok(secondRun.reusedObjectCount >= 3, '未变化的媒体与笔记附件必须复用已有密文，实际复用 ' + secondRun.reusedObjectCount);
    const objectsAfter = objectFiles(context.targetDirectory, created.vault.id);
    // 新增对象只应来自新图片与变化过的数据库快照，未变化的媒体不能重复上传。
    const added = objectsAfter.length - objects.length;
    assert.ok(added >= 1 && added <= 3, '新增对象应只来自新图片与数据库快照，实际新增 ' + added);

    // 错误密码不能解锁，也不能覆盖任何本地数据。
    await context.app.inject({ method: 'POST', url: '/api/v1/admin/backups/vault/lock', headers: adminHeaders });
    const wrong = await context.app.inject({ method: 'POST', url: '/api/v1/admin/backups/vault/unlock', headers: adminHeaders, payload: { password: 'definitely-wrong' } });
    assert.equal(wrong.statusCode, 409);
    const right = await context.app.inject({ method: 'POST', url: '/api/v1/admin/backups/vault/unlock', headers: adminHeaders, payload: { recoveryKey: created.recoveryKey } });
    assert.equal(right.statusCode, 200, right.body);
    assert.equal(right.json().unlocked, true);

    // 快照缺失的引用文件要如实记录，不能标成完整。
    const snapshotResponse = await context.app.inject({ method: 'GET', url: '/api/v1/admin/backups/snapshots/' + run.snapshotId, headers: adminHeaders });
    assert.equal(snapshotResponse.statusCode, 200);
    assert.equal(snapshotResponse.json().snapshot.missingCount, 0);
  } finally {
    await context.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});
