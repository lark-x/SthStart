import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  description?: string;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, label, description, checked, onChange, id, disabled, ...props }, ref) => {
    const generatedId = React.useId();
    const switchId = id || generatedId;

    return (
      <div className="flex items-center justify-between gap-4 py-1.5">
        {(label || description) && (
          <label htmlFor={switchId} className="cursor-pointer select-none text-sm text-ink">
            {label && <div className="font-medium">{label}</div>}
            {description && <p className="text-sm text-muted leading-relaxed">{description}</p>}
          </label>
        )}
        <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
          <input
            type="checkbox"
            id={switchId}
            ref={ref}
            checked={checked}
            onChange={onChange}
            disabled={disabled}
            className="sr-only peer"
            {...props}
          />
          <div
            className={cn(
              "w-10 h-6 bg-ink/18 peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-accent rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-surface-raised after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-surface-raised after:border-border-default after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent",
              disabled && 'opacity-50 cursor-not-allowed',
              className
            )}
          />
        </label>
      </div>
    );
  }
);

Switch.displayName = 'Switch';

