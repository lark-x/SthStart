import { createHash } from 'node:crypto';
import type { CreativePurposeOptions, ImageConfiguration, WorkflowInputCapabilities } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { mergeGenerationValues, projectFieldContracts, validateRequiredValues, type InputSchemaMap } from './configuration.js';
import { listPresets, resolveDefaultPreset, resolveEnabledPreset } from './configuration-store.js';
import { resolveWorkflowAndEngine } from './task-store.js';
import { cachedModels } from './comfy-discovery.js';
import { resolveActivityImagePromptPolicy } from '../activities/image-prompt-policies.js';

export type ImageSelection = { appId: string; purpose: string; presetId?: string | null; presetRevision?: number | null };
export function imageConfigurationError(code: string, message: string, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}
/** Same ownership and merge rules as task submission. Never discovers models over the network. */
export function resolveImageConfiguration(database: ServiceDatabase, selection: ImageSelection) {
  const preset = selection.presetId
    ? resolveEnabledPreset(database, selection.appId, selection.purpose, selection.presetId, selection.presetRevision)
    : resolveDefaultPreset(database, selection.appId, selection.purpose);
  const resolved = resolveWorkflowAndEngine(database, selection.appId, preset ? {
    purpose: selection.purpose, isInternal: true, workflowId: preset.preset.workflowId,
    workflowVersion: preset.preset.workflowVersion, engineId: preset.preset.engineId,
  } : { purpose: selection.purpose });
  const { workflow, engine } = resolved;
  if (workflow.category !== 'image') throw imageConfigurationError('image_workflow_required', '当前用途没有绑定图片工作流。');
  const editor = workflow.editorConfig;
  const cached = cachedModels({ id: engine.id, kind: engine.kind, baseUrl: engine.baseUrl, credentialAccount: engine.credentialAccount });
  const fields = projectFieldContracts(workflow.inputSchema as InputSchemaMap, editor).map(field => {
    const config = editor?.fields[field.key];
    return { ...field,
      defaultValue: preset?.values[field.key] ?? field.defaultValue,
      ...(field.type === 'model' ? {
        modelEditable: editor?.modelSelection === 'individual' && config?.allowIndividualSwitch !== false,
        allowedModels: config?.allowedModels ?? [],
      } : {}),
    };
  });
  const schema = workflow.inputSchema as InputSchemaMap;
  const candidatePromptKey = Object.keys(schema).find(key => schema[key].semantic === 'prompt')
    ?? fields.find(field => field.key === 'prompt')?.key
    ?? fields.find(field => /positive|正向|正面/i.test(`${field.key} ${field.label}`))?.key ?? null;
  const promptKey = candidatePromptKey && workflow.nodeBindings[candidatePromptKey] ? candidatePromptKey : null;
  const candidateNegativeKey = Object.keys(schema).find(key => schema[key].semantic === 'negative_prompt')
    ?? fields.find(field => /negative|负面|反向/i.test(`${field.key} ${field.label}`))?.key ?? null;
  const negativePromptKey = candidateNegativeKey && workflow.nodeBindings[candidateNegativeKey] ? candidateNegativeKey : null;
  const promptMode = editor?.promptAssembly ?? 'workflow-internal';
  const promptPolicy = resolveActivityImagePromptPolicy(database, workflow.id, workflow.version);
  const configurationHash = createHash('sha256').update(JSON.stringify({ workflow, engineId: engine.id,
    promptPolicy, preset: preset ? { id: preset.preset.id, revision: preset.preset.revision, values: preset.values } : null })).digest('hex');
  const inputCapabilities = (workflow.inputCapabilities ?? {}) as WorkflowInputCapabilities;
  const referenceInputKey = Object.keys(inputCapabilities).find(key => workflow.nodeBindings[key]
    && key === 'sourceImage') ?? Object.keys(inputCapabilities).find(key => workflow.nodeBindings[key]
      && ['init_image', 'identity', 'outfit', 'pose', 'style', 'composition'].includes(inputCapabilities[key].semantic ?? '')
      && (!inputCapabilities[key].mediaTypes?.length || inputCapabilities[key].mediaTypes?.some(type => type.startsWith('image/')))) ?? null;
  const configuration: ImageConfiguration = {
    inputCapabilities, referenceInputKey,
    configurationHash, outputFormat: promptPolicy.outputFormat, fields, sizePresets: editor?.sizePresets ?? [], promptMode, promptKey, negativePromptKey,
    modelChoices: cached?.items ?? [], modelChoicesStale: cached?.stale ?? false,
    warnings: [
      ...(promptMode === 'workflow-internal' ? ['此工作流可能在图内追加文本，当前编辑的是注入文本，不能保证为最终提示词。'] : []),
      ...(!promptKey ? ['工作流未声明可编辑的正面提示词，请先在生成设置中完成映射。'] : []),
    ],
  };
  return { ...resolved, preset, configuration, promptPolicy };
}

