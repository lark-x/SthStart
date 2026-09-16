import { useQuery } from '@tanstack/react-query';
import { backupKeys } from '@/app/lib/query-keys';
import {
  fetchBackupOverview, fetchBackupSnapshots, fetchQuarkCapability, fetchRestorePreview, fetchRestores,
} from './api';

/** 概览：有备份在跑时快一点刷新，空闲时慢一点，不打扰其它页面。 */
export function useBackupOverview() {
  return useQuery({
    queryKey: backupKeys.overview(),
    queryFn: fetchBackupOverview,
    refetchInterval: (query) => {
      const runs = query.state.data?.runs ?? [];
      const active = runs.some((run) => run.status === 'running' || run.status === 'queued');
      return active ? 2_000 : 30_000;
    },
    refetchOnWindowFocus: true,
  });
}

export function useBackupSnapshots() {
  return useQuery({ queryKey: backupKeys.snapshots(), queryFn: fetchBackupSnapshots, refetchInterval: 30_000 });
}

export function useBackupRestores() {
  return useQuery({ queryKey: backupKeys.restores(), queryFn: fetchRestores, refetchInterval: 10_000 });
}

export function useRestorePreview(snapshotId: string | null, targetId: string | null) {
  return useQuery({
    queryKey: backupKeys.restorePreview(snapshotId ?? '', targetId ?? ''),
    queryFn: () => fetchRestorePreview(snapshotId!, targetId!),
    enabled: Boolean(snapshotId && targetId),
    staleTime: 5_000,
  });
}

export function useQuarkCapability() {
  return useQuery({ queryKey: backupKeys.quark(), queryFn: fetchQuarkCapability, staleTime: 60_000 });
}
