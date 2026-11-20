import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import Fastify from 'fastify';
import type {
  CreativeBudget,
  CreativeMessageRequest,
  CreativeMessageResponse,
  CreativeRun,
  CreativeScope,
  CreativeStartRun,
  CreativeWorkflowDocument,
} from '@sthstart/contracts';
import { readConfig } from '../config.js';
import { ServiceDatabase } from '../database.js';
import { hashToken } from '../security.js';
import {
  CREATIVE_AGENT_GRANT_STATEMENTS,
  creativeScopeWithin,
  registerCreativeBridge,
  type CreativeAgentCandidateReceipt,
  type CreativeAgentCandidateSubmission,
  type CreativeAgentContextResponse,
  type CreativeAgentMemoryEntriesQuery,
  type CreativeAgentMemoryFactsQuery,
  type CreativeCreateGrant,
  type CreativeGrantCreated,
  type CreativeBridgeHandlers,
} from './bridge.js';
import { CREATIVE_ORCHESTRATION_STATEMENTS } from './migration.js';
import { createCreativeConversationWorkflow } from './conversation.js';
import { CreativeStore, CreativeStoreError, creativeHash } from './store.js';
import {
  createDefaultCreativeRoles,
} from './templates.js';

const ADMIN_TOKEN = `admin_${'a'.repeat(40)}`;
const AT = '2026-11-17T00:00:00.000Z';
const scopeA: CreativeScope = {
  workName: '作品 A',
  worldId: null,
  branchId: null,
  projectId: null,
};
const scopeB: CreativeScope = {
  workName: '作品 B',
  worldId: null,
  branchId: null,
  projectId: null,
};
const budget: CreativeBudget = {
  maxTextCalls: 3,
  maxImages: 2,
  maxTokens: 5000,
  maxRevisions: 1,
};

type LoggedRequest = {
  url: string;
  method: string;
  body: unknown;
};

function temporaryDatabase(): ServiceDatabase {
  const database = new ServiceDatabase(':memory:');
  for (const statement of [
    ...CREATIVE_ORCHESTRATION_STATEMENTS,
    ...CREATIVE_AGENT_GRANT_STATEMENTS,
  ]) database.connection.exec(statement);
  return database;
}

function grantInput(overrides: Partial<CreativeCreateGrant> = {}): CreativeCreateGrant {
  return {
    name: '外部创作 Agent',
    scope: scopeA,
    permissions: ['read', 'propose', 'run', 'stop'],
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    budget: { ...budget },
    ...overrides,
  };
}

function runInput(
  workflowId: string,
  idempotencyKey: string,
  overrides: Partial<CreativeStartRun> = {},
): CreativeStartRun {
  return {
    workflowId,
    workflowVersion: 1,
    idempotencyKey,
    scope: scopeA,
    instruction: '生成一个等待人工采用的候选场景。',
    budget: {
      maxTextCalls: 1,
      maxImages: 1,
      maxTokens: 1000,
      maxRevisions: 1,
    },
    input: { premise: '雨夜抵达车站' },
    ...overrides,
  };
}

