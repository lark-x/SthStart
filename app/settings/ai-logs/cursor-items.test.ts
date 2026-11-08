import assert from 'node:assert/strict';
import test from 'node:test';
import { uniqueCursorItems } from './cursor-items';

test('overlapping cursor pages update records without duplicate rows or reordered history', () => {
  assert.deepEqual(uniqueCursorItems([
    { items: [{ id: 'a', status: 'running' }, { id: 'b', status: 'running' }] },
    { items: [{ id: 'b', status: 'succeeded' }, { id: 'c', status: 'failed' }] },
  ]), [{ id: 'a', status: 'running' }, { id: 'b', status: 'succeeded' }, { id: 'c', status: 'failed' }]);
});
test('empty filters and page refetches do not retain old cursor rows', () => {
  assert.deepEqual(uniqueCursorItems([]), []);
  assert.deepEqual(uniqueCursorItems([{ items: [{ id: 'new' }] }]), [{ id: 'new' }]);
});
