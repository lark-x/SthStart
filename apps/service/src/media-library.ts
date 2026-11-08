import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SQLInputValue } from 'node:sqlite';
import {
  MediaLibraryQuerySchema,
  MediaLibraryResponseSchema,
  inferMediaKind,
  resolveAppMeta,
  type MediaLibraryItem,
  type MediaLibraryKind,
  type MediaLibraryReferenceItem,
  type MediaLibraryStatus,
} from '@sthstart/contracts';
import { authenticateAdmin } from './access.js';
import {
  createArtifactReadStream,
  resolveArtifactStoragePath,
} from './artifacts.js';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';

interface RawArtifactRow {
  id: string;
  app_id: string;
  content_type: string | null;
  byte_size: number;
  sha256: string | null;
  file_status: string;
  original_name: string | null;
  media_type: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  fps: number | null;
  codec: string | null;
  has_audio: number | null;
  thumbnail_artifact_id: string | null;
  metadata_json: string | null;
  params_summary_json: string | null;
  pinned: number;
  created_at: string;
  updated_at: string | null;
}

interface RawReferenceRow {
  id: string;
  artifact_id: string;
  app_id: string;
  ref_type: string;
  ref_id: string;
  created_at: string;
}

const SAFE_PARAMETER_KEYS = new Set(['prompt', 'negativePrompt', 'model', 'seed', 'steps', 'cfg', 'sampler', 'scheduler', 'width', 'height', 'duration', 'fps', 'workflowName']);
const ABSOLUTE_PATH_RE = /^([A-Za-z]:[\\/]|\/(?:home|var|tmp|etc|usr|opt|root|Users|Project)\b)/;

function sanitizeSafeObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!SAFE_PARAMETER_KEYS.has(k)) continue;
    if (typeof v === 'string') {
      if (ABSOLUTE_PATH_RE.test(v.trim())) continue;
      result[k] = v.slice(0, 2000);
    } else if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
      result[k] = v;
    }
  }
  return result;
}

const ATTACHMENT_ONLY_TYPES = /^(text\/(html|xml|javascript|ecmascript)|image\/svg\+xml|application\/(javascript|xml|xhtml\+xml|x-javascript|octet-stream))/i;

