import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';

const kinds = new Set(['diary', 'idea', 'note', 'story', 'character', 'world']);
const stages = new Set(['draft', 'reference', 'story-candidate']);
const NOTE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const imageExtensions: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

interface NoteBody {
  title?: string;
  kind?: string;
  summary?: string;
  content?: unknown[];
  tags?: string[];
  stage?: string;
  favorite?: boolean;
}

function mapNote(row: Record<string, unknown>) {
  return {
    id: String(row.id), title: String(row.title), kind: String(row.kind), summary: String(row.summary),
    content: JSON.parse(String(row.content_json)) as unknown[], tags: JSON.parse(String(row.tags_json)) as string[],
    stage: String(row.stage), favorite: Boolean(row.favorite),
    revision: Number(row.revision ?? 1),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function validate(body: NoteBody) {
  const title = body.title?.trim() || '未命名笔记';
  const kind = kinds.has(body.kind ?? '') ? body.kind! : 'note';
  const stage = stages.has(body.stage ?? '') ? body.stage! : 'draft';
  const summary = body.summary?.trim().slice(0, 500) ?? '';
  const content = Array.isArray(body.content) ? body.content.slice(0, 500) : [];
  const tags = Array.isArray(body.tags) ? [...new Set(body.tags.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 20) : [];
  return { title, kind, stage, summary, content, tags, favorite: Boolean(body.favorite) };
}

function linkNoteAssets(database: ServiceDatabase, noteId: string, content: unknown[]) {
  const assetIds = content.flatMap((block) => {
    if (!block || typeof block !== 'object') return [];
    const candidate = block as { type?: unknown; src?: unknown };
    if (candidate.type !== 'image' || typeof candidate.src !== 'string') return [];
    const match = candidate.src.match(/^\/api\/(?:v1\/)?admin\/notebook\/assets\/([A-Za-z0-9_-]+)$/);
    return match ? [match[1]] : [];
  });
  const update = database.connection.prepare('UPDATE note_assets SET note_id=? WHERE id=? AND (note_id IS NULL OR note_id=?)');
  for (const assetId of assetIds) update.run(noteId, assetId, noteId);
}

export function registerNotebookRoutes(app: FastifyInstance, config: ServiceConfig, database: ServiceDatabase) {
  app.get<{ Querystring: { q?: string; kind?: string; stage?: string } }>('/api/v1/admin/notebook/notes', async (request) => {
    const conditions: string[] = []; const values: string[] = [];
    if (request.query.kind && kinds.has(request.query.kind)) { conditions.push('kind = ?'); values.push(request.query.kind); }
    if (request.query.stage && stages.has(request.query.stage)) { conditions.push('stage = ?'); values.push(request.query.stage); }
    if (request.query.q?.trim()) {
      const search = `%${request.query.q.trim()}%`;
      conditions.push('(title LIKE ? OR summary LIKE ? OR tags_json LIKE ? OR content_json LIKE ?)');
      values.push(search, search, search, search);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = database.connection.prepare(`SELECT * FROM creative_notes ${where} ORDER BY favorite DESC, updated_at DESC LIMIT 300`).all(...values) as Record<string, unknown>[];
    return { items: rows.map(mapNote) };
  });

  app.post<{ Body: NoteBody }>('/api/v1/admin/notebook/notes', async (request, reply) => {
    const note = validate(request.body ?? {}); const id = randomUUID(); const now = nowIso();
    database.connection.prepare(`INSERT INTO creative_notes
      (id,title,kind,summary,content_json,tags_json,stage,favorite,created_at,updated_at,revision)
      VALUES (?,?,?,?,?,?,?,?,?,?,1)`)
      .run(id, note.title, note.kind, note.summary, JSON.stringify(note.content), JSON.stringify(note.tags), note.stage, note.favorite ? 1 : 0, now, now);
    linkNoteAssets(database, id, note.content);
    return reply.code(201).send(mapNote(database.connection.prepare('SELECT * FROM creative_notes WHERE id=?').get(id) as Record<string, unknown>));
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/notebook/notes/:id', async (request, reply) => {
    const row = database.connection.prepare('SELECT * FROM creative_notes WHERE id=?').get(request.params.id) as Record<string, unknown> | undefined;
    return row ? mapNote(row) : reply.code(404).send({ error: 'not_found' });
  });

  app.put<{ Params: { id: string }; Body: NoteBody }>('/api/v1/admin/notebook/notes/:id', async (request, reply) => {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(request.params.id)) return reply.code(400).send({ error: 'invalid_note_id' });
    const existing = database.connection.prepare('SELECT created_at,revision FROM creative_notes WHERE id=?').get(request.params.id) as { created_at: string; revision: number } | undefined;
    const note = validate(request.body ?? {});
    const now = nowIso();
    if (!existing) {
      database.connection.prepare(`INSERT INTO creative_notes
        (id,title,kind,summary,content_json,tags_json,stage,favorite,created_at,updated_at,revision)
        VALUES (?,?,?,?,?,?,?,?,?,?,1)`)
        .run(request.params.id, note.title, note.kind, note.summary, JSON.stringify(note.content), JSON.stringify(note.tags), note.stage, note.favorite ? 1 : 0, now, now);
      linkNoteAssets(database, request.params.id, note.content);
      return reply.code(201).send(mapNote(database.connection.prepare('SELECT * FROM creative_notes WHERE id=?').get(request.params.id) as Record<string, unknown>));
    }
    database.connection.prepare(`UPDATE creative_notes SET title=?,kind=?,summary=?,content_json=?,tags_json=?,stage=?,favorite=?,updated_at=?,revision=revision+1 WHERE id=?`)
      .run(note.title, note.kind, note.summary, JSON.stringify(note.content), JSON.stringify(note.tags), note.stage, note.favorite ? 1 : 0, now, request.params.id);
    linkNoteAssets(database, request.params.id, note.content);
    return mapNote(database.connection.prepare('SELECT * FROM creative_notes WHERE id=?').get(request.params.id) as Record<string, unknown>);
  });

  app.delete<{ Params: { id: string } }>('/api/v1/admin/notebook/notes/:id', async (request, reply) => {
    const assets = database.connection.prepare('SELECT id,local_path FROM note_assets WHERE note_id=?').all(request.params.id) as { id: string; local_path: string }[];
    const result = database.connection.prepare('DELETE FROM creative_notes WHERE id=?').run(request.params.id);
    if (!result.changes) return reply.code(404).send({ error: 'not_found' });
    for (const asset of assets) {
      await unlink(asset.local_path).catch(() => undefined);
      database.connection.prepare('DELETE FROM note_assets WHERE id=?').run(asset.id);
    }
    return { ok: true };
  });

  app.post<{ Body: { noteId?: string; dataUrl?: string; filename?: string } | Readable }>('/api/v1/admin/notebook/assets', async (request, reply) => {
    const contentType = String(request.headers['content-type'] ?? '').split(';')[0].toLowerCase();
    const id = randomUUID();
    const directory = resolve(config.artifactDirectory, 'notebook');
    await mkdir(directory, { recursive: true });

    let noteId: string | null = null;
    let originalName: string | null = null;
    let storedContentType = contentType;
    let byteSize = 0;
    let path = '';

    if (contentType === 'application/json') {
      const body = request.body as { noteId?: string; dataUrl?: string; filename?: string };
      const match = body?.dataUrl?.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
      if (!match) return reply.code(400).send({ error: 'invalid_image' });
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.length > NOTE_IMAGE_MAX_BYTES) return reply.code(413).send({ error: 'image_too_large' });
      noteId = body.noteId && database.connection.prepare('SELECT 1 FROM creative_notes WHERE id=?').get(body.noteId) ? body.noteId : null;
      originalName = body.filename?.slice(0, 255) || null;
      storedContentType = match[1];
      byteSize = bytes.length;
      path = resolve(directory, `${id}${imageExtensions[storedContentType]}`);
      await writeFile(path, bytes, { flag: 'wx' });
    } else {
      const extension = imageExtensions[contentType];
      if (!extension || !request.body || typeof (request.body as Readable).pipe !== 'function') {
        return reply.code(400).send({ error: 'invalid_image' });
      }
      const suppliedNoteId = request.headers['x-note-id'];
      noteId = typeof suppliedNoteId === 'string' && suppliedNoteId
        && database.connection.prepare('SELECT 1 FROM creative_notes WHERE id=?').get(suppliedNoteId)
        ? suppliedNoteId
        : null;
      const suppliedName = request.headers['x-original-filename'];
      originalName = typeof suppliedName === 'string' ? suppliedName.slice(0, 255) : null;
      path = resolve(directory, `${id}${extension}`);
      const temporaryPath = `${path}.upload`;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          byteSize += chunk.length;
          callback(byteSize > NOTE_IMAGE_MAX_BYTES ? new Error('image_too_large') : null, chunk);
        },
      });
      try {
        await pipeline(request.body as Readable, meter, createWriteStream(temporaryPath, { flags: 'wx' }));
        await rename(temporaryPath, path);
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        if (error instanceof Error && error.message === 'image_too_large') return reply.code(413).send({ error: 'image_too_large' });
        throw error;
      }
    }

    try {
      database.connection.prepare('INSERT INTO note_assets VALUES (?,?,?,?,?,?,?)')
        .run(id, noteId, path, storedContentType, byteSize, originalName, nowIso());
    } catch (error) {
      await unlink(path).catch(() => undefined);
      throw error;
    }
    return reply.code(201).send({ id, url: `/api/admin/notebook/assets/${id}` });
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/notebook/assets/:id', async (request, reply) => {
    const asset = database.connection.prepare('SELECT local_path,content_type,byte_size FROM note_assets WHERE id=?').get(request.params.id) as { local_path: string; content_type: string; byte_size: number } | undefined;
    if (!asset) return reply.code(404).send({ error: 'not_found' });
    try {
      await access(asset.local_path);
      // Asset IDs are immutable, so let the browser and Cloudflare cache a
      // previously loaded note image instead of downloading it on every
      // editor visit. The portal still keeps the response private behind the
      // authenticated admin proxy.
      reply.header('cache-control', 'private, max-age=31536000, immutable');
      reply.header('content-length', String(asset.byte_size));
      return reply.type(asset.content_type).send(createReadStream(asset.local_path));
    } catch {
      return reply.code(404).type('application/json').send({ error: 'file_not_found' });
    }
  });
}
