import { randomUUID } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  CreativeAlternativeRunRequestSchema,
  CreativeConversationSchema,
  CreativeMessageRequestSchema,
  CreativeMessageResponseSchema,
  CreativeRoleSchema,
  CreativeRoleFromTemplateSchema,
  CreativeStartRunSchema,
  CreativeWorkflowDocumentSchema,
  CreativeWorkflowDryRunResultSchema,
  CreativeWorkflowNlEditRequestSchema,
  CreativeWorkflowNlEditResultSchema,
  isSystemInternalWorkflowName,
  type CreativeAlternativeRunRequest,
  type CreativeApproval,
  type CreativeBudget,
  type CreativeDecision,
  type CreativeMessageRequest,
  type CreativeMessageResponse,
  type CreativeRole,
  type CreativeRoleFromTemplate,
  type CreativeRun,
  type CreativeRunDetail,
  type CreativeScope,
  type CreativeStartRun,
  type CreativeWorkflow,
  type CreativeWorkflowDocument,
  type CreativeWorkflowDryRunResult,
  type CreativeWorkflowNlEditRequest,
  type CreativeWorkflowNlEditResult,
  type CreativeWorkflowVersion,
} from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import { nowIso, type ServiceDatabase } from '../database.js';
import { executeTextLlm } from '../llm/common-llm.js';
import { resolveEffectiveModelProfile } from '../providers.js';
import type { SecretStore } from '../security.js';
import { resolveWorkflowAndEngine } from '../generation/task-store.js';
import {
  CreativeAgentCandidateReceiptSchema,
  CreativeAgentCandidateSubmissionSchema,
  normalizeCreativeScope,
  type CreativeAgentCandidateReceipt,
  type CreativeAgentCandidateSubmission,
  type CreativeAgentMemoryEntriesQuery,
  type CreativeAgentMemoryFactsQuery,
} from './bridge.js';
import { CreativeActions, type CreativeActionCatalog } from './actions.js';
import {
  createCreativeConversationWorkflow,
  isCreativeConversationWorkflow,
} from './conversation.js';
import { CreativeDomain, type CreativeContext } from './domain.js';
import {
  createCreativeExecutor,
  CREATIVE_APP_ID,
  CREATIVE_TOOLS,
  profileFingerprint,
} from './executor.js';
import { validateCreativeGraph } from './graph.js';
import {
  readCreativeScopePolicy,
  saveCreativeScopePolicy,
  CreativeScopePolicyReadSchema,
  CreativeScopePolicyPutSchema,
  type CreativeScopePolicyRead,
  type CreativeScopePolicyPut,
  type CreativeScopePolicyView,
} from './policy.js';
import { CreativeRuntime, type CreativeExecutor } from './runtime.js';
import { CreativeStore, creativeHash } from './store.js';
import {
  DEFAULT_CREATIVE_ROLES,
  createCriticalStorySceneWorkflow,
  createDefaultCreativeRoles,
  createDefaultIllustrationWorkflow,
  createDefaultVideoPlanWorkflow,
  createStandardStorySceneWorkflow,
} from './templates.js';

export interface CreateCreativeServiceOptions {
  config: ServiceConfig;
  database: ServiceDatabase;
  secrets: SecretStore;
  fetcher?: typeof fetch;
  /** Controlled test/embedding seam. Production uses createCreativeExecutor below. */
  executor?: CreativeExecutor;
}

export interface CreativeRunActivation {
  expectedRevision: number;
  budget: CreativeBudget;
}

type FrozenModels = {
  roles: CreativeRole[];
  rows: Array<{ roleId: string; profileId: string; profileHash: string }>;
};

type CandidateInternalKind = 'scene' | 'visual-brief';
const mediaConfigSchema = Type.Object({
  workflowId: Type.String({
    minLength: 1,
    maxLength: 160,
    pattern: '^[A-Za-z0-9_-]+$',
  }),
  workflowVersion: Type.Integer({ minimum: 1 }),
  inputs: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  references: Type.Optional(Type.Array(Type.Object({
    artifactId: Type.String({ minLength: 1, maxLength: 160 }),
    inputKey: Type.String({ minLength: 1, maxLength: 160 }),
  }, { additionalProperties: false }), { maxItems: 32 })),
}, { additionalProperties: false });
type MediaConfig = Static<typeof mediaConfigSchema>;
export {
  CreativeRoleFromTemplateSchema,
  type CreativeRoleFromTemplate,
} from '@sthstart/contracts';

const EXTERNAL_BUDGET: CreativeBudget = {
  maxTextCalls: 1,
  maxImages: 0,
  maxTokens: 100,
  maxRevisions: 0,
};
const CONVERSATION_MESSAGE_LIMIT = 200;
const ALLOWED_ROLE_TOOLS = new Set<string>([
  ...CREATIVE_TOOLS,
  'knowledge_search',
  'web_search',
]);
const candidateWorkflowNames: Record<CreativeAgentCandidateSubmission['kind'], string> = {
  scene: '外部场景候选审核',
  'visual-brief': '外部视觉简报候选审核',
  'video-plan': '外部视频方案候选审核',
};
const candidateInternalKinds: Record<CreativeAgentCandidateSubmission['kind'], CandidateInternalKind> = {
  scene: 'scene',
  'visual-brief': 'visual-brief',
  'video-plan': 'visual-brief',
};

export class CreativeServiceError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string) {
    super(message);
    this.name = 'CreativeServiceError';
  }
}

function fail(code: string, statusCode: number, message: string): never {
  throw new CreativeServiceError(code, statusCode, message);
}

function assertSchema<T>(schema: Parameters<typeof Value.Check>[0], value: unknown, code: string, label: string): asserts value is T {
  if (Value.Check(schema, value)) return;
  const first = [...Value.Errors(schema, value)][0];
  fail(code, 400, `${label}${first?.path ?? '/'} 格式错误：${first?.message ?? '不符合契约'}。`);
}

function canonical<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function externalWorkflow(kind: CreativeAgentCandidateSubmission['kind']): CreativeWorkflowDocument {
  const internalKind = candidateInternalKinds[kind];
  const candidateRole = kind === 'scene' ? 'lead_writer' : 'production_manager';
  const reviewerA = kind === 'scene' ? 'continuity_editor'
    : kind === 'visual-brief' ? 'visual_reviewer' : 'creative_director';
  const reviewerB = kind === 'scene' ? 'editor_in_chief' : 'art_director';
  const input = (nodeId: string, inputKind: CreativeWorkflowDocument['nodes'][number]['outputKind']) =>
    ({ nodeId, kind: inputKind });
  return {
    name: candidateWorkflowNames[kind],
    description: '外部内容作为已完成候选导入，只经过双审核、人工批准和采用；没有生成主笔或事后方向补批。',
    purpose: 'general',
    nodes: [
      {
        id: 'external_context',
        kind: 'context',
        label: '提交时冻结的真实上下文',
        outputKind: 'context',
        inputs: {},
        config: {},
        position: { x: 40, y: 240 },
      },
      {
        id: 'external_candidate',
        kind: 'agent',
        label: '外部已完成候选',
        roleId: candidateRole,
        outputKind: internalKind,
        inputs: { context: input('external_context', 'context') },
        config: {
          instruction: '该节点只在服务端导入预完成候选；运行时永远不调用模型重写候选内容。',
          parameters: { externalPrecompleted: true },
        },
        position: { x: 260, y: 240 },
      },
      {
        id: 'external_review_a',
        kind: 'agent',
        label: '第一路独立审核',
        roleId: reviewerA,
        outputKind: 'review',
        inputs: {
          context: input('external_context', 'context'),
          candidate: input('external_candidate', internalKind),
        },
        config: { instruction: '同时读取原始上下文与外部候选，输出绑定实际候选 hash 的审核。' },
        position: { x: 490, y: 140 },
      },
      {
        id: 'external_review_b',
        kind: 'agent',
        label: '第二路独立审核',
        roleId: reviewerB,
        outputKind: 'review',
        inputs: {
          context: input('external_context', 'context'),
          candidate: input('external_candidate', internalKind),
        },
        config: { instruction: '独立核对完整性、一致性与可交付质量，不得只复述第一路审核。' },
        position: { x: 490, y: 340 },
      },
      {
        id: 'external_approval',
        kind: 'approval',
        label: '人工批准外部候选',
        outputKind: 'decision',
        inputs: {
          candidate: input('external_candidate', internalKind),
          first_review: input('external_review_a', 'review'),
          second_review: input('external_review_b', 'review'),
        },
        config: {
          reviewerRoleIds: ['production_manager', 'editor_in_chief'],
          instruction: '必须同时阅读实际候选和两路有效审核；外部提交没有批准权。',
        },
        position: { x: 720, y: 240 },
      },
      {
        id: 'external_adopt',
        kind: 'adopt',
        label: '经批准后正式采用',
        outputKind: 'result',
        inputs: { approval: input('external_approval', 'decision') },
        config: { instruction: '只接收最终批准的候选，始终使用受控采用适配器。' },
        position: { x: 950, y: 240 },
      },
    ],
    edges: [
      { id: 'external_context_candidate', source: 'external_context', target: 'external_candidate' },
      { id: 'external_context_review_a', source: 'external_context', target: 'external_review_a' },
      { id: 'external_candidate_review_a', source: 'external_candidate', target: 'external_review_a' },
      { id: 'external_context_review_b', source: 'external_context', target: 'external_review_b' },
      { id: 'external_candidate_review_b', source: 'external_candidate', target: 'external_review_b' },
      { id: 'external_candidate_approval', source: 'external_candidate', target: 'external_approval' },
      { id: 'external_review_a_approval', source: 'external_review_a', target: 'external_approval' },
      { id: 'external_review_b_approval', source: 'external_review_b', target: 'external_approval' },
      { id: 'external_approval_adopt', source: 'external_approval', target: 'external_adopt', when: 'approved' },
    ],
  };
}

