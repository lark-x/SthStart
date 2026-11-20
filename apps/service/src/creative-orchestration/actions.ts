import { randomUUID } from 'node:crypto';
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  CreateWorldBranchSchema,
  CreativeActionEntitySchema,
  CreativeActionPreviewItemSchema,
  CreativeActionPreviewSchema,
  CreativeWorkflowDocumentSchema,
  WorldAuthoringDraftSchema,
  type CreativeApproval,
  type CreativeActionEntity,
  type CreativeActionPreviewItem,
  type CreativeActionPreview,
  type CreativeArtifact,
  type CreativeRun,
  type CreativeScope,
  type CreativeWorkflowDocument,
  type WorldAuthoringDraft,
} from '@sthstart/contracts';
export {
  CreativeActionEntitySchema,
  CreativeActionPreviewItemSchema,
  CreativeActionPreviewSchema,
};
export type {
  CreativeActionEntity,
  CreativeActionPreviewItem,
  CreativeActionPreview,
};
import { nowIso, type ServiceDatabase } from '../database.js';
import {
  canonicalWork,
  characterWorks,
  editCharacterOrganization,
  upsertCharacterWorkHierarchy,
} from '../characters/organization.js';
import { StoryStore } from '../story/store.js';
import { StoryWorldStore } from '../story-worlds/store.js';
import { validateCreativeGraph } from './graph.js';
import {
  approvalBundleHash,
  CreativeStore,
  creativeHash,
} from './store.js';

const strict = { additionalProperties: false };
// Frozen canonical hash of the server-owned assistant template. A template
// change must update this hash together with conversation.ts and its tests.
export const CREATIVE_CONVERSATION_WORKFLOW_HASH =
  '2c030cf1eb502004bd5e5d6ae0fe012b1ac70f2efc0bc1fc6b7a1945c7b9c0ae';
const id = Type.String({ minLength: 1, maxLength: 160, pattern: '^[A-Za-z0-9_-]+$' });
const text = (maxLength: number) => Type.String({ maxLength });
const workNature = Type.Union([
  Type.Literal('canon'),
  Type.Literal('derivative'),
  Type.Literal('original'),
]);

export const WorkCreateArgsSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  nature: Type.Optional(workNature),
  parentWork: Type.Optional(Type.Union([Type.String({ maxLength: 200 }), Type.Null()])),
}, strict);
export type WorkCreateArgs = Static<typeof WorkCreateArgsSchema>;

export const WorldSetupCreateArgsSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  background: Type.Optional(text(12000)),
  workNature: Type.Optional(workNature),
  parentWork: Type.Optional(Type.Union([Type.String({ maxLength: 200 }), Type.Null()])),
  idempotencyKey: Type.Optional(id),
}, strict);
export type WorldSetupCreateArgs = Static<typeof WorldSetupCreateArgsSchema>;

export const WorldSetupUpdateArgsSchema = Type.Object({
  worldId: id,
  expectedRevision: Type.Integer({ minimum: 1 }),
  draft: WorldAuthoringDraftSchema,
  complete: Type.Boolean(),
}, strict);
export type WorldSetupUpdateArgs = Static<typeof WorldSetupUpdateArgsSchema>;

export const StoryProjectCreateArgsSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 120 }),
  summary: Type.Optional(Type.String({ maxLength: 4000 })),
  workId: Type.Optional(Type.Union([Type.String({ maxLength: 200 }), Type.Null()])),
}, strict);
export type StoryProjectCreateArgs = Static<typeof StoryProjectCreateArgsSchema>;

export const StoryDocumentCreateArgsSchema = Type.Object({
  projectId: id,
  kind: Type.Union([Type.Literal('world'), Type.Literal('scene'), Type.Literal('chapter')]),
  title: Type.String({ minLength: 1, maxLength: 120 }),
  body: Type.Optional(text(100000)),
}, strict);
export type StoryDocumentCreateArgs = Static<typeof StoryDocumentCreateArgsSchema>;

export const StoryDocumentUpdateArgsSchema = Type.Object({
  projectId: id,
  documentId: id,
  expectedRevision: Type.Integer({ minimum: 1 }),
  title: Type.String({ minLength: 1, maxLength: 120 }),
  body: text(100000),
}, strict);
export type StoryDocumentUpdateArgs = Static<typeof StoryDocumentUpdateArgsSchema>;

export const WorkflowCreateArgsSchema = Type.Object({
  document: CreativeWorkflowDocumentSchema,
}, strict);
export type WorkflowCreateArgs = Static<typeof WorkflowCreateArgsSchema>;

export const WorkflowUpdateArgsSchema = Type.Object({
  workflowId: id,
  expectedRevision: Type.Integer({ minimum: 1 }),
  instruction: Type.String({ minLength: 1, maxLength: 20000 }),
  document: CreativeWorkflowDocumentSchema,
}, strict);
export type WorkflowUpdateArgs = Static<typeof WorkflowUpdateArgsSchema>;

export const CharacterOrganizationUpdateArgsSchema = Type.Object({
  ids: Type.Array(id, { minItems: 1, maxItems: 100 }),
  work: Type.Optional(Type.String({ maxLength: 200 })),
  originType: Type.Optional(Type.Union([
    Type.Literal('ip'),
    Type.Literal('derivative'),
    Type.Literal('original'),
  ])),
  tags: Type.Optional(Type.Array(text(100), { maxItems: 50 })),
  groups: Type.Optional(Type.Array(text(100), { maxItems: 50 })),
  interpretation: Type.Optional(text(100)),
  favorite: Type.Optional(Type.Boolean()),
  fillEmpty: Type.Optional(Type.Boolean()),
  replaceTags: Type.Optional(Type.Boolean()),
  replaceGroups: Type.Optional(Type.Boolean()),
}, strict);
export type CharacterOrganizationUpdateArgs =
  Static<typeof CharacterOrganizationUpdateArgsSchema>;

