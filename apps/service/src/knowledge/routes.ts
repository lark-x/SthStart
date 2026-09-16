import { Value } from '@sinclair/typebox/value';
import { PlanningKnowledgeReferenceSchema, PlanningKnowledgeSnapshotSchema } from '@sthstart/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  KnowledgeRecommendation, KnowledgeReferenceCheckResponse, KnowledgeSearchResponse,
  NoteKnowledge, PlanningReferenceSelection,
} from '@sthstart/contracts';
import type { PlanningKnowledgeSnapshot } from '@sthstart/contracts';
import { KNOWLEDGE_MAX_REFERENCES } from '@sthstart/contracts';
import { authenticateAdmin } from '../access.js';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import type { NarrativeDatabase } from '../narrative-database.js';
import type { SecretStore } from '../security.js';
import { KnowledgeStore, normalizeKnowledge } from './store.js';
import { recommendNotes, searchKnowledge, searchNotes } from './search.js';
import { suggestGaps } from './gaps.js';
import crypto from 'node:crypto';
import { checkReferences, compileSnapshot } from './references.js';
import { resolveReference } from './references.js';
import { nowIso } from '../database.js';
import {
  KnowledgeCollectionStore, adoptOrganizeDraft, runKnowledgeCollection, runOrganizeDraft,
} from './collections.js';
import { contentHashOf, noteReferenceText } from './store.js';

export interface KnowledgeRouteOptions {
  config: ServiceConfig;
  database: ServiceDatabase;
  narrativeDatabase: NarrativeDatabase | null;
  secrets: SecretStore;
  fetcher?: typeof fetch;
}

function checkAdmin(config: ServiceConfig, request: FastifyRequest, reply: FastifyReply): boolean {
  if (config.adminToken && !authenticateAdmin(config.adminToken, request)) {
    reply.code(401).send({ error: 'unauthorized', message: '未授权的管理请求。' });
    return false;
  }
  return true;
}

function parseList(value: unknown, limit: number): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()).slice(0, limit);
  if (typeof value === 'string' && value.trim()) return value.split(',').map((item) => item.trim()).filter(Boolean).slice(0, limit);
  return [];
}

function errorResponse(reply: FastifyReply, error: unknown) {
  const status = (error as { statusCode?: number }).statusCode || 400;
  const code = (error as { code?: string }).code || 'knowledge_failed';
  return reply.code(status).send({ error: code, message: (error as Error).message });
}

function parseSelections(value: unknown): PlanningReferenceSelection[] {
  if (!Array.isArray(value)) return [];
  const out: PlanningReferenceSelection[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const sourceKind = String(raw.sourceKind ?? '');
    if (!['note', 'narrative', 'collection', 'topic'].includes(sourceKind)) continue;
    const sourceId = String(raw.sourceId ?? '').trim();
    if (!sourceId) continue;
    const usage = raw.usage === 'requirement' ? 'requirement' as const : 'background' as const;
    const excerptOverride = typeof raw.excerptOverride === 'string' && raw.excerptOverride.trim() ? raw.excerptOverride.trim().slice(0, 8_000) : undefined;
    out.push({
      sourceKind: sourceKind as PlanningReferenceSelection['sourceKind'],
      sourceId,
      usage,
      ...(excerptOverride ? { excerptOverride } : {}),
      ...(Value.Check(PlanningKnowledgeReferenceSchema, raw.frozenReference) ? { frozenReference: raw.frozenReference } : {}),
    });
    if (out.length >= KNOWLEDGE_MAX_REFERENCES) break;
  }
  return out;
}

