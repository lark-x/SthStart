import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import type {
  CreativeArtifact,
  CreativeApproval,
  CreativeRole,
  CreativeRun,
  CreativeScope,
  CreativeWorkflowDocument,
  WorldAuthoringDraft,
  WorldDefinition,
} from '@sthstart/contracts';
import { upsertCharacterWorkHierarchy } from '../characters/organization.js';
import { ServiceDatabase } from '../database.js';
import { StoryStore } from '../story/store.js';
import { StoryWorldStore } from '../story-worlds/store.js';
import {
  CreativeAssistantActionProposalSchema,
  CreativeActionRequestSchema,
  CreativeActionPlanSchema,
  CreativeActions,
  CREATIVE_CONVERSATION_WORKFLOW_HASH,
  type CreativeActionRequest,
} from './actions.js';
import { CREATIVE_ACTION_STATEMENTS } from './action-migration.js';
import { createCreativeConversationWorkflow } from './conversation.js';
import { CREATIVE_ORCHESTRATION_STATEMENTS } from './migration.js';
import { CreativeStore, creativeHash } from './store.js';

const scopeForProject = (projectId: string): CreativeScope => ({
  workName: '动作测试作品',
  worldId: null,
  branchId: null,
  projectId,
});

const actionWorkflow = (): CreativeWorkflowDocument => ({
  name: '动作计划执行',
  description: '计划形成后经批准执行受控动作。',
  purpose: 'video-plan',
  nodes: [
    {
      id: 'action_context',
      kind: 'context',
      label: '动作上下文',
      outputKind: 'context',
      inputs: {},
      config: {},
      position: { x: 0, y: 0 },
    },
    {
      id: 'action_plan',
      kind: 'tool',
      label: '动作计划',
      outputKind: 'plan',
      inputs: { context: { nodeId: 'action_context', kind: 'context' } },
      config: { tool: 'video_plan' },
      position: { x: 100, y: 0 },
    },
    {
      id: 'action_approval',
      kind: 'approval',
      label: '批准动作',
      outputKind: 'decision',
      inputs: { plan: { nodeId: 'action_plan', kind: 'plan' } },
      config: {
        reviewerRoleIds: ['production_manager'],
        instruction: '批准实际动作包。',
      },
      position: { x: 200, y: 0 },
    },
    {
      id: 'action_adopt',
      kind: 'adopt',
      label: '采用动作',
      outputKind: 'result',
      inputs: { decision: { nodeId: 'action_approval', kind: 'decision' } },
      config: { instruction: '执行受控采用。' },
      position: { x: 300, y: 0 },
    },
  ],
  edges: [
    { id: 'action_context_plan', source: 'action_context', target: 'action_plan' },
    { id: 'action_plan_approval', source: 'action_plan', target: 'action_approval' },
    {
      id: 'action_approval_adopt',
      source: 'action_approval',
      target: 'action_adopt',
      when: 'approved',
    },
  ],
});

function configuredWorldDraft(base: WorldAuthoringDraft, summary: string): WorldAuthoringDraft {
  const draft = structuredClone(base);
  draft.definition.summary = summary;
  draft.definition.locations = [{
    id: 'harbor',
    name: '潮汐港口',
    description: '夜色中的木质码头。',
  }];
  draft.definition.actors = [{
    id: 'traveler',
    name: '旅人',
    role: 'main',
    characterId: null,
    characterVersion: null,
    background: '刚从海路抵达。',
    personality: '谨慎',
    speechStyle: '简短',
    appearance: '深色外套',
    goals: ['找到旧友'],
    locationId: 'harbor',
    referenceArtifactIds: [],
  }];
  draft.initialBranch = {
    title: '抵达港口',
    mode: 'canon-gap',
    direction: '从潮汐声和远处的灯火开始。',
  };
  return draft;
}

type Harness = {
  database: ServiceDatabase;
  store: CreativeStore;
  actions: CreativeActions;
  run: CreativeRun;
  approve(content: Record<string, unknown>): {
    artifact: CreativeArtifact;
    approval: CreativeApproval;
  };
};

function harness(
  scope: CreativeScope,
  input: Record<string, unknown> = {},
  suppliedDatabase?: ServiceDatabase,
  workflowDocument: CreativeWorkflowDocument = createCreativeConversationWorkflow(),
): Harness {
  const database = suppliedDatabase ?? new ServiceDatabase(':memory:');
  for (const statement of CREATIVE_ORCHESTRATION_STATEMENTS) database.connection.exec(statement);
  for (const statement of CREATIVE_ACTION_STATEMENTS) database.connection.exec(statement);
  const store = new CreativeStore(database);
  const workflow = store.createWorkflow(workflowDocument);
  const published = store.publishWorkflow(workflow.id, workflow.revision);
  const roles: CreativeRole[] = [];
  const started = store.startRun({
    workflowId: workflow.id,
    workflowVersion: published.version,
    idempotencyKey: `action-${randomUUID()}`,
    scope,
    instruction: '执行已批准动作',
    budget: { maxTextCalls: 1, maxImages: 0, maxTokens: 100, maxRevisions: 0 },
    input,
  }, roles);
  const run = store.updateRun(started.id, { status: 'running' }, started.revision);
  const planNodeId = workflowDocument.nodes.find((node) =>
    node.kind === 'tool' || node.kind === 'agent'
  )!.id;
  const approvalNodeId = workflowDocument.nodes.find((node) =>
    node.kind === 'approval'
  )!.id;
  const approvalNode = store.ensureNode(run.id, approvalNodeId, 0, {});
  return {
    database,
    store,
    actions: new CreativeActions(database),
    run,
    approve(content) {
      const planNode = store.ensureNode(run.id, planNodeId, 0, { contentHash: creativeKey(content) });
      const artifact = store.putArtifact(planNode.id, 'plan', content, []);
      const approval = store.requestApproval(approvalNode.id, [artifact.id]);
      const approved = store.decideApproval(approval.id, {
        expectedRevision: approval.revision,
        bundleHash: approval.bundleHash,
        decision: 'approve',
        comment: '批准动作',
      });
      return { artifact, approval: approved };
    },
  };
}

