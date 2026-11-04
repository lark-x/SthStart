'use client';

import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

interface StudioMenuProps {
  label: string;
  summaryContent?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** 工作台内的上下文菜单：点外部或按 Escape 关闭，并把焦点还给触发器。 */
export function StudioMenu({ label, summaryContent, children, className = '' }: StudioMenuProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      const element = ref.current;
      if (!element?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.isComposing || event.keyCode === 229 || event.key !== 'Escape') return;
        element.open = false;
        element.querySelector('summary')?.focus();
      } else if (!element.contains(event.target as Node)) {
        element.open = false;
      }
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', dismiss);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', dismiss);
    };
  }, []);

  return (
    <details ref={ref} onToggle={event => setOpen(event.currentTarget.open)} className={`relative ${className}`}
      onKeyDown={event => {
        if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        if (ref.current) ref.current.open = true;
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])].filter(item => item.getClientRects().length);
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowUp' ? (current <= 0 ? items.length - 1 : current - 1) : (current + 1) % items.length;
        items[next]?.focus();
      }}>
      <summary
        role="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        className="flex h-9 cursor-pointer list-none items-center justify-center gap-1 rounded-[var(--radius-control)] px-2 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline focus-visible:outline-accent motion-reduce:transition-none"
      >
        {summaryContent ?? <MoreHorizontal className="size-4" aria-hidden="true" />}
      </summary>
      <div
        role="menu"
        aria-label={label}
        className="absolute right-0 top-full z-30 mt-2 flex w-52 flex-col gap-0.5 rounded-[var(--radius-control)] border border-border-subtle bg-surface p-1.5 shadow-lg"
      >
        {children}
      </div>
    </details>
  );
}

interface StudioMenuItemProps {
  children: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
}

export function StudioMenuItem({ children, onSelect, danger = false, disabled = false, className = '' }: StudioMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={(event) => {
        event.currentTarget.closest('details')?.removeAttribute('open');
        onSelect();
      }}
      className={`flex h-9 w-full items-center rounded-[var(--radius-control)] px-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        danger ? 'text-danger-fg hover:bg-danger-bg' : 'text-ink hover:bg-surface-hover'
      } ${className}`}
    >
      {children}
    </button>
  );
}
