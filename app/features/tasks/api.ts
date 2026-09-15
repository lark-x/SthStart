import { getJson, postJson } from '@/app/lib/api-client';
import type { TasksResponse, TaskDomain } from '@sthstart/contracts';

export async function fetchTasks(params?: {
  state?: 'active' | 'recent' | 'all';
  domain?: string;
  limit?: number;
}): Promise<TasksResponse> {
  const query = new URLSearchParams();
  if (params?.state) query.set('state', params.state);
  if (params?.domain) query.set('domain', params.domain);
  if (params?.limit) query.set('limit', String(params.limit));

  const qs = query.toString();
  return getJson(`/api/admin/tasks${qs ? `?${qs}` : ''}`);
}

export async function cancelTask(
  domain: TaskDomain,
  taskId: string,
): Promise<{ success: boolean; message?: string }> {
  return postJson(`/api/admin/tasks/${encodeURIComponent(domain)}/${encodeURIComponent(taskId)}/cancel`, {});
}

export async function retryTask(
  domain: TaskDomain,
  taskId: string,
): Promise<{ success: boolean; message?: string }> {
  return postJson(`/api/admin/tasks/${encodeURIComponent(domain)}/${encodeURIComponent(taskId)}/retry`, {});
}
