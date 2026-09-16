import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BackupManifest, BackupManifestObject, BackupRestore, BackupRestorePreview, BackupTarget, BackupVault } from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import type { RuntimeLogService } from '../runtime.js';
import type { SecretStore } from '../security.js';
import { computeFileSha256, createPortableBackup } from '../portable-backup.js';
import { ActivityStore } from '../activities/store.js';
import { commitActivityImport, stageActivityImport } from '../activities/imports.js';
import { createZip, type ZipEntryInput } from '../activities/zip.js';
import { decryptFileToFile, readCipherIdentity } from './crypto.js';
import { backupPaths } from './layout.js';
import { parseManifest } from './manifest.js';
import { classifyFailure, createProvider, providerCapabilities, type BackupProvider } from './providers/index.js';
import type { BackupStore } from './store.js';
import type { BackupVaultService } from './vault.js';

export interface RestoreServiceOptions {
  config: ServiceConfig;
  database: ServiceDatabase;
  store: BackupStore;
  vaults: BackupVaultService;
  secrets: SecretStore;
  logs: RuntimeLogService;
  fetcher?: typeof fetch;
}

interface DecryptedObject {
  entry: BackupManifestObject;
  plaintextPath: string;
}

/**
 * 恢复：下载 → 校验 → 解密 → 预览 → 执行。
 *
 * - 下载与验证不修改当前数据；解密失败或空间不足都不触碰工作区。
 * - 活动恢复为副本、资料按逻辑包导入；完整工作区替换必须显式确认，
 *   并由「停止服务后运行恢复助手」完成替换，不显示成功却仍在使用旧连接。
 * - 格式版本高于本应用支持版本时直接拒绝，不向旧 schema 强塞新数据。
 */
export class BackupRestoreService {
  private readonly running = new Map<string, Promise<void>>();

  constructor(private readonly options: RestoreServiceOptions) {}

  private get store() {
    return this.options.store;
  }

  private log(level: 'info' | 'warn' | 'error', message: string, context: { runId?: string; snapshotId?: string; targetId?: string; phase?: string; errorCode?: string } = {}) {
    this.options.logs.append({ appId: 'sthstart', serviceId: 'backup-restore', stream: 'system', level, message, force: true, taskId: 'backup', ...context });
  }

  private async providerFor(targetId: string): Promise<BackupProvider> {
    const target = this.store.getTarget(targetId);
    if (!target) throw new Error('backup_target_missing');
    const stored = await this.options.secrets.get('backup-target:' + target.id).catch(() => ({ value: null }));
    return createProvider(target, {
      fetcher: this.options.fetcher ?? fetch,
      credential: stored?.value ?? null,
      directory: this.store.getTargetLocalDirectory(target.id),
      downloadVerifyLimitBytes: 64 * 1024 * 1024,
    });
  }

  private masterKey(vaultId: string): Buffer {
    const key = this.options.vaults.getMasterKey(vaultId);
    if (!key) throw new Error('backup_locked');
    return key;
  }

  /** 下载并解密清单；只读远端与暂存目录，不修改当前数据。 */
  private async fetchManifest(input: { snapshotId: string; targetId: string; vaultId: string; directory: string }): Promise<BackupManifest> {
    const manifestObjectId = this.store.getSnapshotManifestObject(input.snapshotId);
    if (!manifestObjectId) throw new Error('backup_manifest_missing');
    mkdirSync(input.directory, { recursive: true });
    const cipherPath = resolve(input.directory, 'manifest.bin');
    const plaintextPath = resolve(input.directory, 'manifest.json');
    const cached = this.store.getObject(manifestObjectId);
    if (cached?.localCipherPath && existsSync(cached.localCipherPath)) {
      await decryptFileToFile({ cipherPath: cached.localCipherPath, targetPath: plaintextPath, masterKey: this.masterKey(input.vaultId), vaultId: input.vaultId, objectId: cached.id });
    } else {
      const provider = await this.providerFor(input.targetId);
      await provider.downloadSnapshot({ vaultId: input.vaultId, snapshotId: input.snapshotId, targetPath: cipherPath });
      await decryptFileToFile({ cipherPath, targetPath: plaintextPath, masterKey: this.masterKey(input.vaultId), vaultId: input.vaultId, objectId: '' });
    }
    // 解析失败（含格式版本过新）会直接抛出，调用方据此拒绝继续。
    return parseManifest(readFileSync(plaintextPath, 'utf8'));
  }

