import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CreativeApproval,
  CreativeReview,
  CreativeRunDetail,
  CreativeWorkflowDocument,
} from '@sthstart/contracts';
import { ServiceDatabase } from '../database.js';
import {
  assertValidCreativeGraph,
  CreativeGraphValidationError,
  validateCreativeGraph,
} from './graph.js';
import { CREATIVE_ORCHESTRATION_STATEMENTS } from './migration.js';
import {
  CreativeRuntime,
  type CreativeExecutionContext,
  type CreativeExecutor,
} from './runtime.js';
import { CreativeStore } from './store.js';
import {
  CORE_CREATIVE_ROLES,
  DEFAULT_CREATIVE_ROLES,
  createDefaultCreativeRoles,
  createDefaultIllustrationWorkflow,
  createDefaultStorySceneWorkflow,
  createDefaultVideoPlanWorkflow,
} from './templates.js';

const issueCodes = (input: unknown): string[] =>
  validateCreativeGraph(input).issues.map((entry) => entry.code);

const node = (workflow: CreativeWorkflowDocument, id: string) =>
  workflow.nodes.find((entry) => entry.id === id)!;

const inputKinds = (workflow: CreativeWorkflowDocument, id: string): string[] =>
  Object.values(node(workflow, id).inputs).map((entry) => entry.kind);

const conditionConvergenceWorkflow = (): CreativeWorkflowDocument => ({
  name: '条件分支汇合',
  description: '一条分支被条件跳过时，多输入汇合仍可合法执行。',
  purpose: 'video-plan',
  nodes: [
    {
      id: 'condition_context',
      kind: 'context',
      label: '任务上下文',
      outputKind: 'context',
      inputs: {},
      config: {},
      position: { x: 0, y: 0 },
    },
    {
      id: 'condition_plan',
      kind: 'agent',
      label: '创作计划',
      roleId: 'creative_director',
      outputKind: 'plan',
      inputs: { context: { nodeId: 'condition_context', kind: 'context' } },
      config: { instruction: '建立可分支执行的计划。' },
      position: { x: 100, y: 0 },
    },
    {
      id: 'condition_route',
      kind: 'condition',
      label: '选择普通路径或关键路径',
      outputKind: 'decision',
      inputs: { plan: { nodeId: 'condition_plan', kind: 'plan' } },
      config: { condition: 'approved', instruction: '按 server policy 选择路径。' },
      position: { x: 200, y: 0 },
    },
    {
      id: 'condition_path_a',
      kind: 'agent',
      label: '普通路径',
      roleId: 'art_director',
      outputKind: 'plan',
      inputs: { decision: { nodeId: 'condition_route', kind: 'decision' } },
      config: { instruction: '生成普通候选。' },
      position: { x: 300, y: -80 },
    },
    {
      id: 'condition_path_b',
      kind: 'agent',
      label: '关键路径',
      roleId: 'art_director',
      outputKind: 'plan',
      inputs: { decision: { nodeId: 'condition_route', kind: 'decision' } },
      config: { instruction: '生成关键候选。' },
      position: { x: 300, y: 80 },
    },
    {
      id: 'condition_join',
      kind: 'join',
      label: '任一条件路径汇合',
      outputKind: 'plan',
      inputs: {
        ordinary: { nodeId: 'condition_path_a', kind: 'plan' },
        critical: { nodeId: 'condition_path_b', kind: 'plan' },
      },
      config: { instruction: '只采用实际执行分支的产物。' },
      position: { x: 420, y: 0 },
    },
    {
      id: 'condition_review',
      kind: 'agent',
      label: '独立图片审核',
      roleId: 'visual_reviewer',
      outputKind: 'review',
      inputs: { plan: { nodeId: 'condition_join', kind: 'plan' } },
      config: { instruction: '审核实际汇合后的候选。' },
      position: { x: 520, y: 0 },
    },
    {
      id: 'condition_revision',
      kind: 'revision',
      label: '有限返修',
      roleId: 'visual_reviewer',
      outputKind: 'plan',
      inputs: { review: { nodeId: 'condition_review', kind: 'review' } },
      config: {
        instruction: '从实际分支起点复跑。',
        reviewerRoleIds: ['visual_reviewer'],
        maxRevisions: 1,
        targetNodeId: 'condition_path_a',
      },
      position: { x: 620, y: 100 },
    },
    {
      id: 'condition_approval',
      kind: 'approval',
      label: '审批门',
      outputKind: 'decision',
      inputs: {
        plan: { nodeId: 'condition_join', kind: 'plan' },
        review: { nodeId: 'condition_review', kind: 'review' },
      },
      config: { reviewerRoleIds: ['production_manager'], instruction: '按 policy 批准。' },
      position: { x: 720, y: 0 },
    },
    {
      id: 'condition_adopt',
      kind: 'adopt',
      label: '服务采用',
      outputKind: 'result',
      inputs: { decision: { nodeId: 'condition_approval', kind: 'decision' } },
      config: { instruction: '只采用 approved 结果。' },
      position: { x: 820, y: 0 },
    },
  ],
  edges: [
    { id: 'condition_context_plan', source: 'condition_context', target: 'condition_plan' },
    { id: 'condition_plan_route', source: 'condition_plan', target: 'condition_route' },
    { id: 'condition_route_a', source: 'condition_route', target: 'condition_path_a', when: 'approved' },
    { id: 'condition_route_b', source: 'condition_route', target: 'condition_path_b', when: 'rejected' },
    { id: 'condition_a_join', source: 'condition_path_a', target: 'condition_join' },
    { id: 'condition_b_join', source: 'condition_path_b', target: 'condition_join' },
    { id: 'condition_join_review', source: 'condition_join', target: 'condition_review' },
    {
      id: 'condition_review_revision',
      source: 'condition_review',
      target: 'condition_revision',
      when: 'rejected',
    },
    { id: 'condition_join_approval', source: 'condition_join', target: 'condition_approval' },
    {
      id: 'condition_review_approval',
      source: 'condition_review',
      target: 'condition_approval',
      when: 'approved',
    },
    {
      id: 'condition_approval_adopt',
      source: 'condition_approval',
      target: 'condition_adopt',
      when: 'approved',
    },
  ],
});

