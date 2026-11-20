import assert from 'node:assert/strict';
import test from 'node:test';
import type { CreativeScope, CreativeWorkflow, CreativeWorkflowDocument } from '@sthstart/contracts';
import { nowIso, ServiceDatabase } from '../database.js';
import { readConfig } from '../config.js';
import { SecretStore } from '../security.js';
import { resolveEffectiveModelProfile } from '../providers.js';
import { CreativeActions } from './actions.js';
import { CREATIVE_ACTION_STATEMENTS } from './action-migration.js';
import { CREATIVE_ORCHESTRATION_STATEMENTS } from './migration.js';
import {
  createCreativeConversationWorkflow, isCreativeConversationWorkflow,
  normalizeAssistantPlan, prepareAssistantPlan,
} from './conversation.js';
import { CreativeRuntime, CreativeOutputRejectedError } from './runtime.js';
import { CreativeStore } from './store.js';
import { createDefaultCreativeRoles, createDefaultStorySceneWorkflow } from './templates.js';
import { validateCreativeGraph } from './graph.js';
import { CreativeDomain } from './domain.js';
import { CREATIVE_APP_ID, createCreativeExecutor, profileFingerprint } from './executor.js';

const scope = { workName: '创作测试', worldId: null, branchId: null, projectId: null };
function fixture() {
  const database = new ServiceDatabase(':memory:');
  for (const statement of [...CREATIVE_ORCHESTRATION_STATEMENTS, ...CREATIVE_ACTION_STATEMENTS]) database.connection.exec(statement);
  const store = new CreativeStore(database);
  const actions = new CreativeActions(database);
  const workflow = store.createWorkflow(createDefaultStorySceneWorkflow());
  store.publishWorkflow(workflow.id, workflow.revision);
  const target = store.getWorkflow(workflow.id)!;
  return { database, store, actions, target };
}
const answer = { kind: 'assistant-proposal', intent: 'answer', answer: '请告诉我这一幕的核心冲突。' };
const edit = (target: CreativeWorkflow, document = { ...target.document, name: '更慢的节奏' }) => ({
  kind: 'assistant-proposal', answer: '我会沿用当前流程，把场景节奏调整为更慢。', intent: 'edit_workflow',
  action: { tool: 'workflow.update', args: { workflowId: target.id, expectedRevision: target.revision, instruction: '将节奏调慢', document } },
});

test('conversation workflow is a real graph and only its exact server template grants its identity', () => {
  const workflow = createCreativeConversationWorkflow();
  assert.equal(validateCreativeGraph(workflow).valid, true);
  assert.equal(isCreativeConversationWorkflow(workflow), true);
  assert.equal(isCreativeConversationWorkflow({ ...workflow, name: '相似但非官方模板' }), false);
  const malicious = structuredClone(workflow);
  malicious.nodes[1].config.parameters = { assistantProposal: false };
  assert.equal(isCreativeConversationWorkflow(malicious), false);
  assert.equal(workflow.nodes.find(node => node.kind === 'agent')?.roleId, 'production_manager');
});

test('parser accepts all four intents and pins run proposals to a real published version', () => {
  const f = fixture();
  try {
    const catalog = f.actions.catalog();
    assert.equal(normalizeAssistantPlan(answer, [f.target], catalog).intent, 'answer');
    assert.equal(normalizeAssistantPlan(edit(f.target), [f.target], catalog).intent, 'edit_workflow');
    assert.equal(normalizeAssistantPlan({ kind: 'assistant-proposal', intent: 'apply_action', answer: '创建世界草稿。',
      action: { tool: 'world.setup.create', args: { name: '港口', background: '清晨的港口' } } }, [f.target], catalog).intent, 'apply_action');
    const start = { kind: 'assistant-proposal', intent: 'start_workflow', answer: '已准备创作方案，待确认预算后开始。',
      proposal: { workflowId: f.target.id, workflowVersion: 1, instruction: '写一次重逢', input: { sceneGoal: '重逢' } } };
    const normalized = normalizeAssistantPlan(start, [f.target], catalog);
    assert.equal(normalized.intent, 'start_workflow');
    start.proposal.input.sceneGoal = '外部修改';
    assert.equal(normalized.intent === 'start_workflow' && normalized.proposal.input.sceneGoal, '重逢');
    for (const proposal of [
      { ...start.proposal, workflowId: 'nonexistent' }, { ...start.proposal, workflowVersion: 99 },
      { ...start.proposal, input: { actionOrigin: 'admin-ui' } }, { ...start.proposal, input: { candidateArtifactId: 'foreign' } },
    ]) assert.throws(() => normalizeAssistantPlan({ ...start, proposal }, [f.target], catalog), CreativeOutputRejectedError);
  } finally { f.database.close(); }
});

