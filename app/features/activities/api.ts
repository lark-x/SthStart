import { getJson, postJson, putJson, deleteJson, adminFetch } from '@/app/lib/api-client';
import type {
  Activity,
  ActivityDraft,
  ContentDocument,
  ContentRevision,
  MediaRevisionDocument,
  MediaRevision,
  PlaybackDocument,
  PlaybackRevision,
  ActivityAsset,
  ActivityCandidate,
  ActivityCheckpoint,
  ActivityJob,
  ImageConfigDocument,
  ImageConfigDraft,
  ImageConfigRevision,
  PromptRecipe,
  PromptCompilation,
  GenerationAttempt,
  ImpactPreview,
  SourceRef,
  AssetLineageEdge,
  ActivityCapabilitiesResponse,
} from '@sthstart/contracts';

export interface ActivityCapabilities {
  llm: boolean;
  llmProfile: { id: string; name: string } | null;
  media: boolean;
  images?: {
    textToImage: import('@sthstart/contracts').ImageCapabilityDescriptor;
    imageToImage: import('@sthstart/contracts').ImageCapabilityDescriptor;
  };
  templates: Array<{ id: string; name: string; version: string }>;
  limits: {
    maxActors: number;
    maxStages: number;
    maxRecords: number;
    maxDocumentBytes: number;
  };
}

export interface ActivityListFilter {
  q?: string;
  archived?: boolean;
  limit?: number;
}

export interface CreateActivityInput {
  title?: string;
  type?: string;
  theme?: string;
  location?: string;
  rules?: string;
  stageTitles?: string[];
  actors?: Array<{
    sourceCharacterId?: string;
    sourceVersion?: number;
    displayName: string;
    activityRole?: string;
    outfitDescription?: string;
    appearanceReferenceAssetKeys?: string[];
  }>;
  document?: ContentDocument;
}

export interface StagedImportPreview {
  importId: string;
  jobId: string;
  preview: {
    title: string;
    theme: string;
    activity?: { title: string; theme: string };
    actorCount: number;
    stageCount: number;
    messageCount: number;
    postCount: number;
    mediaCount: number;
    assetCount?: number;
  };
}

// 1. Activities List & CRUD
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

export async function fetchPlaybackRevision(id: string, playbackRevisionId: string): Promise<PlaybackRevision> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/playback-revisions/${encodeURIComponent(playbackRevisionId)}`);
}

export async function savePlaybackRevision(
  id: string,
  contentRevisionId: string,
  mediaRevisionId: string,
  document: PlaybackDocument
): Promise<PlaybackRevision> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/playback-revisions`, {
    contentRevisionId,
    mediaRevisionId,
    document,
  });
}

export async function generateAutoPlayback(
  id: string,
  options?: {
    contentRevisionId?: string;
    mediaRevisionId?: string;
    viewerActorId?: string;
    speed?: number;
    autoPlay?: boolean;
  }
): Promise<{ playbackDocument: PlaybackDocument; savedRevisionId?: string }> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/playback/generate`, options || {});
}

// 4. Assets & Media Workstation
export async function fetchActivityAssets(id: string): Promise<{ items: ActivityAsset[] }> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/assets`);
}

export async function uploadActivityAsset(
  id: string,
  file: File | Blob,
  customAssetKey?: string
): Promise<ActivityAsset> {
  const headers: Record<string, string> = {
    'content-type': file.type || 'application/octet-stream',
  };
  if (customAssetKey) {
    headers['x-asset-key'] = customAssetKey;
  }
  if ('name' in file && file.name) {
    headers['x-artifact-original-name'] = file.name;
  }

  const response = await adminFetch(`/api/admin/activities/${encodeURIComponent(id)}/uploads`, {
    method: 'POST',
    headers,
    body: file,
  });

  if (!response.ok) {
    const err = (await response.json().catch(() => ({ message: `HTTP ${response.status}` }))) as { message?: string };
    throw new Error(err.message || '上传资产失败');
  }

  return response.json();
}

export async function linkArtifactToActivity(
  id: string,
  artifactId: string,
  customAssetKey?: string
): Promise<ActivityAsset> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/assets/link`, {
    artifactId,
    customAssetKey,
  });
}

export async function createMediaGenerationTask(
  id: string,
  input: {
    contentRevisionId: string;
    slotId: string;
    slotFingerprint: string;
    workflowId?: string;
    workflowVersion?: number;
    inputs?: Record<string, unknown>;
  }
): Promise<{ task: { id: string; status: string } }> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/media-jobs`, input);
}

export async function syncMediaGenerationOutputs(
  id: string,
  taskId: string
): Promise<{ task: unknown; assets: ActivityAsset[] }> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/media-jobs/${encodeURIComponent(taskId)}/sync`, {});
}

// 5. Text Generation Jobs & Candidates
export async function triggerTextGeneration(
  id: string,
  input: {
    mode: 'plan' | 'stage' | 'rewrite-records' | 'whole-text';
    targetRevisionId?: string;
    scope?: Record<string, unknown>;
    userInstruction?: string;
    idempotencyKey?: string;
  }
): Promise<ActivityJob> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/text-jobs`, input);
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

