import { useQuery } from '@tanstack/react-query';
import { providerKeys } from '@/app/lib/query-keys';
import { fetchPublicOverview, fetchAppLlmStatus, fetchModelRoutes } from './api';

export function usePublicOverview() {
  return useQuery({
    queryKey: providerKeys.overview(),
    queryFn: fetchPublicOverview,
    staleTime: 30_000,
  });
}

export function useModelRoutes() {
  return useQuery({
    queryKey: providerKeys.modelRoutes(),
    queryFn: fetchModelRoutes,
    staleTime: 15_000,
  });
}

export function useAppLlmStatus(appId?: string | null) {
  return useQuery({
    queryKey: providerKeys.llmStatus(appId ?? ''),
    queryFn: () => fetchAppLlmStatus(appId!),
    enabled: Boolean(appId),
    staleTime: 15_000,
  });
}
