import assert from 'node:assert/strict';
import test from 'node:test';
import type { CreativeReview, CreativeRunDetail, CreativeWorkflowDocument } from '@sthstart/contracts';
import { ServiceDatabase } from '../database.js';
import { CREATIVE_ORCHESTRATION_STATEMENTS } from './migration.js';
import { CREATIVE_MEMORY_STATEMENTS } from './memory-migration.js';
import { CreativeStore } from './store.js';
import { CreativeDomain, type CreativeContext, type CreativeScene } from './domain.js';
import {
  CreativeRuntime, CreativePendingExecution, CreativeDefiniteFailureError,
  type CreativeExecutionContext, type CreativeExecutor,
} from './runtime.js';
import { createDefaultCreativeRoles, createDefaultIllustrationWorkflow, createDefaultStorySceneWorkflow } from './templates.js';

const planWorkflow = (): CreativeWorkflowDocument => ({
  name: '方案测试', description: '', purpose: 'general',
  nodes: [
    { id: 'context', kind: 'context', outputKind: 'context', inputs: {}, config: {}, label: '上下文', position: { x: 0, y: 0 } },
    { id: 'plan', kind: 'agent', roleId: 'creative_director', outputKind: 'plan', inputs: { context: { nodeId: 'context', kind: 'context' } }, config: {}, label: '方案', position: { x: 1, y: 0 } },
    { id: 'approval', kind: 'approval', outputKind: 'decision', inputs: { plan: { nodeId: 'plan', kind: 'plan' } }, config: { reviewerRoleIds: ['production_manager'] }, label: '确认', position: { x: 2, y: 0 } },
    { id: 'adopt', kind: 'adopt', outputKind: 'result', inputs: { approval: { nodeId: 'approval', kind: 'decision' } }, config: {}, label: '采用', position: { x: 3, y: 0 } },
  ],
  edges: [
    { id: 'a', source: 'context', target: 'plan' }, { id: 'b', source: 'plan', target: 'approval' },
    { id: 'c', source: 'approval', target: 'adopt', when: 'approved' },
  ],
});

function fixture(document = createDefaultStorySceneWorkflow(), options: { input?: Record<string, unknown>; maxTextCalls?: number; maxRevisions?: number } = {}) {
  const database = new ServiceDatabase(':memory:');
  for (const statement of CREATIVE_ORCHESTRATION_STATEMENTS) database.connection.exec(statement);
  for (const statement of CREATIVE_MEMORY_STATEMENTS) database.connection.exec(statement);
  const store = new CreativeStore(database);
  const roles = createDefaultCreativeRoles();
  const workflow = store.createWorkflow(document);
  const version = store.publishWorkflow(workflow.id, workflow.revision);
  const run = store.startRun({
    workflowId: workflow.id, workflowVersion: version.version, idempotencyKey: 'runtime-test',
    scope: { workName: '运行测试', worldId: null, branchId: null, projectId: null },
    instruction: '测试持久执行', input: options.input ?? {},
    budget: { maxTextCalls: options.maxTextCalls ?? 40, maxImages: 4, maxTokens: 10_000, maxRevisions: options.maxRevisions ?? 2 },
  }, roles);
  return { database, store, run, workflow, roles };
}

function review(context: CreativeExecutionContext, approved = true): CreativeReview {
  const target = Object.values(context.inputs).find(input => input.kind === 'image')
    ?? Object.values(context.inputs).find(input => input.kind === 'scene');
  assert.ok(target);
  return {
    verdict: approved ? 'approved' : 'changes_requested', targetArtifactId: target.artifactId, targetHash: target.contentHash,
    issues: approved ? [] : [{ severity: 'blocking', message: '修改目标内容', evidence: '测试证据', location: '正文' }],
    summary: approved ? '审核通过' : '需要返修',
  };
}
function executor(options: { approve?: boolean; revise?: boolean; rejectForever?: boolean; calls?: string[] } = {}): CreativeExecutor {
  return {
    context: async () => ({ request: '场景请求' }),
    agent: async context => {
      context.markDispatched({ textCalls: 1, tokens: 30 });
      options.calls?.push(context.node.id);
      if (context.node.outputKind === 'review') return review(context, !options.rejectForever && (!options.revise || context.nodeRun.attempt > 0));
      if (context.node.outputKind === 'scene') return { body: `正文${context.nodeRun.attempt}`, feedback: context.revision?.number ?? 0 };
      if (context.node.outputKind === 'image-prompt') return { prompt: `提示词${context.nodeRun.attempt}`, feedback: context.revision?.number ?? 0 };
      return { summary: '方案', requiresDirectionApproval: false, approved: true };
    },
    tool: async context => {
      context.markDispatched({ images: 1 });
      options.calls?.push(context.node.id);
      return { imageId: `image_${context.nodeRun.attempt}` };
    },
    adopt: async context => {
      assert.equal(context.approval?.status, 'approved');
      assert.ok(context.artifacts?.length);
      context.markDispatched({});
      options.calls?.push(context.node.id);
      return { adopted: true };
    },
    ...(options.approve ? { autoApprove: () => true } : {}),
  };
}
function approvePending(store: CreativeStore, detail: CreativeRunDetail): void {
  for (const approval of detail.approvals.filter(item => item.status === 'pending')) {
    store.decideApproval(approval.id, { expectedRevision: approval.revision, bundleHash: approval.bundleHash, decision: 'approve', comment: '已核对' });
  }
}

