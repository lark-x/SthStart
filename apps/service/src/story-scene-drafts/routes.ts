import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { FastifyInstance } from 'fastify';
import {
  CreateStorySceneDraftSchema, PatchStorySceneDraftSchema, StorySceneActionRequestSchema,
  type CreateStorySceneDraft, type PatchStorySceneDraft, type StorySceneActionRequest,
} from '@sthstart/contracts';
import { authenticateAdmin } from '../access.js';
import type { ServiceConfig } from '../config.js';
import type { StorySceneService } from './service.js';
import { SceneDraftError } from './store.js';

const params = Type.Object({ id: Type.String({ minLength: 1, maxLength: 200 }) });
const querystring = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
}, { additionalProperties: false });
type Params = Static<typeof params>;

export function registerStorySceneDraftRoutes(app: FastifyInstance, config: ServiceConfig, service: StorySceneService) {
  void app.register(async routes => {
    routes.addHook('onRequest', async (request, reply) => {
      if (!config.adminToken) return reply.code(503).send({ error: 'admin_not_configured', message: '管理员访问未配置。' });
      if (!authenticateAdmin(config.adminToken, request)) return reply.code(401).send({ error: 'unauthorized', message: '需要管理员权限。' });
    });
    routes.setErrorHandler((error, request, reply) => {
      if (error instanceof SceneDraftError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      if (error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500) {
        return reply.code(error.statusCode).send({ error: 'invalid_scene_request', message: '草稿请求格式无效。' });
      }
      request.log.error({ code: 'story_scene_route_failed' }, 'Story scene draft API failed');
      return reply.code(500).send({ error: 'scene_service_failed', message: '草稿暂时无法访问。' });
    });

    routes.post<{ Body: CreateStorySceneDraft }>('/', async (request, reply) => {
      // Validate the original JSON: Fastify's default AJV can strip fields from union branches.
      if (!Value.Check(CreateStorySceneDraftSchema, request.body)) throw new SceneDraftError('invalid_scene_create', '请提供有效的角色或变体起点。');
      return reply.code(201).send(service.store.create(request.body));
    });
    routes.get<{ Querystring: Static<typeof querystring> }>('/', { schema: { querystring } }, request =>
      service.store.list(request.query.limit ?? 20, request.query.cursor));
    routes.get<{ Params: Params }>('/:id', { schema: { params } }, request => service.get(request.params.id));
    routes.patch<{ Params: Params; Body: PatchStorySceneDraft }>('/:id', { schema: { params } }, request => {
      if (!Value.Check(PatchStorySceneDraftSchema, request.body)) throw new SceneDraftError('invalid_scene_patch', '请检查要保存的草稿字段。');
      return service.store.patch(request.params.id, request.body);
    });
    routes.post<{ Params: Params; Body: StorySceneActionRequest }>('/:id/actions', { schema: { params } }, async (request, reply) => {
      if (!Value.Check(StorySceneActionRequestSchema, request.body)) throw new SceneDraftError('invalid_scene_action', '请检查操作参数。');
      const result = await service.run(request.params.id, request.body);
      return reply.code(['running', 'queued'].includes(result.action.status) ? 202 : 200).send(result);
    });
  }, { prefix: '/api/v1/admin/story-scene-drafts' });
}
