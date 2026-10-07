import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  ActivityImageCompilationDiagnosticsSchema,
  ActivityImagePromptPolicyResponseSchema,
  ActivityImagePromptPolicySchema,
  GenerationEditorConfigSchema,
  SaveActivityImagePromptPolicyRequestSchema,
  StructuredVisualPromptSchema,
} from './index.js';

const basePolicy = {
  workflowId: 'wf', workflowVersion: 1, revision: 0, enabled: true, instructions: '',
  positiveSuffix: '', negativePrompt: '', createdAt: '2026-10-03T00:00:00.000Z',
};

test('a legacy policy payload without the new modes is rejected by the strict policy schema', () => {
  assert.equal(Value.Check(ActivityImagePromptPolicySchema, basePolicy), false);
  assert.equal(Value.Check(ActivityImagePromptPolicySchema, { ...basePolicy, outputFormat: 'prose', knowledgeMode: 'none' }), true);
  assert.equal(Value.Check(ActivityImagePromptPolicySchema, { ...basePolicy, outputFormat: 'tags', knowledgeMode: 'keyword' }), true);
  assert.equal(Value.Check(ActivityImagePromptPolicySchema, { ...basePolicy, outputFormat: 'tags', knowledgeMode: 'vector' }), false);
});

test('save requests may omit the modes so old clients keep working', () => {
  const legacyRequest = {
    workflowId: 'wf', workflowVersion: 1, revision: 0, enabled: true,
    instructions: '', positiveSuffix: '', negativePrompt: '',
  };
  assert.equal(Value.Check(SaveActivityImagePromptPolicyRequestSchema, legacyRequest), true);
  assert.equal(Value.Check(SaveActivityImagePromptPolicyRequestSchema, { ...legacyRequest, outputFormat: 'tags', knowledgeMode: 'keyword' }), true);
  assert.equal(Value.Check(SaveActivityImagePromptPolicyRequestSchema, { ...legacyRequest, outputFormat: 'markdown' }), false);
});

test('the policy response always states whether the style is managed by the activity', () => {
  const response = {
    policy: { ...basePolicy, outputFormat: 'tags', knowledgeMode: 'keyword' },
    optimizer: { ready: false, profileName: null, model: null, message: null },
    serviceFinalizedAssembly: true,
  };
  assert.equal(Value.Check(ActivityImagePromptPolicyResponseSchema, response), true);
  assert.equal(Value.Check(ActivityImagePromptPolicyResponseSchema, { policy: null, optimizer: response.optimizer }), false);
});

test('the editor config carries the optional prompt assembly marker only when declared', () => {
  const base = {
    version: 2, fields: {}, modelSelection: 'preset-locked', loraSlots: [], sizePresets: [], constraints: {},
  };
  assert.equal(Value.Check(GenerationEditorConfigSchema, base), true);
  assert.equal(Value.Check(GenerationEditorConfigSchema, { ...base, promptAssembly: 'service-finalized-v1' }), true);
  assert.equal(Value.Check(GenerationEditorConfigSchema, { ...base, promptAssembly: 'anything-else' }), false);
});

test('the structured prompt schema is strict about its exact shape', () => {
  const valid = {
    actors: [{ actorId: 'a', identity: ['alice'], appearance: [], clothing: [], action: [], expression: [] }],
    camera: ['full body'], scene: ['night'], details: [], naturalLanguage: '',
  };
  assert.equal(Value.Check(StructuredVisualPromptSchema, valid), true);
  assert.equal(Value.Check(StructuredVisualPromptSchema, { ...valid, extra: 1 }), false);
  assert.equal(Value.Check(StructuredVisualPromptSchema, {
    ...valid, actors: [{ actorId: 'a', identity: [], appearance: [], clothing: [], action: [] }],
  }), false);
  assert.equal(Value.Check(StructuredVisualPromptSchema, { ...valid, camera: ['ok', 5] }), false);
});

test('compilation diagnostics keep provenance and allow an unknown final prompt', () => {
  const diagnostics = {
    compilerVersion: 'activity-image-v2.1',
    outputFormat: 'tags', knowledgeMode: 'keyword',
    knowledgeVersion: 'linshe-parity-1+7baabdab',
    phase: 'optimized',
    structuredPrompt: null,
    knowledgeHits: [{ knowledgeId: 'ipk.slot.order', actorId: null, tags: ['solo'], score: 20, reason: 'matched:tag' }],
    removedTags: [{ scope: 'actor:a', tag: '2girls', reason: 'conflicts with solo' }],
    warnings: ['w'],
    styleSource: 'activity_art_style',
    policyRevision: 3,
    sourceFingerprint: 'abc',
    finalPositive: '@ebora, solo',
    finalNegative: 'score_1',
    finalPromptHash: 'def',
  };
  assert.equal(Value.Check(ActivityImageCompilationDiagnosticsSchema, diagnostics), true);
  assert.equal(Value.Check(ActivityImageCompilationDiagnosticsSchema, {
    ...diagnostics, finalPositive: null, finalNegative: null, finalPromptHash: null, knowledgeVersion: null,
    structuredPrompt: null, phase: 'source_preview',
  }), true);
  assert.equal(Value.Check(ActivityImageCompilationDiagnosticsSchema, { ...diagnostics, phase: 'other' }), false);
  assert.equal(Value.Check(ActivityImageCompilationDiagnosticsSchema, { ...diagnostics, knowledgeHits: [{ knowledgeId: 'x' }] }), false);
});
