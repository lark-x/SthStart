import assert from 'node:assert/strict';
import test from 'node:test';
import type { ComicDocument, ComicPanel } from '@sthstart/contracts';
import { renderComicPage } from './renderer.js';

function fakeCanvas() {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const ctx = new Proxy({ measureText: (text: string) => ({ width: text.length * 10 }) } as Record<string, unknown>, {
    get(target, key: string) {
      if (key in target) return target[key];
      return (...args: unknown[]) => calls.push({ name: key, args });
    },
    set(target, key: string, value: unknown) { target[key] = value; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const panel: ComicPanel = {
  id: 'panel-a', source: { stageId: 'stage-a', sceneId: 'scene-a', beatIds: ['beat-a'] }, actorIds: ['actor-a'],
  shotSize: 'medium', visualDescription: '挥手', composition: '人物居中', textSafeArea: 'top_left',
  selectedImage: { artifactId: 'image-a', origin: 'comic_render', renderJobId: 'job-a', sourceFingerprint: 'fingerprint' },
  crop: { focalX: 0.5, focalY: 0.5, zoom: 1 },
  bubbles: [{ id: 'bubble-a', kind: 'speech', speakerActorId: 'actor-a', text: '你好', rect: { x: 0.1, y: 0.1, width: 0.4, height: 0.2 }, tail: { x: 0.6, y: 0.5 }, fontSize: 32 }],
  presentation: { camera: 'none', impact: 'none', holdMs: null }, renderSettings: {},
};
const document: ComicDocument = {
  schemaVersion: 1, contentRevisionId: 'revision-a', style: 'ink-paper-v1', canvas: { width: 1920, height: 1080 },
  pages: [{ id: 'page-a', title: 'Page', template: 'single', panelIds: ['panel-a'] }], panels: [panel],
};

test('shared page renderer resolves image crops and produces precise overflow issues', () => {
  const { ctx, calls } = fakeCanvas();
  const image = { width: 1600, height: 900 } as CanvasImageSource;
  const issues = renderComicPage(ctx, document, document.pages[0], {
    pageId: 'page-a', visiblePanelIds: ['panel-a'], visibleBubbleIds: ['bubble-a'], activePanelId: null, effectProgress: 1, reducedMotion: true,
  }, { getImage: () => image });
  assert.deepEqual(issues, []);
  const draw = calls.find((call) => call.name === 'drawImage');
  assert.ok(draw);
  assert.equal(draw.args[0], image);
  assert.equal(draw.args.length, 9);
  assert.ok(calls.some((call) => call.name === 'fillText' && call.args[0] === '你好'));

  const overflowDoc = { ...document, panels: [{ ...panel, bubbles: [{ ...panel.bubbles[0], rect: { ...panel.bubbles[0].rect, height: 0.05 }, text: '这段文字应该无法放进非常矮的气泡中' }] }] };
  const overflow = renderComicPage(fakeCanvas().ctx, overflowDoc, document.pages[0], {
    pageId: 'page-a', visiblePanelIds: ['panel-a'], visibleBubbleIds: ['bubble-a'], activePanelId: null, effectProgress: 1, reducedMotion: true,
  }, { getImage: () => image });
  assert.equal(overflow[0]?.code, 'bubble_overflow');
  assert.equal(overflow[0]?.bubbleId, 'bubble-a');
});

test('hidden reading panels do not show their image or bubbles', () => {
  const { ctx, calls } = fakeCanvas();
  const image = { width: 1, height: 1 } as CanvasImageSource;
  renderComicPage(ctx, document, document.pages[0], {
    pageId: 'page-a', visiblePanelIds: [], visibleBubbleIds: [], activePanelId: null, effectProgress: 0, reducedMotion: true,
  }, { getImage: () => image });
  assert.equal(calls.filter((call) => call.name === 'drawImage').length, 0);
  assert.equal(calls.filter((call) => call.name === 'fillText').length, 0);
});
