import type {
  GenerationAnalyzedInput,
  GenerationEditorConfig,
  GenerationFieldConfig,
  GenerationFieldContract,
  GenerationFieldType,
} from '@sthstart/contracts';
import { validateComfyApiJson } from './workflows.js';

/**
 * 配置工作台的纯逻辑层：原生 API JSON 分析、V2 编辑器配置、参数校验与安全投影。
 * 这里不触碰数据库与网络；草稿与预设的持久化在 configuration-store.ts。
 */

export interface SchemaEntry {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  step?: number;
  enum?: string[];
  required?: boolean;
}

export type InputSchemaMap = Record<string, SchemaEntry>;

export interface MediaSlotCandidate {
  nodeId: string;
  classType: string;
  currentValue: string;
}

export interface AnalyzeComfyJsonResult {
  nodeCount: number;
  inputs: GenerationAnalyzedInput[];
  outputCandidates: string[];
  mediaSlotCandidates: MediaSlotCandidate[];
  warnings: string[];
}

/** 已知“加载器节点 → 模型类别”的适配表。类别名与 ComfyUI models 子目录保持一致。 */
const MODEL_NODE_ADAPTERS: Record<string, { inputName: string; category: string; semantic: string; label: string }> = {
  CheckpointLoaderSimple: { inputName: 'ckpt_name', category: 'checkpoints', semantic: 'checkpoint', label: '主模型' },
  unCLIPCheckpointLoader: { inputName: 'ckpt_name', category: 'checkpoints', semantic: 'checkpoint', label: '主模型' },
  checkpointLoader: { inputName: 'ckpt_name', category: 'checkpoints', semantic: 'checkpoint', label: '主模型' },
  VAELoader: { inputName: 'vae_name', category: 'vae', semantic: 'vae', label: 'VAE 模型' },
  CLIPLoader: { inputName: 'clip_name', category: 'clip', semantic: 'clip', label: '文本编码器' },
  CLIPVisionLoader: { inputName: 'clip_name', category: 'clip_vision', semantic: 'clip_vision', label: 'CLIP Vision 模型' },
  UNETLoader: { inputName: 'unet_name', category: 'unet', semantic: 'unet', label: '扩散模型' },
  LoraLoader: { inputName: 'lora_name', category: 'loras', semantic: 'lora', label: 'LoRA 模型' },
  LoraLoaderModelOnly: { inputName: 'lora_name', category: 'loras', semantic: 'lora', label: 'LoRA 模型' },
  ControlNetLoader: { inputName: 'control_net_name', category: 'controlnet', semantic: 'controlnet', label: 'ControlNet 模型' },
  StyleModelLoader: { inputName: 'style_name', category: 'style_models', semantic: 'style_model', label: '风格模型' },
  UpscaleModelLoader: { inputName: 'model_name', category: 'upscale_models', semantic: 'upscale', label: '放大模型' },
};

const SAMPLER_CLASSES = new Set(['KSampler', 'KSamplerAdvanced']);
/** 采样器家族的标准输入名；这些名字只会出现在采样语义中。 */
const SAMPLER_INPUT_SEMANTICS: Record<string, { semantic: string; kind: GenerationFieldType; label: string; section: 'basic' | 'advanced' }> = {
  seed: { semantic: 'seed', kind: 'seed', label: '种子', section: 'basic' },
  noise_seed: { semantic: 'seed', kind: 'seed', label: '种子', section: 'basic' },
  steps: { semantic: 'steps', kind: 'integer', label: '步数', section: 'advanced' },
  cfg: { semantic: 'cfg', kind: 'number', label: 'CFG', section: 'advanced' },
  denoise: { semantic: 'denoise', kind: 'number', label: '重绘强度', section: 'advanced' },
  sampler_name: { semantic: 'sampler_name', kind: 'enum', label: '采样器', section: 'advanced' },
  scheduler: { semantic: 'scheduler', kind: 'enum', label: '调度器', section: 'advanced' },
};

/** API JSON 中出现但属于界面控制而非真实节点参数的输入名。 */
const EXCLUDED_INPUT_NAMES = new Set(['control_after_generate']);

const SEMANTIC_LABELS: Record<string, string> = {
  prompt: '提示词',
  negative_prompt: '反向提示词',
  width: '宽度',
  height: '高度',
  batch_size: '批量数量',
  ...Object.fromEntries(Object.entries(SAMPLER_INPUT_SEMANTICS).map(([name, meta]) => [meta.semantic, meta.label])),
  checkpoint: '主模型',
  lora: 'LoRA 模型',
  strength: 'LoRA 强度',
  vae: 'VAE 模型',
  clip: '文本编码器',
  unet: '扩散模型',
};

function isLink(value: unknown, nodeIds: Set<string>): boolean {
  return Array.isArray(value) && value.length === 2
    && typeof value[0] === 'string' && nodeIds.has(value[0])
    && typeof value[1] === 'number';
}

