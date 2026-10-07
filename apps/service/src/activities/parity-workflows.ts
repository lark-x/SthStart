import { createHash } from 'node:crypto';
import type { GenerationEditorConfig } from '@sthstart/contracts';

/**
 * 邻舍对齐工作流族。
 *
 * 固定方案（计划 §6.1）：服务端组装完整提示词，工作流只编码与生成。
 * 因此正／负提示词语义字段直接绑定到 CLIPTextEncode.text，
 * 定义里没有任何画师／质量串的 StringConcatenate 分支。
 *
 * 参数取值来自邻舍模板（`upstream/linshe/agent-core/src/services/workflowTemplates.js`）：
 * - Base：anima_baseV10.safetensors，31 步，CFG 5，er_sde / beta
 * - Turbo：anima_turboV10.safetensors，12 步，CFG 1，er_sde / beta
 * 文本编码器 anima_baseV10_txt.safetensors（type qwen_image），VAE qwen_image_vae.safetensors。
 */

export const PARITY_TEXT_WORKFLOW_ID = 'anima-activity-linshe-parity';
export const PARITY_HIRES_WORKFLOW_ID = 'anima-activity-hires-basic';
/** 细化专用生成用途（计划 §12.1）。 */
export const PARITY_HIRES_PURPOSE = 'activity_image_upscale';

export const PARITY_BASE_UNET = 'anima_baseV10.safetensors';
export const PARITY_TURBO_UNET = 'anima_turboV10.safetensors';
export const PARITY_TEXT_ENCODER = 'anima_baseV10_txt.safetensors';
export const PARITY_VAE = 'qwen_image_vae.safetensors';

/** 已核对的邻舍模板负向词快照。不覆盖用户既有负向词，只作为新画风的初值。 */
export const LINSHE_PARITY_NEGATIVE_PROMPT =
  'score_1, score_2, score_3, bad anatomy, bad proportions, deformed anatomy, deformed face, deformed eyes, '
  + 'multiple fingers, text, watermark, artist name, censor, mosaic, signature, logo, twitter username, '
  + 'patreon username, username, shadows, highlights, strong lighting, dramatic lighting, rim light, '
  + 'backlighting, high contrast, volumetric lighting';

/** 活动画风「邻舍对齐 · Anima」的质量／画师串，只保存一次。 */
export const LINSHE_PARITY_STYLE_PROMPT =
  '@ebora, masterpiece, best quality, score_9, score_8, highres, absurdres, anime screenshot, year 2025';

/** 常用尺寸（计划 §10.2）；1920×1080 显式标注高显存／高耗时，不成为自动默认。 */
export const PARITY_SIZE_PRESETS = [
  { label: '横版 3:2 · 768×512', width: 768, height: 512 },
  { label: '横版 4:3 · 1024×768', width: 1024, height: 768 },
  { label: '横版 16:9 · 1280×720', width: 1280, height: 720 },
  { label: '横版 16:9 · 1920×1080（高显存／高耗时）', width: 1920, height: 1080 },
] as const;

const MAX_PIXELS = 1920 * 1080;
const DIMENSION_MIN = 256;
const DIMENSION_MAX = 2048;
const DIMENSION_STEP = 8;

export interface ParityPresetTemplate {
  templateKey: string;
  name: string;
  description: string;
  values: Record<string, unknown>;
}

export const PARITY_BASE_PRESET: ParityPresetTemplate = {
  templateKey: 'parity-base',
  name: '邻舍对齐 · Base',
  description: '邻舍 Base 模板参数：31 步、CFG 5、er_sde / beta，初始 768×512。',
  values: {
    unet_name: PARITY_BASE_UNET, clip_name: PARITY_TEXT_ENCODER, vae_name: PARITY_VAE,
    steps: 31, cfg: 5, sampler_name: 'er_sde', scheduler: 'beta', width: 768, height: 512,
  },
};

