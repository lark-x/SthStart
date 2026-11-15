'use client';

import React from 'react';
import { Tooltip as MantineTooltip } from '@mantine/core';
import { useOverlayPortalTarget } from './overlay-policy';

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement<{ 'aria-describedby'?: string }>;
  className?: string;
}

export function Tooltip({ content, children, className }: TooltipProps) {
  const host = useOverlayPortalTarget();
  return (
    <MantineTooltip
      label={content}
      withArrow
      openDelay={180}
      withinPortal
      portalProps={host ? { target: host } : undefined}
      events={{ hover: true, focus: true, touch: true }}
      className={className}
    >
      {children}
    </MantineTooltip>
  );
}
