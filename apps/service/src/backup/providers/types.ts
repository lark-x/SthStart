import type { BackupCapabilities, BackupTargetKind } from '@sthstart/contracts';

/**
 * 校验方式。远端校验值与本地密文算法一致时才能叫 remote_checksum；
 * 没有可信内容校验值时，要么下载后算 hash（downloaded_hash），
 * 要么如实标注「已上传，完整校验待完成」（size_only），不能只看大小就说字节一致。
 */
export type VerifyMethod = 'remote_checksum' | 'downloaded_hash' | 'size_only';

export interface RemoteObjectInfo {
  remoteId: string;
  /** 远端文件名（不含目录）。新设备要靠它认出清单对应的版本。 */
  name?: string;
  size: number;
  checksum?: string;
  checksumAlgorithm?: 'sha256' | 'md5' | 'quickxor' | 'crc32' | 'none';
}

export interface UploadOutcome {
  remoteId: string;
  size: number;
  verified: boolean;
  verifyMethod: VerifyMethod;
  checksum?: string;
}

export interface QuotaInfo {
  totalBytes: number | null;
  usedBytes: number | null;
}

/**
 * 网盘适配器：职责明确，不让业务层依赖 CLI 文本或某个平台的文件对象。
 * 能力用结构化结果表达（是否支持可恢复上传、删除、远端校验、列举）。
 */
export interface BackupProvider {
  readonly kind: BackupTargetKind;
  readonly capabilities: BackupCapabilities;
  /** 验证授权与根目录可写；失败时抛出结构化错误。 */
  connect(): Promise<void>;
  ensureLayout(vaultId: string): Promise<void>;
  listObjects(vaultId: string): Promise<RemoteObjectInfo[]>;
  listSnapshots(vaultId: string): Promise<RemoteObjectInfo[]>;
  statObject(vaultId: string, remoteKey: string): Promise<RemoteObjectInfo | null>;
  uploadObject(input: { vaultId: string; remoteKey: string; filePath: string; size: number }): Promise<UploadOutcome>;
  downloadObject(input: { vaultId: string; remoteKey: string; targetPath: string; remoteId?: string }): Promise<{ bytes: number }>;
  publishSnapshot(input: { vaultId: string; snapshotId: string; filePath: string; size: number }): Promise<UploadOutcome>;
  statSnapshot(vaultId: string, snapshotId: string): Promise<RemoteObjectInfo | null>;
  downloadSnapshot(input: { vaultId: string; snapshotId: string; targetPath: string; remoteId?: string }): Promise<{ bytes: number }>;
  deleteRemote(input: { vaultId: string; remoteId: string }): Promise<boolean>;
  writeVaultHeader(vaultId: string, payload: string): Promise<RemoteObjectInfo>;
  readVaultHeader(vaultId: string): Promise<string | null>;
  quota(): Promise<QuotaInfo | null>;
}

export interface ProviderContext {
  kind: BackupTargetKind;
  /** 远端根目录（逻辑路径或平台目录 ID）。 */
  rootPath: string;
  accountLabel: string;
  /** 平台凭据（JSON 字符串），已从 SecretStore 取出；不写日志。 */
  credential: string | null;
  /** local_test 的本地目录。 */
  directory: string | null;
  fetcher: typeof fetch;
  /** 超过该大小的对象跳过下载校验，改用 size_only 并如实标注。 */
  downloadVerifyLimitBytes: number;
}

/** 结构化错误：业务层按 code 区分登录失效、空间不足、网络中断等。 */
export class BackupProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'BackupProviderError';
  }
}

/** 凭据错误不无限重试；网络与服务端错误有限重试加退避。 */
export function classifyFailure(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof BackupProviderError) return { code: error.code, message: error.message, retryable: error.retryable };
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|fetch failed/i.test(message)) {
    return { code: 'backup_network', message: '网络中断：' + message, retryable: true };
  }
  if (/ENOSPC|no space left/i.test(message)) return { code: 'backup_disk_full', message: '本地空间不足：' + message, retryable: false };
  return { code: 'backup_provider_error', message, retryable: false };
}

export function parseCredential(credential: string | null): Record<string, unknown> {
  if (!credential) return {};
  try {
    const parsed = JSON.parse(credential) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function detectContentChecksum(algorithm: string | undefined, value: string | undefined): { algorithm: 'sha256' | 'md5' | 'quickxor' | 'crc32' | 'none'; value?: string } {
  if (!value) return { algorithm: 'none' };
  const normalized = (algorithm ?? '').toLowerCase();
  if (normalized.includes('sha256')) return { algorithm: 'sha256', value: value.toLowerCase() };
  if (normalized.includes('md5')) return { algorithm: 'md5', value: value.toLowerCase() };
  if (normalized.includes('quickxor')) return { algorithm: 'quickxor', value: value.toLowerCase() };
  if (normalized.includes('crc')) return { algorithm: 'crc32', value: value.toLowerCase() };
  return { algorithm: 'none' };
}