export const PARITY_TURBO_PRESET: ParityPresetTemplate = {
  templateKey: 'parity-turbo',
  name: '邻舍对齐 · Turbo',
  description: '邻舍 Turbo 模板参数：12 步、CFG 1、er_sde / beta，初始 768×512。',
  values: {
    unet_name: PARITY_TURBO_UNET, clip_name: PARITY_TEXT_ENCODER, vae_name: PARITY_VAE,
    steps: 12, cfg: 1, sampler_name: 'er_sde', scheduler: 'beta', width: 768, height: 512,
  },
};

export interface ParityWorkflowBundle {
  id: string;
  name: string;
  description: string;
  engineKind: 'comfyui';
  category: 'image';
  definition: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
  nodeBindings: Record<string, string[]>;
  outputDeclarations: string[];
  outputMediaTypes: string[];
  inputCapabilities: Record<string, unknown>;
  editorConfig: GenerationEditorConfig;
  /** 稳定内容哈希：重复 apply 不创建重复修订，内容变化才需要发布新版本。 */
  contentHash: string;
  presets: ParityPresetTemplate[];
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b, 'en')))
    : item);
}

export interface ParityContentShape {
  definition: unknown;
  inputSchema: unknown;
  nodeBindings: unknown;
  editorConfig: unknown;
  outputDeclarations: unknown;
  outputMediaTypes: unknown;
  inputCapabilities: unknown;
}

/** 稳定内容哈希：重复 apply 不创建重复修订，内容变化才需要显式发布新版本。 */
export function parityContentHash(shape: ParityContentShape): string {
  return createHash('sha256').update(canonical({
    definition: shape.definition,
    inputSchema: shape.inputSchema,
    nodeBindings: shape.nodeBindings,
    editorConfig: shape.editorConfig,
    outputDeclarations: shape.outputDeclarations,
    outputMediaTypes: shape.outputMediaTypes,
    inputCapabilities: shape.inputCapabilities,
  })).digest('hex');
}

