import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BACKUP_UPLOAD_CONCURRENCY, type BackupManifest, type BackupManifestObject, type BackupObject, type BackupRun, type BackupScope, type BackupTarget } from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import type { RuntimeLogService } from '../runtime.js';
import type { SecretStore } from '../security.js';
import { activeGenerationExecutions } from '../generation/events.js';
import { captureBackup } from './capture.js';
import { decryptFileToFile } from './crypto.js';
import { backupPaths } from './layout.js';
import { buildManifest, MANIFEST_KIND, parseManifest, serializeManifest } from './manifest.js';
import { BackupObjectWriter } from './objects.js';
import { cleanupTarget } from './retention.js';
import { createProvider, classifyFailure, type BackupProvider } from './providers/index.js';
import type { BackupStore } from './store.js';
import type { BackupVaultService } from './vault.js';

const DEFAULT_RETAIN_COUNT = 10;
/** 超过该大小的对象不下载回读校验，如实标注「完整校验待完成」。 */
const DEFAULT_DOWNLOAD_VERIFY_LIMIT = 64 * 1024 * 1024;
/** 等待长任务收敛的预算；等不到就如实记录并未收敛的项。 */
const IDLE_BUDGET_MS = 180_000;

export interface BackupRunnerOptions {
  config: ServiceConfig;
  database: ServiceDatabase;
  store: BackupStore;
  vaults: BackupVaultService;
  logs: RuntimeLogService;
  secrets: SecretStore;
  fetcher?: typeof fetch;
  downloadVerifyLimitBytes?: number;
}

export interface BackupRunRequest {
  planId?: string | null;
  trigger: BackupRun['trigger'];
  planName?: string;
  scope?: BackupScope;
  activityIds?: string[];
  works?: string[];
  targetIds?: string[];
}

/** 一次上传阶段需要的全部冻结信息；重试与补传都复用它。 */
interface PreparedUpload {
  snapshotId: string;
  manifest: BackupManifest;
  items: Array<{ entry: BackupManifestObject; objectId: string; cipherPath: string; cipherBytes: number }>;
  manifestObjectId: string;
  manifestCipherPath: string;
  manifestCipherBytes: number;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item)) : [];
}

async function runLimited<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/**
 * 备份执行器：手动、定时与重试共用同一条路径。
 *
 * 顺序：空闲等待 → 一致快照 → 加密 → 每目标独立上传 → 清单最后发布 → 校验 → 完成。
 * 快照只捕获一次，多个目标共用同一份冻结内容；每个目标独立成功、失败与重试。
 */
export class BackupRunner {
  private readonly running = new Map<string, Promise<void>>();
  /** 取消请求：只停止安排新的上传，已完成的对象与可续传状态都保留。 */
  private readonly cancelRequested = new Set<string>();

  constructor(private readonly options: BackupRunnerOptions) {}

  private get store() {
    return this.options.store;
  }

  private log(level: 'info' | 'warn' | 'error', message: string, context: { runId?: string; snapshotId?: string; targetId?: string; phase?: string; errorCode?: string } = {}) {
    this.options.logs.append({
      appId: 'sthstart', serviceId: 'backup', stream: 'system', level, message, force: true,
      taskId: 'backup', ...context,
    });
  }

  isBusy(): boolean {
    return this.store.hasActiveRun();
  }

  cancel(runId: string): boolean {
    const run = this.store.getRun(runId);
    if (!run || (run.status !== 'queued' && run.status !== 'running')) return false;
    this.cancelRequested.add(runId);
    this.store.updateRun(runId, { progressLabel: '正在取消：已完成的传输会保留' });
    return true;
  }

  /** 等待某个运行结束；测试与路由都可以用。 */
  async wait(runId: string): Promise<BackupRun | null> {
    await (this.running.get(runId) ?? Promise.resolve());
    return this.store.getRun(runId);
  }

