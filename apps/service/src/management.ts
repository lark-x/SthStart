import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppLlmAssignment, LlmModelCapability, ManagedApp, PersonaTemplate, ProviderProfile, PublicCapability } from '@sthstart/contracts';
import { authenticateAdmin } from './access.js';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';
import { hashToken, issueToken, type SecretStore } from './security.js';
import { validateWorkflowVersionStructure } from './generation.js';

function appRows(database: ServiceDatabase): ManagedApp[] {
  const rows = database.connection.prepare('SELECT * FROM managed_apps ORDER BY created_at').all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id), name: String(row.name), enabled: Boolean(row.enabled),
    capabilities: JSON.parse(String(row.capabilities_json)) as PublicCapability[],
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }));
}

async function profileRows(database: ServiceDatabase, secrets: SecretStore): Promise<ProviderProfile[]> {
  const rows = database.connection.prepare(`SELECT p.*,o.thinking_mode,o.headers_json,o.extra_body_json,o.capabilities_json FROM provider_profiles p
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
      capabilities: JSON.parse(String(row.capabilities_json ?? (row.kind === 'llm' ? '["text"]' : '[]'))) as LlmModelCapability[],
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }));
}

function assignmentRows(database: ServiceDatabase): AppLlmAssignment[] {
  const rows = database.connection.prepare('SELECT app_id,role,profile_id,updated_at FROM app_llm_assignments').all() as Array<{ app_id: string; role: 'text' | 'multimodal'; profile_id: string; updated_at: string }>;
  return appRows(database).map((managedApp) => {
    const assigned = rows.filter((row) => row.app_id === managedApp.id);
    const updated = assigned.map((row) => row.updated_at).sort().at(-1) ?? null;
    return {
      appId: managedApp.id,
      textProfileId: assigned.find((row) => row.role === 'text')?.profile_id ?? null,
      multimodalProfileId: assigned.find((row) => row.role === 'multimodal')?.profile_id ?? null,
      updatedAt: updated,
    };
  });
}

function safeHeaders(headers: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(headers).filter(([key, value]) => typeof value === 'string' && !/authorization|api[-_]?key|token|secret|cookie/i.test(key))) as Record<string, string>;
}

function validCapabilities(kind: ProviderProfile['kind'], capabilities: unknown): LlmModelCapability[] | null {
  if (kind !== 'llm') return [];
  const values = capabilities === undefined ? ['text'] : capabilities;
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !['text', 'multimodal'].includes(String(value)))) return null;
  return [...new Set(values as LlmModelCapability[])];
}

function profileUsage(database: ServiceDatabase, profileId: string) {
  return database.connection.prepare(`SELECT a.app_id,m.name,a.role FROM app_llm_assignments a
    JOIN managed_apps m ON m.id=a.app_id WHERE a.profile_id=? ORDER BY m.name,a.role`).all(profileId) as Array<{ app_id: string; name: string; role: string }>;
}

function personaRows(database: ServiceDatabase): PersonaTemplate[] {
  const rows = database.connection.prepare('SELECT * FROM personas ORDER BY display_name').all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id), displayName: String(row.display_name), tags: JSON.parse(String(row.tags_json)) as string[],
    source: row.source ? String(row.source) : null, latestVersion: Number(row.latest_version),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }));
}

export function registerManagementRoutes(app: FastifyInstance, config: ServiceConfig, database: ServiceDatabase, secrets: SecretStore, fetcher: typeof fetch = fetch) {
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/v1/admin/')) return;
    if (!config.adminToken) return reply.code(503).send({ error: 'admin_not_configured', message: '请设置 STHSTART_ADMIN_TOKEN。' });
    if (!authenticateAdmin(config.adminToken, request)) return reply.code(401).send({ error: 'unauthorized' });
  });

  app.get('/api/v1/admin/overview', async () => ({
    keyring: await secrets.status(), apps: appRows(database),
    profiles: await profileRows(database, secrets), llmAssignments: assignmentRows(database), personas: personaRows(database),
  }));

  app.get('/api/v1/admin/apps', async () => ({ items: appRows(database) }));
  app.post<{ Body: { id?: string; name?: string; capabilities?: PublicCapability[] } }>('/api/v1/admin/apps', async (request, reply) => {
    const id = request.body?.id?.trim();
    const name = request.body?.name?.trim();
    const capabilities = request.body?.capabilities ?? ['llm', 'vector', 'image', 'artifact', 'persona', 'logs'];
    if (id === 'linshe') return reply.code(409).send({ error: 'system_app_reserved', message: 'linshe 是系统内置应用，不能重复创建。' });
    if (!id?.match(/^[a-z][a-z0-9-]{1,62}$/) || !name) return reply.code(400).send({ error: 'invalid_app' });
    const token = issueToken('sth_app');
    const now = nowIso();
    try {
      database.transaction(() => {
        database.connection.prepare('INSERT INTO managed_apps VALUES (?, ?, ?, ?, 1, ?, ?)')
          .run(id, name, hashToken(token), JSON.stringify(capabilities), now, now);
        database.connection.prepare("INSERT INTO storage_policies(app_id, mode) VALUES (?, 'keep')").run(id);
      });
    } catch {
      return reply.code(409).send({ error: 'app_exists' });
    }
    return reply.code(201).send({ id, name, enabled: true, capabilities, createdAt: now, updatedAt: now, token });
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/apps/:id/rotate-token', async (request, reply) => {
    if (request.params.id === 'linshe') return reply.code(409).send({ error: 'system_app_managed', message: '邻舍令牌由主服务自动管理。' });
    const token = issueToken('sth_app');
    const result = database.connection.prepare('UPDATE managed_apps SET token_hash = ?, updated_at = ? WHERE id = ?')
      .run(hashToken(token), nowIso(), request.params.id);
    if (!result.changes) return reply.code(404).send({ error: 'not_found' });
    return { id: request.params.id, token };
  });

  app.get('/api/v1/admin/profiles', async () => ({ items: await profileRows(database, secrets) }));
  app.post<{ Body: { id?: string; name?: string; kind?: ProviderProfile['kind']; baseUrl?: string; model?: string; secret?: string; enabled?: boolean; capabilities?: LlmModelCapability[]; thinkingMode?: ProviderProfile['thinkingMode']; headers?: Record<string, string>; extraBody?: Record<string, unknown> } }>('/api/v1/admin/profiles', async (request, reply) => {
    const { id, name, kind, baseUrl, model, secret, enabled = true, capabilities: rawCapabilities, thinkingMode = 'omit', headers = {}, extraBody = {} } = request.body ?? {};
    if (!id?.match(/^[a-z][a-z0-9-]{1,62}$/) || !name?.trim() || !['llm', 'vector', 'image'].includes(kind ?? '')) {
      return reply.code(400).send({ error: 'invalid_profile' });
    }
    if (kind === 'llm' && !model?.trim()) return reply.code(400).send({ error: 'model_required' });
    if (!['enabled', 'disabled', 'omit'].includes(thinkingMode) || !headers || typeof headers !== 'object' || Array.isArray(headers) || !extraBody || typeof extraBody !== 'object' || Array.isArray(extraBody)) return reply.code(400).send({ error: 'invalid_profile_options' });
    const capabilities = validCapabilities(kind as ProviderProfile['kind'], rawCapabilities);
    if (!capabilities || typeof enabled !== 'boolean') return reply.code(400).send({ error: 'invalid_profile_capabilities' });
    const usage = profileUsage(database, id);
    if (usage.length && (!enabled || kind !== 'llm' || usage.some((item) => !capabilities.includes(item.role as LlmModelCapability)))) return reply.code(409).send({ error: 'profile_in_use', message: '请先更换使用该模型的应用。' });
    let normalizedUrl: string;
    try { normalizedUrl = new URL(baseUrl ?? '').toString().replace(/\/$/, ''); } catch { return reply.code(400).send({ error: 'invalid_url' }); }
    const account = `profile:${id}`;
    if (secret) {
      try { await secrets.set(account, secret); } catch (error) { return reply.code(503).send({ error: 'keyring_unavailable', message: String(error) }); }
    }
    const now = nowIso();
    const filteredHeaders = safeHeaders(headers);
    database.transaction(() => {
      database.connection.prepare(`INSERT INTO provider_profiles
        (id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, base_url=excluded.base_url,
        model=excluded.model, credential_account=excluded.credential_account, enabled=excluded.enabled, updated_at=excluded.updated_at`)
        .run(id, name.trim(), kind as ProviderProfile['kind'], normalizedUrl, model?.trim() || null, account, enabled ? 1 : 0, now, now);
      database.connection.prepare(`INSERT INTO provider_profile_options(profile_id,thinking_mode,headers_json,extra_body_json,capabilities_json) VALUES (?,?,?,?,?)
        ON CONFLICT(profile_id) DO UPDATE SET thinking_mode=excluded.thinking_mode,headers_json=excluded.headers_json,extra_body_json=excluded.extra_body_json,capabilities_json=excluded.capabilities_json`)
        .run(id, thinkingMode, JSON.stringify(filteredHeaders), JSON.stringify(extraBody), JSON.stringify(capabilities));
    });
    return reply.code(201).send({ id });
  });

  app.post<{ Body: { profileId?: string; baseUrl?: string; secret?: string; headers?: Record<string, string> } }>('/api/v1/admin/llm/models/discover', async (request, reply) => {
    const body = request.body ?? {};
    let baseUrl = body.baseUrl?.trim() ?? '';
    let secret = body.secret?.trim() || null;
    let headers = safeHeaders(body.headers ?? {});
    if (body.profileId) {
      const row = database.connection.prepare(`SELECT p.id,p.base_url,p.credential_account,o.headers_json FROM provider_profiles p
        LEFT JOIN provider_profile_options o ON o.profile_id=p.id WHERE p.id=? AND p.kind='llm'`).get(body.profileId) as { id: string; base_url: string; credential_account: string | null; headers_json: string | null } | undefined;
      if (!row) return reply.code(404).send({ error: 'profile_not_found' });
      baseUrl = row.base_url;
      headers = JSON.parse(row.headers_json ?? '{}') as Record<string, string>;
      const credential = row.credential_account ? await secrets.get(row.credential_account, `STHSTART_SECRET_${row.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`) : { value: null };
      secret = credential.value;
    }
    if (body.baseUrl?.trim()) baseUrl = body.baseUrl.trim();
    if (body.headers) headers = safeHeaders(body.headers);
    if (body.secret?.trim()) secret = body.secret.trim();
    let endpoint: URL;
    try { endpoint = new URL(`${baseUrl.replace(/\/+$/, '')}/models`); if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error(); }
    catch { return reply.code(400).send({ error: 'invalid_url', message: '请填写有效的 HTTP(S) API 地址。' }); }
    try {
      const response = await fetcher(endpoint, { headers: { accept: 'application/json', ...(secret ? { authorization: `Bearer ${secret}` } : {}), ...headers }, signal: AbortSignal.timeout(15_000) });
      const payload = await response.json().catch(() => null) as { data?: unknown[]; models?: unknown[]; error?: { message?: string }; message?: string } | unknown[] | null;
      if (!response.ok) {
        const detail = !Array.isArray(payload) && payload ? payload.error?.message ?? payload.message : null;
        return reply.code(502).send({ error: 'model_discovery_failed', message: `模型列表请求失败：${String(detail ?? `HTTP ${response.status}`).slice(0, 300)}` });
      }
      const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
      const models = [...new Set(rows.map((item) => typeof item === 'string' ? item : item && typeof item === 'object' ? String((item as { id?: unknown; name?: unknown }).id ?? (item as { name?: unknown }).name ?? '') : '').filter(Boolean).map((id) => id.replace(/^models\//, '')))].sort((left, right) => left.localeCompare(right));
      if (!models.length) return reply.code(502).send({ error: 'empty_model_list', message: '接口未返回可识别的模型列表；仍可手动填写模型 ID。' });
      return { models, endpoint: endpoint.toString() };
    } catch (error) {
      const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return reply.code(502).send({ error: 'model_discovery_failed', message: timeout ? '获取模型列表超时。' : '无法连接模型服务。' });
    }
  });

  app.post<{ Params: { id: string }; Body: { id?: string; name?: string; model?: string; capabilities?: LlmModelCapability[] } }>('/api/v1/admin/profiles/:id/clone', async (request, reply) => {
    const targetId = request.body?.id?.trim();
    const targetName = request.body?.name?.trim();
    const model = request.body?.model?.trim();
    const capabilities = validCapabilities('llm', request.body?.capabilities);
    if (!targetId?.match(/^[a-z][a-z0-9-]{1,62}$/)) return reply.code(400).send({ error: 'invalid_clone_id', message: '副本配置 ID 必须以小写字母开头，只能包含小写字母、数字和连字符，长度为 2～63 个字符。' });
    if (!targetName) return reply.code(400).send({ error: 'clone_name_required', message: '请填写副本显示名称。' });
    if (!model) return reply.code(400).send({ error: 'clone_model_required', message: '请选择或填写副本使用的模型 ID。' });
    if (!capabilities) return reply.code(400).send({ error: 'invalid_clone_capabilities', message: '请至少选择一个有效的模型能力标签。' });
    if (database.connection.prepare('SELECT 1 FROM provider_profiles WHERE id=?').get(targetId)) return reply.code(409).send({ error: 'profile_exists' });
    const source = database.connection.prepare(`SELECT p.*,o.thinking_mode,o.headers_json,o.extra_body_json FROM provider_profiles p
      LEFT JOIN provider_profile_options o ON o.profile_id=p.id WHERE p.id=? AND p.kind='llm'`).get(request.params.id) as Record<string, unknown> | undefined;
    if (!source) return reply.code(404).send({ error: 'profile_not_found' });
    const sourceAccount = source.credential_account ? String(source.credential_account) : '';
    const credential = sourceAccount ? await secrets.get(sourceAccount, `STHSTART_SECRET_${request.params.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`) : { value: null };
    const targetAccount = `profile:${targetId}`;
    if (credential.value) {
      try { await secrets.set(targetAccount, credential.value); }
      catch { return reply.code(503).send({ error: 'independent_credential_unavailable', message: '系统凭据库不可用，无法创建独立的 API Key 副本。' }); }
    }
    const now = nowIso();
    try {
      database.transaction(() => {
        database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)').run(targetId, targetName, 'llm', String(source.base_url), model, targetAccount, now, now);
        database.connection.prepare('INSERT INTO provider_profile_options(profile_id,thinking_mode,headers_json,extra_body_json,capabilities_json) VALUES (?,?,?,?,?)')
          .run(targetId, String(source.thinking_mode ?? 'omit'), String(source.headers_json ?? '{}'), String(source.extra_body_json ?? '{}'), JSON.stringify(capabilities));
      });
    } catch (error) {
      if (credential.value) await secrets.delete(targetAccount).catch(() => undefined);
      throw error;
    }
    return reply.code(201).send({ id: targetId });
  });

  app.delete<{ Params: { id: string } }>('/api/v1/admin/profiles/:id', async (request, reply) => {
    const usage = profileUsage(database, request.params.id);
    if (usage.length) return reply.code(409).send({ error: 'profile_in_use', message: '请先更换使用该模型的应用。', apps: usage });
    const row = database.connection.prepare('SELECT credential_account FROM provider_profiles WHERE id=?').get(request.params.id) as { credential_account: string | null } | undefined;
    if (!row) return reply.code(404).send({ error: 'profile_not_found' });
    database.connection.prepare('DELETE FROM provider_profiles WHERE id=?').run(request.params.id);
    if (row.credential_account) await secrets.delete(row.credential_account).catch(() => undefined);
    return { ok: true };
  });

  app.put<{ Params: { appId: string }; Body: { textProfileId?: string | null; multimodalProfileId?: string | null } }>('/api/v1/admin/apps/:appId/llm-assignments', async (request, reply) => {
    if (!database.connection.prepare('SELECT 1 FROM managed_apps WHERE id=?').get(request.params.appId)) return reply.code(404).send({ error: 'app_not_found' });
    const requested = [['text', request.body?.textProfileId], ['multimodal', request.body?.multimodalProfileId]] as const;
    for (const [role, profileId] of requested) {
      if (!profileId) continue;
      const row = database.connection.prepare(`SELECT p.model,o.capabilities_json FROM provider_profiles p JOIN provider_profile_options o ON o.profile_id=p.id
        WHERE p.id=? AND p.kind='llm' AND p.enabled=1`).get(profileId) as { model: string | null; capabilities_json: string } | undefined;
      if (!row?.model || !(JSON.parse(row.capabilities_json) as string[]).includes(role)) return reply.code(400).send({ error: 'profile_capability_mismatch', role, profileId });
    }
    const now = nowIso();
    database.transaction(() => {
      for (const [role, profileId] of requested) {
        if (!profileId) database.connection.prepare('DELETE FROM app_llm_assignments WHERE app_id=? AND role=?').run(request.params.appId, role);
        else database.connection.prepare(`INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES (?,?,?,?)
          ON CONFLICT(app_id,role) DO UPDATE SET profile_id=excluded.profile_id,updated_at=excluded.updated_at`).run(request.params.appId, role, profileId, now);
      }
    });
    return { appId: request.params.appId, textProfileId: request.body?.textProfileId ?? null, multimodalProfileId: request.body?.multimodalProfileId ?? null, updatedAt: now };
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
    const displayName = body.displayName.trim();
    const personaPrompt = body.personaPrompt.trim();
    const now = nowIso();
    try {
      database.transaction(() => {
        database.connection.prepare('INSERT INTO personas VALUES (?,?,?,?,?,?,?)')
          .run(id, displayName, JSON.stringify(body.tags ?? []), body.source?.trim() || null, 1, now, now);
        database.connection.prepare('INSERT INTO persona_versions VALUES (?,?,?,?,?,?,?,?)')
          .run(id, 1, displayName, personaPrompt, body.appearancePrompt?.trim() || null, null, JSON.stringify(body.metadata ?? {}), now);
      });
    } catch {
      return reply.code(409).send({ error: 'persona_exists' });
    }
    return reply.code(201).send({ id, version: 1 });
  });

  app.post<{ Params: { id: string }; Body: { displayName?: string; personaPrompt?: string; appearancePrompt?: string; metadata?: Record<string, unknown> } }>('/api/v1/admin/personas/:id/versions', async (request, reply) => {
    const current = database.connection.prepare('SELECT display_name,latest_version FROM personas WHERE id=?').get(request.params.id) as { display_name: string; latest_version: number } | undefined;
    if (!current) return reply.code(404).send({ error: 'not_found' });
    if (!request.body?.personaPrompt?.trim()) return reply.code(400).send({ error: 'persona_prompt_required' });
    const personaPrompt = request.body.personaPrompt.trim();
    const version = current.latest_version + 1; const now = nowIso();
    database.transaction(() => {
      database.connection.prepare('INSERT INTO persona_versions VALUES (?,?,?,?,?,?,?,?)')
        .run(request.params.id, version, request.body.displayName?.trim() || current.display_name, personaPrompt, request.body.appearancePrompt?.trim() || null, null, JSON.stringify(request.body.metadata ?? {}), now);
      database.connection.prepare('UPDATE personas SET latest_version=?,display_name=?,updated_at=? WHERE id=?')
        .run(version, request.body.displayName?.trim() || current.display_name, now, request.params.id);
    });
    return reply.code(201).send({ id: request.params.id, version });
  });

  app.post<{ Body: { appId?: string; localId?: string; personaId?: string } }>('/api/v1/admin/personas/publish', async (request, reply) => {
    const { appId, localId } = request.body ?? {};
    if (!appId || !localId) return reply.code(400).send({ error: 'invalid_publish_request' });
    const local = database.connection.prepare('SELECT snapshot_json FROM app_personas WHERE app_id=? AND local_id=?').get(appId, localId) as { snapshot_json: string } | undefined;
    if (!local) return reply.code(404).send({ error: 'not_found' });
    const snapshot = JSON.parse(local.snapshot_json) as Record<string, unknown>;
    const id = request.body.personaId?.trim() || randomUUID(); const now = nowIso();
    database.transaction(() => {
      database.connection.prepare('INSERT INTO personas VALUES (?,?,?,?,?,?,?)')
        .run(id, String(snapshot.display_name ?? '未命名角色'), '[]', `app:${appId}`, 1, now, now);
      database.connection.prepare('INSERT INTO persona_versions VALUES (?,?,?,?,?,?,?,?)')
        .run(id, 1, String(snapshot.display_name ?? '未命名角色'), String(snapshot.persona_prompt ?? ''), snapshot.appearance_prompt == null ? null : String(snapshot.appearance_prompt), snapshot.avatar_artifact_id == null ? null : String(snapshot.avatar_artifact_id), String(snapshot.metadata_json ?? '{}'), now);
      database.connection.prepare('UPDATE app_personas SET published_persona_id=? WHERE app_id=? AND local_id=?').run(id, appId, localId);
    });
    return reply.code(201).send({ id, version: 1 });
  });

  // ── Generation Engines Admin ──
  app.get('/api/v1/admin/generation/engines', async () => ({
    items: database.connection.prepare('SELECT id, name, kind, base_url, enabled, concurrency_limit, created_at, updated_at FROM generation_engines ORDER BY name').all(),
  }));

  app.post<{
    Body: {
      id?: string;
      name?: string;
      kind?: 'comfyui' | 'worker' | 'cloud';
      baseUrl?: string;
      secret?: string;
      enabled?: boolean;
      concurrencyLimit?: number;
    };
  }>('/api/v1/admin/generation/engines', async (request, reply) => {
    const { id, name, kind = 'comfyui', baseUrl, secret, enabled = true, concurrencyLimit = 1 } = request.body ?? {};
    if (!id?.match(/^[a-z][a-z0-9-]{1,62}$/) || !name?.trim() || !['comfyui', 'worker', 'cloud'].includes(kind)) {
      return reply.code(400).send({ error: 'invalid_engine' });
    }
    let urlObj: URL;
    try {
      urlObj = new URL(baseUrl ?? '');
    } catch {
      return reply.code(400).send({ error: 'invalid_url', message: '请提供有效的 HTTP(S) 地址。' });
    }
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return reply.code(400).send({ error: 'invalid_url', message: '生成引擎地址必须使用 HTTP 或 HTTPS 协议。' });
    }
    const normalizedUrl = urlObj.toString().replace(/\/+$/, '');

    if (typeof concurrencyLimit !== 'number' || !Number.isInteger(concurrencyLimit) || concurrencyLimit < 1) {
      return reply.code(400).send({ error: 'invalid_concurrency_limit', message: '并发限制 concurrencyLimit 必须为大于等于 1 的正整数。' });
    }

    const account = `engine:${id}`;
    if (secret) {
      try { await secrets.set(account, secret); }
      catch (err) { return reply.code(503).send({ error: 'keyring_unavailable', message: String(err) }); }
    }

    const now = nowIso();
    database.connection.prepare(`
      INSERT INTO generation_engines (id, name, kind, base_url, credential_account, enabled, concurrency_limit, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, base_url=excluded.base_url,
      credential_account=excluded.credential_account, enabled=excluded.enabled, concurrency_limit=excluded.concurrency_limit, updated_at=excluded.updated_at
    `).run(id, name.trim(), kind, normalizedUrl, secret ? account : null, enabled ? 1 : 0, concurrencyLimit, now, now);

    return reply.code(201).send({ id });
  });

  app.delete<{ Params: { id: string } }>('/api/v1/admin/generation/engines/:id', async (request, reply) => {
    const inUse = database.connection.prepare('SELECT 1 FROM app_generation_assignments WHERE engine_id = ?').get(request.params.id);
    if (inUse) return reply.code(409).send({ error: 'engine_in_use', message: '该生成引擎正被应用绑定使用，请先更换绑定。' });
    database.connection.prepare('DELETE FROM generation_engines WHERE id = ?').run(request.params.id);
    return { ok: true };
  });

  // ── Generation Workflows & Versions Admin ──
  app.get('/api/v1/admin/generation/workflows', async () => {
    const workflows = database.connection.prepare('SELECT * FROM generation_workflows ORDER BY name').all() as Array<Record<string, unknown>>;
    const versions = database.connection.prepare('SELECT * FROM generation_workflow_versions ORDER BY version DESC').all() as Array<Record<string, unknown>>;
    return {
      items: workflows.map((wf) => ({
        ...wf,
        versions: versions.filter((v) => v.workflow_id === wf.id).map((v) => ({
          version: v.version,
          engineId: v.engine_id,
          inputSchema: JSON.parse(String(v.input_schema_json ?? '{}')),
          nodeBindings: JSON.parse(String(v.node_bindings_json ?? '{}')),
          outputDeclarations: JSON.parse(String(v.output_declarations_json ?? '[]')),
          isPublished: Boolean(v.is_published),
          createdAt: v.created_at,
        })),
      })),
    };
  });

  app.post<{
    Body: {
      id?: string;
      name?: string;
      description?: string;
      engineKind?: 'comfyui' | 'worker' | 'cloud';
    };
  }>('/api/v1/admin/generation/workflows', async (request, reply) => {
    const { id, name, description = '', engineKind = 'comfyui' } = request.body ?? {};
    if (!id?.match(/^[a-z][a-z0-9-]{1,62}$/) || !name?.trim() || !['comfyui', 'worker', 'cloud'].includes(engineKind)) {
      return reply.code(400).send({ error: 'invalid_workflow' });
    }
    const now = nowIso();
    database.connection.prepare(`
      INSERT INTO generation_workflows (id, name, description, engine_kind, latest_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, updated_at=excluded.updated_at
    `).run(id, name.trim(), description.trim(), engineKind, now, now);
    return reply.code(201).send({ id });
  });

  app.post<{
    Params: { id: string };
    Body: {
      engineId?: string;
      inputSchema?: Record<string, unknown>;
      nodeBindings?: Record<string, string[]>;
      outputDeclarations?: string[];
      definition?: unknown;
    };
  }>('/api/v1/admin/generation/workflows/:id/versions', async (request, reply) => {
    const wf = database.connection.prepare('SELECT * FROM generation_workflows WHERE id = ?').get(request.params.id) as { id: string; latest_version: number; engine_kind: string } | undefined;
    if (!wf) return reply.code(404).send({ error: 'workflow_not_found', message: '指定的工作流不存在。' });

    const targetEngineId = request.body?.engineId?.trim() || null;
    if (targetEngineId) {
      const engine = database.connection.prepare('SELECT * FROM generation_engines WHERE id = ?').get(targetEngineId) as { id: string; kind: string } | undefined;
      if (!engine) {
        return reply.code(404).send({ error: 'engine_not_found', message: `指定的生成引擎 ${targetEngineId} 不存在。` });
      }
      if (engine.kind !== wf.engine_kind) {
        return reply.code(400).send({ error: 'engine_kind_mismatch', message: `生成引擎类型 (${engine.kind}) 与工作流类型 (${wf.engine_kind}) 不匹配。` });
      }
    }

    let validated: ReturnType<typeof validateWorkflowVersionStructure>;
    try {
      validated = validateWorkflowVersionStructure(
        request.body?.definition,
        request.body?.inputSchema ?? {},
        request.body?.nodeBindings ?? {},
        request.body?.outputDeclarations ?? [],
      );
    } catch (err) {
      const code = (err as { code?: string })?.code || 'invalid_workflow_format';
      return reply.code(400).send({ error: code, message: err instanceof Error ? err.message : String(err) });
    }

    const version = Number(wf.latest_version) + 1;
    const now = nowIso();

    database.transaction(() => {
      database.connection.prepare(`
        INSERT INTO generation_workflow_versions (
          workflow_id, version, engine_id, input_schema_json, node_bindings_json,
          output_declarations_json, definition_json, is_published, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        request.params.id,
        version,
        targetEngineId,
        JSON.stringify(validated.validatedInputSchema),
        JSON.stringify(validated.validatedNodeBindings),
        JSON.stringify(validated.validatedOutputDeclarations),
        JSON.stringify(validated.validatedDefinition),
        now,
      );
      database.connection.prepare('UPDATE generation_workflows SET latest_version = ?, updated_at = ? WHERE id = ?')
        .run(version, now, request.params.id);
    });

    return reply.code(201).send({ workflowId: request.params.id, version });
  });

  // ── Generation Assignments Admin ──
  app.get('/api/v1/admin/generation/assignments', async () => ({
    items: database.connection.prepare('SELECT * FROM app_generation_assignments').all(),
  }));

  app.put<{
    Params: { appId: string };
    Body: {
      assignments: Array<{
        purpose: string;
        workflowId: string;
        workflowVersion?: number;
        engineId: string;
      }>;
    };
  }>('/api/v1/admin/apps/:appId/generation-assignments', async (request, reply) => {
    const appRow = database.connection.prepare('SELECT 1 FROM managed_apps WHERE id = ?').get(request.params.appId);
    if (!appRow) return reply.code(404).send({ error: 'app_not_found', message: '目标应用不存在。' });

    const list = Array.isArray(request.body?.assignments) ? request.body.assignments : [];
    const validatedItems: Array<{ purpose: string; workflowId: string; workflowVersion: number; engineId: string }> = [];

    for (const item of list) {
      if (!item.purpose || typeof item.purpose !== 'string' || !item.purpose.trim()) {
        return reply.code(400).send({ error: 'invalid_assignment', message: '用途 purpose 必须为非空字符串。' });
      }
      if (!item.workflowId || typeof item.workflowId !== 'string' || !item.workflowId.trim()) {
        return reply.code(400).send({ error: 'invalid_assignment', message: '工作流 ID 必须为非空字符串。' });
      }
      if (!item.engineId || typeof item.engineId !== 'string' || !item.engineId.trim()) {
        return reply.code(400).send({ error: 'invalid_assignment', message: '生成引擎 ID 必须为非空字符串。' });
      }

      const wf = database.connection.prepare('SELECT * FROM generation_workflows WHERE id = ?').get(item.workflowId.trim()) as { id: string; engine_kind: string; latest_version: number } | undefined;
      if (!wf) {
        return reply.code(404).send({ error: 'workflow_not_found', message: `未找到工作流 ${item.workflowId}。` });
      }

      const verNum = item.workflowVersion ?? wf.latest_version;
      const ver = database.connection.prepare(
        'SELECT * FROM generation_workflow_versions WHERE workflow_id = ? AND version = ? AND is_published = 1',
      ).get(item.workflowId.trim(), verNum);
      if (!ver) {
        return reply.code(404).send({ error: 'workflow_version_not_found', message: `未找到工作流 ${item.workflowId} 的已发布版本 v${verNum}。` });
      }

      const engine = database.connection.prepare('SELECT * FROM generation_engines WHERE id = ? AND enabled = 1').get(item.engineId.trim()) as { id: string; kind: string } | undefined;
      if (!engine) {
        return reply.code(404).send({ error: 'generation_engine_unavailable', message: `生成引擎 ${item.engineId} 不存在或处于禁用状态。` });
      }

      if (engine.kind !== wf.engine_kind) {
        return reply.code(400).send({ error: 'engine_kind_mismatch', message: `生成引擎类型 (${engine.kind}) 与工作流类型 (${wf.engine_kind}) 不匹配。` });
      }

      validatedItems.push({
        purpose: item.purpose.trim(),
        workflowId: item.workflowId.trim(),
        workflowVersion: verNum,
        engineId: item.engineId.trim(),
      });
    }

    const now = nowIso();
    database.transaction(() => {
      database.connection.prepare('DELETE FROM app_generation_assignments WHERE app_id = ?').run(request.params.appId);
      for (const item of validatedItems) {
        database.connection.prepare(`
          INSERT INTO app_generation_assignments (app_id, purpose, workflow_id, workflow_version, engine_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(request.params.appId, item.purpose, item.workflowId, item.workflowVersion, item.engineId, now);
      }
    });

    return {
      appId: request.params.appId,
      assignments: database.connection.prepare('SELECT * FROM app_generation_assignments WHERE app_id = ?').all(request.params.appId),
    };
  });
}

export { appRows, profileRows, personaRows };
