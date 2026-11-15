'use client';

import { useCallback, useRef } from 'react';

/** Bridges the active editor's explicit flush action to workspace commands. */
export function useStoryFlushRegistry() {
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  const flush = useCallback(() => flushRef.current(), []);
  const register = useCallback((next: () => Promise<boolean>) => { flushRef.current = next; }, []);
  return { flush, register };
}
