import { useMutation, useQueryClient } from '@tanstack/react-query';
import { providerKeys, runtimeKeys } from '@/app/lib/query-keys';
import {
  createProviderProfile,
  cloneProviderProfile,
  deleteProviderProfile,
  createAppToken,
  updateLlmAssignments,
} from './api';

export function useCreateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProviderProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: providerKeys.overview() });
      queryClient.invalidateQueries({ queryKey: runtimeKeys.overview() });
    },
  });
}

export function useCloneProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceId, payload }: { sourceId: string; payload: unknown }) =>
      cloneProviderProfile(sourceId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: providerKeys.overview() });
      queryClient.invalidateQueries({ queryKey: runtimeKeys.overview() });
    },
  });
}

export function useDeleteProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteProviderProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: providerKeys.overview() });
      queryClient.invalidateQueries({ queryKey: runtimeKeys.overview() });
    },
  });
}

export function useCreateApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAppToken,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: providerKeys.overview() });
    },
  });
}

export function useUpdateAssignments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      appId,
      assignments,
    }: {
      appId: string;
      assignments: { textProfileId: string | null; multimodalProfileId: string | null };
    }) => updateLlmAssignments(appId, assignments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: providerKeys.overview() });
      queryClient.invalidateQueries({ queryKey: runtimeKeys.overview() });
    },
  });
}
