import { Type, type Static } from '@sinclair/typebox';

export const StoryContextSettingsSchema = Type.Object({
  contextWindow: Type.Integer({ minimum: 16384, maximum: 131072 }),
  outputTokens: Type.Integer({ minimum: 512, maximum: 8192 }),
  compactThreshold: Type.Number({ minimum: 0.5, maximum: 0.85 }),
  retainTokens: Type.Integer({ minimum: 512, maximum: 16384 }),
});
export type StoryContextSettings = Static<typeof StoryContextSettingsSchema>;

export const StoryProjectSchema = Type.Object({
  id: Type.String(), title: Type.String(), summary: Type.String(), revision: Type.Integer(),
  contextSettings: StoryContextSettingsSchema,
  workId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  createdAt: Type.String(), updatedAt: Type.String(),
});
export type StoryProject = Static<typeof StoryProjectSchema>;
export const CreateStoryProjectSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 120 }),
  summary: Type.Optional(Type.String({ maxLength: 4000 })),
  workId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
export type CreateStoryProject = Static<typeof CreateStoryProjectSchema>;
export const UpdateStoryProjectSchema = Type.Object({
  expectedRevision: Type.Integer({ minimum: 1 }),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  summary: Type.Optional(Type.String({ maxLength: 4000 })),
  workId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  contextSettings: Type.Optional(StoryContextSettingsSchema),
});
export type UpdateStoryProject = Static<typeof UpdateStoryProjectSchema>;

export const StoryDocumentKindSchema = Type.Union([Type.Literal('outline'), Type.Literal('world'), Type.Literal('scene'), Type.Literal('chapter')]);
export type StoryDocumentKind = Static<typeof StoryDocumentKindSchema>;
export const StoryDocumentSchema = Type.Object({
  id: Type.String(), projectId: Type.String(), kind: StoryDocumentKindSchema,
  title: Type.String(), body: Type.String(), position: Type.Integer(), revision: Type.Integer(),
  createdAt: Type.String(), updatedAt: Type.String(),
});
export type StoryDocument = Static<typeof StoryDocumentSchema>;
export const CreateStoryDocumentSchema = Type.Object({
  kind: StoryDocumentKindSchema,
  title: Type.String({ minLength: 1, maxLength: 120 }),
  body: Type.Optional(Type.String({ maxLength: 100000 })),
});
export type CreateStoryDocument = Static<typeof CreateStoryDocumentSchema>;
export const UpdateStoryDocumentSchema = Type.Object({
  expectedRevision: Type.Integer({ minimum: 1 }),
  title: Type.String({ minLength: 1, maxLength: 120 }),
  body: Type.String({ maxLength: 100000 }),
});
export type UpdateStoryDocument = Static<typeof UpdateStoryDocumentSchema>;

export const StoryCharacterSchema = Type.Object({
  id: Type.String(), projectId: Type.String(), name: Type.String(), notes: Type.String(),
  sourceCharacterId: Type.Union([Type.String(), Type.Null()]),
  sourceVersion: Type.Union([Type.Integer(), Type.Null()]),
  revision: Type.Integer(), createdAt: Type.String(), updatedAt: Type.String(),
});
export type StoryCharacter = Static<typeof StoryCharacterSchema>;
export const StoryEntrySchema = Type.Union([StoryDocumentSchema, StoryCharacterSchema]);
export type StoryEntry = Static<typeof StoryEntrySchema>;
export const CreateStoryCharacterSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  notes: Type.Optional(Type.String({ maxLength: 100000 })),
  sourceCharacterId: Type.Optional(Type.String()),
  sourceVersion: Type.Optional(Type.Integer({ minimum: 1 })),
});
export type CreateStoryCharacter = Static<typeof CreateStoryCharacterSchema>;
export const UpdateStoryCharacterSchema = Type.Object({
  expectedRevision: Type.Integer({ minimum: 1 }),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  notes: Type.String({ maxLength: 100000 }),
});
export type UpdateStoryCharacter = Static<typeof UpdateStoryCharacterSchema>;