function scalarKind(value: unknown, objectInfoInput: unknown): { kind: GenerationFieldType; enumValues?: string[] } {
  if (typeof value === 'boolean') return { kind: 'boolean' };
  if (typeof value === 'number') return Number.isInteger(value) ? { kind: 'integer' } : { kind: 'number' };
  if (typeof value === 'string') {
    const info = objectInfoInput;
    if (Array.isArray(info) && Array.isArray(info[0]) && info[0].length > 0 && info[0].every((item) => typeof item === 'string')) {
      return { kind: 'enum', enumValues: info[0] as string[] };
    }
    return { kind: 'text' };
  }
  return { kind: 'text' };
}

function semanticToKey(semantic: string): string {
  if (semantic === 'negative_prompt') return 'negativePrompt';
  return semantic;
}

function sanitizeKey(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^[^A-Za-z]+/, '');
  return cleaned || 'field';
}

function labelFor(analyzed: { semantic: string | null; inputName: string; modelLabel?: string | null }): string {
  if (analyzed.modelLabel) return analyzed.modelLabel;
  if (analyzed.semantic && SEMANTIC_LABELS[analyzed.semantic]) return SEMANTIC_LABELS[analyzed.semantic];
  return analyzed.inputName;
}

/**
 * 分析原生 ComfyUI API JSON。
 *
 * 规划 §6.3：识别标量输入、枚举与输出节点候选；已知节点适配给出语义猜测，
 * 未知节点只展示技术字段；连线数组（[nodeId, outputIndex]）绝不暴露为参数。
 * objectInfo（可选）来自连接的 /object_info，用于补充枚举值。
 */
