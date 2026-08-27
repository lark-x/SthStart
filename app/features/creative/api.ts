import { getJson, postJson, putJson, deleteJson, adminFetch } from '@/app/lib/api-client';
import {
  CreativeArtifactListResponseSchema,
  CreativeStatusResponseSchema,
  CreativeTaskResponseSchema,
} from '@sthstart/contracts';
import type {
  ArtifactDescriptor,
  CreativeStatusResponse,
  CreativeTaskResponse,
} from '@sthstart/contracts';

export type CreativeTaskInput = {
  mode: 'text-to-image' | 'image-to-image';
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number | null;
  sourceArtifactId?: string;
};

export async function fetchCreativeStatus() {
  return getJson<CreativeStatusResponse>('creative/status', undefined, CreativeStatusResponseSchema);
}

export async function fetchCreativeTasks() {
  const response = await getJson<{ items: CreativeTaskResponse[] }>('creative/tasks');
  return response.items;
}

export async function createCreativeTask(input: CreativeTaskInput) {
  return postJson<CreativeTaskResponse>('creative/tasks', input, undefined, CreativeTaskResponseSchema);
}

export async function cancelCreativeTask(id: string) {
  return postJson<CreativeTaskResponse>(`creative/tasks/${encodeURIComponent(id)}/cancel`, undefined, undefined, CreativeTaskResponseSchema);
}

export async function retryCreativeTask(id: string) {
  return postJson<CreativeTaskResponse>(`creative/tasks/${encodeURIComponent(id)}/retry`, undefined, undefined, CreativeTaskResponseSchema);
}

export async function fetchCreativeArtifacts() {
  return getJson<{ items: ArtifactDescriptor[]; total: number }>('creative/artifacts', undefined, CreativeArtifactListResponseSchema);
}

export async function pinCreativeArtifact(id: string, pinned: boolean) {
  return putJson<{ ok: boolean; pinned: boolean }>(`creative/artifacts/${encodeURIComponent(id)}/pin`, { pinned });
}

export async function deleteCreativeArtifact(id: string) {
  return deleteJson<{ ok: boolean }>(`creative/artifacts/${encodeURIComponent(id)}`);
}

export async function uploadCreativeImage(file: File): Promise<ArtifactDescriptor> {
  const response = await adminFetch('creative/uploads', {
    method: 'POST',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-artifact-original-name': encodeURIComponent(file.name),
      accept: 'application/json',
    },
    body: file,
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = typeof payload?.message === 'string' ? payload.message : typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as unknown as ArtifactDescriptor;
}
