import { Type, type Static } from '@sinclair/typebox';
import {
  StoryWorldSchema, WorldActorSchema, WorldBranchModeSchema, WorldBranchSchema,
  WorldDefinitionSchema, WorldLocationSchema,
} from './story-worlds.js';

const strict = { additionalProperties: false };
export const InitialWorldBranchSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }), mode: WorldBranchModeSchema,
  direction: Type.String({ maxLength: 8000 }),
}, strict);
export const WorldAuthoringDraftSchema = Type.Object({
  definition: Type.Object({
    ...WorldDefinitionSchema.properties,
    title: Type.String({ maxLength: 200 }),
    actors: Type.Array(WorldActorSchema, { maxItems: 100 }),
    locations: Type.Array(WorldLocationSchema, { maxItems: 100 }),
  }, strict),
  initialBranch: InitialWorldBranchSchema,
}, strict);
export type WorldAuthoringDraft = Static<typeof WorldAuthoringDraftSchema>;
export const CreateWorldBundleSchema = Type.Object({
  idempotencyKey: Type.String({ minLength: 1, maxLength: 160 }),
  definition: WorldDefinitionSchema, initialBranch: InitialWorldBranchSchema,
}, strict);
export type CreateWorldBundle = Static<typeof CreateWorldBundleSchema>;
export const WorldBundleResultSchema = Type.Object({ world: StoryWorldSchema, branch: WorldBranchSchema }, strict);
export type WorldBundleResult = Static<typeof WorldBundleResultSchema>;
export const CreateWorldSetupSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  idempotencyKey: Type.String({ minLength: 1, maxLength: 160 }),
  workNature: Type.Optional(Type.Union([Type.Literal('canon'), Type.Literal('derivative'), Type.Literal('original')])),
  parentWork: Type.Optional(Type.Union([Type.String({ maxLength: 200 }), Type.Null()])),
}, strict);
export type CreateWorldSetup = Static<typeof CreateWorldSetupSchema>;
export const WorldSetupSummarySchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 160 }), title: Type.String({ minLength: 1, maxLength: 200 }),
  workNature: Type.Optional(Type.Union([Type.Literal('canon'), Type.Literal('derivative'), Type.Literal('original')])),
  parentWork: Type.Optional(Type.Union([Type.String({ maxLength: 200 }), Type.Null()])),
}, strict);
export const WorldSetupListSchema = Type.Object({ items: Type.Array(WorldSetupSummarySchema) }, strict);
export type WorldSetupList = Static<typeof WorldSetupListSchema>;
export const WorldSetupSchema = Type.Object({
  id: WorldSetupSummarySchema.properties.id,
  revision: Type.Integer({ minimum: 1 }),
  draft: WorldAuthoringDraftSchema,
}, strict);
export type WorldSetup = Static<typeof WorldSetupSchema>;
export const UpdateWorldSetupSchema = Type.Object({
  expectedRevision: WorldSetupSchema.properties.revision, draft: WorldAuthoringDraftSchema,
  complete: Type.Boolean(),
}, strict);
export type UpdateWorldSetup = Static<typeof UpdateWorldSetupSchema>;
export const WorldSetupResultSchema = Type.Union([
  Type.Object({ status: Type.Literal('pending'), setup: WorldSetupSchema }, strict),
  Type.Object({ status: Type.Literal('ready'), ...WorldBundleResultSchema.properties }, strict),
]);
export type WorldSetupResult = Static<typeof WorldSetupResultSchema>;
export const UpdateWorldBranchSchema = Type.Object({
  expectedRevision: Type.Integer({ minimum: 1 }), ...InitialWorldBranchSchema.properties,
}, strict);
export type UpdateWorldBranch = Static<typeof UpdateWorldBranchSchema>;
export const WorldSuggestionTargetSchema = Type.Union([
  Type.Literal('title'), Type.Literal('summary'), Type.Literal('timeLabel'),
  Type.Literal('startMinuteOfDay'), Type.Literal('visualStyle'), Type.Literal('lockedFacts'),
  Type.Literal('actor'), Type.Literal('location'), Type.Literal('direction'),
]);
export const WorldSuggestionCandidateSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 160 }), target: WorldSuggestionTargetSchema,
  entityId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  value: Type.Union([
    Type.String({ maxLength: 20000 }), Type.Integer({ minimum: 0, maximum: 1439 }),
    Type.Array(Type.String({ maxLength: 3000 }), { maxItems: 100 }), WorldActorSchema, WorldLocationSchema,
  ]),
  sourceIds: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 100 }),
  dependsOn: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 30 }),
  note: Type.String({ maxLength: 2000 }),
}, strict);
export type WorldSuggestionCandidate = Static<typeof WorldSuggestionCandidateSchema>;
export const WorldSuggestionRequestSchema = Type.Object({
  draft: WorldAuthoringDraftSchema, instruction: Type.String({ minLength: 1, maxLength: 8000 }),
  scope: Type.Union([Type.Literal('all'), Type.Literal('world'), Type.Literal('actors'), Type.Literal('locations'), Type.Literal('direction')]),
  draftFingerprint: Type.String({ minLength: 1, maxLength: 160 }),
}, strict);
export type WorldSuggestionRequest = Static<typeof WorldSuggestionRequestSchema>;
export const WorldSuggestionResponseSchema = Type.Object({
  draftFingerprint: Type.String({ minLength: 1, maxLength: 160 }),
  candidates: Type.Array(WorldSuggestionCandidateSchema, { maxItems: 30 }),
  gaps: Type.Array(Type.String({ maxLength: 2000 }), { maxItems: 30 }),
}, strict);
export type WorldSuggestionResponse = Static<typeof WorldSuggestionResponseSchema>;
