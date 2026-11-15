import type {
  ModelRoute,
  ModelRouteCapability,
  ModelRouteScope,
} from '@sthstart/contracts';
import type { ServiceDatabase } from './database.js';

interface ModelRouteRow {
  id: string;
  scope: ModelRouteScope;
  app_id: string;
  capability: ModelRouteCapability;
  primary_model_id: string;
  fallback_model_ids_json: string;
  inherit_public_fallbacks: number;
  created_at: string;
  updated_at: string;
}

export type ModelRouteSource = 'app' | 'legacy' | 'public' | 'none';

export interface ModelRouteSelection {
  source: ModelRouteSource;
  route: ModelRoute | null;
  appId: string | null;
  capability: ModelRouteCapability;
  primaryModelId: string | null;
  fallbackModelIds: string[];
  profileIds: string[];
}

export type ModelProfileAvailability =
  | 'ok'
  | 'missing'
  | 'connection_missing'
  | 'connection_disabled'
  | 'connection_mismatch'
  | 'model_disabled'
  | 'capability_mismatch'
  | 'model_id_missing';

export interface ModelProfileInspection {
  id: string;
  found: boolean;
  availability: ModelProfileAvailability;
  name: string | null;
  modelId: string | null;
  enabled: boolean;
  connectionId: string | null;
  connectionEnabled: boolean;
  connectionKind: string | null;
  credentialAccount: string | null;
  capabilities: ModelRouteCapability[];
}

function parseFallbackIds(value: unknown): string[] {
  try {
    const parsed: unknown = JSON.parse(String(value ?? '[]'));
    if (!Array.isArray(parsed)) return [];
    const ids: string[] = [];
    for (const item of parsed) {
      if (typeof item !== 'string') continue;
      const id = item.trim();
      if (id && !ids.includes(id)) ids.push(id);
      if (ids.length === 2) break;
    }
    return ids;
  } catch {
    return [];
  }
}

/**
 * Capability names are shared with older rows that still call visual models
 * "vision". Routing only needs the two canonical capabilities.
 */
export function normalizeCapabilities(value: unknown): ModelRouteCapability[] {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const capabilities = new Set<ModelRouteCapability>();
  for (const item of parsed) {
    if (item === 'text') capabilities.add('text');
    if (item === 'multimodal' || item === 'vision') capabilities.add('multimodal');
  }
  return [...capabilities];
}

export function supportsCapability(value: unknown, capability: ModelRouteCapability): boolean {
  return normalizeCapabilities(value).includes(capability);
}

/** Connection kind describes the protocol; the model declares its own output type. */
export function connectionSupportsModelType(kind: string, modelType: string): boolean {
  if (kind === 'openai-compatible-text' || kind === 'openai-compatible-image') {
    return ['chat', 'embedding', 'image'].includes(modelType);
  }
  return kind === 'vector' ? modelType === 'embedding'
    : ['comfyui', 'worker'].includes(kind) && modelType === 'image';
}

