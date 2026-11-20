import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type {
  CreativeRole,
  CreativeRun,
  CreativeStartRun,
  CreativeWorkflowDocument,
  CreativeWorkflowVersion,
} from '@sthstart/contracts';
import {
  migrateDatabase,
  SERVICE_DATABASE_MIGRATIONS,
  ServiceDatabase,
} from '../database.js';
import { approvalBundleHash, CreativeStore } from './store.js';

const at = '2026-11-17T00:00:00.000Z';

function testRole(): CreativeRole {
  return {
    id: 'lead_writer',
    name: '主笔',
    responsibility: '为持久层测试生成场景。',
    core: true,
    capability: 'text',
    modelId: null,
    tools: [],
    revision: 1,
  };
}

function testWorkflow(): CreativeWorkflowDocument {
  return {
    name: '持久层测试工作流',
    description: '最小可审核通用链路。',
    purpose: 'general',
    nodes: [
      {
        id: 'context', kind: 'context', label: '上下文', outputKind: 'context',
        inputs: {}, config: {}, position: { x: 0, y: 0 },
      },
      {
        id: 'write_scene', kind: 'agent', label: '撰写简报', roleId: 'lead_writer',
        outputKind: 'plan', inputs: { context: { nodeId: 'context', kind: 'context' } },
        config: { instruction: '保持设定一致。' }, position: { x: 200, y: 0 },
      },
      {
        id: 'review_brief', kind: 'agent', label: '审核简报', roleId: 'lead_writer',
        outputKind: 'review',
        inputs: { brief: { nodeId: 'write_scene', kind: 'plan' } },
        config: { instruction: '核对简报。' }, position: { x: 400, y: 70 },
      },
      {
        id: 'approve_scene', kind: 'approval', label: '人工批准', outputKind: 'decision',
        inputs: {
          brief: { nodeId: 'write_scene', kind: 'plan' },
          review: { nodeId: 'review_brief', kind: 'review' },
        },
        config: { reviewerRoleIds: ['lead_writer'] }, position: { x: 600, y: 0 },
      },
      {
        id: 'adopt_scene', kind: 'adopt', label: '交付采用', outputKind: 'result',
        inputs: { approval: { nodeId: 'approve_scene', kind: 'decision' } },
        config: {}, position: { x: 800, y: 0 },
      },
    ],
    edges: [
      { id: 'context_write', source: 'context', target: 'write_scene' },
      { id: 'write_review', source: 'write_scene', target: 'review_brief' },
      { id: 'write_approve', source: 'write_scene', target: 'approve_scene' },
      { id: 'review_approve', source: 'review_brief', target: 'approve_scene' },
      {
        id: 'approve_adopt', source: 'approve_scene', target: 'adopt_scene', when: 'approved',
      },
    ],
  };
}

function assertCode(operation: () => unknown, code: string): void {
  assert.throws(operation, (error: unknown) => (error as { code?: string }).code === code);
}

function temporaryDatabase(): ServiceDatabase {
  return new ServiceDatabase(':memory:');
}

function nodeId(version: CreativeWorkflowVersion, kind: 'agent' | 'approval'): string {
  const node = version.document.nodes.find((entry) => entry.kind === kind);
  assert.ok(node, `fixture requires one ${kind} node`);
  return node.id;
}

function runInput(
  workflowId: string,
  version: CreativeWorkflowVersion,
  idempotencyKey = 'run_key_store_001',
  budget: CreativeStartRun['budget'] = {
    maxTextCalls: 3, maxImages: 1, maxTokens: 1000, maxRevisions: 1,
  },
): CreativeStartRun {
  return {
    workflowId,
    workflowVersion: version.version,
    idempotencyKey,
    scope: {
      workName: '测试作品', worldId: null, branchId: null, projectId: null,
    },
    instruction: '生成一个可审核的测试场景。',
    budget,
    input: { request: '保持人物一致' },
  };
}

function fixture() {
  const database = temporaryDatabase();
  const store = new CreativeStore(database);
  const roles = [testRole()];
  for (const role of roles) store.saveRole(role);
  const workflow = store.createWorkflow(testWorkflow());
  const version = store.publishWorkflow(workflow.id, workflow.revision);
  const starting = runInput(workflow.id, version);
  const run = store.startRun(starting, roles);
  return { database, store, roles, workflow, version, starting, run };
}

