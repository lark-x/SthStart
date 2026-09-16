import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BackupCapabilities } from '@sthstart/contracts';
import { computeFileSha256 } from '../../portable-backup.js';
import { asBodyInit, downloadToFile, resumableUpload } from './resumable.js';
import { refreshAccessToken, type OAuthEndpoints, type TokenSet } from './oauth.js';
import {
  BackupProviderError, parseCredential, type BackupProvider, type ProviderContext, type QuotaInfo,
  type RemoteObjectInfo, type UploadOutcome, type VerifyMethod,
} from './types.js';

export function oneDriveEndpoints(redirectUri: string): OAuthEndpoints {
  return {
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    // 应用专用文件夹只需要 AppFolder 范围，个人账号也能用，不要求组织管理员后台权限。
    scopes: ['offline_access', 'Files.ReadWrite.AppFolder'],
    redirectUri,
  };
}

const GRAPH = 'https://graph.microsoft.com/v1.0';
/** Graph 要求除最后一片外使用 320 KiB 的整数倍；与 Google 分开配置，不共用一个写死值。 */
export const ONEDRIVE_CHUNK_SIZE = 320 * 1024 * 10;

interface DriveItem {
  id: string;
  name?: string;
  size?: number;
  file?: { hashes?: { quickXorHash?: string; sha1Hash?: string } };
}

/**
 * OneDrive 适配器（Microsoft Graph + 用户授权）。
 *
 * - 默认写入应用专用文件夹（approot），不动用户其它文件。
 * - 大文件走上传会话，使用与 Google 不同的分片对齐参数。
 * - Graph 提供 quickXorHash/sha1Hash，与本地密文的 SHA-256 不同算法，
 *   因此不冒领 remote_checksum：小对象下载校验，大对象如实标注待完成。
 */
export class OneDriveProvider implements BackupProvider {
  readonly kind = 'onedrive' as const;
  readonly capabilities: BackupCapabilities = { resumableUpload: true, delete: true, remoteChecksum: false, list: true };

  private tokens: TokenSet | null = null;

  constructor(private readonly context: ProviderContext) {}

  private credential() {
    return parseCredential(this.context.credential);
  }

  private endpoints() {
    const redirectUri = String(this.credential().redirectUri ?? 'http://127.0.0.1:4100/api/v1/admin/backups/oauth/onedrive/callback');
    return oneDriveEndpoints(redirectUri);
  }

  private async accessToken(): Promise<string> {
    if (this.tokens && this.tokens.expiresAt > Date.now()) return this.tokens.accessToken;
    const credential = this.credential();
    const refreshToken = typeof credential.refreshToken === 'string' ? credential.refreshToken : '';
    const clientId = typeof credential.clientId === 'string' ? credential.clientId : '';
    if (!refreshToken || !clientId) throw new BackupProviderError('backup_auth_required', '尚未连接 OneDrive，请先在设置里完成授权。', false);
    this.tokens = await refreshAccessToken(this.endpoints(), {
      fetcher: this.context.fetcher,
      clientId,
      ...(typeof credential.clientSecret === 'string' && credential.clientSecret ? { clientSecret: credential.clientSecret } : {}),
      refreshToken,
    });
    return this.tokens.accessToken;
  }

  private async request(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const headers = new Headers(init.headers ?? {});
    headers.set('authorization', 'Bearer ' + await this.accessToken());
    const response = await this.context.fetcher(url, { ...init, headers });
    if (response.status === 401 && retry) {
      this.tokens = null;
      return this.request(url, init, false);
    }
    if (response.status === 401) throw new BackupProviderError('backup_auth_expired', 'OneDrive 登录已失效，请重新连接。', false);
    if (response.status === 507 || response.status === 413) throw new BackupProviderError('backup_quota_exceeded', 'OneDrive 空间不足。', false);
    if (response.status === 429 || response.status >= 500) throw new BackupProviderError('backup_network', 'OneDrive 暂时不可用（HTTP ' + response.status + '）。', true);
    if (response.status === 403) throw new BackupProviderError('backup_quota_exceeded', 'OneDrive 拒绝了这次写入，可能是空间或权限限制。', false);
    return response;
  }

  /** 应用专用文件夹的相对路径；根目录由 rootPath 指定（默认 approot）。 */
  private rootSegment(): { kind: 'approot' | 'id'; value: string } {
    const configured = (this.context.rootPath || 'approot').trim();
    if (!configured || configured === 'approot') return { kind: 'approot', value: '' };
    return { kind: 'id', value: configured };
  }

  private itemPath(vaultId: string, folder: 'objects' | 'snapshots' | null, fileName?: string): string {
    const root = this.rootSegment();
    const segments = [vaultId];
    if (folder) segments.push(folder);
    if (fileName) segments.push(fileName);
    const path = segments.join('/');
    return root.kind === 'approot' ? GRAPH + '/me/drive/special/approot:/' + path : GRAPH + '/me/drive/items/' + root.value + ':/' + path;
  }