test('parser refuses model-issued approval, unregistered tools, mixed intents, stale revisions and invalid graphs', () => {
  const f = fixture();
  try {
    const catalog = f.actions.catalog();
    const invalid = [
      { ...answer, approved: true }, { ...answer, previewHash: 'a'.repeat(64) },
      { ...answer, action: { tool: 'work.create', args: { name: '额外动作' } } },
      { kind: 'assistant-proposal', intent: 'apply_action', answer: '读取密钥', action: { tool: 'secrets.read', args: {} } },
      { ...edit(f.target), intent: 'apply_action' },
      edit({ ...f.target, revision: f.target.revision - 1 }),
    ];
    for (const content of invalid) assert.throws(() => normalizeAssistantPlan(content, [f.target], catalog), CreativeOutputRejectedError);
    assert.throws(() => normalizeAssistantPlan(edit(f.target), [f.target], { ...catalog, tools: [] }), /未登记/);
    const noApproval = structuredClone(f.target.document);
    noApproval.nodes = noApproval.nodes.filter(node => node.kind !== 'approval');
    assert.throws(() => normalizeAssistantPlan(edit(f.target, noApproval), [f.target], catalog), /工作流提案无效/);
  } finally { f.database.close(); }
});

async function runEdit(f: ReturnType<typeof fixture>, content: unknown) {
  const workflow = f.store.createWorkflow(createCreativeConversationWorkflow());
  const version = f.store.publishWorkflow(workflow.id, workflow.revision);
  const run = f.store.startRun({ workflowId: workflow.id, workflowVersion: version.version,
    idempotencyKey: 'assistant_test', scope, instruction: '把这个流程改得更慢一些',
    budget: { maxTextCalls: 1, maxImages: 0, maxTokens: 1000, maxRevisions: 0 }, input: { actionOrigin: 'admin-ui' },
  }, createDefaultCreativeRoles());
  const runtime = new CreativeRuntime(f.store, {
    context: async () => ({ workflows: [f.target], actionCatalog: f.actions.catalog() }),
    agent: async context => {
      context.markDispatched({ textCalls: 1, tokens: 500 });
      return prepareAssistantPlan(content, [f.target], f.actions, scope);
    },
    adopt: async context => {
      const plan = context.artifacts!.find(artifact => artifact.kind === 'plan')!;
      return f.store.atomic(() => {
        context.markDispatched({});
        return f.actions.apply(context.run, plan, context.approval!) as unknown as Record<string, unknown>;
      });
    },
  });
  return { runtime, run, waiting: await runtime.drain(run.id) };
}

