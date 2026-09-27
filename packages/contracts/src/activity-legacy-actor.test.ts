import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { ActorSnapshotSchema } from './index.js';

test('legacy activity actor snapshots may omit appearance reference keys', () => {
  const actor = {
    id: 'actor-1', displayName: '旧角色', persona: {}, activityRole: '', outfitDescription: '',
  };
  assert.equal(Value.Check(ActorSnapshotSchema, actor), true);
  assert.equal(Value.Check(ActorSnapshotSchema, { ...actor, appearanceReferenceAssetKeys: [] }), true);
  assert.equal(Value.Check(ActorSnapshotSchema, { ...actor, appearanceReferenceAssetKeys: 'wrong' }), false);
});
