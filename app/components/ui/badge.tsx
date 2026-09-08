import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-sm font-medium tracking-wide transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-[rgb(24_32_29/8%)] text-ink',
        secondary: 'bg-[rgb(108_107_91/10%)] text-[#6c6d5e]',
        outline: 'border border-[rgb(24_32_29/14%)] text-muted',
        online: 'bg-[#4e9b6b]/12 text-[#35754d] font-semibold',
        running: 'bg-[#4e9b6b]/12 text-[#35754d] font-semibold',
        offline: 'bg-[#c9674a]/12 text-[#a84427]',
        stopped: 'bg-[rgb(24_32_29/8%)] text-muted',
        unknown: 'bg-[#d0a731]/15 text-[#8f6f1a]',
        warning: 'bg-[#d0a731]/15 text-[#8f6f1a]',
        error: 'bg-[#c9674a]/15 text-accent-dark',
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
            (variant === 'online' || variant === 'running') && 'bg-[#4e9b6b]',
            (variant === 'offline' || variant === 'error') && 'bg-[#c9674a]',
            (variant === 'unknown' || variant === 'warning') && 'bg-[#d0a731]',
            (!variant || variant === 'default' || variant === 'secondary' || variant === 'stopped') && 'bg-muted'
          )}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}