test('full story waits for exact bundle approval; restart reuses prior stages and adopts once', async () => {
  const f = fixture();
  const calls: string[] = [];
  const runtime = new CreativeRuntime(f.store, executor({ calls }));
  try {
    const waiting = await runtime.drain(f.run.id);
    assert.equal(waiting.run.status, 'waiting_approval');
    assert.ok(!calls.includes('story_adopt'));
    assert.equal(waiting.nodes.find(node => node.nodeId === 'story_direction_approval')?.status, 'skipped');
    const writer = waiting.nodes.find(node => node.nodeId === 'story_writer_scene')!;
    const continuity = waiting.nodes.find(node => node.nodeId === 'story_continuity_review')!;
    const editor = waiting.nodes.find(node => node.nodeId === 'story_editor_review')!;
    assert.ok(continuity.input.artifacts);
    assert.ok(editor.input.artifacts);
    const approval = waiting.approvals.find(item => item.status === 'pending')!;
    assert.ok(approval.artifactIds.includes(writer.outputArtifactId!));
    assert.equal(waiting.artifacts.filter(artifact => approval.artifactIds.includes(artifact.id) && artifact.kind === 'review').length, 3);
    assert.throws(() => f.store.decideApproval(approval.id, { expectedRevision: approval.revision, bundleHash: 'wrong', decision: 'approve', comment: '' }));
    approvePending(f.store, waiting);
    await runtime.close();
    const restored = new CreativeRuntime(f.store, executor({ calls }));
    assert.equal((await restored.drain(f.run.id)).run.status, 'completed');
    assert.equal(calls.filter(id => id === 'story_writer_scene').length, 1);
    assert.equal(calls.filter(id => id === 'story_adopt').length, 1);
    await restored.close();
  } finally { await runtime.close(); f.database.close(); }
});

test('story revision reruns writer and both independent reviews without rerunning director', async () => {
  const f = fixture();
  const calls: string[] = [];
  const runtime = new CreativeRuntime(f.store, executor({ revise: true, approve: true, calls }));
  try {
    const detail = await runtime.drain(f.run.id);
    assert.equal(detail.run.status, 'completed', detail.run.error ?? '');
    assert.equal(calls.filter(id => id === 'story_director_plan').length, 1);
    for (const id of ['story_writer_scene', 'story_continuity_review', 'story_editor_review']) assert.equal(calls.filter(call => call === id).length, 2);
    const writers = detail.nodes.filter(node => node.nodeId === 'story_writer_scene');
    assert.equal(detail.artifacts.find(artifact => artifact.id === writers[0].outputArtifactId)?.status, 'superseded');
    assert.equal(detail.artifacts.find(artifact => artifact.id === writers[1].outputArtifactId)?.content.feedback, 1);
    assert.equal(detail.approvals[0].artifactIds.includes(writers[0].outputArtifactId!), false);
  } finally { await runtime.close(); f.database.close(); }
});

test('illustration reruns prompt, image and actual-image review, with a hard two-revision bound', async () => {
  for (const rejectForever of [false, true]) {
    const f = fixture(createDefaultIllustrationWorkflow());
    const runtime = new CreativeRuntime(f.store, executor({ revise: true, rejectForever, approve: true }));
    try {
      const detail = await runtime.drain(f.run.id);
      assert.equal(detail.run.status, rejectForever ? 'failed' : 'completed', detail.run.error ?? '');
      const prompts = detail.nodes.filter(node => node.nodeId === 'illustration_prompt');
      assert.equal(prompts.length, rejectForever ? 3 : 2);
      assert.equal(detail.run.usage.images, rejectForever ? 3 : 2);
      if (rejectForever) assert.match(detail.run.error!, /返修次数/);
    } finally { await runtime.close(); f.database.close(); }
  }
});

