import type { AiCallDetail, AiCallListQuery, AiCallListResponse, AiCallStorageStats } from '@sthstart/contracts';
import { AiCallDetailSchema, AiCallListResponseSchema, AiCallStorageStatsSchema } from '@sthstart/contracts';
import { getJson } from '@/app/lib/api-client';

export async function fetchAiCalls(filters: AiCallListQuery & { cursor?: string } = {}): Promise<AiCallListResponse> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') query.set(key, String(value));
  return getJson(`/api/admin/ai-calls${query.size ? `?${query.toString()}` : ''}`, undefined, AiCallListResponseSchema);
}

export async function fetchAiCall(id: string): Promise<AiCallDetail> {
  return getJson(`/api/admin/ai-calls/${encodeURIComponent(id)}`, undefined, AiCallDetailSchema);
}

export async function fetchAiCallStorageStats(): Promise<AiCallStorageStats> {
  return getJson('/api/admin/ai-calls/stats', undefined, AiCallStorageStatsSchema);
}
