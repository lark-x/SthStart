import { useMutation, useQueryClient } from '@tanstack/react-query';
import { activityKeys } from '@/app/lib/query-keys';
import {
  createActivity,
  updateActivity,
  deleteActivity,
  duplicateActivity,
  saveDraft,
  commitDraft,
  saveMediaRevision,
  savePlaybackRevision,
  generateAutoPlayback,
  uploadActivityAsset,
  linkArtifactToActivity,
  createMediaGenerationTask,
  syncMediaGenerationOutputs,
  triggerTextGeneration,
  adoptCandidate,
  createCheckpoint,
  restoreCheckpoint,
  stageActivityZip,
  commitActivityImport,
  saveImageConfigDraft,
  commitImageConfigRevision,
  preparePromptRecipe,
  createImageAttempt,
  retryImageAttempt,
  cancelImageAttempt,
  previewImageImpact,
  type CreateActivityInput,
} from './api';
import type { Activity, ContentDocument, MediaRevisionDocument, PlaybackDocument, ImageConfigDocument } from '@sthstart/contracts';

export function useCreateActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateActivityInput) => createActivity(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: activityKeys.all });
    },
  });
}

export function useUpdateActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      expectedHeadVersion,
      patch,
    }: {
      id: string;
      expectedHeadVersion: number;
      patch: Partial<Pick<Activity, 'title' | 'type' | 'theme' | 'location' | 'rules' | 'archived'>>;
    }) => updateActivity(id, expectedHeadVersion, patch),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.list() });
    },
  });
}

export function useDeleteActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteActivity(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: activityKeys.all });
    },
  });
}

export function useDuplicateActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      options,
    }: {
      id: string;
      options?: { title?: string; scope?: 'settings' | 'adopted' };
    }) => duplicateActivity(id, options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: activityKeys.all });
    },
  });
}

export function useSaveDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      expectedDraftVersion,
      document,
    }: {
      id: string;
      expectedDraftVersion: number;
      document: ContentDocument;
    }) => saveDraft(id, expectedDraftVersion, document),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.draft(variables.id) });
    },
  });
}

export function useCommitDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      expectedHeadVersion,
      expectedDraftVersion,
    }: {
      id: string;
      expectedHeadVersion: number;
      expectedDraftVersion?: number;
    }) => commitDraft(id, expectedHeadVersion, expectedDraftVersion),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.draft(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.revisions(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.list() });
    },
  });
}

export function useSaveMediaRevision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      contentRevisionId,
      slotBindings,
    }: {
      id: string;
      contentRevisionId: string;
      slotBindings: MediaRevisionDocument['slotBindings'];
    }) => saveMediaRevision(id, contentRevisionId, slotBindings),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.mediaRevision(variables.id, '') });
    },
  });
}

export function useSavePlaybackRevision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      contentRevisionId,
      mediaRevisionId,
      document,
    }: {
      id: string;
      contentRevisionId: string;
      mediaRevisionId: string;
      document: PlaybackDocument;
    }) => savePlaybackRevision(id, contentRevisionId, mediaRevisionId, document),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.playbackRevision(variables.id, '') });
    },
  });
}

export function useGenerateAutoPlayback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      options,
    }: {
      id: string;
      options?: {
        contentRevisionId?: string;
        mediaRevisionId?: string;
        viewerActorId?: string;
        speed?: number;
        autoPlay?: boolean;
      };
    }) => generateAutoPlayback(id, options),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.detail(variables.id) });
    },
  });
}

export function useUploadActivityAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      file,
      customAssetKey,
    }: {
      id: string;
      file: File | Blob;
      customAssetKey?: string;
    }) => uploadActivityAsset(id, file, customAssetKey),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.assets(variables.id) });
    },
  });
}

export function useLinkArtifactToActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      artifactId,
      customAssetKey,
    }: {
      id: string;
      artifactId: string;
      customAssetKey?: string;
    }) => linkArtifactToActivity(id, artifactId, customAssetKey),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.assets(variables.id) });
    },
  });
}