test('review of another candidate fails closed and retains rejected response without an unknown replay', async () => {
  const f = fixture();
  const base = executor({ approve: true });
  const runtime = new CreativeRuntime(f.store, {
    ...base,
    agent: async context => {
      const output = await base.agent!(context);
      return context.node.outputKind === 'review' ? { ...output, targetHash: 'incorrect' } : output;
    },
  });
  try {
    const detail = await runtime.drain(f.run.id);
    assert.equal(detail.run.status, 'failed');
    assert.equal(detail.approvals.length, 0);
    assert.ok(detail.nodes.some(node => node.status === 'failed' && node.outputArtifactId));
    assert.ok(!detail.nodes.some(node => node.status === 'uncertain'));
  } finally { await runtime.close(); f.database.close(); }
});

test('budget is reserved before dispatch; rejecting excess stops invocation and leaves no dispatch timestamp', async () => {
  const f = fixture(undefined, { maxTextCalls: 1 });
  const calls: string[] = [];
  const runtime = new CreativeRuntime(f.store, executor({ calls }));
  try {
    const detail = await runtime.drain(f.run.id);
    assert.equal(detail.run.status, 'failed');
    assert.deepEqual(calls, ['story_director_plan']);
    assert.equal(detail.run.usage.textCalls, 1);
    assert.equal(detail.nodes.find(node => node.nodeId === 'story_writer_scene')?.dispatchedAt, null);
  } finally { await runtime.close(); f.database.close(); }
});

test('expired dispatched lease is uncertain, while explicit never-dispatched lease is safe to resume', async () => {
  for (const dispatched of [false, true]) {
    const f = fixture(planWorkflow());
    const pending = f.store.ensureNode(f.run.id, 'context', 0, { artifacts: {} });
    f.store.claimNode(pending.id, 'dead-process');
    f.store.patchNode(pending.id, { leaseUntil: 1, ...(dispatched ? { dispatchedAt: new Date().toISOString() } : {}) });
    let calls = 0;
    const runtime = new CreativeRuntime(f.store, { ...executor(), context: async () => { calls++; return {}; } });
    try {
      const detail = await runtime.drain(f.run.id);
      assert.equal(detail.run.status, dispatched ? 'uncertain' : 'waiting_approval');
      assert.equal(calls, dispatched ? 0 : 1);
      if (dispatched) {
        await runtime.drain(f.run.id);
        assert.equal(calls, 0);
        const recovered = runtime.recover(f.run.id, pending.id, { expectedRevision: f.store.getRun(f.run.id)!.revision, resolution: 'not_executed', note: '核查服务端日志证明未执行' });
        assert.equal(recovered.status, 'paused');
        runtime.resume(f.run.id, recovered.revision);
        assert.equal((await runtime.drain(f.run.id)).run.status, 'waiting_approval');
        assert.equal(calls, 1);
      }
    } finally { await runtime.close(); f.database.close(); }
  }
});

test('transport unknown is not retried, but a definite provider rejection is failed', async () => {
  for (const definite of [false, true]) {
    const f = fixture(planWorkflow());
    let calls = 0;
    const runtime = new CreativeRuntime(f.store, {
      ...executor(), agent: async context => {
        context.markDispatched({ textCalls: 1, tokens: 20 }); calls++;
        if (definite) throw new CreativeDefiniteFailureError('429 已明确拒绝');
        throw new Error('连接中断，响应未知');
      },
    });
    try {
      assert.equal((await runtime.drain(f.run.id)).run.status, definite ? 'failed' : 'uncertain');
      await runtime.drain(f.run.id);
      assert.equal(calls, 1);
    } finally { await runtime.close(); f.database.close(); }
  }
});

test('asynchronous image polls external task once per tick and never reserves its generation twice', async () => {
  const f = fixture(createDefaultIllustrationWorkflow());
  let dispatches = 0;
  let polls = 0;
  const runtime = new CreativeRuntime(f.store, {
    ...executor({ approve: true }),
    tool: async context => {
      if (!context.nodeRun.externalTaskId) {
        context.markDispatched({ images: 1 }, 'external_image'); dispatches++;
        throw new CreativePendingExecution('external_image');
      }
      polls++;
      if (polls < 2) throw new CreativePendingExecution('external_image');
      return { imageId: 'actual_image' };
    },
  });
  try {
    const pending = await runtime.drain(f.run.id);
    assert.equal(pending.run.status, 'running');
    assert.equal(dispatches, 1);
    assert.equal(polls, 1);
    const completed = await runtime.drain(f.run.id);
    assert.equal(completed.run.status, 'completed', completed.run.error ?? '');
    assert.equal(completed.run.usage.images, 1);
    assert.equal(dispatches, 1);
  } finally { await runtime.close(); f.database.close(); }
});

