import React from 'react';
import { cn } from '../../lib/cn';

/**
 * 四类页面模板的布局原语。只负责容器宽度、内边距、栅格与滚动，不接管业务状态。
 *
 * 宽度变体：
 *   - wide（默认）：浏览与媒体，最大 1600px
 *   - settings：配置类页面，最大 1120px
 *   - reading：正文阅读，行宽受控
 *
 * 所有栅格单元显式 min-w-0，避免长内容把列撑宽。
 */

export type PageWidth = 'wide' | 'settings' | 'reading';

export function PageContainer({
  width = 'wide',
  className,
  children,
  ...rest
}: React.ComponentProps<'div'> & { width?: PageWidth }) {
  return (
    <div
      className={cn(
        'tpl-container',
        width === 'settings' && 'tpl-settings',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** 正文阅读容器：限制行宽，保持 16px 以上的正文与稳定行距。 */
export function ReadingContainer({ className, children, ...rest }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('mx-auto w-full max-w-[var(--shell-reading)] px-4 sm:px-6', className)} {...rest}>
      {children}
    </div>
  );
}

/**
 * WorkspacePage：对象编辑与生成工作台。
 * 主区 + 可选辅助栏；小于 1280px 单栏，辅助栏由调用方决定是否转抽屉。
 */
export function WorkbenchColumns({
  left,
  right,
  className,
  leftClassName,
  rightClassName,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  className?: string;
  leftClassName?: string;
  rightClassName?: string;
}) {
  return (
    <div className={cn('grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]', className)}>
      <div className={cn('min-w-0 space-y-4', leftClassName)}>{left}</div>
      <div className={cn('min-w-0 space-y-4', rightClassName)}>{right}</div>
    </div>
  );
}

/**
 * SidebarColumns：主区 + 辅助栏，小于 1280px 单栏。
 * sidebarFirst 时 DOM 直接先渲染侧栏（小屏视觉与键盘顺序一致），
 * 桌面用显式 col-start/row-start 恢复 main 左、sidebar 右。
 */
export function SidebarColumns({
  main,
  sidebar,
  className,
  mainClassName,
  sidebarClassName,
  sidebarFirst = false,
  asideWidth = 'var(--shell-aside)',
}: {
  main: React.ReactNode;
  sidebar: React.ReactNode;
  className?: string;
  mainClassName?: string;
  sidebarClassName?: string;
  sidebarFirst?: boolean;
  asideWidth?: string;
}) {
  const gridClassName = cn(
    'grid min-w-0 grid-cols-1 items-start gap-4',
    sidebarFirst ? 'xl:grid-cols-[minmax(0,1fr)_360px]' : 'xl:grid-cols-[minmax(0,1fr)_360px]',
    className
  );
  void asideWidth;
  if (sidebarFirst) {
    return (
      <div className={gridClassName}>
        <div className={cn('min-w-0 xl:col-start-2 xl:row-start-1', sidebarClassName)}>{sidebar}</div>
        <div className={cn('min-w-0 xl:col-start-1 xl:row-start-1', mainClassName)}>{main}</div>
      </div>
    );
  }
  return (
    <div className={gridClassName}>
      <div className={cn('min-w-0', mainClassName)}>{main}</div>
      <div className={cn('min-w-0', sidebarClassName)}>{sidebar}</div>
    </div>
  );
}

/** BrowsePage：筛选工具栏与常用操作共用，空间不足自然换行。 */
export function Toolbar({ className, children, ...rest }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'tpl-toolbar rounded-[var(--radius-panel)] border border-border-subtle bg-surface px-3 py-2',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** 自适应卡片网格：auto-fill，最小 240px；使用 min(100%,240px) 防止手机视口溢出。 */
export function CardGrid({ className, children, ...rest }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))]', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

/** 标准内容面板：外层工作表面，组内靠间距与分隔线组织，不叠加多层卡片。 */
export function Panel({ className, children, ...rest }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('tpl-panel', className)} {...rest}>
      {children}
    </div>
  );
}

