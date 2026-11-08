import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMediaListState, mediaListUrl, parseMediaListState } from './url-state';

test('media URL state restores search, filters, page and capacity', () => {
  assert.deepEqual(parseMediaListState('?q=cover&mediaKind=image&status=missing&appId=activities&page=4&pageSize=48'), {
    q: 'cover', mediaKind: 'image', status: 'missing', appId: 'activities', page: 4, pageSize: 48,
  });
});

test('media URL state rejects unsupported values and preserves unrelated parameters', () => {
  assert.deepEqual(parseMediaListState('?mediaKind=nope&status=nope&page=-2&pageSize=32'), {
    q: '', mediaKind: 'all', status: 'all', appId: 'all', page: 1, pageSize: 24,
  });
  const params = new URLSearchParams('preview=item-1&q=old&page=7');
  applyMediaListState(params, {
    q: '', mediaKind: 'audio', status: 'ready', appId: 'all', page: 1, pageSize: 96,
  });
  assert.equal(params.get('preview'), 'item-1');
  assert.equal(params.get('q'), null);
  assert.equal(params.get('page'), null);
  assert.equal(params.get('mediaKind'), 'audio');
  assert.equal(params.get('status'), 'ready');
  assert.equal(params.get('pageSize'), '96');
});

test('media page URL preserves unrelated parameters for history push', () => {
  const next = mediaListUrl('https://example.test/apps/media?preview=item-1&page=1', {
    q: 'cover', mediaKind: 'image', status: 'ready', appId: 'all', page: 3, pageSize: 48,
  });
  assert.ok(next.startsWith('/apps/media?preview=item-1'));
  assert.ok(next.includes('q=cover'));
  assert.ok(next.includes('page=3'));
  assert.ok(next.includes('pageSize=48'));
});
