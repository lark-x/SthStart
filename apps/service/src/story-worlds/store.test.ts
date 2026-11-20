import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_WORLD_RUN_SETTINGS, type WorldActor, type WorldActorState, type WorldDefinition,
  type WorldEvent, type WorldMemory, type WorldRun,
} from '@sthstart/contracts';
import { ServiceDatabase } from '../database.js';
import { STORY_WORLD_MIGRATION_STATEMENTS } from './migration.js';
import { StoryWorldError, StoryWorldStore } from './store.js';

const at = '2026-01-01T00:00:00.000Z';
const definition = (): WorldDefinition => ({
  title: '璃月港的冬天', summary: '两个老朋友在港口重逢。', timeLabel: '重逢前',
  locations: [
    { id: 'loc-harbor', name: '港口', description: '潮声不断。' },
    { id: 'loc-tea', name: '茶室', description: '午后安静。' },
  ],
  actors: [
    {
      id: 'actor-a', name: '甲', role: 'main', characterId: null, characterVersion: null,
      background: '常年在港口工作。', personality: '谨慎。', speechStyle: '简短。', appearance: '深色外套。',
      goals: ['找到失散的同伴'], locationId: 'loc-harbor', referenceArtifactIds: [],
    },
    {
      id: 'actor-b', name: '乙', role: 'main', characterId: null, characterVersion: null,
      background: '刚回到璃月。', personality: '直率。', speechStyle: '语速快。', appearance: '浅色围巾。',
      goals: ['拜访旧友'], locationId: 'loc-tea', referenceArtifactIds: [],
    },
  ],
  sources: [{
    id: 'source-canon', title: '原作港口描写', nature: 'canon', content: '第一版资料。',
    sourceUrl: 'https://example.test/canon', sourceVersion: '1.0', capturedAt: at,
  }],
  lockedFacts: ['两人认识多年。'],
  models: { action: null, adjudication: null, narration: null }, visualStyle: '水墨。',
});

function fixture() {
  const database = new ServiceDatabase(':memory:');
  for (const statement of STORY_WORLD_MIGRATION_STATEMENTS) database.connection.exec(statement);
  const store = new StoryWorldStore(database);
  const world = store.create(definition());
  const branch = store.createBranch(world.id, {
    title: '主线', mode: 'canon-gap', direction: '先写重逢。', expectedRevision: world.revision,
  });
  return { database, store, world, branch };
}

test('visual references preserve optional clock and reject dangling scene scope or duplicate media', () => {
  const database = new ServiceDatabase(':memory:');
  const store = new StoryWorldStore(database);
  try {
    const reference = { id: 'loc-harbor', name: '港口锚点', kind: 'location' as const, description: '木桌', referenceArtifactIds: ['scene'] };
    const world = store.create({ ...definition(), startMinuteOfDay: 480, visualReferences: [reference] });
    const branch = store.createBranch(world.id, { title: '原作', mode: 'canon-gap', direction: '', expectedRevision: world.revision });
    assert.equal(store.definition(world.id, branch.id).startMinuteOfDay, 480);
    assert.deepEqual(store.definitionAtTick(world.id, branch.id, 0).visualReferences, [reference]);
    for (const invalid of [
      [{ ...reference, id: 'missing' }],
      [{ ...reference, locationId: 'missing' }],
      [reference, reference],
      [{ ...reference, referenceArtifactIds: ['scene', 'scene'] }],
    ]) assert.throws(() => store.create({ ...definition(), visualReferences: invalid }), (error: any) => error.code === 'story_definition_invalid');
  } finally { database.close(); }
});

test('title-only setup remains outside runtime until atomic, idempotent completion', () => {
  const { database, store, world: existing } = fixture();
  try {
    const input = { title: ' 雾港 ', idempotencyKey: 'create-fog-harbor' };
    const created = store.createSetup(input);
    assert.deepEqual(store.createSetup(input), created);
    assert.throws(() => store.createSetup({ ...input, title: '不同名称' }), { code: 'story_creation_idempotency_conflict' });
    assert.deepEqual(store.listSetups().items, [created]);
    assert.deepEqual(store.list().items.map((item) => item.id), [existing.id]);
    assert.throws(() => store.createBranch(created.id, {
      title: '主线', mode: 'canon-gap', direction: '', expectedRevision: 1,
    }), { code: 'story_world_not_found' });

    const setup = store.getSetup(created.id);
    const draft = { ...setup.draft, definition: { ...setup.draft.definition, locations: definition().locations } };
    assert.throws(() => store.saveSetup(created.id, { draft, expectedRevision: 1, complete: true }), { code: 'story_definition_invalid' });
    const partial = store.saveSetup(created.id, { draft, expectedRevision: 1, complete: false });
    assert.equal(partial.status, 'pending');
    if (partial.status !== 'pending') throw Error('expected pending setup');
    assert.equal(partial.setup.revision, 2);
    assert.throws(() => store.saveSetup(created.id, { draft, expectedRevision: 1, complete: false }), { code: 'story_setup_conflict' });
    const completion = {
      draft: { ...draft, definition: { ...draft.definition, actors: definition().actors } },
      expectedRevision: 2, complete: true,
    };
    const completed = store.saveSetup(created.id, completion);
    assert.equal(completed.status, 'ready');
    if (completed.status !== 'ready') throw Error('expected ready world');
    assert.equal(completed.world.id, created.id);
    assert.deepEqual(store.saveSetup(created.id, completion), completed);
    assert.deepEqual(store.listSetups().items, []);
    assert.deepEqual(store.overview(created.id).branches.map((branch) => branch.id), [completed.branch.id]);
  } finally { database.close(); }
});

test('pending completion rolls back the world when its initial branch cannot be written', () => {
  const { database, store } = fixture();
  try {
    const created = store.createSetup({ title: '雾港', idempotencyKey: 'rollback-setup' });
    const setup = store.getSetup(created.id);
    const input = { expectedRevision: setup.revision, complete: true, draft: { ...setup.draft, definition: definition() } };
    database.connection.exec("CREATE TEMP TRIGGER reject_initial_branch BEFORE INSERT ON sw_branches BEGIN SELECT RAISE(ABORT, 'fixture branch failure'); END");
    assert.throws(() => store.saveSetup(created.id, input), /fixture branch failure/);
    assert.deepEqual(store.getSetup(created.id), setup);
    assert.equal(store.list().items.some((world) => world.id === created.id), false);
    database.connection.exec('DROP TRIGGER reject_initial_branch');
    const result = store.saveSetup(created.id, input);
    assert.equal(result.status, 'ready');
    assert.equal(store.overview(created.id).branches.length, 1);
  } finally { database.close(); }
});

