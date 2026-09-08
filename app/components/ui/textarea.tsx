import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean | string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, rows = 3, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        rows={rows}
        aria-invalid={Boolean(error)}
        className={cn(
          'flex min-h-[70px] w-full rounded border border-[rgb(24_32_29/18%)] bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/60 leading-relaxed',
          'focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20',
          'disabled:cursor-not-allowed disabled:opacity-50 resize-y',
          error && 'border-[#c9674a] focus-visible:border-[#c9674a] focus-visible:ring-[#c9674a]/20',
          className
        )}
        {...props}
      />
    );
  }
);

Textarea.displayName = 'Textarea';