function bridgeWorkflow(
  directorId: string,
  reviewerId: string,
): CreativeWorkflowDocument {
  return {
    name: '桥测试工作流',
    description: '只用于验证外部桥的固定版本与审核采用结构。',
    purpose: 'general',
    nodes: [
      {
        id: 'context',
        kind: 'context',
        label: '上下文',
        outputKind: 'context',
        inputs: {},
        config: {},
        position: { x: 0, y: 0 },
      },
      {
        id: 'writer',
        kind: 'agent',
        label: '候选生成',
        roleId: directorId,
        outputKind: 'plan',
        inputs: { context: { nodeId: 'context', kind: 'context' } },
        config: { instruction: '生成候选，不直接采用。' },
        position: { x: 200, y: 0 },
      },
      {
        id: 'critical',
        kind: 'condition',
        label: '重大方向检查',
        outputKind: 'decision',
        inputs: { plan: { nodeId: 'writer', kind: 'plan' } },
        config: { condition: 'critical_change' },
        position: { x: 320, y: 0 },
      },
      {
        id: 'plan_join',
        kind: 'join',
        label: '普通方向汇合',
        outputKind: 'plan',
        inputs: {
          plan: { nodeId: 'writer', kind: 'plan' },
          ordinary: { nodeId: 'critical', kind: 'decision' },
        },
        config: { instruction: '保留实际计划。' },
        position: { x: 440, y: 120 },
      },
      {
        id: 'review',
        kind: 'agent',
        label: '审核',
        roleId: reviewerId,
        outputKind: 'review',
        inputs: {
          context: { nodeId: 'context', kind: 'context' },
          candidate: { nodeId: 'writer', kind: 'plan' },
        },
        config: { instruction: '审核候选。' },
        position: { x: 400, y: 0 },
      },
      {
        id: 'approval',
        kind: 'approval',
        label: '人工批准',
        outputKind: 'decision',
        inputs: {
          candidate: { nodeId: 'plan_join', kind: 'plan' },
          route: { nodeId: 'critical', kind: 'decision' },
          review: { nodeId: 'review', kind: 'review' },
        },
        config: {
          reviewerRoleIds: [reviewerId],
          parameters: { directionGate: true },
        },
        position: { x: 600, y: 0 },
      },
      {
        id: 'adopt',
        kind: 'adopt',
        label: '正式采用',
        outputKind: 'result',
        inputs: { decision: { nodeId: 'approval', kind: 'decision' } },
        config: { instruction: '只通过采用适配器写入正式内容。' },
        position: { x: 800, y: 0 },
      },
    ],
    edges: [
      { id: 'context_writer', source: 'context', target: 'writer' },
      { id: 'context_review', source: 'context', target: 'review' },
      { id: 'writer_review', source: 'writer', target: 'review' },
      { id: 'writer_critical', source: 'writer', target: 'critical' },
      { id: 'writer_join', source: 'writer', target: 'plan_join' },
      {
        id: 'critical_join',
        source: 'critical',
        target: 'plan_join',
        when: 'rejected',
      },
      {
        id: 'critical_approval',
        source: 'critical',
        target: 'approval',
        when: 'approved',
      },
      { id: 'join_approval', source: 'plan_join', target: 'approval' },
      { id: 'review_approval', source: 'review', target: 'approval' },
      { id: 'approval_adopt', source: 'approval', target: 'adopt', when: 'approved' },
    ],
  };
}

function fixture() {
  const database = temporaryDatabase();
  const store = new CreativeStore(database);
  const roles = createDefaultCreativeRoles();
  for (const role of roles) store.saveRole(role);
  const draft = store.createWorkflow(bridgeWorkflow(roles[1].id, roles[2].id));
  const workflow = store.publishWorkflow(draft.id, draft.revision);
  const proposals: CreativeMessageRequest[] = [];
  const requests: LoggedRequest[] = [];
  const contextReads: CreativeScope[] = [];
  const memoryFactsReads: Array<{
    scope: CreativeScope;
    query: CreativeAgentMemoryFactsQuery;
  }> = [];
  const memoryEntriesReads: Array<{
    scope: CreativeScope;
    options: CreativeAgentMemoryEntriesQuery;
  }> = [];
  const contextState = { unsafeHash: false };
  const candidateSubmissions = new Map<string, {
    input: CreativeAgentCandidateSubmission;
    receipt: CreativeAgentCandidateReceipt;
  }>();
  const candidateState = { unsafeReceipt: false };
  const runtimeStarts = { count: 0 };
  let candidateSequence = 0;
  const handlers: CreativeBridgeHandlers = {
    startRun: async (input) => {
      runtimeStarts.count += 1;
      return store.startRun(input, roles);
    },
    stopRun: (id) => {
      const run = store.getRun(id);
      if (!run) throw new Error('missing run');
      return run.status === 'cancelled'
        ? run
        : store.updateRun(id, { status: 'cancelled' }, run.revision);
    },
    propose: async (input): Promise<CreativeMessageResponse> => {
      proposals.push(structuredClone(input));
      return {
        conversationId: 'conversation_1',
        message: {
          id: 'message_1',
          conversationId: 'conversation_1',
          role: 'assistant',
          content: '建议使用已发布的故事场景工作流。',
          createdAt: AT,
        },
        proposal: {
          workflowId: draft.id,
          workflowVersion: workflow.version,
          instruction: '先写场景候选，不直接入稿。',
          input: { source: 'conversation' },
          reason: '需要人工查看后再决定是否运行。',
        },
      };
    },
    submitCandidate: async (input) => {
      const existing = candidateSubmissions.get(input.idempotencyKey);
      if (existing) {
        if (creativeHash(existing.input) !== creativeHash(input)) {
          throw new CreativeStoreError(
            'creative_agent_candidate_idempotency_conflict',
            409,
            '同一候选提交键对应了不同内容。',
          );
        }
        return { ...existing.receipt, replayed: true };
      }
      candidateSequence += 1;
      const receipt: CreativeAgentCandidateReceipt = {
        candidate: {
          id: `candidate_${candidateSequence}`,
          runId: `run_candidate_${candidateSequence}`,
          nodeRunId: `node_candidate_${candidateSequence}`,
          kind: input.kind,
          status: 'candidate',
          contentHash: creativeHash(input.content),
          contextHash: input.contextHash,
          createdAt: AT,
        },
        review: { required: true, status: 'pending' },
        replayed: false,
      };
      candidateSubmissions.set(input.idempotencyKey, {
        input: structuredClone(input),
        receipt: structuredClone(receipt),
      });
      if (!candidateState.unsafeReceipt) return receipt;
      return {
        ...receipt,
        candidate: { ...receipt.candidate, status: 'approved' as never },
      };
    },
    readContext: async (scope) => {
      contextReads.push(structuredClone(scope));
      const payload = {
        workName: scope.workName,
        worldId: scope.worldId,
        branchId: scope.branchId,
        projectId: scope.projectId,
        canonicalRevision: 3,
        lockedFacts: ['雨夜抵达车站'],
        activeCharacters: ['角色甲', '角色乙'],
      };
      return {
        ...payload,
        contextHash: contextState.unsafeHash
          ? 'f'.repeat(64)
          : creativeHash(payload),
      };
    },
    readMemoryFacts: (scope, query) => {
      memoryFactsReads.push({ scope: structuredClone(scope), query: structuredClone(query) });
      return {
        items: [{
          id: 'fact:bridge',
          eventId: 'event_bridge',
          factId: 'fact_bridge',
          content: '港口存在。',
          nature: query.nature ?? 'canon',
          tick: 3,
          knownBy: ['actor_a'],
          locationId: 'harbor',
          storyLineIds: [],
          sourceHash: creativeHash({ content: '港口存在。' }),
        }],
        total: 1,
        offset: query.offset ?? 0,
        nextOffset: null,
        coverage: 'selected-facts-from-complete-index',
        branchRevision: 3,
        actorId: query.actorId ?? null,
      };
    },
    readMemoryEntries: (scope, options) => {
      memoryEntriesReads.push({ scope: structuredClone(scope), options: structuredClone(options) });
      return {
        items: [{
          id: 'thread_bridge',
          kind: options.kind ?? 'foreshadowing',
          revision: 1,
          status: options.status ?? 'open',
          title: '失踪的船',
          content: '船的去向仍未知。',
          sourceArtifactId: 'artifact_bridge',
          sourceHash: creativeHash({ content: '失踪的船' }),
          sourceRefs: ['source_bridge'],
        }],
        total: 1,
        nextOffset: null,
      };
    },
  };
  const app = Fastify({ logger: false });
  app.addHook('preValidation', async (request) => {
    requests.push({
      url: request.url,
      method: request.method,
      body: request.body ?? null,
    });
  });
  registerCreativeBridge(
    app,
    readConfig({ STHSTART_ADMIN_TOKEN: ADMIN_TOKEN }),
    store,
    handlers,
  );
  return {
    app,
    database,
    store,
    roles,
    workflowId: draft.id,
    workflow,
    handlers,
    proposals,
    requests,
    candidateState,
    runtimeStarts,
    contextReads,
    memoryFactsReads,
    memoryEntriesReads,
    contextState,
  };
}

