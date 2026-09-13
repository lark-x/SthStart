import { useMutation, useQueryClient } from '@tanstack/react-query';
import { activityKeys, providerKeys, runtimeKeys } from '@/app/lib/query-keys';
import {
  createProviderProfile,
  cloneProviderProfile,
  deleteProviderProfile,
  createAppToken,
  updateLlmAssignments,
} from './api';

/** providerKeys.all 作为失效前缀会一并刷新派生的应用模型状态 query。 */
function invalidateProviderCaches(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: providerKeys.all });
  queryClient.invalidateQueries({ queryKey: runtimeKeys.overview() });
  queryClient.invalidateQueries({ queryKey: activityKeys.capabilities() });
}

export function useCreateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProviderProfile,
    onSuccess: () => invalidateProviderCaches(queryClient),
  });
}

export function useCloneProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceId, payload }: { sourceId: string; payload: unknown }) =>
      cloneProviderProfile(sourceId, payload),
    onSuccess: () => invalidateProviderCaches(queryClient),
  });
}

export function useDeleteProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteProviderProfile,
    onSuccess: () => invalidateProviderCaches(queryClient),
  });
}

export function useCreateApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAppToken,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: providerKeys.all });
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
    onSuccess: () => invalidateProviderCaches(queryClient),
  });
}
