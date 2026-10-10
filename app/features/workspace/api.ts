import { RecentWorkResponseSchema, type RecentWorkResponse } from '@sthstart/contracts';
import { getJson } from '@/app/lib/api-client';

export function fetchRecentWork(limit: number, signal?: AbortSignal): Promise<RecentWorkResponse> {
  return getJson(`workspace/recent?limit=${limit}`, { signal }, RecentWorkResponseSchema);
}
