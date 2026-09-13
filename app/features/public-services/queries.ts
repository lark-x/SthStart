import { useQuery } from '@tanstack/react-query';
import { providerKeys } from '@/app/lib/query-keys';
import { fetchPublicOverview, fetchAppLlmStatus } from './api';

export function usePublicOverview() {
  return useQuery({
    queryKey: providerKeys.overview(),
    queryFn: fetchPublicOverview,
    staleTime: 30_000,
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