test('bounded model run persists its proposal, waits for exact approval, then updates the same real draft once', async () => {
  const f = fixture();
  const { runtime, run, waiting } = await runEdit(f, edit(f.target));
  try {
    assert.equal(waiting.run.status, 'waiting_approval');
    assert.equal(waiting.run.usage.textCalls, 1);
    assert.equal(waiting.run.usage.tokens, 500);
    assert.equal(f.store.getWorkflow(f.target.id)?.revision, f.target.revision);
    const plan = waiting.artifacts.find(artifact => artifact.kind === 'plan')!;
    assert.match(String(plan.content.previewHash), /^[a-f0-9]{64}$/);
    const approval = waiting.approvals[0];
    assert.ok(approval.artifactIds.includes(plan.id));
    f.store.decideApproval(approval.id, { expectedRevision: approval.revision, bundleHash: approval.bundleHash, decision: 'approve', comment: '按照该方案修改' });
    const complete = await runtime.drain(run.id);
    assert.equal(complete.run.status, 'completed', complete.run.error ?? '');
    const target = f.store.getWorkflow(f.target.id)!;
    assert.equal(target.document.name, '更慢的节奏');
    assert.equal(target.revision, f.target.revision + 1);
    assert.equal(target.publishedVersion, 1);
    assert.equal(f.store.getVersion(target.id, 1)!.document.name, f.target.document.name);
    await runtime.drain(run.id);
    assert.equal(f.store.getWorkflow(target.id)?.revision, target.revision);
    assert.equal(f.database.connection.prepare('SELECT COUNT(*) AS count FROM co_action_adoptions').get()?.count, 1);
  } finally { await runtime.close(); f.database.close(); }
});

test('natural-language creation saves a real unpublished draft after approval and invalid proposal never reaches approval', async () => {
  for (const valid of [true, false]) {
    const f = fixture();
    const document: CreativeWorkflowDocument = { ...createDefaultStorySceneWorkflow(), name: '为港口写一套新流程' };
    const content = valid ? { kind: 'assistant-proposal', intent: 'edit_workflow', answer: '请核对新流程后创建。', action: { tool: 'workflow.create', args: { document } } }
      : { kind: 'assistant-proposal', intent: 'apply_action', answer: '执行任意脚本', action: { tool: 'exec', args: { command: 'anything' } } };
    const { runtime, run, waiting } = await runEdit(f, content);
    try {
      if (valid) {
        assert.equal(waiting.run.status, 'waiting_approval');
        const approval = waiting.approvals[0];
        f.store.decideApproval(approval.id, { expectedRevision: approval.revision, bundleHash: approval.bundleHash, decision: 'approve', comment: '' });
        assert.equal((await runtime.drain(run.id)).run.status, 'completed');
        const created = f.store.listWorkflows().items.find(workflow => workflow.document.name === document.name)!;
        assert.ok(created);
        assert.equal(created.publishedVersion, 0);
      } else {
        assert.equal(waiting.run.status, 'failed');
        assert.equal(waiting.approvals.length, 0);
        assert.equal(waiting.run.usage.textCalls, 1);
        assert.ok(waiting.nodes.some(node => node.status === 'failed' && node.outputArtifactId));
      }
    } finally { await runtime.close(); f.database.close(); }
  }
});

test('entity changes after proposal invalidate its preview and cannot overwrite the newer workflow', async () => {
  const f = fixture();
  const { runtime, run, waiting } = await runEdit(f, edit(f.target));
  try {
    f.store.saveWorkflow(f.target.id, { expectedRevision: f.target.revision, document: { ...f.target.document, name: '用户手动修改' } });
    const approval = waiting.approvals[0];
    f.store.decideApproval(approval.id, { expectedRevision: approval.revision, bundleHash: approval.bundleHash, decision: 'approve', comment: '' });
    const stopped = await runtime.drain(run.id);
    assert.notEqual(stopped.run.status, 'completed');
    assert.equal(f.store.getWorkflow(f.target.id)?.document.name, '用户手动修改');
    assert.equal(f.database.connection.prepare('SELECT COUNT(*) AS count FROM co_action_adoptions').get()?.count, 0);
  } finally { await runtime.close(); f.database.close(); }
});

class ConversationSecrets extends SecretStore {
  override async status() { return { available: true, backend: 'memory', envFallback: false }; }
  override async get() { return { value: null, source: 'none' as const }; }
}

