import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderWithUi } from '../../../lib/render-with-ui-test';
import type { WorldSourceUpdatePreview } from '@sthstart/contracts';
import { SourceUpdatePreviewPanel, sourceUpdateRefreshRequest } from './source-update-preview';

const preview: WorldSourceUpdatePreview = {
  worldId: 'world-1',
  branchId: 'branch-1',
  worldRevision: 4,
  branchRevision: 7,
  branchSourceRevision: 3,
  currentBranchPending: true,
  generatedAt: '2026-11-11T00:00:00.000Z',
  counts: { added: 1, modified: 2, removed: 1 },
  changes: [
    {
      kind: 'world', id: 'world', name: '世界设定', change: 'modified',
      fields: [
        { field: 'lockedFacts', label: '锁定设定', before: '旧锁定。', after: '新锁定。' },
        { field: 'startMinuteOfDay', label: '世界起点的日内分钟', before: '（未定义）', after: '390 分钟（06:30）' },
      ],
      note: '纳入后只更新后续运行使用的世界基设；既有事件、正文、记忆和人物状态不改写。',
    },
    {
      kind: 'actor', id: 'actor-nahida', name: '纳西妲', change: 'modified',
      fields: [{ field: 'background', label: '背景', before: '旧背景。', after: '新背景。' }],
      note: '纳入后只更新后续运行使用的人物定义；分支当前状态、记忆和既有事件不改写。',
    },
    {
      kind: 'source', id: 'source-old', name: '旧资料', change: 'removed',
      fields: [], note: '纳入后从分支来源列表移除；既有事件、正文和记忆不会改写。',
    },
    {
      kind: 'location', id: 'loc-new', name: '新码头', change: 'added',
      fields: [], note: '',
    },
  ],
  affectedBranches: [
    {
      branchId: 'branch-1', title: '主线', mode: 'canon-gap', currentTick: 60,
      sourceRevision: 3, isCurrent: true, counts: { added: 1, modified: 2, removed: 1 },
    },
    {
      branchId: 'branch-2', title: '另一分支', mode: 'alternate', currentTick: 0,
      sourceRevision: 3, isCurrent: false, counts: { added: 1, modified: 2, removed: 1 },
    },
  ],
  characterVersionUpdates: [{
    actorId: 'actor-nahida', actorName: '纳西妲', characterId: 'char-nahida', characterName: '纳西妲',
    fromVersion: 2, latestVersion: 3, publishedAt: '2026-11-10T00:00:00.000Z', canImport: true,
    note: '角色库已发布 v3，世界快照仍是 v2；可在世界设置中显式导入，预览不会自动覆盖。',
  }],
  sourceSnapshotNotices: [{
    sourceId: 'source-old', title: '旧资料', sourceVersion: '1.0', capturedAt: '2026-11-01T00:00:00.000Z',
    reason: 'no-stable-link',
    note: '没有可稳定核对的原文链接；只按本库快照（版本 1.0，采集于 2026-11-01T00:00:00.000Z）展示，不能据此确认原文已刷新。',
  }],
  historyPreserved: true,
};

function render(overrides: Partial<React.ComponentProps<typeof SourceUpdatePreviewPanel>> = {}) {
  return renderWithUi(
    <SourceUpdatePreviewPanel
      preview={preview}
      loading={false}
      error={null}
      busy={false}
      staleMessage={null}
      actionError={null}
      onRetry={() => {}}
      onConfirm={() => {}}
      onCancel={() => {}}
      {...overrides}
    />,
  );
}

test('source update preview shows loading and load failure states', () => {
  const loading = render({ preview: undefined, loading: true });
  assert.match(loading, /正在比较世界定义/);
  assert.match(loading, /读取最新世界定义/);

  const failed = render({ preview: undefined, error: '故事世界服务暂时不可用。' });
  assert.match(failed, /影响预览加载失败/);
  assert.match(failed, /故事世界服务暂时不可用。/);
  assert.match(failed, /重新比较/);
});

test('source update preview exposes stale revision conflict before confirmation', () => {
  const html = render({ staleMessage: '预览基于分支修订 7；当前已是分支修订 8。为避免覆盖新编辑，请重新比较后再确认。' });
  assert.match(html, /预览已过期/);
  assert.match(html, /为避免覆盖新编辑/);
  assert.match(html, /重新比较/);
  assert.match(html, /disabled/);
});

test('source update preview lists per-entity changes, affected branches and honest source snapshots', () => {
  const html = render({ onEditWorld: () => {} });
  assert.match(html, /只影响以后推进/);
  assert.match(html, /既有事件、正文、记忆和人物状态不会改写/);
  assert.match(html, /世界设定 新增 0 · 修改 1 · 移除 0/);
  assert.match(html, /人物 新增 0 · 修改 1 · 移除 0/);
  assert.match(html, /来源 新增 0 · 修改 0 · 移除 1/);
  assert.match(html, /地点 新增 1 · 修改 0 · 移除 0/);
  assert.match(html, /纳西妲/);
  assert.match(html, /锁定设定/);
  assert.match(html, /旧锁定。/);
  assert.match(html, /新锁定。/);
  assert.match(html, /世界起点的日内分钟/);
  assert.match(html, /（未定义）/);
  assert.match(html, /390 分钟（06:30）/);
  assert.match(html, /旧背景。/);
  assert.match(html, /新背景。/);
  assert.match(html, /分支独有角色会保留|既有事件、正文和记忆不会改写/);
  assert.match(html, /主线/);
  assert.match(html, /当前分支/);
  assert.match(html, /另一分支/);
  assert.match(html, /本次确认只写入当前分支/);
  assert.match(html, /可导入，但不会自动覆盖世界/);
  assert.match(html, /v2 → v3/);
  assert.match(html, /打开世界设置/);
  assert.match(html, /没有可稳定核对的原文链接/);
  assert.match(html, /不能据此确认原文已刷新/);
  assert.match(html, /确认纳入新版/);
  assert.match(html, /分支修订 7/);
});

test('source update confirmation carries both previewed branch and world revisions', () => {
  assert.deepEqual(sourceUpdateRefreshRequest(preview), {
    expectedRevision: 7,
    expectedWorldRevision: 4,
  });
});

test('source update preview keeps a visible failure after confirmation', () => {
  const html = render({ actionError: '数据版本已更新，请更新修订基底后重试。' });
  assert.match(html, /纳入未完成/);
  assert.match(html, /数据版本已更新/);
});
