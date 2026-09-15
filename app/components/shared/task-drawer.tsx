'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Sparkles,
  RotateCcw,
  Square,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  ExternalLink,
  Layers,
  FileText,
  Camera,
  Globe,
  Lightbulb,
  Search,
  ListTodo,
} from 'lucide-react';
import type { TaskDomain, TaskSummary } from '@sthstart/contracts';
import { Drawer } from '@/app/components/ui/drawer';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Spinner } from '@/app/components/ui/spinner';
import { useGlobalTasks } from '@/app/features/tasks/queries';
import {
  useCancelGlobalTask,
  useRetryGlobalTask,
} from '@/app/features/tasks/mutations';

interface TaskDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

function domainIcon(domain: TaskDomain) {
  switch (domain) {
    case 'activity_media_batch':
      return <Layers className="h-3.5 w-3.5 text-sky-500" />;
    case 'activity_text':
      return <FileText className="h-3.5 w-3.5 text-indigo-500" />;
    case 'generation':
      return <Camera className="h-3.5 w-3.5 text-purple-500" />;
    case 'topic_collection':
      return <Globe className="h-3.5 w-3.5 text-emerald-500" />;
    case 'idea_generation':
      return <Lightbulb className="h-3.5 w-3.5 text-amber-500" />;
    case 'research':
      return <Search className="h-3.5 w-3.5 text-cyan-500" />;
    case 'planning':
      return <ListTodo className="h-3.5 w-3.5 text-teal-500" />;
    default:
      return <Sparkles className="h-3.5 w-3.5 text-accent" />;
  }
}

function domainLabel(domain: TaskDomain) {
  switch (domain) {
    case 'activity_media_batch':
      return '批量出图';
    case 'activity_text':
      return '剧情文本';
    case 'generation':
      return '单图生成';
    case 'topic_collection':
      return '话题素材';
    case 'idea_generation':
      return '灵感点子';
    case 'research':
      return '背景研究';
    case 'planning':
      return '企划方案';
    default:
      return '系统任务';
  }
}

