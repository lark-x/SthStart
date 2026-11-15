import type { GenerationEditorConfig } from '@sthstart/contracts';
import { parityContentHash, type ParityWorkflowBundle } from './parity-workflows.js';

/**
 * MOSS-Image 故事配图工作流（DEV-024）。
 *
 * 来源是 ComfyUI 官方模板 image_moss_image_t2i（v0.45.2 起才有 moss_image CLIP 类型）。
 * 与模板的差异只有一处：去掉模板里 9B 文本扩展（TextGenerate）子图，改为直接编码服务端
 * 已经写好的英文画面描述。这样 12GB 显存下不会再多跑一次大模型，且提示词事实完全由
 * 服务端组装、可审计；模板自带的 prompt upsampler 会改写事实，不能用于故事配图。
 */

export const MOSS_WORKFLOW_ID = 'moss-image-story';
export const MOSS_PURPOSE = 'story_world_image';

export const MOSS_DIFFUSION_MODEL = 'moss_image_base_int8_convrot.safetensors';
export const MOSS_TEXT_ENCODER = 'qwen3.5_9b_int8_convrot.safetensors';
export const MOSS_VAE = 'flux2-vae_small.safetensors';

/** 官方模板默认负向词；故事配图另有自己的中文负向词，这里只作为新工作流初值。 */
export const MOSS_NEGATIVE_PROMPT = 'nsfw, worst quality, bad anatomy, watermark, jpeg artifact, blurry, deformed';

const MAX_PIXELS = 1024 * 1024;
const DIMENSION_MIN = 512;
const DIMENSION_MAX = 1536;
const DIMENSION_STEP = 16;

export function buildMossImageWorkflow(): ParityWorkflowBundle {
  const definition: Record<string, unknown> = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: MOSS_DIFFUSION_MODEL, weight_dtype: 'default' } },
    // moss_image 是本模型专用文本编码器类型，不能用 qwen_image 或默认类型加载。
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: MOSS_TEXT_ENCODER, type: 'moss_image', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: MOSS_VAE } },
    '6': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: '' } },
    '7': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: MOSS_NEGATIVE_PROMPT } },
    // MOSS 用 Flux 2 的 16 通道压缩 VAE 潜空间，必须使用 EmptyFlux2LatentImage。
    '8': { class_type: 'EmptyFlux2LatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '9': { class_type: 'KSampler', inputs: {
      model: ['1', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['8', 0],
      seed: 0, steps: 25, cfg: 2.5, sampler_name: 'er_sde', scheduler: 'simple', denoise: 1,
    } },
    '10': { class_type: 'VAEDecode', inputs: { samples: ['9', 0], vae: ['3', 0] } },
    '11': { class_type: 'SaveImage', inputs: { images: ['10', 0], filename_prefix: 'sthstart/moss_story' } },
  };

  const inputSchema: Record<string, unknown> = {
    prompt: { semantic: 'prompt', type: 'string', required: true },
    negativePrompt: { semantic: 'negative_prompt', type: 'string', default: MOSS_NEGATIVE_PROMPT },
    unet_name: { semantic: 'unet', type: 'model', default: MOSS_DIFFUSION_MODEL },
    clip_name: { semantic: 'clip', type: 'model', default: MOSS_TEXT_ENCODER },
    vae_name: { semantic: 'vae', type: 'model', default: MOSS_VAE },
    seed: { semantic: 'seed', type: 'seed', minimum: 0, maximum: 2147483647 },
    width: { semantic: 'width', type: 'integer', minimum: DIMENSION_MIN, maximum: DIMENSION_MAX, step: DIMENSION_STEP, default: 1024 },
    height: { semantic: 'height', type: 'integer', minimum: DIMENSION_MIN, maximum: DIMENSION_MAX, step: DIMENSION_STEP, default: 1024 },
    steps: { semantic: 'steps', type: 'integer', minimum: 8, maximum: 50, default: 25 },
    cfg: { semantic: 'cfg', type: 'number', minimum: 0, maximum: 8, default: 2.5 },
    sampler_name: { semantic: 'sampler_name', type: 'enum', enum: ['er_sde', 'euler', 'euler_ancestral'], default: 'er_sde' },
    scheduler: { semantic: 'scheduler', type: 'enum', enum: ['simple', 'beta', 'normal'], default: 'simple' },
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
      unet_name: { key: 'unet_name', label: 'MOSS 扩散模型', description: null, section: 'advanced', order: 5,
        type: 'model', modelCategory: 'unet', allowedModels: [MOSS_DIFFUSION_MODEL], allowIndividualSwitch: false },
      clip_name: { key: 'clip_name', label: 'MOSS 文本编码器', description: null, section: 'advanced', order: 6,
        type: 'model', modelCategory: 'clip', allowedModels: [MOSS_TEXT_ENCODER], allowIndividualSwitch: false },
      vae_name: { key: 'vae_name', label: 'VAE 模型', description: null, section: 'advanced', order: 7,
        type: 'model', modelCategory: 'vae', allowedModels: [MOSS_VAE], allowIndividualSwitch: false },
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
    // MOSS 训练语料是英文长描述，中文会退化为噪声；故事配图在提交前会先改写为英文。
    promptLanguage: 'en',
    sizePresets: [
      { label: '方形 · 1024×1024', width: 1024, height: 1024 },
      { label: '横版 3:2 · 1216×832', width: 1216, height: 832 },
      { label: '竖版 2:3 · 832×1216', width: 832, height: 1216 },
    ],
    constraints: { maxPixels: MAX_PIXELS },
  };

  const bundle: Omit<ParityWorkflowBundle, 'contentHash'> = {
    id: MOSS_WORKFLOW_ID,
    name: 'MOSS-Image · 故事配图',
    description: '官方 MOSS-Image 文生图模板转为 API 图；去掉 9B 文本扩展节点，直接编码服务端英文描述。',
    engineKind: 'comfyui',
    category: 'image',
    definition,
    inputSchema,
    nodeBindings,
    outputDeclarations: ['11'],
    outputMediaTypes: ['image/png'],
    inputCapabilities: {},
    editorConfig,
    presets: [],
  };
  return { ...bundle, contentHash: parityContentHash(bundle) };
}
