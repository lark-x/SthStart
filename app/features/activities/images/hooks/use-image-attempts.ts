'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Activity, ExecutionSnapshot, GenerationAttempt, PromptRecipe } from '@sthstart/contracts';
import { fetchActivity, saveMediaRevision } from '../../api/activities';
import { fetchImageExecutionSnapshots, fetchPromptRecipe } from '../../api/images';
import { useImageAttemptPages } from '../../queries/images';
import { useCancelImageAttempt, useRetryImageAttempt } from '../../mutations/images';
import { flattenAttemptPages, isRunningAttempt } from '../model/attempts';
import type { WorkbenchSetNotice } from '../types';

type UseImageAttemptsOptions = {
  activity: Activity;
  slotId: string | undefined;
  onAdoptSlotAsset?: (slotId: string, assetKey: string) => Promise<void>;
  setNotice: WorkbenchSetNotice;
};

export type ImageAttemptsState = {
  attempts: GenerationAttempt[];
  attemptsQuery: ReturnType<typeof useImageAttemptPages>;
  currentAttempt: GenerationAttempt | undefined;
  selectedAttemptId: string | null;
  selectAttempt(id: string | null): void;
  compareAttemptId: string | null;
  compareAttempt: GenerationAttempt | undefined;
  setCompareAttemptId(id: string | null): void;
  hiresAttempt: { artifactId: string; label: string } | null;
  setHiresAttempt(value: { artifactId: string; label: string } | null): void;
  adoptingAssetKey: string | null;
  adopt(assetKey: string): Promise<void>;
  retry(attemptId: string, seed?: number): void;
  cancel(attemptId: string): void;
  historicalRecipe: PromptRecipe | null;
  executionSnapshots: ExecutionSnapshot[];
  refresh(): Promise<unknown>;
  isRunning(status: string): boolean;
};

export function useImageAttempts({
  activity,
  slotId,
  onAdoptSlotAsset,
  setNotice,
}: UseImageAttemptsOptions): ImageAttemptsState {
  const queryClient = useQueryClient();
  const attemptsQuery = useImageAttemptPages(activity.id, slotId);
  const { refetch: refetchAttempts } = attemptsQuery;
  const retryAttemptMutation = useRetryImageAttempt();
  const cancelAttemptMutation = useCancelImageAttempt();
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const [compareAttemptId, setCompareAttemptId] = useState<string | null>(null);
  const [hiresAttempt, setHiresAttempt] = useState<{ artifactId: string; label: string } | null>(null);
  const [adoptingAssetKey, setAdoptingAssetKey] = useState<string | null>(null);
  const [historicalRecipeState, setHistoricalRecipeState] = useState<{ recipeId: string; recipe: PromptRecipe } | null>(null);
  const [snapshotState, setSnapshotState] = useState<{ attemptId: string; status: string; items: ExecutionSnapshot[] } | null>(null);

  const attempts = flattenAttemptPages(attemptsQuery.data?.pages);
  const currentAttempt = attempts.find((attempt) => attempt.id === selectedAttemptId) || attempts[0];
  const compareAttempt = attempts.find((attempt) => attempt.id === compareAttemptId);
  const historicalRecipe = historicalRecipeState && historicalRecipeState.recipeId === currentAttempt?.recipeId
    ? historicalRecipeState.recipe
    : null;
  const executionSnapshots = snapshotState && snapshotState.attemptId === currentAttempt?.id && snapshotState.status === currentAttempt?.status
    ? snapshotState.items
    : [];

  useEffect(() => {
    let active = true;
    if (currentAttempt?.recipeId) {
      const recipeId = currentAttempt.recipeId;
      fetchPromptRecipe(activity.id, recipeId)
        .then((result) => { if (active) setHistoricalRecipeState({ recipeId, recipe: result.recipe }); })
        .catch((error) => { if (active) setNotice({ type: 'error', text: String(error) }); });
    }
    return () => { active = false; };
  }, [activity.id, currentAttempt?.recipeId, setNotice]);

  useEffect(() => {
    let active = true;
    if (currentAttempt?.id) {
      const attemptId = currentAttempt.id;
      const status = currentAttempt.status;
      fetchImageExecutionSnapshots(activity.id, currentAttempt.id)
        .then((result) => { if (active) setSnapshotState({ attemptId, status, items: result.items }); })
        .catch(() => {});
    }
    return () => { active = false; };
  }, [activity.id, currentAttempt?.id, currentAttempt?.status]);

  const adopt = useCallback(async (assetKey: string) => {
    if (!slotId) return;
    try {
      setAdoptingAssetKey(assetKey);
      if (onAdoptSlotAsset) await onAdoptSlotAsset(slotId, assetKey);
      else {
        const fresh = await fetchActivity(activity.id);
        const bindings = (fresh.currentMediaRevision?.slotBindings || []).filter((binding) => binding.slotId !== slotId);
        bindings.push({ slotId, slotFingerprint: '', assets: [{ assetKey, order: 10 }] });
        await saveMediaRevision(activity.id, fresh.activity.currentContentRevisionId!, bindings);
        await queryClient.invalidateQueries();
      }
      setNotice({ type: 'success', text: '已成功将该图片采用为镜头画面' });
      setTimeout(() => setNotice(null), 3_000);
    } catch (error) {
      setNotice({ type: 'error', text: '采用候选失败: ' + String(error) });
    } finally {
      setAdoptingAssetKey(null);
    }
  }, [activity.id, onAdoptSlotAsset, queryClient, setNotice, slotId]);

  const retry = useCallback((attemptId: string, seed?: number) => {
    retryAttemptMutation.mutate(seed === undefined
      ? { id: activity.id, attemptId }
      : { id: activity.id, attemptId, seed });
  }, [activity.id, retryAttemptMutation]);

  const cancel = useCallback((attemptId: string) => {
    cancelAttemptMutation.mutate({ id: activity.id, attemptId });
  }, [activity.id, cancelAttemptMutation]);

  return {
    attempts,
    attemptsQuery,
    currentAttempt,
    selectedAttemptId,
    selectAttempt: setSelectedAttemptId,
    compareAttemptId,
    compareAttempt,
    setCompareAttemptId,
    hiresAttempt,
    setHiresAttempt,
    adoptingAssetKey,
    adopt,
    retry,
    cancel,
    historicalRecipe,
    executionSnapshots,
    refresh: refetchAttempts,
    isRunning: isRunningAttempt,
  };
}