/** 纯文生图对齐图：不声明参考图能力，界面据此说明“仅文字描述”。 */
export function buildParityTextWorkflow(): ParityWorkflowBundle {
  const definition: Record<string, unknown> = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: PARITY_BASE_UNET, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: PARITY_TEXT_ENCODER, type: 'qwen_image', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: PARITY_VAE } },
    // 正／负提示词直接落在编码器 text 上：工作流不再拼接任何固定串。
    '6': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: '' } },
    '7': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: LINSHE_PARITY_NEGATIVE_PROMPT } },
    '8': { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 512, batch_size: 1 } },
    '9': { class_type: 'KSampler', inputs: {
      model: ['1', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['8', 0],
      seed: 0, steps: 31, cfg: 5, sampler_name: 'er_sde', scheduler: 'beta', denoise: 1,
    } },
    '10': { class_type: 'VAEDecode', inputs: { samples: ['9', 0], vae: ['3', 0] } },
    '11': { class_type: 'SaveImage', inputs: { images: ['10', 0], filename_prefix: 'sthstart/anima_activity_parity' } },
  };

  const inputSchema: Record<string, unknown> = {
    prompt: { semantic: 'prompt', type: 'string', required: true },
    negativePrompt: { semantic: 'negative_prompt', type: 'string', default: LINSHE_PARITY_NEGATIVE_PROMPT },
    unet_name: { semantic: 'unet', type: 'model', default: PARITY_BASE_UNET },
    clip_name: { semantic: 'clip', type: 'model', default: PARITY_TEXT_ENCODER },
    vae_name: { semantic: 'vae', type: 'model', default: PARITY_VAE },
    seed: { semantic: 'seed', type: 'seed', minimum: 0, maximum: 2147483647 },
    width: { semantic: 'width', type: 'integer', minimum: DIMENSION_MIN, maximum: DIMENSION_MAX, step: DIMENSION_STEP, default: 768 },
    height: { semantic: 'height', type: 'integer', minimum: DIMENSION_MIN, maximum: DIMENSION_MAX, step: DIMENSION_STEP, default: 512 },
    steps: { semantic: 'steps', type: 'integer', minimum: 1, maximum: 60, default: 31 },
    cfg: { semantic: 'cfg', type: 'number', minimum: 0, maximum: 12, default: 5 },
    sampler_name: { semantic: 'sampler_name', type: 'enum', enum: ['er_sde', 'euler', 'euler_ancestral'], default: 'er_sde' },
    scheduler: { semantic: 'scheduler', type: 'enum', enum: ['beta', 'simple', 'normal'], default: 'beta' },
  };

  const nodeBindings: Record<string, string[]> = {
    prompt: ['6', 'inputs', 'text'],
    negativePrompt: ['7', 'inputs', 'text'],
    unet_name: ['1', 'inputs', 'unet_name'],
    clip_name: ['2', 'inputs', 'clip_name'],
    vae_name: ['3', 'inputs', 'vae_name'],
    seed: ['9', 'inputs', 'seed'],
    width: ['8', 'inputs', 'width'],
    height: ['8', 'inputs', 'height'],
    steps: ['9', 'inputs', 'steps'],
    cfg: ['9', 'inputs', 'cfg'],
    sampler_name: ['9', 'inputs', 'sampler_name'],
    scheduler: ['9', 'inputs', 'scheduler'],
  };

  const editorConfig: GenerationEditorConfig = {
    version: 2,
    fields: {
      prompt: { key: 'prompt', label: '画面描述', description: null, section: 'basic', order: 1, type: 'long-text' },
      negativePrompt: { key: 'negativePrompt', label: '负向提示词', description: null, section: 'advanced', order: 2, type: 'long-text' },
      width: { key: 'width', label: '宽度', description: null, section: 'basic', order: 3, type: 'integer' },
      height: { key: 'height', label: '高度', description: null, section: 'basic', order: 4, type: 'integer' },
      unet_name: { key: 'unet_name', label: 'Anima 扩散模型', description: null, section: 'advanced', order: 5,
        type: 'model', modelCategory: 'unet', allowedModels: [PARITY_BASE_UNET, PARITY_TURBO_UNET], allowIndividualSwitch: false },
      clip_name: { key: 'clip_name', label: '文本编码器', description: null, section: 'advanced', order: 6,
        type: 'model', modelCategory: 'clip', allowedModels: [PARITY_TEXT_ENCODER], allowIndividualSwitch: false },
      vae_name: { key: 'vae_name', label: 'VAE 模型', description: null, section: 'advanced', order: 7,
        type: 'model', modelCategory: 'vae', allowedModels: [PARITY_VAE], allowIndividualSwitch: false },
      seed: { key: 'seed', label: '随机种子', description: null, section: 'advanced', order: 8, type: 'seed' },
      steps: { key: 'steps', label: '采样步数', description: null, section: 'advanced', order: 9, type: 'integer' },
      cfg: { key: 'cfg', label: 'CFG', description: null, section: 'advanced', order: 10, type: 'number' },
      sampler_name: { key: 'sampler_name', label: '采样器', description: null, section: 'advanced', order: 11, type: 'enum' },
      scheduler: { key: 'scheduler', label: '调度器', description: null, section: 'advanced', order: 12, type: 'enum' },
    },
    modelSelection: 'preset-locked',
    loraSlots: [],
    activityLoraInjection: { targetNodeId: '9', targetInput: 'model' },
    promptAssembly: 'service-finalized-v1',
    sizePresets: PARITY_SIZE_PRESETS.map((preset) => ({ ...preset })),
    constraints: { maxPixels: MAX_PIXELS },
  };

  const bundle: Omit<ParityWorkflowBundle, 'contentHash'> = {
    id: PARITY_TEXT_WORKFLOW_ID,
    name: '邻舍对齐 · Anima 活动制图',
    description: '服务端组装完整提示词、工作流只编码与生成；画师／质量串由活动画风管理。',
    engineKind: 'comfyui',
    category: 'image',
    definition,
    inputSchema,
    nodeBindings,
    outputDeclarations: ['11'],
    outputMediaTypes: ['image/png'],
    inputCapabilities: {},
    editorConfig,
    presets: [PARITY_BASE_PRESET, PARITY_TURBO_PRESET],
  };
  return { ...bundle, contentHash: parityContentHash(bundle) };
}

