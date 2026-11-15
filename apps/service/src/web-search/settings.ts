import type { WebSearchSettings, WebSearchProvider } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import type { SecretStore } from '../security.js';

export const WEB_SEARCH_SETTINGS_ID = 'tavily';
export const WEB_SEARCH_SECRET_ACCOUNT = 'web-search-tavily';
export const WEB_SEARCH_SECRET_ENV = 'STHSTART_TAVILY_API_KEY';
export const WEB_SEARCH_PROVIDERS = ['anysearch', 'exa', 'tavily'] as const;

const DEFAULT_SETTINGS: StoredWebSearchSettings = { enabled: false, provider: 'tavily', anonymous: false };

export interface StoredWebSearchSettings {
  enabled: boolean;
  provider: WebSearchProvider;
  anonymous: boolean;
}

function parseStoredSettings(value: unknown): StoredWebSearchSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_SETTINGS };
  const v = value as Partial<StoredWebSearchSettings>;
  const provider = WEB_SEARCH_PROVIDERS.includes(v.provider as WebSearchProvider) ? v.provider! : 'tavily';
  return { enabled: v.enabled === true, provider, anonymous: provider === 'anysearch' && v.anonymous === true };
}

export function readStoredWebSearchSettings(database: ServiceDatabase): StoredWebSearchSettings {
  const row = database.connection.prepare(
    'SELECT data_json FROM sw_authoring_settings WHERE id = ?',
  ).get(WEB_SEARCH_SETTINGS_ID) as { data_json?: unknown } | undefined;
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    return parseStoredSettings(JSON.parse(String(row.data_json)));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeStoredWebSearchSettings(database: ServiceDatabase, enabled: boolean, provider: WebSearchProvider = 'tavily', anonymous = false) {
  const now = nowIso();
  database.connection.prepare(`
    INSERT INTO sw_authoring_settings (id, data_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
  `).run(WEB_SEARCH_SETTINGS_ID, JSON.stringify({ enabled, provider, anonymous: provider === 'anysearch' && anonymous }), now);
}

export async function resolveWebSearchCredential(secrets: SecretStore, provider: WebSearchProvider = 'tavily') {
  const credential = await secrets.get(`web-search-${provider}`, `STHSTART_${provider.toUpperCase()}_API_KEY`);
  const value = credential.value?.trim() || null;
  return { value, source: value ? credential.source : 'none' as const };
}

export async function hydrateWebSearchSettings(
  database: ServiceDatabase,
  secrets: SecretStore,
): Promise<WebSearchSettings> {
  const settings = readStoredWebSearchSettings(database);
  const credentials = await Promise.all(WEB_SEARCH_PROVIDERS.map(async provider => ({
    provider,
    ...await resolveWebSearchCredential(secrets, provider),
  })));
  const credential = credentials.find(item => item.provider === settings.provider)!;
  return {
    enabled: settings.enabled,
    provider: settings.provider,
    anonymous: settings.provider === 'anysearch' && settings.anonymous === true,
    providers: credentials.map(({ provider, value }) => ({ provider, hasCredential: value !== null })),
    hasCredential: credential.value !== null,
    credentialSource: credential.source,
  };
}
