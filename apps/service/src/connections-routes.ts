import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { ConnectionTestResult, DiscoveredModelList, PurposeBinding, ServiceConnection, ServiceConnectionKind } from '@sthstart/contracts';
import { authenticateAdmin } from './access.js';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';
import type { SecretStore } from './security.js';
import { upstreamHeaders } from './providers.js';

function safeHeaders(headers: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([key, value]) => typeof value === 'string' && !/authorization|api[-_]?key|token|secret|cookie/i.test(key),
    ),
  ) as Record<string, string>;
}

function connectionSecretAccount(connectionId: string) {
  return `conn:${connectionId}`;
}

export async function hydrateConnection(
  row: Record<string, unknown>,
  secrets: SecretStore,
): Promise<ServiceConnection> {
  const account = row.credential_account ? String(row.credential_account) : '';
  const envFallback = `STHSTART_SECRET_${String(row.id).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const credential = account ? await secrets.get(account, envFallback) : { value: null, source: 'none' as const };

  return {
    id: String(row.id),
    name: String(row.name),
    kind: row.kind as ServiceConnectionKind,
    baseUrl: String(row.base_url),
    credentialAccount: row.credential_account ? String(row.credential_account) : null,
    hasCredential: Boolean(credential.value),
    credentialSource: credential.source,
    timeoutMs: Number(row.timeout_ms ?? 60000),
    headers: JSON.parse(String(row.headers_json ?? '{}')) as Record<string, string>,
    options: JSON.parse(String(row.options_json ?? '{}')) as Record<string, unknown>,
    enabled: Boolean(row.enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function registerConnectionRoutes(
  app: FastifyInstance,
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  fetcher: typeof fetch = fetch,
) {
  const checkAdmin = (request: FastifyRequest, reply: FastifyReply) => {
    if (!authenticateAdmin(config.adminToken, request)) {
      void reply.code(401).send({ error: 'unauthorized', message: '需要管理员凭据喵。' });
      return false;
    }
    return true;
  };

  // 1. 获取所有连接
  app.get('/api/v1/admin/connections', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const rows = database.connection.prepare(
      'SELECT * FROM service_connections ORDER BY name COLLATE NOCASE',
    ).all() as Record<string, unknown>[];
    const items = await Promise.all(rows.map((row) => hydrateConnection(row, secrets)));
    return { items };
  });

  // 2. 获取单个连接
  app.get<{ Params: { id: string } }>('/api/v1/admin/connections/:id', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const row = database.connection.prepare('SELECT * FROM service_connections WHERE id = ?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: 'connection_not_found', message: '连接不存在喵。' });
    return hydrateConnection(row, secrets);
  });

  // 3. 创建或更新连接
  app.post<{
    Body: {
      id?: string;
      name?: string;
      kind?: ServiceConnectionKind;
      baseUrl?: string;
      secret?: string;
      timeoutMs?: number;
      headers?: Record<string, unknown>;
      options?: Record<string, unknown>;
      enabled?: boolean;
    };
  }>('/api/v1/admin/connections', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const body = request.body ?? {};
    const id = typeof body.id === 'string' ? body.id.trim() : undefined;
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    const kind = body.kind;
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : undefined;


    if (!id || !/^[a-z][a-z0-9_-]{1,62}$/.test(id)) {
      return reply.code(400).send({ error: 'invalid_connection_id', message: '连接 ID 必须以小写字母开头，2-63 位字母、数字、下划线或连字符喵。' });
    }
    if (!name) return reply.code(400).send({ error: 'name_required', message: '请填写连接名称喵。' });
    if (!kind || !['openai-compatible-text', 'openai-compatible-image', 'comfyui', 'worker', 'vector'].includes(kind)) {
      return reply.code(400).send({ error: 'invalid_connection_kind', message: '不支持的连接类型喵。' });
    }

    let normalizedUrl: string;
    try {
      const url = new URL(baseUrl ?? '');
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid_url');
      normalizedUrl = url.toString().replace(/\/$/, '');
    } catch {
      return reply.code(400).send({ error: 'invalid_url', message: '请填写有效的 Base URL 喵。' });
    }

    const existing = database.connection.prepare(
      'SELECT * FROM service_connections WHERE id = ?'
    ).get(id) as Record<string, unknown> | undefined;

    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return reply.code(400).send({ error: 'invalid_enabled' });
    const enabled = body.enabled ?? (existing ? Boolean(existing.enabled) : true);
    const timeoutMs = body.timeoutMs ?? Number(existing?.timeout_ms ?? 60000);
    if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) {
      return reply.code(400).send({ error: 'invalid_timeout', message: '超时时间应为 1000–600000 毫秒。' });
    }
    for (const value of [body.headers, body.options]) {
      if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
        return reply.code(400).send({ error: 'invalid_options', message: 'headers 和 options 必须是 JSON 对象。' });
      }
    }
    const headers = safeHeaders(body.headers ?? JSON.parse(String(existing?.headers_json ?? '{}')));
    const options = body.options ?? JSON.parse(String(existing?.options_json ?? '{}'));
    let account = existing?.credential_account ? String(existing.credential_account) : connectionSecretAccount(id);
    let secretWarning: string | null = null;
    if (typeof body.secret === 'string' && body.secret.trim()) {
      const replacementAccount = connectionSecretAccount(id);
      try {
        await secrets.set(replacementAccount, body.secret.trim());
        account = replacementAccount;
      } catch (err) {
        secretWarning = `连接配置已保存，但密钥未能写入凭据库：${err instanceof Error ? err.message : String(err)}喵。`;
      }
    }

    const now = nowIso();
    database.transaction(() => {
      database.connection.prepare(`
        INSERT INTO service_connections (id, name, kind, base_url, credential_account, timeout_ms, headers_json, options_json, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          kind = excluded.kind,
          base_url = excluded.base_url,
          credential_account = excluded.credential_account,
          timeout_ms = excluded.timeout_ms,
          headers_json = excluded.headers_json,
          options_json = excluded.options_json,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `).run(id, name, kind, normalizedUrl, account, timeoutMs, JSON.stringify(headers), JSON.stringify(options), enabled ? 1 : 0, now, now);

      // 同步更新 provider_profiles 中绑定到该连接的模型 base_url 与启用状态
      database.connection.prepare(`
        UPDATE provider_profiles
        SET base_url = ?, credential_account = ?,
            enabled = CASE WHEN ? = 1 THEN (SELECT enabled FROM model_profiles WHERE id = provider_profiles.id) ELSE 0 END, updated_at = ?
        WHERE id IN (SELECT id FROM model_profiles WHERE connection_id = ?)
      `).run(normalizedUrl, account, enabled ? 1 : 0, now, id);

      database.connection.prepare(`
        UPDATE provider_profile_options SET headers_json = ?
        WHERE profile_id IN (SELECT id FROM model_profiles WHERE connection_id = ?)
      `).run(JSON.stringify(headers), id);
      const models = database.connection.prepare('SELECT id, default_params_json, advanced_json FROM model_profiles WHERE connection_id = ?').all(id) as Array<{ id: string; default_params_json: string; advanced_json: string }>;
      for (const model of models) {
        database.connection.prepare('UPDATE provider_profile_options SET extra_body_json = ? WHERE profile_id = ?')
          .run(JSON.stringify({ ...options, ...JSON.parse(model.default_params_json), ...JSON.parse(model.advanced_json) }), model.id);
      }
    });

    return reply.code(201).send({ id, secretStored: secretWarning === null, warning: secretWarning });
  });

  // 4. 删除连接
  app.delete<{ Params: { id: string } }>('/api/v1/admin/connections/:id', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const modelsCount = (database.connection.prepare(
      'SELECT count(*) as count FROM model_profiles WHERE connection_id = ?',
    ).get(request.params.id) as { count: number }).count;

    if (modelsCount > 0) {
      return reply.code(409).send({ error: 'connection_in_use', message: `该连接下仍有 ${modelsCount} 个关联模型，请先解绑或删除模型喵。` });
    }

    const row = database.connection.prepare('SELECT credential_account FROM service_connections WHERE id = ?').get(request.params.id) as { credential_account: string | null } | undefined;
    if (!row) return reply.code(404).send({ error: 'connection_not_found', message: '连接不存在喵。' });

    database.connection.prepare('DELETE FROM service_connections WHERE id = ?').run(request.params.id);
    const sharedCredential = row.credential_account && database.connection.prepare(`
      SELECT 1 FROM service_connections WHERE credential_account = ?
      UNION ALL SELECT 1 FROM provider_profiles WHERE credential_account = ?
      UNION ALL SELECT 1 FROM generation_engines WHERE credential_account = ? LIMIT 1
    `).get(row.credential_account, row.credential_account, row.credential_account);
    if (row.credential_account && !sharedCredential) {
      await secrets.delete(row.credential_account).catch(() => undefined);
    }
    return { ok: true };
  });

  // 5. 连接探测与测试
  app.post<{
    Params: { id?: string };
    Body: { connectionId?: string; baseUrl?: string; secret?: string; kind?: ServiceConnectionKind; headers?: Record<string, string> };
  }>('/api/v1/admin/connections/test', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const body = request.body ?? {};
    const targetId = body.connectionId;
    let baseUrl = body.baseUrl?.trim() ?? '';
    let secret = body.secret?.trim() || null;
    let kind = body.kind || 'openai-compatible-text';
    let headers = safeHeaders(body.headers ?? {});

    if (targetId) {
      const row = database.connection.prepare('SELECT * FROM service_connections WHERE id = ?').get(targetId) as Record<string, unknown> | undefined;
      if (!row) return reply.code(404).send({ error: 'connection_not_found', message: '指定连接不存在喵。' });
      baseUrl = String(row.base_url);
      kind = row.kind as ServiceConnectionKind;
      headers = JSON.parse(String(row.headers_json ?? '{}')) as Record<string, string>;
      if (row.credential_account) {
        const cred = await secrets.get(String(row.credential_account), `STHSTART_SECRET_${String(row.id).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`);
        if (cred.value) secret = cred.value;
      }
    }

    if (!baseUrl) {
      return reply.code(400).send({ error: 'url_required', message: '缺少连接 Base URL 喵。' });
    }

    const startTime = Date.now();
    try {
      let probeUrl = baseUrl;
      if (kind === 'comfyui') {
        probeUrl = `${baseUrl.replace(/\/+$/, '')}/system_stats`;
      } else if (kind === 'worker') {
        probeUrl = `${baseUrl.replace(/\/+$/, '')}/health`;
      } else {
        probeUrl = `${baseUrl.replace(/\/+$/, '')}/models`;
      }

      const res = await fetcher(probeUrl, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          ...(secret ? { authorization: `Bearer ${secret}` } : {}),
          ...headers,
        },
        signal: AbortSignal.timeout(10000),
      });

      const latencyMs = Date.now() - startTime;
      const json = await res.json().catch(() => null) as Record<string, unknown> | null;
      let discoveredModels: string[] | undefined;
      if (Array.isArray(json?.data)) {
        discoveredModels = json.data.map((item: unknown) => typeof item === 'object' && item ? String((item as { id?: unknown }).id ?? '') : String(item)).filter(Boolean);
      }

      const testResult: ConnectionTestResult = {
        success: res.ok,
        latencyMs,
        statusCode: res.status,
        message: res.ok ? '连接成功喵。' : `服务器返回状态码 ${res.status}喵。`,
        discoveredModels,
      };
      return testResult;
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const testResult: ConnectionTestResult = {
        success: false,
        latencyMs,
        statusCode: null,
        message: err instanceof Error ? err.message : '连接超时或网络异常喵。',
      };
      return testResult;
    }
  });

  // 6. 模型目录发现
  app.post<{
    Body: { connectionId?: string; baseUrl?: string; secret?: string; headers?: Record<string, string> };
  }>('/api/v1/admin/connections/discover-models', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const body = request.body ?? {};
    let baseUrl = body.baseUrl?.trim() ?? '';
    let secret = body.secret?.trim() || null;
    let headers = safeHeaders(body.headers ?? {});

    if (body.connectionId) {
      const row = database.connection.prepare('SELECT * FROM service_connections WHERE id = ?').get(body.connectionId) as Record<string, unknown> | undefined;
      if (!row) return reply.code(404).send({ error: 'connection_not_found', message: '连接不存在喵。' });
      baseUrl = String(row.base_url);
      headers = JSON.parse(String(row.headers_json ?? '{}')) as Record<string, string>;
      if (row.credential_account) {
        const cred = await secrets.get(String(row.credential_account), `STHSTART_SECRET_${String(row.id).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`);
        if (cred.value) secret = cred.value;
      }
    }

    if (!baseUrl) return reply.code(400).send({ error: 'url_required', message: '缺少 Base URL 喵。' });

    let endpoint: URL;
    try {
      endpoint = new URL(`${baseUrl.replace(/\/+$/, '')}/models`);
    } catch {
      return reply.code(400).send({ error: 'invalid_url', message: '无效的 API 地址喵。' });
    }

    try {
      const response = await fetcher(endpoint, {
        headers: {
          accept: 'application/json',
          ...(secret ? { authorization: `Bearer ${secret}` } : {}),
          ...headers,
        },
        signal: AbortSignal.timeout(15000),
      });

      const payload = (await response.json().catch(() => null)) as
        | { data?: unknown[]; models?: unknown[]; error?: { message?: string }; message?: string }
        | unknown[]
        | null;

      if (!response.ok) {
        const detail = !Array.isArray(payload) && payload ? payload.error?.message ?? payload.message : null;
        return reply.code(502).send({
          error: 'model_discovery_failed',
          message: `模型列表请求失败：${String(detail ?? `HTTP ${response.status}`).slice(0, 300)}喵。`,
        });
      }

      const rows = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload?.models)
            ? payload.models
            : [];
      const models = [
        ...new Set(
          rows
            .map((item) =>
              typeof item === 'string'
                ? item
                : item && typeof item === 'object'
                  ? String((item as { id?: unknown; name?: unknown }).id ?? (item as { name?: unknown }).name ?? '')
                  : '',
            )
            .filter(Boolean)
            .map((id) => id.replace(/^models\//, '')),
        ),
      ].sort((left, right) => left.localeCompare(right));

      if (!models.length) {
        return reply.code(502).send({ error: 'empty_model_list', message: '接口未返回可识别的模型列表；仍可手动填写模型 ID 喵。' });
      }

      const result: DiscoveredModelList = { models, endpoint: endpoint.toString() };
      return result;
    } catch (error) {
      const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return reply.code(502).send({ error: 'model_discovery_failed', message: timeout ? '获取模型列表超时喵。' : '无法连接模型服务喵。' });
    }
  });

  const listPurposesHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkAdmin(request, reply)) return;
    const rows = database.connection.prepare('SELECT * FROM purpose_bindings ORDER BY app_id, purpose_key').all() as Record<string, unknown>[];
    const items: PurposeBinding[] = rows.map((row) => ({
      id: String(row.id),
      appId: String(row.app_id),
      purposeKey: String(row.purpose_key),
      targetType: row.target_type as 'model' | 'preset',
      targetId: String(row.target_id),
      inheritAppDefault: Boolean(row.inherit_app_default),
      updatedAt: String(row.updated_at),
    }));
    return { items };
  };

  app.get('/api/v1/admin/purpose-bindings', listPurposesHandler);
  app.get('/api/v1/admin/purposes', listPurposesHandler);

  app.put<{
    Params: { appId: string; purpose: string };
    Body: { targetType?: 'model' | 'preset'; targetId?: string; inheritAppDefault?: boolean };
  }>('/api/v1/admin/purposes/:appId/:purpose', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const { appId, purpose } = request.params;
    const body = request.body ?? {};
    if (!body.targetType || !body.targetId) {
      return reply.code(400).send({ error: 'invalid_binding', message: 'targetType 和 targetId 必填喵。' });
    }
    const now = nowIso();
    const id = `bind_${appId}_${purpose}`;
    database.connection.prepare(`
      INSERT INTO purpose_bindings (id, app_id, purpose_key, target_type, target_id, inherit_app_default, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(app_id, purpose_key) DO UPDATE SET
        target_type = excluded.target_type,
        target_id = excluded.target_id,
        inherit_app_default = excluded.inherit_app_default,
        updated_at = excluded.updated_at
    `).run(id, appId, purpose, body.targetType, body.targetId, body.inheritAppDefault ? 1 : 0, now);

    const updated: PurposeBinding = {
      id,
      appId,
      purposeKey: purpose,
      targetType: body.targetType,
      targetId: body.targetId,
      inheritAppDefault: Boolean(body.inheritAppDefault),
      updatedAt: now,
    };
    return updated;
  });

  app.delete<{
    Params: { appId: string; purpose: string };
  }>('/api/v1/admin/purposes/:appId/:purpose', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const { appId, purpose } = request.params;
    database.connection.prepare('DELETE FROM purpose_bindings WHERE app_id = ? AND purpose_key = ?').run(appId, purpose);
    return { ok: true };
  });

  app.put<{
    Body: {
      bindings: Array<{
        id?: string;
        appId: string;
        purposeKey: string;
        targetType: 'model' | 'preset';
        targetId: string;
        inheritAppDefault?: boolean;
      }>;
    };
  }>('/api/v1/admin/purpose-bindings', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const bindings = request.body?.bindings;
    if (!Array.isArray(bindings)) {
      return reply.code(400).send({ error: 'invalid_bindings', message: 'bindings 必须是数组喵。' });
    }

    const now = nowIso();
    database.transaction(() => {
      for (const item of bindings) {
        if (!item.appId || !item.purposeKey || !item.targetId) continue;
        const id = item.id || `bind_${item.appId}_${item.purposeKey}`;
        database.connection.prepare(`
          INSERT INTO purpose_bindings (id, app_id, purpose_key, target_type, target_id, inherit_app_default, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(app_id, purpose_key) DO UPDATE SET
            target_type = excluded.target_type,
            target_id = excluded.target_id,
            inherit_app_default = excluded.inherit_app_default,
            updated_at = excluded.updated_at
        `).run(
          id,
          item.appId,
          item.purposeKey,
          item.targetType,
          item.targetId,
          item.inheritAppDefault ? 1 : 0,
          now,
        );
      }
    });

    return { ok: true };
  });
}
