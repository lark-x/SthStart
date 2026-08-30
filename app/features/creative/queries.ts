import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { creativeKeys } from '@/app/lib/query-keys';
import { fetchCreativeArtifacts, fetchCreativeStatus, fetchCreativeTasks } from './api';

export function useCreativeStatus() {
  return useQuery({
    queryKey: creativeKeys.status(),
    queryFn: fetchCreativeStatus,
    refetchInterval: 10_000,
    staleTime: 3_000,
  });
}

export function useCreativeTasks() {
  return useQuery({
    queryKey: creativeKeys.tasks(),
    queryFn: fetchCreativeTasks,
    refetchInterval: (query) => {
      const tasks = query.state.data ?? [];
      return tasks.some((task) => ['queued', 'submitting', 'accepted', 'running'].includes(task.status)) ? 2_000 : 10_000;
    },
    staleTime: 1_000,
  });
}

export function useCreativeArtifacts() {
  return useInfiniteQuery({
    queryKey: creativeKeys.artifacts(),
    queryFn: ({ pageParam }) => fetchCreativeArtifacts(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.nextOffset < lastPage.total ? lastPage.nextOffset : undefined,
    refetchInterval: 10_000,
    staleTime: 3_000,
  });
}