export const StorySessionSchema = Type.Object({
  id: Type.String(), projectId: Type.String(), title: Type.String(), runtimeSessionId: Type.String(),
  status: Type.Union([Type.Literal('idle'), Type.Literal('running'), Type.Literal('interrupted')]),
  createdAt: Type.String(), updatedAt: Type.String(),
});
export type StorySession = Static<typeof StorySessionSchema>;
export const CreateStorySessionSchema = Type.Object({ title: Type.String({ minLength: 1, maxLength: 120 }) });
export type CreateStorySession = Static<typeof CreateStorySessionSchema>;
export const StoryMessageSchema = Type.Object({
  id: Type.String(), sessionId: Type.String(), role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]),
  content: Type.String(), status: Type.Union([Type.Literal('pending'), Type.Literal('completed'), Type.Literal('interrupted')]),
  createdAt: Type.String(),
});
export type StoryMessage = Static<typeof StoryMessageSchema>;
export const SendStoryMessageSchema = Type.Object({
  content: Type.String({ minLength: 1, maxLength: 16000 }),
  idempotencyKey: Type.String({ minLength: 8, maxLength: 128 }),
});
export type SendStoryMessage = Static<typeof SendStoryMessageSchema>;
export const SendStoryMessageResponseSchema = Type.Object({ message: StoryMessageSchema, created: Type.Boolean() });
export const StoryCompactResponseSchema = Type.Object({ compacted: Type.Boolean(), replacedItems: Type.Integer(), estimatedSourceTokens: Type.Integer() });

export const StoryProposalKindSchema = Type.Union([Type.Literal('outline'), Type.Literal('world'), Type.Literal('scene'), Type.Literal('chapter'), Type.Literal('character')]);
export type StoryProposalKind = Static<typeof StoryProposalKindSchema>;
export const StoryProposalOperationSchema = Type.Union([Type.Literal('update'), Type.Literal('create')]);
export type StoryProposalOperation = Static<typeof StoryProposalOperationSchema>;
export const StoryProposalOriginSchema = Type.Union([Type.Literal('legacy'), Type.Literal('native_dsh')]);
export type StoryProposalOrigin = Static<typeof StoryProposalOriginSchema>;
export const StoryProposalSchema = Type.Object({
  id: Type.String(), projectId: Type.String(), sessionId: Type.Union([Type.String(), Type.Null()]),
  operation: StoryProposalOperationSchema, origin: StoryProposalOriginSchema,
  kind: StoryProposalKindSchema, targetId: Type.Union([Type.String(), Type.Null()]),
  baseRevision: Type.Union([Type.Integer(), Type.Null()]),
  resultEntryId: Type.Union([Type.String(), Type.Null()]),
  proposedTitle: Type.String(), proposedBody: Type.String(), reason: Type.String(),
  status: Type.Union([Type.Literal('pending'), Type.Literal('accepted'), Type.Literal('rejected')]),
  createdAt: Type.String(), decidedAt: Type.Union([Type.String(), Type.Null()]),
});
export type StoryProposal = Static<typeof StoryProposalSchema>;
export const CreateStoryProposalSchema = Type.Object({
  sessionId: Type.String(), kind: StoryProposalKindSchema, targetId: Type.String(),
  baseRevision: Type.Integer({ minimum: 1 }),
  proposedTitle: Type.String({ minLength: 1, maxLength: 120 }),
  proposedBody: Type.String({ maxLength: 100000 }),
  reason: Type.String({ minLength: 1, maxLength: 4000 }),
});
export type CreateStoryProposal = Static<typeof CreateStoryProposalSchema>;

