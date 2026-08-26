import { useQuery } from '@tanstack/react-query';
import { characterKeys } from '@/app/lib/query-keys';
import { fetchCharacters, fetchCharacterDetail } from './api';

export function useCharacters(options?: { query?: string }) {
  return useQuery({
    queryKey: characterKeys.list(options),
    queryFn: fetchCharacters,
    staleTime: 30_000,
  });
}

export function useCharacterDetail(id?: string) {
  return useQuery({
    queryKey: characterKeys.detail(id ?? ''),
    queryFn: () => fetchCharacterDetail(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

