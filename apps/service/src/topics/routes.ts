import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import type {
  ActivityIdeaApply, ActivityIdeaApplyResult, ActivityIdeaBatchCreate,
  ActivityInspirationSnapshot, TopicCollectionSettingsSave, TopicCollectionSettings, TopicKind, TopicListQuery,
} from '@sthstart/contracts';
import { authenticateAdmin } from '../access.js';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import type { SecretStore } from '../security.js';
import { McpSourceStore } from '../mcp/store.js';
import { TopicStore } from './store.js';
import { IDEA_BATCH_LIST_LIMIT, IdeaStore, MAX_IDEA_TOPICS, runIdeaBatch } from './ideas.js';
import { runTopicCollection, type TopicCollectionOptions } from './collection.js';
import { DEFAULT_DAILY_TIME, DEFAULT_TIMEZONE, computeNextRunAt, describeInZone, normalizeTimezone, parseDailyTime } from './time.js';
import { ActivityStore } from '../activities/store.js';

export interface TopicRouteOptions extends TopicCollectionOptions {
  config: ServiceConfig;
  database: ServiceDatabase;
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

function errorResponse(reply: FastifyReply, error: unknown) {
  const status = (error as { statusCode?: number }).statusCode || 400;
  const code = (error as { code?: string }).code || 'topic_failed';
  return reply.code(status).send({ error: code, message: (error as Error).message });
}

function parseList(value: unknown, limit: number): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()).slice(0, limit);
  if (typeof value === 'string' && value.trim()) return value.split(',').map((item) => item.trim()).filter(Boolean).slice(0, limit);
  return [];
}

const KINDS: TopicKind[] = ['meme', 'character', 'update', 'occasion'];

