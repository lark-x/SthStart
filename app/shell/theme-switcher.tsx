'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/app/providers/ui-provider';
import { cn } from '@/app/lib/cn';

export function ThemeSwitcher({ className }: { className?: string }) {
  const { colorMode, toggleColorMode } = useTheme();
  const dark = colorMode === 'dark';
  const label = dark ? '切换至日间模式' : '切换至夜间模式';
  const Icon = dark ? Sun : Moon;
  return (
    <button type="button" className={cn('shell-collapse-btn shell-color-mode-btn', className)}
      aria-label={label} title={label} data-nav-label={label} onClick={toggleColorMode}>
      <Icon className="shell-nav-icon" aria-hidden="true" />
      <span className="shell-nav-text">{label}</span>
    </button>
  );
}
