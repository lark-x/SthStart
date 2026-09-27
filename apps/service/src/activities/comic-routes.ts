import { Value } from '@sinclair/typebox/value';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ComicDraftResponseSchema, CreateComicDraftRequestSchema, SaveComicDraftRequestSchema,
  CreateComicRevisionRequestSchema, ComicRevisionListSchema, ComicJobPageSchema,
} from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import type { SecretStore } from '../security.js';
import { ComicStore } from './comic-store.js';
import { registerComicStoryboardRoutes } from './comic-storyboard.js';
import { registerComicRenderRoutes } from './comic-renders.js';
import { registerComicExportRoutes } from './comic-exports.js';

type AdminCheck = (request: FastifyRequest, reply: FastifyReply) => boolean;

function sendError(reply: FastifyReply, error: unknown) {
  const value = error as { code?: string; statusCode?: number; message?: string; issues?: string[] };
  return reply.code(value.statusCode ?? 400).send({ error: value.code ?? 'comic_request_failed', message: value.message ?? '漫画操作失败。', ...(value.issues ? { details: value.issues } : {}) });
}

export function registerComicRoutes(
  app: FastifyInstance, config: ServiceConfig, database: ServiceDatabase, secrets: SecretStore,
  checkAdmin: AdminCheck, fetcher: typeof fetch = fetch,
) {
  const store = new ComicStore(database);

  app.get<{ Params: { activityId: string } }>('/api/v1/admin/activities/:activityId/comic/draft', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const draft = store.getComicDraft(request.params.activityId);
    const response = { draft };
    if (!Value.Check(ComicDraftResponseSchema, response)) return reply.code(500).send({ error: 'comic_response_invalid' });
    return reply.send(response);
  });

  app.post<{ Params: { activityId: string }; Body: unknown }>('/api/v1/admin/activities/:activityId/comic/draft', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    if (!Value.Check(CreateComicDraftRequestSchema, request.body)) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const body = request.body as { contentRevisionId: string };
      const draft = store.createComicDraft(request.params.activityId, body.contentRevisionId);
      return reply.code(201).send({ draft });
    } catch (error) { return sendError(reply, error); }
  });

  app.put<{ Params: { activityId: string }; Body: unknown }>('/api/v1/admin/activities/:activityId/comic/draft', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    if (!Value.Check(SaveComicDraftRequestSchema, request.body)) return reply.code(400).send({ error: 'invalid_request', details: [...Value.Errors(SaveComicDraftRequestSchema, request.body)].map((error) => `${error.path}: ${error.message}`) });
    try {
      const body = request.body as { expectedDraftVersion: number; document: import('@sthstart/contracts').ComicDocument };
      const draft = store.saveComicDraft(request.params.activityId, body.expectedDraftVersion, body.document);
      return reply.send({ draft });
    } catch (error) { return sendError(reply, error); }
  });

  app.post<{ Params: { activityId: string }; Body: unknown }>('/api/v1/admin/activities/:activityId/comic/revisions', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    if (!Value.Check(CreateComicRevisionRequestSchema, request.body)) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const body = request.body as { expectedDraftVersion: number };
      return reply.code(201).send({ revision: store.createComicRevision(request.params.activityId, body.expectedDraftVersion) });
    } catch (error) { return sendError(reply, error); }
  });

  app.get<{ Params: { activityId: string }; Querystring: { cursor?: string; limit?: string } }>('/api/v1/admin/activities/:activityId/comic/revisions', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const result = store.listComicRevisions(request.params.activityId, request.query.cursor, Number(request.query.limit ?? 20));
    if (!Value.Check(ComicRevisionListSchema, result)) return reply.code(500).send({ error: 'comic_response_invalid' });
    return reply.send(result);
  });

  app.get<{ Params: { activityId: string; jobId: string } }>('/api/v1/admin/activities/:activityId/comic/jobs/:jobId', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const job = store.getComicJob(request.params.activityId, request.params.jobId);
    if (!job) return reply.code(404).send({ error: 'comic_job_not_found' });
    return reply.send({ job });
  });

  app.get<{ Params: { activityId: string }; Querystring: { panelId?: string; cursor?: string; limit?: string } }>('/api/v1/admin/activities/:activityId/comic/jobs', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const result = store.listComicJobs(request.params.activityId, request.query.panelId, request.query.cursor, Number(request.query.limit ?? 20));
    if (!Value.Check(ComicJobPageSchema, result)) return reply.code(500).send({ error: 'comic_response_invalid' });
    return reply.send(result);
  });

  registerComicStoryboardRoutes(app, config, database, secrets, checkAdmin, fetcher);
  registerComicRenderRoutes(app, config, database, secrets, checkAdmin, fetcher);
  registerComicExportRoutes(app, config, database, checkAdmin);
}