async function createGrant(
  f: ReturnType<typeof fixture>,
  overrides: Partial<CreativeCreateGrant> = {},
): Promise<CreativeGrantCreated> {
  const response = await f.app.inject({
    method: 'POST',
    url: '/api/v1/creative-agent/grants',
    headers: {
      'content-type': 'application/json',
      'x-sthstart-admin-token': ADMIN_TOKEN,
    },
    payload: grantInput(overrides),
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<CreativeGrantCreated>();
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

test('grant creation reveals a token once, stores only its hash, and rejects browser/global credentials', async () => {
  const f = fixture();
  try {
    const created = await createGrant(f);
    assert.match(created.token, /^coa_[A-Za-z0-9_-]{40,}$/);
    assert.equal(created.grant.revoked, false);
    assert.ok(!JSON.stringify(created.grant).includes(created.token));
    const stored = f.database.connection.prepare(
      'SELECT * FROM co_agent_grants WHERE id=?',
    ).get(created.grant.id) as Record<string, unknown>;
    assert.equal(stored.token_hash, hashToken(created.token));
    assert.equal(stored.token, undefined);
    assert.ok(!JSON.stringify(stored).includes(created.token));

    const browser = await f.app.inject({
      method: 'GET',
      url: '/api/v1/creative-agent/runs',
      headers: { ...bearer(created.token), origin: 'http://127.0.0.1:4173' },
    });
    assert.equal(browser.statusCode, 403);
    assert.equal(browser.headers['cache-control'], 'no-store');
    assert.equal(browser.json().error, 'creative_agent_browser_forbidden');

    const globalBearer = await f.app.inject({
      method: 'GET',
      url: '/api/v1/creative-agent/runs',
      headers: bearer(ADMIN_TOKEN),
    });
    assert.equal(globalBearer.statusCode, 401);

    const malformed = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/grants',
      headers: {
        'content-type': 'application/json',
        'x-sthstart-admin-token': ADMIN_TOKEN,
      },
      payload: { ...grantInput(), token: 'must-not-be-accepted' },
    });
    assert.equal(malformed.statusCode, 400);

    const emptyScope = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/grants',
      headers: {
        'content-type': 'application/json',
        'x-sthstart-admin-token': ADMIN_TOKEN,
      },
      payload: grantInput({
        scope: { workName: '  ', worldId: null, branchId: 'branch_only', projectId: null },
      }),
    });
    assert.equal(emptyScope.statusCode, 400);
    assert.equal(emptyScope.json().error, 'creative_agent_scope_required');
  } finally {
    await f.app.close();
    f.database.close();
  }
});

