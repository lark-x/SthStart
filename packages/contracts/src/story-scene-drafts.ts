import { Type, type Static } from '@sinclair/typebox';

const strict = { additionalProperties: false };
const id = Type.String({ minLength: 1, maxLength: 200 });
const revision = Type.Integer({ minimum: 1 });
const timestamp = Type.String();
const short = Type.String({ maxLength: 240 });
const detail = Type.String({ maxLength: 2000 });
const markdown = Type.String({ maxLength: 60000 });

export const SceneCharacterSchema = Type.Object({
  id: Type.Optional(id), name: Type.String({ minLength: 1, maxLength: 160, pattern: '\\S' }),
  origin: Type.Union([Type.Literal('gi'), Type.Literal('hsr'), Type.Literal('other'), Type.Literal('original')]),
  work: Type.Optional(short), setting: Type.Optional(detail),
}, strict);
export const SceneAuthorSourceSchema = Type.Object({ title: Type.String({ minLength: 1, maxLength: 240, pattern: '\\S' }), text: Type.String({ minLength: 1, maxLength: 12000, pattern: '\\S' }), locator: Type.Optional(short) }, strict);
export const SceneSourceSchema = Type.Object({
  id, title: short, work: short, locator: Type.String({ maxLength: 1000 }),
  startLine: revision, endLine: revision, excerpt: detail,
  fullText: Type.Optional(Type.String({ maxLength: 60_000 })), fullTextComplete: Type.Optional(Type.Boolean()),
  kind: Type.Union([Type.Literal('canon'), Type.Literal('secondary'), Type.Literal('unknown'), Type.Literal('author')]),
}, strict);
export const SceneEvidenceSchema = Type.Object({
  status: Type.Union([Type.Literal('supported'), Type.Literal('inferred'), Type.Literal('unconfirmed'), Type.Literal('author')]),
  sourceIds: Type.Array(id, { maxItems: 8 }), note: detail,
}, strict);
export const SceneStartSchema = Type.Object({
  candidateId: Type.Optional(id), time: short, location: short, hook: detail,
  timeEvidence: SceneEvidenceSchema, locationEvidence: SceneEvidenceSchema,
}, strict);
export const SceneCandidateSchema = Type.Object({ id, time: short, location: short, hook: detail, timeEvidence: SceneEvidenceSchema, locationEvidence: SceneEvidenceSchema }, strict);
export const SceneDiscoverySchema = Type.Object({
  status: Type.Union([Type.Literal('ready'), Type.Literal('not-configured'), Type.Literal('timeout'), Type.Literal('empty'), Type.Literal('unavailable')]),
  message: detail,
}, strict);
export const SceneDirectionSchema = Type.Union([Type.Literal('canon-gap'), Type.Literal('canon-adaptation'), Type.Literal('if'), Type.Literal('original')]);
export const SceneFormatSchema = Type.Union([Type.Literal('story'), Type.Literal('script')]);
export const SceneBriefSchema = Type.Object({
  viewpoint: short, action: detail, change: detail,
  constraints: Type.Array(detail, { maxItems: 16 }),
  canonEvent: Type.Optional(detail), divergence: Type.Optional(detail),
}, strict);
export const SceneApproachSchema = Type.Object({ id, title: short, description: detail, brief: SceneBriefSchema }, strict);
export const SceneMessageSchema = Type.Object({
  id, role: Type.Union([Type.Literal('author'), Type.Literal('assistant')]), text: Type.String({ maxLength: 8000 }), createdAt: timestamp,
  approaches: Type.Optional(Type.Array(SceneApproachSchema, { maxItems: 3 })), suggestedBrief: Type.Optional(SceneBriefSchema),
}, strict);
export const SceneWritingCandidateSchema = Type.Object({ id, body: markdown, createdAt: timestamp }, strict);
export const SceneImagePlanInputSchema = Type.Object({
  moment: detail, subject: detail, camera: detail, blocking: detail, action: detail, occlusion: detail, style: detail,
  referenceArtifactId: Type.Optional(Type.Union([id, Type.Null()])),
}, strict);
export const SceneImagePlanSchema = Type.Object({ ...SceneImagePlanInputSchema.properties, id, version: revision, bodyVersion: revision }, strict);
export const SceneImageSchema = Type.Object({
  id, taskId: id, bodyVersion: revision, planVersion: revision, createdAt: timestamp,
  status: Type.Union([Type.Literal('queued'), Type.Literal('running'), Type.Literal('uncertain'), Type.Literal('succeeded'), Type.Literal('failed')]),
  artifactId: Type.Optional(id), error: Type.Optional(detail),
}, strict);
export const SceneAdoptionSchema = Type.Object({ worldId: id, projectId: id, documentId: id, href: Type.String(), bodyVersion: revision, createdAt: timestamp }, strict);
export const SceneActionNameSchema = Type.Union([Type.Literal('discover'), Type.Literal('refresh-sources'), Type.Literal('discuss'), Type.Literal('write'), Type.Literal('plan-image'), Type.Literal('generate-image'), Type.Literal('adopt')]);
export const SceneActionSchema = Type.Object({
  id, action: SceneActionNameSchema, inputRevision: revision, idempotencyKey: id, createdAt: timestamp, updatedAt: timestamp,
  status: Type.Union([Type.Literal('running'), Type.Literal('queued'), Type.Literal('succeeded'), Type.Literal('failed'), Type.Literal('stale')]),
  error: Type.Optional(Type.Object({ code: short, message: detail }, strict)), taskId: Type.Optional(id),
  messageId: Type.Optional(id), retryOf: Type.Optional(id),
}, strict);
const progress = Type.Union([Type.Literal('start'), Type.Literal('discuss'), Type.Literal('write'), Type.Literal('image'), Type.Literal('adopted')]);
export const StorySceneSummarySchema = Type.Object({ id, revision, title: short, character: SceneCharacterSchema, progress, createdAt: timestamp, updatedAt: timestamp }, strict);
export const StorySceneDraftSchema = Type.Object({
  ...StorySceneSummarySchema.properties,
  notes: detail, lockedConstraints: Type.Array(detail, { maxItems: 16 }), authorSources: Type.Array(SceneAuthorSourceSchema, { maxItems: 8 }),
  sources: Type.Array(SceneSourceSchema), candidates: Type.Array(SceneCandidateSchema, { maxItems: 3 }),
  start: Type.Union([SceneStartSchema, Type.Null()]), discovery: Type.Union([SceneDiscoverySchema, Type.Null()]),
  direction: Type.Union([SceneDirectionSchema, Type.Null()]), messages: Type.Array(SceneMessageSchema),
  brief: Type.Union([SceneBriefSchema, Type.Null()]), briefConfirmed: Type.Boolean(),
  format: SceneFormatSchema, body: markdown, bodyVersion: revision,
  writingCandidate: Type.Union([SceneWritingCandidateSchema, Type.Null()]),
  imagePlan: Type.Union([SceneImagePlanSchema, Type.Null()]), images: Type.Array(SceneImageSchema),
  adoption: Type.Union([SceneAdoptionSchema, Type.Null()]), currentAction: Type.Union([SceneActionSchema, Type.Null()]),
  forkedFrom: Type.Optional(id),
}, strict);

