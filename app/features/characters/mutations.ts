import { useMutation, useQueryClient } from '@tanstack/react-query';
import { characterKeys } from '@/app/lib/query-keys';
import {
  createCharacter,
  updateCharacter,
  generateCharacterDraft,
  publishCharacter,
  uploadCharacterAvatar,
  importTavernCard,
  saveCharacterRelationship,
  deleteCharacterRelationship,
  generateCharacterAvatar,
  applyCharacterAvatar,
} from './api';
import type { CharacterDraft } from '@sthstart/contracts';

export function useCreateCharacter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCharacter,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: characterKeys.all });
    },
  });
}

export function useUpdateCharacter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, draft, tags }: { id: string; draft: CharacterDraft; tags: string[] }) =>
      updateCharacter(id, { draft, tags }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: characterKeys.all });
      queryClient.invalidateQueries({ queryKey: characterKeys.detail(data.id) });
    },
  });
}

export function useGenerateCharacterDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, description }: { id: string; description: string }) =>
      generateCharacterDraft(id, description),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: characterKeys.detail(variables.id) });
    },
  });
}

export function usePublishCharacter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: publishCharacter,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: characterKeys.all });
      queryClient.invalidateQueries({ queryKey: characterKeys.detail(data.characterId) });
    },
  });
}

export function useUploadCharacterAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => uploadCharacterAvatar(id, file),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: characterKeys.all });
      queryClient.invalidateQueries({ queryKey: characterKeys.detail(variables.id) });
    },
  });
}

export function useGenerateCharacterAvatar() {
  return useMutation({ mutationFn: ({ id, prompt }: { id: string; prompt?: string }) => generateCharacterAvatar(id, prompt) });
}

export function useApplyCharacterAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, taskId }: { id: string; taskId: string }) => applyCharacterAvatar(id, taskId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: characterKeys.all });
      queryClient.invalidateQueries({ queryKey: characterKeys.detail(variables.id) });
    },
  });
}

export function useImportTavernCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importTavernCard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: characterKeys.all });
    },
  });
}

export function useSaveRelationship() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      characterId,
      relationship,
    }: {
      characterId: string;
      relationship: { toCharacterId: string; relationType: string; description: string };
    }) => saveCharacterRelationship(characterId, relationship),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: characterKeys.detail(variables.characterId) });
    },
  });
}

export function useDeleteRelationship() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      characterId,
      relationshipId,
    }: {
      characterId: string;
      relationshipId: string;
    }) => deleteCharacterRelationship(characterId, relationshipId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: characterKeys.detail(variables.characterId) });
    },
  });
}