  async connect(): Promise<void> {
    const root = this.rootSegment();
    const url = root.kind === 'approot' ? GRAPH + '/me/drive/special/approot' : GRAPH + '/me/drive/items/' + root.value;
    const response = await this.request(url);
    if (!response.ok) throw new BackupProviderError('backup_auth_required', '无法访问 OneDrive 应用专用文件夹，请重新连接。', false);
  }

  async ensureLayout(vaultId: string): Promise<void> {
    for (const folder of ['objects', 'snapshots'] as const) {
      const response = await this.request(this.itemPath(vaultId, folder), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: folder, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
      });
      // 已存在时返回 409：目录已就绪，不算失败。
      if (!response.ok && response.status !== 409 && response.status !== 400) {
        throw new BackupProviderError('backup_provider_error', '创建 OneDrive 目录失败（HTTP ' + response.status + '）。', true);
      }
    }
  }

  private async listFolder(vaultId: string, folder: 'objects' | 'snapshots'): Promise<RemoteObjectInfo[]> {
    const out: RemoteObjectInfo[] = [];
    let next: string | null = this.itemPath(vaultId, folder) + '/children?$select=id,name,size,file&$top=200';
    let guard = 0;
    while (next && guard < 50) {
      guard += 1;
      const response = await this.request(next);
      if (response.status === 404) return out;
      const payload = await response.json() as { value?: DriveItem[]; '@odata.nextLink'?: string };
      for (const item of payload.value ?? []) {
        const quickXor = item.file?.hashes?.quickXorHash;
        out.push({
          remoteId: item.id,
          ...(item.name ? { name: item.name } : {}),
          size: Number(item.size ?? 0),
          ...(quickXor ? { checksum: quickXor.toLowerCase(), checksumAlgorithm: 'quickxor' as const } : { checksumAlgorithm: 'none' as const }),
        });
      }
      next = payload['@odata.nextLink'] ?? null;
    }
    return out;
  }

  async listObjects(vaultId: string): Promise<RemoteObjectInfo[]> {
    return this.listFolder(vaultId, 'objects');
  }

  async listSnapshots(vaultId: string): Promise<RemoteObjectInfo[]> {
    return this.listFolder(vaultId, 'snapshots');
  }

  private async statItem(url: string): Promise<RemoteObjectInfo | null> {
    const response = await this.request(url + '?$select=id,name,size,file');
    if (response.status === 404) return null;
    if (!response.ok) return null;
    const item = await response.json() as DriveItem;
    const quickXor = item.file?.hashes?.quickXorHash;
    return {
      remoteId: item.id,
      size: Number(item.size ?? 0),
      ...(quickXor ? { checksum: quickXor.toLowerCase(), checksumAlgorithm: 'quickxor' as const } : { checksumAlgorithm: 'none' as const }),
    };
  }

  async statObject(vaultId: string, remoteKey: string): Promise<RemoteObjectInfo | null> {
    return this.statItem(this.itemPath(vaultId, 'objects', remoteKey + '.bin'));
  }

  async statSnapshot(vaultId: string, snapshotId: string): Promise<RemoteObjectInfo | null> {
    return this.statItem(this.itemPath(vaultId, 'snapshots', snapshotId + '.bin'));
  }

  private async createSession(url: string): Promise<string> {
    const response = await this.request(url + '/createUploadSession', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'fail' } }),
    });
    if (!response.ok) throw new BackupProviderError('backup_provider_error', '创建 OneDrive 上传会话失败（HTTP ' + response.status + '）。', true);
    const payload = await response.json() as { uploadUrl?: string };
    if (!payload.uploadUrl) throw new BackupProviderError('backup_provider_error', 'OneDrive 未返回上传会话地址。', true);
    // 上传会话 URL 自带授权，按秘密处理：只保留在内存。
    return payload.uploadUrl;
  }

  private async verifyUpload(input: { remoteId: string; filePath: string; size: number }): Promise<{ verified: boolean; verifyMethod: VerifyMethod }> {
    const response = await this.request(GRAPH + '/me/drive/items/' + input.remoteId + '?$select=id,size');
    const item = await response.json() as DriveItem;
    if (Number(item.size ?? -1) !== input.size) throw new BackupProviderError('backup_upload_size_mismatch', '远端对象大小与本地不一致，本次不算完成。', true);
    if (input.size > this.context.downloadVerifyLimitBytes) return { verified: false, verifyMethod: 'size_only' };
    const directory = mkdtempSync(join(tmpdir(), 'sthstart-verify-'));
    const target = join(directory, 'verify.bin');
    try {
      await this.downloadRemote(input.remoteId, target);
      if (await computeFileSha256(input.filePath) !== await computeFileSha256(target)) {
        throw new BackupProviderError('backup_upload_corrupt', '下载回读的密文与本地不一致，已要求重新上传。', true);
      }
      return { verified: true, verifyMethod: 'downloaded_hash' };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  private async upload(input: { url: string; filePath: string; size: number }): Promise<UploadOutcome> {
    const sessionUrl = await this.createSession(input.url);
    const result = await resumableUpload({
      fetcher: this.context.fetcher,
      sessionUrl,
      filePath: input.filePath,
      size: input.size,
      chunkSize: ONEDRIVE_CHUNK_SIZE,
      contentType: 'application/octet-stream',
      recreateSession: () => this.createSession(input.url),
    });
    const remoteId = result.remoteId || (await this.statItem(input.url))?.remoteId || '';
    if (!remoteId) throw new BackupProviderError('backup_provider_error', '上传回执缺失且远端未找到对象。', true);
    const verification = await this.verifyUpload({ remoteId, filePath: input.filePath, size: input.size });
    return { remoteId, size: input.size, verified: verification.verified, verifyMethod: verification.verifyMethod };
  }

  async uploadObject(input: { vaultId: string; remoteKey: string; filePath: string; size: number }): Promise<UploadOutcome> {
    return this.upload({ url: this.itemPath(input.vaultId, 'objects', input.remoteKey + '.bin'), filePath: input.filePath, size: input.size });
  }

  async publishSnapshot(input: { vaultId: string; snapshotId: string; filePath: string; size: number }): Promise<UploadOutcome> {
    return this.upload({ url: this.itemPath(input.vaultId, 'snapshots', input.snapshotId + '.bin'), filePath: input.filePath, size: input.size });
  }

  private async downloadRemote(remoteId: string, targetPath: string): Promise<{ bytes: number }> {
    const response = await this.request(GRAPH + '/me/drive/items/' + remoteId + '/content');
    if (!response.ok) throw new BackupProviderError('backup_remote_object_missing', '下载远端对象失败（HTTP ' + response.status + '）。', true);
    return downloadToFile(response, targetPath);
  }

  async downloadObject(input: { vaultId: string; remoteKey: string; targetPath: string; remoteId?: string }): Promise<{ bytes: number }> {
    const remoteId = input.remoteId ?? (await this.statObject(input.vaultId, input.remoteKey))?.remoteId;
    if (!remoteId) throw new BackupProviderError('backup_remote_object_missing', '远端没有这个对象，可能已被人为删除。', false);
    return this.downloadRemote(remoteId, input.targetPath);
  }

  async downloadSnapshot(input: { vaultId: string; snapshotId: string; targetPath: string; remoteId?: string }): Promise<{ bytes: number }> {
    const remoteId = input.remoteId ?? (await this.statSnapshot(input.vaultId, input.snapshotId))?.remoteId;
    if (!remoteId) throw new BackupProviderError('backup_remote_object_missing', '远端没有这个版本的清单。', false);
    return this.downloadRemote(remoteId, input.targetPath);
  }

  async deleteRemote(input: { vaultId: string; remoteId: string }): Promise<boolean> {
    const response = await this.request(GRAPH + '/me/drive/items/' + input.remoteId, { method: 'DELETE' });
    return response.ok || response.status === 404;
  }

  async writeVaultHeader(vaultId: string, payload: string): Promise<RemoteObjectInfo> {
    const url = this.itemPath(vaultId, 'objects', 'vault.json');
    const bytes = Buffer.from(payload, 'utf8');
    const response = await this.request(url + ':/content', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: asBodyInit(bytes),
    });
    if (!response.ok) throw new BackupProviderError('backup_provider_error', '更新 OneDrive 仓库头失败（HTTP ' + response.status + '）。', true);
    const item = await response.json() as DriveItem;
    return { remoteId: item.id, size: bytes.length, checksumAlgorithm: 'none' };
  }

  async readVaultHeader(vaultId: string): Promise<string | null> {
    const found = await this.statItem(this.itemPath(vaultId, 'objects', 'vault.json'));
    if (!found) return null;
    const response = await this.request(GRAPH + '/me/drive/items/' + found.remoteId + '/content');
    return response.ok ? response.text() : null;
  }

  async quota(): Promise<QuotaInfo | null> {
    const response = await this.request(GRAPH + '/me/drive?$select=quota(total,used)');
    if (!response.ok) return null;
    const payload = await response.json() as { quota?: { total?: number; used?: number } };
    if (!payload.quota) return null;
    return { totalBytes: payload.quota.total ?? null, usedBytes: payload.quota.used ?? null };
  }
}
