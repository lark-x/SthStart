import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  ModelRouteSchema,
  ModelRouteListSchema,
  ModelThinkingLevelSchema,
  SaveModelRouteSchema,
} from './model-routing.js';

const route = {
  id: 'route:public::text',
  scope: 'public',
  appId: null,
  capability: 'text',
  primaryModelId: 'model-a',
  fallbackModelIds: ['model-b', 'model-c'],
  inheritPublicFallbacks: false,
  createdAt: '2026-11-15T00:00:00.000Z',
  updatedAt: '2026-11-15T00:00:00.000Z',
};

test('model routing accepts the public and application templates', () => {
  assert.equal(Value.Check(ModelRouteSchema, route), true);
  assert.equal(Value.Check(ModelRouteListSchema, { items: [route] }), true);
  assert.equal(Value.Check(SaveModelRouteSchema, {
    scope: 'app',
    appId: 'story-worlds',
    capability: 'multimodal',
    primaryModelId: 'model-a',
    fallbackModelIds: ['model-b'],
    inheritPublicFallbacks: true,
  }), true);
});

test('model routing rejects unsupported thinking levels and more than two fallbacks', () => {
  assert.equal(Value.Check(ModelThinkingLevelSchema, 'turbo'), false);
  assert.equal(Value.Check(ModelThinkingLevelSchema, 'medium'), true);
  assert.equal(Value.Check(SaveModelRouteSchema, {
    scope: 'public',
    capability: 'text',
    primaryModelId: 'model-a',
    fallbackModelIds: ['model-b', 'model-c', 'model-d'],
    inheritPublicFallbacks: false,
  }), false);
});
