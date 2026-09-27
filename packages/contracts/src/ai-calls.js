// Runtime mirror of ai-calls.ts. The Docker service loads contracts from src
// with Node directly, so this ESM file is the runtime target of index.ts's
// .js specifier. Keep the TypeBox schemas in sync with the typed source file.
import { Type } from '@sinclair/typebox';

export const AiCallStatusSchema = Type.Union([
  Type.Literal('requested'), Type.Literal('not_dispatched'), Type.Literal('submitted'),
  Type.Literal('accepted'), Type.Literal('running'), Type.Literal('succeeded'),
  Type.Literal('failed'), Type.Literal('abandoned'),
]);

export const AiCallEventSchema = Type.Object({
  id: Type.Number(),
  createdAt: Type.String(),
  phase: Type.String(),
  detail: Type.Record(Type.String(), Type.Unknown()),
});

export const AiCallTraceCallSchema = Type.Object({
  id: Type.String(), businessEvent: Type.String(), callType: Type.String(), status: AiCallStatusSchema,
  requestedAt: Type.String(), endedAt: Type.Union([Type.String(), Type.Null()]), durationMs: Type.Union([Type.Number(), Type.Null()]),
  models: Type.Array(Type.String()), errorCode: Type.Union([Type.String(), Type.Null()]), error: Type.Union([Type.String(), Type.Null()]),
});

export const AiCallSummarySchema = Type.Object({
  id: Type.String(), traceId: Type.String(), parentId: Type.Union([Type.String(), Type.Null()]),
  retryOf: Type.Union([Type.String(), Type.Null()]), applicationId: Type.String(), feature: Type.String(),
  businessEvent: Type.String(), objectType: Type.Union([Type.String(), Type.Null()]),
  objectId: Type.Union([Type.String(), Type.Null()]), callType: Type.String(), status: AiCallStatusSchema,
  requestedAt: Type.String(), endedAt: Type.Union([Type.String(), Type.Null()]), durationMs: Type.Union([Type.Number(), Type.Null()]),
  provider: Type.Union([Type.String(), Type.Null()]), models: Type.Array(Type.String()),
  workflowId: Type.Union([Type.String(), Type.Null()]), workflowVersion: Type.Union([Type.Number(), Type.Null()]),
  upstreamTaskId: Type.Union([Type.String(), Type.Null()]), artifactIds: Type.Array(Type.String()),
  errorCode: Type.Union([Type.String(), Type.Null()]), error: Type.Union([Type.String(), Type.Null()]),
});

export const AiCallDetailSchema = Type.Intersect([
  AiCallSummarySchema,
  Type.Object({
    parameters: Type.Record(Type.String(), Type.Unknown()),
    positivePrompt: Type.Union([Type.String(), Type.Null()]), negativePrompt: Type.Union([Type.String(), Type.Null()]),
    requestSnapshot: Type.Record(Type.String(), Type.Unknown()), responseText: Type.Union([Type.String(), Type.Null()]),
    usage: Type.Record(Type.String(), Type.Unknown()), sourceUrl: Type.Union([Type.String(), Type.Null()]),
    generationTaskId: Type.Union([Type.String(), Type.Null()]), events: Type.Array(AiCallEventSchema),
    traceCalls: Type.Array(AiCallTraceCallSchema),
    artifactDetails: Type.Array(Type.Object({ id: Type.String(), sha256: Type.Union([Type.String(), Type.Null()]), available: Type.Boolean(), previewUrl: Type.Union([Type.String(), Type.Null()]) })),
  }),
]);

export const AiCallListResponseSchema = Type.Object({
  items: Type.Array(AiCallSummarySchema), nextCursor: Type.Union([Type.String(), Type.Null()]),
});

export const AiCallListQuerySchema = Type.Object({
  cursor: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  applicationId: Type.Optional(Type.String()), businessEvent: Type.Optional(Type.String()), status: Type.Optional(AiCallStatusSchema),
  model: Type.Optional(Type.String()), workflowId: Type.Optional(Type.String()), from: Type.Optional(Type.String()),
  to: Type.Optional(Type.String()), q: Type.Optional(Type.String()), objectType: Type.Optional(Type.String()), objectId: Type.Optional(Type.String()),
  traceId: Type.Optional(Type.String()),
});

export const AiCallStorageStatsSchema = Type.Object({
  databaseBytes: Type.Number(), walBytes: Type.Number(), totalBytes: Type.Number(),
  recordCount: Type.Number(), eventCount: Type.Number(),
});

export const BeatRenderPreviewRequestSchema = Type.Object({
  stageId: Type.String(), sceneId: Type.String(), beatId: Type.String(),
  purpose: Type.Optional(Type.String()), workflowId: Type.Optional(Type.String()), workflowVersion: Type.Optional(Type.Integer({ minimum: 1 })),
  presetId: Type.Optional(Type.String()), presetRevision: Type.Optional(Type.Integer({ minimum: 1 })),
  customPrompt: Type.Optional(Type.String()), negativePrompt: Type.Optional(Type.String()),
  parameters: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  referenceAssetKey: Type.Optional(Type.String()),
  seed: Type.Optional(Type.Integer({ minimum: 0, maximum: 2147483647 })),
});