export function analyzeComfyApiJson(
  definition: unknown,
  objectInfo?: Record<string, unknown>,
): AnalyzeComfyJsonResult {
  const nodes = validateComfyApiJson(definition);
  const nodeIds = new Set(Object.keys(nodes));
  const warnings: string[] = [];

  // 反向连线：目标节点.输入名 → 来源节点 ID。用于把 KSampler.positive/negative
  // 关联回对应的 CLIPTextEncode，识别提示词/反向提示词语义。
  const linkTarget = new Map<string, string>();
  for (const [nodeId, node] of Object.entries(nodes)) {
    const inputs = (node as { inputs?: Record<string, unknown> }).inputs ?? {};
    for (const [inputName, value] of Object.entries(inputs)) {
      if (isLink(value, nodeIds)) linkTarget.set(`${nodeId}::${inputName}`, String((value as unknown[])[0]));
    }
  }

  const promptSemanticByNode = new Map<string, 'prompt' | 'negative_prompt'>();
  for (const [nodeId, node] of Object.entries(nodes)) {
    const classType = (node as { class_type: string }).class_type;
    if (!SAMPLER_CLASSES.has(classType)) continue;
    for (const [inputName, semantic] of [['positive', 'prompt'], ['negative', 'negative_prompt']] as const) {
      const sourceId = linkTarget.get(`${nodeId}::${inputName}`);
      if (sourceId && nodes[sourceId] && (nodes[sourceId] as { class_type: string }).class_type === 'CLIPTextEncode') {
        promptSemanticByNode.set(sourceId, semantic);
      }
    }
  }

  const inputs: GenerationAnalyzedInput[] = [];
  const usedKeys = new Set<string>();
  const mediaSlotCandidates: MediaSlotCandidate[] = [];
  const semanticCounts = new Map<string, number>();

  const push = (item: Omit<GenerationAnalyzedInput, 'key' | 'note'> & { note?: string | null }) => {
    let key = item.semantic ? semanticToKey(item.semantic) : sanitizeKey(`${item.nodeId}_${item.inputName}`);
    if (usedKeys.has(key)) key = sanitizeKey(`${item.nodeId}_${item.inputName}`);
    usedKeys.add(key);
    inputs.push({ ...item, key, note: item.note ?? null });
  };

  for (const [nodeId, nodeValue] of Object.entries(nodes)) {
    const node = nodeValue as { class_type: string; inputs: Record<string, unknown> };
    const classType = node.class_type;
    const nodeObjectInfo = objectInfo && typeof objectInfo === 'object' ? objectInfo[classType] as Record<string, unknown> | undefined : undefined;
    const inputGroups = nodeObjectInfo && typeof nodeObjectInfo === 'object'
      ? (nodeObjectInfo as { input?: Record<string, Record<string, unknown>> }).input ?? {}
      : {};
    const objectInfoInputs = { ...inputGroups.required, ...inputGroups.optional };

    const modelAdapter = MODEL_NODE_ADAPTERS[classType];
    const samplerLike = SAMPLER_CLASSES.has(classType) || ('cfg' in node.inputs && 'steps' in node.inputs);

    for (const [inputName, rawValue] of Object.entries(node.inputs)) {
      if (EXCLUDED_INPUT_NAMES.has(inputName)) continue;
      if (isLink(rawValue, nodeIds)) continue;
      if (Array.isArray(rawValue)) continue;

      if (classType === 'LoadImage' && inputName === 'image') {
        mediaSlotCandidates.push({ nodeId, classType, currentValue: String(rawValue ?? '') });
        continue;
      }

      if (modelAdapter && inputName === modelAdapter.inputName) {
        push({
          nodeId, inputName, classType,
          currentValue: rawValue,
          kind: 'model',
          semantic: modelAdapter.semantic,
          modelCategory: modelAdapter.category,
          confidence: 'known',
          autoMapped: true,
          modelLabel: modelAdapter.label,
        });
        semanticCounts.set(modelAdapter.semantic, (semanticCounts.get(modelAdapter.semantic) ?? 0) + 1);
        continue;
      }

      if (classType === 'LoraLoader' && (inputName === 'strength_model' || inputName === 'strength_clip')) {
        push({
          nodeId, inputName, classType,
          currentValue: rawValue,
          kind: 'number',
          semantic: 'strength',
          confidence: 'known',
          autoMapped: true,
          modelLabel: inputName === 'strength_model' ? 'LoRA 强度（模型）' : 'LoRA 强度（文本编码器）',
        });
        continue;
      }

      if (samplerLike && SAMPLER_INPUT_SEMANTICS[inputName]) {
        const meta = SAMPLER_INPUT_SEMANTICS[inputName];
        const scalar = scalarKind(rawValue, objectInfoInputs[inputName]);
        push({
          nodeId, inputName, classType,
          currentValue: rawValue,
          kind: meta.kind,
          semantic: meta.semantic,
          ...(scalar.enumValues ? { enumValues: scalar.enumValues } : {}),
          confidence: SAMPLER_CLASSES.has(classType) ? 'known' : 'guessed',
          autoMapped: true,
        });
        semanticCounts.set(meta.semantic, (semanticCounts.get(meta.semantic) ?? 0) + 1);
        continue;
      }

      if (classType === 'CLIPTextEncode' && inputName === 'text') {
        const semantic = promptSemanticByNode.get(nodeId) ?? 'prompt';
        push({
          nodeId, inputName, classType,
          currentValue: rawValue,
          kind: 'long-text',
          semantic,
          confidence: promptSemanticByNode.has(nodeId) ? 'known' : 'guessed',
          autoMapped: true,
          note: promptSemanticByNode.has(nodeId) ? null : '未连接到采样器，按提示词猜测，请确认。',
        });
        semanticCounts.set(semantic, (semanticCounts.get(semantic) ?? 0) + 1);
        continue;
      }

      if (classType === 'EmptyLatentImage' && (inputName === 'width' || inputName === 'height' || inputName === 'batch_size')) {
        const meta = inputName === 'batch_size'
          ? { semantic: 'batch_size', label: '批量数量', section: 'advanced' as const }
          : { semantic: inputName, label: inputName === 'width' ? '宽度' : '高度', section: 'basic' as const };
        push({
          nodeId, inputName, classType,
          currentValue: rawValue,
          kind: 'integer',
          semantic: meta.semantic,
          confidence: 'known',
          autoMapped: true,
          modelLabel: meta.label,
        });
        semanticCounts.set(meta.semantic, (semanticCounts.get(meta.semantic) ?? 0) + 1);
        continue;
      }

      // 未知节点/未知输入：只作为技术字段展示，不猜语义，不自动映射。
      const scalar = scalarKind(rawValue, objectInfoInputs[inputName]);
      push({
        nodeId, inputName, classType,
        currentValue: rawValue,
        kind: scalar.kind,
        semantic: null,
        ...(scalar.enumValues ? { enumValues: scalar.enumValues } : {}),
        confidence: 'guessed',
        autoMapped: false,
        note: '未知节点输入，未映射；可在下方确认后映射为业务字段。',
      });
    }
  }

  // 一个语义影响多个节点时不做自动映射（规划 §6.3），保留高级手工绑定。
  for (const [semantic, count] of semanticCounts) {
    if (count <= 1) continue;
    let demoted = 0;
    for (const item of inputs) {
      if (item.semantic === semantic && item.autoMapped && demoted > 0) {
        item.autoMapped = false;
        item.confidence = 'guessed';
        item.note = `同一语义出现在多个节点，不支持自动映射；请在高级页签手工绑定。`;
      }
      if (item.semantic === semantic && item.autoMapped) demoted = 1;
    }
    warnings.push(`语义 "${SEMANTIC_LABELS[semantic] ?? semantic}" 出现在 ${count} 个节点中，只有第一个被自动映射，其余请手工确认。`);
  }

  const outputCandidates = Object.entries(nodes)
    .filter(([, nodeValue]) => {
      const classType = (nodeValue as { class_type: string }).class_type;
      return /Save/.test(classType) || classType.endsWith('VideoCombine');
    })
    .map(([id]) => id);
  if (!outputCandidates.length) warnings.push('未找到保存类输出节点候选；请在「输入与输出」页签手动指定输出节点。');

  for (const item of inputs) {
    if (item.currentValue === null || item.currentValue === undefined) {
      item.note = item.note ?? '当前值为空，请在参数页签设置默认值。';
    }
  }

  return { nodeCount: nodeIds.size, inputs, outputCandidates, mediaSlotCandidates, warnings };
}

export interface AnalyzedPackageInfo {
  name: string | null;
  description: string | null;
  versionCount: number;
  presetCount: number;
}

