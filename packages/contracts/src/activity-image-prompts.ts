import { Type, type Static } from '@sinclair/typebox';

export const DEFAULT_ACTIVITY_IMAGE_PROMPT_INSTRUCTIONS = `Rewrite the activity image description as one concise English image prompt, using concrete visual tags and short natural-language phrases.
Order the information as: character count and identity; distinctive appearance and clothing; visible action and expression; shot size and camera composition; location, time and environment; small visual details.
Preserve every specified character, count, appearance detail, action, location, time and camera constraint. For multiple characters, keep each person's appearance and action clearly associated with that person. Do not invent characters, events or visual details absent from the source.
Do not add artist names, quality ratings, score tags or generic style labels: the selected style configuration and workflow add those separately. Do not include dialogue text in the image.
Return one English prompt line only, with no explanation or Markdown.`;

/** tags 模式的系统指令：只返回约定 JSON，禁止画师／质量／LoRA／参数类内容。 */
export const DEFAULT_ACTIVITY_IMAGE_STRUCTURED_INSTRUCTIONS = `You convert an activity image description into a strict JSON object of Danbooru-style tags.
Return JSON only. Do not add explanations, Markdown fences or any text outside the JSON object.
Use exactly this shape:
{"actors":[{"actorId":"<given actorId>","identity":["hu_tao (genshin impact)"],"appearance":["long brown hair","red eyes"],"clothing":["black hat"],"action":["standing"],"expression":["smile"]}],"camera":["full body"],"scene":["night"],"details":["cherry blossoms"],"naturalLanguage":"short sentence that is required to keep the composition readable"}
Rules:
- Only use actorId values given in the input. Never invent a character, an event or a visual detail that the source does not state.
- Keep appearance, clothing, action, location, time and composition exactly as described; keep each character's own attributes inside that character's block.
- Do not output dialogue, artist names, quality or score tags, LoRA trigger words, URLs or generation parameters.
- The suggested vocabulary is optional wording, not a checklist: add only what the source supports.
- Use short lowercase tags separated by spaces or underscores. Put anything that cannot be expressed as a tag into naturalLanguage.`;

export const DEFAULT_ACTIVITY_NEGATIVE_PROMPT =
  'score_1, score_2, score_3, bad anatomy, bad hands, missing fingers, extra fingers, multiple fingers, deformed face, deformed eyes, blurry, text, watermark, lowres, bad proportions, bad limbs';

export const ActivityImagePromptOutputFormatSchema = Type.Union([Type.Literal('prose'), Type.Literal('tags')]);
export type ActivityImagePromptOutputFormat = Static<typeof ActivityImagePromptOutputFormatSchema>;

export const ActivityImagePromptKnowledgeModeSchema = Type.Union([Type.Literal('none'), Type.Literal('keyword')]);
export type ActivityImagePromptKnowledgeMode = Static<typeof ActivityImagePromptKnowledgeModeSchema>;

export const ActivityImagePromptPolicySchema = Type.Object({
  workflowId: Type.String(),
  workflowVersion: Type.Integer({ minimum: 1 }),
  revision: Type.Integer({ minimum: 0 }),
  enabled: Type.Boolean(),
  instructions: Type.String(),
  positiveSuffix: Type.String(),
  negativePrompt: Type.String(),
  /** 旧记录没有该列，读取时补 prose。 */
  outputFormat: ActivityImagePromptOutputFormatSchema,
  /** 旧记录没有该列，读取时补 none。 */
  knowledgeMode: ActivityImagePromptKnowledgeModeSchema,
  createdAt: Type.String(),
});
export type ActivityImagePromptPolicy = Static<typeof ActivityImagePromptPolicySchema>;

export const ActivityImagePromptOptimizerSchema = Type.Object({
  ready: Type.Boolean(),
  profileName: Type.Union([Type.String(), Type.Null()]),
  model: Type.Union([Type.String(), Type.Null()]),
  message: Type.Union([Type.String(), Type.Null()]),
});
export type ActivityImagePromptOptimizer = Static<typeof ActivityImagePromptOptimizerSchema>;

