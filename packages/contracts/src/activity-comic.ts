import { Type, type Static } from '@sinclair/typebox';
import { SceneBeatRenderSettingsSchema } from './activities.js';
import { BeatRenderParameterFieldSchema } from './ai-calls.js';
import { ImageOperationMetadataSchema } from './activity-image-operations.js';

export const ComicTemplateSchema = Type.Union([
  Type.Literal('single'), Type.Literal('duo'), Type.Literal('trio'), Type.Literal('quad'),
]);
export type ComicTemplate = Static<typeof ComicTemplateSchema>;

export const ComicShotSizeSchema = Type.Union([
  Type.Literal('wide'), Type.Literal('medium'), Type.Literal('closeup'), Type.Literal('detail'),
]);
export type ComicShotSize = Static<typeof ComicShotSizeSchema>;

export const ComicRectSchema = Type.Object({
  x: Type.Number(), y: Type.Number(), width: Type.Number({ exclusiveMinimum: 0 }), height: Type.Number({ exclusiveMinimum: 0 }),
});
export type ComicRect = Static<typeof ComicRectSchema>;

export const ComicCropSchema = Type.Object({
  focalX: Type.Number({ minimum: 0, maximum: 1 }),
  focalY: Type.Number({ minimum: 0, maximum: 1 }),
  zoom: Type.Number({ minimum: 1, maximum: 3 }),
});
export type ComicCrop = Static<typeof ComicCropSchema>;

export const ComicBubbleKindSchema = Type.Union([
  Type.Literal('speech'), Type.Literal('caption'), Type.Literal('emphasis'),
]);

export const ComicBubbleSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  kind: ComicBubbleKindSchema,
  speakerActorId: Type.Union([Type.String(), Type.Null()]),
  text: Type.String({ maxLength: 300 }),
  rect: ComicRectSchema,
  tail: Type.Union([Type.Object({ x: Type.Number({ minimum: 0, maximum: 1 }), y: Type.Number({ minimum: 0, maximum: 1 }) }), Type.Null()]),
  fontSize: Type.Integer({ minimum: 24, maximum: 48 }),
});
export type ComicBubble = Static<typeof ComicBubbleSchema>;

export const ComicPresentationSchema = Type.Object({
  camera: Type.Union([Type.Literal('none'), Type.Literal('push_in'), Type.Literal('pan_left'), Type.Literal('pan_right')]),
  impact: Type.Union([Type.Literal('none'), Type.Literal('shake'), Type.Literal('flash')]),
  holdMs: Type.Union([Type.Integer({ minimum: 500, maximum: 30_000 }), Type.Null()]),
});
export type ComicPresentation = Static<typeof ComicPresentationSchema>;

export const ComicSelectedImageSchema = Type.Object({
  artifactId: Type.String({ minLength: 1 }),
  origin: Type.Union([Type.Literal('comic_render'), Type.Literal('beat_history')]),
  renderJobId: Type.Union([Type.String(), Type.Null()]),
  sourceFingerprint: Type.Union([Type.String(), Type.Null()]),
});
export type ComicSelectedImage = Static<typeof ComicSelectedImageSchema>;

export const ComicPanelSourceSchema = Type.Object({
  stageId: Type.String({ minLength: 1 }),
  sceneId: Type.String({ minLength: 1 }),
  beatIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 16 }),
});

export const ComicPanelSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  source: ComicPanelSourceSchema,
  actorIds: Type.Array(Type.String(), { maxItems: 8 }),
  shotSize: ComicShotSizeSchema,
  visualDescription: Type.String({ maxLength: 8_000 }),
  composition: Type.String({ maxLength: 4_000 }),
  textSafeArea: Type.Union([Type.Literal('none'), Type.Literal('top_left'), Type.Literal('top_right'), Type.Literal('bottom')]),
  selectedImage: Type.Union([ComicSelectedImageSchema, Type.Null()]),
  crop: ComicCropSchema,
  bubbles: Type.Array(ComicBubbleSchema, { maxItems: 6 }),
  presentation: ComicPresentationSchema,
  renderSettings: SceneBeatRenderSettingsSchema,
});
export type ComicPanel = Static<typeof ComicPanelSchema>;

export const ComicPageSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  title: Type.String({ maxLength: 160 }),
  template: ComicTemplateSchema,
  panelIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 4 }),
});
export type ComicPage = Static<typeof ComicPageSchema>;

export const ComicDocumentSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  contentRevisionId: Type.String({ minLength: 1 }),
  style: Type.Literal('ink-paper-v1'),
  canvas: Type.Object({ width: Type.Literal(1920), height: Type.Literal(1080) }),
  pages: Type.Array(ComicPageSchema, { maxItems: 20 }),
  panels: Type.Array(ComicPanelSchema, { maxItems: 80 }),
});
export type ComicDocument = Static<typeof ComicDocumentSchema>;