/**
 * 基础细化（放大重绘）工作流族：`anima-activity-hires-basic`，purpose=`activity_image_upscale`。
 *
 * 固定图形方案（计划 §12.1／§12.2）：
 *
 * ```text
 * LoadImage
 *   → 白底 alpha 合成（原图有 alpha 时生效）
 *   → ImageScale(lanczos, 计算后的宽高, crop=disabled)
 *   → VAEEncode
 *   → KSampler(原图采样参数，独立 denoise，新的 seed)
 *   → VAEDecode
 *   → SaveImage
 * ```
 *
 * 加载器与 LoRA MODEL 链来自原图冻结配置（执行器把原图的 loader 输入与
 * activityLoras 一起冻结后写回），因此这里给出的是与邻舍模板一致的初值。
 * 正／负提示词直接绑定到 CLIPTextEncode.text：不追加质量串、不优化、不读当前画风。
 *
 * 节点语义说明：ComfyUI 的 `LoadImage` mask 输出是**反 alpha**（`1 - alpha`），
 * `ImageCompositeMasked(destination=白底, source=放大后的原图, mask=该反 alpha)`
 * 会把透明区域合成为白色、保留不透明像素；非透明图 mask 全为 0，逐像素保留原图，
 * 不会产生黑底或变色。所需节点在实例上缺失时由运行时预检明确阻止，不静默跳过 mask。
 */