export const ActivityImagePromptPolicyResponseSchema = Type.Object({
  policy: Type.Union([ActivityImagePromptPolicySchema, Type.Null()]),
  optimizer: ActivityImagePromptOptimizerSchema,
  /** 当前工作流是否声明了服务端组装方式；画风字段在此时由活动画风管理。 */
  serviceFinalizedAssembly: Type.Boolean(),
});
export type ActivityImagePromptPolicyResponse = Static<typeof ActivityImagePromptPolicyResponseSchema>;

export const SaveActivityImagePromptPolicyRequestSchema = Type.Object({
  workflowId: Type.String({ minLength: 1 }),
  workflowVersion: Type.Integer({ minimum: 1 }),
  revision: Type.Integer({ minimum: 0 }),
  enabled: Type.Boolean(),
  instructions: Type.String({ maxLength: 20000 }),
  positiveSuffix: Type.String({ maxLength: 4000 }),
  negativePrompt: Type.String({ maxLength: 4000 }),
  // 旧请求可以省略：读取与保存都规范化为 prose / none。
  outputFormat: Type.Optional(ActivityImagePromptOutputFormatSchema),
  knowledgeMode: Type.Optional(ActivityImagePromptKnowledgeModeSchema),
});
export type SaveActivityImagePromptPolicyRequest = Static<typeof SaveActivityImagePromptPolicyRequestSchema>;

// ── 结构化模型输出 ──

const strict = { additionalProperties: false } as const;
const tags = () => Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 16 });

export const StructuredVisualPromptSchema = Type.Object({
  actors: Type.Array(Type.Object({
    actorId: Type.String({ minLength: 1, maxLength: 160 }),
    identity: tags(), appearance: tags(), clothing: tags(),
    action: tags(), expression: tags(),
  }, strict), { maxItems: 8 }),
  camera: tags(), scene: tags(), details: tags(),
  naturalLanguage: Type.String({ maxLength: 2000 }),
}, strict);
export type StructuredVisualPrompt = Static<typeof StructuredVisualPromptSchema>;

// ── 编译诊断 ──

export const ActivityImageCompilationPhaseSchema = Type.Union([
  Type.Literal('source_preview'), Type.Literal('optimized'),
]);
export type ActivityImageCompilationPhase = Static<typeof ActivityImageCompilationPhaseSchema>;

export const KnowledgeHitSchema = Type.Object({
  knowledgeId: Type.String(),
  /** null 表示全局词条，不属于某个角色。 */
  actorId: Type.Union([Type.String(), Type.Null()]),
  tags: Type.Array(Type.String()),
  score: Type.Number(),
  reason: Type.String(),
}, strict);
export type KnowledgeHit = Static<typeof KnowledgeHitSchema>;

export const RemovedTagDiagnosticSchema = Type.Object({
  scope: Type.String(),
  tag: Type.String(),
  reason: Type.String(),
}, strict);
export type RemovedTagDiagnostic = Static<typeof RemovedTagDiagnosticSchema>;

export const ActivityImageCompilationDiagnosticsSchema = Type.Object({
  compilerVersion: Type.String(),
  outputFormat: ActivityImagePromptOutputFormatSchema,
  knowledgeMode: ActivityImagePromptKnowledgeModeSchema,
  knowledgeVersion: Type.Union([Type.String(), Type.Null()]),
  phase: ActivityImageCompilationPhaseSchema,
  structuredPrompt: Type.Union([StructuredVisualPromptSchema, Type.Null()]),
  knowledgeHits: Type.Array(KnowledgeHitSchema),
  removedTags: Type.Array(RemovedTagDiagnosticSchema),
  warnings: Type.Array(Type.String()),
  styleSource: Type.String(),
  policyRevision: Type.Integer({ minimum: 0 }),
  sourceFingerprint: Type.String(),
  finalPositive: Type.Union([Type.String(), Type.Null()]),
  finalNegative: Type.Union([Type.String(), Type.Null()]),
  finalPromptHash: Type.Union([Type.String(), Type.Null()]),
}, strict);
export type ActivityImageCompilationDiagnostics = Static<typeof ActivityImageCompilationDiagnosticsSchema>;
