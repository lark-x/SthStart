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
export type ProfileKind = 'llm' | 'vector' | 'image';

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
  createdAt: string;
  updatedAt: string;
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

export interface PublicServiceOverview {
  keyring: { available: boolean; backend: string | null; envFallback: boolean };
  apps: readonly ManagedApp[];
  profiles: readonly ProviderProfile[];
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
  checkComfyuiBeforeStart: boolean;
  useMirror: boolean;
  comfyuiExecutable: string;
  extraLoraFolders: string[];
  maibotAutostart: boolean;
  maibotBrowserMaibot: boolean;
  maibotBrowserSnowluma: boolean;
  creative: Readonly<Record<string, unknown>>;
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
  logPolicy: LogPolicy;
  recentErrors: number;
  droppedLogs: number;
}
