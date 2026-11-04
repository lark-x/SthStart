'use client';

import React, { forwardRef } from 'react';
import { useImeSafeHandlers } from './use-ime-safe-handlers';
import { cn } from '../../lib/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean | string;
}

/** 与 Button/Select 同规范：高 40px、语义圆角、统一错误态（计划 §3.3/§7.1）。 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, type = 'text', onKeyDown, onCompositionStart, onCompositionEnd, ...props }, ref) => {
    const imeHandlers = useImeSafeHandlers({ onKeyDown, onCompositionStart, onCompositionEnd });
    return (
      <input
        type={type}
        ref={ref}
        aria-invalid={Boolean(error) || undefined}
        className={cn('ui-control', className)}
        {...props}
        {...imeHandlers}
      />
    );
  }
);

Input.displayName = 'Input';