  /**
   * 下载、校验密文 hash、认证解密并验证明文 hash。
   * 缓存的密文命中时不再重复下载，但仍做完整校验。
   */
  private async verifyAndDecrypt(input: {
    manifest: BackupManifest;
    targetId: string;
    vaultId: string;
    directory: string;
    onProgress?: (verifiedBytes: number, totalBytes: number) => void;
  }): Promise<DecryptedObject[]> {
    const provider = await this.providerFor(input.targetId);
    const masterKey = this.masterKey(input.vaultId);
    const totalBytes = input.manifest.objects.reduce((sum, entry) => sum + entry.plaintextBytes, 0);
    let verifiedBytes = 0;
    const results: DecryptedObject[] = [];
    for (const entry of input.manifest.objects) {
      const cached = this.store.findObjectByContent(input.vaultId, entry.plaintextSha256);
      let cipherPath = cached?.localCipherPath && existsSync(cached.localCipherPath) ? cached.localCipherPath : '';
      if (!cipherPath) {
        cipherPath = resolve(input.directory, 'cipher', entry.remoteKey + '.bin');
        mkdirSync(dirname(cipherPath), { recursive: true });
        await provider.downloadObject({ vaultId: input.vaultId, remoteKey: entry.remoteKey, targetPath: cipherPath });
      }
      const cipherHash = await computeFileSha256(cipherPath);
      if (cipherHash !== entry.cipherSha256) throw new Error('backup_cipher_checksum_mismatch');
      const identity = await readCipherIdentity(cipherPath);
      if (identity.vaultId !== input.vaultId) throw new Error('backup_object_identity_mismatch');
      const plaintextPath = resolve(input.directory, 'plain', entry.relativePath);
      mkdirSync(dirname(plaintextPath), { recursive: true });
      await decryptFileToFile({ cipherPath, targetPath: plaintextPath, masterKey, vaultId: input.vaultId, objectId: identity.objectId });
      if (statSync(plaintextPath).size !== entry.plaintextBytes) throw new Error('backup_restore_size_mismatch');
      if (await computeFileSha256(plaintextPath) !== entry.plaintextSha256) throw new Error('backup_restore_checksum_mismatch');
      // 新设备可以在这里重建对象索引：内容身份与密文缓存都来自已验证的字节。
      const cipherBytes = statSync(cipherPath).size;
      if (!this.store.findObjectByContent(input.vaultId, entry.plaintextSha256)) {
        this.store.saveObject({
          vaultId: input.vaultId, contentHash: entry.plaintextSha256, cipherHash,
          plaintextBytes: entry.plaintextBytes, cipherBytes, localCipherPath: cipherPath,
        });
      }
      verifiedBytes += entry.plaintextBytes;
      input.onProgress?.(verifiedBytes, totalBytes);
      results.push({ entry, plaintextPath });
    }
    return results;
  }

  /** 版本化逻辑包（活动工程包 / 资料包）在预览与恢复时都要读。 */
  private async loadPackage(entry: BackupManifestObject, vaultId: string, targetId: string, directory: string): Promise<Record<string, unknown>> {
    const cached = this.store.findObjectByContent(vaultId, entry.plaintextSha256);
    let cipherPath = cached?.localCipherPath && existsSync(cached.localCipherPath) ? cached.localCipherPath : '';
    if (!cipherPath) {
      cipherPath = resolve(directory, 'cipher', entry.remoteKey + '.bin');
      mkdirSync(dirname(cipherPath), { recursive: true });
      const provider = await this.providerFor(targetId);
      await provider.downloadObject({ vaultId, remoteKey: entry.remoteKey, targetPath: cipherPath });
    }
    const plaintextPath = resolve(directory, 'package', entry.relativePath);
    mkdirSync(dirname(plaintextPath), { recursive: true });
    await decryptFileToFile({ cipherPath, targetPath: plaintextPath, masterKey: this.masterKey(vaultId), vaultId, objectId: cached?.id ?? '' });
    return JSON.parse(readFileSync(plaintextPath, 'utf8')) as Record<string, unknown>;
  }

