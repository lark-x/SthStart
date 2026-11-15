import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_WORLD_RUN_SETTINGS, type WorldDefinition, type WorldEvent } from '@sthstart/contracts';
import { ServiceDatabase } from '../database.js';
import type { ServiceConfig } from '../config.js';
import { SecretStore } from '../security.js';
import { StoryWorldStore } from './store.js';
import { StoryWorldRuntime } from './runtime.js';
import { STORY_WORLD_MIGRATION_STATEMENTS } from './migration.js';
import { WORLD_RUNTIME_MIGRATION_STATEMENTS, WORLD_RUNTIME_NOTIFICATION_MIGRATION_STATEMENTS } from './runtime-migration.js';
import { WORLD_ROUTINE_MIGRATION_STATEMENTS } from './runtime-routine-migration.js';
import type { WorldModelAdapter, WorldModelRequest } from './model.js';
import { WorldRoutinePlans, validatePlanOutcomes } from './runtime.simulation.js';
import type { RoutineIntent, RoutineAdjudication, WorldRoutinePlan } from './runtime.simulation.js';
import { personalContext, type WorldSimulationResult, type WorldSimulationSnapshot } from './simulation.js';
import { knowledgeFingerprint } from './runtime.memory.js';

function definition(): WorldDefinition {
  return { title: '日常计划', summary: '', timeLabel: '清晨', locations: [{ id: 'shop', name: '工坊', description: '' }, { id: 'road', name: '路口', description: '' }],
    actors: ['a', 'extra'].map((id) => ({ id, name: id, role: id === 'a' ? 'main' : 'supporting', characterId: null, characterVersion: null, background: '', personality: '',
      speechStyle: '', appearance: '', goals: ['整理工具'], locationId: id === 'a' ? 'shop' : 'road', referenceArtifactIds: [] })),
    sources: [], lockedFacts: [], models: { action: null, adjudication: null, narration: null }, visualStyle: '' };
}
const answer = (request: WorldModelRequest): string => {
  const input = request.input as any;
  if (request.stage.startsWith('action:')) { const context = input.context; return JSON.stringify({ actorId: context.actor.id, action: '继续整理工具',
    targetLocationId: context.state.locationId, interactWithActorIds: [], prerequisiteFactIds: [], plan: { kind: 'work', validUntil: context.tick + 240 } }); }
  if (request.stage === 'adjudication') { const s = input.snapshot as WorldSimulationSnapshot; return JSON.stringify({
    events: s.definition.actors.map((actor, i) => ({ id: request.stepId + ':event:' + i, tick: s.toTick, duration: 0, title: '继续日常', summary: '保持原有安排',
      locationId: s.states.find((state) => state.actorId === actor.id)!.locationId, participantIds: [actor.id], facts: [{ id: request.stepId + ':fact:' + i,
        content: actor.id === 'a' ? '工匠继续清点螺钉' : '邮差继续整理包裹', knownBy: [actor.id], nature: 'ai' }], stateChanges: [], causeEventIds: [], storyLineIds: [] })),
    supportingActors: [], transfers: [], consumedInterventionIds: s.interventions.filter((i) => !i.consumed).map((i) => i.id), violatedLockedFacts: [],
    planOutcomes: s.definition.actors.map((actor, i) => ({ actorId: actor.id, status: 'continue', eventIds: [request.stepId + ':event:' + i] })),
  }); }
  if (request.stage.startsWith('narration:')) return JSON.stringify({ passages: input.events.map((event: any) => ({ actorId: input.actor.id, eventId: event.id, factIds: event.facts.map((f: any) => f.id), text: event.facts[0].content })) });
  return JSON.stringify({ approved: true, issues: [] });
};
/** Different adjudicated progress each step, never a seeded/repeated fact. */
const continuingAnswer = (request: WorldModelRequest, activity: 'work' | 'sleep' | 'travel' = 'work'): string => {
  const raw = answer(request);
  if (request.stage === 'action:a' && activity !== 'work') {
    const value = JSON.parse(raw) as RoutineIntent; value.action = activity === 'sleep' ? '留在工坊睡觉休息' : '步行前往路口';
    value.plan!.kind = activity === 'sleep' ? 'routine' : 'travel'; if (activity === 'travel') value.targetLocationId = 'road';
    return JSON.stringify(value);
  }
  if (request.stage !== 'adjudication') return raw;
  const value = JSON.parse(raw) as RoutineAdjudication; const snapshot = (request.input as any).snapshot as WorldSimulationSnapshot;
  const index = Math.floor((snapshot.branch.currentTick - 1) / 60);
  const prose = activity === 'sleep'
    ? ['工匠在工坊睡着，休息仍在持续。', '工匠这一小时继续安睡，没有起身。', '工匠仍在睡眠中，尚未醒来。']
    : activity === 'travel'
      ? ['工匠穿过工坊前院朝路口步行，尚未抵达。', '工匠继续向路口行走，行程仍在进行。', '工匠仍在步行，尚未到达路口。']
      : ['工匠按大小将螺钉分入左侧抽屉，其余工具仍待收纳。', '工匠继续整理中间一格，将常用螺钉逐一归位。', '工匠开始收纳右侧工具，整理工作仍在进行。'];
  for (const event of value.events) {
    event.tick = snapshot.branch.currentTick + 1; event.duration = snapshot.toTick - event.tick;
    event.facts[0].content = event.participantIds[0] === 'a' ? prose[index % prose.length] : '邮差继续将第' + (index + 1) + '批包裹分入各个投递筐。';
    const outcome = value.planOutcomes!.find((o) => o.actorId === event.participantIds[0])!;
    outcome.routineProgressFactIds = [event.facts[0].id];
  }
  return JSON.stringify(value);
};
const sharedSleepAnswer = (request: WorldModelRequest): string => {
  const raw = continuingAnswer(request, 'sleep');
  if (request.stage.startsWith('action:')) {
    const value = JSON.parse(raw) as RoutineIntent; value.action = '留在原地睡眠休息'; value.plan!.kind = 'routine'; return JSON.stringify(value);
  }
  if (request.stage !== 'adjudication') return raw;
  const value = JSON.parse(raw) as RoutineAdjudication; const index = Math.floor(((request.input as any).snapshot.branch.currentTick - 1) / 60);
  value.events[1].facts[0].content = ['邮差躺在自己的铺位继续睡眠。', '邮差这一小时仍安睡在铺位，没有起身。', '邮差继续休息，睡眠尚未结束。'][index % 3];
  return JSON.stringify(value);
};
class Model implements WorldModelAdapter {
  requests: WorldModelRequest[] = []; respond = answer;
  async prepare(request: WorldModelRequest) { return { profileId: 'fake-' + request.purpose }; }
  async execute(request: WorldModelRequest) { this.requests.push(structuredClone(request)); return this.respond(request); }
}
function fixture(path = ':memory:', solo = false, shared = false) {
  const db = new ServiceDatabase(path); for (const sql of [...STORY_WORLD_MIGRATION_STATEMENTS, ...WORLD_RUNTIME_MIGRATION_STATEMENTS, ...WORLD_RUNTIME_NOTIFICATION_MIGRATION_STATEMENTS, ...WORLD_ROUTINE_MIGRATION_STATEMENTS]) db.connection.exec(sql);
  const store = new StoryWorldStore(db); const input = definition(); if (solo) input.actors = input.actors.slice(0, 1);
  if (shared) for (const actor of input.actors) actor.locationId = 'shop';
  const world = store.create(input);
  const branch = store.createBranch(world.id, { title: '日常', mode: 'alternate', direction: '', expectedRevision: world.revision });
  const initial: WorldEvent[] = world.actors.map((actor, i) => ({ id: 'known-' + i, worldId: world.id, branchId: branch.id, tick: 1, duration: 0, title: '已知日常', summary: '',
    locationId: actor.locationId, participantIds: [actor.id], facts: [{ id: 'known-fact-' + i, content: actor.id === 'a' ? '工匠继续清点螺钉' : '邮差继续整理包裹', knownBy: [actor.id], nature: 'ai' }],
    perspectives: [], stateChanges: [], storyLineIds: [], causeEventIds: [], createdAt: '' }));
  store.commitStep(world.id, branch.id, branch.revision, { tick: 1, events: initial, states: [], memories: [], consumedInterventionIds: [] });
  const model = new Model(); const errors: unknown[] = [];
  const options = { database: db, store, modelAdapter: model, config: {} as ServiceConfig, secrets: new SecretStore({}), onError: (e: unknown) => errors.push(e) };
  const runtime = new StoryWorldRuntime(options);
  const start = (durationTicks = 180) => runtime.start(world.id, branch.id, { expectedRevision: store.getBranch(world.id, branch.id).revision, idempotencyKey: 'run',
    settings: { ...DEFAULT_WORLD_RUN_SETTINGS, durationTicks, stepTicks: 60, maxTextCalls: 120 } });
  return { db, store, world, branch, model, options, runtime, errors, start };
}
const plans = (db: ServiceDatabase) => db.connection.prepare('SELECT data_json FROM sw_actor_plans ORDER BY rowid').all().map((row) => JSON.parse(String(row.data_json)) as WorldRoutinePlan);