export function useCreateMediaGenerationTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: {
        contentRevisionId: string;
        slotId: string;
        slotFingerprint: string;
        workflowId?: string;
        workflowVersion?: number;
        inputs?: Record<string, unknown>;
      };
    }) => createMediaGenerationTask(id, input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.jobs(variables.id) });
    },
  });
}

export function useSyncMediaGenerationOutputs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, taskId }: { id: string; taskId: string }) =>
      syncMediaGenerationOutputs(id, taskId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.assets(variables.id) });
    },
  });
}

export function useTriggerTextGeneration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: {
        mode: 'plan' | 'stage' | 'rewrite-records' | 'whole-text';
        targetRevisionId?: string;
        scope?: Record<string, unknown>;
        userInstruction?: string;
        idempotencyKey?: string;
      };
    }) => triggerTextGeneration(id, input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.jobs(variables.id) });
    },
  });
}

export function useAdoptCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      candidateId,
      expectedHeadVersion,
    }: {
      id: string;
      candidateId: string;
      expectedHeadVersion: number;
    }) => adoptCandidate(id, candidateId, expectedHeadVersion),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.draft(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.revisions(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.candidate(variables.id, variables.candidateId) });
      queryClient.invalidateQueries({ queryKey: activityKeys.jobs(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.list() });
    },
  });
}

export function useCreateCheckpoint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => createCheckpoint(id, name),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.checkpoints(variables.id) });
    },
  });
}

export function useRestoreCheckpoint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, checkpointId }: { id: string; checkpointId: string }) =>
      restoreCheckpoint(id, checkpointId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.draft(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.revisions(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.checkpoints(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.list() });
    },
  });
}

export function useStageActivityZip() {
  return useMutation({
    mutationFn: (file: File | Blob) => stageActivityZip(file),
  });
}

export function useCommitActivityImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (importId: string) => commitActivityImport(importId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: activityKeys.all });
    },
  });
}

export function useSaveImageConfigDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, document }: { id: string; document: ImageConfigDocument }) =>
      saveImageConfigDraft(id, document),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.imageConfigDraft(variables.id) });
    },
  });
}

export function useCommitImageConfigRevision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, document }: { id: string; document: ImageConfigDocument }) =>
      commitImageConfigRevision(id, document),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.imageConfigDraft(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.imageConfigRevisions(variables.id) });
    },
  });
}

export function usePreparePromptRecipe() {
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: {
        contentRevisionId: string;
        imageConfigRevisionId?: string;
        slotId: string;
        expectedHeadVersion?: number;
        overrides?: Array<{ id: string; fieldPath: string; overrideText: string; reason?: string }>;
        references?: import('@sthstart/contracts').ReferenceInput[];
      customParams?: Record<string, unknown>;
      };
    }) => preparePromptRecipe(id, input),
  });
}

export function useCreateImageAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: {
        contentRevisionId: string;
        imageConfigRevisionId: string;
        slotId: string;
        recipeId: string;
        compilationId: string;
        executionPlanHash: string;
        expectedHeadVersion?: number;
        seed?: number;
        retryOfAttemptId?: string;
        parentAttemptIds?: string[];
        idempotencyKey?: string;
      };
    }) => createImageAttempt(id, input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.attempts(variables.id, variables.input.slotId) });
      queryClient.invalidateQueries({ queryKey: activityKeys.candidates(variables.id) });
    },
  });
}

export function useRetryImageAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, attemptId }: { id: string; attemptId: string }) =>
      retryImageAttempt(id, attemptId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.attempts(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.attempt(variables.id, variables.attemptId) });
    },
  });
}

export function useCancelImageAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, attemptId }: { id: string; attemptId: string }) =>
      cancelImageAttempt(id, attemptId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.attempts(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.attempt(variables.id, variables.attemptId) });
    },
  });
}

export function usePreviewImageImpact() {
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: {
        changedEntityKind: string;
        changedEntityId: string;
        fieldPath: string;
        newValue: unknown;
      };
    }) => previewImageImpact(id, input),
  });
}
