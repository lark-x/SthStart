import { DEFAULT_ACTIVITY_NEGATIVE_PROMPT, type ActivityLora, type ActorSnapshot, type BeatRenderPreview, type ImageConfigDocument, type SceneBeatRenderSettings } from '@sthstart/contracts';
import { createHash, randomInt } from 'node:crypto';
import { resolveVisualSettings } from './visual-settings.js';
import { resolveActivityImagePromptPolicy } from './image-prompt-policies.js';
import type { ServiceDatabase } from '../database.js';
import type { SecretStore } from '../security.js';
import { mergeGenerationValues, projectFieldContracts, type InputSchemaMap } from '../generation/configuration.js';
import { listPresets, resolveDefaultPreset, resolveEnabledPreset } from '../generation/configuration-store.js';
import { resolveWorkflowAndEngine } from '../generation/task-store.js';
import { injectActivityLoras, renderWorkflowSnapshot } from '../generation/workflows.js';
import { inspectWorkflowRuntime } from '../generation/runtime-preflight.js';

export function parseInputCapabilities(value: unknown): Record<string, Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key,
    item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {},]));
}

export function promptInputKey(schema: InputSchemaMap, negative = false): string | null {
  for (const [key, entry] of Object.entries(schema)) {
    const semantic = String(entry.semantic ?? '').toLowerCase();
    const normalized = key.toLowerCase().replaceAll('_', '');
    if (negative ? semantic === 'negative_prompt' || normalized === 'negativeprompt'
      : semantic === 'prompt' || normalized === 'prompt' || normalized === 'positiveprompt') return key;
  }
  return null;
}

export function referenceInputKey(resolved: ReturnType<typeof resolveWorkflowAndEngine>): string | null {
  const capabilities = parseInputCapabilities(resolved.workflow.inputCapabilities);
  for (const [key, capability] of Object.entries(capabilities)) {
    const semantic = String(capability.semantic ?? '');
    const mediaTypes = Array.isArray(capability.mediaTypes) ? capability.mediaTypes.map(String) : [];
    const imageCapable = !mediaTypes.length || mediaTypes.some((item) => item === 'image/*' || item.startsWith('image/'));
    if (resolved.workflow.nodeBindings[key] && imageCapable && ['identity', 'init_image', 'outfit', 'pose', 'style', 'composition'].includes(semantic)) return key;
  }
  return null;
}

export function isCompatibleImageWorkflow(resolved: ReturnType<typeof resolveWorkflowAndEngine>) {
  const schema = resolved.workflow.inputSchema as InputSchemaMap;
  return resolved.workflow.category === 'image'
    && resolved.workflow.outputMediaTypes.some((mediaType) => mediaType.startsWith('image/'))
    && Boolean(promptInputKey(schema) && resolved.workflow.nodeBindings[promptInputKey(schema)!]);
}

/**
 * 工作流版本真实生效的默认画布尺寸：优先取编辑器声明的第一个尺寸预设，
 * 否则取输入 schema 里 width/height 的默认值。两者都没有时不猜。
 */
function workflowDefaultCanvas(
  editorConfig: { sizePresets?: Array<{ width: number; height: number }> } | null | undefined,
  inputSchema: Record<string, unknown> | null | undefined,
): { defaultWidth?: number; defaultHeight?: number } {
  const preset = editorConfig?.sizePresets?.[0];
  if (preset && preset.width > 0 && preset.height > 0) return { defaultWidth: preset.width, defaultHeight: preset.height };
  const schema = inputSchema ?? {};
  const width = Number((schema.width as { default?: unknown } | undefined)?.default);
  const height = Number((schema.height as { default?: unknown } | undefined)?.default);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { defaultWidth: width, defaultHeight: height };
  }
  return {};
}

