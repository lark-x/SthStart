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

const SERVICE_VERSION = '0.1.0';

interface ServiceOptions {
  config?: ServiceConfig;
  inspectApp?: () => Promise<AppDescriptor>;
}

export async function createService(options: ServiceOptions = {}) {
  const config = options.config ?? readConfig();
  const startedAt = Date.now();
  const app = Fastify({ logger: false });
  const inspectApp = options.inspectApp ?? (() => inspectLinshe(config));

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
    ],
  }));

  app.get<{ Reply: AppsResponse }>('/api/v1/apps', async () => ({ items: [await inspectApp()] }));
  app.get<{ Reply: AppDescriptor }>('/api/v1/apps/linshe', async () => inspectApp());

  return { app, config };
}
