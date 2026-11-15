import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { activityKeys } from '../shared/query-keys';
import {
  fetchComicDraft,
  fetchComicJob,
  fetchComicJobs,
  fetchComicRevisions,
  fetchComicPanelHistory,
} from '../comic/api';

export function useComicDraftRecord(id?: string) {
  return useQuery({
    queryKey: activityKeys.comicDraft(id ?? ''),
    queryFn: () => fetchComicDraft(id!),
    enabled: Boolean(id),
    staleTime: 0,
  });
}

export function useComicRevisions(id?: string) {
  return useQuery({
    queryKey: activityKeys.comicRevisions(id ?? ''),
    queryFn: () => fetchComicRevisions(id!),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useComicJobs(id?: string) {
  return useQuery({
    queryKey: [...activityKeys.comicDraft(id ?? ''), 'jobs'],
    queryFn: () => fetchComicJobs(id!),
    enabled: Boolean(id),
    staleTime: 0,
    refetchInterval: (query) => query.state.data?.items.some((job) => ['queued', 'preparing', 'running'].includes(job.status)) ? 1_000 : false,
  });
}

export function useComicJob(id?: string, jobId?: string) {
  return useQuery({
    queryKey: activityKeys.comicJob(id ?? '', jobId ?? ''),
    queryFn: () => fetchComicJob(id!, jobId!),
    enabled: Boolean(id && jobId),
    staleTime: 0,
    refetchInterval: (query) => ['queued', 'preparing', 'running'].includes(query.state.data?.status ?? '') ? 1_000 : false,
  });
}

export function useComicPanelHistory(id?: string, panelId?: string) {
  return useInfiniteQuery({
    queryKey: [...activityKeys.comicDraft(id ?? ''), 'panel-history', panelId ?? ''],
    queryFn: ({ pageParam }) => fetchComicPanelHistory(id!, panelId!, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(id && panelId),
    staleTime: 0,
    refetchInterval: (query) => query.state.data?.pages[0]?.jobs.some((job) => job.panelId === panelId && ['queued', 'preparing', 'running'].includes(job.status)) ? 2_000 : false,
  });
}
