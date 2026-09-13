import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

/** 状态徽标统一走语义状态 token（§3.1），护眼主题自动生效。 */
export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-sm font-medium tracking-wide transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-ink/8 text-ink',
        secondary: 'bg-[rgb(108_107_91/10%)] text-muted',
        outline: 'border border-border-default text-muted',
        online: 'bg-success/12 text-success-fg font-semibold',
        running: 'bg-success/12 text-success-fg font-semibold',
        offline: 'bg-danger/12 text-danger-fg',
        stopped: 'bg-ink/8 text-muted',
        unknown: 'bg-warning/15 text-warning-fg',
        warning: 'bg-warning/15 text-warning-fg',
        error: 'bg-danger/15 text-danger-fg',
        accent: 'bg-accent/12 text-accent-dark',
        system: 'bg-accent/10 text-accent-dark font-bold text-sm uppercase px-1.5 py-0.5',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, className }))} {...props}>
      {dot && (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full flex-shrink-0',
            (variant === 'online' || variant === 'running') && 'bg-success',
            (variant === 'offline' || variant === 'error') && 'bg-danger',
            (variant === 'unknown' || variant === 'warning') && 'bg-warning',
            (!variant || variant === 'default' || variant === 'secondary' || variant === 'stopped') && 'bg-muted'
          )}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