function creativeKey(value: unknown): string {
  return JSON.stringify(value).slice(0, 48);
}

function rejectNextActionLedgerInsert(database: ServiceDatabase): void {
  database.connection.exec(`
    CREATE TEMP TRIGGER reject_action_ledger
    BEFORE INSERT ON co_action_adoptions
    BEGIN
      SELECT RAISE(ABORT, 'fixture action ledger failure');
    END
  `);
}

function allowActionLedgerInsert(database: ServiceDatabase): void {
  database.connection.exec('DROP TRIGGER reject_action_ledger');
}

function isFixtureLedgerFailure(error: unknown): boolean {
  return (error as { message?: string }).message === 'fixture action ledger failure';
}

function approvedPlan(
  h: Harness,
  request: CreativeActionRequest,
): { artifact: CreativeArtifact; approval: CreativeApproval; previewHash: string } {
  const preview = h.actions.preview(h.run.scope, [request]);
  assert.equal(preview.valid, true, JSON.stringify(preview.issues));
  const content = {
    kind: 'action-plan',
    schemaVersion: 1,
    previewHash: preview.previewHash,
    actions: [request],
  };
  const approved = h.approve(content);
  return { ...approved, previewHash: preview.previewHash };
}

test('action catalog is bounded, approval-gated and contains only registered write tools', () => {
  const database = new ServiceDatabase(':memory:');
  try {
    const catalog = new CreativeActions(database).catalog();
    assert.equal(catalog.schemaVersion, 1);
    assert.equal(catalog.singleActionOnly, true);
    assert.deepEqual(catalog.tools.map((entry) => entry.tool), [
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
    ]);
    assert.ok(catalog.tools.every((entry) => entry.requiresApproval));
    assert.equal(catalog.tools.some((entry) => /delete|secret|provider|key/i.test(entry.tool)), false);
  } finally {
    database.close();
  }
});

test('workflow library admin template fingerprint stays synchronized', () => {
  assert.equal(
    creativeHash(createCreativeConversationWorkflow()),
    CREATIVE_CONVERSATION_WORKFLOW_HASH,
  );
});

test('preview rejects batches and does not invent unregistered action fields', () => {
  const database = new ServiceDatabase(':memory:');
  try {
    const actions = new CreativeActions(database);
    const one = { tool: 'workflow.create', args: { document: actionWorkflow() } };
    const preview = actions.preview(
      { workName: '动作测试作品', worldId: null, branchId: null, projectId: null },
      [one, { ...one, tool: 'work.create', args: { name: '第二项' } }],
    );
    assert.equal(preview.valid, false);
    assert.ok(preview.issues.some((entry) => entry.code === 'creative_action_batch_forbidden'));
    assert.equal(Value.Check(CreativeActionRequestSchema, {
      tool: 'character.organization.update',
      args: { ids: ['character'], delete: true },
    }), false);
  } finally {
    database.close();
  }
});

test('global work.create requires admin UI scope in addition to approval', () => {
  const deniedScope = {
    workName: '新作品',
    worldId: null,
    branchId: null,
    projectId: null,
  };
  const denied = harness(deniedScope);
  try {
    const plan = approvedPlan(denied, { tool: 'work.create', args: { name: '新作品', nature: 'original' } });
    assert.throws(
      () => denied.actions.apply(denied.run, plan.artifact, plan.approval),
      (error: unknown) => (error as { code?: string }).code === 'creative_action_admin_scope_required',
    );
  } finally {
    denied.database.close();
  }

  const allowed = harness(deniedScope, {
    actionScope: 'global_work_create',
    actionOrigin: 'admin-ui',
  });
  try {
    const plan = approvedPlan(allowed, {
      tool: 'work.create',
      args: { name: '新作品', nature: 'original' },
    });
    rejectNextActionLedgerInsert(allowed.database);
    assert.throws(
      () => allowed.actions.apply(allowed.run, plan.artifact, plan.approval),
      isFixtureLedgerFailure,
    );
    assert.equal(
      (allowed.database.connection.prepare(
        'SELECT COUNT(*) AS count FROM character_works WHERE name=?',
      ).get('新作品') as { count: number }).count,
      0,
    );
    allowActionLedgerInsert(allowed.database);
    const applied = allowed.actions.apply(allowed.run, plan.artifact, plan.approval);
    assert.equal(applied.entity.kind, 'work');
    assert.equal(
      (allowed.database.connection.prepare(
        'SELECT work_nature FROM character_works WHERE name=?',
      ).get('新作品') as { work_nature: string }).work_nature,
      'original',
    );
  } finally {
    allowed.database.close();
  }
});

