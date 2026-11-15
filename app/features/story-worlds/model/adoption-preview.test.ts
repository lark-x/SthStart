import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorldEvent } from '@sthstart/contracts';
import {
  ADOPTION_BODY_MAX,
  ADOPTION_TITLE_MAX,
  adoptionBodyError,
  adoptionPerspectiveIssues,
  adoptionTitleError,
  composeAdoptionChapterBody,
  defaultAdoptionTitle,
  nextAdoptionAttempt,
  normalizeMinuteRange,
  reviewAdoptionSelection,
  toggleAdoptionEvent,
} from './adoption-preview';

const event = (
  id: string,
  tick: number,
  participants: string[],
  perspectives: Array<{ actorId: string; text: string }>,
): WorldEvent => ({
  id,
  worldId: 'world-1',
  branchId: 'branch-1',
  tick,
  duration: 0,
  title: `事件 ${id}`,
  summary: `摘要 ${id}`,
  locationId: 'loc-1',
  participantIds: participants,
  facts: [],
  perspectives,
  causeEventIds: [],
  storyLineIds: [],
  stateChanges: [],
  createdAt: '2026-01-01T00:00:00.000Z',
});

test('minute range clamps to branch length and never inverts', () => {
  assert.deepEqual(normalizeMinuteRange(-10, 200, 120), { from: 0, to: 120 });
  assert.deepEqual(normalizeMinuteRange(90, 20, 120), { from: 90, to: 90 });
  assert.deepEqual(normalizeMinuteRange(Number.NaN, Number.POSITIVE_INFINITY, 60), { from: 0, to: 60 });
});

test('title validation rejects over-limit text without truncating it', () => {
  assert.equal(adoptionTitleError('归航'), null);
  assert.equal(adoptionTitleError('  '), '采纳标题不能为空。');
  const longTitle = '标'.repeat(ADOPTION_TITLE_MAX + 1);
  assert.match(adoptionTitleError(longTitle) ?? '', /120/);
  assert.equal(longTitle.length, ADOPTION_TITLE_MAX + 1);
});

test('default title falls back to the branch title instead of cutting the world name', () => {
  assert.equal(defaultAdoptionTitle('璃月夜泊', '归航'), '璃月夜泊 · 归航');
  assert.equal(defaultAdoptionTitle('世'.repeat(118), '归航'), '归航');
});

test('body validation uses the shared chapter character ceiling', () => {
  assert.equal(adoptionBodyError(ADOPTION_BODY_MAX), null);
  assert.match(adoptionBodyError(ADOPTION_BODY_MAX + 1) ?? '', /100000/);
});

test('perspective issues cover both non-participation and missing text for every event', () => {
  const events = [
    event('evt-1', 10, ['actor-a', 'actor-b'], [{ actorId: 'actor-a', text: '甲看到的。' }]),
    event('evt-2', 20, ['actor-b'], [{ actorId: 'actor-b', text: '乙看到的。' }]),
    event('evt-3', 30, ['actor-a'], [{ actorId: 'actor-a', text: '   ' }]),
  ];
  const issues = adoptionPerspectiveIssues(events, 'actor-a', new Map([['actor-a', '甲']]));
  assert.deepEqual(issues.map((issue) => issue.eventId), ['evt-2', 'evt-3']);
  assert.match(issues[0].reason, /未参与/);
  assert.match(issues[1].reason, /缺少/);
  assert.deepEqual(adoptionPerspectiveIssues(events, null), []);
});

test('chapter preview orders events and uses only the chosen perspective', () => {
  const events = [
    event('evt-2', 20, ['actor-a'], [{ actorId: 'actor-a', text: '后来的视角。' }]),
    event('evt-1', 10, ['actor-a', 'actor-b'], [
      { actorId: 'actor-a', text: '先前的视角。' },
      { actorId: 'actor-b', text: '乙不该出现。' },
    ]),
  ];
  const body = composeAdoptionChapterBody({
    worldId: 'world-1',
    branchId: 'branch-1',
    branchRevision: 7,
    actorId: 'actor-a',
    events,
    actorNames: new Map([['actor-a', '甲']]),
  });
  assert.ok(body.indexOf('事件 evt-1') < body.indexOf('事件 evt-2'));
  assert.match(body, /先前的视角/);
  assert.match(body, /基准版本=7/);
  assert.doesNotMatch(body, /乙不该出现/);
});

test('selection review blocks submit until title, body and perspective are valid', () => {
  const valid = reviewAdoptionSelection({
    title: '归航',
    worldId: 'world-1',
    branchId: 'branch-1',
    branchRevision: 1,
    actorId: 'actor-a',
    events: [event('evt-1', 10, ['actor-a'], [{ actorId: 'actor-a', text: '正文。' }])],
  });
  assert.equal(valid.ready, true);
  assert.equal(valid.selectedCount, 1);
  assert.ok(valid.bodyLength > 0);

  const blocked = reviewAdoptionSelection({
    title: '标'.repeat(ADOPTION_TITLE_MAX + 1),
    worldId: 'world-1',
    branchId: 'branch-1',
    branchRevision: 1,
    actorId: 'actor-b',
    events: [event('evt-1', 10, ['actor-a'], [{ actorId: 'actor-a', text: '正文。' }])],
  });
  assert.equal(blocked.ready, false);
  assert.ok(blocked.titleError);
  assert.equal(blocked.perspectiveIssues.length, 1);
});

test('attempt key is stable across retries and rebases but rotates on content change', () => {
  let counter = 0;
  const createKey = () => `key-${++counter}`;
  const first = nextAdoptionAttempt(null, 'fingerprint-a', createKey);
  assert.equal(first.key, 'key-1');
  assert.equal(nextAdoptionAttempt(first, 'fingerprint-a', createKey).key, 'key-1');
  const second = nextAdoptionAttempt(first, 'fingerprint-b', createKey);
  assert.equal(second.key, 'key-2');
});

test('event toggle enforces the 100-event cap without dropping earlier picks', () => {
  const ids = Array.from({ length: 100 }, (_, index) => `evt-${index}`);
  const blocked = toggleAdoptionEvent(ids, 'evt-extra');
  assert.equal(blocked.limitReached, true);
  assert.equal(blocked.ids.length, 100);
  const removed = toggleAdoptionEvent(ids, 'evt-0');
  assert.equal(removed.limitReached, false);
  assert.equal(removed.ids.length, 99);
});
