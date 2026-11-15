import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ServiceDatabase } from '../database.js';
import { StoryWorldStore } from './store.js';
import { STORY_WORLD_MIGRATION_STATEMENTS } from './migration.js';
import { WORLD_RUNTIME_MIGRATION_STATEMENTS } from './runtime-migration.js';
import { WORLD_ROUTINE_MIGRATION_STATEMENTS } from './runtime-routine-migration.js';
import { WorldMemorySummaries, memorySummaryLimits } from './runtime.memory.js';
import type { WorldEvent, WorldMemory } from '@sthstart/contracts';
import type { WorldSimulationSnapshot } from './simulation.js';

function fixture(path = ':memory:') {
  const db = new ServiceDatabase(path);
  for (const sql of [...STORY_WORLD_MIGRATION_STATEMENTS, ...WORLD_RUNTIME_MIGRATION_STATEMENTS, ...WORLD_ROUTINE_MIGRATION_STATEMENTS]) db.connection.exec(sql);
  const store = new StoryWorldStore(db);
  const world = store.create({ title: '个人摘要', summary: '', timeLabel: '', locations: [{ id: 'room', name: '房间', description: '不得送进个人摘要的全知描述' }],
    actors: ['a', 'b'].map((id) => ({ id, name: id, role: 'main', characterId: null, characterVersion: null, background: '', personality: '', speechStyle: '', appearance: '',
      goals: ['工作'], locationId: 'room', referenceArtifactIds: [] })), sources: [], lockedFacts: [], models: { action: null, adjudication: null, narration: null }, visualStyle: '' });
  const branch = store.createBranch(world.id, { expectedRevision: world.revision, title: '本分支', mode: 'alternate', direction: '' });
  const snapshot: WorldSimulationSnapshot = { worldId: world.id, branch, definition: store.definition(world.id, branch.id), states: store.detail(world.id, branch.id).states, events: [], memories: [], interventions: [], storyLines: [], toTick: 60 };
  const event = (id: string, tick: number, owner: string, text: string): WorldEvent => ({ id, worldId: world.id, branchId: branch.id, tick, duration: 0, title: '', summary: '不可用的全知事件说明', locationId: 'room', participantIds: [owner],
    facts: [{ id: id + '-fact', content: text, knownBy: [owner], nature: 'ai' }], perspectives: [], stateChanges: [], causeEventIds: [], storyLineIds: [], createdAt: '' });
  return { db, store, world, branch, snapshot, event };
}

test('bounded personal digests include only legal facts and sourced beliefs; future, branch and actor secrets never enter', () => {
  const f = fixture();
  try {
    f.snapshot.branch.currentTick = 50; f.snapshot.toTick = 60;
    f.snapshot.events = [f.event('visible', 10, 'a', '箱子是空的'), f.event('secret', 12, 'b', '密室口令是暮光'),
      f.event('future', 100, 'a', '未来会出现风暴'), { ...f.event('other', 10, 'a', '另一分支藏有地图'), branchId: 'other' }];
    f.snapshot.memories = [{ id: 'belief', worldId: f.world.id, branchId: f.branch.id, actorId: 'a', sourceEventId: 'visible', learnedAt: 10, kind: 'mistaken',
      content: '我误以为工具被搬走了', importance: 0.9, fromActorId: null }, { id: 'leak', worldId: f.world.id, branchId: f.branch.id, actorId: 'a', sourceEventId: 'visible', learnedAt: 10, kind: 'inferred',
      content: '我猜密室口令是暮光', importance: 1, fromActorId: null }];
    const summaries = new WorldMemorySummaries(f.db); const a = summaries.read(f.snapshot, 'a'); const b = summaries.read(f.snapshot, 'b');
    assert.equal(a.facts.length, 1); assert.equal(a.beliefs.length, 1); assert.equal(a.beliefs[0].kind, 'mistaken');
    assert.deepEqual(a.beliefs[0].evidenceFactIds, ['visible-fact']);
    assert.ok(a.facts.every((fact) => !fact.content.includes('搬走')));
    for (const secret of ['密室口令', '未来会出现', '另一分支', '全知']) assert.equal(JSON.stringify(a).includes(secret), false);
    assert.equal(b.facts.length, 1); assert.equal(JSON.stringify(b).includes('箱子'), false);
    const row = f.db.connection.prepare("SELECT fingerprint,data_json FROM sw_memory_summaries WHERE actor_id='a'").get()!;
    const tampered = JSON.parse(String(row.data_json)); tampered.facts.push({ id: 'bad', eventId: 'secret', tick: 12, content: '密室口令是暮光' });
    f.db.connection.prepare("UPDATE sw_memory_summaries SET data_json=? WHERE actor_id='a'").run(JSON.stringify(tampered));
    assert.equal(JSON.stringify(summaries.read(f.snapshot, 'a')).includes('密室口令'), false, 'stored summaries are revalidated, never trusted as authorization');
    f.db.connection.prepare("UPDATE sw_memory_summaries SET data_json='{' WHERE actor_id='a'").run();
    assert.equal(summaries.read(f.snapshot, 'a').facts.length, 1);
  } finally { f.db.close(); }
});

