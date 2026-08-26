export type AppStatus = 'online' | 'offline' | 'unknown';

export interface AppDescriptor {
  id: string;
  name: string;
  description: string;
  launchUrl: string;
  status: AppStatus;
  version: string | null;
  sourceRevision: string | null;
  capabilities: readonly string[];
  checkedAt: string;
}

export interface AppsResponse {
  items: readonly AppDescriptor[];
}

export interface HealthResponse {
  status: 'ok';
  service: 'sthstart-service';
  version: string;
  uptimeMs: number;
  timestamp: string;
}

export interface CapabilitiesResponse {
  apiVersion: 'v1';
  modules: readonly {
    id: string;
    version: string;
    description: string;
  }[];
}

export type PublicCapability = 'llm' | 'vector' | 'image' | 'persona' | 'logs';
export type ImageTaskStatus = 'accepted' | 'running' | 'cancel_requested' | 'cancelled' | 'abandoned' | 'cancel_failed' | 'complete' | 'failed';
export type ImageCancellationScope = 'none' | 'queued' | 'local-tracking';
export type ProfileKind = 'llm' | 'vector' | 'image';
export type LlmModelCapability = 'text' | 'multimodal';
export type LlmModelRole = LlmModelCapability;

export interface ManagedApp {
  id: string;
  name: string;
  enabled: boolean;
  capabilities: readonly PublicCapability[];
  createdAt: string;
  updatedAt: string;
}

export interface CreatedApp extends ManagedApp {
  token: string;
}

export interface ProviderProfile {
  id: string;
  name: string;
  kind: ProfileKind;
  baseUrl: string;
  model: string | null;
  enabled: boolean;
  hasCredential: boolean;
  credentialSource: 'keyring' | 'environment' | 'none';
  thinkingMode: 'enabled' | 'disabled' | 'omit';
  headers: Readonly<Record<string, string>>;
  extraBody: Readonly<Record<string, unknown>>;
  capabilities: readonly LlmModelCapability[];
  createdAt: string;
  updatedAt: string;
}

export interface AppLlmAssignment {
  appId: string;
  textProfileId: string | null;
  multimodalProfileId: string | null;
  updatedAt: string | null;
}

export interface StoragePolicy {
  appId: string;
  mode: 'keep' | 'ttl' | 'quota';
  ttlDays: number | null;
  maxBytes: number | null;
}

export interface PersonaTemplate {
  id: string;
  displayName: string;
  tags: readonly string[];
  source: string | null;
  latestVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface PersonaVersion {
  personaId: string;
  version: number;
  displayName: string;
  personaPrompt: string;
  appearancePrompt: string | null;
  avatarArtifactId: string | null;
  metadata: Readonly<Record<string, unknown>>;
  createdAt: string;
}

export interface CharacterAppearance {
  description: string;
  hair: string;
  eyes: string;
  build: string;
  outfits: string[];
  accessories: string[];
}

export interface CharacterSpeech {
  tone: string;
  habits: string;
  catchphrases: string[];
  examples: string[];
}

export interface CharacterDraft {
  displayName: string;
  englishName: string;
  aliases: string[];
  originType: 'original' | 'ip';
  work: string;
  world: string;
  summary: string;
  identity: string;
  background: string;
  currentSituation: string;
  personality: string[];
  motivations: string[];
  beliefs: string[];
  secrets: string[];
  speech: CharacterSpeech;
  likes: string[];
  dislikes: string[];
  fears: string[];
  boundaries: string[];
  appearance: CharacterAppearance;
  extraRules: string;
  legacyPrompt?: string;
}

export interface CharacterProfile {
  id: string;
  slug: string;
  displayName: string;
  draft: CharacterDraft;
  tags: string[];
  avatarUrl: string | null;
  latestVersion: number | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterVersion {
  characterId: string;
  version: number;
  data: CharacterDraft;
  compiledLinshePrompt: string;
  relationships: CharacterRelationship[];
  createdAt: string;
}

export interface CharacterRelationship {
  id: string;
  fromCharacterId: string;
  toCharacterId: string;
  relationType: string;
  description: string;
  updatedAt: string;
}

export interface CharacterSource {
  id: string;
  characterId: string;
  title: string;
  url: string | null;
  excerpt: string;
  sourceType: 'manual' | 'moegirl' | 'web' | 'tavern-card';
  fetchedAt: string;
}

export interface PublicServiceOverview {
  keyring: { available: boolean; backend: string | null; envFallback: boolean };
  apps: readonly ManagedApp[];
  profiles: readonly ProviderProfile[];
  llmAssignments: readonly AppLlmAssignment[];
  personas: readonly PersonaTemplate[];
}

export type LogLevel = 'off' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
export type RuntimeServiceState = 'stopped' | 'starting' | 'running' | 'stopping' | 'degraded' | 'external' | 'error';

export interface RuntimeService {
  id: string;
  name: string;
  port: number;
  optional: boolean;
  installed: boolean;
  state: RuntimeServiceState;
  pid: number | null;
  startedAt: string | null;
  message: string | null;
  managed: boolean;
}

export interface RuntimeSettings {
  autoStart: boolean;
  autoOpenBrowser: boolean;
  useMirror: boolean;
  publicLlmEnabled: boolean;
  comfyuiExecutable: string;
  extraLoraFolders: string[];
  maibotAutostart: boolean;
  maibotBrowserMaibot: boolean;
  maibotBrowserSnowluma: boolean;
  creative: Readonly<Record<string, unknown>>;
}

export interface RuntimeLlmStatus {
  enabled: boolean;
  textProfileId: string | null;
  textModel: string | null;
  multimodalProfileId: string | null;
  multimodalModel: string | null;
  ready: boolean;
}

export interface LogPolicy {
  globalLevel: LogLevel;
  serviceLevels: Readonly<Record<string, LogLevel | null>>;
  retentionDays: number;
  maxBytes: number;
  sensitiveUntil: string | null;
  diagnosticUntil: string | null;
}

export interface LogEvent {
  id: number;
  timestamp: string;
  appId: string;
  serviceId: string;
  level: Exclude<LogLevel, 'off'>;
  message: string;
  stream: 'stdout' | 'stderr' | 'system' | 'app';
  sensitive: boolean;
}

export interface RuntimeOverview {
  services: readonly RuntimeService[];
  settings: RuntimeSettings;
  linsheLlm: RuntimeLlmStatus;
  logPolicy: LogPolicy;
  recentErrors: number;
  droppedLogs: number;
}