const editableStart = Type.Object({ candidateId: Type.Optional(id), time: short, location: short, hook: Type.Optional(detail) }, strict);
export const CreateStorySceneDraftSchema = Type.Union([
  Type.Object({ idempotencyKey: id, character: SceneCharacterSchema, title: Type.Optional(short), notes: Type.Optional(detail), start: Type.Optional(editableStart) }, strict),
  Type.Object({ idempotencyKey: id, forkFrom: id, direction: Type.Optional(SceneDirectionSchema) }, strict),
]);
export const PatchStorySceneDraftSchema = Type.Object({
  expectedRevision: revision, title: Type.Optional(short), notes: Type.Optional(detail),
  lockedConstraints: Type.Optional(Type.Array(detail, { maxItems: 16 })), authorSources: Type.Optional(Type.Array(SceneAuthorSourceSchema, { maxItems: 8 })),
  start: Type.Optional(Type.Union([editableStart, Type.Null()])), direction: Type.Optional(Type.Union([SceneDirectionSchema, Type.Null()])),
  brief: Type.Optional(Type.Union([SceneBriefSchema, Type.Null()])), briefConfirmed: Type.Optional(Type.Boolean()), format: Type.Optional(SceneFormatSchema),
  body: Type.Optional(markdown), writingCandidateDecision: Type.Optional(Type.Object({ id, decision: Type.Union([Type.Literal('accept'), Type.Literal('discard')]) }, strict)),
  imagePlan: Type.Optional(SceneImagePlanInputSchema),
}, strict);
const actionBase = { expectedRevision: revision, idempotencyKey: id, retryOf: Type.Optional(id) };
export const StorySceneActionRequestSchema = Type.Union([
  Type.Object({ ...actionBase, action: Type.Literal('discover'), hypothesis: Type.Optional(Type.Boolean()) }, strict),
  Type.Object({ ...actionBase, action: Type.Literal('refresh-sources') }, strict),
  Type.Object({ ...actionBase, action: Type.Literal('discuss'), message: Type.Optional(Type.String({ minLength: 1, maxLength: 8000, pattern: '\\S' })) }, strict),
  Type.Object({ ...actionBase, action: Type.Literal('write'), instruction: Type.Optional(detail) }, strict),
  Type.Object({ ...actionBase, action: Type.Literal('plan-image'), instruction: Type.Optional(detail) }, strict),
  Type.Object({ ...actionBase, action: Type.Literal('generate-image'), configId: Type.Optional(id) }, strict),
  Type.Object({ ...actionBase, action: Type.Literal('adopt'), worldId: id, projectId: Type.Optional(id) }, strict),
]);
export const StorySceneActionResponseSchema = Type.Object({ draft: StorySceneDraftSchema, action: SceneActionSchema }, strict);
export const StorySceneListSchema = Type.Object({ items: Type.Array(StorySceneSummarySchema), nextCursor: Type.Union([Type.String(), Type.Null()]) }, strict);