test('migration 65 creates the orchestration schema without changing version 64 data', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('PRAGMA foreign_keys=ON');
    migrateDatabase(
      database,
      SERVICE_DATABASE_MIGRATIONS.filter((migration) => migration.version <= 64),
      'service',
    );
    const preservedKey = 'runtime_setting_preserved_before_65';
    database.prepare(
      'INSERT INTO runtime_settings(key,value_json,updated_at) VALUES (?,?,?)',
    ).run(preservedKey, '{"enabled":true}', at);
    migrateDatabase(database, SERVICE_DATABASE_MIGRATIONS, 'service');

    assert.deepEqual(
      { ...database.prepare(
        'SELECT key,value_json,updated_at FROM runtime_settings WHERE key=?',
      ).get(preservedKey)! },
      { key: preservedKey, value_json: '{"enabled":true}', updated_at: at },
    );
    assert.equal(
      database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version,
      SERVICE_DATABASE_MIGRATIONS.at(-1)!.version,
    );
    const tables = database.prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'co_%' ORDER BY name",
    ).all() as Array<{ name: string }>;
    for (const table of [
      'co_agent_grants', 'co_approvals', 'co_artifacts', 'co_conversations',
      'co_external_candidates', 'co_memory_digests', 'co_memory_entries',
      'co_memory_entry_versions', 'co_memory_facts', 'co_messages', 'co_node_runs',
      'co_roles', 'co_run_keys', 'co_run_models', 'co_runs', 'co_scene_adoptions',
      'co_scene_speculations', 'co_scope_policies', 'co_token_reservations',
      'co_workflow_versions', 'co_workflows',
    ]) {
      assert.equal(tables.some((entry) => entry.name === table), true, `${table} missing`);
    }
    assert.equal(
      database.prepare('PRAGMA quick_check').get()!.quick_check,
      'ok',
    );
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    database.close();
  }
});

test('roles and workflow drafts use CAS while only a valid graph becomes immutable version', () => {
  const f = fixture();
  try {
    assert.equal(f.store.listRoles().items.length, f.roles.length);
    const role = structuredClone(f.roles[0]);
    const updated = f.store.saveRole({ ...role, responsibility: '更新后的职责' });
    assert.equal(updated.revision, role.revision + 1);
    assertCode(
      () => f.store.saveRole({ ...role, responsibility: '过期写入' }),
      'creative_role_conflict',
    );

    const workflow = f.store.createWorkflow(testWorkflow());
    assert.equal(workflow.revision, 1);
    assert.equal(workflow.publishedVersion, 0);
    const document = structuredClone(workflow.document);
    document.name = '可保存的无效草稿';
    const saved = f.store.saveWorkflow(workflow.id, {
      expectedRevision: workflow.revision,
      document,
    });
    assert.equal(saved.revision, 2);
    assertCode(
      () => f.store.saveWorkflow(workflow.id, {
        expectedRevision: 1,
        document: { ...document, name: '过期草稿' },
      }),
      'creative_workflow_conflict',
    );

    document.nodes = document.nodes.filter((node) => node.kind !== 'approval');
    const invalid = f.store.saveWorkflow(workflow.id, {
      expectedRevision: saved.revision,
      document,
    });
    assertCode(
      () => f.store.publishWorkflow(workflow.id, invalid.revision),
      'creative_graph_invalid',
    );
    assert.equal(f.store.getWorkflow(workflow.id)?.publishedVersion, 0);

    const valid = testWorkflow();
    const fresh = f.store.createWorkflow(valid);
    const published = f.store.publishWorkflow(fresh.id, fresh.revision);
    assert.deepEqual(f.store.getVersion(fresh.id, 1), published);
    assert.match(published.contentHash, /^[a-f0-9]{64}$/);
    assert.equal(f.store.getWorkflow(fresh.id)?.publishedVersion, 1);
    assert.throws(
      () => f.database.connection.prepare(
        "UPDATE co_workflow_versions SET document_json='{}' WHERE id=?",
      ).run(published.id),
      /immutable/,
    );
    assert.equal(
      f.database.connection.prepare('PRAGMA quick_check').get()?.quick_check,
      'ok',
    );
    const domainTables = f.database.connection.prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('co_scene_adoptions','co_scene_speculations') ORDER BY name",
    ).all() as Array<{ name: string }>;
    assert.deepEqual(domainTables.map((entry) => entry.name), [
      'co_scene_adoptions', 'co_scene_speculations',
    ]);
    assert.deepEqual(f.database.connection.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    f.database.close();
  }
});

