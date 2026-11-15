'use client';

import { useEffect, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { WorldBranch } from '@sthstart/contracts';

export type WorkbenchView = 'flow' | 'reading' | 'images';

const VIEWS: WorkbenchView[] = ['flow', 'reading', 'images'];

function readView(value: string | null): WorkbenchView {
  if (value === 'reading' || value === 'images' || value === 'flow') return value;
  if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 1024px)').matches) {
    return 'reading';
  }
  return 'flow';
}

/**
 * World and branch live in the URL so back/forward and copied links restore the
 * same workbench. The first world/branch is selected only when the URL has no
 * usable value; choosing a world clears a branch that belongs to another world.
 */
export function useWorkbenchUrl(
  worlds: Array<{ id: string }>,
  branches: WorldBranch[],
) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const worldParam = searchParams.get('world')?.trim() ?? '';
  const branchParam = searchParams.get('branch')?.trim() ?? '';
  const selectedWorldId = worlds.some((world) => world.id === worldParam)
    ? worldParam
    : worlds[0]?.id ?? '';
  const selectedBranch = branches.find((branch) => branch.id === branchParam)
    ?? branches[0]
    ?? null;
  const selectedBranchId = selectedBranch?.id ?? '';
  const view = readView(searchParams.get('view'));

  const canonical = useMemo(() => {
    const next = new URLSearchParams(searchParams.toString());
    if (selectedWorldId && next.get('world') !== selectedWorldId) next.set('world', selectedWorldId);
    if (selectedBranchId && next.get('branch') !== selectedBranchId) next.set('branch', selectedBranchId);
    if (view !== 'flow' && next.get('view') !== view) next.set('view', view);
    return next.toString();
  }, [searchParams, selectedWorldId, selectedBranchId, view]);

  useEffect(() => {
    if (!selectedWorldId) return;
    if (canonical === searchParams.toString()) return;
    router.replace(pathname + (canonical ? `?${canonical}` : ''), { scroll: false });
  }, [canonical, pathname, router, searchParams, selectedWorldId]);

  const write = (patch: { world?: string; branch?: string | null; view?: WorkbenchView }) => {
    const next = new URLSearchParams(searchParams.toString());
    if (patch.world !== undefined) {
      if (patch.world) next.set('world', patch.world);
      else next.delete('world');
      if (patch.branch === undefined) next.delete('branch');
    }
    if (patch.branch !== undefined) {
      if (patch.branch) next.set('branch', patch.branch);
      else next.delete('branch');
    }
    if (patch.view !== undefined) {
      next.set('view', patch.view);
    }
    router.replace(pathname + (next.toString() ? `?${next.toString()}` : ''), { scroll: false });
  };

  return {
    worldId: selectedWorldId,
    branchId: selectedBranchId,
    view,
    selectWorld: (worldId: string) => write({ world: worldId, branch: null }),
    selectBranch: (branchId: string) => write({ branch: branchId }),
    selectView: (nextView: WorkbenchView) => write({ view: nextView }),
  };
}

export function isWorkbenchView(value: string): value is WorkbenchView {
  return VIEWS.includes(value as WorkbenchView);
}
