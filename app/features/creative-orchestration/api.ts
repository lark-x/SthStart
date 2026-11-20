import { getJson, postJson, putJson } from '@/app/lib/api-client';
import {
  CreativeRoleSchema,
  CreativeRoleListSchema,
  CreativeWorkflowSchema,
  CreativeWorkflowListSchema,
  CreativeValidationSchema,
  CreativeWorkflowDryRunResultSchema,
  CreativeWorkflowNlEditResultSchema,
  CreativeWorkflowVersionSchema,
  CreativeRunSchema,
  CreativeRunListSchema,
  CreativeRunDetailSchema,
  CreativeApprovalSchema,
  CreativeMessageResponseSchema,
  CreativeConversationSchema,
  type CreativeRole,
  type CreativeWorkflow,
  type CreativeWorkflowDocument,
  type CreativeValidation,
  type CreativeWorkflowDryRunResult,
  type CreativeWorkflowNlEditRequest,
  type CreativeWorkflowNlEditResult,
  type CreativeWorkflowVersion,
  type CreativeAlternativeRunRequest,
  type CreativeRun,
  type CreativeRunDetail,
  type CreativeStartRun,
  type CreativeApproval,
  type CreativeDecision,
  type CreativeBudget,
  CreativeRecoverySchema,
  type CreativeMessageRequest,
  type CreativeMessageResponse,
  type CreativeScope,
  type CreativeScopePolicyView,
  type CreativeScopePolicyPut,
  CreativeScopePolicyViewSchema,
  type CreativeRoleFromTemplate,
} from '@sthstart/contracts';
import type { Static } from '@sinclair/typebox';

const base = 'creative-orchestration';
const path = (resource: string) => `${base}/${resource}`;
export const creativeApi = {
  roles: () => getJson<{ items: CreativeRole[] }>(path('roles'), undefined, CreativeRoleListSchema),
  saveRole: (role: CreativeRole) =>
    putJson<CreativeRole>(path(`roles/${role.id}`), role, undefined, CreativeRoleSchema),
  createRole: (role: CreativeRoleFromTemplate) =>
    postJson<CreativeRole>(path('roles/from-template'), role, undefined, CreativeRoleSchema),
  scopePolicy: (scope: CreativeScope) =>
    getJson<CreativeScopePolicyView>(
      path(`scope-policy?scope=${encodeURIComponent(JSON.stringify(scope))}`),
      undefined,
      CreativeScopePolicyViewSchema,
    ),
  saveScopePolicy: (input: CreativeScopePolicyPut) =>
    putJson<CreativeScopePolicyView>(path('scope-policy'), input, undefined, CreativeScopePolicyViewSchema),
  workflows: () =>
    getJson<{ items: CreativeWorkflow[] }>(path('workflows'), undefined, CreativeWorkflowListSchema),
  createWorkflow: (document: CreativeWorkflowDocument) =>
    postJson<CreativeWorkflow>(path('workflows'), { document }, undefined, CreativeWorkflowSchema),
  saveWorkflow: (id: string, expectedRevision: number, document: CreativeWorkflowDocument) =>
    putJson<CreativeWorkflow>(
      path(`workflows/${id}`),
      { expectedRevision, document },
      undefined,
      CreativeWorkflowSchema,
    ),
  validateWorkflow: (id: string, document: CreativeWorkflowDocument) =>
    postJson<CreativeValidation>(
      path(`workflows/${id}/validate`),
      { document },
      undefined,
      CreativeValidationSchema,
    ),
  dryRunWorkflow: (id: string, document: CreativeWorkflowDocument) =>
    postJson<CreativeWorkflowDryRunResult>(
      path(`workflows/${id}/dry-run`),
      { document },
      undefined,
      CreativeWorkflowDryRunResultSchema,
    ),
  nlEditWorkflow: (id: string, payload: CreativeWorkflowNlEditRequest) =>
    postJson<CreativeWorkflowNlEditResult>(
      path(`workflows/${id}/nl-edit`),
      payload,
      undefined,
      CreativeWorkflowNlEditResultSchema,
    ),
  publishWorkflow: (id: string, expectedRevision: number) =>
    postJson<CreativeWorkflowVersion>(
      path(`workflows/${id}/publish`),
      { expectedRevision },
      undefined,
      CreativeWorkflowVersionSchema,
    ),
  runs: () => getJson<{ items: CreativeRun[] }>(path('runs'), undefined, CreativeRunListSchema),
  run: (id: string) => getJson<CreativeRunDetail>(path(`runs/${id}`), undefined, CreativeRunDetailSchema),
  start: (payload: CreativeStartRun) =>
    postJson<CreativeRun>(path('runs'), payload, undefined, CreativeRunSchema),
  startAlternative: (id: string, payload: CreativeAlternativeRunRequest) =>
    postJson<CreativeRun>(path(`runs/${id}/alternative`), payload, undefined, CreativeRunSchema),
  controlRun: (id: string, action: 'pause' | 'resume' | 'cancel', expectedRevision: number) =>
    postJson<CreativeRun>(path(`runs/${id}/${action}`), { expectedRevision }, undefined, CreativeRunSchema),
  activate: (id: string, expectedRevision: number, budget: CreativeBudget) =>
    postJson<CreativeRun>(
      path(`runs/${id}/activate`),
      { expectedRevision, budget },
      undefined,
      CreativeRunSchema,
    ),
  recover: (id: string, nodeId: string, recovery: Static<typeof CreativeRecoverySchema>) =>
    postJson<CreativeRun>(path(`runs/${id}/nodes/${nodeId}/recover`), recovery, undefined, CreativeRunSchema),
  decide: (id: string, decision: CreativeDecision) =>
    postJson<CreativeApproval>(path(`approvals/${id}/decision`), decision, undefined, CreativeApprovalSchema),
  message: (message: CreativeMessageRequest) =>
    postJson<CreativeMessageResponse>(
      path('conversations/message'),
      message,
      undefined,
      CreativeMessageResponseSchema,
    ),
  conversation: (id: string) =>
    getJson<Static<typeof CreativeConversationSchema>>(
      path(`conversations/${id}`),
      undefined,
      CreativeConversationSchema,
    ),
};