test('setup creation keys bind nature and mother work across draft edits and completion', () => {
  const database = new ServiceDatabase(':memory:');
  const store = new StoryWorldStore(database);
  try {
    const request = { title: '港口同人', workNature: 'derivative' as const, parentWork: '星铁', idempotencyKey: 'full-identity' };
    const created = store.createSetup(request);
    assert.equal(created.parentWork, '崩坏：星穹铁道');
    assert.deepEqual(store.createSetup({ ...request, parentWork: '崩坏：星穹铁道' }), created);
    assert.throws(() => store.createSetup({ ...request, workNature: 'original' }), { code: 'story_creation_idempotency_conflict' });
    assert.throws(() => store.createSetup({ ...request, parentWork: '原神' }), { code: 'story_creation_idempotency_conflict' });
    const setup = store.getSetup(created.id);
    const draft = { ...setup.draft, definition: { ...setup.draft.definition, title: '港口新名', locations: definition().locations, actors: definition().actors } };
    const saved = store.saveSetup(created.id, { expectedRevision: setup.revision, complete: false, draft });
    assert.equal(saved.status, 'pending');
    assert.equal(store.createSetup(request).id, created.id);
    const complete = store.saveSetup(created.id, { expectedRevision: 2, complete: true, draft });
    assert.equal(complete.status, 'ready');
    assert.equal(store.createSetup(request).id, created.id);
    assert.equal(database.connection.prepare('SELECT count(*) n FROM character_works WHERE world_id=?').get(created.id)!.n, 1);
    assert.equal(database.connection.prepare('SELECT name FROM character_works WHERE world_id=?').get(created.id)!.name, '港口新名');
  } finally { database.close(); }
});

test('invalid mother work cannot leave a partial setup or directory', () => {
  const database = new ServiceDatabase(':memory:');
  const store = new StoryWorldStore(database);
  try {
    assert.throws(() => store.createSetup({ title: '失效同人', workNature: 'derivative', parentWork: '不存在', idempotencyKey: 'invalid' }), { code: 'character_parent_work_missing' });
    assert.equal(store.listSetups().items.length, 0);
    assert.equal(database.connection.prepare('SELECT count(*) n FROM character_works WHERE name=?').get('失效同人')!.n, 0);
  } finally { database.close(); }
});

function event(
  worldId: string, branchId: string, id: string, tick: number, participantIds: string[],
  patch: Partial<WorldEvent> = {},
): WorldEvent {
  return {
    id, worldId, branchId, tick, duration: 0, title: id, summary: '', locationId: 'loc-harbor',
    participantIds, facts: [], perspectives: [], causeEventIds: [], storyLineIds: [], stateChanges: [],
    createdAt: at, ...patch,
  };
}

function state(actorId: string, locationId: string, updatedTick: number): WorldActorState {
  return { actorId, locationId, goals: [], emotion: '', relationships: [], updatedTick };
}

function memory(
  worldId: string, branchId: string, id: string, actorId: string, sourceEventId: string,
  learnedAt: number, kind: WorldMemory['kind'], fromActorId: string | null = null, content?: string,
): WorldMemory {
  return {
    id, worldId, branchId, actorId, sourceEventId, learnedAt, kind,
    content: content ?? `${actorId} 记住了 ${sourceEventId}`, importance: 0.5, fromActorId,
  };
}

