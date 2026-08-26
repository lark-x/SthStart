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
        className="fixed inset-0 bg-[#18201d]/60 backdrop-blur-xs transition-opacity animate-in fade-in"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      <div
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="relative z-50 w-full max-w-xl overflow-hidden rounded-[4px_24px_4px_4px] border border-[rgb(24_32_29/18%)] bg-[#fffdf8] shadow-2xl animate-in zoom-in-95"
      >
        <div className="flex items-center gap-3 border-b border-[rgb(24_32_29/12%)] px-4 py-3 bg-[#fffdf8]">
          <Search className="h-5 w-5 text-[#68716d]" aria-hidden="true" />
          <input
            ref={inputRef}
            aria-label="搜索命令"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="搜索应用、操作、角色或笔记… (↑↓ 导航, Enter 执行)"
            className="flex-1 bg-transparent text-sm text-[#18201d] placeholder:text-[#68716d]/70 outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSelectedIndex(0);
              }}
              className="p-1 text-[#68716d] hover:text-[#18201d]"
              aria-label="清空输入"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <span className="text-[10px] uppercase font-bold tracking-widest text-[#68716d] bg-[rgb(24_32_29/6%)] px-2 py-0.5 rounded">
            ESC
          </span>
        </div>

        <div className="max-h-[380px] overflow-y-auto p-2">
          {filteredItems.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#68716d]">
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
                        ? 'bg-[#18201d] text-[#f4f0e7]'
                        : 'text-[#18201d] hover:bg-[rgb(24_32_29/6%)]'
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {item.icon ? (
                        <div
                          className={cn(
                            'flex h-7 w-7 items-center justify-center rounded',
                            isSelected
                              ? 'bg-[#f4f0e7]/15 text-[#f4f0e7]'
                              : 'bg-[rgb(24_32_29/8%)] text-[#68716d]'
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
                              'text-xs truncate mt-0.5',
                              isSelected ? 'text-[#f4f0e7]/70' : 'text-[#68716d]'
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
                          'text-[10px] tracking-wider uppercase font-semibold px-2 py-0.5 rounded',
                          isSelected
                            ? 'bg-[#f4f0e7]/20 text-[#f4f0e7]'
                            : 'bg-[rgb(24_32_29/6%)] text-[#68716d]'
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
