import type {
  ActivityScene,
  ActorSnapshot,
  ContentDocument,
  SceneBeat,
  StageDefinition,
} from '@sthstart/contracts';

export function createStudioId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function updateDocumentTitle(document: ContentDocument, title: string): ContentDocument {
  return { ...document, activity: { ...document.activity, title } };
}

export function updateBeatInScenes(
  scenes: ActivityScene[],
  sceneId: string,
  beatId: string,
  patch: Partial<SceneBeat>,
): ActivityScene[] {
  return scenes.map((scene) => scene.id === sceneId
    ? { ...scene, beats: scene.beats.map((beat) => beat.id === beatId ? { ...beat, ...patch } : beat) }
    : scene);
}

export function insertBeatInScenes(
  scenes: ActivityScene[],
  sceneId: string,
  beat: SceneBeat,
  insertIndex?: number,
): ActivityScene[] {
  return scenes.map((scene) => {
    if (scene.id !== sceneId) return scene;
    const nextBeats = [...scene.beats];
    if (insertIndex !== undefined && insertIndex >= 0) nextBeats.splice(insertIndex, 0, beat);
    else nextBeats.push(beat);
    return { ...scene, beats: nextBeats };
  });
}

export function removeBeatFromScenes(scenes: ActivityScene[], sceneId: string, beatId: string): ActivityScene[] {
  return scenes.map((scene) => scene.id === sceneId
    ? { ...scene, beats: scene.beats.filter((beat) => beat.id !== beatId) }
    : scene);
}

export function updateSceneInScenes(
  scenes: ActivityScene[],
  sceneId: string,
  patch: Partial<ActivityScene>,
): ActivityScene[] {
  return scenes.map((scene) => scene.id === sceneId ? { ...scene, ...patch } : scene);
}

export function removeSceneFromScenes(scenes: ActivityScene[], sceneId: string): ActivityScene[] {
  return scenes.filter((scene) => scene.id !== sceneId);
}

export function createBeat(input: {
  id: string;
  sceneId: string;
  stageId: string;
  actor?: ActorSnapshot;
  orderIndex: number;
}): SceneBeat {
  return {
    id: input.id,
    sceneId: input.sceneId,
    stageId: input.stageId,
    characterId: input.actor?.id || 'narrator',
    characterName: input.actor?.displayName || '旁白',
    action: '',
    dialogue: '',
    orderIndex: input.orderIndex,
  };
}

export function createScene(input: {
  id: string;
  stageId: string;
  title: string;
  locationText: string;
  orderIndex: number;
  beats?: SceneBeat[];
}): ActivityScene {
  return {
    id: input.id,
    stageId: input.stageId,
    title: input.title,
    timeText: '',
    locationText: input.locationText,
    environment: '',
    beats: input.beats ?? [],
    orderIndex: input.orderIndex,
  };
}

export function createStage(input: {
  id: string;
  order: number;
  actorIds: string[];
  location: string;
}): StageDefinition {
  return {
    id: input.id,
    title: `第 ${input.order} 幕`,
    order: input.order,
    actorIds: input.actorIds,
    location: input.location,
    instruction: '',
    requiredBeats: [],
    locked: false,
    endCondition: '',
    scenes: [],
  };
}