test('run creation is idempotent, leases are exclusive, and budget plus dispatch roll back together', () => {
  const f = fixture();
  try {
    const repeated = f.store.startRun(f.starting, f.roles);
    assert.deepEqual(repeated, f.run);
    assertCode(
      () => f.store.startRun({ ...f.starting, instruction: '不同请求' }, f.roles),
      'creative_run_idempotency_conflict',
    );
    const changedRoles = structuredClone(f.roles);
    changedRoles[0].responsibility = '运行开始后才修改';
    assertCode(
      () => f.store.startRun(f.starting, changedRoles),
      'creative_run_idempotency_conflict',
    );

    const node = f.store.ensureNode(
      f.run.id,
      nodeId(f.version, 'agent'),
      0,
      { prompt: '先写场景', seed: 1 },
    );
    assert.deepEqual(
      f.store.ensureNode(
        f.run.id,
        node.nodeId,
        0,
        { seed: 1, prompt: '先写场景' },
      ),
      node,
    );
    assertCode(
      () => f.store.ensureNode(
        f.run.id,
        node.nodeId,
        0,
        { prompt: '不同输入', seed: 1 },
      ),
      'creative_node_input_conflict',
    );

    const reserved = f.store.reserveBudget(f.run.id, { textCalls: 2, tokens: 10 });
    assert.deepEqual(reserved.usage, { textCalls: 2, images: 0, tokens: 10 });
    assertCode(
      () => f.store.reserveBudget(f.run.id, { images: 2 }),
      'creative_budget_exceeded',
    );
    assert.equal(f.store.getRun(f.run.id)?.usage.images, 0);

    assert.equal(f.store.claimNode(node.id, 'worker-a'), true);
    assert.equal(f.store.claimNode(node.id, 'worker-b'), false);
    assert.equal(
      f.store.detail(f.run.id).nodes.find((entry) => entry.id === node.id)?.dispatchedAt,
      null,
    );
    assert.equal(f.store.renewLease(node.id, 'worker-b'), false);
    assert.equal(f.store.renewLease(node.id, 'worker-a'), true);
    assertCode(
      () => f.store.patchNode(node.id, { status: 'running', owner: 'worker-b' }),
      'creative_node_conflict',
    );
    assertCode(
      () => f.store.atomic(() => {
        f.store.reserveBudget(f.run.id, { textCalls: 1 });
        f.store.patchNode(node.id, {
          status: 'running',
          dispatchedAt: at,
          externalTaskId: 'task-should-rollback',
          owner: 'worker-b',
        });
      }),
      'creative_node_conflict',
    );
    assert.deepEqual(f.store.getRun(f.run.id)?.usage, {
      textCalls: 2, images: 0, tokens: 10,
    });
    assert.equal(
      f.store.detail(f.run.id).nodes.find((entry) => entry.id === node.id)?.externalTaskId,
      null,
    );

    f.database.connection.prepare(
      'UPDATE co_node_runs SET lease_until=? WHERE id=?',
    ).run(Date.now() - 1, node.id);
    assert.equal(f.store.renewLease(node.id, 'worker-a'), false);
    assertCode(
      () => f.store.patchNode(node.id, {
        status: 'running',
        dispatchedAt: at,
        externalTaskId: 'stale-owner-task',
        owner: 'worker-a',
      }),
      'creative_node_conflict',
    );
    f.database.connection.prepare(
      'UPDATE co_node_runs SET lease_until=? WHERE id=?',
    ).run(Date.now() + 60_000, node.id);

    const running = f.store.patchNode(node.id, {
      status: 'running',
      dispatchedAt: at,
      externalTaskId: 'external-task',
      owner: 'worker-a',
    });
    assert.equal(running.leaseOwner, 'worker-a');
    const succeeded = f.store.patchNode(node.id, {
      status: 'succeeded',
      error: null,
      owner: 'worker-a',
    });
    assert.equal(succeeded.status, 'succeeded');
    assert.equal(succeeded.leaseOwner, null);
    assert.equal(succeeded.leaseUntil, 0);
    assert.equal(f.store.renewLease(node.id, 'worker-a'), false);

    const staleRun = f.store.getRun(f.run.id)!;
    const updatedRun = f.store.updateRun(
      f.run.id, { status: 'running' }, staleRun.revision,
    );
    assert.equal(updatedRun.revision, staleRun.revision + 1);
    assertCode(
      () => f.store.updateRun(f.run.id, { status: 'paused' }, staleRun.revision),
      'creative_run_conflict',
    );
    assert.equal(f.store.detail(f.run.id).nodes[0].status, 'succeeded');
  } finally {
    f.database.close();
  }
});