const externalCandidateWorkflow = (kind: 'scene' | 'visual-brief'): CreativeWorkflowDocument => ({
  name: `外部${kind}候选`,
  description: '外部已完成候选只进入双审、批准和采用。',
  purpose: 'general',
  nodes: [
    {
      id: 'external_context',
      kind: 'context',
      label: '冻结上下文',
      outputKind: 'context',
      inputs: {},
      config: {},
      position: { x: 0, y: 0 },
    },
    {
      id: 'external_candidate',
      kind: 'agent',
      label: '外部预完成候选',
      roleId: 'lead_writer',
      outputKind: kind,
      inputs: { context: { nodeId: 'external_context', kind: 'context' } },
      config: { instruction: '服务端导入，不调用模型。', parameters: { externalPrecompleted: true } },
      position: { x: 100, y: 0 },
    },
    {
      id: 'external_review_a',
      kind: 'agent',
      label: '独立审核 A',
      roleId: 'continuity_editor',
      outputKind: 'review',
      inputs: {
        context: { nodeId: 'external_context', kind: 'context' },
        candidate: { nodeId: 'external_candidate', kind },
      },
      config: { instruction: '读取实际候选。' },
      position: { x: 200, y: -50 },
    },
    {
      id: 'external_review_b',
      kind: 'agent',
      label: '独立审核 B',
      roleId: 'editor_in_chief',
      outputKind: 'review',
      inputs: {
        context: { nodeId: 'external_context', kind: 'context' },
        candidate: { nodeId: 'external_candidate', kind },
      },
      config: { instruction: '独立读取实际候选。' },
      position: { x: 200, y: 50 },
    },
    {
      id: 'external_approval',
      kind: 'approval',
      label: '批准外部候选',
      outputKind: 'decision',
      inputs: {
        candidate: { nodeId: 'external_candidate', kind },
        review_a: { nodeId: 'external_review_a', kind: 'review' },
        review_b: { nodeId: 'external_review_b', kind: 'review' },
      },
      config: { reviewerRoleIds: ['production_manager'], instruction: '人工批准。' },
      position: { x: 300, y: 0 },
    },
    {
      id: 'external_adopt',
      kind: 'adopt',
      label: '采用外部候选',
      outputKind: 'result',
      inputs: { decision: { nodeId: 'external_approval', kind: 'decision' } },
      config: { instruction: '受控采用。' },
      position: { x: 400, y: 0 },
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
    {
      id: 'external_approval_adopt',
      source: 'external_approval',
      target: 'external_adopt',
      when: 'approved',
    },
  ],
});

const temporaryStore = (): { database: ServiceDatabase; store: CreativeStore } => {
  const database = new ServiceDatabase(':memory:');
  for (const statement of CREATIVE_ORCHESTRATION_STATEMENTS) {
    database.connection.exec(statement);
  }
  return { database, store: new CreativeStore(database) };
};

const mockExecutor = (modelRequiresDirectionApproval: boolean): CreativeExecutor => {
  const agent = async (context: CreativeExecutionContext): Promise<Record<string, unknown>> => {
    context.markDispatched({ textCalls: 1, tokens: 20 });
    if (context.node.id === 'story_director_plan') {
      return {
        summary: '测试场景方向',
        requiresDirectionApproval: modelRequiresDirectionApproval,
        criticalChanges: modelRequiresDirectionApproval
          ? [{ description: '改变角色归属', reason: '不可逆人物关系变化' }]
          : [],
        steps: ['建立冲突', '完成场景'],
      };
    }
    if (context.node.id === 'story_writer_scene') {
      return { body: '实际场景正文', event: '角色作出选择' };
    }
    if (context.node.outputKind === 'review') {
      const target = Object.values(context.inputs).find((input) => input.kind === 'scene');
      assert.ok(target, 'story review mock requires an actual scene');
      const review: CreativeReview = {
        verdict: 'approved',
        targetArtifactId: target.artifactId,
        targetHash: target.contentHash,
        issues: [],
        summary: '实际场景审核通过。',
      };
      return review;
    }
    throw new Error(`unexpected mock agent ${context.node.id}`);
  };
  return {
    context: async () => ({ request: '测试创作请求' }),
    agent,
    adopt: async (context) => {
      context.markDispatched({});
      return { adopted: true };
    },
    autoApprove: (context) => context.node.config.parameters?.directionGate !== true,
  };
};

async function runStoryMock(criticalChange: boolean, modelRequiresDirectionApproval: boolean): Promise<{
  detail: CreativeRunDetail;
  directionApproval: CreativeApproval | null;
  directionArtifactKinds: string[];
}> {
  const { database, store } = temporaryStore();
  const runtime = new CreativeRuntime(store, mockExecutor(modelRequiresDirectionApproval), {
    pollIntervalMs: 10,
    leaseMs: 60,
    maxParallel: 2,
  });
  try {
    const roles = createDefaultCreativeRoles();
    for (const role of roles) store.saveRole(role);
    const workflow = store.createWorkflow(createDefaultStorySceneWorkflow());
    const version = store.publishWorkflow(workflow.id, workflow.revision);
    const run = store.startRun({
      workflowId: workflow.id,
      workflowVersion: version.version,
      idempotencyKey: `story-runtime-${criticalChange}-${modelRequiresDirectionApproval}`,
      scope: { workName: '运行测试', worldId: null, branchId: null, projectId: null },
      instruction: '生成一个经过真实审核链路的场景。',
      budget: { maxTextCalls: 20, maxImages: 1, maxTokens: 1000, maxRevisions: 2 },
      input: {
        request: '测试创作请求',
        criticalChange,
        importance: 'ordinary',
      },
    }, roles);

    let directionApproval: CreativeApproval | null = null;
    let directionArtifactKinds: string[] = [];
    for (let step = 0; step < 200; step += 1) {
      const detail = await runtime.drain(run.id);
      if (detail.run.status === 'completed') {
        return { detail, directionApproval, directionArtifactKinds };
      }
      if (detail.run.status === 'failed') throw new Error(detail.run.error ?? 'mock run failed');
      const pending = detail.approvals.filter((approval) => approval.status === 'pending');
      for (const approval of pending) {
        const approvalRun = detail.nodes.find((entry) => entry.id === approval.nodeRunId)!;
        if (approvalRun.nodeId === 'story_direction_approval') {
          directionApproval = approval;
          directionArtifactKinds = approval.artifactIds.map((artifactId) =>
            detail.artifacts.find((artifact) => artifact.id === artifactId)!.kind
          );
        }
        store.decideApproval(approval.id, {
          expectedRevision: approval.revision,
          bundleHash: approval.bundleHash,
          decision: 'approve',
          comment: 'mock 人工审阅通过',
        });
      }
    }
    throw new Error('mock story run did not settle');
  } finally {
    await runtime.close();
    database.close();
  }
}

test('default roles use the approved three core positions', () => {
  assert.deepEqual(
    CORE_CREATIVE_ROLES.map((role) => [role.id, role.name]),
    [
      ['production_manager', '总管/制片'],
      ['creative_director', '创作导演'],
      ['editor_in_chief', '总编'],
    ]
  );
  assert.equal(CORE_CREATIVE_ROLES.some((role) => role.id === 'art_director'), false);
  assert.equal(DEFAULT_CREATIVE_ROLES.some((role) => role.id === 'art_director' && !role.core), true);
  assert.deepEqual(
    DEFAULT_CREATIVE_ROLES.find((role) => role.id === 'production_manager')?.tools,
    ['video_plan'],
  );
  assert.deepEqual(
    DEFAULT_CREATIVE_ROLES.find((role) => role.id === 'art_director')?.tools,
    ['image_generation'],
  );
  assert.ok(DEFAULT_CREATIVE_ROLES.every((role) => role.modelId === null));
});

test('default templates validate with deterministic order', () => {
  const story = createDefaultStorySceneWorkflow();
  const illustration = createDefaultIllustrationWorkflow();
  const video = createDefaultVideoPlanWorkflow();
  const storyValidation = validateCreativeGraph(story);
  const illustrationValidation = validateCreativeGraph(illustration);
  const videoValidation = validateCreativeGraph(video);

  assert.equal(storyValidation.valid, true, JSON.stringify(storyValidation.issues));
  assert.equal(illustrationValidation.valid, true, JSON.stringify(illustrationValidation.issues));
  assert.equal(videoValidation.valid, true, JSON.stringify(videoValidation.issues));
  assert.deepEqual(storyValidation.order, [
    'story_context',
    'story_director_plan',
    'story_critical_change',
    'story_direction_approval',
    'story_plan_join',
    'story_writer_scene',
    'story_continuity_review',
    'story_editor_review',
    'story_review_join',
    'story_revision',
    'story_approval',
    'story_adopt',
  ]);
  assert.deepEqual(illustrationValidation.order, [
    'illustration_context',
    'illustration_prompt',
    'illustration_generate',
    'illustration_visual_review',
    'illustration_revision',
    'illustration_approval',
    'illustration_adopt',
  ]);
  assert.deepEqual(videoValidation.order, [
    'video_context',
    'video_director_plan',
    'video_plan',
    'video_approval',
    'video_adopt',
  ]);
  assert.doesNotThrow(() => assertValidCreativeGraph(story));
  assert.doesNotThrow(() => assertValidCreativeGraph(video));
});

test('story direction gate is trusted-input-or-model-upgrade and keeps final scene approval separate', () => {
  const story = createDefaultStorySceneWorkflow();
  const plan = node(story, 'story_director_plan');
  const route = node(story, 'story_critical_change');
  const direction = node(story, 'story_direction_approval');
  const planJoin = node(story, 'story_plan_join');
  const writer = node(story, 'story_writer_scene');
  const continuity = node(story, 'story_continuity_review');
  const editor = node(story, 'story_editor_review');
  const revision = node(story, 'story_revision');
  const finalApproval = node(story, 'story_approval');

  assert.equal(route.config.condition, 'critical_change');
  assert.match(plan.config.instruction ?? '', /只能把方向升级.*不能自行授予批准/);
  assert.match(plan.config.instruction ?? '', /模型 false 永远不能降低用户要求/);
  assert.match(route.config.instruction ?? '', /模型 requiresDirectionApproval=true 可升级为确认/);
  assert.match(route.config.instruction ?? '', /模型 false 不能降级或关闭用户要求/);
  assert.deepEqual(route.inputs.plan, { nodeId: 'story_director_plan', kind: 'plan' });
  assert.deepEqual(
    story.edges.filter((edge) => edge.source === route.id).map((edge) => edge.when).sort(),
    ['approved', 'rejected']
  );
  assert.equal(direction.config.parameters?.directionGate, true);
  assert.deepEqual(inputKinds(story, direction.id).sort(), ['decision', 'plan']);
  assert.deepEqual(planJoin.inputs.plan, { nodeId: 'story_director_plan', kind: 'plan' });
  assert.equal(planJoin.outputKind, 'plan');
  assert.equal(writer.inputs.context.kind, 'context');
  assert.equal(writer.inputs.plan.kind, 'plan');
  assert.deepEqual(inputKinds(story, continuity.id).sort(), ['context', 'scene']);
  assert.deepEqual(inputKinds(story, editor.id).sort(), ['context', 'scene']);
  assert.equal(revision.config.targetNodeId, 'story_writer_scene');
  assert.deepEqual(revision.config.reviewerRoleIds, ['continuity_editor', 'editor_in_chief']);
  assert.equal(revision.config.maxRevisions, 2);
  assert.deepEqual(inputKinds(story, finalApproval.id).sort(), ['review', 'scene']);
  assert.deepEqual((plan.config.parameters?.outputContract as Record<string, unknown>).summary, 'string');
});

test('illustration review reads all sources and revision repairs prompts before regenerating', () => {
  const illustration = createDefaultIllustrationWorkflow();
  const review = node(illustration, 'illustration_visual_review');
  const generate = node(illustration, 'illustration_generate');
  const revision = node(illustration, 'illustration_revision');
  const approval = node(illustration, 'illustration_approval');

  assert.deepEqual(review.inputs, {
    brief: { nodeId: 'illustration_context', kind: 'context' },
    prompt: { nodeId: 'illustration_prompt', kind: 'image-prompt' },
    image: { nodeId: 'illustration_generate', kind: 'image' },
  });
  assert.equal(generate.config.workflowId, undefined);
  assert.equal(generate.config.workflowVersion, undefined);
  assert.equal(generate.roleId, 'art_director');
  assert.equal(generate.config.parameters?.workflowSource, 'run_input');
  assert.equal(revision.config.targetNodeId, 'illustration_prompt');
  assert.deepEqual(revision.config.reviewerRoleIds, ['visual_reviewer']);
  assert.equal(
    illustration.edges.find((edge) => edge.id === 'illustration_review_revision')?.when,
    'always'
  );
  assert.equal(
    illustration.edges.find((edge) => edge.id === 'illustration_revision_approval')?.when,
    'always'
  );
  assert.ok(inputKinds(illustration, approval.id).includes('image'));
  assert.ok(inputKinds(illustration, approval.id).includes('review'));
  assert.equal(illustration.nodes.some((entry) => entry.config.importance !== undefined), false);
});

test('video-plan template binds a complete director plan through the authorized production tool to human adoption', () => {
  const workflow = createDefaultVideoPlanWorkflow();
  const context = node(workflow, 'video_context');
  const director = node(workflow, 'video_director_plan');
  const tool = node(workflow, 'video_plan');
  const approval = node(workflow, 'video_approval');
  const adopt = node(workflow, 'video_adopt');

  assert.equal(workflow.purpose, 'video-plan');
  assert.equal(context.kind, 'context');
  assert.equal(director.kind, 'agent');
  assert.equal(director.roleId, 'creative_director');
  assert.equal(director.outputKind, 'plan');
  assert.equal(director.config.parameters?.videoPlan, true);
  assert.match(director.config.instruction ?? '', /非空 shots/);
  assert.match(director.config.instruction ?? '', /planning_only/);
  const contract = director.config.parameters?.outputContract as {
    shots: Array<Record<string, string>>;
    executionStatus: string;
  };
  assert.deepEqual(Object.keys(contract.shots[0]!).sort(), [
    'camera',
    'description',
    'dialogue',
    'durationSeconds',
    'id',
    'referenceArtifactIds',
    'visualPrompt',
  ]);
  assert.equal(contract.executionStatus, 'planning_only');

  assert.equal(tool.kind, 'tool');
  assert.equal(tool.roleId, 'production_manager');
  assert.equal(tool.outputKind, 'plan');
  assert.equal(tool.config.tool, 'video_plan');
  assert.equal(tool.config.parameters?.videoPlan, true);
  assert.deepEqual(tool.inputs.plan, {
    nodeId: 'video_director_plan',
    kind: 'plan',
  });
  assert.deepEqual(inputKinds(workflow, approval.id).sort(), ['context', 'plan']);
  assert.deepEqual(approval.inputs.plan, { nodeId: 'video_plan', kind: 'plan' });
  assert.deepEqual(adopt.inputs.approval, { nodeId: 'video_approval', kind: 'decision' });
  assert.equal(
    workflow.edges.find((edge) => edge.id === 'video_approval_adopt')?.when,
    'approved',
  );
  assert.equal(workflow.nodes.some((entry) => entry.outputKind === 'image'), false);
});

test('approval validation distinguishes plan direction gates from final content approval', () => {
  const missingGate = createDefaultStorySceneWorkflow();
  node(missingGate, 'story_direction_approval').config.parameters = {};
  const missingGateCodes = issueCodes(missingGate);
  assert.ok(missingGateCodes.includes('graph_plan_approval_gate_missing'));
  assert.ok(missingGateCodes.includes('graph_direction_gate_missing'));

  const missingFinalBinding = createDefaultStorySceneWorkflow();
  delete node(missingFinalBinding, 'story_approval').inputs.scene;
  const finalCodes = issueCodes(missingFinalBinding);
  assert.ok(finalCodes.includes('graph_final_approval_missing'));
  assert.ok(finalCodes.includes('graph_approval_bypass'));
  assert.equal(finalCodes.includes('graph_direction_gate_missing'), false);
});

test('general and video-plan workflows allow a final plan approval without a model review', () => {
  const workflow: CreativeWorkflowDocument = {
    name: '视频方案',
    description: '先形成可审阅的视频方案，再批准和采用。',
    purpose: 'video-plan',
    nodes: [
      {
        id: 'video_context',
        kind: 'context',
        label: '视频任务',
        outputKind: 'context',
        inputs: {},
        config: {},
        position: { x: 0, y: 0 },
      },
      {
        id: 'video_plan',
        kind: 'tool',
        label: '形成视频方案',
        outputKind: 'plan',
        inputs: { context: { nodeId: 'video_context', kind: 'context' } },
        config: { tool: 'video_plan', instruction: '形成分镜与用途方案。' },
        position: { x: 100, y: 0 },
      },
      {
        id: 'video_approval',
        kind: 'approval',
        label: '批准视频方案',
        outputKind: 'decision',
        inputs: { plan: { nodeId: 'video_plan', kind: 'plan' } },
        config: {
          reviewerRoleIds: ['production_manager'],
          instruction: '人工审阅方案，不要求模型 review。',
        },
        position: { x: 200, y: 0 },
      },
      {
        id: 'video_adopt',
        kind: 'adopt',
        label: '采用视频方案',
        outputKind: 'result',
        inputs: { decision: { nodeId: 'video_approval', kind: 'decision' } },
        config: { instruction: '采用已批准方案。' },
        position: { x: 300, y: 0 },
      },
    ],
    edges: [
      { id: 'video_context_plan', source: 'video_context', target: 'video_plan' },
      { id: 'video_plan_approval', source: 'video_plan', target: 'video_approval' },
      { id: 'video_approval_adopt', source: 'video_approval', target: 'video_adopt', when: 'approved' },
    ],
  };

  const validation = validateCreativeGraph(workflow);
  assert.equal(validation.valid, true, JSON.stringify(validation.issues));
  assert.equal(validation.issues.some((entry) => entry.code === 'graph_approval_review_missing'), false);
  assert.equal(validation.issues.some((entry) => entry.code === 'graph_approval_bypass'), false);
});

test('external precompleted scene and visual-brief candidates publish only through two independent reviews', () => {
  for (const kind of ['scene', 'visual-brief'] as const) {
    const workflow = externalCandidateWorkflow(kind);
    const validation = validateCreativeGraph(workflow);
    assert.equal(validation.valid, true, JSON.stringify(validation.issues));
  }

  const oneReview = externalCandidateWorkflow('scene');
  delete node(oneReview, 'external_approval').inputs.review_b;
  oneReview.edges = oneReview.edges.filter((edge) => edge.id !== 'external_review_b_approval');
  const codes = issueCodes(oneReview);
  assert.ok(codes.includes('graph_final_approval_missing'));
  assert.ok(codes.includes('graph_approval_bypass'));

  const forgedGeneralScene = externalCandidateWorkflow('scene');
  node(forgedGeneralScene, 'external_candidate').config.parameters = {};
  assert.ok(issueCodes(forgedGeneralScene).includes('graph_final_approval_missing'));
});

test('story scene adoption cannot omit the trusted direction gate or bind approval to a conditionally skippable review', () => {
  const noGate: CreativeWorkflowDocument = {
    name: '绕过方向门的故事',
    description: '缺少 plan 方向审批。',
    purpose: 'story',
    nodes: [
      {
        id: 'plain_context',
        kind: 'context',
        label: '上下文',
        outputKind: 'context',
        inputs: {},
        config: {},
        position: { x: 0, y: 0 },
      },
      {
        id: 'plain_plan',
        kind: 'agent',
        label: '计划',
        roleId: 'creative_director',
        outputKind: 'plan',
        inputs: { context: { nodeId: 'plain_context', kind: 'context' } },
        config: { instruction: '计划。' },
        position: { x: 100, y: 0 },
      },
      {
        id: 'plain_scene',
        kind: 'agent',
        label: '场景',
        roleId: 'lead_writer',
        outputKind: 'scene',
        inputs: {
          context: { nodeId: 'plain_context', kind: 'context' },
          plan: { nodeId: 'plain_plan', kind: 'plan' },
        },
        config: { instruction: '场景。' },
        position: { x: 200, y: 0 },
      },
      {
        id: 'plain_review',
        kind: 'agent',
        label: '审核',
        roleId: 'editor_in_chief',
        outputKind: 'review',
        inputs: {
          context: { nodeId: 'plain_context', kind: 'context' },
          scene: { nodeId: 'plain_scene', kind: 'scene' },
        },
        config: { instruction: '审核。' },
        position: { x: 300, y: 0 },
      },
      {
        id: 'plain_approval',
        kind: 'approval',
        label: '最终批准',
        outputKind: 'decision',
        inputs: {
          scene: { nodeId: 'plain_scene', kind: 'scene' },
          review: { nodeId: 'plain_review', kind: 'review' },
        },
        config: { reviewerRoleIds: ['editor_in_chief'], instruction: '批准。' },
        position: { x: 400, y: 0 },
      },
      {
        id: 'plain_adopt',
        kind: 'adopt',
        label: '采用',
        outputKind: 'result',
        inputs: { decision: { nodeId: 'plain_approval', kind: 'decision' } },
        config: { instruction: '采用。' },
        position: { x: 500, y: 0 },
      },
    ],
    edges: [
      { id: 'plain_context_plan', source: 'plain_context', target: 'plain_plan' },
      { id: 'plain_context_scene', source: 'plain_context', target: 'plain_scene' },
      { id: 'plain_plan_scene', source: 'plain_plan', target: 'plain_scene' },
      { id: 'plain_context_review', source: 'plain_context', target: 'plain_review' },
      { id: 'plain_scene_review', source: 'plain_scene', target: 'plain_review' },
      { id: 'plain_scene_approval', source: 'plain_scene', target: 'plain_approval' },
      { id: 'plain_review_approval', source: 'plain_review', target: 'plain_approval' },
      { id: 'plain_approval_adopt', source: 'plain_approval', target: 'plain_adopt', when: 'approved' },
    ],
  };
  assert.ok(issueCodes(noGate).includes('graph_direction_gate_missing'));

  const skippedReview = createDefaultStorySceneWorkflow();
  skippedReview.edges.find((edge) => edge.id === 'story_revision_approval')!.when = 'rejected';
  assert.ok(issueCodes(skippedReview).includes('graph_final_approval_missing'));
});

test('revision reviewers must correspond to actual executing review roles', () => {
  const workflow = createDefaultIllustrationWorkflow();
  node(workflow, 'illustration_revision').config.reviewerRoleIds = ['art_director'];
  assert.ok(issueCodes(workflow).includes('graph_revision_reviewer_not_executed'));
});

test('duplicate structural edges are rejected without creating a false cycle deadlock', () => {
  const workflow = createDefaultStorySceneWorkflow();
  workflow.edges.push({
    id: 'story_duplicate_writer_join',
    source: 'story_writer_scene',
    target: 'story_review_join',
  });

  const validation = validateCreativeGraph(workflow);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((entry) => entry.code === 'graph_dependency_duplicate'));
  assert.equal(validation.issues.some((entry) => entry.code === 'graph_cycle'), false);
  assert.equal(validation.order.length, workflow.nodes.length);
});

