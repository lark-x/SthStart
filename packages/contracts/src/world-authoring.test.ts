import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { BindWorldProjectSchema } from './story-worlds.js';
import { CreateWorldBundleSchema, CreateWorldSetupSchema, UpdateWorldSetupSchema, WorldSetupResultSchema, UpdateWorldBranchSchema, WorldAuthoringDraftSchema, WorldSuggestionRequestSchema } from './world-authoring.js';
import { ExtractWebSearchRequestSchema, SaveWebSearchSettingsSchema, SaveWebSearchSourceSchema, WebSearchRequestSchema, WebSearchResultSchema } from './web-search.js';

const draft = {
  definition: {
    title: '', summary: '', timeLabel: '故事时间', locations: [], actors: [], sources: [], lockedFacts: [],
    models: { action: null, adjudication: null, narration: null }, visualStyle: '',
  },
  initialBranch: { title: '主线', mode: 'canon-gap', direction: '' },
};

test('incomplete authoring draft supports suggestions but cannot create a world', () => {
  assert.ok(Value.Check(WorldAuthoringDraftSchema, draft));
  assert.ok(Value.Check(WorldSuggestionRequestSchema, { draft, instruction: '补充港口世界', scope: 'all', draftFingerprint: 'draft-1' }));
  assert.equal(Value.Check(CreateWorldBundleSchema, { ...draft, idempotencyKey: 'create-1' }), false);
  assert.equal(Value.Check(WorldSuggestionRequestSchema, { draft, instruction: '', scope: 'all', draftFingerprint: 'draft-1' }), false);
  assert.equal(Value.Check(UpdateWorldBranchSchema, { ...draft.initialBranch, expectedRevision: 0 }), false);
  assert.ok(Value.Check(UpdateWorldBranchSchema, { ...draft.initialBranch, expectedRevision: 1 }));
});

test('bundle creation requires bounded initial branch and explicit attempt identifier', () => {
  const definition = {
    ...draft.definition, title: '港口', locations: [{ id: 'harbor', name: '港口', description: '' }],
    actors: [{ id: 'actor', name: '林舟', role: 'main', characterId: null, characterVersion: null, background: '',
      personality: '', speechStyle: '', appearance: '', goals: [], locationId: 'harbor', referenceArtifactIds: [] }],
  };
  const request = { definition, initialBranch: draft.initialBranch, idempotencyKey: 'create-1' };
  assert.ok(Value.Check(CreateWorldBundleSchema, request));
  assert.equal(Value.Check(CreateWorldBundleSchema, { ...request, idempotencyKey: '' }), false);
  assert.equal(Value.Check(CreateWorldBundleSchema, { ...request, autoRun: true }), false);
  assert.equal(Value.Check(CreateWorldBundleSchema, { ...request, initialBranch: { ...request.initialBranch, direction: '长'.repeat(8001) } }), false);
});

test('pending world creation and partial saves remain separate from runnable worlds', () => {
  assert.ok(Value.Check(CreateWorldSetupSchema, { title: '港口', idempotencyKey: 'setup-1' }));
  for (const title of ['', '字'.repeat(201)]) {
    assert.equal(Value.Check(CreateWorldSetupSchema, { title, idempotencyKey: 'setup-1' }), false);
  }
  assert.equal(Value.Check(CreateWorldSetupSchema, { title: '港口' }), false);
  const update = { expectedRevision: 1, draft: { ...draft, definition: { ...draft.definition, title: '港口' } }, complete: false };
  assert.ok(Value.Check(UpdateWorldSetupSchema, update));
  assert.equal(Value.Check(UpdateWorldSetupSchema, { ...update, expectedRevision: 0 }), false);
  assert.equal(Value.Check(UpdateWorldSetupSchema, { ...update, complete: undefined }), false);
  const pending = { status: 'pending', setup: { id: 'world-1', revision: 1, draft: update.draft } };
  assert.ok(Value.Check(WorldSetupResultSchema, pending));
  assert.equal(Value.Check(WorldSetupResultSchema, { ...pending, status: 'ready' }), false);
});

test('binding compare-and-swap is optional for old clients and accepts explicit unbound expectation', () => {
  const request = { projectId: 'project', expectedRevision: 1 };
  assert.ok(Value.Check(BindWorldProjectSchema, request));
  assert.ok(Value.Check(BindWorldProjectSchema, { ...request, expectedBinding: null }));
  assert.equal(Value.Check(BindWorldProjectSchema, { ...request, expectedBinding: { branchId: 'branch' } }), false);
});

test('web search snapshots, credentials and extraction stay bounded', () => {
  const item = { id: 'web-1', title: '港口资料', url: 'https://example.com/harbor', siteName: 'example.com',
    snippet: '摘要', content: '正文', retrievedAt: '2026-11-14T00:00:00Z', contentHash: 'hash', status: 'extracted', truncated: false };
  assert.ok(Value.Check(WebSearchResultSchema, item));
  assert.ok(Value.Check(SaveWebSearchSourceSchema, { item }));
  assert.ok(Value.Check(ExtractWebSearchRequestSchema, { items: [item] }));
  assert.equal(Value.Check(ExtractWebSearchRequestSchema, { items: [] }), false);
  assert.equal(Value.Check(WebSearchResultSchema, { ...item, content: '字'.repeat(20001) }), false);
  assert.ok(Value.Check(WebSearchRequestSchema, { query: '港口', maxResults: 10 }));
  assert.equal(Value.Check(WebSearchRequestSchema, { query: '港口', maxResults: 11 }), false);
  assert.equal(Value.Check(SaveWebSearchSettingsSchema, { enabled: true, provider: 'other' }), false);
});
