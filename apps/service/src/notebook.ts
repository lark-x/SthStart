import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import type { NoteKnowledge } from '@sthstart/contracts';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';
import { KnowledgeStore, knowledgeContentHash, normalizeKnowledge } from './knowledge/store.js';

const kinds = new Set(['diary', 'idea', 'note', 'story', 'character', 'world']);
const stages = new Set(['draft', 'reference', 'story-candidate']);
const usages = new Set(['record', 'pending', 'reference']);
const natures = new Set(['canon', 'community', 'personal', 'unconfirmed']);
const categories = new Set(['relation', 'personality', 'preference', 'location', 'plot', 'inspiration', 'other']);
const NOTE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_PAGE_SIZE = 50;
/** 未提供分页参数时沿用旧行为（最多 300 条），保证离线缓存不缺内容。 */
const LEGACY_LIMIT = 300;
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
  /** 缺省表示不改动已有元数据；null 表示显式清空。 */
  knowledge?: unknown;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function mapNote(row: Record<string, unknown>, knowledge: NoteKnowledge | null) {
  return {
    id: String(row.id), title: String(row.title), kind: String(row.kind), summary: String(row.summary),
    content: JSON.parse(String(row.content_json)) as unknown[], tags: JSON.parse(String(row.tags_json)) as string[],
    stage: String(row.stage), favorite: Boolean(row.favorite),
    revision: Number(row.revision ?? 1),
    ...(knowledge ? { knowledge } : {}),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function validate(body: NoteBody): { title: string; kind: string; stage: string; summary: string; content: unknown[]; tags: string[]; favorite: boolean } {
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

function parseList(value: unknown, limit: number): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()).slice(0, limit);
  if (typeof value === 'string' && value.trim()) return value.split(',').map((item) => item.trim()).filter(Boolean).slice(0, limit);
  return [];
}

export function registerNotebookRoutes(app: FastifyInstance, config: ServiceConfig, database: ServiceDatabase) {
  const knowledgeStore = new KnowledgeStore(database);

  app.get<{
    Querystring: {
      q?: string; kind?: string; stage?: string; works?: string | string[]; characters?: string | string[];
      category?: string; usage?: string; nature?: string; favorite?: string; page?: string; pageSize?: string;
    };
  }>('/api/v1/admin/notebook/notes', async (request) => {
    const query = request.query ?? {};
    const conditions: string[] = [];
    const values: unknown[] = [];
    const baseConditions: string[] = [];
    const baseValues: unknown[] = [];
    const escape = '\\';

    if (query.kind && kinds.has(query.kind)) { conditions.push('n.kind = ?'); values.push(query.kind); baseConditions.push('n.kind = ?'); baseValues.push(query.kind); }
    if (query.stage && stages.has(query.stage)) { conditions.push('n.stage = ?'); values.push(query.stage); baseConditions.push('n.stage = ?'); baseValues.push(query.stage); }
    const q = query.q?.trim();
    if (q) {
      const search = '%' + escapeLike(q) + '%';
      // 元数据里的作品、角色与资料名也参与检索，避免“搜不到刚填的作品”。
      const clause = "(n.title LIKE ? ESCAPE '" + escape + "' OR n.summary LIKE ? ESCAPE '" + escape
        + "' OR n.tags_json LIKE ? ESCAPE '" + escape + "' OR n.content_json LIKE ? ESCAPE '" + escape
        + "' OR k.works_json LIKE ? ESCAPE '" + escape + "' OR k.characters_json LIKE ? ESCAPE '" + escape
        + "' OR k.locations_json LIKE ? ESCAPE '" + escape + "')";
      conditions.push(clause); values.push(search, search, search, search, search, search, search);
      baseConditions.push(clause); baseValues.push(search, search, search, search, search, search, search);
    }
    for (const work of parseList(query.works, 20)) {
      conditions.push("k.works_json LIKE ? ESCAPE '" + escape + "'");
      values.push('%"' + escapeLike(work) + '"%');
    }
    for (const character of parseList(query.characters, 20)) {
      conditions.push("k.characters_json LIKE ? ESCAPE '" + escape + "'");
      values.push('%"' + escapeLike(character) + '"%');
    }
    if (query.category && categories.has(query.category)) { conditions.push('k.category=?'); values.push(query.category); }
    if (query.usage && usages.has(query.usage)) { conditions.push('k.usage=?'); values.push(query.usage); }
    if (query.nature && natures.has(query.nature)) { conditions.push('k.nature=?'); values.push(query.nature); }
    if (query.favorite === '1' || query.favorite === 'true') conditions.push('n.favorite=1');

    const from = ' FROM creative_notes n LEFT JOIN note_knowledge k ON k.note_id=n.id ';
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const baseWhere = baseConditions.length ? 'WHERE ' + baseConditions.join(' AND ') : '';

    const paginated = query.page !== undefined || query.pageSize !== undefined;
    const pageSize = paginated
      ? Math.min(Math.max(Math.trunc(Number(query.pageSize) || DEFAULT_PAGE_SIZE), 1), 200)
      : LEGACY_LIMIT;
    const page = Math.max(1, Math.trunc(Number(query.page) || 1));
    const rows = database.connection.prepare(
      'SELECT n.*' + from + where + ' ORDER BY n.favorite DESC, n.updated_at DESC LIMIT ? OFFSET ?',
    ).all(...values as never[], pageSize, (page - 1) * pageSize) as Record<string, unknown>[];

    const knowledgeMap = knowledgeStore.listKnowledge(rows.map((row) => String(row.id)));
    const totalRow = database.connection.prepare('SELECT COUNT(*) count' + from + where).get(...values as never[]) as { count?: number } | undefined;

    // 分面只随关键词/种类/阶段变化：筛选作品后再看作品分面才不会自相矛盾。
    const facetRows = database.connection.prepare(
      'SELECT k.works_json, k.characters_json, k.category, k.usage, k.nature' + from + baseWhere,
    ).all(...baseValues as never[]) as Array<Record<string, unknown>>;
    const collect = (field: string, jsonArray: boolean) => {
      const counts = new Map<string, number>();
      for (const row of facetRows) {
        if (jsonArray) {
          let list: unknown = [];
          try { list = JSON.parse(String(row[field] ?? '[]')); } catch { list = []; }
          if (!Array.isArray(list)) continue;
          for (const item of list) {
            const name = typeof item === 'string' ? item : (item && typeof item === 'object' ? String((item as Record<string, unknown>).name ?? '') : '');
            if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
          }
        } else if (row[field]) {
          const value = String(row[field]);
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }
      }
      return [...counts.keys()].sort((a, b) => a.localeCompare(b, 'zh'));
    };

    return {
      items: rows.map((row) => mapNote(row, knowledgeMap.get(String(row.id)) ?? null)),
      total: Number(totalRow?.count ?? rows.length),
      page,
      pageSize,
      facets: {
        works: collect('works_json', true),
        characters: collect('characters_json', true),
        categories: collect('category', false),
        usages: collect('usage', false),
        natures: collect('nature', false),
      },
    };
  });

  app.post<{ Body: NoteBody }>('/api/v1/admin/notebook/notes', async (request, reply) => {
    const note = validate(request.body ?? {}); const id = randomUUID(); const now = nowIso();
    database.connection.prepare(`INSERT INTO creative_notes
      (id,title,kind,summary,content_json,tags_json,stage,favorite,created_at,updated_at,revision)
      VALUES (?,?,?,?,?,?,?,?,?,?,1)`)
      .run(id, note.title, note.kind, note.summary, JSON.stringify(note.content), JSON.stringify(note.tags), note.stage, note.favorite ? 1 : 0, now, now);
    linkNoteAssets(database, id, note.content);
    // 新建时带元数据就直接写入；否则保持“没有元数据行”= 默认仅记录。
    const requested = (request.body as NoteBody | undefined)?.knowledge;
    if (requested !== undefined && requested !== null) {
      const knowledge = normalizeKnowledge(requested);
      knowledgeStore.writeKnowledge(id, { ...knowledge, contentHash: knowledgeContentHash(note), contentRevision: 1 });
    }
    const row = database.connection.prepare('SELECT * FROM creative_notes WHERE id=?').get(id) as Record<string, unknown>;
    return reply.code(201).send(mapNote(row, knowledgeStore.readKnowledge(id)));
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/notebook/notes/:id', async (request, reply) => {
    const row = database.connection.prepare('SELECT * FROM creative_notes WHERE id=?').get(request.params.id) as Record<string, unknown> | undefined;
    return row ? mapNote(row, knowledgeStore.readKnowledge(String(row.id))) : reply.code(404).send({ error: 'not_found' });
  });

  /** 某篇资料被哪些企划或活动引用过。 */
  app.get<{ Params: { id: string } }>('/api/v1/admin/notebook/notes/:id/references', async (request) => ({
    items: knowledgeStore.listReferencesFor('note', request.params.id),
  }));

  app.put<{ Params: { id: string }; Body: NoteBody }>('/api/v1/admin/notebook/notes/:id', async (request, reply) => {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(request.params.id)) return reply.code(400).send({ error: 'invalid_note_id' });
    const existing = database.connection.prepare('SELECT created_at,revision FROM creative_notes WHERE id=?').get(request.params.id) as { created_at: string; revision: number } | undefined;
    const note = validate(request.body ?? {});
    const now = nowIso();
    const requestedKnowledge = (request.body as NoteBody | undefined)?.knowledge;
    // 缺省 = 不改动已有元数据（旧客户端同步不会把它清掉）；null = 显式清空。
    const previous = knowledgeStore.readKnowledge(request.params.id);
    if (!existing) {
      database.connection.prepare(`INSERT INTO creative_notes
        (id,title,kind,summary,content_json,tags_json,stage,favorite,created_at,updated_at,revision)
        VALUES (?,?,?,?,?,?,?,?,?,?,1)`)
        .run(request.params.id, note.title, note.kind, note.summary, JSON.stringify(note.content), JSON.stringify(note.tags), note.stage, note.favorite ? 1 : 0, now, now);
      linkNoteAssets(database, request.params.id, note.content);
      if (requestedKnowledge === null) knowledgeStore.deleteKnowledge(request.params.id);
      else if (requestedKnowledge !== undefined) {
        knowledgeStore.writeKnowledge(request.params.id, { ...normalizeKnowledge(requestedKnowledge, { fallback: previous }), contentHash: knowledgeContentHash(note), contentRevision: 1 });
      }
      const row = database.connection.prepare('SELECT * FROM creative_notes WHERE id=?').get(request.params.id) as Record<string, unknown>;
      return reply.code(201).send(mapNote(row, knowledgeStore.readKnowledge(request.params.id)));
    }
    database.connection.prepare(`UPDATE creative_notes SET title=?,kind=?,summary=?,content_json=?,tags_json=?,stage=?,favorite=?,updated_at=?,revision=revision+1 WHERE id=?`)
      .run(note.title, note.kind, note.summary, JSON.stringify(note.content), JSON.stringify(note.tags), note.stage, note.favorite ? 1 : 0, now, request.params.id);
    linkNoteAssets(database, request.params.id, note.content);
    const revision = Number(existing.revision ?? 1) + 1;
    if (requestedKnowledge === null) {
      knowledgeStore.deleteKnowledge(request.params.id);
    } else if (requestedKnowledge !== undefined) {
      const knowledge = normalizeKnowledge(requestedKnowledge, { fallback: previous });
      knowledgeStore.writeKnowledge(request.params.id, { ...knowledge, contentHash: knowledgeContentHash(note), contentRevision: revision });
    } else if (previous) {
      // 正文变了但元数据没带过来：只更新内容标记，来源关联与参考状态保持。
      knowledgeStore.writeKnowledge(request.params.id, { ...previous, contentHash: knowledgeContentHash(note), contentRevision: revision });
    }
    const row = database.connection.prepare('SELECT * FROM creative_notes WHERE id=?').get(request.params.id) as Record<string, unknown>;
    return mapNote(row, knowledgeStore.readKnowledge(request.params.id));
  });

  app.delete<{ Params: { id: string } }>('/api/v1/admin/notebook/notes/:id', async (request, reply) => {
    const assets = database.connection.prepare('SELECT id,local_path FROM note_assets WHERE note_id=?').all(request.params.id) as { id: string; local_path: string }[];
    // note_knowledge 通过外键级联删除；历史引用快照保存在企划与活动依据里，不随资料删除。
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
      path = resolve(directory, id + imageExtensions[storedContentType]);
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
      path = resolve(directory, id + extension);
      const temporaryPath = path + '.upload';
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
    return reply.code(201).send({ id, url: '/api/admin/notebook/assets/' + id });
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/notebook/assets/:id', async (request, reply) => {
    const asset = database.connection.prepare('SELECT local_path,content_type,byte_size FROM note_assets WHERE id=?').get(request.params.id) as { local_path: string; content_type: string; byte_size: number } | undefined;
    if (!asset) return reply.code(404).send({ error: 'not_found' });
    try {
      await access(asset.local_path);
      reply.header('cache-control', 'private, max-age=31536000, immutable');
      reply.header('content-length', String(asset.byte_size));
      return reply.type(asset.content_type).send(createReadStream(asset.local_path));
    } catch {
      return reply.code(404).type('application/json').send({ error: 'file_not_found' });
    }
  });
}
