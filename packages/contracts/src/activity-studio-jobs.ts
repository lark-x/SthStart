import { Type, type Static } from '@sinclair/typebox';
import { DirectorSettingsSchema } from './activity-studio.js';
import { ComicStoryboardModelOutputSchema } from './activity-comic.js';

const id = () => Type.String({ minLength: 1, maxLength: 160 });
const strict = { additionalProperties: false } as const;
const nullableId = () => Type.Union([id(), Type.Null()]);
export const StudioTargetSchema = Type.Union([
  Type.Object({ kind: Type.Literal('beat'), stageId: id(), sceneId: id(), beatId: id() }, strict),
  Type.Object({ kind: Type.Literal('comic_panel'), panelId: id() }, strict),
  Type.Object({ kind: Type.Literal('media_slot'), slotId: id() }, strict),
]);
export type StudioTarget = Static<typeof StudioTargetSchema>;
export const StudioHealthRequestSchema=Type.Object({target:StudioTargetSchema},strict);
export type StudioHealthRequest=Static<typeof StudioHealthRequestSchema>;
export const StudioHealthLayerSchema=Type.Object({
  kind:Type.Union((['text','connection','workflow','files','queue'] as const).map(value=>Type.Literal(value))),
  status:Type.Union((['ok','error','unknown','not_required'] as const).map(value=>Type.Literal(value))),
  summary:Type.String(),issues:Type.Array(Type.String()),settingsUrl:Type.String(),
},strict);
export type StudioHealthLayer=Static<typeof StudioHealthLayerSchema>;
export const StudioHealthResultSchema=Type.Object({target:StudioTargetSchema,checkedAt:Type.String(),
  canSubmit:Type.Boolean(),layers:Type.Array(StudioHealthLayerSchema,{minItems:5,maxItems:5}),
  workflowId:nullableId(),workflowVersion:Type.Union([Type.Integer({minimum:1}),Type.Null()]),
  engineId:nullableId(),model:Type.Union([Type.String(),Type.Null()]),
  optimizerEnabled:Type.Union([Type.Boolean(),Type.Null()]),
  queue:Type.Object({running:Type.Union([Type.Integer({minimum:0}),Type.Null()]),
    pending:Type.Union([Type.Integer({minimum:0}),Type.Null()]),localUncertain:Type.Integer({minimum:0})},strict),
},strict);
export type StudioHealthResult=Static<typeof StudioHealthResultSchema>;
export const StudioJobKindSchema = Type.Union((['storyboard', 'refine', 'render_batch'] as const).map(value => Type.Literal(value)));
export type StudioJobKind = Static<typeof StudioJobKindSchema>;
export const StudioJobStatusSchema = Type.Union((['queued','preparing','running','awaiting_review','paused','succeeded',
  'partially_succeeded','failed','cancelled','interrupted','unknown'] as const).map(value => Type.Literal(value)));
