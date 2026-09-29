import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon;
  symbol?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function EmptyState({
  icon: Icon,
  symbol,
  title,
  description,
  actions,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        // 空态自然收缩：有内容时紧凑，不强制占满屏幕高度。
        'flex min-h-[220px] flex-col items-center justify-center rounded-[var(--radius-panel)] bg-surface p-8 text-center shadow-[var(--shadow-panel)]',
        className
      )}
      {...props}
    >
      {Icon ? (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent">
          <Icon className="h-6 w-6" aria-hidden="true" />
        </div>
      ) : symbol ? (
        <span
          className="flex h-16 w-16 items-center justify-center rounded-full bg-ink text-paper text-2xl mb-4"
          aria-hidden="true"
        >
          {symbol}
        </span>
      ) : null}
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      {description && (
        <p className="mt-2 max-w-sm text-sm text-muted leading-relaxed">
          {description}
        </p>
      )}
      {actions && <div className="mt-6 flex flex-wrap gap-3 justify-center">{actions}</div>}
    </div>
  );
}
