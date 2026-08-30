'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CommandPalette, type CommandItem } from '../ui/command';
import { createCommandRegistry } from './command-registry';
import { useEyeCare } from '@/app/providers/ui-provider';

export function GlobalCommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { toggleEyeCare } = useEyeCare();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
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
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const items: CommandItem[] = useMemo(() => createCommandRegistry(router.push, toggleEyeCare), [router, toggleEyeCare]);

  return <CommandPalette open={open} onOpenChange={setOpen} items={items} />;
}
