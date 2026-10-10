import type { FastifyInstance } from 'fastify';
import { RecentWorkQuerySchema, RecentWorkResponseSchema, type RecentWorkResponse } from '@sthstart/contracts';
import type { ServiceDatabase } from './database.js';

export function registerWorkspaceRoutes(app: FastifyInstance, database: ServiceDatabase) {
  app.get<{ Querystring: { limit?: number } }>('/api/v1/admin/workspace/recent', {
    schema: { querystring: RecentWorkQuerySchema, response: { 200: RecentWorkResponseSchema } },
  }, async (request): Promise<RecentWorkResponse> => {
    const items = database.connection.prepare(`
      SELECT id,title,kind,updatedAt FROM (
        SELECT id,title,'activity' AS kind,updated_at AS updatedAt FROM activities WHERE archived=0
        UNION ALL
        SELECT id,title,'note' AS kind,updated_at AS updatedAt FROM creative_notes
        UNION ALL
        SELECT id,display_name AS title,'character' AS kind,updated_at AS updatedAt FROM character_profiles WHERE archived=0
      ) ORDER BY updatedAt DESC,kind,id LIMIT ?
    `).all(request.query.limit ?? 8) as RecentWorkResponse['items'];
    return { items };
  });
}