  private async providerFor(target: BackupTarget): Promise<BackupProvider> {
    const stored = await this.options.secrets.get('backup-target:' + target.id).catch(() => ({ value: null }));
    return createProvider(target, {
      fetcher: this.options.fetcher ?? fetch,
      credential: stored?.value ?? null,
      directory: this.store.getTargetLocalDirectory(target.id),
      downloadVerifyLimitBytes: this.options.downloadVerifyLimitBytes ?? DEFAULT_DOWNLOAD_VERIFY_LIMIT,
    });
  }

  /** 等待已知长任务收敛；不自动取消用户的生图/搜集任务。 */
  private async waitForIdle(): Promise<{ drained: boolean; waitingOn: string[] }> {
    const started = Date.now();
    while (Date.now() - started < IDLE_BUDGET_MS) {
      const active = activeGenerationExecutions.size;
      if (!active) return { drained: true, waitingOn: [] };
      await sleep(2_000);
    }
    const remaining = activeGenerationExecutions.size;
    return { drained: false, waitingOn: remaining ? ['生成任务 ' + remaining + ' 个仍在运行'] : [] };
  }

  /**
   * 创建一次运行。手动与定时共用；未解锁时定时记录「等待解锁」，手动直接报错。
   */
  async start(request: BackupRunRequest): Promise<BackupRun> {
    const vault = this.store.getPrimaryVault();
    if (!vault) throw new Error('backup_vault_missing');
    const plan = request.planId ? this.store.getPlan(request.planId) : null;
    const scope: BackupScope = request.scope ?? plan?.scope ?? 'workspace';
    const activityIds = request.activityIds ?? plan?.activityIds ?? [];
    const works = request.works ?? plan?.works ?? [];
    // 手动「立即备份」没有指定目标时，默认使用已配置的全部目标。
    const requested = request.targetIds ?? plan?.targetIds;
    const targetIds = (requested ?? this.store.listTargets(vault.id).map((target) => target.id))
      .filter((id) => Boolean(this.store.getTarget(id)));
    if (!targetIds.length) throw new Error('backup_target_required');
    if (this.isBusy()) throw new Error('backup_busy');

    if (!this.options.vaults.isUnlocked(vault.id)) {
      const unlocked = await this.options.vaults.unlockRemembered(vault);
      if (!unlocked) {
        if (request.trigger !== 'scheduled') throw new Error('backup_locked');
        const run = this.store.createRun({
          planId: request.planId ?? null,
          planName: request.planName ?? plan?.name ?? '定时备份',
          trigger: 'scheduled',
          scope,
          configSnapshot: { scope, activityIds, works, targetIds },
        });
        this.store.updateRun(run.id, { status: 'queued', phase: 'waiting_unlock', progressLabel: '等待解锁' });
        // 只记录一次，不每分钟生成一条新的失败记录。
        this.log('warn', '备份到点但仓库未解锁，已记录等待解锁，解锁后补做一次。', { runId: run.id, phase: 'waiting_unlock', errorCode: 'backup_locked' });
        return this.store.getRun(run.id)!;
      }
    }

    const run = this.store.createRun({
      planId: request.planId ?? null,
      planName: request.planName ?? plan?.name ?? '手动备份',
      trigger: request.trigger,
      scope,
      configSnapshot: { scope, activityIds, works, targetIds },
    });
    this.launch(run.id);
    return this.store.getRun(run.id)!;
  }

  /** 解锁后把等待中的运行各补做一次。 */
  async resumePending(): Promise<string[]> {
    const launched: string[] = [];
    for (const run of this.store.listWaitingUnlockRuns()) {
      if (this.isBusy()) break;
      this.store.updateRun(run.id, { phase: 'waiting_idle', progressLabel: '解锁后补做' });
      this.launch(run.id);
      launched.push(run.id);
    }
    return launched;
  }