test('pause/cancel during an in-flight call retain result and prevent later dispatch', async () => {
  for (const action of ['pause', 'cancel'] as const) {
    const f = fixture(planWorkflow());
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const resultPromise = new Promise<void>(resolve => { release = resolve; });
    const runtime = new CreativeRuntime(f.store, {
      ...executor({ approve: true }), agent: async context => {
        context.markDispatched({ textCalls: 1, tokens: 20 }); entered();
        await resultPromise;
        return { summary: '已完成但暂不继续' };
      },
    });
    try {
      const execution = runtime.drain(f.run.id);
      await enteredPromise;
      runtime[action](f.run.id);
      release();
      const detail = await execution;
      assert.equal(detail.run.status, action === 'pause' ? 'paused' : 'cancelled');
      assert.equal(detail.nodes.find(node => node.nodeId === 'plan')?.status, 'succeeded');
      assert.equal(detail.approvals.length, 0);
    } finally { await runtime.close(); f.database.close(); }
  }
});

test('a competing scheduler cannot take a live lease; heartbeats retain ownership', async () => {
  const f = fixture(planWorkflow());
  let calls = 0;
  let release!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const adapter: CreativeExecutor = {
    ...executor(), agent: async context => {
      context.markDispatched({ textCalls: 1, tokens: 20 }); calls++; entered(); await wait;
      return { summary: '方案' };
    },
  };
  const first = new CreativeRuntime(f.store, adapter, { leaseMs: 60 });
  const second = new CreativeRuntime(f.store, adapter, { leaseMs: 60 });
  try {
    const execution = first.drain(f.run.id);
    await enteredPromise;
    await new Promise(resolve => setTimeout(resolve, 100));
    const node = f.store.detail(f.run.id).nodes.find(item => item.nodeId === 'plan')!;
    assert.ok(node.leaseUntil > Date.now());
    await second.drain(f.run.id);
    assert.equal(calls, 1);
    release();
    assert.equal((await execution).run.status, 'waiting_approval');
  } finally { await first.close(); await second.close(); f.database.close(); }
});

function addChild(f: ReturnType<typeof fixture>, childDocument = planWorkflow(), roles = f.roles): string {
  const childWorkflow = f.store.createWorkflow(childDocument);
  const childVersion = f.store.publishWorkflow(childWorkflow.id, childWorkflow.revision);
  const parentDocument = createDefaultStorySceneWorkflow();
  const context = parentDocument.nodes.find(node => node.id === 'story_context')!;
  context.kind = 'subworkflow';
  context.outputKind = 'result';
  context.inputs = { parent: { nodeId: 'outer_context', kind: 'context' } };
  context.config = { workflowId: childWorkflow.id, workflowVersion: childVersion.version };
  parentDocument.nodes.unshift({ id: 'outer_context', kind: 'context', outputKind: 'context', inputs: {}, config: {}, label: '父上下文', position: { x: 0, y: 0 } });
  parentDocument.edges.unshift({ id: 'outer_context_child', source: 'outer_context', target: context.id });
  for (const node of parentDocument.nodes) for (const source of Object.values(node.inputs)) if (source.nodeId === context.id) source.kind = 'result';
  // Story reviewers still need context input; keep original context and insert child as an extra director input.
  context.id = 'child_run';
  parentDocument.edges = parentDocument.edges.filter(edge => edge.source !== 'story_context' && edge.target !== 'story_context');
  parentDocument.nodes.push({ id: 'story_context', kind: 'context', outputKind: 'context', inputs: {}, config: {}, label: '故事上下文', position: { x: 0, y: 0 } });
  for (const node of parentDocument.nodes) for (const source of Object.values(node.inputs)) if (source.nodeId === 'story_context') source.kind = 'context';
  for (const node of parentDocument.nodes) if (Object.values(node.inputs).some(input => input.nodeId === 'story_context')) parentDocument.edges.push({ id: `context_${node.id}`, source: 'story_context', target: node.id });
  parentDocument.edges.push({ id: 'outer_child', source: 'outer_context', target: 'child_run' });
  parentDocument.nodes.find(node => node.id === 'story_director_plan')!.inputs.child = { nodeId: 'child_run', kind: 'result' };
  parentDocument.edges.push({ id: 'child_director', source: 'child_run', target: 'story_director_plan' });
  const parentWorkflow = f.store.createWorkflow(parentDocument);
  const parentVersion = f.store.publishWorkflow(parentWorkflow.id, parentWorkflow.revision);
  return f.store.startRun({
    workflowId: parentWorkflow.id, workflowVersion: parentVersion.version, idempotencyKey: 'parent_subworkflow',
    scope: f.run.scope, instruction: f.run.instruction, input: {}, budget: f.run.budget,
  }, roles).id;
}

