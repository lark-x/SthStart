import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import {
  CreateStoryWorldSchema, UpdateStoryWorldSchema, WorldListSchema, StoryWorldSchema,
  WorldOverviewSchema, CreateWorldBranchSchema, WorldBranchSchema, WorldBranchDetailSchema,
  WorldEventQuerySchema, WorldEventPageSchema, WorldMemoryListSchema,
  CreateWorldStoryLineSchema, WorldStoryLineSchema, CreateWorldInterventionSchema, WorldInterventionSchema,
  StartWorldRunSchema, WorldRunSchema, WorldRevisionRequestSchema, ResumeWorldRunSchema,
  PlanWorldImagesSchema, WorldImageListSchema, SubmitWorldImageSchema, WorldImageSchema,
  WorldAdoptionSchema, WorldAdoptionResultSchema,
  BindWorldProjectSchema, WorldProjectBindingSchema, type BindWorldProject, type WorldProjectBinding,
  type WorldDefinition, type CreateWorldBranch, type WorldEventQuery, type CreateWorldStoryLine,
  type CreateWorldIntervention, type StartWorldRun, type WorldRun, type PlanWorldImages,
  type SubmitWorldImage, type WorldImage, type WorldAdoption, type WorldAdoptionResult, type WorldRunSettings, type ResumeWorldRun,
} from '@sthstart/contracts';
import {
  CreateWorldBundleSchema, WorldBundleResultSchema, UpdateWorldBranchSchema,
  type CreateWorldBundle, type UpdateWorldBranch,
  CreateWorldSetupSchema, UpdateWorldSetupSchema, WorldSetupSummarySchema, WorldSetupListSchema, WorldSetupSchema,
  WorldSetupResultSchema, type CreateWorldSetup, type UpdateWorldSetup,
  WorldHubSchema, WorldMcpLookupRequestSchema, WorldMcpLookupResponseSchema,
  WorldMcpReadRequestSchema, WorldMcpReadResponseSchema,
  WorldManuscriptCreateDocSchema, WorldManuscriptSaveDocSchema, WorldManuscriptDocResponseSchema,
  WorldManuscriptDeleteQuerySchema, WorldManuscriptDeleteResponseSchema,
  WorldChapterCopilotRequestSchema, WorldChapterCopilotResponseSchema,
  type WorldHub, type WorldMcpLookupRequest, type WorldMcpLookupResponse,
  type WorldMcpReadRequest, type WorldMcpReadResponse,
  type WorldManuscriptCreateDoc, type WorldManuscriptSaveDoc, type WorldManuscriptDocResponse,
  type WorldManuscriptDeleteQuery, type WorldManuscriptDeleteResponse,
  type WorldChapterCopilotRequest, type WorldChapterCopilotResponse,
} from '@sthstart/contracts';
import {
  RefreshWorldSourcesSchema, WorldSourceUpdatePreviewSchema, type RefreshWorldSources,
} from '@sthstart/contracts';
import { authenticateAdmin } from '../access.js';
import type { ServiceConfig } from '../config.js';
import { StoryWorldSourceUpdates } from './source-updates.js';
import type { StoryWorldStore } from './store.js';

