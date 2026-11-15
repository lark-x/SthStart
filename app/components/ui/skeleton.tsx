import React from 'react';
import { Skeleton as MantineSkeleton } from '@mantine/core';
import { cn } from '../../lib/cn';

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <MantineSkeleton
      unstyled
      visible={false}
      animate={false}
      aria-hidden="true"
      className={cn('skeleton-shimmer rounded-md', className)}
      {...props}
    />
  );
}