export function assertImageConfigurationHash(database: ServiceDatabase, selection: ImageSelection, hash?: string) {
  const resolved = resolveImageConfiguration(database, selection);
  if (hash && resolved.configuration.configurationHash !== hash)
    throw imageConfigurationError('image_configuration_changed', '生成配置已变化，请重新确认提示词和参数后提交。');
  return resolved;
}

export function imageGenerationAudit(database: ServiceDatabase, selection: ImageSelection, hash?: string, optimizerCallId?: string, sourceDescription?: string) {
  const resolved = assertImageConfigurationHash(database, selection, hash);
  if (optimizerCallId) {
    const call = database.connection.prepare(`SELECT parameters_json FROM ai_call_records WHERE id=? AND application_id=?
      AND feature='image-prompt-preparation' AND status='succeeded' AND workflow_id=? AND workflow_version=?`)
      .get(optimizerCallId, selection.appId, resolved.workflow.id, resolved.workflow.version) as { parameters_json: string } | undefined;
    if (!call || JSON.parse(call.parameters_json).configurationHash !== resolved.configuration.configurationHash)
      throw imageConfigurationError('prompt_preparation_mismatch', '提示词准备记录与当前生成配置不匹配，请重新确认。');
  }
  return { parentId: optimizerCallId ?? null, visualConfiguration: {
    configurationHash: resolved.configuration.configurationHash, promptMode: resolved.configuration.promptMode,
    optimizerCallId: optimizerCallId ?? null,
    ...(sourceDescription !== undefined ? { sourceDescription } : {}),
  } };
}

export function mergeImageParameters(resolved: ReturnType<typeof resolveImageConfiguration>, values: Record<string, unknown>) {
  const schema = resolved.workflow.inputSchema as InputSchemaMap;
  const merged = mergeGenerationValues(schema, resolved.workflow.editorConfig,
    resolved.preset?.values ?? {}, values, resolved.workflow.configFormatVersion >= 2 ? 'strict' : 'lenient').values;
  if (resolved.workflow.configFormatVersion >= 2) validateRequiredValues(schema, resolved.workflow.editorConfig, merged);
  return merged;
}

export function buildImagePurposeOptions(database: ServiceDatabase, appId: string, purpose: string): CreativePurposeOptions {
  let current: ReturnType<typeof resolveImageConfiguration> | null = null;
  let status = 'ready';
  try { current = resolveImageConfiguration(database, { appId, purpose }); }
  catch (error) { status = error instanceof Error ? error.message : '配置不可用'; }
  const presets = listPresets(database, { appId, purpose }).filter(item => item.enabled).map(preset => {
    let selected: ReturnType<typeof resolveImageConfiguration> | null = null;
    let unavailableReason: string | undefined;
    try { selected = resolveImageConfiguration(database, { appId, purpose, presetId: preset.id, presetRevision: preset.revision }); }
    catch (error) { unavailableReason = error instanceof Error ? error.message : '预设不可用'; }
    return { id: preset.id, name: preset.name, description: preset.description, revision: preset.revision,
      isDefault: preset.id === current?.preset?.preset.id, workflowId: preset.workflowId,
      workflowName: selected?.workflow.name ?? preset.workflowId, workflowVersion: preset.workflowVersion,
      values: preset.values, modelSummary: selected?.configuration.fields.filter(field => field.type === 'model')
        .map(field => field.defaultValue).filter(Boolean).join(' + ') || null,
      ...(selected ? { configuration: selected.configuration } : {}), ...(unavailableReason ? { unavailableReason } : {}),
    };
  });
  return { purpose, ready: Boolean(current?.configuration.promptKey), status: current && !current.configuration.promptKey ? '工作流缺少正面提示词映射' : status,
    workflow: current ? { id: current.workflow.id, name: current.workflow.name, version: current.workflow.version, category: 'image' as const } : null,
    engine: current ? { id: current.engine.id, name: current.engine.name, kind: current.engine.kind, enabled: true } : null,
    defaultPresetId: current?.preset?.preset.id ?? null, presets,
    fields: current?.configuration.fields ?? [], modelChoices: current?.configuration.modelChoices ?? null,
    modelChoicesStale: current?.configuration.modelChoicesStale,
    ...(current ? { configuration: current.configuration } : {}),
  };
}
