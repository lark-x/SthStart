'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Combobox, Modal, useCombobox } from '@mantine/core';
import { Search, X, CornerDownLeft } from 'lucide-react';
import { cn } from '../../lib/cn';
import { IconButton } from './icon-button';
import { Input } from './input';
import { OverlayFlexScrollArea, OverlayLayer, useModalFocusContainment, useOverlayEscapeLayer } from './overlay-policy';
import { useImeSafeHandlers } from './use-ime-safe-handlers';
import { useWebKitReturnFocus } from './use-webkit-return-focus';

export interface CommandItem {
  id: string;
  title: string;
  description?: string;
  category: string;
  keywords?: string[];
  icon?: React.ReactNode;
  shortcut?: string;
  action: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandItem[];
  invokerRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Mantine Modal + Combobox command palette.
 * Keeps IME composition guards, LIFO Escape ordering, WebKit return-focus,
 * and the existing ARIA / keyboard contracts without a custom focus trap.
 */
export function CommandPalette({ open, onOpenChange, items, invokerRef }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useModalFocusContainment(open, host);
  useWebKitReturnFocus(open, { invokerRef, containerRef: panelRef });
  useOverlayEscapeLayer(open, () => onOpenChange(false), 'palette');

  const combobox = useCombobox({
    opened: true,
    loop: true,
  });

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => {
      const matchTitle = item.title.toLowerCase().includes(needle);
      const matchDesc = item.description?.toLowerCase().includes(needle);
      const matchCat = item.category.toLowerCase().includes(needle);
      const matchKeywords = item.keywords?.some((k) => k.toLowerCase().includes(needle));
      return matchTitle || matchDesc || matchCat || matchKeywords;
    });
  }, [items, query]);

  const itemMap = useMemo(
    () => new Map(filteredItems.map((item) => [item.id, item])),
    [filteredItems],
  );

  useEffect(() => {
    if (!open) return;
    const resetTimer = window.setTimeout(() => {
      setQuery('');
    }, 0);
    const focusFrame = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      combobox.selectFirstOption();
    });
    return () => {
      window.clearTimeout(resetTimer);
      window.cancelAnimationFrame(focusFrame);
    };
    // Only reset when the palette opens; combobox store methods are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      if (filteredItems.length > 0) {
        combobox.selectFirstOption();
      } else {
        combobox.resetSelectedOption();
      }
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, filteredItems.length]);

  const runItem = (item: CommandItem) => {
    item.action();
    onOpenChange(false);
  };

  const imeHandlers = useImeSafeHandlers<HTMLInputElement>({
    onKeyDown: (event) => {
      if (event.defaultPrevented) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        combobox.selectNextOption();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        combobox.selectPreviousOption();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        combobox.clickSelectedOption();
      }
    },
  });

  return (
    <OverlayLayer kind="palette" host={host}>
      <Modal.Root
        opened={open}
        onClose={() => onOpenChange(false)}
        yOffset="15dvh"
        xOffset="1rem"
        size="36rem"
        withinPortal
        trapFocus
        lockScroll
        closeOnEscape={false}
        returnFocus={false}
        closeOnClickOutside
        padding={0}
        scrollAreaComponent={OverlayFlexScrollArea}
        transitionProps={{ duration: 120, transition: 'fade' }}
      >
        <Modal.Overlay />
        <Modal.Content
          ref={(node: HTMLElement | null) => {
            panelRef.current = node;
            setHost(node);
          }}
          aria-label="命令快捷菜单"
          data-state={open ? 'open' : 'closed'}
          classNames={{
            content:
              'relative flex max-h-[min(70dvh,32rem)] w-full flex-col overflow-hidden rounded-panel border border-border-subtle bg-surface shadow-dialog',
          }}
        >
          <Combobox
            store={combobox}
            withinPortal={false}
            onOptionSubmit={(val) => {
              const selected = itemMap.get(val);
              if (selected) runItem(selected);
            }}
          >
            <div data-command-header className="flex items-center gap-3 border-b border-border-subtle px-4 py-3 bg-surface">
              <Search className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
              <Combobox.EventsTarget withKeyboardNavigation={false}>
                <Input
                  ref={inputRef}
                  data-autofocus
                  aria-label="搜索命令"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onCompositionStart={imeHandlers.onCompositionStart}
                  onCompositionEnd={imeHandlers.onCompositionEnd}
                  onKeyDown={imeHandlers.onKeyDown}
                  placeholder="搜索应用、操作、角色或笔记… (↑↓ 导航, Enter 执行)"
                  className="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink shadow-none focus-visible:outline-none"
                />
              </Combobox.EventsTarget>
              {query && (
                <IconButton
                  icon={X}
                  label="清空输入"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setQuery('');
                    inputRef.current?.focus({ preventScroll: true });
                  }}
                  className="h-7 w-7 min-h-7 min-w-7 p-0 text-muted hover:text-ink"
                />
              )}
              <span className="text-sm uppercase font-bold tracking-widest text-muted bg-ink/6 px-2 py-0.5 rounded">
                ESC
              </span>
            </div>

            <div data-command-lining className="max-h-[380px] overflow-y-auto p-2" data-autohide-scroll>
              <Combobox.Options className="space-y-1 p-0">
                {filteredItems.length === 0 ? (
                  <Combobox.Empty className="py-10 text-center text-sm text-muted">
                    没有找到匹配项
                  </Combobox.Empty>
                ) : (
                  filteredItems.map((item, index) => (
                    <Combobox.Option
                      key={item.id}
                      value={item.id}
                      onMouseEnter={() => combobox.selectOption(index)}
                      className={cn(
                        'group flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors cursor-pointer text-ink hover:bg-ink/6 data-[combobox-selected]:bg-ink data-[combobox-selected]:text-paper',
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {item.icon ? (
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-ink/8 text-muted group-data-[combobox-selected]:bg-paper/15 group-data-[combobox-selected]:text-paper">
                            {item.icon}
                          </div>
                        ) : null}
                        <div className="min-w-0">
                          <div className="font-medium truncate">{item.title}</div>
                          {item.description && (
                            <div className="text-sm truncate mt-0.5 text-muted group-data-[combobox-selected]:text-paper/70">
                              {item.description}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-sm tracking-wider uppercase font-semibold px-2 py-0.5 rounded bg-ink/6 text-muted group-data-[combobox-selected]:bg-paper/20 group-data-[combobox-selected]:text-paper">
                          {item.category}
                        </span>
                        <CornerDownLeft
                          className="hidden h-3.5 w-3.5 opacity-80 group-data-[combobox-selected]:block"
                          aria-hidden="true"
                        />
                      </div>
                    </Combobox.Option>
                  ))
                )}
              </Combobox.Options>
            </div>
          </Combobox>
        </Modal.Content>
      </Modal.Root>
    </OverlayLayer>
  );
}