test('subworkflow freezes roles, waits for child approval, and charges each call to child plus parent', async () => {
  const f = fixture();
  const parentId = addChild(f);
  const runtime = new CreativeRuntime(f.store, executor());
  try {
    const waiting = await runtime.drain(parentId);
    assert.equal(waiting.run.status, 'waiting_approval', waiting.run.error ?? '');
    const children = f.store.listRuns().items.filter(run => run.parentRunId === parentId);
    assert.equal(children.length, 1);
    const child = children[0];
    assert.equal(child.status, 'waiting_approval');
    assert.deepEqual(child.roleSnapshot, waiting.run.roleSnapshot);
    assert.equal(child.usage.textCalls, 1);
    assert.equal(waiting.run.usage.textCalls, 1);
    approvePending(f.store, f.store.detail(child.id));
    const parentWaiting = await runtime.drain(parentId);
    assert.equal(parentWaiting.run.status, 'waiting_approval', parentWaiting.nodes.filter(node => node.error).map(node => node.error).join(';'));
    assert.equal(f.store.getRun(child.id)?.status, 'completed');
    approvePending(f.store, parentWaiting);
    assert.equal((await runtime.drain(parentId)).run.status, 'completed');
    assert.equal(f.store.getRun(parentId)?.usage.textCalls, 5);
    assert.equal(f.store.listRuns().items.filter(run => run.parentRunId === parentId).length, 1);
  } finally { await runtime.close(); f.database.close(); }
});

test('subworkflow shares parent limit, propagates unknown, and resumes only after explicit child recovery', async () => {
  const f = fixture();
  const parentId = addChild(f);
  let failed = false;
  const base = executor({ approve: true });
  const runtime = new CreativeRuntime(f.store, {
    ...base,
    agent: async context => {
      if (context.run.parentRunId && !failed) {
        failed = true;
        context.markDispatched({ textCalls: 1, tokens: 30 });
        throw new Error('已派发但连接丢失');
      }
      return base.agent!(context);
    },
  });
  try {
    assert.equal((await runtime.drain(parentId)).run.status, 'uncertain');
    const child = f.store.listRuns().items.find(run => run.parentRunId === parentId)!;
    assert.equal(child.status, 'uncertain');
    assert.throws(() => runtime.resume(parentId), /核对/);
    const unknown = f.store.detail(child.id).nodes.find(node => node.status === 'uncertain')!;
    runtime.recover(child.id, unknown.id, { expectedRevision: child.revision, resolution: 'not_executed', note: '上游人工确认请求未执行' });
    runtime.resume(parentId);
    assert.equal((await runtime.drain(parentId)).run.status, 'completed');
    assert.equal(f.store.getRun(parentId)?.usage.textCalls, 6);
  } finally { await runtime.close(); f.database.close(); }
});

test('closing a scheduler records in-flight uncertainty immediately without replaying it', async () => {
  const f = fixture(planWorkflow());
  let entered!: () => void;
  let finish!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const finishPromise = new Promise<void>(resolve => { finish = resolve; });
  const runtime = new CreativeRuntime(f.store, {
    ...executor(), agent: async context => {
      context.markDispatched({ textCalls: 1, tokens: 30 }); entered();
      await finishPromise;
      return { summary: 'late response' };
    },
  });
  try {
    const active = runtime.drain(f.run.id);
    await enteredPromise;
    await runtime.close();
    assert.equal(f.store.getRun(f.run.id)?.status, 'uncertain');
    assert.equal(f.store.detail(f.run.id).nodes.find(node => node.nodeId === 'plan')?.status, 'uncertain');
    finish();
    await active;
    assert.equal(f.store.detail(f.run.id).nodes.find(node => node.nodeId === 'plan')?.status, 'uncertain');
  } finally { await runtime.close(); f.database.close(); }
});

