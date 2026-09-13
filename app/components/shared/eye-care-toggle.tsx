'use client';

import React from 'react';
import { Eye } from 'lucide-react';
import { useEyeCare } from '@/app/providers/ui-provider';
import { cn } from '@/app/lib/cn';

export function EyeCareToggle({ className }: { className?: string }) {
  const { eyeCare, toggleEyeCare } = useEyeCare();

  return (
    <button
      type="button"
      onClick={() => toggleEyeCare()}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 h-8 text-sm font-medium transition-colors cursor-pointer select-none rounded-md shrink-0',
        'w-8 sm:w-auto px-0 sm:px-2.5',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1',
        eyeCare
          ? 'bg-accent/12 text-accent-dark border border-accent/30 shadow-2xs font-semibold'
          : 'bg-surface hover:bg-surface-raised text-muted hover:text-ink border border-border-default shadow-2xs',
        className
      )}
      title={eyeCare ? '关闭暖杏护眼模式' : '开启暖杏护眼模式'}
      aria-label={eyeCare ? '关闭暖杏护眼模式' : '开启暖杏护眼模式'}
      aria-pressed={eyeCare}
    >
      <Eye className={cn('h-3.5 w-3.5 shrink-0', eyeCare ? 'text-accent-dark' : 'text-muted')} aria-hidden="true" />
      <span className="hidden sm:inline">{eyeCare ? '暖杏护眼' : '护眼'}</span>
    </button>
  );
}