/** 项目配置包分析：恢复 definition 与配置，连接引用不自动迁移。 */
export function analyzeConfigPackage(
  bundle: Record<string, unknown>,
  objectInfo?: Record<string, unknown>,
): { analysis: AnalyzeComfyJsonResult; packageInfo: AnalyzedPackageInfo; suggestedDraft: Record<string, unknown> } {
  const workflow = (bundle.workflow && typeof bundle.workflow === 'object' && !Array.isArray(bundle.workflow) ? bundle.workflow : {}) as Record<string, unknown>;
  const version = (bundle.version && typeof bundle.version === 'object' && !Array.isArray(bundle.version) ? bundle.version : {}) as Record<string, unknown>;
  const definition = bundle.definition ?? version.definition;
  if (!definition) throw codedError('invalid_import_payload', '配置包缺少工作流 definition。');
  const analysis = analyzeComfyApiJson(definition, objectInfo);
  const presets = Array.isArray(bundle.presets) ? bundle.presets.length : 0;
  const versionCount = Array.isArray(bundle.versions) ? bundle.versions.length : 1;
  const suggestedDraft = buildSuggestedDraft(definition, analysis, {
    inputSchema: (version.inputSchema ?? bundle.inputSchema) as InputSchemaMap,
    inputCapabilities: (version.inputCapabilities ?? bundle.inputCapabilities) as Record<string, unknown>,
    nodeBindings: (version.nodeBindings ?? bundle.nodeBindings) as Record<string, string[]>,
    outputDeclarations: (version.outputDeclarations ?? bundle.outputDeclarations) as string[],
    outputMediaTypes: (version.outputMediaTypes ?? bundle.outputMediaTypes) as string[],
    outputSchema: (version.outputSchema ?? bundle.outputSchema) as Record<string, unknown>,
    editorConfig: (version.editorConfig ?? bundle.editorConfig) as GenerationEditorConfig | null,
    formatVersion: (version.configFormatVersion ?? (version.editorConfig ? 2 : 1)) as number,
  });
  suggestedDraft.engineId = null;
  if (version.engineId || bundle.engineId) analysis.warnings.push('配置包中的连接引用不会被自动迁移，请重新选择连接。');
  return {
    analysis,
    packageInfo: {
      name: typeof workflow.name === 'string' ? workflow.name : typeof bundle.name === 'string' ? bundle.name : null,
      description: typeof workflow.description === 'string' ? workflow.description : null,
      versionCount,
      presetCount: presets,
    },
    suggestedDraft,
  };
}

export function buildSuggestedDraft(
  definition: unknown,
  analysis: AnalyzeComfyJsonResult,
  overrides?: {
    inputSchema?: InputSchemaMap;
    inputCapabilities?: Record<string, unknown>;
    nodeBindings?: Record<string, string[]>;
    outputDeclarations?: string[];
    outputMediaTypes?: string[];
    outputSchema?: Record<string, unknown>;
    editorConfig?: GenerationEditorConfig | null;
    formatVersion?: number;
  },
): Record<string, unknown> {
  const mappedInputs = analysis.inputs.filter((item) => item.autoMapped);
  const inputSchema: InputSchemaMap = {};
  for (const item of mappedInputs) {
    const entry: SchemaEntry = { type: jsonTypeFor(item.kind) };
    if (item.semantic === 'prompt') entry.required = true;
    if (item.kind !== 'seed' && item.currentValue !== null && item.currentValue !== undefined && item.currentValue !== '') {
      entry.default = item.currentValue;
    }
    if (item.enumValues?.length) entry.enum = item.enumValues;
    inputSchema[item.key] = entry;
  }
  const nodeBindings: Record<string, string[]> = {};
  for (const item of mappedInputs) nodeBindings[item.key] = [item.nodeId, 'inputs', item.inputName];

  const fields: Record<string, GenerationFieldConfig> = {};
  for (const item of analysis.inputs) {
    const section = !item.autoMapped
      ? 'advanced' as const
      : fieldSectionFor(item);
    fields[item.key] = {
      key: item.key,
      label: labelFor(item),
      description: item.note,
      section,
      order: fieldOrderFor(item),
      type: item.kind,
      ...(item.modelCategory ? { modelCategory: item.modelCategory } : {}),
      ...(item.kind === 'model' && typeof item.currentValue === 'string' && item.currentValue
        ? { allowedModels: [item.currentValue] }
        : {}),
    };
  }

  const modelFields = analysis.inputs.filter((item) => item.autoMapped && item.kind === 'model');
  const loraSlots = [] as Array<{ nameKey: string; strengthKey: string }>;
  for (const lora of analysis.inputs.filter((item) => item.autoMapped && item.semantic === 'lora')) {
    const strength = analysis.inputs.find((item) => item.autoMapped && item.nodeId === lora.nodeId && item.inputName === 'strength_model');
    if (strength) loraSlots.push({ nameKey: lora.key, strengthKey: strength.key });
  }

  const editorConfig: GenerationEditorConfig = {
    version: 2,
    fields,
    modelSelection: modelFields.length === 1 ? 'individual' : 'preset-locked',
    loraSlots,
    sizePresets: [],
    constraints: {},
  };

  return {
    formatVersion: overrides?.formatVersion === 1 ? 1 : 2,
    name: null,
    description: null,
    category: 'image',
    engineId: null,
    definition,
    inputSchema: overrides?.inputSchema ?? inputSchema,
    inputCapabilities: overrides?.inputCapabilities ?? {},
    nodeBindings: overrides?.nodeBindings ?? nodeBindings,
    outputDeclarations: overrides?.outputDeclarations?.length ? overrides.outputDeclarations : analysis.outputCandidates,
    outputMediaTypes: overrides?.outputMediaTypes ?? ['image/png'],
    outputSchema: overrides?.outputSchema ?? {},
    editorConfig: overrides?.editorConfig ?? editorConfig,
  };
}

