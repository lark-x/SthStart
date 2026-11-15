import { randomUUID } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import type { ServiceDatabase } from '../database.js';
import { WorldAdjudicationSchema, WorldIntentSchema, WorldReviewSchema, parseWorldOutput, personalContext, validateWorldIntent,
  type WorldAdjudication, type WorldIntent, type WorldReview, type WorldSimulationResult, type WorldSimulationSnapshot } from './simulation.js';
import { fingerprint, knowledgeFingerprint } from './runtime.memory.js';

export const RoutineIntentSchema = Type.Object({ ...WorldIntentSchema.properties,
  plan: Type.Optional(Type.Object({ kind: Type.Union([Type.Literal('work'), Type.Literal('routine'), Type.Literal('travel')]),
    validUntil: Type.Integer({ minimum: 1 }),
  }, { additionalProperties: false })),
}, { additionalProperties: false });
export type RoutineIntent = Static<typeof RoutineIntentSchema>;
export const RoutineAdjudicationSchema = Type.Object({ ...WorldAdjudicationSchema.properties,
  planOutcomes: Type.Optional(Type.Array(Type.Object({ actorId: Type.String(),
    status: Type.Union([Type.Literal('continue'), Type.Literal('completed'), Type.Literal('blocked')]),
    eventIds: Type.Array(Type.String(), { minItems: 1 }),
    routineProgressFactIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 30,
      description: '仅continue可引用本人在原地点独立持续既定活动的进度事实，如继续睡眠、独立工作或尚未到达的行程。必须是本步已裁定的事实，不是计划；不得把发现、消息、危险、新前提、互动或完成整个计划列为进度。同一事实若同时包含进度与发现须拆分，发现仍使计划失效。事件须本人单独参与、有正时长、无状态变化、转述、猜测或新增因果。分类须通过一致性语义审查；程序只核查结构和来源，不证明自由文本语义。',
    })),
  }, { additionalProperties: false }), { maxItems: 100 })),
}, { additionalProperties: false });
export type RoutineAdjudication = Static<typeof RoutineAdjudicationSchema>;
interface Basis { actor: string; goals: string; location: string; companions: string; knowledge: string; interventions: string; definition: string; personalState: string }
export interface WorldRoutinePlan {
  id: string; worldId: string; branchId: string; actorId: string; sourceStepId: string;
  kind: 'work' | 'routine' | 'travel'; validFrom: number; validUntil: number; checkpointTick: number;
  intent: WorldIntent; basis: Basis; status: 'pending' | 'active' | 'invalid' | 'completed'; invalidReason: string;
}
interface Decision { intent: WorldIntent; mode: 'model' | 'reused' | 'background'; planId: string | null; invalidReason: string }
interface PlanRow { id: string; status: WorldRoutinePlan['status']; data_json: string }

function basis(snapshot: WorldSimulationSnapshot, actorId: string): Basis {
  const context = personalContext(snapshot, actorId);
  return { actor: fingerprint(context.actor), goals: fingerprint([context.actor.goals, context.state.goals]), location: context.state.locationId,
    companions: fingerprint(context.nearbyActors.map((a) => [a.id, a.name, a.appearance]).sort()), knowledge: knowledgeFingerprint(context),
    personalState: fingerprint([context.state.emotion, context.state.relationships]),
    interventions: fingerprint(snapshot.interventions.filter((i) => (!i.actorIds.length || i.actorIds.includes(actorId)) && i.tick <= snapshot.toTick)
      .map((i) => ({ ...i, consumed: false }))),
    definition: fingerprint([snapshot.definition.locations, snapshot.definition.lockedFacts, snapshot.definition.sources, snapshot.definition.models,
      (snapshot.definition as typeof snapshot.definition & { startMinuteOfDay?: number }).startMinuteOfDay ?? null, snapshot.branch.direction, snapshot.branch.mode]) };
}
const coreIntent = (intent: RoutineIntent): WorldIntent => { const { plan: _plan, ...value } = intent; return value; };
export function validateRoutineIntent(intent: RoutineIntent, snapshot: WorldSimulationSnapshot, actorId: string) {
  validateWorldIntent(coreIntent(intent), snapshot, actorId);
  if (!intent.plan) return;
  if (intent.plan.validUntil < snapshot.toTick || intent.plan.validUntil > snapshot.branch.currentTick + 720) throw new Error('计划有效期须覆盖当前步，且不得超过当前时刻后720分钟。');
  const location = personalContext(snapshot, actorId).state.locationId;
  if (intent.plan.kind === 'travel' ? intent.targetLocationId === location : intent.targetLocationId !== location) throw new Error('旅行计划须指向其他地点；工作/日常计划只能留在当前位置。');
  if (intent.interactWithActorIds.length) throw new Error('多人交互意图不可跨步复用，请不提交plan；每步重新确认互动。');
}
export function stripRoutineAdjudication(output: RoutineAdjudication): WorldAdjudication { const { planOutcomes: _outcomes, ...value } = output; return value; }
/** Structural eligibility only: the normal adjudication review must also check
 * these classifications against the actor's intention and actual fact text.
 * Every unlisted fact, including one in a confirmed event, stays new knowledge. */
