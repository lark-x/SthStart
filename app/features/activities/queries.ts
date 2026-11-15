/**
 * @deprecated 集中查询入口，拆分至子域 queries 目录。
 * 新调用请直接引入对应子域：
 * - `@/app/features/activities/queries/activities`
 * - `@/app/features/activities/queries/images`
 * - `@/app/features/activities/queries/comic`
 * - `@/app/features/activities/queries/playback`
 */
export * from './queries/activities';
export * from './queries/images';
export * from './queries/comic';
export * from './queries/playback';

export type { ActivityListFilter } from './shared/types';
export type { ActivityPresetKind } from '@sthstart/contracts';