test('three ordinary steps reuse durable plans: one main action, no idle extra actions, every result adjudicated', async () => {
  const f = fixture();
  try {
    f.model.respond = continuingAnswer;
    const run = await f.start(); for (let i = 0; i < 3; i++) await f.runtime.tick(f.world.id, f.branch.id, run.id);
    const done = f.runtime.getRun(f.world.id, f.branch.id, run.id);
    assert.equal(done.status, 'completed', done.pauseReason + JSON.stringify(f.errors));
    assert.equal(f.model.requests.filter((r) => r.stage.startsWith('action:')).length, 1);
    assert.equal(f.model.requests.filter((r) => r.stage === 'action:extra').length, 0);
    assert.equal(f.model.requests.filter((r) => r.stage === 'adjudication').length, 3);
    assert.equal(done.textCallsUsed, 19, 'six individual actions would cost 24; only one was dispatched');
    assert.equal(f.store.events(f.world.id, f.branch.id, {}).total, 8);
    const progress = f.store.events(f.world.id, f.branch.id, {}).items.filter((e) => e.id !== 'known-0' && e.participantIds.includes('a'));
    assert.equal(new Set(progress.map((e) => e.facts[0].content)).size, 3, 'fresh daily progress actually committed');
    assert.equal(f.store.memories(f.world.id, f.branch.id).items.filter((m) => m.actorId === 'a').length, 3);
    const modes = f.db.connection.prepare('SELECT mode,count(*) AS n FROM sw_step_intents GROUP BY mode').all();
    assert.equal(modes.find((m) => m.mode === 'reused')?.n, 3);
    assert.equal(plans(f.db).find((p) => p.actorId === 'extra')?.invalidReason, 'expired');
    const actionContext = (f.model.requests.find((r) => r.stage === 'action:a')!.input as any).context;
    assert.deepEqual(actionContext.time, { relativeMinute: 1, untilRelativeMinute: 61, spanMinutes: 60, localMinuteOfDay: null, dayNightDefined: false });
    assert.equal(JSON.stringify(actionContext).includes('清晨'), false);
  } finally { await f.runtime.stop(); f.db.close(); }
});

test('sleep continues across distinct positive-duration events without another action call', async () => {
  const f = fixture(':memory:', true);
  try {
    f.model.respond = (r) => continuingAnswer(r, 'sleep');
    const run = await f.start(); for (let i = 0; i < 3; i++) await f.runtime.tick(f.world.id, f.branch.id, run.id);
    const done = f.runtime.getRun(f.world.id, f.branch.id, run.id); assert.equal(done.status, 'completed', done.pauseReason + JSON.stringify(f.errors));
    assert.equal(f.model.requests.filter((r) => r.stage === 'action:a').length, 1);
    assert.equal(f.model.requests.filter((r) => r.stage === 'adjudication').length, 3);
    assert.equal(plans(f.db)[0].status, 'active'); assert.equal(plans(f.db)[0].kind, 'routine');
    assert.equal(f.db.connection.prepare("SELECT count(*) AS n FROM sw_step_intents WHERE mode='reused'").get()?.n, 2);
    assert.ok(f.store.events(f.world.id, f.branch.id, {}).items.filter((e) => e.duration > 0).every((e) => e.stateChanges.length === 0));
  } finally { await f.runtime.stop(); f.db.close(); }
});

