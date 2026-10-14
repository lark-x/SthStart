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
        // 空态自然收缩：带有精致纸片边框与微妙内衬层次
        'flex min-h-[220px] flex-col items-center justify-center rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-8 text-center shadow-[var(--shadow-panel)]',
        className
      )}
      {...props}
    >
      {Icon ? (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-accent/15 bg-accent-soft text-accent shadow-xs">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      ) : symbol ? (
        <span
          className="flex h-14 w-14 items-center justify-center rounded-full bg-ink text-paper text-xl mb-4"
          aria-hidden="true"
        >
          {symbol}
        </span>
      ) : null}
      <h3 className="font-sans text-base font-semibold tracking-tight text-ink">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-md text-sm text-muted leading-relaxed">
          {description}
        </p>
      )}
      {actions && <div className="mt-5 flex flex-wrap gap-2.5 justify-center">{actions}</div>}
    </div>
  );
}
