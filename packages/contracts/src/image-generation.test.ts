import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { CharacterAvatarGenerationRequestSchema, ImagePreparationRequestSchema, ManagedImageOptionsSchema, SceneBeatRenderSettingsSchema, SlotImageConfigSchema } from './index.js';

test('image preparation accepts explicit manual prompts and refuses execution grants', () => {
  const request = { appId: 'creative-center', purpose: 'text-to-image', description: 'a cat', ai: false,
    parameters: { negativePrompt: '', seed: null }, idempotencyKey: 'image-request' };
  assert.ok(Value.Check(ImagePreparationRequestSchema, request));
  for (const extra of [{ workflowId: 'arbitrary' }, { engineId: 'arbitrary' }, { baseUrl: 'http://private' }])
    assert.equal(Value.Check(ImagePreparationRequestSchema, { ...request, ...extra }), false);
  assert.ok(Value.Check(CharacterAvatarGenerationRequestSchema, {}));
  assert.equal(Value.Check(CharacterAvatarGenerationRequestSchema, { seed: -1 }), false);
  assert.equal(Value.Check(CharacterAvatarGenerationRequestSchema, { configurationHash: 'invalid' }), false);
});

test('context selections accept local references only and managed LoRA options reject execution grants', () => {
  const base = { appId: 'characters', purpose: 'character-avatar', description: 'portrait', ai: true, parameters: {}, idempotencyKey: 'context-request',
    context: { characters: [{ characterId: 'alice', draftRevision: 2, outfitOverride: '' }], noteIds: ['world'] } };
  assert.ok(Value.Check(ImagePreparationRequestSchema, base));
  assert.equal(Value.Check(ImagePreparationRequestSchema, { ...base, context: { characters: [{ characterId: 'alice', draft_json: '{}' }] } }), false);
  const managed = { version: 1, loras: [{ model: 'alice.safetensors', strength: 0.7, triggerWord: '', enabled: true }] };
  assert.ok(Value.Check(ManagedImageOptionsSchema, managed));
  assert.equal(Value.Check(ManagedImageOptionsSchema, { ...managed, workflow: {} }), false);
  assert.equal(Value.Check(ManagedImageOptionsSchema, { ...managed, loras: [{ ...managed.loras[0], strength: 99 }] }), false);
});

test('activity prompt overrides are optional and reject empty persisted overrides', () => {
  assert.ok(Value.Check(SceneBeatRenderSettingsSchema, {}));
  assert.ok(Value.Check(SceneBeatRenderSettingsSchema, { finalPositivePrompt: 'a cat', promptOptimization: false }));
  assert.equal(Value.Check(SceneBeatRenderSettingsSchema, { finalPositivePrompt: '' }), false);
  assert.ok(Value.Check(SlotImageConfigSchema, { slotId: 'slot', finalPositivePrompt: 'a cat', promptOptimization: false }));
});
