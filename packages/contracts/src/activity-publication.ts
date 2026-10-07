import { Type, type Static } from '@sinclair/typebox';
import { ActivityLoraSchema, SceneBeatRenderSettingsSchema } from './activities.js';
import { StructuredVisualPromptSchema } from './activity-image-prompts.js';
import { StoryEntryRevisionSchema } from './story.js';
import {BeatRenderWorkflowOptionSchema,BeatRenderPresetOptionSchema} from './ai-calls.js';

const strict = { additionalProperties: false } as const;
const id = () => Type.String({ minLength: 1, maxLength: 160 });
const nullableId = () => Type.Union([id(), Type.Null()]);
const text = (maxLength: number) => Type.String({ maxLength });
export const PublicationActorSchema = Type.Object({
  id: id(), name: Type.String({ minLength: 1, maxLength: 120 }), universe: text(120),
  entryRevisionId: nullableId(), visualDescription: text(4000), characterId: nullableId(),
  loras: Type.Array(ActivityLoraSchema, { maxItems: 16 }), referenceArtifactId: nullableId(),
  voiceBindingId: nullableId(),
}, strict);
export const PublicationUtteranceSchema = Type.Object({
  id: id(), speakerActorId: nullableId(), text: Type.String({ minLength: 1, maxLength: 1000 }),
  voiceBindingId: nullableId(), selectedAudioArtifactId: nullableId(),
}, strict);
export const PublicationShotSchema = Type.Object({
  id: id(), sourceRefs: Type.Array(id(), { minItems: 1, maxItems: 12 }),
  actorIds: Type.Array(id(), { maxItems: 8 }), visualDescription: text(4000),
  structuredPrompt: StructuredVisualPromptSchema, renderSettings: SceneBeatRenderSettingsSchema,
  selectedImage: Type.Union([Type.Object({ artifactId: id(), renderTaskId: nullableId() }, strict), Type.Null()]),
  utterances: Type.Array(PublicationUtteranceSchema, { maxItems: 12 }),
  presentation: Type.Union([Type.Literal('still'), Type.Literal('push_in')]),
}, strict);
export const PublicationDocumentSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  source: Type.Object({ storyProjectId: id(), entryRevisionIds: Type.Array(id(), { minItems: 1, maxItems: 12 }), sourceHash: id() }, strict),
  title: Type.String({ minLength: 1, maxLength: 120 }), synopsis: text(4000),
  orientation: Type.Union([Type.Literal('portrait'), Type.Literal('landscape')]),
  actors: Type.Array(PublicationActorSchema, { maxItems: 16 }),
  shots: Type.Array(PublicationShotSchema, { maxItems: 12 }),
  publishingCopy: Type.Object({ title: text(120), description: text(4000), tags: Type.Array(text(80), { maxItems: 20 }) }, strict),
}, strict);
export type PublicationActor = Static<typeof PublicationActorSchema>;
export type PublicationUtterance = Static<typeof PublicationUtteranceSchema>;
export type PublicationShot = Static<typeof PublicationShotSchema>;
export type PublicationDocument = Static<typeof PublicationDocumentSchema>;
export const PublicationDraftSchema = Type.Object({
  activityId: id(), draftVersion: Type.Integer({ minimum: 1 }), document: PublicationDocumentSchema,
  updatedAt: id(),
}, strict);
export type PublicationDraft = Static<typeof PublicationDraftSchema>;
export const CreatePublicationSchema = Type.Object({ entryRevisionIds: Type.Array(id(), { minItems: 1, maxItems: 12 }) }, strict);
export const SavePublicationSchema = Type.Object({ expectedDraftVersion: Type.Integer({ minimum: 1 }), document: PublicationDocumentSchema }, strict);
export const PublicationSourceBundleSchema = Type.Object({ revisions: Type.Array(StoryEntryRevisionSchema), sourceHash: id() }, strict);
export type PublicationSourceBundle = Static<typeof PublicationSourceBundleSchema>;

