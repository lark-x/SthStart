import { Type, type Static } from '@sinclair/typebox';

export const AppStatusSchema = Type.Union([
  Type.Literal('online'),
  Type.Literal('offline'),
  Type.Literal('unknown'),
]);
export type AppStatus = Static<typeof AppStatusSchema>;

export const AppDescriptorSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.String(),
  launchUrl: Type.String(),
  status: AppStatusSchema,
  version: Type.Union([Type.String(), Type.Null()]),
  sourceRevision: Type.Union([Type.String(), Type.Null()]),
  capabilities: Type.Array(Type.String()),
  checkedAt: Type.String(),
});
export type AppDescriptor = Static<typeof AppDescriptorSchema>;

export const AppsResponseSchema = Type.Object({
  items: Type.Array(AppDescriptorSchema),
});
export type AppsResponse = Static<typeof AppsResponseSchema>;

export const HealthResponseSchema = Type.Object({
  status: Type.Literal('ok'),
  service: Type.Literal('sthstart-service'),
  version: Type.String(),
  uptimeMs: Type.Number(),
  timestamp: Type.String(),
});
export type HealthResponse = Static<typeof HealthResponseSchema>;

export const CapabilitiesResponseSchema = Type.Object({
  apiVersion: Type.Literal('v1'),
  modules: Type.Array(
    Type.Object({
      id: Type.String(),
      version: Type.String(),
      description: Type.String(),
    })
  ),
});
export type CapabilitiesResponse = Static<typeof CapabilitiesResponseSchema>;

export const PublicCapabilitySchema = Type.Union([
  Type.Literal('llm'),
  Type.Literal('vector'),
  Type.Literal('image'),
  Type.Literal('artifact'),
  Type.Literal('generation'),
  Type.Literal('activities'),
  Type.Literal('persona'),
  Type.Literal('logs'),
]);
export type PublicCapability = Static<typeof PublicCapabilitySchema>;

export const ImageTaskStatusSchema = Type.Union([
  Type.Literal('accepted'),
  Type.Literal('running'),
  Type.Literal('cancel_requested'),
  Type.Literal('cancelled'),
  Type.Literal('abandoned'),
  Type.Literal('cancel_failed'),
  Type.Literal('complete'),
  Type.Literal('failed'),
]);
export type ImageTaskStatus = Static<typeof ImageTaskStatusSchema>;

export const ImageCancellationScopeSchema = Type.Union([
  Type.Literal('none'),
  Type.Literal('queued'),
  Type.Literal('local-tracking'),
]);
export type ImageCancellationScope = Static<typeof ImageCancellationScopeSchema>;

export const ProfileKindSchema = Type.Union([
  Type.Literal('llm'),
  Type.Literal('vector'),
  Type.Literal('image'),
]);
export type ProfileKind = Static<typeof ProfileKindSchema>;

export const LlmModelCapabilitySchema = Type.Union([
  Type.Literal('text'),
  Type.Literal('multimodal'),
]);
export type LlmModelCapability = Static<typeof LlmModelCapabilitySchema>;
export type LlmModelRole = LlmModelCapability;

export const ManagedAppSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  enabled: Type.Boolean(),
  capabilities: Type.Array(PublicCapabilitySchema),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type ManagedApp = Static<typeof ManagedAppSchema>;

export const CreatedAppSchema = Type.Intersect([
  ManagedAppSchema,
  Type.Object({
    token: Type.String(),
  }),
]);
export type CreatedApp = Static<typeof CreatedAppSchema>;

export const IdResponseSchema = Type.Object({
  id: Type.String(),
});
export type IdResponse = Static<typeof IdResponseSchema>;

/**
 * 保存 LLM 模板的结果。配置本身保存成功但 API Key 未能写入凭据库时，
 * secretStored 为 false 且 warning 给出替代方案，界面据此提示而不报保存失败。
 */
export const SavedProfileResponseSchema = Type.Object({
  id: Type.String(),
  secretStored: Type.Boolean(),
  warning: Type.Union([Type.String(), Type.Null()]),
});
export type SavedProfileResponse = Static<typeof SavedProfileResponseSchema>;

export const ProviderProfileSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  kind: ProfileKindSchema,
  baseUrl: Type.String(),
  model: Type.Union([Type.String(), Type.Null()]),
  enabled: Type.Boolean(),
  hasCredential: Type.Boolean(),
  credentialSource: Type.Union([Type.Literal('keyring'), Type.Literal('environment'), Type.Literal('none')]),
  thinkingMode: Type.Union([Type.Literal('enabled'), Type.Literal('disabled'), Type.Literal('omit')]),
  headers: Type.Record(Type.String(), Type.String()),
  extraBody: Type.Record(Type.String(), Type.Unknown()),
  capabilities: Type.Array(LlmModelCapabilitySchema),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type ProviderProfile = Static<typeof ProviderProfileSchema>;

export const AppLlmAssignmentSchema = Type.Object({
  appId: Type.String(),
  textProfileId: Type.Union([Type.String(), Type.Null()]),
  multimodalProfileId: Type.Union([Type.String(), Type.Null()]),
  updatedAt: Type.Union([Type.String(), Type.Null()]),
});
export type AppLlmAssignment = Static<typeof AppLlmAssignmentSchema>;

export const AppLlmRoleStatusSchema = Type.Object({
  profileId: Type.String(),
  name: Type.String(),
  model: Type.String(),
  ready: Type.Boolean(),
  updatedAt: Type.Union([Type.String(), Type.Null()]),
});
export type AppLlmRoleStatus = Static<typeof AppLlmRoleStatusSchema>;

export const AppConfigResponseSchema = Type.Object({
  app: Type.Object({
    id: Type.String(),
    name: Type.String(),
  }),
  llm: Type.Object({
    text: Type.Union([AppLlmRoleStatusSchema, Type.Null()]),
    multimodal: Type.Union([AppLlmRoleStatusSchema, Type.Null()]),
    ready: Type.Boolean(),
  }),
});
export type AppConfigResponse = Static<typeof AppConfigResponseSchema>;

/**
 * 应用/角色模型绑定的结构化状态。ready 只表示当前结构配置满足该角色的调用条件，
 * 不代表已对上游完成联网探测；凭据来源独立展示，绝不返回凭据值。
 */
export const LlmBindingStatusSchema = Type.Object({
  appId: Type.String(),
  role: LlmModelCapabilitySchema,
  status: Type.Union([
    Type.Literal('ready'),
    Type.Literal('app_disabled'),
    Type.Literal('unassigned'),
    Type.Literal('profile_missing'),
    Type.Literal('profile_disabled'),
    Type.Literal('capability_mismatch'),
    Type.Literal('model_missing'),
  ]),
  ready: Type.Boolean(),
  profile: Type.Union([
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      model: Type.Union([Type.String(), Type.Null()]),
    }),
    Type.Null(),
  ]),
  credentialSource: Type.Union([
    Type.Literal('keyring'),
    Type.Literal('environment'),
    Type.Literal('none'),
  ]),
  message: Type.Union([Type.String(), Type.Null()]),
  configurationPath: Type.String(),
});
export type LlmBindingStatus = Static<typeof LlmBindingStatusSchema>;

export const AppLlmStatusResponseSchema = Type.Object({
  appId: Type.String(),
  text: LlmBindingStatusSchema,
  multimodal: LlmBindingStatusSchema,
});
export type AppLlmStatusResponse = Static<typeof AppLlmStatusResponseSchema>;

/** 角色生效模型状态：overridden 表示使用角色专属绑定，失效时必须修复而不是回退。 */
export const CharacterLlmBindingStatusSchema = Type.Composite([
  LlmBindingStatusSchema,
  Type.Object({ overridden: Type.Boolean() }),
]);
export type CharacterLlmBindingStatus = Static<typeof CharacterLlmBindingStatusSchema>;

export const CharacterLlmStatusResponseSchema = Type.Object({
  characterId: Type.String(),
  text: CharacterLlmBindingStatusSchema,
  multimodal: CharacterLlmBindingStatusSchema,
});
export type CharacterLlmStatusResponse = Static<typeof CharacterLlmStatusResponseSchema>;

export const MediaCategorySchema = Type.Union([
  Type.Literal('image'), Type.Literal('video'), Type.Literal('audio'), Type.Literal('transform'),
]);
export type MediaCategory = Static<typeof MediaCategorySchema>;

export const MediaKindSchema = Type.Union([
  Type.Literal('image'), Type.Literal('video'), Type.Literal('audio'), Type.Literal('file'),
]);
export type MediaKind = Static<typeof MediaKindSchema>;

export const EngineCapabilitiesSchema = Type.Object({
  mediaKinds: Type.Optional(Type.Array(MediaKindSchema)),
  features: Type.Optional(Type.Array(Type.String())),
});
export type EngineCapabilities = Static<typeof EngineCapabilitiesSchema>;

export const WorkflowInputCapabilitySchema = Type.Object({
  mediaTypes: Type.Optional(Type.Array(Type.String())),
  maxBytes: Type.Optional(Type.Integer({ minimum: 1 })),
  required: Type.Optional(Type.Boolean()),
  maxCount: Type.Optional(Type.Integer({ minimum: 1 })),
  semantic: Type.Optional(Type.Union([
    Type.Literal('init_image'),
    Type.Literal('identity'),
    Type.Literal('outfit'),
    Type.Literal('pose'),
    Type.Literal('style'),
    Type.Literal('composition'),
    Type.Literal('mask'),
  ])),
});
export type WorkflowInputCapability = Static<typeof WorkflowInputCapabilitySchema>;

export const WorkflowInputCapabilitiesSchema = Type.Record(Type.String(), WorkflowInputCapabilitySchema);
export type WorkflowInputCapabilities = Static<typeof WorkflowInputCapabilitiesSchema>;

export const WorkflowOutputSchema = Type.Object({
  mediaTypes: Type.Optional(Type.Array(Type.String())),
  required: Type.Optional(Type.Boolean()),
});
export type WorkflowOutputSchema = Static<typeof WorkflowOutputSchema>;

export const GenerationPrioritySchema = Type.Union([
  Type.Literal('interactive'), Type.Literal('normal'), Type.Literal('background'),
]);
export type GenerationPriority = Static<typeof GenerationPrioritySchema>;

export const GenerationProgressSchema = Type.Object({
  value: Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()]),
  stage: Type.String(),
  message: Type.Optional(Type.String()),
  current: Type.Optional(Type.Number({ minimum: 0 })),
  total: Type.Optional(Type.Number({ minimum: 0 })),
  source: Type.Optional(Type.String()),
});
export type GenerationProgress = Static<typeof GenerationProgressSchema>;

export const ArtifactFileStatusSchema = Type.Union([
  Type.Literal('ready'),
  Type.Literal('missing'),
  Type.Literal('quarantined'),
]);
export type ArtifactFileStatus = Static<typeof ArtifactFileStatusSchema>;

export const ArtifactDescriptorSchema = Type.Object({
  id: Type.String(),
  appId: Type.String(),
  taskId: Type.Union([Type.String(), Type.Null()]),
  providerUrl: Type.Union([Type.String(), Type.Null()]),
  contentType: Type.Union([Type.String(), Type.Null()]),
  byteSize: Type.Number(),
  sha256: Type.Union([Type.String(), Type.Null()]),
  fileStatus: ArtifactFileStatusSchema,
  originalName: Type.Union([Type.String(), Type.Null()]),
  mediaType: Type.Union([Type.String(), Type.Null()]),
  width: Type.Union([Type.Number(), Type.Null()]),
  height: Type.Union([Type.Number(), Type.Null()]),
  durationMs: Type.Union([Type.Number(), Type.Null()]),
  fps: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  codec: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  hasAudio: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  thumbnailArtifactId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  paramsSummary: Type.Record(Type.String(), Type.Unknown()),
  pinned: Type.Boolean(),
  url: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.Union([Type.String(), Type.Null()]),
});
export type ArtifactDescriptor = Static<typeof ArtifactDescriptorSchema>;

export const ArtifactGrantSchema = Type.Object({
  id: Type.String(),
  artifactId: Type.String(),
  ownerAppId: Type.String(),
  granteeAppId: Type.String(),
  access: Type.Union([Type.Literal('read'), Type.Literal('reference')]),
  expiresAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
});
export type ArtifactGrant = Static<typeof ArtifactGrantSchema>;

export const ArtifactReferenceSchema = Type.Object({
  id: Type.String(),
  artifactId: Type.String(),
  appId: Type.String(),
  refType: Type.String(),
  refId: Type.String(),
  createdAt: Type.String(),
});
export type ArtifactReference = Static<typeof ArtifactReferenceSchema>;

export const ArtifactListResponseSchema = Type.Object({
  items: Type.Array(ArtifactDescriptorSchema),
  total: Type.Number(),
});
export type ArtifactListResponse = Static<typeof ArtifactListResponseSchema>;

export const GenerationEngineKindSchema = Type.Union([
  Type.Literal('comfyui'),
  Type.Literal('worker'),
  Type.Literal('cloud'),
]);
export type GenerationEngineKind = Static<typeof GenerationEngineKindSchema>;

export const GenerationEngineSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  kind: GenerationEngineKindSchema,
  baseUrl: Type.String(),
  enabled: Type.Boolean(),
  concurrencyLimit: Type.Number(),
  capabilities: Type.Optional(EngineCapabilitiesSchema),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type GenerationEngine = Static<typeof GenerationEngineSchema>;

export const GenerationWorkflowSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.String(),
  engineKind: GenerationEngineKindSchema,
  category: Type.Optional(MediaCategorySchema),
  latestVersion: Type.Number(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type GenerationWorkflow = Static<typeof GenerationWorkflowSchema>;

export const GenerationWorkflowVersionSchema = Type.Object({
  workflowId: Type.String(),
  version: Type.Number(),
  engineId: Type.Union([Type.String(), Type.Null()]),
  inputSchema: Type.Record(Type.String(), Type.Unknown()),
  category: Type.Optional(MediaCategorySchema),
  inputCapabilities: Type.Optional(WorkflowInputCapabilitiesSchema),
  nodeBindings: Type.Record(Type.String(), Type.Array(Type.String())),
  outputDeclarations: Type.Array(Type.String()),
  outputMediaTypes: Type.Optional(Type.Array(Type.String())),
  outputSchema: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  definition: Type.Record(Type.String(), Type.Unknown()),
  isPublished: Type.Boolean(),
  createdAt: Type.String(),
});
export type GenerationWorkflowVersion = Static<typeof GenerationWorkflowVersionSchema>;

export const AppGenerationAssignmentSchema = Type.Object({
  appId: Type.String(),
  purpose: Type.String(),
  workflowId: Type.String(),
  workflowVersion: Type.Number(),
  engineId: Type.String(),
  updatedAt: Type.String(),
});
export type AppGenerationAssignment = Static<typeof AppGenerationAssignmentSchema>;

export const GenerationTaskStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('submitting'),
  Type.Literal('accepted'),
  Type.Literal('running'),
  Type.Literal('succeeded'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('abandoned'),
]);
export type GenerationTaskStatus = Static<typeof GenerationTaskStatusSchema>;

