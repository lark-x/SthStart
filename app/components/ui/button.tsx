import React, { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * 按钮规范：统一圆角、焦点状态与触控高度；
 * 桌面默认 40px、紧凑 36px；移动端至少 44px，大按钮 48px。
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-[var(--fg-on-accent)] hover:bg-accent-dark active:scale-[0.99] font-semibold',
        accent: 'bg-accent text-[var(--fg-on-accent)] hover:bg-accent-dark active:scale-[0.99] font-semibold',
        secondary: 'bg-surface-sunken/70 text-ink hover:bg-surface-sunken',
        outline: 'border border-border-default bg-surface text-ink hover:border-accent/40 hover:bg-surface-raised',
        ghost: 'bg-transparent text-muted hover:text-ink hover:bg-surface-sunken/65',
        danger: 'bg-danger-solid text-danger-on-solid hover:bg-danger-fg',
        'danger-ghost': 'bg-transparent text-danger-fg hover:bg-danger/12',
      },
      size: {
        sm: 'h-11 sm:h-9 px-3.5 text-sm',
        md: 'h-11 sm:h-10 px-4 py-2 text-sm',
        lg: 'h-12 px-6 py-3 text-base',
        icon: 'h-11 w-11 sm:h-9 sm:w-9 p-0',
        'icon-lg': 'h-11 w-11 p-0',
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
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin text-current" aria-hidden="true" />}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
