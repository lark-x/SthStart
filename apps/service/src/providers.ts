import type { ServiceDatabase } from './database.js';
import type { SecretStore } from './security.js';

export interface ResolvedProfile {
  id: string;
  baseUrl: string;
  model: string | null;
  secret: string | null;
  thinkingMode: 'enabled' | 'disabled' | 'omit';
  headers: Record<string, string>;
  extraBody: Record<string, unknown>;
}

export async function resolveProfile(
  database: ServiceDatabase,
  secrets: SecretStore,
  kind: 'llm' | 'vector' | 'image',
  requested?: string,
): Promise<ResolvedProfile | null> {
  const row = database.connection.prepare(
    `SELECT p.id,p.base_url,p.model,p.credential_account,o.thinking_mode,o.headers_json,o.extra_body_json FROM provider_profiles p
     LEFT JOIN provider_profile_options o ON o.profile_id=p.id
     WHERE p.kind = ? AND p.enabled = 1 ${requested ? 'AND p.id = ?' : ''} ORDER BY p.created_at LIMIT 1`,
  ).get(...(requested ? [kind, requested] : [kind])) as {
    id: string; base_url: string; model: string | null; credential_account: string | null; thinking_mode: 'enabled' | 'disabled' | 'omit' | null; headers_json: string | null; extra_body_json: string | null;
  } | undefined;
  if (!row) return null;
  const envName = `STHSTART_SECRET_${row.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const credential = row.credential_account ? await secrets.get(row.credential_account, envName) : { value: null };
  return { id: row.id, baseUrl: row.base_url.replace(/\/$/, ''), model: row.model, secret: credential.value, thinkingMode: row.thinking_mode ?? 'omit', headers: JSON.parse(row.headers_json ?? '{}') as Record<string, string>, extraBody: JSON.parse(row.extra_body_json ?? '{}') as Record<string, unknown> };
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
