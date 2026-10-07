import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FRAMING_CHIPS,
  LIGHTING_CHIPS,
  isChipActive,
  toggleChipInPrompt,
} from './director-chips.js';

test('isChipActive detects single-tag and multi-tag chips correctly', () => {
  const closeUpChip = FRAMING_CHIPS.find((c) => c.id === 'close-up')!;
  const nightSnowChip = LIGHTING_CHIPS.find((c) => c.id === 'night_snow')!;
  const daytimeChip = LIGHTING_CHIPS.find((c) => c.id === 'daytime')!;

  assert.equal(isChipActive('', closeUpChip), false);
  assert.equal(isChipActive('1girl, solo, close-up', closeUpChip), true);
  assert.equal(isChipActive('1girl, solo, CLOSE-UP', closeUpChip), true);
  assert.equal(isChipActive('1girl, solo, medium_shot', closeUpChip), false);

  assert.equal(isChipActive('1girl, solo, night, snow, outdoors', nightSnowChip), true);
  assert.equal(isChipActive('1girl, solo, night', nightSnowChip), false);
  assert.equal(isChipActive('1girl, solo, daytime', daytimeChip), true);
});

test('toggleChipInPrompt adds chip to empty or existing prompt', () => {
  const closeUpChip = FRAMING_CHIPS.find((c) => c.id === 'close-up')!;
  const rimLightChip = LIGHTING_CHIPS.find((c) => c.id === 'rim_light')!;

  assert.equal(toggleChipInPrompt('', closeUpChip), 'close-up');
  assert.equal(toggleChipInPrompt('1girl, solo', closeUpChip), '1girl, solo, close-up');
  assert.equal(toggleChipInPrompt('1girl, solo, close-up', rimLightChip), '1girl, solo, close-up, rim light');
});

test('toggleChipInPrompt toggles off an active chip', () => {
  const closeUpChip = FRAMING_CHIPS.find((c) => c.id === 'close-up')!;
  const nightSnowChip = LIGHTING_CHIPS.find((c) => c.id === 'night_snow')!;

  assert.equal(toggleChipInPrompt('1girl, solo, close-up', closeUpChip), '1girl, solo');
  assert.equal(toggleChipInPrompt('close-up', closeUpChip), '');
  assert.equal(
    toggleChipInPrompt('1girl, solo, night, snow, outdoors', nightSnowChip),
    '1girl, solo, outdoors'
  );
});

test('toggleChipInPrompt handles shot_size conflict resolution cleanly', () => {
  const closeUpChip = FRAMING_CHIPS.find((c) => c.id === 'close-up')!;
  const mediumShotChip = FRAMING_CHIPS.find((c) => c.id === 'medium_shot')!;
  const fullBodyChip = FRAMING_CHIPS.find((c) => c.id === 'full_body')!;

  let prompt = '1girl, solo, close-up';
  prompt = toggleChipInPrompt(prompt, mediumShotChip);
  assert.equal(prompt, '1girl, solo, medium_shot');

  prompt = toggleChipInPrompt(prompt, fullBodyChip);
  assert.equal(prompt, '1girl, solo, full_body');

  prompt = toggleChipInPrompt(prompt, closeUpChip);
  assert.equal(prompt, '1girl, solo, close-up');
});

test('toggleChipInPrompt handles angle conflict resolution cleanly', () => {
  const fromAboveChip = FRAMING_CHIPS.find((c) => c.id === 'from_above')!;
  const fromBelowChip = FRAMING_CHIPS.find((c) => c.id === 'from_below')!;

  let prompt = '1girl, solo, from_above';
  prompt = toggleChipInPrompt(prompt, fromBelowChip);
  assert.equal(prompt, '1girl, solo, from_below');

  prompt = toggleChipInPrompt(prompt, fromBelowChip);
  assert.equal(prompt, '1girl, solo');
});

test('toggleChipInPrompt handles daytime vs night_snow lighting conflicts', () => {
  const daytimeChip = LIGHTING_CHIPS.find((c) => c.id === 'daytime')!;
  const nightSnowChip = LIGHTING_CHIPS.find((c) => c.id === 'night_snow')!;

  let prompt = '1girl, solo, daytime';
  prompt = toggleChipInPrompt(prompt, nightSnowChip);
  assert.equal(prompt, '1girl, solo, night, snow');

  prompt = toggleChipInPrompt(prompt, daytimeChip);
  assert.equal(prompt, '1girl, solo, daytime');
});

test('isChipActive and toggleChipInPrompt handle prompt weights and brackets', () => {
  const closeUpChip = FRAMING_CHIPS.find((c) => c.id === 'close-up')!;
  const mediumShotChip = FRAMING_CHIPS.find((c) => c.id === 'medium_shot')!;
  const rimLightChip = LIGHTING_CHIPS.find((c) => c.id === 'rim_light')!;

  // Detect weighted tags
  assert.equal(isChipActive('1girl, solo, (close-up:1.2)', closeUpChip), true);
  assert.equal(isChipActive('1girl, solo, ((rim light))', rimLightChip), true);
  assert.equal(isChipActive('1girl, solo, [rim_light:0.9]', rimLightChip), true);

  // Toggle off removes weighted tag
  assert.equal(toggleChipInPrompt('1girl, solo, (close-up:1.2)', closeUpChip), '1girl, solo');

  // Conflict resolution removes conflicting weighted tag
  assert.equal(
    toggleChipInPrompt('1girl, solo, (close-up:1.2)', mediumShotChip),
    '1girl, solo, medium_shot'
  );
});

test('isChipActive and toggleChipInPrompt handle Chinese commas and delimiter variants', () => {
  const closeUpChip = FRAMING_CHIPS.find((c) => c.id === 'close-up')!;
  const rimLightChip = LIGHTING_CHIPS.find((c) => c.id === 'rim_light')!;

  // Chinese comma detection
  assert.equal(isChipActive('1girl，solo，close-up', closeUpChip), true);

  // Chinese comma normalization on toggle
  assert.equal(toggleChipInPrompt('1girl，solo，close-up', closeUpChip), '1girl, solo');

  // Space vs underscore match
  assert.equal(isChipActive('1girl, solo, rim_light', rimLightChip), true);
  assert.equal(toggleChipInPrompt('1girl, solo, rim_light', rimLightChip), '1girl, solo');
});

