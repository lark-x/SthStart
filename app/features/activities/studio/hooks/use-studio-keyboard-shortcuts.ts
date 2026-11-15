'use client';

import { useEffect, useRef, type RefObject } from 'react';

export function useStudioKeyboardShortcuts({
  mediaFlushRef,
  draftFlushRef,
  overlaysOpen,
  onEscape,
}: {
  mediaFlushRef: RefObject<(() => Promise<boolean>) | null>;
  draftFlushRef: RefObject<() => Promise<boolean>>;
  overlaysOpen: boolean;
  onEscape: () => void;
}) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void (async () => {
          if (mediaFlushRef.current && !await mediaFlushRef.current()) return;
          await draftFlushRef.current();
        })();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [draftFlushRef, mediaFlushRef]);

  const escapeRef = useRef(onEscape);
  useEffect(() => { escapeRef.current = onEscape; });

  useEffect(() => {
    if (!overlaysOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || event.key !== 'Escape') return;
      escapeRef.current();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [overlaysOpen]);
}