test('scope subset, ownership, idempotency and cumulative grant budgets are enforced', async () => {
  const f = fixture();
  try {
    const created = await createGrant(f, {
      budget: { maxTextCalls: 2, maxImages: 1, maxTokens: 2000, maxRevisions: 1 },
    });
    const token = created.token;
    const first = runInput(f.workflowId, 'external_first');
    const start = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/runs',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      payload: first,
    });
    assert.equal(start.statusCode, 200, start.body);
    const run = start.json<CreativeRun>();
    const replay = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/runs',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      payload: first,
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json<CreativeRun>().id, run.id);
    assert.equal(
      f.database.connection.prepare('SELECT COUNT(*) AS count FROM co_runs').get()?.count,
      1,
    );
    const usage = JSON.parse(
      String((f.database.connection.prepare(
        'SELECT usage_json FROM co_agent_grants WHERE id=?',
      ).get(created.grant.id) as { usage_json: string }).usage_json),
    ) as { textCalls: number; images: number; tokens: number };
    assert.deepEqual(
      { textCalls: usage.textCalls, images: usage.images, tokens: usage.tokens },
      { textCalls: 1, images: 1, tokens: 1000 },
    );

    const overBudget = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/runs',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      payload: runInput(f.workflowId, 'external_second', {
        budget: {
          maxTextCalls: 2,
          maxImages: 0,
          maxTokens: 1000,
          maxRevisions: 1,
        },
      }),
    });
    assert.equal(overBudget.statusCode, 409);
    assert.equal(overBudget.json().error, 'creative_agent_budget_exceeded');

    const escaped = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/runs',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      payload: runInput(f.workflowId, 'external_escape', {
        scope: scopeB,
        budget: { ...budget, maxTextCalls: 1 },
      }),
    });
    assert.equal(escaped.statusCode, 403);
    assert.equal(escaped.json().error, 'creative_agent_scope_forbidden');

    const internalSameScope = f.store.startRun(
      runInput(f.workflowId, 'internal_same_scope'),
      f.roles,
    );
    const internalOtherScope = f.store.startRun(
      runInput(f.workflowId, 'internal_other_scope', { scope: scopeB }),
      f.roles,
    );
    const listed = await f.app.inject({
      method: 'GET',
      url: '/api/v1/creative-agent/runs',
      headers: bearer(token),
    });
    assert.equal(listed.statusCode, 200);
    const listedIds = listed.json<{ items: CreativeRun[] }>().items.map((entry) => entry.id);
    assert.ok(listedIds.includes(run.id));
    assert.ok(listedIds.includes(internalSameScope.id));
    assert.ok(!listedIds.includes(internalOtherScope.id));

    const unownedDetail = await f.app.inject({
      method: 'GET',
      url: `/api/v1/creative-agent/runs/${internalSameScope.id}`,
      headers: bearer(token),
    });
    assert.equal(unownedDetail.statusCode, 404);
    const ownDetail = await f.app.inject({
      method: 'GET',
      url: `/api/v1/creative-agent/runs/${run.id}`,
      headers: bearer(token),
    });
    assert.equal(ownDetail.statusCode, 200, ownDetail.body);
    assert.equal(ownDetail.json().run.id, run.id);

    const stopped = await f.app.inject({
      method: 'POST',
      url: `/api/v1/creative-agent/runs/${run.id}/stop`,
      headers: { ...bearer(token), 'content-type': 'application/json' },
      payload: {},
    });
    assert.equal(stopped.statusCode, 200, stopped.body);
    assert.equal(stopped.json<CreativeRun>().status, 'cancelled');

    const revoke = await f.app.inject({
      method: 'DELETE',
      url: `/api/v1/creative-agent/grants/${created.grant.id}`,
      headers: { 'x-sthstart-admin-token': ADMIN_TOKEN },
    });
    assert.equal(revoke.statusCode, 200, revoke.body);
    assert.equal(revoke.json().revoked, true);
    const revokeAgain = await f.app.inject({
      method: 'DELETE',
      url: `/api/v1/creative-agent/grants/${created.grant.id}`,
      headers: { 'x-sthstart-admin-token': ADMIN_TOKEN },
    });
    assert.equal(revokeAgain.statusCode, 200);
    assert.equal(revokeAgain.json().revoked, true);
    const revokedReplay = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/runs',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      payload: first,
    });
    assert.equal(revokedReplay.statusCode, 401);
    assert.equal(revokedReplay.json().error, 'creative_agent_grant_revoked');
  } finally {
    await f.app.close();
    f.database.close();
  }
});