  /** 恢复预览：列出会恢复的活动/资料/媒体、时间、缺省项与目标可用性；不修改当前数据。 */
  async preview(input: { snapshotId: string; targetId: string }): Promise<BackupRestorePreview> {
    const snapshot = this.store.getSnapshot(input.snapshotId);
    if (!snapshot) throw new Error('backup_snapshot_missing');
    const targetRun = this.store.getTargetRun(input.snapshotId, input.targetId);
    if (!targetRun?.manifestPublished) throw new Error('backup_target_not_published');
    const directory = resolve(backupPaths(this.options.config).restoreRoot, 'preview-' + input.snapshotId);
    const manifest = await this.fetchManifest({ snapshotId: input.snapshotId, targetId: input.targetId, vaultId: snapshot.vaultId, directory });
    const activities: Array<{ id: string; title: string }> = [];
    let knowledgeNoteCount = 0;
    let characterCount = 0;
    for (const entry of manifest.objects) {
      const parsed = entry.kind === 'activity_package' || entry.kind === 'knowledge_package'
        ? await this.loadPackage(entry, snapshot.vaultId, input.targetId, directory).catch(() => null)
        : null;
      if (entry.kind === 'activity_package') {
        const fallback = this.options.database.connection.prepare('SELECT title FROM activities WHERE id=?').get(String(entry.resourceId ?? '')) as { title?: string } | undefined;
        activities.push({ id: String(entry.resourceId ?? ''), title: String(parsed?.title ?? fallback?.title ?? entry.resourceId ?? '未命名活动') });
      }
      if (entry.kind === 'knowledge_package' && parsed) {
        knowledgeNoteCount = Array.isArray(parsed.notes) ? parsed.notes.length : 0;
        const characters = new Set<string>();
        for (const row of (Array.isArray(parsed.noteKnowledge) ? parsed.noteKnowledge : []) as Array<Record<string, unknown>>) {
          for (const character of parseJsonList(row.characters_json)) characters.add(character);
        }
        characterCount = characters.size;
      }
    }
    const mediaObjects = manifest.objects.filter((entry) => !['database', 'manifest', 'activity_package', 'knowledge_package'].includes(entry.kind));
    return {
      snapshotId: manifest.snapshotId,
      scope: manifest.scope,
      createdAt: manifest.createdAt,
      activities,
      knowledgeNoteCount,
      characterCount,
      mediaCount: mediaObjects.length,
      contentBytes: manifest.objects.reduce((sum, entry) => sum + entry.plaintextBytes, 0),
      schemaVersion: manifest.serviceSchemaVersion,
      supported: true,
      exclusions: manifest.excluded.map((entry) => entry.relativePath + '（' + entry.reason + '）'),
      availableTargets: snapshot.publishedTargetIds,
    };
  }

  /**
   * 开始一次恢复。完整工作区替换必须显式确认，并且只做「准备」，
   * 真正的文件替换在服务停止后由恢复助手完成。
   */
  async start(input: { snapshotId: string; targetId: string; mode: 'activity_copy' | 'knowledge_import' | 'workspace_replace'; confirm?: boolean }): Promise<BackupRestore> {
    const snapshot = this.store.getSnapshot(input.snapshotId);
    if (!snapshot) throw new Error('backup_snapshot_missing');
    const targetRun = this.store.getTargetRun(input.snapshotId, input.targetId);
    if (!targetRun?.manifestPublished) throw new Error('backup_target_not_published');
    if (!this.options.vaults.isUnlocked(snapshot.vaultId)) {
      const vault = this.store.getVault(snapshot.vaultId);
      if (!vault || !(await this.options.vaults.unlockRemembered(vault))) throw new Error('backup_locked');
    }
    if (input.mode === 'workspace_replace' && !input.confirm) throw new Error('backup_restore_confirm_required');
    const restore = this.store.createRestore({
      vaultId: snapshot.vaultId,
      snapshotId: input.snapshotId,
      targetId: input.targetId,
      scope: snapshot.scope,
      totalBytes: snapshot.contentBytes,
      mode: input.mode,
    });
    this.launch(restore.id, input.mode);
    return this.store.getRestore(restore.id)!;
  }

  async wait(restoreId: string): Promise<BackupRestore | null> {
    await (this.running.get(restoreId) ?? Promise.resolve());
    return this.store.getRestore(restoreId);
  }