export const CreateNativeStoryProposalSchema = Type.Union([
  Type.Object({
    operation: Type.Literal('update'), kind: StoryProposalKindSchema,
    targetId: Type.String({ minLength: 1 }), baseRevision: Type.Integer({ minimum: 1 }),
    proposedTitle: Type.String({ minLength: 1, maxLength: 120 }),
    proposedBody: Type.String({ maxLength: 100000 }), reason: Type.String({ minLength: 1, maxLength: 4000 }),
  }),
  Type.Object({
    operation: Type.Literal('create'),
    kind: Type.Union([Type.Literal('world'), Type.Literal('scene'), Type.Literal('chapter'), Type.Literal('character')]),
    targetId: Type.Null(), baseRevision: Type.Null(),
    proposedTitle: Type.String({ minLength: 1, maxLength: 120 }),
    proposedBody: Type.String({ maxLength: 100000 }), reason: Type.String({ minLength: 1, maxLength: 4000 }),
  }),
]);
export type CreateNativeStoryProposal = Static<typeof CreateNativeStoryProposalSchema>;

export const StoryEntrySnapshotSchema = Type.Union([
  Type.Object({ kind: StoryDocumentKindSchema, title: Type.String(), body: Type.String() }),
  Type.Object({ kind: Type.Literal('character'), name: Type.String(), notes: Type.String(),
    sourceCharacterId: Type.Union([Type.String(), Type.Null()]), sourceVersion: Type.Union([Type.Integer(), Type.Null()]) }),
]);
export type StoryEntrySnapshot = Static<typeof StoryEntrySnapshotSchema>;
export const StoryEntryRevisionSchema = Type.Object({
  id: Type.String(), projectId: Type.String(), entryKind: Type.Union([StoryDocumentKindSchema, Type.Literal('character')]),
  entryId: Type.String(), revision: Type.Integer(), snapshot: StoryEntrySnapshotSchema,
  source: Type.Union([Type.Literal('baseline'), Type.Literal('manual'), Type.Literal('proposal'), Type.Literal('restore')]),
  proposalId: Type.Union([Type.String(), Type.Null()]), createdAt: Type.String(),
});
export type StoryEntryRevision = Static<typeof StoryEntryRevisionSchema>;
export const StoryEntryRevisionListSchema = Type.Object({ items: Type.Array(StoryEntryRevisionSchema) });
export const RestoreStoryEntryRevisionSchema = Type.Object({ revisionId: Type.String({ minLength: 1 }), expectedRevision: Type.Integer({ minimum: 1 }) });

export const ReorderStoryChaptersSchema = Type.Object({
  expectedProjectRevision: Type.Integer({ minimum: 1 }), chapterIds: Type.Array(Type.String(), { maxItems: 1000 }),
});
export type ReorderStoryChapters = Static<typeof ReorderStoryChaptersSchema>;
export const StorySearchQuerySchema = Type.Object({
  q: Type.String({ minLength: 1, maxLength: 120 }),
  kind: Type.Optional(StoryProposalKindSchema), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  cursor: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000000 })),
});
export type StorySearchQuery = Static<typeof StorySearchQuerySchema>;
export const StorySearchResultSchema = Type.Object({
  kind: StoryProposalKindSchema, id: Type.String(), title: Type.String(), revision: Type.Integer(), excerpt: Type.String(),
});
export type StorySearchResult = Static<typeof StorySearchResultSchema>;
export const StorySearchResponseSchema = Type.Object({ items: Type.Array(StorySearchResultSchema), nextCursor: Type.Union([Type.Integer(), Type.Null()]) });
export type StorySearchResponse = Static<typeof StorySearchResponseSchema>;

