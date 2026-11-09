'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CommandPalette, type CommandItem } from '../ui/command';
import { createCommandRegistry } from './command-registry';
import { useTheme } from '@/app/providers/ui-provider';
import { OPEN_COMMAND_PALETTE } from './command-palette-events';

export function GlobalCommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { toggleColorMode, setThemeId } = useTheme();

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      const target = event.target as HTMLElement | null;
      const isEditable =
        target?.isContentEditable ||
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT';

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
      } else if (event.key === '/' && !isEditable) {
        event.preventDefault();
        setOpen(true);
      }
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

  return <CommandPalette open={open} onOpenChange={setOpen} items={items} />;
}
