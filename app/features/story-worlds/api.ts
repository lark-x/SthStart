import { getJson, postJson, putJson } from '@/app/lib/api-client';
import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import {
  GenerationRecoveryListResponseSchema,
  GenerationRecoveryResolveRequestSchema,
  GenerationRecoveryResolveResponseSchema,
  PromoteWorldActorSchema,
  StoryWorldSchema,
  WorldActorPromotionResultSchema,
  WorldAdoptionResultSchema,
  WorldBranchDetailSchema,
  WorldBranchSchema,
  WorldEventPageSchema,
  WorldImageListSchema,
  WorldImageSchema,
  WorldInterventionSchema,
  WorldListSchema,
  WorldMemoryListSchema,
  WorldOverviewSchema,
  WorldProjectBindingSchema,
  WorldRevisionRequestSchema,
  WorldRunRecoveryCallSchema,
  WorldRunRecoveryListSchema,
  WorldRunRecoveryResultSchema,
  WorldRunSchema,
  WorldStoryLineSchema,
} from '@sthstart/contracts';
import {
  WorldSourceUpdatePreviewSchema,
  type WorldSourceUpdatePreview,
} from '@sthstart/contracts';
import type {
  CreateWorldBranch,
  CreateWorldIntervention,
  CreateWorldStoryLine,
  BindWorldProject,
  GenerationRecoveryListResponse,
  GenerationRecoveryResolveRequest,
  GenerationRecoveryResolveResponse,
  PlanWorldImages,
  PromoteWorldActor,
  RefreshWorldSources,
  ResolveWorldRunCall,
  ResumeWorldRun,
  StartWorldRun,
  StoryWorld,
  SubmitWorldImage,
  WorldActorPromotionResult,
  WorldAdoption,
  WorldAdoptionResult,
  WorldBranch,
  WorldBranchDetail,
  WorldEventPage,
  WorldEventQuery,
  WorldImage,
  WorldIntervention,
  WorldOverview,
  WorldProjectBinding,
  WorldRun,
  WorldRunRecoveryCall,
  WorldRunRecoveryList,
  WorldRunRecoveryResult,
  WorldStoryLine,
  WorldDefinition,
} from '@sthstart/contracts';

export type WorldList = Static<typeof WorldListSchema>;
export type WorldMemoryList = Static<typeof WorldMemoryListSchema>;
export type WorldImageList = Static<typeof WorldImageListSchema>;
export type WorldRevisionRequest = Static<typeof WorldRevisionRequestSchema>;
export const WorldProjectBindingResponseSchema = Type.Object({
  binding: Type.Union([WorldProjectBindingSchema, Type.Null()]),
}, { additionalProperties: false });
export type WorldProjectBindingResponse = Static<typeof WorldProjectBindingResponseSchema>;

const BASE = 'story-worlds';

function worldPath(worldId: string) {
  return `${BASE}/${encodeURIComponent(worldId)}`;
}

function branchPath(worldId: string, branchId: string) {
  return `${worldPath(worldId)}/branches/${encodeURIComponent(branchId)}`;
}

export function fetchWorlds(): Promise<WorldList> {
  return getJson<WorldList>(BASE, undefined, WorldListSchema);
}

export function createWorld(definition: WorldDefinition): Promise<StoryWorld> {
  return postJson<StoryWorld>(BASE, definition, undefined, StoryWorldSchema);
}

export function fetchWorldOverview(worldId: string): Promise<WorldOverview> {
  return getJson<WorldOverview>(worldPath(worldId), undefined, WorldOverviewSchema);
}

export function updateWorld(
  worldId: string,
  expectedRevision: number,
  definition: WorldDefinition,
): Promise<StoryWorld> {
  return putJson<StoryWorld>(
    worldPath(worldId),
    { expectedRevision, definition },
    undefined,
    StoryWorldSchema,
  );
}

export function createWorldBranch(
  worldId: string,
  input: CreateWorldBranch,
): Promise<WorldBranch> {
  return postJson<WorldBranch>(
    `${worldPath(worldId)}/branches`,
    input,
    undefined,
    WorldBranchSchema,
  );
}

export function fetchWorldBranch(
  worldId: string,
  branchId: string,
): Promise<WorldBranchDetail> {
  return getJson<WorldBranchDetail>(
    branchPath(worldId, branchId),
    undefined,
    WorldBranchDetailSchema,
  );
}

export function fetchWorldEvents(
  worldId: string,
  branchId: string,
  query: WorldEventQuery = {},
  signal?: AbortSignal,
): Promise<WorldEventPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return getJson<WorldEventPage>(
    `${branchPath(worldId, branchId)}/events${suffix}`,
    { signal },
    WorldEventPageSchema,
  );
}

export function fetchWorldMemories(
  worldId: string,
  branchId: string,
  actorId?: string,
): Promise<WorldMemoryList> {
  const params = new URLSearchParams();
  if (actorId) params.set('actorId', actorId);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return getJson<WorldMemoryList>(
    `${branchPath(worldId, branchId)}/memories${suffix}`,
    undefined,
    WorldMemoryListSchema,
  );
}

export function createWorldStoryLine(
  worldId: string,
  branchId: string,
  input: CreateWorldStoryLine,
): Promise<WorldStoryLine> {
  return postJson<WorldStoryLine>(
    `${branchPath(worldId, branchId)}/story-lines`,
    input,
    undefined,
    WorldStoryLineSchema,
  );
}

export function createWorldIntervention(
  worldId: string,
  branchId: string,
  input: CreateWorldIntervention,
): Promise<WorldIntervention> {
  return postJson<WorldIntervention>(
    `${branchPath(worldId, branchId)}/interventions`,
    input,
    undefined,
    WorldInterventionSchema,
  );
}

