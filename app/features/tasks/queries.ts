import { useQuery } from '@tanstack/react-query';
import { taskKeys } from '@/app/lib/query-keys';
import { fetchTasks } from './api';

export function useGlobalTasks(params?: {
  state?: 'active' | 'recent' | 'all';
  domain?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: taskKeys.list(params),
    queryFn: () => fetchTasks(params),
    refetchInterval: (q) => {
      const activeCount = q.state.data?.activeCount ?? 0;
      return activeCount > 0 ? 3_000 : 30_000;
    },
    refetchOnWindowFocus: true,
  });
}
