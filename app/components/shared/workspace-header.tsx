'use client';


import React from 'react';
import { HeaderSlot } from './header-slots';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/app/lib/cn';

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
 * 导航与主操作优先保持单行；窄屏空间不足时可换行，避免挤掉标题和状态。
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
  return (
    <header
      className={cn(
        'workspace-header min-h-[var(--shell-topbar-mobile)] lg:min-h-[var(--shell-topbar)] px-2.5 sm:px-4 py-0 max-sm:flex-wrap max-sm:py-1 shrink-0 min-w-0 flex items-center gap-1.5 border-b border-border-subtle bg-surface select-none z-20',
        centerSlot && centerSlotOnMobile && 'max-md:flex-wrap',
        className
      )}
    >
      {/* 左侧：返回、标题、状态 */}
      <div className="flex flex-1 items-center gap-1.5 min-w-0 max-sm:basis-[max-content]">
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
        {titleSlot ? <div className="min-w-0 flex-1 [&_input]:max-md:h-7"><h1 className="sr-only">{title}</h1>{titleSlot}</div> : <h1 className="min-w-0 flex-1 wrap-anywhere sm:truncate font-sans text-[15px] sm:text-base font-semibold tracking-tight text-ink" title={title}>
          {title}
        </h1>}

        {status && <div className="min-w-0 text-xs leading-4 [&>*]:block [&>*]:max-w-full [&>*]:truncate md:shrink-0">{status}</div>}
        </div>
      </div>

      {/* 中间：视图或阶段切换流 */}
      {centerSlot && <div className="hidden md:flex items-center justify-center flex-1 min-w-0">{centerSlot}</div>}

      {/* 右侧：全局导航、全局任务、业务动作 */}
      <div className="flex min-w-0 shrink-0 items-center justify-end gap-0.5 max-sm:ms-auto max-sm:max-w-full max-sm:flex-wrap sm:gap-2">
        <HeaderSlot name="workspaceTools" />

        {actions && <div className="flex min-w-0 shrink-0 items-center justify-end gap-1 max-sm:max-w-full max-sm:flex-wrap sm:gap-2">{actions}</div>}
      </div>
      {centerSlot && centerSlotOnMobile && <div className="order-last basis-full flex min-w-0 overflow-x-auto pb-1 md:hidden">{centerSlot}</div>}
    </header>
  );
}
