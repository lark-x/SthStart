import React from 'react';
import { cn } from '../../lib/cn';
import type { AppStatus, RuntimeServiceState } from '@sthstart/contracts';

export function StatusIndicator({
  status,
  label,
  className,
}: {
  status: AppStatus | RuntimeServiceState | 'loading' | 'idle';
  label?: string;
  className?: string;
}) {
  const isOnline = status === 'online' || status === 'running';
  const isWarning = status === 'unknown' || status === 'starting' || status === 'degraded' || status === 'external';
  const isError = status === 'offline' || status === 'error';
  const isStopped = status === 'stopped' || status === 'stopping';
  const isIdle = status === 'idle' || status === 'loading';

  return (
    <span className={cn('inline-flex items-center gap-2 text-sm font-medium', className)}>
      <span
        data-status={status}
        className={cn(
          'status-dot h-2 w-2 shrink-0 rounded-full transition-all duration-[var(--motion-base)] ease-[var(--motion-ease)]',
          isOnline && 'bg-success shadow-[0_0_0_3px_color-mix(in_srgb,var(--success)_18%,transparent)]',
          isWarning && 'bg-warning shadow-[0_0_0_3px_color-mix(in_srgb,var(--warning)_20%,transparent)]',
          isError && 'bg-danger shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_18%,transparent)]',
          isStopped && 'border border-border-strong bg-surface-sunken',
          isIdle && 'bg-muted/70 shadow-[0_0_0_3px_color-mix(in_srgb,var(--fg-muted)_14%,transparent)]',
          !isOnline && !isWarning && !isError && !isStopped && !isIdle && 'bg-muted'
        )}
        aria-hidden="true"
      />
      {label && <span>{label}</span>}
    </span>
  );
}
