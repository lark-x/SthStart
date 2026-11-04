import React from 'react';
import { cn } from '../../lib/cn';

export interface CardProps extends React.ComponentPropsWithRef<'div'> {
  interactive?: boolean;
  variant?: 'default' | 'raised' | 'sunken' | 'glass';
}

export function Card({ className, interactive, variant = 'default', children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-[var(--radius-panel)] border p-5 transition-colors duration-[var(--motion-fast)]',
        variant === 'default' && 'border-border-subtle bg-surface',
        variant === 'raised' && 'border-border-subtle bg-surface-raised shadow-xs',
        variant === 'sunken' && 'border-transparent bg-surface-sunken',
        variant === 'glass' && 'border-border-subtle bg-surface/95',
        interactive && 'cursor-pointer hover:border-border-strong hover:bg-surface-raised',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }: React.ComponentPropsWithRef<'div'>) {
  return (
    <div className={cn('mb-5 flex flex-col space-y-1.5', className)} {...props}>
      {children}
    </div>
  );
}

/** 面板标题规范（§3.2）：无衬线 18px/600；全局 UI 标题使用无衬线。 */
export function CardTitle({ className, children, ...props }: React.ComponentPropsWithRef<'h3'>) {
  return (
    <h3
      className={cn(
        'text-lg font-semibold tracking-tight text-ink',
        className
      )}
      {...props}
    >
      {children}
    </h3>
  );
}

export function CardDescription({ className, children, ...props }: React.ComponentPropsWithRef<'p'>) {
  return (
    <p className={cn('text-sm text-muted leading-relaxed', className)} {...props}>
      {children}
    </p>
  );
}

export function CardContent({ className, children, ...props }: React.ComponentPropsWithRef<'div'>) {
  return (
    <div className={cn('space-y-3', className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...props }: React.ComponentPropsWithRef<'div'>) {
  return (
    <div className={cn('mt-5 flex items-center justify-between gap-3 rounded-xl bg-surface-sunken/55 px-3 py-2.5', className)} {...props}>
      {children}
    </div>
  );
}
