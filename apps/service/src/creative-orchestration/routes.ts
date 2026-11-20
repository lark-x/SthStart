import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  CreativeAlternativeRunRequestSchema,
  CreativeDecisionSchema,
  CreativeMessageRequestSchema,
  CreativeRecoverySchema,
  CreativeRoleSchema,
  CreativeRoleFromTemplateSchema,
  CreativeScopePolicyPutSchema,
  CreativeScopePolicyQuerySchema,
  CreativeScopePolicyReadSchema,
  CreativeStartRunSchema,
  CreativeWorkflowDocumentSchema,
  CreativeWorkflowDryRunRequestSchema,
  CreativeWorkflowNlEditRequestSchema,
  type CreativeAlternativeRunRequest,
  type CreativeDecision,
  type CreativeMessageRequest,
  type CreativeRole,
  type CreativeRoleFromTemplate,
  type CreativeScopePolicyPut,
  type CreativeScopePolicyQuery,
  type CreativeScopePolicyRead,
  type CreativeStartRun,
  type CreativeWorkflowDryRunRequest,
  type CreativeWorkflowNlEditRequest,
} from '@sthstart/contracts';
import { authenticateAdmin } from '../access.js';
import type { ServiceConfig } from '../config.js';
import {
  CreativeService,
  CreativeServiceError,
  creativeErrorStatus,
  type CreativeRunActivation,
} from './service.js';

const strict = { additionalProperties: false };
const revisionBodySchema = Type.Object({
  expectedRevision: Type.Integer({ minimum: 1 }),
}, strict);
const workflowCreateSchema = Type.Object({
  document: CreativeWorkflowDocumentSchema,
}, strict);
const workflowSaveSchema = Type.Object({
  expectedRevision: Type.Integer({ minimum: 1 }),
  document: CreativeWorkflowDocumentSchema,
}, strict);
const workflowValidateSchema = Type.Object({
  document: CreativeWorkflowDocumentSchema,
}, strict);
const publishSchema = revisionBodySchema;
const messageSchema = CreativeMessageRequestSchema;
const decisionSchema = CreativeDecisionSchema;
export const creativeActivationSchema = Type.Object({
  expectedRevision: Type.Integer({ minimum: 1 }),
  budget: CreativeStartRunSchema.properties.budget,
}, strict);
type WorkflowCreate = Static<typeof workflowCreateSchema>;
type WorkflowSave = Static<typeof workflowSaveSchema>;
type WorkflowValidate = Static<typeof workflowValidateSchema>;
type RevisionBody = Static<typeof revisionBodySchema>;
type CreativeActivation = Static<typeof creativeActivationSchema>;

function assertBody<T>(schema: TSchema, value: unknown, code: string): asserts value is T {
  if (Value.Check(schema, value)) return;
  const first = [...Value.Errors(schema, value)][0];
  throw new CreativeServiceError(
    code,
    400,
    `请求${first?.path ?? '/'}格式错误：${first?.message ?? '不符合契约'}。`,
  );
}

function admin(config: ServiceConfig, request: FastifyRequest, reply: FastifyReply): boolean {
  if (authenticateAdmin(config.adminToken, request)) return true;
  void reply.code(401).send({ error: 'unauthorized', message: '需要管理员权限。' });
  return false;
}

function noStore(reply: FastifyReply): void {
  reply.header('cache-control', 'no-store');
  reply.header('pragma', 'no-cache');
}

function parameterId(request: FastifyRequest): string {
  const { id } = request.params as { id?: unknown };
  if (typeof id !== 'string' || !id) {
    throw new CreativeServiceError('creative_request_invalid', 400, '缺少资源 ID。');
  }
  return id;
}

function assertSafeJson(
  value: unknown,
  path = '/',
  depth = 0,
  seen = new Set<object>(),
): void {
  if (depth > 20) {
    throw new CreativeServiceError('creative_recovery_invalid', 400, '恢复参数嵌套过深。');
  }
  if (value === null || typeof value === 'string'
    || typeof value === 'boolean' || typeof value === 'number') return;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new CreativeServiceError('creative_recovery_invalid', 400, `恢复参数${path} 不是普通 JSON。`);
  }
  if (seen.has(value)) {
    throw new CreativeServiceError('creative_recovery_invalid', 400, '恢复参数不能包含循环引用。');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CreativeServiceError('creative_recovery_invalid', 400, `恢复参数${path} 的原型不受支持。`);
  }
  seen.add(value);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new CreativeServiceError('creative_recovery_invalid', 400, `恢复参数${path} 包含保留键。`);
    }
    assertSafeJson(child, `${path}${path.endsWith('/') ? '' : '/'}${key}`, depth + 1, seen);
  }
  seen.delete(value);
}