test('ordinary multi-input joins do not require a parallel ancestor and condition-skipped branches may converge', () => {
  const workflow = conditionConvergenceWorkflow();
  const validation = validateCreativeGraph(workflow);
  assert.equal(validation.valid, true, JSON.stringify(validation.issues));
  assert.ok(validation.order.includes('condition_join'));
});

test('runtime contract, cycle, revision budget and stitched-output violations are rejected', () => {
  const invalidType = validateCreativeGraph({
    name: 'invalid',
    description: '',
    purpose: 'illustration',
    nodes: [],
    edges: [],
  });
  assert.ok(invalidType.issues.some((entry) => entry.code === 'graph_type_invalid'));
  assert.deepEqual(invalidType.order, []);

  const cycle = createDefaultStorySceneWorkflow();
  node(cycle, 'story_context').inputs.adopted = { nodeId: 'story_adopt', kind: 'result' };
  cycle.edges.push({ id: 'invalid_cycle', source: 'story_adopt', target: 'story_context' });
  assert.ok(issueCodes(cycle).includes('graph_cycle'));

  const unsafeRevision = createDefaultIllustrationWorkflow();
  const revision = node(unsafeRevision, 'illustration_revision');
  revision.config.maxRevisions = 0;
  revision.config.targetNodeId = 'illustration_adopt';
  const revisionCodes = issueCodes(unsafeRevision);
  assert.ok(revisionCodes.includes('graph_revision_budget_invalid'));
  assert.ok(revisionCodes.includes('graph_revision_target_invalid'));

  const missingImageReview = createDefaultIllustrationWorkflow();
  delete node(missingImageReview, 'illustration_visual_review').inputs.image;
  assert.ok(issueCodes(missingImageReview).includes('graph_illustration_review_inputs_missing'));
});

