'use client';

import React, { forwardRef } from 'react';
import { useImeSafeHandlers } from './use-ime-safe-handlers';
import { cn } from '../../lib/cn';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean | string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, rows = 3, onKeyDown, onCompositionStart, onCompositionEnd, ...props }, ref) => {
    const imeHandlers = useImeSafeHandlers({ onKeyDown, onCompositionStart, onCompositionEnd });
    return (
      <textarea
        ref={ref}
        rows={rows}
        aria-invalid={Boolean(error) || undefined}
        className={cn('ui-control', className)}
        {...props}
        {...imeHandlers}
      />
    );
  }
);

Textarea.displayName = 'Textarea';