export class CreativeService {
  readonly store: CreativeStore;
  readonly domain: CreativeDomain;
  readonly executor: CreativeExecutor;
  readonly actions: CreativeActions;
  readonly runtime: CreativeRuntime;
  private schedulerStarted = false;
  private closed = false;

  constructor(readonly options: CreateCreativeServiceOptions) {
    this.store = new CreativeStore(options.database);
    this.domain = new CreativeDomain(options.database);
    this.actions = new CreativeActions(options.database);
    this.executor = options.executor ?? createCreativeExecutor({
      config: options.config,
      database: options.database,
      secrets: options.secrets,
      store: this.store,
      domain: this.domain,
      fetcher: options.fetcher,
    });
    this.runtime = new CreativeRuntime(this.store, this.executor);
    this.seed();
  }

  start(): void {
    if (this.schedulerStarted || this.closed) return;
    this.schedulerStarted = true;
    this.runtime.start();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.schedulerStarted = false;
    await this.runtime.close();
  }

  roles(): { items: CreativeRole[] } {
    return this.store.listRoles();
  }

  saveRole(input: unknown): CreativeRole {
    assertSchema<CreativeRole>(CreativeRoleSchema, input, 'creative_role_invalid', '岗位');
    const role = canonical(input);
    if (new Set(role.tools).size !== role.tools.length) {
      fail('creative_role_invalid', 400, '岗位工具不能重复。');
    }
    const unknownTools = role.tools.filter((tool) => !ALLOWED_ROLE_TOOLS.has(tool));
    if (unknownTools.length) {
      fail(
        'creative_role_tool_unregistered',
        400,
        `岗位包含未登记工具：${unknownTools.join(', ')}。`,
      );
    }
    const current = this.store.listRoles().items.find((entry) => entry.id === role.id);
    if (current && current.core !== role.core) {
      fail('creative_role_core_immutable', 409, '核心岗位身份不能通过编辑改变。');
    }
    for (const tool of current?.tools ?? []) {
      if ((tool === 'knowledge_search' || tool === 'web_search')
        && !role.tools.includes(tool)) {
        role.tools.push(tool);
      }
    }
    return this.store.saveRole(role);
  }

  async createRoleFromTemplate(input: unknown): Promise<CreativeRole> {
    assertSchema<CreativeRoleFromTemplate>(
      CreativeRoleFromTemplateSchema,
      input,
      'creative_role_invalid',
      '岗位模板请求',
    );
    const template = DEFAULT_CREATIVE_ROLES.find((role) => role.id === input.templateId);
    if (!template) fail('creative_role_template_not_found', 404, '岗位模板不存在。');
    if (this.store.listRoles().items.some((role) => role.id === input.id)) {
      fail('creative_role_exists', 409, '岗位 ID 已存在。');
    }
    const name = input.name.trim();
    if (!name) fail('creative_role_invalid', 400, '岗位名称不能为空。');
    if (input.modelId) {
      let profile;
      try {
        profile = await resolveEffectiveModelProfile(
          this.options.database,
          this.options.secrets,
          CREATIVE_APP_ID,
          template.capability === 'multimodal' ? 'vision' : undefined,
          input.modelId,
        );
      } catch {
        fail(
          'creative_model_unconfigured',
          409,
          `所选模型不支持${template.capability === 'multimodal' ? '看图' : '文本'}岗位。`,
        );
      }
      if (!profile) {
        fail(
          'creative_model_unconfigured',
          409,
          `所选模型不支持${template.capability === 'multimodal' ? '看图' : '文本'}岗位。`,
        );
      }
    }
    return this.store.saveRole({
      id: input.id,
      name,
      responsibility: template.responsibility,
      core: false,
      capability: template.capability,
      modelId: input.modelId ?? null,
      tools: [...template.tools],
      revision: 1,
    });
  }

  workflows(): { items: CreativeWorkflow[] } {
    return this.store.listWorkflows();
  }

  createWorkflow(input: unknown): CreativeWorkflow {
    assertSchema<CreativeWorkflowDocument>(
      CreativeWorkflowDocumentSchema,
      input,
      'creative_workflow_invalid',
      '工作流',
    );
    if (isCreativeConversationWorkflow(input)) {
      fail('creative_conversation_workflow_reserved', 409, '总管工作流由服务端模板独占，不能创建副本。');
    }
    return this.store.createWorkflow(input);
  }

  saveWorkflow(id: string, expectedRevision: number, document: unknown): CreativeWorkflow {
    assertSchema<CreativeWorkflowDocument>(
      CreativeWorkflowDocumentSchema,
      document,
      'creative_workflow_invalid',
      '工作流',
    );
    const current = this.store.getWorkflow(id);
    if (current
      && isCreativeConversationWorkflow(current.document)
      && !isCreativeConversationWorkflow(document)) {
      fail('creative_conversation_workflow_reserved', 409, '总管工作流模板不可由普通工作流接口修改。');
    }
    return this.store.saveWorkflow(id, { expectedRevision, document });
  }

  validateWorkflow(document: unknown) {
    return validateCreativeGraph(document);
  }