test('permissions and proposal stay separate from execution and adoption', async () => {
  const f = fixture();
  try {
    const readOnly = await createGrant(f, { permissions: ['read'] });
    const startForbidden = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/runs',
      headers: { ...bearer(readOnly.token), 'content-type': 'application/json' },
      payload: runInput(f.workflowId, 'read_only_start'),
    });
    assert.equal(startForbidden.statusCode, 403);
    assert.equal(startForbidden.json().error, 'creative_agent_forbidden');

    const proposer = await createGrant(f, { permissions: ['read', 'propose'] });
    const context = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/context',
      headers: { ...bearer(proposer.token), 'content-type': 'application/json' },
      payload: { scope: { ...scopeA, workName: ' 作品 A ' } },
    });
    assert.equal(context.statusCode, 200, context.body);
    const contextResponse = context.json<CreativeAgentContextResponse>();
    assert.deepEqual(contextResponse.scope, scopeA);
    const { contextHash: domainContextHash, ...contextPayload } = contextResponse.context;
    assert.equal(domainContextHash, contextResponse.contextHash);
    assert.equal(contextResponse.contextHash, creativeHash(contextPayload));
    assert.equal(f.contextReads.length, 1);

    const escapedContext = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/context',
      headers: { ...bearer(proposer.token), 'content-type': 'application/json' },
      payload: { scope: scopeB },
    });
    assert.equal(escapedContext.statusCode, 403);
    assert.equal(f.contextReads.length, 1);

    const factsPayload = {
      scope: { ...scopeA, workName: ' 作品 A ' },
      query: {
        actorId: 'actor_a',
        nature: 'canon' as const,
        limit: 20,
      },
    };
    const facts = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/memory/facts',
      headers: { ...bearer(proposer.token), 'content-type': 'application/json' },
      payload: factsPayload,
    });
    assert.equal(facts.statusCode, 200, facts.body);
    assert.equal(facts.json().total, 1);
    assert.deepEqual(f.memoryFactsReads, [{
      scope: scopeA,
      query: factsPayload.query,
    }]);

    const entriesPayload = {
      scope: scopeA,
      options: {
        kind: 'foreshadowing' as const,
        status: 'open' as const,
        limit: 10,
      },
    };
    const entries = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/memory/entries',
      headers: { ...bearer(proposer.token), 'content-type': 'application/json' },
      payload: entriesPayload,
    });
    assert.equal(entries.statusCode, 200, entries.body);
    assert.equal(entries.json().total, 1);
    assert.deepEqual(f.memoryEntriesReads, [{
      scope: scopeA,
      options: entriesPayload.options,
    }]);

    const assistantDraft = f.store.createWorkflow(createCreativeConversationWorkflow());
    const assistantVersion = f.store.publishWorkflow(
      assistantDraft.id,
      assistantDraft.revision,
    );
    const runner = await createGrant(f, { permissions: ['run'] });
    const startsBeforeAssistantAttempt = f.runtimeStarts.count;
    const forbiddenAssistant = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/runs',
      headers: { ...bearer(runner.token), 'content-type': 'application/json' },
      payload: {
        ...runInput(f.workflowId, 'external_assistant_forbidden'),
        workflowId: assistantDraft.id,
        workflowVersion: assistantVersion.version,
      },
    });
    assert.equal(forbiddenAssistant.statusCode, 403, forbiddenAssistant.body);
    assert.equal(forbiddenAssistant.json().error, 'creative_agent_assistant_forbidden');
    assert.equal(f.runtimeStarts.count, startsBeforeAssistantAttempt);

    const escapedFacts = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/memory/facts',
      headers: { ...bearer(proposer.token), 'content-type': 'application/json' },
      payload: { scope: scopeB, query: {} },
    });
    assert.equal(escapedFacts.statusCode, 403);
    assert.equal(f.memoryFactsReads.length, 1);

    const invalidMemoryQuery = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/memory/facts',
      headers: { ...bearer(proposer.token), 'content-type': 'application/json' },
      payload: { scope: scopeA, query: { query: 'x'.repeat(301) } },
    });
    assert.equal(invalidMemoryQuery.statusCode, 400);
    assert.equal(invalidMemoryQuery.json().error, 'creative_agent_memory_invalid');

    const runOnly = await createGrant(f, { permissions: ['run'] });
    const runOnlyFacts = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/memory/facts',
      headers: { ...bearer(runOnly.token), 'content-type': 'application/json' },
      payload: { scope: scopeA, query: {} },
    });
    assert.equal(runOnlyFacts.statusCode, 403);
    assert.equal(runOnlyFacts.json().error, 'creative_agent_forbidden');
    assert.equal(f.memoryFactsReads.length, 1);

    f.contextState.unsafeHash = true;
    const mismatchedContext = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/context',
      headers: { ...bearer(proposer.token), 'content-type': 'application/json' },
      payload: { scope: scopeA },
    });
    assert.equal(mismatchedContext.statusCode, 502);
    assert.equal(mismatchedContext.json().error, 'creative_agent_context_hash');
    f.contextState.unsafeHash = false;

    const proposeOnly = await createGrant(f, { permissions: ['propose'] });
    const proposeOnlyContext = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/context',
      headers: { ...bearer(proposeOnly.token), 'content-type': 'application/json' },
      payload: { scope: scopeA },
    });
    assert.equal(proposeOnlyContext.statusCode, 403);

    const proposal: CreativeMessageRequest = {
      scope: scopeA,
      message: '请建议一个两级审核的故事工作流。',
    };
    const proposed = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/propose',
      headers: { ...bearer(proposer.token), 'content-type': 'application/json' },
      payload: proposal,
    });
    assert.equal(proposed.statusCode, 200, proposed.body);
    assert.equal(proposed.json<CreativeMessageResponse>().proposal?.workflowId, f.workflowId);
    assert.equal(f.proposals.length, 1);
    assert.equal(f.proposals[0].scope.workName, '作品 A');
    const aiProposal = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/propose',
      headers: { ...bearer(proposer.token), 'content-type': 'application/json' },
      payload: {
        scope: scopeA,
        message: '让总管直接替我执行。',
        mode: 'ai',
        budget: {
          maxTextCalls: 1,
          maxImages: 0,
          maxTokens: 100,
          maxRevisions: 0,
        },
        idempotencyKey: 'mcp_ai_must_not_start',
      },
    });
    assert.equal(aiProposal.statusCode, 403);
    assert.equal(aiProposal.json().error, 'creative_agent_ai_forbidden');
    assert.equal(f.proposals.length, 1);

    const proposalCannotRun = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/runs',
      headers: { ...bearer(proposer.token), 'content-type': 'application/json' },
      payload: runInput(f.workflowId, 'proposal_is_not_execution'),
    });
    assert.equal(proposalCannotRun.statusCode, 403);
    assert.equal(
      (f.database.connection.prepare('SELECT COUNT(*) AS count FROM co_runs').get() as { count: number }).count,
      0,
    );
    const readOnlyCandidate = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/candidates',
      headers: { ...bearer(readOnly.token), 'content-type': 'application/json' },
      payload: {},
    });
    assert.equal(readOnlyCandidate.statusCode, 403);

    const candidateInput = {
      idempotencyKey: 'external_candidate_1',
      scope: scopeA,
      kind: 'scene',
      content: { title: '雨夜候选', body: '尚未采用的候选场景。' },
      contextHash: contextResponse.contextHash,
    } as const;
    const candidate = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/candidates',
      headers: { ...bearer(proposer.token), 'content-type': 'application/json' },
      payload: candidateInput,
    });
    assert.equal(candidate.statusCode, 201, candidate.body);
    const receipt = candidate.json<CreativeAgentCandidateReceipt>();
    assert.equal(receipt.candidate.status, 'candidate');
    assert.equal(receipt.review.required, true);
    assert.equal(receipt.review.status, 'pending');
    assert.equal(receipt.candidate.contentHash, creativeHash(candidateInput.content));
    assert.equal(receipt.replayed, false);

    const candidateReplay = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/candidates',
      headers: { ...bearer(proposer.token), 'content-type': 'application/json' },
      payload: candidateInput,
    });
    assert.equal(candidateReplay.statusCode, 200, candidateReplay.body);
    assert.equal(candidateReplay.json<CreativeAgentCandidateReceipt>().candidate.id, receipt.candidate.id);
    assert.equal(candidateReplay.json<CreativeAgentCandidateReceipt>().replayed, true);

    const proposeOnlyCandidate = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/candidates',
      headers: { ...bearer(proposeOnly.token), 'content-type': 'application/json' },
      payload: {
        ...candidateInput,
        idempotencyKey: 'propose_only_candidate',
      },
    });
    assert.equal(proposeOnlyCandidate.statusCode, 201, proposeOnlyCandidate.body);

    const sameKeyDifferentContent = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/candidates',
      headers: { ...bearer(proposer.token), 'content-type': 'application/json' },
      payload: {
        ...candidateInput,
        content: { title: '另一个候选', body: '同一幂等键不能复用。' },
      },
    });
    assert.equal(sameKeyDifferentContent.statusCode, 409);
    assert.equal(
      sameKeyDifferentContent.json().error,
      'creative_agent_candidate_idempotency_conflict',
    );

    const hiddenExecutionFields = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/candidates',
      headers: { ...bearer(proposer.token), 'content-type': 'application/json' },
      payload: {
        ...candidateInput,
        idempotencyKey: 'candidate_with_execution_fields',
        budget,
        autoStart: true,
        status: 'approved',
      },
    });
    assert.equal(hiddenExecutionFields.statusCode, 400);

    const escapedCandidate = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/candidates',
      headers: { ...bearer(proposer.token), 'content-type': 'application/json' },
      payload: {
        ...candidateInput,
        idempotencyKey: 'candidate_scope_escape',
        scope: scopeB,
      },
    });
    assert.equal(escapedCandidate.statusCode, 403);

    const oversizedCandidate = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/candidates',
      headers: { ...bearer(proposer.token), 'content-type': 'application/json' },
      payload: {
        ...candidateInput,
        idempotencyKey: 'candidate_too_large',
        content: { body: 'x'.repeat(256 * 1024 + 1) },
      },
    });
    assert.equal(oversizedCandidate.statusCode, 413);
    assert.equal(oversizedCandidate.json().error, 'creative_agent_candidate_too_large');

    f.candidateState.unsafeReceipt = true;
    const unsafe = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/candidates',
      headers: { ...bearer(proposer.token), 'content-type': 'application/json' },
      payload: { ...candidateInput, idempotencyKey: 'external_candidate_unsafe' },
    });
    assert.equal(unsafe.statusCode, 502);
    assert.equal(unsafe.json().error, 'creative_agent_candidate_contract');
    assert.equal(f.runtimeStarts.count, 0);
    assert.equal(
      (f.database.connection.prepare('SELECT COUNT(*) AS count FROM co_runs').get() as { count: number }).count,
      0,
    );
    for (const grantId of [proposer.grant.id, proposeOnly.grant.id]) {
      const usage = JSON.parse(
        String((f.database.connection.prepare(
          'SELECT usage_json FROM co_agent_grants WHERE id=?',
        ).get(grantId) as { usage_json: string }).usage_json),
      ) as { textCalls: number; images: number; tokens: number };
      assert.deepEqual(
        { textCalls: usage.textCalls, images: usage.images, tokens: usage.tokens },
        { textCalls: 0, images: 0, tokens: 0 },
      );
    }
  } finally {
    await f.app.close();
    f.database.close();
  }
});

