import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { PublicationDocumentSchema, PublicationTaskStatusSchema, PublicationDraftSchema } from './activity-publication.js';
import { StructuredVisualPromptSchema } from './activity-image-prompts.js';
import { SceneBeatRenderSettingsSchema } from './activities.js';
import { StoryProposalKindSchema } from './story.js';

const strict = { additionalProperties: false };
const id = Type.String({ pattern: '^[A-Za-z0-9_-]{1,160}$' });
const version = Type.Integer({ minimum: 1 });
const nullableId = Type.Union([id, Type.Null()]);
export const HarnessPageQuerySchema = Type.Object({
  cursor: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
}, strict);
export type HarnessPageQuery = Static<typeof HarnessPageQuerySchema>;
// Strict merged schemas are used instead of strict intersections (which reject each other's fields).
export const PublicationDiscoveryQuerySchema = Type.Object({ ...HarnessPageQuerySchema.properties, query: Type.Optional(Type.String({ maxLength: 120 })) }, strict);
export const PublicationRunsQuerySchema = Type.Object({ ...HarnessPageQuerySchema.properties, status: Type.Optional(PublicationTaskStatusSchema) }, strict);
export const HarnessIssueSchema = Type.Object({ code: Type.String(), message: Type.String(), path: Type.String(), targetId: Type.Optional(id) }, strict);
export const HarnessErrorSchema = Type.Object({ error: Type.String(), message: Type.String(), retryable: Type.Boolean(), currentVersion: Type.Optional(version), issues: Type.Optional(Type.Array(HarnessIssueSchema)) }, strict);
export const PublicationValidationRequestSchema = Type.Object({ document: PublicationDocumentSchema }, strict);
export const PublicationValidationSchema = Type.Object({ valid: Type.Boolean(), executable: Type.Boolean(), issues: Type.Array(HarnessIssueSchema) }, strict);
export const PublicationPreflightRequestSchema = Type.Object({ expectedDraftVersion: version, speechProfileId: nullableId, makeVideo: Type.Boolean(),checkUpstream:Type.Optional(Type.Boolean()) }, strict);
export const PublicationOptionsQuerySchema = Type.Object({ ...HarnessPageQuerySchema.properties, category: Type.Optional(Type.Union(['images','speech','assets','loras','all'].map(v=>Type.Literal(v)))) }, strict);
export const PublicationArtifactQuerySchema = Type.Object({ mode: Type.Optional(Type.Union([Type.Literal('metadata'), Type.Literal('preview')])) }, strict);
export const PublicationPatchOperationSchema = Type.Union([
  Type.Object({ kind: Type.Literal('publication'), changes: Type.Object({ title: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })), synopsis: Type.Optional(Type.String({ maxLength: 4000 })), publishingCopy: Type.Optional(PublicationDocumentSchema.properties.publishingCopy) }, strict) }, strict),
  Type.Object({ kind: Type.Literal('actor'), id, changes: Type.Object({ visualDescription: Type.Optional(Type.String({ maxLength: 4000 })), voiceBindingId: Type.Optional(nullableId) }, strict) }, strict),
  Type.Object({ kind: Type.Literal('shot'), id, changes: Type.Object({ visualDescription: Type.Optional(Type.String({ maxLength: 4000 })), structuredPrompt: Type.Optional(StructuredVisualPromptSchema), renderSettings: Type.Optional(SceneBeatRenderSettingsSchema), presentation: Type.Optional(Type.Union([Type.Literal('still'),Type.Literal('push_in')])) }, strict) }, strict),
  Type.Object({ kind: Type.Literal('utterance'), id, changes: Type.Object({ text: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })), voiceBindingId: Type.Optional(nullableId) }, strict) }, strict),
]);
export const PublicationPatchRequestSchema = Type.Object({ expectedDraftVersion: version, operations: Type.Array(PublicationPatchOperationSchema, { minItems: 1, maxItems: 40 }) }, strict);
export type PublicationPatchRequest = Static<typeof PublicationPatchRequestSchema>;
export const StoryProposalDiscoveryQuerySchema = Type.Object({ ...HarnessPageQuerySchema.properties, status: Type.Optional(Type.Union(['pending','accepted','rejected'].map(v=>Type.Literal(v)))), targetId: Type.Optional(id) }, strict);
export const StoryRevisionQuerySchema = Type.Object({ ...HarnessPageQuerySchema.properties }, strict);
const nullableString=Type.Union([Type.String(),Type.Null()]);
const paged=(item:TSchema)=>Type.Object({items:Type.Array(item),nextCursor:Type.Union([Type.Integer({minimum:0}),Type.Null()])},strict);
export const PublicationDiscoverySchema=paged(Type.Object({activityId:id,title:Type.String(),draftVersion:version,updatedAt:Type.String(),latestRun:Type.Union([Type.Object({id,status:PublicationTaskStatusSchema},strict),Type.Null()]),nextAction:Type.Union(['inspect_run','prepare_plan','preview_approval'].map(v=>Type.Literal(v)))},strict));
export const PublicationRunDiscoverySchema=paged(Type.Object({id,approvalId:id,status:PublicationTaskStatusSchema,imagesUsed:Type.Integer(),speechCharactersUsed:Type.Integer(),createdAt:Type.String(),updatedAt:Type.String()},strict));
export const PublicationImageDiscoverySchema=paged(Type.Object({artifactId:id,taskId:id,shotId:id,current:Type.Boolean(),available:Type.Boolean(),staleSource:Type.Boolean(),callId:nullableId,createdAt:Type.String()},strict));
export const PublicationAudioDiscoverySchema=paged(Type.Object({artifactId:id,current:Type.Boolean(),available:Type.Boolean(),staleSource:Type.Boolean(),callId:nullableId,createdAt:Type.String(),durationMs:Type.Number()},strict));
export const PublicationMediaDiscoverySchema=paged(Type.Object({artifactId:id,kind:Type.String(),durationMs:Type.Union([Type.Number(),Type.Null()]),available:Type.Boolean()},strict));
export const PublicationArtifactSchema=Type.Object({artifactId:id,kind:Type.String(),sizeBytes:Type.Number(),durationMs:Type.Union([Type.Number(),Type.Null()]),width:Type.Union([Type.Number(),Type.Null()]),height:Type.Union([Type.Number(),Type.Null()]),workspacePath:Type.String(),previewUnavailable:Type.Optional(Type.String()),preview:Type.Optional(Type.Object({type:Type.Union([Type.Literal('image'),Type.Literal('audio')]),mimeType:Type.String(),data:Type.String({maxLength:3_000_000}),transformed:Type.Boolean()},strict))},strict);
export const PublicationOptionsSchema=Type.Object({workflows:Type.Optional(Type.Array(Type.Record(Type.String(),Type.Unknown()))),presets:Type.Optional(Type.Array(Type.Record(Type.String(),Type.Unknown()))),speechProfiles:Type.Optional(Type.Array(Type.Object({id,revision:version,name:Type.String(),model:Type.String(),voices:Type.Array(Type.String()),defaultVoice:Type.String(),speed:Type.Number(),providerVerified:Type.Literal(false)},strict))),referenceAssets:Type.Optional(Type.Array(PublicationMediaDiscoverySchema.properties.items.items)),referenceAssetsNextCursor:Type.Optional(Type.Union([Type.Integer(),Type.Null()])),loras:Type.Optional(Type.Array(Type.Record(Type.String(),Type.Unknown())))},strict);
export const PublicationPreflightSchema=Type.Object({draftVersion:version,validation:PublicationValidationSchema,configHash:nullableString,shots:Type.Array(Type.Record(Type.String(),Type.Unknown())),dependencies:Type.Object({ok:Type.Boolean(),missing:Type.Array(Type.String())},strict),configurationIssue:nullableString,providerVerified:Type.Literal(false),imagesVerified:Type.Boolean(),imageCount:Type.Integer(),speechCharacters:Type.Integer(),approvalId:nullableId,approvalValid:Type.Boolean(),approvalReason:Type.String(),executable:Type.Boolean()},strict);
export const PublicationPatchResponseSchema=Type.Object({draft:PublicationDraftSchema,changedTargets:Type.Array(Type.String()),invalidatedImages:Type.Array(id),invalidatedAudio:Type.Array(id),approvalRequiresReview:Type.Boolean()},strict);
export const StoryProposalDiscoverySchema=paged(Type.Object({id,kind:StoryProposalKindSchema,operation:Type.Union([Type.Literal('update'),Type.Literal('create')]),targetId:nullableId,baseRevision:Type.Union([version,Type.Null()]),status:Type.Union(['pending','accepted','rejected'].map(v=>Type.Literal(v))),proposedTitle:Type.String(),createdAt:Type.String(),decidedAt:nullableString,stale:Type.Boolean()},strict));
export const StoryRevisionDiscoverySchema=paged(Type.Object({id,entryKind:StoryProposalKindSchema,entryId:id,revision:version,source:Type.String(),proposalId:nullableId,createdAt:Type.String()},strict));
export const StoryRevisionChunkSchema=Type.Object({kind:StoryProposalKindSchema,id,revisionId:id,revision:version,source:Type.String(),title:Type.String(),body:Type.String({maxLength:20000}),totalLength:Type.Integer(),offset:Type.Integer(),truncated:Type.Boolean()},strict);

