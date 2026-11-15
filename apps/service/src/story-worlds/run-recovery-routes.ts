import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ResolveWorldRunCallSchema, WorldRunRecoveryListSchema, WorldRunRecoveryResultSchema, type ResolveWorldRunCall } from '@sthstart/contracts';
import { authenticateAdmin } from '../access.js';
import type { ServiceConfig } from '../config.js';
import type { StoryWorldRuntime } from './runtime.js';

const id = Type.String({ minLength: 1, maxLength: 160 });
const runParams = Type.Object({ worldId: id, branchId: id, runId: id }, { additionalProperties: false });
const callParams = Type.Object({ ...runParams.properties, callId: id }, { additionalProperties: false });
interface Params { worldId: string; branchId: string; runId: string; callId: string }
/** Register separately from the core routes. Every operation requires admin auth. */
export function registerStoryWorldRunRecoveryRoutes(app: FastifyInstance, config: ServiceConfig, runtime: Pick<StoryWorldRuntime, 'recovery' | 'resolveCall'>) {
  const guard = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.adminToken) return reply.code(503).send({ error: 'admin_not_configured' });
    if (!authenticateAdmin(config.adminToken, request)) return reply.code(401).send({ error: 'unauthorized' });
  };
  const handle = (reply: FastifyReply, fn: () => unknown) => {
    try { return fn(); }
    catch (e) {
      const failure = e as { statusCode?: number; code?: string; message?: string };
      if (failure.statusCode && failure.statusCode >= 400 && failure.statusCode <= 599) return reply.code(failure.statusCode).send({ error: failure.code ?? 'story_recovery_failed', message: failure.message });
      throw e;
    }
  };
  const path = '/api/v1/admin/story-worlds/:worldId/branches/:branchId/runs/:runId/recovery';
  app.get<{ Params: Params }>(path, { preHandler: guard, schema: { params: runParams, response: { 200: WorldRunRecoveryListSchema } } },
    (request, reply) => handle(reply, () => runtime.recovery(request.params.worldId, request.params.branchId, request.params.runId)));
  app.post<{ Params: Params; Body: ResolveWorldRunCall }>(path + '/:callId', { preHandler: guard,
    schema: { params: callParams, body: ResolveWorldRunCallSchema, response: { 200: WorldRunRecoveryResultSchema } } },
  (request, reply) => handle(reply, () => runtime.resolveCall(request.params.worldId, request.params.branchId, request.params.runId, request.params.callId, request.body)));
}
