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
          'flex min-h-[70px] w-full rounded border border-[rgb(24_32_29/18%)] bg-[#fffdf8] px-3 py-2 text-sm text-[#18201d] placeholder:text-[#68716d]/60 leading-relaxed',
          'focus-visible:outline-none focus-visible:border-[#e45d35] focus-visible:ring-2 focus-visible:ring-[#e45d35]/20',
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

