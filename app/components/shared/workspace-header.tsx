'use client';

import { openCommandPalette } from './command-palette-events';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft, Menu, ListTodo, Search } from 'lucide-react';
import { cn } from '@/app/lib/cn';
import { useGlobalTasks } from '@/app/features/tasks/queries';

export interface WorkspaceHeaderProps {
  title: string;
  /** 行内标题编辑器；title 继续提供可访问名称。 */
  titleSlot?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  /** 保存/同步状态指示组件 */
  status?: React.ReactNode;
  /** 中部阶段或视图切换流 */
  centerSlot?: React.ReactNode;
  /** 中部切换在窄屏是否另起一行；默认收起，避免只有图标的页面留下空行。 */
  centerSlotOnMobile?: boolean;
  /** 右侧业务主操作按钮 */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * 全站通用的工作区顶栏原语：
 * 导航与主操作保持单行；窄屏保存状态位于标题下方，不能因紧凑布局被隐藏。
 */
export function WorkspaceHeader({
  title,
  titleSlot,
  backHref,
  backLabel = '返回',
  status,
  centerSlot,
  centerSlotOnMobile = false,
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
        'workspace-header min-h-[var(--shell-topbar-mobile)] lg:min-h-[var(--shell-topbar)] px-2.5 sm:px-4 py-0 shrink-0 min-w-0 flex items-center gap-1.5 border-b border-border-subtle bg-surface select-none z-20',
        centerSlot && centerSlotOnMobile && 'max-md:flex-wrap',
        className
      )}
    >
      {/* 左侧：返回、标题、状态 */}
      <div className="flex flex-1 items-center gap-1.5 min-w-0">
        {backHref && (
          <Link
            href={backHref}
            className="inline-flex h-10 w-10 sm:h-9 sm:w-auto items-center justify-center gap-1.5 px-2 sm:px-2.5 rounded-control text-sm font-medium text-muted hover:text-ink hover:bg-surface-sunken transition-[background-color,color,transform] duration-150 active:scale-[0.98] shrink-0"
            aria-label={backLabel.startsWith('返回') ? backLabel : `返回${backLabel}`}
            title={backLabel.startsWith('返回') ? backLabel : `返回 ${backLabel}`}
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{backLabel}</span>
          </Link>
        )}

        <div className="flex min-w-0 flex-1 flex-col justify-center md:flex-row md:items-center md:gap-3">
        {titleSlot ? <div className="min-w-0 flex-1 [&_input]:max-md:h-7"><h1 className="sr-only">{title}</h1>{titleSlot}</div> : <h1 className="min-w-0 flex-1 truncate font-sans text-[15px] sm:text-base font-semibold tracking-tight text-ink" title={title}>
          {title}
        </h1>}

        {status && <div className="min-w-0 text-xs leading-4 [&>*]:block [&>*]:max-w-full [&>*]:truncate md:shrink-0">{status}</div>}
        </div>
      </div>

      {/* 中间：视图或阶段切换流 */}
      {centerSlot && <div className="hidden md:flex items-center justify-center flex-1 min-w-0">{centerSlot}</div>}

      {/* 右侧：全局导航、全局任务、业务动作 */}
      <div className="flex min-w-0 shrink-0 items-center justify-end gap-0.5 sm:gap-2">
        <button
          type="button"
          onClick={handleOpenNav}
          className="inline-flex h-10 w-10 sm:h-9 sm:w-auto items-center justify-center gap-1.5 px-2 sm:px-2.5 rounded-control text-sm font-medium text-ink hover:bg-surface-sunken focus-visible:outline focus-visible:outline-accent transition-colors motion-reduce:transition-none"
          title="全站导航"
          aria-label="打开全站导航"
        >
          <Menu className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
          <span className="hidden xl:inline">导航</span>
        </button>

        <button
          type="button"
          onClick={() => openCommandPalette()}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control text-sm text-ink hover:bg-surface-sunken focus-visible:outline focus-visible:outline-accent transition-colors motion-reduce:transition-none"
          title="搜索与命令 (Ctrl/Cmd+K)"
          aria-label="搜索与命令"
        >
          <Search className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={handleOpenTasks}
          className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-sm text-ink hover:bg-surface-sunken focus-visible:outline focus-visible:outline-accent transition-colors motion-reduce:transition-none"
          title="全局任务抽屉"
          aria-label="打开全局任务抽屉"
        >
          <ListTodo className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
          {activeTasksCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-2 w-2">
              <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
            </span>
          )}
        </button>

        {actions && <div className="flex min-w-0 shrink-0 items-center justify-end gap-1 sm:gap-2">{actions}</div>}
      </div>
      {centerSlot && centerSlotOnMobile && <div className="order-last basis-full flex min-w-0 overflow-x-auto pb-1 md:hidden">{centerSlot}</div>}
    </header>
  );
}