test('an approved bundle becoming stale blocks adoption at its last dispatch gate', async () => {
  const f = fixture(planWorkflow());
  const runtime = new CreativeRuntime(f.store, executor());
  try {
    const waiting = await runtime.drain(f.run.id);
    approvePending(f.store, waiting);
    const plan = waiting.nodes.find(node => node.nodeId === 'plan')!;
    f.store.setArtifactStatus(plan.outputArtifactId!, 'superseded');
    const failed = await runtime.drain(f.run.id);
    assert.equal(failed.run.status, 'failed');
    assert.ok(!failed.nodes.some(node => node.nodeId === 'adopt' && node.dispatchedAt));
  } finally { await runtime.close(); f.database.close(); }
});

test('speculative context records parent candidate dependency and is invalidated when parent changes', async () => {
  const f = fixture();
  const runtime = new CreativeRuntime(f.store, executor());
  try {
    const parent = await runtime.drain(f.run.id);
    const candidateId = parent.nodes.find(node => node.nodeId === 'story_writer_scene')!.outputArtifactId!;
    const child = f.store.startRun({
      workflowId: f.workflow.id, workflowVersion: 1, idempotencyKey: 'speculative_child',
      scope: f.run.scope, instruction: f.run.instruction, input: { candidateArtifactId: candidateId }, budget: f.run.budget,
    }, f.roles, f.run.id);
    const waiting = await runtime.drain(child.id);
    assert.equal(waiting.run.status, 'waiting_approval', waiting.run.error ?? '');
    const context = waiting.artifacts.find(artifact => artifact.kind === 'context')!;
    assert.ok(context.dependencyIds.includes(candidateId));
    f.store.setArtifactStatus(candidateId, 'superseded');
    assert.equal(f.store.getArtifact(context.id)?.status, 'stale');
    assert.equal((await runtime.drain(child.id)).run.status, 'failed');
    assert.equal(f.store.detail(child.id).approvals[0].status, 'stale');
  } finally { await runtime.close(); f.database.close(); }
});

test('pause during preparation leaves an unbilled pending node which can safely resume', async () => {
  const f = fixture(planWorkflow());
  let preparationStarted!: () => void;
  let preparationFinished!: () => void;
  const started = new Promise<void>(resolve => { preparationStarted = resolve; });
  const prepared = new Promise<void>(resolve => { preparationFinished = resolve; });
  let attempts = 0;
  const runtime = new CreativeRuntime(f.store, {
    ...executor({ approve: true }), agent: async context => {
      attempts++;
      if (attempts === 1) { preparationStarted(); await prepared; }
      context.markDispatched({ textCalls: 1, tokens: 30 });
      return { summary: '准备完成后才收费' };
    },
  });
  try {
    const active = runtime.drain(f.run.id);
    await started;
    runtime.pause(f.run.id);
    preparationFinished();
    const paused = await active;
    assert.equal(paused.run.status, 'paused');
    assert.equal(paused.run.usage.textCalls, 0);
    assert.equal(paused.nodes.find(node => node.nodeId === 'plan')?.status, 'pending');
    runtime.resume(f.run.id);
    assert.equal((await runtime.drain(f.run.id)).run.status, 'completed');
    assert.equal(f.store.getRun(f.run.id)?.usage.textCalls, 1);
  } finally { await runtime.close(); f.database.close(); }
});

