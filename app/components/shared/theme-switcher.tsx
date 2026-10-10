'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Sun, Moon, Check, ChevronDown } from 'lucide-react';
import { useTheme } from '@/app/providers/ui-provider';
import { THEMES, type ThemeId } from '@/app/lib/theme-preference';
import { cn } from '@/app/lib/cn';

interface ThemeSwitcherProps {
  className?: string;
  compact?: boolean;
  dropDirection?: 'up' | 'down';
  variant?: 'header' | 'sidebar';
}

export function ThemeSwitcher({
  className,
  compact = false,
  dropDirection = 'down',
  variant = 'header',
}: ThemeSwitcherProps) {
  const { themeId, colorMode, setThemeId, toggleColorMode } = useTheme();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click outside and Escape key listener
  useEffect(() => {
    if (!dropdownOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [dropdownOpen]);

  const activeTheme = THEMES.find((t) => t.id === themeId) ?? THEMES[0];
  const isDark = colorMode === 'dark';
  const isSidebar = variant === 'sidebar';

  // In collapsed sidebar: render a single 36px square toggle button
  if (compact) {
    return (
      <div className={cn('relative inline-flex items-center justify-center', className)} ref={containerRef}>
        <button
          type="button"
          onClick={toggleColorMode}
          className={cn(
            'relative inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
            isSidebar
              ? 'border border-nav-border bg-white/5 text-nav-muted hover:bg-white/10 hover:text-nav-foreground'
              : 'border border-border-default/70 bg-surface/70 text-muted hover:bg-surface-hover hover:text-ink'
          )}
          title={isDark ? `当前：${activeTheme.name}（点击切换日间）` : `当前：${activeTheme.name}（点击切换夜间）`}
          aria-label={isDark ? '切换至日间模式' : '切换至夜间模式'}
        >
          {isDark ? (
            <Sun className="h-4 w-4 text-warning-fg" aria-hidden="true" />
          ) : (
            <Moon className={cn('h-4 w-4', isSidebar ? 'text-nav-foreground' : 'text-ink')} aria-hidden="true" />
          )}
          {/* Active theme accent indicator dot */}
          <span
            className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full ring-1 ring-black/20 dark:ring-white/20"
            style={{ backgroundColor: activeTheme.accent }}
            aria-hidden="true"
          />
        </button>
      </div>
    );
  }

  return (
    <div className={cn('relative inline-flex items-center', className)} ref={containerRef}>
      <div
        className={cn(
          'flex items-center rounded-lg p-0.5 shadow-xs transition-colors',
          isSidebar
            ? 'w-full justify-between border border-nav-border bg-white/5'
            : 'border border-border-default/70 bg-surface/70 hover:border-border-default'
        )}
      >
        {/* Quick 1-click day/night toggle button */}
        <button
          type="button"
          onClick={toggleColorMode}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
            isSidebar
              ? 'text-nav-muted hover:bg-white/10 hover:text-nav-foreground'
              : 'text-muted hover:bg-surface-hover hover:text-ink'
          )}
          title={isDark ? '切换至日间模式' : '切换至夜间模式'}
          aria-label={isDark ? '切换至日间模式' : '切换至夜间模式'}
        >
          {isDark ? (
            <Sun className="h-3.5 w-3.5 text-warning-fg" aria-hidden="true" />
          ) : (
            <Moon className={cn('h-3.5 w-3.5', isSidebar ? 'text-nav-foreground' : 'text-ink')} aria-hidden="true" />
          )}
          {isSidebar && (
            <span className="text-[11px] font-medium tracking-tight">
              {isDark ? '夜间' : '日间'}
            </span>
          )}
        </button>

        {/* Palette dropdown toggle */}
        <button
          type="button"
          onClick={() => setDropdownOpen((prev) => !prev)}
          aria-expanded={dropdownOpen}
          aria-haspopup="menu"
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
            isSidebar
              ? 'text-nav-muted hover:bg-white/10 hover:text-nav-foreground'
              : 'text-muted hover:bg-surface-hover hover:text-ink',
            dropdownOpen && (isSidebar ? 'bg-white/10 text-nav-foreground' : 'bg-surface-hover text-ink')
          )}
          title="选择主题色彩"
          aria-label="选择主题色彩"
        >
          <span
            className="h-2 w-2 rounded-full ring-1 ring-black/10 dark:ring-white/20"
            style={{ backgroundColor: activeTheme.accent }}
            aria-hidden="true"
          />
          <span className="max-w-[90px] truncate text-[11px] tracking-tight">
            {activeTheme.name.split(' ')[0]}
          </span>
          <ChevronDown
            className={cn('h-3 w-3 opacity-60 transition-transform', dropdownOpen && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
      </div>

      {dropdownOpen && (
        <div
          role="menu"
          aria-label="主题色彩"
          className={cn(
            'absolute z-[var(--z-overlay)] w-64 overflow-hidden rounded-xl border border-border-default bg-surface/95 p-1.5 shadow-floating backdrop-blur-md animate-in fade-in zoom-in-95 text-ink',
            dropDirection === 'up'
              ? 'bottom-full mb-2 left-0 sm:left-auto sm:right-0'
              : 'top-full mt-1.5 right-0'
          )}
        >
          <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
            主题底色
          </div>

          <div className="space-y-1">
            {THEMES.map((theme) => {
              const isSelected = theme.id === themeId;
              return (
                <button
                  key={theme.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setThemeId(theme.id as ThemeId);
                    setDropdownOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors',
                    isSelected
                      ? 'bg-accent/10 text-ink font-medium'
                      : 'text-muted hover:bg-surface-hover hover:text-ink'
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {/* Visual Color Preview Swatch */}
                    <div
                      className="relative flex h-5 w-5 flex-none items-center justify-center rounded-full border border-border-strong/40 shadow-xs"
                      style={{ backgroundColor: theme.bg }}
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: theme.accent }}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-ink">
                        {theme.name}
                      </div>
                      <div className="truncate text-[10px] text-muted">
                        {theme.description}
                      </div>
                    </div>
                  </div>

                  {isSelected && (
                    <Check className="h-3.5 w-3.5 flex-none text-accent" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
