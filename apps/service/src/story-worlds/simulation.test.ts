import assert from 'node:assert/strict';
import test from 'node:test';
import { materializeWorldAdjudication, validateWorldIntent, validateWorldNarration, personalContext, WORLD_ADJUDICATION_TASK, WorldAdjudicationSchema, type WorldAdjudication, type WorldIntent, type WorldSimulationSnapshot } from './simulation.js';

function fixture() {
  const actors = ['a', 'b'].map((id) => ({ id, name: id, role: 'main' as const, characterId: null, characterVersion: null, background: '', personality: '', speechStyle: '', appearance: '', goals: [], locationId: 'port', referenceArtifactIds: [] }));
  const snapshot: WorldSimulationSnapshot = { worldId: 'world', branch: { id: 'branch', worldId: 'world', title: '', mode: 'canon-gap', parentBranchId: null, forkTick: 0, currentTick: 0, revision: 1, sourceRevision: 1, direction: '', createdAt: '', updatedAt: '' },
    definition: { title: '', summary: '', timeLabel: '', actors, locations: [{ id: 'port', name: '', description: '' }, { id: 'tea', name: '', description: '' }], sources: [], lockedFacts: ['不能飞行'], models: { action: null, adjudication: null, narration: null }, visualStyle: '' },
    states: actors.map((a) => ({ actorId: a.id, locationId: 'port', goals: [], emotion: '', relationships: [], updatedTick: 0 })), events: [], memories: [], interventions: [], storyLines: [], toTick: 60 };
  const output: WorldAdjudication = { events: [{ id: 'event', tick: 10, duration: 0, title: '', summary: '', locationId: 'port', participantIds: ['a', 'b'],
    facts: [{ id: 'secret', content: '盒中有钥匙', knownBy: ['a'], nature: 'ai' }, { id: 'public', content: '盒子放在桌上', knownBy: ['a', 'b'], nature: 'ai' }],
    causeEventIds: [], storyLineIds: [], stateChanges: [] }], supportingActors: [], transfers: [], consumedInterventionIds: [], violatedLockedFacts: [] };
  const intents: WorldIntent[] = actors.map((a) => ({ actorId: a.id, action: '工作', targetLocationId: 'port', prerequisiteFactIds: [], interactWithActorIds: [] }));
  return { snapshot, output, intents };
}
const build = (f: ReturnType<typeof fixture>) => materializeWorldAdjudication(f.output, f.snapshot, f.intents, 'step');

test('adjudication checks time, presence, prerequisites, locked settings and causal history', () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.output.events[0].tick = 0; },
    (f: ReturnType<typeof fixture>) => { f.output.events[0].duration = 100; },
    (f: ReturnType<typeof fixture>) => { f.output.events[0].locationId = 'tea'; },
    (f: ReturnType<typeof fixture>) => { f.output.events[0].causeEventIds = ['future-event']; },
    (f: ReturnType<typeof fixture>) => { f.output.violatedLockedFacts = ['不能飞行']; },
    (f: ReturnType<typeof fixture>) => { f.output.events[0].facts[0].knownBy = ['stranger']; },
    (f: ReturnType<typeof fixture>) => { f.output.events[0].stateChanges = [{ ...f.snapshot.states[0], locationId: 'tea', updatedTick: 10 }]; },
  ]) { const f = fixture(); change(f); assert.throws(() => build(f)); }
  const f = fixture(); assert.throws(() => validateWorldIntent({ ...f.intents[1], prerequisiteFactIds: ['secret'] }, f.snapshot, 'b'), /尚未获知/);
});

