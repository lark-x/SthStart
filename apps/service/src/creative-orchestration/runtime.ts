import { randomUUID } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import {
  CreativeReviewSchema,
  type CreativeApproval, type CreativeArtifact, type CreativeNode,
  type CreativeNodeRun, type CreativeReview, type CreativeRun,
  type CreativeRunDetail, type CreativeWorkflowDocument,
} from '@sthstart/contracts';
import { CreativeStore, approvalBundleHash, creativeHash, fail } from './store.js';
import { assertValidCreativeGraph } from './graph.js';

export interface CreativeArtifactInput {
  artifactId: string;
  contentHash: string;
  kind: CreativeArtifact['kind'];
  content: Record<string, unknown>;
  dependencyIds: string[];
  status: CreativeArtifact['status'];
}
export interface CreativeRevisionFeedback {
  previousTarget: CreativeArtifactInput;
  reviews: CreativeArtifactInput[];
  number: number;
}
export interface CreativeExecutionContext {
  run: CreativeRun;
  node: CreativeNode;
  nodeRun: CreativeNodeRun;
  inputs: Record<string, CreativeArtifactInput>;
  signal: AbortSignal;
  revision?: CreativeRevisionFeedback;
  approval?: CreativeApproval;
  artifacts?: CreativeArtifact[];
  /** Call synchronously immediately before dispatch, never for a status poll. */
  markDispatched(delta: Partial<CreativeRun['usage']>, externalTaskId?: string): void;
  /** Settle only trustworthy provider usage; null retains the conservative reservation. */
  settleTokenUsage(actual: number | null): void;
}
export interface CreativeExecutor {
  context?(context: CreativeExecutionContext): Promise<Record<string, unknown>>;
  agent?(context: CreativeExecutionContext): Promise<Record<string, unknown>>;
  tool?(context: CreativeExecutionContext): Promise<Record<string, unknown>>;
  adopt?(context: CreativeExecutionContext): Promise<Record<string, unknown>>;
  /** Only server-owned policy may implement this; a model result is not policy. */
  autoApprove?(context: CreativeExecutionContext, approval: CreativeApproval): boolean | Promise<boolean>;
}
export class CreativePendingExecution extends Error {
  constructor(readonly externalTaskId: string, message = '外部任务仍在执行。') { super(message); }
}
export class CreativeNotDispatchedError extends Error {}
export class CreativeDefiniteFailureError extends Error {}
export class CreativeOutputRejectedError extends Error {
  constructor(message: string, readonly output?: Record<string, unknown>) { super(message); }
}
export interface CreativeRuntimeOptions { pollIntervalMs?: number; leaseMs?: number; maxParallel?: number }
interface RevisionRequest {
  attempts: Record<string, number>;
  targetNodeId: string;
  feedback: CreativeRevisionFeedback;
}
const terminalRun = new Set<CreativeRun['status']>(['completed', 'failed', 'cancelled']);
const envelope = (artifact: CreativeArtifact): CreativeArtifactInput => ({
  artifactId: artifact.id, contentHash: artifact.contentHash, kind: artifact.kind,
  content: artifact.content, dependencyIds: artifact.dependencyIds, status: artifact.status,
});
const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 8000);
const isLive = (artifact: CreativeArtifact) => artifact.status !== 'stale' && artifact.status !== 'superseded';

/** Persistent DAG execution. All retries are explicit graph revisions or audited recovery. */
export class CreativeRuntime {
  private readonly owner = randomUUID();
  private readonly leaseMs: number;
  private readonly maxParallel: number;
  private readonly intervalMs: number;
  private timer?: ReturnType<typeof setInterval>;
  private closing = false;
  private readonly active = new Map<string, Promise<void>>();
  private readonly controllers = new Map<string, { runId: string; controller: AbortController }>();
  private readonly heartbeats = new Map<string, ReturnType<typeof setInterval>>();