/** Explicit adapters keep route validation independent of the scheduler's lifecycle. */
export interface WorldRouteServices {
  store: StoryWorldStore;
  runtime: {
    start(worldId: string, branchId: string, input: StartWorldRun): WorldRun | Promise<WorldRun>;
    pause(worldId: string, branchId: string, runId: string, revision: number): WorldRun | Promise<WorldRun>;
    cancel?(worldId: string, branchId: string, runId: string, revision: number): WorldRun | Promise<WorldRun>;
    resume(worldId: string, branchId: string, runId: string, revision: number, settings?: WorldRunSettings): WorldRun | Promise<WorldRun>;
  };
  images: {
    plan(worldId: string, branchId: string, input: PlanWorldImages): { items: WorldImage[] } | Promise<{ items: WorldImage[] }>;
    submit(worldId: string, branchId: string, imageId: string, input: SubmitWorldImage): WorldImage | Promise<WorldImage>;
    sync?(worldId: string, branchId: string): unknown | Promise<unknown>;
  };
  adopt(worldId: string, branchId: string, input: WorldAdoption): WorldAdoptionResult | Promise<WorldAdoptionResult>;
  bindProject?(
    projectId: string, worldId: string, branchId: string, expectedRevision: number,
    expectedBinding?: WorldProjectBinding | null,
  ): WorldProjectBinding;
  getProjectBinding?(projectId: string): WorldProjectBinding | null;
  hub?(worldId: string, branchId?: string): WorldHub | Promise<WorldHub>;
  mcpLookup?(worldId: string, input: WorldMcpLookupRequest): Promise<WorldMcpLookupResponse>;
  mcpRead?(worldId: string, input: WorldMcpReadRequest): Promise<WorldMcpReadResponse>;
  createManuscriptDoc?(worldId: string, input: WorldManuscriptCreateDoc): WorldManuscriptDocResponse | Promise<WorldManuscriptDocResponse>;
  saveManuscriptDoc?(worldId: string, docId: string, input: WorldManuscriptSaveDoc): WorldManuscriptDocResponse | Promise<WorldManuscriptDocResponse>;
  deleteManuscriptDoc?(worldId: string, docId: string, projectId?: string): WorldManuscriptDeleteResponse | Promise<WorldManuscriptDeleteResponse>;
  copilot?(worldId: string, input: WorldChapterCopilotRequest): Promise<WorldChapterCopilotResponse>;
}
const key = Type.String({ minLength: 1, maxLength: 160 });
const worldParams = Type.Object({ worldId: key });
const docParams = Type.Object({ worldId: key, docId: key });
const branchParams = Type.Object({ worldId: key, branchId: key });
const runParams = Type.Object({ ...branchParams.properties, runId: key });
const imageParams = Type.Object({ ...branchParams.properties, imageId: key });
type WorldParams = Static<typeof worldParams>;
type DocParams = Static<typeof docParams>;
type BranchParams = Static<typeof branchParams>;
type Revision = Static<typeof WorldRevisionRequestSchema>;
const root = '/api/v1/admin/story-worlds';
const worldPath = root + '/:worldId';
const branchPath = worldPath + '/branches/:branchId';

