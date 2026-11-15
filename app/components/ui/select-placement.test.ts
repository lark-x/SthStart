import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeDropdownPlacement } from './select';
import { getFloatingOverlayRoot } from './overlay-policy';

function selectRect(rect: { left: number; top: number; width: number; height: number }) {
  return {
    getBoundingClientRect: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }),
  };
}

test('dropdown aligns to the trigger and stays inside a 390px viewport', () => {
  const placement = computeDropdownPlacement(
    selectRect({ left: 350, top: 120, width: 40, height: 36 }),
    { width: 390, height: 844 },
  );
  const width = placement.minWidth;
  assert.equal(placement.left, 250);
  assert.equal(placement.left + width, 382);
  assert.ok(placement.left >= 8);
  assert.ok(placement.top !== undefined);
});

test('dropdown flips above when the trigger sits near the viewport bottom', () => {
  const placement = computeDropdownPlacement(
    selectRect({ left: 40, top: 780, width: 220, height: 36 }),
    { width: 390, height: 844 },
  );
  assert.equal(placement.top, undefined);
  assert.equal(placement.bottom, 68);
  assert.equal(placement.maxHeight, 280);
  assert.ok(844 - (placement.bottom ?? 0) - placement.maxHeight >= 8);
});

test('dropdown height never extends past the available edge', () => {
  const placement = computeDropdownPlacement(
    selectRect({ left: 40, top: 250, width: 220, height: 36 }),
    { width: 390, height: 300 },
  );
  assert.equal(placement.top, undefined);
  assert.equal(placement.bottom, 54);
  assert.equal(placement.maxHeight, 238);
  assert.ok(300 - (placement.bottom ?? 0) - placement.maxHeight >= 8);
});

test('floating overlay root is safe to request without a document', () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(getFloatingOverlayRoot(), null);
});
