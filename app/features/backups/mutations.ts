import { useMutation, useQueryClient } from '@tanstack/react-query';
import { backupKeys } from '@/app/lib/query-keys';
import {
  adoptRemoteSnapshot, cancelBackupRun, changeBackupPassword, connectRemoteVault, createBackupVault, lockBackupVault, removeBackupPlan,
  removeBackupTarget, retryBackupRun, runBackupPlan, runCleanup, saveBackupPlan, saveBackupTarget,
  replicateSnapshot, setSnapshotRetained, startBackupRun, startRestore, unlockBackupVault, verifyBackupTarget,
} from './api';

/** 所有写操作完成后统一失效概览，避免页面出现「假成功」的旧状态。 */
function useInvalidatingMutation<TInput, TResult>(worker: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: worker,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: backupKeys.all });
    },
  });
}

export const useCreateBackupVault = () => useInvalidatingMutation((password: string) => createBackupVault(password));
export const useUnlockBackupVault = () => useInvalidatingMutation((input: { password?: string; recoveryKey?: string; remember?: boolean }) => unlockBackupVault(input));
export const useLockBackupVault = () => useInvalidatingMutation(() => lockBackupVault());
export const useChangeBackupPassword = () => useInvalidatingMutation((input: { currentPassword: string; newPassword: string }) => changeBackupPassword(input));
export const useSaveBackupTarget = () => useInvalidatingMutation((input: Parameters<typeof saveBackupTarget>[0]) => saveBackupTarget(input));
export const useRemoveBackupTarget = () => useInvalidatingMutation((targetId: string) => removeBackupTarget(targetId));
export const useVerifyBackupTarget = () => useInvalidatingMutation((targetId: string) => verifyBackupTarget(targetId));
export const useSaveBackupPlan = () => useInvalidatingMutation((input: Parameters<typeof saveBackupPlan>[0]) => saveBackupPlan(input));
export const useRemoveBackupPlan = () => useInvalidatingMutation((planId: string) => removeBackupPlan(planId));
export const useRunBackupPlan = () => useInvalidatingMutation((planId: string) => runBackupPlan(planId));
export const useStartBackupRun = () => useInvalidatingMutation((input: Parameters<typeof startBackupRun>[0]) => startBackupRun(input));
export const useRetryBackupRun = () => useInvalidatingMutation((runId: string) => retryBackupRun(runId));
export const useCancelBackupRun = () => useInvalidatingMutation((runId: string) => cancelBackupRun(runId));
export const useSetSnapshotRetained = () => useInvalidatingMutation((input: { snapshotId: string; retained: boolean }) => setSnapshotRetained(input.snapshotId, input.retained));
export const useRunCleanup = () => useInvalidatingMutation((input: { targetId: string; retainCount: number }) => runCleanup(input.targetId, input.retainCount));
export const useStartRestore = () => useInvalidatingMutation((input: Parameters<typeof startRestore>[0]) => startRestore(input));
export const useConnectRemoteVault = () => useInvalidatingMutation((input: Parameters<typeof connectRemoteVault>[0]) => connectRemoteVault(input));
export const useAdoptRemoteSnapshot = () => useInvalidatingMutation((input: { targetId: string; snapshotId: string }) => adoptRemoteSnapshot(input));
export const useReplicateSnapshot = () => useInvalidatingMutation((input: { snapshotId: string; targetIds: string[] }) => replicateSnapshot(input.snapshotId, input.targetIds));
