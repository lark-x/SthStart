import React, { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e45d35] focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none',
  {
    variants: {
      variant: {
        primary: 'bg-[#18201d] text-[#f4f0e7] hover:bg-black active:scale-[0.99]',
        accent: 'bg-[#e45d35] text-white hover:bg-[#b83b1b] active:scale-[0.99] font-bold',
        secondary: 'border border-[rgb(24_32_29/18%)] bg-transparent text-[#18201d] hover:bg-[rgb(24_32_29/6%)]',
        outline: 'border border-[rgb(24_32_29/18%)] bg-[#fffdf8] text-[#18201d] hover:bg-[rgb(24_32_29/4%)]',
        ghost: 'bg-transparent text-[#68716d] hover:text-[#18201d] hover:bg-[rgb(24_32_29/6%)]',
        danger: 'bg-[#c9674a] text-white hover:bg-[#b83b1b]',
        'danger-ghost': 'bg-transparent text-[#c9674a] hover:bg-[#c9674a]/10',
      },
      size: {
        sm: 'h-8 px-3 text-xs rounded',
        md: 'min-h-[40px] px-4 py-2 text-sm rounded-[3px_12px_3px_3px]',
        lg: 'min-h-[48px] px-6 py-3 text-base rounded-[3px_14px_3px_3px]',
        icon: 'h-11 w-11 min-h-[44px] min-w-[44px] p-0 rounded-md',
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