export function listActivityImageWorkflowOptions(database: ServiceDatabase) {
  const rows = database.connection.prepare(`SELECT purpose,workflow_id,workflow_version FROM app_generation_assignments
      WHERE app_id='activities' AND (purpose LIKE 'activity_image_%' OR purpose='activity_media_slot')
    UNION SELECT purpose,workflow_id,workflow_version FROM generation_presets
      WHERE app_id='activities' AND enabled=1 AND (purpose LIKE 'activity_image_%' OR purpose='activity_media_slot')
    ORDER BY purpose,workflow_id,workflow_version`).all() as Array<{ purpose: string; workflow_id: string; workflow_version: number }>;
  const options: Array<{ purpose: string; workflowId: string; workflowName: string; workflowVersion: number; engineId: string; engineName: string; modelSelection: 'individual' | 'preset-locked'; presetId: string | null; defaultWidth?: number; defaultHeight?: number }> = [];
  for (const row of rows) {
    try {
      const resolved = resolveWorkflowAndEngine(database, 'activities', {
        purpose: row.purpose, workflowId: row.workflow_id, workflowVersion: Number(row.workflow_version), isInternal: true,
      });
      if (!isCompatibleImageWorkflow(resolved)) continue;
      const defaultPreset = resolveDefaultPreset(database, 'activities', row.purpose);
      options.push({ purpose: row.purpose, workflowId: resolved.workflow.id, workflowName: resolved.workflow.name,
        workflowVersion: resolved.workflow.version, engineId: resolved.engine.id, engineName: resolved.engine.name,
        modelSelection: resolved.workflow.editorConfig?.modelSelection === 'preset-locked' ? 'preset-locked' : 'individual',
        presetId: defaultPreset?.preset.workflowId === resolved.workflow.id && defaultPreset.preset.workflowVersion === resolved.workflow.version ? defaultPreset.preset.id : null,
        ...workflowDefaultCanvas(resolved.workflow.editorConfig, resolved.workflow.inputSchema) });
    } catch { /* invalid/unavailable assignments are not selectable */ }
  }
  return options;
}

