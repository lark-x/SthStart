'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft, Menu, ListTodo } from 'lucide-react';
import { cn } from '@/app/lib/cn';
import { useGlobalTasks } from '@/app/features/tasks/queries';

export interface WorkspaceHeaderProps {
  title: string;
  backHref?: string;
  backLabel?: string;
  /** 保存/同步状态指示组件 */
  status?: React.ReactNode;
  /** 中部阶段或视图切换流 */
  centerSlot?: React.ReactNode;
  /** 右侧业务主操作按钮 */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * 全站通用的工作区顶栏原语：
 * 统一高度（桌面 56px / 移动端 48px），左侧返回与对象名称，中间流式切换，右侧导航、任务与业务操作。
 */
export function WorkspaceHeader({
  title,
  backHref,
  backLabel = '返回',
  status,
  centerSlot,
  actions,
  className,
}: WorkspaceHeaderProps) {
  const { data: globalTasksData } = useGlobalTasks({ state: 'active' });
  const activeTasksCount = globalTasksData?.activeCount ?? 0;

  const handleOpenNav = () => {
    window.dispatchEvent(new CustomEvent('sthstart:open-nav-drawer'));
  };

  const handleOpenTasks = () => {
    window.dispatchEvent(new CustomEvent('sthstart:open-task-drawer'));
  };

  return (
    <header
      className={cn(
        'min-h-12 sm:min-h-14 px-3 sm:px-4 py-1.5 shrink-0 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 border-b border-border-subtle/80 bg-surface/85 backdrop-blur-md shadow-xs select-none z-20',
        className
      )}
    >
      {/* 左侧：返回、标题、状态 */}
      <div className="flex flex-1 items-center gap-2 min-w-0">
        {backHref && (
          <Link
            href={backHref}
            className="inline-flex h-11 w-11 sm:h-9 sm:w-auto items-center justify-center gap-1.5 px-2.5 rounded-[var(--radius-control)] text-xs font-medium text-muted hover:text-ink hover:bg-surface-sunken transition-[background-color,color,transform] duration-150 active:scale-[0.98] shrink-0"
            aria-label={`返回${backLabel}`}
            title={`返回 ${backLabel}`}
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{backLabel}</span>
          </Link>
        )}

        <h1 className="text-sm sm:text-base font-bold text-ink truncate max-w-[200px] sm:max-w-[280px]" title={title}>
          {title}
        </h1>

        {status && <div className="hidden md:flex shrink-0 items-center">{status}</div>}
      </div>

      {/* 中间：视图或阶段切换流 */}
      {centerSlot && <div className="hidden md:flex items-center justify-center flex-1 min-w-0">{centerSlot}</div>}

      {/* 右侧：全局导航、全局任务、业务动作 */}
      <div className="flex max-w-full flex-wrap items-center justify-end gap-1.5 sm:gap-2 shrink-0">
        <button
          type="button"
          onClick={handleOpenNav}
          className="inline-flex h-11 w-11 sm:h-9 sm:w-auto items-center justify-center gap-1.5 px-2.5 rounded-[var(--radius-control)] border border-border-subtle/80 bg-surface text-xs font-medium text-ink hover:bg-surface-sunken hover:border-border-default active:scale-[0.98] shadow-xs transition-[background-color,border-color,color,transform] duration-150"
          title="全站导航"
          aria-label="打开全站导航"
        >
          <Menu className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
          <span className="hidden sm:inline">导航</span>
        </button>

        <button
          type="button"
          onClick={handleOpenTasks}
          className="relative inline-flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center rounded-[var(--radius-control)] border border-border-subtle/80 bg-surface text-ink hover:bg-surface-sunken hover:border-border-default active:scale-[0.98] shadow-xs transition-[background-color,border-color,color,transform] duration-150"
          title="全局任务抽屉"
          aria-label="打开全局任务抽屉"
        >
          <ListTodo className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          {activeTasksCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
            </span>
          )}
        </button>

        {actions}
      </div>
      {status && <div className="flex w-full min-w-0 items-center text-xs md:hidden">{status}</div>}
      {centerSlot && <div className="flex w-full min-w-0 overflow-x-auto md:hidden">{centerSlot}</div>}
    </header>
  );
}
