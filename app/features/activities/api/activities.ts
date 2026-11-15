import { getJson, postJson, putJson, deleteJson, adminFetch } from '@/app/lib/api-client';
import type {
  Activity,
  ActivityDraft,
  ContentDocument,
  ContentRevision,
  MediaRevisionDocument,
  MediaRevision,
  PlaybackRevision,
  ActivityCandidate,
  ActivityCheckpoint,
  ActivityJob,
  ActivityProductionOverview,
  AdoptCandidateBatchInput,
  AdoptCandidateBatchOutput,
  ActivityPresetKind,
  ActivityReusablePreset,
  CreateActivityPresetInput,
  InstantiateTemplateInput,
  UpdateActivityPresetInput,
  ActivityPageQuery,
  ActivityPageResponse,
} from '@sthstart/contracts';
import { ActivityPageResponseSchema } from '@sthstart/contracts';
import type {
  ActivityCapabilities,
  ActivityListFilter,
  CreateActivityInput,
  StagedImportPreview,
} from '../shared/types';

// 1. Activities List & CRUD
export async function fetchActivityPage(filters: ActivityPageQuery = {}, signal?: AbortSignal): Promise<ActivityPageResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') params.set(key, String(value));
  return getJson(`activities/page?${params}`, { signal }, ActivityPageResponseSchema);
}

export async function fetchActivities(filters?: ActivityListFilter): Promise<{ items: Activity[] }> {
  const params = new URLSearchParams();
  if (filters?.q) params.set('q', filters.q);
  if (filters?.archived !== undefined) params.set('archived', String(filters.archived));
  if (filters?.limit) params.set('limit', String(filters.limit));
  const query = params.toString() ? `?${params.toString()}` : '';
  return getJson<{ items: Activity[] }>(`/api/admin/activities${query}`);
}

export async function fetchActivity(id: string): Promise<{
  activity: Activity;
  draft: ActivityDraft;
  currentContentRevision?: ContentRevision | null;
  currentMediaRevision?: MediaRevision | null;
  currentPlaybackRevision?: PlaybackRevision | null;
}> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}`);
}

export async function createActivity(input: CreateActivityInput): Promise<{
  activity: Activity;
  initialContentRevisionId: string;
  draftVersion: number;
}> {
  return postJson('/api/admin/activities', input);
}

export async function updateActivity(
  id: string,
  expectedHeadVersion: number,
  patch: Partial<Pick<Activity, 'title' | 'type' | 'theme' | 'location' | 'rules' | 'archived'>>
): Promise<{ activity: Activity }> {
  return putJson(`/api/admin/activities/${encodeURIComponent(id)}`, {
    expectedHeadVersion,
    ...patch,
  });
}

export async function deleteActivity(id: string): Promise<{ ok: boolean }> {
  return deleteJson(`/api/admin/activities/${encodeURIComponent(id)}`);
}

export async function duplicateActivity(
  id: string,
  options?: { title?: string; scope?: 'settings' | 'adopted' }
): Promise<{ activity: Activity }> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/duplicate`, options || {});
}

// 2. Draft Auto-save & Commit
export async function fetchDraft(id: string): Promise<{ draft: ActivityDraft }> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/draft`);
}

export async function saveDraft(
  id: string,
  expectedDraftVersion: number,
  document: ContentDocument
): Promise<{ draftVersion: number }> {
  return putJson(`/api/admin/activities/${encodeURIComponent(id)}/draft`, {
    expectedDraftVersion,
    document,
  });
}

export async function commitDraft(
  id: string,
  expectedHeadVersion: number,
  expectedDraftVersion?: number
): Promise<{
  activity: Activity;
  contentRevision: ContentRevision;
  draft: ActivityDraft;
}> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/commit`, {
    expectedHeadVersion,
    expectedDraftVersion,
  });
}

// 3. Revisions
export async function fetchContentRevisions(id: string): Promise<{ items: ContentRevision[] }> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/revisions`);
}

export async function fetchContentRevision(id: string, revisionId: string): Promise<ContentRevision> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}`);
}

export async function fetchMediaRevision(id: string, mediaRevisionId: string): Promise<MediaRevision> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/media-revisions/${encodeURIComponent(mediaRevisionId)}`);
}

export async function saveMediaRevision(
  id: string,
  contentRevisionId: string,
  slotBindings: MediaRevisionDocument['slotBindings']
): Promise<MediaRevision> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/media-revisions`, {
    contentRevisionId,
    slotBindings,
  });
}

// 4. Text Generation Jobs & Candidates
export async function triggerTextGeneration(
  id: string,
  input: {
    mode: 'plan' | 'stage' | 'rewrite-records' | 'whole-text' | 'invite' | 'wish' | 'moment' | 'shot' | 'continue-chat';
    targetRevisionId?: string;
    scope?: Record<string, unknown>;
    userInstruction?: string;
    idempotencyKey?: string;
  }
): Promise<ActivityJob> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/text-jobs`, input);
}

export async function retryActivityTextJob(id: string, jobId: string): Promise<ActivityJob> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/jobs/${encodeURIComponent(jobId)}/retry`, {});
}

