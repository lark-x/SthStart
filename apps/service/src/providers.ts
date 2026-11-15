import type { ServiceDatabase } from './database.js';
import type { SecretStore } from './security.js';
import type { LlmModelRole, ModelRouteCapability, ModelThinkingLevel } from '@sthstart/contracts';
import { connectionSupportsModelType, inspectModelProfile, normalizeCapabilities, selectModelRoute, supportsCapability } from './model-routing.js';

export interface ResolvedProfile {
  id: string;
  name: string;
  baseUrl: string;
  model: string | null;
  secret: string | null;
  thinkingMode: 'enabled' | 'disabled' | 'omit';
  thinkingLevel?: ModelThinkingLevel;
  timeoutMs?: number;
  capabilities?: ModelRouteCapability[];
  fallbacks?: ResolvedProfile[];
  headers: Record<string, string>;
  extraBody: Record<string, unknown>;
}

function resolvedRow(database: ServiceDatabase, kind: 'llm' | 'vector' | 'image', requested?: string) {
  return database.connection.prepare(
    `SELECT p.id,p.name,p.base_url,p.model,p.credential_account,o.thinking_mode,o.headers_json,o.extra_body_json,o.capabilities_json FROM provider_profiles p
     LEFT JOIN provider_profile_options o ON o.profile_id=p.id
     WHERE p.kind = ? AND p.enabled = 1
       AND NOT EXISTS (SELECT 1 FROM model_profiles mp WHERE mp.id=p.id)
       ${requested ? 'AND p.id = ?' : ''} ORDER BY p.created_at LIMIT 1`,
  ).get(...(requested ? [kind, requested] : [kind])) as {
    id: string; name: string; base_url: string; model: string | null; credential_account: string | null; thinking_mode: 'enabled' | 'disabled' | 'omit' | null; headers_json: string | null; extra_body_json: string | null; capabilities_json: string | null;
  } | undefined;
}

