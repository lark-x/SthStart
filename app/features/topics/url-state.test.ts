import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTopicListState, parseTopicListState, topicListParams, topicListUrl } from './url-state';

test('topic URL state restores filters and favorite time default', () => {
  const parsed = parseTopicListState('?q=%E5%8E%9F%E7%A5%9E&works=Genshin&works=StarRail&kind=meme&view=favorite&page=3&pageSize=50');
  assert.deepEqual(parsed, {
    q: '原神', works: ['Genshin', 'StarRail'], kind: 'meme', days: 0,
    view: 'favorite', page: 3, pageSize: 50,
  });
  assert.deepEqual(topicListParams(parsed), {
    q: '原神', works: ['Genshin', 'StarRail'], kinds: ['meme'], days: 0,
    view: 'favorite', page: 3, pageSize: 50,
  });
});

test('topic URL state supports picker prefix and removes stale keys', () => {
  assert.deepEqual(parseTopicListState('?ip_q=party&ip_days=7&ip_page=2&ip_pageSize=100', 'ip'), {
    q: 'party', works: [], kind: '', days: 7, view: 'all', page: 2, pageSize: 100,
  });
  const params = new URLSearchParams('topic=t1&ip_q=old&ip_page=4');
  applyTopicListState(params, {
    q: '', works: ['Genshin'], kind: 'update', days: 30, view: 'all', page: 1, pageSize: 20,
  }, 'ip');
  assert.equal(params.get('topic'), 't1');
  assert.equal(params.get('ip_q'), null);
  assert.equal(params.get('ip_page'), null);
  assert.deepEqual(params.getAll('ip_works'), ['Genshin']);
  assert.equal(params.get('ip_kind'), 'update');
});

test('topic URL state bounds invalid page and capacity', () => {
  assert.deepEqual(parseTopicListState('?page=0&pageSize=999&kind=bad&view=bad'), {
    q: '', works: [], kind: '', days: 30, view: 'all', page: 1, pageSize: 20,
  });
});

test('embedded topic URL state is namespaced and preserves the outer resources view', () => {
  const current = 'https://example.test/apps/resources?view=inspiration&topic_page=1';
  const next = topicListUrl(current, {
    q: '原神', works: ['Genshin'], kind: 'meme', days: 30,
    view: 'favorite', page: 3, pageSize: 50,
  }, 'topic');
  assert.ok(next.startsWith('/apps/resources?view=inspiration'));
  assert.ok(next.includes('topic_page=3'));
  assert.ok(next.includes('topic_view=favorite'));
  assert.ok(next.includes('topic_pageSize=50'));
  assert.equal(next.includes('&page=3'), false);
  assert.equal(next.includes('&view=favorite'), false);
});

test('standalone topic entry continues to read unprefixed parameters', () => {
  assert.deepEqual(parseTopicListState('?q=old&view=used&page=2&pageSize=100'), {
    q: 'old', works: [], kind: '', days: 30, view: 'used', page: 2, pageSize: 100,
  });
});