export function registerStoryWorldRoutes(app: FastifyInstance, config: ServiceConfig, services: WorldRouteServices) {
  const { store, runtime, images } = services;
  const sourceUpdates = new StoryWorldSourceUpdates(store);
  const guard = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.adminToken) return reply.code(503).send({ error: 'admin_not_configured' });
    if (!authenticateAdmin(config.adminToken, request)) return reply.code(401).send({ error: 'unauthorized' });
  };
  const handle = async <T>(reply: FastifyReply, operation: () => T | Promise<T>) => {
    try { return await operation(); }
    catch (error) {
      const failure = error as { statusCode?: number; code?: string; message?: string };
      if (failure.statusCode && failure.statusCode >= 400 && failure.statusCode <= 599) {
        return reply.code(failure.statusCode).send({ error: failure.code ?? 'story_world_failed', message: failure.message });
      }
      throw error;
    }
  };
  app.get(root, { preHandler: guard, schema: { response: { 200: WorldListSchema } } }, () => store.list());
  app.get(root + '/setups', { preHandler: guard, schema: { response: { 200: WorldSetupListSchema } } }, () => store.listSetups());
  app.post<{ Body: CreateWorldSetup }>(root + '/setups', {
    preHandler: guard, schema: { body: CreateWorldSetupSchema, response: { 201: WorldSetupSummarySchema } },
  }, (req, reply) => handle(reply, () => reply.code(201).send(store.createSetup(req.body))));
  app.get<{ Params: WorldParams }>(root + '/setups/:worldId', {
    preHandler: guard, schema: { params: worldParams, response: { 200: WorldSetupSchema } },
  }, (req, reply) => handle(reply, () => store.getSetup(req.params.worldId)));
  app.put<{ Params: WorldParams; Body: UpdateWorldSetup }>(root + '/setups/:worldId', {
    preHandler: guard, schema: { params: worldParams, body: UpdateWorldSetupSchema, response: { 200: WorldSetupResultSchema } },
  }, (req, reply) => handle(reply, () => store.saveSetup(req.params.worldId, req.body)));
  app.get<{ Params: { projectId: string } }>(root + '/project-bindings/:projectId', {
    preHandler: guard, schema: { params: Type.Object({ projectId: key }), response: { 200: Type.Object({ binding: Type.Union([WorldProjectBindingSchema, Type.Null()]) }) } },
  }, (req, reply) => handle(reply, () => ({ binding: services.getProjectBinding?.(req.params.projectId) ?? null })));
  app.post<{ Body: WorldDefinition }>(root, {
    preHandler: guard, schema: { body: CreateStoryWorldSchema, response: { 201: StoryWorldSchema } },
  }, (req, reply) => handle(reply, () => reply.code(201).send(store.create(req.body))));
  app.post<{ Body: CreateWorldBundle }>(root + '/create-bundle', {
    preHandler: guard, schema: { body: CreateWorldBundleSchema, response: { 201: WorldBundleResultSchema } },
  }, (req, reply) => handle(reply, () => reply.code(201).send(store.createBundle(req.body))));
  app.get<{ Params: WorldParams }>(worldPath, {
    preHandler: guard, schema: { params: worldParams, response: { 200: WorldOverviewSchema } },
  }, (req, reply) => handle(reply, () => store.overview(req.params.worldId)));
  app.get<{ Params: WorldParams; Querystring: { branchId?: string } }>(worldPath + '/hub', {
    preHandler: guard,
    schema: {
      params: worldParams,
      querystring: Type.Object({ branchId: Type.Optional(key) }, { additionalProperties: false }),
      response: { 200: WorldHubSchema },
    },
  }, (req, reply) => handle(reply, () => {
    if (!services.hub) return reply.code(503).send({ error: 'world_hub_unavailable' });
    return services.hub(req.params.worldId, req.query.branchId);
  }));
  app.post<{ Params: WorldParams; Body: WorldMcpLookupRequest }>(worldPath + '/mcp-lookup', {
    preHandler: guard,
    schema: {
      params: worldParams,
      body: WorldMcpLookupRequestSchema,
      response: { 200: WorldMcpLookupResponseSchema },
    },
  }, (req, reply) => handle(reply, () => {
    if (!services.mcpLookup) {
      throw Object.assign(new Error('MCP 检索服务未就绪。'), {
        statusCode: 503,
        code: 'world_mcp_lookup_unavailable',
      });
    }
    return services.mcpLookup(req.params.worldId, req.body);
  }));
  app.post<{ Params: WorldParams; Body: WorldMcpReadRequest }>(worldPath + '/mcp-read', {
    preHandler: guard,
    schema: {
      params: worldParams,
      body: WorldMcpReadRequestSchema,
      response: { 200: WorldMcpReadResponseSchema },
    },
  }, (req, reply) => handle(reply, () => {
    if (!services.mcpRead) {
      throw Object.assign(new Error('MCP 原文读取服务未就绪。'), {
        statusCode: 503,
        code: 'world_mcp_read_unavailable',
      });
    }
    return services.mcpRead(req.params.worldId, req.body);
  }));
  app.post<{ Params: WorldParams; Body: WorldManuscriptCreateDoc }>(worldPath + '/manuscript/documents', {
    preHandler: guard,
    schema: {
      params: worldParams,
      body: WorldManuscriptCreateDocSchema,
      response: { 201: WorldManuscriptDocResponseSchema },
    },
  }, (req, reply) => handle(reply, async () => {
    if (!services.createManuscriptDoc) {
      throw Object.assign(new Error('作品手稿服务未就绪。'), {
        statusCode: 503,
        code: 'world_manuscript_unavailable',
      });
    }
    const created = await services.createManuscriptDoc(req.params.worldId, req.body);
    return reply.code(201).send(created);
  }));
  app.put<{ Params: DocParams; Body: WorldManuscriptSaveDoc }>(worldPath + '/manuscript/documents/:docId', {
    preHandler: guard,
    schema: {
      params: docParams,
      body: WorldManuscriptSaveDocSchema,
      response: { 200: WorldManuscriptDocResponseSchema },
    },
  }, (req, reply) => handle(reply, () => {
    if (!services.saveManuscriptDoc) {
      throw Object.assign(new Error('作品手稿服务未就绪。'), {
        statusCode: 503,
        code: 'world_manuscript_unavailable',
      });
    }
    return services.saveManuscriptDoc(req.params.worldId, req.params.docId, req.body);
  }));
  app.delete<{ Params: DocParams; Querystring: WorldManuscriptDeleteQuery }>(worldPath + '/manuscript/documents/:docId', {
    preHandler: guard,
    schema: {
      params: docParams,
      querystring: WorldManuscriptDeleteQuerySchema,
      response: { 200: WorldManuscriptDeleteResponseSchema },
    },
  }, (req, reply) => handle(reply, () => {
    if (!services.deleteManuscriptDoc) {
      throw Object.assign(new Error('作品手稿服务未就绪。'), {
        statusCode: 503,
        code: 'world_manuscript_unavailable',
      });
    }
    return services.deleteManuscriptDoc(req.params.worldId, req.params.docId, req.query.projectId);
  }));
  app.post<{ Params: WorldParams; Body: WorldChapterCopilotRequest }>(worldPath + '/copilot', {
    preHandler: guard,
    schema: {
      params: worldParams,
      body: WorldChapterCopilotRequestSchema,
      response: { 200: WorldChapterCopilotResponseSchema },
    },
  }, (req, reply) => handle(reply, () => {
    if (!services.copilot) {
      throw Object.assign(new Error('章节写作助手服务未就绪。'), {
        statusCode: 503,
        code: 'world_copilot_unavailable',
      });
    }
    return services.copilot(req.params.worldId, req.body);
  }));
  app.put<{ Params: WorldParams; Body: Static<typeof UpdateStoryWorldSchema> }>(worldPath, {
    preHandler: guard, schema: { params: worldParams, body: UpdateStoryWorldSchema, response: { 200: StoryWorldSchema } },
  }, (req, reply) => handle(reply, () => store.updateWorld(req.params.worldId, req.body)));
  app.post<{ Params: WorldParams; Body: CreateWorldBranch }>(worldPath + '/branches', {
    preHandler: guard, schema: { params: worldParams, body: CreateWorldBranchSchema, response: { 201: WorldBranchSchema } },
  }, (req, reply) => handle(reply, () => reply.code(201).send(store.createBranch(req.params.worldId, req.body))));
  app.put<{ Params: BranchParams; Body: UpdateWorldBranch }>(branchPath, {
    preHandler: guard, schema: { params: branchParams, body: UpdateWorldBranchSchema, response: { 200: WorldBranchSchema } },
  }, (req, reply) => handle(reply, () => store.updateBranch(req.params.worldId, req.params.branchId, req.body)));
  app.get<{ Params: BranchParams }>(branchPath, {
    preHandler: guard, schema: { params: branchParams, response: { 200: WorldBranchDetailSchema } },
  }, (req, reply) => handle(reply, async () => {
    store.getBranch(req.params.worldId, req.params.branchId);
    await images.sync?.(req.params.worldId, req.params.branchId);
    return store.detail(req.params.worldId, req.params.branchId);
  }));
  app.get<{ Params: BranchParams; Querystring: WorldEventQuery }>(branchPath + '/events', {
    preHandler: guard, schema: { params: branchParams, querystring: WorldEventQuerySchema, response: { 200: WorldEventPageSchema } },
  }, (req, reply) => handle(reply, () => store.events(req.params.worldId, req.params.branchId, req.query)));
  app.get<{ Params: BranchParams; Querystring: { actorId?: string } }>(branchPath + '/memories', {
    preHandler: guard, schema: { params: branchParams, querystring: Type.Object({ actorId: Type.Optional(key) }, { additionalProperties: false }), response: { 200: WorldMemoryListSchema } },
  }, (req, reply) => handle(reply, () => store.memories(req.params.worldId, req.params.branchId, req.query.actorId)));
  app.post<{ Params: BranchParams; Body: CreateWorldStoryLine }>(branchPath + '/story-lines', {
    preHandler: guard, schema: { params: branchParams, body: CreateWorldStoryLineSchema, response: { 201: WorldStoryLineSchema } },
  }, (req, reply) => handle(reply, () => reply.code(201).send(store.addStoryLine(req.params.worldId, req.params.branchId, req.body))));
  app.post<{ Params: BranchParams; Body: CreateWorldIntervention }>(branchPath + '/interventions', {
    preHandler: guard, schema: { params: branchParams, body: CreateWorldInterventionSchema, response: { 201: WorldInterventionSchema } },
  }, (req, reply) => handle(reply, () => reply.code(201).send(store.intervene(req.params.worldId, req.params.branchId, req.body))));
  app.post<{ Params: BranchParams; Body: StartWorldRun }>(branchPath + '/runs', {
    preHandler: guard, schema: { params: branchParams, body: StartWorldRunSchema, response: { 200: WorldRunSchema } },
  }, (req, reply) => handle(reply, () => runtime.start(req.params.worldId, req.params.branchId, req.body)));
  for (const action of ['pause', 'resume'] as const) {
    app.post<{ Params: Static<typeof runParams>; Body: ResumeWorldRun }>(branchPath + '/runs/:runId/' + action, {
      preHandler: guard, schema: { params: runParams, body: action === 'resume' ? ResumeWorldRunSchema : WorldRevisionRequestSchema, response: { 200: WorldRunSchema } },
    }, (req, reply) => handle(reply, () => action === 'resume'
      ? runtime.resume(req.params.worldId, req.params.branchId, req.params.runId, req.body.expectedRevision, req.body.settings)
      : runtime.pause(req.params.worldId, req.params.branchId, req.params.runId, req.body.expectedRevision)));
  }
  app.post<{ Params: Static<typeof runParams>; Body: Revision }>(branchPath + '/runs/:runId/cancel', {
    preHandler: guard, schema: { params: runParams, body: WorldRevisionRequestSchema, response: { 200: WorldRunSchema } },
  }, (req, reply) => handle(reply, () => {
    if (!runtime.cancel) return reply.code(503).send({ error: 'run_cancel_unavailable' });
    return runtime.cancel(req.params.worldId, req.params.branchId, req.params.runId, req.body.expectedRevision);
  }));
  app.post<{ Params: BranchParams; Body: RefreshWorldSources }>(branchPath + '/sources/refresh', {
    preHandler: guard, schema: { params: branchParams, body: RefreshWorldSourcesSchema, response: { 200: WorldBranchDetailSchema } },
  }, (req, reply) => handle(reply, () => store.refreshSources(
    req.params.worldId,
    req.params.branchId,
    req.body.expectedRevision,
    req.body.expectedWorldRevision,
  )));
  app.get<{ Params: BranchParams }>(branchPath + '/sources/preview', {
    preHandler: guard, schema: { params: branchParams, response: { 200: WorldSourceUpdatePreviewSchema } },
  }, (req, reply) => handle(reply, () => sourceUpdates.preview(req.params.worldId, req.params.branchId)));
  app.post<{ Params: BranchParams; Body: PlanWorldImages }>(branchPath + '/images/plan', {
    preHandler: guard, schema: { params: branchParams, body: PlanWorldImagesSchema, response: { 200: WorldImageListSchema } },
  }, (req, reply) => handle(reply, () => images.plan(req.params.worldId, req.params.branchId, req.body)));
  app.post<{ Params: Static<typeof imageParams>; Body: SubmitWorldImage }>(branchPath + '/images/:imageId/submit', {
    preHandler: guard, schema: { params: imageParams, body: SubmitWorldImageSchema, response: { 200: WorldImageSchema } },
  }, (req, reply) => handle(reply, () => images.submit(req.params.worldId, req.params.branchId, req.params.imageId, req.body)));
  app.post<{ Params: BranchParams; Body: WorldAdoption }>(branchPath + '/adopt', {
    preHandler: guard, schema: { params: branchParams, body: WorldAdoptionSchema, response: { 200: WorldAdoptionResultSchema } },
  }, (req, reply) => handle(reply, () => services.adopt(req.params.worldId, req.params.branchId, req.body)));
  app.post<{ Params: BranchParams; Body: BindWorldProject }>(branchPath + '/project-binding', {
    preHandler: guard, schema: { params: branchParams, body: BindWorldProjectSchema, response: { 200: WorldProjectBindingSchema } },
  }, (req, reply) => handle(reply, () => {
    if (!services.bindProject) return reply.code(503).send({ error: 'project_binding_unavailable' });
    return services.bindProject(
      req.body.projectId, req.params.worldId, req.params.branchId, req.body.expectedRevision,
      req.body.expectedBinding,
    );
  }));
}
