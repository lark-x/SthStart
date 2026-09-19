import { createHash, randomUUID } from 'node:crypto';
import type { NarrativeDatabase } from '../narrative-database.js';
import type { ResearchScope } from './corpus.js';

export const nowIso = () => new Date().toISOString();

export function stableHash(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

export type ResearchProjectStatus = 'draft' | 'confirmed' | 'researching' | 'review' | 'published' | 'archived';
export type ResearchRunStatus = 'queued' | 'running' | 'needs-review' | 'succeeded' | 'incomplete' | 'failed' | 'cancelled' | 'interrupted';
export type ResearchRunStage = 'inventory' | 'query-planning' | 'retrieval' | 'evidence-expansion' | 'claim-extraction' | 'verification' | 'synthesis' | 'complete';
export type ClaimType = 'fact' | 'inference' | 'speculation' | 'contradiction' | 'open-question';

export interface ResearchProjectRow {
  id: string; workId: string; title: string; question: string;
  scope: ResearchScope; origin: 'ai-suggested' | 'user-defined'; status: ResearchProjectStatus;
  selectedTopicId: string | null; latestRunId: string | null; publishedNoteId: string | null;
  revision: number; createdAt: string; updatedAt: string;
}

export interface TopicSuggestionRow {
  id: string; workId: string; batchId: string; title: string; question: string; reason: string;
  scope: ResearchScope; seedEvidence: Array<{ targetType: string; targetId: string; locator: string; quote: string }>;
  status: 'candidate' | 'selected' | 'dismissed'; createdAt: string;
}

export interface ResearchRunRow {
  id: string; projectId: string; status: ResearchRunStatus; stage: ResearchRunStage;
  inputSnapshot: Record<string, unknown>; corpusVersion: Record<string, unknown>;
  queryPlan: Array<Record<string, unknown>>; candidateEvidence: Array<Record<string, unknown>>;
  verifiedEvidence: Array<Record<string, unknown>>; synthesis: Record<string, unknown>;
  progressLabel: string | null; modelProfileId: string | null; usedModelCalls: number;
  errorMessage: string | null; incompleteReason: string | null;
  startedAt: string | null; finishedAt: string | null; createdAt: string; updatedAt: string;
}

export interface ResearchEvidenceRow {
  id: string; projectId: string; runId: string | null;
  /** 关联到结论后的角色；候选证据没有关联时为 null。 */
  claimRole: 'support' | 'counter' | null;
  providerId: string; workId: string; targetType: 'utterance' | 'node' | 'document';
  targetId: string; nodeId: string | null; sceneId: string | null; locator: string;
  quoteSnapshot: string; contextBefore: string; contextAfter: string;
  contentHash: string; sourceVersion: Record<string, unknown>;
  valid: boolean; validationMessage: string | null; createdAt: string;
}

export interface ResearchClaimRow {
  id: string; workId: string; projectId: string | null; runId: string | null;
  title: string; claimType: ClaimType | null; body: string; explanation: string;
  uncertainty: string; status: 'pending' | 'accepted' | 'rejected'; origin: 'human' | 'ai';
  subjectEntityId: string | null; objectEntityId: string | null;
  revision: number; createdAt: string; updatedAt: string;
  /** 运行期附带的证据引用，仅用于发布渲染，不落库。 */
  evidenceRefs?: string[];
}

export interface ResearchDraftRow {
  id: string; projectId: string; runId: string | null; title: string; summary: string;
  content: Record<string, unknown>; status: 'draft' | 'approved' | 'published';
  contentHash: string; revision: number; createdAt: string; updatedAt: string;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** 研究持久化：所有写操作走这里，路由层不直接拼 SQL。 */
export class ResearchStore {
  constructor(private readonly database: NarrativeDatabase) {}

  private get db() { return this.database.connection; }

  // ---------- 研究专题 ----------

  createProject(input: {
    workId: string; title: string; question: string; scope: ResearchScope;
    origin: 'ai-suggested' | 'user-defined'; selectedTopicId?: string | null;
  }): ResearchProjectRow {
    const id = randomUUID(); const now = nowIso();
    this.db.prepare(`INSERT INTO narrative_research_projects
      (id,work_id,title,question,scope_json,origin,status,selected_topic_id,latest_run_id,published_note_id,revision,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'draft',?,NULL,NULL,1,?,?)`)
      .run(id, input.workId, input.title.trim(), input.question.trim(), JSON.stringify(input.scope), input.origin, input.selectedTopicId ?? null, now, now);
    return this.getProject(id)!;
  }

  getProject(id: string): ResearchProjectRow | null {
    const row = this.db.prepare('SELECT * FROM narrative_research_projects WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id), workId: String(row.work_id), title: String(row.title), question: String(row.question),
      scope: parseJson<ResearchScope>(row.scope_json, { workId: String(row.work_id) }),
      origin: String(row.origin) as ResearchProjectRow['origin'],
      status: String(row.status) as ResearchProjectStatus,
      selectedTopicId: row.selected_topic_id ? String(row.selected_topic_id) : null,
      latestRunId: row.latest_run_id ? String(row.latest_run_id) : null,
      publishedNoteId: row.published_note_id ? String(row.published_note_id) : null,
      revision: Number(row.revision ?? 1), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  listProjects(filter: { workId?: string; status?: string; limit?: number } = {}): ResearchProjectRow[] {
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 300);
    const rows = this.db.prepare(`SELECT id FROM narrative_research_projects
      WHERE (? IS NULL OR work_id=?) AND (? IS NULL OR status=?)
      ORDER BY updated_at DESC LIMIT ?`).all(filter.workId ?? null, filter.workId ?? null, filter.status ?? null, filter.status ?? null, limit) as Array<{ id: string }>;
    return rows.map((row) => this.getProject(row.id)!).filter(Boolean);
  }

  /** 乐观并发：revision 不匹配时拒绝，避免运行期间用户改主题后被旧结果覆盖。 */
  updateProject(id: string, patch: { title?: string; question?: string; scope?: ResearchScope; status?: ResearchProjectStatus; expectedRevision?: number }): { ok: true; project: ResearchProjectRow } | { ok: false; reason: 'not_found' | 'revision_conflict' } {
    const current = this.getProject(id);
    if (!current) return { ok: false, reason: 'not_found' };
    if (patch.expectedRevision !== undefined && patch.expectedRevision !== current.revision) return { ok: false, reason: 'revision_conflict' };
    this.db.prepare(`UPDATE narrative_research_projects SET title=?,question=?,scope_json=?,status=?,revision=revision+1,updated_at=? WHERE id=?`)
      .run(patch.title?.trim() ?? current.title, patch.question?.trim() ?? current.question,
        JSON.stringify(patch.scope ?? current.scope), patch.status ?? current.status, nowIso(), id);
    return { ok: true, project: this.getProject(id)! };
  }

  setProjectRun(id: string, runId: string, status: ResearchProjectStatus): void {
    this.db.prepare('UPDATE narrative_research_projects SET latest_run_id=?,status=?,updated_at=? WHERE id=?').run(runId, status, nowIso(), id);
  }

  setProjectPublishedNote(id: string, noteId: string): void {
    this.db.prepare("UPDATE narrative_research_projects SET published_note_id=?,status='published',updated_at=? WHERE id=?").run(noteId, nowIso(), id);
  }

  // ---------- 选题候选 ----------

  createSuggestionBatch(input: {
    workId: string; batchId: string;
    items: Array<{ title: string; question: string; reason: string; scope: ResearchScope; seedEvidence: TopicSuggestionRow['seedEvidence'] }>;
  }): TopicSuggestionRow[] {
    const now = nowIso();
    const ids: string[] = [];
    this.database.transaction(() => {
      for (const item of input.items) {
        const id = randomUUID(); ids.push(id);
        this.db.prepare(`INSERT INTO narrative_research_topic_suggestions
          (id,work_id,batch_id,title,question,reason,scope_json,seed_evidence_json,status,created_at)
          VALUES (?,?,?,?,?,?,?,?,'candidate',?)`)
          .run(id, input.workId, input.batchId, item.title, item.question, item.reason, JSON.stringify(item.scope), JSON.stringify(item.seedEvidence), now);
      }
    });
    return ids.map((id) => this.getSuggestion(id)!).filter(Boolean);
  }

  getSuggestion(id: string): TopicSuggestionRow | null {
    const row = this.db.prepare('SELECT * FROM narrative_research_topic_suggestions WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id), workId: String(row.work_id), batchId: String(row.batch_id),
      title: String(row.title), question: String(row.question), reason: String(row.reason),
      scope: parseJson<ResearchScope>(row.scope_json, { workId: String(row.work_id) }),
      seedEvidence: parseJson<TopicSuggestionRow['seedEvidence']>(row.seed_evidence_json, []),
      status: String(row.status) as TopicSuggestionRow['status'], createdAt: String(row.created_at),
    };
  }

  listSuggestionsByBatch(batchId: string): TopicSuggestionRow[] {
    const rows = this.db.prepare('SELECT id FROM narrative_research_topic_suggestions WHERE batch_id=? ORDER BY created_at,title').all(batchId) as Array<{ id: string }>;
    return rows.map((row) => this.getSuggestion(row.id)!).filter(Boolean);
  }

  setSuggestionStatus(id: string, status: TopicSuggestionRow['status']): boolean {
    return this.db.prepare('UPDATE narrative_research_topic_suggestions SET status=? WHERE id=?').run(status, id).changes > 0;
  }

  // ---------- 研究运行 ----------

  createRun(input: { projectId: string; inputSnapshot: Record<string, unknown>; corpusVersion: Record<string, unknown> }): ResearchRunRow {
    const id = randomUUID(); const now = nowIso();
    this.db.prepare(`INSERT INTO narrative_research_runs
      (id,project_id,status,stage,input_snapshot_json,corpus_version_json,created_at,updated_at)
      VALUES (?,?,'queued','inventory',?,?,?,?)`)
      .run(id, input.projectId, JSON.stringify(input.inputSnapshot), JSON.stringify(input.corpusVersion), now, now);
    return this.getRun(id)!;
  }

  getRun(id: string): ResearchRunRow | null {
    const row = this.db.prepare('SELECT * FROM narrative_research_runs WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id), projectId: String(row.project_id),
      status: String(row.status) as ResearchRunStatus, stage: String(row.stage) as ResearchRunStage,
      inputSnapshot: parseJson(row.input_snapshot_json, {}), corpusVersion: parseJson(row.corpus_version_json, {}),
      queryPlan: parseJson(row.query_plan_json, []), candidateEvidence: parseJson(row.candidate_evidence_json, []),
      verifiedEvidence: parseJson(row.verified_evidence_json, []), synthesis: parseJson(row.synthesis_json, {}),
      progressLabel: row.progress_label ? String(row.progress_label) : null,
      modelProfileId: row.model_profile_id ? String(row.model_profile_id) : null,
      usedModelCalls: Number(row.used_model_calls ?? 0),
      errorMessage: row.error_message ? String(row.error_message) : null,
      incompleteReason: row.incomplete_reason ? String(row.incomplete_reason) : null,
      startedAt: row.started_at ? String(row.started_at) : null,
      finishedAt: row.finished_at ? String(row.finished_at) : null,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  listRuns(projectId: string): ResearchRunRow[] {
    const rows = this.db.prepare('SELECT id FROM narrative_research_runs WHERE project_id=? ORDER BY created_at DESC').all(projectId) as Array<{ id: string }>;
    return rows.map((row) => this.getRun(row.id)!).filter(Boolean);
  }

  updateRun(id: string, patch: Partial<{
    status: ResearchRunStatus; stage: ResearchRunStage; corpusVersion: Record<string, unknown>; queryPlan: unknown[];
    candidateEvidence: unknown[]; verifiedEvidence: unknown[]; synthesis: Record<string, unknown>;
    progressLabel: string | null; modelProfileId: string | null; usedModelCalls: number;
    errorMessage: string | null; incompleteReason: string | null; startedAt: string | null; finishedAt: string | null;
  }>): void {
    const current = this.getRun(id);
    if (!current) return;
    this.db.prepare(`UPDATE narrative_research_runs SET
      status=?,stage=?,corpus_version_json=?,query_plan_json=?,candidate_evidence_json=?,verified_evidence_json=?,synthesis_json=?,
      progress_label=?,model_profile_id=?,used_model_calls=?,error_message=?,incomplete_reason=?,started_at=?,finished_at=?,updated_at=?
      WHERE id=?`).run(
      patch.status ?? current.status, patch.stage ?? current.stage,
      JSON.stringify(patch.corpusVersion ?? current.corpusVersion),
      JSON.stringify(patch.queryPlan ?? current.queryPlan),
      JSON.stringify(patch.candidateEvidence ?? current.candidateEvidence),
      JSON.stringify(patch.verifiedEvidence ?? current.verifiedEvidence),
      JSON.stringify(patch.synthesis ?? current.synthesis),
      patch.progressLabel === undefined ? current.progressLabel : patch.progressLabel,
      patch.modelProfileId === undefined ? current.modelProfileId : patch.modelProfileId,
      patch.usedModelCalls ?? current.usedModelCalls,
      patch.errorMessage === undefined ? current.errorMessage : patch.errorMessage,
      patch.incompleteReason === undefined ? current.incompleteReason : patch.incompleteReason,
      patch.startedAt === undefined ? current.startedAt : patch.startedAt,
      patch.finishedAt === undefined ? current.finishedAt : patch.finishedAt,
      nowIso(), id,
    );
  }

  /** 服务重启时 running 的运行标记为 interrupted，已保存的阶段结果保留。 */
  markInterruptedRuns(): number {
    return Number(this.db.prepare("UPDATE narrative_research_runs SET status='interrupted',progress_label='服务重启，运行已中断',updated_at=? WHERE status IN ('queued','running')").run(nowIso()).changes);
  }

  // ---------- 证据 ----------

  upsertEvidence(input: {
    projectId: string; runId: string | null; providerId: string; workId: string;
    targetType: 'utterance' | 'node' | 'document'; targetId: string; nodeId: string | null; sceneId: string | null;
    locator: string; quoteSnapshot: string; contextBefore: string; contextAfter: string;
    contentHash: string; sourceVersion: Record<string, unknown>; valid?: boolean; validationMessage?: string | null;
  }): string {
    const existing = this.db.prepare(`SELECT id FROM narrative_research_evidence
      WHERE ifnull(run_id,'')=? AND target_type=? AND target_id=?`)
      .get(input.runId ?? '', input.targetType, input.targetId) as { id: string } | undefined;
    if (existing) {
      this.db.prepare(`UPDATE narrative_research_evidence SET quote_snapshot=?,context_before=?,context_after=?,
        content_hash=?,source_version_json=?,valid=?,validation_message=? WHERE id=?`)
        .run(input.quoteSnapshot, input.contextBefore, input.contextAfter, input.contentHash,
          JSON.stringify(input.sourceVersion), input.valid === false ? 0 : 1, input.validationMessage ?? null, existing.id);
      return existing.id;
    }
    const id = randomUUID();
    this.db.prepare(`INSERT INTO narrative_research_evidence
      (id,project_id,run_id,provider_id,work_id,target_type,target_id,node_id,scene_id,locator,quote_snapshot,
       context_before,context_after,content_hash,source_version_json,valid,validation_message,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, input.projectId, input.runId, input.providerId, input.workId, input.targetType, input.targetId,
        input.nodeId, input.sceneId, input.locator, input.quoteSnapshot, input.contextBefore, input.contextAfter,
        input.contentHash, JSON.stringify(input.sourceVersion), input.valid === false ? 0 : 1, input.validationMessage ?? null, nowIso());
    return id;
  }

  getEvidence(id: string): ResearchEvidenceRow | null {
    const row = this.db.prepare('SELECT * FROM narrative_research_evidence WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id), projectId: String(row.project_id),
      runId: row.run_id ? String(row.run_id) : null,
      claimRole: row.claim_role ? String(row.claim_role) as 'support' | 'counter' : null,
      providerId: String(row.provider_id), workId: String(row.work_id),
      targetType: String(row.target_type) as ResearchEvidenceRow['targetType'], targetId: String(row.target_id),
      nodeId: row.node_id ? String(row.node_id) : null, sceneId: row.scene_id ? String(row.scene_id) : null,
      locator: String(row.locator), quoteSnapshot: String(row.quote_snapshot),
      contextBefore: String(row.context_before), contextAfter: String(row.context_after),
      contentHash: String(row.content_hash), sourceVersion: parseJson(row.source_version_json, {}),
      valid: Number(row.valid ?? 1) === 1, validationMessage: row.validation_message ? String(row.validation_message) : null,
      createdAt: String(row.created_at),
    };
  }

  listEvidence(filter: { projectId?: string; runId?: string }): ResearchEvidenceRow[] {
    const rows = this.db.prepare(`SELECT id FROM narrative_research_evidence
      WHERE (? IS NULL OR project_id=?) AND (? IS NULL OR run_id=?)
      ORDER BY created_at`).all(filter.projectId ?? null, filter.projectId ?? null, filter.runId ?? null, filter.runId ?? null) as Array<{ id: string }>;
    return rows.map((row) => this.getEvidence(row.id)!).filter(Boolean);
  }

  deleteEvidence(id: string): boolean {
    return this.db.prepare('DELETE FROM narrative_research_evidence WHERE id=?').run(id).changes > 0;
  }

  /** 把证据关联到结论。同一处原文可以同时支撑多条结论，所以关系单独存。 */
  linkEvidenceToClaim(evidenceId: string, claimId: string, role: 'support' | 'counter' = 'support'): void {
    this.db.prepare(`INSERT INTO narrative_research_claim_evidence(claim_id,evidence_id,role,created_at)
      VALUES (?,?,?,?) ON CONFLICT(claim_id,evidence_id) DO UPDATE SET role=excluded.role`)
      .run(claimId, evidenceId, role, nowIso());
  }

  /** 某条结论关联的证据，带角色。 */
  listEvidenceForClaim(claimId: string): ResearchEvidenceRow[] {
    const rows = this.db.prepare('SELECT evidence_id,role FROM narrative_research_claim_evidence WHERE claim_id=? ORDER BY created_at')
      .all(claimId) as Array<{ evidence_id: string; role: string }>;
    const items: ResearchEvidenceRow[] = [];
    for (const row of rows) {
      const evidence = this.getEvidence(row.evidence_id);
      if (evidence) items.push({ ...evidence, claimRole: row.role as 'support' | 'counter' });
    }
    return items;
  }

  /** 某条证据被哪些结论引用。 */
  listClaimsForEvidence(evidenceId: string): string[] {
    return (this.db.prepare('SELECT claim_id FROM narrative_research_claim_evidence WHERE evidence_id=?').all(evidenceId) as Array<{ claim_id: string }>)
      .map((row) => row.claim_id);
  }

  /** 只有被结论引用的证据才参与发布；候选行是检索过程产物。 */
  listClaimEvidence(projectId: string): ResearchEvidenceRow[] {
    const rows = this.db.prepare(`SELECT DISTINCT e.id FROM narrative_research_evidence e
      JOIN narrative_research_claim_evidence l ON l.evidence_id=e.id
      WHERE e.project_id=? ORDER BY e.created_at`).all(projectId) as Array<{ id: string }>;
    return rows.map((row) => this.getEvidence(row.id)!).filter(Boolean);
  }

  /**
   * 重跑时清掉本轮证据。证据行是按「结论 + 原文目标」存的，
   * 因为同一条原文可以同时支撑两条不同结论（例如一处原文既支持事实、又参与矛盾对照）。
   */
  clearRunEvidence(runId: string): void {
    this.db.prepare('DELETE FROM narrative_research_evidence WHERE run_id=?').run(runId);
  }

  // ---------- 结论卡 ----------

  createClaim(input: {
    workId: string; projectId: string; runId: string | null; title: string; claimType: ClaimType;
    body: string; explanation: string; uncertainty: string; origin: 'human' | 'ai';
    subjectEntityId?: string | null; objectEntityId?: string | null;
  }): ResearchClaimRow {
    const id = randomUUID(); const now = nowIso();
    this.db.prepare(`INSERT INTO narrative_claims
      (id,work_id,type,subject_entity_id,object_entity_id,body,status,origin,generator_json,created_at,updated_at,
       project_id,run_id,title,claim_type,explanation,uncertainty,revision)
      VALUES (?,?,?,?,?,?,'pending',?,NULL,?,?,?,?,?,?,?,?,1)`)
      .run(id, input.workId, input.claimType, input.subjectEntityId ?? null, input.objectEntityId ?? null,
        input.body, input.origin, now, now, input.projectId, input.runId, input.title, input.claimType, input.explanation, input.uncertainty);
    return this.getClaim(id)!;
  }

  getClaim(id: string): ResearchClaimRow | null {
    const row = this.db.prepare('SELECT * FROM narrative_claims WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id), workId: String(row.work_id),
      projectId: row.project_id ? String(row.project_id) : null, runId: row.run_id ? String(row.run_id) : null,
      title: String(row.title ?? ''), claimType: row.claim_type ? String(row.claim_type) as ClaimType : null,
      body: String(row.body), explanation: String(row.explanation ?? ''), uncertainty: String(row.uncertainty ?? ''),
      status: String(row.status) as ResearchClaimRow['status'], origin: String(row.origin) as ResearchClaimRow['origin'],
      subjectEntityId: row.subject_entity_id ? String(row.subject_entity_id) : null,
      objectEntityId: row.object_entity_id ? String(row.object_entity_id) : null,
      revision: Number(row.revision ?? 1), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  listClaims(filter: { projectId?: string; runId?: string; status?: string }): ResearchClaimRow[] {
    const rows = this.db.prepare(`SELECT id FROM narrative_claims
      WHERE (? IS NULL OR project_id=?) AND (? IS NULL OR run_id=?) AND (? IS NULL OR status=?)
      ORDER BY created_at`).all(filter.projectId ?? null, filter.projectId ?? null, filter.runId ?? null, filter.runId ?? null, filter.status ?? null, filter.status ?? null) as Array<{ id: string }>;
    return rows.map((row) => this.getClaim(row.id)!).filter(Boolean);
  }

  updateClaim(id: string, patch: { status?: ResearchClaimRow['status']; title?: string; body?: string; explanation?: string; uncertainty?: string; expectedRevision?: number }): { ok: true; claim: ResearchClaimRow } | { ok: false; reason: 'not_found' | 'revision_conflict' } {
    const current = this.getClaim(id);
    if (!current) return { ok: false, reason: 'not_found' };
    if (patch.expectedRevision !== undefined && patch.expectedRevision !== current.revision) return { ok: false, reason: 'revision_conflict' };
    this.db.prepare(`UPDATE narrative_claims SET status=?,title=?,body=?,explanation=?,uncertainty=?,revision=revision+1,updated_at=? WHERE id=?`)
      .run(patch.status ?? current.status, patch.title ?? current.title, patch.body ?? current.body,
        patch.explanation ?? current.explanation, patch.uncertainty ?? current.uncertainty, nowIso(), id);
    return { ok: true, claim: this.getClaim(id)! };
  }

  /** 重新校验证据后回写结论的有效性，用户能在审核页看到哪条证据已失效。 */
  markEvidenceInvalid(id: string, message: string): void {
    this.db.prepare('UPDATE narrative_research_evidence SET valid=0,validation_message=? WHERE id=?').run(message, id);
  }

  /** 二次验证的结果只调整类型与不确定说明，不重写正文，因此单独开一个方法。 */
  setClaimVerification(id: string, patch: { claimType: ClaimType; uncertainty: string }): void {
    this.db.prepare('UPDATE narrative_claims SET claim_type=?,uncertainty=?,revision=revision+1,updated_at=? WHERE id=?')
      .run(patch.claimType, patch.uncertainty, nowIso(), id);
  }

  // ---------- 研究总稿 ----------

  createDraft(input: { projectId: string; runId: string | null; title: string; summary: string; content: Record<string, unknown> }): ResearchDraftRow {
    const id = randomUUID(); const now = nowIso();
    this.db.prepare(`INSERT INTO narrative_research_drafts
      (id,project_id,run_id,title,summary,content_json,status,content_hash,revision,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'draft',?,1,?,?)`)
      .run(id, input.projectId, input.runId, input.title, input.summary, JSON.stringify(input.content), stableHash(input.content), now, now);
    return this.getDraft(id)!;
  }

  getDraft(id: string): ResearchDraftRow | null {
    const row = this.db.prepare('SELECT * FROM narrative_research_drafts WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id), projectId: String(row.project_id), runId: row.run_id ? String(row.run_id) : null,
      title: String(row.title), summary: String(row.summary), content: parseJson(row.content_json, {}),
      status: String(row.status) as ResearchDraftRow['status'], contentHash: String(row.content_hash),
      revision: Number(row.revision ?? 1), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  listDrafts(projectId: string): ResearchDraftRow[] {
    // 每次生成开一条新记录，最新的一条是当前工作版本；revision 只在发布语义里递增。
    const rows = this.db.prepare('SELECT id FROM narrative_research_drafts WHERE project_id=? ORDER BY created_at DESC').all(projectId) as Array<{ id: string }>;
    return rows.map((row) => this.getDraft(row.id)!).filter(Boolean);
  }

  latestDraft(projectId: string): ResearchDraftRow | null {
    return this.listDrafts(projectId)[0] ?? null;
  }

  updateDraft(id: string, patch: { title?: string; summary?: string; content?: Record<string, unknown>; status?: ResearchDraftRow['status'] }): ResearchDraftRow | null {
    const current = this.getDraft(id);
    if (!current) return null;
    const content = patch.content ?? current.content;
    this.db.prepare('UPDATE narrative_research_drafts SET title=?,summary=?,content_json=?,status=?,content_hash=?,updated_at=? WHERE id=?')
      .run(patch.title ?? current.title, patch.summary ?? current.summary, JSON.stringify(content),
        patch.status ?? current.status, stableHash(content), nowIso(), id);
    return this.getDraft(id);
  }

  /** 编辑总稿后重新发布时开新 revision，旧活动引用的快照不受影响。 */
  forkDraftRevision(id: string): ResearchDraftRow | null {
    const current = this.getDraft(id);
    if (!current) return null;
    const newId = randomUUID(); const now = nowIso();
    this.db.prepare(`INSERT INTO narrative_research_drafts
      (id,project_id,run_id,title,summary,content_json,status,content_hash,revision,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'draft',?,?,?,?)`)
      .run(newId, current.projectId, current.runId, current.title, current.summary, JSON.stringify(current.content),
        current.contentHash, current.revision + 1, now, now);
    return this.getDraft(newId);
  }
}
