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
import { SecretStore } from './security.js';
import { registerManagementRoutes } from './management.js';
import { registerPublicRoutes } from './public-routes.js';
import { enforceAllRetention } from './artifacts.js';
import { registerNotebookRoutes } from './notebook.js';
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
  const narrativeDatabase = options.narrativeDatabase ?? new NarrativeDatabase(options.database ? ':memory:' : config.narrativeDatabasePath);
  const narrativeConnectors = createNarrativeConnectors(config, options.fetcher);
  const secrets = options.secrets ?? new SecretStore();
  const runtimeSettings = new RuntimeSettingsStore(database);
  const runtimeLogs = new RuntimeLogService(database, config.logDirectory, !options.database);
  const runtimeManager = new RuntimeManager(config, runtimeSettings, runtimeLogs);
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
    ],
  }));

  app.get<{ Reply: AppsResponse }>('/api/v1/apps', async () => ({ items: [await inspectApp(), inspectNotebook(), inspectNarrative()] }));
  app.get<{ Reply: AppDescriptor }>('/api/v1/apps/linshe', async () => inspectApp());
  app.get<{ Reply: AppDescriptor }>('/api/v1/apps/notebook', async () => inspectNotebook());
  app.get<{ Reply: AppDescriptor }>('/api/v1/apps/narrative', async () => inspectNarrative());

  registerManagementRoutes(app, config, database, secrets);
  registerNotebookRoutes(app, config, database);
  registerNarrativeRoutes(app, narrativeDatabase, database, narrativeConnectors);
  registerPublicRoutes(app, config, database, secrets, options.fetcher);
  registerRuntimeRoutes(app, config, database, runtimeSettings, runtimeLogs, runtimeManager, options.fetcher);

  void enforceAllRetention(database).catch(() => undefined);
  const retentionTimer = setInterval(() => void enforceAllRetention(database).catch(() => undefined), 60 * 60_000);
  retentionTimer.unref();

  app.addHook('onClose', async () => {
    clearInterval(retentionTimer);
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
