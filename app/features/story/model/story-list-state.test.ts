import assert from 'node:assert/strict';
import test from 'node:test';
import { readStoryListState, storyListHref, storyProjectHref } from './story-list-state';

test('story directory restores type, keyword, sort and paging while preserving unrelated flags', () => {
  const state = readStoryListState(new URLSearchParams('type=reflection&q=%20%E6%84%9F%E6%83%B3%20&sort=title&page=3&pageSize=50&from=resources'));
  assert.deepEqual(state, { type: 'reflection', q: '感想', sort: 'title', page: 3, pageSize: 50 });
  const href = storyListHref(state, 'from=resources&returnTo=%2Fapps%2Fresources');
  const params = new URL(href, 'http://x').searchParams;
  assert.equal(params.get('from'), 'resources');
  assert.equal(params.get('returnTo'), '/apps/resources');
  assert.equal(params.get('type'), 'reflection');
  assert.equal(params.get('q'), '感想');
  assert.equal(params.get('page'), '3');
});

test('story directory repairs invalid state and drops the type flag for the all view', () => {
  assert.deepEqual(readStoryListState(new URLSearchParams('type=nope&page=-1&pageSize=500&sort=nope')), {
    type: 'all', q: '', sort: 'updated', page: 1, pageSize: 20,
  });
  const href = storyListHref({ type: 'all', q: '', sort: 'updated', page: 1, pageSize: 20 }, 'type=reflection&q=old');
  const params = new URL(href, 'http://x').searchParams;
  assert.equal(params.has('type'), false);
  assert.equal(params.has('q'), false);
  assert.equal(params.get('page'), '1');
});

test('story project links keep the directory as the return target', () => {
  const list = '/apps/story?type=fiction&q=%E6%BD%AE%E6%B1%90';
  assert.equal(storyProjectHref('p1', 'fiction', list), '/apps/projects/p1?returnTo=' + encodeURIComponent(list));
  assert.equal(storyProjectHref('p1', 'reflection', list), '/apps/story/p1?returnTo=' + encodeURIComponent(list));
});
