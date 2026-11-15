/**
 * @deprecated 集中变更入口，拆分至子域 mutations 目录。
 * 新调用请直接引入对应子域：
 * - `@/app/features/activities/mutations/activities`
 * - `@/app/features/activities/mutations/images`
 * - `@/app/features/activities/mutations/comic`
 * - `@/app/features/activities/mutations/playback`
 */
export * from './mutations/activities';
export * from './mutations/images';
export * from './mutations/comic';
export * from './mutations/playback';

export type { CreateActivityInput } from './shared/types';
export type { PreparePromptRecipeRequest } from '@sthstart/contracts';
export type {
  Activity,
  ContentDocument,
  MediaRevisionDocument,
  PlaybackDocument,
  ImageConfigDocument,
  AdoptCandidateBatchInput,
  PrepareMediaBatchInput,
  CreateMediaBatchInput,
  CreateActivityPresetInput,
  UpdateActivityPresetInput,
  InstantiateTemplateInput,
  ComicDocument,
  ComicStoryboardRequest,
} from '@sthstart/contracts';
