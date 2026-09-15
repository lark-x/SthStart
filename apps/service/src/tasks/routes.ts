import { authenticateAdmin } from '../access.js';
import type { FastifyInstance } from 'fastify';
import type { TaskDomain, TasksResponse } from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import type { SecretStore } from '../security.js';
import { ActivityStore } from '../activities/store.js';
import {
  cancelUnifiedTask,
  listUnifiedTasks,
  retryUnifiedTask,
} from './adapters.js';

export function registerTaskRoutes(
  app: FastifyInstance,
  options: {
    config: ServiceConfig;
    database: ServiceDatabase;
    secrets: SecretStore;
    fetcher?: typeof fetch;
  },
) {
  const { config, database, secrets, fetcher } = options;
  const store = new ActivityStore(database);

  // List unified tasks
  app.get<{
    Querystring: {
      state?: 'active' | 'recent' | 'all';
      domain?: TaskDomain;
      limit?: string;
    };
  }>('/api/v1/admin/tasks', async (request, reply) => {
    if (config.adminToken && !authenticateAdmin(config.adminToken, request)) return reply.code(401).send({ error: 'unauthorized' });
    const limit = request.query.limit ? Math.min(Math.max(1, parseInt(request.query.limit, 10) || 50), 200) : 50;
    const result = listUnifiedTasks(database, {
      state: request.query.state,
      domain: request.query.domain,
      limit,
    });
    return reply.send(result);
  });

  // Cancel task
  app.post<{
    Params: {
      domain: TaskDomain;
      taskId: string;
    };
  }>('/api/v1/admin/tasks/:domain/:taskId/cancel', async (request, reply) => {
    if (config.adminToken && !authenticateAdmin(config.adminToken, request)) return reply.code(401).send({ error: 'unauthorized' });
    try {
      const result = await cancelUnifiedTask(
        config,
        database,
        secrets,
        store,
        request.params.domain,
        request.params.taskId,
        fetcher,
      );
      return reply.send(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  });

  // Retry task
  app.post<{
    Params: {
      domain: TaskDomain;
      taskId: string;
    };
  }>('/api/v1/admin/tasks/:domain/:taskId/retry', async (request, reply) => {
    if (config.adminToken && !authenticateAdmin(config.adminToken, request)) return reply.code(401).send({ error: 'unauthorized' });
    try {
      const result = await retryUnifiedTask(
        config,
        database,
        secrets,
        store,
        request.params.domain,
        request.params.taskId,
        fetcher,
      );
      return reply.send(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  });
}
