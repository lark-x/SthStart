'use client';

import React, { useRef } from 'react';
import { cn } from '../../lib/cn';

export interface PageTab {
  id: string;
  label: React.ReactNode;
  /** 可选的数量徽标（如筛选结果数）。 */
  count?: number;
  disabled?: boolean;
  /** 同页面板切换时由调用方为 panel 提供 id，这里建立 aria 关联。 */
  panelId?: string;
}

export interface PageTabsProps {
  tabs: PageTab[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * 页面级 tabs（§7.2）：tablist/tab 语义与方向键移动；
 * 真正导航到新页面时请使用链接语义，不要用 tabs 模拟页面跳转。
 */
export function PageTabs({ tabs, value, onChange, ariaLabel, className }: PageTabsProps) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusAndSelect = (index: number) => {
    const tab = tabs[index];
    if (!tab || tab.disabled) return;
    onChange(tab.id);
    tabRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const selectable = tabs.map((tab, index) => ({ tab, index })).filter(({ tab }) => !tab.disabled);
    if (selectable.length === 0) return;
    const currentIndex = selectable.findIndex(({ tab }) => tab.id === value);
    let target: number | null = null;

    if (event.key === 'ArrowRight') {
      target = selectable[(currentIndex + 1 + selectable.length) % selectable.length].index;
    } else if (event.key === 'ArrowLeft') {
      target = selectable[(currentIndex - 1 + selectable.length) % selectable.length].index;
    } else if (event.key === 'Home') {
      target = selectable[0].index;
    } else if (event.key === 'End') {
      target = selectable[selectable.length - 1].index;
    }

    if (target !== null) {
      event.preventDefault();
      focusAndSelect(target);
    }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cn('page-tabs inline-flex max-w-full flex-wrap items-center gap-1 rounded-[var(--radius-panel)] bg-surface-muted p-1', className)}
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={tab.panelId}
            tabIndex={selected ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              selected
                ? 'bg-surface text-ink shadow-xs'
                : 'text-muted hover:bg-surface-hover hover:text-ink',
              tab.disabled && 'pointer-events-none opacity-50'
            )}
          >
            {tab.label}
            {typeof tab.count === 'number' && (
              <span
                className={cn(
                  'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs leading-5',
                  selected ? 'bg-accent/12 text-accent-dark' : 'bg-ink/8 text-muted'
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
