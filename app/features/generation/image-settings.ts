import type { GenerationFieldContract, ImageConfiguration, SceneBeatRenderSettings } from '@sthstart/contracts';

export type ImageFieldGroup = 'models' | 'sampling' | 'style';
const keyParts = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().split(/[_\-.]+/);

/** Field types carry the primary meaning; known tokens support older editor definitions. */
export function imageFieldGroup(field: GenerationFieldContract): ImageFieldGroup {
  const tokens = keyParts(field.key);
  if (field.type === 'model' || field.modelCategory || tokens.includes('lora')) return 'models';
  if (['number', 'integer', 'seed'].includes(field.type) || tokens.some(token => ['sampler', 'scheduler', 'denoise'].includes(token))) return 'sampling';
  return 'style';
}

export function imageProfessionalChanges(configuration: ImageConfiguration | undefined, overrides: Record<string, unknown>, manual: boolean, simpleCanvas = true) {
  if (!configuration) return [];
  const values = Object.fromEntries(configuration.fields.map(field => [field.key, field.defaultValue]));
  Object.assign(values, overrides);
  const presetSize = simpleCanvas && configuration.sizePresets.some(size => values.width === size.width && values.height === size.height);
  const changes = configuration.fields.filter(field => field.key !== configuration.promptKey
    && !(presetSize && ['width', 'height'].includes(field.key))
    && Object.hasOwn(overrides, field.key) && JSON.stringify(overrides[field.key]) !== JSON.stringify(field.defaultValue))
    .map(field => field.key === configuration.negativePromptKey
      ? `负面词：${String(overrides[field.key] ?? '').trim() ? '本次覆盖' : '明确清空'}`
      : `${field.label}：${String(overrides[field.key] ?? '随机')}`);
  if (manual) changes.unshift('手动最终提示词');
  return changes;
}

/** Authored content and reference choices remain in the simple form. */
export function visualProfessionalChanges(settings: SceneBeatRenderSettings, fields: Array<{ key: string; label: string; value?: unknown }> = []) {
  const changes: string[] = [];
  if (settings.finalPositivePrompt !== undefined) changes.push('手动最终提示词');
  if (settings.negativePrompt !== undefined) changes.push(`负面词：${settings.negativePrompt.trim() ? '本次覆盖' : '明确清空'}`);
  if (settings.loraOverrides?.length) changes.push(`LoRA 覆盖：${settings.loraOverrides.length} 项`);
  for (const [key, value] of Object.entries(settings.parameters ?? {})) {
    const field = fields.find(item => item.key === key);
    if (value !== undefined) changes.push(`${field?.label ?? key}：${String(value ?? '随机')}`);
  }
  return changes;
}

export function restoreVisualProfessionalDefaults(settings: SceneBeatRenderSettings): SceneBeatRenderSettings {
  const { finalPositivePrompt, negativePrompt, loraOverrides, parameters, ...content } = settings;
  void finalPositivePrompt; void negativePrompt; void loraOverrides; void parameters;
  return content;
}