  /**
   * 新设备：只凭远端仓库与解锁材料列出可恢复版本，不依赖旧数据库。
   * 远端清单文件名就是版本 ID，因此这里不需要任何本地索引。
   */
  async listRemoteSnapshots(input: { targetId: string; vaultId?: string }): Promise<Array<{ snapshotId: string; size: number; remoteId: string }>> {
    const target = this.store.getTarget(input.targetId);
    if (!target) throw new Error('backup_target_missing');
    const provider = await this.providerFor(input.targetId);
    const vaultId = input.vaultId ?? target.vaultId;
    const listed = await provider.listSnapshots(vaultId);
    return listed
      .filter((item) => (item.name ?? '').endsWith('.bin'))
      .map((item) => ({ snapshotId: (item.name ?? '').slice(0, -4), size: item.size, remoteId: item.remoteId }))
      .filter((item) => Boolean(item.snapshotId));
  }

  /**
   * 把远端版本登记到本机：下载并解密清单、重建对象索引与发布状态，
   * 之后就能像本机备份一样预览与恢复。重复登记同一个版本会跳过。
   */
  async adoptRemoteSnapshot(input: { targetId: string; snapshotId: string }): Promise<{ snapshotId: string; adopted: boolean; objectCount: number }> {
    const target = this.store.getTarget(input.targetId);
    if (!target) throw new Error('backup_target_missing');
    const vaultId = target.vaultId;
    if (!this.options.vaults.isUnlocked(vaultId)) {
      const vault = this.store.getVault(vaultId);
      if (!vault || !(await this.options.vaults.unlockRemembered(vault))) throw new Error('backup_locked');
    }
    const directory = resolve(backupPaths(this.options.config).restoreRoot, 'adopt-' + input.snapshotId);
    mkdirSync(directory, { recursive: true });
    const cipherPath = resolve(directory, 'manifest.bin');
    const plaintextPath = resolve(directory, 'manifest.json');
    const provider = await this.providerFor(input.targetId);
    await provider.downloadSnapshot({ vaultId, snapshotId: input.snapshotId, targetPath: cipherPath });
    const identity = await readCipherIdentity(cipherPath);
    if (identity.vaultId !== vaultId) throw new Error('backup_object_identity_mismatch');
    await decryptFileToFile({
      cipherPath, targetPath: plaintextPath,
      masterKey: this.masterKey(vaultId), vaultId, objectId: identity.objectId,
    });
    const manifest = parseManifest(readFileSync(plaintextPath, 'utf8'));
    const manifestHash = await computeFileSha256(plaintextPath);
    const cipherHash = await computeFileSha256(cipherPath);
    // 清单自身也登记为对象：身份取密文头部身份，缓存指向这次下载的副本。
    const manifestObject = this.store.findObjectByContent(vaultId, manifestHash) ?? this.store.saveObject({
      id: identity.objectId,
      vaultId,
      contentHash: manifestHash,
      cipherHash,
      plaintextBytes: statSync(plaintextPath).size,
      cipherBytes: statSync(cipherPath).size,
      localCipherPath: cipherPath,
    });
    // 每个内容对象只登记身份与大小；真正的密文在恢复时按远端对象键下载并校验。
    for (const entry of manifest.objects) {
      if (this.store.findObjectByContent(vaultId, entry.plaintextSha256)) continue;
      this.store.saveObject({
        vaultId,
        contentHash: entry.plaintextSha256,
        cipherHash: entry.cipherSha256,
        plaintextBytes: entry.plaintextBytes,
        cipherBytes: entry.cipherBytes,
        localCipherPath: null,
      });
    }
    const existing = this.store.getSnapshot(manifest.snapshotId);
    if (!existing) {
      this.store.createSnapshot({
        id: manifest.snapshotId,
        vaultId,
        scope: manifest.scope,
        scopeDetail: manifest.scopeDetail,
        description: manifest.description + '（自远端登记）',
        objectCount: manifest.objects.length,
        contentBytes: manifest.objects.reduce((sum, entry) => sum + entry.plaintextBytes, 0),
        missingCount: manifest.excluded.length,
        stagedDirectory: null,
      });
    }
    this.store.setSnapshotManifestObject(manifest.snapshotId, manifestObject.id);
    this.store.upsertTargetRun({
      runId: 'remote-adopt',
      snapshotId: manifest.snapshotId,
      targetId: input.targetId,
      state: 'succeeded',
      totalObjects: manifest.objects.length,
      totalBytes: manifest.objects.reduce((sum, entry) => sum + entry.cipherBytes, 0),
      manifestPublished: true,
    });
    this.log('info', '已从远端登记版本 ' + manifest.snapshotId + '（' + manifest.objects.length + ' 个对象）。', {
      snapshotId: manifest.snapshotId, targetId: input.targetId, phase: 'done',
    });
    return { snapshotId: manifest.snapshotId, adopted: !existing, objectCount: manifest.objects.length };
  }

