import type { FastifyInstance } from 'fastify';
import type { ServiceDatabase } from '../database.js';
import type { NarrativeDatabase } from '../narrative-database.js';
import type { SecretStore } from '../security.js';
import type { NarrativeCorpusProvider, ResearchScope } from './corpus.js';
import { ResearchStore, type ClaimType, type ResearchProjectStatus } from './store.js';
import { executeResearchRun } from './run.js';
import { suggestResearchTopics } from './topics.js';
import { natureForClaims, unresolvedSynthesisIds } from './engine.js';
import { publishResearchDraft } from './publish.js';
import { regenerateSynthesis } from './synthesize.js';
import { randomUUID } from 'node:crypto';

export interface ResearchRoutesOptions {
  database: ServiceDatabase;
  narrativeDatabase: NarrativeDatabase;
  secrets: SecretStore;
  provider: NarrativeCorpusProvider;
  fetcher: typeof fetch;
}

const PROJECT_STATUSES: ResearchProjectStatus[] = ['draft', 'confirmed', 'researching', 'review', 'published', 'archived'];
const CLAIM_TYPES: ClaimType[] = ['fact', 'inference', 'speculation', 'contradiction', 'open-question'];

function normalizeScope(value: unknown, fallbackWorkId: string): ResearchScope {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const strings = (input: unknown, limit: number) => Array.isArray(input)
    ? input.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, limit) : [];
  const workId = String(row.workId ?? '').trim() || fallbackWorkId;
  const scope: ResearchScope = { workId };
  const nodeIds = strings(row.nodeIds, 200); const nodeKinds = strings(row.nodeKinds, 20);
  const entityIds = strings(row.entityIds, 200); const keywords = strings(row.keywords, 20);
  if (nodeIds.length) scope.nodeIds = nodeIds;
  if (nodeKinds.length) scope.nodeKinds = nodeKinds;
  if (entityIds.length) scope.entityIds = entityIds;
  if (keywords.length) scope.keywords = keywords;
  return scope;
}

/** 乐观并发：请求带 revision 时校验，不带则按最新版本写入。 */
function expectedRevision(request: { headers: Record<string, unknown>; body?: unknown }): number | undefined {
  const header = request.headers['if-match'];
  const fromHeader = typeof header === 'string' ? Number(header.replace(/[^0-9]/g, '')) : NaN;
  if (Number.isSafeInteger(fromHeader) && fromHeader > 0) return fromHeader;
  const body = request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {};
  const fromBody = Number(body.revision);
  return Number.isSafeInteger(fromBody) && fromBody > 0 ? fromBody : undefined;
}

