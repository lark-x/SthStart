import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface PageHeaderProps {
  title: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  /** 当前对象的额外交付状态（如草稿/已发布/保存失败）。 */
  status?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  /** compact：工具栏式标题区，减少工作台页面的首屏占用。 */
  compact?: boolean;
}

/**
 * 页面标题区：只负责标题、返回、当前对象状态与页面动作。
 *
 * 全局应用切换与主题开关已上移到 AppShell；页面内不再重复放置全局工具。
 */
export function PageHeader({
  title,
  description,
  backHref,
  backLabel = '返回',
  status,
  actions,
  className,
  compact = false,
}: PageHeaderProps) {
  return (
    <header className={cn('tpl-header', compact ? 'pb-1' : 'pb-2', className)}>
      {backHref && (
        <Link
          href={backHref}
          className="inline-flex min-h-7 items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{backLabel}</span>
        </Link>
      )}

      <div className="tpl-header-main">
        <div className="min-w-0">
          <h1 className={cn('tpl-title', compact && 'text-xl')}>{title}</h1>
          {description && (
            <p className={cn('tpl-description mt-1', compact && 'line-clamp-2')}>
              {description}
            </p>
          )}
        </div>

        {/* page-header-actions 保留为兼容类名：既有测试与样式仍按它定位动作区。 */}
        <div className="tpl-actions page-header-actions">
          {status}
          {actions}
        </div>
      </div>
    </header>
  );
}