export const TimelineBranchCreateArgsSchema = Type.Object({
  worldId: id,
  ...CreateWorldBranchSchema.properties,
}, strict);
export type TimelineBranchCreateArgs = Static<typeof TimelineBranchCreateArgsSchema>;

export const CREATIVE_ACTION_TOOLS = [
  'work.create',
  'world.setup.create',
  'world.setup.update',
  'story.project.create',
  'story.document.create',
  'story.document.update',
  'workflow.create',
  'workflow.update',
  'character.organization.update',
  'timeline.branch.create',
] as const;
export type CreativeActionTool = typeof CREATIVE_ACTION_TOOLS[number];
const ADMIN_ASSISTANT_ACTION_TOOLS: ReadonlySet<CreativeActionTool> = new Set([
  'work.create',
  'world.setup.create',
  'workflow.create',
  'workflow.update',
  'world.setup.update',
  'story.project.create',
]);

export const CreativeActionArgsSchemas: Record<CreativeActionTool, TSchema> = {
  'work.create': WorkCreateArgsSchema,
  'world.setup.create': WorldSetupCreateArgsSchema,
  'world.setup.update': WorldSetupUpdateArgsSchema,
  'story.project.create': StoryProjectCreateArgsSchema,
  'story.document.create': StoryDocumentCreateArgsSchema,
  'story.document.update': StoryDocumentUpdateArgsSchema,
  'workflow.create': WorkflowCreateArgsSchema,
  'workflow.update': WorkflowUpdateArgsSchema,
  'character.organization.update': CharacterOrganizationUpdateArgsSchema,
  'timeline.branch.create': TimelineBranchCreateArgsSchema,
};

const action = <T extends CreativeActionTool>(tool: T, args: TSchema) =>
  Type.Object({ tool: Type.Literal(tool), args }, strict);
export const CreativeActionRequestSchema = Type.Union([
  action('work.create', WorkCreateArgsSchema),
  action('world.setup.create', WorldSetupCreateArgsSchema),
  action('world.setup.update', WorldSetupUpdateArgsSchema),
  action('story.project.create', StoryProjectCreateArgsSchema),
  action('story.document.create', StoryDocumentCreateArgsSchema),
  action('story.document.update', StoryDocumentUpdateArgsSchema),
  action('workflow.create', WorkflowCreateArgsSchema),
  action('workflow.update', WorkflowUpdateArgsSchema),
  action('character.organization.update', CharacterOrganizationUpdateArgsSchema),
  action('timeline.branch.create', TimelineBranchCreateArgsSchema),
]);
export type CreativeActionRequest =
  | { tool: 'work.create'; args: WorkCreateArgs }
  | { tool: 'world.setup.create'; args: WorldSetupCreateArgs }
  | { tool: 'world.setup.update'; args: WorldSetupUpdateArgs }
  | { tool: 'story.project.create'; args: StoryProjectCreateArgs }
  | { tool: 'story.document.create'; args: StoryDocumentCreateArgs }
  | { tool: 'story.document.update'; args: StoryDocumentUpdateArgs }
  | { tool: 'workflow.create'; args: WorkflowCreateArgs }
  | { tool: 'workflow.update'; args: WorkflowUpdateArgs }
  | { tool: 'character.organization.update'; args: CharacterOrganizationUpdateArgs }
  | { tool: 'timeline.branch.create'; args: TimelineBranchCreateArgs };

export const CreativeActionPlanSchema = Type.Object({
  kind: Type.Literal('action-plan'),
  schemaVersion: Type.Literal(1),
  previewHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  actions: Type.Array(CreativeActionRequestSchema, { minItems: 1, maxItems: 1 }),
}, strict);
export type CreativeActionPlan = {
  kind: 'action-plan';
  schemaVersion: 1;
  previewHash: string;
  actions: [CreativeActionRequest];
};

export const CreativeAssistantActionProposalSchema = Type.Object({
  kind: Type.Literal('assistant-proposal'),
  answer: text(20000),
  intent: Type.Union([Type.Literal('apply_action'), Type.Literal('edit_workflow')]),
  action: CreativeActionRequestSchema,
  previewHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  preview: Type.Optional(CreativeActionPreviewSchema),
  proposal: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
}, strict);
export type CreativeAssistantActionProposal = {
  kind: 'assistant-proposal';
  answer: string;
  intent: 'apply_action' | 'edit_workflow';
  action: CreativeActionRequest;
  previewHash: string;
  preview?: CreativeActionPreview;
  proposal?: Record<string, unknown>;
};

export type CreativeActionCatalogEntry = {
  tool: CreativeActionTool;
  title: string;
  description: string;
  argsSchema: TSchema;
  scope: 'global-admin-work' | 'work' | 'project' | 'world' | 'workflow-library';
  requiresApproval: true;
};
export type CreativeActionCatalog = {
  schemaVersion: 1;
  singleActionOnly: true;
  tools: CreativeActionCatalogEntry[];
};

export type CreativeActionApplyResult = {
  schemaVersion: 1;
  adoptionId: string;
  previewHash: string;
  tool: CreativeActionTool;
  entity: CreativeActionEntity;
  result: Record<string, unknown>;
  replayed: boolean;
};

export class CreativeActionError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string) {
    super(message);
    this.name = 'CreativeActionError';
  }
}

function fail(code: string, message: string, statusCode = 409): never {
  throw new CreativeActionError(code, statusCode, message);
}

function actionError(code: string, message: string) {
  return { code, message };
}

