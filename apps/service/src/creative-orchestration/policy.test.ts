import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CreativeApproval,
  CreativeArtifact,
  CreativeReview,
  CreativeRole,
  CreativeRun,
} from '@sthstart/contracts';
import { nowIso, ServiceDatabase } from '../database.js';
import type { CreativeContext, CreativeContextSelection, CreativeDomain } from './domain.js';
import { CREATIVE_ORCHESTRATION_STATEMENTS } from './migration.js';
import {
  createCreativeApprovalPolicy,
  creativeScopePolicyKey,
  type CreativeApprovalScopePolicy,
} from './policy.js';
import type { CreativeExecutionContext } from './runtime.js';
import { CreativeStore, creativeHash } from './store.js';
import {
  createDefaultIllustrationWorkflow,
  createDefaultStorySceneWorkflow,
} from './templates.js';

const scope = {
  workName: '自动采用测试',
  worldId: 'world_policy',
  branchId: 'branch_policy',
  projectId: null,
} as const;

const roles: CreativeRole[] = [{
  id: 'policy_reviewer',
  name: '审核员',
  responsibility: '审核实际图片',
  core: false,
  capability: 'multimodal',
  modelId: null,
  tools: [],
  revision: 1,
}];

type FixtureOptions = {
  createTable?: boolean;
  enabled?: boolean;
  allowedScene?: boolean;
  scopeMismatch?: boolean;
  sceneAccepted?: boolean;
  omitAdoption?: boolean;
  sceneHashMismatch?: boolean;
  reviewVerdict?: CreativeReview['verdict'];
  reviewUnknown?: boolean;
  runImportance?: unknown;
  imageImportance?: unknown;
  sceneImportance?: unknown;
  revisionWrapper?: boolean;
  contextHashMismatch?: boolean;
  omitSceneFromPromptContext?: boolean;
};

type Fixture = {
  database: ServiceDatabase;
  store: CreativeStore;
  run: CreativeRun;
  nodeRunId: string;
  image: CreativeArtifact;
  reviewArtifact: CreativeArtifact;
  approval: CreativeApproval;
  context: CreativeExecutionContext;
  contextSelection(): CreativeContextSelection | undefined;
  invoke(): Promise<boolean>;
};