function addCharacter(database: ServiceDatabase, id = 'char-1', version = 2) {
  database.connection.prepare(`INSERT INTO character_profiles
    (id,slug,display_name,draft_json,tags_json,avatar_asset_id,latest_version,archived,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, id, '来源角色', '{"name":"来源角色"}', '[]', null, version, 0, at, at);
  database.connection.prepare(`INSERT INTO character_versions
    (character_id,version,data_json,compiled_linshe_prompt,relationships_json,created_at)
    VALUES (?,?,?,?,?,?)`).run(id, version, '{"name":"来源角色","locked":1}', 'prompt', '[]', at);
}

test('relationships may cite the event producing their state change and preserve its ID', () => {
  const f = fixture();
  try {
    const meetingId = 'ev-cleanharbor-meet-005';
    const states = ['actor-a', 'actor-b'].map((actorId, i) => ({
      ...state(actorId, 'loc-harbor', 30),
      relationships: [{ actorId: i === 0 ? 'actor-b' : 'actor-a', description: '重逢后愿意相互帮忙。', sourceEventId: meetingId }],
    }));
    const meeting = event(f.world.id, f.branch.id, meetingId, 21, ['actor-a', 'actor-b'], { duration: 9, stateChanges: states });
    const committed = f.store.commitStep(f.world.id, f.branch.id, f.branch.revision, {
      tick: 30, events: [meeting], states, memories: [], consumedInterventionIds: [],
    });
    assert.equal(committed.currentTick, 30);
    assert.deepEqual(f.store.events(f.world.id, f.branch.id, {}).items, [meeting]);
    for (const saved of f.store.detail(f.world.id, f.branch.id).states) {
      assert.equal(saved.relationships[0].sourceEventId, meetingId);
    }
    assert.equal(f.store.commitStep(f.world.id, f.branch.id, f.branch.revision, {
      tick: 30, events: [meeting], states, memories: [], consumedInterventionIds: [],
    }).revision, committed.revision);
  } finally { f.database.close(); }
});

test('relationship sources must still exist on this branch and cannot come from future events', () => {
  const f = fixture();
  try {
    const other = f.store.createBranch(f.world.id, { title: '其他分支', mode: 'alternate', direction: '', expectedRevision: f.world.revision });
    f.store.commitStep(f.world.id, other.id, other.revision, {
      tick: 10, events: [event(f.world.id, other.id, 'other-meeting', 10, ['actor-a', 'actor-b'])],
      states: [], memories: [], consumedInterventionIds: [],
    });
    const changed = (sourceEventId: string) => ({
      ...state('actor-a', 'loc-harbor', 30),
      relationships: [{ actorId: 'actor-b', description: '愿意帮忙。', sourceEventId }],
    });
    const attempt = (sourceId: string, extra: WorldEvent[] = [], prefix: WorldEvent[] = []) => f.store.commitStep(
      f.world.id, f.branch.id, f.branch.revision, {
        tick: 60, events: [...prefix, event(f.world.id, f.branch.id, 'meeting', 21, ['actor-a', 'actor-b'], {
          duration: 9, stateChanges: [changed(sourceId)],
        }), ...extra], states: [], memories: [], consumedInterventionIds: [],
      },
    );
    assert.throws(() => attempt('missing'), /来源事件 missing 不存在/);
    assert.throws(() => attempt('other-meeting'), /来源事件 other-meeting 不存在/);
    const future = event(f.world.id, f.branch.id, 'future', 40, ['actor-a', 'actor-b']);
    assert.throws(() => attempt('future', [future]), /来源事件 future 不存在/);
    assert.throws(() => attempt('future', [], [future]), /不能引用晚于状态时点/);
    assert.throws(() => f.store.commitStep(f.world.id, f.branch.id, f.branch.revision, {
      tick: 60, events: [future], states: [changed('future')], memories: [], consumedInterventionIds: [],
    }), /不能引用晚于状态时点/);
    assert.equal(f.store.events(f.world.id, f.branch.id, {}).total, 0);
    assert.equal(f.store.getBranch(f.world.id, f.branch.id).currentTick, 0);
    assert.equal(f.store.getBranch(f.world.id, f.branch.id).revision, f.branch.revision);
    assert.ok(f.store.detail(f.world.id, f.branch.id).states.every((saved) => saved.relationships.length === 0));
  } finally { f.database.close(); }
});

test('historical fork inherits only events, memories and states at the fork tick', () => {
  const f = fixture();
  try {
    const line = f.store.addStoryLine(f.world.id, f.branch.id, {
      expectedRevision: f.branch.revision, title: '寻找旧友', description: '主线', actorIds: ['actor-a'],
    });
    let revision = f.branch.revision + 1;
    const first = f.store.commitStep(f.world.id, f.branch.id, revision, {
      tick: 60,
      events: [event(f.world.id, f.branch.id, 'event-1', 60, ['actor-a'], { storyLineIds: [line.id] })],
      memories: [memory(f.world.id, f.branch.id, 'memory-1', 'actor-a', 'event-1', 60, 'experienced')],
      states: [state('actor-a', 'loc-tea', 60)], consumedInterventionIds: [],
    });
    revision = first.revision;
    const supporting: WorldActor = {
      id: 'actor-c', name: '丙', role: 'supporting', characterId: null, characterVersion: null,
      background: '临时出现的船工。', personality: '热心。', speechStyle: '方言。', appearance: '斗笠。',
      goals: ['送信'], locationId: 'loc-harbor', referenceArtifactIds: [],
    };
    const run: WorldRun = {
      id: 'run-1', worldId: f.world.id, branchId: f.branch.id, status: 'running',
      settings: DEFAULT_WORLD_RUN_SETTINGS, startTick: 60, targetTick: 120, completedTick: 120,
      textCallsUsed: 2, imagesSubmitted: 0, pauseReason: '', createdAt: at, updatedAt: at,
    };
    const second = f.store.commitStep(f.world.id, f.branch.id, revision, {
      tick: 120,
      events: [event(f.world.id, f.branch.id, 'event-2', 120, ['actor-a', 'actor-b', 'actor-c'])],
      memories: [memory(f.world.id, f.branch.id, 'memory-2', 'actor-b', 'event-2', 120, 'experienced')],
      states: [state('actor-b', 'loc-harbor', 120)], consumedInterventionIds: [],
      supportingActors: [supporting], run,
    });
    assert.equal(second.currentTick, 120);
    f.database.connection.prepare(`INSERT INTO sw_images
      (id,world_id,branch_id,event_id,status,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('image-1', f.world.id, f.branch.id, 'event-2', 'planned',
        JSON.stringify({ id: 'image-1', worldId: f.world.id, branchId: f.branch.id, eventId: 'event-2' }), at, at);

    const fork = f.store.createBranch(f.world.id, {
      title: '回到重逢前', mode: 'adaptation', direction: '让两人错过。',
      expectedRevision: f.world.revision, parentBranchId: f.branch.id, forkTick: 60,
    });
    assert.equal(fork.currentTick, 60);
    assert.equal(fork.sourceRevision, f.branch.sourceRevision);
    const detail = f.store.detail(f.world.id, fork.id);
    assert.deepEqual(detail.definition.actors.map((actor) => actor.id), ['actor-a', 'actor-b']);
    assert.deepEqual(detail.states.map((item) => [item.actorId, item.locationId, item.updatedTick]), [
      ['actor-a', 'loc-tea', 60], ['actor-b', 'loc-tea', 0],
    ]);
    assert.equal(detail.run, null);
    assert.deepEqual(detail.images, []);
    assert.deepEqual(f.store.events(f.world.id, fork.id, { from: 0, to: 120 }).items.map((item) => item.id), ['event-1']);
    assert.deepEqual(f.store.memories(f.world.id, fork.id).items.map((item) => item.id), ['memory-1']);

    const parent = f.store.detail(f.world.id, f.branch.id);
    assert.equal(parent.definition.actors.length, 3);
    assert.equal(parent.run?.id, 'run-1');
    assert.equal(parent.images.length, 1);
    assert.deepEqual(f.store.events(f.world.id, f.branch.id, {}).items.map((item) => item.id), ['event-1', 'event-2']);

    const advanced = f.store.commitStep(f.world.id, fork.id, fork.revision, {
      tick: 90, events: [event(f.world.id, fork.id, 'fork-event', 90, ['actor-a'])],
      memories: [], states: [], consumedInterventionIds: [],
    });
    assert.equal(advanced.currentTick, 90);
    assert.equal(f.store.getBranch(f.world.id, f.branch.id).currentTick, 120);
    assert.equal(f.store.events(f.world.id, fork.id, {}).total, 2);
    assert.equal(f.store.events(f.world.id, f.branch.id, {}).total, 2);
  } finally { f.database.close(); }
});

test('a fork during a lasting event inherits only completed outcomes, memories and states', () => {
  const f = fixture();
  try {
    const past = event(f.world.id, f.branch.id, 'before-trip', 5, ['actor-a'], {
      duration: 2, stateChanges: [state('actor-a', 'loc-harbor', 7)],
    });
    const travel = event(f.world.id, f.branch.id, 'lasting-trip', 10, ['actor-a'], {
      duration: 20, locationId: 'loc-tea', summary: '到达茶室后才看到密封信件。',
      facts: [{ id: 'late-letter', content: '茶室有一封密封信件。', knownBy: ['actor-a'], nature: 'ai' }],
      perspectives: [{ actorId: 'actor-a', text: '我走到茶室，发现了密封信件。' }],
      stateChanges: [state('actor-a', 'loc-tea', 30)], causeEventIds: [past.id],
    });
    const parallel = event(f.world.id, f.branch.id, 'other-work', 11, ['actor-b'], {
      duration: 1, locationId: 'loc-tea', stateChanges: [state('actor-b', 'loc-tea', 12)],
    });
    f.store.commitStep(f.world.id, f.branch.id, f.branch.revision, {
      tick: 30, events: [past, travel, parallel], states: [], consumedInterventionIds: [],
      memories: [memory(f.world.id, f.branch.id, 'late-memory', 'actor-a', travel.id, 30, 'experienced', null, travel.facts[0].content)],
    });
    const forkAt = (tick: number) => f.store.createBranch(f.world.id, {
      title: 't' + tick, mode: 'canon-gap', direction: '', expectedRevision: f.world.revision, parentBranchId: f.branch.id, forkTick: tick,
    });
    for (const tick of [10, 15, 29]) {
      const fork = forkAt(tick);
      const history = f.store.events(f.world.id, fork.id, { to: 60 }).items;
      assert.deepEqual(history.map(e => e.id), tick < 12 ? [past.id] : [past.id, parallel.id]);
      assert.equal(JSON.stringify(history).includes('密封信件'), false);
      assert.deepEqual(f.store.memories(f.world.id, fork.id).items, []);
      assert.deepEqual(f.store.detail(f.world.id, fork.id).states.find(s => s.actorId === 'actor-a'), state('actor-a', 'loc-harbor', 7));
      assert.equal(fork.currentTick, tick);
    }
    const finished = forkAt(30);
    assert.equal(f.store.events(f.world.id, finished.id, {}).items.some(e => e.id === travel.id), true);
    assert.equal(f.store.memories(f.world.id, finished.id).items[0].sourceEventId, travel.id);
    assert.equal(f.store.detail(f.world.id, finished.id).states.find(s => s.actorId === 'actor-a')?.locationId, 'loc-tea');
    assert.equal(f.store.events(f.world.id, f.branch.id, {}).total, 3);
  } finally { f.database.close(); }
});