function validateWorkflow(document: CreativeWorkflowDocument): string[] {
  const validation = validateCreativeGraph(document);
  return validation.valid
    ? []
    : validation.issues.map((entry) => `${entry.code}: ${entry.message}`);
}

function canonicalScopeWork(database: ServiceDatabase, scope: CreativeScope): string | null {
  if (scope.workName) return canonicalWork(database, scope.workName) || scope.workName.trim();
  if (!scope.projectId) return null;
  return new StoryStore(database).requireProject(scope.projectId).workId ?? null;
}

function setupIdempotencyKey(scope: CreativeScope, request: CreativeActionRequest): string {
  if (request.tool !== 'world.setup.create') return '';
  return request.args.idempotencyKey
    ?? `co_action_${creativeHash({ scope, request }).slice(0, 32)}`;
}

type Resolved = {
  valid: boolean;
  issues: Array<{ code: string; message: string }>;
  item: CreativeActionPreviewItem;
  snapshot: Record<string, unknown>;
};

export class CreativeActions {
  readonly store: CreativeStore;
  readonly stories: StoryStore;
  readonly worlds: StoryWorldStore;

  constructor(readonly database: ServiceDatabase) {
    this.store = new CreativeStore(database);
    this.stories = new StoryStore(database);
    this.worlds = new StoryWorldStore(database);
  }

  catalog(): CreativeActionCatalog {
    const rows: Array<[CreativeActionTool, string, string, CreativeActionCatalogEntry['scope']]> = [
      ['work.create', '创建作品', '创建或补齐作品层级；仅 admin UI 的显式 global_work_create scope 可执行。', 'global-admin-work'],
      ['world.setup.create', '创建世界草稿', '通过世界设置 API 创建待配置世界并写入最小背景，不自动启动运行。', 'work'],
      ['world.setup.update', '配置并完成世界', '以 expectedRevision CAS 保存地点、角色、背景和起始分支；complete=true 时原子创建正式世界与分支。', 'work'],
      ['story.project.create', '创建剧情项目', '创建独立的纯写作项目及主线大纲，不要求世界或时间线准备。', 'work'],
      ['story.document.create', '创建剧情文档', '在当前剧情项目中创建 world、scene 或 chapter 文档。', 'project'],
      ['story.document.update', '更新剧情文档', '以 expectedRevision CAS 更新当前项目中的文档。', 'project'],
      ['workflow.create', '创建工作流草稿', '创建通过图校验的工作流草稿，不自动发布。', 'workflow-library'],
      ['workflow.update', '编辑工作流草稿', '把自然语言编辑形成的新 document 以 CAS 写回同一工作流草稿，不新建副本。', 'workflow-library'],
      ['character.organization.update', '更新角色组织信息', '仅更新当前作品角色的分组、标签与组织字段，不允许秘密、密钥或删除。', 'work'],
      ['timeline.branch.create', '创建时间线分支', '在现有世界中以 expectedRevision CAS 创建分支。', 'world'],
    ];
    return {
      schemaVersion: 1,
      singleActionOnly: true,
      tools: rows.map(([tool, title, description, scope]) => ({
        tool,
        title,
        description,
        argsSchema: CreativeActionArgsSchemas[tool],
        scope,
        requiresApproval: true,
      })),
    };
  }

  preview(scope: CreativeScope, actions: unknown): CreativeActionPreview {
    const rawActions = Array.isArray(actions) ? actions : [];
    const issues: Array<{ code: string; message: string }> = [];
    if (rawActions.length !== 1) {
      issues.push(actionError(
        'creative_action_batch_forbidden',
        '动作包每次必须且只能包含一个动作；批次需要逐项审批和执行。',
      ));
    }
    for (const value of rawActions) {
      if (!Value.Check(CreativeActionRequestSchema, value)) {
        issues.push(actionError('creative_action_request_invalid', '动作工具或参数不符合登记契约。'));
      }
    }
    const validActions = rawActions.filter((value): value is CreativeActionRequest =>
      Value.Check(CreativeActionRequestSchema, value)
    );
    const resolved = validActions.map((request, index) => this.resolve(scope, request, index));
    for (const entry of resolved) issues.push(...entry.issues);
    const previewHash = creativeHash({
      schemaVersion: 1,
      scope,
      rawActions,
      snapshots: resolved.map((entry) => entry.snapshot),
    });
    return {
      schemaVersion: 1,
      scope: structuredClone(scope),
      previewHash,
      valid: issues.length === 0 && resolved.length === 1,
      issues,
      items: resolved.map((entry) => entry.item),
    };
  }

