import { Value } from '@sinclair/typebox/value';
import type {
  CreativeApproval,
  CreativeArtifact,
  CreativeApprovalScopePolicy,
  CreativeReview,
  CreativeScope,
  CreativeScopePolicyPut,
  CreativeScopePolicyView,
} from '@sthstart/contracts';
import {
  CreativeApprovalScopePolicySchema,
  CreativeReviewSchema,
  CreativeScopePolicyPutSchema,
  CreativeScopePolicyViewSchema,
} from '@sthstart/contracts';
import { nowIso } from '../database.js';
import { isCreativeConversationWorkflow } from './conversation.js';
import type { CreativeContextSelection, CreativeDomain } from './domain.js';
import type { CreativeExecutionContext } from './runtime.js';
import {
  approvalBundleHash,
  creativeHash,
  type CreativeStore,
} from './store.js';

export {
  CreativeApprovalScopePolicySchema,
  CreativeScopePolicyPutSchema,
  CreativeScopePolicyQuerySchema,
  CreativeScopePolicyReadSchema,
  CreativeScopePolicyViewSchema,
  type CreativeApprovalScopePolicy,
  type CreativeScopePolicyPut,
  type CreativeScopePolicyQuery,
  type CreativeScopePolicyRead,
  type CreativeScopePolicyView,
} from '@sthstart/contracts';

export function creativeScopePolicyKey(scope: CreativeScope): string {
  return creativeHash(scope);
}

const disabledPolicy = (): CreativeApprovalScopePolicy => ({
  schemaVersion: 1,
  enabled: false,
  kind: 'ordinary_image',
  allowedSceneArtifactIds: [],
});

function fail(code: string, statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { code, statusCode });
}

export function readCreativeScopePolicy(
  store: CreativeStore,
  scope: CreativeScope,
): CreativeScopePolicyView {
  const row = store.database.connection.prepare(
    'SELECT scope_json,data_json,revision,updated_at FROM co_scope_policies WHERE scope_key=?',
  ).get(creativeScopePolicyKey(scope)) as PolicyRow | undefined;
  if (!row) {
    return {
      scope: structuredClone(scope),
      policy: disabledPolicy(),
      revision: 0,
      updatedAt: null,
    };
  }
  const savedScope = JSON.parse(String(row.scope_json)) as unknown;
  const policy = JSON.parse(String(row.data_json)) as unknown;
  const view = {
    scope: savedScope,
    policy,
    revision: Number(row.revision),
    updatedAt: row.updated_at,
  };
  if (!Value.Check(CreativeScopePolicyViewSchema, view)
    || creativeHash(savedScope) !== creativeScopePolicyKey(scope)) {
    fail('creative_policy_invalid', 500, '已保存的范围审批策略数据无效。');
  }
  return view;
}

export function saveCreativeScopePolicy(
  store: CreativeStore,
  input: CreativeScopePolicyPut,
): CreativeScopePolicyView {
  if (!Value.Check(CreativeScopePolicyPutSchema, input)) {
    fail('creative_policy_invalid', 400, '范围审批策略请求无效。');
  }
  if (new Set(input.policy.allowedSceneArtifactIds).size
    !== input.policy.allowedSceneArtifactIds.length) {
    fail('creative_policy_invalid', 400, '自动审批场景白名单不能重复。');
  }
  for (const artifactId of input.policy.allowedSceneArtifactIds) {
    const artifact = store.getArtifact(artifactId);
    if (!artifact
      || !validArtifact(artifact)
      || artifact.kind !== 'scene'
      || artifact.status !== 'accepted'
      || creativeHash(artifact.content.scope) !== creativeScopePolicyKey(input.scope)) {
      fail(
        'creative_policy_scene_ineligible',
        409,
        `场景 ${artifactId} 必须已正式采用且属于当前范围。`,
      );
    }
    const adoption = store.database.connection.prepare(
      'SELECT artifact_id FROM co_scene_adoptions WHERE artifact_id=?',
    ).get(artifact.id);
    if (!adoption) {
      fail(
        'creative_policy_scene_ineligible',
        409,
        `场景 ${artifact.id} 缺少正式采用记录。`,
      );
    }
  }
  return store.atomic(() => {
    const current = readCreativeScopePolicy(store, input.scope);
    if (current.revision !== input.expectedRevision) {
      fail('creative_policy_conflict', 409, '范围审批策略已更新，请刷新后重试。');
    }
    const revision = current.revision + 1;
    const updatedAt = nowIso();
    store.database.connection.prepare(
      `INSERT INTO co_scope_policies(scope_key,scope_json,data_json,revision,updated_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(scope_key) DO UPDATE SET
         scope_json=excluded.scope_json,data_json=excluded.data_json,
         revision=excluded.revision,updated_at=excluded.updated_at`,
    ).run(
      creativeScopePolicyKey(input.scope),
      JSON.stringify(input.scope),
      JSON.stringify(input.policy),
      revision,
      updatedAt,
    );
    return {
      scope: structuredClone(input.scope),
      policy: structuredClone(input.policy),
      revision,
      updatedAt,
    };
  });
}