test('one destination permits its move but rejects both representations of a second move with actionable locations', async (t) => {
  const movingFixture = () => {
    const f = fixture();
    f.snapshot.definition.actors = f.snapshot.definition.actors.slice(0, 1); f.snapshot.states = f.snapshot.states.slice(0, 1);
    f.snapshot.definition.locations.push({ id: 'quarters', name: '宿舍', description: '' });
    f.intents = [{ ...f.intents[0], action: '先去茶室用餐，之后去宿舍休息', targetLocationId: 'tea' }];
    f.output.events[0] = { ...f.output.events[0], locationId: 'tea', participantIds: ['a'], duration: 5,
      facts: [{ id: 'meal', content: '人物抵达茶室用餐', knownBy: ['a'], nature: 'ai' }],
      stateChanges: [{ ...f.snapshot.states[0], locationId: 'tea', updatedTick: 15 }],
    };
    return f;
  };
  for (const eventLocation of ['port', 'tea']) await t.test('authorized destination with event at ' + eventLocation, () => {
    const f = movingFixture(); f.output.events[0].locationId = eventLocation;
    const before = structuredClone(f);
    const result = build(f);
    assert.equal(result.states.find((s) => s.actorId === 'a')?.locationId, 'tea');
    assert.equal(result.events.length, 1); assert.deepEqual(f, before, 'successful materialization does not mutate its input');
  });
  for (const eventLocation of ['quarters', 'tea']) await t.test('unauthorized second destination with event at ' + eventLocation, () => {
    const f = movingFixture();
    f.output.events.push({ ...structuredClone(f.output.events[0]), id: 'second-move', tick: 20, locationId: eventLocation,
      facts: [{ id: 'sleep', content: '人物走进宿舍', knownBy: ['a'], nature: 'ai' }],
      stateChanges: [{ ...f.snapshot.states[0], locationId: 'quarters', updatedTick: 25 }],
    });
    const before = structuredClone(f);
    assert.throws(() => build(f), (error: unknown) => {
      const message = (error as Error).message;
      assert.match(message, eventLocation === 'quarters' ? /角色不在事件现场/ : /人物位置变化必须来自移动意图/);
      for (const detail of ['eventId=second-move', 'actorId=a', 'currentLocationId=tea', 'event.locationId=' + eventLocation,
        'newStateLocationId=quarters', 'targetLocationId=tea', '一轮只有一个意图目的地', '后续地点留到下一轮']) assert.ok(message.includes(detail), message);
      return true;
    });
    assert.deepEqual(f, before, 'rejection rolls back even the preceding valid move in the local materialization');
    assert.equal(f.snapshot.states[0].locationId, 'port');
  });
});

test('time corrections name every invalid event, actual duration and the strict absolute range', () => {
  const f = fixture();
  f.output.events[0].tick = 0; f.output.events[0].duration = 15;
  f.output.events.push({ ...structuredClone(f.output.events[0]), id: 'overrun', tick: 59, duration: 2 });
  assert.throws(() => build(f), (error: unknown) => {
    const message = (error as Error).message;
    assert.match(message, /事件 event 时间无效：tick=0，duration=15，tick[+]duration=15/);
    assert.match(message, /事件 overrun 时间无效：tick=59，duration=2，tick[+]duration=61/);
    assert.match(message, /currentTick=0，toTick=60，要求 1<=tick<=60/);
    assert.match(message, /tick不能等于currentTick/); return true;
  });
  for (const time of [
    { tick: -1, duration: 0 }, { tick: 1.5, duration: 1 }, { tick: 1, duration: -1 },
    { tick: 1, duration: 0.5 }, { tick: 61, duration: 0 }, { tick: Number.NaN, duration: 0 },
    { tick: 1, duration: Number.POSITIVE_INFINITY }, { tick: Number.MAX_SAFE_INTEGER + 1, duration: 0 },
  ]) {
    const bad = fixture(); Object.assign(bad.output.events[0], time);
    assert.throws(() => build(bad), /事件 event 时间无效/);
  }
  const later = fixture(); later.snapshot.branch.currentTick = 60; later.snapshot.toTick = 120;
  later.output.events[0].tick = 60;
  assert.throws(() => build(later), /currentTick=60，toTick=120，要求 61<=tick<=120/);
  later.output.events[0].tick = 61; assert.equal(build(later).events[0].tick, 61);
  later.output.events[0].tick = 120; assert.equal(build(later).events[0].tick, 120);
});

test('out-of-order arrays report their neighboring event IDs without bypassing chronology checks', () => {
  const f = fixture();
  f.output.events[0].tick = 20;
  f.output.events.push({ ...structuredClone(f.output.events[0]), id: 'earlier', tick: 10, facts: [{ id: 'early-fact', content: '双方先看到桌子', knownBy: ['a', 'b'], nature: 'ai' }] });
  assert.throws(() => build(f), /earlier（tick=10，duration=0）排在 event（tick=20，duration=0）之后/);
  assert.deepEqual(f.output.events.map((event) => event.id), ['event', 'earlier']);
  f.output.events.reverse();
  assert.deepEqual(build(f).events.map((event) => event.id), ['earlier', 'event']);
});