  apply(
    run: CreativeRun,
    inputArtifact: CreativeArtifact,
    inputApproval: CreativeApproval,
  ): CreativeActionApplyResult {
    return this.store.atomic(() => {
      const currentRun = this.store.getRun(run.id);
      const artifact = this.store.getArtifact(inputArtifact.id);
      const approval = this.store.getApproval(inputApproval.id);
      if (!currentRun
        || currentRun.status !== 'running'
        || creativeHash(currentRun.scope) !== creativeHash(run.scope)) {
        fail('creative_action_run_invalid', '动作只能由当前正在运行且范围未变化的创作运行采用。');
      }
      if (!artifact
        || artifact.runId !== currentRun.id
        || artifact.kind !== 'plan'
        || artifact.contentHash !== inputArtifact.contentHash
        || creativeHash(artifact.content) !== artifact.contentHash
        || artifact.status === 'stale'
        || artifact.status === 'superseded') {
        fail('creative_action_artifact_invalid', '动作计划产物不存在、已失效或不属于当前运行。');
      }
      if (!approval
        || approval.runId !== currentRun.id
        || approval.status !== 'approved'
        || !approval.decidedAt
        || !approval.artifactIds.includes(artifact.id)) {
        fail('creative_action_approval_required', '动作计划没有当前运行的有效采用批准。');
      }
      const closure = this.approvalClosure(approval.artifactIds);
      if (approvalBundleHash(closure.filter((entry) =>
        approval.artifactIds.includes(entry.id))) !== approval.bundleHash) {
        fail('creative_action_approval_stale', '动作计划审批包已变化。');
      }
      const planContent = artifact.content;
      const actionPlan = Value.Check(CreativeActionPlanSchema, planContent)
        ? planContent as CreativeActionPlan
        : null;
      const assistantProposal = Value.Check(CreativeAssistantActionProposalSchema, planContent)
        ? planContent as CreativeAssistantActionProposal
        : null;
      if (!actionPlan && !assistantProposal) {
        fail(
          'creative_action_plan_invalid',
          '审批产物必须是单动作 action-plan，或带 previewHash 的 assistant-proposal(action)。',
        );
      }
      const request = actionPlan?.actions[0] ?? assistantProposal!.action;
      const approvedPreviewHash = actionPlan?.previewHash ?? assistantProposal!.previewHash;
      const approvedActions = [request];

      const replay = this.database.connection.prepare(
        `SELECT preview_hash,tool,result_json FROM co_action_adoptions
         WHERE run_id=? AND artifact_id=? AND action_index=0`,
      ).get(currentRun.id, artifact.id) as {
        preview_hash: string;
        tool: string;
        result_json: string;
      } | undefined;
      if (replay) {
        if (replay.preview_hash !== approvedPreviewHash || replay.tool !== request.tool) {
          fail('creative_action_replay_conflict', '同一动作计划已记录不同的预览或工具。');
        }
        return {
          ...JSON.parse(replay.result_json) as CreativeActionApplyResult,
          replayed: true,
        };
      }

      const preview = this.preview(currentRun.scope, approvedActions);
      if (!preview.valid || preview.previewHash !== approvedPreviewHash) {
        fail('creative_action_preview_stale', '实体、范围或动作内容在预览后发生变化，请重新预览并批准。');
      }
      if (request.tool === 'work.create'
        && currentRun.input.actionScope !== 'global_work_create') {
        fail(
          'creative_action_admin_scope_required',
          '全局作品创建必须由 admin UI 以 explicit global_work_create scope 发起并批准。',
          403,
        );
      }
      if (request.tool === 'world.setup.create'
        && !currentRun.scope.workName
        && currentRun.input.actionScope !== 'global_work_create') {
        fail(
          'creative_action_admin_scope_required',
          '全局世界草稿创建必须由 admin UI 以 explicit global_work_create scope 发起并批准。',
          403,
        );
      }
      if (ADMIN_ASSISTANT_ACTION_TOOLS.has(request.tool)) {
        const workflowVersion = this.store.getVersion(
          currentRun.workflowId,
          currentRun.workflowVersion,
        );
        if (currentRun.input.actionOrigin !== 'admin-ui'
          || !workflowVersion
          || creativeHash(workflowVersion.document) !== CREATIVE_CONVERSATION_WORKFLOW_HASH) {
          fail(
            'creative_action_admin_template_required',
            '这项全局创作或配置动作只能由 admin UI 发起的服务固定 AI 总管模板采用。',
            403,
          );
        }
      }

      const resolved = this.resolve(currentRun.scope, request, 0);
      if (!resolved.valid) fail('creative_action_preview_invalid', resolved.issues[0]?.message ?? '动作预览无效。');
      this.assertResolvedSnapshot(resolved);
      const result = this.execute(currentRun, artifact, preview.previewHash, request, resolved.snapshot);
      const adoptionId = randomUUID();
      const now = nowIso();
      this.database.connection.prepare(
        `INSERT INTO co_action_adoptions
          (id,run_id,artifact_id,approval_id,action_index,tool,preview_hash,
           status,request_json,result_json,created_at,updated_at)
         VALUES (?,?,?,?,0,?,?,'applied',?,?,?,?)`,
      ).run(
        adoptionId,
        currentRun.id,
        artifact.id,
        approval.id,
        request.tool,
        preview.previewHash,
        JSON.stringify(request),
        JSON.stringify({ ...result, adoptionId }),
        now,
        now,
      );
      return { ...result, adoptionId, replayed: false };
    });
  }

  private approvalClosure(rootIds: string[]): CreativeArtifact[] {
    const found = new Map<string, CreativeArtifact>();
    const queue = [...rootIds];
    while (queue.length) {
      const artifactId = queue.shift()!;
      if (found.has(artifactId)) continue;
      const artifact = this.store.getArtifact(artifactId);
      if (!artifact
        || artifact.status === 'stale'
        || artifact.status === 'superseded'
        || creativeHash(artifact.content) !== artifact.contentHash) {
        fail('creative_action_approval_stale', '审批闭包中的产物已失效。');
      }
      found.set(artifactId, artifact);
      if (found.size > 2000) fail('creative_action_approval_stale', '审批闭包超过读取上限。');
      queue.push(...artifact.dependencyIds);
    }
    return [...found.values()];
  }

