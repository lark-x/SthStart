import assert from 'node:assert/strict';
import test from 'node:test';
import type { ComicStoryboardModelOutput, ContentDocument } from '@sthstart/contracts';
import { validateComicDocument } from './activities/comic-validation.js';
import { buildComicStoryboardPrompt, materializeComicStoryboard } from './activities/comic-storyboard.js';

function source(): ContentDocument {
  return {
    schemaVersion: 1,
    activity: { title: '雪山实验', type: '短篇', theme: '发现', location: '龙脊雪山', rules: '', generationMode: 'fill_details' },
    actors: [{ id: 'actor-a', displayName: '阿贝多', activityRole: '主角', outfitDescription: '炼金术师服装', persona: { appearance: { baseText: '金色头发' } }, appearanceReferenceAssetKeys: [] }],
    relationships: [], messages: [], posts: [], comments: [], likes: [], mediaSlots: [], facts: [], stageResults: [], conversations: [],
    stages: [{ id: 'stage-a', title: '雪山', order: 1, actorIds: ['actor-a'], location: '龙脊雪山', instruction: '发现结晶', requiredBeats: [], locked: false, endCondition: '' }],
    scenes: [{ id: 'scene-a', stageId: 'stage-a', title: '实验营地', timeText: '傍晚', locationText: '营地', environment: '风雪渐起', beats: [
      { id: 'beat-a', characterId: 'actor-a', action: '观察结晶', dialogue: '反应稳定。', outcome: '完成分析', orderIndex: 0 },
    ] }],
  } as ContentDocument;
}

function modelOutput(count: number): ComicStoryboardModelOutput {
  return { panels: Array.from({ length: count }, (_, index) => ({
    sourceBeatIds: ['beat-a'], actorIds: ['actor-a'], shotSize: (['wide', 'medium', 'closeup', 'detail'] as const)[index % 4],
    visualDescription: `画面 ${index + 1}：观察结晶`, composition: '角色在画面中央，实验台位于前景', textSafeArea: 'top_left',
    bubbles: [{ kind: 'speech', speakerActorId: 'actor-a', text: `第 ${index + 1} 格台词` }],
  })) } as ComicStoryboardModelOutput;
}

test('comic storyboard prompt is tied to the selected frozen scene and requests semantic JSON only', () => {
  const prompt = buildComicStoryboardPrompt({ content: source(), stageId: 'stage-a', sceneId: 'scene-a', panelCount: 6 });
  assert.match(prompt, /只返回符合给定 Schema 的 JSON/);
  assert.match(prompt, /必须恰好返回 6 格/);
  assert.match(prompt, /不是 "close_up"/);
  assert.match(prompt, /不能是 "bottom_left"/);
  assert.match(prompt, /beat-a/);
  assert.match(prompt, /actor-a/);
  assert.throws(() => buildComicStoryboardPrompt({ content: source(), stageId: 'missing', sceneId: 'scene-a', panelCount: 6 }), /不存在/);
});

test('six-panel model result materializes into two ordered trio pages with server-owned IDs and defaults', () => {
  const result = materializeComicStoryboard(modelOutput(6), source(), { stageId: 'stage-a', sceneId: 'scene-a', panelCount: 6 });
  assert.deepEqual(result.pages.map((page) => page.template), ['trio', 'trio']);
  assert.deepEqual(result.pages.map((page) => page.panelIds.length), [3, 3]);
  assert.equal(result.panels.length, 6);
  assert.ok(result.panels.every((panel) => panel.id && panel.bubbles[0].id && panel.selectedImage === null));
  const document = { schemaVersion: 1 as const, contentRevisionId: 'revision-a', style: 'ink-paper-v1' as const,
    canvas: { width: 1920 as const, height: 1080 as const }, pages: result.pages, panels: result.panels };
  assert.doesNotThrow(() => validateComicDocument(document, source()));
});

test('storyboard model output with invalid actor, beat, or count is rejected rather than silently trimmed', () => {
  const invalidActor = modelOutput(4);
  invalidActor.panels[2].actorIds = ['unknown'];
  assert.throws(() => materializeComicStoryboard(invalidActor, source(), { stageId: 'stage-a', sceneId: 'scene-a', panelCount: 4 }), /未知角色 ID/);

  const invalidBeat = modelOutput(4);
  invalidBeat.panels[0].sourceBeatIds = ['invented'];
  assert.throws(() => materializeComicStoryboard(invalidBeat, source(), { stageId: 'stage-a', sceneId: 'scene-a', panelCount: 4 }), /不属于当前场次/);

  assert.throws(() => materializeComicStoryboard(modelOutput(5), source(), { stageId: 'stage-a', sceneId: 'scene-a', panelCount: 4 }), /要求 4 格/);
});