export async function fetchActivityJobs(id: string): Promise<{ items: ActivityJob[] }> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/jobs`);
}

export async function fetchActivityJob(id: string, jobId: string): Promise<{
  job: ActivityJob;
  candidates: ActivityCandidate[];
}> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/jobs/${encodeURIComponent(jobId)}`);
}

export async function fetchCandidate(id: string, candidateId: string): Promise<ActivityCandidate> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/candidates/${encodeURIComponent(candidateId)}`);
}

export async function adoptCandidate(
  id: string,
  candidateId: string,
  expectedHeadVersion: number
): Promise<{
  activity: Activity;
  contentRevision: ContentRevision;
  candidate: ActivityCandidate;
  headVersion: number;
}> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/candidates/${encodeURIComponent(candidateId)}/adopt`, {
    expectedHeadVersion,
  });
}

export async function adoptCandidateBatch(
  id: string,
  input: AdoptCandidateBatchInput
): Promise<AdoptCandidateBatchOutput> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/candidates/adopt-batch`, input);
}

export async function fetchActivityProductionOverview(id: string): Promise<ActivityProductionOverview> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/production`);
}

// 5. Checkpoints
export async function fetchCheckpoints(id: string): Promise<{ items: ActivityCheckpoint[] }> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/checkpoints`);
}

export async function createCheckpoint(
  id: string,
  name: string
): Promise<{ checkpoint: ActivityCheckpoint }> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/checkpoints`, { name });
}

export async function restoreCheckpoint(
  id: string,
  checkpointId: string
): Promise<{ activity: Activity; checkpoint: ActivityCheckpoint }> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/checkpoints/${encodeURIComponent(checkpointId)}/restore`, {});
}

// 6. Capabilities
export async function fetchCapabilities(): Promise<ActivityCapabilities> {
  return getJson('/api/admin/activities/capabilities');
}

// 7. Export & Import
export async function exportActivityPackage(
  id: string,
  options?: {
    mode?: 'reader' | 'project' | 'full' | 'hyperframes-project';
    format?: 'reader' | 'project' | 'hyperframes-project';
    contentRevisionId?: string;
    mediaRevisionId?: string;
    playbackRevisionId?: string;
  }
): Promise<Blob> {
  const response = await adminFetch(`/api/admin/activities/${encodeURIComponent(id)}/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(options || { mode: 'full' }),
  });

  if (!response.ok) {
    const err = (await response.json().catch(() => ({ message: `HTTP ${response.status}` }))) as { message?: string };
    throw new Error(err.message || '导出活动失败');
  }

  return response.blob();
}

export async function stageActivityZip(file: File | Blob): Promise<StagedImportPreview> {
  const response = await adminFetch('/api/admin/activities/imports/stage', {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: file,
  });

  if (!response.ok) {
    const err = (await response.json().catch(() => ({ message: `HTTP ${response.status}` }))) as { message?: string };
    throw new Error(err.message || '暂存导入活动包失败');
  }

  return response.json();
}

export async function commitActivityImport(importId: string): Promise<{ activity: Activity; headVersion: number }> {
  return postJson(`/api/admin/activities/imports/${encodeURIComponent(importId)}/commit`, {});
}

// 8. Activity Reusable Presets (M5)
export async function fetchActivityPresets(
  kind?: ActivityPresetKind,
): Promise<{ items: ActivityReusablePreset[] }> {
  const query = kind ? `?kind=${encodeURIComponent(kind)}` : '';
  return getJson(`/api/admin/activity-presets${query}`);
}

export async function fetchActivityPreset(
  id: string,
): Promise<ActivityReusablePreset> {
  return getJson(`/api/admin/activity-presets/${encodeURIComponent(id)}`);
}

export async function createActivityPreset(
  input: CreateActivityPresetInput,
): Promise<ActivityReusablePreset> {
  return postJson(`/api/admin/activity-presets`, input);
}

export async function updateActivityPreset(
  id: string,
  input: UpdateActivityPresetInput,
): Promise<ActivityReusablePreset> {
  return putJson(`/api/admin/activity-presets/${encodeURIComponent(id)}`, input);
}

export async function deleteActivityPreset(
  id: string,
): Promise<{ success: boolean }> {
  return deleteJson(`/api/admin/activity-presets/${encodeURIComponent(id)}`);
}

export async function instantiateActivityTemplate(
  id: string,
  input: InstantiateTemplateInput,
): Promise<any> {
  return postJson(`/api/admin/activity-presets/${encodeURIComponent(id)}/instantiate`, input);
}
