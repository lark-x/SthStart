import { createHash, randomUUID } from 'node:crypto';
import type { TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  CreativeDecisionSchema,
  CreativeRoleSchema,
  CreativeStartRunSchema,
  CreativeWorkflowDocumentSchema,
  type CreativeApproval,
  type CreativeArtifact,
  type CreativeBudget,
  type CreativeDecision,
  type CreativeNodeRun,
  type CreativePayloadKind,
  type CreativeRole,
  type CreativeRun,
  type CreativeRunDetail,
  type CreativeStartRun,
  type CreativeWorkflow,
  type CreativeWorkflowDocument,
  type CreativeWorkflowVersion,
} from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import { validateCreativeGraph } from './graph.js';

type Row = Record<string, unknown>;
type SqlValue = string | number | null;
type NodeStatus = CreativeNodeRun['status'];
type ArtifactStatus = CreativeArtifact['status'];
type RunStatus = CreativeRun['status'];
type Usage = CreativeRun['usage'];
type TokenReservationState = 'reserved' | 'settled' | 'unknown' | 'overage';

const NODE_STATUSES: readonly NodeStatus[] = [
  'pending', 'running', 'waiting', 'succeeded', 'skipped', 'failed', 'uncertain',
];
const RUN_STATUSES: readonly RunStatus[] = [
  'queued', 'running', 'waiting_approval', 'paused', 'uncertain', 'completed', 'failed', 'cancelled',
];
const ARTIFACT_STATUSES: readonly ArtifactStatus[] = ['candidate', 'accepted', 'superseded', 'stale'];
const PAYLOAD_KINDS: readonly CreativePayloadKind[] = [
  'context', 'plan', 'scene', 'review', 'visual-brief', 'image-prompt', 'image', 'decision', 'result',
];
const MAX_RUN_DEPTH = 5;
const DISPATCH_BLOCKED_ANCESTOR_STATUSES: readonly RunStatus[] = [
  'paused', 'uncertain', 'failed', 'cancelled',
];

export type CreativeNodePatch = Partial<Pick<
  CreativeNodeRun,
  'status' | 'outputArtifactId' | 'externalTaskId' | 'dispatchedAt' | 'error' | 'leaseOwner' | 'leaseUntil'
>> & {
  expectedRevision?: number;
  owner?: string;
};

export interface CreativeTokenReservation {
  nodeRunId: string;
  runId: string;
  reserved: number;
  actual: number | null;
  lineage: string[];
  state: TokenReservationState;
  createdAt: string;
  settledAt: string | null;
}

export class CreativeStoreError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'CreativeStoreError';
  }
}

export function fail(code: string, statusCode: number, message: string): never {
  throw new CreativeStoreError(code, statusCode, message);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function creativeHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalValue(value))).digest('hex');
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function parse<T>(value: unknown): T {
  return JSON.parse(String(value)) as T;
}

function assertSchema<T>(schema: TSchema, value: unknown, code: string, label: string): asserts value is T {
  if (Value.Check(schema, value)) return;
  const first = [...Value.Errors(schema, value)][0];
  fail(code, 400, `${label} ${first?.path ?? '/'} 格式错误：${first?.message ?? '不符合契约'}`);
}

function uniqueIds(values: readonly string[], code: string, label: string): string[] {
  if (values.some((value) => !value)) fail(code, 400, `${label}包含空 ID。`);
  if (new Set(values).size !== values.length) fail(code, 400, `${label}包含重复 ID。`);
  return [...values];
}

function isTerminalNode(status: NodeStatus): boolean {
  return status === 'waiting' || status === 'succeeded' || status === 'skipped'
    || status === 'failed' || status === 'uncertain';
}

function roleFromRow(row: Row): CreativeRole {
  return { ...parse<CreativeRole>(row.data_json), revision: Number(row.revision) };
}

