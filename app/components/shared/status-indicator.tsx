import React from 'react';
import { cn } from '../../lib/cn';
import type { AppStatus, RuntimeServiceState } from '@sthstart/contracts';

export function StatusIndicator({
  status,
  label,
  className,
}: {
  status: AppStatus | RuntimeServiceState | 'loading';
  label?: string;
  className?: string;
}) {
  const isOnline = status === 'online' || status === 'running';
  const isWarning = status === 'unknown' || status === 'starting' || status === 'degraded' || status === 'external';
  const isError = status === 'offline' || status === 'error' || status === 'stopped';

  return (
    <span className={cn('inline-flex items-center gap-2 text-xs font-medium', className)}>
      <span
        className={cn(
          'h-2 w-2 rounded-full',
          isOnline && 'bg-[#4e9b6b] shadow-[0_0_0_4px_rgb(78_155_107/15%)]',
          isWarning && 'bg-[#d0a731] shadow-[0_0_0_4px_rgb(208_167_49/15%)]',
          isError && 'bg-[#c9674a] shadow-[0_0_0_4px_rgb(201_103_74/15%)]'
        )}
        aria-hidden="true"
      />
      {label && <span>{label}</span>}
    </span>
  );
}

