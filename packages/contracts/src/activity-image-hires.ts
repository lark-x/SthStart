import { Type, type Static } from '@sinclair/typebox';
import { StudioTargetSchema, StudioVersionContextSchema } from './activity-studio-jobs.js';

/**
 * 阶段 4A／4B／4C：基础细化（放大重绘）的对外契约。
 *
 * 边界（计划 §11.1）：
 * - 请求只接受业务标识（活动内的目标定位、来源 artifactId、尺寸、denoise、seed 与幂等键）。
 * - 不接受服务器路径、任意 URL、输入文件名、工作流图、模型密钥或调用方提供的实际配置快照；
 *   未知字段一律拒绝。
 * - 实际继承的配置（加载器、采样参数、LoRA、提示词）只出现在**响应**里，由服务端从原图执行
 *   快照冻结后回显，不能由浏览器上传。
 */

const id = () => Type.String({ minLength: 1, maxLength: 160 });
const strict = { additionalProperties: false } as const;
const nullableId = () => Type.Union([id(), Type.Null()]);
/** 项目现有安全 seed 范围。 */
const seed = () => Type.Integer({ minimum: 0, maximum: 2_147_483_647 });

/** 细化最长边选项：整数 512..2048，默认 2000 由界面填写。 */
export const HIRES_MAX_SIZE_MIN = 512;
export const HIRES_MAX_SIZE_MAX = 2048;
export const HIRES_MAX_SIZE_DEFAULT = 2000;
export const HIRES_DENOISE_MIN = 0.05;
export const HIRES_DENOISE_MAX = 0.35;
export const HIRES_DENOISE_DEFAULT = 0.2;

export const HiresPreviewRequestSchema = Type.Object({
  versions: StudioVersionContextSchema,
  target: StudioTargetSchema,
  sourceArtifactId: id(),
  maxSize: Type.Optional(Type.Integer({ minimum: HIRES_MAX_SIZE_MIN, maximum: HIRES_MAX_SIZE_MAX, default: HIRES_MAX_SIZE_DEFAULT })),
  denoise: Type.Optional(Type.Number({ minimum: HIRES_DENOISE_MIN, maximum: HIRES_DENOISE_MAX, default: HIRES_DENOISE_DEFAULT })),
  seed: Type.Optional(seed()),
}, strict);
export type HiresPreviewRequest = Static<typeof HiresPreviewRequestSchema>;

/** 提交必须回传预览 seed 与 planHash；服务端不重新随机 seed 来“修正”不一致。 */
export const HiresSubmitRequestSchema = Type.Object({
  versions: StudioVersionContextSchema,
  target: StudioTargetSchema,
  sourceArtifactId: id(),
  maxSize: Type.Optional(Type.Integer({ minimum: HIRES_MAX_SIZE_MIN, maximum: HIRES_MAX_SIZE_MAX, default: HIRES_MAX_SIZE_DEFAULT })),
  denoise: Type.Optional(Type.Number({ minimum: HIRES_DENOISE_MIN, maximum: HIRES_DENOISE_MAX, default: HIRES_DENOISE_DEFAULT })),
  seed: seed(),
  planHash: id(),
  idempotencyKey: id(),
}, strict);
export type HiresSubmitRequest = Static<typeof HiresSubmitRequestSchema>;

export const HiresLoraSchema = Type.Object({
  model: Type.String(), strength: Type.Number(), triggerWord: Type.String(), enabled: Type.Boolean(),
}, strict);
export type HiresLora = Static<typeof HiresLoraSchema>;

export const HiresSamplerSchema = Type.Object({
  steps: Type.Integer({ minimum: 1 }), cfg: Type.Number({ minimum: 0 }),
  samplerName: Type.String(), scheduler: Type.String(), denoise: Type.Number({ minimum: 0, maximum: 1 }),
}, strict);
export type HiresSampler = Static<typeof HiresSamplerSchema>;

/** 原图冻结的实际模型／编码器／VAE 加载输入（只回显，不接受上传）。 */
export const HiresLoadersSchema = Type.Object({
  unetName: Type.Union([Type.String(), Type.Null()]),
  clipName: Type.Union([Type.String(), Type.Null()]),
  vaeName: Type.Union([Type.String(), Type.Null()]),
}, strict);
export type HiresLoaders = Static<typeof HiresLoadersSchema>;

export const HiresPreviewResponseSchema = Type.Object({
  canSubmit: Type.Boolean(),
  issues: Type.Array(Type.String()),
  sourceArtifactId: id(),
  sourceGenerationTaskId: id(),
  sourceCallId: nullableId(),
  sourceFingerprint: id(),
  sourceWidth: Type.Integer({ minimum: 1 }),
  sourceHeight: Type.Integer({ minimum: 1 }),
  outputWidth: Type.Integer({ minimum: 8 }),
  outputHeight: Type.Integer({ minimum: 8 }),
  maxSize: Type.Integer({ minimum: HIRES_MAX_SIZE_MIN, maximum: HIRES_MAX_SIZE_MAX }),
  denoise: Type.Number({ minimum: HIRES_DENOISE_MIN, maximum: HIRES_DENOISE_MAX }),
  seed: seed(),
  loaders: HiresLoadersSchema,
  sampler: HiresSamplerSchema,
  positivePrompt: Type.String(),
  negativePrompt: Type.String(),
  loras: Type.Array(HiresLoraSchema),
  workflowId: id(),
  workflowVersion: Type.Integer({ minimum: 1 }),
  engineId: id(),
  planHash: id(),
  /** 来源图带 alpha 时提示：结果是不透明新图，不重新抠图。 */
  transparencyHint: Type.Union([Type.String(), Type.Null()]),
  /** 来源描述（来源指纹）已变化：只警告，不自动采纳，也不写回。 */
  sourceChanged: Type.Boolean(),
}, strict);
export type HiresPreviewResponse = Static<typeof HiresPreviewResponseSchema>;
