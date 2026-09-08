import { AppSwitcher } from '@/app/components/shared/app-switcher';
import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../../lib/cn';
import { EyeCareToggle } from './eye-care-toggle';

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
    <div className={cn('flex flex-col gap-2.5 pb-4 pt-1', className)}>
      {backHref && (
        <div>
          <Link
            href={backHref}
            className="inline-flex min-h-7 items-center gap-1.5 text-sm text-muted hover:text-accent transition-colors font-medium"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{backLabel}</span>
          </Link>
        </div>
      )}

      <div className="page-header-main flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          {eyebrow && (
            <p className="page-header-eyebrow hidden text-xs font-bold tracking-[0.16em] uppercase text-accent-dark mb-0.5">
              {eyebrow}
            </p>
          )}
          <h1 className="font-serif text-2xl sm:text-3xl font-medium tracking-tight text-ink">
            {title}
          </h1>
          {description && (
            <p className="page-header-description mt-1 max-w-2xl text-sm sm:text-sm text-muted leading-relaxed">
              {description}
            </p>
          )}
        </div>

        <div className="page-header-actions flex items-center gap-2 flex-wrap sm:flex-nowrap">
          <AppSwitcher />
          <EyeCareToggle />
          {actions}
        </div>
      </div>
    </div>
  );
}