export function registerKnowledgeRoutes(app: FastifyInstance, options: KnowledgeRouteOptions) {

/** 待整理各状态数量，用于页面上的计数徽标。 */
function countsByPendingState(database: ServiceDatabase): Record<string, number> {
  const rows = database.connection.prepare('SELECT state, COUNT(*) count FROM knowledge_pending_items GROUP BY state').all() as Array<{ state?: string; count?: number }>;
  const counts: Record<string, number> = { pending: 0, kept: 0, ignored: 0, organized: 0 };
  for (const row of rows) counts[String(row.state ?? 'pending')] = Number(row.count ?? 0);
  return counts;
}

/**
 * 把话题素材收藏到资料库：保留话题身份、摘要快照与原有来源。
 * 重复点击返回已有收藏，不复制第二份。
 */
function saveTopicToKnowledge(database: ServiceDatabase, topicId: string): { noteId: string; created: boolean } {
  const existing = database.connection.prepare("SELECT note_id FROM note_knowledge WHERE origin_json LIKE ? LIMIT 1")
    .get('%"kind":"topic","refId":"' + topicId.replace(/"/g, '') + '"%') as { note_id?: string } | undefined;
  if (existing?.note_id) return { noteId: String(existing.note_id), created: false };

  const topic = database.connection.prepare('SELECT * FROM topics WHERE id=?').get(topicId) as Record<string, unknown> | undefined;
  if (!topic) throw Object.assign(new Error('话题素材不存在。'), { statusCode: 404, code: 'topic_not_found' });
  const sources = database.connection.prepare('SELECT * FROM topic_sources WHERE topic_id=? ORDER BY COALESCE(published_at, created_at) DESC LIMIT 6').all(topicId) as Record<string, unknown>[];
  const works = (() => { try { const parsed = JSON.parse(String(topic.works_json ?? '[]')) as unknown; return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } })();
  const characters = (() => { try { const parsed = JSON.parse(String(topic.characters_json ?? '[]')) as unknown; return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } })();
  const summary = String(topic.summary ?? '');
  const title = String(topic.title ?? '话题素材');

  const noteId = crypto.randomUUID();
  const now = new Date().toISOString();
  const blocks = [{ id: crypto.randomUUID(), type: 'text', text: summary }];
  database.connection.prepare(`INSERT INTO creative_notes
    (id,title,kind,summary,content_json,tags_json,stage,favorite,created_at,updated_at,revision)
    VALUES (?,?,'idea',?,?,'["话题素材"]','draft',0,?,?,1)`)
    .run(noteId, title.slice(0, 200), summary.slice(0, 500), JSON.stringify(blocks), now, now);

  const knowledge = new KnowledgeStore(database);
  knowledge.writeKnowledge(noteId, {
    schemaVersion: 1,
    works: works.map((name) => ({ key: name, name })),
    characters: characters.map((name) => ({ work: works[0] ?? '', name })),
    locations: [],
    category: 'inspiration',
    nature: String(topic.info_nature ?? '') === 'official' ? 'canon' : 'community',
    authorship: 'excerpt',
    usage: 'record',
    sources: sources.map((source) => ({
      id: crypto.randomUUID(),
      kind: 'topic' as const,
      title: String(source.title ?? title),
      excerpt: String(source.excerpt ?? '').slice(0, 2_000),
      ...(source.url ? { url: String(source.url) } : {}),
      ...(source.published_at ? { publishedAt: String(source.published_at) } : {}),
      retrievedAt: String(source.created_at ?? now),
    })),
    origin: { kind: 'topic', refId: topicId, label: title, createdAt: now },
    contentHash: contentHashOf(noteReferenceText({ title, summary, content: blocks })),
    contentRevision: 1,
  });
  return { noteId, created: true };
}

  const { config, database, narrativeDatabase, secrets } = options;
  const store = new KnowledgeStore(database);
  const dependencies = { database, narrativeDatabase };
  const collections = new KnowledgeCollectionStore(database);
  // 服务重启后把未完成的执行记录标记为中断，避免永久“运行中”。
  collections.interruptDanglingRuns();
  void secrets;

  /** 一起检索资料与本地叙事摘录。只读，不触发联网。 */
  app.get<{ Querystring: { q?: string; workId?: string; works?: string | string[]; characters?: string | string[]; kinds?: string | string[]; limit?: string } }>(
    '/api/v1/admin/knowledge/search',
    async (request, reply) => {
      if (!checkAdmin(config, request, reply)) return;
      const query = request.query ?? {};
      const result: KnowledgeSearchResponse = searchKnowledge(dependencies, {
        q: query.q,
        workId: query.workId,
        works: parseList(query.works, 20),
        characters: parseList(query.characters, 20),
        kinds: parseList(query.kinds, 4),
        limit: Number(query.limit) || undefined,
      });
      return result;
    },
  );

  /** 只查资料，不查叙事：用于资料库列表内的“查找资料”。 */
  app.get<{ Querystring: { q?: string; works?: string | string[]; characters?: string | string[]; usage?: string; category?: string; limit?: string } }>(
    '/api/v1/admin/knowledge/notes',
    async (request, reply) => {
      if (!checkAdmin(config, request, reply)) return;
      const query = request.query ?? {};
      return searchNotes(database, {
        q: query.q,
        works: parseList(query.works, 20),
        characters: parseList(query.characters, 20),
        usage: query.usage,
        category: query.category,
        limit: Number(query.limit) || undefined,
      });
    },
  );

  /**
   * 引用预览：按选择读取权威内容并编译快照，但不保存。
   * 让用户在生成前看到实际会送给模型的正文与截断情况。
   */
  app.post<{ Body: { selections?: unknown } }>('/api/v1/admin/knowledge/references/preview', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const selections = parseSelections(request.body?.selections);
    if (!selections.length) return { snapshot: { schemaVersion: 1, capturedAt: new Date().toISOString(), references: [] }, unresolved: [], truncated: false };
    const result = compileSnapshot(dependencies, selections);
    return result;
  });

  /** 更新检查：只比较本地内容 hash / revision，不逐条联网。 */
  app.post<{ Body: { snapshot?: unknown } }>('/api/v1/admin/knowledge/references/check', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const snapshot = request.body?.snapshot;
    if (!Value.Check(PlanningKnowledgeSnapshotSchema, snapshot)) {
      return reply.code(400).send({ error: 'invalid_snapshot' });
    }
    const result: KnowledgeReferenceCheckResponse = checkReferences(dependencies, snapshot);
    return result;
  });

  /** 本地推荐：按作品、角色、地点与主题推荐已有资料。 */
  app.get<{ Querystring: { works?: string | string[]; characters?: string | string[]; locations?: string | string[]; theme?: string; keywords?: string | string[]; limit?: string; includePending?: string } }>(
    '/api/v1/admin/knowledge/recommendations',
    async (request, reply) => {
      if (!checkAdmin(config, request, reply)) return;
      const query = request.query ?? {};
      const items: KnowledgeRecommendation[] = recommendNotes(database, {
        works: parseList(query.works, 20),
        characters: parseList(query.characters, 30),
        locations: parseList(query.locations, 20),
        theme: query.theme ?? '',
        keywords: parseList(query.keywords, 10),
        limit: Number(query.limit) || undefined,
        includePending: query.includePending === '1' || query.includePending === 'true',
      });
      return { items, empty: items.length === 0 };
    },
  );

  /** 单篇资料的元数据读写（资料属性面板使用）。 */
  app.get<{ Params: { id: string } }>('/api/v1/admin/knowledge/notes/:id/knowledge', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const note = database.connection.prepare('SELECT id FROM creative_notes WHERE id=?').get(request.params.id);
    if (!note) return reply.code(404).send({ error: 'not_found' });
    return { knowledge: store.readKnowledge(request.params.id) };
  });

  app.put<{ Params: { id: string }; Body: { knowledge?: unknown } }>('/api/v1/admin/knowledge/notes/:id/knowledge', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const note = database.connection.prepare('SELECT * FROM creative_notes WHERE id=?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!note) return reply.code(404).send({ error: 'not_found' });
    if (request.body?.knowledge === null) {
      store.deleteKnowledge(request.params.id);
      return { knowledge: null };
    }
    const previous = store.readKnowledge(request.params.id);
    const knowledge: NoteKnowledge = normalizeKnowledge(request.body?.knowledge, { fallback: previous });
    store.writeKnowledge(request.params.id, knowledge);
    store.syncContentMarker(request.params.id, {
      title: String(note.title),
      summary: String(note.summary ?? ''),
      content: (() => { try { const parsed = JSON.parse(String(note.content_json ?? '[]')) as unknown; return Array.isArray(parsed) ? parsed : []; } catch { return []; } })(),
    }, Number(note.revision ?? 1));
    return { knowledge: store.readKnowledge(request.params.id) };
  });

  /** 被引用记录：这篇资料出现在哪些企划或活动里。 */
  app.get<{ Params: { id: string } }>('/api/v1/admin/knowledge/notes/:id/references', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    return { items: store.listReferencesFor('note', request.params.id) };
  });

  /** 来源版本详情：待整理与整理草稿展示原始摘录。 */

  // ------------------------------------------------------------------ 搜集任务

  app.get('/api/v1/admin/knowledge/collections', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    return { items: collections.list(), runs: collections.listRuns({ limit: 20 }) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/knowledge/collections/:id', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const collection = collections.get(request.params.id);
    if (!collection) return reply.code(404).send({ error: 'collection_not_found' });
    return { collection, runs: collections.listRuns({ collectionId: collection.id, limit: 20 }) };
  });

  app.post<{ Body: Record<string, unknown> }>('/api/v1/admin/knowledge/collections', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    try {
      const body = request.body ?? {};
      const name = String(body.name ?? '').trim();
      if (!name) return reply.code(400).send({ error: 'name_required', message: '请填写任务名称。' });
      const collection = collections.save({
        name,
        goal: String(body.goal ?? ''),
        works: parseList(body.works, 20),
        characters: parseList(body.characters, 30),
        mode: body.mode === 'recent' ? 'recent' : 'topic',
        windowDays: Number(body.windowDays) || undefined,
        sources: Array.isArray(body.sources)
          ? (body.sources as Array<Record<string, unknown>>).map((item) => ({
              sourceId: String(item.sourceId ?? ''),
              searchTool: String(item.searchTool ?? ''),
              ...(item.readTool ? { readTool: String(item.readTool) } : {}),
            })).filter((item) => item.sourceId && item.searchTool)
          : [],
        targetNoteIds: parseList(body.targetNoteIds, 20),
        frequency: body.frequency === 'daily' ? 'daily' : body.frequency === 'weekly' ? 'weekly' : 'once',
        dailyTime: String(body.dailyTime ?? '09:00'),
        ...(body.weekday === undefined || body.weekday === null ? {} : { weekday: Number(body.weekday) }),
        timezone: String(body.timezone ?? 'Asia/Shanghai'),
        enabled: body.enabled === undefined ? true : Boolean(body.enabled),
        ...(typeof body.sessionId === 'string' && body.sessionId.trim() ? { sessionId: body.sessionId.trim() } : {}),
      });
      return reply.code(201).send(collection);
    } catch (error) { return errorResponse(reply, error); }
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/v1/admin/knowledge/collections/:id', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const existing = collections.get(request.params.id);
    if (!existing) return reply.code(404).send({ error: 'collection_not_found' });
    try {
      const body = request.body ?? {};
      return collections.save({
        name: String(body.name ?? existing.name),
        goal: body.goal === undefined ? existing.goal : String(body.goal),
        works: body.works === undefined ? existing.works : parseList(body.works, 20),
        characters: body.characters === undefined ? existing.characters : parseList(body.characters, 30),
        mode: body.mode === undefined ? existing.mode : (body.mode === 'recent' ? 'recent' : 'topic'),
        ...(body.windowDays === undefined ? {} : { windowDays: Number(body.windowDays) }),
        sources: body.sources === undefined
          ? existing.sources
          : (Array.isArray(body.sources) ? body.sources as Array<Record<string, unknown>> : []).map((item) => ({
              sourceId: String(item.sourceId ?? ''),
              searchTool: String(item.searchTool ?? ''),
              ...(item.readTool ? { readTool: String(item.readTool) } : {}),
            })).filter((item) => item.sourceId && item.searchTool),
        targetNoteIds: body.targetNoteIds === undefined ? existing.targetNoteIds : parseList(body.targetNoteIds, 20),
        frequency: body.frequency === undefined ? existing.frequency : (body.frequency === 'daily' ? 'daily' : body.frequency === 'weekly' ? 'weekly' : 'once'),
        dailyTime: String(body.dailyTime ?? existing.dailyTime),
        ...(body.weekday === undefined ? {} : { weekday: Number(body.weekday) }),
        timezone: String(body.timezone ?? existing.timezone),
        enabled: body.enabled === undefined ? existing.enabled : Boolean(body.enabled),
      }, existing);
    } catch (error) { return errorResponse(reply, error); }
  });

  /** 暂停 / 恢复：暂停停止未来调度，取消当前运行是另一个明确操作。 */
  app.patch<{ Params: { id: string }; Body: { enabled?: boolean } }>('/api/v1/admin/knowledge/collections/:id/enabled', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const updated = collections.setEnabled(request.params.id, Boolean(request.body?.enabled));
    if (!updated) return reply.code(404).send({ error: 'collection_not_found' });
    return updated;
  });

  /** 删除定义：默认保留已保存资料与来源。 */
  app.delete<{ Params: { id: string } }>('/api/v1/admin/knowledge/collections/:id', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const removed = collections.delete(request.params.id);
    return removed ? { ok: true } : reply.code(404).send({ error: 'collection_not_found' });
  });

  /**
   * 启动一次执行。手动与定时共用同一占用检查：同一任务同一时刻只运行一次。
   * 带 retryRunId 时复用上次已保存的来源版本，不重新搜索。
   */
  app.post<{ Params: { id: string }; Body: { retryRunId?: string } }>('/api/v1/admin/knowledge/collections/:id/run', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const collection = collections.get(request.params.id);
    if (!collection) return reply.code(404).send({ error: 'collection_not_found' });
    const active = collections.findActiveRun(collection.id);
    if (active) return reply.code(202).send({ run: active, reused: true });
    if (!collection.sources.length) return reply.code(400).send({ error: 'sources_required', message: '该任务没有资料源，请先编辑任务选择资料源。' });

    const retryRunId = typeof request.body?.retryRunId === 'string' ? request.body.retryRunId : '';
    const run = collections.createRun({
      collectionId: collection.id,
      trigger: retryRunId ? 'retry' : 'manual',
      settingsSnapshot: { ...collection, ...(retryRunId ? { retriedRunId: retryRunId } : {}) } as unknown as Record<string, unknown>,
    });
    if (retryRunId) {
      // 复用上次执行已保存的来源版本：只重新整理，不重新搜索。
      const previousRun = collections.getRun(retryRunId);
      if (!previousRun || previousRun.collectionId !== collection.id) {
        return reply.code(404).send({ error: 'run_not_found' });
      }
      const versionIds = collections.listPendingSourceVersionIds(retryRunId);
      if (!versionIds.length) {
        return reply.code(409).send({ error: 'nothing_to_retry', message: '该执行没有留下可复用的来源内容，无法只重试整理。' });
      }
      void runKnowledgeCollection(options, collection, run, { sourceVersionIds: versionIds });
      return reply.code(202).send({ run, reused: false });
    }
    void runKnowledgeCollection(options, collection, run);
    return reply.code(202).send({ run, reused: false });
  });

  app.get<{ Querystring: { collectionId?: string; limit?: string } }>('/api/v1/admin/knowledge/collection-runs', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    return { items: collections.listRuns({ collectionId: request.query?.collectionId, limit: Number(request.query?.limit) || 30 }) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/knowledge/collection-runs/:id', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const run = collections.getRun(request.params.id);
    if (!run) return reply.code(404).send({ error: 'run_not_found' });
    // 列出这次执行实际发现的结果（含重复发现与已整理条目），而不是该任务的全部待整理。
    return {
      run,
      findings: collections.listFindings(run.id),
      pending: collections.listPending({ runId: run.id, limit: 200 }),
    };
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/knowledge/collection-runs/:id/cancel', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const run = collections.cancelRun(request.params.id);
    if (!run) return reply.code(404).send({ error: 'run_not_found' });
    return run;
  });

  // ------------------------------------------------------------------ 待整理

  app.get<{ Querystring: { state?: string; collectionId?: string; limit?: string } }>('/api/v1/admin/knowledge/pending', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const items = collections.listPending({
      state: request.query?.state,
      collectionId: request.query?.collectionId,
      limit: Number(request.query?.limit) || 60,
    });
    return { items, counts: countsByPendingState(database) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/knowledge/pending/:id', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const item = collections.getPending(request.params.id);
    if (!item) return reply.code(404).send({ error: 'pending_not_found' });
    const versions = database.connection.prepare('SELECT * FROM knowledge_source_versions WHERE source_id=(SELECT source_id FROM knowledge_source_versions WHERE id=?) ORDER BY retrieved_at DESC LIMIT 20')
      .all(item.sourceVersionId) as Array<Record<string, unknown>>;
    return {
      item,
      versions: versions.map((row) => ({
        id: String(row.id),
        title: String(row.title ?? ''),
        excerpt: String(row.excerpt ?? ''),
        contentHash: String(row.content_hash),
        ...(row.published_at ? { publishedAt: String(row.published_at) } : {}),
        retrievedAt: String(row.retrieved_at),
        ...(row.truncated ? { truncated: true } : {}),
      })),
    };
  });

  /** 批量保留 / 忽略 / 恢复：忽略可以恢复，新版本会重新提示。 */
  app.patch<{ Body: { ids?: unknown; state?: unknown } }>('/api/v1/admin/knowledge/pending', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const ids = parseList(request.body?.ids, 200);
    const state = String(request.body?.state ?? '');
    if (!ids.length) return reply.code(400).send({ error: 'ids_required' });
    if (!['pending', 'kept', 'ignored', 'organized'].includes(state)) return reply.code(400).send({ error: 'invalid_state' });
    const changed = collections.setPendingState(ids, state as 'pending');
    return { changed, counts: countsByPendingState(database) };
  });

  // ------------------------------------------------------------------ 整理草稿

  app.get<{ Querystring: { limit?: string } }>('/api/v1/admin/knowledge/organize-drafts', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    return { items: collections.listDrafts(Number(request.query?.limit) || 20) };
  });

  app.post<{ Body: { itemIds?: unknown; narrativeRefIds?: unknown; targetNoteId?: string; instruction?: string } }>('/api/v1/admin/knowledge/organize-drafts', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const itemIds = parseList(request.body?.itemIds, 30);
    const narrativeRefIds = parseList(request.body?.narrativeRefIds, 30);
    if (!itemIds.length && !narrativeRefIds.length) return reply.code(400).send({ error: 'items_required', message: '请至少选择一条待整理资料或一段原文片段。' });
    const items = itemIds.map((id) => collections.getPending(id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (!items.length && !narrativeRefIds.length) return reply.code(404).send({ error: 'pending_not_found' });

    // 原文片段：解析成来源版本，草稿就有一份冻结的原始摘录可以查回。
    const narrativeVersions: Array<{ sourceVersionId: string }> = [];
    for (const refId of narrativeRefIds) {
      const resolved = resolveReference(dependencies, { sourceKind: 'narrative', sourceId: refId, usage: 'background' }, store);
      if (!resolved) continue;
      const sourceId = store.upsertSource({
        kind: 'narrative',
        ...(typeof resolved.locator?.workId === 'string' ? { providerId: String(resolved.locator.workId) } : {}),
        ...(typeof resolved.locator?.work === 'string' ? { work: String(resolved.locator.work) } : {}),
        externalKey: refId,
        title: resolved.title,
        sourceName: '叙事档案',
        nature: 'canon',
      });
      const version = store.recordSourceVersion(sourceId, {
        title: resolved.title,
        excerpt: resolved.excerpt,
        ...(typeof resolved.locator?.speaker === 'string' ? {} : {}),
      });
      narrativeVersions.push({ sourceVersionId: version.versionId });
    }

    const targetNoteId = typeof request.body?.targetNoteId === 'string' && request.body.targetNoteId.trim() ? request.body.targetNoteId.trim() : undefined;
    let baseRevision: number | undefined;
    let targetContentHash: string | undefined;
    if (targetNoteId) {
      const row = database.connection.prepare('SELECT * FROM creative_notes WHERE id=?').get(targetNoteId) as Record<string, unknown> | undefined;
      if (!row) return reply.code(404).send({ error: 'note_not_found' });
      baseRevision = Number(row.revision ?? 1);
      const blocks = (() => { try { const parsed = JSON.parse(String(row.content_json ?? '[]')) as unknown; return Array.isArray(parsed) ? parsed : []; } catch { return []; } })();
      targetContentHash = noteReferenceText({ title: String(row.title), summary: String(row.summary ?? ''), content: blocks });
      targetContentHash = contentHashOf(targetContentHash);
    }
    const draft = collections.createDraft({
      ...(targetNoteId ? { targetNoteId } : {}),
      ...(baseRevision === undefined ? {} : { baseRevision }),
      ...(targetContentHash ? { targetContentHash } : {}),
      sourceVersionIds: [...items.map((item) => item.sourceVersionId), ...narrativeVersions.map((item) => item.sourceVersionId)],
      sourceItemIds: items.map((item) => item.id),
      instruction: String(request.body?.instruction ?? ''),
    });
    void runOrganizeDraft(options, draft);
    return reply.code(202).send(collections.getDraft(draft.id));
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/knowledge/organize-drafts/:id', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const draft = collections.getDraft(request.params.id);
    if (!draft) return reply.code(404).send({ error: 'draft_not_found' });
    return draft;
  });

  app.post<{ Params: { id: string }; Body: { mode?: string; targetNoteId?: string; expectedRevision?: number; title?: string } }>(
    '/api/v1/admin/knowledge/organize-drafts/:id/adopt',
    async (request, reply) => {
      if (!checkAdmin(config, request, reply)) return;
      try {
        const mode = request.body?.mode === 'append' ? 'append' : 'new-note';
        const result = adoptOrganizeDraft(options, request.params.id, {
          mode,
          ...(request.body?.targetNoteId ? { targetNoteId: request.body.targetNoteId } : {}),
          ...(request.body?.expectedRevision === undefined ? {} : { expectedRevision: Number(request.body.expectedRevision) }),
          ...(request.body?.title ? { title: request.body.title } : {}),
        });
        return reply.code(result.created ? 201 : 200).send(result);
      } catch (error) { return errorResponse(reply, error); }
    },
  );

  /** 话题收藏到资料库：重复点击返回已有收藏，不复制第二份。 */

  /**
   * 缺失问题补查入口：列出本次检索范围内的缺口问题，用户也可以自己填写。
   * 不要求全面事实评估；模型不可用时这里仍然给出基础问题。
   */
  app.get<{ Querystring: { sessionId?: string; characters?: string | string[]; works?: string | string[]; theme?: string } }>(
    '/api/v1/admin/knowledge/gaps',
    async (request, reply) => {
      if (!checkAdmin(config, request, reply)) return;
      const query = request.query ?? {};
      const sessionId = typeof query.sessionId === 'string' ? query.sessionId.trim() : '';
      let snapshot: PlanningKnowledgeSnapshot | null = null;
      let works = parseList(query.works, 20);
      let characters = parseList(query.characters, 30);
      if (sessionId) {
        const row = database.connection.prepare('SELECT form_json,document_json FROM activity_planning_sessions WHERE id=?').get(sessionId) as { form_json?: string; document_json?: string } | undefined;
        if (!row) return reply.code(404).send({ error: 'session_not_found' });
        const form = (() => { try { return JSON.parse(String(row.form_json ?? '{}')) as Record<string, unknown>; } catch { return {}; } })();
        snapshot = (form.knowledgeSnapshot as PlanningKnowledgeSnapshot | undefined) ?? null;
        const document = (() => { try { return JSON.parse(String(row.document_json ?? '{}')) as Record<string, unknown>; } catch { return {}; } })();
        const actors = Array.isArray(document.actors) ? document.actors as Array<Record<string, unknown>> : [];
        if (!characters.length) characters = actors.slice(0, 5).map((actor) => String(actor.displayName ?? '')).filter(Boolean);
        if (!works.length && Array.isArray(form.crossoverWorks)) works = (form.crossoverWorks as string[]).slice(0, 10);
      }
      const referenceDates = (snapshot?.references ?? [])
        .map((reference) => reference.evidence?.[0]?.retrievedAt)
        .filter((value: string | undefined): value is string => Boolean(value));
      const items = suggestGaps(database, {
        snapshot,
        works,
        characters,
        ...(typeof query.theme === 'string' ? { theme: query.theme } : {}),
        referenceDates,
      });
      return { items, hasReferences: Boolean(snapshot?.references?.length) };
    },
  );

  /**
   * 活动回流为个人设定：从活动内容整理一篇资料。
   * 默认「仅记录」并标注来自哪个活动，不冒充原作剧情，也不自动供其他活动参考。
   */
  app.post<{ Body: { activityId?: string; title?: string; texts?: unknown; note?: string } }>(
    '/api/v1/admin/knowledge/notes/from-activity',
    async (request, reply) => {
      if (!checkAdmin(config, request, reply)) return;
      const activityId = String(request.body?.activityId ?? '').trim();
      if (!activityId) return reply.code(400).send({ error: 'activity_id_required' });
      const activity = database.connection.prepare('SELECT id,title FROM activities WHERE id=?').get(activityId) as { id: string; title: string } | undefined;
      if (!activity) return reply.code(404).send({ error: 'activity_not_found' });
      const texts = parseList(request.body?.texts, 40).length ? parseList(request.body?.texts, 40) : [];
      const blocks = texts.length
        ? texts.map((text) => ({ id: crypto.randomUUID(), type: 'text' as const, text }))
        : [];
      const note = typeof request.body?.note === 'string' ? request.body.note.trim() : '';
      if (note) blocks.push({ id: crypto.randomUUID(), type: 'text' as const, text: note });
      if (!blocks.length) return reply.code(400).send({ error: 'texts_required', message: '请先选择要整理的活动片段。' });
      const title = (typeof request.body?.title === 'string' && request.body.title.trim())
        ? request.body.title.trim().slice(0, 200)
        : '活动记录：' + activity.title;
      const noteId = crypto.randomUUID();
      const now = nowIso();
      const summary = blocks.map((block) => block.text).join(' ').slice(0, 180);
      database.connection.prepare("INSERT INTO creative_notes(id,title,kind,summary,content_json,tags_json,stage,favorite,created_at,updated_at,revision) VALUES (?,?,'story',?,?,'[]','draft',0,?,?,1)")
        .run(noteId, title, summary, JSON.stringify(blocks), now, now);
      store.writeKnowledge(noteId, {
        schemaVersion: 1, works: [], characters: [], locations: [],
        category: 'plot', nature: 'personal', authorship: 'excerpt', usage: 'record', sources: [],
        origin: { kind: 'activity', refId: activityId, label: activity.title, note: '来自活动内容，属于个人设定，不是原作剧情', createdAt: now },
        contentHash: contentHashOf(noteReferenceText({ title, summary, content: blocks })),
        contentRevision: 1,
      });
      return reply.code(201).send({ noteId, title });
    },
  );

  app.post<{ Params: { id: string } }>('/api/v1/admin/knowledge/topics/:id/save', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    return saveTopicToKnowledge(database, request.params.id);
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/knowledge/source-versions/:id', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const version = store.getSourceVersion(request.params.id);
    if (!version) return reply.code(404).send({ error: 'source_version_not_found' });
    return version;
  });
}
