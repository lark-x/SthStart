import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Value } from '@sinclair/typebox/value';
import type { TSchema } from '@sinclair/typebox';
import { StartWorldRunSchema, WorldRunSettingsSchema, type StartWorldRun, type WorldBranch, type WorldDefinition, type WorldEvent, type WorldRun, type WorldRunSettings } from '@sthstart/contracts';
import { ResolveWorldRunCallSchema, type ResolveWorldRunCall, type WorldRunRecoveryList, type WorldRunRecoveryResult } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import type { ServiceConfig } from '../config.js';
import type { SecretStore } from '../security.js';
import { StoryWorldStore } from './store.js';
import { WORLD_NARRATION_TASK, WORLD_NARRATION_REVIEW_TASK, narrationCorrectionIssues } from './narration.js';
import { WorldHistoryCache } from './memory-cache.js';
import { WorldMemorySummaries } from './runtime.memory.js';
import { WorldRoutinePlans, RoutineIntentSchema, RoutineAdjudicationSchema, stripRoutineAdjudication, validateRoutineIntent, validatePlanOutcomes,
  type RoutineIntent, type RoutineAdjudication } from './runtime.simulation.js';
import { appendAiCallEvent, createAiCallRecord, redactAiValue, updateAiCallRecord } from '../ai-call-trace.js';
import { PublicWorldModelAdapter, type WorldModelAdapter, type WorldModelPurpose, type WorldModelRequest } from './model.js';
import { WorldAdjudicationSchema, WorldIntentSchema, WorldNarrationSchema, WorldReviewSchema, WORLD_SIMULATION_SYSTEM, WORLD_ADJUDICATION_TASK,
  materializeWorldAdjudication, parseWorldOutput, personalContext, validateWorldIntent, validateWorldNarration, worldModelSnapshot,
  type WorldAdjudication, type WorldIntent, type WorldNarration, type WorldReview, type WorldSimulationResult, type WorldSimulationSnapshot } from './simulation.js';

type Models = WorldDefinition['models'];
interface StepRow { id: string; run_id: string; status: string; branch_revision: number; snapshot_json: string; result_json: string | null; lease_owner: string | null; lease_until: number }
interface CallRow { id: string; status: string; request_json: string; response_text: string | null; error: string }
interface NotificationRow { id: string; run_id: string; result_json: string }
const notificationLeaseMs = 60000;
const notificationBatchSize = 32;
// Select only callback payloads, never the much larger snapshot_json.
export const WORLD_RUNTIME_PENDING_NOTIFICATIONS_SQL = "SELECT id,run_id,result_json FROM sw_run_steps WHERE status='committed' AND result_json IS NOT NULL AND lease_until<=? ORDER BY lease_until,created_at,id LIMIT ?";
export interface WorldAfterStep { worldId: string; branchId: string; runId: string; eventIds: string[]; run: WorldRun; events: WorldEvent[] }
export interface StoryWorldRuntimeOptions {
  database: ServiceDatabase; config: ServiceConfig; secrets: SecretStore; fetcher?: typeof fetch; store: StoryWorldStore;
  modelAdapter?: WorldModelAdapter; afterStep?: (step: WorldAfterStep) => void | Promise<void>;
  onError?: (error: unknown) => void; schedulerIntervalMs?: number;
}
class Halt extends Error { constructor(readonly status: 'paused' | 'uncertain', message: string) { super(message); } }
const error = (code: string, message: string, statusCode = 409) => Object.assign(new Error(message), { code, statusCode });
const now = () => new Date().toISOString();