function jsonTypeFor(kind: GenerationFieldType): string {
  switch (kind) {
    case 'integer': case 'seed': return 'integer';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    default: return 'string';
  }
}

function fieldSectionFor(item: GenerationAnalyzedInput): 'basic' | 'advanced' {
  if (item.semantic && ['prompt', 'negative_prompt', 'width', 'height', 'seed', 'checkpoint'].includes(item.semantic)) return 'basic';
  if (item.semantic === 'lora') return 'basic';
  if (item.kind === 'model') return 'basic';
  return 'advanced';
}

function fieldOrderFor(item: GenerationAnalyzedInput): number {
  const order: Record<string, number> = {
    prompt: 1, negative_prompt: 2, checkpoint: 3, width: 4, height: 5, seed: 6, lora: 7,
    steps: 10, cfg: 11, denoise: 12, sampler_name: 13, scheduler: 14, batch_size: 15,
  };
  if (item.semantic && order[item.semantic] != null) return order[item.semantic];
  return 100;
}

// ── 编辑器配置规范化与校验 ──

function codedError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** 从数据库 JSON 宽容解析 editorConfig；损坏时回退 null（V1 行为）。 */
export function parseEditorConfig(value: unknown): GenerationEditorConfig | null {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  if (!isRecord(parsed) || parsed.version !== 2 || !isRecord(parsed.fields)) return null;
  return {
    version: 2,
    fields: Object.fromEntries(Object.entries(parsed.fields as Record<string, unknown>)
      .filter(([, item]) => isRecord(item) && typeof (item as Record<string, unknown>).key === 'string' && typeof (item as Record<string, unknown>).label === 'string')
      .map(([key, item]) => {
        const field = item as Record<string, unknown>;
        return [key, {
          key: String(field.key),
          label: String(field.label),
          description: typeof field.description === 'string' ? field.description : null,
          section: field.section === 'basic' || field.section === 'fixed' ? field.section : 'advanced',
          order: Number.isFinite(Number(field.order)) ? Number(field.order) : 100,
          type: typeof field.type === 'string' ? field.type as GenerationFieldType : undefined,
          modelCategory: typeof field.modelCategory === 'string' ? field.modelCategory : undefined,
          allowedModels: Array.isArray(field.allowedModels) ? field.allowedModels.filter((name): name is string => typeof name === 'string') : undefined,
          allowIndividualSwitch: typeof field.allowIndividualSwitch === 'boolean' ? field.allowIndividualSwitch : undefined,
        } satisfies GenerationFieldConfig];
      })),
    modelSelection: parsed.modelSelection === 'individual' ? 'individual' : 'preset-locked',
    loraSlots: Array.isArray(parsed.loraSlots)
      ? parsed.loraSlots.filter((slot): slot is { nameKey: string; strengthKey: string } =>
        isRecord(slot) && typeof slot.nameKey === 'string' && typeof slot.strengthKey === 'string')
      : [],
    sizePresets: Array.isArray(parsed.sizePresets)
      ? parsed.sizePresets.filter((preset): preset is { label: string; width: number; height: number } =>
        isRecord(preset) && typeof preset.label === 'string' && Number.isFinite(Number(preset.width)) && Number.isFinite(Number(preset.height)))
      : [],
    constraints: {
      maxPixels: isRecord(parsed.constraints) && Number.isFinite(Number(parsed.constraints.maxPixels)) ? Number(parsed.constraints.maxPixels) : undefined,
      allowedSizes: isRecord(parsed.constraints) && Array.isArray(parsed.constraints.allowedSizes)
        ? parsed.constraints.allowedSizes.filter((size): size is { width: number; height: number } =>
          isRecord(size) && Number.isFinite(Number(size.width)) && Number.isFinite(Number(size.height)))
        : undefined,
    },
  };
}