export function TaskDrawer({ isOpen, onClose }: TaskDrawerProps) {
  const [tab, setTab] = useState<'all' | 'active' | 'recent'>('all');
  const { data, isLoading } = useGlobalTasks({
    state: tab,
  });

  const cancelMutation = useCancelGlobalTask();
  const retryMutation = useRetryGlobalTask();

  const tasks = data?.items || [];
  const activeCount = data?.activeCount ?? 0;

  return (
    <Drawer
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      title="全局任务中心"
    >
      <div className="space-y-4 py-2">
        {/* Header Tabs */}
        <div className="flex items-center justify-between border-b border-border-default pb-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTab('all')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                tab === 'all'
                  ? 'bg-accent/10 text-accent font-semibold'
                  : 'text-muted hover:text-ink hover:bg-surface-hover'
              }`}
            >
              全部任务
            </button>
            <button
              type="button"
              onClick={() => setTab('active')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1 ${
                tab === 'active'
                  ? 'bg-accent/10 text-accent font-semibold'
                  : 'text-muted hover:text-ink hover:bg-surface-hover'
              }`}
            >
              进行中
              {activeCount > 0 && (
                <span className="bg-accent text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                  {activeCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setTab('recent')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                tab === 'recent'
                  ? 'bg-accent/10 text-accent font-semibold'
                  : 'text-muted hover:text-ink hover:bg-surface-hover'
              }`}
            >
              最近完成
            </button>
          </div>

          <div className="text-xs text-muted">
            {activeCount > 0 ? (
              <span className="text-sky-600 flex items-center gap-1">
                <Spinner className="h-3 w-3" />
                {activeCount} 个任务运行中
              </span>
            ) : (
              '无活跃任务'
            )}
          </div>
        </div>

        {/* Task List */}
        {isLoading && tasks.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted flex flex-col items-center gap-2">
            <Spinner className="h-5 w-5 text-accent" />
            <span>加载任务记录中…</span>
          </div>
        ) : tasks.length === 0 ? (
          <div className="p-12 text-center text-xs text-muted space-y-1">
            <ListTodo className="h-8 w-8 mx-auto text-fg-subtle opacity-50" />
            <p>暂无符合筛选的任务记录</p>
            <p className="text-[11px] text-muted">
              在活动工作室发起生成或采集任务时，将在此处实时汇总追踪。
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => {
              const isRunning = task.displayState === 'running';
              const isWaiting = task.displayState === 'waiting';
              const isSucceeded = task.displayState === 'succeeded';
              const isFailed = task.displayState === 'failed';
              const isPartial = task.displayState === 'partial';
              const isStopped = task.displayState === 'stopped';

              return (
                <div
                  key={`${task.domain}_${task.taskId}`}
                  className="p-3 rounded-lg border border-border-default bg-surface hover:border-border-strong transition-all space-y-2.5 shadow-2xs"
                >
                  {/* Top line: domain badge, title, status */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-surface-raised border border-border-default">
                          {domainIcon(task.domain)}
                          <span>{domainLabel(task.domain)}</span>
                        </span>
                        <span className="text-xs font-semibold text-ink truncate">
                          {task.title}
                        </span>
                      </div>

                      {task.detail && (
                        <p className="text-xs text-muted leading-relaxed truncate">
                          {task.detail}
                        </p>
                      )}
                    </div>

                    {/* Status Badge */}
                    <div className="flex-shrink-0">
                      {isRunning && (
                        <Badge variant="outline" className="text-[10px] bg-sky-50 text-sky-700 border-sky-300 flex items-center gap-1">
                          <Spinner className="h-2.5 w-2.5" />
                          处理中
                        </Badge>
                      )}
                      {isWaiting && (
                        <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-300 flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" />
                          排队中
                        </Badge>
                      )}
                      {isSucceeded && (
                        <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300 flex items-center gap-1">
                          <CheckCircle2 className="h-2.5 w-2.5" />
                          已完成
                        </Badge>
                      )}
                      {isPartial && (
                        <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-300 flex items-center gap-1">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          部分成功
                        </Badge>
                      )}
                      {isFailed && (
                        <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 border-rose-300 flex items-center gap-1">
                          <XCircle className="h-2.5 w-2.5" />
                          失败
                        </Badge>
                      )}
                      {isStopped && (
                        <Badge variant="outline" className="text-[10px] bg-slate-50 text-slate-700 border-slate-300 flex items-center gap-1">
                          <Square className="h-2.5 w-2.5" />
                          已停止
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Progress bar if progress exists */}
                  {task.progress && task.progress.total > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-muted">
                        <span>进度: {task.progress.completed} / {task.progress.total} {task.progress.unit}</span>
                        <span>{Math.round((task.progress.completed / task.progress.total) * 100)}%</span>
                      </div>
                      <div className="w-full bg-border-subtle rounded-full h-1 overflow-hidden">
                        <div
                          className="bg-accent h-full transition-all duration-300"
                          style={{ width: `${Math.round((task.progress.completed / task.progress.total) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Bottom bar: timestamp and actions */}
                  <div className="flex items-center justify-between pt-1 border-t border-border-subtle text-[11px] text-muted">
                    <span>{new Date(task.createdAt).toLocaleTimeString()}</span>

                    <div className="flex items-center gap-2">
                      {task.capabilities.cancel && (
                        <button
                          type="button"
                          disabled={cancelMutation.isPending}
                          onClick={() => cancelMutation.mutate({ domain: task.domain, taskId: task.taskId })}
                          className="text-rose-600 hover:text-rose-700 font-medium flex items-center gap-0.5 transition-colors"
                        >
                          <Square className="h-2.5 w-2.5" />
                          取消
                        </button>
                      )}

                      {task.capabilities.retry && (
                        <button
                          type="button"
                          disabled={retryMutation.isPending}
                          onClick={() => retryMutation.mutate({ domain: task.domain, taskId: task.taskId })}
                          className="text-sky-600 hover:text-sky-700 font-medium flex items-center gap-0.5 transition-colors"
                        >
                          <RotateCcw className="h-2.5 w-2.5" />
                          重试
                        </button>
                      )}

                      <Link
                        href={task.targetUrl}
                        onClick={onClose}
                        className="text-accent hover:underline flex items-center gap-0.5 font-medium"
                      >
                        查看结果
                        <ExternalLink className="h-2.5 w-2.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Drawer>
  );
}