test('empty scope can preview and create a work only from the admin assistant template', () => {
  const emptyScope: CreativeScope = {
    workName: null,
    worldId: null,
    branchId: null,
    projectId: null,
  };
  const h = harness(emptyScope, {
    actionScope: 'global_work_create',
    actionOrigin: 'admin-ui',
  });
  try {
    const request: CreativeActionRequest = {
      tool: 'work.create',
      args: { name: '零上下文新作品', nature: 'original' },
    };
    const preview = h.actions.preview(emptyScope, [request]);
    assert.equal(preview.valid, true, JSON.stringify(preview.issues));
    assert.equal(preview.items[0]?.requiresAdminScope, true);
    const plan = approvedPlan(h, request);
    const applied = h.actions.apply(h.run, plan.artifact, plan.approval);
    assert.equal(applied.entity.kind, 'work');
    assert.equal(h.run.input.actionScope, 'global_work_create');
    assert.equal(
      (h.database.connection.prepare(
        'SELECT COUNT(*) AS count FROM character_works WHERE name=?',
      ).get('零上下文新作品') as { count: number }).count,
      1,
    );
  } finally {
    h.database.close();
  }
});

test('workflow.update edits the same draft, records natural-language instruction and accepts an approved assistant proposal', () => {
  const database = new ServiceDatabase(':memory:');
  const project = new StoryStore(database).createProject({ title: '工作流编辑作品' });
  const h = harness(scopeForProject(project.id), { actionOrigin: 'admin-ui' }, database);
  try {
    const current = h.store.createWorkflow(actionWorkflow());
    const nextDocument = structuredClone(current.document);
    nextDocument.name = '自然语言编辑后的动作计划';
    const request: CreativeActionRequest = {
      tool: 'workflow.update',
      args: {
        workflowId: current.id,
        expectedRevision: current.revision,
        instruction: '把名称改成自然语言编辑后的动作计划，保持审核节点不变。',
        document: nextDocument,
      },
    };
    const preview = h.actions.preview(h.run.scope, [request]);
    assert.equal(preview.valid, true, JSON.stringify(preview.issues));
    assert.equal(preview.items[0]?.affectsGlobalLibrary, true);
    const approved = h.approve({
      kind: 'assistant-proposal',
      answer: '将把名称修改后写回同一草稿。',
      intent: 'edit_workflow',
      action: request,
      previewHash: preview.previewHash,
      preview,
    });
    rejectNextActionLedgerInsert(h.database);
    assert.throws(
      () => h.actions.apply(h.run, approved.artifact, approved.approval),
      isFixtureLedgerFailure,
    );
    assert.equal(h.store.getWorkflow(current.id)?.revision, current.revision);
    assert.equal(h.store.getWorkflow(current.id)?.document.name, current.document.name);
    allowActionLedgerInsert(h.database);
    const applied = h.actions.apply(h.run, approved.artifact, approved.approval);
    const replayed = h.actions.apply(h.run, approved.artifact, approved.approval);
    const updated = h.store.getWorkflow(current.id)!;
    assert.equal(applied.result.sameWorkflow, true);
    assert.equal(applied.replayed, false);
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.adoptionId, applied.adoptionId);
    assert.equal(updated.id, current.id);
    assert.equal(updated.revision, current.revision + 1);
    assert.equal(updated.document.name, nextDocument.name);
    assert.equal(
      (h.database.connection.prepare(
        'SELECT request_json FROM co_action_adoptions WHERE artifact_id=?',
      ).get(approved.artifact.id) as { request_json: string }).request_json.includes('自然语言'),
      true,
    );
    assert.equal(h.store.listWorkflows().items.filter((entry) => entry.id === current.id).length, 1);
  } finally {
    database.close();
  }
});

test('workflow.update rejects a reviewed plan after the draft changes', () => {
  const database = new ServiceDatabase(':memory:');
  const project = new StoryStore(database).createProject({ title: '工作流并发编辑作品' });
  const h = harness(scopeForProject(project.id), { actionOrigin: 'admin-ui' }, database);
  try {
    const current = h.store.createWorkflow(actionWorkflow());
    const proposed = structuredClone(current.document);
    proposed.name = '动作计划的自然语言修改';
    const request: CreativeActionRequest = {
      tool: 'workflow.update',
      args: {
        workflowId: current.id,
        expectedRevision: current.revision,
        instruction: '把名称改成动作计划的自然语言修改。',
        document: proposed,
      },
    };
    const plan = approvedPlan(h, request);
    const concurrent = structuredClone(current.document);
    concurrent.description = '用户在预览后完成的人工并发修改。';
    const saved = h.store.saveWorkflow(current.id, {
      expectedRevision: current.revision,
      document: concurrent,
    });

    assert.throws(
      () => h.actions.apply(h.run, plan.artifact, plan.approval),
      (error: unknown) => (error as { code?: string }).code === 'creative_action_preview_stale',
    );
    assert.equal(h.store.getWorkflow(current.id)?.revision, saved.revision);
    assert.equal(h.store.getWorkflow(current.id)?.document.description, concurrent.description);
  } finally {
    database.close();
  }
});

