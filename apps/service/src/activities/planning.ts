import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  ActivityPlanningCandidate,
  ActivityPlanningCharacterRef,
  ActivityPlanningForm,
  ActivityPlanningJob,
  ActivityPlanningOutput,
  ActivityPlanningSession,
  ActivityPlanningSessionStatus,
  ActivityPlanningSessionResponse,
  ContentDocument,
} from '@sthstart/contracts';
import { buildActivityDocument } from '@sthstart/contracts';
import { authenticateAdmin } from '../access.js';
import type { ServiceConfig } from '../config.js';
import { nowIso, type ServiceDatabase } from '../database.js';
import { resolveAssignedLlmProfile } from '../providers.js';
import { errorConfigurationPath, llmNotReadyError, resolveAppLlmBindingStatus } from '../llm-status.js';
import type { SecretStore } from '../security.js';
import { createActorSnapshotFromCharacter } from './characters.js';
import { buildPlanningPrompt, parseAiJsonOutput } from './prompts.js';
import { callLlm } from './text-jobs.js';
import type { ActivityStore } from './store.js';
import { normalizeScheduledDate } from './schedule.js';

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

function normalizeForm(value: unknown): ActivityPlanningForm {
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

  createSession(input: { form: ActivityPlanningForm; document: ContentDocument; characters: ActivityPlanningCharacterRef[] }): ActivityPlanningSession {
    const id = crypto.randomUUID();
    const now = nowIso();
    this.connection.prepare(
      `INSERT INTO activity_planning_sessions(id,version,status,form_json,snapshot_json,document_json,activity_id,created_at,updated_at)
       VALUES (?,1,'draft',?,?,?,NULL,?,?)`
    ).run(id, JSON.stringify(input.form), JSON.stringify(input.characters), JSON.stringify(input.document), now, now);
    return this.getSession(id)!;
  }

  getSession(id: string): ActivityPlanningSession | null {
    const row = this.connection.prepare('SELECT * FROM activity_planning_sessions WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      version: Number(row.version),
      status: String(row.status) as ActivityPlanningSessionStatus,
      form: normalizeForm(JSON.parse(String(row.form_json || '{}'))),
      document: JSON.parse(String(row.document_json || '{}')) as ContentDocument,
      characters: JSON.parse(String(row.snapshot_json || '[]')) as ActivityPlanningCharacterRef[],
      activityId: row.activity_id ? String(row.activity_id) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  updateSession(id: string, expectedVersion: number, form: ActivityPlanningForm): ActivityPlanningSession {
    const session = this.getSession(id);
    if (!session) throw badRequest('session_not_found', '企划会话不存在。');
    if (session.status === 'created') throw conflict('session_created', '该企划已经创建了活动，无法再修改。');
    const now = nowIso();
    const result = this.connection.prepare(
      'UPDATE activity_planning_sessions SET version=version+1,form_json=?,updated_at=? WHERE id=? AND version=?'
    ).run(JSON.stringify(form), now, id, expectedVersion);
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

  createCandidate(input: { sessionId: string; sessionVersion: number; payload: ActivityPlanningOutput }): ActivityPlanningCandidate {
    const id = crypto.randomUUID();
    this.connection.prepare(
      "INSERT INTO activity_planning_candidates(id,session_id,session_version,payload_json,validation_json,adopted,created_at) VALUES (?,?,?,?,'{}',0,?)"
    ).run(id, input.sessionId, input.sessionVersion, JSON.stringify(input.payload), nowIso());
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

/** 企划输出只允许覆盖主题与阶段，日期、寿星与角色身份保持用户设定。 */
export function applyPlanningOutput(document: ContentDocument, output: ActivityPlanningOutput): ContentDocument {
  const updated: ContentDocument = JSON.parse(JSON.stringify(document));
  const roleByActor = new Map((output.actorRoles || []).map((role) => [role.actorId, role.activityRole]));
  updated.actors = updated.actors.map((actor) => roleByActor.has(actor.id) ? { ...actor, activityRole: roleByActor.get(actor.id)! } : actor);
  updated.activity = {
    ...updated.activity,
    title: output.activity.title?.trim() || updated.activity.title,
    theme: output.activity.theme ?? updated.activity.theme,
    location: output.activity.location ?? updated.activity.location,
    rules: output.activity.rules ?? updated.activity.rules,
    overview: output.activity.overview ?? updated.activity.overview,
  };
  const actorIds = new Set(updated.actors.map((actor) => actor.id));
  updated.stages = (output.stages || []).map((stage, index) => ({
    id: `stage_${index + 1}`,
    title: stage.title,
    order: index + 1,
    actorIds: (stage.actorIds || []).filter((id) => actorIds.has(id)),
    location: stage.location || updated.activity.location,
    instruction: stage.description,
    requiredBeats: (stage.requiredBeats || []).map((text, beatIndex) => ({ id: `beat_${index + 1}_${beatIndex + 1}`, text, actorIds: (stage.actorIds || []).filter((id) => actorIds.has(id)) })),
    locked: false,
    endCondition: stage.endCondition || '',
  }));
  // 寿星必须出现在至少一个阶段，否则企划不可用。
  const birthdayActorIds = updated.activity.birthdayActorIds || [];
  for (const id of birthdayActorIds) {
    if (!updated.stages.some((stage) => stage.actorIds.includes(id))) {
      const target = updated.stages.at(-1);
      if (target) { target.actorIds = [...target.actorIds, id]; target.requiredBeats.push({ id: `beat_${target.order}_birthday`, text: `为${updated.actors.find((actor) => actor.id === id)?.displayName || '寿星'}送上祝福`, actorIds: [id] }); }
    }
  }
  updated.conversations = [{ id: 'group_main', kind: 'group', title: updated.activity.title, memberActorIds: [...actorIds] }];
  return updated;
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

export interface PlanningServiceOptions {
  config: ServiceConfig;
  database: ServiceDatabase;
  secrets: SecretStore;
  store: ActivityStore;
  fetcher?: typeof fetch;
}

export async function runPlanningJob(options: PlanningServiceOptions, sessionId: string, input: { instruction?: string; idempotencyKey?: string }) {
  const { database, secrets, store } = options;
  const planning = new ActivityPlanningStore(database);
  const session = planning.getSession(sessionId);
  if (!session) throw badRequest('session_not_found', '企划会话不存在。');
  if (session.status === 'created') throw conflict('session_created', '该企划已经创建了活动。');
  if (!session.document.actors?.length) throw badRequest('characters_required', '请先选择参与角色。');

  // 创建任务前先做结构预检；未就绪时直接 409，不产生注定失败的排队任务。
  const bindingStatus = await resolveAppLlmBindingStatus(database, secrets, 'activities', 'text');
  if (!bindingStatus.ready) throw llmNotReadyError(bindingStatus);

  const instruction = input.instruction?.trim() || session.form.instruction || undefined;
  const requestHash = hash({ sessionId, version: session.version, documentHash: hash(session.document), instruction: instruction ?? null });
  const { job, isExisting } = planning.createJob({
    sessionId,
    requestHash,
    idempotencyKey: input.idempotencyKey,
    request: { document: session.document, instruction: instruction ?? null, sessionVersion: session.version },
  });
  if (isExisting) return job;

  planning.setStatus(sessionId, 'generating');
  setImmediate(async () => {
    try {
      planning.updateJob(job.id, { status: 'running' });
      // 执行前再次检查：排队期间模型配置可能已被修改。
      const status = await resolveAppLlmBindingStatus(database, secrets, 'activities', 'text');
      const profile = status.ready ? await resolveAssignedLlmProfile(database, secrets, 'activities', 'text') : null;
      if (!profile) throw llmNotReadyError(status);
      const prompt = buildPlanningPrompt(session.document, instruction);
      const response = await callLlm(profile, prompt, options.fetcher ?? fetch);
      const parsed = validatePlanningOutput(parseAiJsonOutput<unknown>(response), session.document);
      const candidate = planning.createCandidate({ sessionId, sessionVersion: session.version, payload: parsed });
      planning.updateJob(job.id, { status: 'succeeded', resultCandidateIds: [candidate.id], modelMetadata: { model: profile.model, profileId: profile.id } });
      planning.setStatus(sessionId, 'ready');
    } catch (error) {
      const message = (error as Error).message;
      planning.updateJob(job.id, { status: 'failed', errorMessage: message });
      planning.setStatus(sessionId, 'failed');
    }
  });
  return job;
}

export async function retryPlanningJob(options: PlanningServiceOptions, sessionId: string, jobId: string) {
  const planning = new ActivityPlanningStore(options.database);
  const job = planning.getJob(sessionId, jobId);
  if (!job) return null;
  const snapshot = planning.getJobRequest(jobId);
  if (!snapshot) {
    planning.updateJob(jobId, { status: 'failed', errorMessage: '该任务没有保存原始输入快照，无法原样重试。' });
    return planning.getJob(sessionId, jobId);
  }
  planning.updateJob(jobId, { status: 'queued', errorMessage: null });
  planning.setStatus(sessionId, 'generating');
  const document = snapshot.document as ContentDocument;
  const instruction = typeof snapshot.instruction === 'string' ? snapshot.instruction : undefined;
  const sessionVersion = Number(snapshot.sessionVersion || 1);
  setImmediate(async () => {
    try {
      planning.updateJob(jobId, { status: 'running' });
      const status = await resolveAppLlmBindingStatus(options.database, options.secrets, 'activities', 'text');
      const profile = status.ready ? await resolveAssignedLlmProfile(options.database, options.secrets, 'activities', 'text') : null;
      if (!profile) throw llmNotReadyError(status);
      const response = await callLlm(profile, buildPlanningPrompt(document, instruction), options.fetcher ?? fetch);
      const parsed = validatePlanningOutput(parseAiJsonOutput<unknown>(response), document);
      const candidate = planning.createCandidate({ sessionId, sessionVersion, payload: parsed });
      planning.updateJob(jobId, { status: 'succeeded', resultCandidateIds: [candidate.id], modelMetadata: { model: profile.model, profileId: profile.id } });
      planning.setStatus(sessionId, 'ready');
    } catch (error) {
      const message = (error as Error).message;
      planning.updateJob(jobId, { status: 'failed', errorMessage: message });
      planning.setStatus(sessionId, 'failed');
    }
  });
  return planning.getJob(sessionId, jobId);
}

/** 由企划会话创建正式活动：校验人设快照一致，并在事务内标记会话已创建。 */
export function createActivityFromSession(options: PlanningServiceOptions, sessionId: string, input: { document?: ContentDocument; idempotencyKey?: string | null }) {
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

  // 提交的角色必须与会话冻结的快照一致，避免客户端替换人设。
  const sessionActors = new Map(session.document.actors.map((actor) => [actor.id, actor]));
  if (document.actors.length !== session.document.actors.length) throw badRequest('actors_mismatch', '提交的角色与会话快照不一致。');
  for (const actor of document.actors) {
    const frozen = sessionActors.get(actor.id);
    if (!frozen) throw badRequest('actors_mismatch', '提交的角色与会话快照不一致。');
    if (hash(actor.persona) !== hash(frozen.persona) || actor.displayName !== frozen.displayName || actor.sourceCharacterId !== frozen.sourceCharacterId) {
      throw conflict('character_snapshot_changed', '角色人设与会话快照不一致，请重新读取角色。');
    }
  }
  const birthdayActorIds = document.activity.birthdayActorIds || [];
  for (const id of birthdayActorIds) {
    if (!sessionActors.has(id)) throw badRequest('birthday_actor_unknown', '寿星必须是本场活动内的角色。');
  }
  assertCharactersStable(options.database, session.characters);

  const created = options.database.transaction(() => {
    const activity = options.store.createActivity({
      title: document.activity.title.trim(),
      type: document.activity.type || '日常活动',
      theme: document.activity.theme || '',
      location: document.activity.location || '',
      rules: document.activity.rules || '',
      initialDocument: { ...document, activity: { ...document.activity, scheduledDate: normalizeScheduledDate(document.activity.scheduledDate) } },
      skipTransaction: true,
    });
    planning.markCreated(sessionId, activity.activity.id);
    return activity.activity;
  });
  return { activity: created, session: planning.getSession(sessionId)!, created: true };
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
  const session = planning.createSession({ form, document, characters: refs });
  return { session: session, jobs: [], candidates: [] } satisfies ActivityPlanningSessionResponse;
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
    return { session, jobs: planning.listJobs(session.id), candidates: planning.listCandidates(session.id) };
  });

  app.put<{ Params: { id: string }; Body: { form?: unknown; expectedVersion?: number } }>('/api/v1/admin/activity-planning-sessions/:id', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    try {
      const session = planning.getSession(request.params.id);
      if (!session) return reply.code(404).send({ error: 'session_not_found' });
      const expectedVersion = Number(request.body?.expectedVersion ?? session.version);
      const form = normalizeForm(request.body?.form);
      const updated = planning.updateSession(session.id, expectedVersion, form);
      // 表单变化后重新冻结角色人设，保证生成依据与页面一致。
      const { actors, refs } = freezeCharacters(options.database, form);
      const birthdayActorIds = refs.filter((ref) => form.birthdayCharacterIds.includes(ref.characterId)).map((ref) => ref.actorId);
      const document = buildActivityDocument({
        templateId: form.templateId, title: form.title || updated.document.activity.title, type: form.type, theme: form.theme,
        location: form.location, rules: form.rules, actors, birthdayActorIds, scheduledDate: form.scheduledDate,
      });
      const saved = planning.updateSessionDocument(session.id, document);
      return { session: saved, jobs: planning.listJobs(session.id), candidates: planning.listCandidates(session.id) };
    } catch (error) { return respond(reply, error); }
  });

  app.delete<{ Params: { id: string } }>('/api/v1/admin/activity-planning-sessions/:id', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    return { ok: planning.deleteSession(request.params.id) };
  });

  app.post<{ Params: { id: string }; Body: { instruction?: string; idempotencyKey?: string } }>('/api/v1/admin/activity-planning-sessions/:id/jobs', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    try {
      const job = await runPlanningJob(options, request.params.id, { instruction: request.body?.instruction, idempotencyKey: request.body?.idempotencyKey });
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
    if (job.status !== 'succeeded' && job.status !== 'failed' && job.status !== 'cancelled') planning.updateJob(job.id, { status: 'cancelled', errorMessage: '用户手动取消' });
    planning.setStatus(request.params.id, 'draft');
    return planning.getJob(request.params.id, job.id);
  });

  app.post<{ Params: { id: string; jobId: string } }>('/api/v1/admin/activity-planning-sessions/:id/jobs/:jobId/retry', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const job = await retryPlanningJob(options, request.params.id, request.params.jobId);
    if (!job) return reply.code(404).send({ error: 'job_not_found' });
    return reply.code(202).send(job);
  });

  app.post<{ Params: { id: string }; Body: { document?: ContentDocument; idempotencyKey?: string | null } }>('/api/v1/admin/activity-planning-sessions/:id/create-activity', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    try {
      const result = createActivityFromSession(options, request.params.id, request.body || {});
      return reply.code(result.created ? 201 : 200).send(result);
    } catch (error) { return respond(reply, error); }
  });
}

export { ActivityPlanningStore as PlanningStore };
