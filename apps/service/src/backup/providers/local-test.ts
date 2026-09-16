import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { BackupCapabilities } from '@sthstart/contracts';
import { computeFileSha256 } from '../../portable-backup.js';
import { BackupProviderError, type BackupProvider, type ProviderContext, type QuotaInfo, type RemoteObjectInfo, type UploadOutcome } from './types.js';

/**
 * 本地目录适配器：用于开发、自动化测试与模拟验证。
 *
 * 它按远端语义实现（对象不可变、按 ID 定位、清单最后发布），
 * 因此可以完整走通增量、校验与清理逻辑，而不需要真实网盘账号。
 */
export class LocalTestProvider implements BackupProvider {
  readonly kind = 'local_test' as const;
  readonly capabilities: BackupCapabilities;

  constructor(private readonly context: ProviderContext, options: { capabilities?: Partial<BackupCapabilities>; failUploads?: () => string | null } = {}) {
    this.capabilities = {
      resumableUpload: true,
      delete: true,
      remoteChecksum: true,
      list: true,
      ...options.capabilities,
    };
    this.failUploads = options.failUploads ?? (() => null);
  }

  /** 测试注入：返回非空字符串时该次上传失败（用于验证半成品与部分完成）。 */
  private readonly failUploads: () => string | null;

  private root() {
    const directory = this.context.directory;
    if (!directory) throw new BackupProviderError('backup_target_directory_missing', '本地测试目标没有配置目录。');
    return resolve(directory, this.context.rootPath || 'SthStart');
  }

  private vaultDirectory(vaultId: string) {
    return resolve(this.root(), vaultId);
  }

  private objectsDirectory(vaultId: string) {
    return resolve(this.vaultDirectory(vaultId), 'objects');
  }

  private snapshotsDirectory(vaultId: string) {
    return resolve(this.vaultDirectory(vaultId), 'snapshots');
  }

  async connect(): Promise<void> {
    const root = this.root();
    mkdirSync(root, { recursive: true });
    if (!existsSync(root)) throw new BackupProviderError('backup_target_unavailable', '本地测试目标目录不可写：' + root);
  }

  async ensureLayout(vaultId: string): Promise<void> {
    mkdirSync(this.objectsDirectory(vaultId), { recursive: true });
    mkdirSync(this.snapshotsDirectory(vaultId), { recursive: true });
  }

  private static async describe(filePath: string, remoteId: string): Promise<RemoteObjectInfo> {
    const size = statSync(filePath).size;
    return { remoteId, name: remoteId, size, checksum: await computeFileSha256(filePath), checksumAlgorithm: 'sha256' };
  }

  private listDirectory(directory: string): RemoteObjectInfo[] {
    if (!existsSync(directory)) return [];
    return readdirSync(directory).filter((name) => !name.endsWith('.part')).map((name) => {
      const filePath = resolve(directory, name);
      const stat = statSync(filePath);
      return {
        remoteId: name,
        name,
        size: stat.size,
        checksumAlgorithm: 'sha256' as const,
      };
    });
  }

  async listObjects(vaultId: string): Promise<RemoteObjectInfo[]> {
    return this.listDirectory(this.objectsDirectory(vaultId));
  }

  async listSnapshots(vaultId: string): Promise<RemoteObjectInfo[]> {
    return this.listDirectory(this.snapshotsDirectory(vaultId));
  }

  private async statInDirectory(directory: string, name: string): Promise<RemoteObjectInfo | null> {
    const filePath = resolve(directory, name);
    if (!existsSync(filePath)) return null;
    return LocalTestProvider.describe(filePath, name);
  }

  async statObject(vaultId: string, remoteKey: string): Promise<RemoteObjectInfo | null> {
    return this.statInDirectory(this.objectsDirectory(vaultId), remoteKey + '.bin');
  }

  async statSnapshot(vaultId: string, snapshotId: string): Promise<RemoteObjectInfo | null> {
    return this.statInDirectory(this.snapshotsDirectory(vaultId), snapshotId + '.bin');
  }

