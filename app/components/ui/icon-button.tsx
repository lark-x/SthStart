import React, { forwardRef } from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';
import { Button, type ButtonProps } from './button';
import { cn } from '../../lib/cn';

export interface IconButtonProps extends Omit<ButtonProps, 'children'> {
  icon: LucideIcon;
  label: string;
  iconClassName?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon: Icon, label, iconClassName, className, size = 'icon', variant = 'ghost', loading, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        size={size}
        variant={variant}
        aria-label={label}
        aria-busy={loading || undefined}
        aria-disabled={loading || props['aria-disabled']}
        title={label}
        className={cn('inline-flex items-center justify-center', className)}
        {...props}
        loading={false}
      >
        {loading ? (
          <Loader2 className={cn('h-4 w-4 animate-spin', iconClassName)} aria-hidden="true" />
        ) : (
          <Icon className={cn('h-4 w-4', iconClassName)} aria-hidden="true" />
        )}
      </Button>
    );
  }
);

IconButton.displayName = 'IconButton';
