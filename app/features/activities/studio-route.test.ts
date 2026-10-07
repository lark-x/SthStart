import assert from 'node:assert/strict';
import test from 'node:test';
import { navigateActivityStudio, resolveActivityStudioRoute } from './studio-route';

test('all legacy workbench links retain their meaning and anchors', () => {
  const cases = [
    ['', 'studio', 'storyboard', null], ['tab=script', 'studio', 'storyboard', null],
    ['tab=records', 'studio', 'records', null], ['tab=settings', 'studio', 'storyboard', 'activity-settings'],
    ['tab=media', 'studio', 'assets', null], ['tab=playback', 'theater', 'storyboard', null],
    ['tab=playback&mode=comic', 'studio', 'comic', null], ['tab=export', 'delivery', 'storyboard', null],
  ];
  for (const [search, tab, view, panel] of cases) {
    const result = resolveActivityStudioRoute(`${search}&stageId=s&sceneId=c&beatId=b&panelId=p&jobId=legacy&studioJobId=new&slotId=m&batchId=q`);
    assert.equal(result.route.tab, tab);
    assert.equal(result.route.view, view);
    assert.equal(result.route.panel, panel);
    const params = new URLSearchParams(result.canonicalSearch);
    for (const [key,value] of Object.entries({ stageId: 's', sceneId: 'c', beatId: 'b', panelId: 'p', jobId: 'legacy', studioJobId: 'new', slotId: 'm', batchId: 'q' })) assert.equal(params.get(key), value);
    assert.equal(resolveActivityStudioRoute(result.canonicalSearch).canonicalSearch, result.canonicalSearch, 'replace normalization is idempotent');
  }
});

test('navigation separates comic editing, reading and delivery without stale mode flags', () => {
  const editing = navigateActivityStudio('tab=playback', { tab: 'studio', view: 'comic' });
  assert.equal(resolveActivityStudioRoute(editing).route.view, 'comic');
  assert.equal(new URLSearchParams(editing).has('mode'), false);
  const reading = navigateActivityStudio(editing, { tab: 'theater', mode: 'comic' });
  assert.equal(resolveActivityStudioRoute(reading).route.mode, 'comic');
  const gallery = navigateActivityStudio(reading, { tab: 'delivery', deliveryView: 'gallery' });
  assert.equal(new URLSearchParams(gallery).has('mode'), false);
  assert.equal(resolveActivityStudioRoute(gallery).route.deliveryView, 'gallery');
});

test('record subviews survive navigation and browser history without overwriting anchors', () => {
  const moments = navigateActivityStudio('tab=studio&view=storyboard&stageId=s', { view: 'records', recordView: 'moments' });
  assert.equal(resolveActivityStudioRoute(moments).route.recordView, 'moments');
  assert.equal(new URLSearchParams(moments).get('stageId'), 's');
  const facts = navigateActivityStudio(moments, { recordView: 'facts' });
  assert.equal(resolveActivityStudioRoute(facts).route.recordView, 'facts');
  assert.equal(resolveActivityStudioRoute(moments).route.recordView, 'moments');
});
