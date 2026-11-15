'use client';

import React from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { ActivityScene, ContentDocument, SceneBeat, StageDefinition } from '@sthstart/contracts';
import { getEffectiveStageScenes } from '../../scene-beat-utils';
import { submitBeatRender } from '../../beat-renders-api';
import type { StudioDraftController } from '../model/draft-controller';

interface StudioToast {
  success(title: string, description?: string): void;
  info(title: string, description?: string): void;
  error(title: string, description?: string): void;
}

export function useStudioRenderTasks({
  activityId,
  document,
  activeStage,
  activeScene,
  draft,
  queryClient,
  toast,
}: {
  activityId: string;
  document: ContentDocument | null;
  activeStage: StageDefinition | null;
  activeScene: ActivityScene | null;
  draft: StudioDraftController;
  queryClient: QueryClient;
  toast: StudioToast;
}) {
  const [generatingBeatIds, setGeneratingBeatIds] = React.useState<Set<string>>(new Set());
  const [isBatchGenerating, setIsBatchGenerating] = React.useState(false);
  const quickAttempts = React.useRef(new Map<string, string>());
  const quickLocks = React.useRef(new Set<string>());

  const handleQuickGenerateBeat = async (beat: SceneBeat) => {
    if (!activeStage || !activeScene || quickLocks.current.has(beat.id)) return;
    quickLocks.current.add(beat.id);
    if (!await draft.flush()) { quickLocks.current.delete(beat.id); return; }
    const beatId = beat.id;
    setGeneratingBeatIds((prev) => new Set(prev).add(beatId));

    try {
      const identity = JSON.stringify([activeStage.id, activeScene.id, beatId, beat.action, beat.renderSettings]);
      const idempotencyKey = quickAttempts.current.get(identity) ?? `beat-${crypto.randomUUID()}`;
      quickAttempts.current.set(identity, idempotencyKey);
      await submitBeatRender(activityId, {
        stageId: activeStage.id,
        sceneId: activeScene.id,
        beatId,
        idempotencyKey,
        ...(beat.renderSettings?.customPrompt ? { customPrompt: beat.renderSettings.customPrompt } : {}),
        ...(beat.renderSettings?.negativePrompt !== undefined ? { negativePrompt: beat.renderSettings.negativePrompt } : {}),
      });
      quickAttempts.current.delete(identity);
      await queryClient.invalidateQueries({ queryKey: ['activity-beat-renders', activityId] });
      toast.success('已提交生成任务，进度与结果可在镜头工坊查看');
    } catch (err) {
      toast.error('提交生图失败', err instanceof Error ? err.message : undefined);
    } finally {
      quickLocks.current.delete(beat.id);
      setTimeout(() => {
        setGeneratingBeatIds((prev) => {
          const next = new Set(prev);
          next.delete(beatId);
          return next;
        });
      }, 1000);
    }
  };

  const handleBatchGenerate = async () => {
    if (!activeStage || !document) return;
    const allStageScenes = getEffectiveStageScenes(activeStage, document.scenes);
    const pendingBeats: { sceneId: string; beat: SceneBeat }[] = [];

    for (const scene of allStageScenes) {
      for (const beat of scene.beats) {
        if (!beat.mediaUrl && beat.mediaType !== 'video') {
          pendingBeats.push({ sceneId: scene.id, beat });
        }
      }
    }

    if (pendingBeats.length === 0) {
      toast.info('当前幕所有镜头均已生成画面');
      return;
    }

    if (!await draft.flush()) return;
    setIsBatchGenerating(true);
    let successCount = 0;

    for (const { sceneId, beat } of pendingBeats) {
      try {
        const idempotencyKey = `batch-${activityId}-${beat.id}-${Date.now()}`;
        await submitBeatRender(activityId, {
          stageId: activeStage.id,
          sceneId,
          beatId: beat.id,
          idempotencyKey,
        });
        successCount++;
      } catch {
        // Continue others
      }
    }

    setIsBatchGenerating(false);
    toast.success(`已为 ${successCount} 个镜头排队生成画面，后台绘制中`);
  };

  return { generatingBeatIds, isBatchGenerating, handleQuickGenerateBeat, handleBatchGenerate };
}