export function registerMediaLibraryRoutes(
  app: FastifyInstance,
  config: ServiceConfig,
  database: ServiceDatabase,
): void {
  const authorized = (request: FastifyRequest, reply: FastifyReply): boolean => {
    if (!config.adminToken) {
      void reply.code(503).send({ error: 'admin_not_configured', message: '需要管理员凭证配置。' });
      return false;
    }
    if (!authenticateAdmin(config.adminToken, request)) {
      void reply.code(401).send({ error: 'unauthorized', message: '未授权的管理请求。' });
      return false;
    }
    return true;
  };

  // 1. GET /api/v1/admin/media-library
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/api/v1/admin/media-library',
    {
      schema: {
        querystring: MediaLibraryQuerySchema,
        response: { 200: MediaLibraryResponseSchema },
      },
    },
    async (request, reply) => {
      if (!authorized(request, reply)) return;

      const q = typeof request.query.q === 'string' ? request.query.q.trim() : '';
      const mediaKind = request.query.mediaKind && request.query.mediaKind !== 'all' ? request.query.mediaKind : null;
      const appId = typeof request.query.appId === 'string' && request.query.appId.trim() && request.query.appId !== 'all' ? request.query.appId.trim() : null;
      const status = request.query.status && request.query.status !== 'all' ? request.query.status : null;

      const limit = Math.max(1, Math.min(100, Number(request.query.limit) || 50));
      const offset = Math.max(0, Number(request.query.offset) || 0);

      const conditions: string[] = [];
      const params: SQLInputValue[] = [];

      if (appId) {
        conditions.push('a.app_id = ?');
        params.push(appId);
      }

      if (q) {
        conditions.push('(a.id LIKE ? OR a.original_name LIKE ? OR a.content_type LIKE ? OR a.metadata_json LIKE ?)');
        const searchPattern = `%${q}%`;
        params.push(searchPattern, searchPattern, searchPattern, searchPattern);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // 仅扫描用于过滤与物理存在性检测的 minimal 字段，避免物化大字段
      const minimalSql = `
        SELECT
          a.id, a.app_id, a.content_type, a.media_type,
          a.file_status, a.local_path
        FROM artifacts a
        ${whereClause}
        ORDER BY a.created_at DESC, a.id DESC
      `;

      const candidateRows = (database.connection.prepare(minimalSql).all(...params) as unknown) as Array<{
        id: string;
        app_id: string;
        content_type: string | null;
        media_type: string | null;
        file_status: string;
        local_path: string | null;
      }>;

      interface MatchedItem {
        id: string;
        appId: string;
        itemKind: MediaLibraryKind;
        resolvedStatus: MediaLibraryStatus;
      }
      const matchedItems: MatchedItem[] = [];

      for (const row of candidateRows) {
        const itemKind = inferMediaKind(row.media_type, row.content_type);
        if (mediaKind && itemKind !== mediaKind) {
          continue;
        }

        let resolvedStatus: MediaLibraryStatus = (row.file_status as MediaLibraryStatus) || 'ready';
        if (resolvedStatus === 'ready') {
          // minimal 状态判定使用与 file route 完全一致的 resolveArtifactStoragePath(root)，不轻信被 root 拒绝的 local_path
          let resolvedPath: string | null = null;
          if (config.artifactDirectory) {
            resolvedPath = resolveArtifactStoragePath(database, row.id, config.artifactDirectory);
          } else if (row.local_path && existsSync(row.local_path)) {
            resolvedPath = row.local_path;
          }
          if (!resolvedPath || !existsSync(resolvedPath)) {
            resolvedStatus = 'missing';
          }
        }

        if (status && resolvedStatus !== status) {
          continue;
        }

        matchedItems.push({
          id: row.id,
          appId: row.app_id,
          itemKind,
          resolvedStatus,
        });
      }

      const total = matchedItems.length;
      const pageSlice = matchedItems.slice(offset, offset + limit);

      if (pageSlice.length === 0) {
        return reply.send({
          items: [],
          total,
          limit,
          offset,
        });
      }

      // 仅针对当页 pageSlice 的 artifact IDs 查询完整详情与引用，避免全量物化
      const pagedIds = pageSlice.map((m) => m.id);
      const placeholders = pagedIds.map(() => '?').join(',');

      const detailSql = `
        SELECT
          a.id, a.app_id, a.content_type, a.byte_size, a.sha256,
          a.file_status, a.original_name, a.media_type, a.width,
          a.height, a.duration_ms, a.fps, a.codec, a.has_audio,
          a.thumbnail_artifact_id, a.metadata_json, a.params_summary_json,
          a.pinned, a.created_at, a.updated_at
        FROM artifacts a
        WHERE a.id IN (${placeholders})
      `;
      const detailRows = (database.connection.prepare(detailSql).all(...(pagedIds as SQLInputValue[])) as unknown) as RawArtifactRow[];
      const detailMap = new Map<string, RawArtifactRow>();
      for (const row of detailRows) {
        detailMap.set(row.id, row);
      }

      const appRows = (database.connection.prepare('SELECT id, name FROM managed_apps').all() as unknown) as Array<{ id: string; name: string }>;
      const appNameMap = new Map<string, string>();
      for (const row of appRows) {
        appNameMap.set(row.id, row.name);
      }

      const refSql = `SELECT id, artifact_id, app_id, ref_type, ref_id, created_at FROM artifact_references WHERE artifact_id IN (${placeholders})`;
      const refs = (database.connection.prepare(refSql).all(...(pagedIds as SQLInputValue[])) as unknown) as RawReferenceRow[];
      const referencesByArtifact = new Map<string, RawReferenceRow[]>();
      for (const ref of refs) {
        let list = referencesByArtifact.get(ref.artifact_id);
        if (!list) {
          list = [];
          referencesByArtifact.set(ref.artifact_id, list);
        }
        list.push(ref);
      }

      const items: MediaLibraryItem[] = [];

      for (const match of pageSlice) {
        const row = detailMap.get(match.id);
        if (!row) continue;

        const appMeta = resolveAppMeta(row.app_id, appNameMap.get(row.app_id));
        const artRefs = referencesByArtifact.get(row.id) || [];
        const appCounts: Record<string, number> = {};
        const refList: MediaLibraryReferenceItem[] = [];
        const topRefs: string[] = [];

        for (const ref of artRefs) {
          appCounts[ref.app_id] = (appCounts[ref.app_id] || 0) + 1;
          const refAppMeta = resolveAppMeta(ref.app_id, appNameMap.get(ref.app_id));
          refList.push({
            id: ref.id,
            appId: ref.app_id,
            appName: refAppMeta.name,
            refType: ref.ref_type,
            refId: ref.ref_id,
            createdAt: ref.created_at,
          });
          if (topRefs.length < 5) {
            topRefs.push(`${refAppMeta.name}:${ref.ref_type}:${ref.ref_id}`);
          }
        }

        let rawMetadata: unknown = {};
        try {
          if (row.metadata_json) rawMetadata = JSON.parse(row.metadata_json);
        } catch { /* ignore malformed json */ }

        let rawParamsSummary: unknown = {};
        try {
          if (row.params_summary_json) rawParamsSummary = JSON.parse(row.params_summary_json);
        } catch { /* ignore malformed json */ }

        const safeMetadata = sanitizeSafeObject(rawMetadata);
        const safeParamsSummary = sanitizeSafeObject(rawParamsSummary);

        const fileUrl = `/api/v1/admin/media-library/${encodeURIComponent(row.id)}/file`;
        const thumbnailUrl = row.thumbnail_artifact_id
          ? `/api/v1/admin/media-library/${encodeURIComponent(row.thumbnail_artifact_id)}/file`
          : null;

        items.push({
          id: row.id,
          appId: row.app_id,
          appName: appMeta.name,
          appHref: appMeta.href,
          contentType: row.content_type,
          byteSize: Number(row.byte_size || 0),
          sha256: row.sha256,
          fileStatus: match.resolvedStatus,
          originalName: row.original_name,
          mediaType: row.media_type,
          mediaKind: match.itemKind,
          width: row.width != null ? Number(row.width) : null,
          height: row.height != null ? Number(row.height) : null,
          durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
          fps: row.fps != null ? Number(row.fps) : null,
          codec: row.codec,
          hasAudio: row.has_audio == null ? null : Boolean(row.has_audio),
          thumbnailArtifactId: row.thumbnail_artifact_id,
          metadata: safeMetadata,
          paramsSummary: safeParamsSummary,
          pinned: Boolean(row.pinned),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          fileUrl,
          thumbnailUrl,
          references: refList,
          referenceSummary: {
            totalCount: refList.length,
            appCounts,
            topRefs,
          },
        });
      }

      return reply.send({
        items,
        total,
        limit,
        offset,
      });
    },
  );

  // 2. GET /api/v1/admin/media-library/:id/file
  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/media-library/:id/file',
    async (request, reply) => {
      if (!authorized(request, reply)) return;

      // 严格检查 DB 原始状态：非 ready 绝不允许访问实体文件
      const rawRow = database.connection.prepare(
        'SELECT id, app_id, file_status, local_path, content_type, original_name, media_type FROM artifacts WHERE id=?'
      ).get(request.params.id) as {
        id: string;
        app_id: string;
        file_status: string;
        local_path: string | null;
        content_type: string | null;
        original_name: string | null;
        media_type: string | null;
      } | undefined;

      if (!rawRow) {
        return reply.code(404).send({ error: 'not_found', message: '媒体文件不存在。' });
      }

      if (rawRow.file_status !== 'ready') {
        if (rawRow.file_status === 'quarantined') {
          return reply.code(403).send({ error: 'quarantined', message: '媒体文件已被隔离，禁止读取。' });
        }
        return reply.code(404).send({ error: 'not_ready', message: `媒体文件状态为 ${rawRow.file_status}，不可访问。` });
      }

      // 与 minimal status 保持一致的 resolveArtifactStoragePath
      let resolvedLocalPath = rawRow.local_path;
      if (config.artifactDirectory) {
        resolvedLocalPath = resolveArtifactStoragePath(database, request.params.id, config.artifactDirectory);
      }

      if (!resolvedLocalPath || !existsSync(resolvedLocalPath)) {
        return reply.code(404).send({ error: 'not_found', message: '磁盘文件不存在。' });
      }

      let fileStat;
      try {
        fileStat = await stat(resolvedLocalPath);
      } catch {
        return reply.code(404).send({ error: 'not_found', message: '无法读取文件状态。' });
      }

      const contentType = rawRow.content_type || 'application/octet-stream';
      const rangeHeader = request.headers.range;

      reply.header('accept-ranges', 'bytes');
      reply.header('cache-control', 'private, no-cache');
      reply.header('x-content-type-options', 'nosniff');

      // 针对非图音视频或可执行/脚本活动格式 (html/svg/xml/js)，强制使用 attachment 防止同源脚本执行风险
      const itemKind = inferMediaKind(rawRow.media_type, rawRow.content_type);
      const isDangerousInlineType = ATTACHMENT_ONLY_TYPES.test(contentType);
      const isSafePreviewMedia = (itemKind === 'image' || itemKind === 'video' || itemKind === 'audio') && !isDangerousInlineType;
      const safeFilename = encodeURIComponent(rawRow.original_name || `artifact-${request.params.id}`);

      if (isSafePreviewMedia) {
        reply.header('content-disposition', `inline; filename="${safeFilename}"`);
      } else {
        reply.header('content-disposition', `attachment; filename="${safeFilename}"`);
      }

      if (rangeHeader && rangeHeader.startsWith('bytes=')) {
        const spec = rangeHeader.slice(6).trim();
        let start: number;
        let end: number;

        const suffixMatch = spec.match(/^-(\d+)$/);
        const standardMatch = spec.match(/^(\d+)-(\d*)$/);

        if (suffixMatch) {
          const suffixLength = parseInt(suffixMatch[1], 10);
          if (suffixLength === 0 || fileStat.size === 0) {
            reply.header('content-range', `bytes */${fileStat.size}`);
            return reply.code(416).send({ error: 'range_not_satisfiable' });
          }
          start = Math.max(0, fileStat.size - suffixLength);
          end = fileStat.size - 1;
        } else if (standardMatch) {
          start = parseInt(standardMatch[1], 10);
          end = standardMatch[2] ? parseInt(standardMatch[2], 10) : fileStat.size - 1;
        } else {
          reply.header('content-range', `bytes */${fileStat.size}`);
          return reply.code(416).send({ error: 'range_not_satisfiable' });
        }

        if (fileStat.size === 0 || start >= fileStat.size || end >= fileStat.size || start > end) {
          reply.header('content-range', `bytes */${fileStat.size}`);
          return reply.code(416).send({ error: 'range_not_satisfiable' });
        }

        const chunkSize = end - start + 1;
        reply.code(206);
        reply.header('content-range', `bytes ${start}-${end}/${fileStat.size}`);
        reply.header('content-length', chunkSize);
        reply.type(contentType);
        return reply.send(createArtifactReadStream(resolvedLocalPath, { start, end }));
      }

      reply.header('content-length', fileStat.size);
      reply.type(contentType);
      return reply.send(createArtifactReadStream(resolvedLocalPath));
    },
  );
}