  async dryRunWorkflow(document: unknown): Promise<CreativeWorkflowDryRunResult> {
    assertSchema<CreativeWorkflowDocument>(
      CreativeWorkflowDocumentSchema,
      document,
      'creative_workflow_invalid',
      '工作流',
    );
    const validation = validateCreativeGraph(document);
    const blockers = validation.issues.map((issue) => issue.message);
    const rolesById = new Map(this.store.listRoles().items.map((role) => [role.id, role]));
    const referencedRoleIds = new Set<string>();
    const collectRoles = (doc: CreativeWorkflowDocument, path: string[] = []) => {
      for (const node of doc.nodes) {
        if (node.roleId) referencedRoleIds.add(node.roleId);
        if (node.kind === 'tool') {
          const tool = node.config.tool;
          if (!tool || !(CREATIVE_TOOLS as readonly string[]).includes(tool)) {
            blockers.push(`节点「${node.label}」引用了未登记工具 ${tool ?? '未指定'}。`);
          } else if (node.roleId) {
            const role = rolesById.get(node.roleId);
            if (role && !role.tools.includes(tool)) {
              blockers.push(`岗位「${role.name}」没有工具 ${tool} 的授权。`);
            }
          }
        }
        if (node.kind === 'subworkflow' && node.config.workflowId && node.config.workflowVersion) {
          if (path.includes(node.config.workflowId)) continue;
          const version = this.store.getVersion(node.config.workflowId, node.config.workflowVersion);
          if (!version) {
            blockers.push(`子流程「${node.label}」固定的版本不存在。`);
          } else {
            collectRoles(version.document, [...path, node.config.workflowId]);
          }
        }
      }
    };
    collectRoles(document);

    const roleChecks: CreativeWorkflowDryRunResult['roles'] = [];
    for (const roleId of [...referencedRoleIds].sort()) {
      const role = rolesById.get(roleId);
      if (!role) {
        blockers.push(`工作流引用了不存在的岗位 ${roleId}。`);
        continue;
      }
      let ready = false;
      let issue: string | null = null;
      try {
        const profile = await resolveEffectiveModelProfile(
          this.options.database,
          this.options.secrets,
          CREATIVE_APP_ID,
          role.capability === 'multimodal' ? 'vision' : undefined,
          role.modelId ?? undefined,
        );
        if (profile) {
          ready = true;
        } else {
          issue = `尚未配置可用的${role.capability === 'multimodal' ? '看图' : '文本'}模型`;
        }
      } catch (error) {
        issue = error instanceof Error ? error.message : '模型配置不可用';
      }
      if (!ready && issue) blockers.push(`岗位「${role.name}」：${issue}。`);
      roleChecks.push({
        roleId: role.id,
        name: role.name,
        capability: role.capability,
        modelId: role.modelId,
        ready,
        issue,
      });
    }

    const layerOf = new Map<string, number>();
    const incoming = new Map<string, string[]>();
    for (const node of document.nodes) incoming.set(node.id, []);
    for (const edge of document.edges) incoming.get(edge.target)?.push(edge.source);
    const orderedIds = validation.order.length === document.nodes.length
      ? validation.order
      : document.nodes.map((node) => node.id);
    for (const nodeId of orderedIds) {
      const deps = incoming.get(nodeId) ?? [];
      const maxParent = deps.reduce((max, dep) => Math.max(max, layerOf.get(dep) ?? -1), -1);
      layerOf.set(nodeId, maxParent + 1);
    }
    const maxLayer = Math.max(0, ...layerOf.values());
    const stages: CreativeWorkflowDryRunResult['stages'] = [];
    for (let layer = 0; layer <= maxLayer; layer++) {
      const nodeIds = orderedIds.filter((nodeId) => layerOf.get(nodeId) === layer);
      if (nodeIds.length) stages.push({ layer, nodeIds });
    }

    const agentCount = document.nodes.filter((node) =>
      node.kind === 'agent' && node.config.parameters?.externalPrecompleted !== true).length;
    const imageToolCount = document.nodes.filter((node) =>
      node.kind === 'tool' && node.config.tool === 'image_generation').length;
    const maxRev = document.nodes
      .filter((node) => node.kind === 'revision')
      .reduce((acc, node) => Math.max(acc, node.config.maxRevisions ?? 2), 0);
    const revMultiplier = 1 + maxRev;
    const branches = document.nodes
      .filter((node) => node.kind === 'condition')
      .map((node) => {
        const edges = document.edges.filter((edge) => edge.source === node.id).map((edge) => edge.when ?? 'always');
        return `${node.label}（${node.config.condition ?? '条件'} → ${edges.join(' / ')}）`;
      });
    const uniqueBlockers = [...new Set(blockers)];
    const result: CreativeWorkflowDryRunResult = {
      valid: validation.valid,
      validation,
      ready: validation.valid && uniqueBlockers.length === 0,
      blockers: uniqueBlockers,
      estimatedCalls: {
        minTextCalls: agentCount,
        maxTextCalls: Math.max(agentCount, agentCount * revMultiplier),
        minImages: imageToolCount,
        maxImages: Math.max(imageToolCount, imageToolCount * revMultiplier),
        estimatedMinTokens: agentCount * 20_000,
        estimatedMaxTokens: Math.max(agentCount, agentCount * revMultiplier) * 50_000 + imageToolCount * 16_384,
      },
      stages,
      roles: roleChecks,
      branches,
    };
    assertSchema<CreativeWorkflowDryRunResult>(
      CreativeWorkflowDryRunResultSchema,
      result,
      'creative_workflow_invalid',
      '试跑结果',
    );
    return result;
  }

  async nlEditWorkflow(
    id: string,
    rawInput: unknown,
  ): Promise<CreativeWorkflowNlEditResult> {
    assertSchema<CreativeWorkflowNlEditRequest>(
      CreativeWorkflowNlEditRequestSchema,
      rawInput,
      'creative_workflow_invalid',
      '自然语言编辑请求',
    );
    const current = this.store.getWorkflow(id);
    if (!current) fail('creative_workflow_not_found', 404, '工作流不存在。');
    if (isSystemInternalWorkflowName(current.document.name)) {
      fail('creative_conversation_workflow_reserved', 409, '系统托管流程不能通过自然语言编辑器修改。');
    }
    if (current.revision !== rawInput.expectedRevision) {
      fail('creative_workflow_conflict', 409, '工作流草稿已更新，请刷新后重试。');
    }
    const instruction = rawInput.instruction.trim();
    if (!instruction) fail('creative_workflow_invalid', 400, '请输入具体修改要求。');

    const roles = this.store.listRoles().items;
    const candidateRoleIds = ['production_manager', 'creative_director', ...roles.filter((r) => r.capability === 'text').map((r) => r.id)];
    let profile = null;
    for (const roleId of candidateRoleIds) {
      const role = roles.find((item) => item.id === roleId);
      if (!role || role.capability !== 'text') continue;
      profile = await resolveEffectiveModelProfile(
        this.options.database,
        this.options.secrets,
        CREATIVE_APP_ID,
        undefined,
        role.modelId ?? undefined,
      ).catch(() => null);
      if (profile) break;
    }
    if (!profile) {
      fail('creative_model_unconfigured', 409, '请先在「岗位与模型」中为总管或导演配置一个可用的文本模型。');
    }

    const systemPrompt = [
      '你是 SthStart 工作流编排助手。根据用户的自然语言修改要求，直接输出更新后的完整工作流 JSON。',
      '严格返回 JSON 对象：{ "summary": "一句中文修改说明", "document": CreativeWorkflowDocument }，不要 Markdown，不要额外字段。',
      '保持原有未要求改变的节点 ID、已有连线和合理坐标；新增节点按从左到右（x 每层增加 310，y 间隔 160）排列。',
      '可用岗位：' + JSON.stringify(roles.map((r) => ({ id: r.id, name: r.name, capability: r.capability, tools: r.tools }))),
      '可用受控工具：image_generation, video_plan。',
      '必须保留或满足合法 DAG 约束（context 入口无上游、每个节点 inputs 与 edges 一致、approval+adopt 闭环、revision 最多 1-2 轮且 targetNodeId 为可复跑上游节点）。',
      'Document JSON Schema：' + JSON.stringify(CreativeWorkflowDocumentSchema),
    ].join('\n');
    const userPrompt = JSON.stringify({
      instruction,
      currentDocument: rawInput.document,
    });

    let raw: string;
    let totalTokens: number | null = null;
    try {
      raw = await executeTextLlm({
        profile: { ...profile, fallbacks: undefined },
        maxTokens: 16384,
        jsonMode: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        fetchFn: this.options.fetcher,
        onResult: (res) => {
          const t = res.tokenUsage?.total_tokens;
          totalTokens = typeof t === 'number' && Number.isSafeInteger(t) && t >= 0 ? t : null;
        },
        audit: {
          database: this.options.database,
          traceId: randomUUID(),
          applicationId: CREATIVE_APP_ID,
          feature: 'creative-orchestration',
          businessEvent: 'workflow.nl_edit',
          objectType: 'creative-workflow',
          objectId: id,
        },
      });
    } catch (error) {
      fail('creative_nl_edit_failed', 502, error instanceof Error ? error.message : 'AI 修改流程失败，请核对模型连接后重试。');
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      fail('creative_nl_edit_invalid', 422, '模型没有返回可解析的 JSON 流程方案。');
    }
    const nextDocument = parsed.document;
    const summary = typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim().slice(0, 4000)
      : '已按你的要求生成流程草稿修改方案。';
    if (!Value.Check(CreativeWorkflowDocumentSchema, nextDocument)) {
      const first = [...Value.Errors(CreativeWorkflowDocumentSchema, nextDocument)][0];
      fail('creative_nl_edit_invalid', 422, `AI 生成的流程结构不符合契约 ${first?.path ?? '/'}：${first?.message ?? ''}`);
    }
    const validation = validateCreativeGraph(nextDocument);
    const prevNodes = new Map(rawInput.document.nodes.map((node) => [node.id, node]));
    const nextNodes = new Map(nextDocument.nodes.map((node) => [node.id, node]));
    const changes: string[] = [];
    if (rawInput.document.name !== nextDocument.name) {
      changes.push(`流程名称：${rawInput.document.name} → ${nextDocument.name}`);
    }
    for (const node of nextDocument.nodes) {
      const old = prevNodes.get(node.id);
      if (!old) changes.push(`新增节点：${node.label}（${node.kind}）`);
      else if (creativeHash(old) !== creativeHash(node)) changes.push(`调整节点：${node.label}`);
    }
    for (const node of rawInput.document.nodes) {
      if (!nextNodes.has(node.id)) changes.push(`移除节点：${node.label}`);
    }
    if (changes.length === 0 && rawInput.document.edges.length !== nextDocument.edges.length) {
      changes.push(`连线数量：${rawInput.document.edges.length} → ${nextDocument.edges.length}`);
    }
    const result: CreativeWorkflowNlEditResult = {
      summary,
      document: nextDocument,
      validation,
      changes,
      usage: { totalTokens },
    };
    assertSchema<CreativeWorkflowNlEditResult>(
      CreativeWorkflowNlEditResultSchema,
      result,
      'creative_nl_edit_invalid',
      '自然语言编辑结果',
    );
    return result;
  }

