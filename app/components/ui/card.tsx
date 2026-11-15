import React from 'react';
import { Box, Card as MantineCard } from '@mantine/core';
import { cn } from '../../lib/cn';

export interface CardProps extends React.ComponentPropsWithRef<'div'> {
  interactive?: boolean;
  variant?: 'default' | 'raised' | 'sunken' | 'glass';
}

export function Card({ className, interactive, variant = 'default', children, ...props }: CardProps) {
  return (
    <MantineCard
      unstyled
      component="div"
      className={cn(
        'min-w-0 rounded-panel border p-5 transition-[background-color,border-color,box-shadow,transform] duration-[var(--motion-base)]',
        variant === 'default' && 'border-transparent bg-surface shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)]',
        variant === 'raised' && 'border-transparent bg-surface-raised shadow-sm',
        variant === 'sunken' && 'border-transparent bg-surface-sunken',
        variant === 'glass' && 'border-border-subtle bg-surface/95',
        interactive && 'cursor-pointer hover:-translate-y-px hover:shadow-md',
        className
      )}
      data-ui-variant={variant}
      data-interactive={interactive || undefined}
      {...props}
    >
      {children}
    </MantineCard>
  );
}

export function CardHeader({ className, children, ...props }: React.ComponentPropsWithRef<'div'>) {
  return (
    <Box component="div" className={cn('mb-5 flex flex-col space-y-1.5', className)} {...props}>
      {children}
    </Box>
  );
}

/** Shared section typography follows the semantic type scale. */
export function CardTitle({ className, children, ...props }: React.ComponentPropsWithRef<'h3'>) {
  return (
    <Box
      component="h3"
      className={cn(
        'text-[length:var(--text-section)] font-semibold tracking-tight text-ink',
        className
      )}
      {...props}
    >
      {children}
    </Box>
  );
}

export function CardDescription({ className, children, ...props }: React.ComponentPropsWithRef<'p'>) {
  return (
    <Box component="p" className={cn('text-sm text-muted leading-relaxed', className)} {...props}>
      {children}
    </Box>
  );
}

export function CardContent({ className, children, ...props }: React.ComponentPropsWithRef<'div'>) {
  return (
    <Box component="div" className={cn('space-y-3', className)} {...props}>
      {children}
    </Box>
  );
}

export function CardFooter({ className, children, ...props }: React.ComponentPropsWithRef<'div'>) {
  return (
    <Box component="div" className={cn('mt-5 flex items-center justify-between gap-3 rounded-control bg-surface-sunken/55 px-3 py-2.5', className)} {...props}>
      {children}
    </Box>
  );
}
