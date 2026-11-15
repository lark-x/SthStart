import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  GenerationRecoveryListQuery,
  GenerationRecoveryResolveRequest,
  GenerationRecoveryTask,
  GenerationTaskDescriptor,
} from '@sthstart/contracts';
import {
  GenerationRecoveryListQuerySchema,
  GenerationRecoveryListResponseSchema,
  GenerationRecoveryResolveRequestSchema,
  GenerationRecoveryResolveResponseSchema,
} from '@sthstart/contracts';
import { authenticateAdmin } from '../access.js';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { confirmGenerationTaskUncertainOutcome, listUncertainGenerationTasks } from './execution.js';

function recoveryTask(task: GenerationTaskDescriptor): GenerationRecoveryTask {
  return {
    id: task.id,
    appId: task.appId,
    engineId: task.engineId,
    workflowId: task.workflowId,
    workflowVersion: task.workflowVersion,
    purpose: task.purpose,
    status: task.status,
    ...(task.priority ? { priority: task.priority } : {}),
    ...(task.progress ? {
      progress: {
        value: task.progress.value ?? null,
        stage: task.progress.stage,
        ...(task.progress.message !== undefined ? { message: task.progress.message } : {}),
        ...(task.progress.current !== undefined ? { current: task.progress.current } : {}),
        ...(task.progress.total !== undefined ? { total: task.progress.total } : {}),
        ...(task.progress.source !== undefined ? { source: task.progress.source } : {}),
      },
    } : {}),
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    upstreamMayContinue: task.upstreamMayContinue,
    cancellationScope: task.cancellationScope,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    finishedAt: task.finishedAt,
  };
}

/**
 * Admin-only recovery endpoints for tasks whose upstream outcome is unknown.
 * Resolution requires both an explicit operator confirmation and a note; an
 * active or already-resolved task is rejected instead of simply releasing it.
 */
export function registerGenerationRecoveryRoutes(
  app: FastifyInstance,
  config: ServiceConfig,
  database: ServiceDatabase,
) {
  const authorized = (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.adminToken) {
      reply.code(503).send({ error: 'admin_not_configured', message: '请设置 STHSTART_ADMIN_TOKEN。' });
      return false;
    }
    if (!authenticateAdmin(config.adminToken, request)) {
      reply.code(401).send({ error: 'unauthorized', message: '未授权的管理请求。' });
      return false;
    }
    return true;
  };

  app.get<{ Querystring: GenerationRecoveryListQuery }>(
    '/api/v1/admin/generation/uncertain-tasks',
    { schema: { querystring: GenerationRecoveryListQuerySchema, response: { 200: GenerationRecoveryListResponseSchema } } },
    (request, reply) => {
      if (!authorized(request, reply)) return;
      const all = listUncertainGenerationTasks(database, request.query.appId);
      const limit = request.query.limit ?? 100;
      return { items: all.slice(0, limit).map(recoveryTask), total: all.length };
    },
  );

  app.post<{ Params: { id: string }; Body: GenerationRecoveryResolveRequest }>(
    '/api/v1/admin/generation/tasks/:id/resolve-uncertain',
    { schema: { body: GenerationRecoveryResolveRequestSchema, response: { 200: GenerationRecoveryResolveResponseSchema } } },
    (request, reply) => {
      if (!authorized(request, reply)) return;
      const note = request.body.note.trim();
      if (!note) return reply.code(400).send({ error: 'review_note_required', message: '请填写上游核对说明。' });

      const row = database.connection.prepare(
        'SELECT id, app_id, status, upstream_may_continue FROM generation_tasks WHERE id = ?',
      ).get(request.params.id) as { id: string; app_id: string; status: string; upstream_may_continue: number } | undefined;
      if (!row) return reply.code(404).send({ error: 'generation_task_not_found', message: '未找到生成任务。' });
      if (request.body.appId && request.body.appId !== row.app_id) {
        // Admin tokens are global; an explicit app scope must still match.
        return reply.code(404).send({ error: 'generation_task_not_found', message: '未找到生成任务。' });
      }
      if (!Boolean(row.upstream_may_continue)) {
        return reply.code(409).send({ error: 'task_not_awaiting_review', message: '该任务没有待核对的上游执行状态。' });
      }
      if (String(row.status) === 'succeeded') {
        return reply.code(409).send({ error: 'task_not_awaiting_review', message: '已成功的任务不存在待核对的上游执行状态。' });
      }
      if (!['abandoned', 'failed', 'cancelled'].includes(String(row.status))) {
        return reply.code(409).send({ error: 'task_still_active', message: '任务仍在执行中，不能直接释放；请先等待终态或完成取消核对。' });
      }

      try {
        const task = confirmGenerationTaskUncertainOutcome(database, request.params.id, row.app_id, request.body.outcome, note);
        return { task: recoveryTask(task) };
      } catch (error) {
        const code = (error as { code?: string })?.code;
        if (code === 'not_found') return reply.code(404).send({ error: 'generation_task_not_found', message: '未找到生成任务。' });
        if (code === 'not_reviewable') return reply.code(409).send({ error: 'task_not_reviewable', message: (error as Error).message });
        throw error;
      }
    },
  );
}