test('real domain adopts parent then speculative successor while each run keeps its own approved budget', async () => {
  const f = fixture();
  const domain = new CreativeDomain(f.database);
  const world = domain.worlds.create({
    title: '港口', summary: '清晨的码头', timeLabel: '清晨', workNature: 'original',
    locations: [{ id: 'harbor', name: '港口', description: '旧码头' }],
    actors: [{ id: 'sailor', name: '水手', role: 'main', characterId: null, characterVersion: null,
      background: '居住在港口', personality: '沉稳', speechStyle: '简短', appearance: '', goals: ['出航'],
      locationId: 'harbor', referenceArtifactIds: [] }], sources: [], lockedFacts: [],
    models: { action: null, adjudication: null, narration: null }, visualStyle: '',
  });
  const branch = domain.worlds.createBranch(world.id, { title: '主线', mode: 'alternate', direction: '', expectedRevision: world.revision });
  const scope = { workName: world.title, worldId: world.id, branchId: branch.id, projectId: null };
  const parent = f.store.startRun({ workflowId: f.workflow.id, workflowVersion: 1, idempotencyKey: 'domain_parent', instruction: '清晨的港口', scope, budget: f.run.budget, input: {} }, f.roles);
  const base = executor();
  const runtime = new CreativeRuntime(f.store, {
    ...base,
    context: async context => domain.collectCreativeContext(context.run),
    agent: async context => {
      if (context.node.outputKind !== 'scene') return base.agent!(context);
      context.markDispatched({ textCalls: 1, tokens: 30 });
      const source = context.inputs.context.content as CreativeContext;
      const scene: CreativeScene = {
        schemaVersion: 1, title: '港口清晨', body: '海风吹过码头，新的一天开始。',
        contextHash: source.contextHash, scope: source.scope, base: source.base,
        sourceRefs: source.sources.map(item => item.id), speculation: source.speculation, directionApprovalId: null,
        simulation: { tick: source.base.currentTick! + 10, events: [{
          id: `event_${context.run.id}`, worldId: world.id, branchId: branch.id, tick: source.base.currentTick! + 10,
          duration: 0, title: '清晨', summary: '码头迎来清晨', locationId: 'harbor', participantIds: ['sailor'],
          facts: [], perspectives: [], causeEventIds: [], storyLineIds: [], stateChanges: [], createdAt: new Date().toISOString(),
        }], states: [], memories: [], consumedInterventionIds: [], supportingActors: [] },
      };
      return domain.validateCreativeScene(scene, source) as unknown as Record<string, unknown>;
    },
    adopt: async context => {
      const reviewedIds = context.artifacts!.filter(item => item.runId === context.run.id && item.kind === 'review').map(item => item.content.targetArtifactId);
      const scene = context.artifacts!.find(item => item.runId === context.run.id && item.kind === 'scene' && reviewedIds.includes(item.id))!;
      return f.store.atomic(() => {
        context.markDispatched({});
        return domain.commitCreativeScene(context.run, scene, context.approval!);
      });
    },
  });
  try {
    const parentWaiting = await runtime.drain(parent.id);
    assert.equal(parentWaiting.run.status, 'waiting_approval', parentWaiting.nodes.filter(node => node.error).map(node => node.error).join(';'));
    const candidateId = parentWaiting.nodes.find(node => node.nodeId === 'story_writer_scene')!.outputArtifactId!;
    const child = f.store.startRun({
      workflowId: f.workflow.id, workflowVersion: 1, idempotencyKey: 'domain_successor', instruction: '接着写下一幕', scope,
      budget: f.run.budget, input: { candidateArtifactId: candidateId },
    }, f.roles, parent.id);
    const childWaiting = await runtime.drain(child.id);
    assert.equal(childWaiting.run.status, 'waiting_approval', childWaiting.run.error ?? '');
    assert.equal(f.store.getRun(parent.id)?.usage.textCalls, 4);
    assert.equal(childWaiting.run.usage.textCalls, 4);
    approvePending(f.store, childWaiting);
    assert.equal((await runtime.drain(child.id)).run.status, 'waiting_approval');
    approvePending(f.store, parentWaiting);
    assert.equal((await runtime.drain(parent.id)).run.status, 'completed');
    const completed = await runtime.drain(child.id);
    assert.equal(completed.run.status, 'completed', completed.run.error ?? '');
    assert.equal(domain.worlds.getBranch(world.id, branch.id).revision, branch.revision + 2);
    assert.equal(f.database.connection.prepare('SELECT COUNT(*) AS count FROM sw_events').get()?.count, 2);
  } finally { await runtime.close(); f.database.close(); }
});

test('parent pause during child preparation spends nothing and child resumes under the shared ceiling', async () => {
  const f = fixture();
  const parentId = addChild(f);
  let entered!: () => void;
  let release!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const releasePromise = new Promise<void>(resolve => { release = resolve; });
  let prepared = false;
  const base = executor({ approve: true });
  const runtime = new CreativeRuntime(f.store, {
    ...base, agent: async context => {
      if (context.run.parentRunId && !prepared) { prepared = true; entered(); await releasePromise; }
      return base.agent!(context);
    },
  });
  try {
    const active = runtime.drain(parentId);
    await enteredPromise;
    runtime.pause(parentId);
    release();
    assert.equal((await active).run.status, 'paused');
    const child = f.store.listRuns().items.find(run => run.parentRunId === parentId)!;
    assert.equal(child.usage.textCalls, 0);
    assert.equal(f.store.detail(child.id).nodes.find(node => node.nodeId === 'plan')?.status, 'pending');
    runtime.resume(parentId);
    assert.equal((await runtime.drain(parentId)).run.status, 'completed');
  } finally { await runtime.close(); f.database.close(); }
});

