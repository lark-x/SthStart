import assert from 'node:assert/strict';
import test from 'node:test';
import type { ImageConfigDocument } from '@sthstart/contracts';
import { resolveVisualSettings, restoreVisualDefaults } from './visual-settings.js';
const config: ImageConfigDocument = {
  schemaVersion: 1, stylePreset: 'custom', globalStylePrompt: 'ink', globalNegativePrompt: 'text',
  defaultParams: { steps: 999 }, defaultWorkflowId: 'legacy', slotConfigs: [],
  artDirection: { selectedStyle: null, quality: 'draft', canvas: { width: 1152, height: 648 },
    renderProfiles: { draft: { purpose: 'activity_image_text', presetId: 'draft', presetRevision: 1, workflowId: 'w', workflowVersion: 2 },
      final: { purpose: 'activity_image_text', presetId: 'final', presetRevision: 3, workflowId: 'w', workflowVersion: 2 } },
    parameterOverrides: { draft: { steps: 15 }, final: { steps: 31 } } },
};
test('quality overrides remain separate; target parameters and selection win', () => {
  assert.equal(resolveVisualSettings(config).parameters.steps, 15);
  assert.equal(resolveVisualSettings(config, { quality: 'final' }).parameters.steps, 31);
  const local = resolveVisualSettings(config, { workflowId: 'other', parameters: { width: 768 }, negativePrompt: '' });
  assert.equal(local.selection.workflowId, 'other');
  assert.equal(local.selection.presetId, undefined);
  assert.equal(local.parameters.width, 768);
  assert.equal(local.negativePrompt, '');
  assert.equal(local.stylePrompt, 'ink');
});
test('legacy default settings remain unchanged and resetting retains creative inputs', () => {
  const legacy = { ...config, artDirection: undefined };
  assert.equal(resolveVisualSettings(legacy).parameters.steps, 999);
  assert.equal(resolveVisualSettings(legacy).selection.workflowId, 'legacy');
  assert.deepEqual(restoreVisualDefaults({ workflowId: 'w', quality: 'final', parameters: { steps: 30 },
    customPrompt: '雪景', director: { angle: 'low' }, referenceAssetKey: 'ref', loraOverrides: [] }),
  { customPrompt: '雪景', director: { angle: 'low' }, referenceAssetKey: 'ref', loraOverrides: [] });
});
