import { Type, type Static } from '@sinclair/typebox';
import {
  CreativeCharacterVoiceSchema,
  CreativeStyleGuideSchema,
} from './creative-orchestration.js';
import {
  StoryWorldSchema,
  WorldActorStateSchema,
  WorldBranchSchema,
  WorldDefinitionSchema,
  WorldImageSchema,
  WorldStoryLineSchema,
} from './story-worlds.js';

const id = Type.String({ minLength: 1, maxLength: 160 });
const text = (maxLength = 20000) => Type.String({ maxLength });

export const WorldHubDocSummarySchema = Type.Object({
  id,
  kind: Type.Union([
    Type.Literal('outline'),
    Type.Literal('world'),
    Type.Literal('chapter'),
    Type.Literal('scene'),
  ]),
  title: text(300),
  body: text(100000),
  position: Type.Integer({ minimum: 0 }),
  revision: Type.Integer({ minimum: 1 }),
  updatedAt: Type.String(),
  wordCount: Type.Integer({ minimum: 0 }),
});
export type WorldHubDocSummary = Static<typeof WorldHubDocSummarySchema>;

export const WorldHubLinkedProjectSchema = Type.Object({
  project: Type.Object({
    id,
    title: text(200),
    summary: text(4000),
    workId: Type.Union([text(200), Type.Null()]),
    projectType: Type.Union([Type.Literal('fiction'), Type.Literal('reflection')]),
    revision: Type.Integer({ minimum: 1 }),
    updatedAt: Type.String(),
  }),
  bindingRevision: Type.Integer({ minimum: 0 }),
  outline: Type.Union([WorldHubDocSummarySchema, Type.Null()]),
  chapters: Type.Array(WorldHubDocSummarySchema),
  worldDocs: Type.Array(WorldHubDocSummarySchema),
});
export type WorldHubLinkedProject = Static<typeof WorldHubLinkedProjectSchema>;

export const WorldHubCharacterCardSchema = Type.Object({
  id,
  displayName: text(120),
  englishName: text(160),
  originType: Type.Union([Type.Literal('ip'), Type.Literal('derivative'), Type.Literal('original')]),
  summary: text(2000),
  personaText: text(20000),
  speechText: text(8000),
  dialogueExamples: Type.Array(text(800)),
  behaviorRules: text(8000),
  appearance: Type.Object({
    baseText: text(8000),
    defaultOutfitText: text(8000),
  }),
  tags: Type.Array(text(80)),
  avatarUrl: Type.Union([text(500), Type.Null()]),
  latestVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
});
export type WorldHubCharacterCard = Static<typeof WorldHubCharacterCardSchema>;

export const WorldHubScopePolicySchema = Type.Object({
  revision: Type.Integer({ minimum: 0 }),
  styleGuide: Type.Optional(CreativeStyleGuideSchema),
  characterVoices: Type.Optional(Type.Record(Type.String({ minLength: 1, maxLength: 160 }), CreativeCharacterVoiceSchema)),
});
export type WorldHubScopePolicy = Static<typeof WorldHubScopePolicySchema>;