function fixture(options: FixtureOptions = {}): Fixture {
  const database = new ServiceDatabase(':memory:');
  for (const statement of CREATIVE_ORCHESTRATION_STATEMENTS) database.connection.exec(statement);
  const store = new CreativeStore(database);

  const sceneDocument = createDefaultStorySceneWorkflow();
  const sceneWorkflow = store.createWorkflow(sceneDocument);
  store.publishWorkflow(sceneWorkflow.id, sceneWorkflow.revision);
  const sceneRun = store.startRun({
    workflowId: sceneWorkflow.id,
    workflowVersion: 1,
    idempotencyKey: 'policy-scene-source',
    scope,
    instruction: '建立被人工采用的场景事实。',
    budget: { maxTextCalls: 1, maxImages: 0, maxTokens: 100, maxRevisions: 0 },
    input: {},
  }, roles);
  const contextNode = store.ensureNode(sceneRun.id, 'story_context', 0, {});
  const contextArtifact = store.putArtifact(contextNode.id, 'context', {
    scope,
    contextHash: 'scene-context-hash',
  }, []);
  const sceneNode = store.ensureNode(sceneRun.id, 'story_writer_scene', 0, {
    contextArtifactId: contextArtifact.id,
  });
  const sceneArtifact = store.putArtifact(sceneNode.id, 'scene', {
    scope,
    contextHash: contextArtifact.content.contextHash,
    title: '已采用的场景',
    body: '角色在同一地点完成不可逆选择。',
    ...(options.sceneImportance === undefined ? {} : { importance: options.sceneImportance }),
  }, [contextArtifact.id]);
  const sceneApprovalNode = store.ensureNode(sceneRun.id, 'story_approval', 0, {});
  const sceneApproval = store.requestApproval(sceneApprovalNode.id, [sceneArtifact.id]);
  const approvedScene = store.decideApproval(sceneApproval.id, {
    expectedRevision: sceneApproval.revision,
    bundleHash: sceneApproval.bundleHash,
    decision: 'approve',
    comment: '人工接受场景事实',
  });
  if (options.sceneAccepted !== false) store.setArtifactStatus(sceneArtifact.id, 'accepted');
  if (!options.omitAdoption) {
    database.connection.prepare(
      `INSERT INTO co_scene_adoptions
       (artifact_id,run_id,approval_id,result_json,created_at) VALUES (?,?,?,?,?)`,
    ).run(
      sceneArtifact.id,
      sceneRun.id,
      approvedScene.id,
      JSON.stringify({ artifactId: sceneArtifact.id }),
      nowIso(),
    );
  }

  const illustrationDocument = createDefaultIllustrationWorkflow();
  const illustrationWorkflow = store.createWorkflow(illustrationDocument);
  store.publishWorkflow(illustrationWorkflow.id, illustrationWorkflow.revision);
  const illustrationRun = store.startRun({
    workflowId: illustrationWorkflow.id,
    workflowVersion: 1,
    idempotencyKey: 'policy-illustration-run',
    scope,
    instruction: '为已采用场景生成插图。',
    budget: { maxTextCalls: 2, maxImages: 2, maxTokens: 200, maxRevisions: 2 },
    input: {
      sceneArtifactId: sceneArtifact.id,
      sceneArtifactHash: options.sceneHashMismatch ? 'stale-scene-hash' : sceneArtifact.contentHash,
      ...(options.runImportance === undefined ? {} : { importance: options.runImportance }),
    },
  }, roles);
  const policyContextNode = store.ensureNode(illustrationRun.id, 'illustration_context', 0, {});
  const illustrationScene = {
    artifactId: sceneArtifact.id,
    contentHash: sceneArtifact.contentHash,
    content: sceneArtifact.content,
    provenance: 'formally-adopted-scene',
  };
  const illustrationContext = store.putArtifact(policyContextNode.id, 'context', {
    scope,
    contextHash: options.contextHashMismatch
      ? 'stale-context-hash'
      : 'illustration-context-hash',
    data: options.omitSceneFromPromptContext ? {} : { illustrationScene },
  }, options.omitSceneFromPromptContext ? [] : [sceneArtifact.id]);
  const promptNode = store.ensureNode(illustrationRun.id, 'illustration_prompt', 0, {});
  const prompt = store.putArtifact(promptNode.id, 'image-prompt', {
    prompt: '角色在已采用场景中回望',
  }, [illustrationContext.id]);
  const imageNode = store.ensureNode(illustrationRun.id, 'illustration_generate', 0, {
    promptArtifactId: prompt.id,
  });
  const image = store.putArtifact(imageNode.id, 'image', {
    images: [{ artifactId: 'media_policy_image' }],
    ...(options.imageImportance === undefined ? {} : { importance: options.imageImportance }),
  }, [prompt.id]);
  const reviewNode = store.ensureNode(illustrationRun.id, 'illustration_visual_review', 0, {
    imageArtifactId: image.id,
  });
  const review: CreativeReview = {
    verdict: options.reviewVerdict ?? 'approved',
    targetArtifactId: image.id,
    targetHash: image.contentHash,
    issues: options.reviewUnknown
      ? [{ severity: 'unknown', message: '无法判断', evidence: '人工复核', location: 'image' }]
      : [],
    summary: '实际图片审核',
  };
  const reviewArtifact = store.putArtifact(reviewNode.id, 'review', review, [image.id]);
  const revisionNode = options.revisionWrapper
    ? store.ensureNode(illustrationRun.id, 'illustration_revision', 0, {
      reviewArtifactId: reviewArtifact.id,
      imageArtifactId: image.id,
    })
    : null;
  const revisedImage = revisionNode
    ? store.putArtifact(revisionNode.id, 'image', image.content, [image.id, reviewArtifact.id])
    : null;
  const approvalNode = store.ensureNode(illustrationRun.id, 'illustration_approval', 0, {
    imageArtifactId: (revisedImage ?? image).id,
    reviewArtifactId: reviewArtifact.id,
  });
  const approval = store.requestApproval(approvalNode.id, [
    (revisedImage ?? image).id,
    reviewArtifact.id,
  ]);
  if (options.createTable !== false) {
    database.connection.exec(
      `CREATE TABLE IF NOT EXISTS co_scope_policies (
        scope_key TEXT PRIMARY KEY,scope_json TEXT NOT NULL,data_json TEXT NOT NULL,
        revision INTEGER NOT NULL,updated_at TEXT NOT NULL)`,
    );
    const policy: CreativeApprovalScopePolicy = {
      schemaVersion: 1,
      enabled: options.enabled ?? true,
      kind: 'ordinary_image',
      allowedSceneArtifactIds: options.allowedScene === false ? [] : [sceneArtifact.id],
    };
    const policyScope = options.scopeMismatch
      ? { ...scope, workName: '另一个作品' }
      : scope;
    database.connection.prepare(
      `INSERT INTO co_scope_policies
       (scope_key,scope_json,data_json,revision,updated_at) VALUES (?,?,?,1,?)`,
    ).run(
      creativeScopePolicyKey(scope),
      JSON.stringify(policyScope),
      JSON.stringify(policy),
      nowIso(),
    );
  }

  let lastSelection: CreativeContextSelection | undefined;
  const domain = {
    collectScopeContext: (_scope: unknown, selection: CreativeContextSelection) => {
      lastSelection = selection;
      return {
      schemaVersion: 1,
      scope,
      contextHash: 'illustration-context-hash',
      } as CreativeContext;
    },
  } as unknown as CreativeDomain;
  const policy = createCreativeApprovalPolicy(store, domain);
  const context = {
    run: illustrationRun,
    node: illustrationDocument.nodes.find((node) => node.id === 'illustration_approval')!,
    nodeRun: store.getNodeRun(approvalNode.id)!,
    inputs: {
      brief: {
        artifactId: illustrationContext.id,
        contentHash: illustrationContext.contentHash,
        kind: illustrationContext.kind,
        content: illustrationContext.content,
        dependencyIds: illustrationContext.dependencyIds,
        status: illustrationContext.status,
      },
      image: {
        artifactId: image.id,
        contentHash: image.contentHash,
        kind: image.kind,
        content: image.content,
        dependencyIds: image.dependencyIds,
        status: image.status,
      },
      review: {
        artifactId: reviewArtifact.id,
        contentHash: reviewArtifact.contentHash,
        kind: reviewArtifact.kind,
        content: reviewArtifact.content,
        dependencyIds: reviewArtifact.dependencyIds,
        status: reviewArtifact.status,
      },
      ...(revisedImage ? {
        revised_image: {
          artifactId: revisedImage.id,
          contentHash: revisedImage.contentHash,
          kind: revisedImage.kind,
          content: revisedImage.content,
          dependencyIds: revisedImage.dependencyIds,
          status: revisedImage.status,
        },
      } : {}),
    },
    signal: new AbortController().signal,
    markDispatched: () => undefined,
    settleTokenUsage: () => undefined,
  } as CreativeExecutionContext;
  return {
    database,
    store,
    run: illustrationRun,
    nodeRunId: approvalNode.id,
    image,
    reviewArtifact,
    approval,
    context,
    contextSelection: () => lastSelection,
    invoke: () => policy(context, approval),
  };
}