test('empty scope previews admin workflow library actions and rejects scoped document writes', () => {
  const database = new ServiceDatabase(':memory:');
  const emptyScope: CreativeScope = {
    workName: null,
    worldId: null,
    branchId: null,
    projectId: null,
  };
  const h = harness(emptyScope, {}, database);
  try {
    const current = h.store.createWorkflow(actionWorkflow());
    const next = structuredClone(current.document);
    next.description = '仅在全局工作流库中可见的修改。';
    const update = h.actions.preview(emptyScope, [{
      tool: 'workflow.update',
      args: {
        workflowId: current.id,
        expectedRevision: current.revision,
        instruction: '更新全局工作流库草稿。',
        document: next,
      },
    } satisfies CreativeActionRequest]);
    assert.equal(update.valid, true, JSON.stringify(update.issues));
    assert.equal(update.items[0]?.affectsGlobalLibrary, true);

    const create = h.actions.preview(emptyScope, [{
      tool: 'workflow.create',
      args: { document: actionWorkflow() },
    } satisfies CreativeActionRequest]);
    assert.equal(create.valid, true, JSON.stringify(create.issues));
    assert.equal(create.items[0]?.affectsGlobalLibrary, true);

    const unrelated = h.actions.preview(emptyScope, [{
      tool: 'story.document.create',
      args: {
        projectId: 'missing-project',
        kind: 'scene',
        title: '空 scope 不允许创建剧情',
      },
    } satisfies CreativeActionRequest]);
    assert.equal(unrelated.valid, false);
    assert.ok(unrelated.issues.some((issue) => issue.code === 'creative_action_scope_mismatch'));
  } finally {
    database.close();
  }
});

test('workflow apply requires the exact server assistant template and admin UI origin', () => {
  const emptyScope: CreativeScope = {
    workName: null,
    worldId: null,
    branchId: null,
    projectId: null,
  };

  const missingOrigin = harness(emptyScope);
  try {
    const document = actionWorkflow();
    document.name = '不能由外部 bridge 创建的工作流';
    const plan = approvedPlan(missingOrigin, {
      tool: 'workflow.create',
      args: { document },
    });
    assert.throws(
      () => missingOrigin.actions.apply(missingOrigin.run, plan.artifact, plan.approval),
      (error: unknown) => (error as { code?: string }).code
        === 'creative_action_admin_template_required',
    );
  } finally {
    missingOrigin.database.close();
  }

  const wrongTemplate = harness(
    emptyScope,
    { actionOrigin: 'admin-ui' },
    undefined,
    actionWorkflow(),
  );
  try {
    const document = actionWorkflow();
    document.name = '伪造总管模板不能创建工作流';
    const plan = approvedPlan(wrongTemplate, {
      tool: 'workflow.create',
      args: { document },
    });
    assert.throws(
      () => wrongTemplate.actions.apply(
        wrongTemplate.run,
        plan.artifact,
        plan.approval,
      ),
      (error: unknown) => (error as { code?: string }).code
        === 'creative_action_admin_template_required',
    );
  } finally {
    wrongTemplate.database.close();
  }
});

test('assistant proposal may embed the server preview without letting display data drive apply', () => {
  const emptyScope: CreativeScope = {
    workName: null,
    worldId: null,
    branchId: null,
    projectId: null,
  };
  const h = harness(emptyScope, { actionOrigin: 'admin-ui' });
  try {
    const document = actionWorkflow();
    document.name = '不信任展示对象的受控工作流';
    const request: CreativeActionRequest = {
      tool: 'workflow.create',
      args: { document },
    };
    const preview = h.actions.preview(emptyScope, [request]);
    assert.equal(preview.valid, true, JSON.stringify(preview.issues));
    const misleadingDisplay = structuredClone(preview);
    misleadingDisplay.previewHash = 'f'.repeat(64);
    misleadingDisplay.valid = false;
    const content = {
      kind: 'assistant-proposal',
      answer: '服务已生成完整预览，展示副本仅供审阅。',
      intent: 'edit_workflow',
      action: request,
      previewHash: preview.previewHash,
      preview: misleadingDisplay,
    };
    assert.equal(Value.Check(CreativeAssistantActionProposalSchema, content), true);
    const approved = h.approve(content);
    const applied = h.actions.apply(h.run, approved.artifact, approved.approval);
    assert.equal(applied.entity.kind, 'workflow');
    assert.equal(h.store.listWorkflows().items.some((workflow) =>
      workflow.document.name === document.name
    ), true);
  } finally {
    h.database.close();
  }
});

test('workflow.create writes a validated document and rolls back when the action ledger fails', () => {
  const database = new ServiceDatabase(':memory:');
  const project = new StoryStore(database).createProject({ title: '工作流创建作品' });
  const h = harness(scopeForProject(project.id), { actionOrigin: 'admin-ui' }, database);
  try {
    const document = actionWorkflow();
    document.name = '审批后创建的真实工作流';
    const request: CreativeActionRequest = {
      tool: 'workflow.create',
      args: { document },
    };
    const preview = h.actions.preview(h.run.scope, [request]);
    assert.equal(preview.valid, true, JSON.stringify(preview.issues));
    assert.equal(preview.items[0]?.affectsGlobalLibrary, true);
    const plan = approvedPlan(h, request);

    rejectNextActionLedgerInsert(database);
    assert.throws(
      () => h.actions.apply(h.run, plan.artifact, plan.approval),
      isFixtureLedgerFailure,
    );
    assert.equal(
      (database.connection.prepare(
        'SELECT COUNT(*) AS count FROM co_workflows WHERE json_extract(document_json, \'$.name\')=?',
      ).get(document.name) as { count: number }).count,
      0,
    );
    allowActionLedgerInsert(database);

    const applied = h.actions.apply(h.run, plan.artifact, plan.approval);
    assert.equal(applied.entity.kind, 'workflow');
    assert.equal(
      (database.connection.prepare(
        'SELECT COUNT(*) AS count FROM co_workflows WHERE json_extract(document_json, \'$.name\')=?',
      ).get(document.name) as { count: number }).count,
      1,
    );
  } finally {
    database.close();
  }
});