test('adoption requires the final content approval, not a plan direction decision', () => {
  const bypassed = createDefaultStorySceneWorkflow();
  const adopt = node(bypassed, 'story_adopt');
  adopt.inputs.approval = { nodeId: 'story_direction_approval', kind: 'decision' };
  bypassed.edges.find((edge) => edge.id === 'story_approval_adopt')!.source = 'story_direction_approval';
  assert.ok(issueCodes(bypassed).includes('graph_approval_bypass'));

  const rejectedOnly = createDefaultStorySceneWorkflow();
  rejectedOnly.edges.find((edge) => edge.id === 'story_approval_adopt')!.when = 'rejected';
  assert.ok(issueCodes(rejectedOnly).includes('graph_approval_bypass'));
});

test('mock runtime: ordinary plans skip direction approval and complete the real review/adopt chain', async () => {
  const result = await runStoryMock(false, false);
  const direction = result.detail.nodes.find((entry) => entry.nodeId === 'story_direction_approval')!;
  const writer = result.detail.nodes.find((entry) => entry.nodeId === 'story_writer_scene')!;
  const continuity = result.detail.nodes.find((entry) => entry.nodeId === 'story_continuity_review')!;
  const writerInputs = (writer.input as { artifacts: Record<string, { kind: string }> }).artifacts;
  const reviewInputs = (continuity.input as { artifacts: Record<string, { kind: string }> }).artifacts;

  assert.equal(result.detail.run.status, 'completed');
  assert.equal(direction.status, 'skipped');
  assert.deepEqual(Object.values(writerInputs).map((input) => input.kind).sort(), ['context', 'plan']);
  assert.deepEqual(Object.values(reviewInputs).map((input) => input.kind).sort(), ['context', 'scene']);
  assert.equal(result.directionApproval, null);
});