test('scope comparison treats null as unconstrained without relaxing other dimensions', () => {
  const constrained = {
    workName: '作品 A',
    worldId: 'world_a',
    branchId: null,
    projectId: null,
  };
  assert.equal(creativeScopeWithin(
    { workName: '作品 A', worldId: 'world_a', branchId: 'branch_a', projectId: 'project_a' },
    constrained,
  ), true);
  assert.equal(creativeScopeWithin(
    { workName: '作品 B', worldId: 'world_a', branchId: null, projectId: null },
    constrained,
  ), false);
  assert.equal(creativeScopeWithin(
    { workName: '作品 A', worldId: null, branchId: null, projectId: null },
    { ...constrained, worldId: null },
  ), true);
});

test('stdio MCP maps only scoped methods and rejects approval tools', async () => {
  const f = fixture();
  let client: Client | null = null;
  try {
    const created = await createGrant(f);
    const initialResponse = await f.app.inject({
      method: 'POST',
      url: '/api/v1/creative-agent/runs',
      headers: { ...bearer(created.token), 'content-type': 'application/json' },
      payload: runInput(f.workflowId, 'mcp_existing'),
    });
    assert.equal(initialResponse.statusCode, 200, initialResponse.body);
    const initial = initialResponse.json<CreativeRun>();
    const address = await f.app.listen({ port: 0, host: '127.0.0.1' });
    assert.match(address, /^http:\/\/127\.0\.0\.1:\d+$/);
    const childEnvironment = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    client = new Client({ name: 'creative-agent-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [
        '--import',
        import.meta.resolve('tsx/esm'),
        fileURLToPath(new URL('./mcp-server.ts', import.meta.url)),
      ],
      cwd: process.cwd(),
      env: {
        ...childEnvironment,
        STHSTART_SERVICE_URL: address,
        STHSTART_CREATIVE_AGENT_TOKEN: created.token,
      },
      stderr: 'pipe',
    }));
    const listedTools = await client.listTools();
    assert.deepEqual(
      listedTools.tools.map((entry) => entry.name).sort(),
      [
        'creative.memory.entries',
        'creative.memory.facts',
        'get_run',
        'list_runs',
        'propose_creative_run',
        'read_context',
        'start_run',
        'stop_run',
        'submit_candidate',
      ],
    );
    assert.equal(
      listedTools.tools.some((entry) => /approve|publish|grant|budget/i.test(entry.name)),
      false,
    );

    f.requests.length = 0;
    const list = await client.callTool({ name: 'list_runs', arguments: {} });
    assert.ok(!list.isError, JSON.stringify(list));
    assert.deepEqual(f.requests.at(-1), {
      url: '/api/v1/creative-agent/runs',
      method: 'GET',
      body: null,
    });

    const get = await client.callTool({ name: 'get_run', arguments: { runId: initial.id } });
    assert.ok(!get.isError, JSON.stringify(get));
    assert.deepEqual(f.requests.at(-1), {
      url: `/api/v1/creative-agent/runs/${initial.id}`,
      method: 'GET',
      body: null,
    });

    const contextArguments = { scope: scopeA };
    const context = await client.callTool({
      name: 'read_context',
      arguments: contextArguments,
    });
    assert.ok(!context.isError, JSON.stringify(context));
    assert.deepEqual(f.requests.at(-1), {
      url: '/api/v1/creative-agent/context',
      method: 'POST',
      body: contextArguments,
    });
    const contextHash = String(
      (context.structuredContent as CreativeAgentContextResponse).contextHash,
    );
    assert.match(contextHash, /^[a-f0-9]{64}$/);

    const factsArguments = {
      scope: scopeA,
      query: { actorId: 'actor_a', locationId: 'harbor', limit: 20 },
    };
    const facts = await client.callTool({
      name: 'creative.memory.facts',
      arguments: factsArguments,
    });
    assert.ok(!facts.isError, JSON.stringify(facts));
    assert.deepEqual(f.requests.at(-1), {
      url: '/api/v1/creative-agent/memory/facts',
      method: 'POST',
      body: factsArguments,
    });

    const entriesArguments = {
      scope: scopeA,
      options: { kind: 'setting', status: 'confirmed', limit: 10 },
    };
    const entries = await client.callTool({
      name: 'creative.memory.entries',
      arguments: entriesArguments,
    });
    assert.ok(!entries.isError, JSON.stringify(entries));
    assert.deepEqual(f.requests.at(-1), {
      url: '/api/v1/creative-agent/memory/entries',
      method: 'POST',
      body: entriesArguments,
    });

    const proposalArguments = {
      scope: scopeA,
      message: '建议一个先做场景、再做视觉审核的流程。',
    };
    const proposal = await client.callTool({
      name: 'propose_creative_run',
      arguments: proposalArguments,
    });
    assert.ok(!proposal.isError, JSON.stringify(proposal));
    assert.deepEqual(f.requests.at(-1), {
      url: '/api/v1/creative-agent/propose',
      method: 'POST',
      body: proposalArguments,
    });

    const candidateArguments = {
      idempotencyKey: 'mcp_candidate',
      scope: scopeA,
      kind: 'visual-brief',
      content: { sceneId: 'scene-mcp', shotPlan: ['雨夜站台', '远近景切换'] },
      contextHash,
    } as const;
    const candidate = await client.callTool({
      name: 'submit_candidate',
      arguments: candidateArguments,
    });
    assert.ok(!candidate.isError, JSON.stringify(candidate));
    assert.deepEqual(f.requests.at(-1), {
      url: '/api/v1/creative-agent/candidates',
      method: 'POST',
      body: candidateArguments,
    });

    const startArguments = runInput(f.workflowId, 'mcp_start');
    const start = await client.callTool({ name: 'start_run', arguments: startArguments });
    assert.ok(!start.isError, JSON.stringify(start));
    const started = start.structuredContent as unknown as CreativeRun;
    assert.equal(f.requests.at(-1)?.url, '/api/v1/creative-agent/runs');
    assert.equal(f.requests.at(-1)?.method, 'POST');
    assert.deepEqual(f.requests.at(-1)?.body, startArguments);

    const stop = await client.callTool({ name: 'stop_run', arguments: { runId: started.id } });
    assert.ok(!stop.isError, JSON.stringify(stop));
    assert.deepEqual(f.requests.at(-1), {
      url: `/api/v1/creative-agent/runs/${started.id}/stop`,
      method: 'POST',
      body: {},
    });

    const beforeDisallowed = f.requests.length;
    const approve = await client.callTool({ name: 'approve', arguments: {} });
    assert.equal(approve.isError, true);
    assert.equal(f.requests.length, beforeDisallowed);
  } finally {
    if (client) await client.close();
    await f.app.close();
    f.database.close();
  }
});
