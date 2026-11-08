'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sun, Moon, Check, ChevronDown } from 'lucide-react';
import { useTheme } from '@/app/providers/ui-provider';
import { THEMES } from '@/app/lib/theme-preference';
import { cn } from '@/app/lib/cn';

interface ThemeSwitcherProps {
  className?: string;
  compact?: boolean;
  dropDirection?: 'up' | 'down';
  variant?: 'header' | 'sidebar';
}

export function ThemeSwitcher({ className, compact = false, dropDirection = 'down', variant = 'header' }: ThemeSwitcherProps) {
  const { themeId, colorMode, setThemeId, toggleColorMode } = useTheme();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<React.CSSProperties>({ visibility: 'hidden' });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const isDark = colorMode === 'dark';
  const activeTheme = THEMES.find(theme => theme.id === themeId) ?? THEMES[0];

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const positionMenu = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!rect || !menu) return;
      const width = Math.min(288, window.innerWidth - 16);
      const above = dropDirection === 'up' || rect.bottom + menu.offsetHeight + 8 > window.innerHeight;
      setPosition({
        width,
        left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
        top: Math.max(8, above ? rect.top - menu.offsetHeight - 8 : rect.bottom + 8),
        maxHeight: 'calc(100dvh - 16px)',
      });
    };
    positionMenu();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('focusin', onFocus);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('focusin', onFocus);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [open, dropDirection]);

  useEffect(() => {
    if (!open || position.visibility === 'hidden') return;
    menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [open, position.visibility]);

  const handleMenuKey = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length
      : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
  };

  return (
    <div className={cn('inline-flex min-w-0 items-center gap-1', variant === 'sidebar' && 'w-full', className)}>
      {!compact && (
        <button type="button" onClick={toggleColorMode} className={cn('shell-command-action', variant === 'header' && 'shell-theme-mode-toggle')} aria-label={isDark ? '切换至日间模式' : '切换至夜间模式'} title={isDark ? '切换至日间模式' : '切换至夜间模式'}>
          {isDark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
        </button>
      )}
      <button
        ref={triggerRef}
        type="button"
        className={cn('shell-command-action min-w-0', variant === 'sidebar' && !compact && 'flex-1')}
        aria-label={`选择主题与外观，当前${activeTheme.name}`}
        title={`外观：${activeTheme.name}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(value => !value)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
          if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); }
        }}
      >
        {compact ? (isDark ? <Moon className="h-4 w-4" aria-hidden="true" /> : <Sun className="h-4 w-4" aria-hidden="true" />) : (
          <>
            {variant === 'header' && <span className="sm:hidden" aria-hidden="true">{isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}</span>}
            <span className={cn('truncate', variant === 'header' && 'hidden sm:inline')}>{activeTheme.name}</span>
            <ChevronDown className={cn('h-4 w-4 flex-none', variant === 'header' && 'hidden sm:block')} aria-hidden="true" />
          </>
        )}
      </button>
      {open && createPortal(
        <div ref={menuRef} id={menuId} role="menu" aria-label="主题与外观" onKeyDown={handleMenuKey} style={position} className="fixed z-[var(--z-overlay)] overflow-y-auto rounded-panel border border-border-subtle bg-surface p-2 shadow-floating">
          <p className="px-2 py-2 text-xs font-medium text-muted">主题风格</p>
          {THEMES.map(theme => (
            <button key={theme.id} type="button" role="menuitemradio" aria-checked={theme.id === themeId} onClick={() => { setThemeId(theme.id); close(true); }} className="flex w-full items-center gap-3 rounded-control px-2 py-3 text-left text-sm text-ink hover:bg-surface-hover focus-visible:bg-surface-hover">
              <span className="flex h-6 w-8 flex-none overflow-hidden rounded border border-border-subtle" style={{ backgroundColor: theme.bg }} aria-hidden="true">
                <span className="h-full w-1/2" style={{ backgroundColor: theme.surface }} />
              </span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{theme.name}</span><span className="block text-xs text-muted">{theme.description}</span></span>
              {theme.id === themeId && <Check className="h-4 w-4 flex-none" aria-hidden="true" />}
            </button>
          ))}
          <button type="button" role="menuitem" onClick={toggleColorMode} className="mt-1 flex w-full items-center gap-3 rounded-control px-2 py-3 text-left text-sm text-ink hover:bg-surface-hover">
            {isDark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
            {isDark ? '切换至日间模式' : '切换至夜间模式'}
          </button>
        </div>, document.body,
      )}
    </div>
  );
}
