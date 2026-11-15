import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderWithUi } from '../../../lib/render-with-ui-test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { activityKeys } from '../shared/query-keys';
import { ActivityWorkspaceRouter } from './activity-workspace-router';

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

test('ActivityWorkspaceRouter renders pending loading state when query is loading', () => {
  const queryClient = createTestQueryClient();
  const html = renderWithUi(
    <QueryClientProvider client={queryClient}>
      <ActivityWorkspaceRouter activityId="pending-act" />
    </QueryClientProvider>
  );

  assert.ok(html.includes('活动工作室'), 'must render workspace title in header');
  assert.ok(html.includes('role="status"'), 'must include accessible status role');
  assert.ok(html.includes('正在载入作品…'), 'must include pending message');
});

test('ActivityWorkspaceRouter renders error banner when activity does not exist', () => {
  const queryClient = createTestQueryClient();
  // Set explicit null data indicating missing entity
  queryClient.setQueryData(activityKeys.detail('missing-act'), null);

  const html = renderWithUi(
    <QueryClientProvider client={queryClient}>
      <ActivityWorkspaceRouter activityId="missing-act" />
    </QueryClientProvider>
  );

  assert.ok(html.includes('role="alert"'), 'must include accessible alert role');
  assert.ok(html.includes('无法读取作品：作品不存在'), 'must show failure explanation');
  assert.ok(html.includes('重新加载作品'), 'must provide refetch button');
});

test('ActivityWorkspaceRouter dynamically routes publication activity to publication workspace lazy panel', () => {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(activityKeys.detail('pub-act-1'), {
    activity: {
      id: 'pub-act-1',
      type: 'publication',
      name: '出版测试',
    },
  });

  const html = renderWithUi(
    <QueryClientProvider client={queryClient}>
      <ActivityWorkspaceRouter activityId="pub-act-1" />
    </QueryClientProvider>
  );

  assert.ok(
    html.includes('正在载入出版工作台…'),
    'must render publication lazy panel loading state without statically loading studio'
  );
  assert.ok(
    !html.includes('正在载入活动工作室…'),
    'must not render studio workspace loading state for publication'
  );
});

test('ActivityWorkspaceRouter dynamically routes non-publication activity to activity studio workspace lazy panel', () => {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(activityKeys.detail('story-act-1'), {
    activity: {
      id: 'story-act-1',
      type: 'story',
      name: '分镜测试',
    },
  });

  const html = renderWithUi(
    <QueryClientProvider client={queryClient}>
      <ActivityWorkspaceRouter activityId="story-act-1" />
    </QueryClientProvider>
  );

  assert.ok(
    html.includes('正在载入活动工作室…'),
    'must render activity studio lazy panel loading state'
  );
  assert.ok(
    !html.includes('正在载入出版工作台…'),
    'must not render publication workspace loading state for story activity'
  );
});
