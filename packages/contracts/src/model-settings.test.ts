import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { SaveModelProfileSchema } from './index.js';

const model = { id: 'model-main', connectionId: 'supplier-main', name: '日常模型', modelId: 'upstream/model', capabilities: ['text'] };

test('shared model settings accept all supported purposes and legacy requests', () => {
  assert.equal(Value.Check(SaveModelProfileSchema, model), true);
  for (const modelType of ['chat', 'embedding', 'image']) {
    assert.equal(Value.Check(SaveModelProfileSchema, { ...model, modelType, capabilities: modelType === 'chat' ? ['text', 'multimodal'] : [],
      contextLength: null, maxOutputTokens: null, timeoutMs: null }), true);
  }
  for (const timeoutMs of [1000, 600000]) assert.equal(Value.Check(SaveModelProfileSchema, { ...model, timeoutMs }), true);
});

test('shared model settings reject unsupported types, malformed identifiers and invalid limits', () => {
  for (const fields of [
    { modelType: 'unknown' }, { id: 'Invalid ID' }, { id: 'm' }, { id: `m${'a'.repeat(63)}` },
    { modelId: 123 }, { modelId: '' }, { capabilities: ['video'] }, { enabled: 'true' },
    { timeoutMs: 999 }, { timeoutMs: 600001 }, { timeoutMs: 1000.5 }, { contextLength: 0 }, { maxOutputTokens: -1 },
  ]) assert.equal(Value.Check(SaveModelProfileSchema, { ...model, ...fields }), false, JSON.stringify(fields));
});
