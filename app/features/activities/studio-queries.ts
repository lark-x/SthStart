'use client';

import { useEffect } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StudioJob } from '@sthstart/contracts';
import { fetchStudioJob, fetchStudioJobs,fetchStudioItems } from './studio-api';
import { activityKeys } from '@/app/lib/query-keys';

export const studioKeys = {
  jobs: (activityId: string) => ['activity-studio-jobs', activityId] as const,
  job: (activityId: string, jobId: string) => ['activity-studio-job', activityId, jobId] as const,
  items:(activityId:string,jobId:string)=>['activity-studio-items',activityId,jobId] as const,
};
export const isStudioJobActive = (job: StudioJob) => ['queued', 'preparing', 'running'].includes(job.status);
export function useStudioJobs(activityId: string, enabled: boolean) {
  const cache = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => { if (!document.hidden) void cache.invalidateQueries({ queryKey: studioKeys.jobs(activityId) }); };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [activityId, enabled, cache]);
  return useInfiniteQuery({ queryKey: studioKeys.jobs(activityId), enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchStudioJobs(activityId, pageParam),
    getNextPageParam: page => page.nextCursor ?? undefined,
    refetchInterval: query => query.state.data?.pages.some(page => page.items.some(isStudioJobActive)) ?
      (typeof document !== 'undefined' && document.hidden ? 10_000 : 2000) : false,
    refetchIntervalInBackground: true,
  });
}
export function useStudioJob(activityId: string, jobId: string | null, enabled: boolean) {
  const cache = useQueryClient();
  useEffect(() => {
    if (!enabled || !jobId) return;
    const refresh = () => { if (!document.hidden) void cache.invalidateQueries({ queryKey: studioKeys.job(activityId, jobId) }); };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [activityId, jobId, enabled, cache]);
  const query=useQuery({ queryKey: studioKeys.job(activityId, jobId ?? ''), enabled: enabled && Boolean(jobId),
    queryFn: () => fetchStudioJob(activityId, jobId!),
    refetchInterval: query => query.state.data && isStudioJobActive(query.state.data) ?
      (typeof document !== 'undefined' && document.hidden ? 10_000 : 2000) : false,
    refetchIntervalInBackground: true,
  });
  const renderedRevision=query.data?.kind==='render_batch' ? `${query.data.id}:${query.data.revision}` : null;
  useEffect(()=>{
    if(!renderedRevision)return;
    if(jobId)void cache.invalidateQueries({queryKey:studioKeys.items(activityId,jobId)});
    // Refresh histories only on a new recorded state, not on every polling response.
    void cache.invalidateQueries({queryKey:['activity-beat-renders',activityId]});
    const comicKey=activityKeys.comicDraft(activityId);
    void cache.invalidateQueries({predicate:entry=>comicKey.every((part,index)=>entry.queryKey[index]===part)&&entry.queryKey[comicKey.length]==='panel-history'});
  },[renderedRevision,activityId,jobId,cache]);
  return query;
}
export function useStudioItems(activityId:string,job:StudioJob|null){
  return useInfiniteQuery({queryKey:studioKeys.items(activityId,job?.id ?? ''),enabled:Boolean(job),initialPageParam:undefined as string|undefined,
    queryFn:({pageParam})=>fetchStudioItems(activityId,job!.id,pageParam),getNextPageParam:page=>page.nextCursor ?? undefined});
}
