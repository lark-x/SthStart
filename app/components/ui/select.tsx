import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean | string;
}

/** 与 Button/Input 同规范：统一点击高度、圆角与错误态。 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, error, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        aria-invalid={Boolean(error) || undefined}
        className={cn('ui-control', className)}
        {...props}
      >
        {children}
      </select>
    );
  }
);

Select.displayName = 'Select';
