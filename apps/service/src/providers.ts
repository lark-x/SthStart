import type { ServiceDatabase } from './database.js';
import type { SecretStore } from './security.js';
import type { LlmModelRole } from '@sthstart/contracts';

export interface ResolvedProfile {
  id: string;
  name: string;
  baseUrl: string;
  model: string | null;
  secret: string | null;
  thinkingMode: 'enabled' | 'disabled' | 'omit';
  timeoutMs?: number;
  headers: Record<string, string>;
  extraBody: Record<string, unknown>;
}

function resolvedRow(database: ServiceDatabase, kind: 'llm' | 'vector' | 'image', requested?: string) {
  return database.connection.prepare(
    `SELECT p.id,p.name,p.base_url,p.model,p.credential_account,o.thinking_mode,o.headers_json,o.extra_body_json FROM provider_profiles p
     LEFT JOIN provider_profile_options o ON o.profile_id=p.id
     WHERE p.kind = ? AND p.enabled = 1 ${requested ? 'AND p.id = ?' : ''} ORDER BY p.created_at LIMIT 1`,
  ).get(...(requested ? [kind, requested] : [kind])) as {
    id: string; name: string; base_url: string; model: string | null; credential_account: string | null; thinking_mode: 'enabled' | 'disabled' | 'omit' | null; headers_json: string | null; extra_body_json: string | null;
  } | undefined;
}

async function hydrateProfile(row: ReturnType<typeof resolvedRow>, secrets: SecretStore) {
  if (!row) return null;
  const envName = `STHSTART_SECRET_${row.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const credential = row.credential_account ? await secrets.get(row.credential_account, envName) : { value: null };
  return { id: row.id, name: row.name, baseUrl: row.base_url.replace(/\/$/, ''), model: row.model, secret: credential.value, thinkingMode: row.thinking_mode ?? 'omit', headers: JSON.parse(row.headers_json ?? '{}') as Record<string, string>, extraBody: JSON.parse(row.extra_body_json ?? '{}') as Record<string, unknown> } satisfies ResolvedProfile;
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

  return {
    id: String(row.id),
    name: String(row.name),
    baseUrl: String(row.base_url).replace(/\/$/, ''),
    model: String(row.model ?? row.model_id ?? ''),
    secret: credential.value,
    thinkingMode: (advanced.thinkingMode ?? 'omit') as 'enabled' | 'disabled' | 'omit',
    timeoutMs: Number(row.timeout_ms ?? 60000),
    headers,
    extraBody: { ...(row.max_output_tokens ? { max_tokens: Number(row.max_output_tokens) } : {}), ...options, ...defaultParams, ...advanced },
  } satisfies ResolvedProfile;
}

export async function resolveProfile(
  database: ServiceDatabase,
  secrets: SecretStore,
  kind: 'llm' | 'vector' | 'image',
  requested?: string,
): Promise<ResolvedProfile | null> {
  if (requested) {
    const modelRow = database.connection.prepare(
      `SELECT mp.id, mp.connection_id, mp.name, mp.model_id, sc.id as connection_id, sc.base_url, sc.credential_account,
              mp.advanced_json, mp.default_params_json, mp.max_output_tokens, sc.headers_json, sc.options_json, sc.timeout_ms
       FROM model_profiles mp
       JOIN service_connections sc ON sc.id = mp.connection_id
       WHERE mp.id = ? AND mp.enabled = 1 AND sc.enabled = 1 AND sc.kind = ?`
    ).get(requested, kind === 'llm' ? 'openai-compatible-text' : kind === 'image' ? 'openai-compatible-image' : 'vector') as Record<string, unknown> | undefined;
    if (modelRow) return hydrateFromModelProfile(modelRow, secrets);
    // A managed model must never bypass its connection or model state through its legacy projection.
    if (database.connection.prepare('SELECT id FROM model_profiles WHERE id = ?').get(requested)) return null;
  }
  return hydrateProfile(resolvedRow(database, kind, requested), secrets);
}

export async function resolveAssignedLlmProfile(database: ServiceDatabase, secrets: SecretStore, appId: string, role: LlmModelRole): Promise<ResolvedProfile | null> {
  const assignment = database.connection.prepare(
    'SELECT profile_id FROM app_llm_assignments WHERE app_id=? AND role=?'
  ).get(appId, role) as { profile_id: string } | undefined;

  if (assignment?.profile_id) return resolveProfile(database, secrets, 'llm', assignment.profile_id);

  const row = database.connection.prepare(
    `SELECT p.id,p.name,p.base_url,p.model,p.credential_account,o.thinking_mode,o.headers_json,o.extra_body_json
     FROM app_llm_assignments a
     JOIN provider_profiles p ON p.id=a.profile_id AND p.kind='llm' AND p.enabled=1
     LEFT JOIN provider_profile_options o ON o.profile_id=p.id
     WHERE a.app_id=? AND a.role=?`,
  ).get(appId, role) as ReturnType<typeof resolvedRow>;
  return hydrateProfile(row, secrets);
}

export async function resolveEffectiveModelProfile(
  database: ServiceDatabase,
  secrets: SecretStore,
  appId: string,
  purposeKey?: string,
  explicitModelId?: string,
): Promise<ResolvedProfile | null> {
  // 1. 本次明确指定的模型配置
  if (explicitModelId) {
    const resolved = await resolveProfile(database, secrets, 'llm', explicitModelId);
    if (!resolved) {
      throw Object.assign(new Error(`explicit_model_not_found: 显式指定的模型配置 "${explicitModelId}" 不存在或已被禁用，拒绝回退喵。`), { statusCode: 409 });
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
      return resolved;
    }
  }

  // 3. 应用级绑定回退 (app_llm_assignments)
  const isMultimodal = purposeKey === 'image-recognition' || purposeKey === 'vision';
  const role: LlmModelRole = isMultimodal ? 'multimodal' : 'text';
  const assigned = await resolveAssignedLlmProfile(database, secrets, appId, role);
  if (assigned) return assigned;

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