  constructor(readonly store: CreativeStore, readonly executor: CreativeExecutor, options: CreativeRuntimeOptions = {}) {
    this.leaseMs = Math.max(30, options.leaseMs ?? 60_000);
    this.maxParallel = Math.max(1, Math.min(16, options.maxParallel ?? 4));
    this.intervalMs = Math.max(20, options.pollIntervalMs ?? 1000);
  }
  start(): void {
    if (this.closing || this.timer) return;
    this.timer = setInterval(() => this.wake(), this.intervalMs);
    this.timer.unref();
    this.wake();
  }
  wake(runId?: string): void { void this.tick(runId).catch(() => { /* Per-run errors are persisted by tick. */ }); }
  async tick(runId?: string): Promise<void> {
    if (this.closing) return;
    const ids = runId ? [runId] : this.store.listRuns().items.filter(run => !terminalRun.has(run.status)).map(run => run.id);
    await Promise.all(ids.map(id => {
      const active = this.active.get(id);
      if (active) return active;
      const operation = this.executeRun(id).catch(error => {
        const run = this.store.getRun(id);
        if (run && !terminalRun.has(run.status) && run.status !== 'paused' && run.status !== 'uncertain') {
          this.store.updateRun(id, { status: 'failed', error: errorText(error) });
        }
      }).finally(() => this.active.delete(id));
      this.active.set(id, operation);
      return operation;
    }));
  }
  async drain(runId: string): Promise<CreativeRunDetail> { await this.tick(runId); return this.store.detail(runId); }
  pause(id: string, expectedRevision?: number): CreativeRun {
    const run = this.requireRun(id);
    if (terminalRun.has(run.status)) fail('creative_run_state', 409, '已结束的运行不能暂停。');
    return this.store.updateRun(id, { status: 'paused' }, expectedRevision);
  }
  resume(id: string, expectedRevision?: number): CreativeRun {
    const run = this.requireRun(id);
    const ownUnknown = this.store.detail(id).nodes.some(node => node.status === 'uncertain');
    const children = this.store.listRuns().items.filter(child => child.parentRunId === id);
    if (run.status !== 'paused' && !(run.status === 'uncertain' && !ownUnknown)) fail('creative_run_state', 409, '运行必须暂停或已完成子流程核对后才能继续。');
    if (children.some(child => child.status === 'uncertain')) fail('creative_run_state', 409, '请先核对子流程中状态不明的请求。');
    const next = this.store.atomic(() => {
      const updated = this.store.updateRun(id, { status: ownUnknown ? 'uncertain' : 'queued', error: null }, expectedRevision);
      for (const child of children) if (child.status === 'paused') this.store.updateRun(child.id, { status: 'queued', error: null });
      return updated;
    });
    this.wake(id);
    return next;
  }
  cancel(id: string, expectedRevision?: number): CreativeRun {
    const run = this.requireRun(id);
    if (terminalRun.has(run.status)) fail('creative_run_state', 409, '运行已经结束。');
    // In-flight operations are allowed to report their result. No further dispatch is allowed.
    return this.store.atomic(() => {
      const cancelled = this.store.updateRun(id, { status: 'cancelled' }, expectedRevision);
      const descendants = new Set([id]);
      const runs = this.store.listRuns().items;
      for (let pass = 0; pass < 6; pass++) for (const child of runs) {
        if (child.parentRunId && descendants.has(child.parentRunId) && !descendants.has(child.id)) {
          descendants.add(child.id);
          if (!terminalRun.has(child.status)) this.store.updateRun(child.id, { status: 'cancelled', error: '父运行已取消。' });
        }
      }
      return cancelled;
    });
  }
  recover(id: string, nodeRunId: string, input: {
    expectedRevision: number; resolution: 'not_executed' | 'result_received'; note: string; output?: Record<string, unknown>;
  }): CreativeRun {
    if (!input.note.trim()) fail('creative_recovery_invalid', 400, '恢复必须记录外部核对依据。');
    return this.store.atomic(() => {
      const detail = this.store.detail(id);
      if (detail.run.revision !== input.expectedRevision) fail('creative_run_conflict', 409, '运行已更新。');
      if (detail.run.status !== 'uncertain') fail('creative_run_state', 409, '只有状态不明的运行可以人工核对恢复。');
      const nodeRun = detail.nodes.find(node => node.id === nodeRunId);
      if (!nodeRun || nodeRun.status !== 'uncertain') fail('creative_recovery_invalid', 409, '该节点无需核对恢复。');
      const node = this.document(detail.run).nodes.find(node => node.id === nodeRun.nodeId)!;
      if (input.resolution === 'result_received') {
        if (!input.output) fail('creative_recovery_invalid', 400, '已收到结果时必须提供完整产物。');
        if (node.kind === 'adopt') fail('creative_recovery_invalid', 409, '正式采用需要业务存储核对，不能以手填结果代替。');
        this.validateOutput(node, input.output, this.savedInputs(nodeRun), detail);
        const artifact = this.store.putArtifact(nodeRun.id, node.outputKind, input.output, this.dependencyIds(nodeRun));
        this.store.patchNode(nodeRun.id, { status: 'succeeded', outputArtifactId: artifact.id, error: `人工核对：${input.note}` });
      } else {
        this.store.patchNode(nodeRun.id, {
          status: 'skipped', leaseOwner: null, leaseUntil: 0,
          error: `人工确认未执行：${input.note}`,
        });
        const attempt = Math.max(...detail.nodes.filter(item => item.nodeId === nodeRun.nodeId).map(item => item.attempt)) + 1;
        this.store.ensureNode(id, nodeRun.nodeId, attempt, {
          ...nodeRun.input, __runtimeRecovery: { supersedes: nodeRun.id, note: input.note },
        });
      }
      const remains = this.store.detail(id).nodes.some(candidate => candidate.status === 'uncertain');
      return this.store.updateRun(id, { status: remains ? 'uncertain' : 'paused', error: null });
    });
  }
  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    for (const heartbeat of this.heartbeats.values()) clearInterval(heartbeat);
    this.heartbeats.clear();
    const activeRunIds = new Set<string>();
    for (const { controller, runId } of this.controllers.values()) {
      activeRunIds.add(runId);
      controller.abort(new Error('调度器正在关闭。'));
    }
    // Do not wait indefinitely for providers ignoring AbortSignal. Retain dispatch evidence.
    // An injected database is owned by its caller, who may have already closed it.
    if (this.store.database.connection.isOpen === false) return;
    for (const runId of activeRunIds) {
      const detail = this.store.detail(runId);
      let unknown = false;
      for (const node of detail.nodes) {
        if (node.status !== 'running' || node.leaseOwner !== this.owner) continue;
        unknown ||= node.dispatchedAt !== null;
        this.store.patchNode(node.id, {
          status: node.dispatchedAt ? 'uncertain' : 'pending', leaseOwner: null, leaseUntil: 0,
          error: node.dispatchedAt ? '执行期间服务关闭；必须核对外部请求结果。' : null,
        });
      }
      if (unknown && !terminalRun.has(detail.run.status) && detail.run.status !== 'paused') {
        this.store.updateRun(detail.run.id, { status: 'uncertain', error: '服务关闭时仍有已派发请求。' });
      }
    }
  }
  private requireRun(id: string): CreativeRun {
    const run = this.store.getRun(id);
    if (!run) fail('creative_run_not_found', 404, '运行不存在。');
    return run;
  }
  private document(run: CreativeRun): CreativeWorkflowDocument {
    const version = this.store.getVersion(run.workflowId, run.workflowVersion);
    if (!version) fail('creative_workflow_version_not_found', 409, '运行版本不存在。');
    assertValidCreativeGraph(version.document);
    return version.document;
  }
  private savedInputs(node: CreativeNodeRun): Record<string, CreativeArtifactInput> {
    return (node.input.artifacts ?? {}) as Record<string, CreativeArtifactInput>;
  }
  private dependencyIds(node: CreativeNodeRun): string[] {
    return [...new Set(Object.values(this.savedInputs(node)).map(input => input.artifactId))];
  }
  private expectations(detail: CreativeRunDetail, document: CreativeWorkflowDocument): {
    attempts: Map<string, number>; feedback: Map<string, CreativeRevisionFeedback>;
  } {
    const attempts = new Map(document.nodes.map(node => [node.id, 0]));
    const feedback = new Map<string, CreativeRevisionFeedback>();
    const revisions = new Set(document.nodes.filter(node => node.kind === 'revision').map(node => node.id));
    const revisionRuns = detail.nodes.filter(node => revisions.has(node.nodeId) && node.outputArtifactId)
      .sort((a, b) => a.attempt - b.attempt || a.createdAt.localeCompare(b.createdAt));
    for (const node of revisionRuns) {
      const content = detail.artifacts.find(artifact => artifact.id === node.outputArtifactId)?.content;
      const request = content?.__runtimeRevision as RevisionRequest | undefined;
      if (!request) continue;
      for (const [nodeId, attempt] of Object.entries(request.attempts)) attempts.set(nodeId, Math.max(attempts.get(nodeId) ?? 0, attempt));
      feedback.set(request.targetNodeId, request.feedback);
    }
    for (const node of detail.nodes) if (node.input.__runtimeRecovery) attempts.set(node.nodeId, Math.max(attempts.get(node.nodeId) ?? 0, node.attempt));
    return { attempts, feedback };
  }
  private currentNodes(detail: CreativeRunDetail, attempts: Map<string, number>): Map<string, CreativeNodeRun> {
    return new Map(detail.nodes.filter(node => node.attempt === attempts.get(node.nodeId)).map(node => [node.nodeId, node]));
  }
  private closure(ids: string[], detail: CreativeRunDetail): CreativeArtifact[] {
    const byId = new Map(detail.artifacts.map(artifact => [artifact.id, artifact]));
    const found = new Map<string, CreativeArtifact>();
    const queue = [...ids];
    while (queue.length) {
      const id = queue.shift()!;
      if (found.has(id)) continue;
      const artifact = byId.get(id) ?? this.store.getArtifact(id);
      if (!artifact || !isLive(artifact) || creativeHash(artifact.content) !== artifact.contentHash) {
        fail('creative_artifact_stale', 409, '节点输入或其依赖已经失效。');
      }
      found.set(id, artifact);
      queue.push(...artifact.dependencyIds);
    }
    return [...found.values()];
  }
  private edgeActive(when: CreativeWorkflowDocument['edges'][number]['when'], artifact: CreativeArtifact | undefined): boolean {
    if (!when || when === 'always') return true;
    const content = artifact?.content;
    if (!content) return false;
    if (when === 'approved') return content.verdict === 'approved' || content.approved === true;
    if (when === 'rejected') return content.verdict === 'changes_requested' || content.verdict === 'uncertain' || content.approved === false;
    if (when === 'ordinary') return content.importance === 'ordinary';
    return content.importance === 'key' || content.importance === 'baseline' || content.importance === 'unknown';
  }
  private async executeRun(id: string): Promise<void> {
    const initial = this.store.detail(id);
    if (terminalRun.has(initial.run.status) || initial.run.status === 'paused') return;
    if (!this.ancestorsPermit(initial.run)) return;
    const document = this.document(initial.run);
    // A crash after dispatch must never silently replay. Unclaimed pending work is safe.
    for (const node of initial.nodes) {
      if (node.status !== 'running' || node.leaseUntil > Date.now()) continue;
      this.store.patchNode(node.id, {
        status: node.dispatchedAt ? 'uncertain' : 'pending', leaseOwner: null, leaseUntil: 0,
        error: node.dispatchedAt ? '执行租约过期；请核对已派发请求。' : null,
      });
    }
    const polled = new Set<string>();
    for (let step = 0; step < 1000 && !this.closing; step++) {
      const detail = this.store.detail(id);
      if (terminalRun.has(detail.run.status) || detail.run.status === 'paused') return;
      if (!this.ancestorsPermit(detail.run)) return;
      if (detail.approvals.some(approval => approval.status === 'rejected')) {
        this.cancel(id);
        return;
      }
      const blockedChildren = detail.nodes.filter(node => node.status === 'waiting' && node.externalTaskId)
        .map(node => this.store.getRun(node.externalTaskId!)).filter((child): child is CreativeRun => Boolean(child && child.parentRunId === id));
      if (blockedChildren.some(child => child.status === 'uncertain' || child.status === 'paused')) {
        const status = blockedChildren.some(child => child.status === 'uncertain') ? 'uncertain' : 'paused';
        if (detail.run.status !== status) this.store.updateRun(id, { status, error: '子工作流需要核对或继续。' });
        return;
      }
      const { attempts, feedback } = this.expectations(detail, document);
      const current = this.currentNodes(detail, attempts);
      if ([...current.values()].some(node => node.status === 'uncertain')) {
        this.store.updateRun(id, { status: 'uncertain', error: '存在结果不明的节点，禁止自动重投。' });
        return;
      }
      if ([...current.values()].some(node => node.status === 'failed')) {
        this.store.updateRun(id, { status: 'failed', error: [...current.values()].find(node => node.status === 'failed')!.error });
        return;
      }
      const artifactById = new Map(detail.artifacts.map(artifact => [artifact.id, artifact]));
      const jobs: Array<{ node: CreativeNode; run: CreativeNodeRun }> = [];
      let changed = false;
      for (const node of document.nodes) {
        if (jobs.length >= this.maxParallel) break;
        if (node.kind === 'adopt' && typeof detail.run.input.candidateArtifactId === 'string'
          && this.store.getArtifact(detail.run.input.candidateArtifactId)?.status !== 'accepted') continue;
        let nodeRun = current.get(node.id);
        if (nodeRun?.status === 'succeeded' || nodeRun?.status === 'skipped' || nodeRun?.status === 'running') continue;
        if (nodeRun?.status === 'waiting') {
          if (node.kind === 'approval') {
            const approval = detail.approvals.find(item => item.nodeRunId === nodeRun!.id && item.status !== 'stale');
            if (!approval) {
              this.store.patchNode(nodeRun.id, { status: 'failed', error: '审批绑定的产物或依赖已失效。' });
              changed = true;
              continue;
            }
            if (approval.status === 'pending') continue;
          } else if (!['tool', 'subworkflow'].includes(node.kind) || !nodeRun.externalTaskId || polled.has(nodeRun.id)) continue;
          this.store.patchNode(nodeRun.id, { status: 'pending', leaseOwner: null, leaseUntil: 0 });
          nodeRun = this.store.detail(id).nodes.find(item => item.id === nodeRun!.id)!;
        }
        if (!nodeRun) {
          const incoming = document.edges.filter(edge => edge.target === node.id);
          if (incoming.some(edge => !['succeeded', 'skipped'].includes(current.get(edge.source)?.status ?? ''))) continue;
          const enabled = new Set(incoming.filter(edge => {
            const source = current.get(edge.source)!;
            return source.status === 'succeeded' && this.edgeActive(edge.when, artifactById.get(source.outputArtifactId ?? ''));
          }).map(edge => edge.source));
          const inputs: Record<string, CreativeArtifactInput> = {};
          for (const [port, source] of Object.entries(node.inputs)) {
            if (!enabled.has(source.nodeId)) continue;
            const artifact = artifactById.get(current.get(source.nodeId)?.outputArtifactId ?? '');
            if (!artifact || artifact.kind !== source.kind) fail('creative_input_missing', 409, `节点 ${node.id} 的 ${port} 输入缺失或类型错误。`);
            this.closure([artifact.id], detail);
            inputs[port] = envelope(artifact);
          }
          nodeRun = this.store.ensureNode(id, node.id, attempts.get(node.id)!, {
            artifacts: inputs, ...(feedback.has(node.id) ? { revision: feedback.get(node.id) } : {}),
          });
          const conditionalGateClosed = incoming.some(edge => edge.when && edge.when !== 'always')
            && !incoming.some(edge => edge.when && edge.when !== 'always' && enabled.has(edge.source));
          if ((incoming.length && !enabled.size) || (conditionalGateClosed && node.kind !== 'join')) {
            this.store.patchNode(nodeRun.id, { status: 'skipped' });
            changed = true;
            continue;
          }
        }
        if (nodeRun.status === 'pending') jobs.push({ node, run: nodeRun });
      }
      if (jobs.length) {
        if (detail.run.status !== 'running') this.store.updateRun(id, { status: 'running', error: null });
        for (const job of jobs) if (job.run.externalTaskId) polled.add(job.run.id);
        await Promise.all(jobs.map(job => this.executeNode(document, job.node, job.run)));
        continue;
      }
      if (changed) continue;
      const nodes = [...current.values()];
      if (nodes.length === document.nodes.length && nodes.every(node => node.status === 'succeeded' || node.status === 'skipped')) {
        this.store.updateRun(id, { status: 'completed', error: null });
      } else if (nodes.some(node => node.status === 'waiting' && document.nodes.find(item => item.id === node.nodeId)?.kind === 'approval')
        || blockedChildren.some(child => child.status === 'waiting_approval')) {
        if (detail.run.status !== 'waiting_approval') this.store.updateRun(id, { status: 'waiting_approval', error: null });
      } else if (!nodes.some(node => node.status === 'running' || node.status === 'waiting')) {
        if (typeof detail.run.input.candidateArtifactId === 'string'
          && this.store.getArtifact(detail.run.input.candidateArtifactId)?.status === 'candidate'
          && document.nodes.some(node => node.kind === 'adopt' && !current.has(node.id))) {
          if (detail.run.status !== 'waiting_approval') this.store.updateRun(id, { status: 'waiting_approval', error: '等待上一场景正式采用。' });
          return;
        }
        fail('creative_graph_stalled', 409, '没有可执行节点，依赖未能满足。');
      }
      return;
    }
  }
  private ancestorsPermit(run: CreativeRun): boolean {
    let ancestorId = run.parentRunId;
    let descendant = run;
    const ancestorIds = new Set<string>();
    while (ancestorId) {
      if (ancestorIds.has(ancestorId)) fail('creative_run_cycle', 409, '父运行链存在循环。');
      ancestorIds.add(ancestorId);
      const ancestor = this.requireRun(ancestorId);
      const candidateId = descendant.input.candidateArtifactId;
      const candidate = typeof candidateId === 'string' ? this.store.getArtifact(candidateId) : null;
      const speculative = Boolean(candidate && candidate.runId === ancestor.id && candidate.kind === 'scene');
      if (speculative && candidate && !isLive(candidate)) fail('creative_candidate_stale', 409, '预写依赖的候选版本已失效。');
      if ((terminalRun.has(ancestor.status) && !(speculative && ancestor.status === 'completed'))
        || ancestor.status === 'paused' || ancestor.status === 'uncertain') return false;
      if (speculative) break;
      descendant = ancestor;
      ancestorId = ancestor.parentRunId;
    }
    return true;
  }
  private validateOutput(node: CreativeNode, content: Record<string, unknown>, inputs: Record<string, CreativeArtifactInput>, detail: CreativeRunDetail): void {
    if (!content || typeof content !== 'object' || Array.isArray(content)) throw new CreativeOutputRejectedError('节点输出必须是对象。');
    if (node.kind !== 'agent' || node.outputKind !== 'review') return;
    if (!Value.Check(CreativeReviewSchema, content)) throw new CreativeOutputRejectedError('审核输出不符合结构契约。', content);
    const review = content as CreativeReview;
    const supplied = Object.values(inputs);
    const priority = ['image', 'scene', 'plan', 'visual-brief'] as const;
    const targetKind = priority.find(kind => supplied.some(input => input.kind === kind));
    const candidates = supplied.filter(input => input.kind === targetKind);
    const target = candidates.find(input => input.artifactId === review.targetArtifactId);
    if (!target || target.contentHash !== review.targetHash) throw new CreativeOutputRejectedError('审核未绑定实际输入产物及其内容哈希。', content);
    this.closure([target.artifactId], detail);
    const targetArtifact = this.store.getArtifact(target.artifactId)!;
    const targetProducer = this.store.getNodeRun(targetArtifact.nodeRunId);
    const targetRun = targetProducer && this.store.getRun(targetProducer.runId);
    const targetNode = targetRun && this.document(targetRun).nodes.find(item => item.id === targetProducer!.nodeId);
    if (targetNode?.roleId && targetNode.roleId === node.roleId) throw new CreativeOutputRejectedError('生成岗位不能自审并授予通过。', content);
    if (review.verdict === 'approved' && review.issues.some(issue => issue.severity === 'blocking' || issue.severity === 'unknown')) {
      throw new CreativeOutputRejectedError('含阻断或未知问题的审核不能声明通过。', content);
    }
  }
  private checkedReviews(artifacts: CreativeArtifact[]): CreativeArtifact[] {
    const reviews = artifacts.filter(artifact => artifact.kind === 'review' && Value.Check(CreativeReviewSchema, artifact.content));
    if (!reviews.length) fail('creative_review_missing', 409, '审批前缺少有效独立审核。');
    const byId = new Map(artifacts.map(artifact => [artifact.id, artifact]));
    for (const artifact of reviews) {
      const review = artifact.content as CreativeReview;
      const target = byId.get(review.targetArtifactId);
      if (!target || target.contentHash !== review.targetHash || !isLive(target)) fail('creative_review_stale', 409, '审核对象与本次产物不一致。');
    }
    return reviews;
  }
  private approvedBundle(nodeRun: CreativeNodeRun, detail: CreativeRunDetail): { approval: CreativeApproval; artifacts: CreativeArtifact[] } {
    const decisions = Object.values(this.savedInputs(nodeRun)).filter(input => input.kind === 'decision');
    const approvalIds = decisions.map(input => input.content.approvalId).filter((id): id is string => typeof id === 'string');
    if (approvalIds.length !== 1) fail('creative_approval_required', 409, '正式采用必须绑定唯一审批记录。');
    const approval = this.store.getApproval(approvalIds[0]);
    if (!approval || approval.runId !== detail.run.id || approval.status !== 'approved') fail('creative_approval_required', 409, '正式采用尚未批准。');
    const artifactIds = [...approval.artifactIds].sort((a, b) => a.localeCompare(b));
    const artifacts = this.closure(artifactIds, detail);
    const hash = approvalBundleHash(artifactIds.map(id => artifacts.find(item => item.id === id)!));
    if (hash !== approval.bundleHash || !decisions.some(input => input.content.bundleHash === hash)) fail('creative_approval_stale', 409, '采用审批已失效。');
    return { approval, artifacts };
  }
  private async executeNode(document: CreativeWorkflowDocument, node: CreativeNode, pending: CreativeNodeRun): Promise<void> {
    if (this.closing || this.requireRun(pending.runId).status !== 'running') return;
    if (!this.store.claimNode(pending.id, this.owner, this.leaseMs)) return;
    const controller = new AbortController();
    this.controllers.set(pending.id, { runId: pending.runId, controller });
    let lostLease = false;
    let nodeRun = this.store.detail(pending.runId).nodes.find(item => item.id === pending.id)!;
    let marked = false;
    const heartbeat = setInterval(() => {
      if (!this.store.renewLease(nodeRun.id, this.owner, this.leaseMs)) {
        lostLease = true;
        controller.abort(new Error('执行租约丢失。'));
      }
    }, Math.max(10, Math.floor(this.leaseMs / 3)));
    heartbeat.unref();
    this.heartbeats.set(nodeRun.id, heartbeat);
    const context: CreativeExecutionContext = {
      run: this.requireRun(nodeRun.runId), node, nodeRun,
      inputs: this.savedInputs(nodeRun), signal: controller.signal,
      ...(nodeRun.input.revision ? { revision: nodeRun.input.revision as CreativeRevisionFeedback } : {}),
      markDispatched: (delta, externalTaskId) => {
        if (marked || nodeRun.dispatchedAt) fail('creative_already_dispatched', 409, '本次尝试已经派发，不能重复计费或重投。');
        this.store.atomic(() => {
          if (this.closing || this.requireRun(nodeRun.runId).status !== 'running') throw new CreativeNotDispatchedError('运行已停止，尚未派发。');
          const latestDetail = this.store.detail(nodeRun.runId);
          this.closure(this.dependencyIds(nodeRun), latestDetail);
          if (node.kind === 'adopt') Object.assign(context, this.approvedBundle(nodeRun, latestDetail));
          if (node.kind === 'agent' && (!delta.textCalls || !delta.tokens)) fail('creative_budget_required', 409, '模型调用必须先预留调用数和 token 上限。');
          if (node.kind === 'tool' && node.config.tool === 'image_generation' && !delta.images) fail('creative_budget_required', 409, '生图前必须预留图片额度。');
          this.store.reserveNodeBudget(nodeRun.runId, nodeRun.id, delta);
          nodeRun = this.store.patchNode(nodeRun.id, {
            owner: this.owner, dispatchedAt: new Date().toISOString(), ...(externalTaskId ? { externalTaskId } : {}),
          });
          context.nodeRun = nodeRun;
          context.run = this.requireRun(nodeRun.runId);
        });
        marked = true;
      },
      settleTokenUsage: actual => {
        const reservation = this.store.getTokenReservation(nodeRun.id);
        if (!reservation) fail('creative_token_reservation_not_found', 409, '节点没有可结算的 token 预留。');
        this.store.settleTokenUsage(nodeRun.runId, nodeRun.id, reservation.reserved, actual);
        context.run = this.requireRun(nodeRun.runId);
      },
    };
    try {
      const detail = this.store.detail(nodeRun.runId);
      const dependencies = this.dependencyIds(nodeRun);
      if (node.kind === 'context' && typeof context.run.input.candidateArtifactId === 'string') {
        const candidate = this.store.getArtifact(context.run.input.candidateArtifactId);
        if (!candidate || candidate.runId !== context.run.parentRunId || candidate.kind !== 'scene') fail('creative_candidate_scope', 409, '预写上下文必须绑定父运行的场景候选。');
        dependencies.push(candidate.id);
      }
      this.closure(dependencies, detail);
      let content: Record<string, unknown>;
      let forwardedArtifactId: string | undefined;
      if (node.kind === 'parallel') {
        const input = Object.values(context.inputs)[0];
        if (!input) fail('creative_input_missing', 409, '并行转发缺少输入。');
        content = input.content;
        forwardedArtifactId = input.artifactId;
      } else if (node.kind === 'join') {
        const primary = Object.values(context.inputs).find(input => input.kind === node.outputKind);
        if (!primary) fail('creative_input_missing', 409, '汇合缺少匹配输出类型的有效分支。');
        content = primary.content;
      } else if (node.kind === 'condition') {
        const artifacts = this.closure(dependencies, detail);
        const reviews = artifacts.filter(artifact => artifact.kind === 'review' && Value.Check(CreativeReviewSchema, artifact.content));
        const approved = reviews.length > 0 && reviews.every(artifact => artifact.content.verdict === 'approved');
        const importance = context.run.input.importance;
        const condition = node.config.condition;
        const matches = condition === 'approved' ? approved : condition === 'needs_revision' ? !approved
          : condition === 'ordinary_image' ? importance === 'ordinary'
            : context.run.input.criticalChange === true || Object.values(context.inputs).some(input => input.kind === 'plan' && input.content.requiresDirectionApproval === true);
        content = { approved: matches, verdict: matches ? 'approved' : 'changes_requested', importance: importance ?? 'unknown' };
      } else if (node.kind === 'revision') {
        content = this.revision(document, node, nodeRun, detail);
      } else if (node.kind === 'approval') {
        const bundle = this.closure(dependencies, detail);
        const directionGate = node.config.parameters?.directionGate === true;
        const planOnly = ['general', 'video-plan', 'research'].includes(document.purpose)
          && Object.values(context.inputs).some(input => input.kind === 'plan')
          && !Object.values(context.inputs).some(input => ['scene', 'image'].includes(input.kind));
        const reviews = directionGate || planOnly ? [] : this.checkedReviews(bundle);
        if (directionGate && !Object.values(context.inputs).some(input => input.kind === 'plan')) fail('creative_plan_missing', 409, '方向审批必须包含实际计划。');
        if (reviews.some(artifact => artifact.content.verdict !== 'approved')) fail('creative_review_blocked', 409, '仍有未通过的审核，不能进入采用审批。');
        let approval = detail.approvals.find(item => item.nodeRunId === nodeRun.id && item.status !== 'stale')
          ?? this.store.requestApproval(nodeRun.id, bundle.filter(artifact => artifact.runId === context.run.id).map(artifact => artifact.id));
        if (!directionGate && approval.status === 'pending' && this.executor.autoApprove && await this.executor.autoApprove(context, approval)) {
          approval = this.store.decideApproval(approval.id, { expectedRevision: approval.revision, bundleHash: approval.bundleHash, decision: 'approve', comment: '服务端受控自动审批策略通过。' });
        }
        if (approval.status === 'pending') {
          this.store.patchNode(nodeRun.id, { owner: this.owner, status: 'waiting' });
          return;
        }
        content = { approvalId: approval.id, bundleHash: approval.bundleHash, artifactIds: approval.artifactIds, approved: approval.status === 'approved', verdict: approval.status === 'approved' ? 'approved' : 'changes_requested' };
      } else if (node.kind === 'subworkflow') {
        content = await this.subworkflow(context);
      } else {
        if (node.kind === 'tool' && !this.toolPermitted(node, context.run)) throw new CreativeNotDispatchedError('工具未获得本次运行冻结岗位的授权。');
        const handler = this.executor[node.kind];
        if (!handler) throw new CreativeNotDispatchedError(`未安装 ${node.kind} 执行器。`);
        if (node.kind === 'adopt') Object.assign(context, this.approvedBundle(nodeRun, detail));
        content = await handler.call(this.executor, context);
        if (node.kind !== 'context' && !nodeRun.dispatchedAt) throw new CreativeOutputRejectedError('执行器返回结果但未记录派发。', content);
        this.validateOutput(node, content, context.inputs, this.store.detail(nodeRun.runId));
      }
      if (lostLease || this.closing) return;
      this.store.atomic(() => {
        // Even after pause/cancel, retain any in-flight result; later nodes cannot dispatch.
        this.store.patchNode(nodeRun.id, { owner: this.owner });
        const revisionRequest = content.__runtimeRevision as RevisionRequest | undefined;
        if (node.kind === 'revision' && revisionRequest) this.store.setArtifactStatus(revisionRequest.feedback.previousTarget.artifactId, 'superseded');
        if (node.kind === 'subworkflow' && typeof content.childArtifactId === 'string') dependencies.push(content.childArtifactId);
        const artifactId = forwardedArtifactId ?? this.store.putArtifact(nodeRun.id, node.outputKind, content, dependencies).id;
        this.store.patchNode(nodeRun.id, { owner: this.owner, status: 'succeeded', outputArtifactId: artifactId, error: null });
      });
    } catch (error) {
      if (lostLease || this.closing) return;
      const current = this.store.detail(nodeRun.runId).nodes.find(item => item.id === nodeRun.id)!;
      if (current.leaseOwner !== this.owner || current.leaseUntil <= Date.now()) return;
      if (error instanceof CreativePendingExecution) {
        if (!error.externalTaskId || !current.dispatchedAt) {
          this.store.patchNode(nodeRun.id, { owner: this.owner, status: 'failed', error: '异步任务缺少已派发证据或任务 ID。' });
        } else this.store.patchNode(nodeRun.id, { owner: this.owner, status: 'waiting', externalTaskId: error.externalTaskId, error: null });
      } else {
        const known = error instanceof CreativeNotDispatchedError || error instanceof CreativeDefiniteFailureError || error instanceof CreativeOutputRejectedError;
        const runStopped = ['paused', 'cancelled'].includes(this.requireRun(nodeRun.runId).status)
          || (error as { code?: string })?.code === 'creative_ancestor_inactive';
        const status = !current.dispatchedAt && runStopped ? 'pending' : current.dispatchedAt && !known ? 'uncertain' : 'failed';
        this.store.atomic(() => {
          const rejected = error instanceof CreativeOutputRejectedError && error.output
            ? this.store.putArtifact(nodeRun.id, node.outputKind, error.output, this.dependencyIds(nodeRun)) : undefined;
          this.store.patchNode(nodeRun.id, { owner: this.owner, status, error: errorText(error),
            ...(status === 'pending' ? { leaseOwner: null, leaseUntil: 0 } : {}),
            ...(rejected ? { outputArtifactId: rejected.id } : {}) });
        });
      }
    } finally {
      clearInterval(heartbeat);
      this.heartbeats.delete(pending.id);
      this.controllers.delete(pending.id);
    }
  }
  private toolPermitted(node: CreativeNode, run: CreativeRun): boolean {
    if (!node.config.tool) return false;
    const roles = node.roleId ? run.roleSnapshot.filter(role => role.id === node.roleId) : run.roleSnapshot;
    return roles.some(role => role.tools.includes(node.config.tool!));
  }
  private async subworkflow(context: CreativeExecutionContext): Promise<Record<string, unknown>> {
    const { node, nodeRun, run } = context;
    const workflowId = node.config.workflowId;
    const versionNumber = node.config.workflowVersion;
    if (!workflowId || !versionNumber) throw new CreativeNotDispatchedError('子工作流必须固定已发布版本。');
    const version = this.store.getVersion(workflowId, versionNumber);
    if (!version) throw new CreativeNotDispatchedError('子工作流版本不存在。');
    let ancestor: CreativeRun | null = run;
    const visited = new Set<string>();
    let depth = 0;
    while (ancestor) {
      if (visited.has(ancestor.id) || ancestor.workflowId === workflowId) throw new CreativeNotDispatchedError('子工作流不能递归调用当前或祖先工作流。');
      visited.add(ancestor.id);
      depth++;
      if (depth > 5) throw new CreativeNotDispatchedError('子工作流超过五层深度限制。');
      ancestor = ancestor.parentRunId ? this.requireRun(ancestor.parentRunId) : null;
    }
    // The child sees only frozen parent roles and tool permissions.
    for (const childNode of version.document.nodes) {
      if (childNode.roleId && !run.roleSnapshot.some(role => role.id === childNode.roleId)) throw new CreativeNotDispatchedError('子工作流引用了父运行未授权的岗位。');
      if (childNode.kind === 'tool' && !this.toolPermitted(childNode, run)) {
        throw new CreativeNotDispatchedError('子工作流工具不在冻结岗位权限内。');
      }
    }
    let child: CreativeRun;
    if (nodeRun.externalTaskId) {
      child = this.requireRun(nodeRun.externalTaskId);
      if (child.parentRunId !== run.id || child.workflowId !== workflowId || child.workflowVersion !== versionNumber) throw new CreativeNotDispatchedError('子运行关联或版本不匹配。');
    } else {
      child = this.store.atomic(() => {
        context.markDispatched({});
        const created = this.store.startRun({
          workflowId, workflowVersion: versionNumber, idempotencyKey: `child_${nodeRun.id}`,
          scope: run.scope, instruction: node.config.instruction ?? run.instruction,
          budget: run.budget,
          input: { ...run.input, parentInputs: context.inputs },
        }, run.roleSnapshot, run.id);
        this.store.patchNode(nodeRun.id, { owner: this.owner, externalTaskId: created.id });
        return created;
      });
    }
    if (child.status === 'queued' || child.status === 'running' || child.status === 'waiting_approval') {
      await this.tick(child.id);
      child = this.requireRun(child.id);
    }
    if (child.status === 'failed' || child.status === 'cancelled') throw new CreativeDefiniteFailureError(`子工作流${child.status === 'failed' ? '失败' : '取消'}：${child.error ?? ''}`);
    if (child.status !== 'completed') {
      if (child.status === 'uncertain' || child.status === 'paused') this.store.updateRun(run.id, { status: child.status, error: '子工作流需要核对或继续后才能推进。' });
      throw new CreativePendingExecution(child.id);
    }
    const detail = this.store.detail(child.id);
    const outputs = detail.nodes.filter(item => item.status === 'succeeded' && item.outputArtifactId)
      .map(item => detail.artifacts.find(artifact => artifact.id === item.outputArtifactId)!)
      .filter(artifact => artifact.kind === node.outputKind && isLive(artifact));
    if (outputs.length !== 1) throw new CreativeOutputRejectedError('子工作流必须产生唯一且类型匹配的交付产物。');
    return { ...outputs[0].content, childRunId: child.id, childArtifactId: outputs[0].id };
  }
  private revision(document: CreativeWorkflowDocument, node: CreativeNode, nodeRun: CreativeNodeRun, detail: CreativeRunDetail): Record<string, unknown> {
    const artifacts = this.closure(this.dependencyIds(nodeRun), detail);
    const reviews = this.checkedReviews(artifacts).filter(artifact => {
      const producer = this.store.getNodeRun(artifact.nodeRunId);
      return producer && document.nodes.find(item => item.id === producer.nodeId)?.kind === 'agent';
    });
    const reviewRoles = new Set(reviews.map(artifact => {
      const producer = this.store.getNodeRun(artifact.nodeRunId)!;
      return document.nodes.find(item => item.id === producer.nodeId)?.roleId;
    }));
    if ((node.config.reviewerRoleIds ?? []).some(roleId => !reviewRoles.has(roleId))) fail('creative_review_missing', 409, '返修节点缺少指定独立岗位的审核。');
    const { attempts } = this.expectations(detail, document);
    const targetId = node.config.targetNodeId!;
    const targetRun = detail.nodes.find(item => item.nodeId === targetId && item.attempt === attempts.get(targetId));
    const target = detail.artifacts.find(item => item.id === targetRun?.outputArtifactId);
    if (!target || !reviews.every(review => this.closure([String(review.content.targetArtifactId)], detail).some(artifact => artifact.id === target.id))) fail('creative_revision_target', 409, '返修审核未指向当前目标产物或其下游产物。');
    if (reviews.every(review => review.content.verdict === 'approved')) {
      const reviewedCandidate = artifacts.find(artifact => artifact.id === reviews[0].content.targetArtifactId)!;
      return node.outputKind === reviewedCandidate.kind ? reviewedCandidate.content : node.outputKind === target.kind ? target.content : {
        verdict: 'approved', targetArtifactId: target.id, targetHash: target.contentHash,
        issues: [], summary: '当前目标的独立审核全部通过。',
      };
    }
    const count = detail.nodes.filter(item => item.nodeId === node.id && item.outputArtifactId &&
      detail.artifacts.find(artifact => artifact.id === item.outputArtifactId)?.content.__runtimeRevision).length;
    if (count >= Math.min(2, node.config.maxRevisions ?? 0, detail.run.budget.maxRevisions)) fail('creative_revision_exhausted', 409, '定向返修次数已达到上限，保留候选供人工处理。');
    const forward = new Set([targetId]);
    const reverse = new Set([node.id]);
    for (let pass = 0; pass < document.nodes.length; pass++) {
      for (const edge of document.edges) {
        if (forward.has(edge.source) && edge.source !== node.id) forward.add(edge.target);
        if (reverse.has(edge.target)) reverse.add(edge.source);
      }
    }
    const affected = [...forward].filter(id => reverse.has(id));
    if (affected.some(id => ['adopt', 'approval'].includes(document.nodes.find(item => item.id === id)!.kind))) fail('creative_revision_unsafe', 409, '返修子图不能跨过审批或正式采用节点。');
    const request: RevisionRequest = {
      targetNodeId: targetId,
      attempts: Object.fromEntries(affected.map(id => [id, (attempts.get(id) ?? 0) + 1])),
      feedback: { number: count + 1, previousTarget: envelope(target), reviews: reviews.map(envelope) },
    };
    // The caller persists this request and invalidates the old target in one transaction.
    return { verdict: 'changes_requested', __runtimeRevision: request };
  }
}