  private resolve(scope: CreativeScope, request: CreativeActionRequest, index: number): Resolved {
    const issues: Array<{ code: string; message: string }> = [];
    let entity: CreativeActionEntity;
    let operation: 'create' | 'update' = 'create';
    let changes: CreativeActionPreviewItem['changes'] = [];
    let requiresAdminScope = false;
    let affectsGlobalLibrary = false;
    const snapshot: Record<string, unknown> = {};

    if (request.tool === 'work.create') {
      if (scope.worldId || scope.projectId) {
        issues.push(actionError('creative_action_scope_invalid', 'work.create 只能使用显式 global work scope。'));
      }
      if (scope.workName && canonicalWork(this.database, scope.workName) !== request.args.name) {
        issues.push(actionError('creative_action_scope_mismatch', 'global work scope 必须与创建作品名称一致。'));
      }
      const current = characterWorks(this.database).find((entry) =>
        [entry.name, ...entry.aliases].some((name) =>
          name.toLowerCase() === request.args.name.trim().toLowerCase()
        )
      );
      entity = { kind: 'work', id: request.args.name, name: request.args.name };
      operation = current ? 'update' : 'create';
      changes = [
        { field: 'name', before: current?.name ?? null, after: request.args.name },
        { field: 'workNature', before: current?.workNature ?? null, after: request.args.nature ?? current?.workNature ?? 'canon' },
      ];
      requiresAdminScope = true;
      snapshot.current = current ?? null;
    } else if (request.tool === 'world.setup.create') {
      if (scope.worldId || scope.projectId) {
        issues.push(actionError(
          'creative_action_scope_invalid',
          'world.setup.create 只能使用全局或当前作品 scope。',
        ));
      }
      if (scope.workName
        && canonicalWork(this.database, scope.workName)?.toLowerCase()
          !== request.args.name.trim().toLowerCase()
        && scope.workName.trim().toLowerCase() !== request.args.name.trim().toLowerCase()) {
        issues.push(actionError(
          'creative_action_scope_mismatch',
          '创建世界草稿时当前作品 scope 必须与新世界同名。',
        ));
      }
      if (request.args.workNature === 'derivative'
        && canonicalWork(this.database, request.args.parentWork ?? '')
          !== canonicalWork(this.database, scope.workName ?? '')) {
        issues.push(actionError('creative_action_parent_work_invalid', '派生作品必须关联当前作品。'));
      }
      const key = setupIdempotencyKey(scope, request);
      const existing = this.database.connection.prepare(
        'SELECT id,revision FROM sw_world_setups WHERE creation_key=?',
      ).get(key) as { id: string; revision: number } | undefined;
      entity = {
        kind: 'world-setup',
        id: existing?.id ?? `setup-key:${key}`,
        name: request.args.name,
        ...(existing ? { revision: Number(existing.revision) } : {}),
      };
      operation = existing ? 'update' : 'create';
      changes = [
        { field: 'name', before: existing ? request.args.name : null, after: request.args.name },
        { field: 'background', before: null, after: request.args.background ?? '' },
        { field: 'completed', before: false, after: false },
      ];
      snapshot.setupIdempotencyKey = key;
      snapshot.existing = existing ?? null;
      requiresAdminScope = !scope.workName;
    } else if (request.tool === 'world.setup.update') {
      let setup: ReturnType<StoryWorldStore['getSetup']> | null = null;
      try {
        setup = this.worlds.getSetup(request.args.worldId);
      } catch {
        issues.push(actionError('creative_action_entity_missing', '待配置世界草稿不存在或已经完成。'));
      }
      if (setup) {
        const linkedWork = characterWorks(this.database).find((entry) =>
          entry.worldId === setup!.id
          && (!scope.workName || [entry.name, ...entry.aliases].some((name) =>
            name.trim().toLowerCase() === scope.workName!.trim().toLowerCase()
          ))
        );
        const titleMatches = Boolean(scope.workName)
          && scope.workName!.trim().toLowerCase()
            === setup.draft.definition.title.trim().toLowerCase();
        if (scope.worldId && scope.worldId !== setup.id) {
          issues.push(actionError(
            'creative_action_scope_mismatch',
            '世界配置动作的 worldId 与当前世界 scope 不一致。',
          ));
        }
        if (scope.workName && !linkedWork && !titleMatches) {
          issues.push(actionError(
            'creative_action_scope_mismatch',
            '世界配置动作的作品 scope 与待配置世界不一致。',
          ));
        }
        if (setup.revision !== request.args.expectedRevision) {
          issues.push(actionError(
            'creative_action_revision_conflict',
            '世界草稿已在预览后变化。',
          ));
        }

        const before = setup.draft;
        const after = request.args.draft;
        const actorSummary = (draft: WorldAuthoringDraft) => draft.definition.actors.map((actor) => ({
          id: actor.id,
          name: actor.name,
          role: actor.role,
          characterId: actor.characterId,
          locationId: actor.locationId,
        }));
        const locationSummary = (draft: WorldAuthoringDraft) =>
          draft.definition.locations.map((location) => ({
            id: location.id,
            name: location.name,
            description: location.description,
          }));
        const targetWorkName = linkedWork?.name ?? before.definition.title;
        entity = {
          kind: 'world-setup',
          id: setup.id,
          name: before.definition.title,
          revision: setup.revision,
        };
        operation = 'update';
        changes = [
          {
            field: 'background',
            before: before.definition.summary,
            after: after.definition.summary,
          },
          {
            field: 'locations',
            before: locationSummary(before),
            after: locationSummary(after),
          },
          {
            field: 'actors',
            before: actorSummary(before),
            after: actorSummary(after),
          },
          {
            field: 'initialBranch',
            before: before.initialBranch,
            after: after.initialBranch,
          },
          {
            field: 'scopeSelection',
            before: !scope.worldId && !scope.workName
              ? {
                  mode: 'global-admin-continuation',
                  selectedWork: null,
                  selectedWorld: null,
                }
              : {
                  mode: 'scoped',
                  selectedWork: scope.workName,
                  selectedWorld: scope.worldId,
                },
            after: {
              mode: 'explicit-target',
              workId: targetWorkName,
              workName: targetWorkName,
              setupId: setup.id,
            },
          },
          {
            field: 'completion',
            before: { status: 'pending', worldId: setup.id, branchId: null },
            after: request.args.complete
              ? {
                  status: 'ready',
                  creates: ['world', 'branch'],
                  worldId: setup.id,
                  branchTitle: after.initialBranch.title,
                }
              : { status: 'pending', worldId: setup.id, branchId: null },
          },
        ];
        requiresAdminScope = !scope.worldId && !scope.workName;
        snapshot.setup = setup;
        snapshot.scopeSelection = {
          scope,
          workId: targetWorkName,
          workName: targetWorkName,
          setupId: setup.id,
        };
      } else {
        entity = {
          kind: 'world-setup',
          id: request.args.worldId,
          name: request.args.draft.definition.title,
        };
        operation = 'update';
      }
    } else if (request.tool === 'story.project.create') {
      if (scope.projectId) {
        issues.push(actionError(
          'creative_action_scope_mismatch',
          '新剧情项目不能创建在另一个项目 scope 内。',
        ));
      }
      let scopedWorkId: string | null = null;
      if (scope.workName) {
        scopedWorkId = canonicalWork(this.database, scope.workName);
        if (!scopedWorkId) {
          issues.push(actionError(
            'creative_action_entity_missing',
            '当前作品 scope 没有已登记的作品身份。',
          ));
        }
      }
      if (scope.worldId) {
        const worldWork = characterWorks(this.database).find((entry) =>
          entry.worldId === scope.worldId
        );
        if (!worldWork) {
          issues.push(actionError(
            'creative_action_scope_mismatch',
            '当前世界 scope 没有可关联的作品身份。',
          ));
        } else if (scopedWorkId && scopedWorkId !== worldWork.name) {
          issues.push(actionError(
            'creative_action_scope_mismatch',
            '当前作品与世界 scope 指向不同作品。',
          ));
        } else {
          scopedWorkId = worldWork.name;
        }
      }
      let workId = scopedWorkId;
      if (request.args.workId !== undefined) {
        const requested = request.args.workId?.trim() || null;
        if (requested) {
          const canonical = canonicalWork(this.database, requested);
          if (!canonical) {
            issues.push(actionError(
              'creative_action_entity_missing',
              '指定的作品不存在，不能静默改挂其他作品。',
            ));
          } else if (scopedWorkId && canonical !== scopedWorkId) {
            issues.push(actionError(
              'creative_action_scope_mismatch',
              '项目 workId 与当前作品 scope 不一致。',
            ));
          } else {
            workId = canonical;
          }
        } else {
          if (scopedWorkId) {
            issues.push(actionError(
              'creative_action_scope_mismatch',
              '当前作品 scope 下不能显式解除项目归属。',
            ));
          }
          workId = null;
        }
      }
      requiresAdminScope = !scope.worldId && !scope.workName;
      entity = {
        kind: 'story-project',
        id: `project-key:${creativeHash({
          title: request.args.title,
          summary: request.args.summary ?? '',
          workId,
        }).slice(0, 24)}`,
        name: request.args.title,
      };
      changes = [
        { field: 'title', before: null, after: request.args.title },
        { field: 'summary', before: null, after: request.args.summary ?? '' },
        { field: 'workId', before: null, after: workId },
        {
          field: 'creates',
          before: null,
          after: ['story-project', 'outline'],
        },
      ];
      snapshot.projectWorkId = workId;
      snapshot.projectScope = structuredClone(scope);
    } else if (request.tool === 'story.document.create') {
      if (!scope.projectId || scope.projectId !== request.args.projectId) {
        issues.push(actionError('creative_action_scope_mismatch', '剧情文档创建必须属于当前项目 scope。'));
      }
      try {
        const project = this.stories.requireProject(request.args.projectId);
        snapshot.projectRevision = project.revision;
      } catch {
        issues.push(actionError('creative_action_entity_missing', '剧情项目不存在。'));
      }
      entity = {
        kind: 'story-document',
        id: `document-key:${creativeHash(request.args).slice(0, 24)}`,
        name: request.args.title,
      };
      changes = [
        { field: 'kind', before: null, after: request.args.kind },
        { field: 'title', before: null, after: request.args.title },
        { field: 'body', before: null, after: request.args.body ?? '' },
      ];
    } else if (request.tool === 'story.document.update') {
      if (!scope.projectId || scope.projectId !== request.args.projectId) {
        issues.push(actionError('creative_action_scope_mismatch', '剧情文档更新必须属于当前项目 scope。'));
      }
      const document = this.stories.getDocument(request.args.projectId, request.args.documentId);
      if (!document) {
        issues.push(actionError('creative_action_entity_missing', '剧情文档不存在。'));
        entity = { kind: 'story-document', id: request.args.documentId, name: request.args.title };
      } else {
        if (document.revision !== request.args.expectedRevision) {
          issues.push(actionError('creative_action_revision_conflict', '剧情文档已在预览后变化。'));
        }
        entity = { kind: 'story-document', id: document.id, name: document.title, revision: document.revision };
        operation = 'update';
        changes = [
          { field: 'title', before: document.title, after: request.args.title },
          { field: 'body', before: document.body, after: request.args.body },
        ];
        snapshot.document = document;
      }
    } else if (request.tool === 'workflow.create') {
      issues.push(...validateWorkflow(request.args.document).map((message) =>
        actionError('creative_action_workflow_invalid', message)
      ));
      entity = {
        kind: 'workflow',
        id: `workflow-key:${creativeHash(request.args.document).slice(0, 24)}`,
        name: request.args.document.name,
      };
      changes = [{ field: 'document', before: null, after: creativeHash(request.args.document) }];
      affectsGlobalLibrary = true;
      snapshot.documentHash = creativeHash(request.args.document);
    } else if (request.tool === 'workflow.update') {
      affectsGlobalLibrary = true;
      const workflow = this.store.getWorkflow(request.args.workflowId);
      if (!workflow) {
        issues.push(actionError('creative_action_entity_missing', '工作流草稿不存在。'));
        entity = { kind: 'workflow', id: request.args.workflowId, name: request.args.document.name };
      } else {
        if (workflow.revision !== request.args.expectedRevision) {
          issues.push(actionError('creative_action_revision_conflict', '工作流草稿已在预览后变化。'));
        }
        issues.push(...validateWorkflow(request.args.document).map((message) =>
          actionError('creative_action_workflow_invalid', message)
        ));
        entity = { kind: 'workflow', id: workflow.id, name: workflow.document.name, revision: workflow.revision };
        operation = 'update';
        changes = [
          { field: 'name', before: workflow.document.name, after: request.args.document.name },
          { field: 'instruction', before: null, after: request.args.instruction },
          { field: 'documentHash', before: creativeHash(workflow.document), after: creativeHash(request.args.document) },
        ];
        snapshot.workflow = workflow;
      }
    } else if (request.tool === 'character.organization.update') {
      const work = canonicalScopeWork(this.database, scope);
      if (!work) {
        issues.push(actionError('creative_action_scope_invalid', '角色组织更新必须有当前作品 scope。'));
      }
      const profiles = request.args.ids.map((characterId) =>
        this.database.connection.prepare(
          'SELECT id,draft_json,draft_revision FROM character_profiles WHERE id=? AND archived=0',
        ).get(characterId) as {
          id: string;
          draft_json: string;
          draft_revision: number;
        } | undefined
      );
      if (profiles.some((profile) => !profile)) {
        issues.push(actionError('creative_action_entity_missing', '至少一个角色不存在或已归档。'));
      }
      const profileWorkMismatch = profiles.some((profile) =>
        profile && canonicalWork(this.database, String(JSON.parse(profile.draft_json).work ?? '')) !== work
      );
      if (profileWorkMismatch) {
        issues.push(actionError('creative_action_scope_mismatch', '所选角色不属于当前作品 scope。'));
      }
      entity = {
        kind: 'character-organization',
        id: request.args.ids.join(','),
        name: `${request.args.ids.length} 位角色`,
      };
      changes = [
        { field: 'groups', before: null, after: request.args.groups ?? [] },
        { field: 'tags', before: null, after: request.args.tags ?? [] },
        { field: 'interpretation', before: null, after: request.args.interpretation ?? '' },
      ];
      snapshot.profiles = profiles.filter(Boolean).map((profile) => ({
        id: profile!.id,
        revision: Number(profile!.draft_revision),
        contentHash: creativeHash(JSON.parse(profile!.draft_json)),
      }));
    } else {
      if (!scope.worldId || scope.worldId !== request.args.worldId) {
        issues.push(actionError('creative_action_scope_mismatch', '时间线动作必须属于当前世界 scope。'));
      }
      const world = this.worlds.getWorld(request.args.worldId);
      if (world.revision !== request.args.expectedRevision) {
        issues.push(actionError('creative_action_revision_conflict', '世界已在预览后变化。'));
      }
      entity = {
        kind: 'world-branch',
        id: `branch-key:${creativeHash(request.args).slice(0, 24)}`,
        name: request.args.title,
      };
      changes = [
        { field: 'title', before: null, after: request.args.title },
        { field: 'mode', before: null, after: request.args.mode },
      ];
      snapshot.world = world;
    }

    return {
      valid: issues.length === 0,
      issues,
      item: {
        index,
        tool: request.tool,
        entity,
        operation,
        changes,
        requiresAdminScope,
        affectsGlobalLibrary,
        snapshotHash: creativeHash(snapshot),
      },
      snapshot,
    };
  }

