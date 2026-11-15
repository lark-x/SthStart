import { Type, type Static } from '@sinclair/typebox';

const text = (maxLength = 2000) => Type.String({ maxLength });
const strict = { additionalProperties: false };
const count = Type.Integer({ minimum: 0 });
const revision = Type.Integer({ minimum: 1 });

export const WorldSourceUpdateKindSchema = Type.Union([
  Type.Literal('actor'),
  Type.Literal('source'),
  Type.Literal('location'),
  Type.Literal('world'),
]);
export type WorldSourceUpdateKind = Static<typeof WorldSourceUpdateKindSchema>;

export const WorldSourceUpdateChangeSchema = Type.Union([
  Type.Literal('added'),
  Type.Literal('modified'),
  Type.Literal('removed'),
]);
export type WorldSourceUpdateChange = Static<typeof WorldSourceUpdateChangeSchema>;

export const WorldSourceUpdateCountsSchema = Type.Object({
  added: count,
  modified: count,
  removed: count,
}, strict);
export type WorldSourceUpdateCounts = Static<typeof WorldSourceUpdateCountsSchema>;

export const WorldSourceUpdateFieldSchema = Type.Object({
  field: text(100),
  label: text(100),
  before: text(2000),
  after: text(2000),
}, strict);
export type WorldSourceUpdateField = Static<typeof WorldSourceUpdateFieldSchema>;

export const WorldSourceUpdateEntitySchema = Type.Object({
  kind: WorldSourceUpdateKindSchema,
  id: text(160),
  name: text(300),
  change: WorldSourceUpdateChangeSchema,
  fields: Type.Array(WorldSourceUpdateFieldSchema, { maxItems: 30 }),
  note: text(2000),
}, strict);
export type WorldSourceUpdateEntity = Static<typeof WorldSourceUpdateEntitySchema>;

export const WorldSourceUpdateBranchSchema = Type.Object({
  branchId: text(160),
  title: text(200),
  mode: Type.Union([
    Type.Literal('canon-gap'),
    Type.Literal('adaptation'),
    Type.Literal('alternate'),
  ]),
  currentTick: count,
  sourceRevision: revision,
  isCurrent: Type.Boolean(),
  counts: WorldSourceUpdateCountsSchema,
}, strict);
export type WorldSourceUpdateBranch = Static<typeof WorldSourceUpdateBranchSchema>;

export const WorldCharacterVersionUpdateSchema = Type.Object({
  actorId: text(160),
  actorName: text(200),
  characterId: text(160),
  characterName: text(200),
  fromVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  latestVersion: Type.Integer({ minimum: 1 }),
  publishedAt: Type.Union([Type.String(), Type.Null()]),
  canImport: Type.Boolean(),
  note: text(2000),
}, strict);
export type WorldCharacterVersionUpdate = Static<typeof WorldCharacterVersionUpdateSchema>;

export const WorldSourceSnapshotNoticeSchema = Type.Object({
  sourceId: text(160),
  title: text(300),
  sourceVersion: text(200),
  capturedAt: text(100),
  reason: Type.Literal('no-stable-link'),
  note: text(2000),
}, strict);
export type WorldSourceSnapshotNotice = Static<typeof WorldSourceSnapshotNoticeSchema>;

/**
 * Explicit source refresh request. expectedWorldRevision is optional only for
 * older callers; the source preview UI always sends the revision it displayed.
 */
export const RefreshWorldSourcesSchema = Type.Object({
  expectedRevision: revision,
  expectedWorldRevision: Type.Optional(revision),
}, strict);
export type RefreshWorldSources = Static<typeof RefreshWorldSourcesSchema>;

export const WorldSourceUpdatePreviewSchema = Type.Object({
  worldId: text(160),
  branchId: text(160),
  worldRevision: revision,
  branchRevision: revision,
  branchSourceRevision: revision,
  currentBranchPending: Type.Boolean(),
  generatedAt: Type.String(),
  counts: WorldSourceUpdateCountsSchema,
  changes: Type.Array(WorldSourceUpdateEntitySchema, { maxItems: 1000 }),
  affectedBranches: Type.Array(WorldSourceUpdateBranchSchema, { maxItems: 5000 }),
  characterVersionUpdates: Type.Array(WorldCharacterVersionUpdateSchema, { maxItems: 100 }),
  sourceSnapshotNotices: Type.Array(WorldSourceSnapshotNoticeSchema, { maxItems: 100 }),
  historyPreserved: Type.Boolean(),
}, strict);
export type WorldSourceUpdatePreview = Static<typeof WorldSourceUpdatePreviewSchema>;