export function resolveActivityImageWorkflow(database: ServiceDatabase, input: {
  purpose?: string | null; workflowId?: string | null; workflowVersion?: number | null; presetId?: string | null; presetRevision?: number | null; referenceAssetKey?: string | null;
}) {
  let purpose = input.purpose?.trim() || (input.referenceAssetKey ? 'activity_image_edit' : 'activity_image_text');
  const assigned = (value: string) => Boolean(database.connection.prepare('SELECT 1 FROM app_generation_assignments WHERE app_id=? AND purpose=?').get('activities', value));
  if (!assigned(purpose)) {
    const fallback = input.referenceAssetKey ? 'activity_image_edit' : 'activity_media_slot';
    if (!input.purpose && assigned(fallback)) purpose = fallback;
    else throw Object.assign(new Error(`尚未为活动配置用途 ${purpose} 的图片工作流，请先到生成配置中绑定已发布的图片工作流。`), { code: 'generation_assignment_not_found', statusCode: 409 });
  }
  const availableWorkflows = listActivityImageWorkflowOptions(database);
  let selectedPresetId = input.presetId ?? null;
  let selectedPresetRevision = input.presetRevision ?? null;
  let presetValues: Record<string, unknown> = {};
  let workflowId = input.workflowId ?? null;
  let workflowVersion = input.workflowVersion ?? null;
  let hasPreset = false;
  let presetEngineId: string | null = null;
  if (selectedPresetId) {
    const preset = resolveEnabledPreset(database, 'activities', purpose, selectedPresetId, selectedPresetRevision);
    if (workflowId && (workflowId !== preset.preset.workflowId || (workflowVersion != null && workflowVersion !== preset.preset.workflowVersion))) {
      throw Object.assign(new Error('所选预设与工作流不匹配，请重新选择。'), { code: 'preset_workflow_conflict', statusCode: 409 });
    }
    selectedPresetId = preset.preset.id;
    selectedPresetRevision = preset.preset.revision;
    presetValues = preset.values;
    presetEngineId = preset.preset.engineId;
    workflowId = preset.preset.workflowId;
    workflowVersion = preset.preset.workflowVersion;
    hasPreset = true;
  } else if (!workflowId) {
    const defaultPreset = resolveDefaultPreset(database, 'activities', purpose);
    if (defaultPreset) {
      selectedPresetId = defaultPreset.preset.id;
      selectedPresetRevision = defaultPreset.preset.revision;
      presetValues = defaultPreset.values;
      presetEngineId = defaultPreset.preset.engineId;
      workflowId = defaultPreset.preset.workflowId;
      workflowVersion = defaultPreset.preset.workflowVersion;
      hasPreset = true;
    }
  }
  const resolved = resolveWorkflowAndEngine(database, 'activities', { purpose, workflowId, workflowVersion, engineId: presetEngineId, isInternal: true });
  if (!availableWorkflows.some((item) => item.purpose === purpose && item.workflowId === resolved.workflow.id && item.workflowVersion === resolved.workflow.version)) {
    throw Object.assign(new Error('所选工作流未通过活动用途绑定或活动预设开放，请先在生成配置中为活动开放此工作流。'), { code: 'activity_workflow_not_available', statusCode: 409 });
  }
  if (!isCompatibleImageWorkflow(resolved)) throw Object.assign(new Error('所选已发布工作流必须声明图片输出，并绑定正向提示词输入。'), { code: 'image_workflow_incompatible', statusCode: 409 });
  const presets = listPresets(database, { appId: 'activities', purpose, workflowId: resolved.workflow.id })
    .filter((preset) => preset.enabled)
    .map((preset) => ({ id: preset.id, name: preset.name, revision: preset.revision, workflowId: preset.workflowId, workflowVersion: preset.workflowVersion, isDefault: preset.isDefault }));
  return { purpose, selectedPresetId, selectedPresetRevision, presetValues, hasPreset, resolved, availableWorkflows, presets };
}

export function readActivityLoraPolicy(database: ServiceDatabase, workflowId: string, workflowVersion: number) {
  const row = database.connection.prepare(`SELECT revision,entries_json FROM activity_lora_policy_versions
    WHERE workflow_id=? AND workflow_version=? ORDER BY revision DESC LIMIT 1`).get(workflowId, workflowVersion) as
    { revision: number; entries_json: string } | undefined;
  try { return { revision: Number(row?.revision ?? 0), entries: JSON.parse(row?.entries_json ?? '[]') as ActivityLora[] }; }
  catch { return { revision: 0, entries: [] as ActivityLora[] }; }
}

export function mergeActivityLoras(globalEntries: ActivityLora[], actorEntries: ActivityLora[], overrides: Array<{
  model: string; strength?: number; triggerWord?: string; enabled?: boolean;
}>, options: { rejectActorConflicts?: boolean } = {}) {
  const merged = new Map<string, ActivityLora & { source: 'global' | 'character' | 'shot'; available: boolean }>();
  const actorConfig = new Map<string, ActivityLora>();
  for (const item of globalEntries) merged.set(item.model, { ...item, source: 'global', available: false });
  for (const item of actorEntries) {
    const previousActor = actorConfig.get(item.model);
    if (options.rejectActorConflicts && previousActor
      && (previousActor.strength !== item.strength || previousActor.triggerWord !== item.triggerWord || previousActor.enabled !== item.enabled)
      && !overrides.some((override) => override.model === item.model)) {
      throw Object.assign(new Error(`多个角色的 LoRA「${item.model}」配置冲突；请在此画格显式覆盖后再生成。`), { code: 'comic_actor_lora_conflict', statusCode: 409 });
    }
    actorConfig.set(item.model, item);
    merged.set(item.model, { ...item, source: 'character', available: false });
  }
  for (const override of overrides) {
    const previous = merged.get(override.model);
    merged.set(override.model, { model: override.model, strength: override.strength ?? previous?.strength ?? 1,
      triggerWord: override.triggerWord ?? previous?.triggerWord ?? '', enabled: override.enabled ?? previous?.enabled ?? true,
      source: 'shot', available: false });
  }
  return [...merged.values()];
}

