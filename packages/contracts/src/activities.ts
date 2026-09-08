import { Type, type Static } from '@sinclair/typebox';

export const GenerationModeSchema = Type.Union([
  Type.Literal('autonomous'),
  Type.Literal('fill_details'),
  Type.Literal('strict'),
]);
export type GenerationMode = Static<typeof GenerationModeSchema>;

export const ReviewStateSchema = Type.Union([
  Type.Literal('ready'),
  Type.Literal('needs_review'),
]);
export type ReviewState = Static<typeof ReviewStateSchema>;

export const ActorPersonaSchema = Type.Record(Type.String(), Type.Unknown());
export type ActorPersona = Static<typeof ActorPersonaSchema>;

export const ActorSnapshotSchema = Type.Object({
  id: Type.String(),
  sourceCharacterId: Type.Optional(Type.String()),
  sourceVersion: Type.Optional(Type.Number()),
  displayName: Type.String(),
  persona: ActorPersonaSchema,
  avatarAssetKey: Type.Optional(Type.String()),
  activityRole: Type.String(),
  outfitDescription: Type.String(),
  appearanceReferenceAssetKeys: Type.Array(Type.String()),
});
export type ActorSnapshot = Static<typeof ActorSnapshotSchema>;

export const StageDefinitionSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  order: Type.Number(),
  actorIds: Type.Array(Type.String()),
  location: Type.String(),
  instruction: Type.String(),
  requiredBeats: Type.Array(
    Type.Object({
      id: Type.String(),
      text: Type.String(),
      actorIds: Type.Array(Type.String()),
    })
  ),
  locked: Type.Boolean(),
  endCondition: Type.String(),
});
export type StageDefinition = Static<typeof StageDefinitionSchema>;

export const ConversationSchema = Type.Object({
  id: Type.String(),
  kind: Type.Union([Type.Literal('group'), Type.Literal('direct')]),
  title: Type.String(),
  memberActorIds: Type.Array(Type.String()),
});
export type Conversation = Static<typeof ConversationSchema>;

export const MediaSlotSchema = Type.Object({
  id: Type.String(),
  stageId: Type.String(),
  kind: Type.Union([Type.Literal('image'), Type.Literal('video')]),
  caption: Type.String(),
  shotDescription: Type.String(),
  actorIds: Type.Array(Type.String()),
  sourceFactIds: Type.Array(Type.String()),
});
export type MediaSlot = Static<typeof MediaSlotSchema>;

export const ChatMessageSchema = Type.Object({
  id: Type.String(),
  conversationId: Type.String(),
  stageId: Type.String(),
  kind: Type.Union([Type.Literal('message'), Type.Literal('system')]),
  speakerActorId: Type.Optional(Type.String()),
  text: Type.String(),
  mediaSlotIds: Type.Array(Type.String()),
  replyToMessageId: Type.Optional(Type.String()),
  storyOrder: Type.Number(),
  storyTimeLabel: Type.Optional(Type.String()),
});
export type ChatMessage = Static<typeof ChatMessageSchema>;

export const MomentPostSchema = Type.Object({
  id: Type.String(),
  stageId: Type.String(),
  authorActorId: Type.String(),
  text: Type.String(),
  mediaSlotIds: Type.Array(Type.String()),
  storyOrder: Type.Number(),
  storyTimeLabel: Type.Optional(Type.String()),
  sourceFactIds: Type.Array(Type.String()),
});
export type MomentPost = Static<typeof MomentPostSchema>;

export const MomentCommentSchema = Type.Object({
  id: Type.String(),
  postId: Type.String(),
  authorActorId: Type.String(),
  text: Type.String(),
  replyToCommentId: Type.Optional(Type.String()),
  storyOrder: Type.Number(),
});
export type MomentComment = Static<typeof MomentCommentSchema>;

export const MomentLikeSchema = Type.Object({
  postId: Type.String(),
  actorId: Type.String(),
});
export type MomentLike = Static<typeof MomentLikeSchema>;

export const ActivityFactSchema = Type.Object({
  id: Type.String(),
  stageId: Type.String(),
  text: Type.String(),
  sourceRecordIds: Type.Array(Type.String()),
  knownByActorIds: Type.Array(Type.String()),
  status: Type.Union([Type.Literal('planned'), Type.Literal('happened')]),
});
export type ActivityFact = Static<typeof ActivityFactSchema>;

