'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function RoutePreloader() {
  const router = useRouter();

  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData || connection?.effectiveType === '2g') return;
    let prefetchTimer: number | undefined;
    const prefetchLink = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="/"]') : null;
      if (!target) return;
      const href = target.getAttribute('href');
      if (!href || href.startsWith('/api/')) return;
      if (prefetchTimer !== undefined) window.clearTimeout(prefetchTimer);
      prefetchTimer = window.setTimeout(() => {
        try {
          router.prefetch(href);
        } catch {
          // best-effort prefetch
        }
      }, 80);
    };
    document.addEventListener('pointerover', prefetchLink, { passive: true });
    document.addEventListener('focusin', prefetchLink);

    return () => {
      if (prefetchTimer !== undefined) window.clearTimeout(prefetchTimer);
      document.removeEventListener('pointerover', prefetchLink);
      document.removeEventListener('focusin', prefetchLink);
    };
  }, [router]);

  return null;
}
