'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import type { WorldEvent, WorldEventPage } from '@sthstart/contracts';
import { fetchWorldEvents } from '../api';
import { storyWorldKeys } from '../query-keys';

export const ADOPTION_EVENT_PAGE_SIZE = 200;

export interface AdoptionEventRange {
  from: number;
  to: number;
}

export function useAdoptionEvents(
  worldId: string | undefined,
  branchId: string | undefined,
  range: AdoptionEventRange,
  enabled = true,
) {
  const query = useInfiniteQuery<
    WorldEventPage,
    Error,
    { pages: WorldEventPage[]; pageParams: unknown[] },
    readonly unknown[],
    string | undefined
  >({
    queryKey: [
      ...storyWorldKeys.all,
      'adoption-events',
      worldId ?? '',
      branchId ?? '',
      range.from,
      range.to,
    ],
    queryFn: ({ pageParam, signal }) => fetchWorldEvents(
      worldId!,
      branchId!,
      {
        from: range.from,
        to: range.to,
        limit: ADOPTION_EVENT_PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
      },
      signal,
    ),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(enabled && worldId && branchId),
    staleTime: 4_000,
  });

  const pagination = adoptionEventPagination(query.data?.pages);

  return {
    ...query,
    events: pagination.events,
    total: pagination.total,
    loadedCount: pagination.loadedCount,
    truncated: pagination.hasMore,
  };
}

export function adoptionEventPagination(pages: WorldEventPage[] | undefined) {
  const events = mergeAdoptionEventPages(pages);
  const lastPage = pages?.at(-1);
  return {
    events,
    loadedCount: events.length,
    total: lastPage?.total ?? 0,
    hasMore: Boolean(lastPage?.nextCursor),
  };
}

export function mergeAdoptionEventPages(pages: WorldEventPage[] | undefined): WorldEvent[] {
  if (!pages?.length) return [];
  const seen = new Set<string>();
  const items: WorldEvent[] = [];
  for (const page of pages) {
    for (const event of page.items) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      items.push(event);
    }
  }
  return items.sort((left, right) =>
    left.tick === right.tick ? left.id.localeCompare(right.id) : left.tick - right.tick);
}
