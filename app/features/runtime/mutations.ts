import { useMutation, useQueryClient } from '@tanstack/react-query';
import { runtimeKeys } from '@/app/lib/query-keys';
import {
  startRuntimeService,
  stopRuntimeService,
  restartRuntimeService,
  updateRuntimeSettings,
  updateCreativeSettings,
  updateLogPolicy,
  commitLauncherImport,
  syncPublicLlmModel,
} from './api';
import type { LogPolicy, RuntimeSettings } from '@sthstart/contracts';

export function useStartService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => startRuntimeService(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runtimeKeys.overview() });
    },
  });
}

export function useStopService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => stopRuntimeService(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runtimeKeys.overview() });
    },
  });
}

export function useRestartService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => restartRuntimeService(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runtimeKeys.overview() });
    },
  });
}

export function useUpdateRuntimeSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: Partial<RuntimeSettings>) => updateRuntimeSettings(settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runtimeKeys.overview() });
    },
  });
}

export function useUpdateCreativeSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (creative: Record<string, unknown>) => updateCreativeSettings(creative),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runtimeKeys.overview() });
    },
  });
}

export function useUpdateLogPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (policy: Partial<LogPolicy>) => updateLogPolicy(policy),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runtimeKeys.overview() });
    },
  });
}

export function useImportLauncherConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: commitLauncherImport,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runtimeKeys.overview() });
      queryClient.invalidateQueries({ queryKey: runtimeKeys.configPreview() });
    },
  });
}

export function useSyncPublicModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: syncPublicLlmModel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runtimeKeys.overview() });
    },
  });
}

