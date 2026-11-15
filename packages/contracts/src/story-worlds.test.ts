import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { DEFAULT_WORLD_RUN_SETTINGS, StartWorldRunSchema, WorldDefinitionSchema,
  StoryWorldSchema, WorldEventQuerySchema, WorldAdoptionSchema, SubmitWorldImageSchema,
  WorldVisualReferenceSchema,
} from './story-worlds.js';

test('world run bounds protect time, call and image budgets and require idempotency/revision', () => {
  const input = { expectedRevision: 1, idempotencyKey: 'run-key', settings: DEFAULT_WORLD_RUN_SETTINGS };
  assert.ok(Value.Check(StartWorldRunSchema, input));
  for (const settings of [
    { ...input.settings, durationTicks: 0 }, { ...input.settings, durationTicks: 10081 },
    { ...input.settings, stepTicks: -1 }, { ...input.settings, maxTextCalls: 0 },
    { ...input.settings, maxTextCalls: 1.5 }, { ...input.settings, maxImages: -1 },
  ]) assert.equal(Value.Check(StartWorldRunSchema, { ...input, settings }), false);
  assert.equal(Value.Check(StartWorldRunSchema, { ...input, expectedRevision: 0 }), false);
  assert.equal(Value.Check(StartWorldRunSchema, { ...input, idempotencyKey: '' }), false);
  assert.equal(Value.Check(StartWorldRunSchema, { ...input, settings: { ...input.settings, extraCalls: 99 } }), false);
});

test('world response preserves identities and immutable metadata while rejecting unknown request fields', () => {
  const definition = {
    title: '港口', summary: '', timeLabel: '归航后', locations: [{ id: 'harbor', name: '港口', description: '' }],
    actors: [{ id: 'a', name: '行者', role: 'main', characterId: null, characterVersion: null,
      background: '', personality: '', speechStyle: '', appearance: '', goals: [], locationId: 'harbor', referenceArtifactIds: [] }],
    sources: [], lockedFacts: [], models: { action: null, adjudication: null, narration: null }, visualStyle: '',
  };
  assert.ok(Value.Check(WorldDefinitionSchema, definition));
  assert.ok(Value.Check(StoryWorldSchema, { ...definition, id: 'w1', revision: 1, createdAt: 'now', updatedAt: 'now' }));
  assert.equal(Value.Check(WorldDefinitionSchema, { ...definition, revision: 1 }), false);
  assert.equal(Value.Check(WorldDefinitionSchema, { ...definition, actors: [] }), false);
});

test('window pagination, image submission and adoption requests remain bounded', () => {
  assert.ok(Value.Check(WorldEventQuerySchema, { from: 60, to: 120, limit: 200, actorId: 'a' }));
  assert.equal(Value.Check(WorldEventQuerySchema, { limit: 201 }), false);
  assert.equal(Value.Check(WorldEventQuerySchema, { from: -1 }), false);
  const image = { expectedRevision: 2, idempotencyKey: 'image-1', engineId: 'gpt' };
  assert.ok(Value.Check(SubmitWorldImageSchema, image));
  assert.equal(Value.Check(SubmitWorldImageSchema, { ...image, n: 12 }), false);
  const adoption = { expectedRevision: 1, idempotencyKey: 'adopt-1', projectId: 'project', eventIds: ['event'], title: '归航' };
  assert.ok(Value.Check(WorldAdoptionSchema, adoption));
  assert.equal(Value.Check(WorldAdoptionSchema, { ...adoption, eventIds: [] }), false);
});

test('visual references and start minute stay optional and schema-bounded for old and new worlds', () => {
  const legacy = {
    title: '港口', summary: '', timeLabel: '归航后', locations: [{ id: 'harbor', name: '港口', description: '' }],
    actors: [{ id: 'a', name: '行者', role: 'main', characterId: null, characterVersion: null,
      background: '', personality: '', speechStyle: '', appearance: '', goals: [], locationId: 'harbor', referenceArtifactIds: [] }],
    sources: [], lockedFacts: [], models: { action: null, adjudication: null, narration: null }, visualStyle: '',
  };
  // 旧世界没有 visualReferences 字段，必须继续通过严格校验。
  assert.ok(Value.Check(WorldDefinitionSchema, legacy));

  const scene: Record<string, unknown> = {
    id: 'vis-harbor', name: '港口锚点', kind: 'location', locationId: 'harbor',
    description: '三号码头与吊机的位置关系。', referenceArtifactIds: ['art-scene'],
  };
  const prop: Record<string, unknown> = {
    id: 'vis-lamp', name: '黄铜灯', kind: 'prop', description: '', referenceArtifactIds: [],
  };
  assert.ok(Value.Check(WorldVisualReferenceSchema, scene));
  assert.ok(Value.Check(WorldVisualReferenceSchema, prop));

  const current = { ...legacy, visualReferences: [scene, prop] };
  assert.ok(Value.Check(WorldDefinitionSchema, current));
  assert.ok(Value.Check(StoryWorldSchema, { ...current, id: 'w1', revision: 1, createdAt: 'now', updatedAt: 'now' }));

  assert.equal(Value.Check(WorldVisualReferenceSchema, { ...scene, kind: 'actor' }), false);
  assert.equal(Value.Check(WorldVisualReferenceSchema, { ...scene, referenceArtifactIds: undefined }), false);
  assert.equal(Value.Check(WorldVisualReferenceSchema, { ...scene, locationId: '' }), false);
  assert.equal(Value.Check(WorldVisualReferenceSchema, { ...scene, extra: 'x' }), false);
  assert.equal(Value.Check(WorldVisualReferenceSchema, {
    ...scene, referenceArtifactIds: Array.from({ length: 11 }, (_, index) => `art-${index}`),
  }), false);
  assert.equal(Value.Check(WorldDefinitionSchema, {
    ...current,
    visualReferences: Array.from({ length: 101 }, (_, index) => ({ ...scene, id: `vis-${index}` })),
  }), false);

  // 起点时刻：缺省不推测；0..1439 的整数合法，越界、小数与字符串都拒绝。
  for (const minute of [0, 480, 1439]) {
    assert.ok(Value.Check(WorldDefinitionSchema, { ...legacy, startMinuteOfDay: minute }));
  }
  for (const minute of [-1, 1440, 1.5, '480']) {
    assert.equal(Value.Check(WorldDefinitionSchema, { ...legacy, startMinuteOfDay: minute }), false);
  }
});