/** 保存前严格校验编辑器配置结构。 */
export function validateEditorConfig(value: unknown): GenerationEditorConfig {
  const parsed = parseEditorConfig(value);
  if (!parsed) throw codedError('invalid_editor_config', '编辑器配置必须是 version=2 的对象，且包含字段表。');
  for (const [key, field] of Object.entries(parsed.fields)) {
    if (field.key !== key) throw codedError('invalid_editor_config', `字段配置键 "${key}" 与字段 key "${field.key}" 不一致。`);
    if (!field.label.trim()) throw codedError('invalid_editor_config', `字段 "${key}" 缺少显示名称。`);
    if (!['basic', 'advanced', 'fixed'].includes(field.section)) throw codedError('invalid_editor_config', `字段 "${key}" 的显示层级无效。`);
  }
  for (const slot of parsed.loraSlots) {
    if (!parsed.fields[slot.nameKey] || !parsed.fields[slot.strengthKey]) {
      throw codedError('invalid_editor_config', `LoRA 槽位引用了不存在的字段（${slot.nameKey}/${slot.strengthKey}）。`);
    }
  }
  return parsed;
}

export function parseInputSchema(value: unknown): InputSchemaMap {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return {}; }
  }
  if (!isRecord(parsed)) return {};
  const result: InputSchemaMap = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (!isRecord(entry)) continue;
    const schemaEntry: SchemaEntry = {};
    if (typeof entry.type === 'string') schemaEntry.type = entry.type;
    if (typeof entry.title === 'string') schemaEntry.title = entry.title;
    if (typeof entry.description === 'string') schemaEntry.description = entry.description;
    if (entry.default !== undefined) schemaEntry.default = entry.default;
    if (Number.isFinite(Number(entry.minimum))) schemaEntry.minimum = Number(entry.minimum);
    if (Number.isFinite(Number(entry.maximum))) schemaEntry.maximum = Number(entry.maximum);
    if (Number.isFinite(Number(entry.step))) schemaEntry.step = Number(entry.step);
    if (Array.isArray(entry.enum)) schemaEntry.enum = entry.enum.filter((item): item is string => typeof item === 'string');
    if (entry.required === true) schemaEntry.required = true;
    result[key] = schemaEntry;
  }
  return result;
}

export interface ValueValidationOptions {
  /** strict：拒绝未知参数与固定字段覆盖（V2）；lenient：仅校验已知键的类型与范围（V1 兼容）。 */
  mode: 'strict' | 'lenient';
  /** request：客户端本次输入；preset：管理员保存的预设覆盖值。 */
  context: 'request' | 'preset';
}

/**
 * 校验参数值。规划 §8.2：Service 拒绝 NaN、无穷、非法类型、未知参数、越界、
 * 固定字段覆盖；不静默截断或钳制。
 *
 * - strict：用于 V2 版本上的客户端参数通道（创作请求与试运行）。
 * - lenient：旧调用方兼容——只拒绝非有限数字与固定字段覆盖，未知键原样放行，
 *   保证旧请求仍可执行（阶段 B 退出条件）。
 */
export function validateValuesAgainstSchema(
  inputSchema: InputSchemaMap,
  editorConfig: GenerationEditorConfig | null,
  values: Record<string, unknown>,
  options: ValueValidationOptions,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(values ?? {})) {
    const fieldConfig = editorConfig?.fields[key];
    if (fieldConfig?.section === 'fixed') {
      throw codedError('fixed_parameter', `参数 "${key}" 为固定字段，不能被${options.context === 'preset' ? '预设' : '请求'}覆盖。`);
    }
    if (typeof rawValue === 'number' && !Number.isFinite(rawValue)) {
      throw codedError('invalid_parameter_value', `参数 "${key}" 不是有限数字。`);
    }
    if (options.mode === 'lenient') {
      result[key] = rawValue;
      continue;
    }
    const entry = inputSchema[key];
    if (!entry) throw codedError('unknown_parameter', `未知参数 "${key}"，该工作流未声明此字段。`);
    result[key] = validateSingleValue(key, entry, rawValue);
  }
  return result;
}

function validateSingleValue(key: string, entry: SchemaEntry, rawValue: unknown): unknown {
  const type = entry.type ?? inferType(entry.default);
  if (entry.enum && (typeof rawValue !== 'string' || !entry.enum.includes(rawValue))) {
    throw codedError('parameter_not_in_enum', `参数 "${key}" 的值不在允许的枚举列表中。`);
  }
  if (typeof rawValue === 'number' && entry.step !== undefined && entry.step > 0) {
    const steps = (rawValue - (entry.minimum ?? 0)) / entry.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-7) {
      throw codedError('parameter_out_of_range', `参数 "${key}" 必须符合步长 ${entry.step}。`);
    }
  }
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    if (type === 'string' || type === 'long-text') return '';
    throw codedError('invalid_parameter_value', `参数 "${key}" 不能为空。`);
  }
  if (type === 'integer' || type === 'seed') {
    const value = rawValue;
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      throw codedError('invalid_parameter_value', `参数 "${key}" 必须是整数。`);
    }
    if (type === 'seed' && (value < 0 || value > 2_147_483_647)) {
      throw codedError('invalid_parameter_value', `参数 "${key}" 必须在 0 到 2147483647 之间。`);
    }
    if (entry.minimum !== undefined && value < entry.minimum) throw codedError('parameter_out_of_range', `参数 "${key}" 不能小于 ${entry.minimum}。`);
    if (entry.maximum !== undefined && value > entry.maximum) throw codedError('parameter_out_of_range', `参数 "${key}" 不能大于 ${entry.maximum}。`);
    return value;
  }
  if (type === 'number') {
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
      throw codedError('invalid_parameter_value', `参数 "${key}" 必须是有限数字。`);
    }
    if (entry.minimum !== undefined && rawValue < entry.minimum) throw codedError('parameter_out_of_range', `参数 "${key}" 不能小于 ${entry.minimum}。`);
    if (entry.maximum !== undefined && rawValue > entry.maximum) throw codedError('parameter_out_of_range', `参数 "${key}" 不能大于 ${entry.maximum}。`);
    return rawValue;
  }
  if (type === 'boolean') {
    if (typeof rawValue !== 'boolean') throw codedError('invalid_parameter_value', `参数 "${key}" 必须是布尔值。`);
    return rawValue;
  }
  if (type === 'enum') {
    if (typeof rawValue !== 'string') throw codedError('invalid_parameter_value', `参数 "${key}" 必须是字符串枚举值。`);
    if (entry.enum?.length && !entry.enum.includes(rawValue)) {
      throw codedError('parameter_not_in_enum', `参数 "${key}" 的值不在允许的枚举列表中。`);
    }
    return rawValue;
  }
  // string / long-text / model
  if (typeof rawValue !== 'string') throw codedError('invalid_parameter_value', `参数 "${key}" 必须是字符串。`);
  return rawValue;
}

