import { getJson, postJson, putJson, adminFetch } from '@/app/lib/api-client';
import type {
  ActivityAsset,
  ActivityGallery,
  ImageConfigDocument,
  ImageConfigDraft,
  ImageConfigRevision,
  PromptRecipe,
  PromptCompilation,
  PreparePromptRecipeRequest,
  GenerationAttempt,
  ImpactPreview,
  SourceRef,
  AssetLineageEdge,
  PrepareMediaBatchInput,
  PrepareMediaBatchOutput,
  CreateMediaBatchInput,
  ActivityMediaBatch,
  ImageAttemptPage,
  ExecutionSnapshot,
  ActorSnapshot,
} from '@sthstart/contracts';
import { ActivityGallerySchema, ImageAttemptPageSchema } from '@sthstart/contracts';

// 1. Assets & Media Workstation
export async function fetchActivityAssets(id: string): Promise<{ items: ActivityAsset[] }> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/assets`);
}

/** Aggregate read-only gallery. The contract validates the response shape. */
export async function fetchActivityGallery(id: string): Promise<ActivityGallery> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/gallery`, undefined, ActivityGallerySchema);
}

export async function transferCharacterReferenceToActivity(
  activityId: string,
  input: { characterId: string; version?: number | null; referenceId: string },
): Promise<ActivityAsset> {
  const idempotencyKey = `character-reference-${activityId}-${input.referenceId}`;
  return postJson<ActivityAsset>(
    `/api/admin/activities/${encodeURIComponent(activityId)}/character-references`,
    input,
    { headers: { 'idempotency-key': idempotencyKey } },
  );
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

// 2. Image Configs & Revisions
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

// 3. Prompt Recipes & Preparation
export async function preparePromptRecipe(
  id: string,
  input: PreparePromptRecipeRequest
): Promise<{ recipe: PromptRecipe; compilation: PromptCompilation }> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/recipes/prepare`, input);
}

export async function fetchPromptRecipe(id: string, recipeId: string): Promise<{ recipe: PromptRecipe; compilation: PromptCompilation }> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/recipes/${encodeURIComponent(recipeId)}`);
}

export async function fetchPromptCompilation(id: string, compilationId: string): Promise<PromptCompilation> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/compilations/${encodeURIComponent(compilationId)}`);
}

// 4. Generation Attempts
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

export async function fetchImageAttempts(id: string, slotId?: string, cursor?: string, signal?: AbortSignal): Promise<ImageAttemptPage> {
  const params = new URLSearchParams({ limit: '50' });
  if (slotId) params.set('slotId', slotId);
  if (cursor) params.set('cursor', cursor);
  return getJson(`activities/${encodeURIComponent(id)}/image-attempts?${params}`, { signal }, ImageAttemptPageSchema);
}

export async function fetchImageAttempt(id: string, attemptId: string): Promise<GenerationAttempt> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/image-attempts/${encodeURIComponent(attemptId)}`);
}

/** 重试一次素材绘制。传 seed 时按“复用原配置、换种子”重绘；不传则沿用原种子（失败重试）。 */
export async function retryImageAttempt(id: string, attemptId: string, seed?: number): Promise<GenerationAttempt> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/image-attempts/${encodeURIComponent(attemptId)}/retry`, seed === undefined ? {} : { seed });
}

export async function cancelImageAttempt(id: string, attemptId: string): Promise<{ cancelled: boolean; status: string }> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/image-attempts/${encodeURIComponent(attemptId)}/cancel`, {});
}

// 5. Provenance, Sources, Impact & Lineage
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

export async function fetchImageExecutionSnapshots(id: string, attemptId: string): Promise<{ items: ExecutionSnapshot[] }> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/image-attempts/${encodeURIComponent(attemptId)}/execution-snapshots`);
}

export async function fetchActivityCharacterSnapshot(characterId: string, version?: number): Promise<ActorSnapshot> {
  const query = version == null ? '' : `?version=${version}`;
  return getJson(`/api/admin/activities/characters/${encodeURIComponent(characterId)}/snapshot${query}`);
}

// 6. Media Batches
export async function prepareMediaBatch(
  activityId: string,
  input: PrepareMediaBatchInput,
): Promise<PrepareMediaBatchOutput> {
  return postJson(`/api/admin/activities/${encodeURIComponent(activityId)}/media-batches/prepare`, input);
}

export async function createMediaBatch(
  activityId: string,
  input: CreateMediaBatchInput,
): Promise<ActivityMediaBatch> {
  return postJson(`/api/admin/activities/${encodeURIComponent(activityId)}/media-batches`, input);
}

export async function fetchMediaBatches(
  activityId: string,
): Promise<{ items: ActivityMediaBatch[] }> {
  return getJson(`/api/admin/activities/${encodeURIComponent(activityId)}/media-batches`);
}

export async function fetchMediaBatch(
  activityId: string,
  batchId: string,
): Promise<ActivityMediaBatch> {
  return getJson(`/api/admin/activities/${encodeURIComponent(activityId)}/media-batches/${encodeURIComponent(batchId)}`);
}

export async function cancelMediaBatch(
  activityId: string,
  batchId: string,
): Promise<ActivityMediaBatch> {
  return postJson(`/api/admin/activities/${encodeURIComponent(activityId)}/media-batches/${encodeURIComponent(batchId)}/cancel`, {});
}

export async function retryFailedBatchItems(
  activityId: string,
  batchId: string,
  itemIds?: string[],
): Promise<ActivityMediaBatch> {
  return postJson(`/api/admin/activities/${encodeURIComponent(activityId)}/media-batches/${encodeURIComponent(batchId)}/retry-failed`, { itemIds });
}
