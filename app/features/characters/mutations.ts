import { useMutation, useQueryClient } from '@tanstack/react-query';
import { characterKeys } from '@/app/lib/query-keys';
import {
  createCharacter,
  updateCharacter,
  generateCharacterDraft,
  publishCharacter,
  uploadCharacterAvatar,
  uploadCharacterAsset,
  previewCharacterOfficialAssets,
  importCharacterAssets,
  setCharacterActiveAsset,
  matchOfficialAvatar,
  batchMatchOfficialAvatars,
  fetchAvatarFromUrl,
  importTavernCard,
  saveCharacterRelationship,
  deleteCharacterRelationship,
  generateCharacterAvatar,
  applyCharacterAvatar,
} from './api';
import type { CharacterDraftAny, CharacterVariant } from '@sthstart/contracts';

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
    mutationFn: ({ id, draft, tags, variants, avatarAssetId, expectedDraftRevision }: { id: string; draft: CharacterDraftAny; tags: string[]; variants?: CharacterVariant[]; avatarAssetId?: string | null; expectedDraftRevision?: number }) =>
      updateCharacter(id, { draft, tags, variants, avatarAssetId, expectedDraftRevision }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: characterKeys.all });
      queryClient.invalidateQueries({ queryKey: characterKeys.detail(data.id) });
    },
  });
}

export function useMatchOfficialAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => matchOfficialAvatar(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: characterKeys.all });
      queryClient.invalidateQueries({ queryKey: characterKeys.detail(id) });
    },
  });
}

export function useFetchAvatarFromUrl() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, url }: { id: string; url: string }) => fetchAvatarFromUrl(id, url),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: characterKeys.all });
      queryClient.invalidateQueries({ queryKey: characterKeys.detail(variables.id) });
    },
  });
}

export function useBatchMatchOfficialAvatars() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { ids?: string[]; onlyMissing?: boolean }) => batchMatchOfficialAvatars(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: characterKeys.all });
    },
  });
}

export function useGenerateCharacterDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, description, useWeb }: { id: string; description: string; useWeb?: boolean }) =>
      generateCharacterDraft(id, description, useWeb),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: characterKeys.detail(variables.id) });
    },
  });
}

export function usePublishCharacter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expectedDraftRevision }: { id: string; expectedDraftRevision?: number }) => publishCharacter(id, expectedDraftRevision),
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

export function useUploadCharacterAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file, kind, setAsActive }: { id: string; file: File; kind?: 'avatar' | 'portrait' | 'reference'; setAsActive?: boolean }) =>
      uploadCharacterAsset(id, file, kind, setAsActive),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: characterKeys.all });
      queryClient.invalidateQueries({ queryKey: characterKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: characterKeys.assets(variables.id) });
    },
  });
}

export function usePreviewCharacterOfficialAssets() {
  return useMutation({
    mutationFn: (id: string) => previewCharacterOfficialAssets(id),
  });
}

export function useImportCharacterAssets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: import('@sthstart/contracts').CharacterImportAssetsRequest }) =>
      importCharacterAssets(id, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: characterKeys.all });
      queryClient.invalidateQueries({ queryKey: characterKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: characterKeys.assets(variables.id) });
    },
  });
}

export function useSetCharacterActiveAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: import('@sthstart/contracts').CharacterSetActiveAssetRequest }) =>
      setCharacterActiveAsset(id, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: characterKeys.all });
      queryClient.invalidateQueries({ queryKey: characterKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: characterKeys.assets(variables.id) });
    },
  });
}