test('subworkflow depth and shared ancestor budgets fail closed before any layer is spent', () => {
  const f = fixture();
  try {
    const childA = f.store.startRun(
      runInput(f.workflow.id, f.version, 'run_child_a_001'),
      f.roles,
      f.run.id,
    );
    const childB = f.store.startRun(
      runInput(f.workflow.id, f.version, 'run_child_b_001'),
      f.roles,
      f.run.id,
    );
    assert.equal(childA.parentRunId, f.run.id);
    assert.equal(childB.parentRunId, f.run.id);

    const first = f.store.reserveBudget(childA.id, { textCalls: 2 });
    assert.equal(first.usage.textCalls, 2);
    assert.equal(f.store.getRun(f.run.id)?.usage.textCalls, 2);
    assertCode(
      () => f.store.reserveBudget(childB.id, { textCalls: 2 }),
      'creative_budget_exceeded',
    );
    assert.equal(f.store.getRun(childB.id)?.usage.textCalls, 0);
    assert.equal(f.store.getRun(f.run.id)?.usage.textCalls, 2);

    const paused = f.store.updateRun(f.run.id, { status: 'paused' });
    assertCode(
      () => f.store.reserveBudget(childA.id, { tokens: 1 }),
      'creative_ancestor_inactive',
    );
    assert.equal(f.store.getRun(childA.id)?.usage.tokens, 0);
    const resumed = f.store.updateRun(f.run.id, { status: 'running' }, paused.revision);
    const cancelled = f.store.updateRun(f.run.id, { status: 'cancelled' }, resumed.revision);
    assertCode(
      () => f.store.reserveBudget(childA.id, { tokens: 1 }),
      'creative_ancestor_inactive',
    );
    f.store.updateRun(f.run.id, { status: 'queued' }, cancelled.revision);

    let parent: CreativeRun = childA;
    for (let depth = 2; depth <= 5; depth++) {
      parent = f.store.startRun(
        runInput(f.workflow.id, f.version, `run_child_depth_${depth}`),
        f.roles,
        parent.id,
      );
    }
    assertCode(
      () => f.store.startRun(
        runInput(f.workflow.id, f.version, 'run_child_depth_6'),
        f.roles,
        parent.id,
      ),
      'creative_run_depth_exceeded',
    );

    const beforeCycle = f.store.getRun(parent.id)!.usage.tokens;
    f.database.connection.prepare('UPDATE co_runs SET parent_run_id=? WHERE id=?')
      .run(parent.id, f.run.id);
    assertCode(
      () => f.store.reserveBudget(parent.id, { tokens: 1 }),
      'creative_run_cycle',
    );
    assert.equal(f.store.getRun(parent.id)?.usage.tokens, beforeCycle);
    f.database.connection.prepare('UPDATE co_runs SET parent_run_id=NULL WHERE id=?')
      .run(f.run.id);
  } finally {
    f.database.close();
  }
});