  private assertResolvedSnapshot(resolved: Resolved): void {
    const snapshot = resolved.snapshot;
    if (snapshot.setup) {
      const setup = snapshot.setup as {
        id: string;
        revision: number;
        draft: WorldAuthoringDraft;
      };
      let current: ReturnType<StoryWorldStore['getSetup']> | null = null;
      try {
        current = this.worlds.getSetup(setup.id);
      } catch {
        current = null;
      }
      if (!current
        || current.revision !== setup.revision
        || creativeHash(current.draft) !== creativeHash(setup.draft)) {
        fail('creative_action_revision_conflict', '世界草稿已在预览后变化。');
      }
    }
    if (snapshot.document) {
      const document = snapshot.document as { id: string; projectId: string; revision: number };
      const current = this.stories.getDocument(document.projectId, document.id);
      if (!current || current.revision !== document.revision) {
        fail('creative_action_revision_conflict', '剧情文档已在预览后变化。');
      }
    }
    if (snapshot.workflow) {
      const workflow = snapshot.workflow as { id: string; revision: number };
      if (this.store.getWorkflow(workflow.id)?.revision !== workflow.revision) {
        fail('creative_action_revision_conflict', '工作流草稿已在预览后变化。');
      }
    }
    if (Array.isArray(snapshot.profiles)) {
      for (const profile of snapshot.profiles as Array<{ id: string; revision: number; contentHash: string }>) {
        const row = this.database.connection.prepare(
          'SELECT draft_json,draft_revision FROM character_profiles WHERE id=? AND archived=0',
        ).get(profile.id) as { draft_json: string; draft_revision: number } | undefined;
        if (!row
          || Number(row.draft_revision) !== profile.revision
          || creativeHash(JSON.parse(row.draft_json)) !== profile.contentHash) {
          fail('creative_action_revision_conflict', '角色资料已在预览后变化。');
        }
      }
    }
    if (snapshot.world) {
      const world = snapshot.world as { id: string; revision: number };
      if (this.worlds.getWorld(world.id).revision !== world.revision) {
        fail('creative_action_revision_conflict', '世界已在预览后变化。');
      }
    }
  }

