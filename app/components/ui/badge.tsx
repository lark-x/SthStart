import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Badge as MantineBadge } from '@mantine/core';
import { cn } from '../../lib/cn';

/** 状态徽标统一走语义状态 token（§3.1），护眼主题自动生效。 */
export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium tracking-wide transition-colors',
  {
    variants: {
      variant: {
        default: 'border border-hairline bg-surface-sunken text-ink',
        secondary: 'border border-hairline bg-surface-sunken text-muted',
        outline: 'border border-border-default bg-transparent text-muted',
        online: 'border border-success-border bg-success-bg text-success-fg font-semibold',
        running: 'border border-success-border bg-success-bg text-success-fg font-semibold',
        offline: 'border border-danger-border bg-danger-bg text-danger-fg font-semibold',
        stopped: 'border border-hairline bg-surface-sunken text-muted',
        unknown: 'border border-warning-border bg-warning-bg text-warning-fg font-semibold',
        warning: 'border border-warning-border bg-warning-bg text-warning-fg font-semibold',
        error: 'border border-danger-border bg-danger-bg text-danger-fg font-semibold',
        busy: 'border border-info-border bg-info-bg text-info-fg font-semibold',
        accent: 'border border-[var(--selection-border)] bg-[var(--selection-bg)] text-[var(--selection-fg)] font-semibold',
        /** 跟随最近的 [data-tone] 容器（模块识别色）。 */
        tone: 'border border-[color-mix(in_srgb,var(--tone)_24%,transparent)] bg-tone-soft text-tone-fg font-semibold',
        system: 'border border-[var(--selection-border)] bg-[var(--selection-bg)] text-[var(--selection-fg)] font-semibold text-xs uppercase px-2 py-0.5',
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
    <MantineBadge
      component="span"
      unstyled
      data-ui-badge={variant ?? 'default'}
      className={cn(badgeVariants({ variant, className }))}
      classNames={{ label: 'contents', section: 'contents' }}
      leftSection={
        dot ? (
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full flex-shrink-0 bg-current',
              (variant === 'online' || variant === 'running') && 'bg-success',
              (variant === 'offline' || variant === 'error') && 'bg-danger',
              (variant === 'unknown' || variant === 'warning') && 'bg-warning',
              variant === 'busy' && 'bg-info',
              (!variant || variant === 'default' || variant === 'secondary' || variant === 'stopped') && 'bg-muted'
            )}
            aria-hidden="true"
          />
        ) : undefined
      }
      {...props}
    >
      {children}
    </MantineBadge>
  );
}
