import { Type, type Static } from '@sinclair/typebox';
import { CoverArtifactIdFieldSchema } from './covers.js';

const id = Type.String({ minLength: 1, maxLength: 160 });
const text = (maxLength = 20000) => Type.String({ maxLength });
const tick = Type.Integer({ minimum: 0 });
const revision = Type.Integer({ minimum: 1 });
const nullableId = Type.Union([id, Type.Null()]);
const strict = { additionalProperties: false };
export const WorldSourceNatureSchema = Type.Union([Type.Literal('canon'), Type.Literal('author'), Type.Literal('ai'), Type.Literal('unverified')]);
export const WorldBranchModeSchema = Type.Union([Type.Literal('canon-gap'), Type.Literal('adaptation'), Type.Literal('alternate')]);
export const WorldSourceSchema = Type.Object({
  id, title: text(300), nature: WorldSourceNatureSchema, content: text(100000),
  sourceUrl: text(2000), sourceVersion: text(200), capturedAt: Type.String(),
}, strict);
export const WorldRegionSchema = Type.Object({
  id,
  name: text(200),
  description: Type.Optional(text(3000)),
}, strict);
export type WorldRegion = Static<typeof WorldRegionSchema>;

export const WorldFactionSchema = Type.Object({
  id,
  name: text(200),
  description: Type.Optional(text(3000)),
  alignment: Type.Optional(text(200)),
}, strict);
export type WorldFaction = Static<typeof WorldFactionSchema>;

export const WorldLocationSchema = Type.Object({
  id,
  name: text(200),
  description: text(5000),
  region: Type.Optional(text(200)),
  regionId: Type.Optional(id),
  parentLocationId: Type.Optional(nullableId),
  tier: Type.Optional(Type.Union([Type.Literal('region'), Type.Literal('sublocation')])),
}, strict);
/**
 * 场景/重要道具的画面参考设定。仅用于配图一致性，不作为世界事实或角色记忆写入。
 * locationId 对场景锚点可省略：省略时用 id 匹配地点，便于直接复用地点 ID。
 */