export const WorldHubRecentRunSchema = Type.Object({
  id,
  status: text(60),
  instruction: text(20000),
  branchId: Type.Union([id, Type.Null()]),
  projectId: Type.Union([id, Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type WorldHubRecentRun = Static<typeof WorldHubRecentRunSchema>;

export const WorldHubMcpSourceSummarySchema = Type.Object({
  id,
  name: text(200),
  purpose: text(1000),
  allowedTools: Type.Array(text(120)),
  discoveredTools: Type.Array(text(120)),
  universal: Type.Boolean(),
});
export type WorldHubMcpSourceSummary = Static<typeof WorldHubMcpSourceSummarySchema>;

export const WorldMcpLookupRequestSchema = Type.Object({
  sourceId: Type.Optional(id),
  query: Type.String({ minLength: 1, maxLength: 300 }),
  chapterTitle: Type.Optional(text(200)),
  toolName: Type.Optional(text(120)),
}, { additionalProperties: false });
export type WorldMcpLookupRequest = Static<typeof WorldMcpLookupRequestSchema>;

export const WorldMcpLookupItemSchema = Type.Object({
  title: text(300),
  excerpt: text(8000),
  locator: Type.Optional(text(500)),
});
export type WorldMcpLookupItem = Static<typeof WorldMcpLookupItemSchema>;

export const WorldMcpLookupResponseSchema = Type.Object({
  sourceId: id,
  sourceName: text(200),
  toolUsed: text(120),
  items: Type.Array(WorldMcpLookupItemSchema),
  rawText: text(20000),
});
export type WorldMcpLookupResponse = Static<typeof WorldMcpLookupResponseSchema>;

export const WorldHubSchema = Type.Object({
  world: StoryWorldSchema,
  branches: Type.Array(WorldBranchSchema),
  activeBranch: Type.Union([WorldBranchSchema, Type.Null()]),
  definition: Type.Union([WorldDefinitionSchema, Type.Null()]),
  storyLines: Type.Array(WorldStoryLineSchema),
  states: Type.Array(WorldActorStateSchema),
  images: Type.Array(WorldImageSchema),
  eventCount: Type.Integer({ minimum: 0 }),
  memoryCount: Type.Integer({ minimum: 0 }),
  linkedProjects: Type.Array(WorldHubLinkedProjectSchema),
  characterCards: Type.Array(WorldHubCharacterCardSchema),
  scopePolicy: Type.Union([WorldHubScopePolicySchema, Type.Null()]),
  recentRuns: Type.Array(WorldHubRecentRunSchema),
  mcpSources: Type.Optional(Type.Array(WorldHubMcpSourceSummarySchema)),
});
export type WorldHub = Static<typeof WorldHubSchema>;

export const WorldMcpReadRequestSchema = Type.Object({
  sourceId: Type.Optional(id),
  locator: Type.String({ minLength: 1, maxLength: 500 }),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 300 })),
  toolName: Type.Optional(text(120)),
}, { additionalProperties: false });
export type WorldMcpReadRequest = Static<typeof WorldMcpReadRequestSchema>;

export const WorldMcpReadResponseSchema = Type.Object({
  sourceId: id,
  sourceName: text(200),
  toolUsed: text(120),
  locator: text(500),
  title: text(300),
  content: text(40000),
  startOffset: Type.Integer({ minimum: 0 }),
  endOffset: Type.Integer({ minimum: 0 }),
  totalLines: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  hasMore: Type.Boolean(),
});
export type WorldMcpReadResponse = Static<typeof WorldMcpReadResponseSchema>;

export const WorldManuscriptCreateDocSchema = Type.Object({
  branchId: Type.Optional(id),
  projectId: Type.Optional(id),
  kind: Type.Optional(Type.Union([Type.Literal('chapter'), Type.Literal('scene')])),
  title: Type.String({ minLength: 1, maxLength: 120 }),
  body: Type.Optional(text(100000)),
}, { additionalProperties: false });
export type WorldManuscriptCreateDoc = Static<typeof WorldManuscriptCreateDocSchema>;

export const WorldManuscriptSaveDocSchema = Type.Object({
  projectId: id,
  expectedRevision: Type.Integer({ minimum: 1 }),
  title: Type.String({ minLength: 1, maxLength: 120 }),
  body: text(100000),
}, { additionalProperties: false });
export type WorldManuscriptSaveDoc = Static<typeof WorldManuscriptSaveDocSchema>;

export const WorldManuscriptDocResponseSchema = Type.Object({
  projectId: id,
  document: WorldHubDocSummarySchema,
});
export type WorldManuscriptDocResponse = Static<typeof WorldManuscriptDocResponseSchema>;

export const WorldManuscriptDeleteQuerySchema = Type.Object({
  projectId: Type.Optional(id),
}, { additionalProperties: false });
export type WorldManuscriptDeleteQuery = Static<typeof WorldManuscriptDeleteQuerySchema>;

export const WorldManuscriptDeleteResponseSchema = Type.Object({
  projectId: id,
  deletedId: id,
});
export type WorldManuscriptDeleteResponse = Static<typeof WorldManuscriptDeleteResponseSchema>;

export const WorldCopilotReferenceSchema = Type.Object({
  title: text(300),
  locator: Type.Optional(text(500)),
  excerpt: text(8000),
}, { additionalProperties: false });
export type WorldCopilotReference = Static<typeof WorldCopilotReferenceSchema>;

export const WorldChapterCopilotModeSchema = Type.Union([
  Type.Literal('beats'),
  Type.Literal('turn'),
  Type.Literal('draft'),
  Type.Literal('polish'),
  Type.Literal('check'),
]);
export type WorldChapterCopilotMode = Static<typeof WorldChapterCopilotModeSchema>;

export const WorldChapterCopilotRequestSchema = Type.Object({
  mode: WorldChapterCopilotModeSchema,
  action: Type.Optional(text(2000)),
  branchId: Type.Optional(id),
  arcId: Type.Optional(id),
  chapterTitle: Type.Optional(text(200)),
  instruction: Type.Optional(text(8000)),
  beats: Type.Optional(Type.Array(text(1000), { maxItems: 12 })),
  actorIds: Type.Optional(Type.Array(id, { maxItems: 20 })),
  locationId: Type.Optional(id),
  existingBody: Type.Optional(text(100000)),
  references: Type.Optional(Type.Array(WorldCopilotReferenceSchema, { maxItems: 10 })),
  targetWordCount: Type.Optional(Type.Integer({ minimum: 300, maximum: 8000 })),
}, { additionalProperties: false });
export type WorldChapterCopilotRequest = Static<typeof WorldChapterCopilotRequestSchema>;

export const WorldCopilotIssueSchema = Type.Object({
  severity: Type.Union([Type.Literal('warning'), Type.Literal('suggestion')]),
  category: Type.Union([
    Type.Literal('canon'),
    Type.Literal('tom'),
    Type.Literal('voice'),
    Type.Literal('style'),
  ]),
  quote: Type.Optional(text(500)),
  detail: text(2000),
});
export type WorldCopilotIssue = Static<typeof WorldCopilotIssueSchema>;

export const WorldChapterCopilotResponseSchema = Type.Object({
  mode: WorldChapterCopilotModeSchema,
  modelUsed: text(200),
  beats: Type.Array(text(1000)),
  choices: Type.Array(text(500), { maxItems: 2 }),
  prose: text(100000),
  issues: Type.Array(WorldCopilotIssueSchema),
  extractedFacts: Type.Array(text(1000)),
});
export type WorldChapterCopilotResponse = Static<typeof WorldChapterCopilotResponseSchema>;
