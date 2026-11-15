import test from 'node:test';
import assert from 'node:assert/strict';
import { characterKeys } from './query-keys';

test('character query keys keep the transitional cache shape', () => {
  const request = { page: 2, pageSize: 50, works: ['原神'] };
  assert.deepEqual(characterKeys.all, ['characters']);
  assert.deepEqual(characterKeys.browse(request), ['characters', 'browse', request]);
  assert.deepEqual(characterKeys.detail('c1'), ['characters', 'detail', 'c1']);
  assert.deepEqual(characterKeys.assets('c1'), ['characters', 'assets', 'c1']);
  assert.deepEqual(characterKeys.list({ query: '芙宁娜' }), ['characters', 'list', { query: '芙宁娜' }]);
});