test('summary storage is bounded, reusable after reopen, and rebuilt for new knowledge or elapsed validity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'world-summary-')); const path = join(dir, 'db'); const f = fixture(path); let reopened: ServiceDatabase | undefined;
  try {
    f.snapshot.branch.currentTick = 100; f.snapshot.toTick = 110;
    f.snapshot.events = Array.from({ length: 80 }, (_, i) => f.event('past-' + i, i + 1, 'a', '已知内容' + i + '。' + '描述'.repeat(100)));
    const summaries = new WorldMemorySummaries(f.db); const first = summaries.read(f.snapshot, 'a');
    assert.ok(first.facts.length <= memorySummaryLimits.facts); assert.ok(JSON.stringify(first).length <= memorySummaryLimits.characters); assert.ok(first.omittedFacts > 0);
    assert.deepEqual(summaries.read(f.snapshot, 'a'), first);
    assert.equal(f.db.connection.prepare('SELECT rebuilds,reuse_count FROM sw_memory_summaries').get()?.reuse_count, 1);
    f.db.close(); reopened = new ServiceDatabase(path); const afterRestart = new WorldMemorySummaries(reopened);
    assert.deepEqual(afterRestart.read(f.snapshot, 'a'), first);
    assert.equal(reopened.connection.prepare('SELECT rebuilds FROM sw_memory_summaries').get()?.rebuilds, 1);
    const updated = { ...f.snapshot, events: [...f.snapshot.events, f.event('new', 101, 'a', '刚刚获知新工作安排')], branch: { ...f.snapshot.branch, currentTick: 101 }, toTick: 115 };
    const changed = afterRestart.read(updated, 'a'); assert.ok(changed.facts.some((fact) => fact.content === '刚刚获知新工作安排'));
    assert.equal(reopened.connection.prepare('SELECT rebuilds FROM sw_memory_summaries').get()?.rebuilds, 2);
    afterRestart.read({ ...updated, branch: { ...updated.branch, currentTick: 300 }, toTick: 310 }, 'a');
    assert.equal(reopened.connection.prepare('SELECT rebuilds FROM sw_memory_summaries').get()?.rebuilds, 3);
  } finally { if (reopened) reopened.close(); else { try { f.db.close(); } catch {} } rmSync(dir, { recursive: true, force: true }); }
});

test('an earlier branch rebuilds from its own completed history, never the parent summary or pending intent', () => {
  const f = fixture();
  try {
    const early = f.event('early', 10, 'a', '早先看见空木盒'); const later = f.event('later', 30, 'a', '后来获知藏钥匙的位置');
    f.store.commitStep(f.world.id, f.branch.id, f.branch.revision, { tick: 30, events: [early, later], states: [], memories: [], consumedInterventionIds: [] });
    const detail = f.store.detail(f.world.id, f.branch.id);
    const parent = { ...f.snapshot, branch: detail.branch, states: detail.states, events: [early, later], toTick: 40 };
    const summaries = new WorldMemorySummaries(f.db); assert.ok(summaries.read(parent, 'a').facts.some((fact) => fact.eventId === 'later'));
    const fork = f.store.createBranch(f.world.id, { title: '早期', mode: 'adaptation', expectedRevision: f.world.revision, direction: '', parentBranchId: f.branch.id, forkTick: 15 });
    const forkDetail = f.store.detail(f.world.id, fork.id);
    const child = { ...parent, branch: fork, definition: forkDetail.definition, states: forkDetail.states, events: f.store.events(f.world.id, fork.id, {}).items, toTick: 25 };
    const digest = summaries.read(child, 'a'); assert.equal(digest.branchId, fork.id); assert.equal(digest.facts.length, 1);
    assert.equal(JSON.stringify(digest).includes('藏钥匙'), false);
    assert.equal(f.db.connection.prepare('SELECT count(*) AS n FROM sw_memory_summaries').get()?.n, 2);
  } finally { f.db.close(); }
});

test('bounded context preserves the numerical clock across midnight without sending time labels', () => {
  const f = fixture();
  try {
    const snapshot: WorldSimulationSnapshot = { ...f.snapshot, definition: { ...f.snapshot.definition, startMinuteOfDay: 480, timeLabel: '机密起点：密室口令暮光' } as WorldSimulationSnapshot['definition'],
      branch: { ...f.snapshot.branch, currentTick: 961 }, toTick: 1021 };
    const context = new WorldMemorySummaries(f.db).context(snapshot, 'a');
    assert.deepEqual(context.clock, { day: 1, minuteOfDay: 1 });
    assert.equal(context.time.dayNightDefined, true); assert.equal(context.time.localMinuteOfDay, 1);
    assert.equal(JSON.stringify(context).includes('密室口令'), false);
  } finally { f.db.close(); }
});
