'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { StudioJob, StudioStoryboardApply, StudioRefineApply,StudioBatchStart,StudioBatchRetry,StudioJobResume } from '@sthstart/contracts';
import { activityKeys } from '@/app/lib/query-keys';
import { applyStudioStoryboard, createStudioStoryboard, stopStudioJob,startStudioBatch,retryStudioBatch,prepareStudioContext,resumeStudioJob,reconcileStudioJob } from './studio-api';
import { studioKeys } from './studio-queries';
import {createStudioTextFallback} from './studio-api';
import {createStudioImageFallback} from './studio-api';
import type {StudioTextFallbackRequest,StudioImageFallbackRequest} from '@sthstart/contracts';

export function useStudioJobMutations(activityId: string) {
  const cache = useQueryClient();
  const update = async (job: StudioJob) => {
    cache.setQueryData(studioKeys.job(activityId, job.id), job);
    await cache.invalidateQueries({ queryKey: studioKeys.jobs(activityId) });
  };
  const create = useMutation({ mutationFn: createStudioStoryboard.bind(null, activityId), onSuccess: update });
  const stop = useMutation({ mutationFn: stopStudioJob.bind(null, activityId), onSuccess: update });
  const start=useMutation({mutationFn:({jobId,input}:{jobId:string;input:StudioBatchStart})=>startStudioBatch(activityId,jobId,input),onSuccess:update});
  const retry=useMutation({mutationFn:({jobId,input}:{jobId:string;input:StudioBatchRetry})=>retryStudioBatch(activityId,jobId,input),onSuccess:update});
  const resume=useMutation({mutationFn:({jobId,input}:{jobId:string;input:StudioJobResume})=>resumeStudioJob(activityId,jobId,input),onSuccess:update});
  const reconcile=useMutation({mutationFn:(jobId:string)=>reconcileStudioJob(activityId,jobId),onSuccess:update});
  const textFallback=useMutation({mutationFn:({jobId,input}:{jobId:string;input:StudioTextFallbackRequest})=>createStudioTextFallback(activityId,jobId,input),onSuccess:update});
  const imageFallback=useMutation({mutationFn:({jobId,input}:{jobId:string;input:StudioImageFallbackRequest})=>createStudioImageFallback(activityId,jobId,input),onSuccess:update});
  const prepare=useMutation({mutationFn:()=>prepareStudioContext(activityId),onSuccess:async()=>{
    await Promise.all([activityKeys.detail(activityId),activityKeys.draft(activityId),activityKeys.imageConfigDraft(activityId),activityKeys.revisions(activityId),activityKeys.imageConfigRevisions(activityId)]
      .map(queryKey=>cache.invalidateQueries({queryKey})));
  }});
  const apply = useMutation({ mutationFn: ({ jobId, input }: { jobId: string; input: StudioStoryboardApply | StudioRefineApply }) => applyStudioStoryboard(activityId, jobId, input),
    onSuccess: async job => {
      await update(job);
      // No draft invalidations during polling. Only a successful explicit application refreshes affected content.
      await Promise.all([activityKeys.detail(activityId), activityKeys.draft(activityId), activityKeys.revisions(activityId),
        ...(job.appliedResult?.comicDraftVersion ? [activityKeys.comicDraft(activityId)] : [])]
        .map(queryKey => cache.invalidateQueries({ queryKey })));
    },
  });
  return { create, stop, apply,start,retry,prepare,resume,reconcile,textFallback,imageFallback };
}
