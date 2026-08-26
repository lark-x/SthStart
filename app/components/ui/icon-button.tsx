import React, { forwardRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button, type ButtonProps } from './button';
import { cn } from '../../lib/cn';

export interface IconButtonProps extends Omit<ButtonProps, 'children'> {
  icon: LucideIcon;
  label: string;
  iconClassName?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon: Icon, label, iconClassName, className, size = 'icon', variant = 'ghost', ...props }, ref) => {
    return (
      <Button
        ref={ref}
        size={size}
        variant={variant}
        aria-label={label}
        title={label}
        className={cn('inline-flex items-center justify-center', className)}
        {...props}
      >
        <Icon className={cn('h-4 w-4', iconClassName)} aria-hidden="true" />
      </Button>
    );
  }
);

IconButton.displayName = 'IconButton';

