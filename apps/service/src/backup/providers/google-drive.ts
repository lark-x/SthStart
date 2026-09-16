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

export function googleDriveEndpoints(redirectUri: string): OAuthEndpoints {
  return {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    // 只用官方端点；个人应用由用户配置自己的 client ID，代码里没有虚构的公共 secret。
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    redirectUri,
  };
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
/** 除最后一片外必须使用 256 KiB 的整数倍。 */
export const GOOGLE_CHUNK_SIZE = 1_048_576;

interface DriveFile {
  id: string;
  name?: string;
  size?: string;
  md5Checksum?: string;
  modifiedTime?: string;
}

/**
 * Google Drive 适配器（官方 Drive API v3 + 用户 OAuth）。
 *
 * - 默认写在应用专用目录（drive.file 授权范围下的 appDataFolder），不碰用户其它文件。
 * - 使用可恢复上传会话；会话过期时重建。
 * - 远端有 MD5 校验值，但与本地密文的 SHA-256 不同算法，因此不冒领 remote_checksum：
 *   小对象下载后算 SHA-256（downloaded_hash），大对象如实标注完整校验待完成（size_only）。
 */
export class GoogleDriveProvider implements BackupProvider {
  readonly kind = 'google_drive' as const;
  readonly capabilities: BackupCapabilities = { resumableUpload: true, delete: true, remoteChecksum: false, list: true };

  private tokens: TokenSet | null = null;
  private readonly folderCache = new Map<string, string>();

  constructor(private readonly context: ProviderContext) {}

  private credential() {
    return parseCredential(this.context.credential);
  }

  private endpoints() {
    const redirectUri = String(this.credential().redirectUri ?? 'http://127.0.0.1:4100/api/v1/admin/backups/oauth/google_drive/callback');
    return googleDriveEndpoints(redirectUri);
  }

  /** 访问令牌：优先复用未过期的内存令牌，否则用 refresh token 刷新。 */
  private async accessToken(): Promise<string> {
    if (this.tokens && this.tokens.expiresAt > Date.now()) return this.tokens.accessToken;
    const credential = this.credential();
    const refreshToken = typeof credential.refreshToken === 'string' ? credential.refreshToken : '';
    const clientId = typeof credential.clientId === 'string' ? credential.clientId : '';
    if (!refreshToken || !clientId) throw new BackupProviderError('backup_auth_required', '尚未连接 Google Drive，请先在设置里完成授权。', false);
    this.tokens = await refreshAccessToken(this.endpoints(), {
      fetcher: this.context.fetcher,
      clientId,
      ...(typeof credential.clientSecret === 'string' && credential.clientSecret ? { clientSecret: credential.clientSecret } : {}),
      refreshToken,
    });
    return this.tokens.accessToken;
  }

  private async request(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const token = await this.accessToken();
    const headers = new Headers(init.headers ?? {});
    headers.set('authorization', 'Bearer ' + token);
    const response = await this.context.fetcher(url, { ...init, headers });
    if (response.status === 401 && retry) {
      this.tokens = null;
      return this.request(url, init, false);
    }
    if (response.status === 401) throw new BackupProviderError('backup_auth_expired', 'Google Drive 登录已失效，请重新连接。', false);
    if (response.status === 403) {
      const text = await response.text();
      if (/storageQuota|quotaExceeded/i.test(text)) throw new BackupProviderError('backup_quota_exceeded', 'Google Drive 空间不足。', false);
      throw new BackupProviderError('backup_auth_expired', 'Google Drive 拒绝了这次请求，可能是授权范围或权限已变化。', false);
    }
    if (response.status === 429 || response.status >= 500) throw new BackupProviderError('backup_network', 'Google Drive 暂时不可用（HTTP ' + response.status + '）。', true);
    return response;
  }

  private async rootFolderId(): Promise<string> {
    const configured = (this.context.rootPath || 'appDataFolder').trim();
    if (!configured || configured === 'appDataFolder') return 'appDataFolder';
    const cached = this.folderCache.get('root:' + configured);
    if (cached) return cached;
    const escaped = configured.replaceAll("'", "\\'");
    const response = await this.request(DRIVE_API + '/files?fields=files(id,name,mimeType)&q=' + encodeURIComponent(
      "name = '" + escaped + "' and mimeType = '" + FOLDER_MIME + "' and trashed = false",
    ));
    const payload = await response.json() as { files?: DriveFile[] };
    const found = payload.files?.[0];
    if (found) {
      this.folderCache.set('root:' + configured, found.id);
      return found.id;
    }
    const created = await this.createFolder(configured, 'root');
    this.folderCache.set('root:' + configured, created);
    return created;
  }

  private async createFolder(name: string, parentId: string): Promise<string> {
    const response = await this.request(DRIVE_API + '/files?fields=id', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    const payload = await response.json() as DriveFile;
    if (!payload.id) throw new BackupProviderError('backup_provider_error', '创建 Google Drive 目录失败。', true);
    return payload.id;
  }

  private async folder(name: string, parentId: string): Promise<string> {
    const key = parentId + '/' + name;
    const cached = this.folderCache.get(key);
    if (cached) return cached;
    const escaped = name.replaceAll("'", "\\'");
    const response = await this.request(DRIVE_API + '/files?fields=files(id)&q=' + encodeURIComponent(
      "name = '" + escaped + "' and mimeType = '" + FOLDER_MIME + "' and '" + parentId + "' in parents and trashed = false",
    ));
    const payload = await response.json() as { files?: DriveFile[] };
    const id = payload.files?.[0]?.id ?? await this.createFolder(name, parentId);
    this.folderCache.set(key, id);
    return id;
  }

  private async vaultFolders(vaultId: string): Promise<{ objects: string; snapshots: string }> {
    const root = await this.rootFolderId();
    const vault = await this.folder(vaultId, root);
    return { objects: await this.folder('objects', vault), snapshots: await this.folder('snapshots', vault) };
  }

  async connect(): Promise<void> {
    const response = await this.request(DRIVE_API + '/about?fields=user(emailAddress,displayName)');
    if (!response.ok) throw new BackupProviderError('backup_provider_error', '无法读取 Google Drive 账号信息。', true);
  }

  async ensureLayout(vaultId: string): Promise<void> {
    await this.vaultFolders(vaultId);
  }

  private async listFolder(folderId: string): Promise<RemoteObjectInfo[]> {
    const out: RemoteObjectInfo[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(DRIVE_API + '/files');
      url.searchParams.set('fields', 'nextPageToken,files(id,name,size,md5Checksum,modifiedTime)');
      url.searchParams.set('q', "'" + folderId + "' in parents and trashed = false");
      url.searchParams.set('pageSize', '200');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await this.request(url.toString());
      const payload = await response.json() as { files?: DriveFile[]; nextPageToken?: string };
      for (const file of payload.files ?? []) {
        out.push({
          remoteId: file.id,
          ...(file.name ? { name: file.name } : {}),
          size: Number(file.size ?? 0),
          ...(file.md5Checksum ? { checksum: file.md5Checksum.toLowerCase(), checksumAlgorithm: 'md5' as const } : { checksumAlgorithm: 'none' as const }),
        });
      }
      pageToken = payload.nextPageToken;
    } while (pageToken);
    return out;
  }

  async listObjects(vaultId: string): Promise<RemoteObjectInfo[]> {
    const folders = await this.vaultFolders(vaultId);
    return this.listFolder(folders.objects);
  }

  async listSnapshots(vaultId: string): Promise<RemoteObjectInfo[]> {
    const folders = await this.vaultFolders(vaultId);
    return this.listFolder(folders.snapshots);
  }

  private async findByKey(folderId: string, fileName: string): Promise<DriveFile | null> {
    const escaped = fileName.replaceAll("'", "\\'");
    const response = await this.request(DRIVE_API + '/files?fields=files(id,name,size,md5Checksum)&q=' + encodeURIComponent(
      "name = '" + escaped + "' and '" + folderId + "' in parents and trashed = false",
    ));
    const payload = await response.json() as { files?: DriveFile[] };
    return payload.files?.[0] ?? null;
  }

  async statObject(vaultId: string, remoteKey: string): Promise<RemoteObjectInfo | null> {
    const folders = await this.vaultFolders(vaultId);
    const found = await this.findByKey(folders.objects, remoteKey + '.bin');
    if (!found) return null;
    return {
      remoteId: found.id,
      size: Number(found.size ?? 0),
      ...(found.md5Checksum ? { checksum: found.md5Checksum.toLowerCase(), checksumAlgorithm: 'md5' as const } : { checksumAlgorithm: 'none' as const }),
    };
  }

  async statSnapshot(vaultId: string, snapshotId: string): Promise<RemoteObjectInfo | null> {
    const folders = await this.vaultFolders(vaultId);
    const found = await this.findByKey(folders.snapshots, snapshotId + '.bin');
    if (!found) return null;
    return { remoteId: found.id, size: Number(found.size ?? 0), checksumAlgorithm: 'none' };
  }

  private async createSession(input: { folderId: string; fileName: string; size: number }): Promise<string> {
    const response = await this.request(DRIVE_UPLOAD + '/files?uploadType=resumable&fields=id,name,size', {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-type': 'application/octet-stream',
        'x-upload-content-length': String(input.size),
      },
      body: JSON.stringify({ name: input.fileName, parents: [input.folderId] }),
    });
    const sessionUrl = response.headers.get('location');
    if (!sessionUrl) throw new BackupProviderError('backup_provider_error', 'Google Drive 未返回上传会话地址。', true);
    // 会话 URL 本身带授权，按秘密处理：只放内存，不写日志、不入库。
    return sessionUrl;
  }

  /** 上传后校验：大小必须一致；小对象再下载算 SHA-256，大对象如实标注待完成。 */
  private async verifyUpload(input: { remoteId: string; filePath: string; size: number }): Promise<{ verified: boolean; verifyMethod: VerifyMethod }> {
    const remote = await this.request(DRIVE_API + '/files/' + input.remoteId + '?fields=id,size,md5Checksum');
    const payload = await remote.json() as DriveFile;
    if (Number(payload.size ?? -1) !== input.size) throw new BackupProviderError('backup_upload_size_mismatch', '远端对象大小与本地不一致，本次不算完成。', true);
    if (input.size > this.context.downloadVerifyLimitBytes) return { verified: false, verifyMethod: 'size_only' };
    const directory = mkdtempSync(join(tmpdir(), 'sthstart-verify-'));
    const target = join(directory, 'verify.bin');
    try {
      await this.downloadRemote(input.remoteId, target);
      const [expected, actual] = [await computeFileSha256(input.filePath), await computeFileSha256(target)];
      if (expected !== actual) throw new BackupProviderError('backup_upload_corrupt', '下载回读的密文与本地不一致，已要求重新上传。', true);
      return { verified: true, verifyMethod: 'downloaded_hash' };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  private async upload(input: { vaultId: string; folderId: string; fileName: string; filePath: string; size: number }): Promise<UploadOutcome> {
    const sessionUrl = await this.createSession({ folderId: input.folderId, fileName: input.fileName, size: input.size });
    const result = await resumableUpload({
      fetcher: this.context.fetcher,
      sessionUrl,
      filePath: input.filePath,
      size: input.size,
      chunkSize: GOOGLE_CHUNK_SIZE,
      contentType: 'application/octet-stream',
      recreateSession: () => this.createSession({ folderId: input.folderId, fileName: input.fileName, size: input.size }),
    });
    if (!result.remoteId) {
      const found = await this.findByKey(input.folderId, input.fileName);
      if (!found) throw new BackupProviderError('backup_provider_error', '上传回执缺失且远端未找到对象。', true);
      result.remoteId = found.id;
    }
    const verification = await this.verifyUpload({ remoteId: result.remoteId, filePath: input.filePath, size: input.size });
    return {
      remoteId: result.remoteId,
      size: input.size,
      verified: verification.verified,
      verifyMethod: verification.verifyMethod,
    };
  }

  async uploadObject(input: { vaultId: string; remoteKey: string; filePath: string; size: number }): Promise<UploadOutcome> {
    const folders = await this.vaultFolders(input.vaultId);
    return this.upload({ vaultId: input.vaultId, folderId: folders.objects, fileName: input.remoteKey + '.bin', filePath: input.filePath, size: input.size });
  }

  async publishSnapshot(input: { vaultId: string; snapshotId: string; filePath: string; size: number }): Promise<UploadOutcome> {
    const folders = await this.vaultFolders(input.vaultId);
    return this.upload({ vaultId: input.vaultId, folderId: folders.snapshots, fileName: input.snapshotId + '.bin', filePath: input.filePath, size: input.size });
  }

  private async downloadRemote(remoteId: string, targetPath: string): Promise<{ bytes: number }> {
    const response = await this.request(DRIVE_API + '/files/' + remoteId + '?alt=media');
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
    const response = await this.request(DRIVE_API + '/files/' + input.remoteId, { method: 'DELETE' });
    return response.ok || response.status === 404;
  }

  async writeVaultHeader(vaultId: string, payload: string): Promise<RemoteObjectInfo> {
    const folders = await this.vaultFolders(vaultId);
    const existing = await this.findByKey(folders.objects, 'vault.json');
    const bytes = Buffer.from(payload, 'utf8');
    if (existing) {
      const response = await this.request(DRIVE_UPLOAD + '/files/' + existing.id + '?uploadType=media', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: asBodyInit(bytes),
      });
      if (!response.ok) throw new BackupProviderError('backup_provider_error', '更新远端仓库头失败。', true);
      return { remoteId: existing.id, size: bytes.length, checksumAlgorithm: 'none' };
    }
    const boundary = 'sthstart' + Date.now().toString(36);
    const metadata = JSON.stringify({ name: 'vault.json', parents: [folders.objects] });
    const body = Buffer.concat([
      Buffer.from('--' + boundary + '\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n' + metadata + '\r\n'),
      Buffer.from('--' + boundary + '\r\ncontent-type: application/json\r\n\r\n'),
      bytes,
      Buffer.from('\r\n--' + boundary + '--\r\n'),
    ]);
    const response = await this.request(DRIVE_UPLOAD + '/files?uploadType=multipart&fields=id', {
      method: 'POST',
      headers: { 'content-type': 'multipart/related; boundary=' + boundary },
      body: asBodyInit(body),
    });
    const created = await response.json() as DriveFile;
    return { remoteId: created.id, size: bytes.length, checksumAlgorithm: 'none' };
  }

  async readVaultHeader(vaultId: string): Promise<string | null> {
    const folders = await this.vaultFolders(vaultId);
    const found = await this.findByKey(folders.objects, 'vault.json');
    if (!found) return null;
    const response = await this.request(DRIVE_API + '/files/' + found.id + '?alt=media');
    return response.ok ? response.text() : null;
  }

  async quota(): Promise<QuotaInfo | null> {
    const response = await this.request(DRIVE_API + '/about?fields=storageQuota(limit,usage)');
    if (!response.ok) return null;
    const payload = await response.json() as { storageQuota?: { limit?: string; usage?: string } };
    if (!payload.storageQuota) return null;
    return {
      totalBytes: payload.storageQuota.limit ? Number(payload.storageQuota.limit) : null,
      usedBytes: payload.storageQuota.usage ? Number(payload.storageQuota.usage) : null,
    };
  }
}