export const SpeechProfileSchema = Type.Object({
  id: id(), revision: Type.Integer({ minimum: 1 }), name: Type.String({ minLength: 1, maxLength: 120 }),
  baseUrl: Type.String({ minLength: 1, maxLength: 1000 }), model: Type.String({ minLength: 1, maxLength: 160 }),
  voices: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { minItems: 1, maxItems: 100 }),
  defaultVoice: id(), speed: Type.Number({ minimum: 0.5, maximum: 2 }),
  secretEnvironment: Type.String({ pattern: '^[A-Z][A-Z0-9_]{0,100}$' }),
  connectionId: Type.Optional(id()),
}, strict);
export type SpeechProfile = Static<typeof SpeechProfileSchema>;
export const SpeechProfileListSchema = Type.Object({ items: Type.Array(SpeechProfileSchema) }, strict);
export const SaveSpeechProfileSchema = Type.Object({ expectedRevision: Type.Integer({ minimum: 0 }), profile: SpeechProfileSchema }, strict);
export const PublicationSpeechModelsSchema = Type.Object({items:Type.Array(Type.Object({
  modelProfileId:id(),connectionId:id(),name:Type.String(),model:Type.String(),baseUrl:Type.String(),hasCredential:Type.Boolean(),
},strict))},strict);
export type PublicationSpeechModels = Static<typeof PublicationSpeechModelsSchema>;
export const PublicationApprovalRequestSchema = Type.Object({
  expectedDraftVersion: Type.Integer({ minimum: 1 }), speechProfileId: nullableId(),
  makeVideo: Type.Boolean(), imageBudget: Type.Integer({ minimum: 1, maximum: 15 }),
  speechCharacterBudget: Type.Integer({ minimum: 0, maximum: 20000 }),
  expectedConfigHash: Type.Optional(id()),
}, strict);
export type PublicationApprovalRequest = Static<typeof PublicationApprovalRequestSchema>;
export const PublicationApprovalSchema = Type.Object({
  id: id(), activityId: id(), draftVersion: Type.Integer(), revisionId: id(), documentHash: id(), configHash: id(),
  imageBudget: Type.Integer(), speechCharacterBudget: Type.Integer(), makeVideo: Type.Boolean(),
  speechProfileId: nullableId(), createdAt: id(),
}, strict);
export type PublicationApproval = Static<typeof PublicationApprovalSchema>;
export const PublicationRunRequestSchema = Type.Object({ approvalId: id(), idempotencyKey: Type.String({ minLength: 8, maxLength: 128 }) }, strict);
export const PublicationTaskStatusSchema = Type.Union((['queued', 'preparing', 'running', 'succeeded', 'failed', 'interrupted', 'unknown', 'stopped'] as const).map(value => Type.Literal(value)));
export const PublicationTaskSchema = Type.Object({
  id: id(), runId: id(), kind: Type.Union([Type.Literal('image'), Type.Literal('speech'), Type.Literal('export')]),
  targetId: id(), status: PublicationTaskStatusSchema, generationTaskId: nullableId(), callId: nullableId(),
  artifactIds: Type.Array(id()), error: Type.Union([text(2000), Type.Null()]), inputHash: id(), updatedAt: id(),
}, strict);
export type PublicationTask = Static<typeof PublicationTaskSchema>;
export const PublicationRunSchema = Type.Object({
  id: id(), activityId: id(), approvalId: id(), status: PublicationTaskStatusSchema,
  imagesUsed: Type.Integer(), speechCharactersUsed: Type.Integer(), tasks: Type.Array(PublicationTaskSchema),
  createdAt: id(), updatedAt: id(),
}, strict);
export type PublicationRun = Static<typeof PublicationRunSchema>;
export const PublicationRunListSchema = Type.Object({ items: Type.Array(PublicationRunSchema) }, strict);
export const PublicationSelectImageSchema = Type.Object({ expectedDraftVersion: Type.Integer({ minimum: 1 }), artifactId: id(), allowStaleSource: Type.Boolean() }, strict);
export const PublicationAudioRequestSchema = Type.Object({ expectedDraftVersion: Type.Integer({ minimum: 1 }), artifactId: id(), allowStaleSource:Type.Optional(Type.Boolean()) }, strict);
export const PublicationRetrySchema = Type.Object({ runId: id(), idempotencyKey: Type.String({ minLength: 8, maxLength: 128 }) }, strict);
export const PublicationExportRequestSchema = Type.Object({ expectedDraftVersion: Type.Integer({ minimum: 1 }), makeVideo: Type.Boolean(), idempotencyKey: Type.String({ minLength: 8, maxLength: 128 }) }, strict);
export const PublicationGrantSchema = Type.Object({ token: Type.String(), projectId: id() }, strict);
export const PublicationGrantStatusSchema = Type.Object({ paired: Type.Boolean(), lastUsedAt: Type.Union([Type.String(), Type.Null()]) }, strict);
export const PublicationHistorySchema = Type.Object({ items: Type.Array(Type.Object({
  artifactId: id(), taskId: id(), shotId: id(), available: Type.Boolean(), current: Type.Boolean(), callId: nullableId(), createdAt: id(),
}, strict)) }, strict);
export type PublicationHistory = Static<typeof PublicationHistorySchema>;
export const PublicationPlanRequestSchema = Type.Object({ activityId: id(), expectedDraftVersion: Type.Integer({ minimum: 1 }), document: PublicationDocumentSchema }, strict);
export const PublicationSourceTextSchema = Type.Object({ sourceHash: id(), entryRevisionIds: Type.Array(id()),
  entryRevisionId: id(), title: Type.String(), body: Type.String(), totalLength: Type.Integer(), offset: Type.Integer(), nextOffset: Type.Union([Type.Integer(), Type.Null()]),
}, strict);
export const PublicationMediaSchema = Type.Object({ items: Type.Array(Type.Object({
  artifactId: id(), kind: Type.String(), durationMs: Type.Union([Type.Number(), Type.Null()]), available: Type.Boolean(),
}, strict)) }, strict);
export type PublicationMedia = Static<typeof PublicationMediaSchema>;
export const PublicationSourceQuerySchema = Type.Object({ activityId: id(), entryRevisionId: Type.Optional(id()),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20000 })),
}, strict);
export const PublicationWorkspaceStateSchema = Type.Object({draft:PublicationDraftSchema,approval:Type.Union([PublicationApprovalSchema,Type.Null()])},strict);
export const PublicationAudioUploadResponseSchema = Type.Object({artifactId:id(),durationMs:Type.Number({exclusiveMinimum:0})},strict);
export const PublicationPreviewRequestSchema = Type.Object({expectedDraftVersion:Type.Integer({minimum:1}),speechProfileId:nullableId(),makeVideo:Type.Boolean()},strict);
export const PublicationPreviewSchema = Type.Object({configHash:id(),shots:Type.Array(Type.Object({
  shotId:id(),workflowId:id(),workflowVersion:Type.Integer(),presetId:nullableId(),models:Type.Array(Type.String()),positivePrompt:Type.String(),negativePrompt:Type.Union([Type.String(),Type.Null()]),
  parameters:Type.Record(Type.String(),Type.Unknown()),loras:Type.Array(ActivityLoraSchema),referenceArtifactIds:Type.Array(id()),
},strict)),speech:Type.Union([SpeechProfileSchema,Type.Null()])},strict);
export type PublicationPreview = Static<typeof PublicationPreviewSchema>;
export const PublicationImageOptionsSchema=Type.Object({items:Type.Array(BeatRenderWorkflowOptionSchema),presets:Type.Array(BeatRenderPresetOptionSchema)},strict);
export const PublicationAudioHistorySchema=Type.Object({items:Type.Array(Type.Object({artifactId:id(),available:Type.Boolean(),current:Type.Boolean(),staleSource:Type.Boolean(),durationMs:Type.Number(),createdAt:id(),callId:nullableId()},strict))},strict);
export type PublicationAudioHistory=Static<typeof PublicationAudioHistorySchema>;
