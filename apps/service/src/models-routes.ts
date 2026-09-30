import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { LlmModelCapability, ModelInferenceTestResult, ModelProfile } from '@sthstart/contracts';
import { authenticateAdmin } from './access.js';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';
import type { SecretStore } from './security.js';
import { executeTextLlm } from './llm/common-llm.js';

export function hydrateModelProfile(row: Record<string, unknown>): ModelProfile {
  return {
    id: String(row.id),
    connectionId: String(row.connection_id),
    name: String(row.name),
    modelId: String(row.model_id),
    capabilities: JSON.parse(String(row.capabilities_json ?? '["text"]')) as LlmModelCapability[],
    contextLength: row.context_length ? Number(row.context_length) : null,
    maxOutputTokens: row.max_output_tokens ? Number(row.max_output_tokens) : null,
    defaultParams: JSON.parse(String(row.default_params_json ?? '{}')) as Record<string, unknown>,
    advancedJson: JSON.parse(String(row.advanced_json ?? '{}')) as Record<string, unknown>,
    testStatus: (row.test_status ?? 'untested') as 'untested' | 'passed' | 'failed',
    lastTestedAt: row.last_tested_at ? String(row.last_tested_at) : null,
    enabled: Boolean(row.enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function registerModelRoutes(
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

  // 1. 获取所有模型配置
  app.get('/api/v1/admin/models', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const rows = database.connection.prepare(
      'SELECT * FROM model_profiles ORDER BY name COLLATE NOCASE',
    ).all() as Record<string, unknown>[];
    const items = rows.map((row) => hydrateModelProfile(row));
    return { items };
  });

  // 2. 获取单个模型配置
  app.get<{ Params: { id: string } }>('/api/v1/admin/models/:id', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const row = database.connection.prepare('SELECT * FROM model_profiles WHERE id = ?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: 'model_not_found', message: '模型配置不存在喵。' });
    return hydrateModelProfile(row);
  });

  // 3. 创建或更新模型配置
  app.post<{
    Body: {
      id?: string;
      connectionId?: string;
      name?: string;
      modelId?: string;
      capabilities?: LlmModelCapability[];
      contextLength?: number | null;
      maxOutputTokens?: number | null;
      defaultParams?: Record<string, unknown>;
      advancedJson?: Record<string, unknown>;
      enabled?: boolean;
    };
  }>('/api/v1/admin/models', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const body = request.body ?? {};
    const id = typeof body.id === 'string' ? body.id.trim() : undefined;
    const connectionId = typeof body.connectionId === 'string' ? body.connectionId.trim() : undefined;
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : undefined;
    if (!id || !/^[a-z][a-z0-9_-]{1,62}$/.test(id)) {
      return reply.code(400).send({ error: 'invalid_model_id', message: '模型配置 ID 必须以小写字母开头，2-63 位字母、数字、下划线或连字符喵。' });
    }
    if (!name) return reply.code(400).send({ error: 'name_required', message: '请填写模型显示名称喵。' });
    if (!modelId) return reply.code(400).send({ error: 'model_id_required', message: '请填写或选择实际模型 ID喵。' });
    if (!connectionId) return reply.code(400).send({ error: 'connection_id_required', message: '请选择关联的服务连接喵。' });

    const conn = database.connection.prepare('SELECT * FROM service_connections WHERE id = ?').get(connectionId) as Record<string, unknown> | undefined;
    if (!conn) return reply.code(404).send({ error: 'connection_not_found', message: '关联的服务连接不存在喵。' });

    const existing = database.connection.prepare('SELECT * FROM model_profiles WHERE id = ?').get(id) as Record<string, unknown> | undefined;

    const effectiveCapabilities = Array.isArray(body.capabilities) && body.capabilities.length > 0
      ? body.capabilities.map((cap) => String(cap) === 'vision' ? 'multimodal' : cap)
      : (existing?.capabilities_json ? JSON.parse(String(existing.capabilities_json)) : ['text']);

    const effectiveContextLength = body.contextLength !== undefined
      ? (typeof body.contextLength === 'number' ? body.contextLength : null)
      : (existing && existing.context_length !== undefined ? (existing.context_length as number | null) : null);

    const effectiveMaxOutputTokens = body.maxOutputTokens !== undefined
      ? (typeof body.maxOutputTokens === 'number' ? body.maxOutputTokens : null)
      : (existing && existing.max_output_tokens !== undefined ? (existing.max_output_tokens as number | null) : null);

    const effectiveDefaultParams = body.defaultParams !== undefined
      ? (body.defaultParams && typeof body.defaultParams === 'object' && !Array.isArray(body.defaultParams) ? body.defaultParams : {})
      : (existing?.default_params_json ? JSON.parse(String(existing.default_params_json)) : {});

    const effectiveAdvancedJson = body.advancedJson !== undefined
      ? (body.advancedJson && typeof body.advancedJson === 'object' && !Array.isArray(body.advancedJson) ? body.advancedJson : {})
      : (existing?.advanced_json ? JSON.parse(String(existing.advanced_json)) : {});

    const effectiveEnabled = body.enabled !== undefined
      ? Boolean(body.enabled)
      : (existing && existing.enabled !== undefined ? Boolean(existing.enabled) : true);

    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return reply.code(400).send({ error: 'invalid_enabled' });
    if (body.capabilities !== undefined && (!Array.isArray(body.capabilities) || !body.capabilities.length || body.capabilities.some((c) => !['text', 'multimodal', 'vision'].includes(c)))) return reply.code(400).send({ error: 'invalid_capabilities' });
    for (const value of [body.defaultParams, body.advancedJson]) {
      if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) return reply.code(400).send({ error: 'invalid_model_params' });
    }
    for (const value of [body.contextLength, body.maxOutputTokens]) {
      if (value !== undefined && value !== null && (!Number.isInteger(value) || value <= 0)) return reply.code(400).send({ error: 'invalid_token_limit' });
    }
    const now = nowIso();
    database.transaction(() => {
      database.connection.prepare(`
        INSERT INTO model_profiles (
          id, connection_id, name, model_id, capabilities_json, context_length,
          max_output_tokens, default_params_json, advanced_json, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          connection_id = excluded.connection_id,
          name = excluded.name,
          model_id = excluded.model_id,
          capabilities_json = excluded.capabilities_json,
          context_length = excluded.context_length,
          max_output_tokens = excluded.max_output_tokens,
          default_params_json = excluded.default_params_json,
          advanced_json = excluded.advanced_json,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `).run(
        id,
        connectionId,
        name,
        modelId,
        JSON.stringify(effectiveCapabilities),
        effectiveContextLength,
        effectiveMaxOutputTokens,
        JSON.stringify(effectiveDefaultParams),
        JSON.stringify(effectiveAdvancedJson),
        effectiveEnabled ? 1 : 0,
        now,
        now,
      );

      // 双向同步至 provider_profiles 保持透明向下兼容
      const legacyKind = conn.kind === 'openai-compatible-image' ? 'image' : conn.kind === 'vector' ? 'vector' : 'llm';
      database.connection.prepare(`
        INSERT INTO provider_profiles (id, name, kind, base_url, model, credential_account, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          kind = excluded.kind,
          base_url = excluded.base_url,
          model = excluded.model,
          credential_account = excluded.credential_account,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `).run(id, name, legacyKind, String(conn.base_url), modelId, conn.credential_account ? String(conn.credential_account) : null, effectiveEnabled && Boolean(conn.enabled) ? 1 : 0, now, now);

      database.connection.prepare(`
        INSERT INTO provider_profile_options (profile_id, thinking_mode, headers_json, extra_body_json, capabilities_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(profile_id) DO UPDATE SET
          thinking_mode = excluded.thinking_mode,
          headers_json = excluded.headers_json,
          extra_body_json = excluded.extra_body_json,
          capabilities_json = excluded.capabilities_json
      `).run(
        id,
        String(effectiveAdvancedJson.thinkingMode ?? 'omit'),
        String(conn.headers_json ?? '{}'),
        JSON.stringify({ ...effectiveDefaultParams, ...effectiveAdvancedJson }),
        JSON.stringify(effectiveCapabilities),
      );
    });

    return reply.code(201).send({ id });
  });

  // 4. 删除模型配置
  app.delete<{ Params: { id: string } }>('/api/v1/admin/models/:id', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const id = request.params.id;

    const assignments = database.connection.prepare(
      'SELECT a.app_id, m.name, a.role FROM app_llm_assignments a JOIN managed_apps m ON m.id = a.app_id WHERE a.profile_id = ?',
    ).all(id) as Array<{ app_id: string; name: string; role: string }>;

    const bindings = database.connection.prepare(
      "SELECT p.app_id, m.name, p.purpose_key FROM purpose_bindings p JOIN managed_apps m ON m.id = p.app_id WHERE p.target_type = 'model' AND p.target_id = ?",
    ).all(id) as Array<{ app_id: string; name: string; purpose_key: string }>;

    if (assignments.length > 0 || bindings.length > 0) {
      return reply.code(409).send({
        error: 'model_in_use',
        message: '该模型正在被业务或应用使用，请先解绑后再删除喵。',
        assignments,
        bindings,
      });
    }

    database.transaction(() => {
      database.connection.prepare('DELETE FROM model_profiles WHERE id = ?').run(id);
      database.connection.prepare('DELETE FROM provider_profiles WHERE id = ?').run(id);
      database.connection.prepare('DELETE FROM provider_profile_options WHERE profile_id = ?').run(id);
    });

    return { ok: true };
  });

  // 5. 模型能力与推理测试
  app.post<{
    Params: { id: string };
    Body: { prompt?: string; type?: 'text' | 'json' | 'vision' };
  }>('/api/v1/admin/models/:id/test', async (request, reply) => {
    const startTime = Date.now();
    const id = request.params.id;
    let callMetadata: import('./llm/common-llm.js').CommonLlmResult | undefined;
    try {
      if (!checkAdmin(request, reply)) return;
      const body = request.body ?? {};

      const modelRow = database.connection.prepare(
        `SELECT mp.*, sc.base_url, sc.credential_account, sc.headers_json, sc.options_json, sc.timeout_ms
         FROM model_profiles mp
         JOIN service_connections sc ON sc.id = mp.connection_id
         WHERE mp.id = ?`,
      ).get(id) as Record<string, unknown> | undefined;

      if (!modelRow) return reply.code(404).send({ error: 'model_not_found', message: '模型配置不存在喵。' });

      const account = modelRow.credential_account ? String(modelRow.credential_account) : '';
      const connId = modelRow.connection_id ? String(modelRow.connection_id) : '';
      const connEnv = connId ? `STHSTART_SECRET_${connId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}` : '';
      const modelEnv = `STHSTART_SECRET_${String(id).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
      let credential = account ? await secrets.get(account, connEnv || modelEnv) : { value: null };
      if (!credential.value && connEnv && account) {
        credential = await secrets.get(account, modelEnv);
      }

      if (body.type !== undefined && !['text', 'json', 'vision'].includes(body.type)) return reply.code(400).send({ error: 'invalid_test_type' });
      const headers = JSON.parse(String(modelRow.headers_json || '{}')) as Record<string, string>;
      const defaultParams = JSON.parse(String(modelRow.default_params_json || '{}')) as Record<string, unknown>;
      const advanced = JSON.parse(String(modelRow.advanced_json || '{}')) as Record<string, unknown>;

      const connectionOptions = JSON.parse(String(modelRow.options_json || '{}')) as Record<string, unknown>;
      const isJsonTest = body.type === 'json';
      const isVisionTest = body.type === 'vision';
      const testPrompt = (typeof body.prompt === 'string' ? body.prompt.trim() : '') || (isVisionTest
        ? '请描述这张图片的内容，并回复“视觉测试成功”。'
        : isJsonTest
          ? '请输出合法的 JSON 对象，包含 status: "ok", model: "connected"。'
          : '请回复“连接成功”并简要说明你的模型代号。');

      let testMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string | Array<Record<string, unknown>> }> | undefined;
      if (isVisionTest) {
        testMessages = [
          { role: 'system', content: 'You are an AI visual model connectivity tester. Reply concisely in Chinese.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: testPrompt },
              {
                type: 'image_url',
                image_url: {
                  url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
                },
              },
            ],
          },
        ];
      }

      const output = await executeTextLlm({
        profile: {
          id,
          name: String(modelRow.name),
          baseUrl: String(modelRow.base_url),
          secret: credential.value,
          model: String(modelRow.model_id),
          headers,
          extraBody: { ...connectionOptions, ...defaultParams, ...advanced },
          thinkingMode: advanced.thinkingMode === 'enabled' || advanced.thinkingMode === 'disabled' ? advanced.thinkingMode : 'omit',
          timeoutMs: Number(modelRow.timeout_ms ?? 60000),
        },
        prompt: isVisionTest ? undefined : testPrompt,
        systemPrompt: isVisionTest ? undefined : (isJsonTest ? 'You are a JSON test server. Only return valid JSON.' : 'You are an AI model connectivity tester. Reply concisely in Chinese.'),
        messages: testMessages,
        onResult: (result) => { callMetadata = result; },
        temperature: 0.2,
        maxTokens: 100,
        jsonMode: isJsonTest,
        fetchFn: fetcher,
        audit: {
          database,
          applicationId: 'admin',
          feature: 'model-test',
          businessEvent: 'model-inference-test',
          objectType: 'model_profile',
          objectId: id,
        },
      });

      if (isJsonTest) {
        try {
          const parsed: unknown = JSON.parse(output);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('json_object_required');
        } catch (jsonErr) {
          throw new Error(`json_validation_failed: 模型未返回合法的 JSON 对象喵。输出片段: ${output.slice(0, 120)}`);
        }
      }

      const latencyMs = Date.now() - startTime;
      const now = nowIso();
      database.connection.prepare(
        "UPDATE model_profiles SET test_status = 'passed', last_tested_at = ?, updated_at = ? WHERE id = ?",
      ).run(now, now, id);

      const result: ModelInferenceTestResult = {
        success: true,
        latencyMs,
        output,
        tokenUsage: callMetadata?.tokenUsage ?? null,
        error: null,
        aiCallId: callMetadata?.aiCallId ?? null,
      };
      return result;
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const now = nowIso();
      database.connection.prepare(
        "UPDATE model_profiles SET test_status = 'failed', last_tested_at = ?, updated_at = ? WHERE id = ?",
      ).run(now, now, id);

      const result: ModelInferenceTestResult = {
        success: false,
        latencyMs,
        output: null,
        tokenUsage: callMetadata?.tokenUsage ?? null,
        error: err instanceof Error ? err.message : String(err),
        aiCallId: callMetadata?.aiCallId ?? null,
      };
      return result;
    }
  });
}
