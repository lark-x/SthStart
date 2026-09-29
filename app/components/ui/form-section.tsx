'use client';

import React from 'react';
import { cn } from '@/app/lib/cn';

/** A quiet content grouping: hierarchy comes from spacing and typography, not divider stacks. */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('min-w-0 space-y-4', className)}>
      <header className="space-y-1">
        <h2 className="text-base font-semibold leading-snug text-ink">{title}</h2>
        {description ? <p className="max-w-[var(--shell-reading)] text-sm leading-relaxed text-muted">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

/** For short fields only. Long text belongs on a full row or in the document editor. */
export function ShortFieldGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid min-w-0 grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2', className)}>{children}</div>;
}
