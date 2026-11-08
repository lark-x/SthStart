import { useQuery } from '@tanstack/react-query';
import { characterKeys } from '@/app/lib/query-keys';
import { fetchCharacters, fetchCharacterDetail, fetchCharacterAssets } from './api';

/** 角色主库列表。各处的全量选择器共用同一份缓存，按需用 enabled 延迟到弹窗打开时再请求。 */
export function useCharacters(options?: { query?: string; enabled?: boolean }) {
  const filters = options?.query ? { query: options.query } : undefined;
  return useQuery({
    queryKey: characterKeys.list(filters),
    queryFn: () => fetchCharacters(filters),
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
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

export function useCharacterAssets(id?: string) {
  return useQuery({
    queryKey: characterKeys.assets(id ?? ''),
    queryFn: () => fetchCharacterAssets(id!),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}