test('mock runtime: trusted critical input and model safety upgrade both pause for plan approval', async () => {
  for (const [criticalChange, modelRequires] of [[true, false], [false, true]] as const) {
    const result = await runStoryMock(criticalChange, modelRequires);
    const direction = result.detail.nodes.find((entry) => entry.nodeId === 'story_direction_approval')!;
    assert.equal(result.detail.run.status, 'completed');
    assert.equal(direction.status, 'succeeded');
    assert.ok(result.directionApproval);
    assert.ok(result.directionArtifactKinds.includes('plan'));
    assert.equal(
      result.detail.approvals.some((approval) =>
        approval.status === 'approved'
        && approval.nodeRunId === result.detail.nodes.find((entry) =>
          entry.nodeId === 'story_approval')!.id
      ),
      true
    );
  }
});

test('mock runtime: default video-plan carries non-empty shots from director through tool approval and adoption', async () => {
  const { database, store } = temporaryStore();
  const runtime = new CreativeRuntime(store, {
    context: async () => ({ request: '制作视频方案' }),
    agent: async (context) => {
      assert.equal(context.node.id, 'video_director_plan');
      context.markDispatched({ textCalls: 1, tokens: 80 });
      return {
        kind: 'video-plan',
        title: '港口重逢',
        brief: '两名旧友在潮汐港口重逢。',
        shots: [{
          id: 'shot-1',
          durationSeconds: 4,
          description: '远景建立港口，再切到两人对视。',
          dialogue: '“你终于回来了。”',
          visualPrompt: 'rain-soaked harbor, two friends facing each other, cinematic lighting',
          camera: 'slow push-in',
          referenceArtifactIds: [],
        }],
        totalDurationSeconds: 4,
        requiresHumanApproval: true,
        executionStatus: 'planning_only',
      };
    },
    tool: async (context) => {
      assert.equal(context.node.id, 'video_plan');
      assert.equal(context.node.roleId, 'production_manager');
      const plan = Object.values(context.inputs).find((entry) => entry.kind === 'plan');
      assert.ok(plan, 'video_plan must receive the director plan');
      assert.ok(Array.isArray(plan.content.shots) && plan.content.shots.length > 0);
      context.markDispatched({});
      return structuredClone(plan.content);
    },
    adopt: async (context) => {
      context.markDispatched({});
      return { adopted: true };
    },
    autoApprove: () => true,
  }, { pollIntervalMs: 10, leaseMs: 60, maxParallel: 1 });
  try {
    const roles = createDefaultCreativeRoles();
    for (const role of roles) store.saveRole(role);
    const workflow = createDefaultVideoPlanWorkflow();
    const draft = store.createWorkflow(workflow);
    const published = store.publishWorkflow(draft.id, draft.revision);
    const run = store.startRun({
      workflowId: draft.id,
      workflowVersion: published.version,
      idempotencyKey: 'video-plan-runtime-mock',
      scope: { workName: '视频测试', worldId: null, branchId: null, projectId: null },
      instruction: '制作并采用视频方案。',
      budget: { maxTextCalls: 1, maxImages: 0, maxTokens: 100, maxRevisions: 0 },
      input: { request: '视频方案' },
    }, roles);

    let detail = await runtime.drain(run.id);
    for (let step = 0; step < 100 && detail.run.status !== 'completed'; step += 1) {
      detail = await runtime.drain(run.id);
    }
    assert.equal(detail.run.status, 'completed', detail.run.error ?? undefined);
    assert.equal(detail.nodes.find((entry) => entry.nodeId === 'video_approval')?.status, 'succeeded');
    assert.equal(detail.nodes.find((entry) => entry.nodeId === 'video_adopt')?.status, 'succeeded');
    const toolNode = detail.nodes.find((entry) => entry.nodeId === 'video_plan')!;
    const toolArtifact = detail.artifacts.find((entry) => entry.id === toolNode.outputArtifactId)!;
    const directorNode = detail.nodes.find((entry) => entry.nodeId === 'video_director_plan')!;
    const directorArtifact = detail.artifacts.find((entry) => entry.id === directorNode.outputArtifactId)!;
    assert.equal(toolArtifact.contentHash, directorArtifact.contentHash);
    assert.ok(Array.isArray(toolArtifact.content.shots) && toolArtifact.content.shots.length > 0);
  } finally {
    await runtime.close();
    database.close();
  }
});

