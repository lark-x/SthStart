'use client';

import React, { useId } from 'react';
import { cn } from '../../lib/cn';

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement<{ 'aria-describedby'?: string }>;
  className?: string;
}

export function Tooltip({ content, children, className }: TooltipProps) {
  const id = useId();
  return (
    <div className="relative group inline-flex">
      {React.cloneElement(children, {
        'aria-describedby': [children.props['aria-describedby'], id].filter(Boolean).join(' '),
      })}
      <div
        id={id}
        role="tooltip"
        className={cn(
          'absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex group-focus-within:flex pointer-events-none z-50 max-w-[min(24rem,calc(100vw-2rem))] w-max rounded-[var(--radius-control)] bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-floating',
          className
        )}
      >
        {content}
      </div>
    </div>
  );
}
