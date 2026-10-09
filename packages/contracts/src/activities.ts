import { Type, type Static } from '@sinclair/typebox';
import { ActivityRenderQualitySchema, DirectorSettingsSchema } from './activity-studio.js';

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

/** A ComfyUI LoRA selection captured with a character or activity render. */
export const ActivityLoraSchema = Type.Object({
  model: Type.String({ minLength: 1, maxLength: 512 }),
  strength: Type.Number({ minimum: -10, maximum: 10 }),
  triggerWord: Type.String({ maxLength: 2_000 }),
  enabled: Type.Boolean(),
});
export type ActivityLora = Static<typeof ActivityLoraSchema>;

/** Per-shot values overlay inherited global and character LoRAs by exact model filename. */
export const ActivityLoraOverrideSchema = Type.Object({
  model: Type.String({ minLength: 1, maxLength: 512 }),
  strength: Type.Optional(Type.Number({ minimum: -10, maximum: 10 })),
  triggerWord: Type.Optional(Type.String({ maxLength: 2_000 })),
  enabled: Type.Optional(Type.Boolean()),
});
export type ActivityLoraOverride = Static<typeof ActivityLoraOverrideSchema>;

export const SceneBeatRenderSettingsSchema = Type.Object({
  finalPositivePrompt: Type.Optional(Type.String({ minLength: 1, maxLength: 20_000 })),
  promptOptimization: Type.Optional(Type.Boolean()),
  quality: Type.Optional(ActivityRenderQualitySchema),
  director: Type.Optional(DirectorSettingsSchema),
  composition: Type.Optional(Type.String({ maxLength: 2_000 })),
  visualSupplement: Type.Optional(Type.String({ maxLength: 2_000 })),
  expression: Type.Optional(Type.String({ maxLength: 500 })),
  purpose: Type.Optional(Type.String()),
  workflowId: Type.Optional(Type.String()),
  workflowVersion: Type.Optional(Type.Integer({ minimum: 1 })),
  presetId: Type.Optional(Type.String()),
  presetRevision: Type.Optional(Type.Integer({ minimum: 1 })),
  customPrompt: Type.Optional(Type.String({ maxLength: 20_000 })),
  negativePrompt: Type.Optional(Type.String({ maxLength: 20_000 })),
  parameters: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  referenceAssetKey: Type.Optional(Type.String()),
  loraOverrides: Type.Optional(Type.Array(ActivityLoraOverrideSchema, { maxItems: 32 })),
});
export type SceneBeatRenderSettings = Static<typeof SceneBeatRenderSettingsSchema>;

export const ActorSnapshotSchema = Type.Object({
  id: Type.String(),
  sourceCharacterId: Type.Optional(Type.String()),
  sourceVersion: Type.Optional(Type.Number()),
  sourceVersionStatus: Type.Optional(Type.Union([
    Type.Literal('published'), Type.Literal('draft'), Type.Literal('unknown'), Type.Literal('missing'),
  ])),
  characterDraftRevision: Type.Optional(Type.Number()),
  displayName: Type.String(),
  persona: ActorPersonaSchema,
  visualLoras: Type.Optional(Type.Array(ActivityLoraSchema, { maxItems: 32 })),
  avatarAssetKey: Type.Optional(Type.String()),
  avatarAssetId: Type.Optional(Type.String()),
  avatarUrl: Type.Optional(Type.String()),
  portraitAssetId: Type.Optional(Type.String()),
  portraitUrl: Type.Optional(Type.String()),
  activityRole: Type.String(),
  outfitDescription: Type.String(),
  appearanceReferenceAssetKeys: Type.Optional(Type.Array(Type.String())),
});
export type ActorSnapshot = Static<typeof ActorSnapshotSchema>;

export const SceneBeatSchema = Type.Object({
  id: Type.String(),
  actorIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 8, uniqueItems: true })),
  sceneId: Type.Optional(Type.String()),
  stageId: Type.Optional(Type.String()),
  characterId: Type.String(),
  characterName: Type.Optional(Type.String()),
  action: Type.String(),
  dialogue: Type.Optional(Type.String()),
  outcome: Type.Optional(Type.String()),
  mediaUrl: Type.Optional(Type.String()),
  mediaType: Type.Optional(Type.Union([Type.Literal('image'), Type.Literal('video')])),
  renderSettings: Type.Optional(SceneBeatRenderSettingsSchema),
  orderIndex: Type.Optional(Type.Number()),
});
export type SceneBeat = Static<typeof SceneBeatSchema>;

