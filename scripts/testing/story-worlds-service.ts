/** Isolated browser service. No network fetch escapes this deterministic provider. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createService } from '../../apps/service/src/server.js';
import { readConfig } from '../../apps/service/src/config.js';
import { ServiceDatabase } from '../../apps/service/src/database.js';
import { SecretStore } from '../../apps/service/src/security.js';
import { StoryWorldStore } from '../../apps/service/src/story-worlds/store.js';
import { StoryStore } from '../../apps/service/src/story/store.js';
import type { WorldDefinition, WorldEvent, WorldActorState, WorldRun } from '@sthstart/contracts';

const directory = mkdtempSync(join(tmpdir(), 'sthstart-worlds-ui-'));
const config = readConfig({ SERVICE_PORT: '4974', PORTAL_ORIGINS: 'http://127.0.0.1:4973',
  STHSTART_ADMIN_TOKEN: 'story-worlds-isolated-e2e-admin-token-4974', STHSTART_SESSION_SECRET: 'story-worlds-isolated-e2e-session-token-4973',
  STHSTART_DATABASE_PATH: join(directory, 'service.db'), STHSTART_NARRATIVE_DATABASE_PATH: join(directory, 'narrative.db'),
  STHSTART_ARTIFACT_DIR: join(directory, 'artifacts'), STHSTART_LOG_DIR: join(directory, 'logs'), STHSTART_LAN_ACCESS: 'false',
});
const database = new ServiceDatabase(config.databasePath);
const stamp = new Date().toISOString();
database.connection.prepare("INSERT INTO provider_profiles(id,name,kind,base_url,model,enabled,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)")
  .run('world-test-model', '隔离文本模型', 'llm', 'https://world-test.invalid/v1', 'fixture-story-model', stamp, stamp);
database.connection.prepare("INSERT INTO provider_profile_options(profile_id,thinking_mode,headers_json,extra_body_json,capabilities_json) VALUES (?,'omit','{}','{}',?)").run('world-test-model', JSON.stringify(['text']));
let calls = 0;
let stepDelayMs = 30;
const fetcher: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body ?? '{}'));
  if (!Array.isArray(body.messages)) throw new Error('Fixture denies non-text upstream call');
  calls++;
  const request = JSON.parse(body.messages.at(-1).content);
  const input = request.input;
  let output: unknown;
  if (input.context?.actor) {
    output = { actorId: input.context.actor.id, action: '在港口整理日常工作，与在场朋友交谈。',
      targetLocationId: input.context.state.locationId, prerequisiteFactIds: [], interactWithActorIds: [] };
  } else if (input.snapshot) {
    const snap = input.snapshot;
    const start = snap.branch.currentTick;
    const actors = snap.definition.actors as WorldDefinition['actors'];
    const dayEvent = (actor: WorldDefinition['actors'][number], index: number) => ({
      id: 'day-' + start + '-' + actor.id, tick: start + 1, duration: 0,
      title: actor.name + '的清晨', summary: actor.name + '独自整理行李，准备迎接归航的朋友。',
      locationId: actor.locationId, participantIds: [actor.id],
      facts: [{ id: 'fact-' + start + '-' + index, content: actor.name + '整理了自己的行李。', knownBy: [actor.id], nature: 'ai' }],
      causeEventIds: [] as string[], storyLineIds: snap.storyLines.filter((l: { actorIds: string[] }) => l.actorIds.includes(actor.id)).map((l: { id: string }) => l.id), stateChanges: [],
    });
    const events = actors.map(dayEvent);
    const pair = actors.slice(0, 2);
    events.push({ id: 'meeting-' + start, tick: start + 2, duration: 0, title: '港口的重逢',
      summary: pair.map(a => a.name).join('与') + '在码头相遇，约好一起去茶室。',
      locationId: actors[0].locationId, participantIds: pair.map(a => a.id),
      facts: [{ id: 'fact-meeting-' + start, content: '两人在港口相遇并约好稍后同行。', knownBy: pair.map(a => a.id), nature: 'ai' }],
      causeEventIds: [events[0].id], storyLineIds: [], stateChanges: [] });
    output = { events, supportingActors: [], transfers: [], beliefs: [],
      consumedInterventionIds: snap.interventions.filter((i: { consumed: boolean; tick: number }) => !i.consumed && i.tick <= snap.toTick).map((i: { id: string }) => i.id), violatedLockedFacts: [] };
  } else if (input.actor && input.events) {
    output = { passages: input.events.map((e: { id: string; facts: Array<{ id: string; content: string }> }) => ({
      eventId: e.id, actorId: input.actor.id, factIds: e.facts.map(f => f.id),
      text: input.actor.name + '望着潮水漫过石阶。' + e.facts.map(f => f.content).join('') + '熟悉的港口让这一天显得安静而踏实。',
    })) };
  } else if (input.payload) output = { approved: true, issues: [] };
  else throw new Error('Unknown fixture stage: ' + JSON.stringify(input).slice(0, 200));
  await new Promise(resolve => setTimeout(resolve, stepDelayMs));
  return Response.json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(output) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } });
};
const store = new StoryWorldStore(database);
const definition = (title: string, count: number): WorldDefinition => ({ title, summary: '围绕一次归航展开的共同生活。', timeLabel: '归航日',
  locations: [{ id: 'harbor', name: '港口', description: '石阶、潮汐和茶香。' }],
  actors: Array.from({ length: count }, (_, index) => ({ id: 'actor-' + index, name: ['林舟', '苏禾', '遥音'][index] ?? '居民' + (index + 1),
    role: 'main', characterId: null, characterVersion: null, background: '在港口生活多年。', personality: '温和谨慎', speechStyle: '自然简洁', appearance: '亚麻外套',
    goals: ['完成日常工作'], locationId: 'harbor', referenceArtifactIds: [] })),
  sources: [{ id: 'setting', title: '港口设定', nature: 'author', content: '这里没有魔法，是普通的海边小镇。', sourceUrl: '', sourceVersion: '1', capturedAt: stamp }],
  lockedFacts: ['世界没有魔法'], models: { action: 'world-test-model', adjudication: 'world-test-model', narration: 'world-test-model' }, visualStyle: '柔和纸感插画',
});
const world = store.create(definition('归航后的日常', 3));
const branch = store.createBranch(world.id, { title: '归航主线', mode: 'canon-gap', direction: '平静的生活和偶然相遇。', expectedRevision: world.revision });

const comparisonBranch = store.createBranch(world.id, {
  title: '海潮平行线', mode: 'alternate', direction: '海潮退去后的另一条支线。', expectedRevision: world.revision,
});
const mobileBranch = store.createBranch(world.id, { title: '移动端验收分支', mode: 'alternate', direction: '隔离的阅读与暂停验收。', expectedRevision: world.revision });
const comparisonEvents: WorldEvent[] = [{
  id: 'comp-event-1', worldId: world.id, branchId: comparisonBranch.id, tick: 1, duration: 0,
  title: '平行世界的雾气', summary: '海面上弥漫着未曾见过的浓雾。', locationId: 'harbor',
  participantIds: [world.actors[0].id],
  facts: [{ id: 'fact-comp-1', content: '浓雾笼罩了整个港口。', knownBy: [world.actors[0].id], nature: 'ai' }],
  perspectives: [{ actorId: world.actors[0].id, text: '林舟站在码头前，浓雾遮蔽了归航的船只。' }],
  causeEventIds: [], storyLineIds: [], stateChanges: [], createdAt: stamp,
}];
store.commitStep(world.id, comparisonBranch.id, comparisonBranch.revision, {
  tick: 1, events: comparisonEvents, memories: [], states: [] as WorldActorState[], consumedInterventionIds: [],
});

const uncertainWorld = store.create(definition('异常调用排查世界', 2));
const uncertainBranch = store.createBranch(uncertainWorld.id, {
  title: '排查分支', mode: 'canon-gap', direction: '测试调用结果不明时的恢复流程。', expectedRevision: uncertainWorld.revision,
});
const uncertainRunId = 'run-uncertain-fixture-1';
const uncertainStepId = 'step-uncertain-fixture-1';
const uncertainCallId = 'call-uncertain-fixture-1';
const uncertainRunData: WorldRun = {
  id: uncertainRunId, worldId: uncertainWorld.id, branchId: uncertainBranch.id, status: 'uncertain',
  settings: { durationTicks: 60, stepTicks: 60, maxTextCalls: 40, maxImages: 10, autoImages: false },
  startTick: 0, targetTick: 60, completedTick: 0, textCallsUsed: 4, imagesSubmitted: 0,
  pauseReason: '模型调用结果不明，已停止派发；核对成功前不会重放。', createdAt: stamp, updatedAt: stamp,
};
database.connection.prepare(
  "INSERT INTO sw_runs (id, world_id, branch_id, status, data_json, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, 'uncertain', ?, ?, ?, ?)"
).run(uncertainRunId, uncertainWorld.id, uncertainBranch.id, JSON.stringify(uncertainRunData), 'idemp-uncertain-1', stamp, stamp);
database.connection.prepare(
  "INSERT INTO sw_run_steps (id, run_id, step_key, from_tick, to_tick, branch_revision, status, snapshot_json, result_json, error, lease_owner, lease_until, created_at, updated_at) VALUES (?, ?, 'step-0', 0, 60, ?, 'pending', '{}', NULL, '', NULL, 0, ?, ?)"
).run(uncertainStepId, uncertainRunId, uncertainBranch.revision, stamp, stamp);
database.connection.prepare(
  "INSERT INTO sw_run_calls (id, step_id, stage_key, attempt, purpose, status, request_json, response_text, ai_call_id, error, created_at, updated_at) VALUES (?, ?, 'action:actor-0', 0, 'action', 'uncertain', '{}', NULL, 'upstream-call-524', '模型调用结果不明（网关 524 超时）。请核对供应商记录或已经收到的原始响应。', ?, ?)"
).run(uncertainCallId, uncertainStepId, stamp, stamp);
database.connection.prepare('UPDATE sw_run_calls SET request_json=? WHERE id=?').run(JSON.stringify({
  callId: uncertainCallId, runId: uncertainRunId, stepId: uncertainStepId, worldId: uncertainWorld.id, branchId: uncertainBranch.id,
  stage: 'action:actor-0', purpose: 'action', profileId: 'world-test-model', system: 'Fixture only', input: {},
}), uncertainCallId);

const performanceWorld = store.create(definition('十二人的港口', 12));
const performanceBranch = store.createBranch(performanceWorld.id, {
  title: '一千段经历',
  mode: 'alternate',
  direction: '十二名主要角色在港口生活推演。',
  expectedRevision: performanceWorld.revision,
});
const performanceLine1 = store.addStoryLine(performanceWorld.id, performanceBranch.id, {
  title: '灯塔修缮线',
  description: '围绕港口主灯塔与防波堤的协同维护。',
  actorIds: [performanceWorld.actors[0].id, performanceWorld.actors[1].id],
  expectedRevision: performanceBranch.revision,
});
const branchRev1 = store.getBranch(performanceWorld.id, performanceBranch.id).revision;
const performanceLine2 = store.addStoryLine(performanceWorld.id, performanceBranch.id, {
  title: '潮汐观测线',
  description: '水文记录与潮汐观测记录。',
  actorIds: [performanceWorld.actors[2].id, performanceWorld.actors[3].id],
  expectedRevision: branchRev1,
});
const branchRev2 = store.getBranch(performanceWorld.id, performanceBranch.id).revision;

const events: WorldEvent[] = Array.from({ length: 1000 }, (_, index) => {
  const actor = performanceWorld.actors[index % 12];
  const ids = index % 10 === 0 ? [actor.id, performanceWorld.actors[(index + 1) % 12].id] : [actor.id];
  const storyLineIds: string[] = [];
  if (index % 5 === 0) storyLineIds.push(performanceLine1.id);
  if (index % 7 === 0) storyLineIds.push(performanceLine2.id);
  return { id: 'fixture-event-' + index, worldId: performanceWorld.id, branchId: performanceBranch.id, tick: index + 1, duration: 0,
    title: '港口生活片段 ' + (index + 1), summary: actor.name + '在港口完成了日常任务。', locationId: 'harbor', participantIds: ids,
    facts: [{ id: 'fixture-fact-' + index, content: '完成日常工作 ' + index, knownBy: ids, nature: 'author' }],
    perspectives: ids.map(actorId => ({ actorId, text: '海风轻轻吹来，码头上的人们相互照应。今天又完成了一件小事，生活继续向前。' })),
    causeEventIds: [], storyLineIds, stateChanges: [], createdAt: stamp };
});
store.commitStep(performanceWorld.id, performanceBranch.id, branchRev2, { tick: 1000, events, memories: [], states: [] as WorldActorState[], consumedInterventionIds: [] });
const project = new StoryStore(database).createProject({ title: '归航故事集', summary: '' });
const service = await createService({ config, database, secrets: new SecretStore({}), fetcher });
service.app.post('/__fixture/delay', async (request) => {
  const body = request.body as { ms?: number } | undefined;
  stepDelayMs = Number(body?.ms ?? 30);
  return { stepDelayMs };
});
service.app.get('/__fixture', async () => ({
  worldId: world.id, branchId: branch.id, comparisonBranchId: comparisonBranch.id, mobileBranchId: mobileBranch.id,
  performanceWorldId: performanceWorld.id, performanceBranchId: performanceBranch.id,
  performanceLine1Id: performanceLine1.id, performanceLine2Id: performanceLine2.id,
  uncertainWorldId: uncertainWorld.id, uncertainBranchId: uncertainBranch.id,
  uncertainRunId, uncertainCallId, projectId: project.id, calls,
}));
let closing = false;
const close = async () => { if (closing) return; closing = true; await service.app.close(); database.close(); rmSync(directory, { recursive: true, force: true }); };
process.once('SIGTERM', () => { void close(); }); process.once('SIGINT', () => { void close(); });
await service.app.listen({ host: '127.0.0.1', port: config.port });
