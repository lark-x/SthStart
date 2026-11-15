'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/** 深链接打开的浮层关闭后，从地址栏去掉这些参数，刷新时不会再次弹出。 */
export const DEEP_LINK_PARAMS = ['tab', 'view', 'mode', 'panel', 'recordView', 'actorId', 'stageId', 'factId', 'recordId', 'jobId', 'slotId', 'batchId', 'reworkSlots'];

export function useStudioDeepLink({
  documentReady,
  search,
  applyRoute,
}: {
  documentReady: boolean;
  search: string;
  applyRoute: (search: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const appliedSearch = useRef<string | null>(null);
  const applyRouteRef = useRef(applyRoute);
  useEffect(() => { applyRouteRef.current = applyRoute; });

  useEffect(() => {
    if (!documentReady || appliedSearch.current === search) return;
    appliedSearch.current = search;
    applyRouteRef.current(search);
  }, [documentReady, search]);

  const clearDeepLink = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    if (!DEEP_LINK_PARAMS.some((key) => params.has(key))) return;
    for (const key of DEEP_LINK_PARAMS) params.delete(key);
    const next = params.toString();
    appliedSearch.current = next;
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [pathname, router]);

  return { clearDeepLink };
}
