import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  backHref,
  backLabel = '返回',
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-4 pb-6 pt-2', className)}>
      {backHref && (
        <div>
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 text-xs text-[#68716d] hover:text-[#e45d35] transition-colors font-medium"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{backLabel}</span>
          </Link>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          {eyebrow && (
            <p className="text-[11px] font-bold tracking-[0.16em] uppercase text-[#b83b1b] mb-1.5">
              {eyebrow}
            </p>
          )}
          <h1 className="font-serif text-3xl sm:text-4xl font-medium tracking-tight text-[#18201d]">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-2xl text-sm text-[#68716d] leading-relaxed">
              {description}
            </p>
          )}
        </div>

        {actions && <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap">{actions}</div>}
      </div>
    </div>
  );
}

