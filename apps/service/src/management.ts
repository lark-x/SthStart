import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { FastifyInstance } from 'fastify';
import type { AppLlmAssignment, GenerationWorker, LlmModelCapability, ManagedApp, PersonaTemplate, ProviderProfile, PublicCapability } from '@sthstart/contracts';
import { authenticateAdmin } from './access.js';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';
import { hashToken, issueToken, type SecretStore } from './security.js';
import { assertNoWorkflowSecrets, subscribeGenerationEvents, validateWorkflowVersionStructure } from './generation.js';
import { defaultWorkerSettings, workerHealth } from './worker.js';
import { getH3Status, readH3Settings } from './h3.js';
import { getMediaDiagnostics } from './media-diagnostics.js';

function appRows(database: ServiceDatabase): ManagedApp[] {
  const rows = database.connection.prepare('SELECT * FROM managed_apps ORDER BY created_at').all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id), name: String(row.name), enabled: Boolean(row.enabled),
    capabilities: JSON.parse(String(row.capabilities_json)) as PublicCapability[],
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }));
}

async function configuredH3WorkerToken(database: ServiceDatabase, secrets: SecretStore) {
  const workerUrl = readH3Settings().workerUrl;
  if (!workerUrl) return null;
  const row = database.connection.prepare(`
    SELECT credential_account FROM generation_engines
    WHERE kind='worker' AND rtrim(base_url, '/')=?
    LIMIT 1
  `).get(workerUrl) as { credential_account: string | null } | undefined;
  if (!row?.credential_account) return null;
  return (await secrets.get(row.credential_account)).value;
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

function jsonObject(value: unknown, fallback: Record<string, unknown> = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  return value as Record<string, unknown>;
}

function jsonArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
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

function parseWorkerAllowlist(raw: unknown): string[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 64) return null;
  const values: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') return null;
    const value = item.trim();
    const [address, prefix, ...extra] = value.split('/');
    const addressType = isIP(address);
    if (!address || !addressType || extra.length || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > (addressType === 4 ? 32 : 128)))) return null;
    values.push(value);
  }
  return [...new Set(values)];
}

