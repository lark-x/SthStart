import assert from 'node:assert/strict';
import test from 'node:test';
import { storyBackTarget } from './story-route';

test('fiction editor returns to the same project overview with its list target intact', () => {
  const overview = '/apps/projects/p1?returnTo=%2Fapps%2Fprojects%3Fpage%3D2%26q%3D%E6%BD%AE%E6%B1%90';
  assert.deepEqual(storyBackTarget({ projectId: 'p1', isReflection: false, returnTo: overview }), {
    href: overview, label: '返回项目总览',
  });
  assert.deepEqual(storyBackTarget({ projectId: 'p1', isReflection: false, returnTo: '/apps/projects/p2' }), {
    href: '/apps/projects/p1', label: '返回项目总览',
  });
});

test('reflection editor returns to its filtered directory and rejects unsafe targets', () => {
  const list = '/apps/story?type=reflection&q=%E6%84%9F%E6%83%B3';
  assert.deepEqual(storyBackTarget({ projectId: 'p1', isReflection: true, returnTo: list }), {
    href: list, label: '返回剧情项目',
  });
  for (const unsafe of ['//evil.test/apps/story', '/apps/story\tx', 'https://evil.test/apps/story']) {
    assert.deepEqual(storyBackTarget({ projectId: 'p1', isReflection: true, returnTo: unsafe }), {
      href: '/apps/story?type=reflection', label: '返回剧情项目',
    });
  }
});