test('approval policy is closed when no persistent scope policy exists', async () => {
  const f = fixture({ createTable: false });
  try {
    assert.equal(await f.invoke(), false);
  } finally {
    f.database.close();
  }
});

test('approval policy approves only an admin-enabled ordinary image within the bound scope and scene evidence', async () => {
  const f = fixture();
  try {
    assert.equal(await f.invoke(), true);
    assert.equal(creativeHash(f.context.run.scope), creativeScopePolicyKey(scope));
    assert.equal(f.run.input.sceneArtifactId, f.store.getArtifact(
      String(f.run.input.sceneArtifactId),
    )?.id);
  } finally {
    f.database.close();
  }
});

test('approval policy follows review of the original image through a same-hash revision wrapper', async () => {
  const f = fixture({ revisionWrapper: true });
  try {
    assert.notEqual(f.context.inputs.revised_image.artifactId, f.image.id);
    const targetId = (f.reviewArtifact.content as unknown as CreativeReview).targetArtifactId;
    assert.equal(targetId, f.image.id);
    assert.equal(await f.invoke(), true);
  } finally {
    f.database.close();
  }
});

test('approval policy reuses the run context selection and retrieval instruction exactly', async () => {
  const f = fixture();
  try {
    f.context.run.input.contextSelection = { actorIds: ['actor-a'], storyLineIds: ['line-a'], documentIds: ['document-a'] };
    f.context.run.input.evidenceQueries = ['旧港密码'];
    assert.equal(await f.invoke(), true);
    assert.deepEqual(f.contextSelection(), { actorIds: ['actor-a'], storyLineIds: ['line-a'], documentIds: ['document-a'],
      evidenceQueries: ['旧港密码'], instruction: f.context.run.instruction,
      sceneArtifactId: f.context.run.input.sceneArtifactId, sceneArtifactHash: f.context.run.input.sceneArtifactHash });
    f.context.run.input.contextSelection = { actorIds: [1] };
    assert.equal(await f.invoke(), false);
  } finally { f.database.close(); }
});

