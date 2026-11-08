'use client';

import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  description?: string;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, label, description, checked, onChange, id, disabled, 'aria-describedby': describedBy, ...props }, ref) => {
    const generatedId = React.useId();
    const switchId = id || generatedId;

    return (
      <div className="flex items-center justify-between gap-4 py-1.5">
        {(label || description) && (
          <label htmlFor={switchId} className={cn("min-w-0 select-none text-sm text-ink", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer")}>
            {label && <span className="block font-medium">{label}</span>}
            {description && <span id={switchId + '-description'} className="block text-sm text-muted leading-relaxed">{description}</span>}
          </label>
        )}
        <label className={cn("relative inline-flex shrink-0 items-center", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
          <input
            type="checkbox"
            role="switch"
            aria-label={!label ? (props['aria-label'] ?? description) : props['aria-label']}
            aria-describedby={[describedBy, description ? switchId + '-description' : undefined].filter(Boolean).join(' ') || undefined}
            id={switchId}
            ref={ref}
            checked={checked}
            onChange={onChange}
            disabled={disabled}
            className="sr-only peer"
            {...props}
          />
          <span
            aria-hidden="true"
            className={cn(
              "h-6 w-11 rounded-full border border-border-control bg-surface-sunken peer-focus-visible:outline-2 peer-focus-visible:outline-focus-ring peer-focus-visible:outline-offset-2 peer-checked:bg-action-primary peer-checked:border-transparent after:content-[''] after:absolute after:top-1 after:left-1 after:size-4 after:rounded-full after:bg-fg-muted peer-checked:after:bg-action-on-primary peer-checked:after:translate-x-5 after:transition-transform after:duration-[var(--motion-fast)]",
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

