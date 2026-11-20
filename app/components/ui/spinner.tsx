import React from 'react';
import { Box } from '@mantine/core';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: '2xs' | 'xs' | 'sm' | 'md' | 'lg';
  label?: string;
  iconClassName?: string;
}

const sizeClasses = {
  '2xs': 'h-2.5 w-2.5',
  xs: 'h-3 w-3',
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-9 w-9',
} as const;

export function Spinner({
  size = 'md',
  label,
  className,
  iconClassName,
  ...props
}: SpinnerProps) {
  const hasVisibleLabel = Boolean(label && label.trim().length > 0);
  const hasBoxSizeOverride = Boolean(className && /(?:^|\s)(?:h-|w-|size-)/.test(className));
  const hasColorOverride = Boolean(className && /(?:^|\s)text-/.test(className));
  const ariaLabel = hasVisibleLabel
    ? undefined
    : (props['aria-label'] ?? '加载中');

  return (
    <Box
      component="span"
      role="status"
      aria-live={props['aria-live'] ?? 'polite'}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 text-muted',
        className,
      )}
      {...props}
    >
      <Loader2
        className={cn(
          'animate-spin shrink-0',
          hasColorOverride ? 'text-current' : 'text-accent',
          !hasVisibleLabel && hasBoxSizeOverride && !iconClassName
            ? 'h-full w-full'
            : sizeClasses[size],
          iconClassName,
        )}
        aria-hidden="true"
      />
      {hasVisibleLabel && <span className="text-sm">{label}</span>}
    </Box>
  );
}