test('root and nested tools both require frozen role authorization, including explicit-role restrictions', async () => {
  for (const nested of [false, true]) for (const access of ['granted', 'removed', 'wrong_role'] as const) {
    const document = planWorkflow();
    document.purpose = 'video-plan';
    const tool = document.nodes.find(node => node.id === 'plan')!;
    tool.kind = 'tool';
    tool.config = { tool: 'video_plan' };
    if (access === 'wrong_role') tool.roleId = 'lead_writer';
    else delete tool.roleId;
    const f = fixture(document);
    const roles = access === 'removed' ? f.roles.map(role => ({ ...role, tools: role.tools.filter(name => name !== 'video_plan') })) : f.roles;
    const runId = nested ? addChild(f, document, roles) : f.store.startRun({
      workflowId: f.workflow.id, workflowVersion: 1, idempotencyKey: 'tool_access_root', scope: f.run.scope,
      instruction: f.run.instruction, input: {}, budget: f.run.budget,
    }, roles).id;
    let dispatched = 0;
    const runtime = new CreativeRuntime(f.store, {
      ...executor({ approve: true }), tool: async context => {
        context.markDispatched({}); dispatched++;
        return { summary: '已准备视频计划', executionStatus: 'planning_only' };
      },
    });
    try {
      const detail = await runtime.drain(runId);
      assert.equal(detail.run.status, access === 'granted' ? 'completed' : 'failed', detail.run.error ?? '');
      assert.equal(dispatched, access === 'granted' ? 1 : 0);
      if (access !== 'granted') assert.equal(detail.run.usage.textCalls, 0);
    } finally { await runtime.close(); f.database.close(); }
  }
});

test('node token reservations precede dispatch and settle once, while unknown and overage never allow free retries', async () => {
  for (const actual of [20, null, 90]) {
    const f = fixture(planWorkflow());
    const runtime = new CreativeRuntime(f.store, {
      ...executor({ approve: true }), agent: async context => {
        context.markDispatched({ textCalls: 1, tokens: 50 });
        assert.equal(f.store.getTokenReservation(context.nodeRun.id)?.reserved, 50);
        assert.equal(f.store.getRun(context.run.id)?.usage.tokens, 50);
        context.settleTokenUsage(actual);
        assert.throws(() => context.settleTokenUsage(actual), /已经结算/);
        return { summary: '已有可信供应商用量或明确未知' };
      },
    });
    try {
      const detail = await runtime.drain(f.run.id);
      assert.equal(detail.run.usage.tokens, actual ?? 50);
      const node = detail.nodes.find(item => item.nodeId === 'plan')!;
      assert.equal(f.store.getTokenReservation(node.id)?.state, actual === null ? 'unknown' : actual > 50 ? 'overage' : 'settled');
      assert.equal(detail.run.status, actual !== null && actual > 50 ? 'failed' : 'completed');
      if (actual === 90) assert.equal(detail.nodes.find(item => item.nodeId === 'adopt')?.dispatchedAt, null);
    } finally { await runtime.close(); f.database.close(); }
  }
});

test('explicit recovery creates a fresh attempt and preserves the unknown request token reservation', async () => {
  const f = fixture(planWorkflow());
  let calls = 0;
  const runtime = new CreativeRuntime(f.store, {
    ...executor({ approve: true }), agent: async context => {
      context.markDispatched({ textCalls: 1, tokens: 50 }); calls++;
      if (calls === 1) { context.settleTokenUsage(null); throw new Error('结果未知'); }
      context.settleTokenUsage(10);
      return { summary: '核对后新尝试' };
    },
  });
  try {
    const unknown = await runtime.drain(f.run.id);
    const first = unknown.nodes.find(item => item.nodeId === 'plan')!;
    runtime.recover(f.run.id, first.id, { expectedRevision: unknown.run.revision, resolution: 'not_executed', note: '人工核对服务端没有执行记录' });
    runtime.resume(f.run.id);
    const detail = await runtime.drain(f.run.id);
    assert.equal(detail.run.status, 'completed', detail.run.error ?? '');
    assert.equal(detail.run.usage.tokens, 60);
    assert.equal(detail.run.usage.textCalls, 2);
    const nodes = detail.nodes.filter(item => item.nodeId === 'plan');
    assert.deepEqual(nodes.map(item => item.attempt), [0, 1]);
    assert.equal(f.store.getTokenReservation(first.id)?.state, 'unknown');
    assert.ok(nodes[0].dispatchedAt);
    assert.equal(f.store.getTokenReservation(nodes[1].id)?.actual, 10);
  } finally { await runtime.close(); f.database.close(); }
});
