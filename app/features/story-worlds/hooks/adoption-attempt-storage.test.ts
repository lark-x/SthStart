import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADOPTION_ATTEMPT_STORAGE_PREFIX,
  clearAdoptionAttempt,
  persistAdoptionAttempt,
  persistAdoptionDraftSnapshot,
  readAdoptionAttempt,
} from './adoption-attempt-storage';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test('attempt is persisted under its own key before the request', () => {
  const storage = memoryStorage();
  const attempt = persistAdoptionAttempt('adopt:branch-1', {
    key: 'sw-adopt-1',
    fingerprint: 'fp-1',
  }, storage);
  assert.equal(attempt.key, 'sw-adopt-1');
  assert.equal(storage.values.has(ADOPTION_ATTEMPT_STORAGE_PREFIX + 'adopt:branch-1'), true);
  assert.deepEqual(
    readAdoptionAttempt('adopt:branch-1', storage),
    { key: 'sw-adopt-1', fingerprint: 'fp-1', updatedAt: attempt.updatedAt },
  );
});

test('success clears the attempt so the next adoption starts fresh', () => {
  const storage = memoryStorage();
  persistAdoptionAttempt('adopt:branch-1', { key: 'sw-adopt-1', fingerprint: 'fp-1' }, storage);
  clearAdoptionAttempt('adopt:branch-1', storage);
  assert.equal(readAdoptionAttempt('adopt:branch-1', storage), null);
});

test('attempt survives a reload when the dirty draft timer has not flushed', () => {
  const storage = memoryStorage();
  persistAdoptionAttempt('adopt:branch-1', { key: 'sw-adopt-2', fingerprint: 'fp-2' }, storage);
  storage.setItem('sthstart:story-worlds:draft:adopt:branch-1', JSON.stringify({
    isDirty: true,
    data: { eventIds: [], attemptKey: '' },
    expectedRevision: 3,
    updatedAt: 1,
  }));
  assert.equal(readAdoptionAttempt('adopt:branch-1', storage)?.key, 'sw-adopt-2');
});

test('missing or corrupt attempt storage reads as absent', () => {
  const storage = memoryStorage();
  assert.equal(readAdoptionAttempt('adopt:branch-1', storage), null);
  storage.setItem(ADOPTION_ATTEMPT_STORAGE_PREFIX + 'adopt:branch-1', '{"key":""}');
  assert.equal(readAdoptionAttempt('adopt:branch-1', storage), null);
  storage.setItem(ADOPTION_ATTEMPT_STORAGE_PREFIX + 'adopt:branch-1', 'not-json');
  assert.equal(readAdoptionAttempt('adopt:branch-1', storage), null);
});

test('synchronous snapshot keeps the submitted draft and revision for a hard refresh', () => {
  const storage = memoryStorage();
  const draft = {
    projectId: 'project-1',
    eventIds: ['evt-1', 'evt-2'],
    actorId: 'actor-a',
    title: '归航',
    expectedRevision: 4,
    rangeFrom: 0,
    rangeTo: 120,
  };
  persistAdoptionAttempt('adopt:branch-1', { key: 'sw-adopt-9', fingerprint: 'fp-9' }, storage);
  persistAdoptionDraftSnapshot('adopt:branch-1', draft, draft.expectedRevision, storage);

  const envelope = JSON.parse(
    storage.values.get('sthstart:story-worlds:draft:adopt:branch-1') ?? '{}',
  );
  assert.equal(envelope.isDirty, true);
  assert.equal(envelope.expectedRevision, 4);
  assert.deepEqual(envelope.data, draft);
  assert.equal(readAdoptionAttempt('adopt:branch-1', storage)?.key, 'sw-adopt-9');
});
