import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  description?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, description, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;

    return (
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          id={inputId}
          ref={ref}
          className={cn(
            'h-4 w-4 rounded border-[rgb(24_32_29/24%)] text-accent accent-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 mt-0.5 cursor-pointer',
            className
          )}
          {...props}
        />
        {(label || description) && (
          <label htmlFor={inputId} className="cursor-pointer select-none text-sm text-ink">
            {label && <span className="font-medium">{label}</span>}
            {description && <p className="text-sm text-muted leading-relaxed mt-0.5">{description}</p>}
          </label>
        )}
      </div>
    );
  }
);

Checkbox.displayName = 'Checkbox';