export const StageResultSchema = Type.Object({
  stageId: Type.String(),
  sourceContextHash: Type.String(),
  reviewState: ReviewStateSchema,
  summary: Type.String(),
  factIds: Type.Array(Type.String()),
});
export type StageResult = Static<typeof StageResultSchema>;

export const ContentDocumentSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  activity: Type.Object({
    title: Type.String(),
    type: Type.String(),
    theme: Type.String(),
    location: Type.String(),
    rules: Type.String(),
    generationMode: GenerationModeSchema,
  }),
  actors: Type.Array(ActorSnapshotSchema),
  relationships: Type.Array(
    Type.Object({
      fromActorId: Type.String(),
      toActorId: Type.String(),
      description: Type.String(),
    })
  ),
  stages: Type.Array(StageDefinitionSchema),
  conversations: Type.Array(ConversationSchema),
  messages: Type.Array(ChatMessageSchema),
  posts: Type.Array(MomentPostSchema),
  comments: Type.Array(MomentCommentSchema),
  likes: Type.Array(MomentLikeSchema),
  mediaSlots: Type.Array(MediaSlotSchema),
  facts: Type.Array(ActivityFactSchema),
  stageResults: Type.Array(StageResultSchema),
});
export type ContentDocument = Static<typeof ContentDocumentSchema>;

export const SlotBindingSchema = Type.Object({
  slotId: Type.String(),
  slotFingerprint: Type.String(),
  assets: Type.Array(
    Type.Object({
      assetKey: Type.String(),
      order: Type.Number(),
    })
  ),
});
export type SlotBinding = Static<typeof SlotBindingSchema>;

export const MediaRevisionDocumentSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  slotBindings: Type.Array(SlotBindingSchema),
});
export type MediaRevisionDocument = Static<typeof MediaRevisionDocumentSchema>;

export const PlaybackActionTypeSchema = Type.Union([
  Type.Literal('open_view'),
  Type.Literal('reveal_message'),
  Type.Literal('typing'),
  Type.Literal('scroll_to'),
  Type.Literal('hold'),
  Type.Literal('open_media'),
  Type.Literal('close_media'),
  Type.Literal('stage_card'),
  Type.Literal('reveal_comments'),
]);
export type PlaybackActionType = Static<typeof PlaybackActionTypeSchema>;

export const PlaybackActionSchema = Type.Object({
  id: Type.String(),
  type: PlaybackActionTypeSchema,
  atMs: Type.Number(),
  durationMs: Type.Number(),
  view: Type.Optional(Type.Union([Type.Literal('chat'), Type.Literal('moments')])),
  conversationId: Type.Optional(Type.String()),
  visibleThroughOrder: Type.Optional(Type.Number()),
  targetType: Type.Optional(Type.Union([Type.Literal('message'), Type.Literal('post'), Type.Literal('comment')])),
  targetId: Type.Optional(Type.String()),
  align: Type.Optional(Type.Union([Type.Literal('start'), Type.Literal('center'), Type.Literal('end')])),
  slotId: Type.Optional(Type.String()),
  assetKey: Type.Optional(Type.String()),
  kind: Type.Optional(Type.Union([Type.Literal('image'), Type.Literal('video')])),
  sourceInMs: Type.Optional(Type.Number()),
  volume: Type.Optional(Type.Number()),
  text: Type.Optional(Type.String()),
  stageId: Type.Optional(Type.String()),
  postId: Type.Optional(Type.String()),
  throughOrder: Type.Optional(Type.Number()),
  actorId: Type.Optional(Type.String()),
});
export type PlaybackAction = Static<typeof PlaybackActionSchema>;

export const PlaybackDocumentSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  contentRevisionId: Type.String(),
  mediaRevisionId: Type.String(),
  template: Type.Object({
    id: Type.String(),
    version: Type.String(),
  }),
  viewerActorId: Type.String(),
  layout: Type.Object({
    width: Type.Number(),
    height: Type.Number(),
  }),
  output: Type.Object({
    width: Type.Number(),
    height: Type.Number(),
    fps: Type.Number(),
  }),
  totalDurationMs: Type.Number(),
  actions: Type.Array(PlaybackActionSchema),
});
export type PlaybackDocument = Static<typeof PlaybackDocumentSchema>;

export const ActivitySchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  type: Type.String(),
  theme: Type.String(),
  location: Type.String(),
  rules: Type.String(),
  archived: Type.Boolean(),
  headVersion: Type.Number(),
  currentContentRevisionId: Type.Union([Type.String(), Type.Null()]),
  currentMediaRevisionId: Type.Union([Type.String(), Type.Null()]),
  currentPlaybackRevisionId: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type Activity = Static<typeof ActivitySchema>;

