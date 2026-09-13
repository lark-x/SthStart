import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean | string;
}

/** 与 Button/Select 同规范：高 40px、圆角 8px、统一错误态（计划 §3.3/§7.1）。 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, type = 'text', ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        aria-invalid={Boolean(error) || undefined}
        className={cn(
          'flex h-10 w-full rounded-[var(--radius-control)] border border-border-control bg-surface-raised px-3 py-2 text-sm text-ink placeholder:text-muted/60',
          'focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-danger focus-visible:border-danger focus-visible:ring-danger/20',
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';
