import { useQuery } from '@tanstack/react-query';
import { providerKeys } from '@/app/lib/query-keys';
import { fetchPublicOverview } from './api';

export function usePublicOverview() {
  return useQuery({
    queryKey: providerKeys.overview(),
    queryFn: fetchPublicOverview,
    staleTime: 30_000,
  });
}

