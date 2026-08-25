import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ManagedApp, PersonaTemplate, ProviderProfile, PublicCapability } from '@sthstart/contracts';
import { authenticateAdmin } from './access.js';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';
import { hashToken, issueToken, type SecretStore } from './security.js';

function appRows(database: ServiceDatabase): ManagedApp[] {
  const rows = database.connection.prepare('SELECT * FROM managed_apps ORDER BY created_at').all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id), name: String(row.name), enabled: Boolean(row.enabled),
    capabilities: JSON.parse(String(row.capabilities_json)) as PublicCapability[],
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }));
}

async function profileRows(database: ServiceDatabase, secrets: SecretStore): Promise<ProviderProfile[]> {
  const rows = database.connection.prepare(`SELECT p.*,o.thinking_mode,o.headers_json,o.extra_body_json FROM provider_profiles p
    LEFT JOIN provider_profile_options o ON o.profile_id=p.id ORDER BY p.kind,p.name`).all() as Record<string, unknown>[];
  return Promise.all(rows.map(async (row) => {
    const account = row.credential_account ? String(row.credential_account) : '';
    const secret = account ? await secrets.get(account, `STHSTART_SECRET_${String(row.id).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`) : { value: null, source: 'none' as const };
    return {
      id: String(row.id), name: String(row.name), kind: row.kind as ProviderProfile['kind'],
      baseUrl: String(row.base_url), model: row.model ? String(row.model) : null,
      enabled: Boolean(row.enabled), hasCredential: Boolean(secret.value), credentialSource: secret.source,
      thinkingMode: (row.thinking_mode ?? 'omit') as ProviderProfile['thinkingMode'],
      headers: JSON.parse(String(row.headers_json ?? '{}')) as Record<string, string>,
      extraBody: JSON.parse(String(row.extra_body_json ?? '{}')) as Record<string, unknown>,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }));
}

function personaRows(database: ServiceDatabase): PersonaTemplate[] {
  const rows = database.connection.prepare('SELECT * FROM personas ORDER BY display_name').all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id), displayName: String(row.display_name), tags: JSON.parse(String(row.tags_json)) as string[],
    source: row.source ? String(row.source) : null, latestVersion: Number(row.latest_version),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }));
}

