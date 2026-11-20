'use client';

import { useEffect, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { WorldBranch } from '@sthstart/contracts';

export type WorkbenchView = 'overview' | 'chapters' | 'lore' | 'sandbox';
export type LedgerSubView = 'flow' | 'reading' | 'images';

const VIEWS: WorkbenchView[] = ['overview', 'chapters', 'lore', 'sandbox'];

function readViewAndSub(viewParam: string | null, subParam: string | null): {
  view: WorkbenchView;
  ledgerSub: LedgerSubView;
} {
  // 兼容旧链接：?view=flow|reading|images 归入隐藏高级沙盒调试视图
  if (viewParam === 'flow' || viewParam === 'reading' || viewParam === 'images') {
    return { view: 'sandbox', ledgerSub: viewParam };
  }
  const ledgerSub: LedgerSubView =
    subParam === 'flow' || subParam === 'images' || subParam === 'reading'
      ? subParam
      : 'reading';

  if (viewParam === 'plan' || viewParam === 'chapters') return { view: 'chapters', ledgerSub };
  if (viewParam === 'codex' || viewParam === 'lore') return { view: 'lore', ledgerSub };
  if (viewParam === 'ledger' || viewParam === 'sandbox') return { view: 'sandbox', ledgerSub };
  return { view: 'overview', ledgerSub };
}

/**
 * World, branch, and primary section live in the URL so back/forward
 * restores exact reading state. Default landing view is 'overview'.
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
  const { view, ledgerSub } = readViewAndSub(searchParams.get('view'), searchParams.get('sub'));

  const canonical = useMemo(() => {
    const next = new URLSearchParams(searchParams.toString());
    if (selectedWorldId && next.get('world') !== selectedWorldId) next.set('world', selectedWorldId);
    if (selectedBranchId && next.get('branch') !== selectedBranchId) next.set('branch', selectedBranchId);
    if (view !== 'overview' && next.get('view') !== view) next.set('view', view);
    return next.toString();
  }, [searchParams, selectedWorldId, selectedBranchId, view]);

  useEffect(() => {
    if (!selectedWorldId) return;
    if (canonical === searchParams.toString()) return;
    router.replace(pathname + (canonical ? `?${canonical}` : ''), { scroll: false });
  }, [canonical, pathname, router, searchParams, selectedWorldId]);

  const write = (patch: {
    world?: string;
    branch?: string | null;
    view?: WorkbenchView;
    sub?: LedgerSubView | null;
  }) => {
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
      if (patch.view === 'overview') next.delete('view');
      else next.set('view', patch.view);
      if (patch.view !== 'sandbox' && patch.sub === undefined) next.delete('sub');
    }
    if (patch.sub !== undefined) {
      if (patch.sub) next.set('sub', patch.sub);
      else next.delete('sub');
    }
    router.replace(pathname + (next.toString() ? `?${next.toString()}` : ''), { scroll: false });
  };

  return {
    worldId: selectedWorldId,
    branchId: selectedBranchId,
    view,
    ledgerSub,
    selectWorld: (worldId: string) => write({ world: worldId, branch: null }),
    selectBranch: (branchId: string) => write({ branch: branchId }),
    selectView: (nextView: WorkbenchView, nextSub?: LedgerSubView) =>
      write({ view: nextView, sub: nextSub }),
    selectLedgerSub: (nextSub: LedgerSubView) => write({ view: 'sandbox', sub: nextSub }),
  };
}

export function isWorkbenchView(value: string): value is WorkbenchView {
  return VIEWS.includes(value as WorkbenchView);
}
