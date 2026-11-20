import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  COVER_IMAGE_CONTENT_TYPES,
  COVER_IMAGE_MAX_BYTES,
  CoverEntityParamsSchema,
  CoverUploadResponseSchema,
  EntityCoverSchema,
  SetEntityCoverSchema,
  type CoverEntityParams,
  type CoverEntityType,
  type CoverUploadResponse,
  type EntityCover,
  type SetEntityCover,
} from '@sthstart/contracts';
import { streamUploadArtifact } from './artifacts.js';
import type { ServiceConfig } from './config.js';
import { nowIso, type ServiceDatabase } from './database.js';
import { hashToken, issueToken } from './security.js';

/** 封面上传归属的中心媒体应用；媒体库中显示为「作品封面」。 */
export const COVER_APP_ID = 'entity-covers';
export const COVER_REF_TYPE = 'entity-cover';

const COVER_TABLES: Record<CoverEntityType, string> = {
  'story-project': 'story_projects',
  'story-world': 'sw_worlds',
  activity: 'activities',
};

class CoverError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: number) { super(message); }
}

export function coverRefId(entityType: CoverEntityType, entityId: string) {
  return `${entityType}:${entityId}`;
}

export function ensureCoverApp(database: ServiceDatabase) {
  const now = nowIso();
  // 封面应用不对外发令牌；令牌哈希只为满足 managed_apps 的非空约束，每次启动轮换。
  database.connection.prepare(`
    INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
    VALUES (?,?,?,?,1,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, token_hash=excluded.token_hash,
      capabilities_json=excluded.capabilities_json, enabled=1, updated_at=excluded.updated_at
  `).run(COVER_APP_ID, '作品封面', hashToken(issueToken('sth_internal')), JSON.stringify(['artifact']), now, now);
  database.connection.prepare("INSERT OR IGNORE INTO storage_policies(app_id,mode) VALUES (?,'keep')").run(COVER_APP_ID);
}

export function readEntityCover(database: ServiceDatabase, entityType: CoverEntityType, entityId: string): EntityCover {
  const row = database.connection.prepare(`SELECT cover_artifact_id FROM ${COVER_TABLES[entityType]} WHERE id=?`).get(entityId) as
    { cover_artifact_id: string | null } | undefined;
  if (!row) throw new CoverError('cover_entity_not_found', '要设置封面的对象不存在。', 404);
  return { entityType, entityId, coverArtifactId: row.cover_artifact_id ?? null };
}

/** 校验并设置或清除封面。同一事务内替换封面引用，旧封面媒体本身保留在媒体库。 */
export function setEntityCover(
  database: ServiceDatabase,
  entityType: CoverEntityType,
  entityId: string,
  input: SetEntityCover,
): EntityCover {
  readEntityCover(database, entityType, entityId);
  const artifactId = input.artifactId;
  if (artifactId !== null) {
    const artifact = database.connection.prepare('SELECT content_type,byte_size,file_status FROM artifacts WHERE id=?').get(artifactId) as
      { content_type: string | null; byte_size: number; file_status: string | null } | undefined;
    if (!artifact) throw new CoverError('cover_artifact_not_found', '选择的图片不存在。', 404);
    if ((artifact.file_status ?? 'ready') !== 'ready') throw new CoverError('cover_artifact_unavailable', '选择的图片文件当前不可用。', 422);
    const contentType = (artifact.content_type ?? '').split(';')[0].trim().toLowerCase();
    if (!COVER_IMAGE_CONTENT_TYPES.includes(contentType)) {
      throw new CoverError('cover_artifact_invalid_type', '封面只支持 PNG、JPEG、WebP、GIF 或 AVIF 图片。', 422);
    }
    if (Number(artifact.byte_size) > COVER_IMAGE_MAX_BYTES) throw new CoverError('cover_artifact_too_large', '封面图片不能超过 12 MiB。', 422);
  }
  const refId = coverRefId(entityType, entityId);
  database.transaction(() => {
    const connection = database.connection;
    connection.prepare(`UPDATE ${COVER_TABLES[entityType]} SET cover_artifact_id=? WHERE id=?`).run(artifactId, entityId);
    connection.prepare('DELETE FROM artifact_references WHERE ref_type=? AND ref_id=?').run(COVER_REF_TYPE, refId);
    if (artifactId !== null) {
      connection.prepare('INSERT INTO artifact_references(id,artifact_id,app_id,ref_type,ref_id,created_at) VALUES (?,?,?,?,?,?)')
        .run(randomUUID(), artifactId, COVER_APP_ID, COVER_REF_TYPE, refId, nowIso());
    }
  });
  return { entityType, entityId, coverArtifactId: artifactId };
}

