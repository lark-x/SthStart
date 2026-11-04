'use client';

import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/app/lib/cn';

export interface RowActionItem {
  label: React.ReactNode;
  icon?: React.ReactNode;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  hidden?: boolean;
  separatorBefore?: boolean;
}

export function RowActionsMenu({
  label,
  items,
  className,
}: {
  label: string;
  items: RowActionItem[];
  className?: string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const close = () => {
      if (detailsRef.current?.open) detailsRef.current.open = false;
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (detailsRef.current?.open && !detailsRef.current.contains(event.target as Node)) close();
    };
    const handleFocus = (event: FocusEvent) => {
      if (detailsRef.current?.open && !detailsRef.current.contains(event.target as Node)) close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !detailsRef.current?.open || event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        detailsRef.current.querySelector('summary')?.focus();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const buttons = [...detailsRef.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
      if (!buttons.length) return;
      event.preventDefault();
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : event.key === 'ArrowUp'
            ? (current <= 0 ? buttons.length - 1 : current - 1)
            : (current + 1) % buttons.length;
      buttons[next]?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('focusin', handleFocus);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('focusin', handleFocus);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <details ref={detailsRef} onToggle={event => setOpen(event.currentTarget.open)} className={cn('relative shrink-0', className)}>
      <summary
        role="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229 || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
          event.preventDefault();
          if (detailsRef.current) detailsRef.current.open = true;
          const items = detailsRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
          if (items?.length) items[event.key === 'ArrowUp' ? items.length - 1 : 0].focus();
        }}
        className="flex h-10 w-10 sm:h-9 sm:w-9 cursor-pointer list-none items-center justify-center rounded-[var(--radius-control)] text-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline focus-visible:outline-accent [&::-webkit-details-marker]:hidden"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </summary>
      <div
        role="menu"
        aria-label={label}
        className="absolute right-0 top-full z-40 mt-1 w-44 rounded-[var(--radius-control)] border border-border-subtle bg-surface p-1 shadow-floating"
        onClick={(event) => {
          if ((event.target as Element).closest('button')) {
            requestAnimationFrame(() => {
              if (detailsRef.current) detailsRef.current.open = false;
              if (document.activeElement === document.body || detailsRef.current?.contains(document.activeElement)) detailsRef.current?.querySelector('summary')?.focus();
            });
          }
        }}
      >
        {items.filter((item) => !item.hidden).map((item, index) => (
          <React.Fragment key={index}>
            {item.separatorBefore && <div className="my-1 h-px bg-border-subtle" />}
            <button
              type="button"
              role="menuitem"
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                item.tone === 'danger'
                  ? 'text-danger-fg hover:bg-danger/10'
                  : 'text-ink hover:bg-surface-hover'
              )}
              onClick={item.onSelect}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          </React.Fragment>
        ))}
      </div>
    </details>
  );
}
