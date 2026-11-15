import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorldDefinition, WorldBranch, WorldEvent, WorldMemory, WorldActorState } from '@sthstart/contracts';
import { buildWorldPersonalContext, rankWorldMemories } from './memory.js';

const definition: WorldDefinition = { title: '隔离', summary: '全知剧透不能传给人物', timeLabel: '', locations: [{ id: 'port', name: '港口', description: '未来秘密' }],
  actors: ['a', 'b', 'c'].map((id) => ({ id, name: id, role: 'main', characterId: null, characterVersion: null, background: '', personality: '', speechStyle: '', appearance: '', goals: ['钥匙'], locationId: 'port', referenceArtifactIds: [] })),
  sources: [], lockedFacts: ['不能泄露世界锁定资料'], models: { action: null, adjudication: null, narration: null }, visualStyle: '' };
const branch: WorldBranch = { id: 'branch', worldId: 'world', title: '', mode: 'canon-gap', parentBranchId: null, forkTick: 0, currentTick: 20, revision: 1, sourceRevision: 1, direction: '', createdAt: '', updatedAt: '' };
const states: WorldActorState[] = definition.actors.map((a) => ({ actorId: a.id, locationId: 'port', goals: ['钥匙'], emotion: '', relationships: [], updatedTick: 0 }));
function event(id: string, tick: number, participants: string[], knownBy: string[], content = '钥匙在盒内'): WorldEvent {
  return { id, worldId: 'world', branchId: 'branch', tick, duration: 0, title: '禁止传播标题', summary: '禁止传播摘要', locationId: 'port', participantIds: participants,
    facts: [{ id: id + ':fact', content, knownBy, nature: 'ai' }], perspectives: [{ actorId: 'a', text: '禁止传播别人的视角' }], causeEventIds: [], storyLineIds: [], stateChanges: [], createdAt: '' };
}
function memory(id: string, actorId: string, sourceEventId: string, kind: WorldMemory['kind'], content: string, patch: Partial<WorldMemory> = {}): WorldMemory {
  return { id, worldId: 'world', branchId: 'branch', actorId, sourceEventId, kind, learnedAt: 10, content, importance: 0.5, fromActorId: null, ...patch };
}
const context = (actorId: string, events: WorldEvent[], memories: WorldMemory[], tick = 20) => buildWorldPersonalContext({ worldId: 'world', branch, definition, actorId, events, memories, states, tick });

test('personal context excludes other branch, future, event prose and in-scene unknown secrets', () => {
  const secret = event('secret', 5, ['a', 'b'], ['a']);
  const future = event('future', 100, ['b'], ['b'], '未来秘密');
  const other = { ...event('other', 5, ['b'], ['b'], '其他分支秘密'), branchId: 'other' };
  const memories = [memory('unknown', 'b', 'secret', 'experienced', '钥匙在盒内'), memory('future-memory', 'b', 'future', 'experienced', '未来秘密', { learnedAt: 100 }),
    memory('other-memory', 'b', 'other', 'experienced', '其他分支秘密', { branchId: 'other' })];
  const b = context('b', [secret, future, other], memories);
  assert.equal(b.facts.length, 0); assert.equal(b.memories.length, 0);
  for (const hidden of ['钥匙在盒内', '未来秘密', '其他分支秘密', '禁止传播', '全知剧透']) assert.equal(JSON.stringify(b).includes(hidden), false, hidden);
  assert.equal(context('a', [secret], []).facts.length, 1);
});

test('personal clock crosses midnight from an explicit numerical start without exposing free-form time labels', () => {
  const input = { worldId: 'world', branch, actorId: 'a', events: [], memories: [], states, tick: 961 };
  const safe = buildWorldPersonalContext({ ...input, definition: { ...definition, startMinuteOfDay: 480, timeLabel: '08:00，隐藏口令暮光' } });
  assert.deepEqual(safe.clock, { day: 1, minuteOfDay: 1 });
  assert.equal(JSON.stringify(safe).includes('暮光'), false);
  assert.equal(buildWorldPersonalContext({ ...input, definition }).clock, undefined);
  assert.deepEqual(buildWorldPersonalContext({ ...input, tick: 1440, definition: { ...definition, startMinuteOfDay: 0 } }).clock, { day: 1, minuteOfDay: 0 });
});

