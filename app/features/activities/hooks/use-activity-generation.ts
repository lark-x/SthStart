'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useTriggerTextGeneration } from '../mutations';
import { useActivityJob } from '../queries';

export type ActivityGenerationMode =
  | 'plan' | 'stage' | 'whole-text' | 'rewrite-records'
  | 'invite' | 'wish' | 'moment' | 'shot' | 'continue-chat';

/**
 * 视图内一键生成共用的状态机。
 *
 * 工作台与高级生成弹窗共享一个任务 ID 和轮询源；候选采用统一由差异审阅面板处理。
 */
export function useActivityGeneration(activityId: string, initialJobId?: string | null) {
  const triggerMutation = useTriggerTextGeneration();
  const [jobId, setJobId] = useState<string | null>(initialJobId || null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const startPromise = useRef<Promise<string | null> | null>(null);

  const { data: jobData, error: jobQueryError } = useActivityJob(activityId, jobId || undefined);
  const job = jobData?.job;
  const candidates = useMemo(() => jobData?.candidates || [], [jobData]);

  const start = useCallback(async (input: {
    mode: ActivityGenerationMode;
    scope?: Record<string, unknown>;
    userInstruction?: string;
  }) => {
    if (startPromise.current) return startPromise.current;
    setErrorMsg(null);
    const pending = (async () => {
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
    })();
    startPromise.current = pending;
    try {
      return await pending;
    } finally {
      if (startPromise.current === pending) startPromise.current = null;
    }
  }, [activityId, triggerMutation]);

  const reset = useCallback(() => { setJobId(null); setErrorMsg(null); }, []);
  const selectJob = useCallback((nextJobId: string | null) => {
    setJobId(nextJobId);
    setErrorMsg(null);
  }, []);

  return {
    jobId,
    job,
    candidates,
    start,
    reset,
    selectJob,
    errorMsg,
    queryError: jobQueryError instanceof Error ? jobQueryError.message : null,
    starting: triggerMutation.isPending,
    running: Boolean(job && ['queued', 'preparing', 'submitting', 'accepted', 'running'].includes(job.status)),
    failed: job?.status === 'failed',
  };
}