export const WorldVisualReferenceKindSchema = Type.Union([Type.Literal('location'), Type.Literal('prop')]);
export const WorldVisualReferenceSchema = Type.Object({
  id, name: text(200), kind: WorldVisualReferenceKindSchema,
  locationId: Type.Optional(id), description: text(5000),
  referenceArtifactIds: Type.Array(id, { maxItems: 10 }),
}, strict);
export type WorldVisualReference = Static<typeof WorldVisualReferenceSchema>;
export type WorldVisualReferenceKind = Static<typeof WorldVisualReferenceKindSchema>;
export const WorldActorSchema = Type.Object({
  id, name: text(200), role: Type.Union([Type.Literal('main'), Type.Literal('supporting')]),
  faction: Type.Optional(text(200)),
  factionId: Type.Optional(id),
  regionId: Type.Optional(nullableId),
  characterVariantId: Type.Optional(id), characterCostumeAssetId: Type.Optional(id),
  characterId: nullableId, characterVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  background: text(), personality: text(8000), speechStyle: text(4000), appearance: text(5000),
  goals: Type.Array(text(1000), { maxItems: 30 }), locationId: id,
  referenceArtifactIds: Type.Array(id, { maxItems: 10 }),
}, strict);
export const WorldModelBindingsSchema = Type.Object({
  action: nullableId, adjudication: nullableId, narration: nullableId,
}, strict);
export type WorldActor = Static<typeof WorldActorSchema>;
export type WorldLocation = Static<typeof WorldLocationSchema>;
export type WorldSource = Static<typeof WorldSourceSchema>;
export type WorldModelBindings = Static<typeof WorldModelBindingsSchema>;
export type WorldBranchMode = Static<typeof WorldBranchModeSchema>;
export type WorldSourceNature = Static<typeof WorldSourceNatureSchema>;
export const WorldDefinitionSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }), summary: text(), timeLabel: text(200),
  workNature: Type.Optional(Type.Union([Type.Literal('canon'), Type.Literal('derivative'), Type.Literal('original')])),
  parentWork: Type.Optional(Type.Union([Type.String({ maxLength: 200 }), Type.Null()])),
  narrativeMode: Type.Optional(Type.Union([Type.Literal('quest-chapter'), Type.Literal('sandbox-tick')])),
  regions: Type.Optional(Type.Array(WorldRegionSchema, { maxItems: 100 })),
  factions: Type.Optional(Type.Array(WorldFactionSchema, { maxItems: 100 })),
  /** 世界起点对应的日内分钟（0=00:00，1439=23:59）；缺省表示未定义，不推测昼夜。 */
  startMinuteOfDay: Type.Optional(Type.Integer({ minimum: 0, maximum: 1439 })),
  locations: Type.Array(WorldLocationSchema, { minItems: 1, maxItems: 100 }),
  visualReferences: Type.Optional(Type.Array(WorldVisualReferenceSchema, { maxItems: 100 })),
  actors: Type.Array(WorldActorSchema, { minItems: 1, maxItems: 100 }),
  sources: Type.Array(WorldSourceSchema, { maxItems: 100 }),
  lockedFacts: Type.Array(text(3000), { maxItems: 100 }), models: WorldModelBindingsSchema,
  visualStyle: text(8000),
}, strict);
export type WorldDefinition = Static<typeof WorldDefinitionSchema>;
/** `coverArtifactId` 是实体元数据而非 definition：保存世界时必须和 id/revision 一样剔除（见 STORY_WORLD_METADATA_KEYS）。 */
export const StoryWorldSchema = Type.Object({ ...WorldDefinitionSchema.properties, id, revision, coverArtifactId: CoverArtifactIdFieldSchema, createdAt: Type.String(), updatedAt: Type.String() }, strict);
/** StoryWorld 上不属于 WorldDefinition 的字段；从世界还原 definition 时统一剔除。 */
export const STORY_WORLD_METADATA_KEYS: readonly string[] = ['id', 'revision', 'coverArtifactId', 'createdAt', 'updatedAt'];
export type StoryWorld = Static<typeof StoryWorldSchema>;
export const CreateStoryWorldSchema = WorldDefinitionSchema;
export const UpdateStoryWorldSchema = Type.Object({ expectedRevision: revision, definition: WorldDefinitionSchema }, strict);
export const WorldActorStateSchema = Type.Object({
  actorId: id, locationId: id, goals: Type.Array(text(1000)), emotion: text(2000),
  relationships: Type.Array(Type.Object({ actorId: id, description: text(2000), sourceEventId: nullableId }, strict)),
  updatedTick: tick,
}, strict);
export type WorldActorState = Static<typeof WorldActorStateSchema>;
export const WorldBranchSchema = Type.Object({
  id, worldId: id, title: text(200), mode: WorldBranchModeSchema,
  parentBranchId: nullableId, forkTick: tick, currentTick: tick, revision,
  sourceRevision: revision, direction: text(8000), createdAt: Type.String(), updatedAt: Type.String(),
}, strict);
export type WorldBranch = Static<typeof WorldBranchSchema>;
export const CreateWorldBranchSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }), mode: WorldBranchModeSchema,
  direction: text(8000), expectedRevision: revision,
  parentBranchId: Type.Optional(id), forkTick: Type.Optional(tick),
}, strict);
export const WorldMemorySchema = Type.Object({
  id, worldId: id, branchId: id, actorId: id, sourceEventId: id, learnedAt: tick,
  kind: Type.Union([Type.Literal('experienced'), Type.Literal('heard'), Type.Literal('inferred'), Type.Literal('mistaken')]),
  content: text(5000), importance: Type.Number({ minimum: 0, maximum: 1 }), fromActorId: nullableId,
}, strict);
export type WorldMemory = Static<typeof WorldMemorySchema>;
export const WorldFactSchema = Type.Object({
  id, content: text(5000), knownBy: Type.Array(id), nature: WorldSourceNatureSchema,
}, strict);
export const WorldPerspectiveSchema = Type.Object({ actorId: id, text: text(30000) }, strict);
export const WorldEventSchema = Type.Object({
  id, worldId: id, branchId: id, tick, duration: tick, title: text(300), summary: text(5000),
  locationId: id, participantIds: Type.Array(id, { minItems: 1 }),
  facts: Type.Array(WorldFactSchema, { maxItems: 30 }), perspectives: Type.Array(WorldPerspectiveSchema),
  causeEventIds: Type.Array(id), storyLineIds: Type.Array(id),
  stateChanges: Type.Array(WorldActorStateSchema), createdAt: Type.String(),
}, strict);
export type WorldEvent = Static<typeof WorldEventSchema>;
export const WorldStoryLineArcKindSchema = Type.Union([
  Type.Literal('canon-chapter'),
  Type.Literal('main'),
  Type.Literal('quest'),
  Type.Literal('companion'),
  Type.Literal('side'),
]);
export type WorldStoryLineArcKind = Static<typeof WorldStoryLineArcKindSchema>;

export const WorldStoryLineStatusSchema = Type.Union([
  Type.Literal('planned'),
  Type.Literal('active'),
  Type.Literal('completed'),
]);
export type WorldStoryLineStatus = Static<typeof WorldStoryLineStatusSchema>;