  /**
   * 连接已有仓库。
   *
   * - 已有目标时直接读它的远端仓库头。
   * - 新设备上还没有仓库（目标必须引用一个仓库，因此不能先建目标）：用「网盘类型 + 远端根目录 +
   *   仓库 ID」读取远端仓库头，写入本机后再建立目标。仓库 ID 可以在旧设备的「网盘与加密」里看到。
   */
  async connectRemoteVault(input: {
    targetId?: string;
    kind?: BackupTarget['kind'];
    rootPath?: string;
    localDirectory?: string | null;
    vaultId?: string;
    import: boolean;
  }): Promise<{ vault: BackupVault | null; imported: boolean; targetId: string | null }> {
    if (input.targetId) {
      const target = this.store.getTarget(input.targetId);
      if (!target) throw new Error('backup_target_missing');
      const provider = await this.providerFor(input.targetId);
      const header = await provider.readVaultHeader(target.vaultId);
      if (!header) return { vault: null, imported: false, targetId: target.id };
      const vault = JSON.parse(header) as BackupVault;
      if (vault.id !== target.vaultId) throw new Error('backup_remote_vault_mismatch');
      const existing = this.store.getVault(vault.id);
      if (!input.import) return { vault: existing ?? vault, imported: false, targetId: target.id };
      this.store.saveVault({ ...vault, unlockPolicy: existing?.unlockPolicy ?? 'manual', rememberedOnDevice: existing?.rememberedOnDevice ?? false });
      this.log('info', '已从远端导入仓库头 ' + vault.id + '。', { targetId: target.id, phase: 'done' });
      return { vault: this.store.getVault(vault.id), imported: true, targetId: target.id };
    }

    if (!input.kind || !input.vaultId) throw new Error('backup_remote_vault_target_required');
    const capabilities = providerCapabilities(input.kind);
    const probe = createProvider({
      id: 'probe',
      kind: input.kind,
      accountLabel: '连接已有仓库',
      rootPath: input.rootPath ?? '',
      vaultId: input.vaultId,
      connected: true,
      capabilities,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    } as BackupTarget, {
      fetcher: this.options.fetcher ?? fetch,
      credential: (await this.options.secrets.get('backup-target-probe:' + input.vaultId).catch(() => ({ value: null })))?.value ?? null,
      directory: input.localDirectory ?? null,
      downloadVerifyLimitBytes: 64 * 1024 * 1024,
    });
    const header = await probe.readVaultHeader(input.vaultId);
    if (!header) return { vault: null, imported: false, targetId: null };
    const vault = JSON.parse(header) as BackupVault;
    if (vault.id !== input.vaultId) throw new Error('backup_remote_vault_mismatch');
    const existing = this.store.getVault(vault.id);
    if (!input.import) return { vault: existing ?? vault, imported: false, targetId: null };
    this.store.saveVault({ ...vault, unlockPolicy: existing?.unlockPolicy ?? 'manual', rememberedOnDevice: existing?.rememberedOnDevice ?? false });
    const target = this.store.saveTarget({
      vaultId: vault.id,
      kind: input.kind,
      accountLabel: input.kind === 'local_test' ? '已有仓库目录' : vault.id.slice(0, 8),
      rootPath: input.rootPath ?? '',
      localDirectory: input.localDirectory ?? null,
      capabilities,
      connected: true,
      lastError: null,
    });
    this.log('info', '已连接已有仓库 ' + vault.id + ' 并创建目标。', { targetId: target.id, phase: 'done' });
    return { vault: this.store.getVault(vault.id), imported: true, targetId: target.id };
  }

  private launch(restoreId: string, mode: 'activity_copy' | 'knowledge_import' | 'workspace_replace') {
    const task = this.execute(restoreId, mode)
      .catch((error: unknown) => {
        const failure = classifyFailure(error);
        this.store.updateRestore(restoreId, { status: 'failed', phase: 'done', errorMessage: failure.message, progressLabel: '恢复失败：' + failure.message });
        this.log('error', '恢复失败：' + failure.message, { runId: restoreId, errorCode: failure.code, phase: 'done' });
      })
      .finally(() => { this.running.delete(restoreId); });
    this.running.set(restoreId, task);
  }

