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
  mode: 'text-to-image' | 'image-to-image' | 'h3-t2v' | 'h3-i2v' | 'h3-fl2va';
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number | null;
  sourceArtifactId?: string;
  duration?: number;
  firstFrameId?: string;
  aspectRatio?: string;
  lastFrameId?: string;
};

function portalArtifactUrl(id: string) {
  return `/api/admin/creative/artifacts/${encodeURIComponent(id)}`;
}

function withPortalArtifactUrls(task: CreativeTaskResponse): CreativeTaskResponse {
  return {
    ...task,
    artifacts: task.artifacts.map((artifact) => ({ ...artifact, url: portalArtifactUrl(artifact.artifactId) })),
  };
}

export async function fetchCreativeStatus() {
  return getJson<CreativeStatusResponse>('creative/status', undefined, CreativeStatusResponseSchema);
}

export async function fetchCreativeTasks() {
  const response = await getJson<{ items: CreativeTaskResponse[] }>('creative/tasks');
  return response.items.map(withPortalArtifactUrls);
}

export async function createCreativeTask(input: CreativeTaskInput) {
  const task = await postJson<CreativeTaskResponse>('creative/tasks', input, undefined, CreativeTaskResponseSchema);
  return withPortalArtifactUrls(task);
}

export async function cancelCreativeTask(id: string) {
  const task = await postJson<CreativeTaskResponse>(`creative/tasks/${encodeURIComponent(id)}/cancel`, undefined, undefined, CreativeTaskResponseSchema);
  return withPortalArtifactUrls(task);
}

export async function retryCreativeTask(id: string) {
  const task = await postJson<CreativeTaskResponse>(`creative/tasks/${encodeURIComponent(id)}/retry`, undefined, undefined, CreativeTaskResponseSchema);
  return withPortalArtifactUrls(task);
}

export async function fetchCreativeArtifacts() {
  const response = await getJson<{ items: ArtifactDescriptor[]; total: number }>('creative/artifacts', undefined, CreativeArtifactListResponseSchema);
  return { ...response, items: response.items.map((artifact) => ({ ...artifact, url: portalArtifactUrl(artifact.id) })) };
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
  const artifact = payload as unknown as ArtifactDescriptor;
  return { ...artifact, url: portalArtifactUrl(artifact.id) };
}
