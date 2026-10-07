import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { ActivityArtDirectionSchema, ActivityArtStylePayloadSchema, ActivityArtStyleUpdateSchema,
  DirectorSettingsSchema, ImageConfigDocumentSchema, SceneBeatSchema, isActivityArtStylePayload } from './index.js';

const payload = {
  schemaKind: 'activity_art_style_v1', positiveStylePrompt: 'ink', negativePrompt: '',
  renderProfiles: { draft: null, final: null }, defaultQuality: 'draft',
  defaultCanvas: { width: 1152, height: 648 }, previewArtifactId: null,
};
test('art direction is optional for legacy image configurations and beats', () => {
  assert.ok(Value.Check(ImageConfigDocumentSchema, {
    schemaVersion: 1, stylePreset: 'legacy', globalStylePrompt: '', globalNegativePrompt: '', slotConfigs: [],
  }));
  assert.ok(Value.Check(SceneBeatSchema, { id: 'b', characterId: 'narrator', action: '风吹过' }));
  assert.ok(Value.Check(SceneBeatSchema, { id: 'b', characterId: 'a', actorIds: ['a', 'b'], action: '交谈' }));
  assert.equal(Value.Check(SceneBeatSchema, { id: 'b', characterId: 'a', actorIds: ['a', 'a'], action: '' }), false);
});
test('art cards distinguish typed payloads and keep versioned profiles strict', () => {
  assert.ok(Value.Check(ActivityArtStylePayloadSchema, payload));
  assert.ok(isActivityArtStylePayload(payload));
  assert.equal(isActivityArtStylePayload({ steps: 20 }), false);
  assert.ok(Value.Check(ActivityArtStyleUpdateSchema, { name: '漫画', payload, expectedVersion: 1 }));
  assert.equal(Value.Check(ActivityArtStylePayloadSchema, { ...payload, defaultCanvas: { width: 0, height: 648 } }), false);
  assert.equal(Value.Check(ActivityArtStylePayloadSchema, { ...payload, renderProfiles: { draft: { presetId: 'p' }, final: null } }), false);
  assert.ok(Value.Check(ActivityArtDirectionSchema, {
    selectedStyle: null, quality: 'final', canvas: payload.defaultCanvas,
    renderProfiles: payload.renderProfiles, parameterOverrides: { final: { steps: 31 } },
  }));
});
test('director fields reject prompt strings and unknown properties', () => {
  assert.ok(Value.Check(DirectorSettingsSchema, { angle: 'low', mood: 'tense' }));
  assert.equal(Value.Check(DirectorSettingsSchema, { angle: 'from_below' }), false);
  assert.equal(Value.Check(DirectorSettingsSchema, { model: 'arbitrary' }), false);
});
