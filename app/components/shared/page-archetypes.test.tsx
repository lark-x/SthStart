import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HeadlessMantineProvider } from '@mantine/core';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {
  MAX_SECONDARY_ACTIONS,
  collectionViewSearch,
  isSparseCollection,
  parseCollectionView,
  pickNextSteps,
  resolveCollectionView,
  splitCollectionActions,
} from './page-archetypes-model';
import {
  CollectionActions,
  CollectionFilterButton,
  CollectionFilterChips,
  CollectionLayout,
  CollectionViewToggle,
  DetailLayout,
  OverviewLayout,
  ReaderLayout,
} from './page-archetypes';

const router = {
  back() {}, forward() {}, refresh() {}, prefetch() {}, push() {}, replace() {},
  hmrRefresh() {},
} as unknown as React.ContextType<typeof AppRouterContext>;

const render = (node: React.ReactElement) => renderToStaticMarkup(
  <AppRouterContext.Provider value={router}>
    <HeadlessMantineProvider>{node}</HeadlessMantineProvider>
  </AppRouterContext.Provider>,
);

const action = (id: string) => ({ id, label: id });

test('secondary actions beyond the budget spill into the overflow menu ahead of existing overflow items', () => {
  const split = splitCollectionActions([action('a'), action('b'), action('c'), action('d')], [action('z')]);
  assert.equal(MAX_SECONDARY_ACTIONS, 2);
  assert.deepEqual(split.visible.map((item) => item.id), ['a', 'b']);
  assert.deepEqual(split.overflow.map((item) => item.id), ['c', 'd', 'z']);
  assert.deepEqual(splitCollectionActions(undefined, undefined), { visible: [], overflow: [] });
});

test('view parsing falls back for unknown values and sparse lists force the sparse view', () => {
  assert.equal(parseCollectionView('row', ['card', 'row'] as const, 'card'), 'row');
  assert.equal(parseCollectionView('grid', ['card', 'row'] as const, 'card'), 'card');
  assert.equal(parseCollectionView(null, ['card', 'row'] as const, 'row'), 'row');
  assert.equal(isSparseCollection(undefined), false, 'unknown count (loading) is not sparse');
  assert.equal(isSparseCollection(0), false, 'empty lists use the empty state, not the sparse layout');
  assert.equal(isSparseCollection(2), true);
  assert.equal(isSparseCollection(3), false);
  assert.equal(resolveCollectionView('row', 1, 'card'), 'card');
  assert.equal(resolveCollectionView('row', 5, 'card'), 'row');
  assert.equal(resolveCollectionView('row', undefined, 'card'), 'row', 'loading keeps the requested view to avoid flicker');
});

test('view search keeps other params and omits the default value', () => {
  assert.equal(collectionViewSearch('?q=%E8%A7%92&page=2', 'row', 'card'), '?q=%E8%A7%92&page=2&view=row');
  assert.equal(collectionViewSearch('?q=a&view=row', 'card', 'card'), '?q=a');
  assert.equal(collectionViewSearch('', 'card', 'card'), '');
  assert.equal(collectionViewSearch('cf=1', 'avatar', 'card', 'display'), '?cf=1&display=avatar');
});

test('next steps appear only for 0–2 items and are capped at three', () => {
  const steps = ['a', 'b', 'c', 'd'];
  assert.deepEqual(pickNextSteps(steps, 0), ['a', 'b', 'c']);
  assert.deepEqual(pickNextSteps(steps, 2), ['a', 'b', 'c']);
  assert.deepEqual(pickNextSteps(steps, 3), []);
});

