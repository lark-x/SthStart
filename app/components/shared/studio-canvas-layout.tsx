'use client';

import React from 'react';
import { cn } from '@/app/lib/cn';

interface StudioCanvasLayoutProps {
  /** 顶部微工具条或状态行 */
  header?: React.ReactNode;
  /** 左侧面板（如大纲树、资产列表、分镜目录） */
  sidebar?: React.ReactNode;
  /** 主画布区（居中或工作台核心内容） */
  children: React.ReactNode;
  /** 右侧属性检查器或辅助配置栏 */
  inspector?: React.ReactNode;
  /** 底部浮动操作条插槽 */
  floatingActions?: React.ReactNode;
  className?: string;
  sidebarWidth?: string;
  inspectorWidth?: string;
}

/**
 * 创作工坊视口锁高画布布局基元 (StudioCanvasLayout):
 * - 外层锁高 h-[calc(100vh-48px)] 与 overflow-hidden；
 * - 左右侧栏与主画布独立滚动计算；
 * - 顶栏微工具条与底栏浮动动作条解耦。
 */
export function StudioCanvasLayout({
  header,
  sidebar,
  children,
  inspector,
  floatingActions,
  className,
  sidebarWidth = '280px',
  inspectorWidth = '320px',
}: StudioCanvasLayoutProps) {
  return (
    <div
      className={cn(
        'relative flex h-[calc(100vh-var(--shell-topbar,48px))] h-[calc(100dvh-var(--shell-topbar,48px))] w-full flex-col overflow-hidden bg-paper select-text',
        className
      )}
    >
      {/* 顶部微工具条 */}
      {header && (
        <div className="shrink-0 border-b border-border-subtle bg-surface/90 px-4 py-2 backdrop-blur-md z-10">
          {header}
        </div>
      )}

      {/* 工作区三栏主体 */}
      <div className="relative flex flex-1 min-h-0 w-full overflow-hidden">
        {/* 左侧工作栏 */}
        {sidebar && (
          <aside
            style={{ width: sidebarWidth }}
            className="hidden lg:flex shrink-0 flex-col border-r border-border-subtle bg-surface overflow-y-auto"
          >
            {sidebar}
          </aside>
        )}

        {/* 核心主画布 */}
        <main className="relative flex-1 min-w-0 overflow-y-auto bg-paper">
          {children}

          {/* 浮动操作栏插槽 */}
          {floatingActions && (
            <div className="pointer-events-none sticky bottom-4 z-20 flex justify-center px-4">
              <div className="pointer-events-auto shadow-floating backdrop-blur-md">
                {floatingActions}
              </div>
            </div>
          )}
        </main>

        {/* 右侧属性检查器 */}
        {inspector && (
          <aside
            style={{ width: inspectorWidth }}
            className="hidden xl:flex shrink-0 flex-col border-l border-border-subtle bg-surface overflow-y-auto"
          >
            {inspector}
          </aside>
        )}
      </div>
    </div>
  );
}
