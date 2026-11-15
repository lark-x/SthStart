import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_WORLD_RUN_SETTINGS, type WorldDefinition, type WorldRunSettings } from '@sthstart/contracts';
import { ServiceDatabase } from '../database.js';
import type { ServiceConfig } from '../config.js';
import { SecretStore } from '../security.js';
import { createAiCallRecord, updateAiCallRecord } from '../ai-call-trace.js';
import { STORY_WORLD_MIGRATION_STATEMENTS } from './migration.js';
import { WORLD_RUNTIME_MIGRATION_STATEMENTS, WORLD_RUNTIME_NOTIFICATION_MIGRATION_STATEMENTS } from './runtime-migration.js';
import { StoryWorldStore } from './store.js';
import { StoryWorldRuntime, WORLD_RUNTIME_PENDING_NOTIFICATIONS_SQL, type StoryWorldRuntimeOptions } from './runtime.js';
import type { WorldCallResolution, WorldModelAdapter, WorldModelRequest } from './model.js';
import { personalContext, type WorldAdjudication, type WorldIntent, type WorldSimulationSnapshot } from './simulation.js';
import { memorySummaryLimits, type PersonalMemorySummary } from './runtime.memory.js';
import { narrationCorrectionIssues } from './narration.js';

function definition(): WorldDefinition {
  return { title: '持续生活', summary: '港口和茶室的日常。', timeLabel: '起点',
    locations: [{ id: 'port', name: '港口', description: '' }, { id: 'tea', name: '茶室', description: '' }],
    actors: ['a', 'b'].map((id) => ({ id, name: id, role: 'main', characterId: null, characterVersion: null,
      background: '普通居民', personality: '谨慎', speechStyle: '', appearance: '', goals: ['工作'], locationId: id === 'a' ? 'port' : 'tea', referenceArtifactIds: [] })),
    sources: [{ id: 'canon', title: '原作', content: '不能发生飞行。', nature: 'canon', sourceUrl: '', sourceVersion: '1', capturedAt: '2026-01-01' }],
    lockedFacts: ['不能飞行'], models: { action: null, adjudication: null, narration: null }, visualStyle: '' };
}
function goodAnswer(request: WorldModelRequest): string {
  const input = request.input as Record<string, any>;
  if (request.stage.startsWith('action:')) {
    const context = input.context;
    return JSON.stringify({ actorId: context.actor.id, action: context.beliefs?.length ? '根据个人误解采取防范' : '完成自己的工作', targetLocationId: context.state.locationId,
      prerequisiteFactIds: [], interactWithActorIds: [] });
  }
  if (request.stage === 'adjudication') {
    const s = input.snapshot as WorldSimulationSnapshot;
    const result: WorldAdjudication = { events: s.definition.actors.map((a, i) => ({ id: request.stepId + ':e:' + i, tick: s.toTick, duration: 0,
      title: a.name + '的工作', summary: '日常结果', locationId: s.states.find((state) => state.actorId === a.id)!.locationId, participantIds: [a.id],
      facts: [{ id: request.stepId + ':f:' + i, content: a.name + '完成了工作', knownBy: [a.id], nature: 'ai' }],
      causeEventIds: [], storyLineIds: [], stateChanges: [] })), supportingActors: [], transfers: [], consumedInterventionIds: s.interventions.filter((i) => !i.consumed).map((i) => i.id), violatedLockedFacts: [] };
    return JSON.stringify(result);
  }
  if (request.stage.startsWith('narration:')) return JSON.stringify({ passages: input.events.map((event: any) => ({ eventId: event.id, actorId: input.actor.id,
    factIds: event.facts.map((f: any) => f.id), text: event.facts.map((f: any) => f.content).join('。') })) });
  if (request.stage.includes('-review:')) return JSON.stringify({ approved: true, issues: [] });
  throw new Error('unknown fake stage ' + request.stage);
}
class FakeModel implements WorldModelAdapter {
  requests: WorldModelRequest[] = [];
  prepared: string[] = [];
  respond: (request: WorldModelRequest) => string | Promise<string> = goodAnswer;
  resolution: WorldCallResolution = { status: 'unknown' };
  async prepare(request: WorldModelRequest) { this.prepared.push(request.purpose); return { profileId: 'fake-' + request.purpose }; }
  async execute(request: WorldModelRequest) { this.requests.push(structuredClone(request)); return this.respond(request); }
  async reconcile(_request: WorldModelRequest) { return this.resolution; }
}
function setup(path = ':memory:', inputDefinition = definition()) {
  const database = new ServiceDatabase(path);
  for (const sql of [...STORY_WORLD_MIGRATION_STATEMENTS, ...WORLD_RUNTIME_MIGRATION_STATEMENTS, ...WORLD_RUNTIME_NOTIFICATION_MIGRATION_STATEMENTS]) database.connection.exec(sql);
  const store = new StoryWorldStore(database);
  const world = store.create(inputDefinition);
  const branch = store.createBranch(world.id, { title: '主分支', mode: 'canon-gap', direction: '人物各自生活', expectedRevision: world.revision });
  const model = new FakeModel();
  const errors: unknown[] = [];
  const options: StoryWorldRuntimeOptions = { database, store, config: {} as ServiceConfig, secrets: new SecretStore({}), modelAdapter: model, onError: (e) => { errors.push(e); } };
  const runtime = new StoryWorldRuntime(options);
  const start = (settings: Partial<WorldRunSettings> = {}, key = 'start') => runtime.start(world.id, branch.id, {
    expectedRevision: store.getBranch(world.id, branch.id).revision, idempotencyKey: key,
    settings: { ...DEFAULT_WORLD_RUN_SETTINGS, durationTicks: 60, stepTicks: 60, ...settings },
  });
  return { database, store, world, branch, model, options, runtime, errors, start };
}
const code = (expected: string) => (e: unknown) => (e as { code: string }).code === expected;
const receivedFinalSample = JSON.parse(readFileSync(new URL('./simulation-sol-final.fixture.json', import.meta.url), 'utf8')) as {
  definition: WorldDefinition; branch: Pick<WorldSimulationSnapshot['branch'], 'mode' | 'direction' | 'currentTick'>;
  states: WorldSimulationSnapshot['states']; toTick: number; intents: WorldIntent[]; responses: WorldAdjudication[];
};