export function appendLoraTriggerWords(prompt: string, loras: ActivityLora[]) {
  const result = prompt.trim();
  const existing = result.toLocaleLowerCase();
  const additions = [...new Set(loras.filter((item) => item.enabled).map((item) => item.triggerWord.trim()).filter(Boolean))]
    .filter((word) => !existing.includes(word.toLocaleLowerCase()));
  return additions.length ? `${result}\n${additions.join(', ')}` : result;
}

export { composeActivityPrompt, prependLoraTriggerWords } from './prompt-tag-composer.js';
import { composeActivityPrompt } from './prompt-tag-composer.js';
import { compileVisualPrompt, isServiceFinalizedAssembly, type StructuredActorBlock } from './image-prompt-v2.js';

/** All activity targets append style and triggers after optimization, without guessing actor count. */
export function finalizeActivityVisualPrompt(
  optimized: string,
  style: string,
  loras: ActivityLora[],
  v2?: V2FinalizeInput,
) {
  if (isServiceFinalizedAssembly(v2?.editorConfig)) {
    return compileVisualPrompt({
      loraTriggers: loras.filter(item => item.enabled).map(item => item.triggerWord),
      stylePrompt: style,
      personCount: v2?.personCount ?? null,
      characters: v2?.characters,
      camera: v2?.camera,
      environment: v2?.environment,
      details: v2?.details,
      directorConstraints: v2?.directorConstraints,
      // 结构化模式下 naturalLanguage 取自模型的原始自然语言块（计划 §5.3）。
      // 此时 `optimized` 已经是 `compileVisualPrompt()` 的产物，再当作自然语言拼一次
      // 会让动作、景别等字段重复出现；只有 prose 模式才回退到 `optimized`。
      naturalLanguage: v2?.naturalLanguage ?? optimized,
    }).positive;
  }
  return composeActivityPrompt([optimized, style].filter(Boolean).join(', '), {
    preserveActorSemantics: true,
    loraTriggers: loras.filter(item => item.enabled).map(item => item.triggerWord),
  });
}

export interface V2FinalizeInput {
  editorConfig?: { promptAssembly?: string } | null;
  personCount?: string | null;
  characters?: StructuredActorBlock[];
  camera?: string[];
  environment?: string[];
  details?: string[];
  directorConstraints?: string[];
  /** 结构化模式下模型的原始自然语言块；缺失表示 prose 模式。 */
  naturalLanguage?: string;
}

/**
 * 从优化结果构造 V2 组装输入：结构化模式使用模型返回的作用域块，
 * prose 模式保持“优化文本即自然语言”的旧行为。
 *
 * 注意 `naturalLanguage` 必须带出去（计划 §5.3）：结构化结果的 `optimizedPrompt`
 * 已经是编译产物，收尾时不能再把它当作自然语言。
 */
export function v2FinalizeInputFrom(
  editorConfig: { promptAssembly?: string } | null | undefined,
  optimization: { visualBlocks?: { personCount: string | null; characters: StructuredActorBlock[]; camera: string[]; environment: string[]; details: string[]; naturalLanguage?: string } | null },
): V2FinalizeInput {
  const blocks = optimization.visualBlocks;
  if (!blocks) return { editorConfig };
  return {
    editorConfig,
    personCount: blocks.personCount,
    characters: blocks.characters,
    camera: blocks.camera,
    environment: blocks.environment,
    details: blocks.details,
    naturalLanguage: blocks.naturalLanguage,
  };
}


