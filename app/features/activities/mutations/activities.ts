import { useMutation, useQueryClient } from '@tanstack/react-query';
import { activityKeys } from '../shared/query-keys';
import {
  createActivity,
  updateActivity,
  deleteActivity,
  duplicateActivity,
  saveDraft,
  commitDraft,
  saveMediaRevision,
  triggerTextGeneration,
  adoptCandidate,
  adoptCandidateBatch,
  createCheckpoint,
  restoreCheckpoint,
  stageActivityZip,
  commitActivityImport,
  createActivityPreset,
  updateActivityPreset,
  deleteActivityPreset,
  instantiateActivityTemplate,
} from '../api/activities';
import type {
  Activity,
  ContentDocument,
  MediaRevisionDocument,
  AdoptCandidateBatchInput,
  CreateActivityPresetInput,
  UpdateActivityPresetInput,
  InstantiateTemplateInput,
} from '@sthstart/contracts';
import type { CreateActivityInput } from '../shared/types';

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

export function useTriggerTextGeneration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: {
        mode: 'plan' | 'stage' | 'rewrite-records' | 'whole-text' | 'invite' | 'wish' | 'moment' | 'shot' | 'continue-chat';
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
      queryClient.invalidateQueries({ queryKey: activityKeys.production(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.list() });
    },
  });
}

export function useAdoptCandidateBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: AdoptCandidateBatchInput;
    }) => adoptCandidateBatch(id, input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.draft(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.revisions(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.candidates(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.jobs(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.production(variables.id) });
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

export function useCreateActivityPreset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateActivityPresetInput) => createActivityPreset(input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.presets() });
      queryClient.invalidateQueries({ queryKey: activityKeys.presets(data.kind) });
    },
  });
}

export function useUpdateActivityPreset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateActivityPresetInput }) =>
      updateActivityPreset(id, input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.presets() });
      queryClient.invalidateQueries({ queryKey: activityKeys.presets(data.kind) });
      queryClient.invalidateQueries({ queryKey: activityKeys.preset(data.id) });
    },
  });
}

export function useDeleteActivityPreset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteActivityPreset(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: activityKeys.presets() });
    },
  });
}

export function useInstantiateActivityTemplate() {
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: InstantiateTemplateInput }) =>
      instantiateActivityTemplate(id, input),
  });
}