  private launch(runId: string) {
    const task = this.execute(runId)
      .catch((error: unknown) => {
        const failure = classifyFailure(error);
        this.store.updateRun(runId, { status: 'failed', phase: 'done', finishedAt: nowIso(), errorMessage: failure.message, progressLabel: '失败' });
        this.log('error', '备份失败：' + failure.message, { runId, errorCode: failure.code });
      })
      .finally(() => { this.running.delete(runId); this.cancelRequested.delete(runId); });
    this.running.set(runId, task);
  }

  /** 执行一次运行：没有快照的做完整捕获，已有快照的只做上传（重试/补传）。 */
  private async execute(runId: string): Promise<void> {
    const run = this.store.getRun(runId);
    if (!run) return;
    const vault = this.store.getPrimaryVault();
    if (!vault) throw new Error('backup_vault_missing');
    const config = this.store.getRunConfig(runId);
    const scope: BackupScope = typeof config.scope === 'string' ? config.scope as BackupScope : run.scope;
    const activityIds = toStringArray(config.activityIds);
    const works = toStringArray(config.works);
    const targetIds = toStringArray(config.targetIds).filter((id) => Boolean(this.store.getTarget(id)));
    const masterKey = this.options.vaults.getMasterKey(vault.id);
    if (!masterKey) {
      // 未解锁时绝不用明文代替：把这次运行放回等待解锁，解锁后补做一次。
      this.store.updateRun(runId, { status: 'queued', phase: 'waiting_unlock', progressLabel: '等待解锁' });
      return;
    }
    const namingKey = this.options.vaults.subkeys(vault.id).naming;
    const paths = backupPaths(this.options.config);
    const plan = run.planId ? this.store.getPlan(run.planId) : null;
    const retainCount = plan?.retainCount ?? DEFAULT_RETAIN_COUNT;

    if (run.snapshotId) {
      const prepared = await this.prepareFromSnapshot(run.snapshotId, vault.id, masterKey);
      this.store.updateRun(runId, { status: 'running', phase: 'uploading', startedAt: run.startedAt ?? nowIso(), progressLabel: '补传到目标网盘' });
      await this.uploadPhase({ runId, vaultId: vault.id, prepared, targetIds, retainCount, missingCount: 0 });
      return;
    }

    this.store.updateRun(runId, { status: 'running', phase: 'waiting_idle', startedAt: run.startedAt ?? nowIso(), progressLabel: '等待空闲并创建一致快照' });
    const snapshotId = randomUUID();
    const capture = await captureBackup({
      config: this.options.config,
      database: this.options.database,
      selection: { scope, activityIds, works },
      stagingRoot: paths.stagingRoot,
      snapshotId,
      waitForIdle: () => this.waitForIdle(),
    });
    const missing = capture.excluded.filter((entry) => entry.reason.includes('缺失'));
    this.store.createSnapshot({
      id: snapshotId,
      vaultId: vault.id,
      scope,
      scopeDetail: { activityIds, works },
      description: capture.description,
      objectCount: capture.items.length,
      contentBytes: 0,
      missingCount: missing.length,
      stagedDirectory: capture.stagingDirectory,
    });
    this.store.updateRun(runId, { snapshotId, phase: 'encrypting', progressLabel: '加密变化的内容' });
    if (!capture.idleWait.drained) {
      // 如实记录：快照是在仍有长任务运行时拍的，不假装是空闲状态。
      this.log('warn', '捕获时仍有长任务未收敛：' + capture.idleWait.waitingOn.join('、'), { runId, snapshotId, phase: 'capturing' });
    }
    if (missing.length) {
      this.log('warn', '捕获发现 ' + missing.length + ' 个必要文件缺失，本版本不能算完整。', { runId, snapshotId, phase: 'capturing', errorCode: 'backup_source_missing' });
    }

    const writer = new BackupObjectWriter({ store: this.store, vaultId: vault.id, directory: paths.objectDirectory, masterKey, namingKey });
    const entries: BackupManifestObject[] = [];
    let reused = 0;
    let contentBytes = 0;
    const localObjects: Array<{ entry: BackupManifestObject; objectId: string; cipherPath: string; cipherBytes: number }> = [];
    for (const item of capture.items) {
      const written = await writer.add(item);
      if (written.reused) reused += 1;
      contentBytes += written.entry.plaintextBytes;
      entries.push(written.entry);
      localObjects.push({ entry: written.entry, objectId: written.object.id, cipherPath: written.object.localCipherPath ?? '', cipherBytes: written.object.cipherBytes });
    }

    // 清单本身也作为一个对象保存，但最后才发布到各目标。
    const manifest = buildManifest({
      vaultId: vault.id,
      snapshotId,
      deviceId: this.options.config.host + ':' + process.platform,
      createdAt: nowIso(),
      scope,
      scopeDetail: { activityIds, works },
      appVersion: '0.1.0',
      serviceSchemaVersion: capture.serviceSchemaVersion,
      narrativeSchemaVersion: capture.narrativeSchemaVersion,
      description: capture.description,
      objects: entries,
      excluded: capture.excluded,
    });
    const manifestPath = resolve(capture.stagingDirectory, 'manifest.json');
    writeFileSync(manifestPath, serializeManifest(manifest));
    const manifestWritten = await writer.add({
      relativePath: 'manifest.json',
      kind: MANIFEST_KIND,
      storage: 'artifact',
      referencedBy: ['backup:manifest'],
      contentType: 'application/json',
      sourcePath: manifestPath,
    });
    this.store.setSnapshotManifestObject(snapshotId, manifestWritten.object.id);
    this.store.updateRun(runId, { contentBytes, objectCount: entries.length, reusedObjectCount: reused, phase: 'uploading', progressLabel: '上传到目标网盘' });
    this.log('info', '快照完成：' + entries.length + ' 个对象，其中 ' + reused + ' 个复用已有密文。', { runId, snapshotId, phase: 'capturing' });

    await this.uploadPhase({
      runId,
      vaultId: vault.id,
      prepared: {
        snapshotId,
        manifest,
        items: localObjects,
        manifestObjectId: manifestWritten.object.id,
        manifestCipherPath: manifestWritten.object.localCipherPath ?? '',
        manifestCipherBytes: manifestWritten.object.cipherBytes,
      },
      targetIds,
      retainCount,
      missingCount: missing.length,
    });
  }