test('node token reservations settle actual usage across the exact shared lineage', () => {
  const f = fixture();
  try {
    const child = f.store.startRun(
      runInput(
        f.workflow.id,
        f.version,
        'run_token_settlement_child',
        { maxTextCalls: 4, maxImages: 1, maxTokens: 1000, maxRevisions: 1 },
      ),
      f.roles,
      f.run.id,
    );
    const settledNode = f.store.ensureNode(child.id, 'context', 0, { call: 'settled' });
    f.store.reserveNodeBudget(child.id, settledNode.id, { textCalls: 1, tokens: 300 });
    let reservation = f.store.getTokenReservation(settledNode.id);
    assert.deepEqual(reservation?.lineage, [child.id, f.run.id]);
    assert.equal(reservation?.state, 'reserved');
    assert.equal(f.store.getRun(child.id)?.usage.tokens, 300);
    assert.equal(f.store.getRun(f.run.id)?.usage.tokens, 300);

    reservation = f.store.settleTokenUsage(child.id, settledNode.id, 300, 120);
    assert.equal(reservation.state, 'settled');
    assert.equal(reservation.actual, 120);
    assert.equal(f.store.getRun(child.id)?.usage.tokens, 120);
    assert.equal(f.store.getRun(f.run.id)?.usage.tokens, 120);
    assertCode(
      () => f.store.settleTokenUsage(child.id, settledNode.id, 300, 120),
      'creative_token_reservation_settled',
    );

    const unknownNode = f.store.ensureNode(child.id, 'context', 1, { call: 'unknown' });
    f.store.reserveNodeBudget(child.id, unknownNode.id, { textCalls: 1, tokens: 200 });
    assert.equal(f.store.getRun(child.id)?.usage.tokens, 320);
    reservation = f.store.settleTokenUsage(child.id, unknownNode.id, 200, null);
    assert.equal(reservation.state, 'unknown');
    assert.equal(reservation.actual, null);
    assert.equal(f.store.getRun(child.id)?.usage.tokens, 320);
    assert.equal(f.store.getRun(f.run.id)?.usage.tokens, 320);

    const overflowNode = f.store.ensureNode(child.id, 'context', 2, { call: 'overflow' });
    const childBefore = f.store.getRun(child.id)!;
    const parentBefore = f.store.getRun(f.run.id)!;
    assertCode(
      () => f.store.reserveNodeBudget(child.id, overflowNode.id, { tokens: 1000 }),
      'creative_budget_exceeded',
    );
    assert.equal(f.store.getTokenReservation(overflowNode.id), null);
    assert.deepEqual(f.store.getRun(child.id)?.usage, childBefore.usage);
    assert.deepEqual(f.store.getRun(f.run.id)?.usage, parentBefore.usage);

    const overageNode = f.store.ensureNode(child.id, 'context', 3, { call: 'overage' });
    f.store.reserveNodeBudget(child.id, overageNode.id, { textCalls: 1, tokens: 100 });
    reservation = f.store.settleTokenUsage(child.id, overageNode.id, 100, 150);
    assert.equal(reservation.state, 'overage');
    assert.equal(reservation.actual, 150);
    assert.equal(f.store.getRun(child.id)?.usage.tokens, 470);
    assert.equal(f.store.getRun(f.run.id)?.usage.tokens, 470);
    assertCode(
      () => f.store.reserveBudget(child.id, { tokens: 1 }),
      'creative_token_overage',
    );
  } finally {
    f.database.close();
  }
});

test('verified speculative scene parents stop shared budgets while invalid references remain subflows', () => {
  const f = fixture();
  try {
    const producer = f.store.ensureNode(
      f.run.id,
      nodeId(f.version, 'agent'),
      0,
      { source: 'speculative-parent' },
    );
    const candidate = f.store.putArtifact(
      producer.id,
      'scene',
      { title: '待审场景', body: '供下一场景预写。' },
      [],
    );
    const speculativeStart = runInput(
      f.workflow.id,
      f.version,
      'run_speculative_child_001',
    );
    speculativeStart.input = { candidateArtifactId: candidate.id };
    const speculativeChild = f.store.startRun(
      speculativeStart,
      f.roles,
      f.run.id,
    );
    const parentCompleted = f.store.updateRun(f.run.id, { status: 'completed' });

    const reserved = f.store.reserveBudget(speculativeChild.id, { textCalls: 2, tokens: 30 });
    assert.deepEqual(reserved.usage, { textCalls: 2, images: 0, tokens: 30 });
    assert.deepEqual(f.store.getRun(f.run.id)?.usage, {
      textCalls: 0, images: 0, tokens: 0,
    });

    const paused = f.store.updateRun(
      f.run.id,
      { status: 'paused' },
      parentCompleted.revision,
    );
    assertCode(
      () => f.store.reserveBudget(speculativeChild.id, { tokens: 1 }),
      'creative_ancestor_inactive',
    );
    assert.equal(f.store.getRun(speculativeChild.id)?.usage.tokens, 30);
    f.store.updateRun(f.run.id, { status: 'completed' }, paused.revision);

    f.store.setArtifactStatus(candidate.id, 'stale');
    assertCode(
      () => f.store.reserveBudget(speculativeChild.id, { tokens: 1 }),
      'creative_candidate_stale',
    );
    assert.equal(f.store.getRun(speculativeChild.id)?.usage.tokens, 30);

    const review = f.store.putArtifact(
      producer.id,
      'review',
      { verdict: 'approved' },
      [],
    );
    const mismatchedStart = runInput(
      f.workflow.id,
      f.version,
      'run_speculative_invalid_001',
    );
    mismatchedStart.input = { candidateArtifactId: review.id };
    const invalidReference = f.store.startRun(
      mismatchedStart,
      f.roles,
      f.run.id,
    );
    assertCode(
      () => f.store.reserveBudget(invalidReference.id, { tokens: 1 }),
      'creative_ancestor_inactive',
    );
    assert.equal(f.store.getRun(invalidReference.id)?.usage.tokens, 0);

    const unrelatedStart = runInput(
      f.workflow.id,
      f.version,
      'run_speculative_unrelated_parent_001',
    );
    const unrelated = f.store.startRun(unrelatedStart, f.roles);
    const unrelatedNode = f.store.ensureNode(
      unrelated.id,
      nodeId(f.version, 'agent'),
      0,
      { source: 'unrelated' },
    );
    const unrelatedScene = f.store.putArtifact(
      unrelatedNode.id,
      'scene',
      { title: '别的父运行', body: '不能冒认。' },
      [],
    );
    const foreignStart = runInput(
      f.workflow.id,
      f.version,
      'run_speculative_foreign_001',
    );
    foreignStart.input = { candidateArtifactId: unrelatedScene.id };
    const foreignReference = f.store.startRun(
      foreignStart,
      f.roles,
      f.run.id,
    );
    assertCode(
      () => f.store.reserveBudget(foreignReference.id, { tokens: 1 }),
      'creative_ancestor_inactive',
    );
    assert.equal(f.store.getRun(foreignReference.id)?.usage.tokens, 0);
  } finally {
    f.database.close();
  }
});

