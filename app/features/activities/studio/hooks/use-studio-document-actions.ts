'use client';

import type { ActivityScene, ContentDocument, StageDefinition } from '@sthstart/contracts';
import { getEffectiveStageScenes, writeStageScenes } from '../../scene-beat-utils';
import {
  createBeat,
  createScene,
  createStage,
  createStudioId,
  insertBeatInScenes,
  removeBeatFromScenes,
  removeSceneFromScenes,
  updateBeatInScenes,
  updateDocumentTitle,
  updateSceneInScenes,
} from '../model/document';

export interface StudioDocumentActionsOptions {
  document: ContentDocument | null;
  activeStage: StageDefinition | null;
  activeScene: ActivityScene | null;
  activeSceneId: string | null;
  scenes: ActivityScene[];
  selectedBeatId: string | null;
  updateDocument: (document: ContentDocument) => void;
  setActiveStageId: (stageId: string) => void;
  setActiveSceneId: (sceneId: string | null) => void;
  setSelectedBeatId: (beatId: string | null) => void;
}

/** 文档编辑动作；纯转换在 model/document，这里只负责与草稿控制器和选中状态衔接。 */
export function useStudioDocumentActions({
  document,
  activeStage,
  activeScene,
  activeSceneId,
  scenes,
  selectedBeatId,
  updateDocument,
  setActiveStageId,
  setActiveSceneId,
  setSelectedBeatId,
}: StudioDocumentActionsOptions) {
  const handleUpdateScenes = (nextScenes: ActivityScene[]) => {
    if (!document || !activeStage) return;
    updateDocument(writeStageScenes(document, activeStage.id, nextScenes));
  };

  const handleUpdateTitle = (newTitle: string) => {
    if (!document) return;
    updateDocument(updateDocumentTitle(document, newTitle));
  };

  const handleUpdateBeat = (beatId: string, patch: Partial<ActivityScene['beats'][number]>) => {
    if (!activeScene) return;
    handleUpdateScenes(updateBeatInScenes(scenes, activeScene.id, beatId, patch));
  };

  const handleAddBeat = (insertIndex?: number) => {
    if (!document || !activeStage || !activeScene) return;
    const newBeatId = createStudioId('beat');
    const newBeat = createBeat({
      id: newBeatId,
      sceneId: activeScene.id,
      stageId: activeStage.id,
      actor: document.actors[0],
      orderIndex: (activeScene.beats.length + 1) * 10,
    });
    handleUpdateScenes(insertBeatInScenes(scenes, activeScene.id, newBeat, insertIndex));
    setSelectedBeatId(newBeatId);
  };

  const handleDeleteBeat = (beatId: string) => {
    if (!activeScene) return;
    const nextScenes = removeBeatFromScenes(scenes, activeScene.id, beatId);
    const nextBeats = nextScenes.find((scene) => scene.id === activeScene.id)?.beats ?? [];
    handleUpdateScenes(nextScenes);
    if (selectedBeatId === beatId) setSelectedBeatId(nextBeats[0]?.id || null);
  };

  const handleAddScene = (stageId: string) => {
    if (!document) return;
    const targetStage = document.stages.find((stage) => stage.id === stageId);
    if (!targetStage) return;
    const stageScenes = getEffectiveStageScenes(targetStage, document.scenes);
    const newSceneId = createStudioId('scene');
    const newBeat = createBeat({
      id: createStudioId('beat'),
      sceneId: newSceneId,
      stageId,
      actor: document.actors[0],
      orderIndex: 0,
    });
    const newScene = createScene({
      id: newSceneId,
      stageId,
      title: `新场次 ${stageScenes.length + 1}`,
      locationText: targetStage.location || '',
      orderIndex: stageScenes.length * 10,
      beats: [newBeat],
    });
    updateDocument(writeStageScenes(document, stageId, [...stageScenes, newScene]));
    setActiveStageId(stageId);
    setActiveSceneId(newSceneId);
    setSelectedBeatId(newBeat.id);
  };

  const handleUpdateScene = (patch: Partial<ActivityScene>) => {
    if (!activeScene) return;
    handleUpdateScenes(updateSceneInScenes(scenes, activeScene.id, patch));
  };

  const handleDeleteScene = (sceneId: string) => {
    if (!window.confirm('确定要删除该场次及场次内的所有分镜吗？')) return;
    const nextScenes = removeSceneFromScenes(scenes, sceneId);
    handleUpdateScenes(nextScenes);
    if (activeSceneId === sceneId) {
      setActiveSceneId(nextScenes[0]?.id || null);
      setSelectedBeatId(nextScenes[0]?.beats[0]?.id || null);
    }
  };

  const handleAddStage = () => {
    if (!document) return;
    const newStageId = createStudioId('stage');
    const newStageOrder = document.stages.length + 1;
    const newStage = createStage({
      id: newStageId,
      order: newStageOrder,
      actorIds: document.actors.map((actor) => actor.id),
      location: document.activity.location || '',
    });
    const newSceneId = `scene_${crypto.randomUUID()}`;
    const newScene = createScene({
      id: newSceneId,
      stageId: newStageId,
      title: '新场次 1',
      locationText: newStage.location || '',
      orderIndex: 0,
    });
    updateDocument(writeStageScenes({
      ...document,
      stages: [...document.stages, newStage],
    }, newStageId, [newScene]));
    setActiveStageId(newStageId);
    setActiveSceneId(newSceneId);
    setSelectedBeatId(null);
  };

  return {
    handleUpdateTitle,
    handleUpdateBeat,
    handleAddBeat,
    handleDeleteBeat,
    handleAddScene,
    handleUpdateScene,
    handleDeleteScene,
    handleAddStage,
  };
}
