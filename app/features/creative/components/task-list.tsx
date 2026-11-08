'use client';

import { Clock3 } from 'lucide-react';
import type { CreativeTaskResponse } from '@sthstart/contracts';
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
    <div className="space-y-4">
      {isLoading && !tasks.length ? (
        <div className="flex justify-center py-10 text-xs text-muted">正在读取任务…</div>
      ) : tasks.length ? (
        <div className="rounded-panel border border-border-subtle bg-surface divide-y divide-border-subtle overflow-hidden">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onCancel={onCancel} onRetry={onRetry} onReplay={onReplay} />
          ))}
        </div>
      ) : (
          <EmptyState
            className="min-h-64 shadow-none"
            icon={Clock3}
            title="还没有生成任务"
            description="提交创作后，在这里查看生成进度。"
          />
      )}
    </div>
  );
}