export const ComicRevisionSchema = Type.Object({
  id: Type.String(), activityId: Type.String(), sourceDraftVersion: Type.Integer({ minimum: 1 }),
  document: ComicDocumentSchema, documentHash: Type.String(), createdAt: Type.String({ minLength: 1 }),
});
export type ComicRevision = Static<typeof ComicRevisionSchema>;

export const ComicDraftSchema = Type.Object({
  activityId: Type.String(), draftVersion: Type.Integer({ minimum: 1 }),
  baseRevisionId: Type.Union([Type.String(), Type.Null()]), document: ComicDocumentSchema,
  updatedAt: Type.String({ minLength: 1 }),
});
export type ComicDraft = Static<typeof ComicDraftSchema>;

export const ComicJobKindSchema = Type.Union([Type.Literal('storyboard'), Type.Literal('render')]);
export const ComicJobStatusSchema = Type.Union([
  Type.Literal('queued'), Type.Literal('preparing'), Type.Literal('running'), Type.Literal('succeeded'),
  Type.Literal('failed'), Type.Literal('interrupted'), Type.Literal('unknown'),
]);
export const ComicJobSchema = Type.Object({
  id: Type.String(), activityId: Type.String(), kind: ComicJobKindSchema,
  panelId: Type.Union([Type.String(), Type.Null()]), status: ComicJobStatusSchema,
  idempotencyKey: Type.String(), input: Type.Record(Type.String(), Type.Unknown()),
  result: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  generationTaskId: Type.Union([Type.String(), Type.Null()]), traceId: Type.String(), callId: Type.Union([Type.String(), Type.Null()]),
  errorCode: Type.Union([Type.String(), Type.Null()]), errorMessage: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ minLength: 1 }), updatedAt: Type.String({ minLength: 1 }),
});
export type ComicJob = Static<typeof ComicJobSchema>;

export const ComicHistoryImageSchema = Type.Object({
  artifactId: Type.String(), origin: Type.Union([Type.Literal('comic_render'), Type.Literal('beat_history')]), renderJobId: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ minLength: 1 }), available: Type.Boolean(),
  unavailableReason: Type.Union([Type.String(), Type.Null()]), current: Type.Boolean(), sourceChanged: Type.Boolean(),
  sourceFingerprint: Type.Union([Type.String(), Type.Null()]),
  callId: Type.Union([Type.String(), Type.Null()]), previewUrl: Type.Union([Type.String(), Type.Null()]),
  imageOperation: Type.Optional(ImageOperationMetadataSchema),
});
export type ComicHistoryImage = Static<typeof ComicHistoryImageSchema>;

export const ComicJobPageSchema = Type.Object({ items: Type.Array(ComicJobSchema), nextCursor: Type.Union([Type.String(), Type.Null()]) });
export type ComicJobPage = Static<typeof ComicJobPageSchema>;
export const ComicJobResponseSchema = Type.Object({ job: ComicJobSchema });
export const ComicHistoryPageSchema = Type.Object({
  images: Type.Array(ComicHistoryImageSchema), jobs: Type.Array(ComicJobSchema), nextCursor: Type.Union([Type.String(), Type.Null()]),
});
export type ComicHistoryPage = Static<typeof ComicHistoryPageSchema>;

export const ComicDraftResponseSchema = Type.Object({ draft: Type.Union([ComicDraftSchema, Type.Null()]) });
export type ComicDraftResponse = Static<typeof ComicDraftResponseSchema>;
export const CreateComicDraftRequestSchema = Type.Object({ contentRevisionId: Type.String({ minLength: 1 }) });
export type CreateComicDraftRequest = Static<typeof CreateComicDraftRequestSchema>;
export const SaveComicDraftRequestSchema = Type.Object({ expectedDraftVersion: Type.Integer({ minimum: 1 }), document: ComicDocumentSchema });
export type SaveComicDraftRequest = Static<typeof SaveComicDraftRequestSchema>;
export const CreateComicRevisionRequestSchema = Type.Object({ expectedDraftVersion: Type.Integer({ minimum: 1 }) });
export type CreateComicRevisionRequest = Static<typeof CreateComicRevisionRequestSchema>;
export const ComicRevisionResponseSchema = Type.Object({ revision: ComicRevisionSchema });
export const ComicRevisionListSchema = Type.Object({ items: Type.Array(ComicRevisionSchema), nextCursor: Type.Union([Type.String(), Type.Null()]) });

