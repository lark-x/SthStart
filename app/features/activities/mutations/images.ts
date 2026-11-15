import { useMutation, useQueryClient } from '@tanstack/react-query';
import { activityKeys } from '../shared/query-keys';
import {
  uploadActivityAsset,
  linkArtifactToActivity,
  createMediaGenerationTask,
  syncMediaGenerationOutputs,
  saveImageConfigDraft,
  commitImageConfigRevision,
  preparePromptRecipe,
  createImageAttempt,
  retryImageAttempt,
  cancelImageAttempt,
  previewImageImpact,
  prepareMediaBatch,
  createMediaBatch,
  cancelMediaBatch,
  retryFailedBatchItems,
} from '../api/images';
import type {
  ImageConfigDocument,
  PreparePromptRecipeRequest,
  PrepareMediaBatchInput,
  CreateMediaBatchInput,
} from '@sthstart/contracts';

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

export function useSaveImageConfigDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, document, expectedDraftVersion }: { id: string; document: ImageConfigDocument; expectedDraftVersion?: number }) =>
      saveImageConfigDraft(id, document, expectedDraftVersion),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.imageConfigDraft(variables.id) });
    },
  });
}

export function useCommitImageConfigRevision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, document, expectedDraftVersion, expectedHeadVersion }: { id: string; document: ImageConfigDocument; expectedDraftVersion?: number; expectedHeadVersion?: number }) =>
      commitImageConfigRevision(id, document, expectedDraftVersion, expectedHeadVersion),
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
      input: PreparePromptRecipeRequest;
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
    mutationFn: ({ id, attemptId, seed }: { id: string; attemptId: string; seed?: number }) =>
      retryImageAttempt(id, attemptId, seed),
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

export function usePrepareMediaBatch() {
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: PrepareMediaBatchInput;
    }) => prepareMediaBatch(id, input),
  });
}

export function useCreateMediaBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: CreateMediaBatchInput;
    }) => createMediaBatch(id, input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.mediaBatches(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.attempts(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.production(variables.id) });
    },
  });
}

export function useCancelMediaBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      batchId,
    }: {
      id: string;
      batchId: string;
    }) => cancelMediaBatch(id, batchId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.mediaBatches(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.mediaBatch(variables.id, variables.batchId) });
      queryClient.invalidateQueries({ queryKey: activityKeys.attempts(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.production(variables.id) });
    },
  });
}

export function useRetryFailedBatchItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      batchId,
      itemIds,
    }: {
      id: string;
      batchId: string;
      itemIds?: string[];
    }) => retryFailedBatchItems(id, batchId, itemIds),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.mediaBatches(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.mediaBatch(variables.id, variables.batchId) });
      queryClient.invalidateQueries({ queryKey: activityKeys.attempts(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.production(variables.id) });
    },
  });
}