test('story.document.create apply succeeds and rolls back on a later action failure', () => {
  const database = new ServiceDatabase(':memory:');
  const stories = new StoryStore(database);
  const project = stories.createProject({ title: '场景创建动作作品' });
  const h = harness(scopeForProject(project.id), {}, database);
  try {
    const request: CreativeActionRequest = {
      tool: 'story.document.create',
      args: {
        projectId: project.id,
        kind: 'scene',
        title: '动作创建的真实场景',
        body: '只应在整个采用动作成功后存在。',
      },
    };
    const plan = approvedPlan(h, request);
    rejectNextActionLedgerInsert(database);
    assert.throws(
      () => h.actions.apply(h.run, plan.artifact, plan.approval),
      isFixtureLedgerFailure,
    );
    assert.equal(
      database.connection.prepare(
        'SELECT COUNT(*) AS count FROM story_documents WHERE project_id=? AND title=?',
      ).get(project.id, request.args.title)?.count,
      0,
    );
    allowActionLedgerInsert(database);

    const applied = h.actions.apply(h.run, plan.artifact, plan.approval);
    assert.equal(applied.entity.kind, 'story-document');
    const document = stories.getDocument(project.id, applied.entity.id);
    assert.equal(document?.title, request.args.title);
    assert.equal(document?.body, request.args.body);
  } finally {
    database.close();
  }
});

test('story.document.update apply succeeds and rolls back on a later action failure', () => {
  const database = new ServiceDatabase(':memory:');
  const stories = new StoryStore(database);
  const project = stories.createProject({ title: '场景更新动作作品' });
  const document = stories.createDocument(project.id, {
    kind: 'scene',
    title: '待更新场景',
    body: '原正文',
  });
  const h = harness(scopeForProject(project.id), {}, database);
  try {
    const request: CreativeActionRequest = {
      tool: 'story.document.update',
      args: {
        projectId: project.id,
        documentId: document.id,
        expectedRevision: document.revision,
        title: '已更新场景',
        body: '新正文',
      },
    };
    const plan = approvedPlan(h, request);
    rejectNextActionLedgerInsert(database);
    assert.throws(
      () => h.actions.apply(h.run, plan.artifact, plan.approval),
      isFixtureLedgerFailure,
    );
    assert.equal(stories.getDocument(project.id, document.id)?.title, document.title);
    assert.equal(stories.getDocument(project.id, document.id)?.revision, document.revision);
    allowActionLedgerInsert(database);

    const applied = h.actions.apply(h.run, plan.artifact, plan.approval);
    assert.equal(applied.entity.kind, 'story-document');
    assert.equal(stories.getDocument(project.id, document.id)?.title, request.args.title);
    assert.equal(stories.getDocument(project.id, document.id)?.body, request.args.body);
    assert.equal(stories.getDocument(project.id, document.id)?.revision, document.revision + 1);
  } finally {
    database.close();
  }
});

test('story document preview hash and expectedRevision reject a stale apply', () => {
  const database = new ServiceDatabase(':memory:');
  for (const statement of CREATIVE_ORCHESTRATION_STATEMENTS) database.connection.exec(statement);
  const stories = new StoryStore(database);
  const project = stories.createProject({ title: '动作文档' });
  const document = stories.createDocument(project.id, {
    kind: 'scene',
    title: '原场景',
    body: '原正文',
  });
  const h = harness(scopeForProject(project.id), {}, database);
  try {
    const request: CreativeActionRequest = {
      tool: 'story.document.update',
      args: {
        projectId: project.id,
        documentId: document.id,
        expectedRevision: document.revision,
        title: '修改后场景',
        body: '修改后正文',
      },
    };
    const plan = approvedPlan(h, request);
    stories.updateDocument(project.id, document.id, {
      expectedRevision: document.revision,
      title: '并发人工修改',
      body: '不应被动作计划覆盖',
    });
    assert.throws(
      () => h.actions.apply(h.run, plan.artifact, plan.approval),
      (error: unknown) => (error as { code?: string }).code === 'creative_action_preview_stale'
        || (error as { code?: string }).code === 'creative_action_preview_invalid',
    );
    assert.equal(stories.getDocument(project.id, document.id)?.title, '并发人工修改');
  } finally {
    database.close();
  }
});

