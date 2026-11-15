'use client';

import React from 'react';
import { useActivity } from '@/app/features/activities/queries/activities';
import { Button } from '@/app/components/ui/button';
import { WorkspaceHeader } from '@/app/components/shared/workspace-header';
import { LazyPanel, createRetryableLoader } from '@/app/components/shared/lazy-panel';

const loadPublicationWorkspace = createRetryableLoader(
  () => import('./publication-workspace'), m => ({ default: m.PublicationWorkspace }));

const loadActivityStudioWorkspace = createRetryableLoader(
  () => import('../components/activity-studio-workspace'), m => ({
    default: m.ActivityStudioWorkspace,
  }));

export function ActivityWorkspaceRouter({ activityId }: { activityId: string }) {
  const query = useActivity(activityId);

  if (query.isPending) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-paper text-ink">
        <WorkspaceHeader title="活动工作室" backHref="/apps/activities" backLabel="制作项目" />
        <div
          className="flex flex-1 items-center justify-center p-6 text-sm text-muted"
          role="status"
        >
          正在载入作品…
        </div>
      </div>
    );
  }

  if (!query.data) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-paper text-ink">
        <WorkspaceHeader
          title="活动工作室"
          backHref="/apps/activities"
          backLabel="制作项目"
          actions={
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              重新加载作品
            </Button>
          }
        />
        <div className="flex flex-1 items-center justify-center p-6">
          <p role="alert" className="text-sm text-danger-fg">
            无法读取作品：{query.error?.message ?? '作品不存在'}
          </p>
        </div>
      </div>
    );
  }

  const isPublication = query.data.activity.type === 'publication';

  if (isPublication) {
    return (
      <LazyPanel
        label="出版工作台"
        loader={loadPublicationWorkspace}
        componentProps={{ activityId }}
        fallback={
          <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-paper text-ink">
            <WorkspaceHeader title="活动工作室" backHref="/apps/activities" backLabel="制作项目" />
            <div
              className="flex flex-1 items-center justify-center p-6 text-sm text-muted"
              role="status"
            >
              正在载入出版工作台…
            </div>
          </div>
        }
        errorFallback={(error, retry) => (
          <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-paper text-ink">
            <WorkspaceHeader
              title="活动工作室"
              backHref="/apps/activities"
              backLabel="制作项目"
              actions={
                <Button variant="outline" onClick={retry}>
                  重新尝试载入
                </Button>
              }
            />
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6">
              <p role="alert" className="text-sm text-danger-fg">
                无法载入出版工作台：{error.message || '网络异常'}
              </p>
              <p className="text-xs text-muted">请重试加载此工作台，无需刷新整页。</p>
            </div>
          </div>
        )}
      />
    );
  }

  return (
    <LazyPanel
      label="活动工作室"
      loader={loadActivityStudioWorkspace}
      componentProps={{ activityId }}
      fallback={
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-paper text-ink">
          <WorkspaceHeader title="活动工作室" backHref="/apps/activities" backLabel="制作项目" />
          <div
            className="flex flex-1 items-center justify-center p-6 text-sm text-muted"
            role="status"
          >
            正在载入活动工作室…
          </div>
        </div>
      }
      errorFallback={(error, retry) => (
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-paper text-ink">
          <WorkspaceHeader
            title="活动工作室"
            backHref="/apps/activities"
            backLabel="制作项目"
            actions={
              <Button variant="outline" onClick={retry}>
                重新尝试载入
              </Button>
            }
          />
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6">
            <p role="alert" className="text-sm text-danger-fg">
              无法载入活动工作室：{error.message || '网络异常'}
            </p>
            <p className="text-xs text-muted">请重试加载此工作台，无需刷新整页。</p>
          </div>
        </div>
      )}
    />
  );
}