test('header actions render one primary, at most two secondary and an overflow menu trigger', () => {
  const html = render(
    <CollectionActions
      primary={{ id: 'new', label: '新建', href: '/new' }}
      secondary={[action('导入'), action('导出'), action('同步')]}
      overflow={[action('整理')]}
      overflowLabel="更多角色操作"
    />,
  );
  const primaryLink = /<a\b[^>]*data-collection-action="new"[^>]*>/.exec(html)?.[0] ?? '';
  assert.match(primaryLink, /href="\/new"/, 'primary action with href renders as a link');
  assert.equal((html.match(/data-collection-action=/g) ?? []).length, 3, 'primary + two secondary are visible');
  assert.doesNotMatch(html, />同步</, 'the third secondary action is moved into the menu');
  assert.match(html, /aria-label="更多角色操作"/);
  assert.equal(render(<CollectionActions />), '', 'no actions, no wrapper');
});

test('filter chips are individually removable and announce the summary', () => {
  const html = render(
    <CollectionFilterChips
      chips={[{ id: 'a', label: '作品：原神', onRemove() {} }, { id: 'b', label: '仅收藏', onRemove() {} }]}
      onClearAll={() => {}}
      summary="共 3 位"
    />,
  );
  assert.match(html, /aria-label="已生效的筛选条件"/);
  assert.match(html, /aria-label="移除筛选：作品：原神"/);
  assert.match(html, /清除全部/);
  assert.match(html, /共 3 位/);
  assert.equal(render(<CollectionFilterChips chips={[]} />), '', 'nothing to show, no empty row');
});

test('filter button name matches its visible text and the view toggle exposes pressed state', () => {
  const button = render(<CollectionFilterButton activeCount={2} onClick={() => {}} expanded={false} />);
  assert.doesNotMatch(button, /aria-label=/, 'accessible name comes from the visible label');
  assert.match(button, /筛选/);
  assert.match(button, /\(2\)/);
  assert.match(button, /aria-haspopup="dialog"/);
  const toggle = render(
    <CollectionViewToggle value="row" onChange={() => {}} options={[{ value: 'card', label: '卡片' }, { value: 'row', label: '列表' }]} />,
  );
  assert.match(toggle, /role="group"[^>]*aria-label="展示方式"/);
  assert.match(toggle, /aria-pressed="true"[^>]*>(?:<!-- -->)?<span>列表/);
  assert.match(toggle, /aria-pressed="false"[^>]*>(?:<!-- -->)?<span>卡片/);
});

test('collection layout marks sparse lists and keeps one h1', () => {
  const sparse = render(
    <CollectionLayout title="角色库" itemCount={1} search={<input aria-label="搜索" />} summary="共 1 位">
      <ul><li>一位角色</li></ul>
    </CollectionLayout>,
  );
  assert.match(sparse, /data-page-archetype="collection"/);
  assert.match(sparse, /data-sparse="true"/);
  assert.equal((sparse.match(/<h1/g) ?? []).length, 1);
  assert.match(sparse, /data-collection-toolbar/);
  const full = render(<CollectionLayout title="角色库" itemCount={12}><p>列表</p></CollectionLayout>);
  assert.doesNotMatch(full, /data-sparse/);
  assert.doesNotMatch(full, /data-collection-toolbar/, 'no toolbar row without search, filter or view controls');
});

test('overview, detail and reader layouts expose their archetype and structure', () => {
  const overview = render(<OverviewLayout greeting={<h1>工作台</h1>} hero={<p>主卡</p>} stats={<p>统计</p>} />);
  assert.match(overview, /data-page-archetype="overview"/);
  assert.match(overview, /<section class="overview-hero" aria-label="继续创作">/);
  const detail = render(<DetailLayout title="林舟" media={<img alt="" />} aside={<p>关系</p>}><p>档案</p></DetailLayout>);
  assert.match(detail, /data-page-archetype="detail"/);
  assert.match(detail, /detail-body-with-aside/);
  const reader = render(<ReaderLayout meta="第 1 章"><p>正文</p></ReaderLayout>);
  assert.match(reader, /data-page-archetype="reader"/);
  assert.match(reader, /<article class="reader-layout">/);
});