test('mock runtime: illustration prompt repair and reviewed image complete the default workflow', async () => {
  const { database, store } = temporaryStore();
  const runtime = new CreativeRuntime(store, {
    context: async () => ({ request: '绘制关键场景插图' }),
    agent: async (context) => {
      context.markDispatched({ textCalls: 1, tokens: 20 });
      if (context.node.id === 'illustration_prompt') {
        return { positive: '一名角色在雪夜回望', negative: '文字, 水印' };
      }
      if (context.node.outputKind === 'review') {
        const target = Object.values(context.inputs).find((input) => input.kind === 'image');
        assert.ok(target, 'visual review mock requires an actual image');
        const review: CreativeReview = {
          verdict: 'approved',
          targetArtifactId: target.artifactId,
          targetHash: target.contentHash,
          issues: [],
          summary: '图片与任务、提示词一致。',
        };
        return review;
      }
      throw new Error(`unexpected illustration agent ${context.node.id}`);
    },
    tool: async (context) => {
      context.markDispatched({ images: 1 });
      return { artifactId: `mock-image-${context.nodeRun.attempt}`, width: 1024, height: 1024 };
    },
    adopt: async (context) => {
      context.markDispatched({});
      return { adopted: true };
    },
    autoApprove: () => true,
  }, { pollIntervalMs: 10, leaseMs: 60, maxParallel: 2 });
  try {
    const roles = createDefaultCreativeRoles();
    for (const role of roles) store.saveRole(role);
    const workflow = store.createWorkflow(createDefaultIllustrationWorkflow());
    const published = store.publishWorkflow(workflow.id, workflow.revision);
    const run = store.startRun({
      workflowId: workflow.id,
      workflowVersion: published.version,
      idempotencyKey: 'illustration-runtime-mock',
      scope: { workName: '插图测试', worldId: null, branchId: null, projectId: null },
      instruction: '生成并审核插图。',
      budget: { maxTextCalls: 10, maxImages: 3, maxTokens: 1000, maxRevisions: 2 },
      input: { workflowId: 'registered-image-workflow', workflowVersion: 1 },
    }, roles);

    let detail = await runtime.drain(run.id);
    for (let step = 0; step < 100 && detail.run.status !== 'completed'; step += 1) {
      detail = await runtime.drain(run.id);
    }
    assert.equal(detail.run.status, 'completed', detail.run.error ?? undefined);
    for (const id of [
      'illustration_prompt',
      'illustration_generate',
      'illustration_visual_review',
      'illustration_revision',
      'illustration_approval',
      'illustration_adopt',
    ]) {
      assert.equal(detail.nodes.find((entry) => entry.nodeId === id)?.status, 'succeeded', id);
    }
    const reviewRun = detail.nodes.find((entry) => entry.nodeId === 'illustration_visual_review')!;
    const reviewInputs = (reviewRun.input as { artifacts: Record<string, { kind: string }> }).artifacts;
    assert.deepEqual(
      Object.values(reviewInputs).map((input) => input.kind).sort(),
      ['context', 'image', 'image-prompt']
    );
  } finally {
    await runtime.close();
    database.close();
  }
});

test('the assertion exposes validation issues without discarding deterministic order', () => {
  const workflow = createDefaultIllustrationWorkflow();
  node(workflow, 'illustration_revision').config.maxRevisions = 0;

  assert.throws(
    () => assertValidCreativeGraph(workflow),
    (error: unknown) => {
      assert.ok(error instanceof CreativeGraphValidationError);
      assert.equal(error.code, 'creative_graph_invalid');
      assert.equal(error.validation.valid, false);
      assert.ok(error.validation.issues.some((entry) => entry.code === 'graph_revision_budget_invalid'));
      return true;
    }
  );
});