export const ActivityDraftSchema = Type.Object({
  activityId: Type.String(),
  draftVersion: Type.Number(),
  document: ContentDocumentSchema,
  baseContentRevisionId: Type.Union([Type.String(), Type.Null()]),
  updatedAt: Type.String(),
});
export type ActivityDraft = Static<typeof ActivityDraftSchema>;

export const ActivityCheckpointSchema = Type.Object({
  id: Type.String(),
  activityId: Type.String(),
  name: Type.String(),
  headVersion: Type.Number(),
  contentRevisionId: Type.String(),
  mediaRevisionId: Type.Union([Type.String(), Type.Null()]),
  playbackRevisionId: Type.Union([Type.String(), Type.Null()]),
  imageConfigRevisionId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  createdAt: Type.String(),
});
export type ActivityCheckpoint = Static<typeof ActivityCheckpointSchema>;

export const ActivityAssetSchema = Type.Object({
  id: Type.Optional(Type.String()),
  activityId: Type.String(),
  assetKey: Type.String(),
  artifactId: Type.String(),
  source: Type.String(),
  type: Type.Union([Type.Literal('image'), Type.Literal('video'), Type.Literal('audio'), Type.Literal('document'), Type.Literal('binary')]),
  byteSize: Type.Optional(Type.Number()),
  sha256: Type.Optional(Type.String()),
  width: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  height: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  durationMs: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  hash: Type.Optional(Type.String()),
  createdAt: Type.String(),
});
export type ActivityAsset = Static<typeof ActivityAssetSchema>;

export const ContentRevisionSchema = Type.Object({
  id: Type.String(),
  activityId: Type.String(),
  parentId: Type.Union([Type.String(), Type.Null()]),
  document: ContentDocumentSchema,
  schemaVersion: Type.Literal(1),
  hash: Type.String(),
  createdSource: Type.String(),
  createdAt: Type.String(),
});
export type ContentRevision = Static<typeof ContentRevisionSchema>;

export const MediaRevisionSchema = Type.Object({
  id: Type.String(),
  activityId: Type.String(),
  contentRevisionId: Type.String(),
  imageConfigRevisionId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  slotBindings: Type.Array(Type.Object({
    slotId: Type.String(),
    slotFingerprint: Type.String(),
    assets: Type.Array(Type.Object({
      assetKey: Type.String(),
      order: Type.Number(),
    })),
  })),
  hash: Type.String(),
  createdAt: Type.String(),
});
export type MediaRevision = Static<typeof MediaRevisionSchema>;

export const PlaybackRevisionSchema = Type.Object({
  id: Type.String(),
  activityId: Type.String(),
  contentRevisionId: Type.String(),
  mediaRevisionId: Type.String(),
  document: PlaybackDocumentSchema,
  hash: Type.String(),
  createdAt: Type.String(),
});
export type PlaybackRevision = Static<typeof PlaybackRevisionSchema>;

export const ActivityCandidateSchema = Type.Object({
  id: Type.String(),
  activityId: Type.String(),
  baseRevisionId: Type.Union([Type.String(), Type.Null()]),
  draftVersion: Type.Union([Type.Number(), Type.Null()]),
  scope: Type.Record(Type.String(), Type.Unknown()),
  payload: Type.Record(Type.String(), Type.Unknown()),
  validation: Type.Record(Type.String(), Type.Unknown()),
  adopted: Type.Boolean(),
  createdAt: Type.String(),
});
export type ActivityCandidate = Static<typeof ActivityCandidateSchema>;

export const ActivityJobStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('running'),
  Type.Literal('succeeded'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('result_unknown'),
]);
export type ActivityJobStatus = Static<typeof ActivityJobStatusSchema>;

export const ActivityJobSchema = Type.Object({
  id: Type.String(),
  activityId: Type.String(),
  kind: Type.Union([Type.Literal('text'), Type.Literal('media'), Type.Literal('export'), Type.Literal('import')]),
  mode: Type.String(),
  status: ActivityJobStatusSchema,
  requestHash: Type.String(),
  idempotencyKey: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  targetRevisionId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  resultCandidateIds: Type.Array(Type.String()),
  errorMessage: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  modelMetadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type ActivityJob = Static<typeof ActivityJobSchema>;
