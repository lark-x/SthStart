import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean | string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, error, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        aria-invalid={Boolean(error)}
        className={cn(
          'flex min-h-[42px] w-full rounded border border-[rgb(24_32_29/18%)] bg-surface px-3 py-2 text-sm text-ink',
          'focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20',
          'disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-[#c9674a] focus-visible:border-[#c9674a] focus-visible:ring-[#c9674a]/20',
          className
        )}
        {...props}
      >
        {children}
      </select>
    );
  }
);

Select.displayName = 'Select';

