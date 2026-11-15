import assert from 'node:assert/strict';
import test from 'node:test';
import { projectBackTarget, projectEditorHref, projectListHref, projectOverviewHref, projectReturnHref, readProjectListState } from './list-state';

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

test('project overview and editor keep the list return target through the round trip', () => {
  const list = projectListHref(readProjectListState(new URLSearchParams('page=2&pageSize=50&sort=title&q=潮汐')));
  const overview = projectOverviewHref('p1', list);
  assert.equal(overview, '/apps/projects/p1?returnTo=' + encodeURIComponent(list));
  assert.deepEqual(projectBackTarget(decodeURIComponent(new URL(overview, 'http://x').searchParams.get('returnTo')!)), {
    href: list,
    label: '返回创作项目列表',
  });

  const editor = projectEditorHref('p1', list, 'chapter-1');
  const params = new URL(editor, 'http://x').searchParams;
  assert.equal(params.get('entry'), 'chapter-1');
  assert.equal(params.get('returnTo'), overview);
  assert.equal(projectOverviewHref('p1', null), '/apps/projects/p1');
});

test('project back target accepts a safe Story directory return but rejects foreign paths', () => {
  const story = '/apps/story?type=fiction&q=%E6%BD%AE%E6%B1%90&page=1';
  assert.deepEqual(projectBackTarget(story), { href: story, label: '返回剧情项目' });
  for (const unsafe of ['//evil.test/apps/story', '/apps/story evil', 'https://evil.test/apps/story', '/apps/story\\x']) {
    assert.deepEqual(projectBackTarget(unsafe), { href: '/apps/projects', label: '返回创作项目列表' }, unsafe);
  }
});
