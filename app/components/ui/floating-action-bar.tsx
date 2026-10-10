'use client';

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Button } from './button';

export interface FloatingActionBarProps {
  /** 是否显示浮动操作栏 */
  open: boolean;
  /** 已选数量 */
  selectedCount: number;
  /** 计数单位，默认 '项'，例如 '位角色'、'个活动' */
  unit?: string;
  /** 主操作按钮区（位于中间） */
  children?: React.ReactNode;
  /** 快捷选择操作（如全选本页、全不选） */
  selectionActions?: React.ReactNode;
  /** 清空所选回调 */
  onClear?: () => void;
  /** 关闭 / 退出选择模式回调 */
  onClose?: () => void;
  /** 自定义外层样式类名 */
  className?: string;
}

/**
 * 现代浮动操作栏（Floating Action Bar）：
 * 用于列表页批量管理、多选操作。
 * 在用户选择项目时平滑浮起于页面底部正中央，
 * 采用磨砂玻璃背景与清晰的视觉层级，支持键盘 Escape 快速退出。
 */
export function FloatingActionBar({
  open,
  selectedCount,
  unit = '项',
  children,
  selectionActions,
  onClear,
  onClose,
  className,
}: FloatingActionBarProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (onClose) onClose();
        else if (onClear) onClear();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose, onClear]);

  if (!open) return null;

  return (
    <div
      role="toolbar"
      aria-label="批量操作栏"
      className={cn(
        'fixed bottom-6 left-1/2 -translate-x-1/2 z-50',
        'flex max-w-[calc(100vw-2rem)] flex-wrap items-center justify-between gap-3',
        'rounded-full border border-border-default/80 bg-surface/92 px-4 py-2 sm:px-5 sm:py-2.5',
        'shadow-[0_12px_36px_-6px_rgba(0,0,0,0.18),0_4px_12px_-2px_rgba(0,0,0,0.1)]',
        'backdrop-blur-md backdrop-saturate-150',
        'animate-in fade-in slide-in-from-bottom-5 duration-200',
        className
      )}
    >
      {/* 计数指示 */}
      <div className="flex items-center gap-2 pr-1 text-sm font-medium text-ink">
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-accent/15 px-2 text-xs font-semibold text-accent">
          {selectedCount}
        </span>
        <span className="hidden whitespace-nowrap text-xs text-muted sm:inline">
          已选 {selectedCount} {unit}
        </span>
      </div>

      <div className="h-4 w-px bg-border-subtle" aria-hidden="true" />

      {/* 主业务操作群 */}
      {children && (
        <div className="flex items-center gap-2">
          {children}
        </div>
      )}

      {/* 辅助选择与退出操作 */}
      <div className="flex items-center gap-1.5 pl-1">
        {selectionActions}
        {onClear && selectedCount > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2.5 text-xs text-muted hover:text-ink"
            onClick={onClear}
          >
            清空
          </Button>
        )}
        {onClose && (
          <button
            type="button"
            aria-label="退出批量模式"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
