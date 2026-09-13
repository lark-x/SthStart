'use client';

import React from 'react';
import { AlertCircle, CloudOff, PackageOpen, SearchX } from 'lucide-react';
import { cn } from '../../lib/cn';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

export type AsyncStateStatus = 'loading' | 'error' | 'empty' | 'no-results' | 'offline';

export interface AsyncStateProps {
  status: AsyncStateStatus;
  title?: string;
  description?: string;
  /** 首要动作（如“新建角色”“清除筛选”），由页面按业务语义提供。 */
  action?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  /** loading 骨架行数。 */
  rows?: number;
  className?: string;
}

const DEFAULT_COPY: Record<Exclude<AsyncStateStatus, 'loading' | 'error'>, { title: string; description: string }> = {
  empty: { title: '还没有内容', description: '创建第一条内容开始使用' },
  'no-results': { title: '没有匹配的结果', description: '试试调整或清除筛选条件' },
  offline: { title: '当前处于离线状态', description: '网络恢复后即可继续同步' },
};

/**
 * 共享异步状态呈现（§7.2/§8.1）：loading/error/empty/no-results/offline。
 * 只负责视觉与基本交互，不接管业务请求；动作按钮由调用方提供。
 */
export function AsyncState({
  status,
  title,
  description,
  action,
  onRetry,
  retryLabel = '重试',
  rows = 3,
  className,
}: AsyncStateProps) {
  if (status === 'loading') {
    return (
      <div
        className={cn('flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface/60 p-6', className)}
        aria-busy="true"
      >
        <span className="sr-only">加载中</span>
        <Skeleton className="h-6 w-1/3" />
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        role="alert"
        className={cn(
          'flex flex-col gap-3 rounded-lg border border-danger-border bg-danger-bg p-4 text-sm leading-relaxed text-danger-fg sm:flex-row sm:items-start sm:justify-between',
          className
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold">{title ?? '加载失败'}</p>
            {description && <p className="mt-1 text-[13px] break-words">{description}</p>}
          </div>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="flex-shrink-0 inline-flex h-9 items-center justify-center rounded-lg border border-danger-border bg-surface px-3 text-sm font-medium text-danger-fg transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {retryLabel}
          </button>
        )}
      </div>
    );
  }

  const icons = { empty: PackageOpen, 'no-results': SearchX, offline: CloudOff } as const;
  const copy = DEFAULT_COPY[status];
  const Icon = icons[status];

  return (
    <EmptyState
      icon={Icon}
      title={title ?? copy.title}
      description={
        description !== undefined ? description : copy.description
      }
      className={className}
      actions={action}
    />
  );
}