export const ComicStoryboardRequestSchema = Type.Object({
  expectedDraftVersion: Type.Integer({ minimum: 1 }), stageId: Type.String({ minLength: 1 }), sceneId: Type.String({ minLength: 1 }),
  panelCount: Type.Integer({ minimum: 4, maximum: 8 }), instructions: Type.Optional(Type.String({ maxLength: 4_000 })),
  idempotencyKey: Type.String({ minLength: 1, maxLength: 160 }),
});
export type ComicStoryboardRequest = Static<typeof ComicStoryboardRequestSchema>;
export const ComicStoryboardApplyRequestSchema = Type.Object({
  expectedDraftVersion: Type.Integer({ minimum: 1 }), mode: Type.Union([Type.Literal('append'), Type.Literal('replace_scene')]),
});
export type ComicStoryboardApplyRequest = Static<typeof ComicStoryboardApplyRequestSchema>;
export const ComicStoryboardModelOutputSchema = Type.Object({
  panels: Type.Array(Type.Object({
    sourceBeatIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 16 }),
    actorIds: Type.Array(Type.String({ minLength: 1 }), { maxItems: 8 }),
    shotSize: ComicShotSizeSchema,
    visualDescription: Type.String({ minLength: 1, maxLength: 8_000 }),
    composition: Type.String({ maxLength: 4_000 }),
    textSafeArea: Type.Union([Type.Literal('none'), Type.Literal('top_left'), Type.Literal('top_right'), Type.Literal('bottom')]),
    bubbles: Type.Array(Type.Object({
      kind: ComicBubbleKindSchema, speakerActorId: Type.Union([Type.String(), Type.Null()]), text: Type.String({ maxLength: 300 }),
    }, { additionalProperties: false }), { maxItems: 6 }),
  }, { additionalProperties: false }), { minItems: 4, maxItems: 8 }),
}, { additionalProperties: false });
export type ComicStoryboardModelOutput = Static<typeof ComicStoryboardModelOutputSchema>;
export const ComicStoryboardAppliedResponseSchema = Type.Object({ draft: ComicDraftSchema, addedPageIds: Type.Array(Type.String()) });
export type ComicStoryboardAppliedResponse = Static<typeof ComicStoryboardAppliedResponseSchema>;
export const ComicRenderPreviewRequestSchema = Type.Object({ expectedDraftVersion: Type.Integer({ minimum: 1 }), seed: Type.Optional(Type.Integer({ minimum: 0, maximum: 2_147_483_647 })) });
export type ComicRenderPreviewRequest = Static<typeof ComicRenderPreviewRequestSchema>;
export const ComicRenderPreviewSchema = Type.Object({
  promptOptimization: Type.Optional(Type.Object({ enabled: Type.Boolean() })),
  planHash: Type.String(), canSubmit: Type.Boolean(), workflowId: Type.String(), workflowVersion: Type.Integer(),
  workflowName: Type.String(), engineId: Type.String(), engineName: Type.String(), model: Type.Union([Type.String(), Type.Null()]),
  seed: Type.Integer({ minimum: 0, maximum: 2_147_483_647 }), sourceFingerprint: Type.String(),
  presetId: Type.Union([Type.String(), Type.Null()]), presetRevision: Type.Union([Type.Integer(), Type.Null()]),
  promptPolicyRevision: Type.Integer({ minimum: 0 }), referenceSupported: Type.Boolean(), referenceSelected: Type.Boolean(),
  /** 当前工作流版本的提示词组装模式（计划 §15.1：常用页要说明模式来自哪个工作流）。 */
  promptAssembly: Type.Union([Type.Literal('service-finalized-v1'), Type.Literal('workflow-internal')]),
  parameters: Type.Record(Type.String(), Type.Unknown()), positivePrompt: Type.String(), negativePrompt: Type.String(),
  fields: Type.Optional(Type.Array(BeatRenderParameterFieldSchema)),
  sources: Type.Array(Type.Object({ label: Type.String(), value: Type.String() })),
  loras: Type.Array(Type.Object({ model: Type.String(), strength: Type.Number(), enabled: Type.Boolean(), available: Type.Boolean() })),
  warnings: Type.Array(Type.String()),
});
export type ComicRenderPreview = Static<typeof ComicRenderPreviewSchema>;
export const ComicRenderRequestSchema = Type.Object({
  expectedDraftVersion: Type.Integer({ minimum: 1 }), planHash: Type.String({ minLength: 1 }),
  seed: Type.Optional(Type.Integer({ minimum: 0, maximum: 2_147_483_647 })), idempotencyKey: Type.String({ minLength: 1, maxLength: 160 }),
});
export type ComicRenderRequest = Static<typeof ComicRenderRequestSchema>;
export const ComicSelectImageRequestSchema = Type.Object({
  expectedDraftVersion: Type.Integer({ minimum: 1 }), artifactId: Type.String({ minLength: 1 }), allowStaleSource: Type.Boolean(),
});
export type ComicSelectImageRequest = Static<typeof ComicSelectImageRequestSchema>;
export const ComicExportReaderRequestSchema = Type.Object({ revisionId: Type.String({ minLength: 1 }) });
export type ComicExportReaderRequest = Static<typeof ComicExportReaderRequestSchema>;
