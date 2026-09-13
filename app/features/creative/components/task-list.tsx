'use client';

import { Clock3 } from 'lucide-react';
import type { CreativeTaskResponse } from '@sthstart/contracts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { EmptyState } from '@/app/components/ui/empty-state';
import { TaskCard } from './task-card';

export function TaskList({
  tasks,
  isLoading,
  onCancel,
  onRetry,
  onReplay,
}: {
  tasks: CreativeTaskResponse[];
  isLoading: boolean;
  onCancel: (id: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
  onReplay: (task: CreativeTaskResponse) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="mt-1">生成任务</CardTitle>
            <CardDescription>查看生成进度，重试失败任务或复用创作参数。</CardDescription>
          </div>
          <span className="text-sm text-fg-subtle">共 {tasks.length} 条</span>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && !tasks.length ? (
          <div className="flex justify-center py-10 text-sm text-muted">正在读取任务…</div>
        ) : tasks.length ? (
          <div className="space-y-3">{tasks.map((task) => <TaskCard key={task.id} task={task} onCancel={onCancel} onRetry={onRetry} onReplay={onReplay} />)}</div>
        ) : (
          <EmptyState className="min-h-[140px] py-4" icon={Clock3} title="还没有生成任务" description="提交创作后，在这里查看生成进度。" />
        )}
      </CardContent>
    </Card>
  );
}