  private async upload(input: { vaultId: string; name: string; filePath: string; folder: 'objects' | 'snapshots' }): Promise<UploadOutcome> {
    const injected = this.failUploads();
    if (injected) throw new BackupProviderError(injected, '本地测试目标按配置拒绝了这次上传。', true);
    const directory = input.folder === 'objects' ? this.objectsDirectory(input.vaultId) : this.snapshotsDirectory(input.vaultId);
    mkdirSync(directory, { recursive: true });
    const targetPath = resolve(directory, input.name);
    const temporaryPath = targetPath + '.part';
    copyFileSync(input.filePath, temporaryPath);
    const expected = await computeFileSha256(input.filePath);
    const actual = await computeFileSha256(temporaryPath);
    if (expected !== actual) {
      rmSync(temporaryPath, { force: true });
      throw new BackupProviderError('backup_upload_corrupt', '上传后的密文与本地不一致，已删除半成品。', true);
    }
    // 与远端语义一致：只有完整写入后才以最终名字出现。
    renameSync(temporaryPath, targetPath);
    return { remoteId: input.name, size: statSync(targetPath).size, verified: true, verifyMethod: 'remote_checksum', checksum: expected };
  }

  async uploadObject(input: { vaultId: string; remoteKey: string; filePath: string; size: number }): Promise<UploadOutcome> {
    return this.upload({ vaultId: input.vaultId, name: input.remoteKey + '.bin', filePath: input.filePath, folder: 'objects' });
  }

  async publishSnapshot(input: { vaultId: string; snapshotId: string; filePath: string; size: number }): Promise<UploadOutcome> {
    return this.upload({ vaultId: input.vaultId, name: input.snapshotId + '.bin', filePath: input.filePath, folder: 'snapshots' });
  }

  async downloadObject(input: { vaultId: string; remoteKey: string; targetPath: string; remoteId?: string }): Promise<{ bytes: number }> {
    return this.download(resolve(this.objectsDirectory(input.vaultId), (input.remoteId ?? input.remoteKey) + (input.remoteId ? '' : '.bin')), input.targetPath);
  }

  async downloadSnapshot(input: { vaultId: string; snapshotId: string; targetPath: string; remoteId?: string }): Promise<{ bytes: number }> {
    return this.download(resolve(this.snapshotsDirectory(input.vaultId), (input.remoteId ?? input.snapshotId) + (input.remoteId ? '' : '.bin')), input.targetPath);
  }

  private download(sourcePath: string, targetPath: string): { bytes: number } {
    if (!existsSync(sourcePath)) throw new BackupProviderError('backup_remote_object_missing', '远端找不到该对象：' + sourcePath, false);
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
    return { bytes: statSync(targetPath).size };
  }

  async deleteRemote(input: { vaultId: string; remoteId: string }): Promise<boolean> {
    for (const directory of [this.objectsDirectory(input.vaultId), this.snapshotsDirectory(input.vaultId)]) {
      const target = resolve(directory, input.remoteId);
      if (existsSync(target)) {
        rmSync(target, { force: true });
        return true;
      }
    }
    return false;
  }

  async writeVaultHeader(vaultId: string, payload: string): Promise<RemoteObjectInfo> {
    const directory = this.vaultDirectory(vaultId);
    mkdirSync(directory, { recursive: true });
    const targetPath = resolve(directory, 'vault.json');
    writeFileSync(targetPath, payload, 'utf8');
    return { remoteId: 'vault.json', size: statSync(targetPath).size, checksum: createHash('sha256').update(payload).digest('hex'), checksumAlgorithm: 'sha256' };
  }

  async readVaultHeader(vaultId: string): Promise<string | null> {
    const targetPath = resolve(this.vaultDirectory(vaultId), 'vault.json');
    return existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : null;
  }

  async quota(): Promise<QuotaInfo | null> {
    return null;
  }
}
