import { useQuery } from '@tanstack/react-query';
import { runtimeKeys } from '@/app/lib/query-keys';
import { fetchRuntimeOverview, fetchLogs, previewLauncherImport } from './api';

export function useRuntimeOverview(options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: runtimeKeys.overview(),
    queryFn: fetchRuntimeOverview,
    refetchInterval: options?.refetchInterval ?? 4000,
    staleTime: 2000,
  });
}

export function useInitialLogs(limit = 500) {
  return useQuery({
    queryKey: runtimeKeys.logs({ limit }),
    queryFn: () => fetchLogs(limit),
    staleTime: 10_000,
  });
}

export function useLauncherPreview(enabled = false) {
  return useQuery({
    queryKey: runtimeKeys.configPreview(),
    queryFn: previewLauncherImport,
    enabled,
  });
}