type PolicyRow = {
  scope_json?: unknown;
  data_json?: unknown;
  revision?: unknown;
  updated_at?: unknown;
};

const live = (artifact: CreativeArtifact): boolean =>
  artifact.status !== 'stale' && artifact.status !== 'superseded';

const validArtifact = (artifact: CreativeArtifact | null): artifact is CreativeArtifact =>
  Boolean(artifact)
  && live(artifact!)
  && creativeHash(artifact!.content) === artifact!.contentHash;

function closure(store: CreativeStore, rootIds: readonly string[]): CreativeArtifact[] | null {
  const found = new Map<string, CreativeArtifact>();
  const queue = [...rootIds];
  while (queue.length) {
    const artifactId = queue.shift()!;
    if (found.has(artifactId)) continue;
    const artifact = store.getArtifact(artifactId);
    if (!validArtifact(artifact)) return null;
    found.set(artifactId, artifact);
    if (found.size > 2000) return null;
    queue.push(...artifact.dependencyIds);
  }
  return [...found.values()];
}

const nonOrdinary = (value: unknown): boolean =>
  value !== undefined && value !== 'ordinary';

function imageIdentity(content: Record<string, unknown>): {
  taskId: string | null;
  artifactIds: string[];
} {
  const taskId = typeof content.taskId === 'string' ? content.taskId : null;
  const artifactIds = [
    ...(typeof content.artifactId === 'string' ? [content.artifactId] : []),
    ...(Array.isArray(content.images)
      ? content.images
        .map((item) => item && typeof item === 'object'
          ? (item as Record<string, unknown>).artifactId
          : null)
        .filter((item): item is string => typeof item === 'string' && Boolean(item))
      : []),
  ];
  return { taskId, artifactIds: [...new Set(artifactIds)].sort() };
}

function sameReviewedImage(left: CreativeArtifact, right: CreativeArtifact): boolean {
  if (left.id === right.id) return true;
  if (left.contentHash !== right.contentHash) return false;
  const leftIdentity = imageIdentity(left.content);
  const rightIdentity = imageIdentity(right.content);
  return Boolean(leftIdentity.taskId && rightIdentity.taskId
      && leftIdentity.taskId === rightIdentity.taskId)
    || (leftIdentity.artifactIds.length > 0
      && leftIdentity.artifactIds.length === rightIdentity.artifactIds.length
      && leftIdentity.artifactIds.every((artifactId) => rightIdentity.artifactIds.includes(artifactId)));
}

function hasNonOrdinaryDeclaration(
  context: CreativeExecutionContext,
  image: CreativeArtifact,
  reviews: readonly CreativeArtifact[],
): boolean {
  const declarations = [
    context.node.config.importance,
    context.run.input.importance,
    image.content.importance,
    ...reviews.map((review) => review.content.importance),
  ];
  return declarations.some(nonOrdinary);
}

/**
 * Returns the server-owned auto-approval oracle. It is closed by default and
 * never creates policy state. The binding is intentionally computed at call
 * time so an admin revision or stale artifact immediately returns false.
 */