test('two co-located independent sleepers reuse both plans across three distinct reviewed steps', async () => {
  const f = fixture(':memory:', false, true);
  try {
    f.model.respond = sharedSleepAnswer; const run = await f.start();
    for (let i = 0; i < 3; i++) {
      const state = await f.runtime.tick(f.world.id, f.branch.id, run.id);
      assert.equal(state.status, i === 2 ? 'completed' : 'queued', state.pauseReason + JSON.stringify(f.errors));
      assert.ok(plans(f.db).every((p) => p.status === 'active' && p.invalidReason === ''));
    }
    assert.equal(f.model.requests.filter((r) => r.stage === 'action:a').length, 1);
    assert.equal(f.model.requests.filter((r) => r.stage === 'action:extra').length, 1);
    assert.equal(f.model.requests.filter((r) => r.stage === 'adjudication').length, 3);
    assert.equal(f.model.requests.filter((r) => r.stage.startsWith('adjudication-review:')).length, 3);
    assert.equal(f.db.connection.prepare("SELECT count(*) AS n FROM sw_step_intents WHERE mode='reused'").get()?.n, 4);
    const detail = f.store.detail(f.world.id, f.branch.id);
    const events = f.store.events(f.world.id, f.branch.id, {}).items; const memories = f.store.memories(f.world.id, f.branch.id).items;
    for (const actor of ['a', 'extra']) {
      const progress = events.filter((e) => e.duration > 0 && e.participantIds.includes(actor));
      assert.equal(progress.length, 3); assert.equal(new Set(progress.map((e) => e.facts[0].content)).size, 3);
      assert.ok(progress.every((e) => e.locationId === 'shop' && e.participantIds.length === 1 && e.stateChanges.length === 0));
      const context = personalContext({ worldId: f.world.id, branch: detail.branch, definition: detail.definition, states: detail.states,
        events, memories, interventions: [], storyLines: [], toTick: 181 }, actor);
      const otherContents = new Set(events.filter((e) => !e.participantIds.includes(actor)).flatMap((e) => e.facts.map((fact) => fact.content)));
      assert.ok(context.facts.every((fact) => !otherContents.has(fact.content)), 'exemption never shares the neighbor private progress');
    }
  } finally { await f.runtime.stop(); f.db.close(); }
});

test('neighbor progress needs the exact accepted review and cannot hide a received memory', async (t) => {
  for (const change of ['missing-review', 'wrong-attempt', 'rejected-review', 'received-memory'] as const) await t.test(change, async () => {
    const f = fixture(':memory:', false, true);
    try {
      f.model.respond = sharedSleepAnswer; const run = await f.start(60); const done = await f.runtime.tick(f.world.id, f.branch.id, run.id);
      assert.equal(done.status, 'completed', done.pauseReason + JSON.stringify(f.errors));
      const original = plans(f.db).find((p) => p.actorId === 'a')!; assert.equal(original.status, 'active');
      const step = f.db.connection.prepare('SELECT snapshot_json,result_json FROM sw_run_steps WHERE id=?').get(original.sourceStepId)!;
      const snapshot = JSON.parse(String(step.snapshot_json)) as WorldSimulationSnapshot;
      const result = JSON.parse(String(step.result_json)) as WorldSimulationResult;
      // These mutations represent old or inconsistent audit history in an
      // isolated test database, never a bypass in the actual runtime path.
      if (change === 'missing-review') f.db.connection.prepare("DELETE FROM sw_run_calls WHERE step_id=? AND stage_key='adjudication-review:0'").run(original.sourceStepId);
      if (change === 'wrong-attempt') f.db.connection.prepare("UPDATE sw_run_calls SET stage_key='adjudication-review:1' WHERE step_id=? AND stage_key='adjudication-review:0'").run(original.sourceStepId);
      if (change === 'rejected-review') f.db.connection.prepare("UPDATE sw_run_calls SET response_text=? WHERE step_id=? AND stage_key='adjudication-review:0'")
        .run(JSON.stringify({ approved: false, issues: ['不是既定活动的纯进度'] }), original.sourceStepId);
      if (change === 'received-memory') {
        const neighbor = result.events.find((e) => e.participantIds[0] === 'extra')!;
        result.memories.push({ ...result.memories[0], id: 'received-known-memory', actorId: 'a', sourceEventId: neighbor.id,
          content: '工匠继续清点螺钉', learnedAt: neighbor.tick + neighbor.duration });
      }
      new WorldRoutinePlans(f.db).commit(original.sourceStepId, snapshot, result);
      const interrupted = plans(f.db).find((p) => p.id === original.id)!;
      assert.equal(interrupted.status, 'invalid'); assert.equal(interrupted.invalidReason, 'new-relevant-event');
    } finally { await f.runtime.stop(); f.db.close(); }
  });
});

test('co-located unclassified facts, risks and changed state still interrupt a reviewed pure continuation', async (t) => {
  for (const change of ['unclassified', 'risk', 'external-event', 'state', 'cause', 'no-duration', 'not-continue', 'missing-outcome'] as const) await t.test(change, async () => {
    const f = fixture(':memory:', false, true);
    try {
      f.model.respond = (request) => {
        const raw = sharedSleepAnswer(request); if (request.stage !== 'adjudication' || (request.input as any).snapshot.branch.currentTick === 1) return raw;
        const value = JSON.parse(raw) as RoutineAdjudication; const event = value.events[1]; const outcome = value.planOutcomes![1];
        const snapshot = (request.input as any).snapshot as WorldSimulationSnapshot;
        if (change === 'risk') event.facts.push({ id: request.stepId + ':risk', content: '邮差发现铺位旁电线破损，有起火危险。', knownBy: ['extra'], nature: 'ai' });
        else if (change === 'external-event') value.events.push({ ...structuredClone(event), id: event.id + ':outside', tick: snapshot.toTick, duration: 0,
          facts: [{ id: request.stepId + ':noise', content: '窗外传来物体坠落的声音。', knownBy: ['extra'], nature: 'ai' }] });
        else {
          delete outcome.routineProgressFactIds;
          if (change === 'state') event.stateChanges = [{ ...snapshot.states.find((s) => s.actorId === 'extra')!, updatedTick: snapshot.toTick, emotion: '警觉' }];
          if (change === 'cause') event.causeEventIds = ['known-1'];
          if (change === 'no-duration') { event.tick = snapshot.toTick; event.duration = 0; }
          if (change === 'not-continue') outcome.status = 'blocked';
          if (change === 'missing-outcome') value.planOutcomes = value.planOutcomes!.slice(0, 1);
        }
        return JSON.stringify(value);
      };
      const run = await f.start(); await f.runtime.tick(f.world.id, f.branch.id, run.id);
      const original = plans(f.db).find((p) => p.actorId === 'a')!; assert.equal(original.status, 'active');
      const second = await f.runtime.tick(f.world.id, f.branch.id, run.id); assert.equal(second.status, 'queued', second.pauseReason + JSON.stringify(f.errors));
      const invalid = plans(f.db).find((p) => p.id === original.id)!;
      assert.equal(invalid.status, 'invalid'); assert.equal(invalid.invalidReason, 'new-relevant-event');
      assert.equal(invalid.basis.knowledge, original.basis.knowledge, 'interrupted continuation keeps prior knowledge basis');
      await f.runtime.tick(f.world.id, f.branch.id, run.id);
      assert.equal(f.model.requests.filter((r) => r.stage === 'action:a').length, 2);
    } finally { await f.runtime.stop(); f.db.close(); }
  });
});