export function buildParityHiresWorkflow(): Omit<ParityWorkflowBundle, 'presets'> & { presets: ParityPresetTemplate[] } {
  const definition: Record<string, unknown> = {
    // 1：来源图。执行器上传产物后把受控文件名写回 image 输入，用户输入不含本地路径。
    '1': { class_type: 'LoadImage', inputs: { image: '', upload: 'image', upscale_method: 'lanczos' } },
    // 2：白色底图。尺寸必须是**来源图尺寸**（计划 §12.2）：合成是 1:1 贴图，
    // 白底若留在默认 1024×1024，来源只覆盖左上角，其余留白，再被放大成整张白边图。
    '2': { class_type: 'EmptyImage', inputs: { width: 1024, height: 1024, batch_size: 1, color: 16777215 } },
    // 3：白底合成。mask 必须是 LoadImage 反 alpha 的**反转**（计划 §12.2）：
    // LoadImage 的 mask 输出是“透明处为 1”的反 alpha，对不透明图整张为 0；
    // 直接拿来当合成 mask 会保留整张白底，把画面抹成纯白。所以中间必须过 InvertMask。
    '3': { class_type: 'ImageCompositeMasked', inputs: {
      destination: ['2', 0], source: ['1', 0], x: 0, y: 0, resize_source: false, mask: ['14', 0], paste: false,
    } },
    // 4：lanczos 放大到计算尺寸，crop=disabled（不裁剪，保持比例一致）。
    '4': { class_type: 'ImageScale', inputs: {
      image: ['3', 0], upscale_method: 'lanczos', width: 1024, height: 1024, crop: 'disabled',
    } },
    '5': { class_type: 'VAEEncode', inputs: { pixels: ['4', 0], vae: ['8', 0] } },
    // 6／7：正负提示词直接落在编码器 text 上，工作流不拼接任何固定串。
    '6': { class_type: 'CLIPTextEncode', inputs: { clip: ['9', 0], text: '' } },
    '7': { class_type: 'CLIPTextEncode', inputs: { clip: ['9', 0], text: LINSHE_PARITY_NEGATIVE_PROMPT } },
    // 8／9／10：原图冻结的 VAE／UNET／CLIP 加载输入。
    '8': { class_type: 'VAELoader', inputs: { vae_name: PARITY_VAE } },
    '9': { class_type: 'CLIPLoader', inputs: { clip_name: PARITY_TEXT_ENCODER, type: 'qwen_image', device: 'default' } },
    '10': { class_type: 'UNETLoader', inputs: { unet_name: PARITY_BASE_UNET, weight_dtype: 'default' } },
    '11': { class_type: 'KSampler', inputs: {
      model: ['10', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
      seed: 0, steps: 31, cfg: 5, sampler_name: 'er_sde', scheduler: 'beta', denoise: 0.2,
    } },
    '12': { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['8', 0] } },
    '13': { class_type: 'SaveImage', inputs: { images: ['12', 0], filename_prefix: 'sthstart/anima_activity_hires' } },
    // 14：把 LoadImage 的反 alpha 反转回“不透明处为 1”，供白底合成使用。
    '14': { class_type: 'InvertMask', inputs: { mask: ['1', 1] } },
  };

  // 加载器取值只由执行器从原图快照写回；这里不提供模型选择字段，避免把细化接到当前配置上。
  const inputSchema: Record<string, unknown> = {
    positivePrompt: { semantic: 'prompt', type: 'string', default: '' },
    negativePrompt: { semantic: 'negative_prompt', type: 'string', default: LINSHE_PARITY_NEGATIVE_PROMPT },
    width: { semantic: 'width', type: 'integer', minimum: 8, maximum: DIMENSION_MAX, step: 8, default: 1024 },
    height: { semantic: 'height', type: 'integer', minimum: 8, maximum: DIMENSION_MAX, step: 8, default: 1024 },
    // 来源图尺寸：白底合成必须与来源 1:1，否则会留下白边。只由执行器从原图探测结果写回。
    sourceWidth: { semantic: 'source_width', type: 'integer', minimum: 1, maximum: DIMENSION_MAX, step: 1, default: 1024 },
    sourceHeight: { semantic: 'source_height', type: 'integer', minimum: 1, maximum: DIMENSION_MAX, step: 1, default: 1024 },
    seed: { semantic: 'seed', type: 'seed', minimum: 0, maximum: 2147483647 },
    steps: { semantic: 'steps', type: 'integer', minimum: 1, maximum: 60, default: 31 },
    cfg: { semantic: 'cfg', type: 'number', minimum: 0, maximum: 12, default: 5 },
    sampler_name: { semantic: 'sampler_name', type: 'enum', enum: ['er_sde', 'euler', 'euler_ancestral'], default: 'er_sde' },
    scheduler: { semantic: 'scheduler', type: 'enum', enum: ['beta', 'simple', 'normal'], default: 'beta' },
    denoise: { semantic: 'denoise', type: 'number', minimum: 0, maximum: 1, default: 0.2 },
    unet_name: { semantic: 'unet', type: 'model', default: PARITY_BASE_UNET },
    clip_name: { semantic: 'clip', type: 'model', default: PARITY_TEXT_ENCODER },
    vae_name: { semantic: 'vae', type: 'model', default: PARITY_VAE },
  };

  const nodeBindings: Record<string, string[]> = {
    positivePrompt: ['6', 'inputs', 'text'],
    negativePrompt: ['7', 'inputs', 'text'],
    width: ['4', 'inputs', 'width'],
    height: ['4', 'inputs', 'height'],
    sourceWidth: ['2', 'inputs', 'width'],
    sourceHeight: ['2', 'inputs', 'height'],
    seed: ['11', 'inputs', 'seed'],
    steps: ['11', 'inputs', 'steps'],
    cfg: ['11', 'inputs', 'cfg'],
    sampler_name: ['11', 'inputs', 'sampler_name'],
    scheduler: ['11', 'inputs', 'scheduler'],
    denoise: ['11', 'inputs', 'denoise'],
    unet_name: ['10', 'inputs', 'unet_name'],
    clip_name: ['9', 'inputs', 'clip_name'],
    vae_name: ['8', 'inputs', 'vae_name'],
    // init_image 由执行器上传产物后写回 LoadImage.image，用户输入不传 ComfyUI 本地文件名。
    init_image: ['1', 'inputs', 'image'],
  };

  const editorConfig: GenerationEditorConfig = {
    version: 2,
    // 细化弹窗不暴露通用字段编辑器；这里的字段只用于核对实际继承的配置。
    // 注意：section='fixed' 会拒绝任何请求值，而细化必须把冻结的原图取值写回工作流，
    // 因此这些字段一律为 advanced。加载器字段允许单独切换（allowIndividualSwitch=true），
    // 因为它们的取值只能来自来源任务的冻结快照，且仍被 allowedModels 白名单约束。
    fields: {
      positivePrompt: { key: 'positivePrompt', label: '实际正向提示词（来源图）', description: null, section: 'advanced', order: 1, type: 'long-text' },
      negativePrompt: { key: 'negativePrompt', label: '实际负向提示词（来源图）', description: null, section: 'advanced', order: 2, type: 'long-text' },
      width: { key: 'width', label: '输出宽度', description: null, section: 'advanced', order: 3, type: 'integer' },
      height: { key: 'height', label: '输出高度', description: null, section: 'advanced', order: 4, type: 'integer' },
      sourceWidth: { key: 'sourceWidth', label: '来源图宽度（白底尺寸）', description: null, section: 'advanced', order: 14, type: 'integer' },
      sourceHeight: { key: 'sourceHeight', label: '来源图高度（白底尺寸）', description: null, section: 'advanced', order: 15, type: 'integer' },
      seed: { key: 'seed', label: '随机种子', description: null, section: 'advanced', order: 5, type: 'seed' },
      steps: { key: 'steps', label: '采样步数（来源图）', description: null, section: 'advanced', order: 6, type: 'integer' },
      cfg: { key: 'cfg', label: 'CFG（来源图）', description: null, section: 'advanced', order: 7, type: 'number' },
      sampler_name: { key: 'sampler_name', label: '采样器（来源图）', description: null, section: 'advanced', order: 8, type: 'enum' },
      scheduler: { key: 'scheduler', label: '调度器（来源图）', description: null, section: 'advanced', order: 9, type: 'enum' },
      denoise: { key: 'denoise', label: '重绘幅度', description: null, section: 'advanced', order: 10, type: 'number' },
      unet_name: { key: 'unet_name', label: '扩散模型（来源图）', description: null, section: 'advanced', order: 11,
        type: 'model', modelCategory: 'unet', allowedModels: [PARITY_BASE_UNET, PARITY_TURBO_UNET], allowIndividualSwitch: true },
      clip_name: { key: 'clip_name', label: '文本编码器（来源图）', description: null, section: 'advanced', order: 12,
        type: 'model', modelCategory: 'clip', allowedModels: [PARITY_TEXT_ENCODER], allowIndividualSwitch: true },
      vae_name: { key: 'vae_name', label: 'VAE 模型（来源图）', description: null, section: 'advanced', order: 13,
        type: 'model', modelCategory: 'vae', allowedModels: [PARITY_VAE], allowIndividualSwitch: true },
    },
    modelSelection: 'preset-locked',
    loraSlots: [],
    activityLoraInjection: { targetNodeId: '11', targetInput: 'model' },
    promptAssembly: 'service-finalized-v1',
    sizePresets: [],
    constraints: {},
  };

  const bundle: Omit<ParityWorkflowBundle, 'contentHash'> = {
    id: PARITY_HIRES_WORKFLOW_ID,
    name: '邻舍对齐 · Anima 基础细化',
    description: '按原图冻结配置做白底合成与 lanczos 放大重绘；不追加质量串、不优化、不读当前画风。',
    engineKind: 'comfyui',
    category: 'image',
    definition,
    inputSchema,
    nodeBindings,
    outputDeclarations: ['13'],
    outputMediaTypes: ['image/png'],
    // 细化必须拿到来源图；实例缺少所需节点时由预检阻止，不静默跳过 mask。
    inputCapabilities: { init_image: { mediaTypes: ['image/png', 'image/jpeg', 'image/webp'], required: true, maxCount: 1, semantic: 'init_image' } },
    editorConfig,
    presets: [],
  };
  return { ...bundle, contentHash: parityContentHash(bundle) };
}

