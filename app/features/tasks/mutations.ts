import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TaskDomain } from '@sthstart/contracts';
import { taskKeys, activityKeys } from '@/app/lib/query-keys';
import { cancelTask, retryTask } from './api';

export function useCancelGlobalTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ domain, taskId }: { domain: TaskDomain; taskId: string }) =>
      cancelTask(domain, taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      queryClient.invalidateQueries({ queryKey: activityKeys.all });
    },
  });
}

export function useRetryGlobalTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ domain, taskId }: { domain: TaskDomain; taskId: string }) =>
      retryTask(domain, taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      queryClient.invalidateQueries({ queryKey: activityKeys.all });
    },
  });
}