test('shared events create individual facts and traceable later transfers without remote knowledge', () => {
  const f = fixture();
  f.output.events.push({ ...structuredClone(f.output.events[0]), id: 'meeting', tick: 20,
    facts: [{ id: 'disclosed', content: '盒中有钥匙', knownBy: ['a', 'b'], nature: 'ai' }] });
  f.output.transfers.push({ actorId: 'b', fromActorId: 'a', sourceEventId: 'event', factId: 'secret', meetingEventId: 'meeting' });
  const result = build(f);
  const heard = result.memories.find((m) => m.kind === 'heard')!;
  assert.equal(heard.actorId, 'b'); assert.equal(heard.fromActorId, 'a'); assert.equal(heard.sourceEventId, 'event');
  assert.equal(heard.learnedAt, 20);
  const later = { ...f.snapshot, branch: { ...f.snapshot.branch, currentTick: 30 }, events: result.events, memories: result.memories };
  assert.ok(personalContext(later, 'b').facts.some((fact) => fact.id === 'secret'));
  const bad = fixture(); bad.output.transfers = [{ actorId: 'b', fromActorId: 'a', sourceEventId: 'event', factId: 'secret', meetingEventId: 'missing' }]; assert.throws(() => build(bad), /转述/);
});

test('supporting actors, personal mistaken beliefs and objective facts remain distinct', () => {
  const f = fixture();
  f.output.supportingActors = [{ ...f.snapshot.definition.actors[0], id: 'shopkeeper', name: '店主', role: 'supporting' }];
  f.output.events[0].participantIds.push('shopkeeper');
  f.output.events[0].facts.find((fact) => fact.id === 'public')!.knownBy.push('shopkeeper');
  f.output.beliefs = [{ actorId: 'a', sourceEventId: 'event', evidenceFactIds: ['public'], kind: 'mistaken', content: '我误以为b藏起钥匙', importance: 0.9 }];
  const result = build(f);
  assert.equal(result.supportingActors.length, 1);
  const later = { ...f.snapshot, definition: { ...f.snapshot.definition, actors: [...f.snapshot.definition.actors, ...result.supportingActors] },
    branch: { ...f.snapshot.branch, currentTick: 60 }, events: result.events, memories: result.memories };
  const context = personalContext(later, 'a'); assert.equal(context.beliefs[0].kind, 'mistaken');
  assert.ok(context.facts.every((fact) => !fact.content.includes('误以为')));
  const intent = { ...f.intents[0], action: '因误解而检查盒子' };
  validateWorldIntent(intent, later, 'a');
  f.output.beliefs[0].actorId = 'b'; f.output.beliefs[0].evidenceFactIds = ['secret'];
  assert.throws(() => build(f), /来源事实/);
});

test('director goals and external events are consumed atomically; constraints persist', () => {
  const f = fixture();
  f.snapshot.interventions = [{ id: 'goal', worldId: 'world', branchId: 'branch', tick: 15, kind: 'external-event', actorIds: ['a'], instruction: '敲门', consumed: false, createdAt: '' }];
  assert.throws(() => build(f), /遗漏/);
  f.output.consumedInterventionIds = ['goal']; assert.throws(() => build(f), /生效时刻/);
  f.output.events[0].tick = 20; assert.deepEqual(build(f).consumedInterventionIds, ['goal']);
  f.snapshot.interventions[0].consumed = true; f.snapshot.interventions[0].kind = 'constraint'; f.output.consumedInterventionIds = [];
  assert.equal(build(f).events.length, 1);
});

test('narration is constrained by actor visibility and cannot alter structured events', () => {
  const f = fixture(); const result = build(f);
  assert.throws(() => validateWorldNarration({ passages: [{ actorId: 'b', eventId: 'event', factIds: ['secret'], text: '偷看秘密' }] }, result.events, 'b'), /未知/);
  validateWorldNarration({ passages: [{ actorId: 'b', eventId: 'event', factIds: ['public'], text: '看见桌上的盒子' }] }, result.events, 'b');
  assert.equal(result.events[0].perspectives.length, 0);
});

