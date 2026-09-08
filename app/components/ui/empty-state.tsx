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
        'flex flex-col items-center justify-center p-10 text-center rounded-lg border border-dashed border-[rgb(24_32_29/18%)] bg-surface/60 min-h-[300px]',
        className
      )}
      {...props}
    >
      {Icon ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgb(24_32_29/6%)] text-muted mb-4">
          <Icon className="h-6 w-6" aria-hidden="true" />
        </div>
      ) : symbol ? (
        <span
          className="flex h-16 w-16 items-center justify-center rounded-full bg-ink text-paper font-serif text-2xl mb-4"
          aria-hidden="true"
        >
          {symbol}
        </span>
      ) : null}
      <h3 className="font-serif text-2xl font-medium text-ink">{title}</h3>
      {description && (
        <p className="mt-2 max-w-sm text-sm text-muted leading-relaxed">
          {description}
        </p>
      )}
      {actions && <div className="mt-6 flex flex-wrap gap-3 justify-center">{actions}</div>}
    </div>
  );
}

