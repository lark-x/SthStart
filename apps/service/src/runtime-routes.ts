import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { LogLevel, RuntimeOverview, RuntimeSettings } from '@sthstart/contracts';
import { authenticateApp } from './access.js';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';
import { readLauncherImport, RuntimeLogService, RuntimeManager, RuntimeSettingsStore } from './runtime.js';

type Fetcher = typeof fetch;

const runtimeSettingsBody = Type.Partial(Type.Object({
  autoStart: Type.Boolean(), autoOpenBrowser: Type.Boolean(), useMirror: Type.Boolean(),
  publicLlmEnabled: Type.Boolean(),
  comfyuiExecutable: Type.String({ maxLength: 4_096 }), extraLoraFolders: Type.Array(Type.String({ maxLength: 4_096 }), { maxItems: 128 }),
  maibotAutostart: Type.Boolean(), maibotBrowserMaibot: Type.Boolean(), maibotBrowserSnowluma: Type.Boolean(),
  creative: Type.Record(Type.String(), Type.Unknown()),
}));

const logLevelSchema = Type.Union([
  Type.Literal('off'), Type.Literal('error'), Type.Literal('warn'), Type.Literal('info'), Type.Literal('debug'), Type.Literal('trace'),
]);
const logPolicyBody = Type.Partial(Type.Object({
  globalLevel: logLevelSchema,
  serviceLevels: Type.Record(Type.String(), Type.Union([logLevelSchema, Type.Null()])),
  retentionDays: Type.Integer({ minimum: 1, maximum: 90 }), maxBytes: Type.Integer({ minimum: 10 * 1024 * 1024, maximum: 2 * 1024 * 1024 * 1024 }),
  sensitiveUntil: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]), diagnosticUntil: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
}));

