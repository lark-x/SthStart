'use client';

import React, { useEffect, useRef } from 'react';
import { Tabs } from '@mantine/core';
import { cn } from '../../lib/cn';
import { useScrollFade } from './use-scroll-fade';

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
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useScrollFade(listRef, 'horizontal', 16);

  const revealTab = (tab: HTMLButtonElement | null) => {
    const list = listRef.current;
    if (!tab || !list) return;
    const listRect = list.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const padding = 16;
    let delta = 0;
    if (tabRect.left < listRect.left + padding) delta = tabRect.left - listRect.left - padding;
    else if (tabRect.right > listRect.right - padding) delta = tabRect.right - listRect.right + padding;
    if (delta !== 0) list.scrollTo({ left: list.scrollLeft + delta, behavior: 'auto' });
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      event.stopPropagation();
      return;
    }
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;

    const focused = event.target as HTMLElement;
    if (focused.getAttribute('role') !== 'tab') return;
    const selectable = tabs
      .map((tab, index) => ({ tab, index }))
      .filter(({ tab }) => !tab.disabled);
    if (selectable.length === 0) return;

    const focusedIndex = selectable.findIndex(({ index }) => tabRefs.current[index] === focused);
    const currentIndex = Math.max(0, focusedIndex >= 0 ? focusedIndex : selectable.findIndex(({ tab }) => tab.id === value));
    const target = event.key === 'Home'
      ? selectable[0]
      : event.key === 'End'
        ? selectable[selectable.length - 1]
        : selectable[(currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + selectable.length) % selectable.length];
    const targetButton = tabRefs.current[target.index];
    if (!targetButton) return;

    event.preventDefault();
    event.stopPropagation();
    targetButton.focus({ preventScroll: true });
    if (target.tab.id !== value) onChange(target.tab.id);
    revealTab(targetButton);
  };

  useEffect(() => {
    const index = tabs.findIndex((tab) => tab.id === value);
    if (index >= 0) revealTab(tabRefs.current[index]);
  }, [tabs, value]);

  return (
    <Tabs
        value={value}
        onChange={(next) => {
          if (next !== null) onChange(next);
        }}
        data-page-tabs-root=""
        className="block min-w-0 max-w-full"
      >
        <Tabs.List
          ref={listRef}
          aria-label={ariaLabel}
          data-scroll-fade="horizontal"
          data-variant={variant}
          className={cn('page-tabs', className)}
          onKeyDownCapture={handleTabKeyDown}
        >
          {tabs.map((tab, index) => {
            const selected = tab.id === value;
            return (
              <Tabs.Tab
                key={tab.id}
                ref={(node: HTMLButtonElement | null) => {
                  tabRefs.current[index] = node;
                }}
                value={tab.id}
                data-value={tab.id}
                disabled={tab.disabled}
                aria-controls={tab.panelId || undefined}
                tabIndex={!tab.disabled && (selected || (!tabs.some((item) => item.id === value && !item.disabled) && index === tabs.findIndex((item) => !item.disabled))) ? 0 : -1}
                onFocus={(event) => revealTab(event.currentTarget)}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium transition-colors duration-[var(--motion-fast)]',
                  selected
                    ? 'text-ink font-semibold'
                    : 'text-muted hover:text-ink',
                  tab.disabled && 'pointer-events-none opacity-50'
                )}
                rightSection={typeof tab.count === 'number' ? (
                  <span
                    className={cn(
                      'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs leading-5',
                      selected ? 'bg-surface-sunken text-ink' : 'bg-ink/8 text-muted'
                    )}
                  >
                    {tab.count}
                  </span>
                ) : undefined}
              >
                {tab.label}
              </Tabs.Tab>
            );
          })}
        </Tabs.List>
      </Tabs>
  );
}