  /**
   * 重建补传所需的信息：只读冻结的清单与本地密文，
   * 不重新捕获此刻已经变化的工作区。
   */
  private async prepareFromSnapshot(snapshotId: string, vaultId: string, masterKey: Buffer): Promise<PreparedUpload> {
    const manifestObjectId = this.store.getSnapshotManifestObject(snapshotId);
    if (!manifestObjectId) throw new Error('backup_manifest_missing');
    const manifestObject = this.store.getObject(manifestObjectId);
    if (!manifestObject) throw new Error('backup_manifest_missing');
    const manifestCipherPath = await this.ensureCipher(manifestObject, null, vaultId, masterKey, { snapshotId });
    const plaintextPath = resolve(backupPaths(this.options.config).stagingRoot, snapshotId, 'manifest.plain.json');
    await decryptFileToFile({ cipherPath: manifestCipherPath, targetPath: plaintextPath, masterKey, vaultId, objectId: manifestObject.id });
    const manifest = parseManifest(readFileSync(plaintextPath, 'utf8'));
    const items: PreparedUpload['items'] = [];
    for (const entry of manifest.objects) {
      const object = this.store.findObjectByContent(vaultId, entry.plaintextSha256);
      if (!object) throw new Error('backup_object_missing');
      const cipherPath = await this.ensureCipher(object, entry, vaultId, masterKey, { snapshotId });
      items.push({ entry, objectId: object.id, cipherPath, cipherBytes: object.cipherBytes });
    }
    return { snapshotId, manifest, items, manifestObjectId, manifestCipherPath, manifestCipherBytes: manifestObject.cipherBytes };
  }