export const BeatRenderWorkflowOptionSchema = Type.Object({
  purpose: Type.String(), workflowId: Type.String(), workflowName: Type.String(), workflowVersion: Type.Number(),
  engineId: Type.String(), engineName: Type.String(), modelSelection: Type.Union([Type.Literal('individual'), Type.Literal('preset-locked')]),
  presetId: Type.Union([Type.String(), Type.Null()]),
});

export const BeatRenderPresetOptionSchema = Type.Object({
  id: Type.String(), name: Type.String(), revision: Type.Number(), workflowId: Type.String(), workflowVersion: Type.Number(), isDefault: Type.Boolean(),
});

export const BeatRenderParameterFieldSchema = Type.Object({
  key: Type.String(), label: Type.String(), type: Type.String(), value: Type.Unknown(), required: Type.Boolean(),
  minimum: Type.Optional(Type.Number()), maximum: Type.Optional(Type.Number()), step: Type.Optional(Type.Number()),
  enumValues: Type.Optional(Type.Array(Type.String())), allowedModels: Type.Optional(Type.Array(Type.String())), modelCategory: Type.Optional(Type.String()), modelEditable: Type.Boolean(),
});

export const BeatRenderPreviewSchema = Type.Object({
  purpose: Type.String(), planHash: Type.String(), source: Type.Array(Type.Object({ label: Type.String(), value: Type.String() })),
  positivePrompt: Type.String(), negativePrompt: Type.Union([Type.String(), Type.Null()]), workflowId: Type.String(), workflowName: Type.String(),
  workflowVersion: Type.Number(), engineId: Type.String(), engineName: Type.String(), model: Type.Union([Type.String(), Type.Null()]),
  parameters: Type.Record(Type.String(), Type.Unknown()), referenceSupported: Type.Boolean(), referenceSelected: Type.Boolean(),
  referenceAssetKey: Type.Union([Type.String(), Type.Null()]), referenceInputKey: Type.Union([Type.String(), Type.Null()]), seed: Type.Integer({ minimum: 0, maximum: 2147483647 }),
    selectedPresetId: Type.Union([Type.String(), Type.Null()]), selectedPresetRevision: Type.Union([Type.Number(), Type.Null()]), canSubmit: Type.Boolean(),
    promptOptimization: Type.Object({ enabled: Type.Boolean(), policyRevision: Type.Integer({ minimum: 0 }), profileReady: Type.Boolean() }),
  workflowOptions: Type.Array(BeatRenderWorkflowOptionSchema), presetOptions: Type.Array(BeatRenderPresetOptionSchema),
  fields: Type.Array(BeatRenderParameterFieldSchema), warnings: Type.Array(Type.String()), draftVersion: Type.Number(),
});

export const BeatRenderSubmitRequestSchema = Type.Intersect([
  BeatRenderPreviewRequestSchema,
  Type.Object({ planHash: Type.String(), idempotencyKey: Type.String({ minLength: 8, maxLength: 128 }) }),
]);

export const BeatRenderSubmitResponseSchema = Type.Object({
  candidateId: Type.String(), taskId: Type.Union([Type.String(), Type.Null()]), callId: Type.Union([Type.String(), Type.Null()]),
});

export const BeatRenderCandidateSchema = Type.Object({
  id: Type.String(), activityId: Type.String(), stageId: Type.String(), sceneId: Type.String(), beatId: Type.String(),
  status: Type.Union([Type.Literal('preparing'), Type.Literal('queued'), Type.Literal('running'), Type.Literal('succeeded'), Type.Literal('failed'), Type.Literal('adopted')]),
  taskId: Type.Union([Type.String(), Type.Null()]), callId: Type.Union([Type.String(), Type.Null()]),
  artifactId: Type.Union([Type.String(), Type.Null()]), mediaUrl: Type.Union([Type.String(), Type.Null()]),
  originalPrompt: Type.String(), positivePrompt: Type.String(), negativePrompt: Type.Union([Type.String(), Type.Null()]),
  promptOptimizationStatus: Type.Union([Type.Literal('optimizing'), Type.Literal('optimized'), Type.Literal('skipped'), Type.Literal('failed')]),
  sourceFingerprint: Type.String(),
  artifactSha256: Type.Union([Type.String(), Type.Null()]), progress: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  createdAt: Type.String(), adoptedAt: Type.Union([Type.String(), Type.Null()]), error: Type.Union([Type.String(), Type.Null()]),
});

export const BeatRenderCandidateListSchema = Type.Object({ items: Type.Array(BeatRenderCandidateSchema) });
