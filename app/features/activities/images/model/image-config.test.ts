import test from 'node:test';
import assert from 'node:assert/strict';
import type { ImageConfigDocument } from '@sthstart/contracts';
import { findSlotConfig, upsertSlotConfig } from './image-config';
import { parseImageConfigRecovery } from './config-recovery';

const base: ImageConfigDocument = {
  schemaVersion: 1,
  stylePreset: 'anime_standard',
  globalStylePrompt: '',
  globalNegativePrompt: '',
  slotConfigs: [{ slotId: 'slot-a', shotType: 'close-up' }],
};

test('slot lookup returns the matching config or an inherited fallback', () => {
  assert.equal(findSlotConfig(base, 'slot-a').shotType, 'close-up');
  assert.deepEqual(findSlotConfig(base, 'slot-b'), { slotId: 'slot-b' });
  assert.deepEqual(findSlotConfig(null, 'slot-a'), { slotId: 'slot-a' });
});

test('slot update merges the target only and leaves the source document untouched', () => {
  const next = upsertSlotConfig(base, 'slot-a', { lighting: 'soft' });
  assert.equal(next.slotConfigs[0].lighting, 'soft');
  assert.equal(next.slotConfigs[0].shotType, 'close-up');
  assert.equal(base.slotConfigs[0].lighting, undefined);
  assert.equal(next.globalStylePrompt, base.globalStylePrompt);
  assert.deepEqual(upsertSlotConfig(base, 'slot-b', { shotType: 'wide' }).slotConfigs[1], { slotId: 'slot-b', shotType: 'wide' });
});

test('recovery parsing rejects malformed or incomplete records', () => {
  const valid = JSON.stringify({ version: 3, baseline: JSON.stringify(base), document: base });
  assert.deepEqual(parseImageConfigRecovery(valid), { version: 3, baseline: JSON.stringify(base), document: base });
  assert.equal(parseImageConfigRecovery(null), null);
  assert.equal(parseImageConfigRecovery('not-json'), null);
  assert.equal(parseImageConfigRecovery(JSON.stringify({ version: 1, baseline: '', document: { schemaVersion: 1 } })), null);
  assert.equal(parseImageConfigRecovery(JSON.stringify({ version: '3', baseline: '', document: base })), null);
});