// 6. Checkpoints
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

// 7. Capabilities
export async function fetchCapabilities(): Promise<ActivityCapabilities> {
  return getJson('/api/admin/activities/capabilities');
}

// 8. Export & Import
export async function exportActivityPackage(
  id: string,
  options?: {
    mode?: 'reader' | 'full';
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

// 9. Image Configs & Revisions
export async function fetchImageConfigDraft(id: string): Promise<ImageConfigDraft> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/image-config/draft`);
}

export async function saveImageConfigDraft(id: string, document: ImageConfigDocument, expectedDraftVersion?: number): Promise<ImageConfigDraft> {
  return putJson(`/api/admin/activities/${encodeURIComponent(id)}/image-config/draft`, { document, expectedDraftVersion: expectedDraftVersion ?? (await fetchImageConfigDraft(id)).draftVersion });
}

export async function commitImageConfigRevision(id: string, document: ImageConfigDocument, expectedDraftVersion?: number, expectedHeadVersion?: number): Promise<ImageConfigRevision> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/image-config/revisions`, { document, expectedDraftVersion, expectedHeadVersion });
}

export async function fetchImageConfigRevisions(id: string): Promise<{ items: ImageConfigRevision[] }> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/image-config/revisions`);
}

// 10. Prompt Recipes & Preparation
export async function preparePromptRecipe(
  id: string,
  input: {
    contentRevisionId: string;
    imageConfigRevisionId?: string;
    slotId: string;
    expectedHeadVersion?: number;
    overrides?: Array<{ id: string; fieldPath: string; overrideText: string; reason?: string }>;
    references?: import('@sthstart/contracts').ReferenceInput[];
    customParams?: Record<string, unknown>;
  }
): Promise<{ recipe: PromptRecipe; compilation: PromptCompilation }> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/recipes/prepare`, input);
}

export async function fetchPromptRecipe(id: string, recipeId: string): Promise<{ recipe: PromptRecipe; compilation: PromptCompilation }> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/recipes/${encodeURIComponent(recipeId)}`);
}

export async function fetchPromptCompilation(id: string, compilationId: string): Promise<PromptCompilation> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/compilations/${encodeURIComponent(compilationId)}`);
}

// 11. Generation Attempts
export async function createImageAttempt(
  id: string,
  input: {
    contentRevisionId: string;
    imageConfigRevisionId: string;
    slotId: string;
    recipeId: string;
    compilationId: string;
    executionPlanHash: string;
    expectedHeadVersion?: number;
    seed?: number;
    retryOfAttemptId?: string;
    parentAttemptIds?: string[];
    idempotencyKey?: string;
  }
): Promise<GenerationAttempt> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/image-attempts`, input);
}

export async function fetchImageAttempts(id: string, slotId?: string): Promise<{ items: GenerationAttempt[] }> {
  const query = slotId ? `?slotId=${encodeURIComponent(slotId)}` : '';
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/image-attempts${query}`);
}

export async function fetchImageAttempt(id: string, attemptId: string): Promise<GenerationAttempt> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/image-attempts/${encodeURIComponent(attemptId)}`);
}

export async function retryImageAttempt(id: string, attemptId: string): Promise<GenerationAttempt> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/image-attempts/${encodeURIComponent(attemptId)}/retry`, {});
}

export async function cancelImageAttempt(id: string, attemptId: string): Promise<{ cancelled: boolean; status: string }> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/image-attempts/${encodeURIComponent(attemptId)}/cancel`, {});
}

// 12. Provenance, Sources, Impact & Lineage
export async function previewImageImpact(
  id: string,
  input: {
    changedEntityKind: string;
    changedEntityId: string;
    fieldPath: string;
    newValue: unknown;
  }
): Promise<ImpactPreview> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/image-impact/preview`, input);
}

export async function resolveImageSource(
  id: string,
  sourceRefId: string
): Promise<{
  sourceRef: SourceRef;
  currentValue: unknown;
  hasChanged: boolean;
  fieldPath: string;
  entityKind: string;
  entityId: string;
  label: string;
}> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/image-sources/resolve`, { sourceRefId });
}

export async function fetchAssetLineage(
  id: string,
  assetKey: string
): Promise<{ lineage: AssetLineageEdge[]; ancestors: string[] }> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/image-lineage/${encodeURIComponent(assetKey)}`);
}


export async function fetchImageExecutionSnapshots(id: string, attemptId: string): Promise<{ items: import('@sthstart/contracts').ExecutionSnapshot[] }> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/image-attempts/${encodeURIComponent(attemptId)}/execution-snapshots`);
}