function routineProgressFacts(output: RoutineAdjudication, outcome: NonNullable<RoutineAdjudication['planOutcomes']>[number], intent: WorldIntent) {
  const facts = new Set<string>();
  for (const factId of outcome.routineProgressFactIds ?? []) {
    const event = output.events.find((e) => e.facts.some((f) => f.id === factId));
    const fact = event?.facts.find((f) => f.id === factId);
    if (facts.has(factId) || outcome.status !== 'continue' || intent.interactWithActorIds.length
      || !event || !fact || !outcome.eventIds.includes(event.id) || event.participantIds.length !== 1 || event.participantIds[0] !== outcome.actorId
      || event.duration <= 0 || event.stateChanges.length || event.causeEventIds.length
      || fact.nature !== 'ai' || fact.knownBy.length !== 1 || fact.knownBy[0] !== outcome.actorId
      || output.transfers.some((t) => t.sourceEventId === event.id || t.meetingEventId === event.id)
      || output.beliefs?.some((b) => b.sourceEventId === event.id)) {
      throw new Error('日常进度 ' + factId + ' 必须为continue的本人独立行动：引用本步单人、原地点、正时长、无状态变化/转述/猜测/新增因果的事件；事实仅本人知道。只可分类既定活动的进行进度，发现、消息或危险必须另列事实且不能放入routineProgressFactIds。');
    }
    facts.add(factId);
  }
  return facts;
}
export function validatePlanOutcomes(output: RoutineAdjudication, intents: WorldIntent[]) {
  const seen = new Set<string>();
  for (const outcome of output.planOutcomes ?? []) {
    if (seen.has(outcome.actorId) || !intents.some((i) => i.actorId === outcome.actorId)) throw new Error('计划反馈须唯一且属于本步意图人物。');
    seen.add(outcome.actorId);
    if (new Set(outcome.eventIds).size !== outcome.eventIds.length || outcome.eventIds.some((id) => !output.events.some((e) => e.id === id && e.participantIds.includes(outcome.actorId)))) throw new Error('计划反馈必须引用人物参与的本步实际事件。');
    routineProgressFacts(output, outcome, intents.find((i) => i.actorId === outcome.actorId)!);
  }
}

/** Durable intent reuse only. This module never writes world events or actor
 * state. Every continuation, including background extras, goes to adjudication. */
