'use client';

import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  description?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, description, id, disabled, 'aria-describedby': describedBy, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;

    return (
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          id={inputId}
          ref={ref}
          disabled={disabled}
          aria-describedby={[describedBy, description ? inputId + '-description' : undefined].filter(Boolean).join(' ') || undefined}
          className={cn(
            'h-4 w-4 shrink-0 rounded border-border-control accent-action-primary mt-1 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
          {...props}
        />
        {(label || description) && (
          <label htmlFor={inputId} className={cn("min-w-0 select-none text-sm text-ink", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer")}>
            {label && <span className="font-medium">{label}</span>}
            {description && <span id={inputId + '-description'} className="mt-1 block text-sm text-muted leading-relaxed">{description}</span>}
          </label>
        )}
      </div>
    );
  }
);

Checkbox.displayName = 'Checkbox';