  private async execute(restoreId: string, mode: 'activity_copy' | 'knowledge_import' | 'workspace_replace'): Promise<void> {
    const restore = this.store.getRestore(restoreId);
    if (!restore) return;
    const directory = resolve(backupPaths(this.options.config).restoreRoot, restoreId);
    this.store.updateRestore(restoreId, { status: 'running', phase: 'waiting', progressLabel: '下载并校验清单' });
    const manifest = await this.fetchManifest({ snapshotId: restore.snapshotId, targetId: restore.targetId, vaultId: restore.vaultId, directory });
    const totalBytes = manifest.objects.reduce((sum, entry) => sum + entry.plaintextBytes, 0);
    this.store.updateRestore(restoreId, { phase: 'verifying', totalBytes, progressLabel: '下载并验证 ' + manifest.objects.length + ' 个对象' });
    const objects = await this.verifyAndDecrypt({
      manifest,
      targetId: restore.targetId,
      vaultId: restore.vaultId,
      directory,
      onProgress: (verifiedBytes) => this.store.updateRestore(restoreId, { verifiedBytes }),
    });

    if (mode === 'activity_copy') {
      const summary = await this.importActivities(objects);
      this.store.updateRestore(restoreId, { status: 'succeeded', phase: 'done', progressLabel: summary, verifiedBytes: totalBytes });
      this.log('info', '恢复完成：' + summary, { runId: restoreId, snapshotId: restore.snapshotId, targetId: restore.targetId, phase: 'done' });
      return;
    }
    if (mode === 'knowledge_import') {
      const summary = await this.importKnowledge(objects);
      this.store.updateRestore(restoreId, { status: 'succeeded', phase: 'done', progressLabel: summary, verifiedBytes: totalBytes });
      this.log('info', '恢复完成：' + summary, { runId: restoreId, snapshotId: restore.snapshotId, targetId: restore.targetId, phase: 'done' });
      return;
    }
    const prepared = await this.prepareWorkspaceReplace(restoreId, objects);
    // 完整的「替换完成」需要停止服务后运行助手，因此这里如实报告为部分完成，
    // 绝不显示成「已恢复成功」而服务仍在使用旧连接。
    this.store.updateRestore(restoreId, {
      status: 'partial',
      phase: 'done',
      progressLabel: prepared.summary,
      verifiedBytes: totalBytes,
      preRestoreBackupPath: prepared.preRestoreBackupPath,
    });
    this.log('warn', prepared.summary, { runId: restoreId, snapshotId: restore.snapshotId, targetId: restore.targetId, phase: 'done', errorCode: 'backup_restore_manual_apply' });
  }

  /** 活动恢复：按逻辑包重组工程 ZIP，再走既有导入流程，始终新建活动副本。 */
  private async importActivities(objects: DecryptedObject[]): Promise<string> {
    const packages = objects.filter((object) => object.entry.kind === 'activity_package');
    const media = objects.filter((object) => object.entry.kind === 'activity_media');
    const store = new ActivityStore(this.options.database);
    const imported: string[] = [];
    for (const object of packages) {
      const parsed = JSON.parse(readFileSync(object.plaintextPath, 'utf8')) as {
        title?: string;
        entries?: Array<{ path?: string; data?: string }>;
      };
      const activityId = String(object.entry.resourceId ?? '');
      const mediaPrefix = 'activities/' + activityId + '/media/';
      const entries: ZipEntryInput[] = [];
      for (const entry of parsed.entries ?? []) {
        if (typeof entry.path !== 'string') continue;
        const mediaObject = media.find((candidate) => candidate.entry.relativePath === mediaPrefix + entry.path);
        if (mediaObject) entries.push({ path: entry.path, filePath: mediaObject.plaintextPath });
        else entries.push({ path: entry.path, data: Buffer.from(String(entry.data ?? ''), 'base64') });
      }
      const staged = await stageActivityImport(this.options.config, this.options.database, createZip(entries));
      const committed = await commitActivityImport(this.options.config, this.options.database, store, staged.jobId);
      const title = String((committed.activity as unknown as { title?: string }).title ?? parsed.title ?? activityId);
      imported.push(title);
    }
    return imported.length ? '已导入 ' + imported.length + ' 个活动副本：' + imported.join('、') : '该版本没有可导入的活动';
  }

