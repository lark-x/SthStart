import React from 'react';
import { cn } from '../../lib/cn';

export interface SectionHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn('flex items-end justify-between gap-4 mb-5 pb-3 border-b border-[rgb(24_32_29/10%)]', className)}>
      <div>
        {eyebrow && (
          <p className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#b83b1b] mb-1">
            {eyebrow}
          </p>
        )}
        <h2 className="font-serif text-2xl font-medium tracking-tight text-[#18201d]">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-xs text-[#68716d] leading-relaxed">
            {description}
          </p>
        )}
      </div>

      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

