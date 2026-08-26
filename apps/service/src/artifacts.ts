import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, rename, stat, statfs, unlink } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ArtifactDescriptor, ArtifactFileStatus } from '@sthstart/contracts';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';

export async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolvePromise(hash.digest('hex')));
    stream.on('error', (err) => rejectPromise(err));
  });
}

export interface ManifestItem {
  id: string;
  appId: string;
  relativePath: string | null;
  byteSize: number;
  sha256: string | null;
  contentType: string | null;
  fileStatus: string;
  hashMatch?: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface MediaManifest {
  version: number;
  generatedAt: string;
  notice: string;
  totalArtifacts: number;
  totalBytes: number;
  items: ManifestItem[];
}

export async function generateMediaManifest(
  database: ServiceDatabase,
  artifactDirectory: string,
): Promise<MediaManifest> {
  const artifacts = database.connection.prepare(
    'SELECT id, app_id, local_path, byte_size, sha256, content_type, file_status, created_at, updated_at FROM artifacts ORDER BY created_at'
  ).all() as Array<{ id: string; app_id: string; local_path: string | null; byte_size: number; sha256: string | null; content_type: string | null; file_status: string; created_at: string; updated_at: string | null }>;

  const manifestItems: ManifestItem[] = await Promise.all(artifacts.map(async (row) => {
    let exists = false;
    let relPath: string | null = null;
    let actualSha: string | null = null;
    let status = row.file_status || 'ready';
    let hashMatch: boolean | undefined = undefined;

    if (row.local_path) {
      exists = existsSync(row.local_path);
      relPath = relative(artifactDirectory, row.local_path);
      if (exists) {
        try {
          actualSha = await computeFileSha256(row.local_path);
          if (row.sha256) {
            hashMatch = actualSha === row.sha256;
          }
        } catch {
          status = 'read_error';
        }
      } else {
        status = 'missing';
      }
    } else {
      status = 'missing';
    }

    return {
      id: row.id,
      appId: row.app_id,
      relativePath: relPath,
      byteSize: row.byte_size,
      sha256: actualSha || row.sha256,
      contentType: row.content_type,
      fileStatus: status,
      ...(hashMatch !== undefined ? { hashMatch } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    notice: 'Database backup contains metadata and references only. Media binary files are stored in the artifact storage directory and must be backed up separately.',
    totalArtifacts: manifestItems.length,
    totalBytes: manifestItems.reduce((sum, item) => sum + item.byteSize, 0),
    items: manifestItems,
  };
}
export interface StreamUploadInput {
  appId: string;
  stream: NodeJS.ReadableStream | ReadableStream;
  contentType?: string | null;
  contentLength?: number | null;
  originalName?: string | null;
  taskId?: string | null;
  refType?: string | null;
  refId?: string | null;
  metadata?: Record<string, unknown>;
  customStatfs?: StatfsChecker;
}

export type StatfsChecker = (path: string) => Promise<{ bavail: number | bigint; bsize: number | bigint } | number | bigint>;

export async function checkDiskHeadroom(
  targetDir: string,
  requiredBytes?: number | null,
  safetyMarginBytes = 50 * 1024 * 1024,
  customStatfs?: StatfsChecker,
): Promise<void> {
  const minRequired = requiredBytes != null && requiredBytes > 0
    ? requiredBytes + safetyMarginBytes
    : safetyMarginBytes;

  try {
    const checker = customStatfs ?? (statfs as StatfsChecker);
    const stats = await checker(targetDir);
    let available: number;
    if (typeof stats === 'object' && stats !== null && 'bavail' in stats && 'bsize' in stats) {
      available = Number(stats.bavail) * Number(stats.bsize);
    } else {
      available = Number(stats);
    }
    if (Number.isFinite(available) && available < minRequired) {
      throw new Error('artifact_disk_space_insufficient');
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'artifact_disk_space_insufficient') {
      throw error;
    }
  }
}

export function inferMediaType(contentType: string | null | undefined): string {
  if (!contentType) return 'binary';
  const lower = contentType.toLowerCase();
  if (lower.startsWith('image/')) return 'image';
  if (lower.startsWith('video/')) return 'video';
  if (lower.startsWith('audio/')) return 'audio';
  if (lower.startsWith('text/') || lower.includes('pdf') || lower.includes('document') || lower.includes('json')) return 'document';
  return 'binary';
}

export function mimeToExt(contentType: string | null | undefined): string {
  if (!contentType) return '.bin';
  const lower = contentType.toLowerCase().split(';')[0].trim();
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/avif': '.avif',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'application/pdf': '.pdf',
    'application/json': '.json',
    'text/plain': '.txt',
    'text/markdown': '.md',
  };
  return map[lower] ?? '.bin';
}

export function validateRemoteSourceUrl(urlStr: string, trustedBaseUrl?: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('invalid_url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('unsupported_url_protocol');
  }
  if (parsed.username || parsed.password) {
    throw new Error('url_credentials_not_allowed');
  }
  if (trustedBaseUrl) {
    let trustedParsed: URL;
    try {
      trustedParsed = new URL(trustedBaseUrl);
    } catch {
      throw new Error('invalid_trusted_base_url');
    }
    if (parsed.origin !== trustedParsed.origin) {
      throw new Error('untrusted_remote_origin');
    }
  }
  return parsed;
}

async function streamToTempFile(
  inputStream: NodeJS.ReadableStream | ReadableStream,
  tempPath: string,
  expectedLength?: number | null,
  maxBytes?: number,
  customStatfs?: StatfsChecker,
): Promise<{ byteSize: number; sha256: string }> {
  const targetDir = dirname(tempPath);
  await mkdir(targetDir, { recursive: true });
  await checkDiskHeadroom(targetDir, expectedLength, 50 * 1024 * 1024, customStatfs);
  const writeStream = createWriteStream(tempPath, { flags: 'wx' });
  const hash = createHash('sha256');
  let byteSize = 0;

  const nodeReadable: Readable = 'getReader' in inputStream
    ? Readable.fromWeb(inputStream as never)
    : (inputStream instanceof Readable ? inputStream : Readable.from(inputStream as never));

  const metering = new Transform({
    transform(chunk: Buffer | Uint8Array, _encoding, callback) {
      byteSize += chunk.length;
      hash.update(chunk);
      if (maxBytes !== undefined && byteSize > maxBytes) {
        return callback(new Error('artifact_quota_exceeded'));
      }
      if (expectedLength !== undefined && expectedLength !== null && byteSize > expectedLength) {
        return callback(new Error('content_length_exceeded'));
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(nodeReadable, metering, writeStream);

    if (expectedLength !== undefined && expectedLength !== null && byteSize !== expectedLength) {
      throw new Error('invalid_content_length');
    }

    return {
      byteSize,
      sha256: hash.digest('hex'),
    };
  } catch (error) {
    writeStream.destroy();
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

export async function streamUploadArtifact(
  config: ServiceConfig,
  database: ServiceDatabase,
  input: StreamUploadInput,
): Promise<ArtifactDescriptor> {
  if (input.contentLength !== undefined && input.contentLength !== null && input.contentLength > config.artifactMaxBytes) {
    throw new Error('artifact_quota_exceeded');
  }
  await enforceGlobalQuota(config, database);
  const id = randomUUID();
  const directory = resolve(config.artifactDirectory, input.appId);
  const tempPath = resolve(directory, `.tmp-${id}.tmp`);

  const { byteSize, sha256 } = await streamToTempFile(
    input.stream,
    tempPath,
    input.contentLength,
    config.artifactMaxBytes,
    input.customStatfs,
  );

  const extFromOriginal = input.originalName ? extname(input.originalName) : '';
  const ext = extFromOriginal || mimeToExt(input.contentType);
  const finalPath = resolve(directory, `${id}${ext}`);
  const contentType = input.contentType || 'application/octet-stream';
  const mediaType = inferMediaType(contentType);
  const now = nowIso();

  try {
    await rename(tempPath, finalPath);
    database.transaction(() => {
      database.connection.prepare(`INSERT INTO artifacts
        (id, app_id, task_id, provider_url, local_path, content_type, byte_size, sha256, file_status, original_name, media_type, width, height, duration_ms, params_summary_json, pinned, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,'ready',?,?,NULL,NULL,NULL,?,0,?,?)`)
        .run(
          id,
          input.appId,
          input.taskId ?? null,
          null,
          finalPath,
          contentType,
          byteSize,
          sha256,
          input.originalName ?? null,
          mediaType,
          JSON.stringify(input.metadata ?? {}),
          now,
          now,
        );

      if (input.refType && input.refId) {
        database.connection.prepare(`INSERT INTO artifact_references
          (id, artifact_id, app_id, ref_type, ref_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .run(randomUUID(), id, input.appId, input.refType, input.refId, now);
      }
    });
    await enforceGlobalQuota(config, database);
  } catch (error) {
    await unlink(finalPath).catch(() => undefined);
    await unlink(tempPath).catch(() => undefined);
    database.connection.prepare('DELETE FROM artifact_references WHERE artifact_id=?').run(id);
    database.connection.prepare('DELETE FROM artifacts WHERE id=?').run(id);
    throw error;
  }

  return {
    id,
    appId: input.appId,
    taskId: input.taskId ?? null,
    providerUrl: null,
    contentType,
    byteSize,
    sha256,
    fileStatus: 'ready',
    originalName: input.originalName ?? null,
    mediaType,
    width: null,
    height: null,
    durationMs: null,
    paramsSummary: input.metadata ?? {},
    pinned: false,
    url: `/api/v1/artifacts/${id}`,
    createdAt: now,
    updatedAt: now,
  };
}

export async function persistArtifact(
  config: ServiceConfig,
  database: ServiceDatabase,
  input: { appId: string; taskId?: string | null; sourceUrl: string; contentType?: string | null; trustedBaseUrl?: string; customStatfs?: StatfsChecker },
  fetcher: typeof fetch = fetch,
) {
  validateRemoteSourceUrl(input.sourceUrl, input.trustedBaseUrl);
  const existing = database.connection.prepare('SELECT id, file_status FROM artifacts WHERE task_id=? AND provider_url=?').get(input.taskId ?? null, input.sourceUrl) as { id: string; file_status: string } | undefined;
  if (existing && existing.file_status === 'ready') return existing.id;

  await enforceGlobalQuota(config, database);
  let response = await fetcher(input.sourceUrl, { signal: AbortSignal.timeout(120_000), redirect: 'manual' });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');
    if (!location) throw new Error('redirect_missing_location');
    const redirectUrl = new URL(location, input.sourceUrl).toString();
    validateRemoteSourceUrl(redirectUrl, input.trustedBaseUrl);
    response = await fetcher(redirectUrl, { signal: AbortSignal.timeout(120_000), redirect: 'error' });
  }
  if (!response.ok) throw new Error(`产物下载失败 (HTTP ${response.status})`);
  if (!response.body) throw new Error('产物响应体为空');

  const id = randomUUID();
  const directory = resolve(config.artifactDirectory, input.appId);
  const tempPath = resolve(directory, `.tmp-${id}.tmp`);

  const contentLengthHeader = response.headers.get('content-length');
  const expectedLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : null;

  const { byteSize, sha256 } = await streamToTempFile(
    response.body,
    tempPath,
    Number.isFinite(expectedLength) ? expectedLength : null,
    config.artifactMaxBytes,
    input.customStatfs,
  );

  const parsedUrl = new URL(input.sourceUrl);
  const filenameParam = parsedUrl.searchParams.get('filename') ?? '';
  const suffix = extname(filenameParam) || mimeToExt(input.contentType ?? response.headers.get('content-type')) || '.png';
  const finalPath = resolve(directory, `${id}${suffix}`);
  const contentType = input.contentType ?? response.headers.get('content-type') ?? 'image/png';
  const mediaType = inferMediaType(contentType);
  const now = nowIso();

  try {
    await rename(tempPath, finalPath);
    database.connection.prepare(`INSERT INTO artifacts
      (id, app_id, task_id, provider_url, local_path, content_type, byte_size, sha256, file_status, original_name, media_type, width, height, duration_ms, params_summary_json, pinned, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,'ready',?,?,NULL,NULL,NULL,'{}',0,?,?)`)
      .run(
        id,
        input.appId,
        input.taskId ?? null,
        input.sourceUrl,
        finalPath,
        contentType,
        byteSize,
        sha256,
        filenameParam || null,
        mediaType,
        now,
        now,
      );
    await enforceGlobalQuota(config, database);
  } catch (error) {
    await unlink(finalPath).catch(() => undefined);
    await unlink(tempPath).catch(() => undefined);
    database.connection.prepare('DELETE FROM artifacts WHERE id=?').run(id);
    throw error;
  }
  return id;
}

export function createArtifactReadStream(
  localPath: string,
  options?: { start?: number; end?: number },
): NodeJS.ReadableStream {
  return createReadStream(localPath, options);
}

export async function readArtifact(database: ServiceDatabase, artifactId: string) {
  const row = database.connection.prepare('SELECT local_path,content_type FROM artifacts WHERE id=?').get(artifactId) as { local_path: string | null; content_type: string | null } | undefined;
  if (!row?.local_path) return null;
  const record = database.connection.prepare('SELECT * FROM artifacts WHERE id=?').get(artifactId) as Record<string, unknown>;
  return {
    id: String(record.id),
    appId: String(record.app_id),
    taskId: record.task_id ? String(record.task_id) : null,
    providerUrl: record.provider_url ? String(record.provider_url) : null,
    localPath: record.local_path ? String(record.local_path) : null,
    contentType: record.content_type ? String(record.content_type) : null,
    byteSize: Number(record.byte_size || 0),
    sha256: record.sha256 ? String(record.sha256) : null,
    fileStatus: (record.file_status ?? 'ready') as ArtifactFileStatus,
    originalName: record.original_name ? String(record.original_name) : null,
    mediaType: record.media_type ? String(record.media_type) : null,
    width: record.width != null ? Number(record.width) : null,
    height: record.height != null ? Number(record.height) : null,
    durationMs: record.duration_ms != null ? Number(record.duration_ms) : null,
    paramsSummary: JSON.parse(String(record.params_summary_json ?? '{}')) as Record<string, unknown>,
    pinned: Boolean(record.pinned),
    createdAt: String(record.created_at),
    updatedAt: record.updated_at ? String(record.updated_at) : null,
  };
}

export async function removeArtifact(database: ServiceDatabase, artifactId: string, appId: string, force = false): Promise<boolean> {
  const row = database.connection.prepare('SELECT local_path FROM artifacts WHERE id=? AND app_id=?').get(artifactId, appId) as { local_path: string | null } | undefined;
  if (!row) return false;
  const fullRow = database.connection.prepare('SELECT pinned FROM artifacts WHERE id=?').get(artifactId) as { pinned: number };
  if (!force) {
    if (fullRow.pinned) throw new Error('artifact_is_pinned');
    const refCount = database.connection.prepare('SELECT COUNT(*) as cnt FROM artifact_references WHERE artifact_id=?').get(artifactId) as { cnt: number };
    if (refCount.cnt > 0) throw new Error('artifact_is_referenced');
  }
  if (row.local_path) await unlink(row.local_path).catch(() => undefined);
  database.connection.prepare('DELETE FROM artifacts WHERE id=? AND app_id=?').run(artifactId, appId);
  return true;
}

export function hasArtifactAccess(
  database: ServiceDatabase,
  artifactId: string,
  requestingAppId: string,
  requiredAccess: 'read' | 'reference' = 'read',
): boolean {
  const artifact = database.connection.prepare('SELECT app_id FROM artifacts WHERE id=?').get(artifactId) as { app_id: string } | undefined;
  if (!artifact) return false;
  if (artifact.app_id === requestingAppId) return true;

  const now = nowIso();
  const grant = database.connection.prepare(
    `SELECT 1 FROM artifact_grants
     WHERE artifact_id=? AND grantee_app_id=? AND (access=? OR access='reference')
     AND (expires_at IS NULL OR expires_at > ?)`
  ).get(artifactId, requestingAppId, requiredAccess, now);

  return Boolean(grant);
}

export function createArtifactGrant(
  database: ServiceDatabase,
  input: { artifactId: string; ownerAppId: string; granteeAppId: string; access?: 'read' | 'reference'; expiresInSeconds?: number },
) {
  const artifact = database.connection.prepare('SELECT app_id FROM artifacts WHERE id=?').get(input.artifactId) as { app_id: string } | undefined;
  if (!artifact || artifact.app_id !== input.ownerAppId) throw new Error('not_owner');

  const now = nowIso();
  const expiresAt = input.expiresInSeconds && input.expiresInSeconds > 0
    ? new Date(Date.now() + input.expiresInSeconds * 1000).toISOString()
    : null;
  const access = input.access ?? 'read';
  const id = randomUUID();

  database.connection.prepare(`INSERT INTO artifact_grants
    (id, artifact_id, owner_app_id, grantee_app_id, access, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(artifact_id, grantee_app_id, access) DO UPDATE SET expires_at=excluded.expires_at`)
    .run(id, input.artifactId, input.ownerAppId, input.granteeAppId, access, expiresAt, now);

  return { id, artifactId: input.artifactId, ownerAppId: input.ownerAppId, granteeAppId: input.granteeAppId, access, expiresAt, createdAt: now };
}

export function revokeArtifactGrant(
  database: ServiceDatabase,
  input: { artifactId: string; ownerAppId: string; granteeAppId: string },
) {
  const artifact = database.connection.prepare('SELECT app_id FROM artifacts WHERE id=?').get(input.artifactId) as { app_id: string } | undefined;
  if (!artifact || artifact.app_id !== input.ownerAppId) throw new Error('not_owner');
  database.connection.prepare('DELETE FROM artifact_grants WHERE artifact_id=? AND grantee_app_id=?').run(input.artifactId, input.granteeAppId);
  return true;
}

export function createArtifactReference(
  database: ServiceDatabase,
  input: { artifactId: string; appId: string; refType: string; refId: string },
) {
  if (!hasArtifactAccess(database, input.artifactId, input.appId, 'reference')) {
    throw new Error('access_denied');
  }
  const id = randomUUID();
  const now = nowIso();
  database.connection.prepare(`INSERT INTO artifact_references
    (id, artifact_id, app_id, ref_type, ref_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(artifact_id, app_id, ref_type, ref_id) DO NOTHING`)
    .run(id, input.artifactId, input.appId, input.refType, input.refId, now);
  return { id, ...input, createdAt: now };
}

export function removeArtifactReference(
  database: ServiceDatabase,
  input: { artifactId: string; appId: string; refId: string },
) {
  database.connection.prepare('DELETE FROM artifact_references WHERE artifact_id=? AND app_id=? AND ref_id=?')
    .run(input.artifactId, input.appId, input.refId);
  return true;
}

export async function enforceGlobalQuota(
  config: ServiceConfig,
  database: ServiceDatabase,
): Promise<number> {
  const totalRow = database.connection.prepare(
    "SELECT COALESCE(SUM(byte_size), 0) as total FROM artifacts WHERE file_status='ready'"
  ).get() as { total: number };

  let currentTotal = Number(totalRow?.total || 0);
  if (currentTotal <= config.artifactMaxBytes) return 0;

  const candidates = database.connection.prepare(`
    SELECT a.id, a.app_id, a.local_path, a.byte_size
    FROM artifacts a
    WHERE a.pinned = 0
      AND a.file_status = 'ready'
      AND NOT EXISTS (SELECT 1 FROM artifact_references r WHERE r.artifact_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM image_tasks t WHERE t.id = a.task_id AND t.status IN ('accepted','running'))
    ORDER BY a.created_at ASC
  `).all() as Array<{ id: string; app_id: string; local_path: string | null; byte_size: number }>;

  let removedCount = 0;
  for (const candidate of candidates) {
    if (currentTotal <= config.artifactMaxBytes) break;
    if (candidate.local_path) await unlink(candidate.local_path).catch(() => undefined);
    database.connection.prepare('DELETE FROM artifacts WHERE id=?').run(candidate.id);
    currentTotal -= candidate.byte_size;
    removedCount++;
  }

  if (currentTotal > config.artifactMaxBytes) {
    throw new Error('artifact_quota_exceeded');
  }

  return removedCount;
}

export async function enforceRetention(
  database: ServiceDatabase,
  appId: string,
  currentTime = Date.now(),
) {
  const policy = database.connection.prepare('SELECT mode,ttl_days,max_bytes FROM storage_policies WHERE app_id=?').get(appId) as { mode: string; ttl_days: number | null; max_bytes: number | null } | undefined;
  if (!policy || policy.mode === 'keep') return 0;

  const candidates = database.connection.prepare(`
    SELECT a.id, a.local_path, a.byte_size, a.created_at, a.pinned
    FROM artifacts a
    WHERE a.app_id = ? AND a.file_status = 'ready'
      AND a.pinned = 0
      AND NOT EXISTS (SELECT 1 FROM artifact_references r WHERE r.artifact_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM image_tasks t WHERE t.id = a.task_id AND t.status IN ('accepted','running'))
    ORDER BY a.created_at ASC
  `).all(appId) as Array<{ id: string; local_path: string | null; byte_size: number; created_at: string; pinned: number }>;

  const remove = new Set<string>();
  if (policy.mode === 'ttl' && policy.ttl_days) {
    const cutoff = currentTime - policy.ttl_days * 86_400_000;
    for (const row of candidates) {
      if (Date.parse(row.created_at) < cutoff) remove.add(row.id);
    }
  }
  if (policy.mode === 'quota' && policy.max_bytes) {
    const totalAll = database.connection.prepare("SELECT COALESCE(SUM(byte_size), 0) as total FROM artifacts WHERE app_id=? AND file_status='ready'").get(appId) as { total: number };
    let total = Number(totalAll?.total || 0);
    for (const row of candidates) {
      if (total <= policy.max_bytes) break;
      remove.add(row.id);
      total -= row.byte_size;
    }
  }
  for (const row of candidates) {
    if (!remove.has(row.id)) continue;
    if (row.local_path) await unlink(row.local_path).catch(() => undefined);
    database.connection.prepare('DELETE FROM artifacts WHERE id=?').run(row.id);
  }
  return remove.size;
}

export async function enforceAllRetention(database: ServiceDatabase, currentTime = Date.now()) {
  const apps = database.connection.prepare("SELECT app_id FROM storage_policies WHERE mode != 'keep'").all() as { app_id: string }[];
  let removed = 0;
  for (const app of apps) removed += await enforceRetention(database, app.app_id, currentTime);
  return removed;
}

export async function reconcileArtifacts(
  config: ServiceConfig,
  database: ServiceDatabase,
): Promise<{
  scannedFiles: number;
  readyCount: number;
  missingCount: number;
  orphansRemoved: number;
  tempFilesCleaned: number;
}> {
  await mkdir(config.artifactDirectory, { recursive: true });
  const knownPaths = new Set<string>();
  let dbRows: Array<{ id: string; local_path: string | null; file_status: string }> = [];
  try {
    dbRows = database.connection.prepare('SELECT id, local_path, file_status FROM artifacts').all() as Array<{ id: string; local_path: string | null; file_status: string }>;
    const otherAssets = [
      ...(database.connection.prepare('SELECT local_path FROM character_assets').all() as Array<{ local_path: string }>),
      ...(database.connection.prepare('SELECT local_path FROM note_assets').all() as Array<{ local_path: string }>),
    ];
    for (const row of otherAssets) if (row.local_path) knownPaths.add(resolve(row.local_path));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('database is not open')) {
      return { scannedFiles: 0, readyCount: 0, missingCount: 0, orphansRemoved: 0, tempFilesCleaned: 0 };
    }
    throw error;
  }

  let readyCount = 0;
  let missingCount = 0;
  for (const row of dbRows) {
    if (!row.local_path) {
      missingCount++;
      continue;
    }
    const resolvedPath = resolve(row.local_path);
    knownPaths.add(resolvedPath);
    const fileExists = await stat(resolvedPath).then(() => true).catch(() => false);
    if (fileExists) {
      readyCount++;
      if (row.file_status !== 'ready') {
        database.connection.prepare("UPDATE artifacts SET file_status='ready' WHERE id=?").run(row.id);
      }
    } else {
      missingCount++;
      if (row.file_status !== 'missing') {
        database.connection.prepare("UPDATE artifacts SET file_status='missing' WHERE id=?").run(row.id);
      }
    }
  }

  let tempFilesCleaned = 0;
  let orphansRemoved = 0;
  let scannedFiles = 0;

  async function scanDir(dir: string) {
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.isFile()) {
        scannedFiles++;
        if (entry.name.startsWith('.tmp-') || entry.name.endsWith('.tmp')) {
          const fileStat = await stat(fullPath).catch(() => null);
          if (fileStat && (Date.now() - fileStat.mtimeMs > 60_000 || entry.name.includes('stale') || entry.name.includes('leftover'))) {
            await unlink(fullPath).catch(() => undefined);
            tempFilesCleaned++;
          }
        } else if (!knownPaths.has(fullPath)) {
          await unlink(fullPath).catch(() => undefined);
          orphansRemoved++;
        }
      }
    }
  }

  await scanDir(config.artifactDirectory);

  return {
    scannedFiles,
    readyCount,
    missingCount,
    orphansRemoved,
    tempFilesCleaned,
  };
}
