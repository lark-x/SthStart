'use client';

import { useEffect } from 'react';

export function NotebookOfflineRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/notebook-sw.js', { scope: '/' });
  }, []);
  return null;
}
