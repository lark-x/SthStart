import test from 'node:test';
import assert from 'node:assert/strict';
import type { GenerationAttempt } from '@sthstart/contracts';
import { flattenAttemptPages, isRunningAttempt } from './attempts';

function attempt(id: string, status: GenerationAttempt['status']): GenerationAttempt {
  return {
    id, activityId: 'a1', baseContentRevisionId: 'c1', imageConfigRevisionId: 'i1', slotId: 's1',
    slotFingerprint: 'f', recipeId: 'r1', compilationId: 'p1', recipeHash: 'h', executionPlanHash: 'e',
    taskId: 't1', status, actualSeed: 1, parentAttemptIds: [], businessRequestHash: 'b',
    outputs: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

test('attempt pages flatten in order and deduplicate repeated ids', () => {
  const pages = [
    { items: [attempt('a', 'succeeded'), attempt('b', 'failed')] },
    { items: [attempt('b', 'running'), attempt('c', 'queued')] },
  ];
  assert.deepEqual(flattenAttemptPages(pages).map((item) => `${item.id}:${item.status}`), ['a:succeeded', 'b:running', 'c:queued']);
  assert.deepEqual(flattenAttemptPages(undefined), []);
});

test('only active attempt states count as running', () => {
  for (const status of ['preparing', 'submitting', 'queued', 'running']) assert.equal(isRunningAttempt(status), true);
  for (const status of ['succeeded', 'failed', 'cancelled', 'abandoned']) assert.equal(isRunningAttempt(status), false);
});
