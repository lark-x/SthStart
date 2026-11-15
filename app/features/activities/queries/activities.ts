import { useQuery } from '@tanstack/react-query';
import { activityKeys } from '../shared/query-keys';
import {
  fetchActivities,
  fetchActivity,
  fetchDraft,
  fetchContentRevisions,
  fetchContentRevision,
  fetchMediaRevision,
  fetchActivityJobs,
  fetchActivityJob,
  fetchCandidate,
  fetchCheckpoints,
  fetchCapabilities,
  fetchActivityProductionOverview,
  fetchActivityPresets,
  fetchActivityPreset,
} from '../api/activities';
import type { ActivityPresetKind } from '@sthstart/contracts';
import type { ActivityListFilter } from '../shared/types';

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
    refetchInterval: (q) => ['queued', 'preparing', 'submitting', 'accepted', 'running'].includes(q.state.data?.job.status ?? 'queued') ? 2_000 : false,
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

export function useActivityProductionOverview(id?: string) {
  return useQuery({
    queryKey: activityKeys.production(id ?? ''),
    queryFn: () => fetchActivityProductionOverview(id!),
    enabled: Boolean(id),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
}

export function useActivityPresets(kind?: ActivityPresetKind) {
  return useQuery({
    queryKey: activityKeys.presets(kind),
    queryFn: () => fetchActivityPresets(kind),
    staleTime: 10_000,
  });
}

export function useActivityPreset(id?: string) {
  return useQuery({
    queryKey: activityKeys.preset(id ?? ''),
    queryFn: () => fetchActivityPreset(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}