test('global world.setup.create writes a bounded pending setup without requiring prior work scope', () => {
  const h = harness({
    workName: null,
    worldId: null,
    branchId: null,
    projectId: null,
  }, {
    actionScope: 'global_work_create',
    actionOrigin: 'admin-ui',
  });
  try {
    const request: CreativeActionRequest = {
      tool: 'world.setup.create',
      args: {
        name: '海港世界',
        background: '一座在潮汐中移动的港城。',
        workNature: 'original',
        idempotencyKey: 'action-world-setup-rollback',
      },
    };
    const plan = approvedPlan(h, request);
    rejectNextActionLedgerInsert(h.database);
    assert.throws(
      () => h.actions.apply(h.run, plan.artifact, plan.approval),
      isFixtureLedgerFailure,
    );
    assert.equal(
      (h.database.connection.prepare(
        'SELECT COUNT(*) AS count FROM sw_world_setups WHERE creation_key=?',
      ).get('action-world-setup-rollback') as { count: number }).count,
      0,
    );
    allowActionLedgerInsert(h.database);

    const applied = h.actions.apply(h.run, plan.artifact, plan.approval);
    assert.equal(applied.entity.kind, 'world-setup');
    const row = h.database.connection.prepare(
      'SELECT id,revision,draft_json,completed_branch_id FROM sw_world_setups WHERE title=?',
    ).get('海港世界') as {
      id: string;
      revision: number;
      draft_json: string;
      completed_branch_id: string | null;
    };
    assert.equal(row.completed_branch_id, null);
    assert.equal(JSON.parse(row.draft_json).definition.summary, '一座在潮汐中移动的港城。');
  } finally {
    h.database.close();
  }
});

test('world.setup.update previews full configuration and rejects a stale setup revision', () => {
  const database = new ServiceDatabase(':memory:');
  const worlds = new StoryWorldStore(database);
  const setup = worlds.createSetup({
    title: '并发配置世界',
    workNature: 'original',
    idempotencyKey: 'world-update-conflict',
  });
  const h = harness({
    workName: '并发配置世界',
    worldId: setup.id,
    branchId: null,
    projectId: null,
  }, { actionOrigin: 'admin-ui' }, database);
  try {
    const draft = configuredWorldDraft(worlds.getSetup(setup.id).draft, '预览中的海港背景。');
    const request: CreativeActionRequest = {
      tool: 'world.setup.update',
      args: {
        worldId: setup.id,
        expectedRevision: 1,
        draft,
        complete: true,
      },
    };
    const preview = h.actions.preview(h.run.scope, [request]);
    assert.equal(preview.valid, true, JSON.stringify(preview.issues));
    const wrongScope = h.actions.preview({
      workName: null,
      worldId: 'different-world',
      branchId: null,
      projectId: null,
    }, [request]);
    assert.equal(wrongScope.valid, false);
    assert.ok(wrongScope.issues.some((issue) =>
      issue.code === 'creative_action_scope_mismatch'
    ));
    assert.ok(preview.items[0]?.changes.some((change) =>
      change.field === 'locations'
      && Array.isArray(change.after)
      && change.after.some((location) =>
        (location as { name?: string }).name === '潮汐港口'
      )
    ));
    assert.ok(preview.items[0]?.changes.some((change) =>
      change.field === 'actors'
      && Array.isArray(change.after)
      && change.after.some((actor) => (actor as { name?: string }).name === '旅人')
    ));
    assert.ok(preview.items[0]?.changes.some((change) =>
      change.field === 'completion'
      && (change.after as { creates?: string[] }).creates?.join(',') === 'world,branch'
    ));

    const plan = approvedPlan(h, request);
    worlds.saveSetup(setup.id, {
      expectedRevision: 1,
      complete: false,
      draft: configuredWorldDraft(worlds.getSetup(setup.id).draft, '并发人工修改。'),
    });
    assert.throws(
      () => h.actions.apply(h.run, plan.artifact, plan.approval),
      (error: unknown) => (error as { code?: string }).code === 'creative_action_preview_stale',
    );
    assert.equal(worlds.getSetup(setup.id).revision, 2);
    assert.equal(worlds.list().items.some((world) => world.id === setup.id), false);
  } finally {
    database.close();
  }
});

test('empty scope can explicitly continue a pending world setup through the admin assistant', () => {
  const database = new ServiceDatabase(':memory:');
  const worlds = new StoryWorldStore(database);
  const setup = worlds.createSetup({
    title: '全局继续配置世界',
    workNature: 'original',
    idempotencyKey: 'world-update-global-continuation',
  });
  const emptyScope: CreativeScope = {
    workName: null,
    worldId: null,
    branchId: null,
    projectId: null,
  };
  const h = harness(emptyScope, {
    actionOrigin: 'admin-ui',
  }, database);
  try {
    const request: CreativeActionRequest = {
      tool: 'world.setup.update',
      args: {
        worldId: setup.id,
        expectedRevision: 1,
        draft: configuredWorldDraft(worlds.getSetup(setup.id).draft, '全局对话继续完善世界。'),
        complete: false,
      },
    };
    const preview = h.actions.preview(emptyScope, [request]);
    assert.equal(preview.valid, true, JSON.stringify(preview.issues));
    assert.equal(preview.items[0]?.requiresAdminScope, true);
    assert.equal(preview.items[0]?.entity.id, setup.id);
    assert.equal(preview.items[0]?.entity.name, '全局继续配置世界');
    const scopeChange = preview.items[0]?.changes.find((change) =>
      change.field === 'scopeSelection'
    );
    assert.deepEqual(scopeChange?.before, {
      mode: 'global-admin-continuation',
      selectedWork: null,
      selectedWorld: null,
    });
    assert.deepEqual(scopeChange?.after, {
      mode: 'explicit-target',
      workId: '全局继续配置世界',
      workName: '全局继续配置世界',
      setupId: setup.id,
    });

    const plan = approvedPlan(h, request);
    const applied = h.actions.apply(h.run, plan.artifact, plan.approval);
    assert.equal(applied.entity.kind, 'world-setup');
    assert.equal(applied.result.branchId, null);
    assert.equal(worlds.getSetup(setup.id).revision, 2);
    assert.equal(worlds.list().items.some((world) => world.id === setup.id), false);
  } finally {
    database.close();
  }
});

