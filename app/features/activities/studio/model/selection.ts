import type { ActivityScene, ContentDocument, SceneBeat, StageDefinition } from '@sthstart/contracts';
import { getEffectiveStageScenes } from '../../scene-beat-utils';

export function resolveActiveStage(document: ContentDocument | null, activeStageId: string): StageDefinition | null {
  if (!document) return null;
  return document.stages.find((stage) => stage.id === activeStageId) || document.stages[0] || null;
}

export function resolveActiveScene(scenes: ActivityScene[], activeSceneId: string | null): ActivityScene | null {
  if (!scenes.length) return null;
  return scenes.find((scene) => scene.id === activeSceneId) || scenes[0] || null;
}

export function resolveSelectedBeat(activeScene: ActivityScene | null, selectedBeatId: string | null): SceneBeat | null {
  if (!activeScene || !activeScene.beats.length) return null;
  return activeScene.beats.find((beat) => beat.id === selectedBeatId) || activeScene.beats[0] || null;
}

export function resolveStageSelection(document: ContentDocument, stageId: string) {
  const stage = document.stages.find((item) => item.id === stageId);
  if (!stage) return { sceneId: null, beatId: null };
  const scenes = getEffectiveStageScenes(stage, document.scenes);
  return { sceneId: scenes[0]?.id ?? null, beatId: scenes[0]?.beats[0]?.id ?? null };
}

export function resolveSceneSelection(document: ContentDocument, stageId: string, sceneId: string) {
  const stage = document.stages.find((item) => item.id === stageId);
  if (!stage) return null;
  const scenes = getEffectiveStageScenes(stage, document.scenes);
  return scenes.find((scene) => scene.id === sceneId)?.beats[0]?.id ?? null;
}
