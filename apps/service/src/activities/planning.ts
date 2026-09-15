import crypto from 'node:crypto';
import { applySavedActivityTemplate } from './presets.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  ActorPersona,
  ActorSnapshot,
  ActivityIdea,
  ActivityIdeaBatch,
  ActivityInspirationSnapshot,
  ActivityPlanningCandidate,
  ActivityPlanningCharacterRef,
  ActivityPlanningForm,
  ActivityPlanningFormExtended,
  ActivityPlanningPendingActor,
  ActivityPlanningPersonaDraft,
  ActivityPlanningActorResolveInput,
  ActivityPlanningBasis,
  PlanningSelectionState,
  PlanningCandidateSummary,
  ActivityPlanningJob,
  ActivityPlanningOutput,
  ActivityPlanningSession,
  ActivityPlanningSessionStatus,
  ActivityPlanningSessionResponse,
  ContentDocument,
  ResearchEvidenceBasis,
  ResearchTask,
} from '@sthstart/contracts';
import { normalizeRoleMappings, buildActivityDocument, isUnresolvedPlanningActor } from '@sthstart/contracts';
import { authenticateAdmin } from '../access.js';
import type { ServiceConfig } from '../config.js';
import { nowIso, type ServiceDatabase } from '../database.js';
import { toAuthorityDraft } from '../characters/draft.js';
import { upsertCharacterBirthday } from '../characters/birthday.js';
import type { CharacterDraftV2 } from '@sthstart/contracts';
import { resolveAssignedLlmProfile } from '../providers.js';
import { errorConfigurationPath, llmNotReadyError, resolveAppLlmBindingStatus } from '../llm-status.js';
import type { SecretStore } from '../security.js';
import { createActorSnapshotFromCharacter } from './characters.js';
import { buildVariantPlanningPrompt, parseAiJsonOutput } from './prompts.js';
import { callLlm } from './text-jobs.js';
import type { ActivityStore } from './store.js';
import { normalizeScheduledDate } from './schedule.js';
import { ResearchStore } from '../mcp/research-store.js';
import { TopicStore } from '../topics/store.js';
import { IdeaStore } from '../topics/ideas.js';

function hash(value: unknown) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function conflict(code: string, message: string) {
  const error = new Error(message);
  (error as unknown as { statusCode: number; code: string }).statusCode = 409;
  (error as unknown as { code: string }).code = code;
  return error;
}

function badRequest(code: string, message: string) {
  const error = new Error(message);
  (error as unknown as { statusCode: number; code: string }).statusCode = 400;
  (error as unknown as { code: string }).code = code;
  return error;
}

function normalizeForm(value: unknown): ActivityPlanningFormExtended {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const stringOr = (key: string, fallback = '') => (typeof source[key] === 'string' ? String(source[key]).trim() : fallback);
  const characters = Array.isArray(source.characters)
    ? source.characters
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => ({
          characterId: String(item.characterId || ''),
          ...(item.version === null || item.version === undefined ? {} : { version: Number(item.version) }),
          ...(typeof item.activityRole === 'string' && item.activityRole.trim() ? { activityRole: item.activityRole.trim() } : {}),
        }))
        .filter((item) => item.characterId)
        .slice(0, 50)
    : [];
  const unique = new Map(characters.map((item) => [item.characterId, item]));
  return {
    templateId: stringOr('templateId', 'blank') || 'blank',
    templateActorMappings: source.templateActorMappings ? normalizeRoleMappings(source.templateActorMappings) : undefined,
    creationProfile: source.creationProfile && typeof source.creationProfile === 'object' ? source.creationProfile as Record<string,unknown> : undefined,
    title: stringOr('title'),
    type: stringOr('type'),
    theme: stringOr('theme'),
    location: stringOr('location'),
    rules: stringOr('rules'),
    scheduledDate: normalizeScheduledDate(source.scheduledDate),
    characters: [...unique.values()],
    birthdayCharacterIds: Array.isArray(source.birthdayCharacterIds)
      ? [...new Set(source.birthdayCharacterIds.filter((id): id is string => typeof id === 'string'))].slice(0, 50)
      : [],
    ...(typeof source.instruction === 'string' && source.instruction.trim() ? { instruction: source.instruction.trim().slice(0, 4_000) } : {}),
    ...(source.selection && typeof source.selection === 'object' ? { selection: source.selection as unknown as PlanningSelectionState } : {}),
    // 扩展字段必须原样保留：生成时要用研究修订、联动范围与人数偏好。
    ...(typeof source.leadCharacterId === 'string' && source.leadCharacterId.trim() ? { leadCharacterId: source.leadCharacterId.trim() } : {}),
    ...(source.leadRoleLabel === 'birthday-star' || source.leadRoleLabel === 'activity-lead' ? { leadRoleLabel: source.leadRoleLabel } : {}),
    ...(source.unrestrictedWorks === true ? { unrestrictedWorks: true } : {}),
    ...(Array.isArray(source.crossoverWorks)
      ? { crossoverWorks: [...new Set(source.crossoverWorks.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())))].slice(0, 30) }
      : {}),
    ...(Number.isFinite(Number(source.guestCountPreference)) ? { guestCountPreference: Math.max(2, Math.min(50, Math.trunc(Number(source.guestCountPreference)))) } : {}),
    ...(typeof source.researchRevisionId === 'string' && source.researchRevisionId.trim() ? { researchRevisionId: source.researchRevisionId.trim() } : {}),
    ...(typeof source.storyScopeNote === 'string' && source.storyScopeNote.trim() ? { storyScopeNote: source.storyScopeNote.trim().slice(0, 1_000) } : {}),
    // 灵感来源：采用话题点子时冻结，旧会话缺失该字段时按原逻辑运行。
    ...(source.inspiration && typeof source.inspiration === 'object' && !Array.isArray(source.inspiration)
      ? { inspiration: source.inspiration as ActivityInspirationSnapshot }
      : {}),
  };
}

/** 冻结本次企划使用的角色人设：发布版固定使用该版本，草稿记录当时的修订号。 */
function freezeCharacters(database: ServiceDatabase, form: ActivityPlanningForm): { actors: ContentDocument['actors']; refs: ActivityPlanningCharacterRef[] } {
  const actors: ContentDocument['actors'] = [];
  const refs: ActivityPlanningCharacterRef[] = [];
  for (const entry of form.characters) {
    const snapshot = createActorSnapshotFromCharacter(database, entry.characterId, {
      sourceVersion: entry.version ?? undefined,
      activityRole: entry.activityRole,
    });
    if (!snapshot) throw badRequest('character_snapshot_not_found', '角色不存在或已被删除。');
    actors.push(snapshot);
    refs.push({
      characterId: entry.characterId,
      displayName: snapshot.displayName,
      sourceVersion: snapshot.sourceVersion ?? null,
      sourceVersionStatus: snapshot.sourceVersionStatus || 'draft',
      draftRevision: Number(snapshot.characterDraftRevision ?? 1),
      actorId: snapshot.id,
      personaHash: hash(snapshot.persona),
    });
  }
  return { actors, refs };
}

/** 生成结束后重新确认人设未变，避免企划依据与实际活动快照不一致。 */
function assertCharactersStable(database: ServiceDatabase, refs: ActivityPlanningCharacterRef[]) {
  for (const ref of refs) {
    const snapshot = createActorSnapshotFromCharacter(database, ref.characterId, { sourceVersion: ref.sourceVersion ?? undefined });
    if (!snapshot) throw conflict('character_missing', `角色「${ref.displayName}」已被删除，请重新选择。`);
    if (ref.sourceVersionStatus === 'draft' && Number(snapshot.characterDraftRevision ?? 1) !== ref.draftRevision) {
      throw conflict('character_draft_changed', `角色「${ref.displayName}」的草稿已更新，请重新读取角色后再创建活动。`);
    }
    if (hash(snapshot.persona) !== ref.personaHash) {
      throw conflict('character_snapshot_changed', `角色「${ref.displayName}」的人设与企划依据不一致，请重新读取角色。`);
    }
  }
}

export class ActivityPlanningStore {
  constructor(private readonly database: ServiceDatabase) {}

  private get connection() {
    return this.database.connection;
  }

  createSession(input: { form: ActivityPlanningFormExtended; document: ContentDocument; characters: ActivityPlanningCharacterRef[] }): ActivityPlanningSession {
    const id = crypto.randomUUID();
    const now = nowIso();
    this.connection.prepare(
      `INSERT INTO activity_planning_sessions(id,version,status,form_json,snapshot_json,document_json,activity_id,inspiration_json,created_at,updated_at)
       VALUES (?,1,'draft',?,?,?,NULL,?,?,?)`
    ).run(
      id, JSON.stringify(input.form), JSON.stringify(input.characters), JSON.stringify(input.document),
      input.form.inspiration ? JSON.stringify(input.form.inspiration) : null, now, now,
    );
    return this.getSession(id)!;
  }