export function registerResearchRoutes(app: FastifyInstance, options: ResearchRoutesOptions) {
  const { narrativeDatabase, provider, fetcher, secrets } = options;
  const store = new ResearchStore(narrativeDatabase);

  app.get('/api/v1/admin/narrative/research/provider', async () => ({ ...await provider.status() }));

  app.get<{ Querystring: { workId?: string; status?: string } }>('/api/v1/admin/narrative/research/projects', async (request, reply) => {
    const status = request.query.status;
    if (status && !PROJECT_STATUSES.includes(status as ResearchProjectStatus)) return reply.code(400).send({ error: 'invalid_status' });
    const items = store.listProjects({ workId: request.query.workId, status });
    return { items: items.map((project) => ({ ...project, runCount: store.listRuns(project.id).length })) };
  });

  app.post<{ Body: unknown }>('/api/v1/admin/narrative/research/projects', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const workId = String(body.workId ?? '').trim();
    const title = String(body.title ?? '').trim();
    if (!workId || !title) return reply.code(400).send({ error: 'invalid_project', message: 'workId 与 title 必填。' });
    const work = narrativeDatabase.connection.prepare('SELECT id FROM narrative_works WHERE id=?').get(workId);
    if (!work) return reply.code(404).send({ error: 'work_not_found' });
    const origin = body.origin === 'ai-suggested' ? 'ai-suggested' : 'user-defined';
    const project = store.createProject({
      workId, title, question: String(body.question ?? '').trim(),
      scope: normalizeScope(body.scope, workId), origin,
      selectedTopicId: body.selectedTopicId ? String(body.selectedTopicId) : null,
    });
    if (project.selectedTopicId) store.setSuggestionStatus(project.selectedTopicId, 'selected');
    return reply.code(201).send(project);
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/narrative/research/projects/:id', async (request, reply) => {
    const project = store.getProject(request.params.id);
    if (!project) return reply.code(404).send({ error: 'not_found' });
    const runs = store.listRuns(project.id);
    const claims = store.listClaims({ projectId: project.id });
    const drafts = store.listDrafts(project.id);
    return {
      project,
      runs: runs.map((run) => ({ ...run, evidenceCount: store.listEvidence({ runId: run.id }).length })),
      claims: claims.map((claim) => ({ ...claim, evidence: store.listEvidenceForClaim(claim.id) })),
      drafts,
      latestDraft: drafts[0] ?? null,
      evidence: store.listClaimEvidence(project.id),
    };
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/api/v1/admin/narrative/research/projects/:id', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const current = store.getProject(request.params.id);
    if (!current) return reply.code(404).send({ error: 'not_found' });
    const status = body.status === undefined ? undefined : String(body.status);
    if (status && !PROJECT_STATUSES.includes(status as ResearchProjectStatus)) return reply.code(400).send({ error: 'invalid_status' });
    const result = store.updateProject(request.params.id, {
      ...(body.title === undefined ? {} : { title: String(body.title) }),
      ...(body.question === undefined ? {} : { question: String(body.question) }),
      ...(body.scope === undefined ? {} : { scope: normalizeScope(body.scope, current.workId) }),
      ...(status ? { status: status as ResearchProjectStatus } : {}),
      expectedRevision: expectedRevision(request as never),
    });
    if (!result.ok) return reply.code(result.reason === 'not_found' ? 404 : 409).send({ error: result.reason });
    return result.project;
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/api/v1/admin/narrative/research/projects/:id/confirm', async (request, reply) => {
    const current = store.getProject(request.params.id);
    if (!current) return reply.code(404).send({ error: 'not_found' });
    const body = (request.body ?? {}) as Record<string, unknown>;
    // 确认时允许同时修改标题与范围：用户经常在确认前最后调整一次。
    const result = store.updateProject(request.params.id, {
      ...(body.title === undefined ? {} : { title: String(body.title) }),
      ...(body.question === undefined ? {} : { question: String(body.question) }),
      ...(body.scope === undefined ? {} : { scope: normalizeScope(body.scope, current.workId) }),
      status: 'confirmed', expectedRevision: expectedRevision(request as never),
    });
    if (!result.ok) return reply.code(result.reason === 'not_found' ? 404 : 409).send({ error: result.reason });
    return result.project;
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/narrative/research/projects/:id/archive', async (request, reply) => {
    const result = store.updateProject(request.params.id, { status: 'archived' });
    if (!result.ok) return reply.code(404).send({ error: result.reason });
    return result.project;
  });

  // ---------- 选题 ----------

  app.post<{ Body: unknown }>('/api/v1/admin/narrative/research/topic-suggestions', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const workId = String(body.workId ?? '').trim();
    if (!workId) return reply.code(400).send({ error: 'invalid_work', message: 'workId 必填。' });
    if (!narrativeDatabase.connection.prepare('SELECT id FROM narrative_works WHERE id=?').get(workId)) return reply.code(404).send({ error: 'work_not_found' });
    const existingTitles = store.listProjects({ workId }).map((project) => project.title);
    const result = await suggestResearchTopics(
      { database: options.database, narrativeDatabase, secrets, provider, store, fetcher },
      { workId, scope: normalizeScope(body.scope, workId), existingTitles },
    );
    return reply.code(result.items.length ? 201 : 200).send(result);
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/narrative/research/topic-suggestion-batches/:id', async (request) => ({
    batchId: request.params.id, items: store.listSuggestionsByBatch(request.params.id),
  }));

  app.post<{ Params: { id: string }; Body: unknown }>('/api/v1/admin/narrative/research/topic-suggestions/:id/select', async (request, reply) => {
    const suggestion = store.getSuggestion(request.params.id);
    if (!suggestion) return reply.code(404).send({ error: 'not_found' });
    const body = (request.body ?? {}) as Record<string, unknown>;
    // 选中即建专题：候选本身不承载研究状态，避免两套主题结构并存。
    const project = store.createProject({
      workId: suggestion.workId,
      title: String(body.title ?? suggestion.title).trim() || suggestion.title,
      question: String(body.question ?? suggestion.question).trim(),
      scope: normalizeScope(body.scope ?? suggestion.scope, suggestion.workId),
      origin: 'ai-suggested', selectedTopicId: suggestion.id,
    });
    store.setSuggestionStatus(suggestion.id, 'selected');
    return reply.code(201).send(project);
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/narrative/research/topic-suggestions/:id/dismiss', async (request, reply) => {
    return store.setSuggestionStatus(request.params.id, 'dismissed') ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  // ---------- 研究运行 ----------

  app.post<{ Params: { id: string }; Body: unknown }>('/api/v1/admin/narrative/research/projects/:id/runs', async (request, reply) => {
    const project = store.getProject(request.params.id);
    if (!project) return reply.code(404).send({ error: 'not_found' });
    if (project.status === 'draft') return reply.code(409).send({ error: 'project_not_confirmed', message: '请先确认研究主题。' });
    const status = await provider.status();
    if (status.status === 'empty') return reply.code(409).send({ error: 'corpus_empty', message: status.message });
    const version = await provider.version({ ...project.scope, workId: project.workId });
    const run = store.createRun({
      projectId: project.id,
      inputSnapshot: { title: project.title, question: project.question, scope: project.scope, projectRevision: project.revision },
      corpusVersion: version as unknown as Record<string, unknown>,
    });
    store.setProjectRun(project.id, run.id, 'researching');
    /*
     * 运行在后台推进：接口立刻返回 runId，前端轮询运行详情。
     * 这样长时间的研究不会占住一个 HTTP 连接。
     */
    void executeResearchRun({ database: options.database, narrativeDatabase, secrets, provider, store, fetcher }, run.id).catch(() => undefined);
    return reply.code(202).send(store.getRun(run.id));
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/narrative/research/runs/:id', async (request, reply) => {
    const run = store.getRun(request.params.id);
    if (!run) return reply.code(404).send({ error: 'not_found' });
    return {
      run,
      // 结论必须带上各自证据，审核页要能直接展开原文。
      claims: store.listClaims({ runId: run.id }).map((claim) => ({ ...claim, evidence: store.listEvidenceForClaim(claim.id) })),
      evidence: store.listEvidence({ runId: run.id }),
    };
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/narrative/research/runs/:id/cancel', async (request, reply) => {
    const run = store.getRun(request.params.id);
    if (!run) return reply.code(404).send({ error: 'not_found' });
    if (!['queued', 'running'].includes(run.status)) return reply.code(409).send({ error: 'run_not_active', status: run.status });
    store.updateRun(run.id, { status: 'cancelled', progressLabel: '运行已取消', finishedAt: new Date().toISOString() });
    return store.getRun(run.id);
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/narrative/research/runs/:id/retry', async (request, reply) => {
    const run = store.getRun(request.params.id);
    if (!run) return reply.code(404).send({ error: 'not_found' });
    if (['queued', 'running'].includes(run.status)) return reply.code(409).send({ error: 'run_active' });
    /*
     * 重试沿用同一条运行记录：已保存的检索与证据继续可用，
     * 只把状态复位并重新走后续阶段。
     */
    store.updateRun(run.id, { status: 'queued', errorMessage: null, incompleteReason: null, finishedAt: null, progressLabel: '重新运行' });
    store.setProjectRun(run.projectId, run.id, 'researching');
    void executeResearchRun({ database: options.database, narrativeDatabase, secrets, provider, store, fetcher }, run.id).catch(() => undefined);
    return reply.code(202).send(store.getRun(run.id));
  });

  // ---------- 结论与证据 ----------

  app.patch<{ Params: { id: string }; Body: unknown }>('/api/v1/admin/narrative/research/claims/:id', async (request, reply) => {
    const claim = store.getClaim(request.params.id);
    if (!claim) return reply.code(404).send({ error: 'not_found' });
    const body = (request.body ?? {}) as Record<string, unknown>;
    const status = body.status === undefined ? undefined : String(body.status);
    if (status && !['pending', 'accepted', 'rejected'].includes(status)) return reply.code(400).send({ error: 'invalid_status' });
    const claimType = body.claimType === undefined ? undefined : String(body.claimType);
    if (claimType && !CLAIM_TYPES.includes(claimType as ClaimType)) return reply.code(400).send({ error: 'invalid_claim_type' });
    const result = store.updateClaim(claim.id, {
      ...(status ? { status: status as 'pending' | 'accepted' | 'rejected' } : {}),
      ...(body.title === undefined ? {} : { title: String(body.title) }),
      ...(body.body === undefined ? {} : { body: String(body.body) }),
      ...(body.explanation === undefined ? {} : { explanation: String(body.explanation) }),
      ...(body.uncertainty === undefined ? {} : { uncertainty: String(body.uncertainty) }),
      expectedRevision: expectedRevision(request as never),
    });
    if (!result.ok) return reply.code(result.reason === 'not_found' ? 404 : 409).send({ error: result.reason });
    if (claimType) store.setClaimVerification(claim.id, { claimType: claimType as ClaimType, uncertainty: result.claim.uncertainty });
    return store.getClaim(claim.id);
  });

  /** 重新校验：原文可能已经更新，用户需要看到哪条证据已失效。 */
  app.post<{ Params: { id: string } }>('/api/v1/admin/narrative/research/claims/:id/revalidate', async (request, reply) => {
    const claim = store.getClaim(request.params.id);
    if (!claim) return reply.code(404).send({ error: 'not_found' });
    const evidence = store.listEvidenceForClaim(claim.id);
    const results: Array<{ id: string; valid: boolean; message: string | null }> = [];
    for (const item of evidence) {
      const document = await provider.read({ targetType: item.targetType, targetId: item.targetId, contextSize: 1 });
      if (!document) {
        store.markEvidenceInvalid(item.id, '源资料已不可用，保留冻结快照。');
        results.push({ id: item.id, valid: false, message: '源资料已不可用' }); continue;
      }
      // 内容 hash 变化说明原文被改过，快照仍可读但要标记出来。
      if (document.contentHash !== item.contentHash) {
        store.markEvidenceInvalid(item.id, '原文已更新，当前显示的是研究当时的冻结快照。');
        results.push({ id: item.id, valid: false, message: '原文已更新' }); continue;
      }
      results.push({ id: item.id, valid: true, message: null });
    }
    return { claimId: claim.id, evidence: results };
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/narrative/research/evidence/:id', async (request, reply) => {
    const evidence = store.getEvidence(request.params.id);
    if (!evidence) return reply.code(404).send({ error: 'not_found' });
    // 跳回叙事档案：本地证据必须能定位到原文节点。
    return { ...evidence, archiveHref: evidence.nodeId ? `/apps/narrative?node=${evidence.nodeId}` : null };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/admin/narrative/research/evidence/:id', async (request, reply) => {
    return store.deleteEvidence(request.params.id) ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  /** 用户从本地原文补一条证据：AI 之外的人工校正入口。 */
  app.post<{ Params: { id: string }; Body: unknown }>('/api/v1/admin/narrative/research/claims/:id/evidence', async (request, reply) => {
    const claim = store.getClaim(request.params.id);
    if (!claim) return reply.code(404).send({ error: 'not_found' });
    const body = (request.body ?? {}) as Record<string, unknown>;
    const targetType = String(body.targetType ?? 'utterance');
    const targetId = String(body.targetId ?? '').trim();
    if (!['utterance', 'node', 'document'].includes(targetType) || !targetId) return reply.code(400).send({ error: 'invalid_target' });
    const document = await provider.read({ targetType: targetType as 'utterance' | 'node' | 'document', targetId, contextSize: 3 });
    if (!document) return reply.code(404).send({ error: 'source_not_found' });
    const evidenceId = store.upsertEvidence({
      projectId: claim.projectId ?? '', runId: claim.runId, providerId: provider.id, workId: document.workId,
      targetType: document.targetType, targetId: document.targetId, nodeId: document.nodeId, sceneId: document.sceneId,
      locator: document.locator, quoteSnapshot: document.text, contextBefore: document.contextBefore,
      contextAfter: document.contextAfter, contentHash: document.contentHash, sourceVersion: document.sourceVersion as unknown as Record<string, unknown>,
    });
    // 人工补的证据默认作为支持证据挂到该结论上。
    store.linkEvidenceToClaim(evidenceId, claim.id, 'support');
    return reply.code(201).send(store.getEvidence(evidenceId));
  });

  // ---------- 总稿与发布 ----------

  app.patch<{ Params: { id: string }; Body: unknown }>('/api/v1/admin/narrative/research/drafts/:id', async (request, reply) => {
    const draft = store.getDraft(request.params.id);
    if (!draft) return reply.code(404).send({ error: 'not_found' });
    const body = (request.body ?? {}) as Record<string, unknown>;
    const updated = store.updateDraft(draft.id, {
      ...(body.title === undefined ? {} : { title: String(body.title) }),
      ...(body.summary === undefined ? {} : { summary: String(body.summary) }),
      ...(body.content === undefined ? {} : { content: body.content as Record<string, unknown> }),
      ...(body.status === undefined ? {} : { status: String(body.status) as 'draft' | 'approved' | 'published' }),
    });
    return updated;
  });

  /** 发布预览：先把条件检查结果给用户，避免点了发布才发现不满足。 */
  app.post<{ Params: { id: string } }>('/api/v1/admin/narrative/research/projects/:id/regenerate-draft', async (request, reply) => {
    const project = store.getProject(request.params.id);
    if (!project) return reply.code(404).send({ error: 'not_found' });
    const result = await regenerateSynthesis({ database: options.database, narrativeDatabase, secrets, provider, store, fetcher }, project.id);
    return result.ok ? reply.code(201).send(result) : reply.code(409).send({ error: 'regenerate_failed', message: result.reason });
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/narrative/research/projects/:id/publish-preview', async (request, reply) => {
    const project = store.getProject(request.params.id);
    if (!project) return reply.code(404).send({ error: 'not_found' });
    return buildPublishPreview(store, project.id, project.revision);
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/api/v1/admin/narrative/research/projects/:id/publish', async (request, reply) => {
    const project = store.getProject(request.params.id);
    if (!project) return reply.code(404).send({ error: 'not_found' });
    const body = (request.body ?? {}) as Record<string, unknown>;
    const revision = expectedRevision(request as never);
    if (revision !== undefined && revision !== project.revision) return reply.code(409).send({ error: 'revision_conflict' });
    const preview = buildPublishPreview(store, project.id, project.revision);
    if (!preview.ready) return reply.code(409).send({ error: 'publish_blocked', ...preview });
    try {
      const result = await publishResearchDraft({ database: options.database, narrativeDatabase, provider, store, fetcher }, {
        projectId: project.id, draftId: preview.draftId!, noteId: body.noteId ? String(body.noteId) : null,
      });
      return reply.code(result.created ? 201 : 200).send(result);
    } catch (error) {
      return reply.code(409).send({ error: 'publish_failed', message: error instanceof Error ? error.message : String(error) });
    }
  });
}

/** 发布条件（计划 3.7）：至少一条已接受结论、证据有效、无悬空引用。 */
function buildPublishPreview(store: ResearchStore, projectId: string, revision: number) {
  const draft = store.latestDraft(projectId);
  const claims = store.listClaims({ projectId });
  const accepted = claims.filter((claim) => claim.status === 'accepted');
  // 只有挂在结论上的证据才参与发布判断；候选行是检索过程产物。
  const evidence = store.listClaimEvidence(projectId);
  const invalid = evidence.filter((item) => !item.valid);
  const blocked: string[] = [];
  if (!accepted.length) blocked.push('至少需要一条已接受的结论。');
  if (!draft) blocked.push('还没有研究总稿。');
  if (invalid.length) blocked.push(`有 ${invalid.length} 条证据已失效，请重新校验或移除。`);
  let unresolved = { evidence: [] as string[], claims: [] as string[] };
  if (draft) {
    const content = draft.content as unknown as { sections?: Array<{ evidenceIds?: string[]; claimIds?: string[] }>; evidenceIndex?: Array<{ evidenceId?: string }> };
    unresolved = unresolvedSynthesisIds({
      sections: (content.sections ?? []).map((section) => ({ evidenceIds: section.evidenceIds ?? [], claimIds: section.claimIds ?? [] })),
      evidenceIndex: (content.evidenceIndex ?? []).map((entry) => ({ evidenceId: entry.evidenceId ?? '' })),
    }, {
      evidenceIds: new Set(evidence.filter((item) => item.valid).map((item) => item.id)),
      claimIds: new Set(accepted.map((claim) => claim.id)),
    });
    if (unresolved.evidence.length) blocked.push(`总稿引用了 ${unresolved.evidence.length} 条不存在的证据。`);
  }
  return {
    ready: blocked.length === 0, blocked, revision,
    draftId: draft?.id ?? null, draftTitle: draft?.title ?? null,
    acceptedClaims: accepted.length, totalClaims: claims.length, evidenceCount: evidence.length,
    nature: natureForClaims(accepted.map((claim) => claim.claimType ?? 'open-question')),
    unresolved,
  };
}

export function newResearchId(): string { return randomUUID(); }
