import type { ActivityScene, ContentDocument, SceneBeat, StageDefinition } from '@sthstart/contracts';

function mergeBeat(primary: SceneBeat, legacy?: SceneBeat): SceneBeat {
  if (!legacy) return primary;
  return {
    ...primary,
    mediaUrl: primary.mediaUrl === undefined ? legacy.mediaUrl : primary.mediaUrl,
    mediaType: primary.mediaType === undefined ? legacy.mediaType : primary.mediaType,
  };
}

function mergeScene(primary: ActivityScene, legacy?: ActivityScene, stageId?: string): ActivityScene {
  if (!legacy) return { ...primary, stageId: primary.stageId || stageId };

  const legacyBeats = new Map(legacy.beats.map((beat) => [beat.id, beat]));
  const primaryBeats = Array.from(new Map(primary.beats.map((beat) => [beat.id, beat])).values());

  return {
    ...primary,
    stageId: primary.stageId || stageId,
    // Only supplement media for matching IDs. A nested-only beat may have been
    // intentionally removed from the canonical top-level scene and must not return.
    beats: primaryBeats.map((beat) => mergeBeat(beat, legacyBeats.get(beat.id))),
  };
}

/** Top-level scenes are canonical; nested scenes are a fallback or media-only compatibility source. */
export function getEffectiveStageScenes(
  stage: StageDefinition,
  documentScenes?: ActivityScene[] | null,
): ActivityScene[] {
  const topLevel = (documentScenes || []).filter((scene) => scene.stageId === stage.id);
  const nested = (stage.scenes || []).filter((scene) => !scene.stageId || scene.stageId === stage.id);

  if (topLevel.length === 0) {
    return sortScenes(nested.map((scene) => ({ ...scene, stageId: stage.id })));
  }

  const nestedById = new Map(nested.map((scene) => [scene.id, scene]));
  const merged = [
    ...Array.from(new Map(topLevel.map((scene) => [scene.id, scene])).values())
      .map((scene) => mergeScene(scene, nestedById.get(scene.id), stage.id)),
  ];

  return sortScenes(merged);
}

function sortScenes(scenes: ActivityScene[]): ActivityScene[] {
  return Array.from(new Map(scenes.map((scene) => [scene.id, scene])).values())
    .map((scene, index) => ({ scene, index }))
    .sort((a, b) => (a.scene.orderIndex ?? a.index) - (b.scene.orderIndex ?? b.index) || a.index - b.index)
    .map(({ scene }) => scene);
}

/** Replace one stage's canonical scenes and keep its nested compatibility mirror in sync. */
export function writeStageScenes(
  document: ContentDocument,
  stageId: string,
  scenes: ActivityScene[],
): ContentDocument {
  const uniqueScenes = Array.from(new Map(scenes.map((scene) => [scene.id, scene])).values())
    .map((scene) => ({
      ...scene,
      stageId,
      beats: scene.beats.map((beat) => ({ ...beat, stageId, sceneId: scene.id })),
    }));

  return {
    ...document,
    scenes: [
      ...(document.scenes || []).filter((scene) => scene.stageId !== stageId),
      ...uniqueScenes,
    ],
    stages: document.stages.map((stage) =>
      stage.id === stageId ? { ...stage, scenes: uniqueScenes } : stage,
    ),
  };
}

/** Merge a generated image into the latest draft without reviving deleted scenes or beats. */
export function writeStageBeatMedia(
  document: ContentDocument,
  stageId: string,
  sceneId: string,
  beatId: string,
  mediaUrl: string,
): ContentDocument | null {
  const stage = document.stages.find((item) => item.id === stageId);
  if (!stage) return null;
  const scenes = getEffectiveStageScenes(stage, document.scenes);
  const scene = scenes.find((item) => item.id === sceneId);
  if (!scene?.beats.some((beat) => beat.id === beatId)) return null;

  return writeStageScenes(document, stageId, scenes.map((item) => item.id !== sceneId ? item : {
    ...item,
    beats: item.beats.map((beat) => beat.id === beatId
      ? { ...beat, mediaUrl, mediaType: 'image' }
      : beat),
  }));
}

export function countStageBeats(scenes: ActivityScene[]): { total: number; withMedia: number } {
  const beats = scenes.flatMap((scene) => scene.beats);
  return {
    total: beats.length,
    withMedia: beats.filter((beat) => Boolean(beat.mediaUrl) && beat.mediaType !== 'video').length,
  };
}