export function buildActivityImageWorkflowSnapshot(
  resolved: ReturnType<typeof resolveWorkflowAndEngine>, parameters: Record<string, unknown>, seed: number, loras: ActivityLora[],
) {
  const schema = resolved.workflow.inputSchema as InputSchemaMap;
  const primarySeedKey = Object.keys(schema).find(key => schema[key].semantic === 'seed') ?? 'seed';
  const base = renderWorkflowSnapshot(resolved.workflow.definition, resolved.workflow.nodeBindings, parameters, seed, primarySeedKey);
  return injectActivityLoras(base, resolved.workflow.editorConfig, loras.filter((item) => item.enabled));
}

export function inspectActivityImageWorkflow(
  resolved: ReturnType<typeof resolveWorkflowAndEngine>, parameters: Record<string, unknown>, seed: number, loras: ActivityLora[],
  secrets: SecretStore, fetcher: typeof fetch, refresh = true,
) {
  return inspectWorkflowRuntime(resolved.engine, buildActivityImageWorkflowSnapshot(resolved, parameters, seed, loras), secrets, fetcher, refresh);
}

export function mergeActivityImageInputs(
  resolved: ReturnType<typeof resolveWorkflowAndEngine>, presetValues: Record<string, unknown>, inputs: Record<string, unknown>, hasPreset: boolean,
) {
  const schema = resolved.workflow.inputSchema as InputSchemaMap;
  const mapped = mapActivityVisualInputs(schema, inputs);
  const mode = resolved.workflow.configFormatVersion >= 2 ? 'strict' : 'lenient';
  if (mode === 'strict') for (const [key, entry] of Object.entries(schema)) {
    const field = resolved.workflow.editorConfig?.fields[key];
    if (entry.type !== 'model' && field?.type !== 'model' && !field?.modelCategory) continue;
    if (resolved.workflow.editorConfig?.modelSelection !== 'preset-locked' && field?.allowIndividualSwitch !== false) continue;
    if (key in mapped && mapped[key] !== (presetValues[key] ?? entry.default)) {
      throw Object.assign(new Error(`模型字段「${field?.label ?? entry.title ?? key}」随预设锁定，不能单独更换。`), { code: 'model_not_allowed', statusCode: 409 });
    }
  }
  return mergeGenerationValues(schema, resolved.workflow.editorConfig, presetValues, mapped, mode, hasPreset ? undefined : { applyDefaults: false }).values;
}

export function mapActivityVisualInputs(schema: InputSchemaMap, inputs: Record<string, unknown>) {
  const mapped = { ...inputs };
  for (const dimension of ['width', 'height']) {
    if (!(dimension in mapped) || dimension in schema) continue;
    const binding = Object.entries(schema).find(([, entry]) => entry.semantic === dimension)?.[0];
    if (!binding) throw Object.assign(new Error(`工作流未开放图片${dimension === 'width' ? '宽度' : '高度'}输入，请选择兼容的预设。`), {
      statusCode: 409, code: 'visual_dimension_unsupported',
    });
    if (!(binding in mapped)) mapped[binding] = mapped[dimension];
    delete mapped[dimension];
  }
  return mapped;
}

