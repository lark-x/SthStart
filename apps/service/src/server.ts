import cors from '@fastify/cors';
import Fastify from 'fastify';
import type {
  AppDescriptor,
  AppsResponse,
  CapabilitiesResponse,
  HealthResponse,
} from '@sthstart/contracts';
import type { ServiceConfig } from './config.js';
import { readConfig } from './config.js';
import { inspectLinshe } from './registry.js';
import { ServiceDatabase } from './database.js';
import { hashToken, issueToken, SecretStore } from './security.js';
import { registerManagementRoutes } from './management.js';
import { registerPublicRoutes } from './public-routes.js';
import { enforceAllRetention, reconcileArtifacts } from './artifacts.js';
import { registerNotebookRoutes } from './notebook.js';
import { registerCharacterRoutes } from './characters.js';
import { NarrativeDatabase } from './narrative-database.js';
import { registerNarrativeRoutes } from './narrative.js';
import { createNarrativeConnectors } from './narrative-connectors.js';
import { RuntimeLogService, RuntimeManager, RuntimeSettingsStore } from './runtime.js';
import { applyCreativeWhenReady, registerRuntimeRoutes } from './runtime-routes.js';

const SERVICE_VERSION = '0.1.0';

interface ServiceOptions {
  config?: ServiceConfig;
  inspectApp?: () => Promise<AppDescriptor>;
  database?: ServiceDatabase;
  secrets?: SecretStore;
  fetcher?: typeof fetch;
  narrativeDatabase?: NarrativeDatabase;
}