test('historical fork reads the definition snapshot effective at that tick, never the latest refresh', () => {
  const f = fixture();
  try {
    const pastSupporting: WorldActor = {
      id: 'actor-past', name: '旧配角', role: 'supporting', characterId: null, characterVersion: null,
      background: '在 t20 加入。', personality: '', speechStyle: '', appearance: '', goals: [],
      locationId: 'loc-harbor', referenceArtifactIds: [],
    };
    f.store.commitStep(f.world.id, f.branch.id, f.branch.revision, {
      tick: 20, events: [], memories: [], states: [], consumedInterventionIds: [],
      supportingActors: [pastSupporting],
    });
    f.store.commitStep(f.world.id, f.branch.id, f.store.getBranch(f.world.id, f.branch.id).revision, {
      tick: 60, events: [event(f.world.id, f.branch.id, 'later-event', 60, ['actor-a'])],
      memories: [], states: [], consumedInterventionIds: [],
    });
    const changed = definition();
    changed.sources = [{ ...changed.sources[0], content: '第二版资料。', sourceVersion: '2.0' }];
    changed.actors[0] = { ...changed.actors[0], background: '刷新后才出现的角色背景。' };
    changed.locations = [...changed.locations, { id: 'loc-future', name: '后来才出现的地点', description: '未来地点。' }];
    f.store.updateWorld(f.world.id, { expectedRevision: f.world.revision, definition: changed });
    const branchBeforeRefresh = f.store.getBranch(f.world.id, f.branch.id);
    f.store.refreshSources(f.world.id, f.branch.id, branchBeforeRefresh.revision);

    const current = f.store.definition(f.world.id, f.branch.id);
    assert.equal(current.sources[0].content, '第二版资料。');
    assert.equal(current.actors[0].background, '刷新后才出现的角色背景。');
    assert.equal(current.locations.some((location) => location.id === 'loc-future'), true);

    const past = f.store.createBranch(f.world.id, {
      title: '刷新前的历史节点', mode: 'adaptation', direction: '',
      expectedRevision: 2, parentBranchId: f.branch.id, forkTick: 30,
    });
    const pastDetail = f.store.detail(f.world.id, past.id);
    assert.equal(past.sourceRevision, 1);
    assert.equal(pastDetail.definition.sources[0].content, '第一版资料。');
    assert.equal(pastDetail.definition.actors[0].background, '常年在港口工作。');
    assert.equal(pastDetail.definition.locations.some((location) => location.id === 'loc-future'), false);
    assert.equal(pastDetail.sourceUpdatesAvailable, true);
    assert.equal(f.store.events(f.world.id, past.id, {}).total, 0);
    assert.equal(pastDetail.definition.actors.some((actor) => actor.id === 'actor-past'), true);

    const beforePast = f.store.createBranch(f.world.id, {
      title: '配角加入前', mode: 'alternate', direction: '',
      expectedRevision: 2, parentBranchId: f.branch.id, forkTick: 10,
    });
    assert.equal(f.store.definition(f.world.id, beforePast.id).actors.some((actor) => actor.id === 'actor-past'), false);

    const node = f.store.createBranch(f.world.id, {
      title: '刷新节点', mode: 'canon-gap', direction: '',
      expectedRevision: 2, parentBranchId: f.branch.id, forkTick: 60,
    });
    const nodeDetail = f.store.detail(f.world.id, node.id);
    assert.equal(node.sourceRevision, 2);
    assert.equal(nodeDetail.definition.sources[0].content, '第二版资料。');
    assert.equal(nodeDetail.definition.actors[0].background, '刷新后才出现的角色背景。');
    assert.equal(nodeDetail.definition.locations.some((location) => location.id === 'loc-future'), true);
    assert.equal(nodeDetail.definition.actors.some((actor) => actor.id === 'actor-past'), true);
    assert.equal(nodeDetail.sourceUpdatesAvailable, false);
    assert.equal(f.store.events(f.world.id, node.id, {}).total, 1);
    assert.throws(() => f.store.createBranch(f.world.id, {
      title: '早于父分支起点', mode: 'alternate', direction: '',
      expectedRevision: 2, parentBranchId: node.id, forkTick: 30,
    }), /早于父分支自身起点/);
  } finally { f.database.close(); }
});

