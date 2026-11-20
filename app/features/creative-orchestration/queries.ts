import { useQueries, useQuery } from '@tanstack/react-query';
import type { CreativeScope } from '@sthstart/contracts';
import { creativeApi } from './api';

export const creativeKeys = {
  all: ['creative-orchestration'] as const,
  roles: ['creative-orchestration', 'roles'] as const,
  workflows: ['creative-orchestration', 'workflows'] as const,
  runs: ['creative-orchestration', 'runs'] as const,
  run: (id: string) => ['creative-orchestration', 'runs', id] as const,
  conversation: (id: string) => ['creative-orchestration', 'conversation', id] as const,
};
export const useCreativeRoles = () => useQuery({ queryKey: creativeKeys.roles, queryFn: creativeApi.roles });
export const useCreativeWorkflows = () =>
  useQuery({ queryKey: creativeKeys.workflows, queryFn: creativeApi.workflows });
export const useCreativeRuns = () =>
  useQuery({ queryKey: creativeKeys.runs, queryFn: creativeApi.runs, refetchInterval: 5000 });
export const useCreativeRun = (id: string | null) =>
  useQuery({
    queryKey: creativeKeys.run(id ?? ''),
    queryFn: () => creativeApi.run(id!),
    enabled: Boolean(id),
    refetchInterval: (query) =>
      ['queued', 'running', 'waiting_approval'].includes(query.state.data?.run.status ?? '') ? 2500 : false,
  });

export function useAcceptedScenes(scope: CreativeScope) {
  const runs = useCreativeRuns();
  const scoped = (runs.data?.items ?? [])
    .filter(
      (run) =>
        run.scope.worldId === scope.worldId &&
        run.scope.branchId === scope.branchId &&
        run.scope.projectId === scope.projectId &&
        run.status === 'completed',
    )
    .slice(0, 30);
  const details = useQueries({
    queries: scoped.map((run) => ({
      queryKey: creativeKeys.run(run.id),
      queryFn: () => creativeApi.run(run.id),
      staleTime: 30000,
    })),
  });
  return {
    scenes: details.flatMap(
      (detail) =>
        detail.data?.artifacts.filter(
          (artifact) => artifact.kind === 'scene' && artifact.status === 'accepted',
        ) ?? [],
    ),
    pending: runs.isPending || details.some((detail) => detail.isPending),
    error: runs.error ?? details.find((detail) => detail.error)?.error,
  };
}