test('empty scope world setup update cannot run from an external or non-assistant template', () => {
  const database = new ServiceDatabase(':memory:');
  const worlds = new StoryWorldStore(database);
  const setup = worlds.createSetup({
    title: '禁止外部续配世界',
    workNature: 'original',
    idempotencyKey: 'world-update-external-denied',
  });
  const emptyScope: CreativeScope = {
    workName: null,
    worldId: null,
    branchId: null,
    projectId: null,
  };
  const h = harness(
    emptyScope,
    { actionOrigin: 'admin-ui' },
    database,
    actionWorkflow(),
  );
  try {
    const plan = approvedPlan(h, {
      tool: 'world.setup.update',
      args: {
        worldId: setup.id,
        expectedRevision: 1,
        draft: configuredWorldDraft(worlds.getSetup(setup.id).draft, '外部尝试写入。'),
        complete: false,
      },
    });
    assert.throws(
      () => h.actions.apply(h.run, plan.artifact, plan.approval),
      (error: unknown) => (error as { code?: string }).code
        === 'creative_action_admin_template_required',
    );
    assert.equal(worlds.getSetup(setup.id).revision, 1);
  } finally {
    database.close();
  }
});

test('world.setup.update completion atomically creates world and branch, including ledger rollback', () => {
  const database = new ServiceDatabase(':memory:');
  const worlds = new StoryWorldStore(database);
  const setup = worlds.createSetup({
    title: '完整世界闭环',
    workNature: 'original',
    idempotencyKey: 'world-update-success',
  });
  const h = harness({
    workName: null,
    worldId: setup.id,
    branchId: null,
    projectId: null,
  }, { actionOrigin: 'admin-ui' }, database);
  try {
    const request: CreativeActionRequest = {
      tool: 'world.setup.update',
      args: {
        worldId: setup.id,
        expectedRevision: 1,
        draft: configuredWorldDraft(worlds.getSetup(setup.id).draft, '可供推演的完整世界。'),
        complete: true,
      },
    };
    const plan = approvedPlan(h, request);

    rejectNextActionLedgerInsert(database);
    assert.throws(
      () => h.actions.apply(h.run, plan.artifact, plan.approval),
      isFixtureLedgerFailure,
    );
    assert.equal(worlds.getSetup(setup.id).revision, 1);
    assert.equal(worlds.list().items.some((world) => world.id === setup.id), false);
    assert.equal(
      (database.connection.prepare(
        'SELECT COUNT(*) AS count FROM sw_branches WHERE world_id=?',
      ).get(setup.id) as { count: number }).count,
      0,
    );

    allowActionLedgerInsert(database);
    const applied = h.actions.apply(h.run, plan.artifact, plan.approval);
    assert.equal(applied.entity.kind, 'world-setup');
    assert.equal(applied.result.status, 'ready');
    assert.equal(typeof applied.result.branchId, 'string');
    const branchId = String(applied.result.branchId);
    assert.equal(worlds.getWorld(setup.id).title, '完整世界闭环');
    assert.equal(worlds.getBranch(setup.id, branchId).title, '抵达港口');
    assert.throws(() => worlds.getSetup(setup.id), /找不到待配置的世界/);
  } finally {
    database.close();
  }
});

test('story.project.create creates pure writing projects and rolls back on a later action failure', () => {
  const database = new ServiceDatabase(':memory:');
  const stories = new StoryStore(database);
  upsertCharacterWorkHierarchy(database, {
    name: '纯写作项目作品',
    workNature: 'original',
  });
  upsertCharacterWorkHierarchy(database, {
    name: '另一个作品',
    workNature: 'original',
  });
  const emptyScope: CreativeScope = {
    workName: null,
    worldId: null,
    branchId: null,
    projectId: null,
  };
  const h = harness(emptyScope, {
    actionOrigin: 'admin-ui',
  }, database);
  try {
    const request: CreativeActionRequest = {
      tool: 'story.project.create',
      args: {
        title: '没有世界准备的纯写作',
        summary: '直接进入文本创作。',
        workId: '纯写作项目作品',
      },
    };
    const preview = h.actions.preview(emptyScope, [request]);
    assert.equal(preview.valid, true, JSON.stringify(preview.issues));
    assert.equal(preview.items[0]?.entity.kind, 'story-project');
    assert.equal(preview.items[0]?.requiresAdminScope, true);
    assert.ok(preview.items[0]?.changes.some((change) =>
      change.field === 'workId' && change.after === '纯写作项目作品'
    ));

    const invalidScope = h.actions.preview({
      workName: '另一个作品',
      worldId: null,
      branchId: null,
      projectId: null,
    }, [request]);
    assert.equal(invalidScope.valid, false);
    assert.ok(invalidScope.issues.some((issue) =>
      issue.code === 'creative_action_scope_mismatch'
    ));

    const plan = approvedPlan(h, request);
    rejectNextActionLedgerInsert(database);
    assert.throws(
      () => h.actions.apply(h.run, plan.artifact, plan.approval),
      isFixtureLedgerFailure,
    );
    assert.equal(
      (database.connection.prepare(
        'SELECT COUNT(*) AS count FROM story_projects WHERE title=?',
      ).get(request.args.title) as { count: number }).count,
      0,
    );
    allowActionLedgerInsert(database);

    const applied = h.actions.apply(h.run, plan.artifact, plan.approval);
    assert.equal(applied.entity.kind, 'story-project');
    assert.equal(applied.result.workId, '纯写作项目作品');
    const project = stories.getProject(applied.entity.id)!;
    assert.equal(project.title, request.args.title);
    assert.equal(project.workId, '纯写作项目作品');
    assert.equal(
      stories.listDocuments(project.id).filter((document) =>
        document.kind === 'outline'
      ).length,
      1,
    );
  } finally {
    database.close();
  }
});