  publishWorkflow(id: string, expectedRevision: number): CreativeWorkflowVersion {
    return this.store.publishWorkflow(id, expectedRevision);
  }

  scopePolicy(input: unknown): CreativeScopePolicyView {
    assertSchema<CreativeScopePolicyRead>(
      CreativeScopePolicyReadSchema,
      input,
      'creative_policy_invalid',
      '范围审批策略请求',
    );
    return readCreativeScopePolicy(
      this.store,
      normalizeCreativeScope(input.scope),
    );
  }

  saveScopePolicy(input: unknown): CreativeScopePolicyView {
    assertSchema<CreativeScopePolicyPut>(
      CreativeScopePolicyPutSchema,
      input,
      'creative_policy_invalid',
      '范围审批策略',
    );
    return saveCreativeScopePolicy(this.store, {
      ...input,
      scope: normalizeCreativeScope(input.scope),
    });
  }

  run(id: string): CreativeRunDetail {
    return this.store.detail(id);
  }

  runs(): { items: CreativeRun[] } {
    return this.store.listRuns();
  }

  async startRun(
    input: CreativeStartRun,
    options: { assistantConversation?: boolean; deferWake?: boolean } = {},
  ): Promise<CreativeRun> {
    assertSchema<CreativeStartRun>(
      CreativeStartRunSchema,
      input,
      'creative_run_invalid',
      '运行请求',
    );
    const version = this.store.getVersion(input.workflowId, input.workflowVersion);
    if (!version) fail('creative_workflow_version_not_found', 404, '指定的已发布工作流版本不存在。');
    const conversationTemplate = isCreativeConversationWorkflow(version.document);
    const assistant = this.isManagedAssistantRun(input, version.document);
    const canonicalInput = canonical({
      ...input,
      scope: normalizeCreativeScope(input.scope, { allowGlobal: conversationTemplate }),
    });
    const existing = this.existingRun(canonicalInput);
    if (existing) return existing;
    if (conversationTemplate && !assistant) {
      fail(
        'creative_message_workflow_invalid',
        409,
        '总管权限只属于服务端当前发布模板，不能运行相似副本或旧版本。',
      );
    }
    if (Object.values(candidateWorkflowNames).includes(version.document.name)
      && input.input.externalCandidate !== true) {
      fail(
        'creative_external_workflow_reserved',
        409,
        '外部候选审核流程仅供外部 Agent 提交候选后由站内激活，不能直接创建运行。',
      );
    }
    if (assistant && options.assistantConversation !== true) {
      fail(
        'creative_message_required',
        409,
        '总管工作流必须通过站内对话接口创建，运行输入由服务端构造。',
      );
    }
    const parentRunId = this.speculationParent(canonicalInput);
    if (!assistant) this.domain.collectScopeContext(canonicalInput.scope);
    this.preflightMedia(version.document, canonicalInput.input);
    const roles = this.store.listRoles().items;
    this.preflightToolAuthorization(version.document, roles);
    const frozen = await this.freezeModels(version.document, roles);
    let run: CreativeRun;
    try {
      run = this.store.atomic(() => {
        const replay = this.existingRun(canonicalInput);
        if (replay) return replay;
        const created = this.store.startRun(canonicalInput, frozen.roles, parentRunId ?? undefined);
        this.insertModelRows(created.id, frozen.rows);
        return created;
      });
    } catch (error) {
      throw error;
    }
    if (this.schedulerStarted && options.deferWake !== true) this.runtime.wake(run.id);
    return run;
  }

  pauseRun(id: string, expectedRevision: number): CreativeRun {
    return this.runtime.pause(id, expectedRevision);
  }

  resumeRun(id: string, expectedRevision: number): CreativeRun {
    const run = this.requireRun(id);
    if (run.input.externalCandidate === true) {
      fail('creative_candidate_activation_required', 409, '外部候选必须通过站内激活入口设置预算并冻结模型。');
    }
    this.assertAgentModelsFrozen(run);
    return this.runtime.resume(id, expectedRevision);
  }

  cancelRun(id: string, expectedRevision: number): CreativeRun {
    return this.runtime.cancel(id, expectedRevision);
  }

  async startAlternativeRun(id: string, rawInput: unknown): Promise<CreativeRun> {
    assertSchema<CreativeAlternativeRunRequest>(
      CreativeAlternativeRunRequestSchema,
      rawInput,
      'creative_run_invalid',
      '对比分支启动参数',
    );
    const source = this.requireRun(id);
    if (isSystemInternalWorkflowName(this.store.getWorkflow(source.workflowId)?.document.name ?? '')) {
      fail('creative_workflow_reserved', 409, '系统托管运行不能发起分支对比。');
    }
    const angle = rawInput.angle.trim();
    if (!angle) fail('creative_run_invalid', 400, '请提供明确的对比分支方向说明。');
    const budget = rawInput.budget ?? source.budget;
    const baseInstruction = source.instruction.replace(/\n\n【对比分支走向要求】[\s\S]*$/u, '').trim();
    const version = this.store.getVersion(source.workflowId, source.workflowVersion);
    const workflow = this.store.getWorkflow(source.workflowId);
    const workflowVersion = workflow?.publishedVersion && workflow.publishedVersion >= 1
      ? workflow.publishedVersion
      : (version?.version ?? source.workflowVersion);
    return this.startRun({
      workflowId: source.workflowId,
      workflowVersion,
      idempotencyKey: rawInput.idempotencyKey,
      scope: source.scope,
      instruction: `${baseInstruction}\n\n【对比分支走向要求】${angle}`,
      budget,
      input: {
        ...source.input,
        alternativeOfRunId: source.id,
        alternativeAngle: angle,
      },
    });
  }