export function registerTopicRoutes(app: FastifyInstance, options: TopicRouteOptions) {
  const { database, secrets, config } = options;
  const topics = new TopicStore(database);
  const ideas = new IdeaStore(database);
  ideas.interruptDanglingBatches();

  // ------------------------------------------------------------------ 素材库

  app.get<{ Querystring: Record<string, unknown> }>('/api/v1/admin/topics', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const query = request.query ?? {};
    const view = String(query.view ?? 'all');
    const listQuery: TopicListQuery = {
      q: typeof query.q === 'string' ? query.q : undefined,
      works: parseList(query.works, 20),
      kinds: parseList(query.kinds, 4).filter((kind): kind is TopicKind => KINDS.includes(kind as TopicKind)),
      days: query.days === undefined ? undefined : Math.max(0, Number(query.days) || 0),
      view: (['all', 'favorite', 'used', 'ignored'].includes(view) ? view : 'all') as TopicListQuery['view'],
      page: Number(query.page) || 1,
      pageSize: Number(query.pageSize) || 24,
    };
    return topics.listTopics(listQuery);
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/topics/:id', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const detail = topics.getTopicDetail(request.params.id);
    if (!detail) return reply.code(404).send({ error: 'topic_not_found' });
    return detail;
  });

  app.patch<{ Params: { id: string }; Body: { favorite?: boolean; ignored?: boolean } }>('/api/v1/admin/topics/:id', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const body = request.body ?? {};
    if (body.favorite === undefined && body.ignored === undefined) return reply.code(400).send({ error: 'nothing_to_update' });
    const updated = topics.updateTopicFlags(request.params.id, {
      ...(body.favorite === undefined ? {} : { favorite: Boolean(body.favorite) }),
      ...(body.ignored === undefined ? {} : { ignored: Boolean(body.ignored) }),
    });
    if (!updated) return reply.code(404).send({ error: 'topic_not_found' });
    return updated;
  });

  // ------------------------------------------------------------------ 搜集设置与任务

  app.get('/api/v1/admin/topic-collection/settings', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const settings = topics.getSettings();
    return {
      settings,
      /** 展示用的本地时间描述，避免前端各算一遍时区。 */
      nextRunLocal: describeInZone(settings.nextRunAt, settings.timezone),
      defaults: { dailyTime: DEFAULT_DAILY_TIME, timezone: DEFAULT_TIMEZONE },
    };
  });

  app.put<{ Body: TopicCollectionSettingsSave }>('/api/v1/admin/topic-collection/settings', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    try {
      const body = request.body ?? {};
      const current = topics.getSettings();
      if (body.enabled ?? current.enabled) {
        const bindings = body.sources ?? current.sources;
        const sources = new McpSourceStore(database, secrets);
        if (!bindings.length || bindings.some(binding => { const source = sources.get(binding.sourceId); return !source || source.status !== 'enabled' || !source.allowedTools.includes(binding.searchTool) || (binding.readTool && !source.allowedTools.includes(binding.readTool)); })) return reply.code(400).send({ error: 'invalid_sources', message: '请选择已启用的资料源及允许调用的搜索/读取工具。' });
      }
      const parsedTime = parseDailyTime(body.dailyTime ?? current.dailyTime);
      const settings = topics.saveSettings({
        enabled: body.enabled,
        works: body.works === undefined ? current.works : parseList(body.works, 50),
        keywords: body.keywords === undefined ? current.keywords : parseList(body.keywords, 30),
        sources: (body.sources ?? current.sources).map((item) => ({ sourceId: String(item.sourceId), searchTool: String(item.searchTool), ...(item.readTool ? { readTool: String(item.readTool) } : {}) })),
        dailyTime: String(parsedTime.hour).padStart(2, '0') + ':' + String(parsedTime.minute).padStart(2, '0'),
        timezone: normalizeTimezone(body.timezone ?? current.timezone),
        maxNewTopics: body.maxNewTopics,
      });
      return { settings, nextRunLocal: describeInZone(settings.nextRunAt, settings.timezone) };
    } catch (error) { return errorResponse(reply, error); }
  });

  app.get<{ Querystring: { limit?: string } }>('/api/v1/admin/topic-collection/runs', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const limit = Math.min(Math.max(Number(request.query?.limit) || 10, 1), 50);
    const items = topics.listRuns(limit);
    return { items, retryable: topics.findRetryableRun(), lastSuccessful: topics.lastSuccessfulRun() };
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/topic-collection/runs/:id', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const run = topics.getRun(request.params.id);
    if (!run) return reply.code(404).send({ error: 'run_not_found' });
    return run;
  });

  /**
   * 手动补采。定时与手动共用同一入口：已有任务在运行时不启动第二份。
   * 带 runId 时表示「重试上次失败任务」，复用已保存的原始候选，不重新搜索。
   */
  app.post<{ Body: { retryRunId?: string } }>('/api/v1/admin/topic-collection/runs', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const settings = topics.getSettings();
    const active = topics.findActiveRun();
    if (active) return reply.code(202).send({ run: active, reused: true });

    const retryRunId = typeof request.body?.retryRunId === 'string' ? request.body.retryRunId : '';
    if (retryRunId) {
      const previous = topics.getRun(retryRunId);
      if (!previous) return reply.code(404).send({ error: 'run_not_found' });
      const rawCandidates = topics.getRunRawCandidates(retryRunId);
      if (!['failed', 'partial', 'interrupted'].includes(previous.status)) return reply.code(409).send({ error: 'run_not_retryable', message: '该任务无需重试。' });
      const retrySettings = { ...settings, ...previous.settingsSnapshot } as TopicCollectionSettings;
      const run = topics.createRun({ trigger: 'retry', settingsSnapshot: { ...retrySettings, retriedRunId: retryRunId } as unknown as Record<string, unknown> });
      // 复用已保存的原始候选：不重新搜索，只重跑整理。
      const restored = rawCandidates.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
      void runTopicCollection(options, run, retrySettings, {
        rawCandidates: restored.map((item) => ({
          title: String(item.title ?? ''),
          url: String(item.url ?? ''),
          publishedAt: typeof item.publishedAt === 'string' ? item.publishedAt : null,
          excerpt: String(item.excerpt ?? ''),
          sourceId: String(item.sourceId ?? ''),
          sourceName: String(item.sourceName ?? ''),
          documentLocator: String(item.documentLocator ?? ''),
        })).filter((item) => item.title || item.url),
      });
      return reply.code(202).send({ run, reused: false });
    }

    if (!settings.sources.length) return reply.code(400).send({ error: 'sources_required', message: '请先配置搜集来源。' });
    const run = topics.createRun({ trigger: 'manual', settingsSnapshot: settings as unknown as Record<string, unknown> });
    void runTopicCollection(options, run, settings, {});
    return reply.code(202).send({ run, reused: false });
  });

  // ------------------------------------------------------------------ 点子批次

  app.get<{ Querystring: { limit?: string } }>('/api/v1/admin/activity-idea-batches', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const limit = Math.min(Math.max(Number(request.query?.limit) || IDEA_BATCH_LIST_LIMIT, 1), 50);
    return { items: ideas.listBatches(limit) };
  });

  app.post<{ Body: ActivityIdeaBatchCreate & { appendToBatchId?: string; ideaCount?: number } }>('/api/v1/admin/activity-idea-batches', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    try {
      const body = request.body ?? ({} as ActivityIdeaBatchCreate);
      const appendBatch = body.appendToBatchId ? ideas.getBatch(body.appendToBatchId) : null;
      const topicIds = [...new Set(parseList(appendBatch?.topics.map(topic => topic.id) ?? body.topicIds, MAX_IDEA_TOPICS + 1))];
      if (!topicIds.length) return reply.code(400).send({ error: 'topics_required', message: '请至少选择一条素材。' });
      if (topicIds.length > MAX_IDEA_TOPICS) return reply.code(400).send({ error: 'too_many_topics', message: '最多选择 ' + MAX_IDEA_TOPICS + ' 条素材。' });
      const selected = topicIds.map((id) => topics.getTopic(id)).filter((topic): topic is NonNullable<typeof topic> => Boolean(topic)).map(topic => ({ ...topic, sourceSnapshot: topics.getTopicSources([topic.id]) }));
      if (!selected.length) return reply.code(404).send({ error: 'topics_not_found' });

      // 追加一批候选：沿用已有批次的素材与要求，保留前一批点子。
      const appendTo = typeof request.body?.appendToBatchId === 'string' ? request.body.appendToBatchId : '';
      if (appendTo) {
        const batch = ideas.getBatch(appendTo);
        if (!batch) return reply.code(404).send({ error: 'batch_not_found' });
        if (['queued', 'running'].includes(batch.status)) return reply.code(409).send({ error: 'batch_running', message: '该批次仍在生成中。' });
        const count = Math.min(Math.max(Math.floor(Number(request.body?.ideaCount) || 3), 1), 3);
        void runIdeaBatch(options, batch, { topics: batch.topics, ideaCount: count, variantSeed: crypto.randomUUID() });
        return reply.code(202).send(ideas.getBatch(batch.id));
      }

      const running = ideas.findRunningBatch();
      if (running) return reply.code(409).send({ error: 'batch_running', message: '已有点子正在生成，请完成后再生成新的批次。' });

      const leadCharacterId = typeof body.leadCharacterId === 'string' && body.leadCharacterId.trim() ? body.leadCharacterId.trim() : undefined;
      const leadCharacterName = leadCharacterId
        ? ((database.connection.prepare('SELECT display_name FROM character_profiles WHERE id=?').get(leadCharacterId) as { display_name?: string } | undefined)?.display_name ?? undefined)
        : undefined;
      const count = Math.min(Math.max(Math.floor(Number(request.body?.ideaCount) || 3), 1), 3);
      const created = ideas.createBatch({
        topics: selected,
        requirement: String(body.requirement ?? '').slice(0, 2_000),
        leadCharacterId,
        leadCharacterName,
        activityType: String(body.activityType ?? '').slice(0, 80),
      });
      if (created.isExisting) return reply.code(202).send(created.batch);
      void runIdeaBatch(options, created.batch, {
        topics: selected,
        ideaCount: count,
        variantSeed: body.previousBatchId ? '追加批次，参考批次 ' + body.previousBatchId : crypto.randomUUID(),
      });
      return reply.code(202).send(created.batch);
    } catch (error) { return errorResponse(reply, error); }
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/activity-idea-batches/:id', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const batch = ideas.getBatch(request.params.id);
    if (!batch) return reply.code(404).send({ error: 'batch_not_found' });
    return batch;
  });

  /**
   * 采用点子：创建或更新目标企划会话，返回会话 ID。
   * 重复应用同一请求不会创建重复会话。
   */
  app.post<{ Params: { id: string; ideaId: string }; Body: ActivityIdeaApply }>(
    '/api/v1/admin/activity-idea-batches/:id/ideas/:ideaId/apply',
    async (request, reply) => {
      if (!checkAdmin(config, request, reply)) return;
      try {
        const batch = ideas.getBatch(request.params.id);
        if (!batch) return reply.code(404).send({ error: 'batch_not_found' });
        const idea = batch.ideas.find((item) => item.id === request.params.ideaId);
        if (!idea) return reply.code(404).send({ error: 'idea_not_found' });

        const snapshot: ActivityInspirationSnapshot = {
          batchId: batch.id,
          sources: batch.topics.flatMap(topic => topic.sourceSnapshot ?? topics.getTopicSources([topic.id])),
          recommendedCharacters: idea.recommendedCharacters, stages: idea.stages,
          ideaId: idea.id,
          ideaName: idea.name,
          overview: idea.overview,
          adaptation: idea.adaptation,
          location: idea.location,
          style: idea.style,
          expectedHighlights: idea.expectedHighlights,
          assumptions: idea.assumptions,
          topics: batch.topics.map((topic) => ({
            id: topic.id,
            title: topic.title,
            summary: topic.summary,
            works: topic.works,
            kind: topic.kind,
            infoNature: topic.infoNature,
          })),
          requirement: batch.requirement,
          appliedAt: new Date().toISOString(),
        };

        // 动态导入避免循环依赖：企划模块也会引用话题类型。
        const planning = await import('../activities/planning.js');
        const result = planning.applyIdeaToPlanningSession({
          config,
          database,
          secrets,
          fetcher: options.fetcher,
          store: new ActivityStore(database),
        }, {
          batch,
          idea,
          snapshot,
          sessionId: typeof request.body?.sessionId === 'string' && request.body.sessionId.trim() ? request.body.sessionId.trim() : undefined,
          overrides: request.body?.overrides ?? {},
        });
        return reply.code(result.createdSession ? 201 : 200).send(result satisfies ActivityIdeaApplyResult);
      } catch (error) { return errorResponse(reply, error); }
    },
  );
}

export { IdeaStore, computeNextRunAt };