export function createCreativeApprovalPolicy(
  store: CreativeStore,
  domain: CreativeDomain,
): (context: CreativeExecutionContext, approval: CreativeApproval) => Promise<boolean> {
  return async (context, approval) => {
    try {
      if (context.signal.aborted
        || context.node.kind !== 'approval'
        || approval.runId !== context.run.id
        || approval.nodeRunId !== context.nodeRun.id
        || approval.status !== 'pending'
        || !approval.artifactIds.length) return false;

      const version = store.getVersion(context.run.workflowId, context.run.workflowVersion);
      if (version && isCreativeConversationWorkflow(version.document)) {
        if (context.run.input.actionOrigin !== 'admin-ui') return false;
        const direct = approval.artifactIds.map((artifactId) => store.getArtifact(artifactId));
        if (direct.some((artifact) => !validArtifact(artifact) || artifact!.runId !== context.run.id)) {
          return false;
        }
        if (approvalBundleHash(direct as CreativeArtifact[]) !== approval.bundleHash) return false;
        const loaded = direct as CreativeArtifact[];
        const plans = loaded.filter((artifact) => artifact.kind === 'plan');
        if (plans.length !== 1 || loaded.some((artifact) => artifact.kind !== 'plan' && artifact.kind !== 'context')) {
          return false;
        }
        const proposal = plans[0].content;
        // Only read-only answers and workflow-launch proposals auto-complete;
        // edit_workflow and apply_action always pause for explicit human diff approval.
        return proposal.kind === 'assistant-proposal'
          && (proposal.intent === 'answer' || proposal.intent === 'start_workflow')
          && !('action' in proposal)
          && !('previewHash' in proposal);
      }
      if (version?.document.purpose !== 'illustration') return false;

      const sceneArtifactId = context.run.input.sceneArtifactId;
      const sceneArtifactHash = context.run.input.sceneArtifactHash;
      if (typeof sceneArtifactId !== 'string'
        || typeof sceneArtifactHash !== 'string'
        || !sceneArtifactId
        || !/^[a-f0-9]{64}$/.test(sceneArtifactHash)) return false;

      // Read-only domain validation proves the run scope still resolves through
      // the official story/world source rather than model-authored metadata.
      const rawSelection = context.run.input.contextSelection;
      if (rawSelection !== undefined && (!rawSelection || typeof rawSelection !== 'object' || Array.isArray(rawSelection))) return false;
      const selection: CreativeContextSelection = {};
      for (const key of ['actorIds', 'storyLineIds', 'documentIds'] as const) {
        const value = rawSelection ? (rawSelection as Record<string, unknown>)[key] : undefined;
        if (value === undefined) continue;
        if (!Array.isArray(value) || value.length > 100 || !value.every((id): id is string => typeof id === 'string' && id.length > 0)
          || new Set(value).size !== value.length) return false;
        selection[key] = value;
      }
      const evidenceQueries = context.run.input.evidenceQueries
        ?? (rawSelection ? (rawSelection as Record<string, unknown>).evidenceQueries : undefined);
      if (evidenceQueries !== undefined) {
        if (!Array.isArray(evidenceQueries) || evidenceQueries.length > 3
          || !evidenceQueries.every((query): query is string => typeof query === 'string' && query.trim().length > 0 && query.length <= 100)) return false;
        selection.evidenceQueries = evidenceQueries;
      }
      const currentContext = domain.collectScopeContext(context.run.scope, {
        ...selection,
        sceneArtifactId,
        sceneArtifactHash,
        instruction: context.run.instruction,
      });
      if (creativeHash(currentContext.scope) !== creativeHash(context.run.scope)) return false;

      const scopeKey = creativeScopePolicyKey(context.run.scope);
      const tableExists = store.database.connection.prepare(
        "SELECT 1 FROM sqlite_schema WHERE type='table' AND name='co_scope_policies'",
      ).get();
      if (!tableExists) return false;
      const row = store.database.connection.prepare(
        'SELECT scope_json,data_json,revision,updated_at FROM co_scope_policies WHERE scope_key=?',
      ).get(scopeKey) as PolicyRow | undefined;
      if (!row
        || !Number.isInteger(Number(row.revision))
        || Number(row.revision) < 1
        || typeof row.updated_at !== 'string'
        || !row.updated_at) return false;
      if (creativeHash(JSON.parse(String(row.scope_json))) !== scopeKey) return false;
      const policy = JSON.parse(String(row.data_json)) as unknown;
      if (!Value.Check(CreativeApprovalScopePolicySchema, policy)
        || !policy.enabled
        || policy.kind !== 'ordinary_image'
        || new Set(policy.allowedSceneArtifactIds).size !== policy.allowedSceneArtifactIds.length) {
        return false;
      }

      const direct = approval.artifactIds.map((artifactId) => store.getArtifact(artifactId));
      if (direct.some((artifact) => !validArtifact(artifact) || artifact!.runId !== context.run.id)) {
        return false;
      }
      if (approvalBundleHash(direct as CreativeArtifact[]) !== approval.bundleHash) return false;
      const all = closure(store, approval.artifactIds);
      if (!all) return false;

      const reviews = all.filter((artifact) =>
        artifact.kind === 'review' && Value.Check(CreativeReviewSchema, artifact.content)
      );
      const imageCandidates = all.filter((artifact) => artifact.kind === 'image');
      const reviewedPairs = reviews.flatMap((reviewArtifact) => {
        const review = reviewArtifact.content as CreativeReview;
        const target = store.getArtifact(review.targetArtifactId);
        if (!validArtifact(target)
          || target.kind !== 'image'
          || target.contentHash !== review.targetHash
          || review.verdict !== 'approved'
          || review.issues.some((issue) =>
            issue.severity === 'blocking' || issue.severity === 'unknown'
          )) return [];
        return imageCandidates
          .filter((candidate) => sameReviewedImage(candidate, target))
          .map((candidate) => ({ candidate, target, reviewArtifact, review }));
      });
      if (!reviewedPairs.length) return false;
      const preferredPair = reviewedPairs.find((pair) =>
        context.inputs.revised_image?.artifactId === pair.candidate.id
      ) ?? reviewedPairs[0];
      const image = preferredPair.candidate;
      const actualImageReviews = reviewedPairs
        .filter((pair) => sameReviewedImage(pair.candidate, image))
        .map((pair) => pair.reviewArtifact);
      if (!actualImageReviews.length
        || !approval.artifactIds.includes(image.id)
        || hasNonOrdinaryDeclaration(
          context,
          image,
          [...actualImageReviews, preferredPair.target],
        )) return false;

      if (!policy.allowedSceneArtifactIds.includes(sceneArtifactId)) return false;
      const scene = store.getArtifact(sceneArtifactId);
      if (!validArtifact(scene)
        || scene.kind !== 'scene'
        || scene.status !== 'accepted'
        || scene.contentHash !== sceneArtifactHash
        || nonOrdinary(scene.content.importance)
        || creativeHash(scene.content.scope) !== creativeHash(context.run.scope)) return false;
      if (!closure(store, [scene.id])) return false;

      const contextInputs = Object.values(context.inputs).filter((input) => input.kind === 'context');
      const inScopeContexts = contextInputs
        .map((input) => store.getArtifact(input.artifactId))
        .filter((artifact): artifact is CreativeArtifact =>
          Boolean(artifact) && validArtifact(artifact!) && artifact!.runId === context.run.id
        )
        .filter((artifact) => artifact.content.contextHash === currentContext.contextHash);
      if (!inScopeContexts.length) return false;
      const sceneInPromptContext = inScopeContexts.some((contextArtifact) => {
        const data = contextArtifact.content.data;
        const illustrationScene = data && typeof data === 'object'
          ? (data as Record<string, unknown>).illustrationScene
          : null;
        return illustrationScene
          && typeof illustrationScene === 'object'
          && (illustrationScene as Record<string, unknown>).artifactId === scene.id
          && (illustrationScene as Record<string, unknown>).contentHash === scene.contentHash;
      });
      if (!sceneInPromptContext) return false;

      const adoption = store.database.connection.prepare(
        'SELECT artifact_id FROM co_scene_adoptions WHERE artifact_id=?',
      ).get(scene.id);
      // An accepted status alone is not proof; the formal adoption row is.
      if (!adoption) return false;

      return policy.allowedSceneArtifactIds.includes(scene.id);
    } catch {
      return false;
    }
  };
}