  async activateRun(id: string, input: CreativeRunActivation): Promise<CreativeRun> {
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
      fail('creative_run_invalid', 400, 'expectedRevision 必须是正整数。');
    }
    assertSchema<CreativeBudget>(
      CreativeStartRunSchema.properties.budget,
      input.budget,
      'creative_run_invalid',
      '激活预算',
    );
    const current = this.requireRun(id);
    if (current.status !== 'paused' || current.input.externalCandidate !== true) {
      fail('creative_run_state', 409, '只有暂停的外部候选可以激活。');
    }
    if (current.revision !== input.expectedRevision) {
      fail('creative_run_conflict', 409, '运行已更新，请刷新后重试。');
    }
    const version = this.store.getVersion(current.workflowId, current.workflowVersion);
    if (!version) fail('creative_workflow_version_not_found', 409, '候选固定工作流版本不存在。');
    const frozen = await this.freezeModels(version.document, this.store.listRoles().items);
    const activated = this.store.atomic(() => {
      const row = this.store.database.connection.prepare(
        'SELECT revision,status,role_snapshot_json FROM co_runs WHERE id=?',
      ).get(id) as { revision: number; status: CreativeRun['status']; role_snapshot_json: string } | undefined;
      if (!row) fail('creative_run_not_found', 404, '运行不存在。');
      if (row.revision !== input.expectedRevision || row.status !== 'paused') {
        fail('creative_run_conflict', 409, '运行已更新，请刷新后重试。');
      }
      const changed = this.store.database.connection.prepare(
        `UPDATE co_runs
         SET budget_json=?,role_snapshot_json=?,revision=revision+1,updated_at=?
         WHERE id=? AND revision=? AND status='paused'`,
      ).run(
        JSON.stringify(input.budget),
        JSON.stringify(frozen.roles),
        nowIso(),
        id,
        input.expectedRevision,
      );
      if (changed.changes !== 1) fail('creative_run_conflict', 409, '运行已更新，请刷新后重试。');
      this.insertModelRows(id, frozen.rows);
      return this.store.getRun(id)!;
    });
    return this.runtime.resume(id, activated.revision);
  }

  decision(id: string, input: CreativeDecision): CreativeApproval {
    const approval = this.store.decideApproval(id, input);
    if (this.schedulerStarted) this.runtime.wake(approval.runId);
    return approval;
  }

  recoverRun(
    id: string,
    nodeRunId: string,
    input: Parameters<CreativeRuntime['recover']>[2],
  ): CreativeRun {
    return this.runtime.recover(id, nodeRunId, input);
  }

  readContext(scope: CreativeScope): CreativeContext {
    return this.domain.collectScopeContext(normalizeCreativeScope(scope));
  }

  readMemoryFacts(
    scope: CreativeScope,
    query: CreativeAgentMemoryFactsQuery = {},
  ): Record<string, unknown> {
    return this.domain.memory.readFacts(normalizeCreativeScope(scope), query);
  }

  readMemoryEntries(
    scope: CreativeScope,
    options: CreativeAgentMemoryEntriesQuery = {},
  ): Record<string, unknown> {
    return this.domain.memory.readEntries(normalizeCreativeScope(scope), options);
  }

  async message(input: CreativeMessageRequest): Promise<CreativeMessageResponse> {
    assertSchema<CreativeMessageRequest>(
      CreativeMessageRequestSchema,
      input,
      'creative_message_invalid',
      '对话消息',
    );
    if (input.mode === 'ai') return this.aiConversationMessage(input);
    if (input.budget !== undefined || input.idempotencyKey !== undefined) {
      fail(
        'creative_message_options_invalid',
        400,
        'advisory 模式不能携带运行预算或运行幂等键。',
      );
    }
    const scope = normalizeCreativeScope(input.scope);
    const now = nowIso();
    const conversationId = input.conversationId ?? randomUUID();
    const userMessage = {
      id: randomUUID(),
      conversationId,
      role: 'user' as const,
      content: input.message.trim(),
      createdAt: now,
    };
    const proposal = this.advisoryProposal(scope, input.message);
    const assistantMessage = {
      id: randomUUID(),
      conversationId,
      role: 'assistant' as const,
      content: proposal
        ? `这是确定性规则建议，未调用模型，也未开始执行。已为当前范围选择「${this.workflowName(proposal.workflowId)}」；检查范围、版本与预算后可人工启动。`
        : '这是确定性规则建议，未调用模型，也未开始执行。当前范围还没有已发布流程，请先在流程页保存并发布。',
      createdAt: now,
    };
    const response: CreativeMessageResponse = {
      conversationId,
      message: assistantMessage,
      proposal,
    };
    assertSchema<CreativeMessageResponse>(
      CreativeMessageResponseSchema,
      response,
      'creative_message_invalid',
      '对话响应',
    );
    this.store.atomic(() => {
      const existing = this.store.database.connection.prepare(
        'SELECT scope_json FROM co_conversations WHERE id=?',
      ).get(conversationId) as { scope_json: string } | undefined;
      if (existing && creativeHash(JSON.parse(existing.scope_json)) !== creativeHash(scope)) {
        fail('creative_conversation_scope_conflict', 409, '对话已绑定其他作品范围，请新建对话。');
      }
      if (!existing) {
        this.store.database.connection.prepare(
          'INSERT INTO co_conversations(id,scope_json,created_at) VALUES (?,?,?)',
        ).run(conversationId, JSON.stringify(scope), now);
      }
      const insert = this.store.database.connection.prepare(
        'INSERT INTO co_messages(id,conversation_id,role,content,created_at) VALUES (?,?,?,?,?)',
      );
      insert.run(userMessage.id, conversationId, 'user', userMessage.content, now);
      insert.run(assistantMessage.id, conversationId, 'assistant', assistantMessage.content, now);
    });
    return response;
  }

  private async aiConversationMessage(
    input: CreativeMessageRequest,
  ): Promise<CreativeMessageResponse> {
    if (!input.budget || !input.idempotencyKey) {
      fail(
        'creative_message_options_required',
        400,
        'AI 总管运行必须同时提供 budget 与 idempotencyKey。',
      );
    }
    const scope = normalizeCreativeScope(input.scope, { allowGlobal: true });
    const conversationId = input.conversationId
      ?? `conversation_${creativeHash({
        mode: 'ai',
        idempotencyKey: input.idempotencyKey,
      }).slice(0, 40)}`;
    const assistantWorkflow = this.store.listWorkflows().items.find((workflow) =>
      workflow.publishedVersion > 0
      && isCreativeConversationWorkflow(workflow.document));
    if (!assistantWorkflow) {
      fail('creative_message_workflow_missing', 503, '服务端总管工作流尚未发布。');
    }
    const version = this.store.getVersion(
      assistantWorkflow.id,
      assistantWorkflow.publishedVersion,
    );
    if (!version || !isCreativeConversationWorkflow(version.document)) {
      fail('creative_message_workflow_missing', 503, '服务端总管工作流版本无效。');
    }
    const existingConversation = this.store.database.connection.prepare(
      'SELECT scope_json FROM co_conversations WHERE id=?',
    ).get(conversationId) as { scope_json: string } | undefined;
    if (existingConversation
      && creativeHash(JSON.parse(existingConversation.scope_json)) !== creativeHash(scope)) {
      fail('creative_conversation_scope_conflict', 409, '对话已绑定其他作品范围，请新建对话。');
    }
    const message = input.message.trim();
    const requestHash = creativeHash({
      mode: 'ai',
      conversationId,
      scope,
      message,
      budget: input.budget,
    });
    const existingKey = this.store.database.connection.prepare(
      'SELECT run_id FROM co_run_keys WHERE idempotency_key=?',
    ).get(input.idempotencyKey) as { run_id: string } | undefined;
    if (existingKey) {
      const run = this.requireRun(existingKey.run_id);
      if (run.workflowId !== assistantWorkflow.id
        || run.workflowVersion !== assistantWorkflow.publishedVersion
        || run.input.assistantMessageRequestHash !== requestHash
        || run.input.conversationId !== conversationId) {
        fail('creative_run_idempotency_conflict', 409, '同一提交键对应了不同的总管消息请求。');
      }
      const response = this.persistAssistantConversation({
        conversationId,
        scope,
        message,
        run,
        createdAt: run.createdAt,
      });
      if (this.schedulerStarted) this.runtime.wake(run.id);
      return response;
    }

    const history = this.store.database.connection.prepare(
      'SELECT role,content FROM co_messages WHERE conversation_id=? ORDER BY created_at,rowid DESC LIMIT ?',
    ).all(conversationId, 50) as Array<{ role: 'user' | 'assistant'; content: string }>;
    const conversationMessages = [
      ...history.reverse().map((entry) => ({
        role: entry.role,
        content: entry.content,
      })),
      { role: 'user' as const, content: message },
    ];
    const run = await this.startRun({
      workflowId: assistantWorkflow.id,
      workflowVersion: assistantWorkflow.publishedVersion,
      idempotencyKey: input.idempotencyKey,
      scope,
      instruction: message,
      budget: input.budget,
      input: {
        conversationId,
        conversationMessages,
        assistantCatalog: this.assistantCatalog(),
        assistantMessageRequestHash: requestHash,
        actionOrigin: 'admin-ui',
        ...(!scope.worldId && !scope.projectId
          ? { actionScope: 'global_work_create' }
          : {}),
      },
    }, { assistantConversation: true, deferWake: true });
    const response = this.persistAssistantConversation({
      conversationId,
      scope,
      message,
      run,
      createdAt: nowIso(),
    });
    if (this.schedulerStarted) this.runtime.wake(run.id);
    return response;
  }

  private persistAssistantConversation(input: {
    conversationId: string;
    scope: CreativeScope;
    message: string;
    run: CreativeRun;
    createdAt: string;
  }): CreativeMessageResponse {
    const conversationId = input.conversationId;
    const userId = `msg_${creativeHash({
      conversationId,
      key: input.run.id,
      role: 'user',
    }).slice(0, 40)}`;
    const assistantId = `msg_${creativeHash({
      conversationId,
      key: input.run.id,
      role: 'assistant',
    }).slice(0, 40)}`;
    const assistantContent = [
      `AI 创作总管运行已创建：${input.run.id}。`,
      `当前状态：${input.run.status}。实际回答、工作流建议或动作提案将在该运行产物中生成。`,
      '提案仍需站内人工审核；本次回复不表示动作、工作流或正式内容已经完成。',
    ].join('\n');
    this.store.atomic(() => {
      const existing = this.store.database.connection.prepare(
        'SELECT scope_json FROM co_conversations WHERE id=?',
      ).get(conversationId) as { scope_json: string } | undefined;
      if (existing && creativeHash(JSON.parse(existing.scope_json)) !== creativeHash(input.scope)) {
        fail('creative_conversation_scope_conflict', 409, '对话已绑定其他作品范围，请新建对话。');
      }
      if (!existing) {
        this.store.database.connection.prepare(
          'INSERT INTO co_conversations(id,scope_json,created_at) VALUES (?,?,?)',
        ).run(conversationId, JSON.stringify(input.scope), input.createdAt);
      }
      const insert = this.store.database.connection.prepare(
        `INSERT OR IGNORE INTO co_messages
          (id,conversation_id,role,content,created_at) VALUES (?,?,?,?,?)`,
      );
      insert.run(userId, conversationId, 'user', input.message, input.createdAt);
      insert.run(assistantId, conversationId, 'assistant', assistantContent, input.createdAt);
    });
    const row = this.store.database.connection.prepare(
      'SELECT * FROM co_messages WHERE id=?',
    ).get(assistantId) as {
      id: string;
      conversation_id: string;
      role: 'assistant';
      content: string;
      created_at: string;
    };
    const response: CreativeMessageResponse = {
      conversationId,
      message: {
        id: row.id,
        conversationId: row.conversation_id,
        role: row.role,
        content: row.content,
        createdAt: row.created_at,
      },
      runId: input.run.id,
      proposal: null,
    };
    assertSchema<CreativeMessageResponse>(
      CreativeMessageResponseSchema,
      response,
      'creative_message_invalid',
      '对话响应',
    );
    return response;
  }

  conversation(id: string) {
    const row = this.store.database.connection.prepare(
      'SELECT * FROM co_conversations WHERE id=?',
    ).get(id) as { id: string; scope_json: string } | undefined;
    if (!row) fail('creative_conversation_not_found', 404, '对话不存在。');
    const messages = this.store.database.connection.prepare(
      'SELECT * FROM co_messages WHERE conversation_id=? ORDER BY created_at,rowid LIMIT ?',
    ).all(id, CONVERSATION_MESSAGE_LIMIT) as Array<Record<string, unknown>>;
    const conversation = {
      id,
      scope: JSON.parse(row.scope_json),
      messages: messages.map((message) => ({
        id: String(message.id),
        conversationId: id,
        role: message.role,
        content: String(message.content),
        createdAt: String(message.created_at),
      })),
    };
    return Value.Check(CreativeConversationSchema, conversation)
      ? conversation
      : fail('creative_conversation_invalid', 500, '对话数据无法读取。');
  }

  async submitCandidate(
    input: CreativeAgentCandidateSubmission,
  ): Promise<CreativeAgentCandidateReceipt> {
    assertSchema<CreativeAgentCandidateSubmission>(
      CreativeAgentCandidateSubmissionSchema,
      input,
      'creative_agent_candidate_invalid',
      '外部候选',
    );
    const normalized = canonical({ ...input, scope: normalizeCreativeScope(input.scope) });
    const requestHash = creativeHash(normalized);
    const existing = this.externalCandidate(input.idempotencyKey);
    if (existing) {
      if (existing.request_hash !== requestHash) {
        fail('creative_agent_candidate_idempotency_conflict', 409, '同一候选提交键对应了不同内容。');
      }
      return { ...JSON.parse(existing.receipt_json) as CreativeAgentCandidateReceipt, replayed: true };
    }
    const context = this.domain.collectScopeContext(normalized.scope);
    if (context.contextHash !== normalized.contextHash
      || creativeHash(context.scope) !== creativeHash(normalized.scope)) {
      fail('creative_context_mismatch', 409, '候选使用的上下文与当前范围不一致，请重新读取上下文。');
    }
    if (normalized.kind === 'scene') {
      const validated = this.domain.validateCreativeScene(normalized.content, context);
      if (validated.directionApprovalId !== null) {
        fail(
          'creative_external_direction_approval',
          409,
          '外部场景不能补写事后方向批准；关键方向必须先走站内创作流程。',
        );
      }
      if (validated.simulation?.events.some((event) =>
        event.facts.some((fact) => fact.nature === 'author'))) {
        fail(
          'creative_external_direction_required',
          409,
          '外部场景包含作者级关键事实，必须先走站内方向审批。',
        );
      }
    }
    const workflow = this.seedWorkflow(externalWorkflow(normalized.kind));
    const version = this.store.getVersion(workflow.id, workflow.publishedVersion);
    if (!version) fail('creative_workflow_version_not_found', 409, '外部候选审核流程尚未发布。');
    const roles = this.store.listRoles().items.map((role) => ({ ...role, modelId: null }));
    const internalKey = `candidate_${creativeHash(normalized).slice(0, 32)}`;
    const internalKind = candidateInternalKinds[normalized.kind];
    const receipt = this.store.atomic((): CreativeAgentCandidateReceipt => {
      const replay = this.externalCandidate(normalized.idempotencyKey);
      if (replay) {
        if (replay.request_hash !== requestHash) {
          fail('creative_agent_candidate_idempotency_conflict', 409, '同一候选提交键对应了不同内容。');
        }
        return { ...JSON.parse(replay.receipt_json) as CreativeAgentCandidateReceipt, replayed: true };
      }
      const run = this.store.startRun({
        workflowId: workflow.id,
        workflowVersion: version.version,
        idempotencyKey: internalKey,
        scope: normalized.scope,
        instruction: `审核外部${normalized.kind}候选；等待站内设置预算并启动。`,
        budget: structuredClone(EXTERNAL_BUDGET),
        input: {
          externalCandidate: true,
          candidateKind: normalized.kind,
          contextHash: normalized.contextHash,
          contentHash: creativeHash(normalized.content),
          criticalChange: false,
        },
      }, roles);
      const paused = this.store.updateRun(run.id, { status: 'paused' }, run.revision);
      const contextNode = this.store.ensureNode(paused.id, 'external_context', 0, { scope: normalized.scope });
      const contextArtifact = this.store.putArtifact(contextNode.id, 'context', context, []);
      this.store.patchNode(contextNode.id, {
        status: 'succeeded',
        outputArtifactId: contextArtifact.id,
      });
      const candidateNode = this.store.ensureNode(paused.id, 'external_candidate', 0, {
        externalPrecompleted: true,
        contextArtifactId: contextArtifact.id,
      });
      const candidateArtifact = this.store.putArtifact(
        candidateNode.id,
        internalKind,
        normalized.content,
        [contextArtifact.id],
      );
      this.store.patchNode(candidateNode.id, {
        status: 'succeeded',
        outputArtifactId: candidateArtifact.id,
      });
      const createdAt = nowIso();
      const candidateReceipt: CreativeAgentCandidateReceipt = {
        candidate: {
          id: candidateArtifact.id,
          runId: paused.id,
          nodeRunId: candidateNode.id,
          kind: normalized.kind,
          status: 'candidate',
          contentHash: candidateArtifact.contentHash,
          contextHash: context.contextHash,
          createdAt,
        },
        review: { required: true, status: 'pending' },
        replayed: false,
      };
      assertSchema<CreativeAgentCandidateReceipt>(
        CreativeAgentCandidateReceiptSchema,
        candidateReceipt,
        'creative_agent_candidate_invalid',
        '候选回执',
      );
      this.store.database.connection.prepare(
        `INSERT INTO co_external_candidates
          (idempotency_key,request_hash,run_id,receipt_json) VALUES (?,?,?,?)`,
      ).run(normalized.idempotencyKey, requestHash, paused.id, JSON.stringify(candidateReceipt));
      return candidateReceipt;
    });
    return receipt;
  }

  private seed(): void {
    const existingRoles = new Map(this.store.listRoles().items.map((role) => [role.id, role]));
    for (const role of createDefaultCreativeRoles()) {
      if (!existingRoles.has(role.id)) this.store.saveRole(role);
    }
    for (const document of [
      createCreativeConversationWorkflow(),
      createStandardStorySceneWorkflow(),
      createCriticalStorySceneWorkflow(),
      createDefaultIllustrationWorkflow(),
      createDefaultVideoPlanWorkflow(),
      ...Object.keys(candidateWorkflowNames).map((kind) =>
        externalWorkflow(kind as CreativeAgentCandidateSubmission['kind'])),
    ]) this.seedWorkflow(document);
  }

  private seedWorkflow(document: CreativeWorkflowDocument): CreativeWorkflow {
    const workflows = this.store.listWorkflows().items;
    if (isCreativeConversationWorkflow(document)) {
      // A user may edit or publish a same-named copy. Never replace that draft:
      // the assistant scope exception requires both the current draft and its
      // latest immutable version to match the server-owned template exactly.
      const systemWorkflow = workflows.find((workflow) => {
        if (!isCreativeConversationWorkflow(workflow.document) || workflow.publishedVersion < 1) return false;
        const version = this.store.getVersion(workflow.id, workflow.publishedVersion);
        return Boolean(version && isCreativeConversationWorkflow(version.document));
      });
      if (systemWorkflow) return systemWorkflow;
      const created = this.store.createWorkflow(document);
      this.store.publishWorkflow(created.id, created.revision);
      return this.store.getWorkflow(created.id)!;
    }
    const existing = workflows.find((workflow) => workflow.document.name === document.name);
    if (existing) {
      // Upgrade unmodified legacy heavyweight default '故事场景创作' cleanly while retaining old published versions.
      if (
        document.name === '故事场景创作'
        && existing.document.description.startsWith('导演先规划；重大方向先经 plan 人工批准')
        && existing.document.nodes.some((n) => n.id === 'story_editor_review')
        && creativeHash(existing.document) !== creativeHash(document)
      ) {
        const updated = this.store.saveWorkflow(existing.id, {
          expectedRevision: existing.revision,
          document,
        });
        this.store.publishWorkflow(updated.id, updated.revision);
        return this.store.getWorkflow(updated.id)!;
      }
      if (existing.publishedVersion === 0
        && creativeHash(existing.document) === creativeHash(document)) {
        this.store.publishWorkflow(existing.id, existing.revision);
        return this.store.getWorkflow(existing.id)!;
      }
      return existing;
    }
    const created = this.store.createWorkflow(document);
    this.store.publishWorkflow(created.id, created.revision);
    return this.store.getWorkflow(created.id)!;
  }

  private isManagedAssistantRun(
    input: CreativeStartRun,
    versionDocument: CreativeWorkflowDocument,
  ): boolean {
    const workflow = this.store.getWorkflow(input.workflowId);
    return Boolean(
      workflow
      && workflow.publishedVersion > 0
      && workflow.publishedVersion === input.workflowVersion
      && isCreativeConversationWorkflow(workflow.document)
      && isCreativeConversationWorkflow(versionDocument),
    );
  }

  private assistantCatalog(): {
    workflows: CreativeWorkflow[];
    actions: CreativeActionCatalog;
  } {
    return {
      workflows: this.store.listWorkflows().items
        .filter((workflow) =>
          !isCreativeConversationWorkflow(workflow.document)
          && !Object.values(candidateWorkflowNames).includes(workflow.document.name))
        .map((workflow) => canonical(workflow)),
      actions: this.actions.catalog(),
    };
  }

  private existingRun(input: CreativeStartRun): CreativeRun | null {
    const key = this.store.database.connection.prepare(
      'SELECT run_id FROM co_run_keys WHERE idempotency_key=?',
    ).get(input.idempotencyKey) as { run_id: string } | undefined;
    if (!key) return null;
    const run = this.store.getRun(key.run_id);
    if (!run) fail('creative_run_not_found', 500, '幂等键指向的运行不存在。');
    if (run.workflowId !== input.workflowId
      || run.workflowVersion !== input.workflowVersion
      || creativeHash(run.scope) !== creativeHash(input.scope)
      || run.instruction !== input.instruction
      || creativeHash(run.budget) !== creativeHash(input.budget)
      || creativeHash(run.input) !== creativeHash(input.input)) {
      fail('creative_run_idempotency_conflict', 409, '同一提交键对应了不同的运行请求。');
    }
    this.assertAgentModelsFrozen(run);
    return run;
  }

  private speculationParent(input: CreativeStartRun): string | null {
    const candidateId = input.input.candidateArtifactId;
    if (candidateId === undefined) return null;
    if (typeof candidateId !== 'string' || !candidateId) {
      fail('creative_speculation_parent', 400, 'candidateArtifactId 必须是非空产物 ID。');
    }
    const row = this.store.database.connection.prepare(
      'SELECT run_id,kind,status,content_json FROM co_artifacts WHERE id=?',
    ).get(candidateId) as {
      run_id: string;
      kind: string;
      status: string;
      content_json: string;
    } | undefined;
    if (!row || row.kind !== 'scene' || row.status !== 'candidate') {
      fail('creative_speculation_parent', 409, '预写必须关联父运行中的待审场景候选。');
    }
    const parent = this.store.getRun(row.run_id);
    if (!parent || parent.status !== 'waiting_approval') {
      fail('creative_speculation_waiting', 409, '预写父场景必须正在等待人工确认。');
    }
    if (creativeHash(parent.scope) !== creativeHash(input.scope)) {
      fail('creative_scope_mismatch', 409, '预写范围必须与父场景完全一致。');
    }
    const content = JSON.parse(row.content_json) as Record<string, unknown>;
    if (creativeHash(content.scope) !== creativeHash(input.scope)) {
      fail('creative_scope_mismatch', 409, '候选场景内容与父运行范围不一致。');
    }
    if (content.speculation !== null && content.speculation !== undefined) {
      fail('creative_speculation_depth', 409, '最多预写一个后续场景，不能继续链式预写。');
    }
    const occupied = this.store.database.connection.prepare(
      'SELECT run_id FROM co_scene_speculations WHERE parent_artifact_id=?',
    ).get(candidateId);
    if (occupied) {
      fail('creative_speculation_limit', 409, '这一待审场景已经有一个预写运行。');
    }
    return parent.id;
  }

  private async freezeModels(
    document: CreativeWorkflowDocument,
    roles: CreativeRole[],
  ): Promise<FrozenModels> {
    const roleIds = new Set(this.roleIdsForWorkflow(document));
    const rolesById = new Map(roles.map((role) => [role.id, role]));
    const frozenRoles = canonical(roles);
    const rows: FrozenModels['rows'] = [];
    for (const roleId of roleIds) {
      const role = rolesById.get(roleId);
      if (!role) fail('creative_role_missing', 409, `工作流引用了不存在的岗位 ${roleId}。`);
      const profile = await resolveEffectiveModelProfile(
        this.options.database,
        this.options.secrets,
        'story-worlds',
        role.capability === 'multimodal' ? 'vision' : undefined,
        role.modelId ?? undefined,
      );
      if (!profile) {
        fail(
          'creative_model_unconfigured',
          409,
          `岗位「${role.name}」没有可用的${role.capability === 'multimodal' ? '看图' : '文本'}模型。`,
        );
      }
      const target = frozenRoles.find((entry) => entry.id === roleId)!;
      target.modelId = profile.id;
      rows.push({
        roleId,
        profileId: profile.id,
        profileHash: profileFingerprint(profile),
      });
    }
    return { roles: frozenRoles, rows };
  }

  private preflightToolAuthorization(
    document: CreativeWorkflowDocument,
    roles: readonly CreativeRole[],
    path: string[] = [],
  ): void {
    const rolesById = new Map(roles.map((role) => [role.id, role]));
    for (const node of document.nodes) {
      if (node.kind === 'tool') {
        const tool = node.config.tool;
        if (!tool || !(CREATIVE_TOOLS as readonly string[]).includes(tool)) {
          fail(
            'creative_tool_unregistered',
            409,
            `工具节点 ${node.id} 引用了未登记的可执行工具。`,
          );
        }
        if (node.roleId) {
          const role = rolesById.get(node.roleId);
          if (!role) {
            fail('creative_role_missing', 409, `工具节点引用了不存在的岗位 ${node.roleId}。`);
          }
          if (!role.tools.includes(tool)) {
            fail(
              'creative_tool_forbidden',
              409,
              `岗位「${role.name}」没有工具 ${tool} 的执行授权。`,
            );
          }
        } else if (!roles.some((role) => role.tools.includes(tool))) {
          fail(
            'creative_tool_forbidden',
            409,
            `没有冻结岗位获得工具 ${tool} 的执行授权。`,
          );
        }
      }
      if (node.kind !== 'subworkflow') continue;
      const workflowId = node.config.workflowId;
      const workflowVersion = node.config.workflowVersion;
      if (!workflowId || !workflowVersion) {
        fail('creative_subworkflow_missing', 409, `子流程节点 ${node.id} 缺少固定版本。`);
      }
      if (path.includes(workflowId)) {
        fail('creative_subworkflow_cycle', 409, '子流程引用形成循环，无法校验工具权限。');
      }
      const version = this.store.getVersion(workflowId, workflowVersion);
      if (!version) {
        fail('creative_subworkflow_missing', 409, `子流程 ${workflowId} 的固定版本不存在。`);
      }
      this.preflightToolAuthorization(
        version.document,
        roles,
        [...path, workflowId],
      );
    }
  }

  private insertModelRows(
    runId: string,
    rows: FrozenModels['rows'],
  ): void {
    const insert = this.store.database.connection.prepare(
      `INSERT INTO co_run_models(run_id,role_id,profile_id,profile_hash)
       VALUES (?,?,?,?) ON CONFLICT(run_id,role_id) DO UPDATE SET
       profile_id=excluded.profile_id,profile_hash=excluded.profile_hash`,
    );
    for (const row of rows) {
      insert.run(runId, row.roleId, row.profileId, row.profileHash);
    }
  }

  private assertAgentModelsFrozen(run: CreativeRun): void {
    const version = this.store.getVersion(run.workflowId, run.workflowVersion);
    if (!version) fail('creative_workflow_version_not_found', 409, '运行固定的工作流版本不存在。');
    const expected = this.roleIdsForWorkflow(version.document);
    if (!expected.length) return;
    const rows = this.store.database.connection.prepare(
      'SELECT role_id FROM co_run_models WHERE run_id=?',
    ).all(run.id) as Array<{ role_id: string }>;
    const frozen = new Set(rows.map((row) => row.role_id));
    const missing = expected.filter((roleId) => !frozen.has(roleId));
    if (missing.length) {
      fail('creative_model_unconfigured', 409, '运行还没有冻结完整岗位模型，不能开始或继续审核。');
    }
  }

  private advisoryProposal(
    scope: CreativeScope,
    message: string,
  ): CreativeMessageResponse['proposal'] {
    const illustration = /(插图|画面|图|image|illustration|镜头)/iu.test(message);
    const wantedPurposes = illustration ? ['illustration'] : ['story'];
    const workflow = this.store.listWorkflows().items
      .filter((item) => item.publishedVersion > 0 && wantedPurposes.includes(item.document.purpose))
      .sort((left, right) => left.document.name.localeCompare(right.document.name))[0]
      ?? this.store.listWorkflows().items
        .filter((item) => item.publishedVersion > 0
          && !Object.values(candidateWorkflowNames).includes(item.document.name))
        .sort((left, right) => left.document.name.localeCompare(right.document.name))[0];
    if (!workflow) return null;
    return {
      workflowId: workflow.id,
      workflowVersion: workflow.publishedVersion,
      instruction: message.trim().slice(0, 20000),
      input: {
        advisory: true,
        scope,
        originalMessage: message.trim(),
      },
      reason: '根据请求中的确定性关键词建议此流程；没有调用模型、没有执行，也没有批准费用。',
    };
  }

  private roleIdsForWorkflow(
    document: CreativeWorkflowDocument,
    path: string[] = [],
  ): string[] {
    const ids = new Set<string>();
    for (const node of document.nodes) {
      if (((node.kind === 'agent'
          && node.config.parameters?.externalPrecompleted !== true)
        || node.kind === 'tool')
        && node.roleId) {
        ids.add(node.roleId);
      }
      if (node.kind !== 'subworkflow') continue;
      const workflowId = node.config.workflowId;
      const workflowVersion = node.config.workflowVersion;
      if (!workflowId || !workflowVersion) {
        fail('creative_subworkflow_missing', 409, `子流程节点 ${node.id} 缺少固定版本。`);
      }
      if (path.includes(workflowId)) {
        fail('creative_subworkflow_cycle', 409, '子流程引用形成循环，无法冻结岗位模型。');
      }
      const version = this.store.getVersion(workflowId, workflowVersion);
      if (!version) fail('creative_subworkflow_missing', 409, `子流程 ${workflowId} 的固定版本不存在。`);
      for (const roleId of this.roleIdsForWorkflow(version.document, [...path, workflowId])) {
        ids.add(roleId);
      }
    }
    return [...ids].sort();
  }

  private preflightMedia(
    document: CreativeWorkflowDocument,
    input: Record<string, unknown>,
  ): void {
    const raw = input.media;
    const needsImage = this.workflowNeedsImage(document);
    if (raw === undefined && !needsImage) return;
    if (!raw) fail('creative_media_required', 400, '该流程需要运行级图片工作流配置。');
    assertSchema<MediaConfig>(mediaConfigSchema, raw, 'creative_media_invalid', '媒体配置');
    try {
      const resolved = resolveWorkflowAndEngine(this.options.database, CREATIVE_APP_ID, {
        purpose: 'default',
        workflowId: raw.workflowId,
        workflowVersion: raw.workflowVersion,
        isInternal: true,
      });
      if (resolved.workflow.category !== 'image') {
        fail('creative_media_workflow_invalid', 409, '所选工作流不是已发布图片工作流。');
      }
    } catch (error) {
      if (error instanceof CreativeServiceError) throw error;
      fail(
        'creative_media_workflow_invalid',
        409,
        error instanceof Error ? error.message : '所选图片工作流不可发布或不完整。',
      );
    }
  }

  private workflowNeedsImage(
    document: CreativeWorkflowDocument,
    path: string[] = [],
  ): boolean {
    for (const node of document.nodes) {
      if (node.kind === 'tool' && node.config.tool === 'image_generation') return true;
      if (node.kind !== 'subworkflow' || !node.config.workflowId || !node.config.workflowVersion) continue;
      if (path.includes(node.config.workflowId)) continue;
      const version = this.store.getVersion(node.config.workflowId, node.config.workflowVersion);
      if (version && this.workflowNeedsImage(version.document, [...path, node.config.workflowId])) {
        return true;
      }
    }
    return false;
  }

  private workflowName(id: string): string {
    return this.store.getWorkflow(id)?.document.name ?? '创作流程';
  }

  private externalCandidate(idempotencyKey: string): {
    request_hash: string;
    run_id: string;
    receipt_json: string;
  } | undefined {
    return this.options.database.connection.prepare(
      'SELECT request_hash,run_id,receipt_json FROM co_external_candidates WHERE idempotency_key=?',
    ).get(idempotencyKey) as {
      request_hash: string;
      run_id: string;
      receipt_json: string;
    } | undefined;
  }

  private requireRun(id: string): CreativeRun {
    const run = this.store.getRun(id);
    if (!run) fail('creative_run_not_found', 404, '创作运行不存在。');
    return run;
  }
}

export function createCreativeService(options: CreateCreativeServiceOptions): CreativeService {
  return new CreativeService(options);
}

export function creativeErrorStatus(error: unknown): { statusCode: number; code: string; message: string } {
  const value = error as {
    statusCode?: unknown;
    code?: unknown;
    message?: unknown;
  };
  const statusCode = typeof value?.statusCode === 'number'
    && value.statusCode >= 400
    && value.statusCode < 600
    ? value.statusCode : 500;
  return {
    statusCode,
    code: typeof value?.code === 'string' ? value.code : 'creative_internal_error',
    message: statusCode < 500 && typeof value?.message === 'string'
      ? value.message : '创作编排服务暂时无法完成请求。',
  };
}
