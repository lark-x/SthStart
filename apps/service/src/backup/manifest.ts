import type { BackupManifest, BackupManifestObject, BackupScope } from '@sthstart/contracts';
import { BACKUP_FORMAT_VERSION } from './crypto.js';

/** 清单作为普通对象保存，因此也有自己的资源种类与逻辑路径。 */
export const MANIFEST_KIND = 'manifest';
export const MANIFEST_RELATIVE_PATH = 'manifest.json';

export interface ManifestInput {
  vaultId: string;
  snapshotId: string;
  deviceId: string;
  createdAt: string;
  scope: BackupScope;
  scopeDetail: { activityIds: string[]; works: string[] };
  appVersion: string;
  serviceSchemaVersion: number;
  narrativeSchemaVersion: number;
  description: string;
  objects: BackupManifestObject[];
  excluded: BackupManifest['excluded'];
}

/**
 * 清单必须列全本次恢复所需的对象，而不是「比上次多了什么」。
 * 因此它由捕获阶段的完整对象表生成，与增量上传无关。
 */
export function buildManifest(input: ManifestInput): BackupManifest {
  return { formatVersion: BACKUP_FORMAT_VERSION, ...input };
}

export function serializeManifest(manifest: BackupManifest): Buffer {
  return Buffer.from(JSON.stringify(manifest), 'utf8');
}

/** 清单路径校验：恢复时要按这些相对路径写回文件，必须拒绝越界写法。 */
export function assertSafeRelativePath(relativePath: string): void {
  if (!relativePath || relativePath.startsWith('/') || relativePath.includes('\\')) throw new Error('backup_manifest_unsafe_path');
  if (relativePath.split('/').some((segment) => segment === '..' || segment === '')) throw new Error('backup_manifest_unsafe_path');
  if (/^[A-Za-z]:/.test(relativePath)) throw new Error('backup_manifest_unsafe_path');
}

/**
 * 解析并校验清单。格式版本高于本应用支持版本时明确拒绝，
 * 不能把新格式硬塞进旧 schema。
 */
export function parseManifest(input: Uint8Array | string): BackupManifest {
  const text = typeof input === 'string' ? input : Buffer.from(input).toString('utf8');
  let parsed: BackupManifest;
  try {
    parsed = JSON.parse(text) as BackupManifest;
  } catch {
    throw new Error('backup_manifest_invalid');
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.objects)) throw new Error('backup_manifest_invalid');
  if (typeof parsed.formatVersion !== 'number' || typeof parsed.snapshotId !== 'string' || typeof parsed.vaultId !== 'string') {
    throw new Error('backup_manifest_invalid');
  }
  if (parsed.formatVersion > BACKUP_FORMAT_VERSION) throw new Error('backup_format_too_new');
  for (const object of parsed.objects) {
    if (!object || typeof object !== 'object') throw new Error('backup_manifest_invalid');
    assertSafeRelativePath(String(object.relativePath));
    if (typeof object.cipherSha256 !== 'string' || typeof object.remoteKey !== 'string') throw new Error('backup_manifest_invalid');
    if (!Array.isArray(object.referencedBy)) throw new Error('backup_manifest_invalid');
  }
  if (!Array.isArray(parsed.excluded)) parsed.excluded = [];
  return parsed;
}

/** 清单与对象的逻辑路径汇总，用于恢复预览与诊断。 */
export function manifestSummary(manifest: BackupManifest) {
  return {
    objectCount: manifest.objects.length,
    contentBytes: manifest.objects.reduce((sum, object) => sum + Number(object.plaintextBytes || 0), 0),
    mediaCount: manifest.objects.filter((object) => object.storage !== 'database' && object.kind !== MANIFEST_KIND).length,
    databaseCount: manifest.objects.filter((object) => object.storage === 'database').length,
    exclusions: manifest.excluded.map((entry) => entry.relativePath + '（' + entry.reason + '）'),
  };
}