  /**
   * 资料导入：只新增，不做双向同步。
   * 相同备份重复导入时按「标题 + 正文」识别并跳过；同名对象不静默覆盖。
   */
  private async importKnowledge(objects: DecryptedObject[]): Promise<string> {
    const packageObject = objects.find((object) => object.entry.kind === 'knowledge_package');
    if (!packageObject) return '该版本没有可导入的资料包';
    const parsed = JSON.parse(readFileSync(packageObject.plaintextPath, 'utf8')) as {
      notes?: Array<Record<string, unknown>>;
      noteKnowledge?: Array<Record<string, unknown>>;
      sources?: Array<Record<string, unknown>>;
      collections?: Array<Record<string, unknown>>;
      assets?: Array<Record<string, unknown>>;
    };
    const connection = this.options.database.connection;
    const now = nowIso();
    const noteIdMap = new Map<string, string>();
    const sourceIdMap = new Map<string, string>();
    let importedNotes = 0;
    let skippedNotes = 0;

    for (const source of parsed.sources ?? []) {
      const oldId = String(source.id ?? '');
      if (!oldId) continue;
      const existing = connection.prepare('SELECT id FROM knowledge_sources WHERE id=?').get(oldId) as { id: string } | undefined;
      if (existing) {
        sourceIdMap.set(oldId, existing.id);
        continue;
      }
      const newId = randomUUID();
      insertRow(connection, 'knowledge_sources', { ...source, id: newId, created_at: String(source.created_at ?? now), updated_at: now });
      sourceIdMap.set(oldId, newId);
    }

    for (const note of parsed.notes ?? []) {
      const oldId = String(note.id ?? '');
      const content = String(note.content_json ?? '[]');
      const duplicate = connection.prepare('SELECT id FROM creative_notes WHERE title=? AND content_json=? LIMIT 1')
        .get(String(note.title ?? ''), content) as { id: string } | undefined;
      if (duplicate) {
        skippedNotes += 1;
        noteIdMap.set(oldId, duplicate.id);
        continue;
      }
      const newId = randomUUID();
      insertRow(connection, 'creative_notes', { ...note, id: newId, created_at: String(note.created_at ?? now), updated_at: now });
      noteIdMap.set(oldId, newId);
      importedNotes += 1;
    }

    for (const meta of parsed.noteKnowledge ?? []) {
      const newNoteId = noteIdMap.get(String(meta.note_id ?? ''));
      if (!newNoteId) continue;
      if (connection.prepare('SELECT note_id FROM note_knowledge WHERE note_id=?').get(newNoteId)) continue;
      // 来源引用按新映射改写，避免导入后指向不存在的来源。
      const sources = parseJsonList(meta.sources_json).map((id) => sourceIdMap.get(id) ?? id);
      insertRow(connection, 'note_knowledge', {
        ...meta,
        note_id: newNoteId,
        sources_json: JSON.stringify(sources),
        created_at: String(meta.created_at ?? now),
        updated_at: now,
      });
    }

    let importedAssets = 0;
    mkdirSync(this.options.config.artifactDirectory, { recursive: true });
    for (const asset of parsed.assets ?? []) {
      const newNoteId = noteIdMap.get(String(asset.noteId ?? ''));
      if (!newNoteId) continue;
      const source = objects.find((candidate) => candidate.entry.kind === 'knowledge_asset' && candidate.entry.resourceId === String(asset.id ?? ''));
      if (!source) continue;
      const fileName = 'note-asset-' + randomUUID() + '-' + source.entry.relativePath.split('/').pop();
      const targetPath = resolve(this.options.config.artifactDirectory, fileName);
      copyFileSync(source.plaintextPath, targetPath);
      insertRow(connection, 'note_assets', {
        id: randomUUID(),
        note_id: newNoteId,
        local_path: targetPath,
        content_type: String(asset.contentType ?? 'application/octet-stream'),
        byte_size: statSync(targetPath).size,
        original_name: asset.originalName ?? null,
        created_at: now,
      });
      importedAssets += 1;
    }

    let importedCollections = 0;
    let skippedCollections = 0;
    for (const collection of parsed.collections ?? []) {
      const name = String(collection.name ?? '');
      if (!name) continue;
      if (connection.prepare('SELECT id FROM knowledge_collections WHERE name=? LIMIT 1').get(name)) {
        skippedCollections += 1;
        continue;
      }
      insertRow(connection, 'knowledge_collections', { ...collection, id: randomUUID(), created_at: String(collection.created_at ?? now), updated_at: now });
      importedCollections += 1;
    }
    return '资料导入完成：新增 ' + importedNotes + ' 篇、跳过重复 ' + skippedNotes + ' 篇、附件 ' + importedAssets + ' 个、搜集定义 ' + importedCollections + ' 个'
      + (skippedCollections ? '（跳过同名定义 ' + skippedCollections + ' 个）' : '');
  }