export function registerManagementRoutes(app: FastifyInstance, config: ServiceConfig, database: ServiceDatabase, secrets: SecretStore) {
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/v1/admin/')) return;
    if (!config.adminToken) return reply.code(503).send({ error: 'admin_not_configured', message: '请设置 STHSTART_ADMIN_TOKEN。' });
    if (!authenticateAdmin(config.adminToken, request)) return reply.code(401).send({ error: 'unauthorized' });
  });

  app.get('/api/v1/admin/overview', async () => ({
    keyring: await secrets.status(), apps: appRows(database),
    profiles: await profileRows(database, secrets), personas: personaRows(database),
  }));

  app.get('/api/v1/admin/apps', async () => ({ items: appRows(database) }));
  app.post<{ Body: { id?: string; name?: string; capabilities?: PublicCapability[] } }>('/api/v1/admin/apps', async (request, reply) => {
    const id = request.body?.id?.trim();
    const name = request.body?.name?.trim();
    const capabilities = request.body?.capabilities ?? ['llm', 'vector', 'image', 'persona', 'logs'];
    if (!id?.match(/^[a-z][a-z0-9-]{1,62}$/) || !name) return reply.code(400).send({ error: 'invalid_app' });
    const token = issueToken('sth_app');
    const now = nowIso();
    try {
      database.connection.prepare('INSERT INTO managed_apps VALUES (?, ?, ?, ?, 1, ?, ?)')
        .run(id, name, hashToken(token), JSON.stringify(capabilities), now, now);
      database.connection.prepare("INSERT INTO storage_policies(app_id, mode) VALUES (?, 'keep')").run(id);
    } catch {
      return reply.code(409).send({ error: 'app_exists' });
    }
    return reply.code(201).send({ id, name, enabled: true, capabilities, createdAt: now, updatedAt: now, token });
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/apps/:id/rotate-token', async (request, reply) => {
    const token = issueToken('sth_app');
    const result = database.connection.prepare('UPDATE managed_apps SET token_hash = ?, updated_at = ? WHERE id = ?')
      .run(hashToken(token), nowIso(), request.params.id);
    if (!result.changes) return reply.code(404).send({ error: 'not_found' });
    return { id: request.params.id, token };
  });

  app.get('/api/v1/admin/profiles', async () => ({ items: await profileRows(database, secrets) }));
  app.post<{ Body: { id?: string; name?: string; kind?: ProviderProfile['kind']; baseUrl?: string; model?: string; secret?: string; thinkingMode?: ProviderProfile['thinkingMode']; headers?: Record<string, string>; extraBody?: Record<string, unknown> } }>('/api/v1/admin/profiles', async (request, reply) => {
    const { id, name, kind, baseUrl, model, secret, thinkingMode = 'omit', headers = {}, extraBody = {} } = request.body ?? {};
    if (!id?.match(/^[a-z][a-z0-9-]{1,62}$/) || !name?.trim() || !['llm', 'vector', 'image'].includes(kind ?? '')) {
      return reply.code(400).send({ error: 'invalid_profile' });
    }
    if (!['enabled', 'disabled', 'omit'].includes(thinkingMode) || !headers || typeof headers !== 'object' || Array.isArray(headers) || !extraBody || typeof extraBody !== 'object' || Array.isArray(extraBody)) return reply.code(400).send({ error: 'invalid_profile_options' });
    let normalizedUrl: string;
    try { normalizedUrl = new URL(baseUrl ?? '').toString().replace(/\/$/, ''); } catch { return reply.code(400).send({ error: 'invalid_url' }); }
    const account = `profile:${id}`;
    if (secret) {
      try { await secrets.set(account, secret); } catch (error) { return reply.code(503).send({ error: 'keyring_unavailable', message: String(error) }); }
    }
    const now = nowIso();
    database.connection.prepare(`INSERT INTO provider_profiles
      (id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, base_url=excluded.base_url,
      model=excluded.model, credential_account=excluded.credential_account, updated_at=excluded.updated_at`)
      .run(id, name.trim(), kind as ProviderProfile['kind'], normalizedUrl, model?.trim() || null, account, now, now);
    const safeHeaders = Object.fromEntries(Object.entries(headers).filter(([key, value]) => typeof value === 'string' && !/authorization|api[-_]?key|token|secret|cookie/i.test(key)));
    database.connection.prepare(`INSERT INTO provider_profile_options(profile_id,thinking_mode,headers_json,extra_body_json) VALUES (?,?,?,?)
      ON CONFLICT(profile_id) DO UPDATE SET thinking_mode=excluded.thinking_mode,headers_json=excluded.headers_json,extra_body_json=excluded.extra_body_json`)
      .run(id, thinkingMode, JSON.stringify(safeHeaders), JSON.stringify(extraBody));
    return reply.code(201).send({ id });
  });

  app.put<{ Params: { appId: string }; Body: { mode?: string; ttlDays?: number; maxBytes?: number } }>('/api/v1/admin/storage-policies/:appId', async (request, reply) => {
    const { mode, ttlDays, maxBytes } = request.body ?? {};
    if (!['keep', 'ttl', 'quota'].includes(mode ?? '')) return reply.code(400).send({ error: 'invalid_policy' });
    if (mode === 'ttl' && (!Number.isInteger(ttlDays) || (ttlDays ?? 0) < 1)) return reply.code(400).send({ error: 'invalid_ttl' });
    if (mode === 'quota' && (!Number.isInteger(maxBytes) || (maxBytes ?? 0) < 1)) return reply.code(400).send({ error: 'invalid_quota' });
    database.connection.prepare(`INSERT INTO storage_policies(app_id,mode,ttl_days,max_bytes) VALUES (?,?,?,?)
      ON CONFLICT(app_id) DO UPDATE SET mode=excluded.mode,ttl_days=excluded.ttl_days,max_bytes=excluded.max_bytes`)
      .run(request.params.appId, mode as 'keep' | 'ttl' | 'quota', ttlDays ?? null, maxBytes ?? null);
    return { ok: true };
  });

  app.get('/api/v1/admin/workflows', async () => ({
    items: database.connection.prepare('SELECT id,name,profile_id,created_at,updated_at FROM image_workflows ORDER BY name').all(),
  }));
  app.post<{ Body: { id?: string; name?: string; profileId?: string; definition?: Record<string, unknown> } }>('/api/v1/admin/workflows', async (request, reply) => {
    const { id, name, profileId, definition } = request.body ?? {};
    if (!id?.match(/^[a-z][a-z0-9-]{1,62}$/) || !name?.trim() || !definition || typeof definition !== 'object') return reply.code(400).send({ error: 'invalid_workflow' });
    const now = nowIso();
    database.connection.prepare(`INSERT INTO image_workflows VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,profile_id=excluded.profile_id,definition_json=excluded.definition_json,updated_at=excluded.updated_at`)
      .run(id, name.trim(), profileId?.trim() || null, JSON.stringify(definition), now, now);
    return reply.code(201).send({ id });
  });

  app.post<{ Body: { appId?: string; namespace?: string; access?: 'read' | 'write' } }>('/api/v1/admin/vector-grants', async (request, reply) => {
    const { appId, namespace, access } = request.body ?? {};
    if (!appId || !namespace?.startsWith('shared:') || !['read', 'write'].includes(access ?? '')) return reply.code(400).send({ error: 'invalid_grant' });
    database.connection.prepare('INSERT OR IGNORE INTO namespace_grants VALUES (?,?,?)').run(appId, namespace, access as 'read' | 'write');
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Body: { id?: string; displayName?: string; personaPrompt?: string; appearancePrompt?: string; tags?: string[]; source?: string; metadata?: Record<string, unknown> } }>('/api/v1/admin/personas', async (request, reply) => {
    const body = request.body ?? {};
    const id = body.id?.trim() || randomUUID();
    if (!body.displayName?.trim() || !body.personaPrompt?.trim()) return reply.code(400).send({ error: 'invalid_persona' });
    const now = nowIso();
    try {
      database.connection.prepare('INSERT INTO personas VALUES (?,?,?,?,?,?,?)')
        .run(id, body.displayName.trim(), JSON.stringify(body.tags ?? []), body.source?.trim() || null, 1, now, now);
      database.connection.prepare('INSERT INTO persona_versions VALUES (?,?,?,?,?,?,?,?)')
        .run(id, 1, body.displayName.trim(), body.personaPrompt.trim(), body.appearancePrompt?.trim() || null, null, JSON.stringify(body.metadata ?? {}), now);
    } catch {
      return reply.code(409).send({ error: 'persona_exists' });
    }
    return reply.code(201).send({ id, version: 1 });
  });

  app.post<{ Params: { id: string }; Body: { displayName?: string; personaPrompt?: string; appearancePrompt?: string; metadata?: Record<string, unknown> } }>('/api/v1/admin/personas/:id/versions', async (request, reply) => {
    const current = database.connection.prepare('SELECT display_name,latest_version FROM personas WHERE id=?').get(request.params.id) as { display_name: string; latest_version: number } | undefined;
    if (!current) return reply.code(404).send({ error: 'not_found' });
    if (!request.body?.personaPrompt?.trim()) return reply.code(400).send({ error: 'persona_prompt_required' });
    const version = current.latest_version + 1; const now = nowIso();
    database.connection.prepare('INSERT INTO persona_versions VALUES (?,?,?,?,?,?,?,?)')
      .run(request.params.id, version, request.body.displayName?.trim() || current.display_name, request.body.personaPrompt.trim(), request.body.appearancePrompt?.trim() || null, null, JSON.stringify(request.body.metadata ?? {}), now);
    database.connection.prepare('UPDATE personas SET latest_version=?,display_name=?,updated_at=? WHERE id=?')
      .run(version, request.body.displayName?.trim() || current.display_name, now, request.params.id);
    return reply.code(201).send({ id: request.params.id, version });
  });

  app.post<{ Body: { appId?: string; localId?: string; personaId?: string } }>('/api/v1/admin/personas/publish', async (request, reply) => {
    const { appId, localId } = request.body ?? {};
    if (!appId || !localId) return reply.code(400).send({ error: 'invalid_publish_request' });
    const local = database.connection.prepare('SELECT snapshot_json FROM app_personas WHERE app_id=? AND local_id=?').get(appId, localId) as { snapshot_json: string } | undefined;
    if (!local) return reply.code(404).send({ error: 'not_found' });
    const snapshot = JSON.parse(local.snapshot_json) as Record<string, unknown>;
    const id = request.body.personaId?.trim() || randomUUID(); const now = nowIso();
    database.connection.prepare('INSERT INTO personas VALUES (?,?,?,?,?,?,?)')
      .run(id, String(snapshot.display_name ?? '未命名角色'), '[]', `app:${appId}`, 1, now, now);
    database.connection.prepare('INSERT INTO persona_versions VALUES (?,?,?,?,?,?,?,?)')
      .run(id, 1, String(snapshot.display_name ?? '未命名角色'), String(snapshot.persona_prompt ?? ''), snapshot.appearance_prompt == null ? null : String(snapshot.appearance_prompt), snapshot.avatar_artifact_id == null ? null : String(snapshot.avatar_artifact_id), String(snapshot.metadata_json ?? '{}'), now);
    database.connection.prepare('UPDATE app_personas SET published_persona_id=? WHERE app_id=? AND local_id=?').run(id, appId, localId);
    return reply.code(201).send({ id, version: 1 });
  });
}

export { appRows, profileRows, personaRows };
