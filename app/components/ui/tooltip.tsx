import React from 'react';
import { cn } from '../../lib/cn';

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  className?: string;
}

export function Tooltip({ content, children, className }: TooltipProps) {
  return (
    <div className="relative group inline-flex">
      {children}
      <div
        role="tooltip"
        className={cn(
          'absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex group-focus-within:flex pointer-events-none z-50 whitespace-nowrap rounded bg-[#18201d] px-2 py-1 text-[11px] font-medium text-[#f4f0e7] shadow-md transition-opacity animate-in fade-in',
          className
        )}
      >
        {content}
      </div>
    </div>
  );
}