export async function createService(options: ServiceOptions = {}) {
  const config = options.config ?? readConfig();
  const startedAt = Date.now();
  const app = Fastify({ logger: false, bodyLimit: 12 * 1024 * 1024 });
  const inspectApp = options.inspectApp ?? (() => inspectLinshe(config));
  const database = options.database ?? new ServiceDatabase(config.databasePath);
  // Keep a user-provided token stable for separately started Linshe processes
  // (for example `dev:all`). The runtime manager still receives the same token
  // and can inject it into a managed child process. When no token is configured,
  // generate an ephemeral one for the in-process runtime manager.
  const linsheAppToken = process.env.STHSTART_APP_TOKEN?.trim() || issueToken('sth_app');
  const identityUpdatedAt = new Date().toISOString();
  database.connection.prepare(`INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
    VALUES ('linshe','邻舍',?,?,1,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,token_hash=excluded.token_hash,capabilities_json=excluded.capabilities_json,enabled=1,updated_at=excluded.updated_at`)
    .run(hashToken(linsheAppToken), JSON.stringify(['llm', 'vector', 'image', 'persona', 'logs']), identityUpdatedAt, identityUpdatedAt);
  database.connection.prepare("INSERT OR IGNORE INTO storage_policies(app_id,mode) VALUES ('linshe','keep')").run();
  if (!options.database && process.env.STHSTART_APP_TOKEN?.trim() && process.env.STHSTART_LLM_PROFILE?.trim()) {
    const legacy = database.connection.prepare(`SELECT a.id app_id,p.id profile_id FROM managed_apps a
      JOIN provider_profiles p ON p.id=? AND p.kind='llm' AND p.enabled=1
      LEFT JOIN provider_profile_options o ON o.profile_id=p.id
      WHERE a.token_hash=? AND COALESCE(o.capabilities_json,'["text"]') LIKE '%"text"%'`).get(process.env.STHSTART_LLM_PROFILE.trim(), hashToken(process.env.STHSTART_APP_TOKEN.trim())) as { app_id: string; profile_id: string } | undefined;
    if (legacy) database.connection.prepare(`INSERT OR IGNORE INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES (?,'text',?,?)`).run(legacy.app_id, legacy.profile_id, new Date().toISOString());
  }
  const narrativeDatabase = options.narrativeDatabase ?? new NarrativeDatabase(options.database ? ':memory:' : config.narrativeDatabasePath);
  const narrativeConnectors = createNarrativeConnectors(config, options.fetcher);
  const secrets = options.secrets ?? new SecretStore();
  const runtimeSettings = new RuntimeSettingsStore(database);
  const runtimeLogs = new RuntimeLogService(database, config.logDirectory, !options.database);
  const runtimeManager = new RuntimeManager(config, runtimeSettings, runtimeLogs, { appToken: linsheAppToken, fetcher: options.fetcher });
  const inspectNotebook = (): AppDescriptor => ({
    id: 'notebook', name: '创作笔记', description: '记录日记、灵感、角色与世界故事。',
    launchUrl: `${config.portalOrigins[0]}/apps/notebook`, status: 'online', version: SERVICE_VERSION,
    sourceRevision: null, capabilities: ['notes', 'images', 'links', 'lore'], checkedAt: new Date().toISOString(),
  });
  const inspectNarrative = (): AppDescriptor => ({
    id: 'narrative', name: '叙事档案', description: '回顾剧情、整理实体，并让结论始终可追溯至原文。',
    launchUrl: `${config.portalOrigins[0]}/apps/narrative`, status: 'online', version: SERVICE_VERSION,
    sourceRevision: null, capabilities: ['story-archive', 'search', 'imports', 'evidence'], checkedAt: new Date().toISOString(),
  });

  await app.register(cors, {
    origin(origin, callback) {
      if (origin === undefined || config.portalOrigins.includes(origin)) callback(null, true);
      else callback(new Error('Origin is not allowed'), false);
    },
  });

  app.addContentTypeParser(
    [
      'application/octet-stream',
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
      'image/avif',
      'video/mp4',
      'video/webm',
      'audio/mpeg',
      'audio/wav',
      'application/pdf',
      'text/plain',
      'text/markdown',
    ],
    (_request, payload, done) => {
      done(null, payload);
    },
  );

  app.addHook('onRequest', async (request, reply) => {
    const supplied = request.headers['x-request-id'];
    const requestId = typeof supplied === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(supplied) ? supplied : request.id;
    request.headers['x-request-id'] = requestId;
    reply.header('x-request-id', requestId);
  });
  app.addHook('onSend', async (request, reply, payload) => {
    if (reply.statusCode < 400 || typeof payload !== 'string' || !String(reply.getHeader('content-type') ?? '').includes('application/json')) return payload;
    try {
      const body = JSON.parse(payload) as Record<string, unknown>;
      if (!body.requestId) body.requestId = request.headers['x-request-id'] ?? request.id;
      return JSON.stringify(body);
    } catch { return payload; }
  });
  app.setErrorHandler((error, request, reply) => {
    const failure = error as { message?: string; statusCode?: number };
    const statusCode = failure.statusCode && failure.statusCode < 500 ? failure.statusCode : 500;
    runtimeLogs.append({ appId: 'sthstart', serviceId: 'api', stream: 'system', level: 'error', message: `${request.method} ${request.url}: ${failure.message ?? String(error)}`, force: true });
    return reply.code(statusCode).send({
      error: statusCode < 500 ? 'request_failed' : 'internal_error',
      message: statusCode < 500 ? failure.message : '服务处理请求时发生错误。',
      requestId: request.headers['x-request-id'] ?? request.id,
    });
  });

  app.get<{ Reply: HealthResponse }>('/api/v1/health', async () => ({
    status: 'ok',
    service: 'sthstart-service',
    version: SERVICE_VERSION,
    uptimeMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  }));

  app.get<{ Reply: CapabilitiesResponse }>('/api/v1/capabilities', async () => ({
    apiVersion: 'v1',
    modules: [
      {
        id: 'app-registry',
        version: '1.0.0',
        description: '发现本地应用并报告其可用状态。',
      },
      { id: 'llm-gateway', version: '1.0.0', description: 'OpenAI 兼容的统一模型入口。' },
      { id: 'vector-service', version: '1.0.0', description: '按应用与授权命名空间隔离的向量能力。' },
      { id: 'image-service', version: '1.0.0', description: '带幂等任务和保留策略的图片生成入口。' },
      { id: 'persona-catalog', version: '1.0.0', description: '不可变版本的通用角色模板目录。' },
      { id: 'creative-notebook', version: '1.0.0', description: '记录文本、图片、链接与创作资料。' },
      { id: 'narrative-archive', version: '1.0.0', description: '多作品剧情导入、回顾、检索与证据化知识。' },
      { id: 'runtime-manager', version: '1.0.0', description: '托管本地应用进程、运行配置与有界日志。' },
      { id: 'artifact-service', version: '2.0.0', description: '基于流式处理、分层授权与 50 GiB 配额保护的中央媒体库。' },
    ],
  }));

  app.get<{ Reply: AppsResponse }>('/api/v1/apps', async () => ({ items: [await inspectApp(), inspectNotebook(), inspectNarrative()] }));
  app.get<{ Reply: AppDescriptor }>('/api/v1/apps/linshe', async () => inspectApp());
  app.get<{ Reply: AppDescriptor }>('/api/v1/apps/notebook', async () => inspectNotebook());
  app.get<{ Reply: AppDescriptor }>('/api/v1/apps/narrative', async () => inspectNarrative());

  registerManagementRoutes(app, config, database, secrets, options.fetcher);
  registerNotebookRoutes(app, config, database);
  registerCharacterRoutes(app, config, database, secrets, options.fetcher);
  registerNarrativeRoutes(app, narrativeDatabase, database, narrativeConnectors);
  registerPublicRoutes(app, config, database, secrets, options.fetcher);
  registerRuntimeRoutes(app, config, database, runtimeSettings, runtimeLogs, runtimeManager, options.fetcher);

  const retentionFailure = (error: unknown) => runtimeLogs.append({ appId: 'sthstart', serviceId: 'artifact-retention', stream: 'system', level: 'warn', message: `保留策略执行失败：${String(error)}`, force: true });
  void enforceAllRetention(database).catch(retentionFailure);
  const retentionTimer = setInterval(() => void enforceAllRetention(database).catch(retentionFailure), 60 * 60_000);
  retentionTimer.unref();
  const reconcilePromise = reconcileArtifacts(config, database).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('database is not open')) {
      runtimeLogs.append({ appId: 'sthstart', serviceId: 'artifact-reconcile', stream: 'system', level: 'warn', message: `媒体库巡检异常：${msg}`, force: true });
    }
  });

  app.addHook('onClose', async () => {
    clearInterval(retentionTimer);
    await reconcilePromise.catch(() => {});
    await runtimeManager.close();
    if (!options.database) database.close();
    if (!options.narrativeDatabase) narrativeDatabase.close();
  });

  if (!options.database && runtimeSettings.get().autoStart) {
    setTimeout(() => void runtimeManager.start('linshe')
      .then(() => applyCreativeWhenReady(config, runtimeSettings, options.fetcher ?? fetch, runtimeLogs))
      .catch((error: unknown) => runtimeLogs.append({ appId: 'sthstart', serviceId: 'runtime-manager', stream: 'system', level: 'error', message: `自动启动邻舍失败：${String(error)}`, force: true })), 500).unref();
  }

  return { app, config, database, narrativeDatabase, runtimeManager, runtimeLogs };
}