export const ActivitySceneSchema = Type.Object({
  id: Type.String(),
  stageId: Type.Optional(Type.String()),
  title: Type.String(),
  timeText: Type.String(),
  locationText: Type.String(),
  environment: Type.Optional(Type.String()),
  beats: Type.Array(SceneBeatSchema),
  orderIndex: Type.Optional(Type.Number()),
});
export type ActivityScene = Static<typeof ActivitySceneSchema>;

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
  stagePremise: Type.Optional(Type.String()),
  mcpQuery: Type.Optional(Type.String()),
  mcpSourceIds: Type.Optional(Type.Array(Type.String())),
  systemPromptOverride: Type.Optional(Type.String()),
  scenes: Type.Optional(Type.Array(ActivitySceneSchema)),
});
export type StageDefinition = Static<typeof StageDefinitionSchema>;

export const GenerateBeatMediaRequestSchema = Type.Object({
  stageId: Type.String(),
  beatId: Type.String(),
  customPrompt: Type.Optional(Type.String()),
  negativePrompt: Type.Optional(Type.String()),
  seed: Type.Optional(Type.Number()),
  steps: Type.Optional(Type.Number()),
  cfg: Type.Optional(Type.Number()),
  width: Type.Optional(Type.Number()),
  height: Type.Optional(Type.Number()),
  mediaType: Type.Optional(Type.Union([Type.Literal('image'), Type.Literal('video')])),
  checkpoint: Type.Optional(Type.String()),
  engineId: Type.Optional(Type.String()),
});
export type GenerateBeatMediaRequest = Static<typeof GenerateBeatMediaRequestSchema>;

export const GenerateBeatMediaResponseSchema = Type.Object({
  success: Type.Boolean(),
  mediaUrl: Type.String(),
  mediaType: Type.Union([Type.Literal('image'), Type.Literal('video')]),
  promptUsed: Type.String(),
  seed: Type.Number(),
  characterConsistent: Type.Boolean(),
  stageId: Type.String(),
  beatId: Type.String(),
  error: Type.Optional(Type.String()),
});
export type GenerateBeatMediaResponse = Static<typeof GenerateBeatMediaResponseSchema>;

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

export const EditingPolicySchema = Type.Object({
  lockedRecords: Type.Array(
    Type.Object({
      kind: Type.Union([Type.Literal('message'), Type.Literal('post')]),
      id: Type.String(),
    })
  ),
  lockedMediaSlotIds: Type.Array(Type.String()),
});
export type EditingPolicy = Static<typeof EditingPolicySchema>;

export const ContentDocumentSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  activity: Type.Object({
    title: Type.String(),
    type: Type.String(),
    theme: Type.String(),
    location: Type.String(),
    rules: Type.String(),
    generationMode: GenerationModeSchema,
    systemPrompt: Type.Optional(Type.String()),
    mcpSourceIds: Type.Optional(Type.Array(Type.String())),
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
  scenes: Type.Optional(Type.Array(ActivitySceneSchema)),
  editingPolicy: Type.Optional(EditingPolicySchema),
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
  imageConfigRevisionId: Type.Optional(Type.String()),
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

// Read-only aggregate of every image an activity has produced, so the delivery
// gallery can show lens, comic and material results in one place. It never
// carries draw parameters or triggers a new picture.
export const ActivityGalleryItemSchema = Type.Object({
  artifactId: Type.String(),
  kind: Type.Union([Type.Literal('beat'), Type.Literal('comic'), Type.Literal('material'), Type.Literal('upload')]),
  label: Type.String(),
  available: Type.Boolean(),
  width: Type.Union([Type.Number(), Type.Null()]),
  height: Type.Union([Type.Number(), Type.Null()]),
  createdAt: Type.String(),
  objectLabel: Type.Union([Type.String(), Type.Null()]),
});
export type ActivityGalleryItem = Static<typeof ActivityGalleryItemSchema>;

export const ActivityGallerySchema = Type.Object({
  items: Type.Array(ActivityGalleryItemSchema),
  counts: Type.Object({ beat: Type.Integer({ minimum: 0 }), comic: Type.Integer({ minimum: 0 }),
    material: Type.Integer({ minimum: 0 }), upload: Type.Integer({ minimum: 0 }) }),
  truncated: Type.Boolean(),
});
export type ActivityGallery = Static<typeof ActivityGallerySchema>;

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
