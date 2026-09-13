'use client';

import React, { useId, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useOverlayAccessibility } from './overlay';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** 宽度由显式 variant 控制（§7.1）：sm 适合短确认，md 默认，lg 适合复杂表单。 */
  size?: 'sm' | 'md' | 'lg';
  /** 危险确认等场景把首焦点交给特定控件（如取消按钮）；默认聚焦首个输入或容器。 */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  className?: string;
}

const sizeClassName: Record<NonNullable<DialogProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  initialFocusRef,
  className,
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useOverlayAccessibility({
    open,
    onRequestClose: () => onOpenChange(false),
    containerRef: dialogRef,
    initialFocusRef,
  });

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ink/60 backdrop-blur-xs transition-opacity animate-in fade-in"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      {/* Content */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={cn(
          'relative z-50 flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-[var(--radius-dialog)] border border-border-default bg-surface p-6 shadow-floating transition-colors focus:outline-none animate-in zoom-in-95',
          sizeClassName[size],
          className
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 mb-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-ink">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="text-sm text-muted leading-relaxed mt-1">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1.5 text-muted hover:text-ink hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="关闭对话框"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* 对话框渲染在 portal 里，不在外框作用域内，需要自己声明滚动条自动隐藏。 */}
        <div className="my-4 min-h-0 overflow-y-auto pr-1" data-autohide-scroll>{children}</div>

        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-3 mt-6 pt-4 border-t border-border-subtle">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