test('real-response pattern reports end-time and paraphrased-transfer mistakes in the same correction', () => {
  const f = fixture();
  f.output.events[0].duration = 6;
  f.output.events[0].stateChanges = [{ ...f.snapshot.states[0], updatedTick: 10 }];
  f.output.events[0].facts[0].content = '林舟确认灯身外表未见裂口；未点灯，尚不能确认功能。';
  f.output.events.push({ ...structuredClone(f.output.events[0]), id: 'meeting', tick: 30, duration: 0, stateChanges: [],
    facts: [{ id: 'report', content: '林舟告诉苏禾灯没有明显裂口，但功能仍未确认。', knownBy: ['a', 'b'], nature: 'ai' }] });
  f.output.transfers = [{ actorId: 'b', fromActorId: 'a', sourceEventId: 'event', factId: 'secret', meetingEventId: 'meeting' }];
  assert.throws(() => build(f), (e: unknown) => {
    assert.match((e as Error).message, /updatedTick应为 16/);
    assert.match((e as Error).message, /meeting.facts.*event\/secret/);
    assert.match((e as Error).message, /逐字复制/); return true;
  });
  f.output.events[0].stateChanges[0].updatedTick = 16;
  assert.throws(() => build(f), /同一事实/);
  f.output.events[1].facts.push({ id: 'shared-source', content: f.output.events[0].facts[0].content, knownBy: ['a', 'b'], nature: 'ai' });
  const result = build(f);
  assert.equal(result.memories.find((m) => m.kind === 'heard')?.learnedAt, 30);
  assert.match(WORLD_ADJUDICATION_TASK, /updatedTick必须等于tick\+duration/);
  assert.match(WorldAdjudicationSchema.properties.transfers.items.description!, /逐字复制/);
});

test('partial reporting shares only a split public fact and retains the speaker private judgment', () => {
  const f = fixture();
  f.output.events[0].facts = [
    { id: 'observable', content: '灯身外表未见裂口，尚未测试功能。', knownBy: ['a'], nature: 'ai' },
    { id: 'private', content: '我怀疑灯曾被人故意损坏，暂不告诉别人。', knownBy: ['a'], nature: 'ai' },
    { id: 'box', content: '双方都看见桌上放着灯。', knownBy: ['a', 'b'], nature: 'ai' },
  ];
  f.output.events.push({ ...structuredClone(f.output.events[0]), id: 'meeting', tick: 20,
    facts: [{ id: 'shared', content: '灯身外表未见裂口，尚未测试功能。', knownBy: ['a', 'b'], nature: 'ai' }] });
  f.output.transfers = [{ actorId: 'b', fromActorId: 'a', sourceEventId: 'event', factId: 'observable', meetingEventId: 'meeting' }];
  const result = build(f);
  const context = personalContext({ ...f.snapshot, branch: { ...f.snapshot.branch, currentTick: 30 }, events: result.events, memories: result.memories }, 'b');
  assert.ok(context.facts.some((fact) => fact.id === 'observable'));
  assert.equal(JSON.stringify(context).includes('故意损坏'), false);
  assert.equal(result.events[0].facts.find((fact) => fact.id === 'private')?.knownBy.includes('b'), false);
});

test('a report cannot bootstrap sender knowledge or send private facts to an absent recipient', () => {
  const f = fixture();
  f.snapshot.definition.actors.push({ ...f.snapshot.definition.actors[0], id: 'c', name: '旁观者' });
  f.snapshot.states.push({ ...f.snapshot.states[0], actorId: 'c' });
  f.output.events[0].participantIds.push('c');
  f.output.events[0].facts.find((fact) => fact.id === 'public')!.knownBy.push('c');
  f.output.events.push({ ...structuredClone(f.output.events[0]), id: 'meeting', tick: 20, participantIds: ['b', 'c'],
    facts: [{ id: 'unfounded', content: '盒中有钥匙', knownBy: ['b', 'c'], nature: 'ai' }] });
  f.output.transfers = [{ actorId: 'c', fromActorId: 'b', sourceEventId: 'event', factId: 'secret', meetingEventId: 'meeting' }];
  assert.throws(() => build(f), /转述人尚未获知/);
  f.output.transfers[0].fromActorId = 'a';
  f.output.events[1].facts[0].knownBy.push('a');
  assert.throws(() => build(f), /知情人必须在场/);
});