export const CreateStoryBridgeGrantResponseSchema = Type.Object({ projectId: Type.String(), token: Type.String(), createdAt: Type.String() });
export type CreateStoryBridgeGrantResponse = Static<typeof CreateStoryBridgeGrantResponseSchema>;
export const StoryBridgeStatusSchema = Type.Object({
  projectId: Type.String(), paired: Type.Boolean(), createdAt: Type.Union([Type.String(), Type.Null()]),
  lastUsedAt: Type.Union([Type.String(), Type.Null()]), running: Type.Boolean(), lastHeartbeatAt: Type.Union([Type.String(), Type.Null()]),
});
export type StoryBridgeStatus = Static<typeof StoryBridgeStatusSchema>;
export const StoryBridgeProjectSchema = Type.Object({ project: StoryProjectSchema });
export const StoryBridgeEntrySchema = Type.Object({
  kind: Type.Union([StoryDocumentKindSchema, Type.Literal('character')]), id: Type.String(), title: Type.String(),
  body: Type.String(), revision: Type.Integer(), totalLength: Type.Integer(), offset: Type.Integer(), truncated: Type.Boolean(),
});
export const StoryBridgeEntryListSchema = Type.Object({ items: Type.Array(Type.Object({
  kind: Type.Union([StoryDocumentKindSchema, Type.Literal('character')]), id: Type.String(), title: Type.String(), revision: Type.Integer(),
})), nextCursor: Type.Union([Type.Integer(), Type.Null()]) });
export const StoryBridgeEntriesQuerySchema = Type.Object({
  kind: Type.Optional(Type.Union([StoryDocumentKindSchema, Type.Literal('character')])),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  cursor: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000000 })),
});
export const StoryBridgeEntryQuerySchema = Type.Object({
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000000 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20000 })),
});
export const StoryBridgeSearchResponseSchema = StorySearchResponseSchema;
export const StoryBridgeHeartbeatSchema = Type.Object({ instanceId: Type.String({ minLength: 8, maxLength: 128 }), port: Type.Literal(3081) });
export const StoryBridgeProposalResponseSchema = Type.Object({ proposal: StoryProposalSchema, created: Type.Boolean() });
export const StoryBridgeHeartbeatResponseSchema = Type.Object({ receivedAt: Type.String(), running: Type.Boolean() });

export const StoryProjectListSchema = Type.Object({ items: Type.Array(StoryProjectSchema) });
export const StoryDocumentListSchema = Type.Object({ items: Type.Array(StoryDocumentSchema) });
export const StoryCharacterListSchema = Type.Object({ items: Type.Array(StoryCharacterSchema) });
export const StorySessionListSchema = Type.Object({ items: Type.Array(StorySessionSchema) });
export const StoryMessageListSchema = Type.Object({ items: Type.Array(StoryMessageSchema) });
export const StoryProposalListSchema = Type.Object({ items: Type.Array(StoryProposalSchema) });

export const StoryDshStatusSchema = Type.Object({
  running: Type.Boolean(),
  port: Type.Union([Type.Integer(), Type.Null()]),
  url: Type.Union([Type.String(), Type.Null()]),
  projectId: Type.String(),
});
export type StoryDshStatus = Static<typeof StoryDshStatusSchema>;

export const StartStoryDshResponseSchema = Type.Object({
  ok: Type.Boolean(),
  url: Type.String(),
  port: Type.Integer(),
  projectId: Type.String(),
});
export type StartStoryDshResponse = Static<typeof StartStoryDshResponseSchema>;

export const StoryScriptLineSchema = Type.Object({
  type: Type.Union([Type.Literal('dialogue'), Type.Literal('narration'), Type.Literal('scene_header')]),
  speaker: Type.Optional(Type.String()),
  content: Type.String(),
  emotion: Type.Optional(Type.String()),
});
export type StoryScriptLine = Static<typeof StoryScriptLineSchema>;

export const StoryScriptProjectSchema = Type.Object({
  title: Type.String(),
  chapterTitle: Type.String(),
  characters: Type.Array(Type.String()),
  lines: Type.Array(StoryScriptLineSchema),
});
export type StoryScriptProject = Static<typeof StoryScriptProjectSchema>;