test('a neighbor leaving and returning within a step still interrupts even when the final roster is unchanged', async () => {
  const f = fixture(':memory:', false, true);
  try {
    f.model.respond = (request) => {
      const raw = sharedSleepAnswer(request);
      if (request.stage === 'action:extra' && (request.input as any).context.tick > 1) {
        const intent = JSON.parse(raw) as RoutineIntent; intent.action = '到路口处理门外的情况'; intent.targetLocationId = 'road'; intent.plan!.kind = 'travel';
        return JSON.stringify(intent);
      }
      if (request.stage !== 'adjudication' || (request.input as any).snapshot.branch.currentTick === 1) return raw;
      const value = JSON.parse(raw) as RoutineAdjudication; const snapshot = (request.input as any).snapshot as WorldSimulationSnapshot;
      const state = snapshot.states.find((s) => s.actorId === 'extra')!; const event = value.events[1];
      event.tick = 70; event.duration = 0; event.locationId = 'road';
      event.facts = [{ id: request.stepId + ':left', content: '邮差走到路口', knownBy: ['extra'], nature: 'ai' }];
      event.stateChanges = [{ ...state, locationId: 'road', updatedTick: 70 }];
      value.events.push({ ...structuredClone(event), id: event.id + ':return', tick: 80, locationId: 'road',
        facts: [{ id: request.stepId + ':returned', content: '邮差回到工坊', knownBy: ['extra'], nature: 'ai' }],
        stateChanges: [{ ...state, locationId: 'shop', updatedTick: 80 }] });
      delete value.planOutcomes![1].routineProgressFactIds;
      // Outward movement has its own intent. Return movement has explicit
      // external-event authorization; both event locations remain remote.
      return JSON.stringify(value);
    };
    const run = await f.start(120); await f.runtime.tick(f.world.id, f.branch.id, run.id);
    const branch = f.store.getBranch(f.world.id, f.branch.id);
    f.store.intervene(f.world.id, f.branch.id, { expectedRevision: branch.revision, tick: 70, kind: 'external-event', actorIds: ['extra'], instruction: '邮差临时出门到路口，随后返回工坊' });
    const second = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(second.status, 'completed', second.pauseReason + JSON.stringify(f.errors));
    assert.equal(f.store.detail(f.world.id, f.branch.id).states.find((s) => s.actorId === 'extra')?.locationId, 'shop');
    const own = plans(f.db).find((p) => p.actorId === 'a')!;
    assert.equal(own.status, 'invalid'); assert.equal(own.invalidReason, 'companions-changed');
  } finally { await f.runtime.stop(); f.db.close(); }
});

test('plans and recorded per-step intents resume after physical disk reopen without action replay', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'routine-restart-')); const f = fixture(join(dir, 'db')); let reopened: ServiceDatabase | undefined; let second: StoryWorldRuntime | undefined;
  try {
    f.model.respond = continuingAnswer;
    const run = await f.start(120); const first = await f.runtime.tick(f.world.id, f.branch.id, run.id); assert.equal(first.status, 'queued');
    await f.runtime.stop(); f.db.close(); reopened = new ServiceDatabase(join(dir, 'db'));
    second = new StoryWorldRuntime({ ...f.options, database: reopened, store: new StoryWorldStore(reopened) });
    await second.pump(); assert.equal(second.getRun(f.world.id, f.branch.id, run.id).status, 'completed');
    assert.equal(f.model.requests.filter((r) => r.stage.startsWith('action:')).length, 1);
    assert.equal(reopened.connection.prepare("SELECT count(*) AS n FROM sw_step_intents WHERE mode='reused'").get()?.n, 2);
  } finally { await second?.stop(); await f.runtime.stop(); if (reopened) reopened.close(); else { try { f.db.close(); } catch {} } rmSync(dir, { recursive: true, force: true }); }
});

test('new knowledge invalidates a working plan while unrelated extras keep their cached intentions', async () => {
  const f = fixture();
  try {
    f.model.respond = (r) => { const raw = answer(r); if (r.stage !== 'adjudication' || (r.input as any).snapshot.branch.currentTick !== 1) return raw;
      const value = JSON.parse(raw) as RoutineAdjudication; value.events[0].facts.push({ id: 'new-loose', content: '工具柄松动，需要检查', knownBy: ['a'], nature: 'ai' }); return JSON.stringify(value); };
    const run = await f.start(120); await f.runtime.tick(f.world.id, f.branch.id, run.id); await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(f.runtime.getRun(f.world.id, f.branch.id, run.id).status, 'completed', JSON.stringify(f.errors));
    assert.equal(f.model.requests.filter((r) => r.stage === 'action:a').length, 2);
    assert.equal(plans(f.db).find((p) => p.actorId === 'a')?.invalidReason, 'new-knowledge');
    assert.equal(f.model.requests.filter((r) => r.stage === 'action:extra').length, 0);
  } finally { await f.runtime.stop(); f.db.close(); }
});