  getSession(id: string): ActivityPlanningSession | null {
    const row = this.connection.prepare('SELECT * FROM activity_planning_sessions WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const form = normalizeForm(JSON.parse(String(row.form_json || '{}')));
    // 灵感来源是服务端持有的快照：会话记录里存有但表单缺失时补回来，
    // 这样任何一次表单同步都不会把「点子出处」弄丢。
    if (!form.inspiration && row.inspiration_json) {
      try {
        form.inspiration = JSON.parse(String(row.inspiration_json)) as ActivityInspirationSnapshot;
      } catch { /* 快照损坏时按没有灵感来源处理。 */ }
    }
    return {
      id: String(row.id),
      version: Number(row.version),
      status: String(row.status) as ActivityPlanningSessionStatus,
      form,
      document: JSON.parse(String(row.document_json || '{}')) as ContentDocument,
      characters: JSON.parse(String(row.snapshot_json || '[]')) as ActivityPlanningCharacterRef[],
      activityId: row.activity_id ? String(row.activity_id) : null,
      researchRevisionId: row.research_revision_id ? String(row.research_revision_id) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  updateSession(id: string, expectedVersion: number, form: ActivityPlanningFormExtended): ActivityPlanningSession {
    const session = this.getSession(id);
    if (!session) throw badRequest('session_not_found', '企划会话不存在。');
    if (session.status === 'created') throw conflict('session_created', '该企划已经创建了活动，无法再修改。');
    const now = nowIso();
    const result = this.connection.prepare(
      'UPDATE activity_planning_sessions SET version=version+1,form_json=?,inspiration_json=COALESCE(?,inspiration_json),updated_at=? WHERE id=? AND version=?'
    ).run(
      JSON.stringify(form),
      form.inspiration ? JSON.stringify(form.inspiration) : null,
      now, id, expectedVersion,
    );
    if (Number(result.changes) !== 1) throw conflict('session_version_conflict', '企划会话已被更新，请刷新后重试。');
    return this.getSession(id)!;
  }

  updateSessionDocument(id: string, document: ContentDocument): ActivityPlanningSession {
    this.connection.prepare('UPDATE activity_planning_sessions SET document_json=?,updated_at=? WHERE id=?').run(JSON.stringify(document), nowIso(), id);
    return this.getSession(id)!;
  }

  setStatus(id: string, status: ActivityPlanningSessionStatus) {
    this.connection.prepare('UPDATE activity_planning_sessions SET status=?,updated_at=? WHERE id=?').run(status, nowIso(), id);
  }

  markCreated(id: string, activityId: string) {
    this.connection.prepare("UPDATE activity_planning_sessions SET status='created',activity_id=?,updated_at=? WHERE id=?").run(activityId, nowIso(), id);
  }

  deleteSession(id: string) {
    const result = this.connection.prepare("DELETE FROM activity_planning_sessions WHERE id=?").run(id);
    return Number(result.changes) > 0;
  }

  createJob(input: { sessionId: string; requestHash: string; idempotencyKey?: string | null; request: Record<string, unknown> }): { job: ActivityPlanningJob; isExisting: boolean } {
    const now = nowIso();
    if (input.idempotencyKey) {
      const existing = this.connection.prepare('SELECT * FROM activity_planning_jobs WHERE session_id=? AND idempotency_key=?')
        .get(input.sessionId, input.idempotencyKey) as Record<string, unknown> | undefined;
      if (existing) return { job: this.mapJob(existing), isExisting: true };
    }
    const id = crypto.randomUUID();
    this.connection.prepare(
      `INSERT INTO activity_planning_jobs(id,session_id,status,request_hash,idempotency_key,request_json,result_candidate_ids_json,error_message,model_metadata_json,created_at,updated_at)
       VALUES (?,?,'queued',?,?,?,'[]',NULL,'{}',?,?)`
    ).run(id, input.sessionId, input.requestHash, input.idempotencyKey || null, JSON.stringify(input.request), now, now);
    return { job: this.getJob(input.sessionId, id)!, isExisting: false };
  }

  getJob(sessionId: string, jobId: string): ActivityPlanningJob | null {
    const row = this.connection.prepare('SELECT * FROM activity_planning_jobs WHERE session_id=? AND id=?').get(sessionId, jobId) as Record<string, unknown> | undefined;
    return row ? this.mapJob(row) : null;
  }

  getJobRequest(jobId: string): Record<string, unknown> | null {
    const row = this.connection.prepare('SELECT request_json FROM activity_planning_jobs WHERE id=?').get(jobId) as { request_json?: string } | undefined;
    if (!row?.request_json) return null;
    try {
      const parsed = JSON.parse(String(row.request_json)) as Record<string, unknown>;
      return Object.keys(parsed).length ? parsed : null;
    } catch { return null; }
  }

  updateJob(jobId: string, patch: { status?: ActivityPlanningJob['status']; resultCandidateIds?: string[]; errorMessage?: string | null; modelMetadata?: Record<string, unknown> }) {
    const sets: string[] = ['updated_at = ?'];
    const params: (string | number | null)[] = [nowIso()];
    if (patch.status) { sets.push('status = ?'); params.push(patch.status); }
    if (patch.resultCandidateIds) { sets.push('result_candidate_ids_json = ?'); params.push(JSON.stringify(patch.resultCandidateIds)); }
    if (patch.errorMessage !== undefined) { sets.push('error_message = ?'); params.push(patch.errorMessage); }
    if (patch.modelMetadata) { sets.push('model_metadata_json = ?'); params.push(JSON.stringify(patch.modelMetadata)); }
    params.push(jobId);
    this.connection.prepare(`UPDATE activity_planning_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  createCandidate(input: { sessionId: string; sessionVersion: number; payload: ActivityPlanningOutput; planningInput?: Record<string, unknown> }): ActivityPlanningCandidate {
    const id = crypto.randomUUID();
    this.connection.prepare(
      "INSERT INTO activity_planning_candidates(id,session_id,session_version,payload_json,validation_json,adopted,created_at) VALUES (?,?,?,?,?,0,?)"
    ).run(id, input.sessionId, input.sessionVersion, JSON.stringify(input.payload), JSON.stringify({ planningInput: input.planningInput }), nowIso());
    return this.getCandidate(input.sessionId, id)!;
  }

  getCandidate(sessionId: string, candidateId: string): ActivityPlanningCandidate | null {
    const row = this.connection.prepare('SELECT * FROM activity_planning_candidates WHERE session_id=? AND id=?').get(sessionId, candidateId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      sessionVersion: row.session_version == null ? null : Number(row.session_version),
      payload: JSON.parse(String(row.payload_json)) as ActivityPlanningOutput,
      adopted: Boolean(row.adopted),
      createdAt: String(row.created_at),
    };
  }

  listJobs(sessionId: string, limit = 20): ActivityPlanningJob[] {
    return (this.connection.prepare('SELECT * FROM activity_planning_jobs WHERE session_id=? ORDER BY created_at DESC LIMIT ?').all(sessionId, limit) as Record<string, unknown>[]).map((row) => this.mapJob(row));
  }

  listCandidates(sessionId: string, limit = 20): ActivityPlanningCandidate[] {
    return (this.connection.prepare('SELECT * FROM activity_planning_candidates WHERE session_id=? ORDER BY created_at DESC LIMIT ?').all(sessionId, limit) as Record<string, unknown>[])
      .map((row) => this.getCandidate(sessionId, String(row.id))!);
  }

  /** 同一会话同一时刻只采用一份方案，采用记录写进候选本身，供导出与复盘。 */
  adoptCandidate(sessionId: string, candidateId: string | null): void {
    this.connection.prepare('UPDATE activity_planning_candidates SET adopted=0 WHERE session_id=?').run(sessionId);
    if (candidateId) this.connection.prepare('UPDATE activity_planning_candidates SET adopted=1 WHERE session_id=? AND id=?').run(sessionId, candidateId);
  }

  updateSessionCharacters(id: string, characters: ActivityPlanningCharacterRef[]): void {
    this.connection.prepare('UPDATE activity_planning_sessions SET snapshot_json=?,updated_at=? WHERE id=?').run(JSON.stringify(characters), nowIso(), id);
  }

  recoverDanglingJobs(): number {
    const result = this.connection.prepare(
      "UPDATE activity_planning_jobs SET status='result_unknown', error_message='server_restarted_result_unknown', updated_at=? WHERE status IN ('running','queued')"
    ).run(nowIso());
    return Number(result.changes);
  }

  private mapJob(row: Record<string, unknown>): ActivityPlanningJob {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      status: String(row.status) as ActivityPlanningJob['status'],
      requestHash: String(row.request_hash),
      idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
      resultCandidateIds: JSON.parse(String(row.result_candidate_ids_json || '[]')),
      errorMessage: row.error_message ? String(row.error_message) : null,
      modelMetadata: JSON.parse(String(row.model_metadata_json || '{}')),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}

/**
 * 各方案里引用到的人物 → 阶段 clientId。
 * 占位角色只出现在方案输出里（会话文档的阶段来自模板），所以“影响哪些阶段”必须把两者并起来看。
 */
function collectCandidateStageRefs(candidates: ActivityPlanningCandidate[]): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  for (const candidate of candidates) {
    for (const stage of candidate.payload.stages ?? []) {
      for (const actorId of stage.actorIds ?? []) {
        const list = refs.get(actorId) ?? [];
        if (!list.includes(stage.clientId)) list.push(stage.clientId);
        refs.set(actorId, list);
      }
    }
  }
  return refs;
}

/** 企划文档中待解析角色（研究候选占位角色）及其影响的阶段。 */
export function listPendingActors(
  document: ContentDocument,
  context?: ResearchContext,
  candidateStageRefs?: Map<string, string[]>,
): ActivityPlanningPendingActor[] {
  const candidateById = new Map((context?.candidates ?? []).map((item) => [item.id, item]));
  return document.actors
    .filter((actor) => isUnresolvedPlanningActor(actor))
    .map((actor) => {
      const candidate = actor.candidateRefId ? candidateById.get(actor.candidateRefId) : undefined;
      const fromDocument = document.stages.filter((stage) => stage.actorIds.includes(actor.id)).map((stage) => stage.id);
      const affectedStageIds = [...new Set([...fromDocument, ...(candidateStageRefs?.get(actor.id) ?? [])])];
      return {
        actorId: actor.id,
        displayName: actor.displayName,
        candidateRefId: actor.candidateRefId ?? null,
        activityRole: actor.activityRole || '受邀参与者',
        ...(candidate?.work ? { work: candidate.work } : {}),
        ...(candidate?.basis ? { basis: candidate.basis } : {}),
        ...(candidate?.relationshipToLead ? { relationshipToLead: candidate.relationshipToLead } : {}),
        evidenceIds: candidate?.evidenceIds ?? [],
        affectedStageIds,
      } satisfies ActivityPlanningPendingActor;
    });
}

/** 单份方案的页面对比摘要。差异点全部来自企划输出本身，不额外生成内容。 */
export function buildCandidateSummary(
  candidate: ActivityPlanningCandidate,
  document: ContentDocument,
  input: { pendingActorIds: Set<string>; researchStale: boolean; researchHasEvidence: boolean; creativeNames: string[] },
): PlanningCandidateSummary {
  const displayNameById = new Map(document.actors.map((actor) => [actor.id, actor.displayName]));
  const stageActorIds = new Set(candidate.payload.stages.flatMap((stage) => stage.actorIds || []));
  const participants = [...stageActorIds].map((id) => displayNameById.get(id) || id);
  const pendingPersonaCount = [...stageActorIds].filter((id) => input.pendingActorIds.has(id)).length;
  const caveats: string[] = [];
  if (pendingPersonaCount) caveats.push(`有 ${pendingPersonaCount} 位人物还需要匹配或补齐人设后才能创建活动。`);
  if (input.creativeNames.length) caveats.push(`${input.creativeNames.slice(0, 3).join('、')}属于跨作品联动创作建议，原作关系未在资料中查证。`);
  if (!input.researchHasEvidence) caveats.push('本方案未取得外部资料依据，人物与地点均为创作建议。');
  if (input.researchStale) caveats.push('活动意图在生成之后有改动，本方案基于旧设置，建议重新生成。');
  return {
    id: candidate.id,
    name: candidate.payload.activity.title,
    overview: candidate.payload.activity.overview,
    participants,
    primaryLocation: candidate.payload.activity.location,
    style: candidate.payload.activity.theme,
    highlights: candidate.payload.stages.map((stage) => stage.title).slice(0, 4),
    stageCount: candidate.payload.stages.length,
    pendingPersonaCount,
    caveats,
    adopted: candidate.adopted,
    createdAt: candidate.createdAt,
  };
}

/** 研究输入是否与当前表单一致；不一致时旧方案要显示“基于旧设置”。 */
export function isResearchInputStale(inputSnapshot: Record<string, unknown>, form: ActivityPlanningFormExtended, researchRevisionId?: string | null): boolean {
  if (researchRevisionId === null) return false;
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const works = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).sort().join('|') : '';
  return (typeof inputSnapshot.leadCharacterId === 'string' && inputSnapshot.leadCharacterId !== (form.leadCharacterId || form.characters[0]?.characterId))
    || (typeof inputSnapshot.activityType === 'string' && text(inputSnapshot.activityType) !== text(form.type))
    || text(inputSnapshot.crossoverWorks ? works(inputSnapshot.crossoverWorks) : '') !== works(form.crossoverWorks ?? [])
    || Boolean(inputSnapshot.unrestrictedWorks) !== Boolean(form.unrestrictedWorks)
    || text(inputSnapshot.userRequest) !== text(form.instruction)
    || text(inputSnapshot.storyScopeNote) !== text(form.storyScopeNote)
    || (inputSnapshot.guestCountPreference == null ? null : Number(inputSnapshot.guestCountPreference)) !== (form.guestCountPreference ?? null);
}

/** 角色人设投影 → V2 草稿，用于把预览确认后的简版人设入库。 */
function draftFromPersona(persona: ActorPersona, displayName: string): CharacterDraftV2 {
  const source = (persona && typeof persona === 'object' ? persona : {}) as Record<string, unknown>;
  const appearance = (source.appearance && typeof source.appearance === 'object' ? source.appearance : {}) as Record<string, unknown>;
  const asText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const asList = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()) : [];
  return {
    schemaVersion: 2,
    displayName,
    englishName: asText(source.englishName),
    aliases: asList(source.aliases),
    originType: source.originType === 'ip' ? 'ip' : 'original',
    work: asText(source.work),
    summary: asText(source.summary),
    personaText: asText(source.personaText),
    speechText: asText(source.speechText),
    dialogueExamples: asList(source.dialogueExamples),
    behaviorRules: asText(source.behaviorRules),
    appearance: { baseText: asText(appearance.baseText), defaultOutfitText: asText(appearance.defaultOutfitText) },
  };
}

/** 企划补齐人设时新建的本地角色记录，与角色库新增接口写入同样的存储形态。 */
function createLocalCharacter(database: ServiceDatabase, draft: CharacterDraftV2, source?: { sessionId: string; note: string }): string {
  const id = crypto.randomUUID();
  const now = nowIso();
  database.connection.prepare(
    'INSERT INTO character_profiles(id,slug,display_name,draft_json,tags_json,avatar_asset_id,latest_version,archived,created_at,updated_at,draft_revision) VALUES (?,?,?,?,?,NULL,NULL,0,?,?,1)'
  ).run(id, uniqueCharacterSlug(database, draft.englishName || draft.displayName), draft.displayName, JSON.stringify(draft), JSON.stringify(['企划补齐']), now, now);
  upsertCharacterBirthday(database, id, draft);
  if (source) database.connection.prepare('INSERT INTO character_sources(id,character_id,title,url,excerpt,source_type,fetched_at) VALUES (?,?,?,?,?,?,?)').run(crypto.randomUUID(), id, '活动企划确认的人设', '/apps/activities/new?session=' + encodeURIComponent(source.sessionId), source.note, 'manual', now);
  return id;
}

function uniqueCharacterSlug(database: ServiceDatabase, input: string) {
  const base = input.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 54) || `character-${Date.now()}`;
  let candidate = base;
  let number = 2;
  while (database.connection.prepare('SELECT 1 FROM character_profiles WHERE slug=?').get(candidate)) candidate = `${base}-${number++}`;
  return candidate;
}

export function validatePlanningOutput(output: unknown, document: ContentDocument): ActivityPlanningOutput {
  const fail = (message: string): never => { throw new Error(`invalid_ai_output: ${message}`); };
  const data = output && typeof output === 'object' && !Array.isArray(output) ? (output as Record<string, unknown>) : fail('expected object');
  if (data.schemaVersion !== 1) fail('schemaVersion must be 1');
  const activity = data.activity && typeof data.activity === 'object' ? (data.activity as Record<string, unknown>) : fail('activity must be object');
  for (const key of ['title', 'theme', 'location', 'rules', 'overview']) {
    if (typeof activity[key] !== 'string') fail(`activity.${key} must be text`);
  }
  const actorIds = new Set(document.actors.map((actor) => actor.id));
  if (!Array.isArray(data.actorRoles)) fail('actorRoles must be an array');
  for (const row of data.actorRoles as Record<string, unknown>[]) {
    if (!row || typeof row !== 'object') fail('actorRoles entries must be objects');
    if (typeof row.actorId !== 'string' || !actorIds.has(row.actorId)) fail(`unknown actor ${String(row.actorId)}`);
    if (typeof row.activityRole !== 'string' || !row.activityRole.trim()) fail('activityRole must be text');
  }
  if (!Array.isArray(data.stages) || data.stages.length < 2) fail('at least two stages required');
  const seen = new Set<string>();
  for (const row of data.stages as Record<string, unknown>[]) {
    if (!row || typeof row !== 'object') fail('stages entries must be objects');
    const clientId = typeof row.clientId === 'string' ? row.clientId : '';
    if (!clientId) fail('missing clientId');
    if (seen.has(clientId)) fail('duplicate clientId');
    seen.add(clientId);
    for (const key of ['title', 'location', 'description', 'endCondition']) {
      if (typeof row[key] !== 'string') fail(`stages.${key} must be text`);
    }
    if (!Array.isArray(row.actorIds) || row.actorIds.some((id) => typeof id !== 'string' || !actorIds.has(id))) fail('invalid stage actor references');
    if (!Array.isArray(row.requiredBeats) || row.requiredBeats.some((beat) => typeof beat !== 'string')) fail('requiredBeats must be text array');
  }
  return data as unknown as ActivityPlanningOutput;
}

interface ResearchContext {
  candidates: Array<{ id: string; name: string; work: string; basis: ResearchEvidenceBasis; relationshipToLead: string; evidenceIds: string[] }>;
  locations: Array<{ id: string; name: string }>;
  evidenceExcerpt: string;
  evidenceCount: number;
  taskId: string | null;
  task: ResearchTask | null;
}

/** 读取企划会话关联的研究候选（通过 research_revision_id）。 */
function loadResearchContext(database: ServiceDatabase, session: ActivityPlanningSession): ResearchContext {
  const researchRevisionId = session.researchRevisionId || session.form.researchRevisionId;
  const ideaCandidates: ResearchContext['candidates'] = (session.form.inspiration?.recommendedCharacters ?? []).map((item, index) => ({ id: 'idea_' + session.form.inspiration!.ideaId + '_' + index, name: item.name, work: item.work, basis: 'creative' as const, relationshipToLead: item.relationshipNote || item.reason, evidenceIds: [] })).filter(item => !session.form.selection?.excludedCharacterIds.includes(item.id));
  const empty: ResearchContext = { candidates: ideaCandidates, locations: [], evidenceExcerpt: '', evidenceCount: 0, taskId: null, task: null };
  if (!researchRevisionId) return empty;
  try {
    const research = new ResearchStore(database);
    const revision = research.getRevision(researchRevisionId);
    if (!revision || revision.sessionId !== session.id) return empty;
    const task = revision.taskSnapshot || research.getTask(revision.taskId);
    if (!task) return empty;
    const locations = task.locationCandidates.map((item) => ({ id: item.id, name: item.name }));
    const candidates = task.characterCandidates
      // 已排除的候选不进入生成；用户的选择必须被遵守。
      .filter((item) => !(session.form.selection?.excludedCharacterIds ?? []).includes(item.id) && item.userStatus !== 'excluded')
      .map((item) => ({
        id: item.id,
        name: item.displayName,
        work: item.work,
        basis: item.basis,
        relationshipToLead: item.relationshipToLead || item.reason,
        evidenceIds: item.evidenceIds,
      }));
    const evidenceExcerpt = task.evidence.slice(0, 4).map((item) =>
      item.sourceName + '（' + item.documentLocator + '）：' + item.excerpt.slice(0, 200)
    ).join('\n');
    return { candidates: [...candidates, ...ideaCandidates.filter(item => !candidates.some(candidate => candidate.name === item.name && candidate.work === item.work))], locations, evidenceExcerpt, evidenceCount: task.evidence.length, taskId: task.id, task };
  } catch {
    return empty;
  }
}

/** 把研究建议人物加入企划文档作为“待补人设”占位 actor，并生成 prompt 用的临时 ID 映射。 */
function buildVariantDocument(
  document: ContentDocument,
  context: ResearchContext,
): { document: ContentDocument; promptCandidates: Array<{ id: string; name: string; work: string; basis: string; relationshipToLead: string }> } {
  if (!context.candidates.length) return { document, promptCandidates: [] };
  const updated: ContentDocument = JSON.parse(JSON.stringify(document));
  const existingNames = new Set(updated.actors.map(actor => `${actor.displayName.toLowerCase()}|${String(actor.persona?.work || '').toLowerCase()}`));
  const promptCandidates: Array<{ id: string; name: string; work: string; basis: string; relationshipToLead: string }> = [];
  context.candidates.forEach((candidate) => {
    if (updated.actors.some(actor => actor.candidateRefId === candidate.id) || existingNames.has(`${candidate.name.toLowerCase()}|${candidate.work.toLowerCase()}`)) return;
    const tempId = 'cand_' + candidate.id;
    promptCandidates.push({ ...candidate, id: tempId });
    updated.actors.push({
      id: tempId,
      displayName: candidate.name,
      persona: { work: candidate.work, identity: '待补人设：' + candidate.name + '（' + candidate.work + '）。', personality: [], speech: { tone: '' } },
      activityRole: '受邀参与者',
      outfitDescription: '',
      appearanceReferenceAssetKeys: [],
      candidateRefId: candidate.id,
      personaStatus: 'pending',
    });
  });
  return { document: updated, promptCandidates };
}
export interface PlanningServiceOptions {
  config: ServiceConfig;
  database: ServiceDatabase;
  secrets: SecretStore;
  store: ActivityStore;
  fetcher?: typeof fetch;
}

interface PlanningRequest {
  document: ContentDocument;
  sessionVersion: number;
  instruction?: string;
  planCount: number;
  requiredActorIds: string[];
  lockedLocation: string | null;
  excludedLocations: string[];
  requiredLocations: string[];
  researchContext: ResearchContext;
  inspiration?: ActivityInspirationSnapshot | null;
  selection?: PlanningSelectionState;
  researchRevisionId?: string | null;
}

const planningAttempts = new Map<string, symbol>();

function executePlanningJob(options: PlanningServiceOptions, sessionId: string, jobId: string, snapshot: PlanningRequest) {
  const planning = new ActivityPlanningStore(options.database);
  const attempt = Symbol(jobId);
  planningAttempts.set(jobId, attempt);
  const active = () => {
    if (planningAttempts.get(jobId) !== attempt) return false;
    const job = planning.getJob(sessionId, jobId);
    return !!job && (job.status === 'queued' || job.status === 'running') && planning.getSession(sessionId)?.status !== 'created';
  };
  setImmediate(async () => {
    if (!active()) { if (planningAttempts.get(jobId) === attempt) planningAttempts.delete(jobId); return; }
    const successIds: string[] = [];
    const errors: string[] = [];
    const previousPlans: string[] = [];
    try {
      planning.updateJob(jobId, { status: 'running' });
      const status = await resolveAppLlmBindingStatus(options.database, options.secrets, 'activities', 'text');
      const profile = status.ready ? await resolveAssignedLlmProfile(options.database, options.secrets, 'activities', 'text') : null;
      if (!profile) throw llmNotReadyError(status);
      for (let index = 0; index < snapshot.planCount; index++) {
        if (!active()) return;
        try {
          const prompt = buildVariantPlanningPrompt(snapshot.document, {
            instructions: [snapshot.instruction, snapshot.requiredLocations.length ? '以下地点必须安排在主要地点或阶段地点中：' + snapshot.requiredLocations.join('、') : '', snapshot.excludedLocations.length ? '不可使用的地点：' + snapshot.excludedLocations.join('、') : '',
              previousPlans.length ? '已生成的方案摘要，请在流程与创意上明显区别：' + previousPlans.join('\n') : ''].filter(Boolean).join('\n'),
            variantIndex: index, variantTotal: snapshot.planCount,
            candidateCharacters: snapshot.document.actors.filter(actor => actor.candidateRefId).map(actor => {
              const candidate = snapshot.researchContext.candidates.find(item => item.id === actor.candidateRefId);
              return { id: actor.id, name: actor.displayName, work: candidate?.work || '', basis: candidate?.basis || 'creative', relationshipToLead: candidate?.relationshipToLead || '' };
            }), requiredCharacterIds: snapshot.requiredActorIds,
            excludedCharacterIds: [], lockedLocation: snapshot.lockedLocation,
            researchEvidenceExcerpt: snapshot.researchContext.evidenceExcerpt,
          });
          const response = await callLlm(profile, prompt, options.fetcher ?? fetch);
          if (!active()) return;
          const parsed = validatePlanningOutput(parseAiJsonOutput<unknown>(response), snapshot.document);
          const roleIds = new Set(parsed.actorRoles.map(role => role.actorId));
          const stageIds = new Set(parsed.stages.flatMap(stage => stage.actorIds));
          if (snapshot.requiredActorIds.some(id => !roleIds.has(id) || !stageIds.has(id))) throw new Error('方案遗漏了必选人物或没有安排其参与阶段。');
          if (snapshot.lockedLocation && parsed.activity.location.trim() !== snapshot.lockedLocation.trim()) throw new Error('方案未遵守锁定的主要地点。');
          if (snapshot.excludedLocations.some(name => [parsed.activity.location, ...parsed.stages.map(stage => stage.location)].some(location => location.trim() === name.trim()))) throw new Error('方案使用了已排除的地点。');
          if (snapshot.requiredLocations.some(name => ![parsed.activity.location, ...parsed.stages.map(stage => stage.location)].some(location => location.trim() === name.trim()))) throw new Error('方案遗漏了必选地点。');
          const candidate = planning.createCandidate({ sessionId, sessionVersion: snapshot.sessionVersion, payload: parsed, planningInput: { inspiration: snapshot.inspiration ?? null, researchContext: snapshot.researchContext, selection: snapshot.selection, researchRevisionId: snapshot.researchRevisionId } });
          successIds.push(candidate.id);
          previousPlans.push(JSON.stringify({ activity: parsed.activity, stages: parsed.stages }));
          // 每份成功即保存；取消后也能取回已经完成的方案。
          const current = planning.getSession(sessionId);
          if (current?.version === snapshot.sessionVersion) {
            const ids = new Set([...roleIds, ...stageIds]);
            const existing = new Set(current.document.actors.map(actor => actor.id));
            const actors = [...current.document.actors, ...snapshot.document.actors.filter(actor => ids.has(actor.id) && !existing.has(actor.id))];
            planning.updateSessionDocument(sessionId, { ...current.document, actors });
          }
          planning.updateJob(jobId, { resultCandidateIds: [...successIds] });
        } catch (error) {
          errors.push(`方案 ${index + 1}：${(error as Error).message}`);
        }
      }
      if (!active()) return;
      if (!successIds.length) throw new Error(errors.join('\n') || '企划全部生成失败，请重试。');
      planning.updateJob(jobId, { status: 'succeeded', resultCandidateIds: successIds,
        errorMessage: errors.length ? errors.join('\n') : null,
        modelMetadata: { model: profile.model, profileId: profile.id, planCount: snapshot.planCount, generated: successIds.length } });
      planning.setStatus(sessionId, 'ready');
    } catch (error) {
      if (!active()) return;
      planning.updateJob(jobId, { status: 'failed', errorMessage: (error as Error).message });
      planning.setStatus(sessionId, 'failed');
    } finally {
      if (planningAttempts.get(jobId) === attempt) planningAttempts.delete(jobId);
    }
  });
}

export async function runPlanningJob(options: PlanningServiceOptions, sessionId: string, input: { instruction?: string; idempotencyKey?: string; planCount?: number }) {
  const planning = new ActivityPlanningStore(options.database);
  const session = planning.getSession(sessionId);
  if (!session) throw badRequest('session_not_found', '企划会话不存在。');
  if (session.status === 'created') throw conflict('session_created', '该企划已经创建了活动。');
  if (!session.document.actors?.length) throw badRequest('characters_required', '请先选择参与角色。');
  const running = planning.listJobs(sessionId).find(job => job.status === 'queued' || job.status === 'running');
  if (running) return running;
  const bindingStatus = await resolveAppLlmBindingStatus(options.database, options.secrets, 'activities', 'text');
  if (!bindingStatus.ready) throw llmNotReadyError(bindingStatus);
  const researchContext = loadResearchContext(options.database, session);
  const selection = session.form.selection;
  const { document } = buildVariantDocument(session.document, researchContext);
  const excluded = new Set(selection?.excludedCharacterIds ?? []);
  document.actors = document.actors.filter(actor => !actor.candidateRefId || !excluded.has(actor.candidateRefId));
  const requiredActorIds = document.actors.filter(actor => !actor.candidateRefId || (selection?.requiredCharacterIds ?? []).includes(actor.candidateRefId)).map(actor => actor.id);
  // 同名本地人设无需占位，必选约束仍映射到真实 actor ID。
  for (const id of selection?.requiredCharacterIds ?? []) {
    const candidate = researchContext.candidates.find(item => item.id === id);
    const actor = document.actors.find(item => item.candidateRefId === id || (item.displayName === candidate?.name && item.persona.work === candidate?.work));
    if (!actor) throw badRequest('required_character_missing', '必选人物已失效，请重新确认候选。');
    if (!requiredActorIds.includes(actor.id)) requiredActorIds.push(actor.id);
  }
  const snapshot: PlanningRequest = {
    document, sessionVersion: session.version,
    instruction: [input.instruction?.trim() || session.form.instruction, session.form.inspiration ? '所选灵感与素材快照（企划须围绕该点子展开）：' + JSON.stringify(session.form.inspiration) : ''].filter(Boolean).join('\n') || undefined,
    planCount: Math.min(Math.max(Math.floor(Number(input.planCount) || 1), 1), 3),
    requiredActorIds,
    lockedLocation: researchContext.locations.find(item => item.id === selection?.lockedLocationId)?.name ?? null,
    requiredLocations: researchContext.locations.filter(item => selection?.requiredLocationIds.includes(item.id)).map(item => item.name),
    excludedLocations: researchContext.locations.filter(item => selection?.excludedLocationIds.includes(item.id)).map(item => item.name),
    researchContext, inspiration: session.form.inspiration || null, selection, researchRevisionId: session.researchRevisionId,
  };
  const { job, isExisting } = planning.createJob({ sessionId, requestHash: hash(snapshot), idempotencyKey: input.idempotencyKey, request: { ...snapshot } });
  if (isExisting) return job;
  planning.setStatus(sessionId, 'generating');
  executePlanningJob(options, sessionId, job.id, snapshot);
  return job;
}

export async function retryPlanningJob(options: PlanningServiceOptions, sessionId: string, jobId: string) {
  const planning = new ActivityPlanningStore(options.database);
  const job = planning.getJob(sessionId, jobId);
  if (!job) return null;
  if (job.status === 'queued' || job.status === 'running' || planning.getSession(sessionId)?.status === 'created') return job;
  const running = planning.listJobs(sessionId).find(item => item.status === 'queued' || item.status === 'running');
  if (running) return running;
  const raw = planning.getJobRequest(jobId);
  if (!raw?.document) {
    planning.updateJob(jobId, { status: 'failed', errorMessage: '该任务没有保存原始输入快照，无法原样重试。' });
    return planning.getJob(sessionId, jobId);
  }
  const snapshot = { planCount: 1, requiredActorIds: [], lockedLocation: null, excludedLocations: [], requiredLocations: [],
    researchContext: { candidates: [], locations: [], evidenceExcerpt: '', evidenceCount: 0, taskId: null, task: null }, ...raw, document: raw.document as ContentDocument, sessionVersion: Number(raw.sessionVersion || 1) } as PlanningRequest;
  planning.updateJob(jobId, { status: 'queued', errorMessage: null, resultCandidateIds: [] });
  planning.setStatus(sessionId, 'generating');
  executePlanningJob(options, sessionId, jobId, snapshot);
  return planning.getJob(sessionId, jobId);
}

/** 由企划会话创建正式活动：校验人设快照一致，并在事务内标记会话已创建。 */
export function createActivityFromSession(options: PlanningServiceOptions, sessionId: string, input: { document?: ContentDocument; candidateId?: string | null; idempotencyKey?: string | null }) {
  const planning = new ActivityPlanningStore(options.database);
  const session = planning.getSession(sessionId);
  if (!session) throw badRequest('session_not_found', '企划会话不存在。');
  if (session.activityId) {
    const existing = options.store.getActivity(session.activityId);
    if (existing) return { activity: existing, session: planning.getSession(sessionId)!, created: false };
  }
  const document = input.document || session.document;
  if (!document?.stages || document.stages.length < 2) throw badRequest('minimum_two_stages_required', '活动至少必须包含两个阶段。');
  if (!document.activity?.title?.trim()) throw badRequest('title_required', '活动标题不能为空。');

  // 待解析角色必须先匹配已有角色或补齐人设：候选占位角色不能写进正式活动。
  const unresolved = document.actors.filter((actor) => isUnresolvedPlanningActor(actor));
  if (unresolved.length) {
    throw conflict('pending_actors_unresolved', `还有 ${unresolved.length} 位人物（${unresolved.map((actor) => actor.displayName).join('、')}）未匹配或补齐人设，请先在“确认创建”中处理。`);
  }

  // 提交的角色必须与会话冻结的快照一致，避免客户端替换人设。
  const sessionActors = new Map(session.document.actors.map((actor) => [actor.id, actor]));
  const submittedIds = new Set(document.actors.map(actor => actor.id));
  if (!document.actors.length || submittedIds.size !== document.actors.length || session.document.actors.some(actor => !actor.candidateRefId && !submittedIds.has(actor.id))) throw badRequest('actors_mismatch', '提交的角色与会话快照不一致。');
  for (const stage of document.stages) {
    if (stage.actorIds.some(id => !submittedIds.has(id)) || stage.requiredBeats.some(beat => beat.actorIds.some(id => !submittedIds.has(id)))) throw badRequest('actor_reference_invalid', '阶段中包含已移除的人物，请编辑该方案后重试。');
  }
  if (input.candidateId && !planning.getCandidate(sessionId, input.candidateId)) throw badRequest('candidate_not_found', '方案不存在。');
  for (const actor of document.actors) {
    const frozen = sessionActors.get(actor.id);
    if (!frozen) throw badRequest('actors_mismatch', '提交的角色与会话快照不一致。');
    if (hash(actor.persona) !== hash(frozen.persona) || actor.displayName !== frozen.displayName || actor.sourceCharacterId !== frozen.sourceCharacterId) {
      throw conflict('character_snapshot_changed', '角色人设与会话快照不一致，请重新读取角色。');
    }
  }
  const birthdayActorIds = document.activity.birthdayActorIds || [];
  for (const id of birthdayActorIds) {
    if (!submittedIds.has(id)) throw badRequest('birthday_actor_unknown', '寿星必须是本场活动内的角色。');
  }
  assertCharactersStable(options.database, session.characters.filter(ref => submittedIds.has(ref.actorId)));

  // 采用方案的依据快照：随活动文档保存，导出时一并带走，不包含任何密钥。
  const basis = buildPlanningBasis(options.database, session, document, input.candidateId ?? null);
  const finalDocument: ContentDocument = {
    ...document,
    activity: { ...document.activity, scheduledDate: normalizeScheduledDate(document.activity.scheduledDate), planningBasis: basis },
  };

  const created = options.database.transaction(() => {
    const activity = options.store.createActivity({
      title: document.activity.title.trim(),
      type: document.activity.type || '日常活动',
      theme: document.activity.theme || '',
      location: document.activity.location || '',
      rules: document.activity.rules || '',
      initialDocument: finalDocument,
      skipTransaction: true,
    });
    planning.adoptCandidate(sessionId, input.candidateId ?? null);
    planning.updateSessionDocument(sessionId, finalDocument);
    planning.markCreated(sessionId, activity.activity.id);
    // 灵感来源落地：素材标记为已使用，点子批次关联正式活动。
    // 失败不影响创建结果，活动与快照已经写好。
    try {
      const inspiration = finalDocument.activity.planningBasis?.inspiration;
      if (inspiration) {
        new TopicStore(options.database).markUsed(inspiration.topics.map((topic) => topic.id), activity.activity.id);
        new IdeaStore(options.database).updateBatch(inspiration.batchId, { activityId: activity.activity.id, sessionId });
      }
    } catch { /* 灵感溯源是附加信息，不阻塞活动创建。 */ }
    return activity.activity;
  });
  return { activity: created, session: planning.getSession(sessionId)!, created: true };
}

/** 采用方案的依据快照。只记录已保存的研究资料与用户约束，不重新访问 MCP。 */
function buildPlanningBasis(
  database: ServiceDatabase,
  session: ActivityPlanningSession,
  document: ContentDocument,
  candidateId: string | null,
): ActivityPlanningBasis {
  const planning = new ActivityPlanningStore(database);
  const sourceJob = candidateId ? planning.listJobs(session.id, 1000).find(job => job.resultCandidateIds.includes(candidateId)) : null;
  const candidateRow = candidateId ? database.connection.prepare('SELECT validation_json FROM activity_planning_candidates WHERE session_id=? AND id=?').get(session.id, candidateId) : null;
  const savedInput = candidateRow ? (JSON.parse(String(candidateRow.validation_json || '{}')) as { planningInput?: Record<string, unknown> }).planningInput : null;
  const savedRequest = savedInput || (sourceJob ? planning.getJobRequest(sourceJob.id) : null);
  const context = (savedRequest?.researchContext as ResearchContext | undefined) ?? loadResearchContext(database, session);
  const resolvedByCandidate = new Map<string, string>();
  for (const actor of document.actors) {
    if (actor.candidateRefId && actor.sourceCharacterId) resolvedByCandidate.set(actor.candidateRefId, String(actor.sourceCharacterId));
  }
  const task = context.task;
  const selection = (savedRequest?.selection as PlanningSelectionState | undefined) ?? session.form.selection;
  return {
    sessionId: session.id,
    ...(candidateId ? { adoptedCandidateId: candidateId } : {}),
    researchRevisionId: savedRequest && 'researchRevisionId' in savedRequest ? savedRequest.researchRevisionId as string | null : session.researchRevisionId || session.form.researchRevisionId || null,
    ...(context.taskId ? { researchTaskId: context.taskId } : {}),
    ...(selection ? { selection } : {}),
    ...(task ? { inputSnapshot: task.inputSnapshot } : {}),
    // 灵感来源随活动依据一起保存与导出；旧会话没有该字段时省略。
    ...((savedRequest && 'inspiration' in savedRequest ? savedRequest.inspiration : session.form.inspiration) ? { inspiration: (savedRequest && 'inspiration' in savedRequest ? savedRequest.inspiration : session.form.inspiration) as ActivityInspirationSnapshot } : {}),
    evidence: (task?.evidence ?? []).map((item) => ({
      id: item.id,
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      tool: item.tool,
      documentLocator: item.documentLocator,
      excerpt: item.excerpt,
      retrievedAt: item.retrievedAt,
      contentHash: item.contentHash,
    })),
    characterCandidates: (task?.characterCandidates ?? []).map((item) => ({
      id: item.id,
      displayName: item.displayName,
      work: item.work,
      basis: item.basis,
      relationshipToLead: item.relationshipToLead,
      userStatus: item.userStatus,
      localMatchStatus: item.localMatchStatus,
      ...(resolvedByCandidate.get(item.id) ? { resolvedCharacterId: resolvedByCandidate.get(item.id)! } : {}),
    })),
    locationCandidates: (task?.locationCandidates ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      work: item.work,
      basis: item.basis,
      userStatus: item.userStatus,
      ...(item.locked ? { locked: true } : {}),
    })),
    createdAt: nowIso(),
  };
}

/** 企划会话的完整视图：候选方案摘要、待解析角色与研究过期状态一起返回。 */
export function buildSessionResponse(database: ServiceDatabase, session: ActivityPlanningSession): ActivityPlanningSessionResponse {
  const planning = new ActivityPlanningStore(database);
  const candidates = planning.listCandidates(session.id);
  const context = loadResearchContext(database, session);
  const revisionId = session.researchRevisionId || session.form.researchRevisionId || null;
  const researchStale = (() => {
    if (!revisionId) return false;
    const revision = new ResearchStore(database).getRevision(revisionId);
    return revision ? isResearchInputStale(revision.inputSnapshot, session.form) : false;
  })();
  const pendingActors = listPendingActors(session.document, context, collectCandidateStageRefs(candidates));
  const pendingActorIds = new Set(pendingActors.map((actor) => actor.actorId));
  const creativeNames = context.candidates.filter((item) => item.basis === 'creative').map((item) => item.name);
  const summaries: PlanningCandidateSummary[] = candidates.map((candidate) => ({
    ...buildCandidateSummary(candidate, session.document, {
      pendingActorIds,
      researchStale,
      researchHasEvidence: context.evidenceCount > 0,
      creativeNames,
    }),
    stale: (candidate.sessionVersion != null && candidate.sessionVersion !== session.version) || researchStale,
  }));
  return { session, jobs: planning.listJobs(session.id), candidates, pendingActors, summaries, researchStale };
}

function snapshotToResolvedActor(previous: ContentDocument['actors'][number], snapshot: ActorSnapshot): ContentDocument['actors'][number] {
  return {
    ...snapshot,
    // 阶段引用使用的是企划内的 actorId，解析后保持不变，避免阶段人物引用失效。
    id: previous.id,
    activityRole: previous.activityRole?.trim() || snapshot.activityRole,
    ...(previous.candidateRefId ? { candidateRefId: previous.candidateRefId } : {}),
    personaStatus: 'resolved',
  };
}

export interface PlanningActorResolveResult {
  session: ActivityPlanningSession;
  affectedStageIds: string[];
  resolvedCharacterId: string | null;
  createdCharacterId?: string;
  pendingActors: ActivityPlanningPendingActor[];
}

/**
 * 把企划内的待解析角色落成真实的本地角色快照。
 *
 * - match：复用已有角色；
 * - persona：把预览确认后的简版人设入库为新角色；
 * - remove：从企划中移除，并返回需要检查的阶段。
 */
export function resolvePlanningActor(
  options: PlanningServiceOptions,
  sessionId: string,
  actorId: string,
  input: ActivityPlanningActorResolveInput,
): PlanningActorResolveResult {
  const planning = new ActivityPlanningStore(options.database);
  const session = planning.getSession(sessionId);
  if (!session) throw badRequest('session_not_found', '企划会话不存在。');
  if (session.status === 'created') throw conflict('session_created', '该企划已经创建了活动，无法再修改。');
  const document: ContentDocument = JSON.parse(JSON.stringify(session.document));
  const index = document.actors.findIndex((actor) => actor.id === actorId);
  if (index === -1) throw badRequest('actor_not_found', '企划中不存在该角色。');
  const previous = document.actors[index];
  if (input.mode !== 'remove' && !isUnresolvedPlanningActor(previous)) return { session, affectedStageIds: [], resolvedCharacterId: previous.sourceCharacterId || null, pendingActors: [] };
  const context = loadResearchContext(options.database, session);
  // 待补角色通常只出现在方案输出里，影响范围要把所有方案的阶段一起算进来。
  const candidateStageRefs = collectCandidateStageRefs(planning.listCandidates(sessionId));
  const affectedStageIds = [...new Set([
    ...document.stages.filter((stage) => stage.actorIds.includes(actorId)).map((stage) => stage.id),
    ...(candidateStageRefs.get(actorId) ?? []),
  ])];
  const research = new ResearchStore(options.database);
  const candidateRefId = previous.candidateRefId ?? null;

  const finish = (resolvedCharacterId: string | null, createdCharacterId?: string): PlanningActorResolveResult => {
    planning.updateSessionDocument(session.id, document);
    return {
      session: planning.getSession(sessionId)!,
      affectedStageIds,
      resolvedCharacterId,
      ...(createdCharacterId ? { createdCharacterId } : {}),
      pendingActors: listPendingActors(document, context, candidateStageRefs),
    };
  };

  if (input.mode === 'remove') {
    document.actors.splice(index, 1);
    for (const stage of document.stages) {
      stage.actorIds = stage.actorIds.filter((id) => id !== actorId);
      stage.requiredBeats = stage.requiredBeats.map((beat) => ({ ...beat, actorIds: beat.actorIds.filter((id) => id !== actorId) }));
    }
    document.activity.birthdayActorIds = (document.activity.birthdayActorIds || []).filter((id) => id !== actorId);
    for (const conversation of document.conversations || []) {
      if (conversation.memberActorIds) conversation.memberActorIds = conversation.memberActorIds.filter((id) => id !== actorId);
    }
    // 候选状态跟着更新：否则重新生成方案时被移除的人又会作为占位角色回来。
    if (context.task && candidateRefId) research.setCandidateStatus(context.task.id, candidateRefId, 'excluded');
    if (candidateRefId?.startsWith('idea_')) {
      const selection = session.form.selection ?? { requiredCharacterIds: [], optionalCharacterIds: [], excludedCharacterIds: [], requiredLocationIds: [], optionalLocationIds: [], excludedLocationIds: [], lockedLocationId: null };
      planning.updateSession(session.id, session.version, { ...session.form, selection: { ...selection, excludedCharacterIds: [...new Set([...selection.excludedCharacterIds, candidateRefId])] } });
    }
    planning.updateSessionCharacters(session.id, session.characters.filter((item) => item.actorId !== actorId));
    return finish(null);
  }

  let snapshot: ActorSnapshot | null = null;
  let createdCharacterId: string | undefined;
  if (input.mode === 'match') {
    snapshot = createActorSnapshotFromCharacter(options.database, input.characterId, { activityRole: previous.activityRole?.trim() || undefined });
    if (!snapshot) throw badRequest('character_snapshot_not_found', '角色不存在或已被删除。');
  } else {
    const draft = toAuthorityDraft(draftFromPersona(input.persona, (input.displayName || previous.displayName).trim()));
    if (!draft.displayName) throw badRequest('display_name_required', '请填写角色名。');
    createdCharacterId = createLocalCharacter(options.database, draft, { sessionId, note: [input.sourceNote || '用户确认的企划人设草稿', draft.personaText || ''].filter(Boolean).join('\n').slice(0, 12000) });
    snapshot = createActorSnapshotFromCharacter(options.database, createdCharacterId, { activityRole: input.activityRole?.trim() || previous.activityRole?.trim() || undefined });
    if (!snapshot) throw badRequest('character_snapshot_not_found', '新角色已创建，但读取人设快照失败。');
  }
  const resolved = snapshot;
  document.actors[index] = snapshotToResolvedActor(previous, resolved);
  const ref: ActivityPlanningCharacterRef = {
    characterId: String(resolved.sourceCharacterId),
    displayName: resolved.displayName,
    sourceVersion: resolved.sourceVersion ?? null,
    sourceVersionStatus: resolved.sourceVersionStatus || 'draft',
    draftRevision: Number(resolved.characterDraftRevision ?? 1),
    actorId: previous.id,
    personaHash: hash(resolved.persona),
  };
  planning.updateSessionCharacters(session.id, [...session.characters.filter((item) => item.actorId !== previous.id), ref]);
  // 匹配人设不改变用户的必选/可选状态。
  return finish(ref.characterId, createdCharacterId);
}

/**
 * 缺少人设时的简版人设草稿：只使用已保存的研究资料与候选关系，不虚构未查到的设定。
 * 结果只用于预览确认，用户确认后才由 resolve(mode=persona) 入库。
 */
export function buildPlanningPersonaDraft(options: PlanningServiceOptions, sessionId: string, actorId: string): ActivityPlanningPersonaDraft {
  const planning = new ActivityPlanningStore(options.database);
  const session = planning.getSession(sessionId);
  if (!session) throw badRequest('session_not_found', '企划会话不存在。');
  const actor = session.document.actors.find((item) => item.id === actorId);
  if (!actor) throw badRequest('actor_not_found', '企划中不存在该角色。');
  if (!isUnresolvedPlanningActor(actor)) throw badRequest('actor_already_resolved', '该角色已经匹配到本地角色。');
  const context = loadResearchContext(options.database, session);
  const candidate = context.task?.characterCandidates.find((item) => item.id === actor.candidateRefId) ?? context.candidates.filter(item => item.id === actor.candidateRefId).map(item => ({ ...item, reason: item.relationshipToLead }))[0];
  const linkedEvidence = (context.task?.evidence ?? []).filter((item) => candidate?.evidenceIds.includes(item.id)).slice(0, 3);
  const hasEvidence = linkedEvidence.length > 0 && candidate?.basis !== 'creative';
  const lines: string[] = [`${actor.displayName}${candidate?.work ? `，来自《${candidate.work}》` : ''}。`];
  if (candidate?.relationshipToLead) {
    lines.push(candidate.basis === 'documented'
      ? `与主角的关系（资料依据）：${candidate.relationshipToLead}`
      : candidate.basis === 'inferred'
        ? `与主角的关系（根据资料推测）：${candidate.relationshipToLead}`
        : `参与方式（跨作品联动创作建议，不是原作关系）：${candidate.relationshipToLead}`);
  }
  if (linkedEvidence.length) {
    lines.push('已保存的资料摘录：', ...linkedEvidence.map((item) => `・${item.sourceName}（${item.documentLocator}）：${item.excerpt.slice(0, 160)}`));
  }
  lines.push(hasEvidence
    ? '以上内容来自已保存的资料；资料没有覆盖的性格、经历与喜好留空，请在保存前补充。'
    : '本次没有可引用的外部资料，以下内容属于创作建议；资料未覆盖的设定一律留空，不虚构未查到的原作设定。');
  const persona: ActorPersona = {
    schemaVersion: 2,
    displayName: actor.displayName,
    work: candidate?.work ?? '',
    originType: candidate?.work ? 'ip' : 'original',
    summary: candidate?.reason ?? '',
    personaText: lines.join('\n'),
    speechText: '',
    dialogueExamples: [],
    behaviorRules: '',
    appearance: { baseText: '', defaultOutfitText: '' },
  };
  return {
    actorId,
    displayName: actor.displayName,
    persona,
    basisNote: hasEvidence ? '依据已保存的资料摘录生成' : '仅依据企划输入与候选关系生成，未查证外部资料',
    evidenceIds: linkedEvidence.map((item) => item.id),
    hasEvidence,
  };
}

function mapFormTemplateRoles(form: ActivityPlanningFormExtended, document: ContentDocument) {
  if (!form.templateActorMappings) return undefined;
  return Object.fromEntries(Object.entries(form.templateActorMappings).map(([role,ids]) => [role,ids.map(id => {
    const actor = document.actors.find(actor => actor.sourceCharacterId === id || actor.id === id);
    if (!actor) throw badRequest('template_actor_missing', '模板职责中的角色已移除，请重新选择');
    return actor.id;
  })]));
}

export function createPlanningSession(options: PlanningServiceOptions, body: { form: unknown }) {
  const planning = new ActivityPlanningStore(options.database);
  const form = normalizeForm(body?.form);
  if (!form.characters.length) throw badRequest('characters_required', '请至少选择一位参与角色。');
  const { actors, refs } = freezeCharacters(options.database, form);
  const birthdayActorIds = refs.filter((ref) => form.birthdayCharacterIds.includes(ref.characterId)).map((ref) => ref.actorId);
  const document = buildActivityDocument({
    templateId: form.templateId,
    title: form.title || `${actors[0]?.displayName || '新的'}的活动`,
    type: form.type,
    theme: form.theme,
    location: form.location,
    rules: form.rules,
    actors,
    birthdayActorIds,
    scheduledDate: form.scheduledDate,
  });
  document.activity.creationProfile = form.creationProfile;
  applySavedActivityTemplate(options.database, document, form.templateId, undefined, mapFormTemplateRoles(form, document));
  const session = planning.createSession({ form, document, characters: refs });
  return buildSessionResponse(options.database, session);
}
/**
 * 采用话题点子：从素材库进入时新建会话，从新建活动向导进入时更新已有会话。
 *
 * 行为约定（计划 §3.4）：
 * - 复用已有主角与日期，不覆盖非空输入；只有显式 overrides 才替换标题与主题。
 * - 推荐人物只作为候选提示，不自动成为必选，也不立即创建公共角色。
 * - 初步阶段只作为企划生成参考，不写进正式阶段。
 * - 灵感来源快照同时写入表单与企划依据。
 */
export function applyIdeaToPlanningSession(
  options: PlanningServiceOptions,
  input: {
    batch: ActivityIdeaBatch;
    idea: ActivityIdea;
    snapshot: ActivityInspirationSnapshot;
    sessionId?: string;
    overrides: { title?: string; theme?: string; location?: string; instruction?: string };
  },
): { batchId: string; ideaId: string; sessionId: string; createdSession: boolean } {
  const planning = new ActivityPlanningStore(options.database);
  const prior = !input.sessionId ? options.database.connection.prepare("SELECT id FROM activity_planning_sessions WHERE json_extract(inspiration_json,'$.batchId')=? AND json_extract(inspiration_json,'$.ideaId')=? ORDER BY created_at LIMIT 1").get(input.batch.id, input.idea.id) as { id: string } | undefined : undefined;
  if (prior) return { batchId: input.batch.id, ideaId: input.idea.id, sessionId: prior.id, createdSession: false };
  const existing = input.sessionId ? planning.getSession(input.sessionId) : null;
  if (input.sessionId && !existing) throw badRequest('session_not_found', '企划会话不存在。');
  if (existing?.status === 'generating') throw conflict('session_generating', '请等待当前企划生成结束后再采用点子。');
  if (existing?.form.inspiration?.ideaId === input.idea.id && !Object.keys(input.overrides).length) return { batchId: input.batch.id, ideaId: input.idea.id, sessionId: existing.id, createdSession: false };
  if (existing && existing.status === 'created') {
    throw conflict('session_created', '该企划已经创建了活动，无法再应用点子。');
  }

  const base: ActivityPlanningFormExtended = existing ? existing.form : {
    templateId: 'blank',
    title: '',
    type: input.batch.activityType || '聚会',
    theme: '',
    location: '',
    rules: '',
    scheduledDate: null,
    // 从素材库进入时没有会话：用批次里选好的主角建立会话，否则无法创建企划。
    characters: input.batch.leadCharacterId ? [{ characterId: input.batch.leadCharacterId, activityRole: '主角' }] : [],
    birthdayCharacterIds: [],
    guestCountPreference: 6,
  };

  const suggestion = buildIdeaSuggestion(input.idea, input.snapshot);
  const overrides = input.overrides ?? {};
  // 空标题与空主题用点子填入；非空输入只在 overrides 里被明确替换。
  const nextForm: ActivityPlanningFormExtended = {
    ...base,
    title: overrides.title ?? (base.title || input.idea.name),
    theme: overrides.theme ?? (base.theme || input.idea.overview),
    location: overrides.location ?? (base.location || input.idea.location),
    instruction: overrides.instruction ?? [base.instruction?.split('【本次企划必须采用的灵感】')[0]?.trim(), suggestion].filter((value) => value && String(value).trim()).join('\n\n'),
    ...(input.batch.leadCharacterId ? { leadCharacterId: base.leadCharacterId || input.batch.leadCharacterId } : {}),
    inspiration: input.snapshot,
  };
  const form = normalizeForm(nextForm);

  if (existing) {
    // 已有会话：保住当前角色与文档，只更新表单与灵感来源。
    const updated = planning.updateSession(existing.id, existing.version, form);
    const document = JSON.parse(JSON.stringify(updated.document)) as ContentDocument;
    document.activity = {
      ...document.activity,
      title: form.title || document.activity.title,
      theme: form.theme || document.activity.theme,
      location: form.location || document.activity.location,
    };
    planning.updateSessionDocument(existing.id, document);
    return { batchId: input.batch.id, ideaId: input.idea.id, sessionId: existing.id, createdSession: false };
  }

  if (!form.characters.length) {
    const document = buildActivityDocument({ templateId: form.templateId, title: form.title, type: form.type, theme: form.theme, location: form.location, rules: form.rules, actors: [], birthdayActorIds: [], scheduledDate: form.scheduledDate });
    const session = planning.createSession({ form, document, characters: [] });
    return { batchId: input.batch.id, ideaId: input.idea.id, sessionId: session.id, createdSession: true };
  }
  const created = createPlanningSession(options, { form });
  return { batchId: input.batch.id, ideaId: input.idea.id, sessionId: created.session.id, createdSession: true };
}

/** 把点子整理成一段明确的企划要求，避免带入点子后又生成一份无关方案。 */
function buildIdeaSuggestion(idea: ActivityIdea, snapshot: ActivityInspirationSnapshot): string {
  const lines = [
    '【本次企划必须采用的灵感】' + idea.name,
    '点子概述：' + idea.overview,
    '对素材的改编方式：' + idea.adaptation,
  ];
  if (idea.style) lines.push('活动风格：' + idea.style);
  if (idea.stages.length) {
    lines.push('初步阶段构思（只作为参考方向，可以调整）：');
    for (const stage of idea.stages) lines.push('- ' + stage.title + '：' + stage.outline);
  }
  if (idea.recommendedCharacters.length) {
    lines.push('推荐人物（只是候选提示，是否加入由用户决定）：');
    for (const character of idea.recommendedCharacters) {
      lines.push('- ' + character.name + (character.work ? '（' + character.work + '）' : '') + '：' + character.reason + (character.relationshipNote ? '；' + character.relationshipNote : ''));
    }
  }
  if (idea.expectedHighlights.length) lines.push('预期可留下的桥段：' + idea.expectedHighlights.join('、'));
  if (idea.assumptions.length) lines.push('以下属于创作建议，素材未能证实：' + idea.assumptions.join('；'));
  if (snapshot.topics.length) {
    lines.push('灵感出处素材：');
    for (const topic of snapshot.topics) lines.push('- ' + topic.title + '：' + topic.summary);
  }
  return lines.join('\n');
}

export function registerPlanningRoutes(app: FastifyInstance, options: PlanningServiceOptions) {
  const planning = new ActivityPlanningStore(options.database);
  planning.recoverDanglingJobs();

  function checkAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
    if (options.config.adminToken && !authenticateAdmin(options.config.adminToken, request)) {
      reply.code(401).send({ error: 'unauthorized', message: '未授权的管理请求。' });
      return false;
    }
    return true;
  }

  const respond = (reply: FastifyReply, error: unknown) => {
    const status = (error as { statusCode?: number }).statusCode || 400;
    const code = (error as { code?: string }).code || 'planning_failed';
    const configurationPath = errorConfigurationPath(error);
    return reply.code(status).send({ error: code, message: (error as Error).message, ...(configurationPath ? { configurationPath } : {}) });
  };

  app.post<{ Body: { form: unknown } }>('/api/v1/admin/activity-planning-sessions', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    try { return reply.code(201).send(createPlanningSession(options, request.body || { form: {} })); }
    catch (error) { return respond(reply, error); }
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/activity-planning-sessions/:id', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const session = planning.getSession(request.params.id);
    if (!session) return reply.code(404).send({ error: 'session_not_found' });
    return buildSessionResponse(options.database, session);
  });

  app.put<{ Params: { id: string }; Body: { form?: unknown; expectedVersion?: number } }>('/api/v1/admin/activity-planning-sessions/:id', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    try {
      const session = planning.getSession(request.params.id);
      if (!session) return reply.code(404).send({ error: 'session_not_found' });
      const expectedVersion = Number(request.body?.expectedVersion ?? session.version);
      const form = normalizeForm(request.body?.form);
      // 先验证全部输入，失败时不留下半更新的会话。
      // 表单变化后重新冻结角色人设，保证生成依据与页面一致。
      const { actors, refs } = freezeCharacters(options.database, form);
      // 同一人物保留会话 actor ID，旧方案和局部重生成继续引用有效。
      for (const actor of actors) {
        const previous = session.document.actors.find(item => item.sourceCharacterId === actor.sourceCharacterId && !item.candidateRefId);
        if (!previous) continue;
        const ref = refs.find(item => item.actorId === actor.id);
        actor.id = previous.id;
        if (ref) ref.actorId = previous.id;
      }
      const birthdayActorIds = refs.filter((ref) => form.birthdayCharacterIds.includes(ref.characterId)).map((ref) => ref.actorId);
      const document = buildActivityDocument({
        templateId: form.templateId, title: form.title || session.document.activity.title, type: form.type, theme: form.theme,
        location: form.location, rules: form.rules, actors, birthdayActorIds, scheduledDate: form.scheduledDate,
      });
      document.activity.creationProfile = form.creationProfile;
      applySavedActivityTemplate(options.database, document, form.templateId, session.document, mapFormTemplateRoles(form, document));
      // 研究候选占位角色与已解析的联动角色不在 form.characters 里；表单改动后必须保住它们，
      // 否则阶段里的角色引用会指向不存在的人物。
      const excludedCandidates = new Set(form.selection?.excludedCharacterIds ?? []);
      const keptActorIds = new Set(document.actors.map((actor) => actor.id));
      const keptCharacterIds = new Set(document.actors.map((actor) => String(actor.sourceCharacterId || '')).filter(Boolean));
      for (const actor of session.document.actors) {
        if (actor.candidateRefId && !form.researchRevisionId) continue;
        if (!actor.candidateRefId && !actor.personaStatus) continue;
        if (actor.candidateRefId && excludedCandidates.has(actor.candidateRefId)) continue;
        if (keptActorIds.has(actor.id)) continue;
        if (actor.sourceCharacterId && keptCharacterIds.has(String(actor.sourceCharacterId))) continue;
        document.actors.push(actor);
      }
      const saved = options.database.transaction(() => {
        planning.updateSession(session.id, expectedVersion, form);
        const actorIds = new Set(document.actors.map(actor => actor.id));
        planning.updateSessionCharacters(session.id, [...refs, ...session.characters.filter(ref => actorIds.has(ref.actorId) && !refs.some(item => item.actorId === ref.actorId))]);
        options.database.connection.prepare('UPDATE activity_planning_sessions SET research_revision_id=? WHERE id=?').run(form.researchRevisionId || null, session.id);
        return planning.updateSessionDocument(session.id, document);
      });
      return buildSessionResponse(options.database, saved);
    } catch (error) { return respond(reply, error); }
  });

  app.delete<{ Params: { id: string } }>('/api/v1/admin/activity-planning-sessions/:id', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    return { ok: planning.deleteSession(request.params.id) };
  });

  app.post<{ Params: { id: string }; Body: { instruction?: string; idempotencyKey?: string; planCount?: number } }>('/api/v1/admin/activity-planning-sessions/:id/jobs', async (request, reply) => {
   if (!checkAdmin(request, reply)) return;
   try {
      const job = await runPlanningJob(options, request.params.id, { instruction: request.body?.instruction, idempotencyKey: request.body?.idempotencyKey, planCount: request.body?.planCount });
     return reply.code(202).send(job);
   } catch (error) { return respond(reply, error); }
 });

  app.get<{ Params: { id: string; jobId: string } }>('/api/v1/admin/activity-planning-sessions/:id/jobs/:jobId', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const job = planning.getJob(request.params.id, request.params.jobId);
    if (!job) return reply.code(404).send({ error: 'job_not_found' });
    const candidateIds = job.resultCandidateIds || [];
    const candidates = candidateIds.map((id) => planning.getCandidate(request.params.id, id)).filter(Boolean);
    return { job, candidates };
  });

  app.post<{ Params: { id: string; jobId: string } }>('/api/v1/admin/activity-planning-sessions/:id/jobs/:jobId/cancel', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const job = planning.getJob(request.params.id, request.params.jobId);
    if (!job) return reply.code(404).send({ error: 'job_not_found' });
    if (job.status === 'queued' || job.status === 'running') {
      planning.updateJob(job.id, { status: 'cancelled', errorMessage: '用户手动取消' });
      planning.setStatus(request.params.id, 'draft');
    }
    return planning.getJob(request.params.id, job.id);
  });

  app.post<{ Params: { id: string; jobId: string } }>('/api/v1/admin/activity-planning-sessions/:id/jobs/:jobId/retry', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const job = await retryPlanningJob(options, request.params.id, request.params.jobId);
    if (!job) return reply.code(404).send({ error: 'job_not_found' });
    return reply.code(202).send(job);
  });

  app.post<{ Params: { id: string }; Body: { document?: ContentDocument; candidateId?: string | null; idempotencyKey?: string | null } }>('/api/v1/admin/activity-planning-sessions/:id/create-activity', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    try {
      const result = createActivityFromSession(options, request.params.id, request.body || {});
      return reply.code(result.created ? 201 : 200).send(result);
    } catch (error) { return respond(reply, error); }
  });

  app.post<{ Params: { id: string; actorId: string }; Body: ActivityPlanningActorResolveInput }>('/api/v1/admin/activity-planning-sessions/:id/actors/:actorId/resolve', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const body = (request.body ?? {}) as { mode?: string };
    if (body.mode !== 'match' && body.mode !== 'persona' && body.mode !== 'remove') {
      return reply.code(400).send({ error: 'invalid_resolve_mode', message: '解析方式必须是 match、persona 或 remove。' });
    }
    if (body.mode === 'match' && !String((body as { characterId?: string }).characterId || '').trim()) {
      return reply.code(400).send({ error: 'character_id_required', message: '请选择要匹配的本地角色。' });
    }
    try {
      return resolvePlanningActor(options, request.params.id, request.params.actorId, request.body as ActivityPlanningActorResolveInput);
    } catch (error) { return respond(reply, error); }
  });

  app.post<{ Params: { id: string; actorId: string } }>('/api/v1/admin/activity-planning-sessions/:id/actors/:actorId/persona-draft', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    try {
      return buildPlanningPersonaDraft(options, request.params.id, request.params.actorId);
    } catch (error) { return respond(reply, error); }
  });
}

export { ActivityPlanningStore as PlanningStore };