test('approval policy rejects disabled, wrong-scope, unlisted, stale or unadopted scene evidence', async () => {
  for (const options of [
    { enabled: false },
    { scopeMismatch: true },
    { allowedScene: false },
    { sceneAccepted: false },
    { omitAdoption: true },
    { sceneHashMismatch: true },
    { contextHashMismatch: true },
    { omitSceneFromPromptContext: true },
  ] satisfies FixtureOptions[]) {
    const f = fixture(options);
    try {
      assert.equal(await f.invoke(), false, JSON.stringify(options));
    } finally {
      f.database.close();
    }
  }
});

test('approval policy rejects review failure, unknown severity and non-ordinary declarations', async () => {
  for (const options of [
    { reviewVerdict: 'changes_requested' as const },
    { reviewUnknown: true },
    { runImportance: 'ordinary', imageImportance: 'key' },
    { sceneImportance: 'baseline' },
    { runImportance: 'unknown' },
    { runImportance: 'baseline' },
  ] satisfies FixtureOptions[]) {
    const f = fixture(options);
    try {
      assert.equal(await f.invoke(), false, JSON.stringify(options));
    } finally {
      f.database.close();
    }
  }
});

test('ordinary self-declaration and a matching run input never replace the admin scene allowlist', async () => {
  const selfDeclared = fixture({ allowedScene: false, runImportance: 'ordinary' });
  try {
    assert.equal(await selfDeclared.invoke(), false);
  } finally {
    selfDeclared.database.close();
  }

  const missingSceneBinding = fixture();
  try {
    const run = structuredClone(missingSceneBinding.run);
    delete run.input.sceneArtifactId;
    const context = { ...missingSceneBinding.context, run } as CreativeExecutionContext;
    const policy = createCreativeApprovalPolicy(
      missingSceneBinding.store,
      {
        collectScopeContext: () => ({
          schemaVersion: 1,
          scope,
          contextHash: 'illustration-context-hash',
        } as CreativeContext),
      } as unknown as CreativeDomain,
    );
    assert.equal(await policy(context, missingSceneBinding.approval), false);
  } finally {
    missingSceneBinding.database.close();
  }
});
