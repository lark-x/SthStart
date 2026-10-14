import type { ActivityLora, ManagedImageOptions } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { resolveWorkflowAndEngine } from './task-store.js';
import { mergeActivityLoras } from '../activities/image-render-common.js';
import { imageConfigurationError } from './image-configuration.js';
import { injectActivityLoras, renderWorkflowSnapshot } from './workflows.js';
import { composeActivityPrompt } from '../activities/prompt-tag-composer.js';

const aliases: Record<string, string[]> = {
  sampler: ['sampler_name'], unet: ['unet_name'], clip: ['clip_name'], vae: ['vae_name'], checkpoint: ['ckpt_name'],
  loraTriggers: ['lora_trigger', 'loraTrigger', 'loraTriggerWords'], qualityPrompt: ['quality', 'quality_prompt'],
  negativePrompt: ['negative', 'negative_prompt'],
};

/** Project into declared semantic keys; unsupported fields never silently disappear. */
export function projectManagedImage(database: ServiceDatabase, appId: string, purpose: unknown, options: ManagedImageOptions,
  values: Record<string, unknown>): { inputs: Record<string, unknown>; loras: ActivityLora[] } {
  if (appId !== 'linshe' || purpose !== 'linshe-chat-image') throw imageConfigurationError('invalid_managed_image', '公共图片选项不属于已授权用途。', 400);
  const resolved = resolveWorkflowAndEngine(database, appId, { purpose });
  const inputs: Record<string, unknown> = {};
  const textParts: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const schema = resolved.workflow.inputSchema as Record<string, { semantic?: string }>;
    const mapped = [key, ...(aliases[key] ?? [])].find(candidate => resolved.workflow.nodeBindings[candidate])
      ?? Object.keys(schema).find(candidate => schema[candidate].semantic === key && resolved.workflow.nodeBindings[candidate]);
    if (!mapped && resolved.workflow.editorConfig?.promptAssembly === 'service-finalized-v1'
      && ['artist', 'qualityPrompt', 'loraTriggers'].includes(key) && typeof value === 'string') {
      textParts.push(value); continue;
    }
    // A fixed sampler value may be omitted only when the authorized graph already uses exactly it.
    if (!mapped && key === 'denoise') {
      const samplers = Object.values(resolved.workflow.definition).filter((node): node is { class_type: string; inputs: Record<string, unknown> } =>
        Boolean(node && typeof node === 'object' && (node as { class_type?: string }).class_type === 'KSampler'));
      if (samplers.length === 1 && samplers[0].inputs.denoise === value) continue;
    }
    if (!mapped) throw imageConfigurationError('managed_image_input_unsupported', `当前用途工作流无法消费 ${key}，请配置对应绑定。`);
    if (Object.hasOwn(inputs, mapped) && inputs[mapped] !== value)
      throw imageConfigurationError('managed_image_input_conflict', `参数 ${mapped} 有互相冲突的取值。`);
    inputs[mapped] = value;
  }
  if (textParts.length) {
    const schema = resolved.workflow.inputSchema as Record<string, { semantic?: string }>;
    const promptKey = Object.keys(schema).find(key => schema[key].semantic === 'prompt') ?? 'prompt';
    if (typeof inputs[promptKey] !== 'string') throw imageConfigurationError('managed_image_input_unsupported', '工作流缺少最终提示词绑定。');
    inputs[promptKey] = composeActivityPrompt([inputs[promptKey], ...textParts].join(', '), { preserveActorSemantics: true });
  }
  const loras = mergeActivityLoras([], options.loras, []);
  try { injectActivityLoras(renderWorkflowSnapshot(resolved.workflow.definition, resolved.workflow.nodeBindings, inputs), resolved.workflow.editorConfig, loras); }
  catch { throw imageConfigurationError('managed_image_lora_unsupported', '当前用途工作流无法安全插入所选 LoRA。'); }
  return { inputs, loras };
}
