/**
 * @deprecated 集中 API 入口，拆分至子域 api 目录。
 * 新调用请直接引入对应子域：
 * - `@/app/features/activities/api/activities` (基础生命周期、草稿、版本、文本生成任务与预设)
 * - `@/app/features/activities/api/planning` (企划向导会话、任务、人设与研究)
 * - `@/app/features/activities/api/images` (资产、画廊、配置、提示词、绘制尝试与批量任务)
 * - `@/app/features/activities/api/playback` (自动播放与播放版本)
 * - `@/app/features/activities/api/studio` (工作台故事板、细化、降级与健康)
 * - `@/app/features/activities/api/beat-renders` (分镜渲染与候选)
 */

export * from './api/activities';
export * from './api/planning';
export * from './api/playback';
export * from './api/images';
export * from './shared/types';

export type {
  Activity,
  ActivityDraft,
  ContentDocument,
  ContentRevision,
  MediaRevisionDocument,
  MediaRevision,
  PlaybackDocument,
  PlaybackRevision,
  ActivityAsset,
  ActivityGallery,
  ActivityCandidate,
  ActivityCheckpoint,
  ActivityJob,
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
  ActivityPlanningForm,
  ActivityPlanningFormExtended,
  ActivityPlanningSessionResponse,
  ActivityPlanningJob,
  ActivityPlanningCandidate,
  ActivityPlanningActorResolveInput,
  ActivityPlanningActorResolveResult,
  ActivityPlanningPersonaDraft,
  ResearchTask,
  PlanningSelectionState,
  ActivityProductionOverview,
  AdoptCandidateBatchInput,
  AdoptCandidateBatchOutput,
  PrepareMediaBatchInput,
  PrepareMediaBatchOutput,
  CreateMediaBatchInput,
  ActivityMediaBatch,
  ActivityPresetKind,
  ActivityReusablePreset,
  CreateActivityPresetInput,
  InstantiateTemplateInput,
  UpdateActivityPresetInput,
  ActivityPageQuery,
  ActivityPageResponse,
  ImageAttemptPage,
} from '@sthstart/contracts';

export {
  ActivityGallerySchema,
  ActivityPageResponseSchema,
  ImageAttemptPageSchema,
} from '@sthstart/contracts';