test('unlisted discoveries in the same continued event invalidate without refreshing the old basis', async () => {
  const f = fixture(':memory:', true);
  try {
    f.model.respond = (r) => { const raw = continuingAnswer(r); if (r.stage !== 'adjudication') return raw;
      const value = JSON.parse(raw) as RoutineAdjudication;
      value.events[0].facts.push({ id: r.stepId + ':damage', content: '工匠发现工具柄松动，继续使用可能受伤。', knownBy: ['a'], nature: 'ai' });
      return JSON.stringify(value); };
    const run = await f.start(120); const first = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(first.status, 'queued', first.pauseReason + JSON.stringify(f.errors));
    const old = plans(f.db)[0]; assert.equal(old.status, 'invalid'); assert.equal(old.invalidReason, 'new-knowledge');
    const before = JSON.parse(String(f.db.connection.prepare('SELECT snapshot_json FROM sw_run_steps WHERE id=?').get(old.sourceStepId)?.snapshot_json)) as WorldSimulationSnapshot;
    assert.equal(old.basis.knowledge, knowledgeFingerprint(personalContext(before, 'a')), 'invalid continuation keeps the original basis');
    await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(plans(f.db)[0].basis.knowledge, old.basis.knowledge);
    assert.equal(f.model.requests.filter((r) => r.stage === 'action:a').length, 2);
  } finally { await f.runtime.stop(); f.db.close(); }
});

test('progress references reject foreign facts, interactions, state, transfers, beliefs and new causes', async (t) => {
  const f = fixture();
  try {
    f.model.respond = continuingAnswer; const run = await f.start(60); await f.runtime.tick(f.world.id, f.branch.id, run.id);
    const request = f.model.requests.find((r) => r.stage === 'adjudication')!;
    const original = JSON.parse(continuingAnswer(request)) as RoutineAdjudication;
    const intents = (request.input as any).intents as RoutineIntent[];
    const state = (request.input as any).snapshot.states[0];
    const cases: Record<string, (value: RoutineAdjudication) => void> = {
      unknown: (v) => { v.planOutcomes![0].routineProgressFactIds = ['missing']; },
      duplicate: (v) => { v.planOutcomes![0].routineProgressFactIds!.push(v.events[0].facts[0].id); },
      foreign: (v) => { v.planOutcomes![0].routineProgressFactIds = [v.events[1].facts[0].id]; },
      interaction: (v) => { v.events[0].participantIds.push('extra'); },
      sharedKnowledge: (v) => { v.events[0].facts[0].knownBy.push('extra'); },
      state: (v) => { v.events[0].stateChanges.push({ ...state, updatedTick: 61 }); },
      noDuration: (v) => { v.events[0].duration = 0; },
      cause: (v) => { v.events[0].causeEventIds.push('known-0'); },
      blocked: (v) => { v.planOutcomes![0].status = 'blocked'; },
      transfer: (v) => { v.transfers.push({ actorId: 'extra', fromActorId: 'a', sourceEventId: v.events[0].id, factId: v.events[0].facts[0].id, meetingEventId: 'meeting' }); },
      belief: (v) => { v.beliefs = [{ actorId: 'a', sourceEventId: v.events[0].id, evidenceFactIds: [v.events[0].facts[0].id], content: '也许有人动过工具', kind: 'inferred', importance: 0.5 }]; },
    };
    assert.doesNotThrow(() => validatePlanOutcomes(original, intents));
    for (const [name, mutate] of Object.entries(cases)) await t.test(name, () => {
      const value = structuredClone(original); mutate(value);
      assert.throws(() => validatePlanOutcomes(value, intents), /日常进度/);
    });
  } finally { await f.runtime.stop(); f.db.close(); }
});

test('pure progress never hides another personal state change or an external event', async (t) => {
  for (const change of ['emotion', 'goals', 'relationship', 'external'] as const) await t.test(change, async () => {
    const f = fixture(':memory:', true);
    try {
      f.model.respond = (r) => { const raw = continuingAnswer(r); if (r.stage !== 'adjudication') return raw;
        const value = JSON.parse(raw) as RoutineAdjudication; const snapshot = (r.input as any).snapshot as WorldSimulationSnapshot;
        const event = structuredClone(value.events[0]); event.id += ':change'; event.tick = snapshot.toTick; event.duration = 0;
        event.facts = [{ ...event.facts[0], id: event.facts[0].id + ':change', content: '工匠继续清点螺钉' }];
        if (change !== 'external') event.stateChanges = [{ ...snapshot.states[0], updatedTick: snapshot.toTick,
          ...(change === 'goals' ? { goals: ['检查账簿'] } : change === 'emotion' ? { emotion: '忧虑' } : { relationships: [{ actorId: 'a', description: '更信任自己', sourceEventId: event.id }] }),
        }];
        value.events.push(event); return JSON.stringify(value); };
      const run = await f.start(60); const done = await f.runtime.tick(f.world.id, f.branch.id, run.id);
      assert.equal(done.status, 'completed', done.pauseReason + JSON.stringify(f.errors));
      const plan = plans(f.db)[0]; assert.equal(plan.status, 'invalid');
      assert.equal(plan.invalidReason, change === 'goals' ? 'goals-changed' : change === 'external' ? 'new-relevant-event' : 'personal-state-changed');
      const before = JSON.parse(String(f.db.connection.prepare('SELECT snapshot_json FROM sw_run_steps WHERE id=?').get(plan.sourceStepId)?.snapshot_json)) as WorldSimulationSnapshot;
      assert.equal(plan.basis.knowledge, knowledgeFingerprint(personalContext(before, 'a')));
    } finally { await f.runtime.stop(); f.db.close(); }
  });
});

