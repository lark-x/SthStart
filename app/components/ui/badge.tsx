import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

/** 状态徽标统一走语义状态 token（§3.1），护眼主题自动生效。 */
export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-ink/8 text-ink',
        secondary: 'bg-surface-sunken text-muted',
        outline: 'border border-border-default text-muted',
        online: 'bg-success/12 text-success-fg font-semibold',
        running: 'bg-success/12 text-success-fg font-semibold',
        offline: 'bg-danger/12 text-danger-fg',
        stopped: 'bg-ink/8 text-muted',
        unknown: 'bg-warning/15 text-warning-fg',
        warning: 'bg-warning/15 text-warning-fg',
        error: 'bg-danger/15 text-danger-fg',
        accent: 'bg-accent-soft text-accent',
        system: 'bg-accent-soft text-accent font-semibold text-sm uppercase px-1.5 py-0.5',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.ComponentPropsWithRef<'span'>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, className }))} {...props}>
      {dot && (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full flex-shrink-0 bg-current',
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