function workflowFromRow(row: Row): CreativeWorkflow {
  return {
    id: String(row.id),
    revision: Number(row.revision),
    publishedVersion: Number(row.published_version),
    document: parse<CreativeWorkflowDocument>(row.document_json),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function versionFromRow(row: Row): CreativeWorkflowVersion {
  return {
    id: String(row.id),
    version: Number(row.version),
    document: parse<CreativeWorkflowDocument>(row.document_json),
    contentHash: String(row.content_hash),
    createdAt: String(row.created_at),
  };
}

function runFromRow(row: Row): CreativeRun {
  return {
    id: String(row.id),
    workflowId: String(row.workflow_id),
    workflowVersion: Number(row.workflow_version),
    revision: Number(row.revision),
    status: row.status as RunStatus,
    scope: parse(row.scope_json),
    instruction: String(row.instruction),
    budget: parse<CreativeBudget>(row.budget_json),
    usage: parse(row.usage_json),
    roleSnapshot: parse<CreativeRole[]>(row.role_snapshot_json),
    input: parse(row.input_json),
    parentRunId: row.parent_run_id == null ? null : String(row.parent_run_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    error: row.error == null ? null : String(row.error),
  };
}

function nodeRunFromRow(row: Row): CreativeNodeRun {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    nodeId: String(row.node_id),
    attempt: Number(row.attempt),
    status: row.status as NodeStatus,
    input: parse(row.input_json),
    outputArtifactId: row.output_artifact_id == null ? null : String(row.output_artifact_id),
    externalTaskId: row.external_task_id == null ? null : String(row.external_task_id),
    traceId: String(row.trace_id),
    dispatchedAt: row.dispatched_at == null ? null : String(row.dispatched_at),
    error: row.error == null ? null : String(row.error),
    leaseOwner: row.lease_owner == null ? null : String(row.lease_owner),
    leaseUntil: Number(row.lease_until),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function artifactFromRow(row: Row): CreativeArtifact {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    nodeRunId: String(row.node_run_id),
    kind: row.kind as CreativePayloadKind,
    content: parse(row.content_json),
    contentHash: String(row.content_hash),
    dependencyIds: parse<string[]>(row.dependency_ids_json),
    status: row.status as ArtifactStatus,
    createdAt: String(row.created_at),
  };
}

function approvalFromRow(row: Row): CreativeApproval {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    nodeRunId: String(row.node_run_id),
    artifactIds: parse<string[]>(row.artifact_ids_json),
    bundleHash: String(row.bundle_hash),
    revision: Number(row.revision),
    status: row.status as CreativeApproval['status'],
    comment: String(row.comment),
    createdAt: String(row.created_at),
    decidedAt: row.decided_at == null ? null : String(row.decided_at),
  };
}

function tokenReservationFromRow(row: Row): CreativeTokenReservation {
  return {
    nodeRunId: String(row.node_run_id),
    runId: String(row.run_id),
    reserved: Number(row.reserved),
    actual: row.actual == null ? null : Number(row.actual),
    lineage: parse<string[]>(row.lineage_json),
    state: row.state as TokenReservationState,
    createdAt: String(row.created_at),
    settledAt: row.settled_at == null ? null : String(row.settled_at),
  };
}

export function approvalBundleHash(artifacts: readonly CreativeArtifact[]): string {
  return creativeHash(artifacts.map((artifact) => ({
    id: artifact.id,
    kind: artifact.kind,
    contentHash: artifact.contentHash,
    dependencyIds: [...artifact.dependencyIds].sort(),
  })).sort((left, right) => left.id.localeCompare(right.id)));
}

/**
 * Durable state for the independent creative orchestration domain. Formal
 * Story, StoryWorld and Generation writes are performed by separate adapters
 * and never by this store.
 */
export class CreativeStore {
  private savepointSeed = 0;

  constructor(readonly database: ServiceDatabase) {}

  private get(sql: string, ...args: SqlValue[]): Row | undefined {
    return this.database.connection.prepare(sql).get(...args) as Row | undefined;
  }

  private all(sql: string, ...args: SqlValue[]): Row[] {
    return this.database.connection.prepare(sql).all(...args) as Row[];
  }

  private run(sql: string, ...args: SqlValue[]) {
    return this.database.connection.prepare(sql).run(...args);
  }

  atomic<T>(operation: () => T): T {
    if (this.database.connection.isTransaction) {
      const name = `co_atomic_${++this.savepointSeed}`;
      this.database.connection.exec(`SAVEPOINT ${name}`);
      try {
        const result = operation();
        this.database.connection.exec(`RELEASE ${name}`);
        return result;
      } catch (error) {
        this.database.connection.exec(`ROLLBACK TO ${name}`);
        this.database.connection.exec(`RELEASE ${name}`);
        throw error;
      }
    }
    return this.database.transaction(operation);
  }

  private runLineage(runId: string): Row[] {
    const lineage: Row[] = [];
    const visited = new Set<string>();
    let current = this.get('SELECT * FROM co_runs WHERE id=?', runId);
    if (!current) fail('creative_run_not_found', 404, '创作运行不存在。');
    while (current) {
      const id = String(current.id);
      if (visited.has(id)) fail('creative_run_cycle', 409, '运行父子关系存在循环。');
      visited.add(id);
      lineage.push(current);
      if (lineage.length > MAX_RUN_DEPTH + 1) {
        fail('creative_run_depth_exceeded', 409, `子流程最多允许 ${MAX_RUN_DEPTH} 层。`);
      }
      const parentRunId = current.parent_run_id == null ? null : String(current.parent_run_id);
      if (!parentRunId) break;
      current = this.get('SELECT * FROM co_runs WHERE id=?', parentRunId);
      if (!current) fail('creative_run_parent_missing', 409, `父运行 ${parentRunId} 不存在。`);
    }
    return lineage;
  }

  private speculativeParentArtifact(descendant: Row, parent: Row): CreativeArtifact | null {
    const input = parse<Record<string, unknown>>(descendant.input_json);
    const candidateArtifactId = input.candidateArtifactId;
    if (typeof candidateArtifactId !== 'string' || !candidateArtifactId) return null;
    const row = this.get('SELECT * FROM co_artifacts WHERE id=?', candidateArtifactId);
    if (!row || String(row.run_id) !== String(parent.id) || row.kind !== 'scene') return null;
    return artifactFromRow(row);
  }

  listRoles(): { items: CreativeRole[] } {
    return {
      items: this.all(
        "SELECT * FROM co_roles ORDER BY json_extract(data_json,'$.core') DESC,"
        + "json_extract(data_json,'$.name'),id",
      )
        .map(roleFromRow),
    };
  }

  saveRole(input: CreativeRole): CreativeRole {
    assertSchema<CreativeRole>(CreativeRoleSchema, input, 'creative_role_invalid', '岗位');
    const current = this.get('SELECT * FROM co_roles WHERE id=?', input.id);
    const now = nowIso();
    if (!current) {
      if (input.revision !== 1) {
        fail('creative_role_conflict', 409, '新岗位必须从 revision 1 开始。');
      }
      const saved = structuredClone(input);
      this.run(
        'INSERT INTO co_roles(id,revision,data_json,created_at,updated_at) VALUES (?,?,?,?,?)',
        saved.id, 1, JSON.stringify(saved), now, now,
      );
      return saved;
    }
    if (Number(current.revision) !== input.revision) {
      fail('creative_role_conflict', 409, '岗位定义已更新，请刷新后重试。');
    }
    const saved = { ...structuredClone(input), revision: input.revision + 1 };
    const changed = this.run(
      'UPDATE co_roles SET revision=?,data_json=?,updated_at=? WHERE id=? AND revision=?',
      saved.revision, JSON.stringify(saved), now, saved.id, input.revision,
    );
    if (changed.changes !== 1) fail('creative_role_conflict', 409, '岗位定义已更新，请刷新后重试。');
    return saved;
  }

  listWorkflows(): { items: CreativeWorkflow[] } {
    return {
      items: this.all('SELECT * FROM co_workflows ORDER BY updated_at DESC,id').map(workflowFromRow),
    };
  }

  createWorkflow(document: CreativeWorkflowDocument): CreativeWorkflow {
    assertSchema<CreativeWorkflowDocument>(
      CreativeWorkflowDocumentSchema, document, 'creative_workflow_invalid', '工作流草稿',
    );
    const id = randomUUID();
    const now = nowIso();
    const saved = structuredClone(document);
    this.run(
      `INSERT INTO co_workflows
        (id,revision,published_version,document_json,created_at,updated_at)
       VALUES (?,1,0,?,?,?)`,
      id, JSON.stringify(saved), now, now,
    );
    return this.getWorkflow(id)!;
  }

  saveWorkflow(
    id: string,
    input: { expectedRevision: number; document: CreativeWorkflowDocument },
  ): CreativeWorkflow {
    assertSchema<CreativeWorkflowDocument>(
      CreativeWorkflowDocumentSchema, input.document, 'creative_workflow_invalid', '工作流草稿',
    );
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
      fail('creative_workflow_invalid', 400, 'expectedRevision 必须是正整数。');
    }
    const changed = this.run(
      `UPDATE co_workflows SET document_json=?,revision=revision+1,updated_at=?
       WHERE id=? AND revision=?`,
      JSON.stringify(canonicalValue(input.document)), nowIso(), id, input.expectedRevision,
    );
    if (changed.changes !== 1) fail('creative_workflow_conflict', 409, '工作流草稿已更新，请刷新后重试。');
    return this.getWorkflow(id)!;
  }

  publishWorkflow(id: string, expectedRevision: number): CreativeWorkflowVersion {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      fail('creative_workflow_invalid', 400, 'expectedRevision 必须是正整数。');
    }
    return this.atomic(() => {
      const row = this.get('SELECT * FROM co_workflows WHERE id=?', id);
      if (!row) fail('creative_workflow_not_found', 404, '工作流不存在。');
      if (Number(row.revision) !== expectedRevision) {
        fail('creative_workflow_conflict', 409, '工作流草稿已更新，请刷新后重试。');
      }
      const document = parse<CreativeWorkflowDocument>(row.document_json);
      const validation = validateCreativeGraph(document);
      if (!validation.valid) {
        const error = new Error(validation.issues.map((entry) => `${entry.code}: ${entry.message}`).join('；'));
        Object.assign(error, { code: 'creative_graph_invalid', validation });
        throw error;
      }
      const version = Number(row.published_version) + 1;
      const versionId = randomUUID();
      const now = nowIso();
      this.run(
        `INSERT INTO co_workflow_versions
          (id,workflow_id,version,document_json,content_hash,created_at)
         VALUES (?,?,?,?,?,?)`,
        versionId, id, version, canonicalJson(document), creativeHash(document), now,
      );
      const changed = this.run(
        `UPDATE co_workflows
         SET revision=revision+1,published_version=?,updated_at=?
         WHERE id=? AND revision=?`,
        version, now, id, expectedRevision,
      );
      if (changed.changes !== 1) fail('creative_workflow_conflict', 409, '工作流草稿已更新，请刷新后重试。');
      return this.getVersion(id, version)!;
    });
  }

  getWorkflow(id: string): CreativeWorkflow | null {
    const row = this.get('SELECT * FROM co_workflows WHERE id=?', id);
    return row ? workflowFromRow(row) : null;
  }

  getVersion(id: string, version: number): CreativeWorkflowVersion | null {
    const row = this.get(
      'SELECT * FROM co_workflow_versions WHERE workflow_id=? AND version=?',
      id, version,
    );
    return row ? versionFromRow(row) : null;
  }

  startRun(
    input: CreativeStartRun,
    roleSnapshot: CreativeRole[],
    parentRunId?: string,
  ): CreativeRun {
    assertSchema<CreativeStartRun>(CreativeStartRunSchema, input, 'creative_run_invalid', '运行请求');
    for (const [index, role] of roleSnapshot.entries()) {
      assertSchema<CreativeRole>(
        CreativeRoleSchema, role, 'creative_run_invalid', `岗位快照 ${index + 1}`,
      );
    }
    if (parentRunId !== undefined && !parentRunId) {
      fail('creative_run_invalid', 400, 'parentRunId 不能为空。');
    }
    const snapshot = roleSnapshot.map((role) => structuredClone(role));
    const payloadHash = creativeHash({
      input,
      roleSnapshot: snapshot,
      parentRunId: parentRunId ?? null,
    });
    return this.atomic(() => {
      const key = this.get('SELECT * FROM co_run_keys WHERE idempotency_key=?', input.idempotencyKey);
      if (key) {
        if (key.request_hash !== payloadHash) {
          fail('creative_run_idempotency_conflict', 409, '同一提交键对应了不同的运行请求。');
        }
        const existing = this.getRun(String(key.run_id));
        if (!existing) fail('creative_run_not_found', 500, '幂等键指向的运行不存在。');
        return existing;
      }
      if (!this.getVersion(input.workflowId, input.workflowVersion)) {
        fail('creative_workflow_version_not_found', 404, '指定的已发布工作流版本不存在。');
      }
      if (parentRunId) {
        const parentLineage = this.runLineage(parentRunId);
        if (parentLineage.length > MAX_RUN_DEPTH) {
          fail('creative_run_depth_exceeded', 409, `子流程最多允许 ${MAX_RUN_DEPTH} 层。`);
        }
      }
      const id = randomUUID();
      const now = nowIso();
      this.run(
        `INSERT INTO co_runs
          (id,workflow_id,workflow_version,revision,status,scope_json,instruction,
           budget_json,usage_json,role_snapshot_json,input_json,parent_run_id,
           idempotency_key,request_hash,error,created_at,updated_at)
         VALUES (?,?,?,1,'queued',?,?,?,?,?,?,?,?,?,NULL,?,?)`,
        id, input.workflowId, input.workflowVersion, JSON.stringify(input.scope),
        input.instruction, JSON.stringify(input.budget),
        JSON.stringify({ textCalls: 0, images: 0, tokens: 0 }),
        JSON.stringify(snapshot), JSON.stringify(canonicalValue(input.input)),
        parentRunId ?? null, input.idempotencyKey, payloadHash, now, now,
      );
      this.run(
        'INSERT INTO co_run_keys(idempotency_key,request_hash,run_id,created_at) VALUES (?,?,?,?)',
        input.idempotencyKey, payloadHash, id, now,
      );
      return this.getRun(id)!;
    });
  }

  getRun(id: string): CreativeRun | null {
    const row = this.get('SELECT * FROM co_runs WHERE id=?', id);
    return row ? runFromRow(row) : null;
  }

  listRuns(): { items: CreativeRun[] } {
    return { items: this.all('SELECT * FROM co_runs ORDER BY created_at DESC,id').map(runFromRow) };
  }

  detail(id: string): CreativeRunDetail {
    const run = this.getRun(id);
    if (!run) fail('creative_run_not_found', 404, '创作运行不存在。');
    return {
      run,
      nodes: this.all(
        'SELECT * FROM co_node_runs WHERE run_id=? ORDER BY created_at,node_id,attempt,id',
        id,
      ).map(nodeRunFromRow),
      artifacts: this.all(
        'SELECT * FROM co_artifacts WHERE run_id=? ORDER BY created_at,id',
        id,
      ).map(artifactFromRow),
      approvals: this.all(
        'SELECT * FROM co_approvals WHERE run_id=? ORDER BY created_at,id',
        id,
      ).map(approvalFromRow),
    };
  }

  updateRun(
    id: string,
    patch: Partial<Pick<CreativeRun, 'status' | 'error'>>,
    expectedRevision?: number,
  ): CreativeRun {
    if (patch.status !== undefined && !RUN_STATUSES.includes(patch.status)) {
      fail('creative_run_invalid', 400, '运行状态无效。');
    }
    if (expectedRevision !== undefined
      && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) {
      fail('creative_run_invalid', 400, 'expectedRevision 必须是正整数。');
    }
    return this.atomic(() => {
      const current = this.get('SELECT * FROM co_runs WHERE id=?', id);
      if (!current) fail('creative_run_not_found', 404, '创作运行不存在。');
      const expected = expectedRevision ?? Number(current.revision);
      const changed = this.run(
        `UPDATE co_runs SET status=?,error=?,revision=revision+1,updated_at=?
         WHERE id=? AND revision=?`,
        patch.status ?? String(current.status),
        patch.error === undefined ? (current.error == null ? null : String(current.error)) : patch.error,
        nowIso(), id, expected,
      );
      if (changed.changes !== 1) fail('creative_run_conflict', 409, '创作运行已更新，请刷新后重试。');
      return this.getRun(id)!;
    });
  }

  ensureNode(
    runId: string,
    nodeId: string,
    attempt: number,
    input: Record<string, unknown>,
  ): CreativeNodeRun {
    if (!nodeId || !Number.isInteger(attempt) || attempt < 0 || !input || typeof input !== 'object' || Array.isArray(input)) {
      fail('creative_node_invalid', 400, '节点、attempt 或输入格式无效。');
    }
    const inputJson = canonicalJson(input);
    const inputHash = creativeHash(input);
    return this.atomic(() => {
      const runRow = this.get('SELECT * FROM co_runs WHERE id=?', runId);
      if (!runRow) fail('creative_run_not_found', 404, '创作运行不存在。');
      const version = this.getVersion(
        String(runRow.workflow_id), Number(runRow.workflow_version),
      );
      if (!version) fail('creative_workflow_version_not_found', 404, '运行固定的工作流版本不存在。');
      if (!version.document.nodes.some((node) => node.id === nodeId)) {
        fail('creative_node_not_found', 404, `工作流版本中不存在节点 ${nodeId}。`);
      }
      const existing = this.get(
        'SELECT * FROM co_node_runs WHERE run_id=? AND node_id=? AND attempt=?',
        runId, nodeId, attempt,
      );
      if (existing) {
        if (existing.input_hash !== inputHash) {
          fail('creative_node_input_conflict', 409, '同一节点尝试对应了不同输入。');
        }
        return nodeRunFromRow(existing);
      }
      const id = randomUUID();
      const now = nowIso();
      this.run(
        `INSERT INTO co_node_runs
          (id,run_id,node_id,attempt,revision,status,input_json,input_hash,
           output_artifact_id,external_task_id,trace_id,dispatched_at,error,
           lease_owner,lease_until,created_at,updated_at)
         VALUES (?,?,?,?,1,'pending',?,?,NULL,NULL,?,NULL,NULL,NULL,0,?,?)`,
        id, runId, nodeId, attempt, inputJson, inputHash, randomUUID(), now, now,
      );
      return nodeRunFromRow(this.get('SELECT * FROM co_node_runs WHERE id=?', id)!);
    });
  }

  getNodeRun(id: string): CreativeNodeRun | null {
    const row = this.get('SELECT * FROM co_node_runs WHERE id=?', id);
    return row ? nodeRunFromRow(row) : null;
  }

  claimNode(id: string, owner: string, leaseMs = 60_000): boolean {
    if (!owner || !Number.isFinite(leaseMs) || leaseMs <= 0) return false;
    const nowMs = Date.now();
    const now = nowIso();
    return this.run(
      `UPDATE co_node_runs
       SET status='running',revision=revision+1,lease_owner=?,lease_until=?,updated_at=?
       WHERE id=? AND status='pending'`,
      owner, nowMs + leaseMs, now, id,
    ).changes === 1;
  }

  renewLease(id: string, owner: string, leaseMs = 60_000): boolean {
    if (!owner || !Number.isFinite(leaseMs) || leaseMs <= 0) return false;
    return this.run(
      `UPDATE co_node_runs SET lease_until=?,updated_at=?
       WHERE id=? AND lease_owner=? AND status='running' AND lease_until>?`,
      Date.now() + leaseMs, nowIso(), id, owner, Date.now(),
    ).changes === 1;
  }

  patchNode(id: string, patch: CreativeNodePatch): CreativeNodeRun {
    if (patch.status !== undefined && !NODE_STATUSES.includes(patch.status)) {
      fail('creative_node_invalid', 400, '节点状态无效。');
    }
    if (patch.leaseUntil !== undefined && !Number.isInteger(patch.leaseUntil)) {
      fail('creative_node_invalid', 400, 'leaseUntil 必须是非负整数。');
    }
    return this.atomic(() => {
      const current = this.get('SELECT * FROM co_node_runs WHERE id=?', id);
      if (!current) fail('creative_node_not_found', 404, '节点运行不存在。');
      const expectedRevision = patch.expectedRevision ?? Number(current.revision);
      if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
        fail('creative_node_invalid', 400, 'expectedRevision 必须是正整数。');
      }
      const nowMs = Date.now();
      if (patch.owner !== undefined
        && (String(current.lease_owner ?? '') !== patch.owner
          || Number(current.lease_until) <= nowMs)) {
        fail('creative_node_conflict', 409, '节点执行租约不属于当前执行者或已经过期。');
      }
      if (patch.outputArtifactId) {
        const artifact = this.get('SELECT run_id FROM co_artifacts WHERE id=?', patch.outputArtifactId);
        if (!artifact || artifact.run_id !== current.run_id) {
          fail('creative_artifact_not_found', 409, '输出产物不属于当前运行。');
        }
      }
      const nextStatus = patch.status ?? current.status as NodeStatus;
      const clearLease = isTerminalNode(nextStatus)
        && patch.leaseOwner === undefined && patch.leaseUntil === undefined;
      const whereOwner = patch.owner === undefined ? '' : ' AND lease_owner=? AND lease_until>?';
      const args: SqlValue[] = [
        nextStatus,
        patch.outputArtifactId === undefined
          ? (current.output_artifact_id == null ? null : String(current.output_artifact_id))
          : patch.outputArtifactId,
        patch.externalTaskId === undefined
          ? (current.external_task_id == null ? null : String(current.external_task_id))
          : patch.externalTaskId,
        patch.dispatchedAt === undefined
          ? (current.dispatched_at == null ? null : String(current.dispatched_at))
          : patch.dispatchedAt,
        patch.error === undefined ? (current.error == null ? null : String(current.error)) : patch.error,
        clearLease ? null : (
          patch.leaseOwner === undefined
            ? (current.lease_owner == null ? null : String(current.lease_owner))
            : patch.leaseOwner
        ),
        clearLease ? 0 : (patch.leaseUntil ?? Number(current.lease_until)),
        nowIso(),
        id,
        expectedRevision,
      ];
      if (patch.owner !== undefined) args.push(patch.owner, nowMs);
      const changed = this.run(
        `UPDATE co_node_runs
         SET status=?,output_artifact_id=?,external_task_id=?,dispatched_at=?,
             error=?,lease_owner=?,lease_until=?,revision=revision+1,updated_at=?
         WHERE id=? AND revision=?${whereOwner}`,
        ...args,
      );
      if (changed.changes !== 1) fail('creative_node_conflict', 409, '节点运行已更新，请刷新后重试。');
      return nodeRunFromRow(this.get('SELECT * FROM co_node_runs WHERE id=?', id)!);
    });
  }

  private budgetLineage(runId: string): Row[] {
    const lineage = this.runLineage(runId);
    const budgetLineage: Row[] = [lineage[0]];
    let descendant = lineage[0];
    for (const ancestor of lineage.slice(1)) {
      const candidate = this.speculativeParentArtifact(descendant, ancestor);
      if (candidate && (candidate.status === 'stale' || candidate.status === 'superseded')) {
        fail('creative_candidate_stale', 409, '预写依赖的候选版本已失效。');
      }
      if (DISPATCH_BLOCKED_ANCESTOR_STATUSES.includes(ancestor.status as RunStatus)) {
        fail(
          'creative_ancestor_inactive',
          409,
          `父运行 ${String(ancestor.id)} 当前为 ${String(ancestor.status)}，不能继续派发子任务。`,
        );
      }
      if (ancestor.status === 'completed' && !candidate) {
        fail(
          'creative_ancestor_inactive',
          409,
          `父运行 ${String(ancestor.id)} 当前为 completed，不能继续派发子任务。`,
        );
      }
      // A verified scene candidate makes this edge a speculative reference,
      // not a shared-budget subworkflow edge. Runtime stops at the same edge.
      if (candidate) break;
      budgetLineage.push(ancestor);
      descendant = ancestor;
    }
    return budgetLineage;
  }

  private assertNoTokenOverage(lineage: readonly Row[]): void {
    const runIds = new Set(lineage.map((row) => String(row.id)));
    for (const row of this.all("SELECT * FROM co_token_reservations WHERE state='overage'")) {
      if (parse<string[]>(row.lineage_json).some((id) => runIds.has(id))) {
        fail(
          'creative_token_overage',
          409,
          '共享预算链存在已确认的 token 超额使用，禁止继续派发。',
        );
      }
    }
  }

  private applyBudgetDelta(
    lineage: readonly Row[],
    delta: Partial<Usage>,
  ): CreativeRun {
    this.assertNoTokenOverage(lineage);
    const plans = lineage.map((row) => {
      const budget = parse<CreativeBudget>(row.budget_json);
      const usage = parse<Usage>(row.usage_json);
      const next: Usage = {
        textCalls: usage.textCalls + (delta.textCalls ?? 0),
        images: usage.images + (delta.images ?? 0),
        tokens: usage.tokens + (delta.tokens ?? 0),
      };
      if (next.textCalls > budget.maxTextCalls || next.images > budget.maxImages
        || next.tokens > budget.maxTokens) {
        fail(
          'creative_budget_exceeded',
          409,
          `本次调用会超过运行 ${String(row.id)} 的额度，已拒绝。`,
        );
      }
      return { row, next };
    });
    const now = nowIso();
    for (const plan of plans) {
      const changed = this.run(
        `UPDATE co_runs SET usage_json=?,revision=revision+1,updated_at=?
         WHERE id=? AND revision=?`,
        JSON.stringify(plan.next), now, String(plan.row.id), Number(plan.row.revision),
      );
      if (changed.changes !== 1) {
        fail('creative_run_conflict', 409, '创作运行已更新，请刷新后重试。');
      }
    }
    return this.getRun(String(lineage[0].id))!;
  }

  reserveBudget(
    runId: string,
    delta: Partial<Usage>,
  ): CreativeRun {
    for (const [key, value] of Object.entries(delta)) {
      if (!['textCalls', 'images', 'tokens'].includes(key)
        || !Number.isInteger(value) || value < 0) {
        fail('creative_budget_invalid', 400, '预算增量必须是非负整数。');
      }
    }
    return this.atomic(() => {
      return this.applyBudgetDelta(this.budgetLineage(runId), delta);
    });
  }

  reserveNodeBudget(
    runId: string,
    nodeRunId: string,
    delta: Partial<Usage>,
  ): CreativeRun {
    for (const [key, value] of Object.entries(delta)) {
      if (!['textCalls', 'images', 'tokens'].includes(key)
        || !Number.isInteger(value) || value < 0) {
        fail('creative_budget_invalid', 400, '预算增量必须是非负整数。');
      }
    }
    return this.atomic(() => {
      const node = this.get('SELECT run_id FROM co_node_runs WHERE id=?', nodeRunId);
      if (!node) fail('creative_node_not_found', 404, '节点运行不存在。');
      if (String(node.run_id) !== runId) {
        fail('creative_budget_invalid', 409, '节点运行不属于指定创作运行。');
      }
      const reserved = delta.tokens ?? 0;
      if (reserved > 0
        && this.get('SELECT 1 FROM co_token_reservations WHERE node_run_id=?', nodeRunId)) {
        fail('creative_token_reservation_conflict', 409, '该节点尝试已经建立 token reservation。');
      }
      const lineage = this.budgetLineage(runId);
      const run = this.applyBudgetDelta(lineage, delta);
      if (reserved > 0) {
        const now = nowIso();
        this.run(
          `INSERT INTO co_token_reservations
            (node_run_id,run_id,reserved,actual,lineage_json,state,created_at,settled_at)
           VALUES (?,?,?,NULL,?,'reserved',?,NULL)`,
          nodeRunId, runId, reserved, JSON.stringify(lineage.map((row) => String(row.id))), now,
        );
      }
      return run;
    });
  }

  getTokenReservation(nodeRunId: string): CreativeTokenReservation | null {
    const row = this.get('SELECT * FROM co_token_reservations WHERE node_run_id=?', nodeRunId);
    return row ? tokenReservationFromRow(row) : null;
  }

  settleTokenUsage(
    runId: string,
    nodeRunId: string,
    reserved: number,
    actual: number | null,
  ): CreativeTokenReservation {
    if (!Number.isInteger(reserved) || reserved < 1
      || (actual !== null && (!Number.isInteger(actual) || actual < 0))) {
      fail('creative_token_settlement_invalid', 400, 'token reservation 或实际用量无效。');
    }
    return this.atomic(() => {
      const row = this.get('SELECT * FROM co_token_reservations WHERE node_run_id=?', nodeRunId);
      if (!row) fail('creative_token_reservation_not_found', 404, 'token reservation 不存在。');
      const reservation = tokenReservationFromRow(row);
      if (reservation.runId !== runId) {
        fail('creative_token_reservation_conflict', 409, 'token reservation 不属于指定运行。');
      }
      if (reservation.reserved !== reserved) {
        fail('creative_token_reservation_conflict', 409, 'token reservation 上限不一致。');
      }
      if (reservation.state !== 'reserved') {
        fail('creative_token_reservation_settled', 409, 'token reservation 已经结算。');
      }
      const now = nowIso();
      if (actual !== null && actual !== reserved) {
        const difference = actual > reserved ? actual - reserved : reserved - actual;
        for (const lineageRunId of reservation.lineage) {
          const runRow = this.get('SELECT * FROM co_runs WHERE id=?', lineageRunId);
          if (!runRow) fail('creative_run_parent_missing', 409, `reservation 运行 ${lineageRunId} 不存在。`);
          const usage = parse<Usage>(runRow.usage_json);
          const tokens = actual > reserved
            ? usage.tokens + difference
            : usage.tokens - difference;
          if (tokens < 0) {
            fail('creative_token_settlement_invalid', 409, 'token reservation 回归账本出现负 usage。');
          }
          const changed = this.run(
            `UPDATE co_runs SET usage_json=?,revision=revision+1,updated_at=?
             WHERE id=? AND revision=?`,
            JSON.stringify({ ...usage, tokens }), now, lineageRunId, Number(runRow.revision),
          );
          if (changed.changes !== 1) {
            fail('creative_run_conflict', 409, '创作运行已更新，请刷新后重试。');
          }
        }
      }
      const state: TokenReservationState = actual === null ? 'unknown'
        : actual > reserved ? 'overage' : 'settled';
      this.run(
        `UPDATE co_token_reservations
         SET actual=?,state=?,settled_at=? WHERE node_run_id=? AND state='reserved'`,
        actual, state, now, nodeRunId,
      );
      return this.getTokenReservation(nodeRunId)!;
    });
  }

  putArtifact(
    nodeRunId: string,
    kind: CreativePayloadKind,
    content: Record<string, unknown>,
    dependencyIds: string[],
  ): CreativeArtifact {
    if (!PAYLOAD_KINDS.includes(kind)) fail('creative_artifact_invalid', 400, '产物类型无效。');
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      fail('creative_artifact_invalid', 400, '产物内容必须是 JSON 对象。');
    }
    const dependencies = uniqueIds(dependencyIds, 'creative_artifact_invalid', '依赖');
    dependencies.sort((left, right) => left.localeCompare(right));
    const contentJson = canonicalJson(content);
    const contentHash = creativeHash(content);
    const dependencyHash = creativeHash(dependencies);
    return this.atomic(() => {
      const node = this.get('SELECT * FROM co_node_runs WHERE id=?', nodeRunId);
      if (!node) fail('creative_node_not_found', 404, '节点运行不存在。');
      for (const dependencyId of dependencies) {
        if (!this.get('SELECT id FROM co_artifacts WHERE id=?', dependencyId)) {
          fail('creative_artifact_dependency_missing', 409, `依赖产物 ${dependencyId} 不存在。`);
        }
      }
      const existing = this.get(
        `SELECT * FROM co_artifacts
         WHERE node_run_id=? AND kind=? AND content_hash=? AND dependency_hash=?`,
        nodeRunId, kind, contentHash, dependencyHash,
      );
      if (existing) return artifactFromRow(existing);
      const id = randomUUID();
      const now = nowIso();
      this.run(
        `INSERT INTO co_artifacts
          (id,run_id,node_run_id,kind,content_json,content_hash,
           dependency_ids_json,dependency_hash,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,'candidate',?,?)`,
        id, String(node.run_id), nodeRunId, kind, contentJson, contentHash,
        JSON.stringify(dependencies), dependencyHash, now, now,
      );
      return artifactFromRow(this.get('SELECT * FROM co_artifacts WHERE id=?', id)!);
    });
  }

  getArtifact(id: string): CreativeArtifact | null {
    const row = this.get('SELECT * FROM co_artifacts WHERE id=?', id);
    return row ? artifactFromRow(row) : null;
  }

  setArtifactStatus(id: string, status: ArtifactStatus): CreativeArtifact {
    if (!ARTIFACT_STATUSES.includes(status)) fail('creative_artifact_invalid', 400, '产物状态无效。');
    return this.atomic(() => {
      const target = this.get('SELECT * FROM co_artifacts WHERE id=?', id);
      if (!target) fail('creative_artifact_not_found', 404, '产物不存在。');
      this.run('UPDATE co_artifacts SET status=?,updated_at=? WHERE id=?', status, nowIso(), id);
      const affectedRuns = new Set<string>([String(target.run_id)]);
      if (status === 'stale' || status === 'superseded') {
        const rows = this.all('SELECT * FROM co_artifacts');
        const dependents = new Map<string, Row[]>();
        for (const row of rows) {
          for (const dependencyId of parse<string[]>(row.dependency_ids_json)) {
            const list = dependents.get(dependencyId) ?? [];
            list.push(row);
            dependents.set(dependencyId, list);
          }
        }
        const queue = [id];
        const visited = new Set<string>();
        while (queue.length) {
          const dependencyId = queue.shift()!;
          for (const dependent of dependents.get(dependencyId) ?? []) {
            const dependentId = String(dependent.id);
            if (visited.has(dependentId)) continue;
            visited.add(dependentId);
            affectedRuns.add(String(dependent.run_id));
            if (dependent.status !== 'stale') {
              this.run(
                "UPDATE co_artifacts SET status='stale',updated_at=? WHERE id=?",
                nowIso(), dependentId,
              );
            }
            queue.push(dependentId);
          }
        }
      }
      this.staleInvalidApprovals(affectedRuns);
      return artifactFromRow(this.get('SELECT * FROM co_artifacts WHERE id=?', id)!);
    });
  }

  requestApproval(nodeRunId: string, artifactIds: string[]): CreativeApproval {
    const ids = [...new Set(uniqueIds(artifactIds, 'creative_approval_invalid', '审核产物'))]
      .sort((left, right) => left.localeCompare(right));
    if (!ids.length) fail('creative_approval_invalid', 400, '人工审核至少需要一个产物。');
    return this.atomic(() => {
      const node = this.get('SELECT * FROM co_node_runs WHERE id=?', nodeRunId);
      if (!node) fail('creative_node_not_found', 404, '审核节点运行不存在。');
      const artifacts = ids.map((artifactId) => {
        const row = this.get('SELECT * FROM co_artifacts WHERE id=?', artifactId);
        if (!row || row.run_id !== node.run_id) {
          fail('creative_approval_invalid', 409, `审核产物 ${artifactId} 不属于当前运行。`);
        }
        return artifactFromRow(row);
      });
      const bundleHash = approvalBundleHash(artifacts);
      const samePending = this.get(
        `SELECT * FROM co_approvals
         WHERE node_run_id=? AND status='pending' AND bundle_hash=?
         ORDER BY created_at DESC,rowid DESC LIMIT 1`,
        nodeRunId, bundleHash,
      );
      if (samePending) return approvalFromRow(samePending);
      this.run(
        `UPDATE co_approvals SET status='stale',revision=revision+1
         WHERE node_run_id=? AND status='pending'`,
        nodeRunId,
      );
      const previous = this.get(
        'SELECT MAX(revision) AS revision FROM co_approvals WHERE node_run_id=?',
        nodeRunId,
      );
      const revision = Number(previous?.revision ?? 0) + 1;
      const id = randomUUID();
      const now = nowIso();
      this.run(
        `INSERT INTO co_approvals
          (id,run_id,node_run_id,artifact_ids_json,bundle_hash,revision,status,
           comment,created_at,decided_at)
         VALUES (?,?,?,?,?,?,'pending','',?,NULL)`,
        id, String(node.run_id), nodeRunId, JSON.stringify(ids), bundleHash, revision, now,
      );
      return this.getApproval(id)!;
    });
  }

  decideApproval(id: string, input: CreativeDecision): CreativeApproval {
    assertSchema<CreativeDecision>(
      CreativeDecisionSchema, input, 'creative_approval_invalid', '人工决定',
    );
    const outcome = this.atomic(() => {
      const row = this.get('SELECT * FROM co_approvals WHERE id=?', id);
      if (!row) fail('creative_approval_not_found', 404, '人工确认记录不存在。');
      const approval = approvalFromRow(row);
      if (approval.status !== 'pending') {
        fail('creative_approval_conflict', 409, '该人工确认已处理或已失效。');
      }
      if (approval.revision !== input.expectedRevision) {
        fail('creative_approval_conflict', 409, '人工确认记录已更新，请刷新后重试。');
      }
      if (approval.bundleHash !== input.bundleHash) {
        fail('creative_approval_hash_conflict', 409, '确认内容与当前待审版本不一致。');
      }
      const artifacts = approval.artifactIds.map((artifactId) => {
        const artifact = this.get('SELECT * FROM co_artifacts WHERE id=?', artifactId);
        return artifact ? artifactFromRow(artifact) : null;
      });
      const invalidDependency = artifacts.some((artifact) =>
        !artifact || this.artifactOrDependencyStale(artifact)
      );
      if (invalidDependency || artifacts.some((artifact) => !artifact)
        || approvalBundleHash(artifacts.filter((artifact): artifact is CreativeArtifact => Boolean(artifact)))
          !== approval.bundleHash) {
        this.run(
          "UPDATE co_approvals SET status='stale',revision=revision+1 WHERE id=? AND status='pending'",
          id,
        );
        return { approval: this.getApproval(id)!, conflict: 'creative_approval_stale' as const };
      }
      const status = input.decision === 'approve' ? 'approved' : 'rejected';
      const changed = this.run(
        `UPDATE co_approvals
         SET status=?,comment=?,revision=revision+1,decided_at=?
         WHERE id=? AND status='pending' AND revision=?`,
        status, input.comment, nowIso(), id, input.expectedRevision,
      );
      if (changed.changes !== 1) {
        fail('creative_approval_conflict', 409, '人工确认记录已更新，请刷新后重试。');
      }
      return { approval: this.getApproval(id)!, conflict: null };
    });
    if (outcome.conflict) {
      fail(outcome.conflict, 409, '审核绑定的产物或依赖已失效，请重新发起人工确认。');
    }
    return outcome.approval;
  }

  getApproval(id: string): CreativeApproval | null {
    const row = this.get('SELECT * FROM co_approvals WHERE id=?', id);
    return row ? approvalFromRow(row) : null;
  }

  private artifactOrDependencyStale(artifact: CreativeArtifact): boolean {
    const rows = this.all('SELECT * FROM co_artifacts');
    const byId = new Map(rows.map((row) => [String(row.id), row]));
    const queue = [artifact.id];
    const visited = new Set<string>();
    while (queue.length) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      const row = byId.get(currentId);
      if (!row || row.status === 'stale' || row.status === 'superseded') return true;
      queue.push(...parse<string[]>(row.dependency_ids_json));
    }
    return false;
  }

  private staleInvalidApprovals(runIds: ReadonlySet<string>): void {
    if (!runIds.size) return;
    const placeholders = [...runIds].map(() => '?').join(',');
    const rows = this.all(
      `SELECT * FROM co_approvals
       WHERE status IN ('pending','approved') AND run_id IN (${placeholders})`,
      ...[...runIds],
    );
    for (const row of rows) {
      const approval = approvalFromRow(row);
      const artifacts = approval.artifactIds.map((artifactId) => {
        const artifact = this.get('SELECT * FROM co_artifacts WHERE id=?', artifactId);
        return artifact ? artifactFromRow(artifact) : null;
      });
      const invalid = artifacts.some((artifact) => !artifact || this.artifactOrDependencyStale(artifact))
        || approvalBundleHash(
          artifacts.filter((artifact): artifact is CreativeArtifact => Boolean(artifact)),
        ) !== approval.bundleHash;
      if (invalid) {
        this.run(
          `UPDATE co_approvals
           SET status='stale',revision=revision+1
           WHERE id=? AND status IN ('pending','approved')`,
          approval.id,
        );
      }
    }
  }
}
