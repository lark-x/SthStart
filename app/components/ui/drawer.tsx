'use client';

import React, { useId, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useOverlayAccessibility } from './overlay';

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  position?: 'right' | 'bottom';
  className?: string;
}

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  position = 'right',
  className,
}: DrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  // 与 Dialog 共用焦点、滚动锁与关闭行为（§7.1/§7.3）；回调经 ref 稳定化，父级重渲染不重置弹层。
  useOverlayAccessibility({
    open,
    onRequestClose: () => onOpenChange(false),
    containerRef: drawerRef,
  });

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className="fixed inset-0 z-50 flex"
    >
      <div
        className="fixed inset-0 bg-ink/60 backdrop-blur-xs transition-opacity animate-in fade-in"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      <div
        ref={drawerRef}
        tabIndex={-1}
        className={cn(
          'relative z-50 flex flex-col bg-surface shadow-floating transition-transform',
          position === 'right' &&
            'ml-auto h-full w-full max-w-md border-l border-border-default p-6 animate-in slide-in-from-right',
          position === 'bottom' &&
            'mt-auto h-[80dvh] w-full rounded-t-2xl border-t border-border-default p-6 safe-area-bottom animate-in slide-in-from-bottom',
          className
        )}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 id={titleId} className="text-lg font-semibold text-ink">
              {title}
            </h3>
            {description && (
              <p id={descriptionId} className="text-sm text-muted leading-relaxed mt-1">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1.5 text-muted hover:text-ink hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="关闭抽屉"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* 抽屉同样在 portal 中，需显式声明滚动条自动隐藏。 */}
        <div className="flex-1 overflow-y-auto py-2" data-autohide-scroll>{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-3 pt-4 mt-auto border-t border-border-subtle">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