test('character.organization.update apply succeeds and rolls back on a later action failure', () => {
  const database = new ServiceDatabase(':memory:');
  upsertCharacterWorkHierarchy(database, {
    name: '角色动作作品',
    workNature: 'original',
  });
  const characterId = 'action-character';
  database.connection.prepare(`
    INSERT INTO character_profiles
      (id,slug,display_name,draft_json,tags_json,organization_json,archived,
       created_at,updated_at,draft_revision)
    VALUES (?,?,?,?,'[]','{}',0,'2026-11-17T00:00:00.000Z','2026-11-17T00:00:00.000Z',1)
  `).run(
    characterId,
    characterId,
    '动作角色',
    JSON.stringify({ displayName: '动作角色', work: '角色动作作品', originType: 'original' }),
  );
  const h = harness({
    workName: '角色动作作品',
    worldId: null,
    branchId: null,
    projectId: null,
  }, {}, database);
  try {
    const request: CreativeActionRequest = {
      tool: 'character.organization.update',
      args: {
        ids: [characterId],
        groups: ['动作专业组'],
        interpretation: '仅更新组织信息',
      },
    };
    const plan = approvedPlan(h, request);
    rejectNextActionLedgerInsert(database);
    assert.throws(
      () => h.actions.apply(h.run, plan.artifact, plan.approval),
      isFixtureLedgerFailure,
    );
    assert.deepEqual(
      JSON.parse(String(database.connection.prepare(
        'SELECT organization_json FROM character_profiles WHERE id=?',
      ).get(characterId)?.organization_json)),
      {},
    );
    allowActionLedgerInsert(database);

    const applied = h.actions.apply(h.run, plan.artifact, plan.approval);
    assert.equal(applied.entity.kind, 'character-organization');
    const organization = JSON.parse(String(database.connection.prepare(
      'SELECT organization_json FROM character_profiles WHERE id=?',
    ).get(characterId)?.organization_json)) as {
      groups: string[];
      interpretation: string;
    };
    assert.deepEqual(organization.groups, request.args.groups);
    assert.equal(organization.interpretation, request.args.interpretation);
  } finally {
    database.close();
  }
});

test('timeline.branch.create apply succeeds and rolls back on a later action failure', () => {
  const database = new ServiceDatabase(':memory:');
  const worlds = new StoryWorldStore(database);
  const definition: WorldDefinition = {
    title: '时间线动作世界',
    workNature: 'original',
    parentWork: null,
    summary: '时间线动作测试。',
    timeLabel: '起点',
    locations: [{ id: 'port', name: '港口', description: '潮汐线。' }],
    actors: [{
      id: 'actor',
      name: '旅人',
      role: 'main',
      characterId: null,
      characterVersion: null,
      background: '',
      personality: '',
      speechStyle: '',
      appearance: '',
      goals: [],
      locationId: 'port',
      referenceArtifactIds: [],
    }],
    sources: [],
    lockedFacts: [],
    models: { action: null, adjudication: null, narration: null },
    visualStyle: '',
  };
  const world = worlds.create(definition);
  const h = harness({
    workName: world.title,
    worldId: world.id,
    branchId: null,
    projectId: null,
  }, {}, database);
  try {
    const request: CreativeActionRequest = {
      tool: 'timeline.branch.create',
      args: {
        worldId: world.id,
        title: '动作审批后的分支',
        mode: 'canon-gap',
        direction: '从潮汐起点开始。',
        expectedRevision: world.revision,
      },
    };
    const plan = approvedPlan(h, request);
    rejectNextActionLedgerInsert(database);
    assert.throws(
      () => h.actions.apply(h.run, plan.artifact, plan.approval),
      isFixtureLedgerFailure,
    );
    assert.equal(worlds.overview(world.id).branches.length, 0);
    allowActionLedgerInsert(database);

    const applied = h.actions.apply(h.run, plan.artifact, plan.approval);
    assert.equal(applied.entity.kind, 'world-branch');
    assert.equal(worlds.overview(world.id).branches.length, 1);
    assert.equal(worlds.getBranch(world.id, applied.entity.id).title, request.args.title);
  } finally {
    database.close();
  }
});

test('action plan schema is single-action and apply rejects a changed approval artifact', () => {
  assert.equal(Value.Check(CreativeActionPlanSchema, {
    kind: 'action-plan',
    schemaVersion: 1,
    previewHash: '0'.repeat(64),
    actions: [
      { tool: 'workflow.create', args: { document: actionWorkflow() } },
      { tool: 'workflow.create', args: { document: actionWorkflow() } },
    ],
  }), false);
});