test('subworkflow child creation and parent external-task binding commit as one dispatch unit', () => {
  const f = fixture();
  try {
    const dispatchNode = f.store.ensureNode(
      f.run.id,
      'context',
      0,
      { childWorkflowId: f.workflow.id },
    );
    assert.equal(f.store.claimNode(dispatchNode.id, 'subflow-worker'), true);
    const initialRunCount = f.store.listRuns().items.length;
    const child = f.store.atomic(() => {
      f.store.reserveBudget(f.run.id, {});
      const created = f.store.startRun(
        runInput(f.workflow.id, f.version, 'run_child_atomic_001'),
        f.roles,
        f.run.id,
      );
      f.store.patchNode(dispatchNode.id, {
        owner: 'subflow-worker',
        status: 'waiting',
        dispatchedAt: at,
        externalTaskId: created.id,
      });
      return created;
    });
    assert.equal(child.parentRunId, f.run.id);
    assert.deepEqual(child.usage, { textCalls: 0, images: 0, tokens: 0 });
    assert.equal(f.store.listRuns().items.length, initialRunCount + 1);
    const waiting = f.store.detail(f.run.id).nodes.find((node) => node.id === dispatchNode.id)!;
    assert.equal(waiting.status, 'waiting');
    assert.equal(waiting.externalTaskId, child.id);
    assert.equal(waiting.dispatchedAt, at);

    const orphan = f.store.ensureNode(
      f.run.id,
      'context',
      1,
      { childWorkflowId: f.workflow.id },
    );
    assertCode(
      () => f.store.atomic(() => {
        f.store.reserveBudget(f.run.id, {});
        const rolledBack = f.store.startRun(
          runInput(f.workflow.id, f.version, 'run_child_atomic_rollback'),
          f.roles,
          f.run.id,
        );
        f.store.patchNode(orphan.id, {
          owner: 'wrong-worker',
          status: 'waiting',
          externalTaskId: rolledBack.id,
        });
      }),
      'creative_node_conflict',
    );
    assert.equal(f.store.listRuns().items.length, initialRunCount + 1);
    assert.equal(
      f.database.connection.prepare(
        'SELECT COUNT(*) AS count FROM co_run_keys WHERE idempotency_key=?',
      ).get('run_child_atomic_rollback')!.count,
      0,
    );
  } finally {
    f.database.close();
  }
});