export function startWorldRun(
  worldId: string,
  branchId: string,
  input: StartWorldRun,
): Promise<WorldRun> {
  return postJson<WorldRun>(
    `${branchPath(worldId, branchId)}/runs`,
    input,
    undefined,
    WorldRunSchema,
  );
}

export function pauseWorldRun(
  worldId: string,
  branchId: string,
  runId: string,
  input: WorldRevisionRequest,
): Promise<WorldRun> {
  return postJson<WorldRun>(
    `${branchPath(worldId, branchId)}/runs/${encodeURIComponent(runId)}/pause`,
    input,
    undefined,
    WorldRunSchema,
  );
}

export function resumeWorldRun(
  worldId: string,
  branchId: string,
  runId: string,
  input: ResumeWorldRun,
): Promise<WorldRun> {
  return postJson<WorldRun>(
    `${branchPath(worldId, branchId)}/runs/${encodeURIComponent(runId)}/resume`,
    input,
    undefined,
    WorldRunSchema,
  );
}

export function planWorldImages(
  worldId: string,
  branchId: string,
  input: PlanWorldImages,
): Promise<WorldImageList> {
  return postJson<WorldImageList>(
    `${branchPath(worldId, branchId)}/images/plan`,
    input,
    undefined,
    WorldImageListSchema,
  );
}

export function submitWorldImage(
  worldId: string,
  branchId: string,
  imageId: string,
  input: SubmitWorldImage,
): Promise<WorldImage> {
  return postJson<WorldImage>(
    `${branchPath(worldId, branchId)}/images/${encodeURIComponent(imageId)}/submit`,
    input,
    undefined,
    WorldImageSchema,
  );
}

export function adoptWorldEvents(
  worldId: string,
  branchId: string,
  input: WorldAdoption,
): Promise<WorldAdoptionResult> {
  return postJson<WorldAdoptionResult>(
    `${branchPath(worldId, branchId)}/adopt`,
    input,
    undefined,
    WorldAdoptionResultSchema,
  );
}

export function refreshWorldSources(
  worldId: string,
  branchId: string,
  input: RefreshWorldSources,
): Promise<WorldBranchDetail> {
  return postJson<WorldBranchDetail>(
    `${branchPath(worldId, branchId)}/sources/refresh`,
    input,
    undefined,
    WorldBranchDetailSchema,
  );
}

export function fetchWorldSourceUpdatePreview(
  worldId: string,
  branchId: string,
  signal?: AbortSignal,
): Promise<WorldSourceUpdatePreview> {
  return getJson<WorldSourceUpdatePreview>(
    `${branchPath(worldId, branchId)}/sources/preview`,
    { signal },
    WorldSourceUpdatePreviewSchema,
  );
}

export function bindWorldProject(
  worldId: string,
  branchId: string,
  input: BindWorldProject,
): Promise<WorldProjectBinding> {
  return postJson<WorldProjectBinding>(
    `${branchPath(worldId, branchId)}/project-binding`,
    input,
    undefined,
    WorldProjectBindingSchema,
  );
}

export function fetchWorldProjectBinding(projectId: string): Promise<WorldProjectBindingResponse> {
  return getJson<WorldProjectBindingResponse>(
    `${BASE}/project-bindings/${encodeURIComponent(projectId)}`,
    undefined,
    WorldProjectBindingResponseSchema,
  );
}

export function fetchRunRecovery(
  worldId: string,
  branchId: string,
  runId: string,
): Promise<WorldRunRecoveryList> {
  return getJson<WorldRunRecoveryList>(
    `${branchPath(worldId, branchId)}/runs/${encodeURIComponent(runId)}/recovery`,
    undefined,
    WorldRunRecoveryListSchema,
  );
}

export function resolveRunCall(
  worldId: string,
  branchId: string,
  runId: string,
  callId: string,
  input: ResolveWorldRunCall,
): Promise<WorldRunRecoveryResult> {
  return postJson<WorldRunRecoveryResult>(
    `${branchPath(worldId, branchId)}/runs/${encodeURIComponent(runId)}/recovery/${encodeURIComponent(callId)}`,
    input,
    undefined,
    WorldRunRecoveryResultSchema,
  );
}

export function promoteWorldActor(
  worldId: string,
  branchId: string,
  actorId: string,
  input: PromoteWorldActor,
): Promise<WorldActorPromotionResult> {
  return postJson<WorldActorPromotionResult>(
    `${branchPath(worldId, branchId)}/actors/${encodeURIComponent(actorId)}/promote`,
    input,
    undefined,
    WorldActorPromotionResultSchema,
  );
}

export function fetchUncertainGenerationTasks(
  query: { limit?: number; appId?: string } = {},
): Promise<GenerationRecoveryListResponse> {
  const params = new URLSearchParams();
  if (query.limit) params.set('limit', String(query.limit));
  if (query.appId) params.set('appId', query.appId);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return getJson<GenerationRecoveryListResponse>(
    `generation/uncertain-tasks${suffix}`,
    undefined,
    GenerationRecoveryListResponseSchema,
  );
}

export function resolveUncertainGenerationTask(
  taskId: string,
  input: GenerationRecoveryResolveRequest,
): Promise<GenerationRecoveryResolveResponse> {
  return postJson<GenerationRecoveryResolveResponse>(
    `generation/tasks/${encodeURIComponent(taskId)}/resolve-uncertain`,
    input,
    undefined,
    GenerationRecoveryResolveResponseSchema,
  );
}
