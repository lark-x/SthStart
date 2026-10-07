import { getJson, postJson, putJson } from '@/app/lib/api-client';
import { StudioJobSchema, StudioJobPageSchema, type StudioJob, type StudioJobPage,
  type StudioStoryboardRequest, type StudioStoryboardApply, type StudioRefineRequest, type StudioRefineApply, type StudioVersionContext,
  StudioItemPageSchema,StudioVersionContextSchema,type StudioItemPage,type StudioBatchRequest,type StudioBatchStart,type StudioBatchRetry,type StudioJobResume } from '@sthstart/contracts';
import {StudioHealthResultSchema,type StudioHealthRequest,type StudioHealthResult} from '@sthstart/contracts';
import {StudioTextFallbackOptionsSchema,StudioTextFallbackPreviewSchema,type StudioTextFallbackOptions,type StudioTextFallbackPreview,
  type StudioTextFallbackRequest,type StudioTextFallbackSelection} from '@sthstart/contracts';
import {StudioImageFallbackOptionsSchema,StudioImageFallbackPreviewSchema,type StudioImageFallbackOptions,type StudioImageFallbackPreview,
  type StudioImageFallbackRequest,type StudioImageFallbackSelection} from '@sthstart/contracts';
import { fetchActivity, fetchDraft, fetchImageConfigDraft } from './api';
import { fetchComicDraft } from './comic/api';
import { ActivityArtStylesResponseSchema, ActivityReusablePresetSchema, CommitActivityArtDirectionResponseSchema,
  type ActivityArtStylesResponse, type ActivityReusablePreset, type ActivityArtStyleWrite, type ActivityArtStyleUpdate,
  type CommitActivityArtDirectionRequest, type CommitActivityArtDirectionResponse,
  ActivitySlotVisualPreviewSchema, type ActivitySlotVisualPreviewRequest, type ActivitySlotVisualPreview } from '@sthstart/contracts';
import { HiresPreviewResponseSchema, type HiresPreviewRequest, type HiresPreviewResponse, type HiresSubmitRequest } from '@sthstart/contracts';

export function fetchActivityArtStyles(): Promise<ActivityArtStylesResponse> {
  return getJson('activity-art-styles', undefined, ActivityArtStylesResponseSchema);
}
export function createActivityArtStyle(input: ActivityArtStyleWrite): Promise<ActivityReusablePreset> {
  return postJson('activity-art-styles', input, undefined, ActivityReusablePresetSchema);
}
export function updateActivityArtStyle(id: string, input: ActivityArtStyleUpdate): Promise<ActivityReusablePreset> {
  return putJson(`activity-art-styles/${encodeURIComponent(id)}`, input, undefined, ActivityReusablePresetSchema);
}
export function commitActivityArtDirection(activityId: string, input: CommitActivityArtDirectionRequest): Promise<CommitActivityArtDirectionResponse> {
  return postJson(`activities/${encodeURIComponent(activityId)}/art-direction/commit`, input, undefined, CommitActivityArtDirectionResponseSchema);
}
export function previewActivitySlotVisual(activityId: string, input: ActivitySlotVisualPreviewRequest): Promise<ActivitySlotVisualPreview> {
  return postJson(`activities/${encodeURIComponent(activityId)}/slot-visual-preview`, input, undefined, ActivitySlotVisualPreviewSchema);
}

/**
 * 放大细化（计划 §11.1 / §15.2）。
 * 预览不创建任务、不调用模型；提交必须回传预览 seed 与 planHash。
 * 状态、items、stop、reconcile、resume 仍走既有 studio-jobs 系列，不另开轮询。
 */
export function previewStudioHires(id: string, input: HiresPreviewRequest): Promise<HiresPreviewResponse> {
  return postJson(`activities/${encodeURIComponent(id)}/studio/hires/preview`, input, undefined, HiresPreviewResponseSchema);
}
export function createStudioHires(id: string, input: HiresSubmitRequest): Promise<StudioJob> {
  return postJson(`activities/${encodeURIComponent(id)}/studio/hires`, input, undefined, StudioJobSchema);
}

