import assert from 'node:assert/strict';
import test from 'node:test';
import { computeCoverCrop, getComicPanelRects, normalizedRectToCanvas, panelLayoutForPage } from './layout.js';

test('comic templates use fixed 1920x1080 coordinates in reading order', () => {
  assert.deepEqual(getComicPanelRects('single'), [{ x: 32, y: 32, width: 1856, height: 1016 }]);
  assert.deepEqual(getComicPanelRects('trio'), [
    { x: 32, y: 32, width: 1088, height: 1016 },
    { x: 1144, y: 32, width: 744, height: 496 },
    { x: 1144, y: 552, width: 744, height: 496 },
  ]);
  assert.deepEqual(panelLayoutForPage('duo', ['first', 'second']).map((item) => item.panelId), ['first', 'second']);
  assert.throws(() => panelLayoutForPage('quad', ['only-one']), /需要 4 个画格/);
});

test('normalized bubble rectangles map into panel coordinates', () => {
  const mapped = normalizedRectToCanvas(
    { x: 0.1, y: 0.2, width: 0.5, height: 0.25 },
    { x: 32, y: 32, width: 916, height: 1016 },
  );
  assert.ok(Math.abs(mapped.x - 123.6) < 1e-9);
  assert.ok(Math.abs(mapped.y - 235.2) < 1e-9);
  assert.equal(mapped.width, 458);
  assert.equal(mapped.height, 254);
});

test('cover crop preserves aspect ratio and clamps the focal region', () => {
  const crop = computeCoverCrop(1600, 900, 400, 400, { focalX: 1, focalY: 0, zoom: 1 });
  assert.deepEqual(crop, { sx: 700, sy: 0, sw: 900, sh: 900 });
  const zoomed = computeCoverCrop(1600, 900, 400, 400, { focalX: 0.5, focalY: 0.5, zoom: 2 });
  assert.deepEqual(zoomed, { sx: 575, sy: 225, sw: 450, sh: 450 });
  assert.throws(() => computeCoverCrop(0, 100, 100, 100, { focalX: 0.5, focalY: 0.5, zoom: 1 }), /尺寸必须/);
});
