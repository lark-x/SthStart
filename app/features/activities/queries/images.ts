import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { activityKeys, generationKeys } from '../shared/query-keys';
import { fetchGenerationPresets, fetchGenerationAssignments, fetchGenerationWorkflows } from '@/app/features/generation/api';
import {
  fetchActivityAssets,
  fetchActivityGallery,
  fetchImageConfigDraft,
  fetchImageConfigRevisions,
  fetchImageAttempts,
  fetchImageAttempt,
  fetchAssetLineage,
  resolveImageSource,
  fetchMediaBatches,
  fetchMediaBatch,
} from '../api/images';

export function useActivityAssets(id?: string) {
  return useQuery({
    queryKey: activityKeys.assets(id ?? ''),
    queryFn: () => fetchActivityAssets(id!),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useActivityGallery(id?: string) {
  return useQuery({
    queryKey: activityKeys.gallery(id ?? ''),
    queryFn: () => fetchActivityGallery(id!),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useActivityComicGenerationOptions() {
  return useQuery({
    queryKey: [...generationKeys.all, 'activity-comic-options'],
    queryFn: async () => {
      const [assignments, workflows, presets] = await Promise.all([
        fetchGenerationAssignments(),
        fetchGenerationWorkflows(),
        fetchGenerationPresets({ appId: 'activities' }),
      ]);
      const imageAssignments = assignments.filter((item) => item.app_id === 'activities' && (item.purpose.startsWith('activity_image_') || item.purpose === 'activity_media_slot'));
      return { assignments: imageAssignments, workflows, presets: presets.items.filter((item) => imageAssignments.some((assignment) => assignment.purpose === item.purpose)) };
    },
    staleTime: 20_000,
  });
}

export function useActivityGenerationPresets(enabled = true) {
  const filter = { appId: 'activities' };
  return useQuery({
    queryKey: generationKeys.presets(filter),
    queryFn: async () => (await fetchGenerationPresets(filter)).items,
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useActivityImageGenerationAssignments(enabled = true) {
  return useQuery({
    queryKey: [...generationKeys.all, 'activity-image-assignments'],
    queryFn: async () => (await fetchGenerationAssignments()).filter((item) => item.app_id === 'activities'),
    enabled,
    staleTime: 30_000,
  });
}

export function useImageConfigDraft(id?: string) {
  return useQuery({
    queryKey: activityKeys.imageConfigDraft(id ?? ''),
    queryFn: () => fetchImageConfigDraft(id!),
    enabled: Boolean(id),
    staleTime: 5_000,
  });
}

export function useImageConfigRevisions(id?: string) {
  return useQuery({
    queryKey: activityKeys.imageConfigRevisions(id ?? ''),
    queryFn: () => fetchImageConfigRevisions(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useImageAttempts(id?: string, slotId?: string) {
  return useQuery({
    queryKey: activityKeys.attempts(id ?? '', slotId),
    queryFn: () => fetchImageAttempts(id!, slotId),
    enabled: Boolean(id),
    refetchInterval: (q) => q.state.data?.items.some(item => ['queued', 'preparing', 'submitting', 'accepted', 'running'].includes(item.status)) ? 3000 : 30000,
    refetchOnWindowFocus: true,
  });
}

export function useImageAttemptPages(id?: string, slotId?: string) {
  return useInfiniteQuery({
    queryKey: [...activityKeys.attempts(id ?? '', slotId), 'pages'],
    queryFn: ({ pageParam, signal }) => fetchImageAttempts(id!, slotId, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(id),
    refetchInterval: (q) => q.state.data?.pages.some(page => page.items.some(item => ['queued', 'preparing', 'submitting', 'accepted', 'running'].includes(item.status))) ? 3_000 : 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useImageAttempt(id?: string, attemptId?: string) {
  return useQuery({
    queryKey: activityKeys.attempt(id ?? '', attemptId ?? ''),
    queryFn: () => fetchImageAttempt(id!, attemptId!),
    enabled: Boolean(id && attemptId),
    refetchInterval: (q) => ['queued', 'preparing', 'submitting', 'accepted', 'running'].includes(q.state.data?.status ?? 'queued') ? 2_000 : false,
  });
}

export function useAssetLineage(id?: string, assetKey?: string) {
  return useQuery({
    queryKey: activityKeys.lineage(id ?? '', assetKey ?? ''),
    queryFn: () => fetchAssetLineage(id!, assetKey!),
    enabled: Boolean(id && assetKey),
    staleTime: 30_000,
  });
}

export function useSourceResolve(id?: string, sourceRefId?: string) {
  return useQuery({
    queryKey: activityKeys.sourceResolve(id ?? '', sourceRefId ?? ''),
    queryFn: () => resolveImageSource(id!, sourceRefId!),
    enabled: Boolean(id && sourceRefId),
    staleTime: 10_000,
  });
}

export function useMediaBatches(id?: string) {
  return useQuery({
    queryKey: activityKeys.mediaBatches(id ?? ''),
    queryFn: () => fetchMediaBatches(id!),
    enabled: Boolean(id),
    refetchInterval: (q) =>
      q.state.data?.items.some((b) => ['preparing', 'running'].includes(b.summary?.displayState))
        ? 3_000
        : 20_000,
    refetchOnWindowFocus: true,
  });
}

export function useMediaBatch(id?: string, batchId?: string) {
  return useQuery({
    queryKey: activityKeys.mediaBatch(id ?? '', batchId ?? ''),
    queryFn: () => fetchMediaBatch(id!, batchId!),
    enabled: Boolean(id && batchId),
    refetchInterval: (q) =>
      ['preparing', 'running'].includes(q.state.data?.summary?.displayState ?? '') ? 2_000 : false,
    refetchOnWindowFocus: true,
  });
}
