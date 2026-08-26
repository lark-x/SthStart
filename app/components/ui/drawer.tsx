'use client';

import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

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
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (open) {
      previousFocus.current = document.activeElement as HTMLElement;
      const firstFocusable = drawerRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      firstFocusable?.focus();

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onOpenChange(false);
          return;
        }

        if (event.key === 'Tab') {
          const focusable = Array.from(
            drawerRef.current?.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            ) ?? []
          ).filter((element) => !element.hasAttribute('disabled'));
          if (focusable.length === 0) {
            event.preventDefault();
            drawerRef.current?.focus();
            return;
          }

          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';

      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = '';
        previousFocus.current?.focus();
        previousFocus.current = null;
      };
    }
  }, [open, onOpenChange]);

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
        className="fixed inset-0 bg-[#18201d]/60 backdrop-blur-xs transition-opacity animate-in fade-in"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      <div
        ref={drawerRef}
        tabIndex={-1}
        className={cn(
          'relative z-50 flex flex-col bg-[#fffdf8] shadow-2xl transition-transform',
          position === 'right' &&
            'ml-auto h-full w-full max-w-md border-l border-[rgb(24_32_29/16%)] p-6 animate-in slide-in-from-right',
          position === 'bottom' &&
            'mt-auto h-[80dvh] w-full rounded-t-2xl border-t border-[rgb(24_32_29/16%)] p-6 safe-area-bottom animate-in slide-in-from-bottom',
          className
        )}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 id={titleId} className="font-serif text-2xl font-medium text-[#18201d]">
              {title}
            </h3>
            {description && (
              <p id={descriptionId} className="text-xs text-[#68716d] leading-relaxed mt-1">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1.5 text-[#68716d] hover:text-[#18201d] hover:bg-[rgb(24_32_29/6%)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e45d35]"
            aria-label="关闭抽屉"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-2">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-3 pt-4 mt-auto border-t border-[rgb(24_32_29/10%)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