test('heard information requires a knowledgeable sender and a traceable shared meeting', () => {
  const source = event('secret', 5, ['a'], ['a']);
  const heard = memory('heard', 'b', 'secret', 'heard', '钥匙在盒内', { fromActorId: 'a', learnedAt: 15 });
  assert.equal(context('b', [source], [heard]).facts.length, 0);
  const meeting = event('meeting', 15, ['a', 'b'], ['a', 'b']);
  const b = context('b', [source, meeting], [heard]);
  assert.equal(b.memories.length, 1); assert.ok(b.facts.some((f) => f.eventId === 'secret'));
  assert.equal(context('b', [source, meeting], [heard], 14).facts.length, 0);
  assert.equal(context('c', [source, meeting], []).facts.length, 0);
});

test('subjective inference and mistaken belief survive only with known evidence and never become facts', () => {
  const source = event('evidence', 5, ['a', 'b'], ['a'], 'a看到空盒子');
  const memories = [memory('inference', 'a', 'evidence', 'inferred', '钥匙可能被人拿走'), memory('mistake', 'a', 'evidence', 'mistaken', '我确信b偷走了钥匙'),
    memory('invalid', 'b', 'evidence', 'mistaken', '我知道尚未获知的秘密')];
  const a = context('a', [source], memories);
  assert.deepEqual(a.beliefs.map((m) => m.kind).sort(), ['inferred', 'mistaken']);
  assert.ok(a.beliefs.every((b) => b.evidenceFactIds.includes('evidence:fact')));
  assert.equal(a.facts.some((f) => f.content.includes('偷走')), false);
  assert.equal(context('b', [source], memories).beliefs.length, 0);
});

test('memory selection combines relevance, importance, recency and deterministic ordering', () => {
  const entries = [memory('recent-relevant', 'a', 's', 'experienced', '钥匙', { importance: 1, learnedAt: 20 }),
    memory('old-irrelevant', 'a', 's', 'experienced', '天气', { importance: 0, learnedAt: 0 }),
    memory('future', 'a', 's', 'experienced', '钥匙', { importance: 1, learnedAt: 100 }),
    memory('recent-important', 'a', 's', 'experienced', '天气', { importance: 1, learnedAt: 20 })];
  assert.deepEqual(rankWorldMemories(entries, '钥匙', 20).map((m) => m.id), ['recent-relevant', 'recent-important', 'old-irrelevant']);
  assert.equal(rankWorldMemories(entries, '钥匙', 20, 1).length, 1);
});

test('a belief cannot smuggle a hidden secret through an otherwise known source event', () => {
  const e = event('e', 5, ['a', 'b'], ['a'], '密室口令是暮光');
  e.facts.push({ id: 'visible', content: '门被锁上', knownBy: ['a', 'b'], nature: 'ai' });
  const belief = memory('smuggled', 'b', 'e', 'inferred', '根据门被锁上，我猜密室口令是暮光');
  assert.equal(context('b', [e], [belief]).beliefs.length, 0);
});

test('a later exact report never erases earlier knowledge or authorizes a new future secret', () => {
  const source = event('inspection', 10, ['a'], ['a'], '灯身外表未见裂口，尚未测试功能。');
  const report = event('report', 30, ['a', 'b'], ['a', 'b'], source.facts[0].content);
  report.facts.push({ id: 'future-secret', content: '信封里有一张秘密地图', knownBy: ['a', 'b'], nature: 'ai' });
  const remembered = memory('source-memory', 'a', source.id, 'experienced', source.facts[0].content, { learnedAt: 10 });
  const smuggled = memory('future-guess', 'a', source.id, 'inferred', '我猜信封里有一张秘密地图', { learnedAt: 10 });
  const a = context('a', [source, report], [remembered, smuggled], 20);
  assert.equal(a.memories.length, 1); assert.equal(a.beliefs.length, 0);
  assert.equal(context('b', [source, report], [remembered], 20).facts.length, 0);
});