  /**
   * 本地密文缓存丢失时从有效副本取回。
   * 解不开或 hash 不符的副本不会被当成可复用密文，也不会重新加密覆盖旧身份。
   */
  private async ensureCipher(
    object: BackupObject,
    entry: BackupManifestObject | null,
    vaultId: string,
    masterKey: Buffer,
    context: { snapshotId?: string },
  ): Promise<string> {
    if (object.localCipherPath && existsSync(object.localCipherPath)) return object.localCipherPath;
    const paths = backupPaths(this.options.config);
    const writer = new BackupObjectWriter({
      store: this.store,
      vaultId,
      directory: paths.objectDirectory,
      masterKey,
      namingKey: this.options.vaults.subkeys(vaultId).naming,
    });
    for (const target of this.store.listTargets(vaultId)) {
      const remoteKey = entry?.remoteKey ?? this.store.getTargetObject(target.id, vaultId, object.id)?.remoteKey;
      if (!remoteKey) continue;
      const directory = mkdtempSync(join(tmpdir(), 'sthstart-cipher-'));
      const downloaded = join(directory, 'object.bin');
      try {
        const provider = await this.providerFor(target);
        if (entry) await provider.downloadObject({ vaultId, remoteKey, targetPath: downloaded });
        else await provider.downloadSnapshot({ vaultId, snapshotId: context.snapshotId ?? '', targetPath: downloaded });
        if (await writer.restoreCipherFromRemote(object, downloaded)) {
          const restored = this.store.getObject(object.id);
          if (restored?.localCipherPath) {
            this.log('warn', '本地密文缓存丢失，已从目标副本取回。', { targetId: target.id, snapshotId: context.snapshotId });
            return restored.localCipherPath;
          }
        }
      } catch {
        // 这个目标不可用就换下一个；全部失败时在下面统一报错。
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
    throw new Error('backup_cipher_cache_missing');
  }

  /** 上传阶段：每个目标独立提交，最多小并发；清单最后发布。 */
  private async uploadPhase(input: {
    runId: string;
    vaultId: string;
    prepared: PreparedUpload;
    targetIds: string[];
    retainCount: number;
    missingCount: number;
  }): Promise<void> {
    const { runId, vaultId, prepared } = input;
    const targets = input.targetIds.map((id) => this.store.getTarget(id)).filter((target): target is BackupTarget => Boolean(target));
    if (!targets.length) throw new Error('backup_target_required');
    for (const target of targets) {
      this.store.upsertTargetRun({
        runId, snapshotId: prepared.snapshotId, targetId: target.id, state: 'pending',
        totalObjects: prepared.items.length + 1, totalBytes: prepared.items.reduce((sum, item) => sum + item.cipherBytes, 0) + prepared.manifestCipherBytes,
      });
    }
    this.store.updateRun(runId, { phase: 'uploading', progressLabel: '上传到 ' + targets.length + ' 个目标' });

    const results = new Map<string, { ok: boolean; uploadedBytes: number }>();
    await runLimited(targets, BACKUP_UPLOAD_CONCURRENCY, async (target) => {
      results.set(target.id, await this.submitToTarget({ runId, vaultId, prepared, target, retainCount: input.retainCount }));
    });

    const uploadedBytes = [...results.values()].reduce((sum, result) => sum + result.uploadedBytes, 0);
    const failedTargets = targets.filter((target) => !results.get(target.id)?.ok);
    const succeeded = targets.length - failedTargets.length;
    const cancelled = this.cancelRequested.has(runId);
    const status: BackupRun['status'] = cancelled
      ? 'cancelled'
      : succeeded === targets.length ? 'succeeded' : succeeded ? 'partial' : 'failed';
    const notes: string[] = [];
    if (input.missingCount) notes.push('有 ' + input.missingCount + ' 个必要文件缺失，本版本不算完整');
    if (failedTargets.length) notes.push(failedTargets.length + ' 个目标失败，可只重试这些目标');
    this.store.updateRun(runId, {
      status,
      phase: 'done',
      finishedAt: nowIso(),
      uploadedBytes,
      progressLabel: cancelled
        ? '已取消：' + succeeded + ' 个目标完成，未上传的部分保留可续传状态'
        : (succeeded === targets.length ? succeeded + ' 个目标完成' : succeeded + ' 个目标完成，' + failedTargets.length + ' 个需要处理') + (notes.length ? '；' + notes.join('；') : ''),
    });
    if (status === 'succeeded') this.log('info', '备份完成：' + prepared.manifest.objects.length + ' 个对象，上传 ' + uploadedBytes + ' 字节。', { runId, snapshotId: prepared.snapshotId, phase: 'done' });
  }

  private async submitToTarget(input: {
    runId: string;
    vaultId: string;
    prepared: PreparedUpload;
    target: BackupTarget;
    retainCount: number;
  }): Promise<{ ok: boolean; uploadedBytes: number }> {
    const { runId, vaultId, prepared, target } = input;
    const totalBytes = prepared.items.reduce((sum, item) => sum + item.cipherBytes, 0) + prepared.manifestCipherBytes;
    const totalObjects = prepared.items.length + 1;
    let uploadedBytes = 0;
    let uploadedObjects = 0;
    try {
      const provider = await this.providerFor(target);
      await provider.connect();
      await provider.ensureLayout(vaultId);
      const vault = this.store.getPrimaryVault();
      if (vault) await provider.writeVaultHeader(vaultId, JSON.stringify(vault));
      this.store.upsertTargetRun({ runId, snapshotId: prepared.snapshotId, targetId: target.id, state: 'uploading', uploadedObjects, uploadedBytes, totalObjects, totalBytes });

      for (const item of prepared.items) {
        if (this.cancelRequested.has(runId)) {
          // 取消只停止安排新的上传：已完成对象与可续传状态都保留。
          this.store.upsertTargetRun({
            runId, snapshotId: prepared.snapshotId, targetId: target.id, state: 'skipped',
            uploadedObjects, uploadedBytes, totalObjects, totalBytes,
            errorCode: 'backup_cancelled', errorMessage: '用户取消了这次备份，已上传的对象可以继续复用。',
          });
          return { ok: false, uploadedBytes };
        }
        const existing = this.store.getTargetObject(target.id, vaultId, item.objectId);
        if (existing?.uploaded && existing.remoteKey === item.entry.remoteKey) {
          // 本地 uploaded 标记不是唯一事实：远端被删除或被替换时必须重新上传。
          const remote = await provider.statObject(vaultId, item.entry.remoteKey).catch(() => null);
          if (remote && remote.size === item.cipherBytes) continue;
        }
        const outcome = await provider.uploadObject({
          vaultId,
          remoteKey: item.entry.remoteKey,
          filePath: item.cipherPath,
          size: item.cipherBytes,
        });
        this.store.upsertTargetObject({
          targetId: target.id, vaultId, objectId: item.objectId, remoteKey: item.entry.remoteKey,
          uploaded: true, verified: outcome.verified, verifyMethod: outcome.verifyMethod,
          remoteId: outcome.remoteId, uploadedBytes: item.cipherBytes,
        });
        uploadedBytes += item.cipherBytes;
        uploadedObjects += 1;
        this.store.upsertTargetRun({ runId, snapshotId: prepared.snapshotId, targetId: target.id, state: 'uploading', uploadedObjects, uploadedBytes, totalObjects, totalBytes });
        if (!outcome.verified) {
          // 有远端校验值时用对应算法校验；没有时如实标注待完成，绝不用大小冒充字节一致。
          this.log('warn', '对象已上传，完整校验待完成（仅确认了大小）。', { runId, snapshotId: prepared.snapshotId, targetId: target.id, phase: 'verifying' });
        }
      }

      this.store.updateRun(runId, { phase: 'verifying', progressLabel: '校验 ' + target.accountLabel });
      await provider.publishSnapshot({
        vaultId,
        snapshotId: prepared.snapshotId,
        filePath: prepared.manifestCipherPath,
        size: prepared.manifestCipherBytes,
      });
      this.store.saveSnapshotObjects(target.id, prepared.snapshotId, vaultId, prepared.items.map((item) => item.objectId));
      this.store.addSnapshotUploadedBytes(prepared.snapshotId, uploadedBytes);
      this.store.upsertTargetRun({ runId, snapshotId: prepared.snapshotId, targetId: target.id, state: 'succeeded', uploadedObjects, uploadedBytes, totalObjects, totalBytes, manifestPublished: true });
      this.store.setTargetError(target.id, null);
      this.log('info', '目标完成：' + (target.accountLabel || target.kind) + '（本次上传 ' + uploadedObjects + ' 个对象）', { runId, snapshotId: prepared.snapshotId, targetId: target.id, phase: 'done' });

      // 保留清理：按目标计算，失败的新版本不会让该目标上一份成功版本过期。
      const cleanup = await cleanupTarget({ store: this.store, provider, target, vaultId: input.vaultId, retainCount: input.retainCount });
      if (cleanup.expiredSnapshotIds.length || cleanup.failures.length) {
        this.log(cleanup.failures.length ? 'warn' : 'info', cleanup.notice, { runId, targetId: target.id, phase: 'done', ...(cleanup.failures.length ? { errorCode: 'backup_cleanup_partial' } : {}) });
      }
      for (const failure of cleanup.failures) this.log('warn', '清理未完成：' + failure, { runId, targetId: target.id, phase: 'done', errorCode: 'backup_cleanup_partial' });
      return { ok: true, uploadedBytes };
    } catch (error) {
      const failure = classifyFailure(error);
      this.store.upsertTargetRun({
        runId, snapshotId: prepared.snapshotId, targetId: target.id, state: 'failed',
        uploadedObjects, uploadedBytes, totalObjects, totalBytes,
        errorCode: failure.code, errorMessage: failure.message,
      });
      if (failure.code === 'backup_auth_expired' || failure.code === 'backup_auth_required' || failure.code === 'backup_quark_unverified') {
        this.store.setTargetError(target.id, failure.message);
      }
      this.log('error', '目标失败：' + (target.accountLabel || target.kind) + '：' + failure.message, {
        runId, snapshotId: prepared.snapshotId, targetId: target.id, phase: 'uploading', errorCode: failure.code,
      });
      return { ok: false, uploadedBytes };
    }
  }

  /**
   * 重试/补传：继续用原来的 snapshot 与对象，不重新捕获已经变化的工作区。
   * 只处理仍未发布清单的目标。
   */
  async retryTargets(input: { snapshotId: string; targetIds: string[] }): Promise<BackupRun> {
    const snapshot = this.store.getSnapshot(input.snapshotId);
    if (!snapshot) throw new Error('backup_snapshot_missing');
    const pending = input.targetIds.filter((id) => Boolean(this.store.getTarget(id)) && !this.store.getTargetRun(input.snapshotId, id)?.manifestPublished);
    if (!pending.length) throw new Error('backup_no_failed_target');
    if (this.isBusy()) throw new Error('backup_busy');
    const vault = this.store.getPrimaryVault();
    if (!vault) throw new Error('backup_vault_missing');
    if (!this.options.vaults.isUnlocked(vault.id) && !(await this.options.vaults.unlockRemembered(vault))) throw new Error('backup_locked');
    const detail = this.store.getSnapshotScopeDetail(input.snapshotId);
    const run = this.store.createRun({
      planId: null,
      planName: '重试失败目标',
      trigger: 'retry',
      scope: snapshot.scope,
      configSnapshot: { scope: snapshot.scope, activityIds: toStringArray(detail.activityIds), works: toStringArray(detail.works), targetIds: pending },
    });
    this.store.updateRun(run.id, { snapshotId: input.snapshotId });
    this.launch(run.id);
    return this.store.getRun(run.id)!;
  }
}
