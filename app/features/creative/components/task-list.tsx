'use client';

import { Clock3 } from 'lucide-react';
import type { ArtifactDescriptor, CreativeTaskResponse } from '@sthstart/contracts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { EmptyState } from '@/app/components/ui/empty-state';
import { TaskCard } from './task-card';

export function TaskList({
  tasks,
  artifacts,
  isLoading,
  onCancel,
  onRetry,
  onReplay,
}: {
  tasks: CreativeTaskResponse[];
  artifacts: ArtifactDescriptor[];
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
            <span className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#b83b1b]">TASKS</span>
            <CardTitle className="mt-1">生成任务</CardTitle>
            <CardDescription>任务状态由公共生成核心持续更新；失败会保留明确错误，不会静默换模型。</CardDescription>
          </div>
          <span className="text-xs text-[#89908a]">共 {tasks.length} 条</span>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && !tasks.length ? (
          <div className="flex justify-center py-10 text-sm text-[#68716d]">正在读取任务…</div>
        ) : tasks.length ? (
          <div className="space-y-3">{tasks.map((task) => <TaskCard key={task.id} task={task} artifacts={artifacts} onCancel={onCancel} onRetry={onRetry} onReplay={onReplay} />)}</div>
        ) : (
          <EmptyState className="min-h-[220px]" icon={Clock3} title="还没有生成任务" description="完成上方参数后，第一张图片会出现在这里。" />
        )}
      </CardContent>
    </Card>
  );
}