export type StudioJobStatus = Static<typeof StudioJobStatusSchema>;
export const StudioVersionContextSchema = Type.Object({
  headVersion: Type.Integer({ minimum: 1 }), contentDraftVersion: Type.Integer({ minimum: 1 }),
  contentRevisionId: nullableId(), imageConfigDraftVersion: Type.Integer({ minimum: 1 }), imageConfigRevisionId: nullableId(),
  comicDraftVersion: Type.Optional(Type.Integer({ minimum: 1 })),
}, strict);
export type StudioVersionContext = Static<typeof StudioVersionContextSchema>;
export const StudioStoryboardSourceSchema = Type.Union([
  Type.Object({ kind: Type.Literal('scene'), contentRevisionId: id(), stageId: id(), sceneId: id() }, strict),
  Type.Object({ kind: Type.Literal('text'), text: Type.String({ minLength: 1, maxLength: 12_000 }) }, strict),
  Type.Object({ kind: Type.Literal('story_chapter'), projectId: id(), chapterId: id(), revisionId: id() }, strict),
]);
export type StudioStoryboardSource = Static<typeof StudioStoryboardSourceSchema>;
export const StudioStoryboardRequestSchema = Type.Object({
  kind: Type.Literal('storyboard'), versions: StudioVersionContextSchema,
  input: Type.Object({ source: StudioStoryboardSourceSchema, actorIds: Type.Array(id(), { maxItems: 8, uniqueItems: true }),
    output: Type.Union([Type.Literal('beats'), Type.Literal('comic')]), count: Type.Integer({ minimum: 2, maximum: 12 }),
    stageId: id(), sceneId: Type.Union([id(), Type.Null()]), instructions: Type.String({ maxLength: 2000 }),
  }, strict), idempotencyKey: Type.String({ minLength: 1, maxLength: 160 }),
}, strict);
export type StudioStoryboardRequest = Static<typeof StudioStoryboardRequestSchema>;
export const StudioRefineTargetSchema = Type.Union([StudioTargetSchema.anyOf[0],StudioTargetSchema.anyOf[1]]);
export const StudioVisualPatchSchema = Type.Object({ director: Type.Optional(DirectorSettingsSchema),
  composition: Type.Optional(Type.String({ maxLength: 2000 })), visualSupplement: Type.Optional(Type.String({ maxLength: 2000 })),
  expression: Type.Optional(Type.String({ maxLength: 500 })),
}, { ...strict,minProperties: 1 });
export type StudioVisualPatch = Static<typeof StudioVisualPatchSchema>;
export const StudioRefineRequestSchema = Type.Object({ kind: Type.Literal('refine'),versions: StudioVersionContextSchema,
  input: Type.Object({ target: StudioRefineTargetSchema,instructions: Type.String({ minLength: 1,maxLength: 2000 }) },strict), idempotencyKey: id(),
},strict);
export type StudioRefineRequest = Static<typeof StudioRefineRequestSchema>;
export const StudioRefineResultSchema = Type.Object({ before: StudioVisualPatchSchema,patch: StudioVisualPatchSchema,
  explanation: Type.String({ minLength: 1,maxLength: 2000 }),sourceFingerprint: id(),resultHash: id(),
},strict);
export type StudioRefineResult = Static<typeof StudioRefineResultSchema>;
export const StudioRenderResultSchema = Type.Object({ renderedImages: Type.Array(id()), succeeded: Type.Integer({ minimum: 0 }),
  failed: Type.Integer({ minimum: 0 }), sourceFingerprint: id(), resultHash: id(),
},strict);
export type StudioRenderResult = Static<typeof StudioRenderResultSchema>;
export const StudioPlacementSchema=Type.Union([Type.Literal('history_only'),Type.Literal('fill_empty')]);
export type StudioPlacement=Static<typeof StudioPlacementSchema>;
export const StudioBatchRequestSchema=Type.Object({kind:Type.Literal('render_batch'),versions:StudioVersionContextSchema,
  input:Type.Object({targets:Type.Array(StudioTargetSchema,{minItems:1,maxItems:12}),candidateCount:Type.Integer({minimum:1,maximum:3}),placement:StudioPlacementSchema},strict),idempotencyKey:id(),
},strict);
export type StudioBatchRequest=Static<typeof StudioBatchRequestSchema>;
export const StudioBatchStartSchema=Type.Object({expectedJobRevision:Type.Integer({minimum:1}),planHash:id()},strict);
export type StudioBatchStart=Static<typeof StudioBatchStartSchema>;
export const StudioBatchRetrySchema=Type.Object({expectedJobRevision:Type.Integer({minimum:1}),
  itemIds:Type.Array(id(),{minItems:1,maxItems:24,uniqueItems:true}),idempotencyKey:id()},strict);
export type StudioBatchRetry=Static<typeof StudioBatchRetrySchema>;
export const StudioJobResumeSchema=Type.Object({expectedJobRevision:Type.Integer({minimum:1}),planHash:Type.Optional(id()),
  itemIds:Type.Optional(Type.Array(id(),{minItems:1,maxItems:24,uniqueItems:true}))},strict);
