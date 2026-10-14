import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  CreateSharedAssetRequest,
  SharedAssetCategory,
  SharedAssetItem,
  SharedAssetListResponse,
  UpdateSharedAssetRequest,
} from '@sthstart/contracts';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';
import {
  createArtifactReadStream,
  readArtifact,
  removeArtifactReference,
  streamUploadArtifact,
} from './artifacts.js';

export function registerSharedAssetRoutes(
  app: FastifyInstance,
  config: ServiceConfig,
  database: ServiceDatabase,
) {
  // GET /api/v1/admin/shared-assets — 获取多角色公共资产列表
  app.get<{
    Querystring: {
      category?: string;
      characterId?: string;
      tag?: string;
      search?: string;
      limit?: string;
      offset?: string;
    };
  }>('/api/v1/admin/shared-assets', async (request, reply) => {
    const { category, characterId, tag, search } = request.query;
    const limit = Math.max(1, Math.min(100, Number(request.query.limit) || 50));
    const offset = Math.max(0, Number(request.query.offset) || 0);

    const conditions: string[] = ['1=1'];
    const params: any[] = [];

    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }
    if (characterId) {
      conditions.push('character_ids_json LIKE ?');
      params.push(`%"${characterId}"%`);
    }
    if (tag) {
      conditions.push('tags_json LIKE ?');
      params.push(`%"${tag}"%`);
    }
    if (search) {
      conditions.push('(title LIKE ? OR author_note LIKE ? OR user_note LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    const whereClause = conditions.join(' AND ');
    const countRow = database.connection
      .prepare(`SELECT COUNT(*) as count FROM shared_assets WHERE ${whereClause}`)
      .get(...params) as { count: number };
    const total = countRow?.count ?? 0;

    const rows = database.connection
      .prepare(
        `SELECT id, title, category, artifact_id, character_ids_json, tags_json, metadata_json,
                author_note, user_note, source_page, source_url, created_at, updated_at
         FROM shared_assets
         WHERE ${whereClause}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as Record<string, unknown>[];

    const items: SharedAssetItem[] = rows.map((r) => {
      let characterIds: string[] = [];
      try { characterIds = JSON.parse(String(r.character_ids_json || '[]')); } catch {}
      let tags: string[] = [];
      try { tags = JSON.parse(String(r.tags_json || '[]')); } catch {}
      let metadata: Record<string, unknown> = {};
      try { metadata = JSON.parse(String(r.metadata_json || '{}')); } catch {}

      return {
        id: String(r.id),
        title: String(r.title || ''),
        category: String(r.category) as SharedAssetCategory,
        url: `/api/admin/shared-assets/file/${r.id}`,
        artifactId: String(r.artifact_id),
        characterIds,
        tags,
        metadata,
        authorNote: r.author_note ? String(r.author_note) : undefined,
        userNote: r.user_note ? String(r.user_note) : undefined,
        sourcePage: r.source_page ? String(r.source_page) : null,
        sourceUrl: r.source_url ? String(r.source_url) : null,
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at),
      };
    });

    return { items, total };
  });

  // POST /api/v1/admin/shared-assets — 创建多角色公共资产
  app.post<{ Body: CreateSharedAssetRequest }>('/api/v1/admin/shared-assets', async (request, reply) => {
    const match = request.body?.dataUrl?.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return reply.code(400).send({ error: 'invalid_image' });

    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > 12 * 1024 * 1024) return reply.code(413).send({ error: 'image_too_large' });

    const id = randomUUID();
    const now = nowIso();
    const originalName = request.body.filename?.slice(0, 255) || `${id}.${match[1].split('/')[1].replace('jpeg', 'jpg')}`;
    const title = (request.body.title || originalName).slice(0, 200);
    const category: SharedAssetCategory = request.body.category || 'other';
    const characterIds = Array.isArray(request.body.characterIds)
      ? request.body.characterIds.filter((cid) => typeof cid === 'string').map((cid) => cid.trim()).filter(Boolean)
      : [];
    const tags = Array.isArray(request.body.tags)
      ? request.body.tags.filter((t) => typeof t === 'string').map((t) => t.trim()).filter(Boolean)
      : [];
    const metadata = request.body.metadata && typeof request.body.metadata === 'object' ? request.body.metadata : {};

    const artifact = await streamUploadArtifact(config, database, {
      appId: 'characters',
      stream: Readable.from([bytes]),
      contentType: match[1],
      originalName,
      refType: 'shared-asset',
      refId: id,
      metadata: { title, category, characterIds },
    });

    database.connection.prepare(`
      INSERT INTO shared_assets
        (id, title, category, artifact_id, character_ids_json, tags_json, metadata_json,
         author_note, user_note, source_page, source_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      title,
      category,
      artifact.id,
      JSON.stringify(characterIds),
      JSON.stringify(tags),
      JSON.stringify(metadata),
      request.body.authorNote?.slice(0, 4_000) || '',
      request.body.userNote?.slice(0, 4_000) || '',
      request.body.sourcePage?.slice(0, 2_000) || null,
      request.body.sourceUrl?.slice(0, 2_000) || null,
      now,
      now
    );

    const item: SharedAssetItem = {
      id,
      title,
      category,
      url: `/api/admin/shared-assets/file/${id}`,
      artifactId: artifact.id,
      characterIds,
      tags,
      metadata,
      authorNote: request.body.authorNote,
      userNote: request.body.userNote,
      sourcePage: request.body.sourcePage || null,
      sourceUrl: request.body.sourceUrl || null,
      createdAt: now,
      updatedAt: now,
    };

    return reply.code(201).send(item);
  });

  // GET /api/v1/admin/shared-assets/:id — 获取单项公共资产详情
  app.get<{ Params: { id: string } }>('/api/v1/admin/shared-assets/:id', async (request, reply) => {
    const row = database.connection
      .prepare(`SELECT * FROM shared_assets WHERE id=?`)
      .get(request.params.id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });

    let characterIds: string[] = [];
    try { characterIds = JSON.parse(String(row.character_ids_json || '[]')); } catch {}
    let tags: string[] = [];
    try { tags = JSON.parse(String(row.tags_json || '[]')); } catch {}
    let metadata: Record<string, unknown> = {};
    try { metadata = JSON.parse(String(row.metadata_json || '{}')); } catch {}

    const item: SharedAssetItem = {
      id: String(row.id),
      title: String(row.title || ''),
      category: String(row.category) as SharedAssetCategory,
      url: `/api/admin/shared-assets/file/${row.id}`,
      artifactId: String(row.artifact_id),
      characterIds,
      tags,
      metadata,
      authorNote: row.author_note ? String(row.author_note) : undefined,
      userNote: row.user_note ? String(row.user_note) : undefined,
      sourcePage: row.source_page ? String(row.source_page) : null,
      sourceUrl: row.source_url ? String(row.source_url) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };

    return item;
  });

  // PATCH /api/v1/admin/shared-assets/:id — 更新多角色公共资产
  app.patch<{ Params: { id: string }; Body: UpdateSharedAssetRequest }>('/api/v1/admin/shared-assets/:id', async (request, reply) => {
    const row = database.connection
      .prepare(`SELECT id FROM shared_assets WHERE id=?`)
      .get(request.params.id) as { id: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });

    const now = nowIso();
    const updates: string[] = ['updated_at=?'];
    const values: any[] = [now];

    if (request.body?.title !== undefined) {
      updates.push('title=?');
      values.push(request.body.title.slice(0, 200));
    }
    if (request.body?.category !== undefined) {
      updates.push('category=?');
      values.push(request.body.category);
    }
    if (request.body?.characterIds !== undefined && Array.isArray(request.body.characterIds)) {
      updates.push('character_ids_json=?');
      values.push(JSON.stringify(request.body.characterIds.filter((cid) => typeof cid === 'string').map((cid) => cid.trim()).filter(Boolean)));
    }
    if (request.body?.tags !== undefined && Array.isArray(request.body.tags)) {
      updates.push('tags_json=?');
      values.push(JSON.stringify(request.body.tags.filter((t) => typeof t === 'string').map((t) => t.trim()).filter(Boolean)));
    }
    if (request.body?.metadata !== undefined && typeof request.body.metadata === 'object') {
      updates.push('metadata_json=?');
      values.push(JSON.stringify(request.body.metadata));
    }
    if (request.body?.userNote !== undefined) {
      updates.push('user_note=?');
      values.push(request.body.userNote.slice(0, 4_000));
    }
    if (request.body?.authorNote !== undefined) {
      updates.push('author_note=?');
      values.push(request.body.authorNote.slice(0, 4_000));
    }
    if (request.body?.sourcePage !== undefined) {
      updates.push('source_page=?');
      values.push(request.body.sourcePage ? request.body.sourcePage.slice(0, 2_000) : null);
    }
    if (request.body?.sourceUrl !== undefined) {
      updates.push('source_url=?');
      values.push(request.body.sourceUrl ? request.body.sourceUrl.slice(0, 2_000) : null);
    }

    values.push(row.id);
    database.connection.prepare(`UPDATE shared_assets SET ${updates.join(', ')} WHERE id=?`).run(...values);

    return { ok: true, id: row.id };
  });

  // DELETE /api/v1/admin/shared-assets/:id — 删除多角色公共资产
  app.delete<{ Params: { id: string } }>('/api/v1/admin/shared-assets/:id', async (request, reply) => {
    const row = database.connection
      .prepare(`SELECT id, artifact_id FROM shared_assets WHERE id=?`)
      .get(request.params.id) as { id: string; artifact_id: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });

    database.transaction(() => {
      database.connection.prepare(`DELETE FROM shared_assets WHERE id=?`).run(row.id);
      if (row.artifact_id) {
        removeArtifactReference(database, { artifactId: row.artifact_id, appId: 'characters', refId: row.id });
      }
    });

    return { ok: true, id: row.id };
  });

  // GET /api/v1/admin/shared-assets/file/:id — 读取公共资产二进制流
  app.get<{ Params: { id: string } }>('/api/v1/admin/shared-assets/file/:id', async (request, reply) => {
    const row = database.connection
      .prepare(`SELECT artifact_id FROM shared_assets WHERE id=?`)
      .get(request.params.id) as { artifact_id: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });

    const artifact = await readArtifact(database, row.artifact_id, config.artifactDirectory);
    if (!artifact || artifact.fileStatus !== 'ready' || !artifact.localPath || !existsSync(artifact.localPath)) {
      return reply.code(404).send({ error: 'file_not_found' });
    }

    reply.type(artifact.contentType || 'application/octet-stream').header('content-length', String(artifact.byteSize));
    return reply.send(createArtifactReadStream(artifact.localPath));
  });
}
