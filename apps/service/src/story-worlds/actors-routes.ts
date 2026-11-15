import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import {
  PromoteWorldActorSchema, WorldActorPromotionResultSchema, type PromoteWorldActor,
} from '@sthstart/contracts';
import { authenticateAdmin } from '../access.js';
import type { ServiceConfig } from '../config.js';
import { StoryWorldActorService } from './actors.js';
import type { StoryWorldStore } from './store.js';

const key = Type.String({ minLength: 1, maxLength: 160 });
const actorParams = Type.Object({ worldId: key, branchId: key, actorId: key }, { additionalProperties: false });
type ActorParams = Static<typeof actorParams>;
const path = '/api/v1/admin/story-worlds/:worldId/branches/:branchId/actors/:actorId/promote';

export function registerStoryWorldActorRoutes(app: FastifyInstance, config: ServiceConfig, store: StoryWorldStore) {
  const service = new StoryWorldActorService(store);
  const guard = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.adminToken) return reply.code(503).send({ error: 'admin_not_configured' });
    if (!authenticateAdmin(config.adminToken, request)) return reply.code(401).send({ error: 'unauthorized' });
  };
  const handle = async <T>(reply: FastifyReply, operation: () => T | Promise<T>) => {
    try { return await operation(); }
    catch (error) {
      const failure = error as { statusCode?: number; code?: string; message?: string };
      if (failure.statusCode && failure.statusCode >= 400 && failure.statusCode <= 599) {
        return reply.code(failure.statusCode).send({ error: failure.code ?? 'story_actor_failed', message: failure.message });
      }
      throw error;
    }
  };
  app.post<{ Params: ActorParams; Body: PromoteWorldActor }>(path, {
    preHandler: guard,
    schema: { params: actorParams, body: PromoteWorldActorSchema, response: { 200: WorldActorPromotionResultSchema } },
  }, (request, reply) => handle(reply, () => service.promote(
    request.params.worldId, request.params.branchId, request.params.actorId, request.body,
  )));
}