export type StudioJobResume=Static<typeof StudioJobResumeSchema>;
export const StudioPrepareContextSchema=Type.Object({expected:StudioVersionContextSchema},strict);
export type StudioPrepareContext=Static<typeof StudioPrepareContextSchema>;
export const StudioItemListQuerySchema=Type.Object({cursor:Type.Optional(id()),limit:Type.Optional(Type.Integer({minimum:1,maximum:20}))},strict);
export type StudioItemListQuery=Static<typeof StudioItemListQuerySchema>;
export const StudioBatchPlanSchema=Type.Object({target:StudioTargetSchema,name:Type.String(),actorIds:Type.Array(id()),empty:Type.Boolean(),
  sourceFingerprint:id(),seed:Type.Integer({minimum:0}),canSubmit:Type.Boolean(),issues:Type.Array(Type.String()),
  workflowId:id(),workflowVersion:Type.Integer({minimum:1}),presetId:nullableId(),presetRevision:Type.Union([Type.Integer({minimum:1}),Type.Null()]),
  model:Type.Union([Type.String(),Type.Null()]),parameters:Type.Record(Type.String(),Type.Unknown()),referenceArtifactIds:Type.Array(id()),
  promptPolicyRevision:Type.Integer({minimum:0}),loraPolicyRevision:Type.Integer({minimum:0}),
  loras:Type.Array(Type.Object({model:Type.String(),strength:Type.Number(),triggerWord:Type.String(),enabled:Type.Boolean()},strict)),
  referenceSupported:Type.Boolean(),referenceSelected:Type.Boolean(),
  compiledPrompt:Type.Optional(Type.String()),negativePrompt:Type.Optional(Type.Union([Type.String(),Type.Null()])),
  optimizerEnabled:Type.Optional(Type.Boolean()),optimizerProfileId:Type.Optional(nullableId()),optimizerModel:Type.Optional(Type.Union([Type.String(),Type.Null()])),
},strict);
export type StudioBatchPlan=Static<typeof StudioBatchPlanSchema>;
export const StudioBatchPreviewResultSchema=Type.Object({plans:Type.Array(StudioBatchPlanSchema,{minItems:1,maxItems:24}),imageTaskCount:Type.Integer({minimum:1,maximum:24}),
  modelRequestCount:Type.Integer({minimum:0,maximum:24}),placement:StudioPlacementSchema,planHash:id(),sourceFingerprint:id(),resultHash:id(),
},strict);
export type StudioBatchPreviewResult=Static<typeof StudioBatchPreviewResultSchema>;
export const StudioItemSchema=Type.Object({id:id(),jobId:id(),target:StudioTargetSchema,candidateIndex:Type.Integer({minimum:0}),attemptNo:Type.Integer({minimum:0}),
  retryOfItemId:nullableId(),state:Type.Union((['waiting','preparing','submitted','succeeded','failed','skipped','cancelled','interrupted','unknown'] as const).map(value=>Type.Literal(value))),
  seed:Type.Integer({minimum:0}),sourceFingerprint:id(),submissionKey:id(),nativeJobId:nullableId(),generationTaskId:nullableId(),candidateId:nullableId(),callId:nullableId(),
  artifactIds:Type.Array(id()),unavailableArtifactIds:Type.Optional(Type.Array(id())),selectedArtifactId:nullableId(),placementState:Type.Union((['not_requested','pending','applied','ineligible','conflict','artifact_unavailable','target_missing'] as const).map(value=>Type.Literal(value))),
  placementReason:Type.Union([Type.String(),Type.Null()]),errorCode:nullableId(),errorMessage:Type.Union([Type.String(),Type.Null()]),createdAt:Type.String(),updatedAt:Type.String(),
},strict);
export type StudioItem=Static<typeof StudioItemSchema>;
export const StudioItemPageSchema=Type.Object({items:Type.Array(StudioItemSchema),nextCursor:Type.Union([id(),Type.Null()])},strict);
export type StudioItemPage=Static<typeof StudioItemPageSchema>;
export const StudioStoryboardOutputSchema = Type.Object({
  scene: Type.Object({ title: Type.String({ minLength: 1, maxLength: 200 }), timeText: Type.String({ maxLength: 200 }),
    locationText: Type.String({ maxLength: 500 }), environment: Type.String({ maxLength: 2000 }) }, strict),
  beats: Type.Array(Type.Object({ actorIds: Type.Array(id(), { maxItems: 8, uniqueItems: true }), primaryActorId: nullableId(),
    action: Type.String({ minLength: 1, maxLength: 2000 }), dialogue: Type.String({ maxLength: 1000 }), outcome: Type.String({ maxLength: 1000 }),
    director: DirectorSettingsSchema, composition: Type.String({ maxLength: 2000 }),
  }, strict), { minItems: 2, maxItems: 12 }),
}, strict);
export type StudioStoryboardOutput = Static<typeof StudioStoryboardOutputSchema>;
export const StudioStoryboardResultSchema = Type.Object({
  output: Type.Union([StudioStoryboardOutputSchema, Type.Null()]),
  comic: Type.Union([ComicStoryboardModelOutputSchema, Type.Null()]),
  sourceLabel: Type.String(), sourceFingerprint: id(), resultHash: id(),
}, strict);
export type StudioStoryboardResult = Static<typeof StudioStoryboardResultSchema>;
export const StudioAppliedResultSchema = Type.Object({
  sceneId: id(), beatIds: Type.Array(id()), pageIds: Type.Array(id()), panelIds: Type.Array(id()),
  contentDraftVersion: Type.Integer({ minimum: 1 }), contentRevisionId: nullableId(), comicDraftVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  childJobId: nullableId(),
}, strict);
export type StudioAppliedResult = Static<typeof StudioAppliedResultSchema>;
export const StudioJobSchema = Type.Object({
  id: id(), activityId: id(), parentJobId: nullableId(), kind: StudioJobKindSchema, status: StudioJobStatusSchema,
  revision: Type.Integer({ minimum: 1 }), idempotencyKey: id(), requestHash: id(),
  input: Type.Record(Type.String(), Type.Unknown()), result: Type.Union([StudioStoryboardResultSchema,StudioRefineResultSchema,StudioRenderResultSchema,StudioBatchPreviewResultSchema,Type.Null()]),
  planHash: nullableId(), traceId: id(), callId: nullableId(), stopRequested: Type.Boolean(),
  applyState: Type.Union([Type.Literal('not_applied'),Type.Literal('applied'),Type.Literal('conflict')]),
  appliedResult: Type.Union([StudioAppliedResultSchema, Type.Null()]),
  errorCode: nullableId(), errorMessage: Type.Union([Type.String(),Type.Null()]),
  createdAt: Type.String(), updatedAt: Type.String(), sourceUrl: Type.String(),readOnly:Type.Optional(Type.Boolean()),
}, strict);
export type StudioJob = Static<typeof StudioJobSchema>;
export const StudioJobPageSchema = Type.Object({ items: Type.Array(StudioJobSchema), nextCursor: Type.Union([id(),Type.Null()]) }, strict);
export type StudioJobPage = Static<typeof StudioJobPageSchema>;
export const StudioJobListQuerySchema = Type.Object({ kind: Type.Optional(StudioJobKindSchema), status: Type.Optional(StudioJobStatusSchema),
  cursor: Type.Optional(id()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
}, strict);
export type StudioJobListQuery = Static<typeof StudioJobListQuerySchema>;
export const StudioStoryboardApplySchema = Type.Object({ expectedJobRevision: Type.Integer({ minimum: 1 }), versions: StudioVersionContextSchema,
  resultHash: id(), mode: Type.Union([Type.Literal('append'),Type.Literal('replace_scene')]),
  confirmReplace: Type.Optional(Type.Boolean()), sceneId: Type.Union([id(),Type.Null()]),
  renderAfterApply: Type.Optional(Type.Boolean()),placement:Type.Optional(StudioPlacementSchema),
}, strict);
export type StudioStoryboardApply = Static<typeof StudioStoryboardApplySchema>;
export const StudioRefineApplySchema = Type.Object({ expectedJobRevision: Type.Integer({ minimum: 1 }),versions: StudioVersionContextSchema,
  resultHash: id(), renderAfterApply: Type.Optional(Type.Boolean()),
},strict);
export type StudioRefineApply = Static<typeof StudioRefineApplySchema>;
export const StudioJobControlSchema = Type.Object({ expectedJobRevision: Type.Integer({ minimum: 1 }) }, strict);
export type StudioJobControl = Static<typeof StudioJobControlSchema>;

// Text fallback is deliberately separate from normal task creation. A scoped
// profile ID is not a new global assignment, credential, URL or prompt override.
export const StudioTextFallbackSelectionSchema=Type.Object({profileId:id()},strict);
export type StudioTextFallbackSelection=Static<typeof StudioTextFallbackSelectionSchema>;
export const StudioTextFallbackPreviewSchema=Type.Object({
  fallbackOf:id(),rootJobId:id(),expectedJobRevision:Type.Integer({minimum:1}),
  profileId:id(),profileName:Type.String(),model:Type.String(),originalModel:Type.Union([Type.String(),Type.Null()]),
  reason:Type.String(),scope:Type.String(),modelRequestCount:Type.Literal(1),imageTaskCount:Type.Literal(0),
  maxAttempts:Type.Literal(1),planHash:id(),
},strict);
export type StudioTextFallbackPreview=Static<typeof StudioTextFallbackPreviewSchema>;
export const StudioTextFallbackOptionsSchema=Type.Object({allowed:Type.Boolean(),reason:Type.String(),
  originalModel:Type.Union([Type.String(),Type.Null()]),
  profiles:Type.Array(Type.Object({id:id(),name:Type.String(),model:Type.String()},strict)),
},strict);
export type StudioTextFallbackOptions=Static<typeof StudioTextFallbackOptionsSchema>;
export const StudioTextFallbackRequestSchema=Type.Object({profileId:id(),expectedJobRevision:Type.Integer({minimum:1}),planHash:id(),idempotencyKey:id()},strict);
export type StudioTextFallbackRequest=Static<typeof StudioTextFallbackRequestSchema>;

// Image fallback replaces only the frozen image preset for the failed items of
// one batch. Compatibility is re-validated before the new attempt is created.
export const StudioImageFallbackSelectionSchema=Type.Object({presetId:id(),presetRevision:Type.Optional(Type.Integer({minimum:1}))},strict);
export type StudioImageFallbackSelection=Static<typeof StudioImageFallbackSelectionSchema>;
export const StudioImageFallbackPreviewSchema=Type.Object({
  fallbackOf:id(),rootJobId:id(),expectedJobRevision:Type.Integer({minimum:1}),
  presetId:id(),presetRevision:Type.Integer({minimum:1}),presetName:Type.String(),model:Type.Union([Type.String(),Type.Null()]),
  originalPresetId:nullableId(),originalPresetRevision:Type.Union([Type.Integer({minimum:1}),Type.Null()]),originalModel:Type.Union([Type.String(),Type.Null()]),
  workflowId:id(),workflowVersion:Type.Integer({minimum:1}),itemIds:Type.Array(id(),{minItems:1,maxItems:24}),
  imageTaskCount:Type.Integer({minimum:1,maximum:24}),modelRequestCount:Type.Integer({minimum:0,maximum:24}),
  reason:Type.String(),scope:Type.String(),maxAttempts:Type.Literal(1),planHash:id(),
},strict);
export type StudioImageFallbackPreview=Static<typeof StudioImageFallbackPreviewSchema>;
export const StudioImageFallbackOptionsSchema=Type.Object({allowed:Type.Boolean(),reason:Type.String(),
  originalPresetId:nullableId(),originalModel:Type.Union([Type.String(),Type.Null()]),
  presets:Type.Array(Type.Object({id:id(),name:Type.String(),revision:Type.Integer({minimum:1}),model:Type.Union([Type.String(),Type.Null()])},strict)),
},strict);
export type StudioImageFallbackOptions=Static<typeof StudioImageFallbackOptionsSchema>;
export const StudioImageFallbackRequestSchema=Type.Object({presetId:id(),presetRevision:Type.Optional(Type.Integer({minimum:1})),
  expectedJobRevision:Type.Integer({minimum:1}),planHash:id(),idempotencyKey:id()},strict);
export type StudioImageFallbackRequest=Static<typeof StudioImageFallbackRequestSchema>;