test('director intervention, changed goals, and nearby new events invalidate rather than silently extend plans', async (t) => {
  for (const change of ['director', 'goals', 'companion', 'event', 'expiry'] as const) await t.test(change, async () => {
    const f = fixture();
    try {
      const run = await f.start(360); await f.runtime.tick(f.world.id, f.branch.id, run.id);
      if (change === 'director') f.store.intervene(f.world.id, f.branch.id, { expectedRevision: f.store.getBranch(f.world.id, f.branch.id).revision, tick: 62, kind: 'goal', actorIds: ['a'], instruction: '检查账簿' });
      else if (change === 'expiry') { for (const plan of plans(f.db)) { plan.validUntil = 62; f.db.connection.prepare('UPDATE sw_actor_plans SET valid_until=62,data_json=? WHERE id=?').run(JSON.stringify(plan), plan.id); } }
      else {
        const state = f.store.detail(f.world.id, f.branch.id).states.find((s) => s.actorId === (change === 'companion' ? 'extra' : 'a'))!;
        const updated = { ...state, updatedTick: 62, ...(change === 'goals' ? { goals: ['检查账簿'] } : change === 'companion' ? { locationId: 'shop' } : {}) };
        const e: WorldEvent = { id: 'external-' + change, worldId: f.world.id, branchId: f.branch.id, tick: 62, duration: 0, title: '环境变化', summary: '',
          locationId: updated.locationId, participantIds: [updated.actorId], facts: [{ id: 'new-' + change, content: '角色仍在此处', knownBy: [updated.actorId], nature: 'ai' }],
          perspectives: [], stateChanges: change === 'event' ? [] : [updated], storyLineIds: [], causeEventIds: [], createdAt: '' };
        f.store.commitStep(f.world.id, f.branch.id, f.store.getBranch(f.world.id, f.branch.id).revision, { tick: 62, events: [e], states: [], memories: [], consumedInterventionIds: [] });
        const latest = f.runtime.getRun(f.world.id, f.branch.id, run.id);
        f.db.connection.prepare('UPDATE sw_runs SET data_json=? WHERE id=?').run(JSON.stringify({ ...latest, completedTick: 62 }), run.id);
      }
      await f.runtime.tick(f.world.id, f.branch.id, run.id);
      const old = plans(f.db).find((p) => p.actorId === 'a')!;
      assert.equal(old.status, 'invalid');
      assert.equal(old.invalidReason, { director: 'director-intervention', goals: 'goals-changed', companion: 'companions-changed', event: 'new-knowledge', expiry: 'expired' }[change]);
      assert.equal(f.model.requests.filter((r) => r.stage === 'action:a').length, 2, JSON.stringify(f.errors));
    } finally { await f.runtime.stop(); f.db.close(); }
  });
});

test('historical forks rebuild decisions in their own scope and never inherit future plan state', async () => {
  const f = fixture();
  try {
    const run = await f.start(120); await f.runtime.tick(f.world.id, f.branch.id, run.id); await f.runtime.tick(f.world.id, f.branch.id, run.id);
    const fork = f.store.createBranch(f.world.id, { expectedRevision: f.world.revision, title: '过去', mode: 'adaptation', direction: '', parentBranchId: f.branch.id, forkTick: 61 });
    assert.equal(f.db.connection.prepare('SELECT count(*) AS n FROM sw_actor_plans WHERE branch_id=?').get(fork.id)?.n, 0);
    const next = await f.runtime.start(f.world.id, fork.id, { expectedRevision: fork.revision, idempotencyKey: 'fork', settings: { ...DEFAULT_WORLD_RUN_SETTINGS, durationTicks: 60 } });
    await f.runtime.tick(f.world.id, fork.id, next.id);
    assert.equal(f.runtime.getRun(f.world.id, fork.id, next.id).status, 'completed', JSON.stringify(f.errors));
    assert.equal(f.model.requests.filter((r) => r.branchId === fork.id && r.stage === 'action:a').length, 1);
    assert.ok(plans(f.db).filter((p) => p.branchId === fork.id).every((p) => p.validFrom === 61));
    const contexts = f.model.requests.filter((r) => r.branchId === fork.id && r.stage.startsWith('action:')).map((r) => (r.input as any).context);
    assert.ok(contexts.every((c) => c.memorySummary.branchId === fork.id && c.facts.every((fact: any) => fact.tick <= 61)));
  } finally { await f.runtime.stop(); f.db.close(); }
});

test('a travel plan retries only the intention and ends on adjudicated arrival, never teleports on expiry', async () => {
  const f = fixture(':memory:', true);
  try {
    f.model.respond = (request) => {
      if (request.stage === 'action:a') { const context = (request.input as any).context;
        return JSON.stringify({ actorId: 'a', action: '步行前往路口', targetLocationId: 'road', prerequisiteFactIds: [], interactWithActorIds: [], plan: { kind: 'travel', validUntil: context.tick + 240 } } satisfies RoutineIntent); }
      if (request.stage === 'action:extra') { const value = JSON.parse(answer(request)); value.plan.kind = 'routine'; return JSON.stringify(value); }
      const raw = continuingAnswer(request, 'travel'); if (request.stage !== 'adjudication') return raw;
      const value = JSON.parse(raw) as RoutineAdjudication; const snapshot = (request.input as any).snapshot as WorldSimulationSnapshot;
      if (snapshot.branch.currentTick < 61) { value.events = value.events.slice(0, 1); value.planOutcomes = value.planOutcomes!.slice(0, 1); return JSON.stringify(value); }
      value.events[0].locationId = 'road'; value.events[0].facts = [{ id: request.stepId + ':arrival', content: '工匠步行抵达路口', knownBy: ['a'], nature: 'ai' }];
      value.events[0].stateChanges = [{ ...snapshot.states.find((s) => s.actorId === 'a')!, locationId: 'road', updatedTick: snapshot.toTick }];
      delete value.planOutcomes![0].routineProgressFactIds;
      return JSON.stringify(value);
    };
    const run = await f.start(120); await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(f.store.detail(f.world.id, f.branch.id).states.find((s) => s.actorId === 'a')!.locationId, 'shop');
    assert.equal(plans(f.db).find((p) => p.actorId === 'a')?.kind, 'travel');
    await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(f.runtime.getRun(f.world.id, f.branch.id, run.id).status, 'completed', f.runtime.getRun(f.world.id, f.branch.id, run.id).pauseReason + JSON.stringify(f.errors));
    assert.equal(f.store.detail(f.world.id, f.branch.id).states.find((s) => s.actorId === 'a')!.locationId, 'road');
    assert.equal(f.model.requests.filter((r) => r.stage === 'action:a').length, 1);
    assert.equal(plans(f.db).find((p) => p.actorId === 'a')?.status, 'completed');
    assert.equal(plans(f.db).find((p) => p.actorId === 'a')?.invalidReason, 'arrived');
  } finally { await f.runtime.stop(); f.db.close(); }
});

