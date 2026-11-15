import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  WorldSuggestionRequestSchema, WorldSuggestionResponseSchema,
  type WorldSuggestionRequest,
} from '@sthstart/contracts';
import { authenticateAdmin } from '../access.js';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import type { SecretStore } from '../security.js';
import { suggestWorldFields } from './suggestions.js';

export interface WorldSuggestionRouteOptions {
  config: ServiceConfig;
  database: ServiceDatabase;
  secrets: SecretStore;
  fetcher?: typeof fetch;
}

const path = '/api/v1/admin/story-worlds/suggestions';

export function registerWorldSuggestionRoutes(app: FastifyInstance, options: WorldSuggestionRouteOptions) {
  const guard = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!options.config.adminToken) return reply.code(503).send({ error: 'admin_not_configured' });
    if (!authenticateAdmin(options.config.adminToken, request)) return reply.code(401).send({ error: 'unauthorized' });
  };
  const handle = async <T>(reply: FastifyReply, operation: () => T | Promise<T>) => {
    try {
      return await operation();
    } catch (error) {
      const failure = error as { statusCode?: number; code?: string; message?: string };
      if (failure.statusCode && failure.statusCode >= 400 && failure.statusCode <= 599) {
        return reply.code(failure.statusCode).send({
          error: failure.code ?? 'world_suggestion_failed',
          message: failure.message,
        });
      }
      throw error;
    }
  };
  app.post<{ Body: WorldSuggestionRequest }>(path, {
    preHandler: guard,
    schema: {
      body: WorldSuggestionRequestSchema,
      response: { 200: WorldSuggestionResponseSchema },
    },
  }, (request, reply) => handle(reply, () => suggestWorldFields(request.body, options)));
}
