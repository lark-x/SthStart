import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type {
  WorldBranch,
  WorldEvent,
  WorldEventPage,
  WorldEventQuery,
} from '@sthstart/contracts';
import {
  fetchWorldBranch,
  fetchWorldEvents,
  fetchWorldHub,
  fetchWorldMemories,
  fetchWorldOverview,
  fetchWorldProjectBinding,
  fetchWorlds,
  fetchRunRecovery,
  fetchUncertainGenerationTasks,
} from './api';
import { storyWorldKeys } from './query-keys';
import { branchPollInterval } from './hooks/world-format';

const ACTIVE_RUN_STATUSES = new Set(['queued', 'running']);

export function isRunActive(status: string | undefined | null) {
  return Boolean(status && ACTIVE_RUN_STATUSES.has(status));
}

export function useStoryWorlds() {
  return useQuery({
    queryKey: storyWorldKeys.list(),
    queryFn: fetchWorlds,
    staleTime: 20_000,
  });
}

export function useStoryWorldOverview(worldId?: string) {
  return useQuery({
    queryKey: storyWorldKeys.overview(worldId ?? ''),
    queryFn: () => fetchWorldOverview(worldId!),
    enabled: Boolean(worldId),
    staleTime: 10_000,
  });
}

export function useWorldHub(worldId?: string, branchId?: string) {
  return useQuery({
    queryKey: storyWorldKeys.hub(worldId ?? '', branchId),
    queryFn: () => fetchWorldHub(worldId!, branchId),
    enabled: Boolean(worldId),
    staleTime: 10_000,
  });
}

export function useWorldBranchDetail(worldId?: string, branchId?: string) {
  return useQuery({
    queryKey: storyWorldKeys.branch(worldId ?? '', branchId ?? ''),
    queryFn: () => fetchWorldBranch(worldId!, branchId!),
    enabled: Boolean(worldId && branchId),
    staleTime: 2_000,
    refetchInterval: (query) => branchPollInterval(
      query.state.data?.run?.status,
      query.state.data?.images,
    ),
  });
}

export function useWorldEventPages(
  worldId: string | undefined,
  branchId: string | undefined,
  query: WorldEventQuery,
  poll = false,
) {
  return useInfiniteQuery<WorldEventPage, Error, { pages: WorldEventPage[]; pageParams: unknown[] }, readonly unknown[], string | undefined>({
    queryKey: storyWorldKeys.events(worldId ?? '', branchId ?? '', query),
    queryFn: ({ pageParam, signal }) =>
      fetchWorldEvents(
        worldId!,
        branchId!,
        { ...query, cursor: pageParam },
        signal,
      ),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(worldId && branchId),
    staleTime: 4_000,
    refetchInterval: poll ? 6_000 : false,
  });
}

export function useWorldMemories(
  worldId: string | undefined,
  branchId: string | undefined,
  actorId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: storyWorldKeys.memories(worldId ?? '', branchId ?? '', actorId),
    queryFn: () => fetchWorldMemories(worldId!, branchId!, actorId),
    enabled: Boolean(enabled && worldId && branchId && actorId),
    staleTime: 10_000,
  });
}

async function fetchAllBranchEvents(worldId: string, branch: WorldBranch): Promise<{ items: WorldEvent[]; total: number; truncated: boolean }> {
  const cap = 1_000;
  const seen = new Set<string>();
  const items: WorldEvent[] = [];
  let cursor: string | undefined;
  let total = 0;
  do {
    const page = await fetchWorldEvents(worldId, branch.id, {
      from: 0,
      to: Math.max(branch.currentTick, 0),
      limit: 200,
      cursor,
    });
    total = page.total;
    for (const event of page.items) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      items.push(event);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor && items.length < cap);
  items.sort((left, right) => left.tick - right.tick || left.createdAt.localeCompare(right.createdAt));
  return { items: items.slice(0, cap), total, truncated: Boolean(cursor) || items.length < total };
}

export function useWorldComparisonBranch(
  worldId: string | undefined,
  branch: WorldBranch | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: storyWorldKeys.comparison(worldId ?? '', branch?.id ?? ''),
    queryFn: () => fetchAllBranchEvents(worldId!, branch!),
    enabled: Boolean(enabled && worldId && branch),
    staleTime: 15_000,
  });
}

export function useWorldProjectBinding(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: storyWorldKeys.projectBinding(projectId ?? ''),
    queryFn: () => fetchWorldProjectBinding(projectId!),
    enabled: Boolean(enabled && projectId),
    staleTime: 15_000,
  });
}

export function useWorldRunRecovery(
  worldId: string | undefined,
  branchId: string | undefined,
  runId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: storyWorldKeys.runRecovery(worldId ?? '', branchId ?? '', runId ?? ''),
    queryFn: () => fetchRunRecovery(worldId!, branchId!, runId!),
    enabled: Boolean(enabled && worldId && branchId && runId),
    staleTime: 4_000,
  });
}

export function useUncertainGenerationTasks(appId?: string, enabled = true) {
  return useQuery({
    queryKey: storyWorldKeys.uncertainGeneration(appId),
    queryFn: () => fetchUncertainGenerationTasks(appId ? { appId } : {}),
    enabled,
    staleTime: 5_000,
  });
}
