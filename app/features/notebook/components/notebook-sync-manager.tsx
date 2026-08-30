'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeNotebookLocalChanges } from '../local-store';
import { syncPendingNotebookData } from '../sync';

export function NotebookSyncManager() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let queued: number | undefined;
    const schedule = (delay = 1_500) => {
      if (queued !== undefined) window.clearTimeout(queued);
      queued = window.setTimeout(() => void syncPendingNotebookData(queryClient), delay);
    };
    const unsubscribe = subscribeNotebookLocalChanges(() => schedule());
    const online = () => schedule(0);
    const visible = () => { if (document.visibilityState === 'visible') schedule(0); };
    window.addEventListener('online', online);
    window.addEventListener('focus', online);
    document.addEventListener('visibilitychange', visible);
    const interval = window.setInterval(() => schedule(0), 15_000);
    schedule(0);
    return () => {
      if (queued !== undefined) window.clearTimeout(queued);
      window.clearInterval(interval);
      unsubscribe();
      window.removeEventListener('online', online);
      window.removeEventListener('focus', online);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [queryClient]);

  return null;
}