export const GenerationTaskArtifactSchema = Type.Object({
  artifactId: Type.String(),
  outputName: Type.String(),
  sortOrder: Type.Number(),
  url: Type.String(),
  byteSize: Type.Number(),
  contentType: Type.Union([Type.String(), Type.Null()]),
  sha256: Type.Union([Type.String(), Type.Null()]),
  mediaKind: Type.Optional(MediaKindSchema),
  thumbnailArtifactId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
export type GenerationTaskArtifact = Static<typeof GenerationTaskArtifactSchema>;

export const GenerationTaskDescriptorSchema = Type.Object({
  id: Type.String(),
  appId: Type.String(),
  engineId: Type.String(),
  workflowId: Type.String(),
  workflowVersion: Type.Number(),
  purpose: Type.String(),
  idempotencyKey: Type.Union([Type.String(), Type.Null()]),
  status: GenerationTaskStatusSchema,
  priority: Type.Optional(GenerationPrioritySchema),
  progress: Type.Optional(GenerationProgressSchema),
  actualSeed: Type.Union([Type.Number(), Type.Null()]),
  providerTaskId: Type.Union([Type.String(), Type.Null()]),
  errorCode: Type.Union([Type.String(), Type.Null()]),
  errorMessage: Type.Union([Type.String(), Type.Null()]),
  upstreamMayContinue: Type.Boolean(),
  cancellationScope: Type.Union([Type.Literal('none'), Type.Literal('queued'), Type.Literal('local-tracking')]),
  retryOf: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  finishedAt: Type.Union([Type.String(), Type.Null()]),
  artifacts: Type.Array(GenerationTaskArtifactSchema),
});
export type GenerationTaskDescriptor = Static<typeof GenerationTaskDescriptorSchema>;

export const GenerationWorkerStateSchema = Type.Union([
  Type.Literal('online'), Type.Literal('offline'), Type.Literal('unknown'),
]);
export type GenerationWorkerState = Static<typeof GenerationWorkerStateSchema>;

export const GenerationWorkerSchema = Type.Object({
  engineId: Type.String(),
  name: Type.String(),
  baseUrl: Type.String(),
  enabled: Type.Boolean(),
  model: Type.String(),
  temperature: Type.Number(),
  concurrencyLimit: Type.Literal(1),
  ipAllowlist: Type.Array(Type.String()),
  diskWarningBytes: Type.Number(),
  diskStopBytes: Type.Number(),
  state: GenerationWorkerStateSchema,
  lastSeenAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type GenerationWorker = Static<typeof GenerationWorkerSchema>;

export const GenerationWorkerHealthSchema = Type.Object({
  ok: Type.Boolean(), workerId: Type.String(), ready: Type.Boolean(),
  model: Type.String(), temperature: Type.Number(), concurrency: Type.Literal(1),
  queueDepth: Type.Number(), runningTaskId: Type.Union([Type.String(), Type.Null()]),
  modelDirectoryReady: Type.Boolean(),
  capabilities: Type.Optional(Type.Array(Type.String())),
  disk: Type.Object({ freeBytes: Type.Number(), tempBytes: Type.Number(), maxTempBytes: Type.Number(), warningBytes: Type.Number(), stopBytes: Type.Number() }),
});
export type GenerationWorkerHealth = Static<typeof GenerationWorkerHealthSchema>;

export const H3ExperimentStatusSchema = Type.Object({
  id: Type.Union([Type.Literal('h3-t2v'), Type.Literal('h3-i2v'), Type.Literal('h3-fl2va')]),
  enabled: Type.Boolean(),
  available: Type.Boolean(),
  ready: Type.Boolean(),
  constraints: Type.Object({
    maxWidth: Type.Integer({ minimum: 1 }), maxHeight: Type.Integer({ minimum: 1 }), maxDurationSeconds: Type.Integer({ minimum: 1 }), concurrencyLimit: Type.Integer({ minimum: 1 }),
  }),
  reason: Type.Union([
    Type.Literal('disabled'), Type.Literal('worker_not_configured'), Type.Literal('model_missing'),
    Type.Literal('worker_unreachable'), Type.Literal('worker_http_error'), Type.Literal('worker_not_ready'),
    Type.Literal('comfyui_unreachable'), Type.Literal('workflow_missing'), Type.Literal('custom_node_missing'),
    Type.Literal('binding_invalid'), Type.Literal('output_invalid'), Type.Literal('capability_missing'), Type.Literal('ready'),
  ]),
});
export type H3ExperimentStatus = Static<typeof H3ExperimentStatusSchema>;

export const MediaToolStatusSchema = Type.Object({
  available: Type.Boolean(),
  version: Type.Union([Type.String(), Type.Null()]),
  error: Type.Union([Type.Literal('not_found'), Type.Literal('unavailable'), Type.Null()]),
});
export type MediaToolStatus = Static<typeof MediaToolStatusSchema>;

export const MediaDiagnosticsSchema = Type.Object({
  checkedAt: Type.String(),
  video: Type.Object({
    ffmpeg: MediaToolStatusSchema,
    ffprobe: MediaToolStatusSchema,
    preprocessingReady: Type.Boolean(),
    installHint: Type.Union([Type.String(), Type.Null()]),
  }),
  h3: H3ExperimentStatusSchema,
});
export type MediaDiagnostics = Static<typeof MediaDiagnosticsSchema>;

export const CreativeWorkflowBindingSchema = Type.Object({
  purpose: Type.Union([Type.Literal('text-to-image'), Type.Literal('image-to-image'), Type.Literal('h3-t2v'), Type.Literal('h3-i2v'), Type.Literal('h3-fl2va')]),
  ready: Type.Boolean(),
  status: Type.String(),
  workflow: Type.Union([
    Type.Object({ id: Type.String(), name: Type.String(), version: Type.Number() }),
    Type.Null(),
  ]),
  engine: Type.Union([
    Type.Object({ id: Type.String(), name: Type.String(), kind: Type.String(), enabled: Type.Boolean() }),
    Type.Null(),
  ]),
  constraints: Type.Optional(Type.Object({
    maxWidth: Type.Integer({ minimum: 1 }),
    maxHeight: Type.Integer({ minimum: 1 }),
    maxDurationSeconds: Type.Integer({ minimum: 1 }),
    concurrencyLimit: Type.Integer({ minimum: 1 }),
  })),
  inputCapabilities: Type.Optional(Type.Record(Type.String(), Type.Object({
    mediaTypes: Type.Optional(Type.Array(Type.String())),
    maxBytes: Type.Optional(Type.Integer({ minimum: 1 })),
    required: Type.Optional(Type.Boolean()),
    maxCount: Type.Optional(Type.Integer({ minimum: 1 })),
    semantic: Type.Optional(Type.Union([
      Type.Literal('init_image'), Type.Literal('identity'), Type.Literal('outfit'), Type.Literal('pose'),
      Type.Literal('style'), Type.Literal('composition'), Type.Literal('mask'),
    ])),
  }))),
});
export type CreativeWorkflowBinding = Static<typeof CreativeWorkflowBindingSchema>;

export const CreativeStatusResponseSchema = Type.Object({
  app: Type.Object({ id: Type.String(), name: Type.String() }),
  modes: Type.Object({
    textToImage: CreativeWorkflowBindingSchema,
    imageToImage: CreativeWorkflowBindingSchema,    h3T2v: CreativeWorkflowBindingSchema,    h3I2v: CreativeWorkflowBindingSchema,    h3Fl2va: CreativeWorkflowBindingSchema,
  }),
});
export type CreativeStatusResponse = Static<typeof CreativeStatusResponseSchema>;

export const CreativeReplaySchema = Type.Object({
  mode: Type.Union([Type.Literal('text-to-image'), Type.Literal('image-to-image'), Type.Literal('h3-t2v'), Type.Literal('h3-i2v'), Type.Literal('h3-fl2va')]),
  inputs: Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()])),
  inputArtifactIds: Type.Array(Type.String()),
});
export type CreativeReplay = Static<typeof CreativeReplaySchema>;

export const CreativeTaskResponseSchema = Type.Intersect([
  GenerationTaskDescriptorSchema,
  Type.Object({ replay: CreativeReplaySchema }),
]);
export type CreativeTaskResponse = Static<typeof CreativeTaskResponseSchema>;

export const CreativeTaskListResponseSchema = Type.Object({
  items: Type.Array(CreativeTaskResponseSchema),
});
export type CreativeTaskListResponse = Static<typeof CreativeTaskListResponseSchema>;

export const CreativeArtifactListResponseSchema = Type.Object({
  items: Type.Array(ArtifactDescriptorSchema),
  total: Type.Number(),
});
export type CreativeArtifactListResponse = Static<typeof CreativeArtifactListResponseSchema>;

export const GenerationEventSchema = Type.Object({
  id: Type.Number(),
  taskId: Type.String(),
  appId: Type.String(),
  eventType: Type.String(),
  payload: Type.Record(Type.String(), Type.Unknown()),
  createdAt: Type.String(),
});
export type GenerationEvent = Static<typeof GenerationEventSchema>;

export const StoragePolicySchema = Type.Object({
  appId: Type.String(),
  mode: Type.Union([Type.Literal('keep'), Type.Literal('ttl'), Type.Literal('quota')]),
  ttlDays: Type.Union([Type.Number(), Type.Null()]),
  maxBytes: Type.Union([Type.Number(), Type.Null()]),
});
export type StoragePolicy = Static<typeof StoragePolicySchema>;

export const PersonaTemplateSchema = Type.Object({
  id: Type.String(),
  displayName: Type.String(),
  tags: Type.Array(Type.String()),
  source: Type.Union([Type.String(), Type.Null()]),
  latestVersion: Type.Number(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type PersonaTemplate = Static<typeof PersonaTemplateSchema>;

export const PersonaVersionSchema = Type.Object({
  personaId: Type.String(),
  version: Type.Number(),
  displayName: Type.String(),
  personaPrompt: Type.String(),
  appearancePrompt: Type.Union([Type.String(), Type.Null()]),
  avatarArtifactId: Type.Union([Type.String(), Type.Null()]),
  metadata: Type.Record(Type.String(), Type.Unknown()),
  createdAt: Type.String(),
});
export type PersonaVersion = Static<typeof PersonaVersionSchema>;

/** 角色人设与外观编译器版本；任何影响生成文本的改动都应递增。 */
export const CHARACTER_PERSONA_COMPILER_VERSION = 'character-persona-v2';

// ────────────────────────────────────────────────────────────────────────────
// 生日（可选结构化字段）
// ────────────────────────────────────────────────────────────────────────────

export const CharacterBirthdayCalendarSchema = Type.Union([
  Type.Literal('gregorian'),
  Type.Literal('lunar'),
  Type.Literal('unknown'),
]);
export type CharacterBirthdayCalendar = Static<typeof CharacterBirthdayCalendarSchema>;

export const CharacterBirthdayStatusSchema = Type.Union([
  Type.Literal('known'),
  Type.Literal('needs_confirmation'),
  Type.Literal('unset'),
]);
export type CharacterBirthdayStatus = Static<typeof CharacterBirthdayStatusSchema>;

// 生日为可选结构化字段：只有 status 为 known 且日历为公历时才参与日历与月份筛选。
// rawText 保留原始文字（农历、冲突或模糊写法），供人工确认。
export const CharacterBirthdaySchema = Type.Object({
  status: CharacterBirthdayStatusSchema,
  calendar: CharacterBirthdayCalendarSchema,
  month: Type.Optional(Type.Number()),
  day: Type.Optional(Type.Number()),
  rawText: Type.Optional(Type.String()),
  source: Type.Optional(Type.Union([
    Type.Literal('manual'),
    Type.Literal('card_field'),
    Type.Literal('card_text'),
  ])),
  evidence: Type.Optional(Type.String()),
});
export type CharacterBirthday = Static<typeof CharacterBirthdaySchema>;

// ────────────────────────────────────────────────────────────────────────────
// 外观
// ────────────────────────────────────────────────────────────────────────────

/**
 * V1 结构化外观：细分字段 + 服装列表。
 * 现在只作为兼容读取、旧版本快照和识图候选的表示保留；新草稿使用 V2 的
 * baseText / defaultOutfitText，不再把服装列表作为命名造型库。
 */
export const CharacterAppearanceSchema = Type.Object({
  description: Type.String(),
  hair: Type.String(),
  eyes: Type.String(),
  build: Type.String(),
  outfits: Type.Array(Type.String()),
  accessories: Type.Array(Type.String()),
  stableFeatures: Type.Optional(Type.Array(Type.String())),
  defaultOutfitId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  referenceIds: Type.Optional(Type.Array(Type.String())),
});
export type CharacterAppearance = Static<typeof CharacterAppearanceSchema>;

/** V2 外观：稳定外貌与可替换穿着分开，且不再含服装列表。 */
export const CharacterAppearanceV2Schema = Type.Object({
  baseText: Type.String(),
  defaultOutfitText: Type.String(),
});
export type CharacterAppearanceV2 = Static<typeof CharacterAppearanceV2Schema>;

export const CharacterSpeechSchema = Type.Object({
  tone: Type.String(),
  habits: Type.String(),
  catchphrases: Type.Array(Type.String()),
  examples: Type.Array(Type.String()),
});
export type CharacterSpeech = Static<typeof CharacterSpeechSchema>;

// ────────────────────────────────────────────────────────────────────────────
// V1 草稿（保留用于兼容读取与迁移来源）
// ────────────────────────────────────────────────────────────────────────────

export const CharacterDraftSchema = Type.Object({
  displayName: Type.String(),
  englishName: Type.String(),
  aliases: Type.Array(Type.String()),
  originType: Type.Union([Type.Literal('original'), Type.Literal('ip')]),
  work: Type.String(),
  world: Type.String(),
  summary: Type.String(),
  identity: Type.String(),
  background: Type.String(),
  currentSituation: Type.String(),
  personality: Type.Array(Type.String()),
  motivations: Type.Array(Type.String()),
  beliefs: Type.Array(Type.String()),
  secrets: Type.Array(Type.String()),
  speech: CharacterSpeechSchema,
  likes: Type.Array(Type.String()),
  dislikes: Type.Array(Type.String()),
  fears: Type.Array(Type.String()),
  boundaries: Type.Array(Type.String()),
  appearance: CharacterAppearanceSchema,
  extraRules: Type.String(),
  legacyPrompt: Type.Optional(Type.String()),
  birthday: Type.Optional(CharacterBirthdaySchema),
});
export type CharacterDraft = Static<typeof CharacterDraftSchema>;

// ────────────────────────────────────────────────────────────────────────────
// V2 草稿
// ────────────────────────────────────────────────────────────────────────────

export const CHARACTER_DRAFT_SCHEMA_VERSION_V2 = 2;

export const CharacterDraftV2Schema = Type.Object({
  schemaVersion: Type.Literal(2),
  displayName: Type.String(),
  englishName: Type.String(),
  aliases: Type.Array(Type.String()),
  originType: Type.Union([Type.Literal('original'), Type.Literal('ip')]),
  work: Type.String(),
  summary: Type.String(),
  personaText: Type.String(),
  speechText: Type.String(),
  dialogueExamples: Type.Array(Type.String()),
  behaviorRules: Type.String(),
  appearance: CharacterAppearanceV2Schema,
  birthday: Type.Optional(CharacterBirthdaySchema),
});
export type CharacterDraftV2 = Static<typeof CharacterDraftV2Schema>;

export type CharacterDraftAny = CharacterDraft | CharacterDraftV2;

/** 存储与接口传输用联合：V2 为新写入形态，V1 仅出现在尚未迁移的历史数据。 */
export const CharacterDraftAnySchema = Type.Union([CharacterDraftV2Schema, CharacterDraftSchema]);

export function isCharacterDraftV2(value: unknown): value is CharacterDraftV2 {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Number((value as Record<string, unknown>).schemaVersion) === CHARACTER_DRAFT_SCHEMA_VERSION_V2;
}

// ────────────────────────────────────────────────────────────────────────────
// 统一运行时对象
// ────────────────────────────────────────────────────────────────────────────

/**
 * 角色在生成链路中的唯一标准表示。
 * V1 与 V2 都归一到它；消费方只读这一份结构，不再各自拼字段。
 */
export type CharacterRuntime = {
  readonly schemaVersion: 1 | 2;
  readonly displayName: string;
  readonly englishName: string;
  readonly aliases: readonly string[];
  readonly originType: 'original' | 'ip';
  readonly work: string;
  readonly summary: string;
  /** 稳定的身份、经历、性格、好恶与内在动机。 */
  readonly personaText: string;
  /** 语气、表达习惯、口头禅。 */
  readonly speechText: string;
  /** 每项是一段完整示例，可含多轮对话。 */
  readonly dialogueExamples: readonly string[];
  /** 需要强调的行为约束。 */
  readonly behaviorRules: string;
  readonly appearance: {
    readonly baseText: string;
    readonly defaultOutfitText: string;
    readonly stableFeatures: readonly string[];
    /** V1 结构化外观；仅用于旧输出口径与兼容回退。 */
    readonly legacy?: CharacterAppearance;
  };
  readonly birthday?: CharacterBirthday;
  /** V1 兼容提示词；仅旧数据存在。 */
  readonly legacyPrompt?: string;
  /** V1 extraRules（可能夹带视觉负面词或系统指令）；保留原文但不提升优先级。 */
  readonly legacyExtraRules?: string;
};

function runtimeText(value: unknown, max = 60_000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function runtimeList(value: unknown, maxItems = 200, max = 20_000): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = runtimeText(item, max);
    if (text) seen.add(text);
    if (seen.size >= maxItems) break;
  }
  return [...seen];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** 归一小节：只输出有内容的小节，标签用 ### 以便嵌套在 ## 小节内。 */
function labeledSections(entries: Array<[string, string]>): string {
  return entries
    .map(([label, body]) => [label, body.trim()] as const)
    .filter(([, body]) => Boolean(body))
    .map(([label, body]) => `### ${label}\n${body}`)
    .join('\n\n');
}

function bulletList(values: readonly string[]): string {
  return values.map((value) => `- ${value}`).join('\n');
}

/**
 * 邻舍用 /##\s*你的外观/（非行首锚定）提取外观段到正文末尾。
 * 因此编译输出里任何出现在官方外观段之前的“## 你的外观”都必须被中和，
 * 否则提取会提前开始并把后续行为段落当成外观。
 */
export function neutralizeAppearanceHeadings(text: string): string {
  return text.replace(/#+\s*你的外观/g, '你的外观');
}

/**
 * V1 → 统一运行时。
 * 组合顺序与旧 compileLinshePrompt 保持一致，保证未迁移角色行为不回退。
 */
function v1ToRuntime(draft: CharacterDraft): CharacterRuntime {
  const speech = draft.speech ?? { tone: '', habits: '', catchphrases: [], examples: [] };
  const appearance = draft.appearance;

  // 每个 V1 字段映射到独立小节，便于导入按小节合并时精确定位；全部为空时退回摘要。
  const identityBody = draft.identity || (draft.background || draft.world || draft.currentSituation ? '' : draft.summary);
  const personaText = labeledSections([
    ['身份', identityBody],
    ['关键经历', draft.background],
    ['世界与舞台', draft.world],
    ['当前处境', draft.currentSituation],
    ['性格', bulletList(draft.personality ?? [])],
    ['核心动机', bulletList(draft.motivations ?? [])],
    ['信念与价值观', bulletList(draft.beliefs ?? [])],
    ['喜好', bulletList(draft.likes ?? [])],
    ['厌恶', bulletList(draft.dislikes ?? [])],
    ['恐惧', bulletList(draft.fears ?? [])],
    ['内心隐情（不轻易主动说出）', bulletList(draft.secrets ?? [])],
  ]);

  const speechParts = [
    speech.tone ? `语气：${speech.tone}` : '',
    speech.habits ? `表达习惯：${speech.habits}` : '',
    (speech.catchphrases ?? []).length ? `常用表达：${speech.catchphrases.join('；')}` : '',
  ].filter(Boolean);

  return {
    schemaVersion: 1,
    displayName: runtimeText(draft.displayName, 200),
    englishName: runtimeText(draft.englishName, 200),
    aliases: runtimeList(draft.aliases),
    originType: draft.originType === 'ip' ? 'ip' : 'original',
    work: runtimeText(draft.work, 300),
    summary: runtimeText(draft.summary, 2_000),
    personaText,
    speechText: speechParts.join('\n'),
    dialogueExamples: runtimeList(speech.examples, 30),
    behaviorRules: bulletList(runtimeList(draft.boundaries, 50)),
    appearance: {
      baseText: [
        appearance?.description,
        appearance?.hair && `发型与发色：${appearance.hair}`,
        appearance?.eyes && `眼睛：${appearance.eyes}`,
        appearance?.build && `体态：${appearance.build}`,
        (appearance?.accessories ?? []).length ? `配饰：${appearance!.accessories.join('；')}` : '',
      ]
        .filter(Boolean).join('\n'),
      defaultOutfitText: (appearance?.outfits ?? []).length
        ? (appearance?.defaultOutfitId && appearance.outfits.includes(appearance.defaultOutfitId) ? appearance.defaultOutfitId : appearance.outfits[0])
        : '',
      stableFeatures: runtimeList(appearance?.stableFeatures),
      legacy: appearance,
    },
    ...(draft.birthday ? { birthday: draft.birthday } : {}),
    ...(draft.legacyPrompt ? { legacyPrompt: draft.legacyPrompt } : {}),
    ...(draft.extraRules ? { legacyExtraRules: draft.extraRules } : {}),
  };
}

/** V2 → 统一运行时。 */
function v2ToRuntime(draft: CharacterDraftV2): CharacterRuntime {
  return {
    schemaVersion: 2,
    displayName: runtimeText(draft.displayName, 200),
    englishName: runtimeText(draft.englishName, 200),
    aliases: runtimeList(draft.aliases),
    originType: draft.originType === 'ip' ? 'ip' : 'original',
    work: runtimeText(draft.work, 300),
    summary: runtimeText(draft.summary, 2_000),
    personaText: runtimeText(draft.personaText),
    speechText: runtimeText(draft.speechText, 8_000),
    dialogueExamples: runtimeList(draft.dialogueExamples, 30, 40_000),
    behaviorRules: runtimeText(draft.behaviorRules, 8_000),
    appearance: {
      baseText: runtimeText(draft.appearance?.baseText, 8_000),
      defaultOutfitText: runtimeText(draft.appearance?.defaultOutfitText, 4_000),
      stableFeatures: [],
    },
    ...(draft.birthday ? { birthday: draft.birthday } : {}),
  };
}

/**
 * 统一入口：接受 V1 草稿、V2 草稿，或活动快照里已投影的 persona 对象。
 * 投影对象若已含 V2 字段则直接采用，否则按 V1 语义回退组合。
 */
export function toCharacterRuntime(input: unknown): CharacterRuntime {
  if (isCharacterDraftV2(input)) return v2ToRuntime(input);
  const source = asRecord(input);

  // 活动快照投影：可能已带 V2 字段，也可能只有 V1 字段与 sourceSnapshot。
  if (source.personaText !== undefined || source.speechText !== undefined || asRecord(source.appearance).baseText !== undefined) {
    const snapshot = asRecord(source.sourceSnapshot);
    const merged: CharacterDraftV2 = {
      schemaVersion: 2,
      displayName: runtimeText(source.displayName ?? snapshot.displayName, 200),
      englishName: runtimeText(source.englishName ?? snapshot.englishName, 200),
      aliases: runtimeList(source.aliases ?? snapshot.aliases),
      originType: (source.originType ?? snapshot.originType) === 'ip' ? 'ip' : 'original',
      work: runtimeText(source.work ?? snapshot.work, 300),
      summary: runtimeText(source.summary ?? snapshot.summary, 2_000),
      personaText: runtimeText(source.personaText),
      speechText: runtimeText(source.speechText, 8_000),
      dialogueExamples: runtimeList(source.dialogueExamples ?? asRecord(snapshot.speech).examples, 30, 40_000),
      behaviorRules: runtimeText(source.behaviorRules, 8_000),
      appearance: {
        baseText: runtimeText(asRecord(source.appearance).baseText, 8_000),
        defaultOutfitText: runtimeText(asRecord(source.appearance).defaultOutfitText, 4_000),
      },
      ...(source.birthday ? { birthday: source.birthday as CharacterBirthday } : {}),
    };
    const runtime = v2ToRuntime(merged);
    const legacy = asRecord(source.appearance).legacy;
    return legacy
      ? { ...runtime, appearance: { ...runtime.appearance, legacy: legacy as CharacterAppearance } }
      : runtime;
  }

  // 旧活动文档把投影字段与 sourceSnapshot 分开存放；快照兜底合并，投影自身字段优先。
  const withSnapshot = source.sourceSnapshot
    ? { ...asRecord(source.sourceSnapshot), ...source }
    : source;
  return v1ToRuntime(normalizeCharacterDraft(withSnapshot));
}

// ────────────────────────────────────────────────────────────────────────────
// V1 草稿归一化（供兼容读取与迁移）
// ────────────────────────────────────────────────────────────────────────────

export const EMPTY_CHARACTER_APPEARANCE: CharacterAppearance = {
  description: '', hair: '', eyes: '', build: '', outfits: [], accessories: [],
};

/**
 * 归一化 V1 结构化外观。字符串按整体描述处理（旧数据曾用纯字符串存外观）。
 */
export function normalizeCharacterAppearance(value: unknown): CharacterAppearance {
  if (typeof value === 'string') return { ...EMPTY_CHARACTER_APPEARANCE, description: value.trim() };
  const source = asRecord(value);
  const list = (input: unknown) => runtimeList(input, 60, 1_000);
  const text = (input: unknown, max = 4_000) => runtimeText(input, max);
  return {
    description: text(source.description),
    hair: text(source.hair, 1_000),
    eyes: text(source.eyes, 1_000),
    build: text(source.build, 1_000),
    outfits: list(source.outfits),
    accessories: list(source.accessories),
    ...(Array.isArray(source.stableFeatures) ? { stableFeatures: list(source.stableFeatures) } : {}),
    ...(typeof source.defaultOutfitId === 'string' || source.defaultOutfitId === null ? { defaultOutfitId: source.defaultOutfitId } : {}),
    ...(Array.isArray(source.referenceIds) ? { referenceIds: list(source.referenceIds) } : {}),
  };
}

export const EMPTY_CHARACTER_DRAFT: CharacterDraft = {
  displayName: '', englishName: '', aliases: [], originType: 'original', work: '', world: '', summary: '',
  identity: '', background: '', currentSituation: '', personality: [], motivations: [], beliefs: [], secrets: [],
  speech: { tone: '', habits: '', catchphrases: [], examples: [] }, likes: [], dislikes: [], fears: [], boundaries: [],
  appearance: { ...EMPTY_CHARACTER_APPEARANCE },
  extraRules: '',
};

/** 归一化 V1 草稿。不认识的字段一律丢弃，调用方负责判定 schemaVersion。 */
export function normalizeCharacterDraft(raw: unknown): CharacterDraft {
  const source = asRecord(raw);
  const speech = asRecord(source.speech);
  const appearanceSource = source.appearance;
  const appearance = normalizeCharacterAppearance(appearanceSource);
  return {
    ...EMPTY_CHARACTER_DRAFT,
    displayName: runtimeText(source.displayName, 200),
    englishName: runtimeText(source.englishName, 200),
    aliases: runtimeList(source.aliases, 50),
    originType: source.originType === 'ip' ? 'ip' : 'original',
    work: runtimeText(source.work, 300),
    world: runtimeText(source.world, 300),
    summary: runtimeText(source.summary, 2_000),
    identity: runtimeText(source.identity),
    background: runtimeText(source.background),
    currentSituation: runtimeText(source.currentSituation),
    personality: runtimeList(source.personality),
    motivations: runtimeList(source.motivations),
    beliefs: runtimeList(source.beliefs),
    secrets: runtimeList(source.secrets),
    speech: {
      tone: runtimeText(speech.tone, 4_000),
      habits: runtimeText(speech.habits, 4_000),
      catchphrases: runtimeList(speech.catchphrases, 50, 1_000),
      examples: runtimeList(speech.examples, 30, 40_000),
    },
    likes: runtimeList(source.likes),
    dislikes: runtimeList(source.dislikes),
    fears: runtimeList(source.fears),
    boundaries: runtimeList(source.boundaries),
    appearance,
    extraRules: runtimeText(source.extraRules),
    ...(runtimeText(source.legacyPrompt) ? { legacyPrompt: runtimeText(source.legacyPrompt) } : {}),
    ...(source.birthday && typeof source.birthday === 'object' ? { birthday: source.birthday as CharacterBirthday } : {}),
  };
}

export const EMPTY_CHARACTER_DRAFT_V2: CharacterDraftV2 = {
  schemaVersion: 2,
  displayName: '', englishName: '', aliases: [], originType: 'original', work: '', summary: '',
  personaText: '', speechText: '', dialogueExamples: [], behaviorRules: '',
  appearance: { baseText: '', defaultOutfitText: '' },
};

/** 归一化 V2 草稿。 */
export function normalizeCharacterDraftV2(raw: unknown): CharacterDraftV2 {
  const source = asRecord(raw);
  const appearance = asRecord(source.appearance);
  return {
    ...EMPTY_CHARACTER_DRAFT_V2,
    displayName: runtimeText(source.displayName, 200),
    englishName: runtimeText(source.englishName, 200),
    aliases: runtimeList(source.aliases, 50),
    originType: source.originType === 'ip' ? 'ip' : 'original',
    work: runtimeText(source.work, 300),
    summary: runtimeText(source.summary, 2_000),
    personaText: runtimeText(source.personaText),
    speechText: runtimeText(source.speechText, 8_000),
    dialogueExamples: runtimeList(source.dialogueExamples, 30, 40_000),
    behaviorRules: runtimeText(source.behaviorRules, 8_000),
    appearance: {
      baseText: runtimeText(appearance.baseText, 8_000),
      defaultOutfitText: runtimeText(appearance.defaultOutfitText, 4_000),
    },
    ...(source.birthday && typeof source.birthday === 'object' ? { birthday: source.birthday as CharacterBirthday } : {}),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// V1 → V2 迁移（纯函数，便于测试与重复执行）
// ────────────────────────────────────────────────────────────────────────────

export type CharacterMigrationConflict = {
  readonly kind: 'mixed_extra_rules' | 'ambiguous_appearance' | 'accessory_placement' | 'ambiguous_legacy_prompt';
  readonly detail: string;
};

export type CharacterMigrationResult = {
  readonly draft: CharacterDraftV2;
  readonly conflicts: readonly CharacterMigrationConflict[];
};

const OUTFIT_HINT_PATTERN = /(?:礼[服裙]|大衣|外套|制服|裙|衬衫|西装|披风|斗篷|和服|泳装|睡衣|女仆|校服|装备|铠甲|盔甲|服[装饰]|套装|outfit|dress|uniform|costume)/i;

/**
 * V1 → V2 无损映射：所有文字原样进入对应小节，不做 AI 改写。
 * 只把无法确定归类的内容标为冲突，交人工确认。
 *
 * 已是 V2 的输入直接归一化返回（无冲突）。这一点是硬要求：迁移可能被重复执行，
 * 若把 V2 当 V1 再解析一次，V2 字段没有对应项，正文会被清空。
 */
export function migrateCharacterDraftToV2(raw: unknown): CharacterMigrationResult {
  if (isCharacterDraftV2(raw)) return { draft: normalizeCharacterDraftV2(raw), conflicts: [] };
  const draft = normalizeCharacterDraft(raw);
  const runtime = v1ToRuntime(draft);
  const conflicts: CharacterMigrationConflict[] = [];

  if (draft.extraRules.trim()) {
    conflicts.push({
      kind: 'mixed_extra_rules',
      detail: '原 extraRules 可能夹带视觉负面词或系统指令，已原样保留在 behaviorRules，优先级未提升，需人工复核。',
    });
  }
  const legacy = runtime.appearance.legacy;
  const hasDetails = Boolean(legacy?.hair || legacy?.eyes || legacy?.build);
  const descriptionMentionsOutfit = OUTFIT_HINT_PATTERN.test(legacy?.description ?? '');
  if (hasDetails && descriptionMentionsOutfit) {
    conflicts.push({
      kind: 'ambiguous_appearance',
      detail: '整体外观描述与单独的发型/眼睛/体态字段并存，且描述疑似包含服装。原文均已保留，需要人工确认外貌与默认穿着的分界。',
    });
  }
  if ((legacy?.accessories ?? []).length) {
    conflicts.push({
      kind: 'accessory_placement',
      detail: '旧配饰无法区分稳定特征与随服装变化的饰品，已整体留在基础外貌，需人工确认。',
    });
  }
  if (draft.legacyPrompt && (draft.identity.trim() || draft.personality.length)) {
    conflicts.push({
      kind: 'ambiguous_legacy_prompt',
      detail: '旧数据同时存在 legacyPrompt 与结构化人设；按旧实际生效逻辑以结构化字段为准，legacyPrompt 保留在原文归档中。',
    });
  }

  const accessories = (legacy?.accessories ?? []).filter(Boolean);
  const baseTextParts = [
    legacy?.description ?? '',
    legacy?.hair ? `发型与发色：${legacy.hair}` : '',
    legacy?.eyes ? `眼睛：${legacy.eyes}` : '',
    legacy?.build ? `体态：${legacy.build}` : '',
    (legacy?.stableFeatures ?? []).length ? `稳定辨识特征：${legacy!.stableFeatures!.join('；')}` : '',
    accessories.length ? `配饰（可能随服装变化，待确认）：${accessories.join('；')}` : '',
  ].filter(Boolean).map((part) => part.trim()).filter(Boolean);

  // 只有旧提示词、没有结构化人设时，旧正文才是最完整的原文：直接作为人设正文保留，
  // 不再套一层「身份」小标题（旧正文本身已含完整分节）。
  const legacyOnly = Boolean(draft.legacyPrompt) && !draft.identity.trim() && draft.personality.length === 0;
  const personaText = legacyOnly ? String(draft.legacyPrompt).trim() : runtime.personaText;

  return {
    draft: {
      schemaVersion: 2,
      displayName: draft.displayName,
      englishName: draft.englishName,
      aliases: draft.aliases,
      originType: draft.originType,
      work: draft.work,
      summary: draft.summary,
      personaText,
      speechText: runtime.speechText,
      dialogueExamples: [...runtime.dialogueExamples],
      behaviorRules: [runtime.behaviorRules, draft.extraRules.trim()].filter(Boolean).join('\n'),
      appearance: {
        baseText: baseTextParts.join('\n'),
        defaultOutfitText: runtime.appearance.defaultOutfitText,
      },
      ...(draft.birthday ? { birthday: draft.birthday } : {}),
    },
    conflicts,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 邻舍协议编译
// ────────────────────────────────────────────────────────────────────────────

function compileHeading(runtime: CharacterRuntime): string {
  return `你是${runtime.displayName}${runtime.englishName ? `(${runtime.englishName})` : ''}${runtime.originType === 'ip' && runtime.work ? `，来自《${runtime.work}》` : ''}。`;
}

/**
 * 编译邻舍角色卡提示词。
 *
 * 关键约定：唯一的顶层 `## 你的外观` 必须位于正文末尾——邻舍按它提取到字符串
 * 末尾作为外观段（见 upstream characterPersona.js），任何放在其后的段落都会被
 * 误当外观。用户正文里出现的同名标题会在编译视图被中和，不改原文。
 */
export function compileLinshePrompt(input: unknown): string {
  const runtime = toCharacterRuntime(input);

  // V1 且结构化人设与 personality 均为空时，旧行为是直接返回 legacyPrompt。
  if (runtime.schemaVersion === 1 && runtime.legacyPrompt) {
    const draft = normalizeCharacterDraft(input);
    if (!draft.identity && draft.personality.length === 0) return runtime.legacyPrompt;
  }

  const sections: string[] = [];
  const personaBody = runtime.personaText.trim() || (runtime.schemaVersion === 1 ? runtime.summary.trim() : '');
  sections.push(`## 你的身份与经历\n${neutralizeAppearanceHeadings(personaBody) || '尚未补充。'}`);

  if (runtime.speechText.trim()) {
    sections.push(`## 你的说话方式\n${neutralizeAppearanceHeadings(runtime.speechText.trim())}`);
  }
  if (runtime.behaviorRules.trim()) {
    sections.push(`## 你的行为约束\n${neutralizeAppearanceHeadings(runtime.behaviorRules.trim())}`);
  }
  if (runtime.dialogueExamples.length) {
    sections.push(`## 对话示例\n${runtime.dialogueExamples.map((example) => `- ${example}`).join('\n')}`);
  }
  if (runtime.legacyExtraRules?.trim()) {
    sections.push(`## 额外规则\n${neutralizeAppearanceHeadings(runtime.legacyExtraRules.trim())}`);
  }

  // 外观必须是最后一段。
  const visual = buildCharacterVisualContext(runtime);
  sections.push(`## 你的外观\n${visual.text || '尚未补充。'}`);

  return [compileHeading(runtime), ...sections].join('\n\n');
}

// ────────────────────────────────────────────────────────────────────────────
// 视觉编译
// ────────────────────────────────────────────────────────────────────────────

export type CharacterVisualContext = {
  /** 稳定外貌正文。 */
  readonly baseText: string;
  /** 本次生效穿着；空字符串 = 明确未指定穿着。 */
  readonly outfitText: string;
  readonly stableFeatures: readonly string[];
  /** 拼好的生图外观文本。 */
  readonly text: string;
  readonly outfitSource: 'activity' | 'default' | 'none';
};

/**
 * 统一视觉编译：基础外貌 + 有效穿着。
 *
 * options.outfitOverride 的语义必须区分：
 * - undefined：未设置，使用角色默认穿着；
 * - ''（空字符串）：本次明确清空穿着；
 * - 非空字符串：使用本次指定穿着。
 */
export function buildCharacterVisualContext(
  input: unknown,
  options: { outfitOverride?: string | null } = {},
): CharacterVisualContext {
  const runtime = toCharacterRuntime(input);
  const override = options.outfitOverride;
  const hasOverride = override !== undefined && override !== null;
  const outfitText = hasOverride ? String(override).trim() : runtime.appearance.defaultOutfitText.trim();
  const outfitSource: CharacterVisualContext['outfitSource'] = !outfitText ? 'none' : (hasOverride ? 'activity' : 'default');

  const lines = [
    runtime.appearance.baseText.trim(),
    runtime.appearance.stableFeatures.length ? `稳定辨识特征：${runtime.appearance.stableFeatures.join('；')}` : '',
    outfitText ? `服装：${outfitText}` : '',
  ].filter(Boolean);

  return {
    baseText: runtime.appearance.baseText.trim(),
    outfitText,
    stableFeatures: runtime.appearance.stableFeatures,
    text: lines.join('\n'),
    outfitSource,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 生成上下文（带预算的角色人设文本）
// ────────────────────────────────────────────────────────────────────────────

export type CharacterContextOptions = {
  /** 附带几条对话示例；默认 0。 */
  readonly includeExamples?: number;
  /** 整个角色块的字符预算。 */
  readonly budgetChars?: number;
};

export type CharacterContextSection = {
  readonly label: string;
  readonly text: string;
  readonly trimmed: boolean;
};

export type CharacterContextResult = {
  readonly sections: readonly CharacterContextSection[];
  readonly text: string;
  readonly usedChars: number;
  readonly budgetChars: number;
  /** 被缩减或丢弃的部分标签，便于调用方记录与提示。 */
  readonly reduced: readonly string[];
};

/** 在段落或句读边界截断，避免半句话或半条规则。 */
function truncateAtBoundary(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  if (max <= 0) return { text: '', truncated: true };
  const slice = text.slice(0, max);
  const candidates = [slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'), slice.lastIndexOf('。'), slice.lastIndexOf('；'), slice.lastIndexOf('，')];
  const cut = Math.max(...candidates);
  return { text: (cut >= Math.floor(max * 0.4) ? slice.slice(0, cut) : slice).trimEnd(), truncated: true };
}

/**
 * 构建一位角色的生成上下文分节。
 *
 * 设计要点（规划 4.2）：
 * - 行为约束与说话方式有独立预算，人设正文只吃剩余空间，避免正文过长把关键约束挤掉；
 * - 不做整块末尾硬截断，每节按段落/句读边界裁剪并标记 trimmed；
 * - 对话示例只在预算有余时补充，且不拆断单条示例。
 */
export function buildCharacterContextSections(input: unknown, options: CharacterContextOptions = {}): CharacterContextResult {
  const runtime = toCharacterRuntime(input);
  const budgetChars = Math.max(240, options.budgetChars ?? 1_200);
  const reduced: string[] = [];

  const nameLine = `${runtime.displayName}${runtime.englishName ? `（${runtime.englishName}）` : ''}${runtime.work ? ` 出自《${runtime.work}》` : ''}`;

  const rulesRaw = runtime.behaviorRules.trim();
  const speechRaw = runtime.speechText.trim();
  const rulesFit = truncateAtBoundary(rulesRaw, rulesRaw ? Math.min(Math.floor(budgetChars * 0.3), rulesRaw.length) : 0);
  const speechFit = truncateAtBoundary(speechRaw, speechRaw ? Math.min(Math.floor(budgetChars * 0.3), speechRaw.length) : 0);
  if (rulesFit.truncated) reduced.push('行为约束');
  if (speechFit.truncated) reduced.push('说话方式');

  const personaRaw = runtime.personaText.trim();
  const personaBudget = Math.max(0, budgetChars - nameLine.length - rulesFit.text.length - speechFit.text.length - 40);
  const personaFit = truncateAtBoundary(personaRaw, personaBudget);
  if (personaFit.truncated) reduced.push('人设正文');

  const sections: CharacterContextSection[] = [];
  if (personaFit.text) sections.push({ label: '人设', text: personaFit.text, trimmed: personaFit.truncated });
  if (speechFit.text) sections.push({ label: '说话方式', text: speechFit.text, trimmed: speechFit.truncated });
  if (rulesFit.text) sections.push({ label: '行为约束（不可违背）', text: rulesFit.text, trimmed: rulesFit.truncated });

  let used = nameLine.length + sections.reduce((sum, section) => sum + section.text.length + section.label.length + 6, 0);
  const requested = Math.max(0, options.includeExamples ?? 0);
  const examples: string[] = [];
  for (const example of runtime.dialogueExamples.slice(0, requested)) {
    if (used + example.length + 8 > budgetChars) { reduced.push('对话示例'); break; }
    used += example.length + 8;
    examples.push(example);
  }
  if (examples.length) sections.push({ label: '对话示例', text: examples.join('\n'), trimmed: examples.length < runtime.dialogueExamples.slice(0, requested).length });

  const text = [nameLine, ...sections.map((section) => `${section.label}：${section.text}`)].filter(Boolean).join('\n');
  const finalFit = truncateAtBoundary(text, budgetChars);
  if (finalFit.truncated && !reduced.length) reduced.push('整体');
  return { sections, text: finalFit.text, usedChars: finalFit.text.length, budgetChars, reduced };
}

/** 便捷：只需要拼好的角色上下文文本。 */
export function buildCharacterContextText(input: unknown, options: CharacterContextOptions = {}): string {
  return buildCharacterContextSections(input, options).text;
}

/** 便捷：只需要外观段文本（头像、立绘、活动生图）。 */
export function buildCharacterVisualText(input: unknown, options: { outfitOverride?: string | null } = {}): string {
  return buildCharacterVisualContext(input, options).text;
}

// ────────────────────────────────────────────────────────────────────────────
// V1 兼容视图
// ────────────────────────────────────────────────────────────────────────────

function splitRuleLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean);
}

/**
 * 把任意草稿投影成 V1 形状，供只支持 V1 字段的旧接口读取（如酒馆导出、批量脚本）。
 *
 * 这是**只读兼容视图**：信息在细分字段间重新分布，不保证可逆，也不能用它回写
 * 权威草稿——回写必须走 V2 迁移。
 */

// ────────────────────────────────────────────────────────────────────────────
// V1 字段补丁合并到 V2（导入会话的「只覆盖卡片提供的字段」语义）
// ────────────────────────────────────────────────────────────────────────────

/** V1 字段 → 人设正文小节标题（与迁移生成的小节一致）。 */
const V1_PERSONA_SECTION: Record<string, string> = {
  identity: '身份',
  background: '关键经历',
  currentSituation: '当前处境',
  world: '世界与舞台',
  personality: '性格',
  motivations: '核心动机',
  beliefs: '信念与价值观',
  likes: '喜好',
  dislikes: '厌恶',
  fears: '恐惧',
  secrets: '内心隐情（不轻易主动说出）',
};

type PersonaSectionMap = Map<string, { label: string; body: string; index: number }>;

function splitPersonaSections(personaText: string): PersonaSectionMap {
  const map: PersonaSectionMap = new Map();
  const matches = [...personaText.matchAll(/^###\s*(\S[^\n]*)$/gm)];
  matches.forEach((match, index) => {
    const label = match[1].trim();
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? personaText.length) : personaText.length;
    map.set(label, { label, body: personaText.slice(start, end).trim(), index });
  });
  return map;
}

function renderPersonaSections(original: string, sections: PersonaSectionMap, touched: Set<string>): string {
  if (!touched.size) return original;
  const ordered = [...sections.values()].sort((a, b) => a.index - b.index);
  const preamble = sections.size ? '' : original.trim();
  return [preamble, ...ordered.map((block) => ('### ' + block.label + '\n' + block.body).trim())].filter(Boolean).join('\n\n');
}

/** 从基础外貌正文里读回迁移时写下的分部位描述。 */
function parseBaseAppearance(baseText: string): { description: string; hair: string; eyes: string; build: string; accessories: string } {
  const parts = { description: '', hair: '', eyes: '', build: '', accessories: '' };
  const rest: string[] = [];
  for (const rawLine of baseText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^(发型与发色|眼睛|体态|配饰)[：:]\s*(.*)$/.exec(line);
    if (!match) { rest.push(line); continue; }
    if (match[1] === '发型与发色') parts.hair = match[2];
    else if (match[1] === '眼睛') parts.eyes = match[2];
    else if (match[1] === '体态') parts.build = match[2];
    else parts.accessories = match[2];
  }
  parts.description = rest.join('\n').trim();
  return parts;
}

/**
 * 把 V1 形态的字段补丁合并进权威 V2 草稿。
 *
 * 只覆盖补丁提供的部分：人设字段按小节替换或新增，未提供的小节与穿着保持原样。
 * 这样导入角色卡时不会因为重建正文而丢掉原有的其他段落。
 */
export function applyV1PatchToV2(stored: unknown, patch: Record<string, unknown>): CharacterDraftV2 {
  const base: CharacterDraftV2 = isCharacterDraftV2(stored) ? normalizeCharacterDraftV2(stored) : migrateCharacterDraftToV2(stored).draft;
  const next: CharacterDraftV2 = { ...base, appearance: { ...base.appearance } };
  const sections = splitPersonaSections(base.personaText);
  const touched = new Set<string>();

  const setSection = (label: string, body: string) => {
    const existing = sections.get(label);
    sections.set(label, { label, body: body.trim(), index: existing?.index ?? Number.MAX_SAFE_INTEGER });
    touched.add(label);
  };
  const stringPatch = (key: string) => {
    const value = patch[key];
    return typeof value === 'string' ? value.trim() : '';
  };
  const listPatch = (key: string) => {
    const value = patch[key];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()).map((item) => item.trim()) : [];
  };

  if (typeof patch.displayName === 'string' && patch.displayName.trim()) next.displayName = patch.displayName.trim();
  if (typeof patch.englishName === 'string') next.englishName = patch.englishName.trim();
  if (typeof patch.work === 'string') next.work = patch.work.trim();
  if (patch.originType === 'ip' || patch.originType === 'original') next.originType = patch.originType;
  if (typeof patch.summary === 'string') next.summary = patch.summary.trim();
  if (Array.isArray(patch.aliases)) next.aliases = listPatch('aliases');

  for (const [key, label] of Object.entries(V1_PERSONA_SECTION)) {
    if (!(key in patch)) continue;
    const isText = key === 'identity' || key === 'background' || key === 'currentSituation' || key === 'world';
    const body = isText ? stringPatch(key) : listPatch(key).map((item) => '- ' + item).join('\n');
    if (body) setSection(label, body);
  }

  const speechPatch = asRecord(patch.speech);
  const speechParts: string[] = [];
  if (typeof speechPatch.tone === 'string' && speechPatch.tone.trim()) speechParts.push('语气：' + speechPatch.tone.trim());
  if (typeof speechPatch.habits === 'string' && speechPatch.habits.trim()) speechParts.push('表达习惯：' + speechPatch.habits.trim());
  const catchphrases = Array.isArray(speechPatch.catchphrases)
    ? speechPatch.catchphrases.filter((item): item is string => typeof item === 'string' && !!item.trim()).map((item) => item.trim())
    : [];
  if (catchphrases.length) speechParts.push('常用表达：' + catchphrases.join('；'));
  if (speechParts.length) next.speechText = speechParts.join('\n');
  if (Array.isArray(speechPatch.examples)) {
    next.dialogueExamples = speechPatch.examples.filter((item): item is string => typeof item === 'string' && !!item.trim()).map((item) => item.trim());
  }

  const appearancePatch = asRecord(patch.appearance);
  if (Object.keys(appearancePatch).length) {
    const parsed = parseBaseAppearance(base.appearance.baseText);
    const keep = (key: string, current: string) => (typeof appearancePatch[key] === 'string' ? String(appearancePatch[key]).trim() : current);
    const hair = keep('hair', parsed.hair);
    const eyes = keep('eyes', parsed.eyes);
    const build = keep('build', parsed.build);
    const accessories = Array.isArray(appearancePatch.accessories)
      ? appearancePatch.accessories.filter((item): item is string => typeof item === 'string' && !!item.trim()).map((item) => item.trim()).join('；')
      : parsed.accessories;
    next.appearance.baseText = [
      keep('description', parsed.description),
      hair ? '发型与发色：' + hair : '',
      eyes ? '眼睛：' + eyes : '',
      build ? '体态：' + build : '',
      accessories ? '配饰：' + accessories : '',
    ].filter(Boolean).join('\n');
    if (Array.isArray(appearancePatch.outfits)) {
      const outfits = appearancePatch.outfits.filter((item): item is string => typeof item === 'string' && !!item.trim()).map((item) => item.trim());
      const preferred = typeof appearancePatch.defaultOutfitId === 'string' ? appearancePatch.defaultOutfitId.trim() : '';
      if (preferred && outfits.includes(preferred)) next.appearance.defaultOutfitText = preferred;
      else if (outfits.length) next.appearance.defaultOutfitText = outfits[0];
    }
  }

  next.personaText = renderPersonaSections(base.personaText, sections, touched);
  return next;
}

export function characterV1View(input: unknown): CharacterDraft {
  const runtime = toCharacterRuntime(input);
  return {
    displayName: runtime.displayName,
    englishName: runtime.englishName,
    aliases: [...runtime.aliases],
    originType: runtime.originType,
    work: runtime.work,
    world: '',
    summary: runtime.summary,
    identity: runtime.personaText,
    background: '',
    currentSituation: '',
    personality: [],
    motivations: [],
    beliefs: [],
    secrets: [],
    speech: {
      tone: runtime.speechText,
      habits: '',
      catchphrases: [],
      examples: [...runtime.dialogueExamples],
    },
    likes: [],
    dislikes: [],
    fears: [],
    boundaries: splitRuleLines(runtime.behaviorRules),
    appearance: {
      ...normalizeCharacterAppearance(runtime.appearance.legacy),
      description: runtime.appearance.baseText,
      outfits: runtime.appearance.defaultOutfitText ? [runtime.appearance.defaultOutfitText] : [],
      ...(runtime.appearance.stableFeatures.length ? { stableFeatures: [...runtime.appearance.stableFeatures] } : {}),
    },
    extraRules: '',
    ...(runtime.birthday ? { birthday: runtime.birthday } : {}),
  };
}


export const CharacterRelationshipSchema = Type.Object({
  id: Type.String(),
  fromCharacterId: Type.String(),
  toCharacterId: Type.String(),
  relationType: Type.String(),
  description: Type.String(),
  updatedAt: Type.String(),
});
export type CharacterRelationship = Static<typeof CharacterRelationshipSchema>;

export const CharacterSourceSchema = Type.Object({
  id: Type.String(),
  characterId: Type.String(),
  title: Type.String(),
  url: Type.Union([Type.String(), Type.Null()]),
  excerpt: Type.String(),
  sourceType: Type.Union([
    Type.Literal('manual'),
    Type.Literal('moegirl'),
    Type.Literal('web'),
    Type.Literal('tavern-card'),
    Type.Literal('character-tavern'),
    Type.Literal('external-card'),
    // 人设结构升级时归档的原文，不是外部资料来源。
    Type.Literal('migration_archive'),
  ]),
  fetchedAt: Type.String(),
  providerId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  externalId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  payloadHash: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sourceSnapshotId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
export type CharacterSource = Static<typeof CharacterSourceSchema>;

// ────────────────────────────────────────────────────────────────────────────
// 结构迁移复核（规划第 7 节剩余项：给迁移复核项一个可查、可处理的入口）
// ────────────────────────────────────────────────────────────────────────────

/** 迁移时记录、但需要人工确认的语义冲突类别。 */
export const CharacterMigrationConflictSchema = Type.Object({
  kind: Type.Union([
    Type.Literal('mixed_extra_rules'),
    Type.Literal('ambiguous_appearance'),
    Type.Literal('accessory_placement'),
    Type.Literal('ambiguous_legacy_prompt'),
  ]),
  detail: Type.String(),
});

/**
 * 一位角色的迁移复核项。
 *
 * 复核内容由「归档原文 + 迁移纯函数」现场推导，不另存一份可漂移的副本：
 * 归档是当初不可变的输入，纯函数是确定性的，因此结果与迁移时一致。
 */
export const CharacterMigrationReviewSchema = Type.Object({
  characterId: Type.String(),
  displayName: Type.String(),
  /** 是否找到迁移归档。没有归档时下面的复核内容为空。 */
  hasArchive: Type.Boolean(),
  archivedAt: Type.Union([Type.String(), Type.Null()]),
  conflicts: Type.Array(CharacterMigrationConflictSchema),
  /** 旧数据里未生效的服装（含旧多套服装），供确认是否补进默认穿着。 */
  archivedOutfits: Type.Array(Type.String()),
  current: Type.Object({
    baseText: Type.String(),
    defaultOutfitText: Type.String(),
  }),
  draftRevision: Type.Number(),
});
export type CharacterMigrationReview = Static<typeof CharacterMigrationReviewSchema>;

export const CharacterMigrationReviewListSchema = Type.Object({
  items: Type.Array(CharacterMigrationReviewSchema),
  /** 存在复核项的角色总数，用于列表页提示。 */
  total: Type.Number(),
});
export type CharacterMigrationReviewList = Static<typeof CharacterMigrationReviewListSchema>;


export const CharacterVersionSchema = Type.Object({
  characterId: Type.String(),
  version: Type.Number(),
  data: CharacterDraftAnySchema,
  compiledLinshePrompt: Type.String(),
  relationships: Type.Array(CharacterRelationshipSchema),
  createdAt: Type.String(),
  draftRevision: Type.Optional(Type.Number()),
  /**
   * 生成该版本提示词的编译器版本。迁移 22 之前的版本没有记录，保持缺省，
   * 不回填成新版本号——旧提示词按旧口径编译，不能冒充新编译器产物（规划 6.3）。
   */
  compilerVersion: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  appearanceSnapshot: Type.Optional(CharacterAppearanceSchema),
  provenance: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type CharacterVersion = Static<typeof CharacterVersionSchema>;

export const CharacterOrganizationSchema = Type.Object({
  favorite: Type.Boolean(),
  groups: Type.Array(Type.String()),
  interpretation: Type.String(),
});
export type CharacterOrganization = Static<typeof CharacterOrganizationSchema>;
export type CharacterBrowseQuery = {
  q?: string; works?: string[]; tags?: string[]; groups?: string[];
  tagMode?: 'any' | 'all'; favorite?: boolean; mediaType?: string; originType?: string;
  reference?: 'yes' | 'no'; appearance?: 'yes' | 'no'; interpretation?: string;
  source?: string; unclassified?: 'work' | 'tags'; excludeIds?: string[];
  birthdayStatus?: CharacterBirthdayStatus; birthdayMonth?: number;
  kinds?: ('birthday' | 'activity')[];
  sort?: 'updated' | 'name'; page?: number; pageSize?: number;
};
export type CharacterWork = { name: string; aliases: string[]; mediaType: string };
export type CharacterBrowseResult = {
  items: CharacterProfile[]; total: number; page: number; pageSize: number;
  facets: {
    works: CharacterWork[]; tags: string[]; groups: string[]; interpretations: string[]; sources: string[];
    birthdayMonths: number[];
  };
};

export const CharacterProfileSchema = Type.Object({
  organization: Type.Optional(CharacterOrganizationSchema),
  birthday: Type.Optional(CharacterBirthdaySchema),
  id: Type.String(),
  slug: Type.String(),
  displayName: Type.String(),
  draft: CharacterDraftAnySchema,
  tags: Type.Array(Type.String()),
  avatarUrl: Type.Union([Type.String(), Type.Null()]),
  latestVersion: Type.Union([Type.Number(), Type.Null()]),
  archived: Type.Boolean(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  draftRevision: Type.Optional(Type.Number()),
  defaultOutfitId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
export type CharacterProfile = Static<typeof CharacterProfileSchema>;

export const CharacterListResponseSchema = Type.Object({
  items: Type.Array(CharacterProfileSchema),
});
export type CharacterListResponse = Static<typeof CharacterListResponseSchema>;

export const CharacterGenerateResponseSchema = Type.Object({
  draft: CharacterDraftAnySchema,
  sources: Type.Array(CharacterSourceSchema),
});
export type CharacterGenerateResponse = Static<typeof CharacterGenerateResponseSchema>;

export const CharacterAssetResponseSchema = Type.Object({
  id: Type.String(),
  url: Type.String(),
});
export type CharacterAssetResponse = Static<typeof CharacterAssetResponseSchema>;

export const CharacterGenerationTaskResponseSchema = GenerationTaskDescriptorSchema;
export type CharacterGenerationTaskResponse = Static<typeof CharacterGenerationTaskResponseSchema>;

export const CharacterDetailSchema = Type.Intersect([
  CharacterProfileSchema,
  Type.Object({
    versions: Type.Array(CharacterVersionSchema),
    sources: Type.Array(CharacterSourceSchema),
    relationships: Type.Array(CharacterRelationshipSchema),
    links: Type.Array(
      Type.Object({
        app_id: Type.String(),
        local_id: Type.String(),
        source_version: Type.Number(),
        local_modified: Type.Number(),
      })
    ),
  }),
]);
export type CharacterDetail = Static<typeof CharacterDetailSchema>;

export const CharacterCardProviderCapabilitiesSchema = Type.Object({
  search: Type.Boolean(),
  detail: Type.Boolean(),
  download: Type.Boolean(),
  importUrl: Type.Boolean(),
});
export type CharacterCardProviderCapabilities = Static<typeof CharacterCardProviderCapabilitiesSchema>;

export const CharacterCardProviderSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  capabilities: CharacterCardProviderCapabilitiesSchema,
  enabled: Type.Boolean(),
  status: Type.Union([
    Type.Literal('ready'),
    Type.Literal('unavailable'),
    Type.Literal('needs_configuration'),
  ]),
  message: Type.Optional(Type.String()),
});
export type CharacterCardProvider = Static<typeof CharacterCardProviderSchema>;

export const CharacterCardSearchResultSchema = Type.Object({
  providerId: Type.String(),
  externalId: Type.String(),
  name: Type.String(),
  author: Type.Union([Type.String(), Type.Null()]),
  summary: Type.String(),
  sourceUrl: Type.String(),
  thumbnail: Type.Union([Type.String(), Type.Null()]),
  tags: Type.Array(Type.String()),
  language: Type.Union([Type.String(), Type.Null()]),
  remoteUpdatedAt: Type.Union([Type.String(), Type.Null()]),
  formatHint: Type.Union([Type.String(), Type.Null()]),
});
export type CharacterCardSearchResult = Static<typeof CharacterCardSearchResultSchema>;

export const CharacterCardSearchResponseSchema = Type.Object({
  providerId: Type.String(),
  items: Type.Array(CharacterCardSearchResultSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
  total: Type.Union([Type.Number(), Type.Null()]),
});
export type CharacterCardSearchResponse = Static<typeof CharacterCardSearchResponseSchema>;

export const CharacterCardCompatibilitySchema = Type.Object({
  format: Type.String(),
  supported: Type.Boolean(),
  warnings: Type.Array(Type.String()),
  preservedFields: Type.Array(Type.String()),
  ignoredFields: Type.Array(Type.String()),
  worldBookEntries: Type.Number(),
  isSceneCard: Type.Boolean(),
});
export type CharacterCardCompatibility = Static<typeof CharacterCardCompatibilitySchema>;

export const CharacterFieldMappingSchema = Type.Object({
  fieldPath: Type.String(),
  sourcePointer: Type.String(),
  valueHash: Type.String(),
  status: Type.Union([
    Type.Literal('source_extract'),
    Type.Literal('card_author'),
    Type.Literal('user_edit'),
    Type.Literal('ai_inferred'),
    Type.Literal('image_observed'),
    Type.Literal('legacy_unknown'),
  ]),
  note: Type.Optional(Type.String()),
});
export type CharacterFieldMapping = Static<typeof CharacterFieldMappingSchema>;

export const CharacterImportCandidateSchema = Type.Object({
  tags: Type.Optional(Type.Array(Type.String())),
  organization: Type.Optional(CharacterOrganizationSchema),
  draft: CharacterDraftAnySchema,
  mappings: Type.Array(CharacterFieldMappingSchema),
  cover: Type.Object({
    available: Type.Boolean(),
    selectedForAvatar: Type.Boolean(),
    selectedForReference: Type.Boolean(),
  }),
  originalCard: Type.Record(Type.String(), Type.Unknown()),
});
export type CharacterImportCandidate = Static<typeof CharacterImportCandidateSchema>;

export const CharacterImportSessionStatusSchema = Type.Union([
  Type.Literal('fetching'), Type.Literal('parsing'), Type.Literal('ready'),
  Type.Literal('committing'), Type.Literal('committed'), Type.Literal('failed'),
  Type.Literal('cancelled'), Type.Literal('expired'),
]);
export type CharacterImportSessionStatus = Static<typeof CharacterImportSessionStatusSchema>;

export const CharacterImportSessionSchema = Type.Object({
  id: Type.String(),
  status: CharacterImportSessionStatusSchema,
  expiresAt: Type.String(),
  previewRevision: Type.Number(),
  previewHash: Type.String(),
  candidate: Type.Union([CharacterImportCandidateSchema, Type.Null()]),
  compatibility: Type.Union([CharacterCardCompatibilitySchema, Type.Null()]),
  source: Type.Record(Type.String(), Type.Unknown()),
  targetCharacterId: Type.Union([Type.String(), Type.Null()]),
  baseDraftRevision: Type.Union([Type.Number(), Type.Null()]),
  commitResult: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type CharacterImportSession = Static<typeof CharacterImportSessionSchema>;

export const CharacterVisualReferenceSchema = Type.Object({
  id: Type.String(),
  characterId: Type.String(),
  assetId: Type.String(),
  artifactId: Type.Union([Type.String(), Type.Null()]),
  sha256: Type.String(),
  width: Type.Union([Type.Number(), Type.Null()]),
  height: Type.Union([Type.Number(), Type.Null()]),
  purposes: Type.Array(Type.Union([
    Type.Literal('avatar'), Type.Literal('identity'), Type.Literal('outfit'),
    Type.Literal('pose'), Type.Literal('style'), Type.Literal('init_image'),
  ])),
  outfitId: Type.Union([Type.String(), Type.Null()]),
  sourcePage: Type.Union([Type.String(), Type.Null()]),
  originalUrl: Type.Union([Type.String(), Type.Null()]),
  authorNote: Type.String(),
  userNote: Type.String(),
  enabled: Type.Boolean(),
  crop: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  url: Type.String(),
  createdAt: Type.String(),
});
export type CharacterVisualReference = Static<typeof CharacterVisualReferenceSchema>;

export const CharacterAppearanceExtractionSchema = Type.Object({
  description: Type.String(),
  hair: Type.String(),
  eyes: Type.String(),
  build: Type.String(),
  accessories: Type.Array(Type.String()),
  observedOutfit: Type.String(),
  unknowns: Type.Array(Type.String()),
  conflicts: Type.Array(Type.String()),
  evidence: Type.Array(Type.String()),
});
export type CharacterAppearanceExtraction = Static<typeof CharacterAppearanceExtractionSchema>;

// ────────────────────────────────────────────────────────────────────────────
// 识图候选采用（服务端应用与前端差异预览共用同一份纯函数）
// ────────────────────────────────────────────────────────────────────────────

/** 候选可影响基础外貌的细项路径（与前端勾选项一致）。 */
export const APPEARANCE_CANDIDATE_BASE_PATHS = [
  '/appearance/description',
  '/appearance/hair',
  '/appearance/eyes',
  '/appearance/build',
  '/appearance/accessories',
] as const;

export const APPEARANCE_CANDIDATE_OUTFIT_PATH = '/appearance/outfits';

export type AppearanceCandidatePreview = {
  /** 采用后基础外貌的完整文本。 */
  readonly baseText: string;
  /** 采用后默认穿着的完整文本。 */
  readonly defaultOutfitText: string;
  readonly baseChanged: boolean;
  readonly outfitChanged: boolean;
};

/**
 * 按勾选的细项重建外貌与穿着（规划 4.3）。
 * 未勾选的细项保留原正文，未勾选「整体外貌」时把原基础外貌整段保留在首位，
 * 因此采用候选不会把用户自己写的形容整段替换掉。
 */
export function previewAppearanceCandidateApplication(
  current: { baseText?: string; defaultOutfitText?: string },
  extraction: Partial<CharacterAppearanceExtraction>,
  selectedFieldPaths: readonly string[],
): AppearanceCandidatePreview {
  const selected = new Set(selectedFieldPaths);
  const baseTextCurrent = String(current?.baseText ?? '');
  const outfitCurrent = String(current?.defaultOutfitText ?? '');
  const accessories = Array.isArray(extraction?.accessories) ? extraction.accessories.filter(Boolean) : [];

  const baseSelected = APPEARANCE_CANDIDATE_BASE_PATHS.filter((path) => selected.has(path));
  const parts: string[] = [];
  if (baseSelected.length) {
    if (!selected.has('/appearance/description') && baseTextCurrent.trim()) parts.push(baseTextCurrent.trim());
    if (selected.has('/appearance/description') && extraction.description) parts.push(extraction.description);
    if (selected.has('/appearance/hair') && extraction.hair) parts.push(`发型与发色：${extraction.hair}`);
    if (selected.has('/appearance/eyes') && extraction.eyes) parts.push(`眼睛：${extraction.eyes}`);
    if (selected.has('/appearance/build') && extraction.build) parts.push(`体态：${extraction.build}`);
    if (selected.has('/appearance/accessories') && accessories.length) parts.push(`配饰：${accessories.join('；')}`);
  }

  const baseText = baseSelected.length ? parts.join('\n') : baseTextCurrent;
  const outfitCandidate = selected.has(APPEARANCE_CANDIDATE_OUTFIT_PATH) ? String(extraction.observedOutfit ?? '').trim() : '';
  const defaultOutfitText = outfitCandidate || outfitCurrent;

  return {
    baseText,
    defaultOutfitText,
    baseChanged: baseText !== baseTextCurrent,
    outfitChanged: defaultOutfitText !== outfitCurrent,
  };
}


/**
 * 试演建议允许指向的 V2 草稿字段。
 *
 * 提示词与编辑器采用入口共用这一份清单：模型看不到不存在的路径，用户也不会拿到
 * 在编辑器里无处可用的建议（规划 6.3）。
 */
export const CHARACTER_AUDITION_FIELD_PATHS = [
  '/personaText',
  '/speechText',
  '/behaviorRules',
  '/dialogueExamples',
  '/summary',
  '/appearance/baseText',
  '/appearance/defaultOutfitText',
] as const;

export type CharacterAuditionFieldPath = (typeof CHARACTER_AUDITION_FIELD_PATHS)[number];

/** 判断试演建议的字段路径是否可落到 V2 草稿上。 */
export function isCharacterAuditionFieldPath(value: unknown): value is CharacterAuditionFieldPath {
  return typeof value === 'string' && (CHARACTER_AUDITION_FIELD_PATHS as readonly string[]).includes(value);
}

export const CharacterAuditionResponseSchema = Type.Object({
  scenario: Type.String(),
  output: Type.String(),
  feedback: Type.Optional(Type.String()),
  suggestions: Type.Array(Type.Object({
    fieldPath: Type.String(),
    before: Type.String(),
    after: Type.String(),
    reason: Type.String(),
  })),
  draftRevision: Type.Number(),
  compilerVersion: Type.String(),
  profileId: Type.Union([Type.String(), Type.Null()]),
});
export type CharacterAuditionResponse = Static<typeof CharacterAuditionResponseSchema>;

export const PublicServiceOverviewSchema = Type.Object({
  keyring: Type.Object({
    available: Type.Boolean(),
    backend: Type.Union([Type.String(), Type.Null()]),
    envFallback: Type.Boolean(),
  }),
  apps: Type.Array(ManagedAppSchema),
  profiles: Type.Array(ProviderProfileSchema),
  llmAssignments: Type.Array(AppLlmAssignmentSchema),
  personas: Type.Array(PersonaTemplateSchema),
});
export type PublicServiceOverview = Static<typeof PublicServiceOverviewSchema>;

export const LogLevelSchema = Type.Union([
  Type.Literal('off'),
  Type.Literal('error'),
  Type.Literal('warn'),
  Type.Literal('info'),
  Type.Literal('debug'),
  Type.Literal('trace'),
]);
export type LogLevel = Static<typeof LogLevelSchema>;

export const RuntimeServiceStateSchema = Type.Union([
  Type.Literal('stopped'),
  Type.Literal('starting'),
  Type.Literal('running'),
  Type.Literal('stopping'),
  Type.Literal('degraded'),
  Type.Literal('external'),
  Type.Literal('error'),
]);
export type RuntimeServiceState = Static<typeof RuntimeServiceStateSchema>;

export const RuntimeServiceSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  port: Type.Number(),
  optional: Type.Boolean(),
  installed: Type.Boolean(),
  state: RuntimeServiceStateSchema,
  pid: Type.Union([Type.Number(), Type.Null()]),
  startedAt: Type.Union([Type.String(), Type.Null()]),
  message: Type.Union([Type.String(), Type.Null()]),
  managed: Type.Boolean(),
});
export type RuntimeService = Static<typeof RuntimeServiceSchema>;

export const RuntimeSettingsSchema = Type.Object({
  autoStart: Type.Boolean(),
  autoOpenBrowser: Type.Boolean(),
  useMirror: Type.Boolean(),
  publicLlmEnabled: Type.Boolean(),
  comfyuiExecutable: Type.String(),
  extraLoraFolders: Type.Array(Type.String()),
  maibotAutostart: Type.Boolean(),
  maibotBrowserMaibot: Type.Boolean(),
  maibotBrowserSnowluma: Type.Boolean(),
  creative: Type.Record(Type.String(), Type.Unknown()),
});
export type RuntimeSettings = Static<typeof RuntimeSettingsSchema>;

export const RuntimeLlmStatusSchema = Type.Object({
  enabled: Type.Boolean(),
  textProfileId: Type.Union([Type.String(), Type.Null()]),
  textModel: Type.Union([Type.String(), Type.Null()]),
  multimodalProfileId: Type.Union([Type.String(), Type.Null()]),
  multimodalModel: Type.Union([Type.String(), Type.Null()]),
  ready: Type.Boolean(),
});
export type RuntimeLlmStatus = Static<typeof RuntimeLlmStatusSchema>;

export const LogPolicySchema = Type.Object({
  globalLevel: LogLevelSchema,
  serviceLevels: Type.Record(Type.String(), Type.Union([LogLevelSchema, Type.Null()])),
  retentionDays: Type.Number(),
  maxBytes: Type.Number(),
  sensitiveUntil: Type.Union([Type.String(), Type.Null()]),
  diagnosticUntil: Type.Union([Type.String(), Type.Null()]),
});
export type LogPolicy = Static<typeof LogPolicySchema>;

export const LogEventSchema = Type.Object({
  id: Type.Number(),
  timestamp: Type.String(),
  appId: Type.String(),
  serviceId: Type.String(),
  level: Type.Union([
    Type.Literal('error'),
    Type.Literal('warn'),
    Type.Literal('info'),
    Type.Literal('debug'),
    Type.Literal('trace'),
  ]),
  message: Type.String(),
  stream: Type.Union([
    Type.Literal('stdout'),
    Type.Literal('stderr'),
    Type.Literal('system'),
    Type.Literal('app'),
  ]),
  sensitive: Type.Boolean(),
});
export type LogEvent = Static<typeof LogEventSchema>;

export const LogListResponseSchema = Type.Object({
  items: Type.Array(LogEventSchema),
});
export type LogListResponse = Static<typeof LogListResponseSchema>;

export const RuntimeOverviewSchema = Type.Object({
  services: Type.Array(RuntimeServiceSchema),
  settings: RuntimeSettingsSchema,
  linsheLlm: RuntimeLlmStatusSchema,
  logPolicy: LogPolicySchema,
  recentErrors: Type.Number(),
  droppedLogs: Type.Number(),
});
export type RuntimeOverview = Static<typeof RuntimeOverviewSchema>;

// Creative Note Contracts
export const NoteKindSchema = Type.Union([
  Type.Literal('diary'),
  Type.Literal('idea'),
  Type.Literal('note'),
  Type.Literal('story'),
  Type.Literal('character'),
  Type.Literal('world'),
]);
export type NoteKind = Static<typeof NoteKindSchema>;

export const NoteStageSchema = Type.Union([
  Type.Literal('draft'),
  Type.Literal('reference'),
  Type.Literal('story-candidate'),
]);
export type NoteStage = Static<typeof NoteStageSchema>;

export const NoteBlockSchema = Type.Union([
  Type.Object({ id: Type.String(), type: Type.Literal('text'), text: Type.String() }),
  Type.Object({ id: Type.String(), type: Type.Literal('image'), src: Type.String(), caption: Type.String() }),
  Type.Object({ id: Type.String(), type: Type.Literal('link'), url: Type.String(), label: Type.String(), note: Type.String() }),
  Type.Object({ id: Type.String(), type: Type.Literal('character-reference'), characterId: Type.String(), note: Type.String() }),
  Type.Object({
    id: Type.String(),
    type: Type.Literal('archive-reference'),
    workId: Type.String(),
    targetType: Type.Literal('utterance'),
    targetId: Type.String(),
    quote: Type.String(),
    locator: Type.String(),
  }),
]);
export type NoteBlock = Static<typeof NoteBlockSchema>;

export const CreativeNoteSchema = Type.Object({
  id: Type.Optional(Type.String()),
  title: Type.String(),
  kind: NoteKindSchema,
  summary: Type.String(),
  content: Type.Array(NoteBlockSchema),
  tags: Type.Array(Type.String()),
  stage: NoteStageSchema,
  favorite: Type.Boolean(),
  revision: Type.Optional(Type.Integer({ minimum: 1 })),
  createdAt: Type.Optional(Type.String()),
  updatedAt: Type.Optional(Type.String()),
});
export type CreativeNote = Static<typeof CreativeNoteSchema>;

export const CreativeNotesResponseSchema = Type.Object({
  items: Type.Array(CreativeNoteSchema),
});
export type CreativeNotesResponse = Static<typeof CreativeNotesResponseSchema>;

export const NoteDeleteResponseSchema = Type.Object({
  ok: Type.Boolean(),
});
export type NoteDeleteResponse = Static<typeof NoteDeleteResponseSchema>;

export const NoteAssetResponseSchema = Type.Object({
  id: Type.String(),
  url: Type.String(),
});
export type NoteAssetResponse = Static<typeof NoteAssetResponseSchema>;

// Narrative Contracts
export const NarrativeWorkSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  description: Type.String(),
  locale: Type.String(),
  sourceName: Type.String(),
  nodeCount: Type.Number(),
});
export type NarrativeWork = Static<typeof NarrativeWorkSchema>;

export const NarrativeStoryNodeSchema = Type.Object({
  id: Type.String(),
  parentId: Type.Union([Type.String(), Type.Null()]),
  kind: Type.String(),
  title: Type.String(),
  sortOrder: Type.Number(),
  summary: Type.String(),
});
export type NarrativeStoryNode = Static<typeof NarrativeStoryNodeSchema>;

export const NarrativeUtteranceSchema = Type.Object({
  id: Type.String(),
  kind: Type.String(),
  speaker: Type.Union([Type.String(), Type.Null()]),
  text: Type.String(),
  condition: Type.Union([Type.String(), Type.Null()]),
});
export type NarrativeUtterance = Static<typeof NarrativeUtteranceSchema>;

export const NarrativeSceneSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  summary: Type.String(),
  sortOrder: Type.Number(),
  utterances: Type.Array(NarrativeUtteranceSchema),
});
export type NarrativeScene = Static<typeof NarrativeSceneSchema>;

export const NarrativeConceptArtifactSchema = Type.Object({
  artifactId: Type.String(),
  url: Type.String(),
  contentType: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
});
export type NarrativeConceptArtifact = Static<typeof NarrativeConceptArtifactSchema>;

export const NarrativeReadingSchema = Type.Object({
  node: Type.Object({
    id: Type.String(),
    workId: Type.String(),
    title: Type.String(),
    summary: Type.String(),
    conceptArtifacts: Type.Array(NarrativeConceptArtifactSchema),
  }),
  scenes: Type.Array(NarrativeSceneSchema),
});
export type NarrativeReading = Static<typeof NarrativeReadingSchema>;

export const NarrativeConnectorSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  kind: Type.String(),
  status: Type.String(),
  message: Type.String(),
  capabilities: Type.Array(Type.String()),
});
export type NarrativeConnector = Static<typeof NarrativeConnectorSchema>;

export const NarrativeSearchResultSchema = Type.Object({
  workId: Type.String(),
  kind: Type.String(),
  refId: Type.String(),
  nodeId: Type.Union([Type.String(), Type.Null()]),
  title: Type.String(),
  excerpt: Type.String(),
});
export type NarrativeSearchResult = Static<typeof NarrativeSearchResultSchema>;

export const NarrativeRemoteResultSchema = Type.Object({
  fileName: Type.String(),
  pathHash: Type.String(),
  totalLines: Type.Number(),
  hits: Type.Array(Type.Object({ line: Type.Number(), snippet: Type.String() })),
  tags: Type.Record(Type.String(), Type.String()),
  sourceTier: Type.Union([Type.Literal('primary'), Type.Literal('secondary')]),
});
export type NarrativeRemoteResult = Static<typeof NarrativeRemoteResultSchema>;

export const NarrativeRemoteDocumentSchema = Type.Object({
  fileName: Type.String(),
  pathHash: Type.String(),
  totalLines: Type.Number(),
  content: Type.String(),
  lineRange: Type.String(),
  remainingCharacters: Type.Number(),
});
export type NarrativeRemoteDocument = Static<typeof NarrativeRemoteDocumentSchema>;

export const NarrativeWorksResponseSchema = Type.Object({
  items: Type.Array(NarrativeWorkSchema),
});
export type NarrativeWorksResponse = Static<typeof NarrativeWorksResponseSchema>;

export const NarrativeTreeResponseSchema = Type.Object({
  items: Type.Array(NarrativeStoryNodeSchema),
});
export type NarrativeTreeResponse = Static<typeof NarrativeTreeResponseSchema>;

export const NarrativeSearchResponseSchema = Type.Object({
  items: Type.Array(NarrativeSearchResultSchema),
});
export type NarrativeSearchResponse = Static<typeof NarrativeSearchResponseSchema>;

export const NarrativeConnectorsResponseSchema = Type.Object({
  items: Type.Array(NarrativeConnectorSchema),
});
export type NarrativeConnectorsResponse = Static<typeof NarrativeConnectorsResponseSchema>;

export const NarrativeImportPreviewSchema = Type.Object({
  id: Type.String(),
  report: Type.Object({
    incoming: Type.Record(Type.String(), Type.Number()),
    existing: Type.Record(Type.String(), Type.Number()),
    workExists: Type.Boolean(),
    note: Type.String(),
  }),
});
export type NarrativeImportPreview = Static<typeof NarrativeImportPreviewSchema>;

export const NarrativeImportCommitSchema = Type.Object({
  workId: Type.String(),
});
export type NarrativeImportCommit = Static<typeof NarrativeImportCommitSchema>;

export const NarrativeHrefResponseSchema = Type.Object({
  href: Type.String(),
});
export type NarrativeHrefResponse = Static<typeof NarrativeHrefResponseSchema>;

export const ModelDiscoveryResponseSchema = Type.Object({
  models: Type.Array(Type.String()),
});
export type ModelDiscoveryResponse = Static<typeof ModelDiscoveryResponseSchema>;

// Activity Studio Contracts
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
  sourceVersionStatus: Type.Optional(Type.Union([
    Type.Literal('published'), Type.Literal('draft'), Type.Literal('unknown'), Type.Literal('missing'),
  ])),
  characterDraftRevision: Type.Optional(Type.Number()),
  displayName: Type.String(),
  persona: ActorPersonaSchema,
  avatarAssetKey: Type.Optional(Type.String()),
  avatarAssetId: Type.Optional(Type.String()),
  avatarUrl: Type.Optional(Type.String()),
  activityRole: Type.String(),
  outfitDescription: Type.String(),
  appearanceReferenceAssetKeys: Type.Array(Type.String()),
  appearanceReferenceAssetIds: Type.Optional(Type.Array(Type.String())),
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
    // 可选排期与模板信息：旧文档缺失时视为未排期、无模板。
    scheduledDate: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    templateId: Type.Optional(Type.String()),
    birthdayActorIds: Type.Optional(Type.Array(Type.String())),
    overview: Type.Optional(Type.String()),
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
  scheduledDate: Type.Optional(Type.Union([Type.String(), Type.Null()])),
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
  replayable: Type.Optional(Type.Boolean()),
  errorMessage: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  modelMetadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type ActivityJob = Static<typeof ActivityJobSchema>;

export const SourceOwnerKindSchema = Type.Union([
  Type.Literal('content'),
  Type.Literal('image_config'),
  Type.Literal('recipe'),
  Type.Literal('character'),
]);
export type SourceOwnerKind = Static<typeof SourceOwnerKindSchema>;

export const SourceEntityKindSchema = Type.Union([
  Type.Literal('actor'),
  Type.Literal('stage'),
  Type.Literal('fact'),
  Type.Literal('activity'),
  Type.Literal('shot'),
  Type.Literal('style'),
  Type.Literal('override'),
  Type.Literal('character'),
  Type.Literal('character_version'),
  Type.Literal('reference'),
]);
export type SourceEntityKind = Static<typeof SourceEntityKindSchema>;

export const SourceRefSchema = Type.Object({
  id: Type.String(),
  activityId: Type.String(),
  ownerKind: SourceOwnerKindSchema,
  ownerRevisionId: Type.String(),
  entityKind: SourceEntityKindSchema,
  entityId: Type.String(),
  fieldPath: Type.String(),
  valueSnapshot: Type.Unknown(),
  valueHash: Type.String(),
  labelSnapshot: Type.String(),
});
export type SourceRef = Static<typeof SourceRefSchema>;

export const PromptBlockKindSchema = Type.Union([
  Type.Literal('identity'),
  Type.Literal('appearance'),
  Type.Literal('outfit'),
  Type.Literal('scene'),
  Type.Literal('action'),
  Type.Literal('composition'),
  Type.Literal('style'),
  Type.Literal('negative'),
  Type.Literal('supplement'),
]);
export type PromptBlockKind = Static<typeof PromptBlockKindSchema>;

export const PromptBlockOriginSchema = Type.Union([
  Type.Literal('source'),
  Type.Literal('manual'),
  Type.Literal('ai_derived'),
]);
export type PromptBlockOrigin = Static<typeof PromptBlockOriginSchema>;

export const PromptBlockMappingPrecisionSchema = Type.Union([
  Type.Literal('exact_block'),
  Type.Literal('derived_block'),
  Type.Literal('whole_prompt'),
]);
export type PromptBlockMappingPrecision = Static<typeof PromptBlockMappingPrecisionSchema>;

export const PromptBlockSchema = Type.Object({
  id: Type.String(),
  kind: PromptBlockKindSchema,
  actorIds: Type.Array(Type.String()),
  sourceRefIds: Type.Array(Type.String()),
  originalText: Type.String(),
  renderedText: Type.String(),
  origin: PromptBlockOriginSchema,
  locked: Type.Boolean(),
  mappingPrecision: PromptBlockMappingPrecisionSchema,
});
export type PromptBlock = Static<typeof PromptBlockSchema>;

export const ReferenceInputRoleSchema = Type.Union([
  Type.Literal('init_image'),
  Type.Literal('identity'),
  Type.Literal('outfit'),
  Type.Literal('composition'),
  Type.Literal('pose'),
  Type.Literal('style'),
  Type.Literal('mask'),
]);
export type ReferenceInputRole = Static<typeof ReferenceInputRoleSchema>;

export const ImageTransformParamsSchema = Type.Object({
  crop: Type.Optional(Type.Object({
    x: Type.Number(),
    y: Type.Number(),
    width: Type.Number(),
    height: Type.Number(),
  })),
  rotation: Type.Optional(Type.Number()),
  targetWidth: Type.Optional(Type.Number()),
  targetHeight: Type.Optional(Type.Number()),
  interpolation: Type.Optional(Type.String()),
});
export type ImageTransformParams = Static<typeof ImageTransformParamsSchema>;

export const ReferenceInputSchema = Type.Object({
  referenceId: Type.String(),
  assetKey: Type.String(),
  artifactId: Type.String(),
  sha256: Type.String(),
  actorId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  role: ReferenceInputRoleSchema,
  inputKey: Type.String(),
  parentAttemptId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  transform: Type.Optional(ImageTransformParamsSchema),
});
export type ReferenceInput = Static<typeof ReferenceInputSchema>;

export const SlotImageConfigSchema = Type.Object({
  slotId: Type.String(),
  shotType: Type.Optional(Type.String()),
  composition: Type.Optional(Type.String()),
  viewpoint: Type.Optional(Type.String()),
  lighting: Type.Optional(Type.String()),
  aspectRatio: Type.Optional(Type.String()),
  supplementPrompt: Type.Optional(Type.String()),
  negativePrompt: Type.Optional(Type.String()),
  referenceAssetKeys: Type.Optional(Type.Array(Type.String())),
  workflowId: Type.Optional(Type.String()),
  workflowVersion: Type.Optional(Type.Number()),
  params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type SlotImageConfig = Static<typeof SlotImageConfigSchema>;

export const ImageConfigDocumentSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  stylePreset: Type.String(),
  globalStylePrompt: Type.String(),
  globalNegativePrompt: Type.String(),
  defaultWorkflowId: Type.Optional(Type.String()),
  defaultWorkflowVersion: Type.Optional(Type.Number()),
  defaultParams: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  slotConfigs: Type.Array(SlotImageConfigSchema),
});
export type ImageConfigDocument = Static<typeof ImageConfigDocumentSchema>;

export const ImageConfigDraftSchema = Type.Object({
  activityId: Type.String(),
  draftVersion: Type.Number(),
  document: ImageConfigDocumentSchema,
  baseRevisionId: Type.Union([Type.String(), Type.Null()]),
  updatedAt: Type.String(),
});
export type ImageConfigDraft = Static<typeof ImageConfigDraftSchema>;

export const ImageConfigRevisionSchema = Type.Object({
  id: Type.String(),
  activityId: Type.String(),
  parentId: Type.Union([Type.String(), Type.Null()]),
  document: ImageConfigDocumentSchema,
  hash: Type.String(),
  createdAt: Type.String(),
});
export type ImageConfigRevision = Static<typeof ImageConfigRevisionSchema>;

export const PromptRecipeOverrideSchema = Type.Object({
  id: Type.String(),
  fieldPath: Type.String(),
  overrideText: Type.String(),
  reason: Type.Optional(Type.String()),
});
export type PromptRecipeOverride = Static<typeof PromptRecipeOverrideSchema>;

export const PromptRecipeSchema = Type.Object({
  id: Type.String(),
  activityId: Type.String(),
  contentRevisionId: Type.String(),
  imageConfigRevisionId: Type.String(),
  slotId: Type.String(),
  slotFingerprint: Type.String(),
  sourceRefs: Type.Array(SourceRefSchema),
  blocks: Type.Array(PromptBlockSchema),
  references: Type.Array(ReferenceInputSchema),
  overrides: Type.Array(PromptRecipeOverrideSchema),
  recipeHash: Type.String(),
  schemaVersion: Type.Literal(1),
  createdAt: Type.String(),
});
export type PromptRecipe = Static<typeof PromptRecipeSchema>;

export const ImageExecutionPlanSchema = Type.Object({
  purpose: Type.String(),
  workflowId: Type.String(),
  workflowVersion: Type.Number(),
  engineId: Type.String(),
  definitionHash: Type.String(),
  nodeBindings: Type.Record(Type.String(), Type.Array(Type.String())),
  inputCapabilities: Type.Optional(WorkflowInputCapabilitiesSchema),
});
export type ImageExecutionPlan = Static<typeof ImageExecutionPlanSchema>;

export const PromptCompilationSchema = Type.Object({
  executionPlan: Type.Optional(Type.Union([ImageExecutionPlanSchema, Type.Null()])),
  id: Type.String(),
  recipeId: Type.String(),
  compilerVersion: Type.String(),
  templateId: Type.String(),
  templateVersion: Type.String(),
  channels: Type.Record(Type.String(), Type.String()),
  effectiveParams: Type.Record(Type.String(), Type.Unknown()),
  executionPlanHash: Type.String(),
  createdAt: Type.String(),
});
export type PromptCompilation = Static<typeof PromptCompilationSchema>;

export const GenerationAttemptStatusSchema = Type.Union([
  Type.Literal('preparing'),
  Type.Literal('submitting'),
  Type.Literal('queued'),
  Type.Literal('running'),
  Type.Literal('succeeded'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('result_unknown'),
]);
export type GenerationAttemptStatus = Static<typeof GenerationAttemptStatusSchema>;

export const AttemptOutputSchema = Type.Object({
  outputName: Type.String(),
  sortOrder: Type.Number(),
  artifactId: Type.String(),
  assetKey: Type.String(),
  mediaType: Type.String(),
  byteSize: Type.Number(),
  sha256: Type.String(),
  width: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  height: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
});
export type AttemptOutput = Static<typeof AttemptOutputSchema>;

export const GenerationAttemptSchema = Type.Object({
  id: Type.String(),
  activityId: Type.String(),
  baseContentRevisionId: Type.String(),
  imageConfigRevisionId: Type.String(),
  slotId: Type.String(),
  slotFingerprint: Type.String(),
  recipeId: Type.String(),
  compilationId: Type.String(),
  recipeHash: Type.String(),
  executionPlanHash: Type.String(),
  taskId: Type.String(),
  status: GenerationAttemptStatusSchema,
  actualSeed: Type.Number(),
  retryOfAttemptId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  parentAttemptIds: Type.Array(Type.String()),
  idempotencyKey: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  businessRequestHash: Type.String(),
  outputs: Type.Array(AttemptOutputSchema),
  errorCode: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  errorMessage: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type GenerationAttempt = Static<typeof GenerationAttemptSchema>;

export const ExecutionSnapshotSchema = Type.Object({
  attemptId: Type.String(),
  phase: Type.Union([Type.Literal('prepared'), Type.Literal('uploaded'), Type.Literal('dispatched'), Type.Literal('completed')]),
  actualInputs: Type.Record(Type.String(), Type.Unknown()),
  uploadedFileMappings: Type.Record(Type.String(), Type.String()),
  requestSummary: Type.Record(Type.String(), Type.Unknown()),
  createdAt: Type.String(),
});
export type ExecutionSnapshot = Static<typeof ExecutionSnapshotSchema>;

export const AssetLineageEdgeSchema = Type.Object({
  id: Type.String(),
  activityId: Type.String(),
  childAssetKey: Type.String(),
  parentAssetKey: Type.String(),
  attemptId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  role: Type.String(),
  transformParams: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  createdAt: Type.String(),
});
export type AssetLineageEdge = Static<typeof AssetLineageEdgeSchema>;

export const SourceDependencySchema = Type.Object({
  activityId: Type.String(),
  slotId: Type.String(),
  recipeId: Type.String(),
  entityKind: SourceEntityKindSchema,
  entityId: Type.String(),
  fieldPath: Type.String(),
  valueHash: Type.String(),
  updatedAt: Type.String(),
});
export type SourceDependency = Static<typeof SourceDependencySchema>;

export const AffectedSlotPreviewSchema = Type.Object({
  slotId: Type.String(),
  reason: Type.String(),
  fieldPath: Type.String(),
  oldValueHash: Type.String(),
  newValueHash: Type.String(),
  currentAssetKey: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  needsReview: Type.Boolean(),
  hasActiveAttempt: Type.Boolean(),
});
export type AffectedSlotPreview = Static<typeof AffectedSlotPreviewSchema>;

export const ImpactPreviewSchema = Type.Object({
  activityId: Type.String(),
  changedEntityKind: SourceEntityKindSchema,
  changedEntityId: Type.String(),
  fieldPath: Type.String(),
  oldValue: Type.Unknown(),
  newValue: Type.Unknown(),
  affectedSlots: Type.Array(AffectedSlotPreviewSchema),
});
export type ImpactPreview = Static<typeof ImpactPreviewSchema>;

export const ImageCapabilityDescriptorSchema = Type.Object({
  purpose: Type.String(),
  configured: Type.Boolean(),
  workflowValid: Type.Boolean(),
  readiness: Type.Union([
    Type.Literal('ready'),
    Type.Literal('unreachable'),
    Type.Literal('incompatible'),
    Type.Literal('unknown'),
  ]),
  reasonCode: Type.Optional(Type.String()),
  workflowId: Type.Optional(Type.String()),
  workflowVersion: Type.Optional(Type.Number()),
  engineId: Type.Optional(Type.String()),
  engineKind: Type.Optional(Type.String()),
  supportedInputs: Type.Array(Type.String()),
  supportedParameters: Type.Array(Type.String()),
  maxInputArtifacts: Type.Number(),
});
export type ImageCapabilityDescriptor = Static<typeof ImageCapabilityDescriptorSchema>;

export const ActivityCapabilitiesResponseSchema = Type.Object({
  llm: Type.Boolean(),
  llmProfile: Type.Union([
    Type.Object({ id: Type.String(), name: Type.String() }),
    Type.Null(),
  ]),
  llmStatus: Type.Optional(LlmBindingStatusSchema),
  media: Type.Boolean(),
  images: Type.Object({
    textToImage: ImageCapabilityDescriptorSchema,
    imageToImage: ImageCapabilityDescriptorSchema,
  }),
  templates: Type.Array(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      version: Type.String(),
    })
  ),
  limits: Type.Object({
    maxActors: Type.Number(),
    maxStages: Type.Number(),
    maxRecords: Type.Number(),
    maxDocumentBytes: Type.Number(),
  }),
});
export type ActivityCapabilitiesResponse = Static<typeof ActivityCapabilitiesResponseSchema>;

// ---------------------------------------------------------------------------
// 活动模板：门户与服务端共用同一份纯数据，避免把默认内容复制到多个页面。
// ---------------------------------------------------------------------------

export interface ActivityTemplateStageDraft {
  title: string;
  instruction: string;
  requiredBeats: string[];
  endCondition: string;
}

export interface ActivityTemplateDefinition {
  id: string;
  name: string;
  description: string;
  type: string;
  theme: string;
  location: string;
  rules: string;
  stages: ActivityTemplateStageDraft[];
}

export const ACTIVITY_TEMPLATES: ActivityTemplateDefinition[] = [
  {
    id: 'birthday',
    name: '生日',
    description: '为一位或多位寿星准备的生日聚会，包含准备、互动、祝福与合照环节。',
    type: '生日聚会',
    theme: '为寿星准备一场温馨的生日聚会，朋友们分工布置场地、准备惊喜与祝福。',
    location: '聚会场地',
    rules: '寿星直到庆祝环节前不应得知全部惊喜安排；每位寿星都需要单独的祝福时刻。',
    stages: [
      { title: '第一阶段：准备邀请', instruction: '发送邀请、确认到场时间，并分工准备场地布置、蛋糕与礼物，尽量瞒住寿星。', requiredBeats: ['确定到场名单与分工', '隐藏惊喜安排'], endCondition: '准备就绪，寿星即将到场' },
      { title: '第二阶段：到场互动', instruction: '寿星与宾客陆续到场，寒暄、玩闹并推进聚会气氛，逐步引出庆祝环节。', requiredBeats: ['全体到场并开始自由交流'], endCondition: '气氛热络，准备进入庆祝' },
      { title: '第三阶段：庆祝祝福', instruction: '端出生日蛋糕，关灯点蜡烛，每位寿星依次接受朋友们的祝福与告白。', requiredBeats: ['端出蛋糕并唱生日歌', '每位寿星都有单独祝福时刻'], endCondition: '寿星许愿并吹熄蜡烛' },
      { title: '第四阶段：合照回顾', instruction: '全体合影留念，发布朋友圈动态并相约下次再聚，聚会温馨收尾。', requiredBeats: ['完成集体合照', '发布一条动态'], endCondition: '聚会圆满结束' },
    ],
  },
  {
    id: 'gathering',
    name: '日常聚会',
    description: '轻松的朋友聚会，以交流、共同活动和告别回顾为主。',
    type: '生活与聚会',
    theme: '朋友们在闲暇时聚在一起，聊近况、做点小事，度过平静而愉快的一天。',
    location: '常去的聚会地点',
    rules: '以日常对话和轻松互动为主，不设置强冲突。',
    stages: [
      { title: '第一阶段：邀约准备', instruction: '发出邀约、确认时间地点，各自准备要带的东西与想聊的话题。', requiredBeats: ['确认聚会时间与地点'], endCondition: '大家陆续出发' },
      { title: '第二阶段：到场交流', instruction: '众人到场，寒暄近况，边做事边聊天，自然展开互动。', requiredBeats: ['成员全部到场'], endCondition: '进入共同活动' },
      { title: '第三阶段：共同活动', instruction: '一起完成计划中的活动，过程中出现小插曲并互相配合解决。', requiredBeats: ['共同完成一项活动'], endCondition: '活动告一段落' },
      { title: '第四阶段：告别回顾', instruction: '收拾场地，互相道别并约定下次见面。', requiredBeats: ['互道再见'], endCondition: '聚会结束' },
    ],
  },
  {
    id: 'festival',
    name: '节日庆祝',
    description: '围绕节日的庆祝活动，包含节日准备、主题体验与留念。',
    type: '节日庆祝',
    theme: '大家一起庆祝节日，准备节日用品、体验节日习俗并留下纪念。',
    location: '节日会场',
    rules: '体现节日氛围与习俗，让每位角色都有参与感。',
    stages: [
      { title: '第一阶段：节日准备', instruction: '采买与布置节日用品，讨论今年的庆祝方式。', requiredBeats: ['完成节日布置'], endCondition: '准备完成' },
      { title: '第二阶段：主题体验', instruction: '体验节日习俗与活动，出现有趣的小意外。', requiredBeats: ['完成至少一项节日习俗'], endCondition: '主题活动结束' },
      { title: '第三阶段：互动庆祝', instruction: '大家一起庆祝，互赠礼物与祝福，气氛达到高潮。', requiredBeats: ['互赠节日祝福'], endCondition: '庆祝环节结束' },
      { title: '第四阶段：合影留念', instruction: '合影、记录并约定明年再一起过节。', requiredBeats: ['完成纪念合影'], endCondition: '节日活动结束' },
    ],
  },
  {
    id: 'trip',
    name: '出游',
    description: '一次短途出游，包含准备、集合出发、游览与返程回顾。',
    type: '旅行出游',
    theme: '朋友们结伴出游，沿途看风景、拍照并分享感受。',
    location: '出发地与目的地',
    rules: '注意行程节奏，体现不同角色面对陌生环境的反应。',
    stages: [
      { title: '第一阶段：行前准备', instruction: '确定行程、收拾行李并检查装备，讨论路上的安排。', requiredBeats: ['确认行程与装备'], endCondition: '准备完毕' },
      { title: '第二阶段：集合出发', instruction: '在集合点碰面，出发途中聊天、看风景。', requiredBeats: ['全员集合出发'], endCondition: '抵达目的地' },
      { title: '第三阶段：游览互动', instruction: '游览景点、拍照、尝试当地事物，过程中互相配合。', requiredBeats: ['完成主要游览项目'], endCondition: '游览结束' },
      { title: '第四阶段：返程回顾', instruction: '返程路上回顾今天的经历，分享照片并约定下次出行。', requiredBeats: ['回顾并分享照片'], endCondition: '顺利返程' },
    ],
  },
  {
    id: 'blank',
    name: '空白',
    description: '从两个空白阶段开始，自行填写全部内容。',
    type: '生活与聚会',
    theme: '',
    location: '',
    rules: '',
    stages: [
      { title: '第一阶段', instruction: '', requiredBeats: [], endCondition: '' },
      { title: '第二阶段', instruction: '', requiredBeats: [], endCondition: '' },
    ],
  },
];

export function findActivityTemplate(id: string | undefined): ActivityTemplateDefinition | null {
  return ACTIVITY_TEMPLATES.find((template) => template.id === id) || null;
}

export interface BuildActivityDocumentInput {
  templateId?: string;
  title: string;
  type?: string;
  theme?: string;
  location?: string;
  rules?: string;
  actors: ActorSnapshot[];
  birthdayActorIds?: string[];
  scheduledDate?: string | null;
  overview?: string;
}

/**
 * 由模板与参与者构建完整活动文档。日期与寿星名单属于用户设定，模型不能改写。
 */
export function buildActivityDocument(input: BuildActivityDocumentInput): ContentDocument {
  const template = findActivityTemplate(input.templateId) || findActivityTemplate('blank')!;
  const actorIds = input.actors.map((actor) => actor.id);
  const birthdayActorIds = (input.birthdayActorIds || []).filter((id) => actorIds.includes(id));
  const birthdayNames = input.actors.filter((actor) => birthdayActorIds.includes(actor.id)).map((actor) => actor.displayName);
  const stages = template.stages.map((stage, index) => {
    const beats = [...stage.requiredBeats];
    let instruction = stage.instruction;
    if (template.id === 'birthday' && birthdayNames.length > 1 && index === 2) {
      instruction = `端出生日蛋糕，关灯点蜡烛，为每位寿星（${birthdayNames.join('、')}）依次安排单独的祝福时刻。`;
      beats.splice(0, beats.length, '端出蛋糕并唱生日歌', ...birthdayNames.map((name) => `为${name}送上祝福`));
    }
    return {
      id: `stage_${index + 1}`,
      title: stage.title,
      order: index + 1,
      actorIds,
      location: input.location || template.location,
      instruction,
      requiredBeats: beats.map((text, beatIndex) => ({ id: `beat_${index + 1}_${beatIndex + 1}`, text, actorIds })),
      locked: false,
      endCondition: stage.endCondition,
    };
  });
  return {
    schemaVersion: 1,
    activity: {
      title: input.title,
      type: input.type || template.type,
      theme: input.theme ?? template.theme,
      location: input.location ?? template.location,
      rules: input.rules ?? template.rules,
      generationMode: 'fill_details',
      scheduledDate: input.scheduledDate ?? null,
      templateId: template.id,
      birthdayActorIds,
      ...(input.overview ? { overview: input.overview } : {}),
    },
    actors: input.actors,
    relationships: [],
    stages,
    conversations: [{ id: 'group_main', kind: 'group', title: input.title, memberActorIds: actorIds }],
    messages: [],
    posts: [],
    comments: [],
    likes: [],
    mediaSlots: [],
    facts: [],
    stageResults: [],
  };
}

// ---------------------------------------------------------------------------
// 创建前 AI 企划：会话、任务、候选与结构化输出。
// ---------------------------------------------------------------------------

export const ActivityPlanningOutputStageSchema = Type.Object({
  clientId: Type.String(),
  title: Type.String(),
  actorIds: Type.Array(Type.String()),
  location: Type.String(),
  description: Type.String(),
  requiredBeats: Type.Array(Type.String()),
  endCondition: Type.String(),
});

export const ActivityPlanningOutputSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  activity: Type.Object({
    title: Type.String(),
    theme: Type.String(),
    location: Type.String(),
    rules: Type.String(),
    overview: Type.String(),
  }),
  actorRoles: Type.Array(Type.Object({ actorId: Type.String(), activityRole: Type.String() })),
  stages: Type.Array(ActivityPlanningOutputStageSchema),
});
export type ActivityPlanningOutput = Static<typeof ActivityPlanningOutputSchema>;

export interface ActivityPlanningCharacterRef {
  characterId: string;
  displayName: string;
  sourceVersion: number | null;
  sourceVersionStatus: 'published' | 'draft' | 'unknown' | 'missing';
  draftRevision: number;
  actorId: string;
  personaHash: string;
}

export interface ActivityPlanningForm {
  templateId: string;
  title: string;
  type: string;
  theme: string;
  location: string;
  rules: string;
  scheduledDate: string | null;
  characters: Array<{ characterId: string; version?: number | null; activityRole?: string }>;
  birthdayCharacterIds: string[];
  instruction?: string;
}

export type ActivityPlanningSessionStatus = 'draft' | 'generating' | 'ready' | 'failed' | 'created' | 'discarded';

export interface ActivityPlanningSession {
  id: string;
  version: number;
  status: ActivityPlanningSessionStatus;
  form: ActivityPlanningForm;
  document: ContentDocument;
  characters: ActivityPlanningCharacterRef[];
  activityId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityPlanningJob {
  id: string;
  sessionId: string;
  status: ActivityJobStatus;
  requestHash: string;
  idempotencyKey: string | null;
  resultCandidateIds: string[];
  errorMessage: string | null;
  modelMetadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityPlanningCandidate {
  id: string;
  sessionId: string;
  sessionVersion: number | null;
  payload: ActivityPlanningOutput;
  adopted: boolean;
  createdAt: string;
}

export interface ActivityPlanningSessionResponse {
  session: ActivityPlanningSession;
  jobs: ActivityPlanningJob[];
  candidates: ActivityPlanningCandidate[];
}