test('plan activation rolls back with world commit and a restarted pending step reuses durable decisions', async () => {
  const f = fixture(); let second: StoryWorldRuntime | undefined;
  try {
    f.model.respond = continuingAnswer;
    const original = f.store.commitStep.bind(f.store); let fail = true;
    f.store.commitStep = (...args: Parameters<typeof original>) => { const branch = original(...args); if (args[3].run && fail) throw new Error('injected commit failure'); return branch; };
    const run = await f.start(120); await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(f.runtime.getRun(f.world.id, f.branch.id, run.id).status, 'paused');
    assert.equal(f.store.getBranch(f.world.id, f.branch.id).currentTick, 1);
    assert.ok(plans(f.db).every((p) => p.status === 'pending'));
    const calls = f.model.requests.length; fail = false; await f.runtime.stop();
    second = new StoryWorldRuntime(f.options); await second.resume(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision);
    const committed = await second.tick(f.world.id, f.branch.id, run.id);
    assert.equal(committed.status, 'queued'); assert.equal(f.model.requests.length, calls);
    assert.ok(plans(f.db).some((p) => p.status === 'active'));
  } finally { await second?.stop(); await f.runtime.stop(); f.db.close(); }
});

test('unknown adjudication recovery validates reused travel intents without new action rows', async () => {
  const f = fixture(':memory:', true);
  try {
    f.model.respond = (request) => {
      if (request.stage === 'action:a') { const context = (request.input as any).context; return JSON.stringify({ actorId: 'a', action: '步行前往路口', targetLocationId: 'road',
        prerequisiteFactIds: [], interactWithActorIds: [], plan: { kind: 'travel', validUntil: context.tick + 240 } }); }
      if (request.stage === 'action:extra') { const value = JSON.parse(answer(request)); value.plan.kind = 'routine'; return JSON.stringify(value); }
      if (request.stage === 'adjudication') {
        if ((request.input as any).snapshot.branch.currentTick > 1) throw new Error('transport timeout');
        const value = JSON.parse(answer(request)) as RoutineAdjudication; value.events = value.events.slice(0, 1); value.planOutcomes = value.planOutcomes!.slice(0, 1); return JSON.stringify(value);
      }
      return answer(request);
    };
    const run = await f.start(120); await f.runtime.tick(f.world.id, f.branch.id, run.id); await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(f.runtime.getRun(f.world.id, f.branch.id, run.id).status, 'uncertain', f.runtime.getRun(f.world.id, f.branch.id, run.id).pauseReason);
    await assert.rejects(f.runtime.resume(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision), (e: any) => e.code === 'story_run_call_uncertain');
    const request = f.model.requests.at(-1)!; const output = JSON.parse(answer(request)) as RoutineAdjudication;
    const snapshot = (request.input as any).snapshot as WorldSimulationSnapshot;
    output.events[0].locationId = 'road'; output.events[0].facts = [{ id: request.stepId + ':arrival', content: '工匠抵达路口', knownBy: ['a'], nature: 'ai' }];
    output.events[0].stateChanges = [{ ...snapshot.states.find((s) => s.actorId === 'a')!, locationId: 'road', updatedTick: snapshot.toTick }];
    const recovery = f.runtime.recovery(f.world.id, f.branch.id, run.id).items[0];
    const resolved = f.runtime.resolveCall(f.world.id, f.branch.id, run.id, recovery.id, { expectedRevision: f.store.getBranch(f.world.id, f.branch.id).revision,
      resolution: 'received-result', evidence: '隔离测试已收到原始结果', responseText: JSON.stringify(output) });
    f.model.respond = answer; await f.runtime.resume(f.world.id, f.branch.id, run.id, resolved.branchRevision);
    const done = await f.runtime.tick(f.world.id, f.branch.id, run.id); assert.equal(done.status, 'completed', done.pauseReason + JSON.stringify(f.errors));
    assert.equal(f.model.requests.filter((r) => r.stage === 'action:a').length, 1);
    assert.equal(f.model.requests.filter((r) => r.stage === 'adjudication').length, 2);
    assert.equal(f.store.detail(f.world.id, f.branch.id).states.find((s) => s.actorId === 'a')!.locationId, 'road');
  } finally { await f.runtime.stop(); f.db.close(); }
});

test('new invalid output still gets one charged correction and cannot revive an invalid step', async () => {
  const f = fixture();
  try {
    f.model.respond = (request) => request.stage === 'adjudication' ? '{}' : answer(request);
    const run = await f.start(); const paused = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(paused.status, 'paused'); assert.equal(paused.textCallsUsed, 3);
    assert.equal(f.model.requests.filter((r) => r.stage === 'adjudication').length, 2);
    assert.ok(plans(f.db).every((p) => p.status === 'invalid' && p.invalidReason === 'validation-failed'));
    await assert.rejects(f.runtime.resume(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision), (e: any) => e.code === 'story_run_validation_failed');
  } finally { await f.runtime.stop(); f.db.close(); }
});

test('an idle extra with newly relevant knowledge or a main character nearby receives a separate action decision', async () => {
  const f = fixture();
  try {
    f.model.respond = (r) => { const raw = answer(r); if (r.stage !== 'adjudication' || (r.input as any).snapshot.branch.currentTick !== 1) return raw;
      const value = JSON.parse(raw) as RoutineAdjudication; value.events[1].facts.push({ id: 'extra-new', content: '邮差发现包裹破损', knownBy: ['extra'], nature: 'ai' }); return JSON.stringify(value); };
    const run = await f.start(120); await f.runtime.tick(f.world.id, f.branch.id, run.id); await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(f.runtime.getRun(f.world.id, f.branch.id, run.id).status, 'completed');
    assert.equal(f.model.requests.filter((r) => r.stage === 'action:extra').length, 1);
    assert.equal(plans(f.db).find((p) => p.actorId === 'extra')?.invalidReason, 'new-knowledge');
  } finally { await f.runtime.stop(); f.db.close(); }
});

