import assert from 'node:assert/strict';
import test from 'node:test';
import { projectListHref, projectReturnHref, readProjectListState } from './list-state';

test('project URL state restores search, sort and capacity without losing unrelated flags', () => {
  const state = readProjectListState(new URLSearchParams('page=4&pageSize=50&sort=title&q=星海'));
  const href = projectListHref(state, 'view=cards&new=1');
  assert.deepEqual(readProjectListState(new URLSearchParams(href.split('?')[1])), state);
  assert.ok(href.includes('view=cards'));
  assert.ok(!href.includes('new='));
  assert.equal(projectReturnHref(href), projectListHref(state));
});
test('invalid URL pagination is repaired and return destinations stay local', () => {
  for (const page of ['-1', 'NaN', 'Infinity', '1.5', '0', '1e3']) {
    assert.deepEqual(readProjectListState(new URLSearchParams(`page=${page}&pageSize=500&sort=nope`)),
      { page: 1, pageSize: 20, q: '', sort: 'updated' });
  }
  for (const url of ['https://example.com', '//example.com', '/apps/projects/other', '/apps/projects.evil?q=x', null]) {
    assert.equal(projectReturnHref(url), '/apps/projects');
  }
  assert.equal(readProjectListState(new URLSearchParams('q=' + 'x'.repeat(300))).q.length, 200);
});
