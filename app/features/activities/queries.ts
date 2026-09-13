import { useQuery } from '@tanstack/react-query';
import { activityKeys } from '@/app/lib/query-keys';
import {
  fetchActivities,
  fetchActivity,
  fetchDraft,
  fetchContentRevisions,
  fetchContentRevision,
  fetchMediaRevision,
  fetchPlaybackRevision,
  fetchActivityAssets,
  fetchActivityJobs,
  fetchActivityJob,
  fetchCandidate,
  fetchCheckpoints,
  fetchCapabilities,
  type ActivityListFilter,
} from './api';

export function useActivities(filters?: ActivityListFilter) {
  return useQuery({
    queryKey: activityKeys.list(filters),
    queryFn: () => fetchActivities(filters),
    staleTime: 10_000,
  });
}

export function useActivity(id?: string) {
  return useQuery({
    queryKey: activityKeys.detail(id ?? ''),
    queryFn: () => fetchActivity(id!),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useActivityDraft(id?: string) {
  return useQuery({
    queryKey: activityKeys.draft(id ?? ''),
    queryFn: () => fetchDraft(id!),
    enabled: Boolean(id),
    staleTime: 0,
  });
}

export function useActivityContentRevisions(id?: string) {
  return useQuery({
    queryKey: activityKeys.revisions(id ?? ''),
    queryFn: () => fetchContentRevisions(id!),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useActivityContentRevision(id?: string, revisionId?: string) {
  return useQuery({
    queryKey: activityKeys.revision(id ?? '', revisionId ?? ''),
    queryFn: () => fetchContentRevision(id!, revisionId!),
    enabled: Boolean(id && revisionId),
    staleTime: 60_000,
  });
}

export function useActivityMediaRevision(id?: string, mediaRevisionId?: string) {
  return useQuery({
    queryKey: activityKeys.mediaRevision(id ?? '', mediaRevisionId ?? ''),
    queryFn: () => fetchMediaRevision(id!, mediaRevisionId!),
    enabled: Boolean(id && mediaRevisionId),
    staleTime: 60_000,
  });
}

export function useActivityPlaybackRevision(id?: string, playbackRevisionId?: string) {
  return useQuery({
    queryKey: activityKeys.playbackRevision(id ?? '', playbackRevisionId ?? ''),
    queryFn: () => fetchPlaybackRevision(id!, playbackRevisionId!),
    enabled: Boolean(id && playbackRevisionId),
    staleTime: 60_000,
  });
}

export function useActivityAssets(id?: string) {
  return useQuery({
    queryKey: activityKeys.assets(id ?? ''),
    queryFn: () => fetchActivityAssets(id!),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useActivityJobs(id?: string) {
  return useQuery({
    queryKey: activityKeys.jobs(id ?? ''),
    queryFn: () => fetchActivityJobs(id!),
    enabled: Boolean(id),
    refetchInterval: (q) => q.state.data?.items.some(item => ['queued', 'preparing', 'submitting', 'accepted', 'running'].includes(item.status)) ? 3_000 : 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useActivityJob(id?: string, jobId?: string) {
  return useQuery({
    queryKey: activityKeys.job(id ?? '', jobId ?? ''),
    queryFn: () => fetchActivityJob(id!, jobId!),
    enabled: Boolean(id && jobId),
    refetchInterval: (q) => ['queued', 'running'].includes(q.state.data?.job.status ?? 'queued') ? 2_000 : false,
  });
}

export function useActivityCandidate(id?: string, candidateId?: string) {
  return useQuery({
    queryKey: activityKeys.candidate(id ?? '', candidateId ?? ''),
    queryFn: () => fetchCandidate(id!, candidateId!),
    enabled: Boolean(id && candidateId),
    staleTime: 60_000,
  });
}

export function useActivityCheckpoints(id?: string) {
  return useQuery({
    queryKey: activityKeys.checkpoints(id ?? ''),
    queryFn: () => fetchCheckpoints(id!),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useActivityCapabilities() {
  return useQuery({
    queryKey: activityKeys.capabilities(),
    queryFn: () => fetchCapabilities(),
    staleTime: 30_000,
    // 从「公共服务」配置页回到本页时立即确认最新模型状态。
    refetchOnWindowFocus: 'always',
  });
}

export function useImageConfigDraft(id?: string) {
  return useQuery({
    queryKey: activityKeys.imageConfigDraft(id ?? ''),
    queryFn: () => import('./api').then(m => m.fetchImageConfigDraft(id!)),
    enabled: Boolean(id),
    staleTime: 5_000,
  });
}

export function useImageConfigRevisions(id?: string) {
  return useQuery({
    queryKey: activityKeys.imageConfigRevisions(id ?? ''),
    queryFn: () => import('./api').then(m => m.fetchImageConfigRevisions(id!)),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useImageAttempts(id?: string, slotId?: string) {
  return useQuery({
    queryKey: activityKeys.attempts(id ?? '', slotId),
    queryFn: () => import('./api').then(m => m.fetchImageAttempts(id!, slotId)),
    enabled: Boolean(id),
    refetchInterval: (q) => q.state.data?.items.some(item => ['queued', 'preparing', 'submitting', 'accepted', 'running'].includes(item.status)) ? 3_000 : 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useImageAttempt(id?: string, attemptId?: string) {
  return useQuery({
    queryKey: activityKeys.attempt(id ?? '', attemptId ?? ''),
    queryFn: () => import('./api').then(m => m.fetchImageAttempt(id!, attemptId!)),
    enabled: Boolean(id && attemptId),
    refetchInterval: (q) => ['queued', 'preparing', 'submitting', 'accepted', 'running'].includes(q.state.data?.status ?? 'queued') ? 2_000 : false,
  });
}

export function useAssetLineage(id?: string, assetKey?: string) {
  return useQuery({
    queryKey: activityKeys.lineage(id ?? '', assetKey ?? ''),
    queryFn: () => import('./api').then(m => m.fetchAssetLineage(id!, assetKey!)),
    enabled: Boolean(id && assetKey),
    staleTime: 30_000,
  });
}

export function useSourceResolve(id?: string, sourceRefId?: string) {
  return useQuery({
    queryKey: activityKeys.sourceResolve(id ?? '', sourceRefId ?? ''),
    queryFn: () => import('./api').then(m => m.resolveImageSource(id!, sourceRefId!)),
    enabled: Boolean(id && sourceRefId),
    staleTime: 10_000,
  });
}
