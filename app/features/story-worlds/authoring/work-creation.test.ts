import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWorkCreationAttempt, workCreationAttempt } from './work-creation';

test('quick creation restores the complete work identity and reuses a key only for the same request', () => {
  const first = workCreationAttempt(null, { title: ' 现代港口 ', workNature: 'derivative', parentWork: ' 原神 ' }, () => 'first');
  assert.deepEqual(parseWorkCreationAttempt(JSON.stringify(first)), {
    title: '现代港口', workNature: 'derivative', parentWork: '原神', key: 'first',
  });
  assert.equal(workCreationAttempt(first, { ...first, title: ' 现代港口 ' }, () => 'unused').key, 'first');
  assert.equal(workCreationAttempt(first, { ...first, workNature: 'original' }, () => 'second').key, 'second');
  assert.equal(workCreationAttempt(first, { ...first, parentWork: '星铁' }, () => 'third').key, 'third');
  assert.equal(workCreationAttempt(first, { ...first, title: '另一个故事' }, () => 'fourth').key, 'fourth');
  assert.equal(parseWorkCreationAttempt(JSON.stringify({ title: '旧标题', key: 'cannot-replay' })), null);
  assert.equal(parseWorkCreationAttempt('{broken'), null);
});