const page = HarnessPageQuerySchema.properties;
const tool = (name: string, description: string, properties: Record<string, TSchema>, required = Object.keys(properties)) => ({ name, description, inputSchema: Type.Object(properties, { ...strict, required }) });
export const PublicationHarnessTools = [
  tool('list_publications','Find this project’s publications. Stable creation-order pagination; pass nextCursor to resume.', { ...page, query: Type.Optional(Type.String({ maxLength: 120 })) }, []),
  tool('list_runs','Find persisted runs and budget usage; read get_run_status for task details.', { activityId:id, ...page, status:Type.Optional(PublicationTaskStatusSchema) }, ['activityId']),
  tool('list_shot_images','List candidate images, current selection, availability and stale source.', { activityId:id, shotId:id, ...page }, ['activityId','shotId']),
  tool('list_utterance_audio','List candidate audio, actual durations and stale source. Listening requires a capable client or the workspace.', { activityId:id, utteranceId:id, ...page }, ['activityId','utteranceId']),
  tool('get_publication_media','List owned image, audio and export artifacts; paginate to see all.', { activityId:id, ...page }, ['activityId']),
  tool('read_publication_artifact','Read owned artifact metadata or a bounded image/audio preview. Video and ZIP use the workspace link; never claim media was reviewed from metadata.', { activityId:id, artifactId:id, ...PublicationArtifactQuerySchema.properties }, ['activityId','artifactId']),
  tool('get_publication_options','Read safe image presets/workflows, speech voices and owned reference assets. LoRA names are configured candidates, availability requires preflight.', { activityId:id, ...PublicationOptionsQuerySchema.properties }, ['activityId']),
  tool('validate_publication_plan','Validate a candidate without saving or calling a model. Draft validity differs from executable completeness.', { activityId:id, document:PublicationDocumentSchema }),
  tool('preview_publication_run','Check saved version, final configuration, quantities and approval validity without paid calls. Optional checkUpstream reads ComfyUI model/LoRA availability and checks configured speech credentials; it does not synthesize. Start rechecks configuration.', { activityId:id, ...PublicationPreflightRequestSchema.properties }, ['activityId','expectedDraftVersion','speechProfileId','makeVideo']),
  tool('patch_publication_plan','Atomically edit specific IDs with CAS; source/media/approval are not editable. On conflict read again; never overwrite.', { activityId:id, ...PublicationPatchRequestSchema.properties }),
  tool('select_utterance_audio','Select audio from this utterance history, with explicit stale-source confirmation.', { activityId:id, utteranceId:id, artifactId:id, expectedDraftVersion:version, allowStaleSource:Type.Boolean() }),
  tool('retry_utterance_audio','Retry unchanged approved speech within remaining budget; successful identical speech is reused. Unknown results forbid resubmission.', { activityId:id, utteranceId:id, runId:id, idempotencyKey:Type.String({ minLength:8,maxLength:128 }) }),
  tool('export_publication','Export the exact saved version using selected media; does not regenerate images or speech.', { activityId:id, expectedDraftVersion:version, makeVideo:Type.Boolean(), idempotencyKey:Type.String({ minLength:8,maxLength:128 }) }),
  tool('get_publication_task','Read a persisted child/export task owned by this publication.', { activityId:id, taskId:id }),
];
export const StoryHarnessTools = [
  tool('list_proposals','Find project proposals and whether their base revision is stale; never accepts them.', { ...StoryProposalDiscoveryQuerySchema.properties }, []),
  tool('list_entry_revisions','List immutable revision metadata; migration baselines are not historical edits.', { kind:StoryProposalKindSchema, id, ...page }, ['kind','id']),
  tool('read_entry_revision','Read a bounded chunk of an immutable revision belonging to this entry.', { kind:StoryProposalKindSchema,id,revisionId:id,offset:Type.Optional(Type.Integer({ minimum:0 })) }, ['kind','id','revisionId']),
];
