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
        'flex min-h-40 flex-col items-center justify-center px-5 py-8 text-center',
        className
      )}
      {...props}
    >
      {Icon ? (
        <div className="mb-3 grid size-9 place-items-center rounded-control bg-surface-sunken text-muted">
          <Icon className="size-[18px]" aria-hidden="true" />
        </div>
      ) : symbol ? (
        <span
          className="mb-3 grid size-9 place-items-center rounded-control bg-surface-sunken text-muted"
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
      {actions && <div className="mt-4 flex flex-wrap gap-2 justify-center">{actions}</div>}
    </div>
  );
}