async function hydrateProfile(row: ReturnType<typeof resolvedRow>, secrets: SecretStore) {
  if (!row) return null;
  const envName = `STHSTART_SECRET_${row.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const credential = row.credential_account ? await secrets.get(row.credential_account, envName) : { value: null };
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url.replace(/\/$/, ''),
    model: row.model,
    secret: credential.value,
    thinkingMode: row.thinking_mode ?? 'omit',
    thinkingLevel: 'auto' as ModelThinkingLevel,
    capabilities: legacyCapabilities(row.capabilities_json),
    headers: JSON.parse(row.headers_json ?? '{}') as Record<string, string>,
    extraBody: JSON.parse(row.extra_body_json ?? '{}') as Record<string, unknown>,
  } satisfies ResolvedProfile;
}

function legacyCapabilities(value: unknown): ModelRouteCapability[] {
  const capabilities = normalizeCapabilities(value ?? '["text"]');
  return capabilities.length ? capabilities : ['text'];
}

async function hydrateFromModelProfile(row: Record<string, unknown>, secrets: SecretStore): Promise<ResolvedProfile> {
  const account = row.credential_account ? String(row.credential_account) : '';
  const connEnv = row.connection_id ? `STHSTART_SECRET_${String(row.connection_id).toUpperCase().replace(/[^A-Z0-9]/g, '_')}` : '';
  const modelEnv = `STHSTART_SECRET_${String(row.id).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  let credential = account ? await secrets.get(account, connEnv || modelEnv) : { value: null };
  if (!credential.value && connEnv && account) {
    credential = await secrets.get(account, modelEnv);
  }
  const advanced = JSON.parse(String(row.advanced_json ?? '{}')) as Record<string, unknown>;
  const defaultParams = JSON.parse(String(row.default_params_json ?? '{}')) as Record<string, unknown>;
  const options = JSON.parse(String(row.options_json ?? '{}')) as Record<string, unknown>;
  const headers = JSON.parse(String(row.headers_json ?? '{}')) as Record<string, string>;
  const capabilities = normalizeCapabilities(row.capabilities_json ?? (row.model_type === 'chat' ? '["text"]' : '[]'));

  const cleanAdvanced = { ...advanced };
  delete cleanAdvanced.thinkingMode;

  return {
    id: String(row.id),
    name: String(row.name),
    baseUrl: String(row.base_url).replace(/\/$/, ''),
    model: String(row.model ?? row.model_id ?? ''),
    secret: credential.value,
    thinkingMode: (advanced.thinkingMode ?? 'omit') as 'enabled' | 'disabled' | 'omit',
    thinkingLevel: (row.thinking_level ?? advanced.thinkingLevel ?? 'auto') as ModelThinkingLevel,
    timeoutMs: positiveInteger(row.model_timeout_ms) ?? positiveInteger(row.timeout_ms) ?? 60000,
    capabilities,
    headers,
    extraBody: { ...(row.max_output_tokens ? { max_tokens: Number(row.max_output_tokens) } : {}), ...options, ...defaultParams, ...cleanAdvanced },
  } satisfies ResolvedProfile;
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
}

export async function resolveProfile(
  database: ServiceDatabase,
  secrets: SecretStore,
  kind: 'llm' | 'vector' | 'image',
  requested?: string,
): Promise<ResolvedProfile | null> {
  {
    const modelRow = database.connection.prepare(
      `SELECT mp.id, mp.connection_id, mp.name, mp.model_id, sc.id as connection_id, sc.base_url, sc.credential_account,
              mp.capabilities_json, mp.advanced_json, mp.default_params_json, mp.max_output_tokens, mp.thinking_level,
              mp.timeout_ms AS model_timeout_ms, sc.kind, mp.model_type, sc.headers_json, sc.options_json, sc.timeout_ms
       FROM model_profiles mp
       JOIN service_connections sc ON sc.id = mp.connection_id
       WHERE mp.enabled = 1 AND sc.enabled = 1 AND mp.model_type = ?
         ${requested ? 'AND mp.id = ?' : kind === 'vector' ? "AND sc.kind = 'vector'" : ''}
       ORDER BY mp.created_at,mp.id LIMIT 1`
    ).get(...[kind === 'llm' ? 'chat' : kind === 'image' ? 'image' : 'embedding', ...(requested ? [requested] : [])]) as Record<string, unknown> | undefined;
    if (modelRow && connectionSupportsModelType(String(modelRow.kind), String(modelRow.model_type))) return hydrateFromModelProfile(modelRow, secrets);
    // A managed model must never bypass its connection or model state through its legacy projection.
    if (requested && database.connection.prepare('SELECT id FROM model_profiles WHERE id = ?').get(requested)) return null;
  }
  return hydrateProfile(resolvedRow(database, kind, requested), secrets);
}

export async function resolveAssignedLlmProfile(database: ServiceDatabase, secrets: SecretStore, appId: string, role: LlmModelRole): Promise<ResolvedProfile | null> {
  return withFallbacks(await resolveRoutedProfiles(database, secrets, appId, role));
}

function withFallbacks(profiles: ResolvedProfile[]): ResolvedProfile | null {
  if (profiles.length === 0) return null;
  const [primary, ...fallbacks] = profiles;
  return fallbacks.length > 0
    ? { ...primary, fallbacks: fallbacks.map((profile) => ({ ...profile, fallbacks: undefined })) }
    : primary;
}

export async function resolveRoutedProfiles(
  database: ServiceDatabase,
  secrets: SecretStore,
  appId: string,
  role: LlmModelRole,
): Promise<ResolvedProfile[]> {
  const capability = role as ModelRouteCapability;
  const selection = selectModelRoute(database, appId, capability);
  if (!selection.primaryModelId) return [];

  const profiles: ResolvedProfile[] = [];
  const primaryId = selection.primaryModelId;
  if (selection.source === 'legacy') {
    const primary = await resolveProfile(database, secrets, 'llm', primaryId);
    if (!primary) {
      throw routeUnavailable(selection, primaryId, 'legacy_assignment_unavailable', '应用仍在使用旧版模型分配，但对应模型已删除或停用。');
    }
    if (!supportsCapability(primary.capabilities, capability)) {
      throw routeUnavailable(selection, primaryId, 'capability_mismatch', '旧版模型分配中的模型不支持当前能力。');
    }
    profiles.push(primary);
  } else {
    const inspected = inspectModelProfile(database, primaryId, capability, 'openai-compatible-text');
    if (inspected.availability !== 'ok') {
      throw routeUnavailable(selection, primaryId, inspected.availability, routeIssueMessage(inspected.availability));
    }
    const primary = await resolveProfile(database, secrets, 'llm', primaryId);
    if (!primary) {
      throw routeUnavailable(selection, primaryId, 'profile_unavailable', '模型路由的主模型无法解析，请检查模型、连接与凭据。');
    }
    if (!supportsCapability(primary.capabilities, capability)) {
      throw routeUnavailable(selection, primaryId, 'capability_mismatch', '模型路由的主模型不支持当前能力。');
    }
    profiles.push(primary);
  }

  for (const id of selection.fallbackModelIds) {
    const inspected = inspectModelProfile(database, id, capability, 'openai-compatible-text');
    if (inspected.availability !== 'ok') continue;
    const profile = await resolveProfile(database, secrets, 'llm', id);
    if (profile && supportsCapability(profile.capabilities, capability)) profiles.push(profile);
  }
  return profiles;
}

interface RouteSelectionLike {
  source: string;
  capability: string;
  appId: string | null;
}

function routeUnavailable(
  selection: RouteSelectionLike,
  modelId: string,
  reason: string,
  message: string,
) {
  return Object.assign(new Error(`model_route_unavailable: ${message}`), {
    statusCode: 409,
    code: 'model_route_unavailable',
    routeSource: selection.source,
    capability: selection.capability,
    appId: selection.appId,
    modelId,
    reason,
  });
}

function routeIssueMessage(reason: string): string {
  switch (reason) {
    case 'missing': return '模型路由的主模型不存在（可能已被删除）。';
    case 'connection_missing': return '模型路由的主模型没有可用连接。';
    case 'connection_disabled': return '模型路由的主模型所属连接已停用。';
    case 'connection_mismatch': return '模型路由的主模型不属于文本服务连接。';
    case 'model_disabled': return '模型路由的主模型已停用。';
    case 'capability_mismatch': return '模型路由的主模型不支持当前能力。';
    case 'model_id_missing': return '模型路由的主模型缺少实际模型 ID。';
    default: return '模型路由的主模型当前不可用。';
  }
}

export async function resolveEffectiveModelProfile(
  database: ServiceDatabase,
  secrets: SecretStore,
  appId: string,
  purposeKey?: string,
  explicitModelId?: string,
): Promise<ResolvedProfile | null> {
  const isMultimodal = purposeKey === 'image-recognition' || purposeKey === 'vision';
  const role: LlmModelRole = isMultimodal ? 'multimodal' : 'text';

  // 1. 本次明确指定的模型配置
  if (explicitModelId) {
    const resolved = await resolveProfile(database, secrets, 'llm', explicitModelId);
    if (!resolved) {
      throw Object.assign(new Error(`explicit_model_not_found: 显式指定的模型配置 "${explicitModelId}" 不存在或已被禁用，拒绝回退喵。`), { statusCode: 409 });
    }
    if (!supportsCapability(resolved.capabilities, role)) {
      throw Object.assign(new Error(`explicit_model_capability_mismatch: 显式指定的模型不支持当前${isMultimodal ? '多模态' : '文本'}调用。`), { statusCode: 409 });
    }
    return resolved;
  }

  // 2. 业务用途级绑定 (purpose_bindings)
  if (purposeKey) {
    const binding = database.connection.prepare(
      'SELECT target_id, target_type, inherit_app_default FROM purpose_bindings WHERE app_id = ? AND purpose_key = ?'
    ).get(appId, purposeKey) as { target_id: string; target_type: string; inherit_app_default: number } | undefined;

    if (binding && !binding.inherit_app_default) {
      if (binding.target_type !== 'model' || !binding.target_id) throw Object.assign(new Error(`purpose_model_unavailable: 用途 ${purposeKey} 没有有效的文本模型绑定。`), { statusCode: 409 });
      const resolved = await resolveProfile(database, secrets, 'llm', binding.target_id);
      if (!resolved) {
        throw Object.assign(new Error(`purpose_model_unavailable: 用途 "${purposeKey}" 绑定的模型配置 "${binding.target_id}" 不存在或已被禁用，拒绝回退喵。`), { statusCode: 409 });
      }
      if (!supportsCapability(resolved.capabilities, role)) {
        throw Object.assign(new Error(`purpose_model_capability_mismatch: 用途 "${purposeKey}" 绑定的模型不支持当前${isMultimodal ? '多模态' : '文本'}调用。`), { statusCode: 409 });
      }
      return resolved;
    }
  }

  const routed = withFallbacks(await resolveRoutedProfiles(database, secrets, appId, role));
  if (routed) return routed;

  if (appId === 'topics' || appId === 'notebook') {
    return resolveAssignedLlmProfile(database, secrets, 'activities', role);
  }
  return null;
}

export function upstreamHeaders(secret: string | null, contentType = true) {
  const headers: Record<string, string> = {};
  if (contentType) headers['content-type'] = 'application/json';
  if (secret) headers.authorization = `Bearer ${secret}`;
  return headers;
}

export function safeJson(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
