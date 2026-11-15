import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActivityScene, ContentDocument, SceneBeat, StageDefinition } from '@sthstart/contracts';
import { getEffectiveStageScenes } from '../../scene-beat-utils';
import { canonical, sameDocument } from './document-equality';
import {
  insertBeatInScenes,
  removeBeatFromScenes,
  removeSceneFromScenes,
  updateBeatInScenes,
} from './document';
import {
  resolveActiveScene,
  resolveActiveStage,
  resolveSceneSelection,
  resolveSelectedBeat,
  resolveStageSelection,
} from './selection';

function beat(id: string, action: string): SceneBeat {
  return {
    id,
    sceneId: 'scene-1',
    stageId: 'stage-1',
    characterId: 'narrator',
    characterName: '旁白',
    action,
    dialogue: '',
    orderIndex: 0,
  };
}

function scene(id: string, stageId: string, beats: SceneBeat[], orderIndex: number): ActivityScene {
  return {
    id,
    stageId,
    title: id,
    timeText: '',
    locationText: '',
    environment: '',
    beats,
    orderIndex,
  };
}

function stage(id: string, order: number, scenes: ActivityScene[] = []): StageDefinition {
  return {
    id,
    title: '第 ' + order + ' 幕',
    order,
    actorIds: [],
    location: '',
    instruction: '',
    requiredBeats: [],
    locked: false,
    endCondition: '',
    scenes,
  };
}

const legacyScene = scene('legacy-scene', 'stage-2', [beat('legacy-beat', '旧分镜')], 0);
const firstBeat = beat('beat-1', '第一镜');
const first = scene('scene-1', 'stage-1', [firstBeat], 0);
const second = scene('scene-2', 'stage-1', [beat('beat-2', '第二镜')], 10);
const document = {
  schemaVersion: 1,
  activity: { title: '测试活动' },
  actors: [],
  stages: [stage('stage-1', 1), stage('stage-2', 2, [legacyScene])],
  scenes: [first, second],
} as unknown as ContentDocument;

function firstScene(): ActivityScene {
  const scenes = getEffectiveStageScenes(document.stages[0], document.scenes);
  assert.ok(scenes[0], 'fixture must contain a scene in the first stage');
  return scenes[0];
}

test('stage and scene selection resolve the first effective scene and beat', () => {
  const stage = document.stages[0];
  const scene = firstScene();
  const beat = scene.beats[0];
  assert.ok(beat, 'fixture must contain a beat in the first scene');

  assert.deepEqual(resolveStageSelection(document, stage.id), { sceneId: scene.id, beatId: beat.id });
  assert.equal(resolveSceneSelection(document, stage.id, scene.id), beat.id);
  assert.equal(resolveSceneSelection(document, stage.id, 'missing-scene'), null);
  assert.deepEqual(resolveStageSelection(document, 'stage-2'), { sceneId: 'legacy-scene', beatId: 'legacy-beat' });
  assert.deepEqual(resolveStageSelection(document, 'missing-stage'), { sceneId: null, beatId: null });
});

test('active fallbacks keep the current stage, scene and beat valid after external updates', () => {
  const first = document.stages[0];
  const second = document.stages[1] ?? first;
  const scenes = getEffectiveStageScenes(first, document.scenes);
  const scene = scenes[0];

  assert.equal(resolveActiveStage(document, 'missing-stage')?.id, first.id);
  assert.equal(resolveActiveStage(null, first.id), null);
  assert.equal(resolveActiveScene(scenes, 'missing-scene')?.id, scene.id);
  assert.equal(resolveActiveScene([], scene.id), null);
  assert.equal(resolveSelectedBeat(scene, 'missing-beat')?.id, scene.beats[0]?.id);
  assert.equal(resolveSelectedBeat(null, 'beat'), null);
  assert.equal(resolveActiveStage(document, second.id)?.id, second.id);
});

test('document comparison ignores key order and undefined fields without hiding real edits', () => {
  assert.equal(sameDocument({ b: 1, a: [{ d: 2, c: 3 }] }, { a: [{ c: 3, d: 2 }], b: 1 }), true);
  assert.equal(sameDocument({ a: 1, omitted: undefined }, { a: 1 }), true);
  assert.equal(sameDocument({ a: 1 }, { a: 2 }), false);
  assert.equal(sameDocument(null, {}), false);
  assert.deepEqual(canonical({ b: 1, a: undefined, c: { z: 0, y: 1 } }), { b: 1, c: { y: 1, z: 0 } });
});

test('scene edits stay scoped to the target scene and never mutate the input arrays', () => {
  assert.ok(document.scenes, 'fixture must contain scenes');
  const scene = firstScene();
  const beat = scene.beats[0];
  const otherScene = document.scenes.find((item) => item.id !== scene.id) ?? scene;
  const otherBeat: SceneBeat = { ...beat, id: 'inserted-beat', sceneId: scene.id };

  const updated = updateBeatInScenes(document.scenes, scene.id, beat.id, { action: '改写后的动作' });
  assert.equal(updated.find((item) => item.id === scene.id)?.beats[0]?.action, '改写后的动作');
  assert.equal(scene.beats[0]?.action, beat.action);
  assert.equal(updated.find((item) => item.id === otherScene.id), otherScene);

  const inserted = insertBeatInScenes(document.scenes, scene.id, otherBeat, 0);
  assert.deepEqual(inserted.find((item) => item.id === scene.id)?.beats.slice(0, 2).map((item) => item.id), [otherBeat.id, beat.id]);

  const removed = removeBeatFromScenes(document.scenes, scene.id, beat.id);
  assert.equal(removed.find((item) => item.id === scene.id)?.beats.some((item) => item.id === beat.id), false);
  assert.equal(scene.beats.some((item) => item.id === beat.id), true);

  const withoutScene = removeSceneFromScenes(document.scenes, scene.id);
  assert.equal(withoutScene.some((item) => item.id === scene.id), false);
  assert.equal(document.scenes.some((item) => item.id === scene.id), true);
});
