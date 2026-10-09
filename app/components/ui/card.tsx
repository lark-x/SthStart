import React from 'react';
import { cn } from '../../lib/cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  variant?: 'default' | 'raised' | 'sunken' | 'glass';
}

export function Card({ className, interactive, variant = 'default', children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-panel)] border p-5 shadow-panel transition-[transform,box-shadow,border-color] duration-200 ease-[var(--motion-ease)]',
        variant === 'default' && 'border-border-subtle/80 bg-surface',
        variant === 'raised' && 'border-border-subtle bg-surface-raised shadow-floating',
        variant === 'sunken' && 'border-border-subtle/60 bg-surface-sunken/60 shadow-xs',
        variant === 'glass' && 'border-border-subtle/80 bg-surface/85 backdrop-blur-md shadow-panel',
        interactive && 'cursor-pointer hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-panel-hover active:translate-y-0',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('mb-5 flex flex-col space-y-1.5', className)} {...props}>
      {children}
    </div>
  );
}

/** 面板标题规范（§3.2）：无衬线 18px/600；页面级 H1 才使用衬线。 */
export function CardTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        'text-lg font-bold tracking-tight text-ink',
        className
      )}
      {...props}
    >
      {children}
    </h3>
  );
}

export function CardDescription({ className, children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-sm text-muted leading-relaxed', className)} {...props}>
      {children}
    </p>
  );
}

export function CardContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('space-y-3', className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('mt-5 flex items-center justify-between gap-3 rounded-xl bg-surface-sunken/55 px-3 py-2.5', className)} {...props}>
      {children}
    </div>
  );
}
