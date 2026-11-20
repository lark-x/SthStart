import type { FastifyInstance } from 'fastify';
import { RecentWorkQuerySchema, RecentWorkResponseSchema, type RecentWorkResponse } from '@sthstart/contracts';
import type { ServiceDatabase } from './database.js';

export function registerWorkspaceRoutes(app: FastifyInstance, database: ServiceDatabase) {
  app.get<{ Querystring: { limit?: number } }>('/api/v1/admin/workspace/recent', {
    schema: { querystring: RecentWorkQuerySchema, response: { 200: RecentWorkResponseSchema } },
  }, async (request): Promise<RecentWorkResponse> => {
    const hasTable = (name: string) => Boolean(
      database.connection.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name),
    );
    const hasWorlds = hasTable('sw_worlds');
    const hasBindings = hasTable('sw_project_bindings');

    const worldSelect = hasWorlds
      ? `
        UNION ALL
        SELECT w.id, COALESCE(json_extract(w.data_json, '$.title'), '未命名作品') AS title, 'world' AS kind,
          ${hasBindings
            ? `MAX(w.updated_at, COALESCE((SELECT MAX(d.updated_at) FROM sw_project_bindings b JOIN story_documents d ON d.project_id = b.project_id WHERE b.world_id = w.id), w.updated_at))`
            : 'w.updated_at'
          } AS updatedAt, w.cover_artifact_id AS imageArtifactId
          FROM sw_worlds w`
      : '';

    const storyFilter = hasBindings
      ? "WHERE project_type='fiction' AND NOT EXISTS (SELECT 1 FROM sw_project_bindings b WHERE b.project_id=p.id)"
      : "WHERE project_type='fiction'";

    const items = database.connection.prepare(`
      SELECT id,title,kind,updatedAt,imageArtifactId FROM (
        SELECT id,title,CASE WHEN type='publication' THEN 'publication' ELSE 'activity' END AS kind,updated_at AS updatedAt,cover_artifact_id AS imageArtifactId FROM activities WHERE archived=0
        ${worldSelect}
        UNION ALL
        SELECT p.id,p.title,'story' AS kind,MAX(p.updated_at,
          COALESCE((SELECT MAX(updated_at) FROM story_documents WHERE project_id=p.id),p.updated_at),
          COALESCE((SELECT MAX(updated_at) FROM story_characters WHERE project_id=p.id),p.updated_at),
          COALESCE((SELECT MAX(captured_at) FROM project_links WHERE project_id=p.id),p.updated_at)) AS updatedAt,p.cover_artifact_id AS imageArtifactId
          FROM story_projects p ${storyFilter}
        UNION ALL
        SELECT id,title,'note' AS kind,updated_at AS updatedAt,NULL AS imageArtifactId FROM creative_notes
        UNION ALL
        SELECT c.id,c.display_name AS title,'character' AS kind,c.updated_at AS updatedAt,
          (SELECT a.artifact_id FROM character_assets a WHERE a.id=COALESCE(c.avatar_asset_id,c.portrait_asset_id)) AS imageArtifactId
          FROM character_profiles c WHERE c.archived=0
      ) ORDER BY updatedAt DESC,kind,id LIMIT ?
    `).all(request.query.limit ?? 8) as RecentWorkResponse['items'];
    return { items };
  });
}
