import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';

const kinds = new Set(['diary', 'idea', 'note', 'story', 'character', 'world']);
const stages = new Set(['draft', 'reference', 'story-candidate']);

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
    database.connection.prepare('INSERT INTO creative_notes VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, note.title, note.kind, note.summary, JSON.stringify(note.content), JSON.stringify(note.tags), note.stage, note.favorite ? 1 : 0, now, now);
    return reply.code(201).send(mapNote(database.connection.prepare('SELECT * FROM creative_notes WHERE id=?').get(id) as Record<string, unknown>));
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/notebook/notes/:id', async (request, reply) => {
    const row = database.connection.prepare('SELECT * FROM creative_notes WHERE id=?').get(request.params.id) as Record<string, unknown> | undefined;
    return row ? mapNote(row) : reply.code(404).send({ error: 'not_found' });
  });

  app.put<{ Params: { id: string }; Body: NoteBody }>('/api/v1/admin/notebook/notes/:id', async (request, reply) => {
    const existing = database.connection.prepare('SELECT created_at FROM creative_notes WHERE id=?').get(request.params.id);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const note = validate(request.body ?? {});
    database.connection.prepare(`UPDATE creative_notes SET title=?,kind=?,summary=?,content_json=?,tags_json=?,stage=?,favorite=?,updated_at=? WHERE id=?`)
      .run(note.title, note.kind, note.summary, JSON.stringify(note.content), JSON.stringify(note.tags), note.stage, note.favorite ? 1 : 0, nowIso(), request.params.id);
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

  app.post<{ Body: { noteId?: string; dataUrl?: string; filename?: string } }>('/api/v1/admin/notebook/assets', async (request, reply) => {
    const match = request.body?.dataUrl?.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return reply.code(400).send({ error: 'invalid_image' });
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > 8 * 1024 * 1024) return reply.code(413).send({ error: 'image_too_large' });
    const id = randomUUID(); const extension = extname(request.body.filename ?? '') || `.${match[1].split('/')[1].replace('jpeg', 'jpg')}`;
    const directory = resolve(config.artifactDirectory, 'notebook'); const path = resolve(directory, `${id}${extension}`);
    await mkdir(directory, { recursive: true }); await writeFile(path, bytes, { flag: 'wx' });
    database.connection.prepare('INSERT INTO note_assets VALUES (?,?,?,?,?,?,?)')
      .run(id, request.body.noteId || null, path, match[1], bytes.length, request.body.filename?.slice(0, 255) || null, nowIso());
    return reply.code(201).send({ id, url: `/api/admin/notebook/assets/${id}` });
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/notebook/assets/:id', async (request, reply) => {
    const asset = database.connection.prepare('SELECT local_path,content_type FROM note_assets WHERE id=?').get(request.params.id) as { local_path: string; content_type: string } | undefined;
    if (!asset) return reply.code(404).send({ error: 'not_found' });
    try { return reply.type(asset.content_type).send(await readFile(asset.local_path)); }
    catch { return reply.code(404).send({ error: 'file_not_found' }); }
  });
}