export class WorldRoutinePlans {
  constructor(private readonly database: ServiceDatabase) {}
  private save(plan: WorldRoutinePlan) {
    this.database.connection.prepare('UPDATE sw_actor_plans SET status=?,checkpoint_tick=?,invalid_reason=?,data_json=?,updated_at=? WHERE id=?')
      .run(plan.status, plan.checkpointTick, plan.invalidReason, JSON.stringify(plan), new Date().toISOString(), plan.id);
  }
  private invalidReason(plan: WorldRoutinePlan, snapshot: WorldSimulationSnapshot): string {
    if (plan.worldId !== snapshot.worldId || plan.branchId !== snapshot.branch.id || plan.checkpointTick > snapshot.branch.currentTick) return 'scope-or-time';
    if (snapshot.toTick > plan.validUntil || snapshot.branch.currentTick >= plan.validUntil) return 'expired';
    const current = basis(snapshot, plan.actorId);
    const reasons: Array<[keyof Basis, string]> = [['goals', 'goals-changed'], ['location', 'location-changed'], ['companions', 'companions-changed'],
      ['knowledge', 'new-knowledge'], ['interventions', 'director-intervention'], ['actor', 'actor-definition-changed'], ['definition', 'world-inputs-changed'], ['personalState', 'personal-state-changed']];
    for (const [key, reason] of reasons) if (current[key] !== plan.basis[key]) return reason;
    if (snapshot.events.some((event) => event.tick + event.duration > plan.checkpointTick && event.tick + event.duration <= snapshot.branch.currentTick
      && (event.participantIds.includes(plan.actorId) || event.locationId === current.location || event.locationId === plan.intent.targetLocationId))) return 'new-relevant-event';
    if (plan.kind === 'travel' && current.location === plan.intent.targetLocationId) return 'arrived';
    try { validateWorldIntent(plan.intent, snapshot, plan.actorId); } catch { return 'prerequisite-changed'; }
    return '';
  }
  decision(stepId: string, snapshot: WorldSimulationSnapshot, actorId: string): Decision | null {
    const saved = this.database.connection.prepare('SELECT data_json FROM sw_step_intents WHERE step_id=? AND actor_id=?').get(stepId, actorId) as { data_json: string } | undefined;
    if (saved) { const decision = JSON.parse(saved.data_json) as Decision; validateWorldIntent(decision.intent, snapshot, actorId); return decision; }
    const row = this.database.connection.prepare("SELECT * FROM sw_actor_plans WHERE world_id=? AND branch_id=? AND actor_id=? AND status='active'")
      .get(snapshot.worldId, snapshot.branch.id, actorId) as unknown as PlanRow | undefined;
    let reason = '';
    if (row) {
      const plan = JSON.parse(row.data_json) as WorldRoutinePlan; reason = this.invalidReason(plan, snapshot);
      if (!reason) return this.record(stepId, { intent: plan.intent, mode: 'reused', planId: plan.id, invalidReason: '' });
      this.save({ ...plan, status: reason === 'arrived' ? 'completed' : 'invalid', invalidReason: reason });
    }
    if (!row) {
      const last = this.database.connection.prepare("SELECT data_json FROM sw_actor_plans WHERE world_id=? AND branch_id=? AND actor_id=? AND status='invalid' ORDER BY checkpoint_tick DESC,rowid DESC LIMIT 1")
        .get(snapshot.worldId, snapshot.branch.id, actorId) as { data_json: string } | undefined;
      if (last) { const plan = JSON.parse(last.data_json) as WorldRoutinePlan;
        if (plan.checkpointTick === snapshot.branch.currentTick && plan.invalidReason !== 'expired') reason = plan.invalidReason; }
    }
    const actor = snapshot.definition.actors.find((a) => a.id === actorId)!;
    const location = personalContext(snapshot, actorId).state.locationId;
    const visibleMain = snapshot.states.some((state) => state.actorId !== actorId && state.locationId === location && snapshot.definition.actors.some((a) => a.id === state.actorId && a.role === 'main'));
    const addressed = snapshot.interventions.some((i) => !i.consumed && i.tick <= snapshot.toTick && (!i.actorIds.length || i.actorIds.includes(actorId)));
    // Extras with new circumstances get one individual decision. Uninvolved
    // extras follow a bounded background intention, never an invented result.
    if (actor.role === 'supporting' && !reason && !visibleMain && !addressed) {
      return this.remember(stepId, snapshot, { actorId, action: '尝试继续自己的日常安排；具体行动、能否推进及结果由环境裁定，不预设成功。',
        targetLocationId: location, prerequisiteFactIds: [], interactWithActorIds: [],
        ...(snapshot.toTick <= snapshot.branch.currentTick + 720 ? { plan: { kind: 'routine' as const, validUntil: Math.max(snapshot.toTick, snapshot.branch.currentTick + 120) } } : {}) }, 'background');
    }
    return null;
  }
  private record(stepId: string, decision: Decision): Decision {
    this.database.connection.prepare('INSERT INTO sw_step_intents(step_id,actor_id,mode,plan_id,data_json) VALUES (?,?,?,?,?)')
      .run(stepId, decision.intent.actorId, decision.mode, decision.planId, JSON.stringify(decision));
    return structuredClone(decision);
  }
  remember(stepId: string, snapshot: WorldSimulationSnapshot, proposed: RoutineIntent, mode: 'model' | 'background' = 'model'): Decision {
    validateRoutineIntent(proposed, snapshot, proposed.actorId);
    let planId: string | null = null;
    if (proposed.plan) {
      planId = randomUUID();
      const plan: WorldRoutinePlan = { id: planId, worldId: snapshot.worldId, branchId: snapshot.branch.id, actorId: proposed.actorId, sourceStepId: stepId,
        ...proposed.plan, validFrom: snapshot.branch.currentTick, checkpointTick: snapshot.branch.currentTick, intent: coreIntent(proposed), basis: basis(snapshot, proposed.actorId), status: 'pending', invalidReason: '' };
      const time = new Date().toISOString();
      this.database.connection.prepare('INSERT INTO sw_actor_plans(id,world_id,branch_id,actor_id,source_step_id,status,valid_until,checkpoint_tick,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(plan.id, plan.worldId, plan.branchId, plan.actorId, stepId, plan.status, plan.validUntil, plan.checkpointTick, JSON.stringify(plan), time, time);
    }
    return this.record(stepId, { intent: coreIntent(proposed), mode, planId, invalidReason: '' });
  }
  stepPlans(stepId: string) {
    return this.database.connection.prepare('SELECT i.actor_id,i.mode,p.data_json FROM sw_step_intents i LEFT JOIN sw_actor_plans p ON p.id=i.plan_id WHERE i.step_id=? ORDER BY i.actor_id')
      .all(stepId).map((row) => { const plan = row.data_json ? JSON.parse(String(row.data_json)) as WorldRoutinePlan : null;
        return { actorId: String(row.actor_id), mode: String(row.mode), kind: plan?.kind, validUntil: plan?.validUntil }; });
  }
  invalidateStep(stepId: string, reason: string) {
    for (const row of this.database.connection.prepare("SELECT data_json FROM sw_actor_plans WHERE source_step_id=? AND status='pending'").all(stepId) as { data_json: string }[]) {
      this.save({ ...JSON.parse(row.data_json) as WorldRoutinePlan, status: 'invalid', invalidReason: reason });
    }
  }
  /** Called inside the same transaction as commitStep. No tentative outcome may
   * keep a plan alive if the event/state/memory commit subsequently rolls back. */
  commit(stepId: string, snapshot: WorldSimulationSnapshot, result: WorldSimulationResult) {
    const rows = this.database.connection.prepare('SELECT data_json FROM sw_step_intents WHERE step_id=?').all(stepId) as { data_json: string }[];
    const decisions = rows.map((row) => JSON.parse(row.data_json) as Decision);
    const call = this.database.connection.prepare("SELECT response_text,attempt FROM sw_run_calls WHERE step_id=? AND stage_key='adjudication' AND status='succeeded' ORDER BY attempt DESC LIMIT 1").get(stepId) as { response_text: string; attempt: number } | undefined;
    const output = call ? parseWorldOutput<RoutineAdjudication>(RoutineAdjudicationSchema, call.response_text) : undefined;
    // Commit follows full validation/review; require the accepted review for
    // this exact adjudication attempt before granting the new exemption. Old
    // records without that evidence keep the conservative interruption rule.
    const reviewCall = call && this.database.connection.prepare("SELECT response_text FROM sw_run_calls WHERE step_id=? AND stage_key=? AND status='succeeded' ORDER BY attempt DESC LIMIT 1")
      .get(stepId, 'adjudication-review:' + call.attempt) as { response_text: string } | undefined;
    const review = reviewCall ? parseWorldOutput<WorldReview>(WorldReviewSchema, reviewCall.response_text) : undefined;
    const independentProgress = new Set<string>();
    if (output && review?.approved && !review.issues.length) for (const other of decisions) {
      const outcome = output.planOutcomes?.find((o) => o.actorId === other.intent.actorId);
      const origin = snapshot.states.find((s) => s.actorId === other.intent.actorId)?.locationId;
      if (!outcome || !origin) continue;
      const progress = routineProgressFacts(output, outcome, other.intent);
      for (const event of result.events) if (event.participantIds.length === 1 && event.participantIds[0] === other.intent.actorId
        && event.locationId === origin && event.duration > 0 && !event.stateChanges.length && !event.causeEventIds.length
        && event.facts.length && event.facts.every((fact) => progress.has(fact.id) && fact.nature === 'ai'
          && fact.knownBy.length === 1 && fact.knownBy[0] === other.intent.actorId)
        && !output.transfers.some((t) => t.sourceEventId === event.id || t.meetingEventId === event.id)
        && !output.beliefs?.some((b) => b.sourceEventId === event.id)) independentProgress.add(event.id);
    }
    for (const decision of decisions) {
      if (!decision.planId) continue;
      const planRow = this.database.connection.prepare('SELECT data_json FROM sw_actor_plans WHERE id=?').get(decision.planId!) as { data_json: string };
      const plan = JSON.parse(planRow.data_json) as WorldRoutinePlan;
      const outcome = output?.planOutcomes?.find((o) => o.actorId === plan.actorId);
      const context = personalContext(snapshot, plan.actorId);
      const known = new Set(context.facts.map((f) => f.content));
      const eligibleProgress = output && outcome ? routineProgressFacts(output, outcome, plan.intent) : new Set<string>();
      // Materialization already checks the event location against the actor's
      // state; check the original plan location again before refreshing basis.
      const progressIds = new Set(result.events.filter((event) => event.locationId === context.state.locationId)
        .flatMap((event) => event.facts.filter((fact) => eligibleProgress.has(fact.id)).map((fact) => fact.id)));
      const progressMemories = new Set(result.events.flatMap((event) => event.facts.filter((fact) => progressIds.has(fact.id))
        .map((fact) => JSON.stringify([event.id, fact.content, event.tick + event.duration]))));
      const newKnowledge = result.events.some((event) => event.facts.some((fact) => fact.knownBy.includes(plan.actorId) && !known.has(fact.content) && !progressIds.has(fact.id)))
        || result.memories.some((memory) => memory.actorId === plan.actorId
          && !(memory.kind === 'inferred' || memory.kind === 'mistaken' ? context.beliefs.some((m) => m.kind === memory.kind && m.content === memory.content) : known.has(memory.content))
          && !(memory.kind === 'experienced' && memory.fromActorId === null
            && progressMemories.has(JSON.stringify([memory.sourceEventId, memory.content, memory.learnedAt]))));
      const changedState = result.states.find((s) => s.actorId === plan.actorId);
      const stateReason = [...result.events.flatMap((e) => e.stateChanges), ...result.states].filter((s) => s.actorId === plan.actorId)
        .map((state) => fingerprint(state.goals) !== fingerprint(context.state.goals) ? 'goals-changed'
          : state.locationId !== context.state.locationId ? 'location-changed'
          : fingerprint([state.emotion, state.relationships]) !== fingerprint([context.state.emotion, context.state.relationships]) ? 'personal-state-changed' : '').find(Boolean) ?? '';
      const priorCompanions = snapshot.states.filter((s) => s.actorId !== plan.actorId && s.locationId === context.state.locationId).map((s) => s.actorId).sort();
      const finalStates = new Map(snapshot.states.map((s) => [s.actorId, s])); for (const state of result.states) finalStates.set(state.actorId, state);
      const finalCompanions = [...finalStates.values()].filter((s) => s.actorId !== plan.actorId && s.locationId === (changedState?.locationId ?? context.state.locationId)).map((s) => s.actorId).sort();
      let companionsChanged = fingerprint(priorCompanions) !== fingerprint(finalCompanions);
      // A companion may leave and return inside one step. The final roster
      // alone must not erase that interruption, even if events name remote
      // locations rather than the observer's location.
      const intermediateLocations = new Map(snapshot.states.map((s) => [s.actorId, s.locationId]));
      for (const event of result.events) for (const state of event.stateChanges) {
        if (state.actorId !== plan.actorId && (intermediateLocations.get(state.actorId) === context.state.locationId) !== (state.locationId === context.state.locationId)) companionsChanged = true;
        intermediateLocations.set(state.actorId, state.locationId);
      }
      const arrived = plan.kind === 'travel' && result.states.some((s) => s.actorId === plan.actorId && s.locationId === plan.intent.targetLocationId);
      const interacted = result.events.some((e) => e.participantIds.includes(plan.actorId) && e.participantIds.length > 1);
      const disrupted = result.events.some((e) => !outcome?.eventIds.includes(e.id)
        && (e.participantIds.includes(plan.actorId) || e.locationId === plan.basis.location || e.locationId === plan.intent.targetLocationId)
        && !(independentProgress.has(e.id) && !e.participantIds.includes(plan.actorId) && !e.facts.some((f) => f.knownBy.includes(plan.actorId))
          && !result.memories.some((m) => m.actorId === plan.actorId && m.sourceEventId === e.id)));
      const expired = result.tick >= plan.validUntil;
      const reason = arrived ? 'arrived' : outcome?.status === 'completed' ? 'completed' : newKnowledge ? 'new-knowledge' : stateReason
        || (companionsChanged ? 'companions-changed' : interacted ? 'interaction' : disrupted ? 'new-relevant-event' : expired ? 'expired' : outcome?.status !== 'continue' ? 'unconfirmed-or-blocked' : '');
      const status = arrived || outcome?.status === 'completed' ? 'completed' : reason ? 'invalid' : 'active';
      // Refresh only knowledge after a validated, atomic continuation. Other
      // basis fields must still detect changed goals/state/inputs next step.
      const nextBasis = status === 'active' && progressIds.size ? { ...plan.basis, knowledge: knowledgeFingerprint(personalContext({ ...snapshot,
        branch: { ...snapshot.branch, currentTick: result.tick }, states: [...finalStates.values()],
        events: [...snapshot.events, ...result.events], memories: [...snapshot.memories, ...result.memories],
      }, plan.actorId)) } : plan.basis;
      this.save({ ...plan, basis: nextBasis, status, checkpointTick: result.tick, invalidReason: reason });
    }
  }
}
