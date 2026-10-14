import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ImageConfiguration, SceneBeatRenderSettings } from '@sthstart/contracts';
import { imageFieldGroup, imageProfessionalChanges, restoreVisualProfessionalDefaults, visualProfessionalChanges } from './image-settings';

const field = (key: string, value: unknown, type: ImageConfiguration['fields'][number]['type'] = 'integer') => ({ key, label: key, defaultValue: value, type, description: null, section: 'advanced' as const, order: 0, required: false });
const configuration: ImageConfiguration = { configurationHash: 'a'.repeat(64), outputFormat: 'prose', fields: [field('prompt', '', 'long-text'), field('negative', 'blur', 'long-text'), field('width', 768), field('height', 512), field('steps', 20)], sizePresets: [{ label: '清晰', width: 1024, height: 768 }], promptMode: 'service-finalized-v1', promptKey: 'prompt', negativePromptKey: 'negative', modelChoices: [], modelChoicesStale: false, warnings: [] };

test('simple canvas choices do not count as professional edits, custom dimensions and cleared negatives do', () => {
  assert.deepEqual(imageProfessionalChanges(configuration, { width: 1024, height: 768 }, false), []);
  assert.deepEqual(imageProfessionalChanges(configuration, { width: 1024, height: 768 }, false, false), ['width：1024', 'height：768']);
  assert.deepEqual(imageProfessionalChanges(configuration, { width: 1024, height: 768, steps: 17, negative: '' }, true), ['手动最终提示词', '负面词：明确清空', 'steps：17']);
  assert.deepEqual(imageProfessionalChanges(configuration, { width: 800 }, false), ['width：800']);
  assert.equal(imageFieldGroup(field('custom_factor', 1, 'number')), 'sampling');
  assert.equal(imageFieldGroup(field('style_name', 'film', 'text')), 'style');
  assert.equal(imageFieldGroup(field('arbitrary_name', 'file', 'model')), 'models');
});

test('restoring professional inheritance preserves authored content, references, AI choice and scheme', () => {
  const settings: SceneBeatRenderSettings = { customPrompt: '雨中的窗边', director: { lighting: 'warm' }, referenceAssetKey: 'ref', presetId: 'base', promptOptimization: false,
    finalPositivePrompt: 'manual', negativePrompt: '', parameters: { steps: 30 }, loraOverrides: [{ model: 'a', strength: 0.5 }] };
  assert.deepEqual(visualProfessionalChanges(settings), ['手动最终提示词', '负面词：明确清空', 'LoRA 覆盖：1 项', 'steps：30']);
  assert.deepEqual(restoreVisualProfessionalDefaults(settings), { customPrompt: '雨中的窗边', director: { lighting: 'warm' }, referenceAssetKey: 'ref', presetId: 'base', promptOptimization: false });
});