/** Server-owned durable simulation. Constructor is inert; the host owns migrations. */
export class StoryWorldRuntime {
  private readonly adapter: WorldModelAdapter;
  private readonly owner = randomUUID();
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private readonly active = new Map<string, Promise<WorldRun>>();
  private readonly notifying = new Map<string, Promise<void>>();
  private readonly notificationChains = new Map<string, Promise<void>>();
  private pumping?: Promise<void>;
  private readonly history: WorldHistoryCache;
  private readonly routines?: WorldRoutinePlans;
  private readonly summaries?: WorldMemorySummaries;
  constructor(readonly options: StoryWorldRuntimeOptions) {
    if (options.store.database !== options.database) throw new Error('story_runtime_store_database_mismatch');
    this.adapter = options.modelAdapter ?? new PublicWorldModelAdapter(options);
    this.history = new WorldHistoryCache(options.database);
    // Host-owned migration 57 enables durable reuse. Existing 55/56 databases
    // keep the original execution path until their explicit schema upgrade.
    if (options.database.connection.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='sw_step_intents'").get()) {
      this.routines = new WorldRoutinePlans(options.database); this.summaries = new WorldMemorySummaries(options.database);
    }
  }
  private get db() { return this.options.database.connection; }
  private atomic<T>(fn: () => T): T {
    if (!this.db.isTransaction) return this.options.database.transaction(fn);
    const name = 'sw_runtime_' + randomUUID().replaceAll('-', '');
    this.db.exec('SAVEPOINT ' + name);
    try { const result = fn(); this.db.exec('RELEASE ' + name); return result; }
    catch (e) { this.db.exec('ROLLBACK TO ' + name); this.db.exec('RELEASE ' + name); throw e; }
  }
  getRun(worldId: string, branchId: string, runId: string): WorldRun {
    this.options.store.getBranch(worldId, branchId);
    const row = this.db.prepare('SELECT data_json FROM sw_runs WHERE id=? AND world_id=? AND branch_id=?').get(runId, worldId, branchId) as { data_json: string } | undefined;
    if (!row) throw error('story_run_not_found', '运行记录不存在。', 404);
    return JSON.parse(row.data_json) as WorldRun;
  }
  /** Actual profile IDs selected by preflight and fixed for the entire run. */
  effectiveModels(runId: string): Models {
    const row = this.db.prepare("SELECT snapshot_json FROM sw_run_steps WHERE run_id=? AND step_key='configuration'").get(runId) as { snapshot_json: string } | undefined;
    if (!row) throw error('story_run_configuration_missing', '运行缺少模型快照。');
    return (JSON.parse(row.snapshot_json) as { models: Models }).models;
  }
  private saveRun(run: WorldRun) {
    const row = this.db.prepare('SELECT data_json FROM sw_runs WHERE id=?').get(run.id) as { data_json: string } | undefined;
    if (row) {
      const latest = JSON.parse(row.data_json) as WorldRun;
      run = { ...run, imagesSubmitted: Math.max(latest.imagesSubmitted, run.imagesSubmitted), textCallsUsed: Math.max(latest.textCallsUsed, run.textCallsUsed) };
    }
    this.db.prepare('UPDATE sw_runs SET status=?,data_json=?,updated_at=? WHERE id=?').run(run.status, JSON.stringify(run), run.updatedAt, run.id);
  }
  private revise(branch: WorldBranch, expectedRevision: number) {
    if (branch.revision !== expectedRevision) throw error('story_branch_revision_conflict', '分支已更新，请刷新后重试。');
    const next = { ...branch, revision: branch.revision + 1, updatedAt: now() };
    const result = this.db.prepare('UPDATE sw_branches SET revision=?,data_json=?,updated_at=? WHERE id=? AND revision=?').run(next.revision, JSON.stringify(next), next.updatedAt, branch.id, expectedRevision);
    if (result.changes !== 1) throw error('story_branch_revision_conflict', '分支已更新，请刷新后重试。');
    return next;
  }
  async start(worldId: string, branchId: string, request: StartWorldRun): Promise<WorldRun> {
    if (!Value.Check(StartWorldRunSchema, request)) throw error('story_run_invalid', '运行参数不符合契约。', 400);
    this.validateSettings(request.settings);
    const branch = this.options.store.getBranch(worldId, branchId);
    const replay = this.db.prepare('SELECT id FROM sw_runs WHERE world_id=? AND branch_id=? AND idempotency_key=?').get(worldId, branchId, request.idempotencyKey) as { id: string } | undefined;
    if (replay) return this.replayStart(worldId, branchId, replay.id, request);
    if (branch.revision !== request.expectedRevision) throw error('story_branch_revision_conflict', '分支版本已更新。');
    const definition = this.options.store.definition(worldId, branchId);
    const runId = randomUUID();
    const models = { ...definition.models };
    for (const purpose of ['action', 'adjudication', 'narration'] as const) {
      const preflight = this.request(runId, 'configuration', worldId, branchId, purpose, purpose, models[purpose], {});
      if (this.adapter.prepare) {
        try { models[purpose] = (await this.adapter.prepare(preflight)).profileId; }
        catch { throw error('story_model_configuration_invalid', '故事世界的 ' + purpose + ' 用途尚未就绪，请检查模型、连接、能力标签及应用启用状态。'); }
      }
    }
    return this.atomic(() => {
      const duplicate = this.db.prepare('SELECT id FROM sw_runs WHERE branch_id=? AND idempotency_key=?').get(branchId, request.idempotencyKey) as { id: string } | undefined;
      if (duplicate) return this.replayStart(worldId, branchId, duplicate.id, request);
      const current = this.options.store.getBranch(worldId, branchId);
      if (current.revision !== request.expectedRevision) throw error('story_branch_revision_conflict', '模型预检期间分支发生了修改。');
      if (this.db.prepare("SELECT id FROM sw_runs WHERE branch_id=? AND status IN ('queued','running','paused','uncertain')").get(branchId)) throw error('story_branch_run_active', '本分支已有运行，请恢复该运行。');
      const timestamp = now();
      const run: WorldRun = { id: runId, worldId, branchId, status: 'queued', settings: structuredClone(request.settings),
        startTick: current.currentTick, targetTick: current.currentTick + request.settings.durationTicks, completedTick: current.currentTick,
        textCallsUsed: 0, imagesSubmitted: 0, pauseReason: '', createdAt: timestamp, updatedAt: timestamp };
      this.db.prepare('INSERT INTO sw_runs(id,world_id,branch_id,status,data_json,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(run.id, worldId, branchId, run.status, JSON.stringify(run), request.idempotencyKey, timestamp, timestamp);
      this.db.prepare("INSERT INTO sw_run_steps(id,run_id,step_key,from_tick,to_tick,branch_revision,status,snapshot_json,created_at,updated_at) VALUES (?,?,?,?,?,?,'committed',?,?,?)")
        .run(randomUUID(), run.id, 'configuration', run.startTick, run.startTick, current.revision, JSON.stringify({ models, settings: request.settings }), timestamp, timestamp);
      this.revise(current, request.expectedRevision);
      return run;
    });
  }
  private replayStart(worldId: string, branchId: string, runId: string, request: StartWorldRun) {
    const run = this.getRun(worldId, branchId, runId);
    const row = this.db.prepare("SELECT snapshot_json FROM sw_run_steps WHERE run_id=? AND step_key='configuration'").get(runId) as { snapshot_json: string };
    const original = (JSON.parse(row.snapshot_json) as { settings: WorldRunSettings }).settings;
    if (!isDeepStrictEqual(original, request.settings)) throw error('story_run_idempotency_conflict', '幂等键已用于不同运行参数。');
    return run;
  }
  pause(worldId: string, branchId: string, runId: string, expectedRevision: number): WorldRun {
    return this.atomic(() => {
      const branch = this.options.store.getBranch(worldId, branchId);
      const run = this.getRun(worldId, branchId, runId);
      this.revise(branch, expectedRevision);
      if (run.status === 'completed' || run.status === 'failed') throw error('story_run_terminal', '运行已结束。');
      // Submitted completions are allowed to finish durably. No next dispatch/commit.
      const paused = { ...run, status: run.status === 'uncertain' ? 'uncertain' as const : 'paused' as const, pauseReason: '用户暂停。', updatedAt: now() };
      this.saveRun(paused); return paused;
    });
  }
  async resume(worldId: string, branchId: string, runId: string, expectedRevision: number, settings?: WorldRunSettings): Promise<WorldRun> {
    if (settings && !Value.Check(WorldRunSettingsSchema, settings)) throw error('story_run_settings_invalid', '恢复设置不符合契约。', 400);
    this.validateSettings(settings ?? this.getRun(worldId, branchId, runId).settings);
    if (this.active.has(runId) || this.db.prepare("SELECT id FROM sw_run_steps WHERE run_id=? AND status='pending' AND lease_owner IS NOT NULL AND lease_until>?").get(runId, Date.now())) throw error('story_run_in_flight', '正在保存暂停前的调用，请稍后恢复。');
    await this.reconcileRun(worldId, branchId, runId);
    // A failed status alone is not permission to retry: old audits may describe
    // transport failures. Recheck positive evidence before this explicit resume
    // authorizes another dispatch. Unknown calls still require manual recovery.
    const rejected = this.db.prepare("SELECT c.* FROM sw_run_calls c JOIN sw_run_steps s ON s.id=c.step_id WHERE s.run_id=? AND s.status='pending' AND c.status='failed'").all(runId) as unknown as Array<CallRow & { step_id: string; stage_key: string; attempt: number }>;
    for (const call of rejected) {
      const request = JSON.parse(call.request_json) as WorldModelRequest;
      const notDispatched = call.response_text === null && call.error === '模型配置在派发前失效；未发送上游请求。';
      if (!notDispatched && (await this.adapter.reconcile?.(request))?.status !== 'failed') {
        throw error('story_run_call_uncertain', '失败调用缺少明确拒绝或未执行依据，必须先核对，禁止重新提交。');
      }
    }
    return this.atomic(() => {
      const branch = this.options.store.getBranch(worldId, branchId);
      let run = this.getRun(worldId, branchId, runId);
      if (branch.revision !== expectedRevision) throw error('story_branch_revision_conflict', '分支版本已更新。');
      if (!['paused', 'uncertain'].includes(run.status)) throw error('story_run_not_paused', '只能恢复已暂停的运行。');
      if (this.active.has(runId)) throw error('story_run_in_flight', '正在保存暂停前的调用结果，请稍后恢复。');
      if (this.db.prepare("SELECT id FROM sw_run_steps WHERE run_id=? AND status='pending' AND lease_owner IS NOT NULL AND lease_until>?").get(runId, Date.now())) throw error('story_run_in_flight', '其他服务实例正在保存此运行，请稍后恢复。');
      if (this.db.prepare("SELECT c.id FROM sw_run_calls c JOIN sw_run_steps s ON s.id=c.step_id WHERE s.run_id=? AND c.status IN ('submitting','uncertain')").get(runId)) throw error('story_run_call_uncertain', '上游调用结果仍不明确，禁止重新提交。');
      if (settings) {
        if (settings.maxTextCalls < run.textCallsUsed || settings.maxImages < run.imagesSubmitted || run.startTick + settings.durationTicks < run.targetTick) throw error('story_run_budget_invalid', '新额度不能小于已用量，目标时刻只能延长。', 400);
        run = { ...run, settings: structuredClone(settings), targetTick: run.startTick + settings.durationTicks };
      }
      if (run.textCallsUsed >= run.settings.maxTextCalls) throw error('story_run_budget_exhausted', '继续运行需要显式增加文本调用额度。');
      if (this.db.prepare("SELECT id FROM sw_run_steps WHERE run_id=? AND status='invalid' LIMIT 1").get(runId)) throw error('story_run_validation_failed', '本步已用完一次修正，不能通过恢复无限重试。');
      // Rebase only when the story inputs are identical; otherwise discard the old
      // uncommitted step and regenerate under the still-counted remaining budget.
      for (const step of this.db.prepare("SELECT * FROM sw_run_steps WHERE run_id=? AND status='pending'").all(runId) as unknown as StepRow[]) {
        const snapshot = JSON.parse(step.snapshot_json) as WorldSimulationSnapshot;
        const current = this.snapshot(worldId, branchId, snapshot.toTick, this.effectiveModels(runId));
        if (!this.sameInputs(snapshot, current)) {
          this.db.prepare("UPDATE sw_run_steps SET status='discarded',updated_at=? WHERE id=?").run(now(), step.id);
          this.routines?.invalidateStep(step.id, 'step-inputs-changed');
        } else {
          snapshot.branch = { ...branch, revision: branch.revision + 1 };
          this.db.prepare('UPDATE sw_run_steps SET branch_revision=?,snapshot_json=? WHERE id=?').run(branch.revision + 1, JSON.stringify(snapshot), step.id);
        }
      }
      for (const call of rejected) {
        const current = this.db.prepare("SELECT c.* FROM sw_run_calls c JOIN sw_run_steps s ON s.id=c.step_id WHERE c.id=? AND s.status='pending'").get(call.id) as unknown as typeof call | undefined;
        if (!current) continue; // Changed story inputs discarded this step.
        if (!isDeepStrictEqual(current, call)) throw error('story_run_in_flight', '恢复期间调用记录已变化，请重新核对。');
        const upstream = this.db.prepare('SELECT id FROM ai_call_records WHERE trace_id=? ORDER BY requested_at DESC,rowid DESC LIMIT 1').get(call.id) as { id: string } | undefined;
        // The call identity and correction attempt stay fixed. Preserve the
        // complete previous failure in a separate append-only authorization
        // audit before the live call row is reused, as with manual recovery.
        const auditId = createAiCallRecord(this.options.database, { applicationId: 'story-worlds', feature: 'run-recovery', callType: 'retry-authorization',
          businessEvent: 'story-worlds.call.rejection-retry-authorized', traceId: call.id + ':resume:' + randomUUID(), objectType: 'world-run', objectId: runId,
          retryOf: upstream?.id ?? null, requestSnapshot: JSON.parse(call.request_json),
          parameters: { callId: call.id, stepId: call.step_id, stage: call.stage_key, attempt: call.attempt, expectedRevision,
            textCallsUsed: run.textCallsUsed, failure: call, upstreamAiCallId: upstream?.id ?? null } });
        updateAiCallRecord(this.options.database, auditId, { status: 'succeeded', event: 'explicit_resume_retry_authorized' });
        if (upstream) appendAiCallEvent(this.options.database, upstream.id, 'explicit_resume_retry_authorized', { authorizationAuditId: auditId });
        this.db.prepare("UPDATE sw_run_calls SET status='confirmed-not-executed',error=?,updated_at=? WHERE id=? AND status='failed'")
          .run('显式恢复已授权明确拒绝调用的重试；原失败审计 ' + auditId, now(), call.id);
      }
      this.revise(branch, expectedRevision);
      const resumed: WorldRun = { ...run, status: 'queued', pauseReason: '', updatedAt: now() }; this.saveRun(resumed); return resumed;
    });
  }
  cancel(worldId: string, branchId: string, runId: string, expectedRevision: number): WorldRun {
    return this.atomic(() => {
      const run = this.getRun(worldId, branchId, runId);
      if (this.active.has(runId)) throw error('story_run_in_flight', '请先暂停并等待在途调用保存后再结束运行。');
      if (this.db.prepare("SELECT id FROM sw_run_steps WHERE run_id=? AND status='pending' AND lease_owner IS NOT NULL AND lease_until>?").get(runId, Date.now())) throw error('story_run_in_flight', '其他服务实例正在保存此运行，请稍后结束。');
      if (run.status === 'uncertain' || this.db.prepare("SELECT c.id FROM sw_run_calls c JOIN sw_run_steps s ON s.id=c.step_id WHERE s.run_id=? AND c.status IN ('submitting','uncertain')").get(runId)) throw error('story_run_call_uncertain', '调用结果尚未核对，不能释放分支并发起替代请求。');
      if (run.status === 'completed' || run.status === 'failed') throw error('story_run_terminal', '运行已结束。');
      this.revise(this.options.store.getBranch(worldId, branchId), expectedRevision);
      const cancelled: WorldRun = { ...run, status: 'failed', pauseReason: '用户结束运行，未提交步骤已保留供审计。', updatedAt: now() };
      this.saveRun(cancelled); return cancelled;
    });
  }
  recovery(worldId: string, branchId: string, runId: string): WorldRunRecoveryList {
    this.getRun(worldId, branchId, runId);
    const rows = this.db.prepare("SELECT c.* FROM sw_run_calls c JOIN sw_run_steps s ON s.id=c.step_id WHERE s.run_id=? AND c.status IN ('submitting','uncertain') ORDER BY c.created_at,c.id").all(runId) as Array<{
      id: string; step_id: string; stage_key: string; purpose: string; attempt: number; status: 'submitting' | 'uncertain';
      created_at: string; updated_at: string; ai_call_id: string | null;
    }>;
    return { items: rows.map((row) => ({ id: row.id, stepId: row.step_id, stage: row.stage_key, purpose: row.purpose,
      attempt: row.attempt, status: row.status, requestedAt: row.created_at, updatedAt: row.updated_at,
      error: '模型调用结果不明。请核对供应商记录或已经收到的原始响应。',
      aiCallId: row.ai_call_id ?? (this.db.prepare('SELECT id FROM ai_call_records WHERE trace_id=? ORDER BY requested_at DESC LIMIT 1').get(row.id) as { id: string } | undefined)?.id ?? null })) };
  }
  resolveCall(worldId: string, branchId: string, runId: string, callId: string, input: ResolveWorldRunCall): WorldRunRecoveryResult {
    if (!Value.Check(ResolveWorldRunCallSchema, input) || !input.evidence.trim()) throw error('story_recovery_invalid', '核对结果和核对依据不能为空。', 400);
    if (input.resolution === 'not-executed' && input.responseText !== undefined) throw error('story_recovery_invalid', '确认未执行时不能同时提供结果。', 400);
    if (input.resolution === 'received-result' && !input.responseText) throw error('story_recovery_result_required', '请提供上游实际返回的原始结果。', 400);
    return this.atomic(() => {
      const run = this.getRun(worldId, branchId, runId);
      const branch = this.options.store.getBranch(worldId, branchId);
      if (branch.revision !== input.expectedRevision) throw error('story_branch_revision_conflict', '分支版本已更新。');
      if (!['paused', 'uncertain'].includes(run.status)) throw error('story_recovery_run_not_paused', '请先暂停运行再人工核对。');
      if (this.active.has(runId) || this.db.prepare("SELECT id FROM sw_run_steps WHERE run_id=? AND status='pending' AND lease_owner IS NOT NULL AND lease_until>?").get(runId, Date.now())) throw error('story_run_in_flight', '服务实例仍在等待这个调用，请等待其结束后核对。');
      const call = this.db.prepare('SELECT c.* FROM sw_run_calls c JOIN sw_run_steps s ON s.id=c.step_id WHERE c.id=? AND s.run_id=?').get(callId, runId) as unknown as CallRow & { stage_key: string } | undefined;
      if (!call) throw error('story_run_call_not_found', '此运行中不存在该调用。', 404);
      if (!['submitting', 'uncertain'].includes(call.status)) throw error('story_run_call_already_resolved', '调用已有核对结果，不能再次覆盖。');
      if (input.resolution === 'not-executed' && this.db.prepare("SELECT id FROM ai_call_records WHERE trace_id=? AND status='succeeded' LIMIT 1").get(callId)) {
        throw error('story_recovery_evidence_conflict', '本地审计已记录上游成功结果，不能确认未执行；请核对并恢复原结果。');
      }
      const stage = call.stage_key;
      if (input.resolution === 'received-result') {
        // Cheap shape validation now; all semantic/store/review checks run through
        // the original durable stage on resume, never by directly committing text.
        const schema = stage.startsWith('action:') ? (this.routines ? RoutineIntentSchema : WorldIntentSchema) : stage === 'adjudication' ? (this.routines ? RoutineAdjudicationSchema : WorldAdjudicationSchema)
          : stage.startsWith('narration:') ? WorldNarrationSchema : WorldReviewSchema;
        try {
          const value = parseWorldOutput(schema, input.responseText!);
          const request = JSON.parse(call.request_json) as WorldModelRequest;
          const saved = this.db.prepare('SELECT snapshot_json FROM sw_run_steps WHERE id=?').get(request.stepId) as { snapshot_json: string };
          const snapshot = JSON.parse(saved.snapshot_json) as WorldSimulationSnapshot;
          if (stage.startsWith('action:')) validateRoutineIntent(value as RoutineIntent, snapshot, stage.slice('action:'.length));
          if (stage === 'adjudication') {
            const intentions = this.db.prepare("SELECT response_text FROM sw_run_calls WHERE step_id=? AND stage_key LIKE 'action:%' AND status='succeeded' ORDER BY stage_key,attempt").all(request.stepId) as { response_text: string }[];
            const intentMap = new Map<string, WorldIntent>();
            for (const row of intentions) { const { plan: _plan, ...intent } = parseWorldOutput<RoutineIntent>(RoutineIntentSchema, row.response_text); intentMap.set(intent.actorId, intent); }
            if (this.routines) {
              for (const row of this.db.prepare('SELECT data_json FROM sw_step_intents WHERE step_id=?').all(request.stepId) as { data_json: string }[]) {
                const intent = (JSON.parse(row.data_json) as { intent: WorldIntent }).intent; intentMap.set(intent.actorId, intent);
              }
              validatePlanOutcomes(value as RoutineAdjudication, [...intentMap.values()]);
            }
            const result = materializeWorldAdjudication(stripRoutineAdjudication(value as RoutineAdjudication), snapshot, [...intentMap.values()], request.stepId);
            this.validateStep(result, snapshot);
          }
          if (stage.startsWith('narration:')) {
            const actorId = stage.slice('narration:'.length);
            const source = request.input as { events: Array<{ id: string; facts: WorldEvent['facts'] }> };
            const passages = (value as WorldNarration).passages;
            if (new Set(passages.map((p) => p.eventId)).size !== passages.length || source.events.some((e) => !passages.some((p) => p.eventId === e.id))
              || passages.some((p) => p.actorId !== actorId || !source.events.some((e) => e.id === p.eventId && p.factIds.every((id) => e.facts.some((f) => f.id === id && f.knownBy.includes(actorId)))))) throw new Error('invalid narrator facts');
          }
        }
        catch { throw error('story_recovery_result_invalid', '收到的原结果不符合该调用阶段的结构、人物、事实或时空约束。', 400); }
      }
      const auditId = createAiCallRecord(this.options.database, { applicationId: 'story-worlds', feature: 'run-recovery', callType: 'manual-reconciliation',
        businessEvent: 'story-worlds.call.manually-reconciled', traceId: callId + ':recovery:' + randomUUID(), objectType: 'world-run', objectId: runId,
        parameters: { callId, stage, resolution: input.resolution, evidence: input.evidence, expectedRevision: input.expectedRevision } });
      updateAiCallRecord(this.options.database, auditId, { status: 'succeeded', event: 'manual_reconciliation_recorded', responseText: input.responseText ?? null });
      const upstream = this.db.prepare('SELECT id FROM ai_call_records WHERE trace_id=? ORDER BY requested_at DESC LIMIT 1').get(callId) as { id: string } | undefined;
      if (upstream) appendAiCallEvent(this.options.database, upstream.id, 'manual_reconciliation_recorded', { resolution: input.resolution, recoveryAuditId: auditId });
      this.db.prepare('UPDATE sw_run_calls SET status=?,response_text=?,error=?,updated_at=? WHERE id=?')
        .run(input.resolution === 'received-result' ? 'succeeded' : 'confirmed-not-executed',
          input.responseText === undefined ? null : String(redactAiValue(input.responseText)),
          '管理员人工核对；审计记录 ' + auditId, now(), callId);
      const revision = this.revise(branch, input.expectedRevision).revision;
      this.saveRun({ ...run, status: 'paused', pauseReason: '人工核对已记录。请显式恢复运行；提供的结果仍需原步骤完整校验。', updatedAt: now() });
      return { callId, status: input.resolution === 'received-result' ? 'received-result' : 'confirmed-not-executed',
        validation: input.resolution === 'received-result' ? 'validated-on-resume' : 'not-applicable', branchRevision: revision };
    });
  }
  private snapshot(worldId: string, branchId: string, toTick: number, models: Models): WorldSimulationSnapshot {
    const detail = this.options.store.detail(worldId, branchId);
    const history = this.history.read(worldId, branchId, detail.branch.currentTick);
    return { worldId, branch: detail.branch, definition: { ...detail.definition, models }, states: detail.states,
      ...history,
      interventions: detail.interventions.filter((i) => (!i.consumed || i.kind === 'constraint') && i.tick <= toTick), storyLines: detail.storyLines, toTick };
  }
  historyCacheStats() { return this.history.stats(); }
  private sameInputs(a: WorldSimulationSnapshot, b: WorldSimulationSnapshot) {
    const inputs = (s: WorldSimulationSnapshot) => ({ definition: s.definition, states: s.states, events: s.events,
      interventions: s.interventions, memories: s.memories, storyLines: s.storyLines,
      direction: s.branch.direction, mode: s.branch.mode, currentTick: s.branch.currentTick });
    return isDeepStrictEqual(inputs(a), inputs(b));
  }
  private validateSettings(settings: WorldRunSettings) {
    if (settings.autoImages && !settings.imageConfig) throw error('story_image_configuration_required', '启用自动配图前请选择生图引擎和对应配置。', 400);
  }
  private request(runId: string, stepId: string, worldId: string, branchId: string, stage: string, purpose: WorldModelPurpose, profileId: string | null, input: unknown): WorldModelRequest {
    return { callId: randomUUID(), runId, stepId, worldId, branchId, stage, purpose, profileId, system: WORLD_SIMULATION_SYSTEM, input };
  }
  private ensureCanContinue(run: WorldRun) {
    const fresh = this.getRun(run.worldId, run.branchId, run.id);
    if (this.stopped || !['queued', 'running'].includes(fresh.status)) throw new Halt(fresh.status === 'uncertain' ? 'uncertain' : 'paused', fresh.pauseReason || '服务调度已停止。');
    return fresh;
  }
  private async reconcileCall(call: CallRow): Promise<CallRow> {
    if (!['submitting', 'uncertain'].includes(call.status)) return call;
    const resolution = await this.adapter.reconcile?.(JSON.parse(call.request_json) as WorldModelRequest);
    if (resolution?.status === 'succeeded') {
      this.db.prepare("UPDATE sw_run_calls SET status='succeeded',response_text=?,ai_call_id=?,updated_at=? WHERE id=?").run(resolution.text, resolution.aiCallId ?? null, now(), call.id);
      return { ...call, status: 'succeeded', response_text: resolution.text };
    }
    if (resolution?.status === 'failed') {
      this.db.prepare("UPDATE sw_run_calls SET status='failed',error=?,updated_at=? WHERE id=?").run(resolution.error, now(), call.id);
      return { ...call, status: 'failed', error: resolution.error };
    }
    this.db.prepare("UPDATE sw_run_calls SET status='uncertain',updated_at=? WHERE id=? AND status='submitting'").run(now(), call.id);
    return { ...call, status: 'uncertain' };
  }
  private async reconcileRun(worldId: string, branchId: string, runId: string) {
    this.getRun(worldId, branchId, runId);
    const calls = this.db.prepare("SELECT c.* FROM sw_run_calls c JOIN sw_run_steps s ON s.id=c.step_id WHERE s.run_id=? AND c.status IN ('submitting','uncertain')").all(runId) as unknown as CallRow[];
    for (const call of calls) await this.reconcileCall(call);
  }
  private async stage<T>(run: WorldRun, step: StepRow, snapshot: WorldSimulationSnapshot, key: string, purpose: WorldModelPurpose, schema: TSchema, input: unknown, validate: (value: T, attempt: number) => void | Promise<void>): Promise<T> {
    let previous = ''; let issues = '';
    for (const attempt of [0, 1]) {
      this.ensureCanContinue(run);
      let call = this.db.prepare('SELECT * FROM sw_run_calls WHERE step_id=? AND stage_key=? AND attempt=?').get(step.id, key, attempt) as unknown as CallRow | undefined;
      if (!call || call.status === 'confirmed-not-executed') {
        const confirmed = call;
        const request = confirmed ? JSON.parse(confirmed.request_json) as WorldModelRequest
          : this.request(run.id, step.id, run.worldId, run.branchId, key, purpose, snapshot.definition.models[purpose], input);
        if (attempt) request.correction = { previous, issues };
        this.atomic(() => {
          const fresh = this.ensureCanContinue(run);
          if (fresh.textCallsUsed >= fresh.settings.maxTextCalls) throw new Halt('paused', '文本调用额度已用尽（含修正调用）。');
          const lease = this.db.prepare('SELECT lease_owner,lease_until FROM sw_run_steps WHERE id=?').get(step.id) as { lease_owner: string; lease_until: number };
          if (lease.lease_owner !== this.owner || lease.lease_until <= Date.now()) throw new Halt('uncertain', '步骤执行权已转移，等待核对。');
          const timestamp = now();
          if (confirmed) this.db.prepare("UPDATE sw_run_calls SET status='submitting',updated_at=? WHERE id=? AND status='confirmed-not-executed'").run(timestamp, confirmed.id);
          else this.db.prepare("INSERT INTO sw_run_calls(id,step_id,stage_key,attempt,purpose,status,request_json,created_at,updated_at) VALUES (?,?,?,?,?,'submitting',?,?,?)")
            .run(request.callId, step.id, key, attempt, purpose, JSON.stringify(request), timestamp, timestamp);
          this.saveRun({ ...fresh, textCallsUsed: fresh.textCallsUsed + 1, updatedAt: timestamp });
        });
        try {
          const response = await this.adapter.execute(request);
          const result = typeof response === 'string' ? { text: response } : response;
          this.db.prepare("UPDATE sw_run_calls SET status='succeeded',response_text=?,ai_call_id=?,updated_at=? WHERE id=?").run(result.text, result.aiCallId ?? null, now(), request.callId);
        } catch (e) {
          const notDispatched = e instanceof Error && (e as Error & { worldCallNotDispatched?: boolean }).worldCallNotDispatched === true;
          this.db.prepare('UPDATE sw_run_calls SET status=?,error=?,updated_at=? WHERE id=?')
            .run(notDispatched ? 'failed' : 'uncertain', notDispatched ? '模型配置在派发前失效；未发送上游请求。' : '模型请求未获得可确认结果。', now(), request.callId);
        }
        call = this.db.prepare('SELECT * FROM sw_run_calls WHERE id=?').get(request.callId) as unknown as CallRow;
      }
      call = await this.reconcileCall(call);
      if (call.status === 'uncertain' || call.status === 'submitting') throw new Halt('uncertain', '模型调用结果不明，已停止派发；核对成功前不会重放。');
      if (call.status === 'failed') throw new Halt('paused', '上游明确拒绝了本步调用；已保留记录。');
      previous = call.response_text ?? '';
      try { const value = parseWorldOutput<T>(schema, previous); await validate(value, attempt); return value; }
      catch (e) {
        if (e instanceof Halt) throw e;
        issues = e instanceof Error ? e.message : String(e);
        if (attempt === 1) {
          this.db.prepare("UPDATE sw_run_steps SET status='invalid',error=?,updated_at=? WHERE id=?").run(issues.slice(0, 4000), now(), step.id);
          this.routines?.invalidateStep(step.id, 'validation-failed');
          throw new Halt('paused', '输出校验及一次修正均失败：' + issues.slice(0, 1000));
        }
      }
    }
    throw new Error('unreachable');
  }
  tick(worldId: string, branchId: string, runId?: string): Promise<WorldRun> {
    const id = runId ?? (this.db.prepare("SELECT id FROM sw_runs WHERE world_id=? AND branch_id=? AND status IN ('queued','running','uncertain') ORDER BY created_at DESC LIMIT 1").get(worldId, branchId) as { id: string } | undefined)?.id;
    if (!id) return Promise.reject(error('story_run_not_found', '没有可推进的运行。', 404));
    const current = this.active.get(id); if (current) return current;
    const task = this.performTick(worldId, branchId, id).finally(() => { this.active.delete(id); });
    this.active.set(id, task); return task;
  }
  private async performTick(worldId: string, branchId: string, runId: string): Promise<WorldRun> {
    let run = this.getRun(worldId, branchId, runId);
    if (run.status === 'uncertain') { await this.reconcileRun(worldId, branchId, runId); return this.getRun(worldId, branchId, runId); }
    if (this.stopped || !['queued', 'running'].includes(run.status)) return run;
    let step: StepRow | undefined;
    try {
      step = this.atomic(() => {
        run = this.ensureCanContinue(run);
        let pending = this.db.prepare("SELECT * FROM sw_run_steps WHERE run_id=? AND status='pending' ORDER BY created_at,id LIMIT 1").get(runId) as unknown as StepRow | undefined;
        if (!pending) {
          const branch = this.options.store.getBranch(worldId, branchId);
          if (run.completedTick !== branch.currentTick) throw new Halt('paused', '分支时刻与运行进度不一致。');
          const toTick = Math.min(run.targetTick, branch.currentTick + run.settings.stepTicks);
          const snapshot = this.snapshot(worldId, branchId, toTick, this.effectiveModels(runId));
          const id = randomUUID(); const timestamp = now();
          this.db.prepare("INSERT INTO sw_run_steps(id,run_id,step_key,from_tick,to_tick,branch_revision,status,snapshot_json,created_at,updated_at) VALUES (?,?,?,?,?,?,'pending',?,?,?)")
            .run(id, runId, branch.currentTick + ':' + branch.revision, branch.currentTick, toTick, branch.revision, JSON.stringify(snapshot), timestamp, timestamp);
          pending = this.db.prepare('SELECT * FROM sw_run_steps WHERE id=?').get(id) as unknown as StepRow;
        }
        const claimed = this.db.prepare('UPDATE sw_run_steps SET lease_owner=?,lease_until=? WHERE id=? AND (lease_owner IS NULL OR lease_until<? OR lease_owner=?)')
          .run(this.owner, Date.now() + 60000, pending.id, Date.now(), this.owner);
        if (claimed.changes !== 1) return undefined;
        run = this.getRun(worldId, branchId, runId); this.saveRun({ ...run, status: 'running', updatedAt: now() });
        return pending;
      });
      if (!step) return this.getRun(worldId, branchId, runId);
      const ownedStep = step;
      const heartbeat = setInterval(() => {
        try { this.db.prepare('UPDATE sw_run_steps SET lease_until=? WHERE id=? AND lease_owner=?').run(Date.now() + 60000, ownedStep.id, this.owner); } catch (e) { this.options.onError?.(e); }
      }, 15000); heartbeat.unref();
      try {
        const snapshot = JSON.parse(step.snapshot_json) as WorldSimulationSnapshot;
        let result: WorldSimulationResult;
        if (step.result_json) result = JSON.parse(step.result_json) as WorldSimulationResult;
        else { result = await this.simulate(run, step, snapshot);
          this.db.prepare('UPDATE sw_run_steps SET result_json=?,updated_at=? WHERE id=? AND lease_owner=?').run(JSON.stringify(result), now(), step.id, this.owner); }
        this.atomic(() => {
          const fresh = this.ensureCanContinue(run);
          const lease = this.db.prepare('SELECT lease_owner FROM sw_run_steps WHERE id=?').get(step!.id) as { lease_owner: string };
          if (lease.lease_owner !== this.owner) throw new Halt('uncertain', '步骤执行权已转移，等待核对。');
          const branch = this.options.store.getBranch(worldId, branchId);
          if (branch.revision !== snapshot.branch.revision && !this.sameInputs(snapshot, this.snapshot(worldId, branchId, snapshot.toTick, this.effectiveModels(runId)))) {
            throw new Halt('paused', '运行期间故事输入发生修改，已保存步骤；恢复时将重新核对。');
          }
          const next: WorldRun = { ...fresh, completedTick: result.tick, status: result.tick >= fresh.targetTick ? 'completed' : (fresh.textCallsUsed >= fresh.settings.maxTextCalls ? 'paused' : 'queued'),
            pauseReason: result.tick < fresh.targetTick && fresh.textCallsUsed >= fresh.settings.maxTextCalls ? '文本调用额度已用尽（含修正调用）。' : '', updatedAt: now() };
          this.options.store.commitStep(worldId, branchId, branch.revision, { ...result, run: next });
          this.routines?.commit(step!.id, snapshot, result);
          this.db.prepare("UPDATE sw_run_steps SET status='committed',lease_owner=NULL,lease_until=0,updated_at=? WHERE id=?").run(now(), step!.id);
        });
        this.notifyStep(step.id, run, result);
      } finally { clearInterval(heartbeat); }
    } catch (e) {
      this.atomic(() => {
        const fresh = this.getRun(worldId, branchId, runId);
        if (['completed', 'failed'].includes(fresh.status)) return;
        const shutdown = this.stopped && ['queued', 'running'].includes(fresh.status) && e instanceof Halt && e.status !== 'uncertain';
        this.saveRun({ ...fresh, status: shutdown ? 'queued' : (e instanceof Halt ? e.status : 'paused'), pauseReason: shutdown ? '' : (e instanceof Halt ? e.message : '模拟处理失败，已保留步骤和调用记录，请检查服务日志。'), updatedAt: now() });
      });
      if (!(e instanceof Halt)) this.options.onError?.(e);
    } finally {
      if (step) this.db.prepare("UPDATE sw_run_steps SET lease_owner=NULL,lease_until=0 WHERE id=? AND status<>'committed' AND lease_owner=?").run(step.id, this.owner);
    }
    return this.getRun(worldId, branchId, runId);
  }
  private async simulate(run: WorldRun, step: StepRow, snapshot: WorldSimulationSnapshot): Promise<WorldSimulationResult> {
    const modelSnapshot = worldModelSnapshot(snapshot);
    const intents: WorldIntent[] = [];
    for (const actor of snapshot.definition.actors) {
      const cached = this.routines ? this.atomic(() => this.routines!.decision(step.id, snapshot, actor.id)) : null;
      if (cached) { intents.push(cached.intent); continue; }
      const schema = this.routines ? RoutineIntentSchema : WorldIntentSchema;
      const intent = await this.stage<RoutineIntent>(run, step, snapshot, 'action:' + actor.id, 'action', schema,
        { task: '提出下一段时间本角色主动尝试的具体日常行动，可工作、观察、问候、提问或邀请。根据本人背景、性格、目标与刚获得的经历选择关注点，而非让所有人采取相同的核对与休息动作。已确认完成的工作不因进入下一步就重新清点、复核；没有新问题时安排下一件事，或让休息、睡眠、旅行持续合理时长。不为填满时段制造危机或强制全员相遇。个人beliefs中的猜测和误解可以影响选择，但不能冒充facts或新增前提。根据个人已知情境推进自己的工作；未描述许可不等于必须等待审批，不凭空添加授权人或许可障碍。涉及明确的他人物品、拒绝或限制时仍遵守已有边界。意图只提出尝试与拟说的话，由环境裁定结果和他人回应；不必反复声明“不要求回应、不要求同行、没有完成”。'
          + ' 本步只选择一个targetLocationId：可以留在当前位置活动，或先移动到该目的地再在那里行动。不要在action里串联第二个目的地，例如“去餐室吃饭后再去休息室”；其他地点的后续安排留到下一轮根据已发生经历再决定。'
          + ' 若targetLocationId不同于context.state.locationId，本步包含移动，不可附work或routine计划；可以不附plan，或仅为尚在路上的持续行程附travel计划，到达后结束旅行计划。到达后的睡眠或工作若仍需延续，下一轮在当地再提出routine或work计划。'
          + ' 计划validUntil按本人准备重新选择活动的时刻设定，可跨多个模拟步；不要因为一次裁定只到untilTick就机械截短原本更长的睡眠或工作。仍须有已知情境与本人意图依据，并遵守720分钟上限，不能把计划持续时间当成已经发生的结果。'
          + (this.routines ? ' 对可以继续的独立工作/日常或旅行，可附plan:{kind:work|routine|travel,validUntil:绝对分钟}；有效期须覆盖本步且最多720分钟。交互、一次性完成动作不要附plan。plan只授权重复尝试，绝不证明完成；新知识/目标/位置/同行或干预会使计划失效。记忆摘录是有界已知信息，省略部分不得猜造。time提供相对分钟及本步跨度；若context.clock已定义，按day和minuteOfDay考虑工作、吃饭、休息与睡眠，避免无期限重复工作；未定义clock时当地昼夜未知，不能从相对分钟猜白天夜晚。' : ''),
          untilTick: snapshot.toTick, schema, context: this.summaries?.context(snapshot, actor.id) ?? personalContext(snapshot, actor.id) },
        (value) => validateRoutineIntent(value, snapshot, actor.id));
      intents.push(this.routines ? this.atomic(() => this.routines!.remember(step.id, snapshot, intent)).intent : intent);
    }
    const review = async (key: string, payload: unknown) => {
      const value = await this.stage<WorldReview>(run, step, snapshot, key, 'adjudication', WorldReviewSchema,
        { task: '严格审查原作一致性、锁定事实、导演约束、有依据的必要前提、人物动机与已裁定事实。叙事不能新造事实或让视角人物知道秘密。仅对实质违反输出具体issues：改变行为结果、凭空增加对白含义或承诺、泄露未知信息、违背设定等；未描述许可不能单独作为缺少审批的证据。对不改变事实、知情范围和人物动机的等义改写、已记录言语的对白化、语序节奏和省略重复否定句应通过，不因不逐字复述而阻断。未知性别应使用姓名或你我，不从外貌职业猜测。只返回approved和issues；实质违规必须approved=false，否则approved=true且issues=[]。', schema: WorldReviewSchema,
          canon: snapshot.branch.mode === 'canon-gap' ? snapshot.definition.sources.filter((s) => s.nature === 'canon') : [],
          lockedFacts: snapshot.definition.lockedFacts, branchMode: snapshot.branch.mode, direction: snapshot.branch.direction, interventions: snapshot.interventions, actors: snapshot.definition.actors,
          ...(key.startsWith('adjudication-review:') ? { routineReview: '若payload.planOutcomes含routineProgressFactIds，逐条检查所引事实是否仅为该人物已提出的独立日常/工作继续进行的进度；没有该字段则不作进度豁免。任何发现、消息、对他人/环境的新判断、新任务或使其需要重新选择的结果，不得伪装成普通进度。无明确语义把握时不批准该分类，让修正去掉对应ID以便下一步重新决策。休息、睡眠和重复工作可持续，但计划不等于完成，意图不能授权新事实。' } : {}), payload }, () => {});
      if (!value.approved || value.issues.length) throw new Error('一致性审查失败：' + value.issues.join('; '));
    };
    let result!: WorldSimulationResult;
    const adjudicationSchema = this.routines ? RoutineAdjudicationSchema : WorldAdjudicationSchema;
    const adjudication = await this.stage<RoutineAdjudication>(run, step, snapshot, 'adjudication', 'adjudication', adjudicationSchema,
      { task: WORLD_ADJUDICATION_TASK + ' 在既有情境和人物意图支持下，让日常工作与相互回应合理推进；只因未写出许可，不能自行创造审批程序或让人物无限等待。已有明确限制、拒绝、物品归属或确有依据的前提仍须遵守。facts记录本步可核对的动作、观察、言语意思与结果；对话按独立含义拆分，明确谁提出什么、谁如何回应，保留承诺和否定，不必逐字写满整段对话。不同参与者的感受若影响后续选择须分别记录为仅本人知道的事实，不能让现场所有人自动知道彼此内心。避免用“不要求回应、不要求同行”等校验声明代替事件。已提交历史不改写。已经完成的事不重复复核，平静时段可以由有实际时长的休息、睡眠或独立工作表示，不把四小时的推进只写成头十分钟后凭空跳时。可以留空白时段，不强制填满或制造事件；未覆盖时段不冒充已经睡过或完成工作。若有数值起始时刻，按日内钟点与人物意图安排夜间和次日，不能每步都重新收工。事件摘要和正文只描述世界内经历，模式标签留在分支元数据。'
          + ' 每人的targetLocationId是本步唯一移动目的地。抵达后可在该地继续活动，但不能仅凭action文字提到“之后去另一处”就安排第二次移动；后续目的地留下一轮选择。修改event.locationId为起点不能绕过stateChanges.locationId的目标核对。没有实际生效的外部事件时，不得新造干预授权第二次移动。'
          + (this.routines ? ' 复用/后台意图都仅是尝试，必须重新裁定本步实际结果。可返回planOutcomes，逐人物status=continue/completed/blocked，并以eventIds引用本步人物参与的真实事件；只有明确continue才可保留计划，不返回则下步重评。routineProgressFactIds可标记单人原地点持续既定活动的纯进度事实，必须满足schema中的结构限制和语义审查；发现、消息、危险、互动、状态变化必须另列，不得作为普通进度。不可把计划或到期时刻当成实际完成事实。' : ''),
        schema: adjudicationSchema, snapshot: modelSnapshot, intents, ...(this.routines ? { plans: this.routines.stepPlans(step.id) } : {}) },
      async (output, attempt) => {
        validatePlanOutcomes(output, intents);
        result = materializeWorldAdjudication(stripRoutineAdjudication(output), snapshot, intents, step.id);
        this.validateStep(result, snapshot);
        await review('adjudication-review:' + attempt, { intents, events: result.events, memories: result.memories, planOutcomes: output.planOutcomes ?? [],
          beliefs: output.beliefs ?? [], transfers: output.transfers, supportingActors: output.supportingActors,
          priorStates: snapshot.states, priorFacts: modelSnapshot.events.map((e) => ({ id: e.id, facts: e.facts })) });
      });
    result = materializeWorldAdjudication(stripRoutineAdjudication(adjudication), snapshot, intents, step.id);
    const narration: WorldNarration[] = [];
    for (const actor of [...snapshot.definition.actors, ...result.supportingActors]) {
      const relevant = result.events.filter((e) => e.participantIds.includes(actor.id));
      if (!relevant.length) continue;
      const known = relevant.map((e) => ({ id: e.id, tick: e.tick, locationId: e.locationId, facts: e.facts.filter((f) => f.knownBy.includes(actor.id)) }));
      const ownIntent = intents.find((intent) => intent.actorId === actor.id) ?? null;
      narration.push(await this.stage<WorldNarration>(run, step, snapshot, 'narration:' + actor.id, 'narration', WorldNarrationSchema,
        { task: WORLD_NARRATION_TASK, schema: WorldNarrationSchema, actor, ownIntent, events: known },
        async (value, attempt) => {
          validateWorldNarration(value, result.events, actor.id);
          // Review the same knowledge slice as the author. Forwarding global
          // review issues could otherwise teach a correction an unknown secret.
          const key = 'narration-review:' + actor.id + ':' + attempt;
          const reviewInput = { task: WORLD_NARRATION_REVIEW_TASK, schema: WorldReviewSchema, actor, ownIntent, payload: { events: known, narration: value } };
          const verdict = await this.stage<WorldReview>(run, step, snapshot, key, 'adjudication', WorldReviewSchema, reviewInput, () => {});
          if (!verdict.approved || verdict.issues.length) {
            // Durable stages reuse their original request on upgrade/resume. A
            // legacy global review remains auditable, but its issues stay private.
            const saved = this.db.prepare('SELECT request_json FROM sw_run_calls WHERE step_id=? AND stage_key=? AND attempt=0').get(step.id, key) as { request_json: string };
            const samePersonalInput = isDeepStrictEqual((JSON.parse(saved.request_json) as WorldModelRequest).input, JSON.parse(JSON.stringify(reviewInput)));
            throw new Error(narrationCorrectionIssues(verdict.issues, samePersonalInput));
          }
        }));
    }
    for (const output of narration) for (const p of output.passages) result.events.find((e) => e.id === p.eventId)!.perspectives.push({ actorId: p.actorId, text: p.text });
    return result;
  }
  private validateStep(result: WorldSimulationResult, snapshot: WorldSimulationSnapshot) {
    // Exercise the store's full invariant checks before spending narration calls.
    // Nothing escapes this savepoint, including its branch revision increment.
    const point = 'sw_validate_' + randomUUID().replaceAll('-', '');
    const branch = this.options.store.getBranch(snapshot.worldId, snapshot.branch.id);
    if (branch.revision !== snapshot.branch.revision && !this.sameInputs(snapshot, this.snapshot(snapshot.worldId, branch.id, snapshot.toTick, snapshot.definition.models))) {
      throw new Halt('paused', '裁定期间故事输入发生修改，恢复前需要重新核对。');
    }
    this.db.exec('SAVEPOINT ' + point);
    try { this.options.store.commitStep(snapshot.worldId, snapshot.branch.id, branch.revision, result); }
    finally { this.db.exec('ROLLBACK TO ' + point); this.db.exec('RELEASE ' + point); }
  }
  private notifyStep(stepId: string, run: WorldRun, result: WorldSimulationResult): void {
    if (this.stopped || !this.options.afterStep || this.notifying.has(stepId)) return;
    // The durable lease excludes in-flight and branch-queued callbacks from pump
    // batches, including when another server instance shares this database.
    const claimed = this.db.prepare("UPDATE sw_run_steps SET lease_owner=?,lease_until=? WHERE id=? AND status='committed' AND result_json IS NOT NULL AND lease_until<=?")
      .run(this.owner, Date.now() + notificationLeaseMs, stepId, Date.now());
    if (claimed.changes !== 1) return;
    const heartbeat = setInterval(() => {
      try { this.db.prepare("UPDATE sw_run_steps SET lease_until=? WHERE id=? AND status='committed' AND lease_owner=?").run(Date.now() + notificationLeaseMs, stepId, this.owner); }
      catch (e) { this.options.onError?.(e); }
    }, 15000); heartbeat.unref();
    // Image planning/submission never holds up the text pump. Serialize callbacks
    // on a branch so two commits cannot race through the image revision/budget.
    const previous = this.notificationChains.get(run.branchId) ?? Promise.resolve();
    const task = previous.then(async () => {
      try {
        const owned = this.db.prepare("UPDATE sw_run_steps SET lease_until=? WHERE id=? AND status='committed' AND lease_owner=?")
          .run(Date.now() + notificationLeaseMs, stepId, this.owner);
        if (owned.changes !== 1) return;
        await this.options.afterStep!({ worldId: run.worldId, branchId: run.branchId, runId: run.id, eventIds: result.events.map((e) => e.id),
          run: this.getRun(run.worldId, run.branchId, run.id), events: structuredClone(result.events) });
        // Ack only after success. Crash between external effect and ack permits
        // at-least-once replay, so consumers must remain idempotent by event ID.
        this.db.prepare("UPDATE sw_run_steps SET status='notified',lease_owner=NULL,lease_until=0,updated_at=? WHERE id=? AND status='committed' AND lease_owner=?")
          .run(now(), stepId, this.owner);
      } catch (e) { this.options.onError?.(e); }
    }).finally(() => {
      clearInterval(heartbeat);
      this.db.prepare("UPDATE sw_run_steps SET lease_owner=NULL,lease_until=0 WHERE id=? AND status='committed' AND lease_owner=?").run(stepId, this.owner);
      this.notifying.delete(stepId);
      if (this.notificationChains.get(run.branchId) === task) this.notificationChains.delete(run.branchId);
    });
    this.notifying.set(stepId, task); this.notificationChains.set(run.branchId, task);
  }
  /** One bounded pass, awaitable without a timer. */
  pump(): Promise<void> {
    if (this.pumping) return this.pumping;
    this.pumping = this.performPump().finally(() => { this.pumping = undefined; });
    return this.pumping;
  }
  private async performPump(): Promise<void> {
    if (this.stopped) return;
    const runs = this.db.prepare("SELECT id,world_id,branch_id FROM sw_runs WHERE status IN ('queued','running','uncertain') ORDER BY created_at,id").all() as { id: string; world_id: string; branch_id: string }[];
    for (const run of runs) {
      if (this.stopped) break;
      // A damaged record must retain its recovery state without starving other runs.
      try { await this.tick(run.world_id, run.branch_id, run.id); }
      catch (e) { this.options.onError?.(e); }
    }
    // Read only indexed, unacknowledged deliveries in bounded batches. With no
    // callback configured, retain pending rows for a later configured startup.
    if (!this.options.afterStep) return;
    const committed = this.db.prepare(WORLD_RUNTIME_PENDING_NOTIFICATIONS_SQL).all(Date.now(), notificationBatchSize) as unknown as NotificationRow[];
    for (const step of committed) {
      if (this.stopped) break;
      const row = this.db.prepare('SELECT data_json FROM sw_runs WHERE id=?').get(step.run_id) as { data_json: string };
      this.notifyStep(step.id, JSON.parse(row.data_json) as WorldRun, JSON.parse(step.result_json) as WorldSimulationResult);
    }
  }
  /** Call once on Fastify ready. Idempotent; initial recovery starts immediately. */
  startScheduler(): void {
    if (this.timer) return; this.stopped = false;
    const pump = () => { void this.pump().catch((e) => this.options.onError?.(e)); };
    this.timer = setInterval(pump, this.options.schedulerIntervalMs ?? 1000); this.timer.unref(); pump();
  }
  /** Await on Fastify close BEFORE closing SQLite. A submitted upstream request is
   * not aborted. Queued work persists for the next server startup. */
  async stop(): Promise<void> {
    this.stopped = true; if (this.timer) clearInterval(this.timer); this.timer = undefined;
    await Promise.allSettled([...this.active.values(), ...(this.pumping ? [this.pumping] : [])]);
    await Promise.allSettled([...this.notifying.values()]);
  }
}
