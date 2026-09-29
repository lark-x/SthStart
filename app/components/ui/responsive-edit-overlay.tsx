'use client';

import React, { useEffect, useState } from 'react';
import { Dialog } from './dialog';
import { Drawer } from './drawer';

export interface ResponsiveEditOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

/** Desktop short-form dialog; on narrow screens the same controlled form becomes a bottom sheet. */
export function ResponsiveEditOverlay({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: ResponsiveEditOverlayProps) {
  // Keep the server snapshot desktop-shaped for hydration, then select the mobile drawer after mount.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)');
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  if (narrow) {
    return (
      <Drawer
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        description={description}
        footer={footer}
        position="bottom"
        className={`!h-auto max-h-[90dvh] px-4 pb-0 pt-5 sm:px-6 ${className ?? ''}`}
      >
        {children}
      </Drawer>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={footer}
      size="lg"
      className={`max-w-3xl ${className ?? ''}`}
    >
      {children}
    </Dialog>
  );
}
