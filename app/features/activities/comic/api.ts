import {
  ComicDraftResponseSchema, ComicHistoryPageSchema, ComicJobPageSchema, ComicJobResponseSchema, ComicRenderPreviewSchema,
  ComicExportReaderRequestSchema, ComicRevisionListSchema, ComicRevisionResponseSchema, ComicStoryboardAppliedResponseSchema,
} from '@sthstart/contracts';
import type {
  ComicDraft, ComicDocument, ComicHistoryPage, ComicJob, ComicJobPage, ComicRenderPreview, ComicRevision,
  ComicStoryboardAppliedResponse, ComicStoryboardRequest,
} from '@sthstart/contracts';
import { ApiClientError, getJson, postJson, putJson } from '@/app/lib/api-client';
import { adminFetch } from '@/app/lib/admin-fetch';
import { Value } from '@sinclair/typebox/value';

const root = (activityId: string) => `/api/admin/activities/${encodeURIComponent(activityId)}/comic`;

export async function fetchComicDraft(activityId: string): Promise<ComicDraft | null> {
  const response = await getJson<{ draft: ComicDraft | null }>(`${root(activityId)}/draft`, undefined, ComicDraftResponseSchema);
  return response.draft;
}

export async function createComicDraft(activityId: string, contentRevisionId: string): Promise<ComicDraft> {
  const response = await postJson<{ draft: ComicDraft }>(`${root(activityId)}/draft`, { contentRevisionId }, undefined, ComicDraftResponseSchema);
  if (!response.draft) throw new Error('服务端没有创建漫画草稿。');
  return response.draft;
}

export async function saveComicDraft(activityId: string, expectedDraftVersion: number, document: ComicDocument): Promise<ComicDraft> {
  const response = await putJson<{ draft: ComicDraft }>(`${root(activityId)}/draft`, { expectedDraftVersion, document }, undefined, ComicDraftResponseSchema);
  if (!response.draft) throw new Error('服务端没有返回已保存的漫画草稿。');
  return response.draft;
}

export async function createComicRevision(activityId: string, expectedDraftVersion: number): Promise<ComicRevision> {
  const response = await postJson<{ revision: ComicRevision }>(`${root(activityId)}/revisions`, { expectedDraftVersion }, undefined, ComicRevisionResponseSchema);
  return response.revision;
}

export async function fetchComicRevisions(activityId: string): Promise<ComicRevision[]> {
  const response = await getJson<{ items: ComicRevision[]; nextCursor: string | null }>(`${root(activityId)}/revisions`, undefined, ComicRevisionListSchema);
  return response.items;
}

export async function exportComicOfflineReader(activityId: string, revisionId: string): Promise<Blob> {
  const request = { revisionId };
  if (!Value.Check(ComicExportReaderRequestSchema, request)) throw new Error('漫画版本编号无效。');
  const path = `${root(activityId)}/exports/reader`;
  const response = await adminFetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: unknown; message?: unknown; details?: unknown };
    throw new ApiClientError(typeof payload.message === 'string' ? payload.message : '离线阅读包导出失败。', {
      status: response.status,
      code: typeof payload.error === 'string' ? payload.error : undefined,
      details: Array.isArray(payload.details) ? payload.details.filter((item): item is string => typeof item === 'string') : undefined,
    });
  }
  return response.blob();
}

export async function fetchComicJob(activityId: string, jobId: string): Promise<ComicJob> {
  const response = await getJson<{ job: ComicJob }>(`${root(activityId)}/jobs/${encodeURIComponent(jobId)}`, undefined, ComicJobResponseSchema);
  return response.job;
}

export async function fetchComicJobs(activityId: string): Promise<ComicJobPage> {
  return getJson<ComicJobPage>(`${root(activityId)}/jobs?limit=100`, undefined, ComicJobPageSchema);
}

export async function createComicStoryboard(activityId: string, request: ComicStoryboardRequest): Promise<ComicJob> {
  const response = await postJson<{ job: ComicJob }>(`${root(activityId)}/storyboards`, request, undefined, ComicJobResponseSchema);
  return response.job;
}

export async function applyComicStoryboard(
  activityId: string,
  jobId: string,
  request: { expectedDraftVersion: number; mode: 'append' | 'replace_scene' },
): Promise<ComicStoryboardAppliedResponse> {
  const response = await postJson<ComicStoryboardAppliedResponse>(`${root(activityId)}/storyboards/${encodeURIComponent(jobId)}/apply`, request, undefined, ComicStoryboardAppliedResponseSchema);
  return response;
}

export async function previewComicPanelRender(activityId: string, panelId: string, expectedDraftVersion: number, seed: number): Promise<ComicRenderPreview> {
  return postJson<ComicRenderPreview>(`${root(activityId)}/panels/${encodeURIComponent(panelId)}/render-preview`,
    { expectedDraftVersion, seed }, undefined, ComicRenderPreviewSchema);
}

export async function createComicPanelRender(activityId: string, panelId: string, input: {
  expectedDraftVersion: number; planHash: string; seed: number; idempotencyKey: string;
}): Promise<ComicJob> {
  const response = await postJson<{ job: ComicJob }>(`${root(activityId)}/panels/${encodeURIComponent(panelId)}/renders`, input, undefined, ComicJobResponseSchema);
  return response.job;
}

export async function fetchComicPanelHistory(activityId: string, panelId: string, cursor?: string): Promise<ComicHistoryPage> {
  const params = new URLSearchParams({ limit: '24' });
  if (cursor) params.set('cursor', cursor);
  return getJson<ComicHistoryPage>(`${root(activityId)}/panels/${encodeURIComponent(panelId)}/history?${params}`, undefined, ComicHistoryPageSchema);
}

export async function selectComicPanelImage(activityId: string, panelId: string, input: {
  expectedDraftVersion: number; artifactId: string; allowStaleSource: boolean;
}): Promise<ComicDraft> {
  const response = await postJson<{ draft: ComicDraft }>(`${root(activityId)}/panels/${encodeURIComponent(panelId)}/select-image`, input, undefined, ComicDraftResponseSchema);
  if (!response.draft) throw new Error('服务端没有返回更新后的漫画草稿。');
  return response.draft;
}