function workerRows(database: ServiceDatabase): GenerationWorker[] {
  const rows = database.connection.prepare(`
    SELECT e.id,e.name,e.base_url,e.enabled,e.concurrency_limit,e.created_at,e.updated_at,
           w.model,w.temperature,w.ip_allowlist_json,w.disk_warning_bytes,w.disk_stop_bytes,w.last_seen_at
    FROM generation_engines e
    LEFT JOIN generation_workers w ON w.engine_id=e.id
    WHERE e.kind='worker'
    ORDER BY e.name
  `).all() as Array<Record<string, unknown>>;
  const defaults = defaultWorkerSettings();
  return rows.map((row) => {
    let ipAllowlist: string[] = [];
    try {
      const parsed = JSON.parse(String(row.ip_allowlist_json ?? '[]'));
      if (Array.isArray(parsed)) ipAllowlist = parsed.filter((item): item is string => typeof item === 'string');
    } catch {}
    const lastSeenAt = row.last_seen_at ? String(row.last_seen_at) : null;
    const lastSeenMs = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
    const state = Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs < 60_000 ? 'online' : lastSeenAt ? 'offline' : 'unknown';
    return {
      engineId: String(row.id),
      name: String(row.name),
      baseUrl: String(row.base_url),
      enabled: Boolean(row.enabled),
      model: String(row.model ?? defaults.model),
      temperature: Number.isFinite(Number(row.temperature)) ? Number(row.temperature) : defaults.temperature,
      concurrencyLimit: 1,
      ipAllowlist,
      diskWarningBytes: Number(row.disk_warning_bytes) || defaults.diskWarningBytes,
      diskStopBytes: Number(row.disk_stop_bytes) || defaults.diskStopBytes,
      state,
      lastSeenAt,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  });
}

function safeWorkerHealth(workerId: string, raw: Record<string, unknown>, settings: ReturnType<typeof defaultWorkerSettings>) {
  const disk = raw.disk && typeof raw.disk === 'object' && !Array.isArray(raw.disk) ? raw.disk as Record<string, unknown> : {};
  const numberOr = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  return {
    ok: Boolean(raw.ok ?? true),
    workerId: String(raw.workerId ?? workerId),
    ready: Boolean(raw.ready),
    model: String(raw.model ?? settings.model),
    temperature: numberOr(raw.temperature, settings.temperature),
    concurrency: 1 as const,
    queueDepth: Math.max(0, numberOr(raw.queueDepth, 0)),
    runningTaskId: typeof raw.runningTaskId === 'string' ? raw.runningTaskId : null,
    modelDirectoryReady: Boolean(raw.modelDirectoryReady ?? true),
    disk: {
      freeBytes: Math.max(0, numberOr(disk.freeBytes, 0)),
      tempBytes: Math.max(0, numberOr(disk.tempBytes, 0)),
      maxTempBytes: Math.max(0, numberOr(disk.maxTempBytes, settings.maxTempBytes)),
      warningBytes: settings.diskWarningBytes,
      stopBytes: settings.diskStopBytes,
    },
    capabilities: Array.isArray(raw.capabilities)
      ? raw.capabilities.filter((value): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value)).slice(0, 128)
      : undefined,
  };
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
    if (id === 'linshe' || id === 'creative-center') return reply.code(409).send({ error: 'system_app_reserved', message: '系统内置应用不能重复创建。' });
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
    if (request.params.id === 'linshe' || request.params.id === 'creative-center') return reply.code(409).send({ error: 'system_app_managed', message: '系统内置应用令牌由主服务自动管理。' });
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
    items: (database.connection.prepare(`SELECT e.id,e.name,e.kind,e.base_url,o.headers_json,e.enabled,e.concurrency_limit,e.created_at,e.updated_at
      FROM generation_engines e LEFT JOIN generation_engine_options o ON o.engine_id=e.id ORDER BY e.name`).all() as Record<string, unknown>[])
      .map((row) => ({ ...row, headers: JSON.parse(String(row.headers_json ?? '{}')), headers_json: undefined })),
  }));

  app.post<{
    Body: {
      id?: string;
      name?: string;
      kind?: 'comfyui' | 'worker' | 'cloud';
      baseUrl?: string;
      secret?: string;
      headers?: Record<string, string>;
      enabled?: boolean;
      concurrencyLimit?: number;
    };
  }>('/api/v1/admin/generation/engines', async (request, reply) => {
    const { id, name, kind = 'comfyui', baseUrl, secret, headers = {}, enabled = true, concurrencyLimit = 1 } = request.body ?? {};
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
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
      return reply.code(400).send({ error: 'invalid_engine_headers', message: '请求头必须是字符串键值对象。' });
    }

    const account = `engine:${id}`;
    const existingEngine = database.connection.prepare('SELECT credential_account FROM generation_engines WHERE id=?').get(id) as { credential_account: string | null } | undefined;
    if (secret) {
      try { await secrets.set(account, secret); }
      catch (err) { return reply.code(503).send({ error: 'keyring_unavailable', message: String(err) }); }
    }

    const now = nowIso();
    database.transaction(() => {
      database.connection.prepare(`
        INSERT INTO generation_engines (id, name, kind, base_url, credential_account, enabled, concurrency_limit, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, base_url=excluded.base_url,
        credential_account=excluded.credential_account, enabled=excluded.enabled, concurrency_limit=excluded.concurrency_limit, updated_at=excluded.updated_at
      `).run(id, name.trim(), kind, normalizedUrl, secret ? account : existingEngine?.credential_account ?? null, enabled ? 1 : 0, kind === 'worker' ? 1 : concurrencyLimit, now, now);
      database.connection.prepare(`INSERT INTO generation_engine_options(engine_id,headers_json) VALUES (?,?)
        ON CONFLICT(engine_id) DO UPDATE SET headers_json=excluded.headers_json`).run(id, JSON.stringify(safeHeaders(headers)));
    });

    if (kind === 'worker') {
      database.connection.prepare(`INSERT OR IGNORE INTO generation_workers
        (engine_id,model,temperature,ip_allowlist_json,disk_warning_bytes,disk_stop_bytes,created_at,updated_at)
        VALUES (?,?,?,? ,?,?,?,?)`).run(id, '', 0.7, '[]', 10 * 1024 * 1024 * 1024, 2 * 1024 * 1024 * 1024, now, now);
    }

    return reply.code(201).send({ id });
  });

  // ── Windows Worker Admin ──
  app.get('/api/v1/admin/workers', async () => ({ items: workerRows(database) }));

  app.post<{
    Body: {
      id?: string;
      name?: string;
      baseUrl?: string;
      token?: string;
      enabled?: boolean;
      model?: string;
      temperature?: number;
      ipAllowlist?: string[];
      diskWarningBytes?: number;
      diskStopBytes?: number;
    };
  }>('/api/v1/admin/workers', async (request, reply) => {
    const body = request.body ?? {};
    const id = body.id?.trim();
    const name = body.name?.trim();
    if (!id?.match(/^[a-z][a-z0-9-]{1,62}$/) || !name) return reply.code(400).send({ error: 'invalid_worker', message: 'Worker ID 和名称格式无效。' });

    let urlObj: URL;
    try { urlObj = new URL(body.baseUrl ?? ''); } catch { return reply.code(400).send({ error: 'invalid_url', message: '请提供有效的 Worker HTTP(S) 地址。' }); }
    if (!['http:', 'https:'].includes(urlObj.protocol) || urlObj.username || urlObj.password) return reply.code(400).send({ error: 'invalid_url', message: 'Worker 地址必须使用不带凭据的 HTTP 或 HTTPS 地址。' });
    const normalizedUrl = urlObj.toString().replace(/\/+$/, '');

    const allowlist = parseWorkerAllowlist(body.ipAllowlist);
    if (!allowlist) return reply.code(400).send({ error: 'invalid_ip_allowlist', message: 'IP 白名单必须是合法 IP 或 CIDR 数组。' });
    const temperature = body.temperature ?? 0.7;
    if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 2) return reply.code(400).send({ error: 'invalid_temperature', message: 'temperature 必须在 0 到 2 之间。' });
    const warningBytes = body.diskWarningBytes ?? defaultWorkerSettings().diskWarningBytes;
    const stopBytes = body.diskStopBytes ?? defaultWorkerSettings().diskStopBytes;
    if (![warningBytes, stopBytes].every((value) => typeof value === 'number' && Number.isInteger(value) && value > 0) || warningBytes < stopBytes) {
      return reply.code(400).send({ error: 'invalid_disk_thresholds', message: '磁盘警告阈值必须不小于停止阈值，且都必须为正整数。' });
    }
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return reply.code(400).send({ error: 'invalid_worker_enabled' });

    const account = `engine:${id}`;
    const existing = database.connection.prepare('SELECT credential_account FROM generation_engines WHERE id=? AND kind=\'worker\'').get(id) as { credential_account: string | null } | undefined;
    let returnedToken: string | null = null;
    const requestedToken = body.token?.trim();
    if (requestedToken && requestedToken.length < 32) return reply.code(400).send({ error: 'invalid_worker_token', message: 'Worker token 至少需要 32 个字符。' });
    const currentCredential = existing?.credential_account ? await secrets.get(existing.credential_account) : { value: null };
    const token = requestedToken || currentCredential.value || issueToken('sth_worker');
    if (requestedToken || !currentCredential.value) {
      try { await secrets.set(account, token); }
      catch (error) { return reply.code(503).send({ error: 'keyring_unavailable', message: String(error) }); }
      returnedToken = token;
    }

    const now = nowIso();
    try {
      database.transaction(() => {
        database.connection.prepare(`
          INSERT INTO generation_engines (id,name,kind,base_url,credential_account,enabled,concurrency_limit,created_at,updated_at)
          VALUES (?,?,?,?,?, ?,1,?,?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind='worker',base_url=excluded.base_url,
            credential_account=excluded.credential_account,enabled=excluded.enabled,concurrency_limit=1,updated_at=excluded.updated_at
        `).run(id, name, 'worker', normalizedUrl, account, body.enabled === false ? 0 : 1, now, now);
        database.connection.prepare(`
          INSERT INTO generation_workers (engine_id,model,temperature,ip_allowlist_json,disk_warning_bytes,disk_stop_bytes,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(engine_id) DO UPDATE SET model=excluded.model,temperature=excluded.temperature,
            ip_allowlist_json=excluded.ip_allowlist_json,disk_warning_bytes=excluded.disk_warning_bytes,
            disk_stop_bytes=excluded.disk_stop_bytes,updated_at=excluded.updated_at
        `).run(id, body.model?.trim() ?? '', temperature, JSON.stringify(allowlist), warningBytes, stopBytes, now, now);
      });
    } catch (error) {
      if (returnedToken && !existing) await secrets.delete(account).catch(() => undefined);
      return reply.code(409).send({ error: 'worker_save_failed', message: error instanceof Error ? error.message : String(error) });
    }
    return reply.code(201).send({ workerId: id, ...(returnedToken ? { token: returnedToken } : {}), item: workerRows(database).find((item) => item.engineId === id) });
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/workers/:id/rotate-token', async (request, reply) => {
    const row = database.connection.prepare('SELECT id FROM generation_engines WHERE id=? AND kind=\'worker\'').get(request.params.id) as { id: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'worker_not_found' });
    const token = issueToken('sth_worker');
    try { await secrets.set(`engine:${request.params.id}`, token); }
    catch (error) { return reply.code(503).send({ error: 'keyring_unavailable', message: String(error) }); }
    database.connection.prepare('UPDATE generation_engines SET credential_account=?,updated_at=? WHERE id=?').run(`engine:${request.params.id}`, nowIso(), request.params.id);
    return { workerId: request.params.id, token };
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/workers/:id/health', async (request, reply) => {
    const row = database.connection.prepare('SELECT id,base_url,credential_account FROM generation_engines WHERE id=? AND kind=\'worker\'').get(request.params.id) as { id: string; base_url: string; credential_account: string | null } | undefined;
    if (!row) return reply.code(404).send({ error: 'worker_not_found' });
    const settings = defaultWorkerSettings();
    const workerSettingsRow = database.connection.prepare('SELECT model,temperature,disk_warning_bytes,disk_stop_bytes FROM generation_workers WHERE engine_id=?').get(request.params.id) as { model: string; temperature: number; disk_warning_bytes: number; disk_stop_bytes: number } | undefined;
    if (workerSettingsRow) {
      settings.model = String(workerSettingsRow.model ?? '');
      if (Number.isFinite(Number(workerSettingsRow.temperature))) settings.temperature = Number(workerSettingsRow.temperature);
      if (Number.isFinite(Number(workerSettingsRow.disk_warning_bytes)) && Number(workerSettingsRow.disk_warning_bytes) > 0) settings.diskWarningBytes = Number(workerSettingsRow.disk_warning_bytes);
      if (Number.isFinite(Number(workerSettingsRow.disk_stop_bytes)) && Number(workerSettingsRow.disk_stop_bytes) > 0) settings.diskStopBytes = Number(workerSettingsRow.disk_stop_bytes);
    }
    const credential = row.credential_account ? await secrets.get(row.credential_account) : { value: null };
    if (!credential.value) return reply.code(503).send({ error: 'worker_token_missing', message: 'Windows Worker token 未配置。' });
    try {
      const raw = await workerHealth(String(row.base_url), credential.value, fetcher);
      const health = safeWorkerHealth(request.params.id, raw, settings);
      database.connection.prepare('UPDATE generation_workers SET last_seen_at=?,updated_at=? WHERE engine_id=?').run(nowIso(), nowIso(), request.params.id);
      return health;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(503).send({ error: 'worker_unavailable', message: message.slice(0, 300) });
    }
  });

  app.get('/api/v1/admin/experiments/h3/status', async () => getH3Status(fetcher, process.env, await configuredH3WorkerToken(database, secrets)));
  app.get('/api/v1/admin/media/diagnostics', async () => getMediaDiagnostics(fetcher, process.env, undefined, await configuredH3WorkerToken(database, secrets)));

  app.delete<{ Params: { id: string } }>('/api/v1/admin/generation/engines/:id', async (request, reply) => {
    const inUse = database.connection.prepare('SELECT 1 FROM app_generation_assignments WHERE engine_id = ?').get(request.params.id);
    if (inUse) return reply.code(409).send({ error: 'engine_in_use', message: '该生成引擎正被应用绑定使用，请先更换绑定。' });
    const engine = database.connection.prepare('SELECT kind,credential_account FROM generation_engines WHERE id=?').get(request.params.id) as { kind: string; credential_account: string | null } | undefined;
    database.connection.prepare('DELETE FROM generation_engines WHERE id = ?').run(request.params.id);
    if (engine?.credential_account) await secrets.delete(engine.credential_account).catch(() => undefined);
    return { ok: true };
  });

  // ── Generation Workflows & Versions Admin ──
  app.get('/api/v1/admin/generation/workflows', async () => {
    const workflows = database.connection.prepare('SELECT * FROM generation_workflows ORDER BY name').all() as Array<Record<string, unknown>>;
    const versions = database.connection.prepare('SELECT * FROM generation_workflow_versions ORDER BY version DESC').all() as Array<Record<string, unknown>>;
    const mediaVersions = database.connection.prepare('SELECT * FROM generation_workflow_media_versions').all() as Array<Record<string, unknown>>;
    return {
      items: workflows.map((wf) => ({
        ...wf,
        versions: versions.filter((v) => v.workflow_id === wf.id).map((v) => ({
          ...(() => {
            const media = mediaVersions.find((item) => item.workflow_id === v.workflow_id && Number(item.version) === Number(v.version));
            return {
              category: String(wf.category ?? media?.category ?? 'image'),
              inputCapabilities: jsonObject(v.input_capabilities_json ? JSON.parse(String(v.input_capabilities_json)) : media?.input_capabilities_json ? JSON.parse(String(media.input_capabilities_json)) : {}),
              outputMediaTypes: jsonArray(v.output_media_types_json ? JSON.parse(String(v.output_media_types_json)) : media?.output_media_types_json ? JSON.parse(String(media.output_media_types_json)) : [], []),
              outputSchema: jsonObject(v.output_schema_json ? JSON.parse(String(v.output_schema_json)) : media?.output_schema_json ? JSON.parse(String(media.output_schema_json)) : {}),
            };
          })(),
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
      category?: 'image' | 'video' | 'audio' | 'transform';
    };
  }>('/api/v1/admin/generation/workflows', async (request, reply) => {
    const { id, name, description = '', engineKind = 'comfyui', category = 'image' } = request.body ?? {};
    if (!id?.match(/^[a-z][a-z0-9-]{1,62}$/) || !name?.trim() || !['comfyui', 'worker', 'cloud'].includes(engineKind) || !['image', 'video', 'audio', 'transform'].includes(category)) {
      return reply.code(400).send({ error: 'invalid_workflow' });
    }
    const now = nowIso();
    database.connection.prepare(`
      INSERT INTO generation_workflows (id, name, description, engine_kind, category, latest_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, engine_kind=excluded.engine_kind, category=excluded.category, updated_at=excluded.updated_at
    `).run(id, name.trim(), description.trim(), engineKind, category, now, now);
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
      inputCapabilities?: Record<string, unknown>;
      outputMediaTypes?: string[];
      outputSchema?: Record<string, unknown>;
    };
  }>('/api/v1/admin/generation/workflows/:id/versions', async (request, reply) => {
    const wf = database.connection.prepare('SELECT * FROM generation_workflows WHERE id = ?').get(request.params.id) as { id: string; latest_version: number; engine_kind: string; category?: string } | undefined;
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
    const inputCapabilities = jsonObject(request.body?.inputCapabilities);
    const defaultOutputTypes = wf.category === 'video' ? ['video/mp4'] : wf.category === 'audio' ? ['audio/wav'] : ['image/png'];
    const outputMediaTypes = jsonArray(request.body?.outputMediaTypes, defaultOutputTypes);
    if (!outputMediaTypes.length || outputMediaTypes.some((value) => !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value))) {
      return reply.code(400).send({ error: 'invalid_output_media_types', message: 'outputMediaTypes 必须是非空 MIME 类型数组。' });
    }
    const outputSchema = jsonObject(request.body?.outputSchema);

    database.transaction(() => {
      database.connection.prepare(`
        INSERT INTO generation_workflow_versions (
          workflow_id, version, engine_id, input_schema_json, node_bindings_json,
          output_declarations_json, definition_json, input_capabilities_json,
          output_media_types_json, output_schema_json, is_published, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        request.params.id,
        version,
        targetEngineId,
        JSON.stringify(validated.validatedInputSchema),
        JSON.stringify(validated.validatedNodeBindings),
        JSON.stringify(validated.validatedOutputDeclarations),
        JSON.stringify(validated.validatedDefinition),
        JSON.stringify(inputCapabilities),
        JSON.stringify(outputMediaTypes),
        JSON.stringify(outputSchema),
        now,
      );
      database.connection.prepare(`
        INSERT INTO generation_workflow_media_versions
          (workflow_id, version, category, input_capabilities_json, output_media_types_json, output_schema_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workflow_id, version) DO UPDATE SET category=excluded.category,
          input_capabilities_json=excluded.input_capabilities_json,
          output_media_types_json=excluded.output_media_types_json,
          output_schema_json=excluded.output_schema_json,
          updated_at=excluded.updated_at
      `).run(request.params.id, version, wf.category ?? 'image', JSON.stringify(inputCapabilities), JSON.stringify(outputMediaTypes), JSON.stringify(outputSchema), now);
      database.connection.prepare('UPDATE generation_workflows SET latest_version = ?, updated_at = ? WHERE id = ?')
        .run(version, now, request.params.id);
    });

    return reply.code(201).send({ workflowId: request.params.id, version });
  });

  app.post<{
    Body: {
      id?: string;
      name?: string;
      description?: string;
      engineKind?: 'comfyui' | 'worker' | 'cloud';
      category?: 'image' | 'video' | 'audio' | 'transform';
      engineId?: string;
      inputSchema?: Record<string, unknown>;
      inputCapabilities?: Record<string, unknown>;
      nodeBindings?: Record<string, string[]>;
      outputDeclarations?: string[];
      outputMediaTypes?: string[];
      outputSchema?: Record<string, unknown>;
      definition?: unknown;
      workflow?: {
        id?: string;
        name?: string;
        description?: string;
        engineKind?: 'comfyui' | 'worker' | 'cloud';
        category?: 'image' | 'video' | 'audio' | 'transform';
      };
      version?: {
        engineId?: string;
        inputSchema?: Record<string, unknown>;
        inputCapabilities?: Record<string, unknown>;
        nodeBindings?: Record<string, string[]>;
        outputDeclarations?: string[];
        outputMediaTypes?: string[];
        outputSchema?: Record<string, unknown>;
        definition?: unknown;
      };
    };
  }>('/api/v1/admin/generation/workflows/import', async (request, reply) => {
    const rawBody = request.body;
    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return reply.code(400).send({ error: 'invalid_import_payload', message: '导入内容必须为有效的 JSON 对象。' });
    }

    try {
      assertNoWorkflowSecrets(rawBody);
    } catch (err) {
      const code = (err as { code?: string })?.code || 'secrets_not_permitted';
      return reply.code(400).send({ error: code, message: err instanceof Error ? err.message : String(err) });
    }

    const workflowObj = rawBody.workflow && typeof rawBody.workflow === 'object' && !Array.isArray(rawBody.workflow) ? rawBody.workflow as Record<string, unknown> : {};
    const versionObj = rawBody.version && typeof rawBody.version === 'object' && !Array.isArray(rawBody.version) ? rawBody.version as Record<string, unknown> : {};

    const rawId = typeof rawBody.id === 'string' ? rawBody.id : typeof workflowObj.id === 'string' ? workflowObj.id : '';
    const id = rawId.trim();
    if (!id || !/^[a-z][a-z0-9-]{1,62}$/.test(id)) {
      return reply.code(400).send({ error: 'invalid_workflow_id', message: '工作流 ID 必须由小写字母开头，由小写字母、数字和连字符组成（2-63 字符）。' });
    }

    const rawName = typeof rawBody.name === 'string' ? rawBody.name : typeof workflowObj.name === 'string' ? workflowObj.name : '';
    const name = rawName.trim();
    if (!name) {
      return reply.code(400).send({ error: 'workflow_name_required', message: '工作流名称必须为非空字符串。' });
    }

    const rawDescription = typeof rawBody.description === 'string' ? rawBody.description : typeof workflowObj.description === 'string' ? workflowObj.description : '';
    const description = rawDescription.trim();

    const rawEngineKind = typeof rawBody.engineKind === 'string' ? rawBody.engineKind : typeof workflowObj.engineKind === 'string' ? workflowObj.engineKind : 'comfyui';
    const engineKind = rawEngineKind as 'comfyui' | 'worker' | 'cloud';
    if (!['comfyui', 'worker', 'cloud'].includes(engineKind)) {
      return reply.code(400).send({ error: 'invalid_engine_kind', message: '引擎类型必须为 comfyui、worker 或 cloud。' });
    }

    const rawCategory = typeof rawBody.category === 'string' ? rawBody.category : typeof workflowObj.category === 'string' ? workflowObj.category : 'image';
    const category = rawCategory as 'image' | 'video' | 'audio' | 'transform';
    if (!['image', 'video', 'audio', 'transform'].includes(category)) {
      return reply.code(400).send({ error: 'invalid_category', message: '媒体类别必须为 image、video、audio 或 transform。' });
    }

    const targetEngineId = (typeof rawBody.engineId === 'string' ? rawBody.engineId : typeof versionObj.engineId === 'string' ? versionObj.engineId : '')?.trim() || null;
    if (targetEngineId) {
      const engine = database.connection.prepare('SELECT * FROM generation_engines WHERE id = ?').get(targetEngineId) as { id: string; kind: string } | undefined;
      if (!engine) {
        return reply.code(404).send({ error: 'engine_not_found', message: `指定的生成引擎 ${targetEngineId} 不存在。` });
      }
      if (engine.kind !== engineKind) {
        return reply.code(400).send({ error: 'engine_kind_mismatch', message: `生成引擎类型 (${engine.kind}) 与工作流类型 (${engineKind}) 不匹配。` });
      }
    }

    const definition = rawBody.definition ?? versionObj.definition;
    const inputSchema = rawBody.inputSchema ?? versionObj.inputSchema ?? {};
    const nodeBindings = rawBody.nodeBindings ?? versionObj.nodeBindings ?? {};
    const outputDeclarations = rawBody.outputDeclarations ?? versionObj.outputDeclarations ?? [];

    let validated: ReturnType<typeof validateWorkflowVersionStructure>;
    try {
      validated = validateWorkflowVersionStructure(definition, inputSchema, nodeBindings, outputDeclarations);
    } catch (err) {
      const code = (err as { code?: string })?.code || 'invalid_workflow_format';
      return reply.code(400).send({ error: code, message: err instanceof Error ? err.message : String(err) });
    }

    const existingWf = database.connection.prepare('SELECT * FROM generation_workflows WHERE id = ?').get(id) as { id: string; latest_version: number; engine_kind: string; category?: string } | undefined;
    const version = Number(existingWf?.latest_version ?? 0) + 1;
    const now = nowIso();
    const inputCapabilities = jsonObject(rawBody.inputCapabilities ?? versionObj.inputCapabilities);
    const defaultOutputTypes = category === 'video' ? ['video/mp4'] : category === 'audio' ? ['audio/wav'] : ['image/png'];
    const outputMediaTypes = jsonArray(rawBody.outputMediaTypes ?? versionObj.outputMediaTypes, defaultOutputTypes);
    if (!outputMediaTypes.length || outputMediaTypes.some((value) => !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value))) {
      return reply.code(400).send({ error: 'invalid_output_media_types', message: 'outputMediaTypes 必须是非空 MIME 类型数组。' });
    }
    const outputSchema = jsonObject(rawBody.outputSchema ?? versionObj.outputSchema);

    database.transaction(() => {
      database.connection.prepare(`
        INSERT INTO generation_workflows (id, name, description, engine_kind, category, latest_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, engine_kind=excluded.engine_kind, category=excluded.category, latest_version=excluded.latest_version, updated_at=excluded.updated_at
      `).run(id, name, description, engineKind, category, version, now, now);

      database.connection.prepare(`
        INSERT INTO generation_workflow_versions (
          workflow_id, version, engine_id, input_schema_json, node_bindings_json,
          output_declarations_json, definition_json, input_capabilities_json,
          output_media_types_json, output_schema_json, is_published, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        id,
        version,
        targetEngineId,
        JSON.stringify(validated.validatedInputSchema),
        JSON.stringify(validated.validatedNodeBindings),
        JSON.stringify(validated.validatedOutputDeclarations),
        JSON.stringify(validated.validatedDefinition),
        JSON.stringify(inputCapabilities),
        JSON.stringify(outputMediaTypes),
        JSON.stringify(outputSchema),
        now,
      );

      database.connection.prepare(`
        INSERT INTO generation_workflow_media_versions
          (workflow_id, version, category, input_capabilities_json, output_media_types_json, output_schema_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workflow_id, version) DO UPDATE SET category=excluded.category,
          input_capabilities_json=excluded.input_capabilities_json,
          output_media_types_json=excluded.output_media_types_json,
          output_schema_json=excluded.output_schema_json,
          updated_at=excluded.updated_at
      `).run(id, version, category, JSON.stringify(inputCapabilities), JSON.stringify(outputMediaTypes), JSON.stringify(outputSchema), now);
    });

    return reply.code(201).send({ ok: true, id, workflowId: id, version, category, engineKind });
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

  app.get<{ Querystring: { appId?: string; after?: string; once?: string } }>('/api/v1/admin/generation/events', async (request, reply) => {
    const appId = request.query.appId?.trim() || 'creative-center';
    if (!/^[a-z][a-z0-9-]{1,62}$/.test(appId)) return reply.code(400).send({ error: 'invalid_app_id' });
    const afterRaw = request.headers['last-event-id'] ?? request.query.after;
    const after = afterRaw == null ? null : Number.parseInt(String(afterRaw), 10);
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(': connected\n\n');
    const unsubscribe = subscribeGenerationEvents(database, appId, (event) => {
      reply.raw.write(`id: ${event.id}\nevent: ${event.eventType}\ndata: ${JSON.stringify({
        ...event.payload,
        taskId: event.taskId,
        appId: event.appId,
        eventType: event.eventType,
      })}\n\n`);
    }, Number.isFinite(after) ? after : null);
    if (request.query.once === 'true') {
      unsubscribe();
      reply.raw.end();
      return;
    }
    const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 15_000);
    request.raw.once('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}

export { appRows, profileRows, personaRows };