export function activityVisualParameterFields(resolved: ReturnType<typeof resolveWorkflowAndEngine>, values: Record<string, unknown>): BeatRenderPreview['fields'] {
  const schema = resolved.workflow.inputSchema as InputSchemaMap;
  // Old creative-field projection invents prompt/seed and misses renamed semantic fields.
  // Activity controls must expose the workflow's real bound keys, including schemas without editor labels.
  const projected = projectFieldContracts(schema, resolved.workflow.editorConfig).filter(field => field.key in schema);
  for (const [key, entry] of Object.entries(schema)) {
    if (projected.some(field => field.key === key) || resolved.workflow.editorConfig?.fields[key]?.section === 'fixed') continue;
    const semantic = (entry.semantic ?? key).toLowerCase().replaceAll('_', '');
    const labels: Record<string, string> = { width: '宽度', height: '高度', seed: '种子', prompt: '提示词', positiveprompt: '提示词', negativeprompt: '反向提示词', checkpoint: '主模型', steps: '步数' };
    const knownTypes = ['text','long-text','integer','number','boolean','enum','seed','model'] as const;
    const type = knownTypes.find(type => type === entry.type) ?? (semantic.includes('prompt') ? 'long-text' : 'text');
    projected.push({ key, label: entry.title ?? labels[semantic] ?? key, description: entry.description ?? null, type,
      section: 'advanced', order: projected.length + 100, defaultValue: entry.default ?? null, required: entry.required === true,
      ...(entry.minimum === undefined ? {} : { minimum: entry.minimum }), ...(entry.maximum === undefined ? {} : { maximum: entry.maximum }),
      ...(entry.step === undefined ? {} : { step: entry.step }), ...(entry.enum === undefined ? {} : { enumValues: entry.enum }) });
  }
  return projected.map(field => {
    const configured = resolved.workflow.editorConfig?.fields[field.key];
    const modelField = field.type === 'model' || Boolean(field.modelCategory);
    return {
      key: field.key, label: field.label, type: field.type, value: values[field.key] ?? field.defaultValue, required: field.required,
      ...(field.minimum === undefined ? {} : { minimum: field.minimum }), ...(field.maximum === undefined ? {} : { maximum: field.maximum }),
      ...(field.step === undefined ? {} : { step: field.step }), ...(field.enumValues === undefined ? {} : { enumValues: field.enumValues }),
      ...(configured?.allowedModels ? { allowedModels: configured.allowedModels } : {}), ...(field.modelCategory ? { modelCategory: field.modelCategory } : {}),
      modelEditable: modelField && resolved.workflow.editorConfig?.modelSelection !== 'preset-locked' && configured?.allowIndividualSwitch !== false,
    };
  });
}

/** Object insertion order is not a configuration change; array order remains meaningful. */
export function hashVisualPlan(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, 'en'))) : item)).digest('hex');
}