function inputStream(request: FastifyRequest): NodeJS.ReadableStream {
  if (Buffer.isBuffer(request.body)) return Readable.from(request.body as unknown as Uint8Array);
  if (request.body && typeof (request.body as NodeJS.ReadableStream).pipe === 'function') return request.body as NodeJS.ReadableStream;
  return request.raw;
}

function originalName(request: FastifyRequest) {
  const raw = request.headers['x-artifact-original-name'];
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const decoded = decodeURIComponent(raw).trim();
    if (!decoded || decoded.length > 255 || decoded.includes('\0')) throw new Error('invalid_filename');
    return decoded;
  } catch {
    throw new CoverError('invalid_filename', '文件名编码格式不正确。', 400);
  }
}

function sendCoverError(reply: FastifyReply, error: unknown) {
  if (error instanceof CoverError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'artifact_quota_exceeded' || message === 'content_length_exceeded') {
    return reply.code(413).send({ error: 'cover_artifact_too_large', message: '封面图片不能超过 12 MiB，或媒体存储已超过配额。' });
  }
  if (message === 'artifact_disk_space_insufficient') return reply.code(507).send({ error: message, message: '存储磁盘空间不足。' });
  if (message === 'invalid_content_length') return reply.code(400).send({ error: message, message: '实际上传字节数与 Content-Length 头不匹配。' });
  throw error;
}

export function registerCoverRoutes(app: FastifyInstance, config: ServiceConfig, database: ServiceDatabase) {
  app.post('/api/v1/admin/covers/uploads', {
    bodyLimit: COVER_IMAGE_MAX_BYTES,
    schema: { response: { 201: CoverUploadResponseSchema } },
  }, async (request, reply) => {
    try {
      const contentType = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (!COVER_IMAGE_CONTENT_TYPES.includes(contentType)) {
        throw new CoverError('cover_artifact_invalid_type', '封面只支持 PNG、JPEG、WebP、GIF 或 AVIF 图片。', 415);
      }
      const rawLength = request.headers['content-length'];
      const parsed = rawLength ? Number.parseInt(rawLength, 10) : null;
      const contentLength = parsed !== null && Number.isFinite(parsed) ? parsed : null;
      if (contentLength !== null && (contentLength < 1 || contentLength > COVER_IMAGE_MAX_BYTES)) {
        throw new CoverError('cover_artifact_too_large', '封面图片不能超过 12 MiB。', 413);
      }
      const artifact = await streamUploadArtifact(config, database, {
        appId: COVER_APP_ID,
        stream: inputStream(request),
        contentType,
        contentLength,
        originalName: originalName(request),
        metadata: { source: 'entity-cover-upload' },
      });
      const response: CoverUploadResponse = {
        artifactId: artifact.id, contentType, byteSize: artifact.byteSize, width: artifact.width, height: artifact.height,
      };
      return reply.code(201).send(response);
    } catch (error) {
      return sendCoverError(reply, error);
    }
  });

  app.get<{ Params: CoverEntityParams }>('/api/v1/admin/covers/:entityType/:entityId', {
    schema: { params: CoverEntityParamsSchema, response: { 200: EntityCoverSchema } },
  }, async (request, reply) => {
    try {
      return readEntityCover(database, request.params.entityType, request.params.entityId);
    } catch (error) {
      return sendCoverError(reply, error);
    }
  });

  app.put<{ Params: CoverEntityParams; Body: SetEntityCover }>('/api/v1/admin/covers/:entityType/:entityId', {
    schema: { params: CoverEntityParamsSchema, body: SetEntityCoverSchema, response: { 200: EntityCoverSchema } },
  }, async (request, reply) => {
    try {
      return setEntityCover(database, request.params.entityType, request.params.entityId, request.body);
    } catch (error) {
      return sendCoverError(reply, error);
    }
  });
}