test('artifact hashes are canonical and immutable, and stale dependencies recursively invalidate approval', () => {
  const f = fixture();
  try {
    const producer = f.store.ensureNode(
      f.run.id,
      nodeId(f.version, 'agent'),
      0,
      { source: 'base' },
    );
    const approvalNode = f.store.ensureNode(
      f.run.id,
      nodeId(f.version, 'approval'),
      0,
      { awaiting: true },
    );
    const base = f.store.putArtifact(producer.id, 'scene', { title: '场景', body: '正文' }, []);
    assert.deepEqual(
      f.store.putArtifact(producer.id, 'scene', { body: '正文', title: '场景' }, []),
      base,
    );
    assert.match(base.contentHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(f.store.getArtifact(base.id), base);
    assert.equal(f.store.getNodeRun(producer.id)?.id, producer.id);
    assert.throws(
      () => f.database.connection.prepare(
        "UPDATE co_artifacts SET content_json='{\"changed\":true}' WHERE id=?",
      ).run(base.id),
      /immutable/,
    );
    assertCode(
      () => f.store.putArtifact(producer.id, 'review', { issue: 'missing source' }, ['missing']),
      'creative_artifact_dependency_missing',
    );
    const dependent = f.store.putArtifact(
      approvalNode.id,
      'review',
      { summary: '依赖基础场景' },
      [base.id],
    );
    const approval = f.store.requestApproval(approvalNode.id, [dependent.id]);
    assert.equal(approval.status, 'pending');
    assert.equal(approval.revision, 1);
    assert.match(approval.bundleHash, /^[a-f0-9]{64}$/);
    assert.equal(approvalBundleHash([dependent]), approval.bundleHash);
    assert.deepEqual(f.store.requestApproval(approvalNode.id, [dependent.id]), approval);

    assertCode(
      () => f.store.decideApproval(approval.id, {
        expectedRevision: approval.revision,
        bundleHash: '0'.repeat(64),
        decision: 'approve',
        comment: '错误指纹',
      }),
      'creative_approval_hash_conflict',
    );
    assert.equal(f.store.getApproval(approval.id)?.status, 'pending');

    f.store.setArtifactStatus(base.id, 'stale');
    assert.equal(
      f.store.detail(f.run.id).artifacts.find((entry) => entry.id === dependent.id)?.status,
      'stale',
    );
    assert.equal(f.store.getApproval(approval.id)?.status, 'stale');
    assertCode(
      () => f.store.decideApproval(approval.id, {
        expectedRevision: approval.revision,
        bundleHash: approval.bundleHash,
        decision: 'approve',
        comment: '旧审核',
      }),
      'creative_approval_conflict',
    );
    assert.deepEqual(f.database.connection.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    f.database.close();
  }
});

test('human approval checks revision and bundle hash and cannot be reused', () => {
  const f = fixture();
  try {
    const producer = f.store.ensureNode(
      f.run.id,
      nodeId(f.version, 'agent'),
      0,
      { prompt: 'review me' },
    );
    const approvalNode = f.store.ensureNode(
      f.run.id,
      nodeId(f.version, 'approval'),
      0,
      { candidate: true },
    );
    const parentArtifact = f.store.putArtifact(
      producer.id,
      'scene',
      { title: '来源场景', body: '上一场景正文' },
      [],
    );
    const artifact = f.store.putArtifact(
      approvalNode.id,
      'scene',
      { title: '候选场景', body: '完整正文' },
      [parentArtifact.id],
    );
    const approval = f.store.requestApproval(approvalNode.id, [artifact.id]);
    assertCode(
      () => f.store.decideApproval(approval.id, {
        expectedRevision: approval.revision + 1,
        bundleHash: approval.bundleHash,
        decision: 'approve',
        comment: '过期修订',
      }),
      'creative_approval_conflict',
    );
    const approved = f.store.decideApproval(approval.id, {
      expectedRevision: approval.revision,
      bundleHash: approval.bundleHash,
      decision: 'approve',
      comment: '人工看过，可以交付。',
    });
    assert.equal(approved.status, 'approved');
    assert.equal(approved.revision, approval.revision + 1);
    assert.equal(approved.comment, '人工看过，可以交付。');
    assert.ok(approved.decidedAt);
    assertCode(
      () => f.store.decideApproval(approval.id, {
        expectedRevision: approved.revision,
        bundleHash: approved.bundleHash,
        decision: 'reject',
        comment: '重复决定',
      }),
      'creative_approval_conflict',
    );
    assert.equal(f.store.getApproval(approval.id)?.status, 'approved');
    f.store.setArtifactStatus(parentArtifact.id, 'superseded');
    assert.equal(
      f.store.detail(f.run.id).artifacts.find((entry) => entry.id === artifact.id)?.status,
      'stale',
    );
    assert.equal(f.store.getApproval(approval.id)?.status, 'stale');
  } finally {
    f.database.close();
  }
});