  private execute(
    run: CreativeRun,
    artifact: CreativeArtifact,
    previewHash: string,
    request: CreativeActionRequest,
    snapshot: Record<string, unknown>,
  ): Omit<CreativeActionApplyResult, 'adoptionId' | 'replayed'> {
    let entity: CreativeActionEntity;
    let result: Record<string, unknown>;
    if (request.tool === 'work.create') {
      const work = upsertCharacterWorkHierarchy(this.database, {
        name: request.args.name,
        workNature: request.args.nature,
        parentWork: request.args.parentWork,
      });
      entity = { kind: 'work', id: work.name, name: work.name };
      result = { work };
    } else if (request.tool === 'world.setup.create') {
      const key = String(snapshot.setupIdempotencyKey);
      const created = this.worlds.createSetup({
        title: request.args.name,
        idempotencyKey: key,
        ...(request.args.workNature ? { workNature: request.args.workNature } : {}),
        ...(request.args.parentWork !== undefined ? { parentWork: request.args.parentWork } : {}),
      });
      const setup = this.worlds.getSetup(created.id);
      const draft = structuredClone(setup.draft) as WorldAuthoringDraft;
      draft.definition.summary = request.args.background ?? '';
      const saved = this.worlds.saveSetup(created.id, {
        expectedRevision: setup.revision,
        draft,
        complete: false,
      });
      if (saved.status !== 'pending') fail('creative_action_world_setup_invalid', '世界草稿不得在创建动作中自动完成。');
      entity = { kind: 'world-setup', id: saved.setup.id, name: saved.setup.draft.definition.title, revision: saved.setup.revision };
      result = { setup: saved.setup };
    } else if (request.tool === 'world.setup.update') {
      const saved = this.worlds.saveSetup(request.args.worldId, {
        expectedRevision: request.args.expectedRevision,
        draft: request.args.draft,
        complete: request.args.complete,
      });
      if (saved.status === 'ready') {
        entity = {
          kind: 'world-setup',
          id: saved.world.id,
          name: saved.world.title,
          revision: saved.world.revision,
        };
        result = {
          status: saved.status,
          world: saved.world,
          branch: saved.branch,
          worldId: saved.world.id,
          branchId: saved.branch.id,
        };
      } else {
        entity = {
          kind: 'world-setup',
          id: saved.setup.id,
          name: saved.setup.draft.definition.title,
          revision: saved.setup.revision,
        };
        result = {
          status: saved.status,
          setup: saved.setup,
          worldId: saved.setup.id,
          branchId: null,
        };
      }
    } else if (request.tool === 'story.project.create') {
      const workId = typeof snapshot.projectWorkId === 'string'
        ? snapshot.projectWorkId
        : null;
      const project = this.stories.createProject({
        title: request.args.title,
        ...(request.args.summary === undefined ? {} : { summary: request.args.summary }),
        workId,
      });
      entity = {
        kind: 'story-project',
        id: project.id,
        name: project.title,
        revision: project.revision,
      };
      result = {
        project,
        workId: project.workId ?? null,
        outline: this.stories.listDocuments(project.id).find((document) =>
          document.kind === 'outline'
        ) ?? null,
      };
    } else if (request.tool === 'story.document.create') {
      const document = this.stories.createDocument(request.args.projectId, {
        kind: request.args.kind,
        title: request.args.title,
        body: request.args.body,
      });
      entity = { kind: 'story-document', id: document.id, name: document.title, revision: document.revision };
      result = { document };
    } else if (request.tool === 'story.document.update') {
      const document = this.stories.updateDocument(request.args.projectId, request.args.documentId, {
        expectedRevision: request.args.expectedRevision,
        title: request.args.title,
        body: request.args.body,
      });
      entity = { kind: 'story-document', id: document.id, name: document.title, revision: document.revision };
      result = { document };
    } else if (request.tool === 'workflow.create') {
      const workflow = this.store.createWorkflow(request.args.document);
      entity = { kind: 'workflow', id: workflow.id, name: workflow.document.name, revision: workflow.revision };
      result = { workflow };
    } else if (request.tool === 'workflow.update') {
      const workflow = this.store.saveWorkflow(request.args.workflowId, {
        expectedRevision: request.args.expectedRevision,
        document: request.args.document,
      });
      entity = { kind: 'workflow', id: workflow.id, name: workflow.document.name, revision: workflow.revision };
      result = {
        workflow,
        sameWorkflow: workflow.id === request.args.workflowId,
        instruction: request.args.instruction,
      };
    } else if (request.tool === 'character.organization.update') {
      const update = editCharacterOrganization(this.database, request.args);
      entity = {
        kind: 'character-organization',
        id: request.args.ids.join(','),
        name: `${request.args.ids.length} 位角色`,
      };
      result = { ...update, ids: request.args.ids };
    } else {
      const branch = this.worlds.createBranch(request.args.worldId, {
        title: request.args.title,
        mode: request.args.mode,
        direction: request.args.direction,
        expectedRevision: request.args.expectedRevision,
        ...(request.args.parentBranchId ? { parentBranchId: request.args.parentBranchId } : {}),
        ...(request.args.forkTick === undefined ? {} : { forkTick: request.args.forkTick }),
      });
      entity = { kind: 'world-branch', id: branch.id, name: branch.title, revision: branch.revision };
      result = { branch };
    }
    return {
      schemaVersion: 1,
      previewHash,
      tool: request.tool,
      entity,
      result: {
        runId: run.id,
        artifactId: artifact.id,
        ...result,
      },
    };
  }
}

export function createCreativeActions(database: ServiceDatabase): CreativeActions {
  return new CreativeActions(database);
}
