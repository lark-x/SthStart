import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../../lib/cn';
import { PageHeaderIcon } from './page-header-icon';
import { PageGlobalActions } from './page-global-actions';

export interface PageHeaderProps extends Omit<React.ComponentPropsWithoutRef<'header'>, 'title'> {
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
  navigation?: React.ReactNode;
}

/**
 * 模块唯一顶栏：标题、子导航、当前对象状态与页面动作。
 * 接管全局搜索和任务入口后，AppShell 隐藏重复工具栏；主题仍由侧栏管理。
 */
export function PageHeader({
  title,
  description,
  backHref,
  backLabel = '返回',
  status,
  actions,
  className,
  compact = true,
  navigation,
  ...rest
}: PageHeaderProps) {
  return (
    <header className={cn('tpl-header', compact ? 'tpl-header-compact pb-1' : 'pb-2', className)} {...rest}>
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
        <div className="tpl-heading">
          <PageHeaderIcon compact={compact} />
          <div className="tpl-heading-text min-w-0">
            <h1 className={cn('tpl-title', compact && 'text-xl')}>{title}</h1>
            {description && (
              <details className="tpl-description-disclosure"><summary aria-label={`${title}使用说明`} title="使用说明">说明</summary><p className="tpl-description">{description}</p></details>
            )}
          </div>
        </div>
        {navigation && <div className="tpl-header-navigation">{navigation}</div>}

        {/* page-header-actions 保留为兼容类名：既有测试与样式仍按它定位动作区。 */}
        {(status || actions) && (
          <div className="tpl-actions page-header-actions">
            {status}
            {actions}
          </div>
        )}
        <PageGlobalActions />
      </div>
    </header>
  );
}
