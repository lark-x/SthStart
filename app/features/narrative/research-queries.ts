import { useQuery } from '@tanstack/react-query';
import { narrativeKeys } from '@/app/lib/query-keys';
import {
  fetchResearchProvider,
  fetchResearchProject,
  fetchResearchProjects,
  fetchResearchRun,
} from './research-api';

export function useResearchProvider() {
  return useQuery({
    queryKey: narrativeKeys.researchProvider(),
    queryFn: fetchResearchProvider,
    staleTime: 60_000,
  });
}

export function useResearchProjects(workId?: string) {
  return useQuery({
    queryKey: narrativeKeys.researchProjects(workId),
    queryFn: () => fetchResearchProjects({ workId }),
    staleTime: 15_000,
  });
}

export function useResearchProject(id?: string) {
  return useQuery({
    queryKey: narrativeKeys.researchProject(id ?? ''),
    queryFn: () => fetchResearchProject(id!),
    enabled: Boolean(id),
    staleTime: 5_000,
  });
}

/** 运行中每 2 秒轮询一次；进入终态后停止，避免空转。 */
export function useResearchRun(id?: string, active = false) {
  return useQuery({
    queryKey: narrativeKeys.researchRun(id ?? ''),
    queryFn: () => fetchResearchRun(id!),
    enabled: Boolean(id),
    refetchInterval: active ? 2_000 : false,
    staleTime: 0,
  });
}
