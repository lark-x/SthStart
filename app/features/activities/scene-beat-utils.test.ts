import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActivityScene, ContentDocument, SceneBeat, StageDefinition } from '@sthstart/contracts';
import { countStageBeats, getEffectiveStageScenes, writeStageBeatMedia, writeStageScenes } from './scene-beat-utils.js';

const beat = (id: string, action: string, mediaUrl?: string): SceneBeat => ({
  id,
  characterId: 'actor-1',
  action,
  mediaUrl,
  mediaType: mediaUrl ? 'image' : undefined,
});

const scene = (id: string, stageId: string, title: string, beats: SceneBeat[], orderIndex: number): ActivityScene => ({
  id,
  stageId,
  title,
  timeText: '',
  locationText: '',
  beats,
  orderIndex,
});

const stage = (scenes: ActivityScene[] = []): StageDefinition => ({
  id: 'stage-1',
  title: '第一幕',
  order: 1,
  actorIds: [],
  location: '',
  instruction: '',
  requiredBeats: [],
  locked: false,
  endCondition: '',
  scenes,
});

test('uses nested scenes as fallback when no top-level scenes exist', () => {
  const result = getEffectiveStageScenes(stage([scene('legacy', 'stage-1', '旧场次', [beat('b1', '旧动作')], 0)]), []);
  assert.equal(result.length, 1);
  assert.equal(result[0].stageId, 'stage-1');
});

test('uses only top-level scenes for the selected stage when canonical scenes exist', () => {
  const result = getEffectiveStageScenes(stage([scene('legacy', 'stage-1', '旧场次', [], 0)]), [
    scene('canonical', 'stage-1', '主源场次', [], 1),
    scene('other-stage', 'stage-2', '其他阶段', [], 0),
  ]);
  assert.deepEqual(result.map((item) => item.id), ['canonical']);
});

test('keeps unscoped legacy scenes for this stage and excludes scenes belonging to other stages', () => {
  const result = getEffectiveStageScenes(stage([
    scene('unscoped', '', '未标阶段', [], 0),
    scene('other', 'stage-2', '其他阶段', [], 1),
  ]), [scene('top-other', 'stage-2', '另一个阶段', [], 0)]);
  assert.deepEqual(result.map((item) => item.id), ['unscoped']);
});

test('prefers top-level text and order while filling only matching legacy media', () => {
  const legacy = [
    scene('same', 'stage-1', '旧标题', [beat('b1', '旧动作', '/media/old.png'), beat('b2', '旧镜头')], 9),
    scene('legacy-only', 'stage-1', '旧补充场次', [], 2),
  ];
  const top = [scene('same', 'stage-1', '新标题', [beat('b1', '新动作')], 0)];
  const result = getEffectiveStageScenes(stage(legacy), top);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, '新标题');
  assert.equal(result[0].beats[0].action, '新动作');
  assert.equal(result[0].beats[0].mediaUrl, '/media/old.png');
  assert.equal(result.some((item) => item.id === 'legacy-only'), false);
  assert.equal(result[0].beats.some((item) => item.id === 'b2'), false);
});

test('preserves an intentionally cleared canonical media URL over the legacy mirror', () => {
  const legacy = [scene('same', 'stage-1', '旧标题', [beat('b1', '旧动作', '/media/old.png')], 0)];
  const canonical = [scene('same', 'stage-1', '新标题', [{
    ...beat('b1', '新动作', '/media/old.png'), mediaUrl: '',
  }], 0)];
  const result = getEffectiveStageScenes(stage(legacy), canonical);
  assert.equal(result[0].beats[0].mediaUrl, '');
});

test('writes only the selected stage and mirrors scenes without duplicates', () => {
  const document = {
    stages: [stage([scene('old', 'stage-1', '旧', [], 0)]), { ...stage(), id: 'stage-2' }],
    scenes: [scene('other', 'stage-2', '其他阶段', [], 0), scene('old', 'stage-1', '旧', [], 0)],
  } as unknown as Parameters<typeof writeStageScenes>[0];
  const result = writeStageScenes(document, 'stage-1', [scene('new', 'stage-1', '新', [beat('b1', '动作')], 0)]);
  assert.deepEqual(result.scenes?.map((item) => item.id), ['other', 'new']);
  assert.deepEqual(result.stages[0].scenes?.map((item) => item.id), ['new']);
  assert.equal(countStageBeats(result.stages[0].scenes || []).total, 1);
});

test('scene and beat identifiers remain unique and beat ownership is normalized on write', () => {
  const document = { stages: [stage()], scenes: [] } as unknown as Parameters<typeof writeStageScenes>[0];
  const duplicateScene = scene('same', 'other-stage', '第二份', [beat('beat', '动作')], 1);
  const result = writeStageScenes(document, 'stage-1', [
    scene('same', 'stage-1', '第一份', [beat('beat', '首条'), beat('beat', '重复')], 0),
    duplicateScene,
  ]);
  assert.equal(result.scenes?.length, 1);
  assert.equal(result.scenes?.[0].title, '第二份');
  assert.equal(result.scenes?.[0].beats.length, 1);
  assert.equal(result.scenes?.[0].beats[0].stageId, 'stage-1');
  assert.equal(result.scenes?.[0].beats[0].sceneId, 'same');
});

test('stage media counts distinguish zero, partial, complete, and legacy video references', () => {
  assert.deepEqual(countStageBeats([]), { total: 0, withMedia: 0 });
  const scenes = [scene('scene-counts', 'stage-1', '计数', [
    beat('image', '有图片', '/image.png'),
    beat('missing', '无图片'),
    { ...beat('video', '旧视频', '/video.mp4'), mediaType: 'video' },
  ], 0)];
  assert.deepEqual(countStageBeats(scenes), { total: 3, withMedia: 1 });
  assert.deepEqual(countStageBeats([scene('complete', 'stage-1', '齐全', [
    beat('image-a', '图一', '/one.png'), beat('image-b', '图二', '/two.png'),
  ], 0)]), { total: 2, withMedia: 2 });
});

test('generated media merges into the latest beat text and does not revive deleted targets', () => {
  const baseScene = scene('scene-1', 'stage-1', '当前场次', [beat('beat-1', '初始动作')], 0);
  const latest = {
    stages: [stage()],
    scenes: [{ ...baseScene, beats: [{ ...baseScene.beats[0], action: '等待生图期间用户更新的动作' }] }],
  } as unknown as ContentDocument;
  const merged = writeStageBeatMedia(latest, 'stage-1', 'scene-1', 'beat-1', '/generated.png');
  assert.ok(merged);
  assert.equal(merged.scenes?.[0].beats[0].action, '等待生图期间用户更新的动作');
  assert.equal(merged.scenes?.[0].beats[0].mediaUrl, '/generated.png');

  const deleted = { ...latest, scenes: [], stages: [stage([])] } as unknown as ContentDocument;
  assert.equal(writeStageBeatMedia(deleted, 'stage-1', 'scene-1', 'beat-1', '/orphan.png'), null);
});