test('information can only travel from witnesses and never backwards in time', () => {
  const f = fixture();
  try {
    const secretText = '国王的钥匙藏在钟楼第三层';
    let revision = f.store.commitStep(f.world.id, f.branch.id, f.branch.revision, {
      tick: 10, events: [event(f.world.id, f.branch.id, 'secret', 10, ['actor-a'], {
        facts: [{ id: 'secret-fact', content: secretText, knownBy: ['actor-a'], nature: 'ai' }],
      })],
      memories: [], states: [], consumedInterventionIds: [],
    }).revision;
    const attempt = (memories: WorldMemory[], events: WorldEvent[] = []) => f.store.commitStep(
      f.world.id, f.branch.id, revision, { tick: 20, events, memories, states: [], consumedInterventionIds: [] },
    );
    assert.throws(() => attempt([memory(f.world.id, f.branch.id, 'early', 'actor-b', 'secret', 5, 'heard', 'actor-a')]),
      /不能早于来源事件/);
    assert.throws(() => attempt([memory(f.world.id, f.branch.id, 'fake-experience', 'actor-b', 'secret', 20, 'experienced')]),
      /不在事件.*现场/);
    assert.throws(() => attempt([memory(f.world.id, f.branch.id, 'content-leak', 'actor-b', 'secret', 20,
      'inferred', null, secretText)]), /尚未获知的事实/);
    assert.throws(() => attempt([memory(f.world.id, f.branch.id, 'no-source', 'actor-b', 'secret', 20, 'heard', 'actor-b')]),
      /不能是自己/);
    const stranger: WorldActor = {
      id: 'actor-c', name: '丙', role: 'supporting', characterId: null, characterVersion: null,
      background: '', personality: '', speechStyle: '', appearance: '', goals: [],
      locationId: 'loc-tea', referenceArtifactIds: [],
    };
    f.store.commitStep(f.world.id, f.branch.id, revision, {
      tick: 20, events: [], memories: [], states: [], consumedInterventionIds: [], supportingActors: [stranger],
    });
    revision = f.store.getBranch(f.world.id, f.branch.id).revision;
    assert.throws(() => f.store.commitStep(f.world.id, f.branch.id, revision, {
      tick: 30, events: [], consumedInterventionIds: [], states: [],
      memories: [memory(f.world.id, f.branch.id, 'gossip-without-source', 'actor-b', 'secret', 30, 'heard', 'actor-c')],
    }), /尚未获知/);
    assert.throws(() => f.store.commitStep(f.world.id, f.branch.id, revision, {
      tick: 30, memories: [], states: [], consumedInterventionIds: [],
      events: [event(f.world.id, f.branch.id, 'secret-2', 30, ['actor-a'], {
        facts: [{ id: 'fact-1', content: '只有甲知道。', knownBy: ['actor-b'], nature: 'ai' }],
      })],
    }), /尚未获知/);
    assert.equal(f.store.getBranch(f.world.id, f.branch.id).revision, revision);

    const valid = f.store.commitStep(f.world.id, f.branch.id, revision, {
      tick: 30, events: [], states: [], consumedInterventionIds: [],
      memories: [
        memory(f.world.id, f.branch.id, 'heard-c', 'actor-c', 'secret', 30, 'heard', 'actor-b', secretText),
        memory(f.world.id, f.branch.id, 'heard-b', 'actor-b', 'secret', 30, 'heard', 'actor-a', secretText),
      ],
    });
    assert.equal(valid.currentTick, 30);
    assert.deepEqual(f.store.memories(f.world.id, f.branch.id, 'actor-c').items.map((item) => item.id), ['heard-c']);
    assert.equal(f.store.getBranch(f.world.id, f.branch.id).revision, valid.revision);
  } finally { f.database.close(); }
});

test('a witness cannot remember a fact assigned to another knownBy set', () => {
  const f = fixture();
  try {
    const secret = '只有甲看见的密信在抽屉里';
    f.store.commitStep(f.world.id, f.branch.id, f.branch.revision, {
      tick: 10, memories: [], states: [], consumedInterventionIds: [],
      events: [event(f.world.id, f.branch.id, 'shared', 10, ['actor-a', 'actor-b'], {
        facts: [{ id: 'private-fact', content: secret, knownBy: ['actor-a'], nature: 'ai' }],
      })],
    });
    const revision = f.store.getBranch(f.world.id, f.branch.id).revision;
    assert.throws(() => f.store.commitStep(f.world.id, f.branch.id, revision, {
      tick: 20, events: [], states: [], consumedInterventionIds: [],
      memories: [memory(f.world.id, f.branch.id, 'b-secret', 'actor-b', 'shared', 20, 'experienced', null, secret)],
    }), /尚未获知的事实/);
    const accepted = f.store.commitStep(f.world.id, f.branch.id, revision, {
      tick: 20, events: [], states: [], consumedInterventionIds: [],
      memories: [
        memory(f.world.id, f.branch.id, 'a-secret', 'actor-a', 'shared', 20, 'experienced', null, secret),
        memory(f.world.id, f.branch.id, 'b-general', 'actor-b', 'shared', 20, 'experienced', null, '乙只记得现场很安静'),
      ],
    });
    assert.equal(accepted.currentTick, 20);
    assert.equal(f.store.memories(f.world.id, f.branch.id, 'actor-b').items.length, 1);
  } finally { f.database.close(); }
});

test('a later exact report permits earlier witness memory without treating the report as future knowledge', () => {
  const f = fixture();
  try {
    const text = '灯身外表未见裂口，尚未测试功能。';
    const source = event(f.world.id, f.branch.id, 'inspection', 10, ['actor-a'], { duration: 5,
      facts: [{ id: 'source-fact', content: text, knownBy: ['actor-a'], nature: 'ai' }] });
    const report = event(f.world.id, f.branch.id, 'report', 30, ['actor-a', 'actor-b'], {
      facts: [{ id: 'report-fact', content: text, knownBy: ['actor-a', 'actor-b'], nature: 'ai' }] });
    f.store.commitStep(f.world.id, f.branch.id, f.branch.revision, { tick: 30, events: [source, report], states: [], consumedInterventionIds: [],
      memories: [memory(f.world.id, f.branch.id, 'witness', 'actor-a', source.id, 15, 'experienced', null, text),
        memory(f.world.id, f.branch.id, 'heard', 'actor-b', source.id, 30, 'heard', 'actor-a', text)] });
    assert.equal(f.store.memories(f.world.id, f.branch.id, 'actor-a').items[0].learnedAt, 15);
    assert.equal(f.store.memories(f.world.id, f.branch.id, 'actor-b').items[0].fromActorId, 'actor-a');
  } finally { f.database.close(); }
});

test('an earlier heard chain also proves known text when a later report repeats it', () => {
  const f = fixture();
  try {
    const text = '黄铜灯的提柄连接处需要进一步检查。';
    const source = event(f.world.id, f.branch.id, 'inspection', 5, ['actor-a'], {
      facts: [{ id: 'original', content: text, knownBy: ['actor-a'], nature: 'ai' }] });
    const report = event(f.world.id, f.branch.id, 'later-report', 30, ['actor-a', 'actor-b'], {
      facts: [{ id: 'repeated', content: text, knownBy: ['actor-a', 'actor-b'], nature: 'ai' }] });
    f.store.commitStep(f.world.id, f.branch.id, f.branch.revision, { tick: 30, events: [source, report], states: [], consumedInterventionIds: [],
      memories: [memory(f.world.id, f.branch.id, 'heard-earlier', 'actor-b', source.id, 10, 'heard', 'actor-a', text)] });
    assert.equal(f.store.memories(f.world.id, f.branch.id, 'actor-b').items[0].learnedAt, 10);
  } finally { f.database.close(); }
});

