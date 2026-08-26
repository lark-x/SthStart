import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean | string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, type = 'text', ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        aria-invalid={Boolean(error)}
        className={cn(
          'flex min-h-[42px] w-full rounded border border-[rgb(24_32_29/18%)] bg-[#fffdf8] px-3 py-2 text-sm text-[#18201d] placeholder:text-[#68716d]/60',
          'focus-visible:outline-none focus-visible:border-[#e45d35] focus-visible:ring-2 focus-visible:ring-[#e45d35]/20',
          'disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-[#c9674a] focus-visible:border-[#c9674a] focus-visible:ring-[#c9674a]/20',
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';

