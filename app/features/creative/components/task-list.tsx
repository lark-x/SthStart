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
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between border-b border-border-subtle pb-3">
        <div>
          <h3 className="text-base font-semibold text-ink">生成任务</h3>
          <p className="text-xs text-muted">查看生成进度，重试失败任务或复用创作参数。</p>
        </div>
        <span className="text-xs text-fg-subtle">共 {tasks.length} 条</span>
      </div>

      {isLoading && !tasks.length ? (
        <div className="flex justify-center py-10 text-xs text-muted">正在读取任务…</div>
      ) : tasks.length ? (
        <div className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface divide-y divide-border-subtle overflow-hidden">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onCancel={onCancel} onRetry={onRetry} onReplay={onReplay} />
          ))}
        </div>
      ) : (
        <div className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-8">
          <EmptyState
            className="min-h-[140px] py-4"
            icon={Clock3}
            title="还没有生成任务"
            description="提交创作后，在这里查看生成进度。"
          />
        </div>
      )}
    </div>
  );
}