async function actualExecutorHarness(
  f: ReturnType<typeof fixture>,
  output: Record<string, unknown>,
  runScope: CreativeScope,
  beforeResponse?: () => void,
) {
  const now = nowIso();
  const modelId = 'conversation_test_model';
  f.database.connection.prepare(`INSERT OR IGNORE INTO managed_apps
    (id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`)
    .run(CREATIVE_APP_ID, '总管测试', 'isolated-test-token-hash', '["story"]', now, now);
  f.database.connection.prepare(`INSERT INTO service_connections
    (id,name,kind,base_url,credential_account,timeout_ms,headers_json,options_json,enabled,created_at,updated_at)
    VALUES (?,?,?,?,NULL,1000,'{}','{}',1,?,?)`)
    .run('conversation_connection', '隔离模型', 'openai-compatible-text', 'https://conversation.invalid/v1', now, now);
  f.database.connection.prepare(`INSERT INTO model_profiles
    (id,connection_id,name,model_id,capabilities_json,default_params_json,advanced_json,test_status,enabled,created_at,updated_at)
    VALUES (?,?,?,?,?,'{}','{"thinkingMode":"omit"}','passed',1,?,?)`)
    .run(modelId, 'conversation_connection', '隔离对话模型', 'mock-conversation', '["text"]', now, now);
  const workflow = f.store.createWorkflow(createCreativeConversationWorkflow());
  const version = f.store.publishWorkflow(workflow.id, workflow.revision);
  const roles = createDefaultCreativeRoles().map(role => ({ ...role, modelId }));
  const run = f.store.startRun({ workflowId: workflow.id, workflowVersion: version.version, idempotencyKey: 'actual_executor_assistant',
    scope: runScope, instruction: '请处理当前创作需求', input: { actionOrigin: 'admin-ui' },
    budget: { maxTextCalls: 1, maxImages: 0, maxTokens: 1_000_000, maxRevisions: 0 },
  }, roles);
  const secrets = new ConversationSecrets({});
  const profile = await resolveEffectiveModelProfile(f.database, secrets, CREATIVE_APP_ID, undefined, modelId);
  assert.ok(profile);
  f.database.connection.prepare('INSERT INTO co_run_models(run_id,role_id,profile_id,profile_hash) VALUES (?,?,?,?)')
    .run(run.id, 'production_manager', profile.id, profileFingerprint(profile));
  const requests: Array<{ context: { data: Record<string, unknown> }; instruction: string }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    assert.match(String(url), /^https:\/\/conversation\.invalid\/v1\/chat\/completions$/);
    const request = JSON.parse(String(init?.body));
    const user = request.messages.find((message: { role: string }) => message.role === 'user');
    const payload = JSON.parse(user.content.find((part: { type: string }) => part.type === 'text').text);
    requests.push(payload);
    assert.equal(f.store.getRun(run.id)?.usage.textCalls, 1);
    assert.ok(f.store.detail(run.id).nodes.find(node => node.nodeId === 'assistant_plan')?.dispatchedAt);
    beforeResponse?.();
    return Response.json({ choices: [{ message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
  };
  const runtime = new CreativeRuntime(f.store, createCreativeExecutor({
    config: readConfig({}), database: f.database, secrets, store: f.store, domain: new CreativeDomain(f.database), fetcher,
  }));
  return { runtime, run, requests };
}

test('actual executor handles unscoped answers and start proposals using one billed request and no automatic second run', async () => {
  for (const intent of ['answer', 'start_workflow'] as const) {
    const f = fixture();
    const output = intent === 'answer' ? answer : { kind: 'assistant-proposal', intent, answer: '这个故事流程合适，确认预算后可以启动。',
      proposal: { workflowId: f.target.id, workflowVersion: f.target.publishedVersion, instruction: '生成一场重逢', input: {} } };
    const h = await actualExecutorHarness(f, output, { workName: null, worldId: null, branchId: null, projectId: null });
    try {
      const done = await h.runtime.drain(h.run.id);
      assert.equal(done.run.status, 'completed', done.run.error ?? '');
      assert.equal(h.requests.length, 1);
      assert.equal(f.store.listRuns().items.length, 1);
      const result = done.artifacts.find(artifact => artifact.kind === 'result')!;
      assert.equal(result.content.executionStatus, intent === 'answer' ? 'answered' : 'awaiting_budget_confirmation');
      assert.ok(Array.isArray(h.requests[0].context.data.workflows));
    } finally { await h.runtime.close(); f.database.close(); }
  }
});

test('actual executor persists real preview then changes the existing draft only after approval', async () => {
  for (const stale of [false, true]) {
    const f = fixture();
    const h = await actualExecutorHarness(f, edit(f.target), { workName: null, worldId: null, branchId: null, projectId: null });
    try {
      const waiting = await h.runtime.drain(h.run.id);
      assert.equal(waiting.run.status, 'waiting_approval', waiting.nodes.filter(node => node.error).map(node => node.error).join(';'));
      const plan = waiting.artifacts.find(artifact => artifact.kind === 'plan')!;
      assert.equal((plan.content.preview as { valid: boolean }).valid, true);
      assert.equal(f.store.getWorkflow(f.target.id)?.revision, f.target.revision);
      if (stale) f.store.saveWorkflow(f.target.id, { expectedRevision: f.target.revision, document: { ...f.target.document, name: '并发更新' } });
      const approval = waiting.approvals[0];
      f.store.decideApproval(approval.id, { expectedRevision: approval.revision, bundleHash: approval.bundleHash, decision: 'approve', comment: '' });
      const done = await h.runtime.drain(h.run.id);
      assert.equal(done.run.status, stale ? 'failed' : 'completed', done.nodes.filter(node => node.error).map(node => node.error).join(';'));
      assert.equal(f.store.getWorkflow(f.target.id)?.document.name, stale ? '并发更新' : '更慢的节奏');
      assert.equal(h.requests.length, 1);
    } finally { await h.runtime.close(); f.database.close(); }
  }
});

test('actual executor validates against the frozen visible catalog and refuses hidden admin actions', async () => {
  const f = fixture();
  const h = await actualExecutorHarness(f, { kind: 'assistant-proposal', intent: 'apply_action', answer: '创建作品',
    action: { tool: 'work.create', args: { name: '未授权作品' } } }, scope);
  try {
    const detail = await h.runtime.drain(h.run.id);
    assert.equal(detail.run.status, 'failed');
    assert.equal(detail.approvals.length, 0);
    assert.equal(h.requests.length, 1);
    const catalog = h.requests[0].context.data.actions as { tools: Array<{ tool: string }> };
    assert.ok(!catalog.tools.some(tool => tool.tool === 'work.create'));
    assert.match(detail.nodes.find(node => node.nodeId === 'assistant_plan')?.error ?? '', /未登记/);
  } finally { await h.runtime.close(); f.database.close(); }
});

test('a workflow published during the model call does not silently move the fixed version in its proposal', async () => {
  const f = fixture();
  const h = await actualExecutorHarness(f, { kind: 'assistant-proposal', intent: 'start_workflow', answer: '使用看到的固定版本',
    proposal: { workflowId: f.target.id, workflowVersion: f.target.publishedVersion, instruction: '生成场景', input: {} } }, scope, () => {
    const saved = f.store.saveWorkflow(f.target.id, { expectedRevision: f.target.revision, document: { ...f.target.document, name: '后来发布的版本' } });
    f.store.publishWorkflow(saved.id, saved.revision);
  });
  try {
    const done = await h.runtime.drain(h.run.id);
    assert.equal(done.run.status, 'completed', done.run.error ?? '');
    assert.equal(f.store.getWorkflow(f.target.id)?.publishedVersion, 2);
    const proposal = done.artifacts.find(artifact => artifact.kind === 'plan')?.content.proposal as { workflowVersion: number };
    assert.equal(proposal.workflowVersion, 1);
    assert.equal(h.requests.length, 1);
  } finally { await h.runtime.close(); f.database.close(); }
});