function inferType(defaultValue: unknown): string {
  if (typeof defaultValue === 'number') return Number.isInteger(defaultValue) ? 'integer' : 'number';
  if (typeof defaultValue === 'boolean') return 'boolean';
  return 'string';
}

/** 组合约束：maxPixels 与合法尺寸组合（规划 §8.2）。尺寸 preset 只是快捷方式，不是权威边界。 */
export function validateCombinedConstraints(
  editorConfig: GenerationEditorConfig | null,
  values: Record<string, unknown>,
): void {
  if (!editorConfig) return;
  const width = values.width;
  const height = values.height;
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height)) return;
  const allowedSizes = editorConfig.constraints.allowedSizes;
  if (allowedSizes?.length && !allowedSizes.some((size) => size.width === width && size.height === height)) {
    throw codedError('invalid_size_combination', `尺寸 ${width}x${height} 不在该工作流允许的画幅组合中。`);
  }
  const maxPixels = editorConfig.constraints.maxPixels;
  if (maxPixels && width * height > maxPixels) {
    throw codedError('invalid_size_combination', `画幅像素总数 ${width * height} 超过工作流限制 ${maxPixels}。`);
  }
}

/** strict 模式下的必填检查：schema 声明 required 且非固定字段的值缺失/为空即拒绝。 */
export function validateRequiredValues(
  inputSchema: InputSchemaMap,
  editorConfig: GenerationEditorConfig | null,
  values: Record<string, unknown>,
): void {
  for (const [key, entry] of Object.entries(inputSchema)) {
    if (entry.required !== true) continue;
    if (editorConfig?.fields[key]?.section === 'fixed') continue;
    const value = values[key];
    if (value === undefined || value === null || value === '') {
      throw codedError('missing_required_parameter', `缺少必填参数 "${editorConfig?.fields[key]?.label ?? key}"。`);
    }
  }
}

/** 模型选择校验：允许列表 + 当前库存。过期缓存由调用方刷新后重试一次。 */
export function validateModelSelection(
  editorConfig: GenerationEditorConfig | null,
  values: Record<string, unknown>,
  inventory: string[],
): void {
  if (!editorConfig) return;
  for (const [key, field] of Object.entries(editorConfig.fields)) {
    if (field.type !== 'model' && !field.modelCategory) continue;
    const value = values[key];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string') throw codedError('invalid_parameter_value', `模型字段 "${key}" 必须是字符串。`);
    if (field.allowedModels?.length && !field.allowedModels.includes(value)) {
      throw codedError('model_not_allowed', `模型 "${value}" 不在该工作流允许选择的模型列表中。`);
    }
    if (inventory.length && !inventory.includes(value)) {
      throw codedError('model_unavailable', `模型 "${value}" 当前连接的库存中不存在；请刷新模型列表后确认。`);
    }
  }
}

// ── 预设与请求的参数合并 ──

export interface MergedValues {
  values: Record<string, unknown>;
  presetValues: Record<string, unknown>;
}

/**
 * 优先级：工作流默认 → 已选预设 → 本次允许修改的输入；随后统一校验（规划 §8.2）。
 * applyDefaults=false 时跳过工作流默认值注入（旧调用方路径，输入保持原样，
 * 避免改变既有请求哈希）。
 */
