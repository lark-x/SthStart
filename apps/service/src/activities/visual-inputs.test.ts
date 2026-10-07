import assert from 'node:assert/strict';
import test from 'node:test';
import { finalizeActivityVisualPrompt, mapActivityVisualInputs, mergeActivityImageInputs } from './image-render-common.js';

test('canvas dimensions use declared semantic inputs without inventing workflow fields', () => {
  assert.deepEqual(mapActivityVisualInputs({ latent_w: { type: 'integer', semantic: 'width' }, latent_h: { type: 'integer', semantic: 'height' } },
    { width: 1024, height: 768, steps: 20 }), { latent_w: 1024, latent_h: 768, steps: 20 });
  assert.throws(() => mapActivityVisualInputs({}, { width: 1024 }), { code: 'visual_dimension_unsupported' });
});

test('canvas range and step requirements are enforced by the submission validator', () => {
  const resolved = { workflow: { inputSchema: {
    w: { type: 'integer', semantic: 'width', minimum: 256, maximum: 2048, step: 64 },
    h: { type: 'integer', semantic: 'height', minimum: 256, maximum: 2048, step: 64 },
  }, configFormatVersion: 2, editorConfig: null } } as unknown as Parameters<typeof mergeActivityImageInputs>[0];
  assert.deepEqual(mergeActivityImageInputs(resolved, {}, { width: 1024, height: 768 }, true), { w: 1024, h: 768 });
  assert.throws(() => mergeActivityImageInputs(resolved, {}, { width: 1, height: 768 }, true));
  assert.throws(() => mergeActivityImageInputs(resolved, {}, { width: 1000, height: 768 }, true));
});

test('all visual targets share final style and trigger composition without changing actor semantics', () => {
  const loras = [
    { model: 'one', strength: 1, enabled: true, triggerWord: 'character_a, ink' },
    { model: 'two', strength: 1, enabled: true, triggerWord: 'character_a' },
  ];
  const prompt = finalizeActivityVisualPrompt('Alice standing, Bob sitting, ink', 'ink, warm_light', loras);
  assert.equal(prompt, 'character_a, Alice standing, Bob sitting, ink, warm_light');
  assert.doesNotMatch(prompt, /solo/);
});