const studioRoot = (id: string) => `activities/${encodeURIComponent(id)}/studio-jobs`;
export function fetchStudioTextFallbackOptions(id:string,jobId:string):Promise<StudioTextFallbackOptions>{
  return getJson(`${studioRoot(id)}/${encodeURIComponent(jobId)}/text-fallback-options`,undefined,StudioTextFallbackOptionsSchema);
}
export function previewStudioTextFallback(id:string,jobId:string,input:StudioTextFallbackSelection):Promise<StudioTextFallbackPreview>{
  return postJson(`${studioRoot(id)}/${encodeURIComponent(jobId)}/text-fallback-preview`,input,undefined,StudioTextFallbackPreviewSchema);
}
export function createStudioTextFallback(id:string,jobId:string,input:StudioTextFallbackRequest):Promise<StudioJob>{
  return postJson(`${studioRoot(id)}/${encodeURIComponent(jobId)}/text-fallback`,input,undefined,StudioJobSchema);
}
export function fetchStudioImageFallbackOptions(id:string,jobId:string):Promise<StudioImageFallbackOptions>{
  return getJson(`${studioRoot(id)}/${encodeURIComponent(jobId)}/image-fallback-options`,undefined,StudioImageFallbackOptionsSchema);
}
export function previewStudioImageFallback(id:string,jobId:string,input:StudioImageFallbackSelection):Promise<StudioImageFallbackPreview>{
  return postJson(`${studioRoot(id)}/${encodeURIComponent(jobId)}/image-fallback-preview`,input,undefined,StudioImageFallbackPreviewSchema);
}
export function createStudioImageFallback(id:string,jobId:string,input:StudioImageFallbackRequest):Promise<StudioJob>{
  return postJson(`${studioRoot(id)}/${encodeURIComponent(jobId)}/image-fallback`,input,undefined,StudioJobSchema);
}
export function inspectStudioHealth(id:string,input:StudioHealthRequest):Promise<StudioHealthResult>{
  return postJson(`${studioRoot(id)}/health`,input,undefined,StudioHealthResultSchema);
}
export function resumeStudioJob(id:string,jobId:string,input:StudioJobResume):Promise<StudioJob>{
  return postJson(`${studioRoot(id)}/${encodeURIComponent(jobId)}/resume`,input,undefined,StudioJobSchema);
}
export function reconcileStudioJob(id:string,jobId:string):Promise<StudioJob>{
  return postJson(`${studioRoot(id)}/${encodeURIComponent(jobId)}/reconcile`,{},undefined,StudioJobSchema);
}
export function createStudioStoryboard(id: string, input: StudioStoryboardRequest | StudioRefineRequest | StudioBatchRequest): Promise<StudioJob> {
  return postJson(studioRoot(id), input, undefined, StudioJobSchema);
}
export function fetchStudioJob(id: string, jobId: string): Promise<StudioJob> {
  return getJson(`${studioRoot(id)}/${encodeURIComponent(jobId)}`, undefined, StudioJobSchema);
}
export function fetchStudioJobs(id: string, cursor?: string): Promise<StudioJobPage> {
  const query = new URLSearchParams({ limit: '20' });
  if (cursor) query.set('cursor', cursor);
  return getJson(`${studioRoot(id)}?${query}`, undefined, StudioJobPageSchema);
}
export function applyStudioStoryboard(id: string, jobId: string, input: StudioStoryboardApply | StudioRefineApply): Promise<StudioJob> {
  return postJson(`${studioRoot(id)}/${encodeURIComponent(jobId)}/apply`, input, undefined, StudioJobSchema);
}
export function stopStudioJob(id: string, job: StudioJob): Promise<StudioJob> {
  return postJson(`${studioRoot(id)}/${encodeURIComponent(job.id)}/stop`, { expectedJobRevision: job.revision }, undefined, StudioJobSchema);
}
export function startStudioBatch(id:string,jobId:string,input:StudioBatchStart):Promise<StudioJob>{
  return postJson(`${studioRoot(id)}/${encodeURIComponent(jobId)}/start`,input,undefined,StudioJobSchema);
}
export function retryStudioBatch(id:string,jobId:string,input:StudioBatchRetry):Promise<StudioJob>{
  return postJson(`${studioRoot(id)}/${encodeURIComponent(jobId)}/retry`,input,undefined,StudioJobSchema);
}
/** The caller must flush all editor queues. Only an explicit new task/preview prepares immutable versions. */
export async function prepareStudioContext(id:string):Promise<StudioVersionContext>{
  return postJson(`${studioRoot(id)}/prepare-context`,{expected:await fetchStudioVersions(id)},undefined,StudioVersionContextSchema);
}
export function fetchStudioItems(id:string,jobId:string,cursor?:string):Promise<StudioItemPage>{
  const query=new URLSearchParams({limit:'20'});if(cursor)query.set('cursor',cursor);
  return getJson(`${studioRoot(id)}/${encodeURIComponent(jobId)}/items?${query}`,undefined,StudioItemPageSchema);
}
/** Only call after all mounted draft queues have flushed. Never manufacture a revision by opening the panel. */
export async function fetchStudioVersions(id: string): Promise<StudioVersionContext> {
  const [activity, draft, image, comic] = await Promise.all([fetchActivity(id), fetchDraft(id), fetchImageConfigDraft(id), fetchComicDraft(id)]);
  return { headVersion: activity.activity.headVersion, contentDraftVersion: draft.draft.draftVersion,
    contentRevisionId: activity.activity.currentContentRevisionId, imageConfigDraftVersion: image.draftVersion,
    imageConfigRevisionId: image.baseRevisionId, ...(comic ? { comicDraftVersion: comic.draftVersion } : {}) };
}
