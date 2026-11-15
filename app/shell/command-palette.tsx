'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CommandPalette, type CommandItem } from '@/app/components/ui/command';
import { createCommandRegistry } from '@/app/shell/command-registry';
import { useTheme } from '@/app/providers/ui-provider';
import { OPEN_COMMAND_PALETTE } from '@/app/shell/command-palette-events';
import { hasBlockingModal, isCommandShortcut } from '@/app/components/ui/overlay-policy';

export function GlobalCommandPalette() {
  const [open, setOpen] = useState(false);
  const invokerRef = useRef<HTMLElement | null>(null);
  const router = useRouter();
  const { toggleColorMode, setThemeId } = useTheme();

  useEffect(() => {
    const handleOpen = (event: Event) => {
      if (hasBlockingModal()) return;
      const invoker = (event as CustomEvent<unknown>).detail;
      invokerRef.current = invoker instanceof HTMLElement ? invoker : null;
      setOpen(true);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isCommandShortcut(event)) return;
      event.preventDefault();
      invokerRef.current = null;
      setOpen((prev) => prev ? false : !hasBlockingModal());
    };
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener(OPEN_COMMAND_PALETTE, handleOpen);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener(OPEN_COMMAND_PALETTE, handleOpen);
    };
  }, []);

  const items: CommandItem[] = useMemo(
    () => createCommandRegistry(router.push, toggleColorMode, setThemeId),
    [router, toggleColorMode, setThemeId]
  );

  return <CommandPalette open={open} onOpenChange={setOpen} items={items} invokerRef={invokerRef} />;
}
