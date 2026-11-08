'use client';

import React, { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * 按钮规范：统一圆角、焦点状态与触控高度；
 * 桌面默认 40px、紧凑 36px；移动端至少 44px，大按钮 48px。
 */
export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-[var(--motion-fast)] enabled:active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-wait aria-disabled:opacity-60 cursor-pointer select-none',
  {
    variants: {
      variant: {
        primary:
          'border border-transparent bg-primary text-primary-foreground shadow-sm enabled:hover:bg-action-primary-hover enabled:hover:shadow-md font-semibold',
        accent:
          'border border-transparent bg-accent text-fg-on-accent shadow-sm enabled:hover:bg-accent-dark enabled:hover:shadow-md font-semibold',
        secondary:
          'border border-transparent bg-action-secondary text-ink enabled:hover:bg-action-secondary-hover',
        outline:
          'border border-border-default bg-surface text-ink shadow-xs enabled:hover:bg-surface-hover',
        ghost: 'border border-transparent bg-transparent text-muted enabled:hover:text-ink enabled:hover:bg-surface-hover',
        danger:
          'border border-transparent bg-danger-solid text-danger-on-solid enabled:hover:bg-[color-mix(in_srgb,var(--danger-solid)_88%,black)] font-semibold',
        'danger-ghost': 'border border-transparent bg-transparent text-danger-fg enabled:hover:bg-danger-bg',
      },
      size: {
        sm: 'min-h-[var(--control-h-touch)] sm:min-h-[var(--control-h-sm)] px-3 text-sm',
        md: 'min-h-[var(--control-h-touch)] sm:min-h-[var(--control-h)] px-4 py-2 text-sm',
        lg: 'min-h-[var(--control-h-lg)] px-6 py-3 text-base',
        icon: 'size-[var(--control-h-touch)] sm:size-[var(--control-h-sm)] p-0',
        'icon-lg': 'size-[var(--control-h-touch)] p-0',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, type = 'button', onClick, onClickCapture, 'aria-disabled': ariaDisabled, ...props }, ref) => {
    const unavailable = loading || ariaDisabled === true || ariaDisabled === 'true';
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        aria-disabled={unavailable || undefined}
        aria-busy={loading || undefined}
        onClickCapture={(event) => {
          if (unavailable) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onClickCapture?.(event);
        }}
        onClick={(event) => {
          if (unavailable) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onClick?.(event);
        }}
        className={cn(buttonVariants({ variant, size, className }))}
        data-variant={variant ?? 'secondary'}
        data-size={size ?? 'md'}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin text-current" aria-hidden="true" />}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
