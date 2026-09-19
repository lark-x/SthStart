'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAdoptCandidate, useTriggerTextGeneration } from '../mutations';
import { useActivityJob } from '../queries';

export type ActivityGenerationMode =
  | 'plan' | 'stage' | 'whole-text' | 'rewrite-records'
  | 'invite' | 'wish' | 'moment' | 'shot' | 'continue-chat';

/**
 * 视图内一键生成共用的状态机。
 *
 * 生成任务与候选轮询原本只写在生成弹窗里，群聊/朋友圈要在视图内直接生成，
 * 所以抽到这里：两处共用同一套「发起 → 轮询 → 采用」流程，避免各写一份。
 */
export function useActivityGeneration(activityId: string, headVersion: number) {
  const queryClient = useQueryClient();
  const triggerMutation = useTriggerTextGeneration();
  const adoptMutation = useAdoptCandidate();
  const [jobId, setJobId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: jobData } = useActivityJob(activityId, jobId || undefined);
  const job = jobData?.job;
  const candidates = useMemo(() => jobData?.candidates || [], [jobData]);

  const start = useCallback(async (input: {
    mode: ActivityGenerationMode;
    scope?: Record<string, unknown>;
    userInstruction?: string;
  }) => {
    setErrorMsg(null);
    try {
      const created = await triggerMutation.mutateAsync({
        id: activityId,
        input: {
          mode: input.mode,
          scope: input.scope,
          userInstruction: input.userInstruction,
          idempotencyKey: `gen_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        },
      });
      setJobId(created.id);
      return created.id;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '启动生成任务失败');
      return null;
    }
  }, [activityId, triggerMutation]);

  const adopt = useCallback(async (candidateId: string) => {
    setErrorMsg(null);
    try {
      await adoptMutation.mutateAsync({ id: activityId, candidateId, expectedHeadVersion: headVersion });
      await queryClient.invalidateQueries();
      setJobId(null);
      return true;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '采用候选失败');
      return false;
    }
  }, [activityId, headVersion, adoptMutation, queryClient]);

  const reset = useCallback(() => { setJobId(null); setErrorMsg(null); }, []);

  return {
    jobId,
    job,
    candidates,
    start,
    adopt,
    reset,
    errorMsg,
    starting: triggerMutation.isPending,
    adopting: adoptMutation.isPending,
    running: Boolean(job && ['queued', 'preparing', 'submitting', 'accepted', 'running'].includes(job.status)),
    failed: job?.status === 'failed',
  };
}

