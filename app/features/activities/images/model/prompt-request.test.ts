import test from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityAsset } from '@sthstart/contracts';
import { buildDrawSignature, buildPromptCustomParams, buildPromptReferences } from './prompt-request';

const asset: ActivityAsset = {
  activityId: 'a1', assetKey: 'ref-key', artifactId: 'art-1', source: 'upload', type: 'image',
  sha256: 'abc', createdAt: '2026-01-01T00:00:00.000Z',
};

test('reference input maps the selected asset and rejects an unloaded key', () => {
  assert.deepEqual(buildPromptReferences({ selectedReferenceKey: 'ref-key', asset, role: 'identity', referenceId: 'r1' }), [{
    referenceId: 'r1', assetKey: 'ref-key', artifactId: 'art-1', sha256: 'abc', role: 'identity', inputKey: 'sourceImage',
  }]);
  assert.deepEqual(buildPromptReferences({ selectedReferenceKey: null, role: 'identity', referenceId: 'r1' }), []);
  assert.throws(() => buildPromptReferences({ selectedReferenceKey: 'missing', role: 'identity', referenceId: 'r1' }), /参考图尚未加载/);
});

test('denoise only applies when a reference is selected', () => {
  assert.deepEqual(buildPromptCustomParams('ref-key', 0.6), { denoise: 0.6 });
  assert.deepEqual(buildPromptCustomParams(null, 0.6), { denoise: undefined });
});

test('draw signature keeps the original field order and values', () => {
  const signature = buildDrawSignature({
    slotId: 's1', config: { schemaVersion: 1 }, overrides: [], referenceKey: 'ref-key',
    referenceRole: 'init_image', denoise: 0.75, preset: undefined, seed: -1, contentRevisionId: 'c1',
  });
  assert.equal(signature, JSON.stringify({
    slot: 's1', config: { schemaVersion: 1 }, overrides: [], reference: 'ref-key',
    referenceRole: 'init_image', denoise: 0.75, preset: undefined, seed: -1, contentRevisionId: 'c1',
  }));
});
