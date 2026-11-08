import assert from 'node:assert/strict';
import test from 'node:test';
import { createActionLock } from './action-lock';

test('rapid duplicate task actions share a lock while independent tasks remain available', () => {
  const lock = createActionLock();
  assert.equal(lock.acquire('task:a'), true);
  assert.equal(lock.acquire('task:a'), false);
  assert.equal(lock.acquire('task:b'), true);
  lock.release('task:a');
  assert.equal(lock.acquire('task:a'), true);
});
test('a rejected action releases its lock for a user retry', async () => {
  const lock = createActionLock();
  assert.ok(lock.acquire('create'));
  try { await Promise.reject(new Error('network')); } catch {} finally { lock.release('create'); }
  assert.ok(lock.acquire('create'));
});
