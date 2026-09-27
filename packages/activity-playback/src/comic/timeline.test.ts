import assert from 'node:assert/strict';
import test from 'node:test';
import type { ComicDocument, ComicPanel } from '@sthstart/contracts';
import { compileComicReadingSteps, getComicFrameState, getComicReadingHoldMs } from './timeline.js';

function panel(id: string, bubbles: ComicPanel['bubbles'] = [], holdMs: number | null = null): ComicPanel {
  return {
    id, source: { stageId: 'stage', sceneId: 'scene', beatIds: ['beat'] }, actorIds: [], shotSize: 'medium',
    visualDescription: '', composition: '', textSafeArea: 'none', selectedImage: null,
    crop: { focalX: 0.5, focalY: 0.5, zoom: 1 }, bubbles,
    presentation: { camera: 'none', impact: 'none', holdMs }, renderSettings: {},
  };
}

function bubble(id: string, text: string) {
  return { id, kind: 'speech' as const, speakerActorId: null, text, rect: { x: 0.1, y: 0.1, width: 0.6, height: 0.2 }, tail: null, fontSize: 32 };
}

function document(): ComicDocument {
  const panels = [panel('a', [bubble('a-1', '你好'), bubble('a-2', '雪山见')]), panel('b'), panel('c', [bubble('c-1', '再见')], 2400)];
  return {
    schemaVersion: 1, contentRevisionId: 'revision', style: 'ink-paper-v1', canvas: { width: 1920, height: 1080 },
    pages: [{ id: 'p1', title: '第一页', template: 'duo', panelIds: ['a', 'b'] }, { id: 'p2', title: '第二页', template: 'single', panelIds: ['c'] }], panels,
  };
}

test('comic reading steps preserve page, panel, and bubble order', () => {
  assert.deepEqual(compileComicReadingSteps(document()), [
    { kind: 'panel', pageId: 'p1', panelId: 'a' },
    { kind: 'bubble', pageId: 'p1', panelId: 'a', bubbleId: 'a-1' },
    { kind: 'bubble', pageId: 'p1', panelId: 'a', bubbleId: 'a-2' },
    { kind: 'panel', pageId: 'p1', panelId: 'b' },
    { kind: 'panel', pageId: 'p2', panelId: 'c' },
    { kind: 'bubble', pageId: 'p2', panelId: 'c', bubbleId: 'c-1' },
  ]);
});

test('comic frame state shows only completed steps and clamps progress', () => {
  const state = getComicFrameState(document(), 2, 1.5, false);
  assert.deepEqual(state.visiblePanelIds, ['a']);
  assert.deepEqual(state.visibleBubbleIds, ['a-1', 'a-2']);
  assert.equal(state.activePanelId, 'a');
  assert.equal(state.activeBubbleId, 'a-2');
  assert.equal(state.effectProgress, 1);
  const initial = getComicFrameState(document(), -1, -2, true);
  assert.deepEqual(initial.visiblePanelIds, []);
  assert.deepEqual(initial.visibleBubbleIds, []);
  assert.equal(initial.activePanelId, null);
  assert.equal(initial.effectProgress, 0);
  assert.equal(initial.reducedMotion, true);
});

test('comic reading hold uses text length, no-bubble default, and explicit override', () => {
  const doc = document();
  const steps = compileComicReadingSteps(doc);
  assert.equal(getComicReadingHoldMs(doc, steps[1]), null, 'non-final bubbles use their short entrance timing');
  assert.equal(getComicReadingHoldMs(doc, steps[2]), 1_800, 'short bubble dialogue respects the 1800 ms minimum reading pause');
  assert.equal(getComicReadingHoldMs(doc, steps[3]), 1_800, 'a panel without bubbles uses the default hold');
  assert.equal(getComicReadingHoldMs(doc, steps[5]), 2_400, 'explicit hold time overrides the calculated reading pause');
});
