import { useMutation, useQueryClient } from '@tanstack/react-query';
import { activityKeys } from '../shared/query-keys';
import type { ComicDocument, ComicStoryboardRequest } from '@sthstart/contracts';
import {
  applyComicStoryboard,
  createComicDraft,
  createComicPanelRender,
  createComicRevision,
  createComicStoryboard,
  previewComicPanelRender,
  saveComicDraft,
  selectComicPanelImage,
} from '../comic/api';

export function useCreateComicDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ activityId, contentRevisionId }: { activityId: string; contentRevisionId: string }) => createComicDraft(activityId, contentRevisionId),
    onSuccess: (draft) => queryClient.setQueryData(activityKeys.comicDraft(draft.activityId), draft),
  });
}

export function useSaveComicDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ activityId, expectedDraftVersion, document }: { activityId: string; expectedDraftVersion: number; document: ComicDocument }) =>
      saveComicDraft(activityId, expectedDraftVersion, document),
    onSuccess: (draft) => queryClient.setQueryData(activityKeys.comicDraft(draft.activityId), draft),
  });
}

export function useCreateComicRevision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ activityId, expectedDraftVersion }: { activityId: string; expectedDraftVersion: number }) => createComicRevision(activityId, expectedDraftVersion),
    onSuccess: (revision) => queryClient.invalidateQueries({ queryKey: activityKeys.comicRevisions(revision.activityId) }),
  });
}

export function useCreateComicStoryboard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ activityId, request }: { activityId: string; request: ComicStoryboardRequest }) => createComicStoryboard(activityId, request),
    onSuccess: (job) => queryClient.setQueryData(activityKeys.comicJob(job.activityId, job.id), job),
  });
}

export function useApplyComicStoryboard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ activityId, jobId, expectedDraftVersion, mode }: { activityId: string; jobId: string; expectedDraftVersion: number; mode: 'append' | 'replace_scene' }) =>
      applyComicStoryboard(activityId, jobId, { expectedDraftVersion, mode }),
    onSuccess: (result) => queryClient.setQueryData(activityKeys.comicDraft(result.draft.activityId), result.draft),
  });
}

export function usePreviewComicPanelRender() {
  return useMutation({
    mutationFn: ({ activityId, panelId, expectedDraftVersion, seed }: {
      activityId: string; panelId: string; expectedDraftVersion: number; seed: number;
    }) => previewComicPanelRender(activityId, panelId, expectedDraftVersion, seed),
  });
}

export function useCreateComicPanelRender() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ activityId, panelId, request }: {
      activityId: string; panelId: string; request: {
        expectedDraftVersion: number; planHash: string; seed: number; idempotencyKey: string;
      };
    }) => createComicPanelRender(activityId, panelId, request),
    onSuccess: (job) => {
      queryClient.setQueryData(activityKeys.comicJob(job.activityId, job.id), job);
      queryClient.invalidateQueries({ queryKey: [...activityKeys.comicDraft(job.activityId), 'jobs'] });
      queryClient.invalidateQueries({ queryKey: [...activityKeys.comicDraft(job.activityId), 'panel-history', job.panelId ?? ''] });
    },
  });
}

export function useSelectComicPanelImage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ activityId, panelId, request }: {
      activityId: string; panelId: string; request: {
        expectedDraftVersion: number; artifactId: string; allowStaleSource: boolean;
      };
    }) => selectComicPanelImage(activityId, panelId, request),
    onSuccess: (draft, variables) => {
      queryClient.setQueryData(activityKeys.comicDraft(draft.activityId), draft);
      queryClient.invalidateQueries({ queryKey: [...activityKeys.comicDraft(variables.activityId), 'panel-history', variables.panelId] });
    },
  });
}