export const WorldStoryLineSchema = Type.Object({
  id, worldId: id, branchId: id, title: text(200), description: text(3000), actorIds: Type.Array(id),
  arcKind: Type.Optional(WorldStoryLineArcKindSchema),
  chapterCode: Type.Optional(text(120)),
  mcpQueryHint: Type.Optional(text(300)),
  timeWindowLabel: Type.Optional(text(200)),
  regionIds: Type.Optional(Type.Array(id, { maxItems: 50 })),
  locationIds: Type.Optional(Type.Array(id, { maxItems: 50 })),
  status: Type.Optional(WorldStoryLineStatusSchema),
  orderIndex: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000 })),
  chapterIds: Type.Optional(Type.Array(id, { maxItems: 200 })),
}, strict);
export type WorldStoryLine = Static<typeof WorldStoryLineSchema>;
export const CreateWorldStoryLineSchema = Type.Object({
  expectedRevision: revision, title: text(200), description: text(3000), actorIds: Type.Array(id),
  arcKind: Type.Optional(WorldStoryLineArcKindSchema),
  chapterCode: Type.Optional(text(120)),
  mcpQueryHint: Type.Optional(text(300)),
  timeWindowLabel: Type.Optional(text(200)),
  regionIds: Type.Optional(Type.Array(id, { maxItems: 50 })),
  locationIds: Type.Optional(Type.Array(id, { maxItems: 50 })),
  status: Type.Optional(WorldStoryLineStatusSchema),
  orderIndex: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000 })),
  chapterIds: Type.Optional(Type.Array(id, { maxItems: 200 })),
}, strict);
export const WorldRunSettingsSchema = Type.Object({
  durationTicks: Type.Integer({ minimum: 1, maximum: 10080, default: 1440 }),
  stepTicks: Type.Integer({ minimum: 1, maximum: 1440, default: 60 }),
  maxTextCalls: Type.Integer({ minimum: 1, maximum: 10000, default: 120 }),
  maxImages: Type.Integer({ minimum: 0, maximum: 100, default: 12 }),
  autoImages: Type.Boolean({ default: false }),
  imageConfig: Type.Optional(Type.Object({ engineId: id, workflowId: Type.Optional(id), model: Type.Optional(text(300)) }, strict)),
}, strict);
export type WorldRunSettings = Static<typeof WorldRunSettingsSchema>;
export const WorldRunSchema = Type.Object({
  id, worldId: id, branchId: id, status: Type.Union([
    Type.Literal('queued'), Type.Literal('running'), Type.Literal('paused'), Type.Literal('completed'), Type.Literal('uncertain'), Type.Literal('failed'),
  ]), settings: WorldRunSettingsSchema, startTick: tick, targetTick: tick, completedTick: tick,
  textCallsUsed: tick, imagesSubmitted: tick, pauseReason: text(5000),
  createdAt: Type.String(), updatedAt: Type.String(),
}, strict);
export type WorldRun = Static<typeof WorldRunSchema>;
export const StartWorldRunSchema = Type.Object({ expectedRevision: revision, idempotencyKey: id, settings: WorldRunSettingsSchema }, strict);
export const WorldRevisionRequestSchema = Type.Object({ expectedRevision: revision }, strict);
export const ResumeWorldRunSchema = Type.Object({ expectedRevision: revision, settings: Type.Optional(WorldRunSettingsSchema) }, strict);
export type ResumeWorldRun = Static<typeof ResumeWorldRunSchema>;
export const WorldInterventionSchema = Type.Object({
  id, worldId: id, branchId: id, tick, kind: Type.Union([Type.Literal('goal'), Type.Literal('constraint'), Type.Literal('external-event')]),
  actorIds: Type.Array(id), instruction: text(8000), consumed: Type.Boolean(), createdAt: Type.String(),
}, strict);
export type WorldIntervention = Static<typeof WorldInterventionSchema>;
export const CreateWorldInterventionSchema = Type.Object({
  expectedRevision: revision, tick, kind: WorldInterventionSchema.properties.kind,
  actorIds: Type.Array(id), instruction: Type.String({ minLength: 1, maxLength: 8000 }),
}, strict);
export const WorldImageSchema = Type.Object({
  id, worldId: id, branchId: id, eventId: id, runId: nullableId,
  phase: Type.Union([Type.Literal('establishing'), Type.Literal('action'), Type.Literal('result')]),
  caption: text(2000), prompt: text(10000), negativePrompt: text(5000),
  status: Type.Union([Type.Literal('planned'), Type.Literal('queued'), Type.Literal('running'), Type.Literal('succeeded'), Type.Literal('failed'), Type.Literal('uncertain'), Type.Literal('stale')]),
  generationTaskId: nullableId, artifactId: nullableId, imageUrl: Type.Union([Type.String(), Type.Null()]),
  error: text(5000), referenceArtifactIds: Type.Array(id), consistencyNote: text(3000), createdAt: Type.String(),
}, strict);
export type WorldImage = Static<typeof WorldImageSchema>;
export const PlanWorldImagesSchema = Type.Object({ expectedRevision: revision, eventIds: Type.Array(id, { minItems: 1, maxItems: 12 }) }, strict);
export const SubmitWorldImageSchema = Type.Object({
  expectedRevision: revision, idempotencyKey: id, engineId: id,
  workflowId: Type.Optional(id), model: Type.Optional(text(300)), runId: Type.Optional(id),
}, strict);
export const WorldAdoptionSchema = Type.Object({
  expectedRevision: revision, idempotencyKey: id, projectId: id, eventIds: Type.Array(id, { minItems: 1, maxItems: 100 }),
  actorId: Type.Optional(id), title: Type.String({ minLength: 1, maxLength: 300 }),
}, strict);
export const WorldAdoptionResultSchema = Type.Object({ projectId: id, documentId: id, sourceBranchId: id, sourceRevision: revision }, strict);
export const WorldProjectBindingSchema = Type.Object({ projectId: id, worldId: id, branchId: id, sourceRevision: revision }, strict);
export type WorldProjectBinding = Static<typeof WorldProjectBindingSchema>;
export const BindWorldProjectSchema = Type.Object({
  projectId: id, expectedRevision: revision,
  expectedBinding: Type.Optional(Type.Union([WorldProjectBindingSchema, Type.Null()])),
}, strict);
export type BindWorldProject = Static<typeof BindWorldProjectSchema>;
export type WorldAdoptionResult = Static<typeof WorldAdoptionResultSchema>;
export const WorldEventQuerySchema = Type.Object({
  from: Type.Optional(tick), to: Type.Optional(tick), cursor: Type.Optional(text(1000)),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })), actorId: Type.Optional(id), storyLineId: Type.Optional(id),
}, strict);
export type WorldEventQuery = Static<typeof WorldEventQuerySchema>;
export const WorldEventPageSchema = Type.Object({
  items: Type.Array(WorldEventSchema), nextCursor: Type.Union([Type.String(), Type.Null()]),
  total: tick, from: tick, to: tick,
  buckets: Type.Array(Type.Object({ from: tick, to: tick, count: tick }, strict)),
}, strict);
export type WorldEventPage = Static<typeof WorldEventPageSchema>;
export const WorldOverviewSchema = Type.Object({ world: StoryWorldSchema, branches: Type.Array(WorldBranchSchema) }, strict);
export type WorldOverview = Static<typeof WorldOverviewSchema>;
export const WorldBranchDetailSchema = Type.Object({
  branch: WorldBranchSchema, definition: WorldDefinitionSchema, states: Type.Array(WorldActorStateSchema),
  storyLines: Type.Array(WorldStoryLineSchema), run: Type.Union([WorldRunSchema, Type.Null()]),
  interventions: Type.Array(WorldInterventionSchema), images: Type.Array(WorldImageSchema), sourceUpdatesAvailable: Type.Boolean(),
}, strict);
export type WorldBranchDetail = Static<typeof WorldBranchDetailSchema>;
export const WorldListSchema = Type.Object({ items: Type.Array(StoryWorldSchema) }, strict);
export const WorldMemoryListSchema = Type.Object({ items: Type.Array(WorldMemorySchema) }, strict);
export const WorldImageListSchema = Type.Object({ items: Type.Array(WorldImageSchema) }, strict);
export type CreateWorldBranch = Static<typeof CreateWorldBranchSchema>;
export type CreateWorldIntervention = Static<typeof CreateWorldInterventionSchema>;
export type StartWorldRun = Static<typeof StartWorldRunSchema>;
export type PlanWorldImages = Static<typeof PlanWorldImagesSchema>;
export type SubmitWorldImage = Static<typeof SubmitWorldImageSchema>;
export type WorldAdoption = Static<typeof WorldAdoptionSchema>;
export type CreateWorldStoryLine = Static<typeof CreateWorldStoryLineSchema>;
export type WorldList = Static<typeof WorldListSchema>;
export type WorldMemoryList = Static<typeof WorldMemoryListSchema>;
export type WorldImageList = Static<typeof WorldImageListSchema>;
export type WorldRevisionRequest = Static<typeof WorldRevisionRequestSchema>;
export type WorldFact = Static<typeof WorldFactSchema>;
export type WorldPerspective = Static<typeof WorldPerspectiveSchema>;
export const DEFAULT_WORLD_RUN_SETTINGS: WorldRunSettings = { durationTicks: 1440, stepTicks: 60, maxTextCalls: 120, maxImages: 12, autoImages: false };