test('preflight, independent daily actions, frozen purposes and atomic multi-view persistence', async () => {
  const f = setup();
  try {
    const notifications: any[] = [];
    f.options.afterStep = (s) => { notifications.push(s); };
    const run = await f.start();
    assert.deepEqual(f.model.prepared, ['action', 'adjudication', 'narration']);
    assert.deepEqual(f.runtime.effectiveModels(run.id), { action: 'fake-action', adjudication: 'fake-adjudication', narration: 'fake-narration' });
    const done = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(done.status, 'completed', JSON.stringify(f.errors));
    assert.equal(done.completedTick, 60);
    assert.equal(done.textCallsUsed, 8);
    const detail = f.store.detail(f.world.id, f.branch.id);
    assert.equal(detail.branch.currentTick, 60);
    const events = f.store.events(f.world.id, f.branch.id, {}).items;
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((e) => e.perspectives[0].actorId).sort(), ['a', 'b']);
    assert.equal(f.store.memories(f.world.id, f.branch.id).items.length, 2);
    const personal = f.model.requests.find((r) => r.stage === 'action:a')!;
    assert.equal(JSON.stringify(personal.input).includes('不能发生飞行'), false);
    assert.equal(JSON.stringify(personal.input).includes('sourceVersion'), false);
    for (const actorId of ['a', 'b']) {
      const narration = f.model.requests.find((r) => r.stage === 'narration:' + actorId)!.input as any;
      assert.equal(narration.ownIntent.actorId, actorId);
      assert.equal(narration.ownIntent.action, '完成自己的工作');
      assert.equal(narration.intents, undefined, 'narration receives only its own intent, never other actors private choices');
    }
    assert.equal(notifications.length, 1); assert.equal(notifications[0].run.status, 'completed');
    await f.runtime.pump(); assert.equal(notifications.length, 1);
    assert.equal(f.database.connection.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('routine progress classification reaches semantic review and a rejected discovery is corrected without retaining its plan', async () => {
  const f = setup();
  try {
    f.model.respond = (request) => {
      const value = JSON.parse(goodAnswer(request));
      if (request.stage === 'action:a') value.plan = { kind: 'work', validUntil: 240 };
      if (request.stage === 'adjudication') {
        const event = value.events[0]; event.tick = 1; event.duration = 59;
        value.events.sort((a: any, b: any) => a.tick - b.tick);
        event.facts[0].content = '整理时发现工具柄松动，需要重新检查';
        value.planOutcomes = [{ actorId: 'a', status: 'continue', eventIds: [event.id],
          ...(request.correction ? {} : { routineProgressFactIds: [event.facts[0].id] }) }];
      }
      if (request.stage === 'adjudication-review:0') {
        const input = request.input as any;
        assert.equal(input.payload.planOutcomes[0].routineProgressFactIds.length, 1);
        assert.equal(typeof input.routineReview, 'string');
        return JSON.stringify({ approved: false, issues: ['新发现不能标记为纯日常进度'] });
      }
      return JSON.stringify(value);
    };
    const run = await f.start();
    const done = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(done.status, 'completed', done.pauseReason + JSON.stringify(f.errors));
    assert.equal(f.model.requests.filter(r => r.stage === 'adjudication').length, 2);
    const plan = f.database.connection.prepare("SELECT status,invalid_reason FROM sw_actor_plans WHERE actor_id='a'").get();
    assert.equal(plan?.status, 'invalid'); assert.equal(plan?.invalid_reason, 'new-knowledge');
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('idempotency and branch exclusivity include paused runs', async () => {
  const f = setup();
  try {
    const run = await f.start(); const replay = await f.start(); assert.equal(replay.id, run.id);
    await assert.rejects(f.start({ maxTextCalls: 99 }), code('story_run_idempotency_conflict'));
    f.runtime.pause(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision);
    await assert.rejects(f.start({}, 'second'), code('story_branch_run_active'));
    f.runtime.cancel(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision);
    const next = await f.start({}, 'second'); assert.notEqual(next.id, run.id);
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('one correction is charged and a second invalid output pauses permanently until cancel', async () => {
  const f = setup();
  try {
    f.model.respond = () => '{}';
    const run = await f.start();
    const paused = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(paused.status, 'paused'); assert.equal(paused.textCallsUsed, 2);
    assert.match(paused.pauseReason, /一次修正/);
    assert.ok(f.model.requests[1].correction);
    assert.equal(f.store.events(f.world.id, f.branch.id, {}).items.length, 0);
    await assert.rejects(f.runtime.resume(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision), code('story_run_validation_failed'));
    assert.equal(f.model.requests.length, 2);
    assert.equal(f.store.getBranch(f.world.id, f.branch.id).currentTick, 0);
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('budget before correction is a hard limit and can be explicitly raised without replay', async () => {
  const f = setup();
  try {
    f.model.respond = (r) => r.stage === 'action:a' && !r.correction ? '{}' : goodAnswer(r);
    const run = await f.start({ maxTextCalls: 1 });
    const paused = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(paused.status, 'paused'); assert.equal(paused.textCallsUsed, 1); assert.equal(f.model.requests.length, 1);
    await assert.rejects(f.runtime.resume(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision,
      { ...run.settings, maxTextCalls: 0 }), code('story_run_settings_invalid'));
    await assert.rejects(f.runtime.resume(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision), code('story_run_budget_exhausted'));
    await f.runtime.resume(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision,
      { ...run.settings, maxTextCalls: 20, durationTicks: 120 });
    const next = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(next.status, 'queued', JSON.stringify(f.errors)); assert.equal(next.targetTick, 120); assert.equal(next.textCallsUsed, 9);
    assert.equal(f.model.requests.filter((r) => r.stage === 'action:a').length, 2);
    assert.equal((await f.start({ maxTextCalls: 1 })).id, run.id, 'start replay compares original settings after resume changes the live budget');
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('unknown transport results survive restart and cannot be blindly resumed or cancelled', async () => {
  const f = setup();
  try {
    f.model.respond = async () => { throw new Error('timeout'); };
    const run = await f.start();
    assert.equal((await f.runtime.tick(f.world.id, f.branch.id, run.id)).status, 'uncertain');
    await f.runtime.stop();
    const restarted = new StoryWorldRuntime(f.options);
    await restarted.pump();
    await assert.rejects(restarted.resume(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision), code('story_run_call_uncertain'));
    assert.throws(() => restarted.cancel(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision), code('story_run_call_uncertain'));
    assert.equal(f.model.requests.length, 1);
    f.model.resolution = { status: 'succeeded', text: goodAnswer(f.model.requests[0]) };
    f.model.respond = goodAnswer;
    await restarted.resume(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision);
    assert.equal((await restarted.tick(f.world.id, f.branch.id, run.id)).status, 'completed');
    assert.equal(f.model.requests.filter((r) => r.stage === 'action:a').length, 1);
    await restarted.stop();
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('pump isolates corrupt uncertain calls so a queued world completes after restart', async (t) => {
  for (const requestJson of ['{}', '{']) await t.test('request_json=' + requestJson, async () => {
    const f = setup();
    let restarted: StoryWorldRuntime | undefined;
    try {
      f.model.respond = async () => { throw new Error('lost response'); };
      const damaged = await f.start();
      assert.equal((await f.runtime.tick(f.world.id, f.branch.id, damaged.id)).status, 'uncertain');
      await f.runtime.stop();
      f.database.connection.prepare("UPDATE sw_run_calls SET request_json=? WHERE step_id IN (SELECT id FROM sw_run_steps WHERE run_id=?)").run(requestJson, damaged.id);
      f.database.connection.prepare('UPDATE sw_runs SET created_at=? WHERE id=?').run('2000-01-01', damaged.id);
      f.model.respond = goodAnswer;
      f.model.reconcile = async (request: WorldModelRequest) => {
        if (typeof request.callId !== 'string') throw new Error('corrupt persisted request has no callId');
        return { status: 'unknown' };
      };
      const delivered: string[] = [];
      restarted = new StoryWorldRuntime({ ...f.options, afterStep: (step) => { delivered.push(step.runId); } });
      const healthyWorld = f.store.create(definition());
      const healthyBranch = f.store.createBranch(healthyWorld.id, { title: '正常分支', mode: 'canon-gap', direction: '', expectedRevision: healthyWorld.revision });
      const healthy = await restarted.start(healthyWorld.id, healthyBranch.id, {
        expectedRevision: healthyBranch.revision, idempotencyKey: 'healthy',
        settings: { ...DEFAULT_WORLD_RUN_SETTINGS, durationTicks: 60, stepTicks: 60 },
      });
      await assert.doesNotReject(restarted.pump());
      const done = restarted.getRun(healthyWorld.id, healthyBranch.id, healthy.id);
      assert.equal(done.status, 'completed'); assert.equal(done.textCallsUsed, 8);
      assert.equal(f.model.requests.filter((request) => request.runId === healthy.id).length, 8);
      assert.equal(restarted.getRun(f.world.id, f.branch.id, damaged.id).status, 'uncertain');
      assert.equal(f.model.requests.filter((request) => request.runId === damaged.id).length, 1);
      assert.equal(f.errors.length, 1); assert.ok(f.errors[0] instanceof Error);
      assert.deepEqual(delivered, [healthy.id]);
      await restarted.pump();
      assert.equal(f.errors.length, 2); assert.equal(f.model.requests.length, 9);
      assert.deepEqual(delivered, [healthy.id]);
      const record = f.database.connection.prepare('SELECT status,request_json FROM sw_run_calls WHERE step_id IN (SELECT id FROM sw_run_steps WHERE run_id=?)').get(damaged.id);
      assert.equal(record?.status, 'uncertain'); assert.equal(record?.request_json, requestJson);
      assert.equal(f.store.getBranch(f.world.id, f.branch.id).currentTick, 0);
    } finally { await restarted?.stop(); await f.runtime.stop(); f.database.close(); }
  });
});

test('pause during dispatch preserves completed call, and another runtime cannot claim its live lease', async () => {
  const f = setup();
  try {
    let release!: (s: string) => void; let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    f.model.respond = (r) => { if (r.stage === 'action:a') { entered(); return new Promise<string>((resolve) => { release = resolve; }); } return goodAnswer(r); };
    const run = await f.start(); const pending = f.runtime.tick(f.world.id, f.branch.id, run.id); await waiting;
    const other = new StoryWorldRuntime(f.options);
    await other.tick(f.world.id, f.branch.id, run.id); assert.equal(f.model.requests.length, 1);
    f.runtime.pause(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision);
    release(goodAnswer(f.model.requests[0])); await pending;
    assert.equal(f.store.getBranch(f.world.id, f.branch.id).currentTick, 0);
    await f.runtime.stop(); f.model.respond = goodAnswer;
    await other.resume(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision);
    const done = await other.tick(f.world.id, f.branch.id, run.id);
    assert.equal(done.status, 'completed', JSON.stringify(f.errors)); assert.equal(done.textCallsUsed, 8);
    assert.equal(f.model.requests.filter((r) => r.stage === 'action:a').length, 1);
    await other.stop();
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('shutdown saves the in-flight result and disk reopen resumes completed stages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'world-runtime-')); const path = join(dir, 'test.db');
  const f = setup(path);
  let reopened: ServiceDatabase | undefined;
  try {
    let entered!: () => void; let release!: (s: string) => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    f.model.respond = () => { entered(); return new Promise<string>((resolve) => { release = resolve; }); };
    const run = await f.start(); const pending = f.runtime.tick(f.world.id, f.branch.id, run.id); await waiting;
    const stopping = f.runtime.stop(); release(goodAnswer(f.model.requests[0])); await stopping; await pending;
    assert.equal(f.runtime.getRun(f.world.id, f.branch.id, run.id).status, 'queued');
    f.database.close(); reopened = new ServiceDatabase(path);
    const second = new StoryWorldRuntime({ ...f.options, database: reopened, store: new StoryWorldStore(reopened) });
    f.model.respond = goodAnswer;
    await second.pump(); assert.equal(second.getRun(f.world.id, f.branch.id, run.id).status, 'completed');
    assert.equal(f.model.requests.filter((r) => r.stage === 'action:a').length, 1);
    const used = f.model.requests.length; await second.pump(); assert.equal(f.model.requests.length, used);
    await second.stop();
  } finally { if (reopened) reopened.close(); else { try { f.database.close(); } catch {} } rmSync(dir, { recursive: true, force: true }); }
});

test('AI veto corrects original adjudication or prose once instead of retrying approval', async () => {
  const f = setup();
  try {
    f.model.respond = (r) => r.stage === 'adjudication-review:0' || r.stage === 'narration-review:a:0'
      ? JSON.stringify({ approved: false, issues: ['违反锁定事实或新增了事实'] }) : goodAnswer(r);
    const run = await f.start(); const done = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(done.status, 'completed', JSON.stringify(f.errors));
    assert.equal(f.model.requests.filter((r) => r.stage === 'adjudication').length, 2);
    assert.equal(f.model.requests.filter((r) => r.stage === 'narration:a').length, 2);
    assert.match(f.model.requests.find((r) => r.stage === 'narration:a' && r.correction)!.correction!.issues, /违反锁定事实或新增了事实/);
    assert.equal(done.textCallsUsed, 12);
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('narration review and its concrete correction stay in the authors knowledge slice', async () => {
  const input = definition();
  input.sources[0].content = 'CANON_PRIVATE_MARKER';
  input.lockedFacts = ['LOCK_PRIVATE_MARKER'];
  input.actors[1].background = 'ACTOR_B_PRIVATE_MARKER';
  const f = setup(':memory:', input);
  try {
    const issue = '正文凭空承诺明天替别人值班，输入事实只有完成工作。';
    f.model.respond = (request) => {
      if (request.stage === 'narration-review:a:0') {
        const body = request.input as { actor: { id: string }; ownIntent: { actorId: string }; canon?: unknown; direction?: unknown; actors?: unknown;
          payload: { events: { facts: { knownBy: string[] }[] }[] } };
        const serialized = JSON.stringify(body);
        for (const marker of ['CANON_PRIVATE_MARKER', 'LOCK_PRIVATE_MARKER', 'ACTOR_B_PRIVATE_MARKER', 'SECRET_B_PROGRESS']) {
          assert.equal(serialized.includes(marker), false, marker);
        }
        assert.equal(body.actor.id, 'a'); assert.equal(body.ownIntent.actorId, 'a');
        assert.equal(body.canon, undefined); assert.equal(body.direction, undefined); assert.equal(body.actors, undefined);
        assert.equal(body.payload.events.length, 1);
        assert.ok(body.payload.events.every((event) => event.facts.every((fact) => fact.knownBy.includes('a'))));
        return JSON.stringify({ approved: false, issues: [issue] });
      }
      const value = JSON.parse(goodAnswer(request));
      if (request.stage === 'adjudication') value.events[1].facts[0].content = 'SECRET_B_PROGRESS';
      if (request.stage === 'narration:a' && !request.correction) value.passages[0].text += '。明天我会替别人值班。';
      return JSON.stringify(value);
    };
    const run = await f.start(); const done = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(done.status, 'completed', JSON.stringify(f.errors)); assert.equal(done.textCallsUsed, 10);
    const correction = f.model.requests.find((r) => r.stage === 'narration:a' && r.correction)!;
    assert.equal(correction.correction!.issues.includes(issue), true);
    assert.equal(JSON.stringify(correction).includes('SECRET_B_PROGRESS'), false);
    assert.equal(f.model.requests.filter((r) => r.stage === 'narration:a').length, 2);
    assert.equal(f.model.requests.filter((r) => r.stage === 'narration-review:a:0').length, 1);
    assert.equal(f.model.requests.filter((r) => r.stage === 'narration-review:a:1').length, 1);
    assert.equal(f.store.events(f.world.id, f.branch.id, {}).items[0].perspectives.length, 1);
    assert.equal(JSON.stringify(f.store.events(f.world.id, f.branch.id, {}).items).includes('明天我会替别人值班'), false);
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('legacy global review issues never enter a resumed personal correction', async () => {
  const f = setup();
  try {
    f.model.respond = (request) => {
      if (request.stage === 'narration-review:a:0') {
        // Simulate a durable request saved before this upgrade. The result may
        // have arrived or been confirmed not executed then sent with that input.
        f.database.connection.prepare('UPDATE sw_run_calls SET request_json=? WHERE id=?')
          .run(JSON.stringify({ ...request, input: { canon: ['LEGACY_UNKNOWN_SECRET'], payload: {} } }), request.callId);
        return JSON.stringify({ approved: false, issues: ['LEGACY_UNKNOWN_SECRET不能由本人知道'] });
      }
      return goodAnswer(request);
    };
    const run = await f.start(); const done = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(done.status, 'completed', JSON.stringify(f.errors)); assert.equal(done.textCallsUsed, 10);
    const correction = f.model.requests.find((r) => r.stage === 'narration:a' && r.correction)!;
    assert.equal(JSON.stringify(correction).includes('LEGACY_UNKNOWN_SECRET'), false);
    assert.match(correction.correction!.issues, /历史审查使用了不同的资料范围/);
    const audit = f.database.connection.prepare('SELECT response_text FROM sw_run_calls WHERE id=?')
      .get(f.model.requests.find((r) => r.stage === 'narration-review:a:0')!.callId) as { response_text: string };
    assert.match(audit.response_text, /LEGACY_UNKNOWN_SECRET/);
    assert.equal(f.model.requests.filter((r) => r.stage === 'narration:a').length, 2);
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('personal review correction details have a total bound and legacy details are discarded', () => {
  const issues = Array.from({ length: 50 }, (_, i) => 'issue-' + i + ':' + 'x'.repeat(1980));
  const result = narrationCorrectionIssues(issues, true);
  assert.ok(result.length <= 6100); assert.match(result, /issue-0/);
  assert.equal(result.includes('issue-8:'), false);
  assert.equal(narrationCorrectionIssues(['LEGACY_UNKNOWN_SECRET'], false).includes('LEGACY_UNKNOWN_SECRET'), false);
  assert.match(narrationCorrectionIssues([], true), /未提供具体说明/);
});

test('concurrent image accounting is preserved, callback failures do not roll back the story', async () => {
  const f = setup();
  try {
    f.model.respond = (r) => {
      if (r.stage === 'action:b') {
        const run = f.runtime.getRun(f.world.id, f.branch.id, r.runId);
        f.database.connection.prepare('UPDATE sw_runs SET data_json=? WHERE id=?').run(JSON.stringify({ ...run, imagesSubmitted: 3 }), run.id);
      }
      return goodAnswer(r);
    };
    let after = 0; f.options.afterStep = () => { after++; if (after === 1) throw new Error('image worker unavailable'); };
    const run = await f.start({ autoImages: true, imageConfig: { engineId: 'configured-engine' } });
    const done = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(done.status, 'completed'); assert.equal(done.imagesSubmitted, 3); assert.equal(after, 1);
    await f.runtime.pump(); assert.equal(after, 2);
    assert.equal(f.store.events(f.world.id, f.branch.id, {}).items.length, 2);
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('startScheduler is idempotent and stop waits for its pump before database close', async () => {
  const f = setup();
  try {
    const run = await f.start();
    f.runtime.startScheduler(); f.runtime.startScheduler();
    await f.runtime.pump();
    assert.equal(f.runtime.getRun(f.world.id, f.branch.id, run.id).status, 'completed');
    await f.runtime.stop(); await f.runtime.pump(); assert.equal(f.model.requests.length, 8);
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('automatic images require explicit settings; nested settings replay remains idempotent', async () => {
  const f = setup();
  try {
    await assert.rejects(f.start({ autoImages: true }), code('story_image_configuration_required'));
    const run = await f.start({ autoImages: true, imageConfig: { engineId: 'engine' } });
    assert.equal((await f.start({ autoImages: true, imageConfig: { engineId: 'engine' } })).id, run.id);
    f.runtime.pause(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision);
    await assert.rejects(f.runtime.resume(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision,
      { ...DEFAULT_WORLD_RUN_SETTINGS, autoImages: true }), code('story_image_configuration_required'));
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('12 actors and 1000 historical events reuse personal contexts and read history incrementally', async (t) => {
  const d = definition();
  d.actors = Array.from({ length: 12 }, (_, i) => ({ ...d.actors[i % 2], id: 'actor-' + i, name: '人物' + i }));
  const f = setup(':memory:', d);
  try {
    const historical = Array.from({ length: 1000 }, (_, i) => {
      const actor = d.actors[i % 12];
      return { id: 'history-' + i, worldId: f.world.id, branchId: f.branch.id, tick: i + 1, duration: 0, title: '日常', summary: '',
        locationId: actor.locationId, participantIds: [actor.id], facts: [{ id: 'fact-' + i, content: '历史见闻' + i.toString().padStart(4, '0') + '结束', knownBy: [actor.id], nature: 'ai' as const }],
        perspectives: [], causeEventIds: [], storyLineIds: [], stateChanges: [], createdAt: '2026-01-01' };
    });
    f.store.commitStep(f.world.id, f.branch.id, f.branch.revision, { tick: 1000, events: historical,
      states: [], consumedInterventionIds: [], memories: historical.map((e) => ({ id: 'memory-' + e.id, worldId: f.world.id, branchId: f.branch.id,
        actorId: e.participantIds[0], sourceEventId: e.id, learnedAt: e.tick, kind: 'experienced' as const, content: e.facts[0].content, importance: 0.5, fromActorId: null })) });
    const run = await f.start({ durationTicks: 120 });
    const started = performance.now();
    const first = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    const firstElapsed = performance.now() - started;
    assert.equal(first.status, 'queued', JSON.stringify(f.errors));
    assert.deepEqual(f.runtime.historyCacheStats(), { eventRowsRead: 1000, memoryRowsRead: 1000, fullReads: 1, incrementalReads: 0, branches: 1 });
    const second = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    const elapsed = performance.now() - started;
    assert.equal(second.status, 'completed', JSON.stringify(f.errors)); assert.equal(second.textCallsUsed, 76);
    assert.equal(f.runtime.historyCacheStats().eventRowsRead, 1012); assert.equal(f.runtime.historyCacheStats().memoryRowsRead, 1012);
    assert.equal(f.runtime.historyCacheStats().incrementalReads, 1);
    assert.ok(elapsed < 15000, 'local deterministic simulation exceeded 15 seconds');
    const action = f.model.requests.find((r) => r.stage === 'action:actor-0')!;
    const snapshots = new Map((f.database.connection.prepare("SELECT id,snapshot_json FROM sw_run_steps WHERE run_id=? AND step_key<>'configuration'").all(run.id))
      .map((row) => [String(row.id), JSON.parse(String(row.snapshot_json)) as WorldSimulationSnapshot]));
    const full = personalContext(snapshots.get(action.stepId)!, 'actor-0');
    assert.equal(full.memories.length, 20, 'personal ranking still selects twenty legal memories before digesting');
    assert.equal(full.facts.length, 84, 'the actor knows its own history, not all 1000 events');
    const actionRequests = f.model.requests.filter((request) => request.stage.startsWith('action:'));
    assert.equal(actionRequests.length, 24, 'both steps still make independent decisions for all twelve actors');
    for (const request of actionRequests) {
      const actorId = request.stage.slice('action:'.length); const snapshot = snapshots.get(request.stepId)!;
      const legal = personalContext(snapshot, actorId);
      const { context } = request.input as { context: typeof legal & { memorySummary: PersonalMemorySummary } };
      const summary = context.memorySummary;
      assert.equal(context.memories.length, memorySummaryLimits.memories);
      assert.equal(context.facts.length, memorySummaryLimits.facts);
      assert.ok(context.beliefs.length <= memorySummaryLimits.beliefs);
      assert.ok(JSON.stringify(summary).length <= memorySummaryLimits.characters);
      assert.equal(summary.worldId, f.world.id); assert.equal(summary.branchId, f.branch.id); assert.equal(summary.actorId, actorId);
      assert.equal(summary.atTick, snapshot.branch.currentTick);
      assert.deepEqual(context.facts, summary.facts); assert.deepEqual(context.memories, summary.memories);
      assert.deepEqual(context.beliefs, summary.beliefs);
      assert.equal(summary.omittedFacts, legal.facts.length - summary.facts.length);
      assert.equal(summary.omittedMemories, legal.memories.length - summary.memories.length);
      assert.ok(summary.omittedFacts > 0); assert.ok(summary.omittedMemories > 0);
      for (const fact of context.facts) assert.ok(legal.facts.some((known) => known.id === fact.id && known.eventId === fact.eventId && known.content === fact.content));
      for (const memory of context.memories) {
        assert.equal(memory.actorId, actorId); assert.equal(memory.branchId, f.branch.id); assert.equal(memory.worldId, f.world.id);
        assert.ok(memory.learnedAt <= snapshot.branch.currentTick);
        assert.ok(legal.memories.some((known) => known.id === memory.id && known.sourceEventId === memory.sourceEventId && known.content === memory.content));
      }
    }
    assert.equal(f.database.connection.prepare('SELECT count(*) AS n FROM sw_memory_summaries WHERE world_id=? AND branch_id=?').get(f.world.id, f.branch.id)?.n, 12);
    const judge = f.model.requests.find((r) => r.stage === 'adjudication')!;
    assert.ok((judge.input as { snapshot: WorldSimulationSnapshot }).snapshot.events.length < 400, 'model sees a bounded recent/relevant history window');
    t.diagnostic('12 actors / 1000 events: first=' + firstElapsed.toFixed(1) + 'ms, two steps=' + elapsed.toFixed(1) + 'ms; history read 1000 then 12 rows, no network.');
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('an invalid step can be explicitly ended and a fresh run preserves committed history', async () => {
  const f = setup();
  try {
    const run = await f.start({ durationTicks: 120 });
    assert.equal((await f.runtime.tick(f.world.id, f.branch.id, run.id)).completedTick, 60);
    f.model.respond = () => '{}';
    const paused = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(paused.status, 'paused'); assert.equal(paused.completedTick, 60);
    f.runtime.cancel(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision);
    f.model.respond = goodAnswer;
    const next = await f.start({}, 'fresh'); assert.equal(next.startTick, 60);
    assert.equal((await f.runtime.tick(f.world.id, f.branch.id, next.id)).status, 'completed');
    assert.equal(f.store.events(f.world.id, f.branch.id, {}).items.length, 4);
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('commit failure rolls back all event, state, memory and progress writes while preserving model outputs', async () => {
  const f = setup();
  try {
    const original = f.store.commitStep.bind(f.store);
    f.store.commitStep = (...args: Parameters<typeof original>) => {
      const result = original(...args);
      if (args[3].run) throw new Error('injected after full store write');
      return result;
    };
    const run = await f.start();
    const paused = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(paused.status, 'paused'); assert.equal(paused.completedTick, 0); assert.equal(paused.textCallsUsed, 8);
    assert.equal(f.store.events(f.world.id, f.branch.id, {}).items.length, 0); assert.equal(f.store.memories(f.world.id, f.branch.id).items.length, 0);
    f.store.commitStep = original;
    await f.runtime.resume(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision);
    assert.equal((await f.runtime.tick(f.world.id, f.branch.id, run.id)).status, 'completed');
    assert.equal(f.model.requests.length, 8, 'commit retry must reuse all completed model output');
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('personal mistaken beliefs affect actions while the environment receives actual facts', async () => {
  const f = setup();
  try {
    const source = { id: 'past', worldId: f.world.id, branchId: f.branch.id, tick: 10, duration: 0, title: '', summary: '', locationId: 'port', participantIds: ['a'],
      facts: [{ id: 'empty', content: '盒子是空的', knownBy: ['a'], nature: 'ai' as const }], perspectives: [], causeEventIds: [], storyLineIds: [], stateChanges: [], createdAt: '' };
    f.store.commitStep(f.world.id, f.branch.id, f.branch.revision, { tick: 10, events: [source], states: [], consumedInterventionIds: [], memories: [{ id: 'belief', worldId: f.world.id,
      branchId: f.branch.id, actorId: 'a', sourceEventId: 'past', learnedAt: 10, kind: 'mistaken', content: '我误以为乙拿走了钥匙', importance: 0.9, fromActorId: null }] });
    const run = await f.start(); const done = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(done.status, 'completed', JSON.stringify(f.errors));
    const action = f.model.requests.find((r) => r.stage === 'action:a')!;
    assert.match(JSON.stringify(action.input), /误以为/);
    const judge = f.model.requests.find((r) => r.stage === 'adjudication')!;
    const input = judge.input as { snapshot: WorldSimulationSnapshot; intents: WorldIntent[] };
    assert.match(input.intents[0].action, /误解/);
    assert.ok(input.snapshot.events.some((e) => e.facts.some((fact) => fact.content === '盒子是空的')));
    assert.equal(input.snapshot.events.some((e) => e.facts.some((fact) => fact.content.includes('误以为'))), false);
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('store-level validation failures trigger a charged correction before narration', async () => {
  const f = setup();
  try {
    let checks = 0; const original = f.store.commitStep.bind(f.store);
    f.store.commitStep = (...args: Parameters<typeof original>) => {
      if (!args[3].run && checks++ === 0) throw new Error('injected store semantic validation');
      return original(...args);
    };
    const run = await f.start(); const done = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(done.status, 'completed'); assert.equal(done.textCallsUsed, 9);
    assert.equal(f.model.requests.filter((r) => r.stage === 'adjudication').length, 2);
    assert.match(f.model.requests.find((r) => r.stage === 'adjudication' && r.correction)!.correction!.issues, /store semantic/);
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('crash-style submitting rows with an expired lease reconcile before any repeat dispatch', async () => {
  const f = setup();
  try {
    f.model.respond = async () => { throw new Error('lost response'); };
    const run = await f.start(); await f.runtime.tick(f.world.id, f.branch.id, run.id); await f.runtime.stop();
    const latest = f.runtime.getRun(f.world.id, f.branch.id, run.id);
    f.database.connection.prepare("UPDATE sw_runs SET status='running',data_json=? WHERE id=?").run(JSON.stringify({ ...latest, status: 'running', pauseReason: '' }), run.id);
    f.database.connection.prepare("UPDATE sw_run_calls SET status='submitting' WHERE step_id IN (SELECT id FROM sw_run_steps WHERE run_id=?)").run(run.id);
    f.database.connection.prepare("UPDATE sw_run_steps SET lease_owner='crashed-process',lease_until=1 WHERE run_id=? AND status='pending'").run(run.id);
    f.model.resolution = { status: 'succeeded', text: goodAnswer(f.model.requests[0]) }; f.model.respond = goodAnswer;
    const restarted = new StoryWorldRuntime(f.options); await restarted.pump();
    const done = restarted.getRun(f.world.id, f.branch.id, run.id);
    assert.equal(done.status, 'completed'); assert.equal(done.textCallsUsed, 8);
    assert.equal(f.model.requests.filter((r) => r.stage === 'action:a').length, 1);
    await restarted.stop();
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('slow automatic image callbacks are serialized and do not block subsequent story steps', async () => {
  const f = setup();
  try {
    let release!: () => void; let entered = 0;
    f.options.afterStep = async () => { entered++; if (entered === 1) await new Promise<void>((resolve) => { release = resolve; }); };
    const run = await f.start({ durationTicks: 120, autoImages: true, imageConfig: { engineId: 'engine' } });
    assert.equal((await f.runtime.tick(f.world.id, f.branch.id, run.id)).completedTick, 60); assert.equal(entered, 1);
    assert.equal((await f.runtime.tick(f.world.id, f.branch.id, run.id)).status, 'completed'); assert.equal(entered, 1);
    const stopping = f.runtime.stop(); release(); await stopping; assert.equal(entered, 2);
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('image-only branch revisions do not interrupt story progression', async () => {
  const f = setup();
  try {
    f.model.respond = (r) => {
      if (r.stage === 'narration:a') {
        const branch = f.store.getBranch(f.world.id, f.branch.id); const next = { ...branch, revision: branch.revision + 1 };
        f.database.connection.prepare('UPDATE sw_branches SET revision=?,data_json=? WHERE id=?').run(next.revision, JSON.stringify(next), next.id);
      }
      return goodAnswer(r);
    };
    const run = await f.start(); const done = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(done.status, 'completed', JSON.stringify(f.errors)); assert.equal(done.textCallsUsed, 8);
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('production runtime uses real public resolution and common LLM audit with an intercepted fetch only', async () => {
  const f = setup(); let dispatched = 0;
  try {
    f.database.connection.prepare("INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('story-worlds','world','test-default-runtime','[]',1,'','')").run();
    f.database.connection.prepare("INSERT INTO provider_profiles(id,name,kind,base_url,model,created_at,updated_at) VALUES ('public-model','public','llm','https://model.example.test/v1','provider-neutral','','')").run();
    f.database.connection.prepare("INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('story-worlds','text','public-model','')").run();
    const runtime = new StoryWorldRuntime({ ...f.options, modelAdapter: undefined, fetcher: async (_input, init) => {
      dispatched++;
      const payload = JSON.parse(String(init?.body)); assert.equal(payload.model, 'provider-neutral');
      const row = f.database.connection.prepare("SELECT request_json FROM sw_run_calls WHERE status='submitting' ORDER BY rowid DESC LIMIT 1").get() as { request_json: string };
      const request = JSON.parse(row.request_json) as WorldModelRequest;
      return new Response(JSON.stringify({ choices: [{ message: { content: goodAnswer(request) } }], usage: { total_tokens: 1 } }), { status: 200 });
    } });
    const run = await runtime.start(f.world.id, f.branch.id, { expectedRevision: f.branch.revision, idempotencyKey: 'default', settings: { ...DEFAULT_WORLD_RUN_SETTINGS, durationTicks: 60, stepTicks: 60 } });
    const done = await runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(done.status, 'completed', JSON.stringify(f.errors)); assert.equal(dispatched, 8);
    assert.equal(f.database.connection.prepare("SELECT count(*) AS n FROM ai_call_records WHERE object_id=? AND status='succeeded'").get(run.id)?.n, 8);
    await runtime.stop();
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('an audited HTTP 429 retries only after explicit budgeted resume, survives reopen, and preserves successful stages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'world-rejected-'));
  const f = setup(join(dir, 'test.db'));
  const requests: WorldModelRequest[] = [];
  let runtime: StoryWorldRuntime | undefined; let reopened: ServiceDatabase | undefined;
  try {
    f.database.connection.prepare("INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('story-worlds','world','test-retry-runtime','[]',1,'','')").run();
    f.database.connection.prepare("INSERT INTO provider_profiles(id,name,kind,base_url,model,created_at,updated_at) VALUES ('retry-model','retry','llm','https://rejected.example.test/v1','neutral-model','','')").run();
    f.database.connection.prepare("INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('story-worlds','text','retry-model','')").run();
    const fetcher: typeof fetch = async (_url, init) => {
      assert.equal(JSON.parse(String(init?.body)).model, 'neutral-model');
      const database = reopened ?? f.database;
      const row = database.connection.prepare("SELECT request_json FROM sw_run_calls WHERE status='submitting' ORDER BY rowid DESC LIMIT 1").get() as { request_json: string };
      const request = JSON.parse(row.request_json) as WorldModelRequest; requests.push(request);
      if (request.stage === 'narration-review:b:0' && requests.filter((r) => r.stage === request.stage).length === 1) {
        return Response.json({ error: { code: 'gateway_concurrency_limit', message: 'gateway_concurrency_limit' } }, { status: 429 });
      }
      return Response.json({ choices: [{ message: { content: goodAnswer(request) } }], usage: { total_tokens: 1 } });
    };
    runtime = new StoryWorldRuntime({ ...f.options, modelAdapter: undefined, fetcher });
    const run = await runtime.start(f.world.id, f.branch.id, { expectedRevision: f.branch.revision, idempotencyKey: 'rejected',
      settings: { ...DEFAULT_WORLD_RUN_SETTINGS, durationTicks: 60, maxTextCalls: 8 } });
    const paused = await runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(paused.status, 'paused'); assert.equal(paused.textCallsUsed, 8); assert.match(paused.pauseReason, /明确拒绝/);
    const failed = f.database.connection.prepare("SELECT * FROM sw_run_calls WHERE status='failed'").get()!;
    const oldAudit = f.database.connection.prepare('SELECT id,status,error_code FROM ai_call_records WHERE trace_id=?').get(String(failed.id))!;
    assert.equal(oldAudit.status, 'failed'); assert.equal(oldAudit.error_code, 'http_429');
    assert.equal(f.database.connection.prepare("SELECT count(*) AS n FROM sw_run_calls WHERE status='succeeded'").get()?.n, 7);
    await runtime.pump(); await runtime.tick(f.world.id, f.branch.id, run.id); assert.equal(requests.length, 8);
    const revision = f.store.getBranch(f.world.id, f.branch.id).revision;
    await assert.rejects(runtime.resume(f.world.id, f.branch.id, run.id, revision), code('story_run_budget_exhausted'));
    await assert.rejects(runtime.resume(f.world.id, f.branch.id, run.id, revision + 1, { ...paused.settings, maxTextCalls: 20 }), code('story_branch_revision_conflict'));
    assert.equal(f.database.connection.prepare("SELECT count(*) AS n FROM ai_call_records WHERE call_type='retry-authorization'").get()?.n, 0);
    const resumed = await runtime.resume(f.world.id, f.branch.id, run.id, revision, { ...paused.settings, maxTextCalls: 20 });
    assert.equal(resumed.status, 'queued'); assert.equal(resumed.textCallsUsed, 8); assert.equal(requests.length, 8);
    const authorization = f.database.connection.prepare("SELECT * FROM ai_call_records WHERE call_type='retry-authorization'").get()!;
    const evidence = JSON.parse(String(authorization.parameters_json));
    assert.equal(evidence.callId, failed.id); assert.equal(evidence.stage, 'narration-review:b:0');
    assert.equal(evidence.attempt, 0); assert.equal(evidence.textCallsUsed, 8);
    assert.equal(evidence.failure.error, failed.error); assert.equal(evidence.failure.request_json, failed.request_json);
    assert.equal(evidence.upstreamAiCallId, oldAudit.id); assert.equal(authorization.retry_of, oldAudit.id);
    assert.equal(f.database.connection.prepare('SELECT status FROM sw_run_calls WHERE id=?').get(String(failed.id))?.status, 'confirmed-not-executed');
    await runtime.stop(); f.database.close();
    reopened = new ServiceDatabase(join(dir, 'test.db'));
    const store = new StoryWorldStore(reopened);
    runtime = new StoryWorldRuntime({ ...f.options, database: reopened, store, modelAdapter: undefined, fetcher });
    const done = await runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(done.status, 'completed', JSON.stringify(f.errors)); assert.equal(done.textCallsUsed, 9);
    assert.equal(requests.length, 9); assert.equal(requests[7].callId, requests[8].callId);
    for (const stage of new Set(requests.map((r) => r.stage))) assert.equal(requests.filter((r) => r.stage === stage).length, stage === 'narration-review:b:0' ? 2 : 1, stage);
    assert.equal(reopened.connection.prepare('SELECT count(*) AS n FROM sw_run_calls').get()?.n, 8);
    assert.equal(reopened.connection.prepare('SELECT status FROM ai_call_records WHERE id=?').get(String(oldAudit.id))?.status, 'failed');
    assert.equal(reopened.connection.prepare('SELECT count(*) AS n FROM ai_call_records WHERE trace_id=?').get(String(failed.id))?.n, 2);
    assert.equal(reopened.connection.prepare("SELECT count(*) AS n FROM ai_call_events WHERE call_id=? AND phase='explicit_resume_retry_authorized'").get(String(oldAudit.id))?.n, 1);
    await runtime.pump(); assert.equal(requests.length, 9);
  } finally { await runtime?.stop(); await f.runtime.stop(); if (reopened) reopened.close(); else { try { f.database.close(); } catch {} } rmSync(dir, { recursive: true, force: true }); }
});

test('explicit rejection retries retain correction attempt one and cannot reset invalid output limits', async () => {
  const f = setup();
  try {
    let correctionDispatches = 0;
    f.model.resolution = { status: 'failed', error: 'HTTP 429 gateway_concurrency_limit' };
    f.model.respond = (request) => {
      if (request.stage === 'action:a') {
        if (request.correction && ++correctionDispatches <= 2) throw new Error('HTTP 429 gateway_concurrency_limit');
        return '{}';
      }
      return goodAnswer(request);
    };
    const run = await f.start();
    const first = await f.runtime.tick(f.world.id, f.branch.id, run.id); assert.equal(first.status, 'paused'); assert.equal(first.textCallsUsed, 2);
    await f.runtime.pump(); assert.equal(f.model.requests.length, 2);
    await f.runtime.resume(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision);
    const second = await f.runtime.tick(f.world.id, f.branch.id, run.id); assert.equal(second.status, 'paused'); assert.equal(second.textCallsUsed, 3);
    await f.runtime.pump(); assert.equal(f.model.requests.length, 3);
    await f.runtime.resume(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision);
    const invalid = await f.runtime.tick(f.world.id, f.branch.id, run.id); assert.equal(invalid.status, 'paused'); assert.equal(invalid.textCallsUsed, 4);
    assert.match(invalid.pauseReason, /一次修正/);
    await assert.rejects(f.runtime.resume(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision), code('story_run_validation_failed'));
    assert.equal(f.model.requests.length, 4); assert.equal(f.model.requests.filter((r) => !r.correction).length, 1);
    assert.equal(new Set(f.model.requests.slice(1).map((r) => r.callId)).size, 1);
    assert.ok(f.model.requests.slice(1).every((r) => r.correction?.previous === '{}'));
    assert.deepEqual(f.database.connection.prepare('SELECT attempt FROM sw_run_calls ORDER BY attempt').all().map((r) => r.attempt), [0, 1]);
    assert.equal(f.database.connection.prepare("SELECT count(*) AS n FROM ai_call_records WHERE call_type='retry-authorization'").get()?.n, 2);
    assert.equal(f.store.getBranch(f.world.id, f.branch.id).currentTick, 0);
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('a legacy failed label without positive rejection evidence never grants retry authorization', async () => {
  const f = setup();
  try {
    f.model.respond = () => { throw new Error('transport timeout'); };
    const run = await f.start(); await f.runtime.tick(f.world.id, f.branch.id, run.id);
    const call = f.runtime.recovery(f.world.id, f.branch.id, run.id).items[0];
    const auditId = createAiCallRecord(f.database, { applicationId: 'story-worlds', feature: 'action', businessEvent: 'test', callType: 'llm', traceId: call.id });
    updateAiCallRecord(f.database, auditId, { status: 'failed', errorCode: 'upstream_unavailable', errorMessage: 'legacy transport timeout' });
    f.database.connection.prepare("UPDATE sw_run_calls SET status='failed',error='legacy transport timeout' WHERE id=?").run(call.id);
    const publicAdapter = new (await import('./model.js')).PublicWorldModelAdapter(f.options);
    f.model.reconcile = (request) => publicAdapter.reconcile(request);
    await assert.rejects(f.runtime.resume(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision), code('story_run_call_uncertain'));
    assert.equal(f.model.requests.length, 1); assert.equal(f.runtime.getRun(f.world.id, f.branch.id, run.id).textCallsUsed, 1);
    assert.equal(f.database.connection.prepare("SELECT count(*) AS n FROM ai_call_records WHERE call_type='retry-authorization'").get()?.n, 0);
    assert.equal(f.database.connection.prepare('SELECT status FROM sw_run_calls WHERE id=?').get(call.id)?.status, 'failed');
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('manual not-executed confirmation is audited and only explicit resume redispatches the same call', async () => {
  const f = setup();
  try {
    f.model.respond = async () => { throw new Error('timeout'); };
    const run = await f.start(); await f.runtime.tick(f.world.id, f.branch.id, run.id);
    const recovery = f.runtime.recovery(f.world.id, f.branch.id, run.id); assert.equal(recovery.items.length, 1);
    const call = recovery.items[0]; assert.equal(call.stage, 'action:a'); assert.ok(call.requestedAt);
    assert.equal(JSON.stringify(recovery).includes('timeout'), false);
    assert.throws(() => f.runtime.resolveCall(f.world.id, f.branch.id, run.id, call.id, { expectedRevision: 999, resolution: 'not-executed', evidence: '查供应商记录，确认未执行' }), code('story_branch_revision_conflict'));
    const resolution = f.runtime.resolveCall(f.world.id, f.branch.id, run.id, call.id, { expectedRevision: f.store.getBranch(f.world.id, f.branch.id).revision,
      resolution: 'not-executed', evidence: '供应商工单确认未执行。' });
    assert.equal(resolution.status, 'confirmed-not-executed'); assert.equal(f.model.requests.length, 1);
    await f.runtime.pump(); assert.equal(f.model.requests.length, 1);
    assert.equal(f.database.connection.prepare("SELECT count(*) AS n FROM ai_call_records WHERE call_type='manual-reconciliation'").get()?.n, 1);
    f.model.respond = goodAnswer;
    await f.runtime.resume(f.world.id, f.branch.id, run.id, resolution.branchRevision);
    const done = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(done.status, 'completed'); assert.equal(done.textCallsUsed, 9);
    assert.equal(f.model.requests[0].callId, f.model.requests[1].callId, 'manual retry remains attached to the original call identity');
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('manual received output is shape-checked immediately and semantically validated before commit', async () => {
  const f = setup();
  try {
    f.model.respond = async () => { throw new Error('timeout'); };
    const run = await f.start(); await f.runtime.tick(f.world.id, f.branch.id, run.id);
    const call = f.runtime.recovery(f.world.id, f.branch.id, run.id).items[0];
    const revision = f.store.getBranch(f.world.id, f.branch.id).revision;
    assert.throws(() => f.runtime.resolveCall(f.world.id, f.branch.id, run.id, call.id, { expectedRevision: revision, resolution: 'received-result', evidence: '收到原始响应', responseText: '{}' }), code('story_recovery_result_invalid'));
    const invalid = JSON.parse(goodAnswer(f.model.requests[0])); invalid.actorId = 'b';
    assert.throws(() => f.runtime.resolveCall(f.world.id, f.branch.id, run.id, call.id, { expectedRevision: revision, resolution: 'received-result', evidence: '收到原始响应', responseText: JSON.stringify(invalid) }), code('story_recovery_result_invalid'));
    const result = f.runtime.resolveCall(f.world.id, f.branch.id, run.id, call.id, { expectedRevision: revision, resolution: 'received-result', evidence: '收到原始响应', responseText: goodAnswer(f.model.requests[0]) });
    assert.equal(result.validation, 'validated-on-resume'); assert.equal(f.store.events(f.world.id, f.branch.id, {}).items.length, 0);
    f.model.respond = goodAnswer;
    await f.runtime.resume(f.world.id, f.branch.id, run.id, result.branchRevision);
    const done = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(done.status, 'completed'); assert.equal(done.textCallsUsed, 8);
    assert.equal(f.model.requests.length, 8); assert.equal(f.model.requests.filter((r) => r.stage === 'action:a').length, 1);
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('durable notifications recover after disk reopen and successful callbacks stay acknowledged across restarts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'world-notifications-')); const path = join(dir, 'test.db');
  const f = setup(path); let reopened: ServiceDatabase | undefined;
  try {
    const run = await f.start(); await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(f.database.connection.prepare("SELECT count(*) AS n FROM sw_run_steps WHERE status='committed' AND result_json IS NOT NULL").get()?.n, 1);
    f.database.connection.exec('DROP INDEX idx_sw_steps_notification_pending');
    await f.runtime.stop(); f.database.close();
    reopened = new ServiceDatabase(path);
    // The existing v55 table receives the new index through a separate migration.
    for (const sql of WORLD_RUNTIME_NOTIFICATION_MIGRATION_STATEMENTS) reopened.connection.exec(sql);
    assert.ok(reopened.connection.prepare("SELECT name FROM sqlite_schema WHERE name='idx_sw_steps_notification_pending'").get());
    const delivered: string[][] = [];
    const options = { ...f.options, database: reopened, store: new StoryWorldStore(reopened), afterStep: (step: { eventIds: string[] }) => { delivered.push(step.eventIds); } };
    const restarted = new StoryWorldRuntime(options); await restarted.pump(); await restarted.stop();
    assert.equal(delivered.length, 1); assert.equal(delivered[0].length, 2);
    assert.equal(reopened.connection.prepare("SELECT count(*) AS n FROM sw_run_steps WHERE status='notified'").get()?.n, 1);
    const again = new StoryWorldRuntime(options); await again.pump(); await again.pump(); await again.stop();
    assert.equal(delivered.length, 1, 'acknowledgement must survive a fresh runtime, not just an in-memory set');
    assert.equal(f.model.requests.length, 8, 'callback recovery never repeats model calls');
  } finally { if (reopened) reopened.close(); else { try { f.database.close(); } catch {} } rmSync(dir, { recursive: true, force: true }); }
});

test('notification failure remains durable and an expired crashed callback lease replays after restart', async () => {
  const f = setup();
  try {
    let attempts = 0;
    f.options.afterStep = () => { attempts++; throw new Error('image worker unavailable'); };
    const run = await f.start(); await f.runtime.tick(f.world.id, f.branch.id, run.id); await f.runtime.stop();
    const step = f.database.connection.prepare("SELECT id,status,lease_owner FROM sw_run_steps WHERE result_json IS NOT NULL").get()!;
    assert.equal(step.status, 'committed'); assert.equal(step.lease_owner, null);
    // Simulate termination before ack: retain pending result with an expired lease.
    f.database.connection.prepare("UPDATE sw_run_steps SET lease_owner='crashed-worker',lease_until=1 WHERE id=?").run(String(step.id));
    let delivered: string[] = [];
    const restarted = new StoryWorldRuntime({ ...f.options, afterStep: (s) => { attempts++; delivered = s.eventIds; } });
    await restarted.pump(); await restarted.stop();
    assert.equal(attempts, 2); assert.equal(delivered.length, 2);
    assert.equal(f.database.connection.prepare('SELECT status FROM sw_run_steps WHERE id=?').get(String(step.id))?.status, 'notified');
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('a live callback claim stays out of pending queries and prevents another runtime replaying it', async () => {
  const f = setup();
  let release!: () => void; let calls = 0; let other: StoryWorldRuntime | undefined;
  try {
    f.options.afterStep = async () => { calls++; await new Promise<void>((resolve) => { release = resolve; }); };
    const run = await f.start(); await f.runtime.tick(f.world.id, f.branch.id, run.id);
    const claimed = f.database.connection.prepare("SELECT lease_owner,lease_until FROM sw_run_steps WHERE result_json IS NOT NULL").get()!;
    assert.ok(claimed.lease_owner); assert.ok(Number(claimed.lease_until) > Date.now());
    assert.equal(f.database.connection.prepare(WORLD_RUNTIME_PENDING_NOTIFICATIONS_SQL).all(Date.now(), 32).length, 0);
    other = new StoryWorldRuntime({ ...f.options, afterStep: () => { calls++; } });
    await other.pump(); assert.equal(calls, 1);
    release(); await f.runtime.stop(); await other.pump(); await other.stop();
    assert.equal(calls, 1);
  } finally { release?.(); await f.runtime.stop(); await other?.stop(); f.database.close(); }
});

test('an image notification lease does not block pausing and resuming the story run', async () => {
  const f = setup(); let release!: () => void;
  try {
    f.options.afterStep = async () => { await new Promise<void>((resolve) => { release = resolve; }); };
    const run = await f.start({ durationTicks: 120 }); await f.runtime.tick(f.world.id, f.branch.id, run.id);
    f.runtime.pause(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision);
    const resumed = await f.runtime.resume(f.world.id, f.branch.id, run.id, f.store.getBranch(f.world.id, f.branch.id).revision);
    assert.equal(resumed.status, 'queued'); release(); await f.runtime.stop();
  } finally { release?.(); await f.runtime.stop(); f.database.close(); }
});

test('pending notification query uses a partial index and bounds payload reads with 20000 acknowledged steps', async (t) => {
  const f = setup();
  try {
    const run = await f.start(); await f.runtime.tick(f.world.id, f.branch.id, run.id);
    const template = f.database.connection.prepare("SELECT id,result_json FROM sw_run_steps WHERE result_json IS NOT NULL").get() as { id: string; result_json: string };
    f.database.connection.prepare("UPDATE sw_run_steps SET status='notified' WHERE id=?").run(template.id);
    f.database.connection.prepare("WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<20000) INSERT INTO sw_run_steps(id,run_id,step_key,from_tick,to_tick,branch_revision,status,snapshot_json,result_json,created_at,updated_at) SELECT 'ack-'||i,?,'ack-'||i,0,60,1,'notified','not parsed',?,'2026-01-01','2026-01-01' FROM n")
      .run(run.id, template.result_json);
    f.database.connection.prepare("WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<70) INSERT INTO sw_run_steps(id,run_id,step_key,from_tick,to_tick,branch_revision,status,snapshot_json,result_json,created_at,updated_at) SELECT 'pending-'||i,?,'pending-'||i,0,60,1,'committed','not parsed',?,'2026-01-01','2026-01-01' FROM n")
      .run(run.id, template.result_json);
    const plan = f.database.connection.prepare('EXPLAIN QUERY PLAN ' + WORLD_RUNTIME_PENDING_NOTIFICATIONS_SQL).all(Date.now(), 32);
    assert.ok(plan.some((row) => String(row.detail).includes('SEARCH') && String(row.detail).includes('idx_sw_steps_notification_pending')), JSON.stringify(plan));
    assert.ok(plan.every((row) => !String(row.detail).includes('TEMP B-TREE')), JSON.stringify(plan));
    const started = performance.now();
    assert.deepEqual(Object.keys(f.database.connection.prepare(WORLD_RUNTIME_PENDING_NOTIFICATIONS_SQL).get(Date.now(), 32)!).sort(), ['id', 'result_json', 'run_id']);
    for (let i = 0; i < 200; i++) assert.equal(f.database.connection.prepare(WORLD_RUNTIME_PENDING_NOTIFICATIONS_SQL).all(Date.now(), 32).length, 32);
    const elapsed = performance.now() - started;
    const delivered = new Set<string>();
    const worker = new StoryWorldRuntime({ ...f.options, afterStep: (s) => {
      // Stable event IDs are used by consumers; count durable claims for this test.
      const claimed = f.database.connection.prepare("SELECT id FROM sw_run_steps WHERE status='committed' AND lease_owner IS NOT NULL").all();
      for (const row of claimed) delivered.add(String(row.id));
      assert.deepEqual(s.eventIds.length, 2);
    } });
    await worker.pump(); await worker.stop();
    assert.equal(f.database.connection.prepare("SELECT count(*) AS n FROM sw_run_steps WHERE status='committed' AND result_json IS NOT NULL").get()?.n, 38);
    assert.equal(delivered.size, 32);
    const rest = new StoryWorldRuntime({ ...f.options, afterStep: () => {} }); await rest.pump(); await rest.stop();
    const last = new StoryWorldRuntime({ ...f.options, afterStep: () => {} }); await last.pump(); await last.stop();
    assert.equal(f.database.connection.prepare(WORLD_RUNTIME_PENDING_NOTIFICATIONS_SQL).all(Date.now(), 32).length, 0);
    t.diagnostic('20000 acknowledged + 70 pending: indexed query returns at most 32 rows; 200 reads=' + elapsed.toFixed(1) + 'ms; pump drains 32/32/6.');
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('received final sample keeps tick zero invalid and gives actionable details on its only correction', async () => {
  const sample = receivedFinalSample; const f = setup(':memory:', sample.definition);
  try {
    assert.equal(sample.branch.currentTick, 0);
    const branch = f.store.createBranch(f.world.id, { title: '真实样本离线回放', mode: sample.branch.mode, direction: sample.branch.direction, expectedRevision: f.world.revision });
    f.model.respond = (request) => {
      if (request.stage.startsWith('action:')) return JSON.stringify(sample.intents.find((intent) => request.stage === 'action:' + intent.actorId));
      if (request.stage === 'adjudication') return JSON.stringify(sample.responses[request.correction ? 1 : 0]);
      throw new Error('Invalid adjudication must not spend review or narration calls: ' + request.stage);
    };
    const run = await f.runtime.start(f.world.id, branch.id, { expectedRevision: branch.revision, idempotencyKey: 'received-final',
      settings: { ...DEFAULT_WORLD_RUN_SETTINGS, durationTicks: sample.toTick, stepTicks: sample.toTick } });
    const done = await f.runtime.tick(f.world.id, branch.id, run.id);
    assert.equal(done.status, 'paused'); assert.equal(done.textCallsUsed, 4);
    assert.match(done.pauseReason, /evt-harbor-001 时间无效：tick=0，duration=10，tick[+]duration=10/);
    const correction = f.model.requests.find((request) => request.stage === 'adjudication' && request.correction)!;
    for (const event of sample.responses[0].events.filter((event) => event.tick === 0)) {
      assert.ok(correction.correction!.issues.includes('事件 ' + event.id + ' 时间无效：tick=0，duration=' + event.duration));
    }
    assert.match(correction.correction!.issues, /currentTick=0，toTick=60，要求 1<=tick<=60/);
    assert.equal(f.store.events(f.world.id, branch.id, {}).total, 0);
    assert.equal(f.store.memories(f.world.id, branch.id).items.length, 0);
    assert.equal(f.store.getBranch(f.world.id, branch.id).currentTick, 0);
    assert.deepEqual(f.errors, []);
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('both received final adjudications complete the whole offline pipeline after an explicit fixture-only one-minute repair', async (t) => {
  for (const [attempt, received] of receivedFinalSample.responses.entries()) await t.test('received attempt ' + attempt, async () => {
    const sample = receivedFinalSample; const f = setup(':memory:', sample.definition);
    try {
      const branch = f.store.createBranch(f.world.id, { title: '样本后续链路回放', mode: sample.branch.mode, direction: sample.branch.direction, expectedRevision: f.world.revision });
      assert.deepEqual(f.store.detail(f.world.id, branch.id).states, sample.states);
      const repaired = structuredClone(received);
      // Diagnostic input only: production never shifts times or changes received calls.
      for (const event of repaired.events) { event.tick += 1; for (const state of event.stateChanges) state.updatedTick += 1; }
      const notifications: string[] = []; f.options.afterStep = (step) => { notifications.push(step.runId); };
      f.model.respond = (request) => {
        if (request.stage.startsWith('action:')) return JSON.stringify(sample.intents.find((intent) => request.stage === 'action:' + intent.actorId));
        if (request.stage === 'adjudication') return JSON.stringify(repaired);
        return goodAnswer(request);
      };
      const run = await f.runtime.start(f.world.id, branch.id, { expectedRevision: branch.revision, idempotencyKey: 'repaired-final',
        settings: { ...DEFAULT_WORLD_RUN_SETTINGS, durationTicks: sample.toTick, stepTicks: sample.toTick } });
      const done = await f.runtime.tick(f.world.id, branch.id, run.id);
      assert.equal(done.status, 'completed', JSON.stringify({ reason: done.pauseReason, errors: f.errors.map(String) }));
      assert.equal(done.textCallsUsed, 10); assert.equal(done.completedTick, 60);
      assert.equal(f.model.requests.filter((request) => request.correction).length, 0);
      const detail = f.store.detail(f.world.id, branch.id);
      assert.equal(detail.definition.actors.length, 3); assert.equal(detail.branch.currentTick, 60);
      const events = f.store.events(f.world.id, branch.id, {}).items;
      assert.deepEqual(events.map((event) => event.id), received.events.map((event) => event.id));
      assert.equal(events.length, 4);
      for (const event of events) {
        assert.equal(event.perspectives.length, event.participantIds.length);
        for (const state of event.stateChanges) for (const relation of state.relationships) assert.equal(relation.sourceEventId, event.id);
      }
      const memories = f.store.memories(f.world.id, branch.id).items;
      assert.equal(memories.length, 16); assert.equal(memories.filter((memory) => memory.kind === 'heard').length, 2);
      const context = personalContext({ worldId: f.world.id, branch: detail.branch, definition: detail.definition, states: detail.states,
        events, memories, interventions: [], storyLines: [], toTick: sample.toTick }, 'actor-1');
      assert.ok(context.facts.some((fact) => fact.id === received.transfers[0].factId));
      assert.ok(context.facts.every((fact) => fact.id !== received.events[0].facts[0].id));
      assert.deepEqual(notifications, [run.id]); assert.deepEqual(f.errors, []);
      assert.equal(f.database.connection.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
    } finally { await f.runtime.stop(); f.database.close(); }
  });
});

test('a corrected meeting persists relationships whose provenance is the meeting itself', async () => {
  const d = definition(); d.actors[1].locationId = 'port';
  const f = setup(':memory:', d);
  try {
    const meetingId = 'ev-cleanharbor-meet-005';
    f.model.respond = (request) => {
      if (request.stage !== 'adjudication') return goodAnswer(request);
      const tick = request.correction ? 21 : 0;
      const snapshot = (request.input as { snapshot: WorldSimulationSnapshot }).snapshot;
      const output: WorldAdjudication = {
        events: [{ id: meetingId, tick, duration: 9, title: '港口会面', summary: '', locationId: 'port', participantIds: ['a', 'b'],
          facts: [{ id: 'meeting-fact', content: '双方在港口当面商量是否需要帮忙。', knownBy: ['a', 'b'], nature: 'ai' }],
          causeEventIds: [], storyLineIds: [], stateChanges: snapshot.states.map((state, i) => ({
            ...state, updatedTick: tick + 9,
            relationships: [{ actorId: i === 0 ? 'b' : 'a', description: '当面商量是否需要帮忙。', sourceEventId: meetingId }],
          })) }],
        supportingActors: [], transfers: [], consumedInterventionIds: [], violatedLockedFacts: [],
      };
      return JSON.stringify(output);
    };
    const run = await f.start(); const done = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(done.status, 'completed', JSON.stringify({ reason: done.pauseReason, errors: f.errors.map(String) }));
    assert.equal(done.textCallsUsed, 9);
    const corrections = f.model.requests.filter((request) => request.stage === 'adjudication' && request.correction);
    assert.equal(corrections.length, 1);
    assert.match(corrections[0].correction!.issues, /ev-cleanharbor-meet-005 时间无效：tick=0，duration=9，tick[+]duration=9/);
    assert.match(corrections[0].correction!.issues, /currentTick=0，toTick=60，要求 1<=tick<=60/);
    const events = f.store.events(f.world.id, f.branch.id, {}).items;
    assert.equal(events.length, 1); assert.equal(events[0].id, meetingId);
    assert.equal(events[0].perspectives.length, 2);
    for (const state of [...events[0].stateChanges, ...f.store.detail(f.world.id, f.branch.id).states]) {
      assert.equal(state.relationships[0].sourceEventId, meetingId); assert.equal(state.updatedTick, 30);
    }
    const memories = f.store.memories(f.world.id, f.branch.id).items;
    assert.equal(memories.length, 2); assert.ok(memories.every((memory) => memory.sourceEventId === meetingId && memory.learnedAt === 30));
    assert.equal(f.database.connection.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
  } finally { await f.runtime.stop(); f.database.close(); }
});

test('one correction receives both real-response errors and commits only a traceable exact transfer', async () => {
  const d = definition(); d.actors[1].locationId = 'port';
  const f = setup(':memory:', d);
  try {
    f.model.respond = (request) => {
      if (request.stage !== 'adjudication') return goodAnswer(request);
      const corrected = Boolean(request.correction);
      const facts = [{ id: 'lamp-check', content: '灯身外表未见裂口，尚未测试功能。', knownBy: ['a'], nature: 'ai' as const },
        { id: 'box', content: '双方都看见桌上的灯。', knownBy: ['a', 'b'], nature: 'ai' as const }];
      const output: WorldAdjudication = {
        events: [{ id: 'inspection', tick: 10, duration: 5, title: '检查', summary: '', locationId: 'port', participantIds: ['a', 'b'], facts,
          causeEventIds: [], storyLineIds: [], stateChanges: [{ ...f.store.detail(f.world.id, f.branch.id).states[0], updatedTick: corrected ? 15 : 10 }] },
        { id: 'meeting', tick: 30, duration: 0, title: '转述', summary: '', locationId: 'port', participantIds: ['a', 'b'],
          facts: [{ id: 'report', content: corrected ? facts[0].content : 'a告诉b检查没发现裂口，功能仍不清楚。', knownBy: ['a', 'b'], nature: 'ai' }],
          causeEventIds: ['inspection'], storyLineIds: [], stateChanges: [] }], supportingActors: [],
        transfers: [{ actorId: 'b', fromActorId: 'a', sourceEventId: 'inspection', factId: 'lamp-check', meetingEventId: 'meeting' }],
        consumedInterventionIds: [], violatedLockedFacts: [],
      };
      return JSON.stringify(output);
    };
    const run = await f.start(); const done = await f.runtime.tick(f.world.id, f.branch.id, run.id);
    assert.equal(done.status, 'completed', JSON.stringify({ reason: done.pauseReason, errors: f.errors.map(String) }));
    assert.equal(done.textCallsUsed, 9);
    const corrections = f.model.requests.filter((request) => request.stage === 'adjudication' && request.correction);
    assert.equal(corrections.length, 1); assert.match(corrections[0].correction!.issues, /updatedTick应为 15/);
    assert.match(corrections[0].correction!.issues, /逐字复制/);
    const heard = f.store.memories(f.world.id, f.branch.id, 'b').items.find((m) => m.kind === 'heard')!;
    assert.equal(heard.sourceEventId, 'inspection'); assert.equal(heard.fromActorId, 'a'); assert.equal(heard.learnedAt, 30);
  } finally { await f.runtime.stop(); f.database.close(); }
});
