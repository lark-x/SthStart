import { Type } from '@sinclair/typebox';
import { ActivityArtStyleWriteSchema, ActivityArtStyleUpdateSchema, ActivityReusablePresetSchema,
  CommitActivityArtDirectionRequestSchema, CommitActivityArtDirectionResponseSchema,
  ActivitySlotVisualPreviewRequestSchema, ActivitySlotVisualPreviewSchema, type ActivitySlotVisualPreviewRequest } from '@sthstart/contracts';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServiceDatabase } from '../database.js';
import type { ActivityStore } from './store.js';
import { listActivityArtStyles, saveActivityArtStyle } from './art-styles.js';
import { commitImageConfigRevision, getImageConfigDraft, saveImageConfigDraft } from './image-configs.js';
import type { ActivityArtStyleWrite, ActivityArtStyleUpdate, CommitActivityArtDirectionRequest } from '@sthstart/contracts';
import { validateArtDirection } from './art-config-validation.js';
import { activityVisualParameterFields, resolveEffectiveActivityVisualPlan } from './image-render-common.js';

export function registerArtDirectionRoutes(app: FastifyInstance, database: ServiceDatabase, store: ActivityStore,
  checkAdmin: (request: FastifyRequest, reply: FastifyReply) => boolean) {
  const failure = (reply: FastifyReply, error: unknown) => {
    const err = error as { code?: string; statusCode?: number; message?: string };
    return reply.code(err.statusCode || 400).send({ error: err.code || 'art_direction_failed', message: err.message || '画风配置操作失败' });
  };
  app.post<{ Params: { id: string }; Body: ActivitySlotVisualPreviewRequest }>('/api/v1/admin/activities/:id/slot-visual-preview', {
    schema: { body: ActivitySlotVisualPreviewRequestSchema, response: { 200: ActivitySlotVisualPreviewSchema } },
  }, async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const content = store.getDraft(request.params.id)?.document;
    if (!content) return reply.code(404).send({ error: 'activity_not_found', message: '活动不存在' });
    const slot = content.mediaSlots.find(slot => slot.id === request.body.slotId);
    if (!slot) return reply.code(404).send({ error: 'slot_not_found', message: '素材槽位不属于此活动' });
    try {
      validateArtDirection(database, request.body.document);
      const settings = request.body.document.slotConfigs.find(item => item.slotId === slot.id);
      const plan = resolveEffectiveActivityVisualPlan(database, { imageConfig: request.body.document, settings: { ...settings, parameters: settings?.params },
        actors: content.actors.filter(actor => slot.actorIds.includes(actor.id)), sourcePrompt: slot.shotDescription || slot.caption || '素材画面', seed: 0 });
      return { workflowId: plan.selection.resolved.workflow.id, workflowVersion: plan.selection.resolved.workflow.version,
        promptAssembly: plan.selection.resolved.workflow.editorConfig?.promptAssembly,
        positivePrompt: plan.visual.finalPositivePrompt ?? String(plan.parameters[plan.positiveKey] ?? ''),
        promptOptimization: { enabled: plan.promptPolicy.enabled },
        fields: activityVisualParameterFields(plan.selection.resolved, plan.parameters), parameters: plan.parameters,
        quality: plan.visual.quality, canvas: request.body.document.artDirection?.canvas ?? null };
    } catch (error) { return failure(reply, error); }
  });
  app.get('/api/v1/admin/activity-art-styles', {
    schema: { response: { 200: Type.Object({ items: Type.Array(ActivityReusablePresetSchema) }) } },
  }, async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    return { items: listActivityArtStyles(database) };
  });
  app.post<{ Body: ActivityArtStyleWrite }>('/api/v1/admin/activity-art-styles', {
    schema: { body: ActivityArtStyleWriteSchema, response: { 201: ActivityReusablePresetSchema } },
  }, async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    try { return reply.code(201).send(saveActivityArtStyle(database, request.body)); }
    catch (error) { return failure(reply, error); }
  });
  app.put<{ Params: { id: string }; Body: ActivityArtStyleUpdate }>('/api/v1/admin/activity-art-styles/:id', {
    schema: { body: ActivityArtStyleUpdateSchema, response: { 200: ActivityReusablePresetSchema } },
  }, async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    try { return saveActivityArtStyle(database, request.body, { id: request.params.id, expectedVersion: request.body.expectedVersion }); }
    catch (error) { return failure(reply, error); }
  });
  app.post<{ Params: { id: string }; Body: CommitActivityArtDirectionRequest }>(
    '/api/v1/admin/activities/:id/art-direction/commit', {
      schema: { body: CommitActivityArtDirectionRequestSchema, response: { 200: CommitActivityArtDirectionResponseSchema } },
    }, async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      if (!store.getActivity(request.params.id)) return reply.code(404).send({ error: 'activity_not_found', message: '活动不存在' });
      try {
        return database.transaction(() => {
          const draft = saveImageConfigDraft(database, request.params.id, request.body.expectedImageConfigDraftVersion, request.body.document, { skipTransaction: true });
          const result = commitImageConfigRevision(database, store, request.params.id, draft.draftVersion, request.body.expectedHeadVersion, { skipTransaction: true });
          return { ...result, draft: getImageConfigDraft(database, request.params.id) };
        });
      } catch (error) { return failure(reply, error); }
    });
}