function handler<T>(
  operation: (request: FastifyRequest, reply: FastifyReply) => Promise<T> | T,
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    noStore(reply);
    try {
      return await operation(request, reply);
    } catch (error) {
      const failure = creativeErrorStatus(error);
      return reply.code(failure.statusCode).send({
        error: failure.code,
        message: failure.message,
      });
    }
  };
}

export function registerCreativeOrchestrationRoutes(
  app: FastifyInstance,
  config: ServiceConfig,
  service: CreativeService,
): void {
  void app.register(async (routes) => {
    routes.addHook('onSend', async (_request, reply, payload) => {
      noStore(reply);
      return payload;
    });
    routes.get('/roles', handler(async (request, reply) => {
      if (!admin(config, request, reply)) return reply;
      return service.roles();
    }));

    routes.post('/roles/from-template', handler(async (request, reply) => {
      if (!admin(config, request, reply)) return reply;
      const input = request.body as CreativeRoleFromTemplate;
      assertBody<CreativeRoleFromTemplate>(
        CreativeRoleFromTemplateSchema,
        input,
        'creative_role_invalid',
      );
      reply.code(201);
      return service.createRoleFromTemplate(input);
    }));

    routes.put<{ Params: { id: string } }>('/roles/:id', handler(async (request, reply) => {
      if (!admin(config, request, reply)) return reply;
      const role = request.body as CreativeRole;
      assertBody<CreativeRole>(CreativeRoleSchema, role, 'creative_role_invalid');
      if (role.id !== parameterId(request)) {
        throw new CreativeServiceError('creative_role_invalid', 400, '岗位 ID 与路径不一致。');
      }
      return service.saveRole(role);
    }));

    routes.get('/workflows', handler(async (request, reply) => {
      if (!admin(config, request, reply)) return reply;
      return service.workflows();
    }));

    routes.post('/workflows', handler(async (request, reply) => {
      if (!admin(config, request, reply)) return reply;
      const input = request.body as WorkflowCreate;
      assertBody<WorkflowCreate>(workflowCreateSchema, input, 'creative_workflow_invalid');
      const workflow = service.createWorkflow(input.document);
      reply.code(201);
      return workflow;
    }));

    routes.put<{ Params: { id: string } }>('/workflows/:id', handler(async (request, reply) => {
      if (!admin(config, request, reply)) return reply;
      const input = request.body as WorkflowSave;
      assertBody<WorkflowSave>(workflowSaveSchema, input, 'creative_workflow_invalid');
      return service.saveWorkflow(parameterId(request), input.expectedRevision, input.document);
    }));

    routes.post<{ Params: { id: string } }>('/workflows/:id/validate', handler(async (request, reply) => {
      if (!admin(config, request, reply)) return reply;
      const input = request.body as WorkflowValidate;
      assertBody<WorkflowValidate>(workflowValidateSchema, input, 'creative_workflow_invalid');
      return service.validateWorkflow(input.document);
    }));

    routes.post<{ Params: { id: string } }>('/workflows/:id/dry-run', handler(async (request, reply) => {
      if (!admin(config, request, reply)) return reply;
      const input = request.body as CreativeWorkflowDryRunRequest;
      assertBody<CreativeWorkflowDryRunRequest>(
        CreativeWorkflowDryRunRequestSchema,
        input,
        'creative_workflow_invalid',
      );
      return service.dryRunWorkflow(input.document);
    }));

    routes.post<{ Params: { id: string } }>('/workflows/:id/nl-edit', handler(async (request, reply) => {
      if (!admin(config, request, reply)) return reply;
      const input = request.body as CreativeWorkflowNlEditRequest;
      assertBody<CreativeWorkflowNlEditRequest>(
        CreativeWorkflowNlEditRequestSchema,
        input,
        'creative_workflow_invalid',
      );
      return service.nlEditWorkflow(parameterId(request), input);
    }));

    routes.post<{ Params: { id: string } }>('/workflows/:id/publish', handler(async (request, reply) => {
      if (!admin(config, request, reply)) return reply;
      const input = request.body as RevisionBody;
      assertBody<RevisionBody>(publishSchema, input, 'creative_workflow_invalid');
      return service.publishWorkflow(parameterId(request), input.expectedRevision);
    }));

    routes.get('/scope-policy', handler(async (request, reply) => {
      if (!admin(config, request, reply)) return reply;
      const body = request.body;
      if (body === undefined || body === null) {
        const query = request.query as CreativeScopePolicyQuery;
        assertBody<CreativeScopePolicyQuery>(
          CreativeScopePolicyQuerySchema,
          query,
          'creative_policy_invalid',
        );
        let parsed: unknown;
        try {
          parsed = JSON.parse(query.scope);
        } catch {
          throw new CreativeServiceError(
            'creative_policy_invalid',
            400,
            'scope 查询参数必须是 JSON。',
          );
        }
        return service.scopePolicy({ scope: parsed });
      }
      const input = body as CreativeScopePolicyRead;
      assertBody<CreativeScopePolicyRead>(
        CreativeScopePolicyReadSchema,
        input,
        'creative_policy_invalid',
      );
      return service.scopePolicy(input);
    }));

    routes.put('/scope-policy', handler(async (request, reply) => {
      if (!admin(config, request, reply)) return reply;
      const input = request.body as CreativeScopePolicyPut;
      assertBody<CreativeScopePolicyPut>(
        CreativeScopePolicyPutSchema,
        input,
        'creative_policy_invalid',
      );
      return service.saveScopePolicy(input);
    }));

    routes.get('/runs', handler(async (request, reply) => {
      if (!admin(config, request, reply)) return reply;
      return service.runs();
    }));

    routes.get<{ Params: { id: string } }>('/runs/:id', handler(async (request, reply) => {
      if (!admin(config, request, reply)) return reply;
      return service.run(parameterId(request));
    }));

    routes.post('/runs', handler(async (request, reply) => {
      if (!admin(config, request, reply)) return reply;
      const input = request.body as CreativeStartRun;
      assertBody<CreativeStartRun>(CreativeStartRunSchema, input, 'creative_run_invalid');
      const run = await service.startRun(input);
      reply.code(201);
      return run;
    }));

    for (const action of ['pause', 'resume', 'cancel'] as const) {
      routes.post<{ Params: { id: string } }>(`/runs/:id/${action}`, handler(async (request, reply) => {
        if (!admin(config, request, reply)) return reply;
        const input = request.body as RevisionBody;
        assertBody<RevisionBody>(revisionBodySchema, input, 'creative_run_invalid');
        const runId = parameterId(request);
        if (action === 'pause') return service.pauseRun(runId, input.expectedRevision);
        if (action === 'resume') return service.resumeRun(runId, input.expectedRevision);
        return service.cancelRun(runId, input.expectedRevision);
      }));
    }

    routes.post<{ Params: { id: string } }>('/runs/:id/activate', handler(async (request, reply) => {
      if (!admin(config, request, reply)) return reply;
      const input = request.body as CreativeActivation;
      assertBody<CreativeActivation>(creativeActivationSchema, input, 'creative_run_invalid');
      const activation: CreativeRunActivation = {
        expectedRevision: input.expectedRevision,
        budget: input.budget,
      };
      return service.activateRun(parameterId(request), activation);
    }));

    routes.post<{ Params: { id: string } }>('/runs/:id/alternative', handler(async (request, reply) => {
      if (!admin(config, request, reply)) return reply;
      const input = request.body as CreativeAlternativeRunRequest;
      assertBody<CreativeAlternativeRunRequest>(
        CreativeAlternativeRunRequestSchema,
        input,
        'creative_run_invalid',
      );
      const run = await service.startAlternativeRun(parameterId(request), input);
      reply.code(201);
      return run;
    }));

    routes.post<{ Params: { id: string; nodeRunId: string } }>(
      '/runs/:id/nodes/:nodeRunId/recover',
      handler(async (request, reply) => {
        if (!admin(config, request, reply)) return reply;
        const { nodeRunId } = request.params as { id?: unknown; nodeRunId?: unknown };
        if (typeof nodeRunId !== 'string' || !nodeRunId) {
          throw new CreativeServiceError('creative_recovery_invalid', 400, '缺少节点运行 ID。');
        }
        assertSafeJson(request.body);
        assertBody<Parameters<CreativeService['recoverRun']>[2]>(
          CreativeRecoverySchema,
          request.body,
          'creative_recovery_invalid',
        );
        return service.recoverRun(
          parameterId(request),
          nodeRunId,
          request.body as Parameters<CreativeService['recoverRun']>[2],
        );
      }),
    );

    routes.post<{ Params: { id: string } }>('/approvals/:id/decision', handler(async (request, reply) => {
      if (!admin(config, request, reply)) return reply;
      const decision = request.body as CreativeDecision;
      assertBody<CreativeDecision>(decisionSchema, decision, 'creative_approval_invalid');
      return service.decision(parameterId(request), decision);
    }));

    routes.post('/conversations/message', handler(async (request, reply) => {
      if (!admin(config, request, reply)) return reply;
      const input = request.body as CreativeMessageRequest;
      assertBody<CreativeMessageRequest>(messageSchema, input, 'creative_message_invalid');
      return service.message(input);
    }));

    routes.get<{ Params: { id: string } }>('/conversations/:id', handler(async (request, reply) => {
      if (!admin(config, request, reply)) return reply;
      return service.conversation(parameterId(request));
    }));
  }, { prefix: '/api/v1/admin/creative-orchestration' });
}