export function hydrateModelRoute(row: ModelRouteRow): ModelRoute {
  return {
    id: String(row.id),
    scope: row.scope,
    appId: row.scope === 'public' ? null : String(row.app_id),
    capability: row.capability,
    primaryModelId: String(row.primary_model_id),
    fallbackModelIds: parseFallbackIds(row.fallback_model_ids_json),
    inheritPublicFallbacks: Boolean(row.inherit_public_fallbacks),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listModelRoutes(database: ServiceDatabase): ModelRoute[] {
  const rows = database.connection.prepare(
    'SELECT * FROM model_routes ORDER BY scope, app_id, capability',
  ).all() as unknown as ModelRouteRow[];
  return rows.map(hydrateModelRoute);
}

export function getModelRoute(
  database: ServiceDatabase,
  scope: ModelRouteScope,
  appId: string | null,
  capability: ModelRouteCapability,
): ModelRoute | null {
  const row = database.connection.prepare(
    'SELECT * FROM model_routes WHERE scope=? AND app_id=? AND capability=?',
  ).get(scope, appId ?? '', capability) as ModelRouteRow | undefined;
  return row ? hydrateModelRoute(row) : null;
}

export function inspectModelProfile(
  database: ServiceDatabase,
  modelId: string,
  capability?: ModelRouteCapability,
  expectedConnectionKind?: string,
): ModelProfileInspection {
  const row = database.connection.prepare(`
    SELECT mp.id, mp.name, mp.model_id, mp.enabled AS model_enabled,
           mp.capabilities_json, mp.model_type, mp.connection_id AS declared_connection_id,
           sc.id AS connection_id, sc.enabled AS connection_enabled, sc.kind AS connection_kind,
           sc.credential_account
    FROM model_profiles mp
    LEFT JOIN service_connections sc ON sc.id = mp.connection_id
    WHERE mp.id = ?
  `).get(modelId) as {
    id: string;
    name: string;
    model_id: string;
    model_enabled: number;
    capabilities_json: string;
    model_type: string;
    declared_connection_id: string;
    connection_id: string | null;
    connection_enabled: number | null;
    connection_kind: string | null;
    credential_account: string | null;
  } | undefined;

  if (!row) {
    return {
      id: modelId, found: false, availability: 'missing', name: null, modelId: null,
      enabled: false, connectionId: null, connectionEnabled: false, connectionKind: null,
      credentialAccount: null, capabilities: [],
    };
  }

  const capabilities = normalizeCapabilities(row.capabilities_json);
  const connectionId = row.connection_id ?? row.declared_connection_id ?? null;
  const connectionEnabled = row.connection_enabled === 1;
  let availability: ModelProfileAvailability = 'ok';
  if (!row.connection_id) availability = 'connection_missing';
  else if (!connectionEnabled) availability = 'connection_disabled';
  else if (!connectionSupportsModelType(String(row.connection_kind), row.model_type)) availability = 'connection_mismatch';
  else if (expectedConnectionKind && row.model_type !== (expectedConnectionKind === 'openai-compatible-text' ? 'chat' : expectedConnectionKind === 'vector' ? 'embedding' : 'image')) availability = 'connection_mismatch';
  else if (row.model_enabled !== 1) availability = 'model_disabled';
  else if (capability && !capabilities.includes(capability)) availability = 'capability_mismatch';
  else if (!String(row.model_id ?? '').trim()) availability = 'model_id_missing';

  return {
    id: String(row.id),
    found: true,
    availability,
    name: String(row.name),
    modelId: String(row.model_id ?? ''),
    enabled: row.model_enabled === 1,
    connectionId,
    connectionEnabled,
    connectionKind: row.connection_kind,
    credentialAccount: row.credential_account,
    capabilities,
  };
}

/**
 * Route precedence:
 * 1. an app route (the new explicit app-level configuration),
 * 2. a legacy app assignment written by the old assignment screen,
 * 3. the public route.
 *
 * A legacy assignment can legitimately be newer than the route created while
 * migrating; choosing by updated_at keeps the old screen functional until it is
 * replaced, without ever letting the public route override an app choice.
 */
export function selectModelRoute(
  database: ServiceDatabase,
  appId: string,
  capability: ModelRouteCapability,
): ModelRouteSelection {
  const appRoute = getModelRoute(database, 'app', appId, capability);
  const publicRoute = getModelRoute(database, 'public', null, capability);
  const legacy = database.connection.prepare(
    'SELECT profile_id,updated_at FROM app_llm_assignments WHERE app_id=? AND role=?',
  ).get(appId, capability) as { profile_id: string; updated_at: string } | undefined;

  if (appRoute && (!legacy || String(appRoute.updatedAt) >= String(legacy.updated_at))) {
    const fallbackModelIds = [...appRoute.fallbackModelIds];
    if (appRoute.inheritPublicFallbacks && publicRoute) {
      for (const id of publicRoute.fallbackModelIds) {
        if (id !== appRoute.primaryModelId && !fallbackModelIds.includes(id)) fallbackModelIds.push(id);
      }
    }
    const uniqueFallbacks = fallbackModelIds.slice(0, 2);
    return {
      source: 'app',
      route: appRoute,
      appId,
      capability,
      primaryModelId: appRoute.primaryModelId,
      fallbackModelIds: uniqueFallbacks,
      profileIds: [appRoute.primaryModelId, ...uniqueFallbacks],
    };
  }

  if (legacy?.profile_id) {
    return {
      source: 'legacy',
      route: null,
      appId,
      capability,
      primaryModelId: legacy.profile_id,
      fallbackModelIds: [],
      profileIds: [legacy.profile_id],
    };
  }

  if (publicRoute) {
    return {
      source: 'public',
      route: publicRoute,
      appId,
      capability,
      primaryModelId: publicRoute.primaryModelId,
      fallbackModelIds: publicRoute.fallbackModelIds,
      profileIds: [publicRoute.primaryModelId, ...publicRoute.fallbackModelIds],
    };
  }

  return {
    source: 'none', route: null, appId, capability,
    primaryModelId: null, fallbackModelIds: [], profileIds: [],
  };
}

export function routeProfileIds(
  database: ServiceDatabase,
  appId: string,
  capability: ModelRouteCapability,
): string[] {
  return selectModelRoute(database, appId, capability).profileIds;
}
