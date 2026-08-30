'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const primaryRoutes = [
  '/apps/notebook',
  '/apps/characters',
  '/apps/narrative',
  '/apps/creative',
  '/settings/control-center',
  '/settings/public-services',
] as const;

export function RoutePreloader() {
  const router = useRouter();

  useEffect(() => {
    const prefetchPrimaryRoutes = () => {
      for (const route of primaryRoutes) router.prefetch(route);
    };
    const browserWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const idleHandle = browserWindow.requestIdleCallback?.(prefetchPrimaryRoutes, { timeout: 2_000 });
    const timeoutHandle = idleHandle === undefined ? window.setTimeout(prefetchPrimaryRoutes, 800) : undefined;

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
    document.addEventListener('touchstart', prefetchLink, { passive: true });

    return () => {
      if (idleHandle !== undefined) browserWindow.cancelIdleCallback?.(idleHandle);
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
      if (prefetchTimer !== undefined) window.clearTimeout(prefetchTimer);
      document.removeEventListener('pointerover', prefetchLink);
      document.removeEventListener('touchstart', prefetchLink);
    };
  }, [router]);

  return null;
}
