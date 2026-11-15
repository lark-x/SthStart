export { activityKeys } from '../query-keys';
export { generationKeys } from '@/app/features/generation/query-keys';

export const studioKeys = {
  jobs: (activityId: string) => ['activity-studio-jobs', activityId] as const,
  job: (activityId: string, jobId: string) => ['activity-studio-job', activityId, jobId] as const,
  items: (activityId: string, jobId: string) => ['activity-studio-items', activityId, jobId] as const,
};