export type SceneCharacter = Static<typeof SceneCharacterSchema>;
export type SceneSource = Static<typeof SceneSourceSchema>;
export type SceneCandidate = Static<typeof SceneCandidateSchema>;
export type SceneDiscovery = Static<typeof SceneDiscoverySchema>;
export type SceneEvidence = Static<typeof SceneEvidenceSchema>;
export type SceneDirection = Static<typeof SceneDirectionSchema>;
export type SceneBrief = Static<typeof SceneBriefSchema>;
export type SceneApproach = Static<typeof SceneApproachSchema>;
export type SceneMessage = Static<typeof SceneMessageSchema>;
export type SceneImagePlanInput = Static<typeof SceneImagePlanInputSchema>;
export type SceneImage = Static<typeof SceneImageSchema>;
export type SceneAdoption = Static<typeof SceneAdoptionSchema>;
export type SceneAction = Static<typeof SceneActionSchema>;
export type StorySceneSummary = Static<typeof StorySceneSummarySchema>;
export type StorySceneDraft = Static<typeof StorySceneDraftSchema>;
export type CreateStorySceneDraft = Static<typeof CreateStorySceneDraftSchema>;
export type PatchStorySceneDraft = Static<typeof PatchStorySceneDraftSchema>;
export type StorySceneActionRequest = Static<typeof StorySceneActionRequestSchema>;
export type StorySceneActionResponse = Static<typeof StorySceneActionResponseSchema>;
export type StorySceneList = Static<typeof StorySceneListSchema>;