test('changed clock configuration invalidates a plan without exposing the free time label', async () => {
  const f = fixture();
  try {
    const run = await f.start(120); await f.runtime.tick(f.world.id, f.branch.id, run.id);
    const detail = f.store.detail(f.world.id, f.branch.id);
    const snapshot: WorldSimulationSnapshot = { worldId: f.world.id, branch: detail.branch, definition: { ...detail.definition, models: f.runtime.effectiveModels(run.id), startMinuteOfDay: 480 } as WorldDefinition,
      states: detail.states, events: f.store.events(f.world.id, f.branch.id, {}).items, memories: f.store.memories(f.world.id, f.branch.id).items, interventions: [], storyLines: [], toTick: 121 };
    const stepId = 'clock-change'; f.db.connection.prepare("INSERT INTO sw_run_steps(id,run_id,step_key,from_tick,to_tick,branch_revision,status,snapshot_json,created_at,updated_at) VALUES (?,?,?,?,?,?,'pending',?,'','')")
      .run(stepId, run.id, 'clock-change', 61, 121, detail.branch.revision, JSON.stringify(snapshot));
    assert.equal(new WorldRoutinePlans(f.db).decision(stepId, snapshot, 'a'), null);
    assert.equal(plans(f.db).find((p) => p.actorId === 'a')?.invalidReason, 'world-inputs-changed');
  } finally { await f.runtime.stop(); f.db.close(); }
});

test('an extra already sharing a location with a main actor is active rather than treated as a distant passerby', async () => {
  const f = fixture();
  try {
    const state = f.store.detail(f.world.id, f.branch.id).states.find((s) => s.actorId === 'extra')!;
    const event: WorldEvent = { id: 'extra-arrived', worldId: f.world.id, branchId: f.branch.id, tick: 2, duration: 0, title: '到访', summary: '', locationId: 'shop', participantIds: ['extra'],
      facts: [{ id: 'arrival-fact', content: '邮差来到工坊', knownBy: ['extra'], nature: 'ai' }], perspectives: [], causeEventIds: [], storyLineIds: [], stateChanges: [{ ...state, locationId: 'shop', updatedTick: 2 }], createdAt: '' };
    f.store.commitStep(f.world.id, f.branch.id, f.store.getBranch(f.world.id, f.branch.id).revision, { tick: 2, events: [event], states: [], memories: [], consumedInterventionIds: [] });
    const run = await f.start(60); await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(f.runtime.getRun(f.world.id, f.branch.id, run.id).status, 'completed', JSON.stringify(f.errors));
    assert.equal(f.model.requests.filter((r) => r.stage === 'action:extra').length, 1);
  } finally { await f.runtime.stop(); f.db.close(); }
});

test('migration 57 is repeatable on a physical version-56 database and leaves existing stories untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'world-plan-migration-')); const path = join(dir, 'db');
  let db: ServiceDatabase | undefined = new ServiceDatabase(path);
  try {
    const before = db.connection.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map((row) => row.name);
    const version = db.connection.prepare('SELECT max(version) AS version FROM schema_migrations').get()?.version;
    db.connection.prepare("INSERT INTO runtime_settings(key,value_json,updated_at) VALUES ('routine-migration-sentinel',?,'')").run(JSON.stringify({ keep: true }));
    for (let i = 0; i < 2; i++) for (const sql of WORLD_ROUTINE_MIGRATION_STATEMENTS) db.connection.exec(sql);
    db.close(); db = new ServiceDatabase(path);
    assert.equal(db.connection.prepare('SELECT max(version) AS version FROM schema_migrations').get()?.version, version, 'host owns migration registration');
    assert.equal(db.connection.prepare("SELECT value_json FROM runtime_settings WHERE key='routine-migration-sentinel'").get()?.value_json, '{"keep":true}');
    for (const name of before) assert.ok(db.connection.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(String(name)));
    for (const name of ['sw_actor_plans', 'sw_step_intents', 'sw_memory_summaries']) assert.ok(db.connection.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name));
    assert.equal(db.connection.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok'); assert.deepEqual(db.connection.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('adding migration 57 during an old pending run reuses completed calls instead of replaying them', async () => {
  const f = fixture(':memory:', true); let old: StoryWorldRuntime | undefined; let upgraded: StoryWorldRuntime | undefined;
  try {
    for (const table of ['sw_step_intents', 'sw_actor_plans', 'sw_memory_summaries']) f.db.connection.exec('DROP TABLE ' + table);
    f.model.respond = (request) => {
      if (request.stage.startsWith('action:')) { const value = JSON.parse(answer(request)); delete value.plan; return JSON.stringify(value); }
      if (request.stage === 'adjudication') throw new Error('unknown response');
      return answer(request);
    };
    old = new StoryWorldRuntime(f.options); const run = await old.start(f.world.id, f.branch.id, { expectedRevision: f.store.getBranch(f.world.id, f.branch.id).revision, idempotencyKey: 'old-run',
      settings: { ...DEFAULT_WORLD_RUN_SETTINGS, durationTicks: 60 } });
    assert.equal((await old.tick(f.world.id, f.branch.id, run.id)).status, 'uncertain');
    const missing = f.model.requests.at(-1)!; await old.stop();
    for (const sql of WORLD_ROUTINE_MIGRATION_STATEMENTS) f.db.connection.exec(sql);
    upgraded = new StoryWorldRuntime(f.options);
    const received = JSON.parse(answer(missing)) as RoutineAdjudication; delete received.planOutcomes;
    const resolved = upgraded.resolveCall(f.world.id, f.branch.id, run.id, missing.callId, { expectedRevision: f.store.getBranch(f.world.id, f.branch.id).revision, resolution: 'received-result', evidence: '原始结果已核对', responseText: JSON.stringify(received) });
    f.model.respond = answer; await upgraded.resume(f.world.id, f.branch.id, run.id, resolved.branchRevision);
    const done = await upgraded.tick(f.world.id, f.branch.id, run.id); assert.equal(done.status, 'completed', done.pauseReason);
    assert.equal(f.model.requests.filter((r) => r.stage === 'action:a').length, 1);
    assert.equal(f.model.requests.filter((r) => r.stage === 'adjudication').length, 1);
  } finally { await upgraded?.stop(); await old?.stop(); await f.runtime.stop(); f.db.close(); }
});