test('an already-known duplicate never authorizes a different, expanded or uncompleted future fact', () => {
  for (const scenario of ['new-secret', 'expanded', 'unfinished', 'unknown-actor', 'belief', 'other-branch'] as const) {
    const f = fixture();
    try {
      const text = '灯身外表未见裂口';
      const unknown = '信封里的口令是暮光';
      const source = event(f.world.id, f.branch.id, 'known-source', 10, ['actor-a'], {
        duration: scenario === 'unfinished' ? 15 : 0,
        facts: [{ id: 'known', content: text, knownBy: ['actor-a'], nature: 'ai' }] });
      const report = event(f.world.id, f.branch.id, 'future-report', 30, ['actor-a', 'actor-b'], {
        facts: [{ id: 'future', content: scenario === 'expanded' ? text + '，且藏有一枚秘密芯片' : text, knownBy: ['actor-a', 'actor-b'], nature: 'ai' },
          { id: 'new', content: unknown, knownBy: ['actor-a', 'actor-b'], nature: 'ai' }] });
      const events = [source, report];
      if (scenario === 'other-branch') {
        f.store.commitStep(f.world.id, f.branch.id, f.branch.revision, { tick: 10, events: [source], memories: [], states: [], consumedInterventionIds: [] });
        const separate = f.store.createBranch(f.world.id, { expectedRevision: f.world.revision, title: 'independent', mode: 'alternate', direction: '' });
        report.branchId = separate.id;
        const local = event(f.world.id, separate.id, 'local', 10, ['actor-a'], {
          facts: [{ id: 'local-fact', content: '本分支人物站在港口', knownBy: ['actor-a'], nature: 'ai' }] });
        assert.throws(() => f.store.commitStep(f.world.id, separate.id, separate.revision, { tick: 30, events: [local, report], states: [], consumedInterventionIds: [],
          memories: [memory(f.world.id, separate.id, 'inferred', 'actor-a', local.id, 15, 'inferred', null, text)] }), /尚未获知的事实/);
        continue;
      }
      const actorId = scenario === 'unknown-actor' ? 'actor-b' : 'actor-a';
      const content = scenario === 'new-secret' || scenario === 'belief' ? text + '；' + unknown : scenario === 'expanded' ? report.facts[0].content : text;
      const kind = scenario === 'new-secret' || scenario === 'expanded' || scenario === 'belief' || scenario === 'unknown-actor' ? 'inferred' as const : 'experienced' as const;
      assert.throws(() => f.store.commitStep(f.world.id, f.branch.id, f.branch.revision, { tick: 30, events, states: [], consumedInterventionIds: [],
        memories: [memory(f.world.id, f.branch.id, 'attempt', actorId, source.id, 15, kind, null, content)] }), /尚未获知的事实/, scenario);
      assert.equal(f.store.events(f.world.id, f.branch.id, {}).items.length, 0, scenario);
    } finally { f.database.close(); }
  }
});

test('revision conflicts, explicit source adoption and idempotent commitStep', () => {
  const f = fixture();
  try {
    assert.throws(() => f.store.updateWorld(f.world.id, { expectedRevision: 9, definition: definition() }),
      /其他窗口|版本/);
    assert.throws(() => f.store.createBranch(f.world.id, {
      title: '错误版本', mode: 'alternate', direction: '', expectedRevision: 9,
    }), /其他窗口|版本/);

    const stepEvent = event(f.world.id, f.branch.id, 'idempotent', 30, ['actor-a']);
    const step = { tick: 30, events: [stepEvent], memories: [], states: [], consumedInterventionIds: [] };
    const first = f.store.commitStep(f.world.id, f.branch.id, f.branch.revision, step);
    const replay = f.store.commitStep(f.world.id, f.branch.id, f.branch.revision, step);
    assert.equal(replay.revision, first.revision);
    assert.equal(f.store.events(f.world.id, f.branch.id, {}).total, 1);
    assert.throws(() => f.store.commitStep(f.world.id, f.branch.id, first.revision, {
      ...step, events: [{ ...stepEvent, title: '被改写的同一事件' }],
    }), /已存在且内容不同/);
    assert.throws(() => f.store.commitStep(f.world.id, f.branch.id, 1, {
      tick: 40, events: [], memories: [], states: [], consumedInterventionIds: [],
    }), /其他窗口|版本/);

    const changed = definition();
    changed.sources = [{ ...changed.sources[0], content: '第二版资料。', sourceVersion: '2.0' }];
    const updatedWorld = f.store.updateWorld(f.world.id, { expectedRevision: f.world.revision, definition: changed });
    assert.equal(updatedWorld.revision, 2);
    const stale = f.store.detail(f.world.id, f.branch.id);
    assert.equal(stale.sourceUpdatesAvailable, true);
    assert.equal(stale.definition.sources[0].content, '第一版资料。');
    const adopted = f.store.refreshSources(f.world.id, f.branch.id, stale.branch.revision);
    assert.equal(adopted.sourceUpdatesAvailable, false);
    assert.equal(adopted.branch.sourceRevision, 2);
    assert.equal(adopted.definition.sources[0].content, '第二版资料。');
    assert.equal(adopted.branch.revision, stale.branch.revision + 1);
    assert.equal(f.store.events(f.world.id, f.branch.id, {}).items[0].id, 'idempotent');
    assert.throws(() => f.store.refreshSources(f.world.id, f.branch.id, stale.branch.revision), /其他窗口|版本/);
  } finally { f.database.close(); }
});