/** Target discovery and artifact ownership stay in the owning feature; actual visual configuration is shared. */
export function resolveEffectiveActivityVisualPlan(database: ServiceDatabase, input: {
  imageConfig: ImageConfigDocument | null; imageConfigRevisionId?: string | null; settings: SceneBeatRenderSettings; actors: ActorSnapshot[];
  sourcePrompt: string; seed?: number;
}) {
  const visual = resolveVisualSettings(input.imageConfig, input.settings);
  const selection = resolveActivityImageWorkflow(database, { ...visual.selection, referenceAssetKey: input.settings.referenceAssetKey });
  const { resolved } = selection;
  const schema = resolved.workflow.inputSchema as InputSchemaMap;
  const positiveKey = promptInputKey(schema)!;
  const negativeKey = promptInputKey(schema, true);
  if (!negativeKey && visual.negativePrompt?.trim()) throw Object.assign(new Error('当前工作流没有反向提示词输入，请清空负向词或选择兼容工作流。'), {
    code: 'negative_prompt_unsupported', statusCode: 409,
  });
  if (negativeKey && !resolved.workflow.nodeBindings[negativeKey]) {
    throw Object.assign(new Error('工作流声明了反向提示词但缺少节点绑定。'), { code: 'negative_prompt_binding_missing', statusCode: 409 });
  }
  const storedPromptPolicy = resolveActivityImagePromptPolicy(database, resolved.workflow.id, resolved.workflow.version);
  const promptPolicy = { ...storedPromptPolicy, enabled: visual.finalPositivePrompt !== undefined ? false : visual.promptOptimization ?? storedPromptPolicy.enabled,
    ...(visual.finalPositivePrompt !== undefined ? { positiveSuffix: '' } : {}) };
  if (visual.finalPositivePrompt !== undefined && (!visual.finalPositivePrompt.trim() || resolved.workflow.editorConfig?.promptAssembly !== 'service-finalized-v1')) {
    throw Object.assign(new Error('完整提示词覆盖需要直接绑定最终文本的工作流，且内容不能为空。'), { code: 'final_prompt_unsupported', statusCode: 409 });
  }
  const loraPolicy = readActivityLoraPolicy(database, resolved.workflow.id, resolved.workflow.version);
  const loras = mergeActivityLoras(loraPolicy.entries, input.actors.flatMap(actor => actor.visualLoras ?? []),
    input.settings.loraOverrides ?? [], { rejectActorConflicts: true });
  if (loras.some(item => item.enabled)) {
    if (!resolved.workflow.editorConfig?.activityLoraInjection) throw Object.assign(new Error('工作流没有声明 LoRA 插入点。'), { code: 'activity_lora_unsupported', statusCode: 409 });
    if (Object.values(resolved.workflow.definition).some(raw => raw && typeof raw === 'object'
      && ['LoraLoader', 'LoraLoaderModelOnly'].includes(String((raw as Record<string, unknown>).class_type)))) {
      throw Object.assign(new Error('工作流已有固定 LoRA，不能重复叠加活动 LoRA。'), { code: 'activity_lora_static_conflict', statusCode: 409 });
    }
  }
  const parameters = mergeActivityImageInputs(resolved, selection.presetValues, visual.parameters, selection.hasPreset);
  parameters[positiveKey] = input.sourcePrompt;
  const negativePrompt = negativeKey ? visual.negativePrompt ?? (promptPolicy.negativePrompt.trim()
    || (typeof parameters[negativeKey] === 'string' ? parameters[negativeKey] as string : '') || DEFAULT_ACTIVITY_NEGATIVE_PROMPT) : null;
  if (negativeKey) parameters[negativeKey] = negativePrompt;
  const seedKey = Object.entries(schema).find(([key, entry]) => entry.semantic === 'seed' || ['seed', 'noise_seed'].includes(key.toLowerCase()))?.[0];
  const configured = seedKey ? visual.parameters[seedKey] : undefined;
  const seed = input.seed ?? (typeof configured === 'number' && Number.isInteger(configured) && configured >= 0 && configured <= 2147483647
    ? configured : randomInt(0, 2147483647));
  if (seedKey && (seedKey in parameters || schema[seedKey].required)) parameters[seedKey] = seed;
  const provenance = {
    ...(visual.finalPositivePrompt !== undefined ? { finalPositivePrompt: visual.finalPositivePrompt } : {}),
    ...(visual.promptOptimization !== undefined ? { promptOptimization: visual.promptOptimization } : {}),
    imageConfigRevisionId: input.imageConfigRevisionId ?? null,
    quality: visual.quality, style: input.imageConfig?.artDirection?.selectedStyle ?? null,
    canvas: input.imageConfig?.artDirection?.canvas ?? null,
    selectionSource: input.settings.presetId || input.settings.workflowId ? 'target' : input.imageConfig?.artDirection ? 'activity' : 'legacy',
    workflowId: resolved.workflow.id, workflowVersion: resolved.workflow.version,
    presetId: selection.selectedPresetId, presetRevision: selection.selectedPresetRevision,
    promptPolicyRevision: promptPolicy.revision, loraPolicyRevision: loraPolicy.revision,
  };
  const { selectionSource: _selectionSource, ...frozenProvenance } = provenance;
  const configurationHash = hashVisualPlan({ provenance: frozenProvenance, imageConfig: input.imageConfig,
    definition: resolved.workflow.definition, bindings: resolved.workflow.nodeBindings, inputSchema: schema,
    parameters, seed, promptPolicy, loras, stylePrompt: visual.stylePrompt });
  return { visual, selection, parameters, positiveKey, negativeKey, negativePrompt, seed, promptPolicy, loraPolicy, loras, provenance, configurationHash };
}
