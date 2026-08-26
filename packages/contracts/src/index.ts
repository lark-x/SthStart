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

export const NarrativeReadingSchema = Type.Object({
  node: Type.Object({
    id: Type.String(),
    workId: Type.String(),
    title: Type.String(),
    summary: Type.String(),
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