test('one thousand events page by time cursor without duplicates and stay branch scoped', () => {
  const f = fixture();
  try {
    const insert = f.database.connection.prepare(`INSERT INTO sw_events
      (id,world_id,branch_id,tick,duration,location_id,data_json,created_at) VALUES (?,?,?,?,?,?,?,?)`);
    f.database.transaction(() => {
      f.database.connection.prepare(`INSERT INTO sw_story_lines
        (id,world_id,branch_id,created_tick,data_json) VALUES (?,?,?,?,?)`).run('story-even',
        f.world.id, f.branch.id, 0, JSON.stringify({
          id: 'story-even', worldId: f.world.id, branchId: f.branch.id,
          title: '批量故事线', description: '', actorIds: ['actor-a'],
        }));
      for (let index = 0; index < 1000; index += 1) {
        const item = event(f.world.id, f.branch.id, `event-${String(index).padStart(4, '0')}`, index,
          index % 2 === 0 ? ['actor-a'] : ['actor-b'], {
            duration: 0, storyLineIds: index % 10 === 0 ? ['story-even'] : [],
          });
        insert.run(item.id, f.world.id, f.branch.id, index, 0, item.locationId, JSON.stringify(item), at);
      }
      const branch = f.store.getBranch(f.world.id, f.branch.id);
      f.database.connection.prepare('UPDATE sw_branches SET current_tick=?,data_json=? WHERE id=?')
        .run(999, JSON.stringify({ ...branch, currentTick: 999 }), f.branch.id);
    });

    const firstPage = f.store.events(f.world.id, f.branch.id, { from: 0, to: 999, limit: 100 });
    assert.ok(firstPage.nextCursor);
    assert.equal(firstPage.nextCursor.length < 1000, true);
    assert.throws(() => f.store.events(f.world.id, f.branch.id, { from: 0, to: 999, limit: 100, actorId: 'ghost' }),
      /未知角色/);
    assert.throws(() => f.store.events(f.world.id, f.branch.id, { from: 0, to: 999, limit: 100, storyLineId: 'ghost-line' }),
      /未知故事线/);
    assert.throws(() => f.store.memories(f.world.id, f.branch.id, 'ghost'), /未知角色/);
    assert.throws(() => f.store.events(f.world.id, f.branch.id, {
      from: 0, to: 999, limit: 100, cursor: firstPage.nextCursor!, actorId: 'actor-a',
    }), /筛选条件不一致/);
    const otherWorld = f.store.create(definition());
    const otherBranch = f.store.createBranch(otherWorld.id, {
      title: '另一世界', mode: 'alternate', direction: '', expectedRevision: otherWorld.revision,
    });
    assert.throws(() => f.store.events(otherWorld.id, otherBranch.id, {
      from: 0, to: 999, limit: 100, cursor: firstPage.nextCursor!,
    }), /不属于当前世界/);

    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    let total = 0;
    do {
      const page = f.store.events(f.world.id, f.branch.id, {
        from: 0, to: 999, limit: 100, ...(cursor ? { cursor } : {}),
      });
      pages += 1;
      total = page.total;
      assert.equal(page.items.length <= 100, true);
      assert.equal(page.buckets.length <= 24, true);
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(total, 1000);
    assert.equal(pages, 10);
    assert.equal(new Set(ids).size, 1000);
    assert.deepEqual(ids.slice(0, 3), ['event-0000', 'event-0001', 'event-0002']);

    const a = f.store.events(f.world.id, f.branch.id, { from: 0, to: 999, limit: 200, actorId: 'actor-a' });
    assert.equal(a.total, 500);
    const buckets = f.store.events(f.world.id, f.branch.id, { from: 0, to: 999, limit: 10 }).buckets;
    assert.equal(buckets.reduce((sum, bucket) => sum + bucket.count, 0), 1000);
    const line = f.store.events(f.world.id, f.branch.id, { from: 0, to: 999, limit: 10, storyLineId: 'story-even' });
    assert.equal(line.total, 100);
    assert.throws(() => f.store.events(f.world.id, f.branch.id, { from: 10, to: 5 }), /时间窗口/);
    assert.throws(() => f.store.events(f.world.id, f.branch.id, { cursor: 'not-a-cursor' }), /游标/);
  } finally { f.database.close(); }
});

test('character library snapshots are verified and never overwritten by world events', () => {
  const database = new ServiceDatabase(':memory:');
  try {
    for (const statement of STORY_WORLD_MIGRATION_STATEMENTS) database.connection.exec(statement);
    addCharacter(database);
    const store = new StoryWorldStore(database);
    const worldDefinition = definition();
    worldDefinition.actors[0] = { ...worldDefinition.actors[0], characterId: 'char-1', characterVersion: 2 };
    const world = store.create(worldDefinition);
    const branch = store.createBranch(world.id, {
      title: '来源版本主线', mode: 'canon-gap', direction: '', expectedRevision: 1,
    });
    assert.equal(store.definition(world.id, branch.id).actors[0].characterVersion, 2);
    const profileBefore = database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get('char-1');
    const versionBefore = database.connection.prepare('SELECT * FROM character_versions WHERE character_id=? AND version=?').get('char-1', 2);
    store.commitStep(world.id, branch.id, branch.revision, {
      tick: 60, events: [event(world.id, branch.id, 'world-event', 60, ['actor-a'])],
      memories: [memory(world.id, branch.id, 'world-memory', 'actor-a', 'world-event', 60, 'experienced')],
      states: [state('actor-a', 'loc-tea', 60)], consumedInterventionIds: [],
    });
    assert.deepEqual(database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get('char-1'), profileBefore);
    assert.deepEqual(database.connection.prepare('SELECT * FROM character_versions WHERE character_id=? AND version=?').get('char-1', 2), versionBefore);
    assert.equal(store.definition(world.id, branch.id).actors[0].characterVersion, 2);

    database.connection.prepare(`INSERT INTO character_versions
      (character_id,version,data_json,compiled_linshe_prompt,relationships_json,created_at)
      VALUES (?,?,?,?,?,?)`).run('char-1', 3, '{"name":"来源角色","locked":2}', 'prompt-v3', '[]', at);
    const changed = structuredClone(worldDefinition);
    changed.actors[0] = {
      ...changed.actors[0], characterVersion: 3, background: '角色库第三版的背景。',
      personality: '第三版性格。', speechStyle: '第三版语气。', appearance: '第三版外观。',
    };
    store.updateWorld(world.id, { expectedRevision: world.revision, definition: changed });
    const stale = store.detail(world.id, branch.id);
    assert.equal(stale.sourceUpdatesAvailable, true);
    assert.equal(stale.definition.actors[0].characterVersion, 2);
    const refreshed = store.refreshSources(world.id, branch.id, stale.branch.revision);
    assert.equal(refreshed.sourceUpdatesAvailable, false);
    assert.equal(refreshed.definition.actors[0].characterVersion, 3);
    assert.equal(refreshed.definition.actors[0].background, '角色库第三版的背景。');
    assert.equal(refreshed.definition.actors[0].locationId, 'loc-harbor');
    assert.equal(store.events(world.id, branch.id, {}).total, 1);
    assert.deepEqual(database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get('char-1'), profileBefore);

    const missing = definition();
    missing.actors[0] = { ...missing.actors[0], characterId: 'char-1', characterVersion: 9 };
    assert.throws(() => store.create(missing), /版本.*不存在/);
    const orphan = definition();
    orphan.actors[0] = { ...orphan.actors[0], characterId: null, characterVersion: 1 };
    assert.throws(() => store.create(orphan), /没有来源角色/);
  } finally { database.close(); }
});

test('commitStep joins an outer transaction with a savepoint and rolls back as a unit', () => {
  const f = fixture();
  try {
    const step = {
      tick: 15, events: [event(f.world.id, f.branch.id, 'nested', 15, ['actor-a'])],
      memories: [], states: [], consumedInterventionIds: [],
    };
    f.database.transaction(() => {
      f.store.commitStep(f.world.id, f.branch.id, f.branch.revision, step);
    });
    assert.equal(f.store.events(f.world.id, f.branch.id, {}).total, 1);
    assert.throws(() => f.database.transaction(() => {
      f.store.commitStep(f.world.id, f.branch.id, f.store.getBranch(f.world.id, f.branch.id).revision, {
        tick: 30, events: [event(f.world.id, f.branch.id, 'rolled-back', 30, ['actor-b'])],
        memories: [], states: [], consumedInterventionIds: [],
      });
      throw new Error('outer failure');
    }), /outer failure/);
    assert.equal(f.store.events(f.world.id, f.branch.id, {}).total, 1);
    assert.equal(f.store.getBranch(f.world.id, f.branch.id).currentTick, 15);
  } finally { f.database.close(); }
});

test('migration creates the shared tables and keeps one active run per branch', () => {
  const f = fixture();
  try {
    const tables = new Set((f.database.connection.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'sw_%'")
      .all() as Array<{ name: string }>).map((row) => row.name));
    for (const name of ['sw_worlds', 'sw_branches', 'sw_branch_definitions', 'sw_events', 'sw_memories', 'sw_story_lines',
      'sw_interventions', 'sw_images', 'sw_runs', 'sw_adoptions', 'sw_actor_states']) {
      assert.equal(tables.has(name), true, name);
    }
    const insertRun = f.database.connection.prepare(`INSERT INTO sw_runs
      (id,world_id,branch_id,status,data_json,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`);
    insertRun.run('run-a', f.world.id, f.branch.id, 'running', '{}', null, at, at);
    assert.throws(() => insertRun.run('run-b', f.world.id, f.branch.id, 'paused', '{}', null, at, at), /UNIQUE/);
    f.database.connection.prepare('UPDATE sw_runs SET status=? WHERE id=?').run('completed', 'run-a');
    insertRun.run('run-b', f.world.id, f.branch.id, 'paused', '{}', null, at, at);
    const insertAdoption = f.database.connection.prepare(`INSERT INTO sw_adoptions
      (id,world_id,branch_id,project_id,idempotency_key,data_json,created_at) VALUES (?,?,?,?,?,?,?)`);
    insertAdoption.run('adoption-a', f.world.id, f.branch.id, 'project-1', 'same-key', '{}', at);
    assert.throws(() => insertAdoption.run('adoption-b', f.world.id, f.branch.id, 'project-1', 'same-key', '{}', at), /UNIQUE/);
    assert.equal(f.database.connection.prepare('PRAGMA quick_check').get()?.quick_check, 'ok');
    assert.equal(f.database.connection.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { f.database.close(); }
});

test('createBundle is atomic, idempotent by request payload and returns the original world branch', () => {
  const f = fixture();
  try {
    const input = {
      idempotencyKey: 'bundle-create-1',
      definition: definition(),
      initialBranch: { title: '初遇', mode: 'canon-gap' as const, direction: '从港口开始。' },
    };
    const created = f.store.createBundle(input);
    assert.equal(created.world.title, '璃月港的冬天');
    assert.equal(created.branch.worldId, created.world.id);
    assert.equal(created.branch.title, '初遇');
    assert.equal(created.branch.mode, 'canon-gap');
    assert.equal(created.branch.direction, '从港口开始。');
    assert.equal(f.store.definition(created.world.id, created.branch.id).actors.length, 2);

    const repeated = f.store.createBundle(input);
    assert.equal(repeated.world.id, created.world.id);
    assert.equal(repeated.branch.id, created.branch.id);
    assert.equal(f.store.list().items.filter((world) => world.id === created.world.id).length, 1);
    assert.equal(f.database.connection.prepare(
      'SELECT COUNT(*) AS count FROM sw_branches WHERE world_id=?',
    ).get(created.world.id)?.count, 1);

    assert.throws(() => f.store.createBundle({
      ...input,
      initialBranch: { ...input.initialBranch, direction: '改从茶室开始。' },
    }), (error: unknown) => error instanceof StoryWorldError
      && error.statusCode === 409
      && error.code === 'story_creation_idempotency_conflict');

    const before = f.store.list().items.length;
    assert.throws(() => f.store.createBundle({
      idempotencyKey: 'bundle-invalid-branch',
      definition: definition(),
      initialBranch: { title: '   ', mode: 'alternate', direction: '' },
    }), (error: unknown) => error instanceof StoryWorldError
      && error.code === 'story_branch_invalid');
    assert.equal(f.store.list().items.length, before);
    assert.equal(f.database.connection.prepare(
      'SELECT COUNT(*) AS count FROM sw_creation_requests WHERE idempotency_key=?',
    ).get('bundle-invalid-branch')?.count, 0);
  } finally { f.database.close(); }
});

test('branch metadata updates use CAS and reject every active run status', () => {
  const f = fixture();
  try {
    const updated = f.store.updateBranch(f.world.id, f.branch.id, {
      expectedRevision: f.branch.revision,
      title: '  主线改名  ',
      mode: 'adaptation',
      direction: '改为从茶室开始。',
    });
    assert.equal(updated.revision, f.branch.revision + 1);
    assert.equal(updated.title, '主线改名');
    assert.equal(updated.mode, 'adaptation');
    assert.equal(updated.direction, '改为从茶室开始。');
    assert.deepEqual(f.store.getBranch(f.world.id, f.branch.id), updated);
    assert.throws(() => f.store.updateBranch(f.world.id, f.branch.id, {
      expectedRevision: f.branch.revision,
      title: '过期写入',
      mode: 'alternate',
      direction: '',
    }), (error: unknown) => error instanceof StoryWorldError
      && error.statusCode === 409
      && error.code === 'story_branch_revision_conflict');

    const insertRun = f.database.connection.prepare(`INSERT INTO sw_runs
      (id,world_id,branch_id,status,data_json,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`);
    for (const status of ['queued', 'running', 'paused', 'uncertain'] as const) {
      insertRun.run(`run-${status}`, f.world.id, f.branch.id, status, '{}', null, at, at);
      assert.throws(() => f.store.updateBranch(f.world.id, f.branch.id, {
        expectedRevision: updated.revision,
        title: '运行中改名',
        mode: 'alternate',
        direction: '',
      }), (error: unknown) => error instanceof StoryWorldError
        && error.statusCode === 409
        && error.code === 'story_run_conflict');
      f.database.connection.prepare('UPDATE sw_runs SET status=? WHERE id=?').run('completed', `run-${status}`);
    }

    insertRun.run('run-completed', f.world.id, f.branch.id, 'completed', '{}', null, at, at);
    const final = f.store.updateBranch(f.world.id, f.branch.id, {
      expectedRevision: updated.revision,
      title: '结束后改名',
      mode: 'alternate',
      direction: '新的方向。',
    });
    assert.equal(final.revision, updated.revision + 1);
    assert.equal(final.title, '结束后改名');
  } finally { f.database.close(); }
});

test('createBundle joins an outer transaction and rolls back every nested savepoint on failure', () => {
  const f = fixture();
  try {
    const worldCount = f.store.list().items.length;
    const branchCount = f.database.connection.prepare('SELECT COUNT(*) AS count FROM sw_branches').get()?.count;
    assert.throws(() => f.database.transaction(() => {
      f.store.createBundle({
        idempotencyKey: 'bundle-outer-failure',
        definition: definition(),
        initialBranch: { title: '应回滚', mode: 'alternate', direction: '' },
      });
      throw new Error('outer failure');
    }), /outer failure/);
    assert.equal(f.store.list().items.length, worldCount);
    assert.equal(f.database.connection.prepare('SELECT COUNT(*) AS count FROM sw_branches').get()?.count, branchCount);
    assert.equal(f.database.connection.prepare(
      'SELECT COUNT(*) AS count FROM sw_creation_requests WHERE idempotency_key=?',
    ).get('bundle-outer-failure')?.count, 0);
    assert.equal(f.database.connection.prepare(
      "SELECT COUNT(*) AS count FROM sw_worlds WHERE json_extract(data_json,'$.title')=?",
    ).get('璃月港的冬天')?.count, 1);
  } finally { f.database.close(); }
});
