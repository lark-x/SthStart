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

export const CharacterAppearanceSchema = Type.Object({
  description: Type.String(),
  hair: Type.String(),
  eyes: Type.String(),
  build: Type.String(),
  outfits: Type.Array(Type.String()),
  accessories: Type.Array(Type.String()),
});
export type CharacterAppearance = Static<typeof CharacterAppearanceSchema>;

export const CharacterSpeechSchema = Type.Object({
  tone: Type.String(),
  habits: Type.String(),
  catchphrases: Type.Array(Type.String()),
  examples: Type.Array(Type.String()),
});
export type CharacterSpeech = Static<typeof CharacterSpeechSchema>;

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
});
export type CharacterDraft = Static<typeof CharacterDraftSchema>;

function bullets(values: string[]) { return values.map((value) => `- ${value}`).join('\n'); }

// 邻舍人格提示词编译：发布（characters publish）与 Tavern 导出共用同一实现，
// 前端预览也引用此函数，保证预览与实际发布的提示词一致。
export function compileLinshePrompt(draft: CharacterDraft) {
  if (draft.legacyPrompt && !draft.identity && draft.personality.length === 0) return draft.legacyPrompt;
  const heading = `你是${draft.displayName}${draft.englishName ? `(${draft.englishName})` : ''}${draft.originType === 'ip' && draft.work ? `，来自《${draft.work}》` : ''}。`;
  const identity = [draft.identity, draft.background, draft.currentSituation].filter(Boolean).join('\n\n') || draft.summary;
  const personality = [
    ...draft.personality,
    draft.speech.tone ? `说话语气：${draft.speech.tone}` : '', draft.speech.habits ? `表达习惯：${draft.speech.habits}` : '',
    draft.speech.catchphrases.length ? `常用表达：${draft.speech.catchphrases.join('；')}` : '',
    draft.motivations.length ? `核心动机：${draft.motivations.join('；')}` : '', draft.beliefs.length ? `信念：${draft.beliefs.join('；')}` : '',
  ].filter(Boolean);
  const preferences = [draft.likes.length ? `- 你喜欢：${draft.likes.join('；')}` : '', draft.dislikes.length ? `- 你不喜欢：${draft.dislikes.join('；')}` : '', draft.fears.length ? `- 你害怕：${draft.fears.join('；')}` : ''].filter(Boolean).join('\n');
  const visual = [draft.appearance.description, draft.appearance.hair && `发型与发色：${draft.appearance.hair}`, draft.appearance.eyes && `眼睛：${draft.appearance.eyes}`, draft.appearance.build && `体态：${draft.appearance.build}`, draft.appearance.outfits.length && `服装：${draft.appearance.outfits.join('；')}`, draft.appearance.accessories.length && `饰品：${draft.appearance.accessories.join('；')}`].filter(Boolean).join('\n');
  return [heading, `## 你的身份\n${identity || '尚未补充。'}`, `## 你的性格\n${bullets(personality) || '- 尚未补充。'}`, preferences && `## 你的好恶\n${preferences}`, `## 你的外观\n${visual || '尚未补充。'}`, draft.boundaries.length && `## 你的边界\n${bullets(draft.boundaries)}`, draft.secrets.length && `## 你不会轻易说出的事\n${bullets(draft.secrets)}`, draft.speech.examples.length && `## 对话示例\n${bullets(draft.speech.examples)}`, draft.extraRules && `## 额外规则\n${draft.extraRules}`].filter(Boolean).join('\n\n');
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
  ]),
  fetchedAt: Type.String(),
});
export type CharacterSource = Static<typeof CharacterSourceSchema>;

export const CharacterVersionSchema = Type.Object({
  characterId: Type.String(),
  version: Type.Number(),
  data: CharacterDraftSchema,
  compiledLinshePrompt: Type.String(),
  relationships: Type.Array(CharacterRelationshipSchema),
  createdAt: Type.String(),
});
export type CharacterVersion = Static<typeof CharacterVersionSchema>;

export const CharacterProfileSchema = Type.Object({
  id: Type.String(),
  slug: Type.String(),
  displayName: Type.String(),
  draft: CharacterDraftSchema,
  tags: Type.Array(Type.String()),
  avatarUrl: Type.Union([Type.String(), Type.Null()]),
  latestVersion: Type.Union([Type.Number(), Type.Null()]),
  archived: Type.Boolean(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type CharacterProfile = Static<typeof CharacterProfileSchema>;

export const CharacterListResponseSchema = Type.Object({
  items: Type.Array(CharacterProfileSchema),
});
export type CharacterListResponse = Static<typeof CharacterListResponseSchema>;

export const CharacterGenerateResponseSchema = Type.Object({
  draft: CharacterDraftSchema,
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

export const SourceOwnerKindSchema = Type.Union([
  Type.Literal('content'),
  Type.Literal('image_config'),
  Type.Literal('recipe'),
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
