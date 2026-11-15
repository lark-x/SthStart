'use client';

import { useCallback, useMemo, useState } from 'react';
import type { ContentDocument } from '@sthstart/contracts';
import { getEffectiveStageScenes } from '../../scene-beat-utils';
import {
  resolveActiveScene,
  resolveActiveStage,
  resolveSceneSelection,
  resolveSelectedBeat,
  resolveStageSelection,
} from '../model/selection';

export function useStudioSelection(document: ContentDocument | null) {
  const [activeStageId, setActiveStageId] = useState('');
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);

  const activeStage = useMemo(() => resolveActiveStage(document, activeStageId), [document, activeStageId]);
  const scenes = useMemo(() => document && activeStage
    ? getEffectiveStageScenes(activeStage, document.scenes)
    : [], [document, activeStage]);
  const activeScene = useMemo(() => resolveActiveScene(scenes, activeSceneId), [scenes, activeSceneId]);
  const selectedBeat = useMemo(() => resolveSelectedBeat(activeScene, selectedBeatId), [activeScene, selectedBeatId]);

  const selectStage = useCallback((stageId: string) => {
    setActiveStageId(stageId);
    if (!document) return;
    const selection = resolveStageSelection(document, stageId);
    setActiveSceneId(selection.sceneId);
    setSelectedBeatId(selection.beatId);
  }, [document]);

  const selectScene = useCallback((stageId: string, sceneId: string) => {
    setActiveStageId(stageId);
    setActiveSceneId(sceneId);
    if (!document) return;
    setSelectedBeatId(resolveSceneSelection(document, stageId, sceneId));
  }, [document]);

  const selectBeat = useCallback((beatId: string | null) => setSelectedBeatId(beatId), []);

  return {
    activeStageId,
    activeSceneId,
    selectedBeatId,
    setActiveStageId,
    setActiveSceneId,
    setSelectedBeatId,
    activeStage,
    scenes,
    activeScene,
    selectedBeat,
    selectStage,
    selectScene,
    selectBeat,
  };
}
