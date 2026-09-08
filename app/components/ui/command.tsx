'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, CornerDownLeft } from 'lucide-react';
import { cn } from '../../lib/cn';

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
}

export function CommandPalette({ open, onOpenChange, items }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

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

  useEffect(() => {
    if (!open) return;

    previousFocus.current = document.activeElement as HTMLElement;
    const focusTimer = window.setTimeout(() => {
      setQuery('');
      setSelectedIndex(0);
      inputRef.current?.focus();
    }, 50);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onOpenChange(false);
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, input, [href], [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((element) => !element.hasAttribute('disabled'));
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
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
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      previousFocus.current?.focus();
      previousFocus.current = null;
    };
  }, [open, onOpenChange]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const selected = filteredItems[selectedIndex];
      if (selected) {
        selected.action();
        onOpenChange(false);
      }
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="命令快捷菜单"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
    >
      <div
        className="fixed inset-0 bg-ink/60 backdrop-blur-xs transition-opacity animate-in fade-in"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      <div
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="relative z-50 w-full max-w-xl overflow-hidden rounded-[4px_24px_4px_4px] border border-[rgb(24_32_29/18%)] bg-surface shadow-2xl animate-in zoom-in-95"
      >
        <div className="flex items-center gap-3 border-b border-[rgb(24_32_29/12%)] px-4 py-3 bg-surface">
          <Search className="h-5 w-5 text-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            aria-label="搜索命令"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="搜索应用、操作、角色或笔记… (↑↓ 导航, Enter 执行)"
            className="flex-1 bg-transparent text-sm text-ink placeholder:text-muted/70 outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSelectedIndex(0);
              }}
              className="p-1 text-muted hover:text-ink"
              aria-label="清空输入"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <span className="text-sm uppercase font-bold tracking-widest text-muted bg-[rgb(24_32_29/6%)] px-2 py-0.5 rounded">
            ESC
          </span>
        </div>

        <div className="max-h-[380px] overflow-y-auto p-2">
          {filteredItems.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted">
              没有找到匹配项
            </div>
          ) : (
            <div className="space-y-1">
              {filteredItems.map((item, index) => {
                const isSelected = index === selectedIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      item.action();
                      onOpenChange(false);
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors cursor-pointer',
                      isSelected
                        ? 'bg-ink text-paper'
                        : 'text-ink hover:bg-[rgb(24_32_29/6%)]'
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {item.icon ? (
                        <div
                          className={cn(
                            'flex h-7 w-7 items-center justify-center rounded',
                            isSelected
                              ? 'bg-paper/15 text-paper'
                              : 'bg-[rgb(24_32_29/8%)] text-muted'
                          )}
                        >
                          {item.icon}
                        </div>
                      ) : null}
                      <div className="min-w-0">
                        <div className="font-medium truncate">{item.title}</div>
                        {item.description && (
                          <div
                            className={cn(
                              'text-sm truncate mt-0.5',
                              isSelected ? 'text-paper/70' : 'text-muted'
                            )}
                          >
                            {item.description}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span
                        className={cn(
                          'text-sm tracking-wider uppercase font-semibold px-2 py-0.5 rounded',
                          isSelected
                            ? 'bg-paper/20 text-paper'
                            : 'bg-[rgb(24_32_29/6%)] text-muted'
                        )}
                      >
                        {item.category}
                      </span>
                      {isSelected && (
                        <CornerDownLeft className="h-3.5 w-3.5 opacity-80" aria-hidden="true" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