  /**
   * 完整工作区替换：只做准备工作。
   *
   * 先在服务仍可用时生成恢复前备份（失败就不继续），再把已解密的文件留在隔离目录，
   * 由「停止服务后运行」的恢复助手做替换并重建路径。这样不会出现
   * 「显示恢复成功、服务仍握着旧数据库连接」的假成功。
   */
  private async prepareWorkspaceReplace(restoreId: string, objects: DecryptedObject[]): Promise<{ summary: string; preRestoreBackupPath: string }> {
    const paths = backupPaths(this.options.config);
    const workDirectory = resolve(paths.restoreRoot, restoreId, 'workspace');
    mkdirSync(workDirectory, { recursive: true });
    const preRestoreDirectory = resolve(paths.restoreRoot, restoreId, 'pre-restore');
    const preRestore = await createPortableBackup({ config: this.options.config, destination: preRestoreDirectory });

    const plan = {
      schemaVersion: 1,
      type: 'sthstart-cloud-restore-plan',
      restoreId,
      createdAt: nowIso(),
      artifactDirectory: this.options.config.artifactDirectory,
      databases: [] as Array<{ sourcePath: string; targetPath: string; relativePath: string }>,
      artifacts: [] as Array<{ sourcePath: string; fileName: string; artifactId: string | null }>,
      noteAssets: [] as Array<{ sourcePath: string; fileName: string; assetId: string | null }>,
      preRestoreDirectory: preRestore.destination,
    };
    for (const object of objects) {
      const entry = object.entry;
      if (entry.storage === 'database') {
        plan.databases.push({
          sourcePath: object.plaintextPath,
          targetPath: entry.resourceId === 'narrative' ? this.options.config.narrativeDatabasePath : this.options.config.databasePath,
          relativePath: entry.relativePath,
        });
        continue;
      }
      const fileName = entry.relativePath.split('/').pop() ?? entry.remoteKey;
      if (entry.storage === 'note_asset') plan.noteAssets.push({ sourcePath: object.plaintextPath, fileName, assetId: entry.resourceId ?? null });
      else plan.artifacts.push({ sourcePath: object.plaintextPath, fileName, artifactId: entry.resourceId ?? null });
    }
    const planPath = resolve(workDirectory, 'apply-restore.json');
    writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf8');
    return {
      summary: '已准备完整工作区恢复：' + plan.databases.length + ' 个数据库、' + plan.artifacts.length + ' 个媒体、'
        + plan.noteAssets.length + ' 个笔记附件，恢复前备份在 ' + preRestore.destination
        + '。请在停止服务后运行恢复助手完成替换：npm run backup:apply-restore -- --plan ' + planPath + ' --confirm',
      preRestoreBackupPath: preRestore.destination,
    };
  }
}

function parseJsonList(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && Boolean(item)) : [];
  } catch {
    return [];
  }
}

/**
 * 按目标表的实际列写入一行：只带入表里存在的字段，
 * 这样导入不会因为备份版本与当前 schema 的细微差异而失败。
 */
function insertRow(connection: { prepare: (sql: string) => { all: () => unknown; run: (...values: never[]) => unknown } }, table: string, row: Record<string, unknown>): void {
  const columns = (connection.prepare('PRAGMA table_info(' + table + ')').all() as Array<{ name: string }>).map((column) => column.name);
  const keys = columns.filter((column) => row[column] !== undefined);
  if (!keys.length) throw new Error('backup_import_row_empty:' + table);
  connection.prepare('INSERT INTO ' + table + ' (' + keys.join(',') + ') VALUES (' + keys.map(() => '?').join(',') + ')')
    .run(...keys.map((key) => row[key]) as never[]);
}
