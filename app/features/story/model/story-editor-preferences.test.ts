import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasWidthClass, paperWidthClass, parseCanvasWidth } from './story-editor-preferences';

test('canvas width parsing only accepts persisted values', () => {
  for (const value of ['comfortable', 'wide', 'full'] as const) assert.equal(parseCanvasWidth(value), value);
  for (const value of [null, '', 'narrow', 'FULL', '100%']) assert.equal(parseCanvasWidth(value), null);
});

test('canvas and paper width classes preserve the existing breakpoints', () => {
  assert.equal(canvasWidthClass('full'), 'max-w-none');
  assert.equal(canvasWidthClass('comfortable'), 'max-w-3xl');
  assert.equal(canvasWidthClass('wide'), 'max-w-5xl');
  assert.equal(paperWidthClass('comfortable', true), 'max-w-7xl');
  assert.equal(paperWidthClass('full', false), 'max-w-none');
});
