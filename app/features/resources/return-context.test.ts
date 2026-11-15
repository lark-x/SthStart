import assert from 'node:assert/strict';
import test from 'node:test';
import { withResourceReturn } from './return-context';

test('resource return strips all navigation envelopes and preserves business filters across repeated trips', () => {
  let query = 'view=notes&q=中文+资料&page=3&pageSize=50&tag=a&tag=b&from=old&from=other&returnTo=%2Fold&returnTo=%2Fother';
  let canonical = '';
  for (let trip = 0; trip < 3; trip++) {
    const destination = new URL(withResourceReturn('/apps/story?type=reflection', query), 'http://localhost');
    assert.equal(destination.searchParams.get('type'), 'reflection');
    assert.equal(destination.searchParams.get('from'), 'resources');
    const back = new URL(destination.searchParams.get('returnTo')!, destination);
    assert.equal(back.pathname, '/apps/resources');
    assert.equal(back.searchParams.has('returnTo'), false);
    assert.equal(back.searchParams.has('from'), false);
    assert.equal(back.searchParams.get('q'), '中文 资料');
    assert.deepEqual(back.searchParams.getAll('tag'), ['a', 'b']);
    assert.equal(back.searchParams.get('page'), '3');
    if (trip) assert.equal(back.search, canonical);
    canonical = back.search; query = back.search;
  }
});
test('navigation-only source returns to the clean resource root', () => {
  const target = new URL(withResourceReturn('/apps/narrative', 'from=old&returnTo=old'), 'http://localhost');
  assert.equal(target.searchParams.get('returnTo'), '/apps/resources');
});