export function mergeGenerationValues(
  inputSchema: InputSchemaMap,
  editorConfig: GenerationEditorConfig | null,
  presetValues: Record<string, unknown>,
  userValues: Record<string, unknown>,
  mode: 'strict' | 'lenient',
  options?: { applyDefaults?: boolean },
): MergedValues {
  const defaults: Record<string, unknown> = {};
  if (options?.applyDefaults !== false) {
    for (const [key, entry] of Object.entries(inputSchema)) {
      if (entry.default !== undefined && entry.default !== null && entry.default !== '') {
        defaults[key] = mode === 'strict' ? validateSingleValue(key, entry, entry.default) : entry.default;
      }
    }
  }
  const validatedPreset = validateValuesAgainstSchema(inputSchema, editorConfig, presetValues, { mode, context: 'preset' });
  const validatedUser = validateValuesAgainstSchema(inputSchema, editorConfig, userValues, { mode, context: 'request' });
  const values = { ...defaults, ...validatedPreset, ...validatedUser };
  if (mode === 'strict') {
    validateModelSelection(editorConfig, values, []);
    for (const [key, field] of Object.entries(editorConfig?.fields ?? {})) {
      if (field.type !== 'model' && !field.modelCategory) continue;
      if (editorConfig?.modelSelection !== 'preset-locked' && field.allowIndividualSwitch !== false) continue;
      if (key in validatedUser && validatedUser[key] !== (validatedPreset[key] ?? defaults[key])) {
        throw codedError('model_not_allowed', `模型字段 "${key}" 随预设锁定，不能在本次请求中单独替换。`);
      }
    }
  }
  validateCombinedConstraints(editorConfig, values);
  return { values, presetValues: validatedPreset };
}

// ── 创作中心字段契约投影 ──

const LEGACY_CREATIVE_FIELDS: Array<{ key: string; label: string; type: GenerationFieldType; section: 'basic' | 'advanced'; order: number }> = [
  { key: 'prompt', label: '提示词', type: 'long-text', section: 'basic', order: 1 },
  { key: 'negativePrompt', label: '反向提示词', type: 'long-text', section: 'basic', order: 2 },
  { key: 'width', label: '宽度', type: 'integer', section: 'basic', order: 3 },
  { key: 'height', label: '高度', type: 'integer', section: 'basic', order: 4 },
  { key: 'steps', label: '步数', type: 'integer', section: 'advanced', order: 10 },
  { key: 'seed', label: '种子', type: 'seed', section: 'basic', order: 6 },
  { key: 'cfg', label: 'CFG', type: 'number', section: 'advanced', order: 11 },
  { key: 'denoise', label: '重绘强度', type: 'number', section: 'advanced', order: 12 },
  { key: 'sampler_name', label: '采样器', type: 'enum', section: 'advanced', order: 13 },
  { key: 'scheduler', label: '调度器', type: 'enum', section: 'advanced', order: 14 },
  { key: 'duration', label: '时长（秒）', type: 'integer', section: 'basic', order: 3 },
  { key: 'aspectRatio', label: '画幅比例', type: 'enum', section: 'basic', order: 5 },
];

/**
 * 服务端字段契约：客户端可调整的字段以此投影为准，不信任前端本地判断（规划 §10.2）。
 * V2 读取编辑器配置；V1 回退到既有创作中心固定字段集。
 */
export function projectFieldContracts(
  inputSchema: InputSchemaMap,
  editorConfig: GenerationEditorConfig | null,
): GenerationFieldContract[] {
  if (editorConfig && Object.keys(editorConfig.fields).length) {
    const contracts: GenerationFieldContract[] = [];
    for (const field of Object.values(editorConfig.fields)) {
      if (field.section === 'fixed') continue;
      const entry = inputSchema[field.key] ?? {};
      contracts.push({
        key: field.key,
        label: field.label,
        description: field.description,
        type: (field.type as GenerationFieldType | undefined) ?? inferContractType(entry),
        section: field.section,
        order: field.order,
        defaultValue: entry.default ?? null,
        ...(entry.minimum !== undefined ? { minimum: entry.minimum } : {}),
        ...(entry.maximum !== undefined ? { maximum: entry.maximum } : {}),
        ...(entry.step !== undefined ? { step: entry.step } : {}),
        ...(entry.enum?.length ? { enumValues: entry.enum } : {}),
        required: entry.required === true || field.key === 'prompt',
        ...(field.modelCategory ? { modelCategory: field.modelCategory } : {}),
      });
    }
    return contracts.sort((left, right) => left.order - right.order);
  }
  const contracts: GenerationFieldContract[] = [];
  for (const legacy of LEGACY_CREATIVE_FIELDS) {
    const entry = inputSchema[legacy.key];
    if (!entry && !['prompt', 'seed'].includes(legacy.key)) continue;
    contracts.push({
      key: legacy.key,
      label: legacy.label,
      description: entry?.description ?? null,
      type: legacy.type,
      section: legacy.section,
      order: legacy.order,
      defaultValue: entry?.default ?? null,
      ...(entry?.minimum !== undefined ? { minimum: entry.minimum } : {}),
      ...(entry?.maximum !== undefined ? { maximum: entry.maximum } : {}),
      ...(entry?.step !== undefined ? { step: entry.step } : {}),
      ...(entry?.enum?.length ? { enumValues: entry.enum } : {}),
      required: legacy.key === 'prompt',
    });
  }
  return contracts;
}

function inferContractType(entry: SchemaEntry): GenerationFieldType {
  switch (entry.type) {
    case 'integer': return 'integer';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'enum': return 'enum';
    default: return 'text';
  }
}
