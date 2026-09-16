import { createWriteStream, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BackupProviderError } from './types.js';

/** 读取文件的一段字节；小分片读取，不把大文件读进内存。 */
async function readChunk(filePath: string, position: number, length: number): Promise<Buffer> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const result = await handle.read(buffer, 0, length, position);
    const bytesRead = typeof result === 'number' ? result : result.bytesRead;
    return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function downloadToFile(
  response: Response,
  targetPath: string,
): Promise<{ bytes: number }> {
  if (!response.body) throw new BackupProviderError('backup_provider_error', '远端没有返回内容。', true);
  const body = response.body as unknown as Parameters<typeof Readable.fromWeb>[0];
  await pipeline(Readable.fromWeb(body), createWriteStream(targetPath));
  return { bytes: statSync(targetPath).size };
}

export interface ResumableUploadOptions {
  fetcher: typeof fetch;
  sessionUrl: string;
  filePath: string;
  size: number;
  /** 分片大小：必须是平台对齐要求的整数倍。 */
  chunkSize: number;
  contentType: string;
  onProgress?: (uploadedBytes: number) => void;
  /** 会话过期后重建；返回新的会话 URL。 */
  recreateSession?: () => Promise<string>;
  maxAttempts?: number;
}

/**
 * Node 的 Buffer 与 DOM 的 BodyInit 在不同编译目标下类型不兼容，
 * 这里统一转换，避免每个调用点各自处理。
 */
export function asBodyInit(value: Uint8Array | string): BodyInit {
  return value as unknown as BodyInit;
}

/**
 * 通用可恢复上传。
 *
 * - 分片对齐由调用方按平台要求给出（Google 256 KiB、Graph 320 KiB 的整数倍）。
 * - 上传的永远是「已冻结的同一个密文文件」，不会为了续传重新生成密文或复用 nonce。
 * - 服务端返回 308 时按其给出的 Range 跳到已确认偏移，避免重复传输。
 * - 会话失效（404/410）时重建会话；网络错误有限重试加退避。
 */
export async function resumableUpload(options: ResumableUploadOptions): Promise<{ remoteId: string; responseText: string; uploadedBytes: number }> {
  const maxAttempts = options.maxAttempts ?? 4;
  let sessionUrl = options.sessionUrl;
  let offset = 0;
  let remoteId = '';
  let responseText = '';
  while (offset < options.size || options.size === 0) {
    const length = Math.min(options.chunkSize, options.size - offset);
    const chunk = await readChunk(options.filePath, offset, Math.max(length, 0));
    if (!chunk.length && options.size > 0) break;
    let attempt = 0;
    let advanced = false;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        const response = await options.fetcher(sessionUrl, {
          method: 'PUT',
          headers: {
            'content-type': options.contentType,
            'content-length': String(chunk.length),
            'content-range': 'bytes ' + offset + '-' + (offset + chunk.length - 1) + '/' + options.size,
          },
          body: asBodyInit(chunk),
        });
        if (response.status === 308) {
          // 未完成：按服务端确认的偏移继续，而不是盲目重传。
          const range = response.headers.get('range');
          const match = range ? /bytes=0-(\d+)/.exec(range) : null;
          offset = match ? Number(match[1]) + 1 : offset + chunk.length;
          options.onProgress?.(offset);
          advanced = true;
          break;
        }
        if (response.ok) {
          responseText = await response.text();
          const parsed = (() => {
            try {
              return JSON.parse(responseText) as Record<string, unknown>;
            } catch {
              return {};
            }
          })();
          remoteId = String(parsed.id ?? parsed.name ?? remoteId);
          offset = options.size;
          options.onProgress?.(offset);
          advanced = true;
          return { remoteId, responseText, uploadedBytes: offset };
        }
        if (response.status === 404 || response.status === 410) {
          if (!options.recreateSession) throw new BackupProviderError('backup_upload_session_expired', '上传会话已过期，且该目标无法重建会话。', true);
          sessionUrl = await options.recreateSession();
          offset = 0;
          advanced = true;
          break;
        }
        if (response.status === 401 || response.status === 403) {
          throw new BackupProviderError('backup_auth_expired', '网盘登录已失效，请重新连接该目标。', false);
        }
        if (response.status === 507 || response.status === 413) {
          throw new BackupProviderError('backup_quota_exceeded', '网盘空间不足，无法完成上传。', false);
        }
        if (response.status === 429 || response.status >= 500) throw new BackupProviderError('backup_network', '网盘暂时不可用（HTTP ' + response.status + '）。', true);
        throw new BackupProviderError('backup_provider_error', '上传被拒绝（HTTP ' + response.status + '）。', false);
      } catch (error) {
        const retryable = error instanceof BackupProviderError ? error.retryable : true;
        if (!retryable || attempt >= maxAttempts) throw error;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(1_000 * 2 ** (attempt - 1), 8_000)));
      }
    }
    if (!advanced) throw new BackupProviderError('backup_network', '上传分片多次失败，已停止。', true);
  }
  if (!remoteId) throw new BackupProviderError('backup_provider_error', '上传结束但未取得远端对象 ID。', true);
  return { remoteId, responseText, uploadedBytes: offset };
}
