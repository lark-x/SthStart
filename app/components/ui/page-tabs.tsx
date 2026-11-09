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
  /** page：页面视图；local：工作台步骤或面板内切换。 */
  variant?: 'page' | 'local';
}

/**
 * 页面与局部 tabs：共享 tablist/tab 语义、方向键与输入法保护；
 * 真正导航到新页面时请使用链接语义，不要用 tabs 模拟页面跳转。
 */
export function PageTabs({ tabs, value, onChange, ariaLabel, className, variant = 'page' }: PageTabsProps) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusAndSelect = (index: number) => {
    const tab = tabs[index];
    if (!tab || tab.disabled) return;
    onChange(tab.id);
    tabRefs.current[index]?.focus();
    tabRefs.current[index]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const selectable = tabs.map((tab, index) => ({ tab, index })).filter(({ tab }) => !tab.disabled);
    if (selectable.length === 0) return;
    const focusedIndex = selectable.findIndex(({ index }) => tabRefs.current[index] === event.target);
    const currentIndex = Math.max(0, focusedIndex >= 0 ? focusedIndex : selectable.findIndex(({ tab }) => tab.id === value));
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
      aria-orientation="horizontal"
      data-variant={variant}
      onKeyDown={handleKeyDown}
      className={cn(
        'page-tabs',
        className
      )}
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
            tabIndex={!tab.disabled && (selected || (!tabs.some((item) => item.id === value && !item.disabled) && index === tabs.findIndex((item) => !item.disabled))) ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            onFocus={(event) => event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium transition-colors duration-[var(--motion-fast)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1',
              selected
                ? 'text-ink font-semibold'
                : 'text-muted hover:text-ink',
              tab.disabled && 'pointer-events-none opacity-50'
            )}
          >
            {tab.label}
            {typeof tab.count === 'number' && (
              <span
                className={cn(
                  'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs leading-5',
                  selected ? 'bg-surface-sunken text-ink' : 'bg-ink/8 text-muted'
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