async function linsheJson(config: ServiceConfig, fetcher: Fetcher, path: string, init?: RequestInit) {
  const response = await fetcher(`http://127.0.0.1:3099${path}`, { ...init, signal: AbortSignal.timeout(5_000), headers: { 'content-type': 'application/json', ...init?.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String((payload as Record<string, unknown>).error ?? `HTTP ${response.status}`));
  return payload as Record<string, unknown>;
}

export async function applyCreativeSettings(config: ServiceConfig, settings: RuntimeSettingsStore, fetcher: Fetcher, logs: RuntimeLogService) {
  const creative = settings.get().creative as Record<string, unknown>;
  const tasks: Promise<unknown>[] = [];
  if (creative.comfy && typeof creative.comfy === 'object') tasks.push(linsheJson(config, fetcher, '/api/config/comfy', { method: 'PUT', body: JSON.stringify(creative.comfy) }));
  if (creative.memory && typeof creative.memory === 'object') tasks.push(linsheJson(config, fetcher, '/api/config/memory', { method: 'PUT', body: JSON.stringify(creative.memory) }));
  if (creative.features && typeof creative.features === 'object') {
    for (const [key, value] of Object.entries(creative.features as Record<string, unknown>)) tasks.push(linsheJson(config, fetcher, '/api/config/features', { method: 'PUT', body: JSON.stringify({ key, value }) }));
  }
  const workflow = creative.workflow as { mode?: string; scene?: Record<string, string> } | undefined;
  if (workflow?.mode) tasks.push(linsheJson(config, fetcher, '/api/config/workflow-mode', { method: 'PUT', body: JSON.stringify({ mode: workflow.mode }) }));
  if (workflow?.scene) for (const [scene, mode] of Object.entries(workflow.scene)) tasks.push(linsheJson(config, fetcher, '/api/config/workflow-scene', { method: 'PUT', body: JSON.stringify({ scene, mode }) }));
  const group = creative.groupChat as { temperature?: number; summaryInterval?: number } | undefined;
  if (group?.temperature !== undefined) tasks.push(linsheJson(config, fetcher, '/api/config/group-temperature', { method: 'PUT', body: JSON.stringify({ value: group.temperature }) }));
  if (group?.summaryInterval !== undefined) tasks.push(linsheJson(config, fetcher, '/api/config/group-summary-interval', { method: 'PUT', body: JSON.stringify({ value: group.summaryInterval }) }));
  const results = await Promise.allSettled(tasks);
  const failed = results.filter((item) => item.status === 'rejected');
  logs.append({ appId: 'sthstart', serviceId: 'runtime-manager', stream: 'system', level: failed.length ? 'warn' : 'info', message: failed.length ? `邻舍配置应用完成，${failed.length} 项失败` : `邻舍配置已应用（${results.length} 项）`, force: true });
  return { applied: results.length - failed.length, failed: failed.length };
}

export async function applyCreativeWhenReady(config: ServiceConfig, settings: RuntimeSettingsStore, fetcher: Fetcher, logs: RuntimeLogService) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const health = await fetcher(config.linsheHealthUrl, { signal: AbortSignal.timeout(1_000) });
      if (health.ok) return await applyCreativeSettings(config, settings, fetcher, logs);
    } catch { /* continue until startup timeout */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  throw new Error('linshe_startup_timeout');
}

export function registerRuntimeRoutes(
  app: FastifyInstance,
  config: ServiceConfig,
  database: ServiceDatabase,
  settings: RuntimeSettingsStore,
  logs: RuntimeLogService,
  runtime: RuntimeManager,
  fetcher: Fetcher = fetch,
) {
  const runtimeErrorMessage = (error: unknown) => {
    const code = error instanceof Error ? error.message : String(error);
    return ({
      unknown_service: '未知的运行服务。', service_not_installed: '该服务尚未安装完整。',
      service_already_managed: '该服务已由控制中心管理。', port_owned_by_other_process: '端口正被其他程序占用，控制中心不会强制结束它。',
      project_process_takeover_failed: '发现邻舍遗留进程，但安全接管失败，请先在日志中确认进程状态。',
    } as Record<string, string>)[code] ?? code;
  };
  async function overview(): Promise<RuntimeOverview> {
    const runtimeSettings = settings.get();
    const rows = database.connection.prepare(`SELECT a.role,a.profile_id,p.model FROM app_llm_assignments a
      LEFT JOIN provider_profiles p ON p.id=a.profile_id WHERE a.app_id='linshe'`).all() as Array<{ role: 'text' | 'multimodal'; profile_id: string; model: string | null }>;
    const text = rows.find((row) => row.role === 'text');
    const multimodal = rows.find((row) => row.role === 'multimodal');
    return {
      services: await runtime.snapshot(), settings: runtimeSettings,
      linsheLlm: {
        enabled: runtimeSettings.publicLlmEnabled,
        textProfileId: text?.profile_id ?? null, textModel: text?.model ?? null,
        multimodalProfileId: multimodal?.profile_id ?? null, multimodalModel: multimodal?.model ?? null,
        ready: !runtimeSettings.publicLlmEnabled || Boolean(text?.model),
      },
      logPolicy: logs.getPolicy(), recentErrors: logs.recentErrorCount(), droppedLogs: logs.droppedLogs,
    };
  }

  app.get('/api/v1/admin/runtime/overview', overview);
  app.get('/api/v1/admin/runtime/settings', async () => settings.get());
  app.put<{ Body: Partial<RuntimeSettings> }>('/api/v1/admin/runtime/settings', { schema: { body: runtimeSettingsBody } }, async (request) => settings.update(request.body ?? {}));

  app.get('/api/v1/admin/runtime/services', async () => ({ items: await runtime.snapshot() }));
  app.post<{ Params: { id: string } }>('/api/v1/admin/runtime/services/:id/start', async (request, reply) => {
    try {
      const result = await runtime.start(request.params.id);
      if (request.params.id === 'linshe' || request.params.id === 'linshe-agent') {
        void applyCreativeWhenReady(config, settings, fetcher, logs).catch((error) => logs.append({ appId: 'sthstart', serviceId: 'runtime-manager', stream: 'system', level: 'warn', message: `配置自动应用失败：${String(error)}`, force: true }));
      }
      return reply.code(202).send(result);
    } catch (error) { const code = error instanceof Error ? error.message : String(error); return reply.code(409).send({ error: code, message: runtimeErrorMessage(error) }); }
  });
  app.post<{ Params: { id: string } }>('/api/v1/admin/runtime/services/:id/stop', async (request) => runtime.stop(request.params.id));
  app.post('/api/v1/admin/runtime/comfyui/start', async (_request, reply) => {
    try { return reply.code(202).send(runtime.launchComfyui()); }
    catch (error) { const code = error instanceof Error ? error.message : String(error); return reply.code(409).send({ error: code, message: runtimeErrorMessage(error) }); }
  });
  app.post<{ Params: { id: string } }>('/api/v1/admin/runtime/services/:id/restart', async (request, reply) => {
    await runtime.stop(request.params.id);
    for (let attempt = 0; attempt < 24; attempt++) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
      if (!(await runtime.snapshot()).find((item) => item.id === request.params.id)?.managed) break;
    }
    try { return reply.code(202).send(await runtime.start(request.params.id)); }
    catch (error) { const code = error instanceof Error ? error.message : String(error); return reply.code(409).send({ error: code, message: runtimeErrorMessage(error) }); }
  });

  app.get('/api/v1/admin/runtime/imports/linshe/preview', async () => {
    const launcher = readLauncherImport(config);
    let business: Record<string, unknown> | null = null;
    let businessError: string | null = null;
    try {
      const current = await linsheJson(config, fetcher, '/api/config');
      const memory = await linsheJson(config, fetcher, '/api/config/memory').catch(() => null);
      business = { comfy: current.comfy, features: current.features, workflow: current.workflow, groupChat: current.groupChat, llmProfiles: current.llmProfiles, memory };
    } catch (error) { businessError = error instanceof Error ? error.message : String(error); }
    return { launcher, business, businessError };
  });

  app.post<{ Body: { launcher?: boolean; business?: Record<string, unknown> | null } }>('/api/v1/admin/runtime/imports/linshe/commit', async (request) => {
    return database.transaction(() => {
      const imported: Record<string, unknown> = {};
    if (request.body?.launcher) {
      const preview = readLauncherImport(config);
      if (preview.settings) { settings.update(preview.settings); imported.launcher = preview.settings; }
    }
    if (request.body?.business && typeof request.body.business === 'object') {
      const business = request.body.business;
      const creative = { comfy: business.comfy ?? {}, features: business.features ?? {}, workflow: business.workflow ?? {}, groupChat: business.groupChat ?? {}, memory: business.memory ?? {} };
      settings.update({ creative }); imported.business = creative;
      const profiles = Array.isArray(business.llmProfiles) ? business.llmProfiles as Record<string, unknown>[] : [];
      for (const profile of profiles) {
        let baseUrl: string;
        try { const parsed = new URL(String(profile.baseURL ?? '')); if (!['http:', 'https:'].includes(parsed.protocol)) continue; baseUrl = parsed.toString().replace(/\/$/, ''); } catch { continue; }
        const rawId = String(profile.id ?? profile.name ?? 'linshe-model').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
        const id = rawId.match(/^[a-z][a-z0-9-]{1,62}$/) ? rawId : `linshe-${Date.now()}`;
        const now = nowIso();
        database.connection.prepare(`INSERT INTO provider_profiles(id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at)
          VALUES (?,?,?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,base_url=excluded.base_url,model=excluded.model,updated_at=excluded.updated_at`)
          .run(id, String(profile.name ?? id), 'llm', baseUrl, profile.model ? String(profile.model) : null, `profile:${id}`, now, now);
      }
    }
    database.connection.prepare(`INSERT INTO runtime_imports(source,imported_at,snapshot_json) VALUES ('linshe',?,?)
      ON CONFLICT(source) DO UPDATE SET imported_at=excluded.imported_at,snapshot_json=excluded.snapshot_json`).run(nowIso(), JSON.stringify(imported));
      return { ok: true, settings: settings.get() };
    });
  });
  app.post('/api/v1/admin/runtime/settings/apply', async (_request, reply) => {
    try { return await applyCreativeSettings(config, settings, fetcher, logs); }
    catch (error) { return reply.code(503).send({ error: 'linshe_unavailable', message: error instanceof Error ? error.message : String(error) }); }
  });

  app.get('/api/v1/admin/logging/policy', async () => logs.getPolicy());
  app.put<{ Body: Partial<ReturnType<RuntimeLogService['getPolicy']>> }>('/api/v1/admin/logging/policy', { schema: { body: logPolicyBody } }, async (request) => logs.setPolicy(request.body ?? {}));
  app.get<{ Querystring: { serviceId?: string; level?: LogLevel; query?: string; after?: string; limit?: string } }>('/api/v1/admin/logs', async (request) => ({ items: logs.list({ serviceId: request.query.serviceId, level: request.query.level, query: request.query.query, after: Number(request.query.after || 0), limit: Number(request.query.limit || 500) }), dropped: logs.droppedLogs }));
  app.get('/api/v1/admin/logs/stream', async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' });
    reply.raw.write(': connected\n\n');
    const unsubscribe = logs.subscribe((event) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`));
    const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 15_000);
    request.raw.once('close', () => { clearInterval(heartbeat); unsubscribe(); });
  });
  app.post('/api/v1/admin/diagnostics/export', async (_request, reply) => {
    const data = logs.diagnosticBundle(await overview());
    return reply.header('content-type', 'application/gzip').header('content-disposition', `attachment; filename="sthstart-diagnostics-${Date.now()}.json.gz"`).send(data);
  });

  app.post<{ Body: { serviceId?: string; level?: Exclude<LogLevel, 'off'>; message?: string; sensitive?: boolean } }>('/api/v1/logs', async (request, reply) => {
    const identity = authenticateApp(database, request);
    if (!identity || !identity.capabilities.includes('logs')) return reply.code(403).send({ error: 'forbidden' });
    const message = request.body?.message?.trim();
    if (!message) return reply.code(400).send({ error: 'message_required' });
    if (request.body.level && !['error', 'warn', 'info', 'debug', 'trace'].includes(request.body.level)) return reply.code(400).send({ error: 'invalid_log_level' });
    const event = logs.append({ appId: identity.id, serviceId: request.body.serviceId?.trim() || identity.id, level: request.body.level, message, stream: 'app', sensitive: request.body.sensitive });
    return reply.code(202).send({ accepted: Boolean(event) });
  });
}
