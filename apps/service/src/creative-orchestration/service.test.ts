import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type {
  CreativeBudget,
  CreativeMessageRequest,
  CreativeRole,
  CreativeScope,
  CreativeStartRun,
  CreativeWorkflow,
  WorldDefinition,
} from '@sthstart/contracts';
import { readConfig } from '../config.js';
import { ServiceDatabase, nowIso } from '../database.js';
import { SecretStore } from '../security.js';
import type { CreativeAgentCandidateSubmission } from './bridge.js';
import type { CreativeContext, CreativeScene } from './domain.js';
import type { CreativeExecutor } from './runtime.js';
import { registerCreativeOrchestrationRoutes } from './routes.js';
import {
  CreativeService,
  createCreativeService,
} from './service.js';
import { profileFingerprint } from './executor.js';
import { createCreativeConversationWorkflow, isCreativeConversationWorkflow } from './conversation.js';

const ADMIN = `admin_${'b'.repeat(40)}`;
const TEST_PROVIDER_CREDENTIAL = 'service-test-provider-credential';

class FixtureSecrets extends SecretStore {
  override async status() {
    return {
      available: true,
      backend: 'memory' as const,
      envFallback: false,
    };
  }

  override async get(account: string) {
    return account === 'service-test-model'
      ? { value: TEST_PROVIDER_CREDENTIAL, source: 'keyring' as const }
      : { value: null, source: 'none' as const };
  }

  override async set(): Promise<void> {}

  override async delete(): Promise<void> {}
}

function addModel(
  database: ServiceDatabase,
  id: string,
  capability: 'text' | 'multimodal',
): void {
  const at = nowIso();
  database.connection.prepare(
    `INSERT INTO provider_profiles
      (id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at)
     VALUES (?,?, 'llm', ?,?,?,1,?,?)`,
  ).run(
    id,
    id,
    'https://provider.invalid/v1',
    `${id}-model`,
    'service-test-model',
    at,
    at,
  );
  database.connection.prepare(
    `INSERT INTO provider_profile_options
      (profile_id,thinking_mode,headers_json,extra_body_json,capabilities_json)
     VALUES (?, 'omit', ?, ?, ?)`,
  ).run(id, '{}', '{}', JSON.stringify([capability]));
}

function projectScope(service: CreativeService): CreativeScope {
  const project = service.domain.stories.createProject({ title: '服务集成测试作品' });
  return {
    workName: null,
    worldId: null,
    branchId: null,
    projectId: project.id,
  };
}

function worldScope(service: CreativeService, title = '预写世界'): CreativeScope {
  const at = nowIso();
  const definition: WorldDefinition = {
    title,
    summary: '两个人在港口生活。',
    timeLabel: '清晨',
    workNature: 'original',
    locations: [{ id: 'harbor', name: '港口', description: '旧码头。' }],
    actors: ['actor_a', 'actor_b'].map((id) => ({
      id,
      name: id,
      role: 'main',
      characterId: null,
      characterVersion: null,
      background: '港口居民。',
      personality: '谨慎',
      speechStyle: '简短',
      appearance: '',
      goals: ['生活'],
      locationId: 'harbor',
      referenceArtifactIds: [],
    })),
    sources: [{
      id: 'world-source',
      title: '世界资料',
      nature: 'author',
      content: '港口存在。',
      sourceUrl: '',
      sourceVersion: 'v1',
      capturedAt: at,
    }],
    lockedFacts: ['港口存在。'],
    models: { action: null, adjudication: null, narration: null },
    visualStyle: '',
  };
  const world = service.domain.worlds.create(definition);
  const branch = service.domain.worlds.createBranch(world.id, {
    title: '主线',
    mode: 'alternate',
    direction: '',
    expectedRevision: world.revision,
  });
  return {
    workName: world.title,
    worldId: world.id,
    branchId: branch.id,
    projectId: null,
  };
}

function workflow(service: CreativeService, name: string): CreativeWorkflow {
  const found = service.workflows().items.find((item) => item.document.name === name);
  assert.ok(found, `missing seeded workflow ${name}`);
  assert.ok(found.publishedVersion > 0);
  return found;
}

function runInput(
  workflow: CreativeWorkflow,
  scope: CreativeScope,
  idempotencyKey: string,
  budget: CreativeBudget = {
    maxTextCalls: 10,
    maxImages: 2,
    maxTokens: 10_000,
    maxRevisions: 1,
  },
): CreativeStartRun {
  return {
    workflowId: workflow.id,
    workflowVersion: workflow.publishedVersion,
    idempotencyKey,
    scope,
    instruction: '完成服务集成测试。',
    budget,
    input: {},
  };
}

function freezeRoles(service: CreativeService): void {
  for (const role of service.roles().items) {
    service.saveRole({
      ...role,
      modelId: role.capability === 'multimodal' ? 'vision-model' : 'text-model',
    });
  }
}

function fixture(executor?: CreativeExecutor, fetcher?: typeof fetch) {
  const database = new ServiceDatabase(':memory:');
  addModel(database, 'text-model', 'text');
  addModel(database, 'text-model-two', 'text');
  addModel(database, 'vision-model', 'multimodal');
  const config = readConfig({ STHSTART_ADMIN_TOKEN: ADMIN });
  const service = createCreativeService({
    config,
    database,
    secrets: new FixtureSecrets({}),
    executor,
    fetcher,
  });
  return { database, config, service };
}

function reviewExecutor(): CreativeExecutor {
  return {
    async agent(ctx) {
      ctx.markDispatched({ textCalls: 1, tokens: 20 });
      const candidate = Object.values(ctx.inputs).find((input) =>
        ['scene', 'visual-brief', 'plan'].includes(input.kind));
      if (!candidate) throw new Error('review fixture requires a candidate');
      return {
        verdict: 'approved',
        targetArtifactId: candidate.artifactId,
        targetHash: candidate.contentHash,
        issues: [],
        summary: '独立审核通过。',
      };
    },
  };
}

function safeScene(
  context: CreativeContext,
  directionApprovalId: string | null = null,
): CreativeScene {
  const tick = (context.base.currentTick ?? 0) + 10;
  return {
    schemaVersion: 1 as const,
    title: '外部候选场景',
    body: '雨水落下，两人在门口停步并确认下一步计划。',
    contextHash: context.contextHash,
    scope: context.scope,
    base: context.base,
    sourceRefs: context.sources.map((source) => source.id),
    speculation: null,
    directionApprovalId,
    simulation: context.scope.worldId ? {
      tick,
      events: [{
        id: `service-event-${context.contextHash.slice(0, 8)}`,
        worldId: context.scope.worldId,
        branchId: context.scope.branchId!,
        tick,
        duration: 0,
        title: '门外停步',
        summary: '两人在门口确认下一步。',
        locationId: 'harbor',
        participantIds: ['actor_a', 'actor_b'],
        facts: [{
          id: 'service-fact',
          content: '两人在门口停步。',
          knownBy: ['actor_a', 'actor_b'],
          nature: 'ai',
        }],
        perspectives: [],
        causeEventIds: [],
        storyLineIds: [],
        stateChanges: [],
        createdAt: '2026-11-17T00:00:00.000Z',
      }],
      states: [],
      memories: [],
      consumedInterventionIds: [],
      supportingActors: [],
    } : null,
  };
}

test('service seeds core roles once and preserves explicit tool revocations', () => {
  const f = fixture();
  try {
    const roles = f.service.roles().items;
    assert.deepEqual(
      roles.filter((role) => role.core).map((role) => role.id).sort(),
      ['production_manager', 'creative_director', 'editor_in_chief'].sort(),
    );
    const workflows = f.service.workflows().items;
    assert.ok(workflows.some((item) =>
      item.document.name === '故事场景创作' && item.publishedVersion === 1));
    assert.ok(workflows.some((item) =>
      item.document.name === '插图生成与审查' && item.publishedVersion === 1));
    assert.ok(workflows.some((item) =>
      item.document.name === '视频方案创作' && item.publishedVersion === 1));
    assert.ok(workflows.some((item) =>
      item.document.name === '外部场景候选审核' && item.publishedVersion === 1));
    assert.ok(roles.find((role) => role.id === 'production_manager')?.tools
      .includes('video_plan'));
    assert.ok(roles.find((role) => role.id === 'art_director')?.tools
      .includes('image_generation'));
    const memoryScope = worldScope(f.service);
    const facts = f.service.readMemoryFacts(memoryScope, {
      actorId: 'actor_a',
      nature: 'canon',
      limit: 10,
    });
    assert.deepEqual(facts.items, []);
    assert.equal(facts.total, 0);
    assert.equal(facts.nextOffset, null);
    assert.equal(facts.actorId, 'actor_a');
    const entries = f.service.readMemoryEntries(memoryScope, {
      kind: 'setting',
      status: 'confirmed',
      limit: 10,
    });
    assert.deepEqual(entries.items, []);
    assert.equal(entries.total, 0);
    assert.equal(entries.nextOffset, null);
    assert.equal(
      (f.database.connection.prepare('SELECT COUNT(*) AS count FROM co_roles').get() as { count: number }).count,
      9,
    );
    const core = roles.find((role) => role.id === 'production_manager')!;
    assert.throws(
      () => f.service.saveRole({ ...core, core: false }),
      (error: unknown) => (error as { code?: string }).code === 'creative_role_core_immutable',
    );
    const professional = roles.find((role) => role.id === 'lead_writer')!;
    assert.throws(
      () => f.service.saveRole({ ...professional, tools: ['unregistered_tool'] }),
      (error: unknown) => (error as { code?: string }).code === 'creative_role_tool_unregistered',
    );

    const artDirector = roles.find((role) => role.id === 'art_director')!;
    f.service.saveRole({
      ...core,
      tools: core.tools.filter((tool) => tool !== 'video_plan'),
    });
    f.service.saveRole({
      ...artDirector,
      tools: artDirector.tools.filter((tool) => tool !== 'image_generation'),
    });
    assert.equal(f.service.roles().items
      .find((role) => role.id === 'production_manager')?.tools
      .includes('video_plan'), false);
    assert.equal(f.service.roles().items
      .find((role) => role.id === 'art_director')?.tools
      .includes('image_generation'), false);
    const second = new CreativeService({
      config: f.config,
      database: f.database,
      secrets: new SecretStore({}),
      executor: reviewExecutor(),
    });
    assert.equal(second.roles().items.length, 9);
    assert.equal(second.workflows().items.length, workflows.length);
    assert.equal(second.roles().items
      .find((role) => role.id === 'production_manager')?.tools
      .includes('video_plan'), false);
    assert.equal(second.roles().items
      .find((role) => role.id === 'art_director')?.tools
      .includes('image_generation'), false);
  } finally {
    f.database.close();
  }
});

test('run preflight rejects unregistered tools and explicit roles without tool authorization', async () => {
  const f = fixture();
  try {
    freezeRoles(f.service);
    const video = workflow(f.service, '视频方案创作');
    const authorized = await f.service.startRun(
      runInput(video, projectScope(f.service), 'service_video_tool_authorized'),
    );
    assert.ok(authorized.roleSnapshot
      .find((role) => role.id === 'production_manager')?.tools
      .includes('video_plan'));
    assert.equal(
      (f.database.connection.prepare(
        'SELECT COUNT(*) AS count FROM co_run_models WHERE run_id=? AND role_id=?',
      ).get(authorized.id, 'production_manager') as { count: number }).count,
      1,
    );

    const unauthorizedDocument = structuredClone(video.document);
    unauthorizedDocument.name = '未授权视频工具测试';
    const unauthorizedNode = unauthorizedDocument.nodes
      .find((node) => node.id === 'video_plan')!;
    unauthorizedNode.roleId = 'lead_writer';
    const unauthorizedDraft = f.service.createWorkflow(unauthorizedDocument);
    const unauthorizedVersion = f.service.publishWorkflow(
      unauthorizedDraft.id,
      unauthorizedDraft.revision,
    );
    await assert.rejects(
      () => f.service.startRun(runInput({
        ...unauthorizedDraft,
        publishedVersion: unauthorizedVersion.version,
      }, projectScope(f.service), 'service_video_tool_forbidden')),
      (error: unknown) => (error as { code?: string }).code === 'creative_tool_forbidden',
    );

    const unregisteredDocument = structuredClone(video.document);
    unregisteredDocument.name = '未登记工具测试';
    unregisteredDocument.nodes.find((node) => node.id === 'video_plan')!
      .config.tool = 'knowledge_search';
    const unregisteredDraft = f.service.createWorkflow(unregisteredDocument);
    const unregisteredVersion = f.service.publishWorkflow(
      unregisteredDraft.id,
      unregisteredDraft.revision,
    );
    await assert.rejects(
      () => f.service.startRun(runInput({
        ...unregisteredDraft,
        publishedVersion: unregisteredVersion.version,
      }, projectScope(f.service), 'service_tool_unregistered')),
      (error: unknown) => (error as { code?: string }).code === 'creative_tool_unregistered',
    );
  } finally {
    f.database.close();
  }
});

test('dynamic roles derive capability and tools from controlled templates without creating core roles', async () => {
  const f = fixture();
  let app: ReturnType<typeof Fastify> | null = null;
  try {
    app = Fastify({ logger: false });
    registerCreativeOrchestrationRoutes(app, f.config, f.service);
    await app.ready();
    const payload = {
      templateId: 'research_specialist',
      id: 'world_lore_researcher',
      name: '  世界考据员  ',
      modelId: 'text-model-two',
    };
    const unauthorized = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/creative-orchestration/roles/from-template',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    assert.equal(unauthorized.statusCode, 401);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/creative-orchestration/roles/from-template',
      headers: {
        'content-type': 'application/json',
        'x-sthstart-admin-token': ADMIN,
      },
      payload,
    });
    assert.equal(created.statusCode, 201, created.body);
    const derived = JSON.parse(created.body) as CreativeRole;
    assert.equal(derived.id, 'world_lore_researcher');
    assert.equal(derived.name, '世界考据员');
    assert.equal(derived.core, false);
    assert.equal(derived.capability, 'text');
    assert.equal(derived.modelId, 'text-model-two');
    assert.deepEqual(derived.tools, ['knowledge_search', 'web_search']);

    assert.throws(
      () => f.service.saveRole({ ...derived, core: true }),
      (error: unknown) => (error as { code?: string }).code === 'creative_role_core_immutable',
    );
    const savedWithoutSearchTools = f.service.saveRole({
      ...derived,
      tools: ['video_plan'],
    });
    assert.deepEqual(savedWithoutSearchTools.tools, [
      'video_plan',
      'knowledge_search',
      'web_search',
    ]);
    assert.throws(
      () => f.service.saveRole({ ...savedWithoutSearchTools, tools: ['not_registered'] }),
      (error: unknown) => (error as { code?: string }).code === 'creative_role_tool_unregistered',
    );
    await assert.rejects(
      () => f.service.createRoleFromTemplate({
        templateId: 'missing_template',
        id: 'missing_role',
        name: '缺失岗位',
      }),
      (error: unknown) => (error as { code?: string }).code === 'creative_role_template_not_found',
    );
    await assert.rejects(
      () => f.service.createRoleFromTemplate({
        templateId: 'art_director',
        id: 'wrong_vision_role',
        name: '错误看图岗位',
        modelId: 'text-model',
      }),
      (error: unknown) => (error as { code?: string }).code === 'creative_model_unconfigured',
    );
  } finally {
    if (app) await app.close();
    else await f.service.close();
    f.database.close();
  }
});

test('admin scope policy reads defaults, enforces CAS, and accepts only adopted same-scope scenes', async () => {
  const f = fixture();
  let app: ReturnType<typeof Fastify> | null = null;
  try {
    freezeRoles(f.service);
    const scope = worldScope(f.service);
    const story = workflow(f.service, '故事场景创作');
    const run = await f.service.startRun(runInput(
      story,
      scope,
      'service_scope_policy_evidence',
    ));
    const paused = f.service.store.updateRun(
      run.id,
      { status: 'paused' },
      run.revision,
    );
    const context = f.service.readContext(scope);
    const contextNode = f.service.store.ensureNode(paused.id, 'story_context', 0, {});
    const contextArtifact = f.service.store.putArtifact(contextNode.id, 'context', context, []);
    const sceneNode = f.service.store.ensureNode(paused.id, 'story_writer_scene', 0, {});
    const sceneArtifact = f.service.store.putArtifact(
      sceneNode.id,
      'scene',
      safeScene(context),
      [contextArtifact.id],
    );
    const approvalNode = f.service.store.ensureNode(paused.id, 'story_approval', 0, {});
    const candidateApproval = f.service.store.requestApproval(
      approvalNode.id,
      [sceneArtifact.id],
    );
    const approved = f.service.store.decideApproval(candidateApproval.id, {
      expectedRevision: candidateApproval.revision,
      bundleHash: candidateApproval.bundleHash,
      decision: 'approve',
      comment: '人工采用本场景',
    });

    app = Fastify({ logger: false });
    registerCreativeOrchestrationRoutes(app, f.config, f.service);
    await app.ready();
    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/creative-orchestration/scope-policy?scope=${encodeURIComponent(JSON.stringify(scope))}`,
      headers: {
        'x-sthstart-admin-token': ADMIN,
      },
    });
    assert.equal(read.statusCode, 200, read.body);
    assert.deepEqual(read.json(), {
      scope,
      policy: {
        schemaVersion: 1,
        enabled: false,
        kind: 'ordinary_image',
        allowedSceneArtifactIds: [],
      },
      revision: 0,
      updatedAt: null,
    });

    const unauthorized = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/creative-orchestration/scope-policy',
      headers: { 'content-type': 'application/json' },
      payload: {
        scope,
        expectedRevision: 0,
        policy: {
          schemaVersion: 1,
          enabled: true,
          kind: 'ordinary_image',
          allowedSceneArtifactIds: [sceneArtifact.id],
        },
      },
    });
    assert.equal(unauthorized.statusCode, 401);

    const candidateOnly = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/creative-orchestration/scope-policy',
      headers: {
        'content-type': 'application/json',
        'x-sthstart-admin-token': ADMIN,
      },
      payload: {
        scope,
        expectedRevision: 0,
        policy: {
          schemaVersion: 1,
          enabled: true,
          kind: 'ordinary_image',
          allowedSceneArtifactIds: [sceneArtifact.id],
        },
      },
    });
    assert.equal(candidateOnly.statusCode, 409);
    assert.equal(candidateOnly.json().error, 'creative_policy_scene_ineligible');

    f.service.store.setArtifactStatus(sceneArtifact.id, 'accepted');
    const otherScope = worldScope(f.service, '另一个预写世界');
    const wrongScope = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/creative-orchestration/scope-policy',
      headers: {
        'content-type': 'application/json',
        'x-sthstart-admin-token': ADMIN,
      },
      payload: {
        scope: otherScope,
        expectedRevision: 0,
        policy: {
          schemaVersion: 1,
          enabled: true,
          kind: 'ordinary_image',
          allowedSceneArtifactIds: [sceneArtifact.id],
        },
      },
    });
    assert.equal(wrongScope.statusCode, 409);
    assert.equal(wrongScope.json().error, 'creative_policy_scene_ineligible');

    f.database.connection.prepare(
      `INSERT INTO co_scene_adoptions
       (artifact_id,run_id,approval_id,result_json,created_at) VALUES (?,?,?,?,?)`,
    ).run(
      sceneArtifact.id,
      paused.id,
      approved.id,
      JSON.stringify({ artifactId: sceneArtifact.id }),
      nowIso(),
    );
    const putInput = {
      scope,
      expectedRevision: 0,
      policy: {
        schemaVersion: 1 as const,
        enabled: true,
        kind: 'ordinary_image' as const,
        allowedSceneArtifactIds: [sceneArtifact.id],
      },
    };
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/creative-orchestration/scope-policy',
      headers: {
        'content-type': 'application/json',
        'x-sthstart-admin-token': ADMIN,
      },
      payload: putInput,
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().revision, 1);
    assert.deepEqual(saved.json().policy, putInput.policy);

    const stale = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/creative-orchestration/scope-policy',
      headers: {
        'content-type': 'application/json',
        'x-sthstart-admin-token': ADMIN,
      },
      payload: putInput,
    });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().error, 'creative_policy_conflict');
  } finally {
    if (app) await app.close();
    else await f.service.close();
    f.database.close();
  }
});

test('normal start freezes models atomically and idempotent retry reuses the saved role snapshot', async () => {
  const f = fixture();
  try {
    freezeRoles(f.service);
    const scope = projectScope(f.service);
    const story = workflow(f.service, '故事场景创作');
    const criticalStory = workflow(f.service, '重要剧情精修（导演+双审）');
    const criticalDry = await f.service.dryRunWorkflow(criticalStory.document);
    assert.ok(criticalDry.estimatedCalls.minTextCalls >= 4);
    const input = runInput(story, scope, 'service_start_freeze');
    const first = await f.service.startRun(input);
    const rows = f.database.connection.prepare(
      'SELECT role_id,profile_id,profile_hash FROM co_run_models WHERE run_id=? ORDER BY role_id',
    ).all(first.id) as Array<{ role_id: string; profile_id: string; profile_hash: string }>;
    assert.deepEqual(
      rows.map((row) => row.role_id),
      ['continuity_editor', 'creative_director', 'lead_writer'],
    );
    assert.ok(rows.every((row) => row.profile_id === 'text-model'));
    assert.ok(rows.every((row) => /^[a-f0-9]{64}$/.test(row.profile_hash)));

    const leadWriter = f.service.roles().items.find((role) => role.id === 'lead_writer')!;
    f.service.saveRole({ ...leadWriter, modelId: 'text-model-two' });
    const replay = await f.service.startRun(input);
    assert.equal(replay.id, first.id);
    assert.equal(replay.roleSnapshot.find((role) => role.id === 'lead_writer')?.modelId, 'text-model');
    assert.equal(
      (f.database.connection.prepare('SELECT COUNT(*) AS count FROM co_runs').get() as { count: number }).count,
      1,
    );

    const profile = {
      id: 'text-model', name: 'text', baseUrl: 'https://provider.invalid/v1',
      model: 'model', secret: 'never-store-this', thinkingMode: 'omit' as const,
      capabilities: ['text' as const], headers: {}, extraBody: {},
    };
    assert.equal(
      profileFingerprint(profile),
      profileFingerprint({ ...profile, secret: 'different-secret' }),
    );
  } finally {
    f.database.close();
  }
});

test('speculation records the real waiting parent run and rejects scope, chain, and duplicate parents', async () => {
  const f = fixture();
  try {
    freezeRoles(f.service);
    const scope = worldScope(f.service);
    const story = workflow(f.service, '故事场景创作');
    const parentInput = runInput(story, scope, 'service_speculation_parent', {
      maxTextCalls: 9,
      maxImages: 2,
      maxTokens: 9000,
      maxRevisions: 1,
    });
    const context = f.service.readContext(scope);
    const roles = f.service.roles().items;
    const parent = f.service.store.startRun(parentInput, roles);
    const contextNode = f.service.store.ensureNode(parent.id, 'story_context', 0, {});
    const contextArtifact = f.service.store.putArtifact(contextNode.id, 'context', context, []);
    f.service.store.patchNode(contextNode.id, {
      status: 'succeeded',
      outputArtifactId: contextArtifact.id,
    });
    const node = f.service.store.ensureNode(parent.id, 'story_writer_scene', 0, {});
    const candidate = f.service.store.putArtifact(
      node.id,
      'scene',
      safeScene(context),
      [contextArtifact.id],
    );
    f.service.store.updateRun(parent.id, { status: 'waiting_approval' }, parent.revision);

    const childInput = runInput(story, scope, 'service_speculation_child', {
      maxTextCalls: 3,
      maxImages: 0,
      maxTokens: 3000,
      maxRevisions: 1,
    });
    childInput.input = { candidateArtifactId: candidate.id };
    const child = await f.service.startRun(childInput);
    assert.equal(child.parentRunId, parent.id);
    assert.equal(child.status, 'queued');
    assert.equal(child.scope.projectId, scope.projectId);
    assert.equal(child.budget.maxTextCalls, 3);
    assert.equal(f.service.store.getRun(parent.id)?.budget.maxTextCalls, 9);
    f.service.domain.collectCreativeContext(child);

    const duplicate = runInput(story, scope, 'service_speculation_duplicate');
    duplicate.input = { candidateArtifactId: candidate.id };
    await assert.rejects(
      () => f.service.startRun(duplicate),
      (error: unknown) => (error as { code?: string }).code === 'creative_speculation_limit',
    );

    const otherScope = projectScope(f.service);
    const escaped = runInput(story, otherScope, 'service_speculation_scope_escape');
    escaped.input = { candidateArtifactId: candidate.id };
    await assert.rejects(
      () => f.service.startRun(escaped),
      (error: unknown) => (error as { code?: string }).code === 'creative_scope_mismatch',
    );

    const chainedNode = f.service.store.ensureNode(parent.id, 'story_writer_scene', 1, {});
    const chainedCandidate = f.service.store.putArtifact(chainedNode.id, 'scene', {
      scope,
      speculation: { parentArtifactId: candidate.id, parentHash: candidate.contentHash },
    }, []);
    const chainedInput = runInput(story, scope, 'service_speculation_chain');
    chainedInput.input = { candidateArtifactId: chainedCandidate.id };
    await assert.rejects(
      () => f.service.startRun(chainedInput),
      (error: unknown) => (error as { code?: string }).code === 'creative_speculation_depth',
    );
  } finally {
    f.database.close();
  }
});

test('admin recovery is wired to runtime.recover and unavailable to unauthenticated callers', async () => {
  const f = fixture();
  let app: ReturnType<typeof Fastify> | null = null;
  try {
    const scope = projectScope(f.service);
    const story = workflow(f.service, '故事场景创作');
    freezeRoles(f.service);
    const run = await f.service.startRun(runInput(story, scope, 'service_recovery'));
    const node = f.service.store.ensureNode(run.id, 'story_context', 0, {});
    const dispatchedAt = '2026-11-17T00:00:00.000Z';
    f.service.store.patchNode(node.id, {
      status: 'uncertain',
      error: '供应商结果未知。',
      dispatchedAt,
    });
    f.service.store.updateRun(run.id, { status: 'uncertain' }, run.revision);

    app = Fastify({ logger: false });
    registerCreativeOrchestrationRoutes(app, f.config, f.service);
    await app.ready();
    await f.service.runtime.tick(run.id);
    const current = f.service.store.getRun(run.id)!;
    const path = `/api/v1/admin/creative-orchestration/runs/${run.id}/nodes/${node.id}/recover`;
    const unauthorized = await app.inject({
      method: 'POST',
      url: path,
      headers: { 'content-type': 'application/json' },
      payload: {
        expectedRevision: current.revision,
        resolution: 'not_executed',
        note: '人工核对供应商请求没有发出',
      },
    });
    assert.equal(unauthorized.statusCode, 401);
    const polluted = await app.inject({
      method: 'POST',
      url: path,
      headers: {
        'content-type': 'application/json',
        'x-sthstart-admin-token': ADMIN,
      },
      payload: JSON.stringify({
        expectedRevision: current.revision,
        resolution: 'not_executed',
        note: '人工核对供应商请求没有发出',
        ['__proto__']: { polluted: true },
      }),
    });
    assert.equal(polluted.statusCode, 400);
    assert.ok(!Object.hasOwn(Object.prototype, 'polluted'));
    const recovered = await app.inject({
      method: 'POST',
      url: path,
      headers: {
        'content-type': 'application/json',
        'x-sthstart-admin-token': ADMIN,
      },
      payload: {
        expectedRevision: current.revision,
        resolution: 'not_executed',
        note: '人工核对供应商请求没有发出',
      },
    });
    assert.equal(recovered.statusCode, 200, recovered.body);
    const detail = f.service.run(run.id);
    const attempted = detail.nodes.find((entry) => entry.id === node.id)!;
    assert.equal(attempted.status, 'skipped');
    assert.equal(attempted.dispatchedAt, dispatchedAt);
    const retry = detail.nodes.find((entry) =>
      entry.nodeId === node.nodeId && entry.attempt === 1);
    assert.ok(retry);
    assert.notEqual(retry.id, node.id);
    assert.equal(retry.status, 'pending');
    assert.equal(detail.run.status, 'paused');
  } finally {
    if (app) await app.close();
    else await f.service.close();
    f.database.close();
  }
});

test('external candidate stays paused without models, then admin activation freezes models and budget before review', async () => {
  const f = fixture(reviewExecutor());
  let app: ReturnType<typeof Fastify> | null = null;
  try {
    freezeRoles(f.service);
    const scope = projectScope(f.service);
    const context = f.service.readContext(scope);
    const candidate: CreativeAgentCandidateSubmission = {
      idempotencyKey: 'service_external_visual',
      scope,
      kind: 'visual-brief',
      content: {
        title: '码头视觉简报',
        brief: '雨夜蓝灰色调，保留人物服装与港口空间关系。',
        importance: 'ordinary',
      },
      contextHash: context.contextHash,
    };
    const submitted = await f.service.submitCandidate(candidate);
    const replay = await f.service.submitCandidate(candidate);
    assert.equal(submitted.candidate.status, 'candidate');
    assert.equal(submitted.review.status, 'pending');
    assert.equal(replay.replayed, true);
    assert.equal(replay.candidate.id, submitted.candidate.id);
    const paused = f.service.store.getRun(submitted.candidate.runId)!;
    assert.equal(paused.status, 'paused');
    assert.ok(paused.roleSnapshot.every((role) => role.modelId === null));
    assert.equal(
      (f.database.connection.prepare(
        'SELECT COUNT(*) AS count FROM co_run_models WHERE run_id=?',
      ).get(paused.id) as { count: number }).count,
      0,
    );
    assert.throws(
      () => f.service.resumeRun(paused.id, paused.revision),
      (error: unknown) => (error as { code?: string }).code === 'creative_candidate_activation_required',
    );

    app = Fastify({ logger: false });
    registerCreativeOrchestrationRoutes(app, f.config, f.service);
    await app.ready();
    const activated = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/creative-orchestration/runs/${paused.id}/activate`,
      headers: {
        'content-type': 'application/json',
        'x-sthstart-admin-token': ADMIN,
      },
      payload: {
        expectedRevision: paused.revision,
        budget: {
          maxTextCalls: 3,
          maxImages: 0,
          maxTokens: 1000,
          maxRevisions: 0,
        },
      },
    });
    assert.equal(activated.statusCode, 200, activated.body);
    await f.service.runtime.tick(paused.id);
    const detail = f.service.run(paused.id);
    assert.ok(
      ['queued', 'running', 'waiting_approval'].includes(detail.run.status),
      `${detail.run.status}: ${detail.run.error}; nodes=${detail.nodes.map((node) => `${node.nodeId}:${node.status}:${node.error ?? ''}`).join(',')}`,
    );
    assert.equal(detail.run.budget.maxTextCalls, 3);
    assert.ok(detail.run.roleSnapshot
      .filter((role) => ['art_director', 'visual_reviewer'].includes(role.id))
      .every((role) => role.modelId === 'vision-model'));
    assert.equal(
      (f.database.connection.prepare(
        'SELECT COUNT(*) AS count FROM co_run_models WHERE run_id=?',
      ).get(paused.id) as { count: number }).count,
      2,
    );
    if (detail.run.status === 'waiting_approval') {
      assert.ok(detail.approvals.some((approval) => approval.status === 'pending'));
    }
  } finally {
    if (app) await app.close();
    else await f.service.close();
    f.database.close();
  }
});

test('video-plan activation imports from a non-review role and reaches two independent reviews', async () => {
  const f = fixture(reviewExecutor());
  let app: ReturnType<typeof Fastify> | null = null;
  try {
    freezeRoles(f.service);
    const scope = projectScope(f.service);
    const context = f.service.readContext(scope);
    const candidate: CreativeAgentCandidateSubmission = {
      idempotencyKey: 'service_external_video_plan',
      scope,
      kind: 'video-plan',
      content: {
        title: '码头镜头方案',
        brief: '从雨夜全景推进到人物近景，再以船只离港收束。',
        shots: [
          { phase: 'establishing', description: '雨夜港口全景' },
          { phase: 'action', description: '人物在码头停步' },
          { phase: 'result', description: '船只离港' },
        ],
      },
      contextHash: context.contextHash,
    };
    const submitted = await f.service.submitCandidate(candidate);
    const paused = f.service.store.getRun(submitted.candidate.runId)!;
    const version = f.service.store.getVersion(paused.workflowId, paused.workflowVersion)!;
    const nodes = version.document.nodes;
    assert.equal(nodes.find((node) => node.id === 'external_candidate')?.roleId, 'production_manager');
    assert.deepEqual(
      nodes.sort((left, right) => left.id.localeCompare(right.id))
        .filter((node) => node.id.startsWith('external_review_'))
        .map((node) => node.roleId)
        .sort(),
      ['art_director', 'creative_director'],
    );

    app = Fastify({ logger: false });
    registerCreativeOrchestrationRoutes(app, f.config, f.service);
    await app.ready();
    const activated = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/creative-orchestration/runs/${paused.id}/activate`,
      headers: {
        'content-type': 'application/json',
        'x-sthstart-admin-token': ADMIN,
      },
      payload: {
        expectedRevision: paused.revision,
        budget: {
          maxTextCalls: 2,
          maxImages: 0,
          maxTokens: 1000,
          maxRevisions: 0,
        },
      },
    });
    assert.equal(activated.statusCode, 200, activated.body);
    await f.service.runtime.tick(paused.id);
    const detail = f.service.run(paused.id);
    assert.equal(
      detail.run.status,
      'waiting_approval',
      `${detail.run.status}: ${detail.run.error}; nodes=${detail.nodes.map((node) => `${node.nodeId}:${node.status}:${node.error ?? ''}`).join(',')}`,
    );
    assert.equal(detail.artifacts.filter((artifact) => artifact.kind === 'review').length, 2);
    assert.ok(detail.artifacts
      .filter((artifact) => artifact.kind === 'review')
      .every((artifact) => artifact.content.verdict === 'approved'));
    assert.equal(
      (f.database.connection.prepare(
        'SELECT COUNT(*) AS count FROM co_run_models WHERE run_id=? AND role_id=?',
      ).get(paused.id, 'production_manager') as { count: number }).count,
      0,
    );
  } finally {
    if (app) await app.close();
    else await f.service.close();
    f.database.close();
  }
});

test('scene candidates require the exact domain context and reject post-hoc or author-critical direction bypass', async () => {
  const f = fixture();
  try {
    freezeRoles(f.service);
    const scope = projectScope(f.service);
    const context = f.service.readContext(scope);
    const forged = await f.service.submitCandidate({
      idempotencyKey: 'service_scene_forged_context',
      scope,
      kind: 'scene',
      content: safeScene({ ...context, contextHash: '0'.repeat(64) }),
      contextHash: '0'.repeat(64),
    }).then(() => null, (error: unknown) => error as { code?: string });
    assert.equal(forged?.code, 'creative_context_mismatch');

    const bypass = await f.service.submitCandidate({
      idempotencyKey: 'service_scene_direction_bypass',
      scope,
      kind: 'scene',
      content: safeScene(context, 'fabricated_approval'),
      contextHash: context.contextHash,
    }).then(() => null, (error: unknown) => error as { code?: string });
    assert.equal(bypass?.code, 'creative_external_direction_approval');
    assert.equal(
      (f.database.connection.prepare(
        'SELECT COUNT(*) AS count FROM co_external_candidates',
      ).get() as { count: number }).count,
      0,
    );
  } finally {
    f.database.close();
  }
});

test('image media preflight requires a published image workflow; conversation is persistent and never starts a run', async () => {
  const f = fixture();
  try {
    freezeRoles(f.service);
    const scope = projectScope(f.service);
    const illustration = workflow(f.service, '插图生成与审查');
    const at = nowIso();
    f.database.connection.prepare(
      `INSERT INTO generation_engines
        (id,name,kind,base_url,credential_account,enabled,concurrency_limit,created_at,updated_at)
       VALUES ('service-image-engine','Image','comfyui','http://127.0.0.1:8188',NULL,1,1,?,?)`,
    ).run(at, at);
    f.database.connection.prepare(
      `INSERT INTO generation_workflows
        (id,name,description,engine_kind,latest_version,created_at,updated_at,category)
       VALUES ('service-image-workflow','Image workflow','','comfyui',1,?,?,'image')`,
    ).run(at, at);
    f.database.connection.prepare(
      `INSERT INTO generation_workflow_versions
        (workflow_id,version,engine_id,input_schema_json,node_bindings_json,
         output_declarations_json,definition_json,is_published,created_at)
       VALUES ('service-image-workflow',1,'service-image-engine',?,'{}','[]','{}',0,?)`,
    ).run(JSON.stringify({ prompt: { type: 'string', semantic: 'positive_prompt' } }), at);
    const mediaInput = runInput(illustration, scope, 'service_media_unpublished', {
      maxTextCalls: 3,
      maxImages: 1,
      maxTokens: 3000,
      maxRevisions: 1,
    });
    mediaInput.input = {
      media: { workflowId: 'service-image-workflow', workflowVersion: 1, inputs: {}, references: [] },
    };
    await assert.rejects(
      f.service.startRun(mediaInput),
      (error: unknown) => (error as { code?: string }).code === 'creative_media_workflow_invalid',
    );
    f.database.connection.prepare(
      "UPDATE generation_workflow_versions SET is_published=1 WHERE workflow_id='service-image-workflow' AND version=1",
    ).run();
    mediaInput.idempotencyKey = 'service_media_published';
    const run = await f.service.startRun(mediaInput);
    assert.equal(run.status, 'queued');

    const request: CreativeMessageRequest = {
      scope,
      message: '请建议一个插图审核流程。',
    };
    const message = await f.service.message(request);
    assert.ok(message.proposal);
    assert.equal(message.proposal?.workflowId, illustration.id);
    const conversation = f.service.conversation(message.conversationId);
    assert.equal(conversation.messages.length, 2);
    assert.match(conversation.messages[1].content, /未调用模型/);
    assert.equal(
      (f.database.connection.prepare('SELECT COUNT(*) AS count FROM co_runs').get() as { count: number }).count,
      1,
    );
  } finally {
    f.database.close();
  }
});

test('AI conversation starts a frozen assistant run with server catalog and idempotent persistent messages', async () => {
  const f = fixture();
  try {
    freezeRoles(f.service);
    const scope: CreativeScope = {
      workName: null,
      worldId: null,
      branchId: null,
      projectId: null,
    };
    const budget: CreativeBudget = {
      maxTextCalls: 2,
      maxImages: 0,
      maxTokens: 2000,
      maxRevisions: 0,
    };
    const request: CreativeMessageRequest = {
      scope,
      message: '请先帮我规划一个全新的原创作品，但不要直接执行。',
      mode: 'ai',
      budget,
      idempotencyKey: 'service_ai_conversation',
    };
    const first = await f.service.message(request);
    assert.ok(first.runId);
    assert.equal(first.proposal, null);
    assert.match(first.message.content, /运行已创建/);
    assert.match(first.message.content, /不表示.*已经完成/);

    const detail = f.service.run(first.runId!);
    assert.equal(detail.run.status, 'queued');
    assert.equal(detail.run.scope.workName, null);
    assert.equal(detail.run.input.conversationId, first.conversationId);
    assert.equal(detail.run.input.actionOrigin, 'admin-ui');
    assert.equal(detail.run.input.actionScope, 'global_work_create');
    const conversationMessages = detail.run.input.conversationMessages as Array<{
      role: string;
      content: string;
    }>;
    assert.deepEqual(conversationMessages, [{
      role: 'user',
      content: request.message,
    }]);
    const catalog = detail.run.input.assistantCatalog as {
      workflows: CreativeWorkflow[];
      actions: { tools: Array<{ tool: string; requiresApproval: boolean }> };
    };
    assert.ok(catalog.workflows.length > 0);
    assert.ok(catalog.workflows.every((workflow) =>
      workflow.publishedVersion >= 0
      && workflow.revision >= 1
      && workflow.document.nodes.length > 0));
    assert.ok(catalog.actions.tools.some((tool) =>
      tool.tool === 'work.create' && tool.requiresApproval));
    assert.doesNotMatch(JSON.stringify(catalog), /credential|secret|apiKey/i);
    assert.equal(
      f.service.roles().items.find((role) => role.id === 'production_manager')?.modelId,
      'text-model',
    );
    assert.equal(
      (f.database.connection.prepare(
        'SELECT COUNT(*) AS count FROM co_run_models WHERE run_id=?',
      ).get(detail.run.id) as { count: number }).count,
      1,
    );
    const conversation = f.service.conversation(first.conversationId);
    assert.equal(conversation.messages.length, 2);
    assert.equal(conversation.messages[0].content, request.message);

    const replay = await f.service.message(request);
    assert.equal(replay.runId, first.runId);
    assert.equal(replay.message.id, first.message.id);
    assert.equal(f.service.conversation(first.conversationId).messages.length, 2);
    assert.equal(
      (f.database.connection.prepare('SELECT COUNT(*) AS count FROM co_runs').get() as { count: number }).count,
      1,
    );

    const assistant = workflow(f.service, 'AI 创作总管对话');
    await assert.rejects(
      () => f.service.startRun({
        workflowId: assistant.id,
        workflowVersion: assistant.publishedVersion,
        idempotencyKey: 'service_ai_direct_bypass',
        scope,
        instruction: '绕过对话接口',
        budget,
        input: {
          assistantCatalog: { workflows: [], actions: { tools: [] } },
        },
      }),
      (error: unknown) => (error as { code?: string }).code === 'creative_message_required',
    );
    await assert.rejects(
      () => f.service.message({
        scope,
        message: '缺少预算和幂等键',
        mode: 'ai',
      }),
      (error: unknown) => (error as { code?: string }).code === 'creative_message_options_required',
    );
    assert.equal(
      (f.database.connection.prepare('SELECT COUNT(*) AS count FROM co_runs').get() as { count: number }).count,
      1,
    );
  } finally {
    f.database.close();
  }
});

test('AI conversation executes through the real executor with a server-built catalog and stops at human approval', async () => {
  const providerRequests: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.match(request.url, /\/chat\/completions$/);
    assert.match(
      request.headers.get('authorization') ?? '',
      new RegExp(TEST_PROVIDER_CREDENTIAL),
    );
    const body = request.body ? await request.clone().text() : '';
    providerRequests.push(body);
    return Response.json({
      choices: [{
        message: {
          content: JSON.stringify({
            kind: 'assistant-proposal',
            answer: '可以新建一个原创港口故事。先创建作品，再进入世界设定，不会自动执行。',
            intent: 'answer',
          }),
        },
      }],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 40,
        total_tokens: 160,
      },
    });
  };
  const f = fixture(undefined, fetcher);
  try {
    freezeRoles(f.service);
    const request: CreativeMessageRequest = {
      scope: {
        workName: null,
        worldId: null,
        branchId: null,
        projectId: null,
      },
      message: '我想新建一个原创港口故事，请先告诉我步骤。',
      mode: 'ai',
      budget: {
        maxTextCalls: 2,
        maxImages: 0,
        maxTokens: 100000,
        maxRevisions: 0,
      },
      idempotencyKey: 'service_ai_real_executor',
    };
    const message = await f.service.message(request);
    assert.ok(message.runId);
    await f.service.runtime.tick(message.runId!);
    const detail = f.service.run(message.runId!);
    assert.equal(
      detail.run.status,
      'completed',
      `${detail.run.status}: ${detail.run.error}; nodes=${detail.nodes.map((node) => `${node.nodeId}:${node.status}:${node.error ?? ''}`).join(',')}`,
    );
    assert.equal(providerRequests.length, 1);
    assert.match(providerRequests[0], /AI 创作总管对话|创作总管/);
    assert.match(providerRequests[0], /assistant-proposal/);
    assert.match(providerRequests[0], /work\.create/);
    assert.match(providerRequests[0], /我想新建一个原创港口故事/);
    assert.doesNotMatch(providerRequests[0], new RegExp(TEST_PROVIDER_CREDENTIAL));
    const plan = detail.artifacts.find((artifact) => artifact.kind === 'plan');
    assert.equal(plan?.content.kind, 'assistant-proposal');
    assert.equal(plan?.content.intent, 'answer');
    assert.match(String(plan?.content.answer), /先创建作品/);
    assert.equal(detail.approvals.length, 1);
    assert.equal(detail.approvals[0].status, 'approved');
    assert.equal(detail.run.usage.textCalls, 1);
    const conversation = f.service.conversation(message.conversationId);
    assert.equal(conversation.messages.length, 3);
    const assistantMessages = conversation.messages.filter((entry) =>
      entry.role === 'assistant');
    assert.equal(assistantMessages.length, 2);
    assert.match(assistantMessages.at(-1)?.content ?? '', /先创建作品/);
    const replay = await f.service.message(request);
    assert.equal(replay.runId, message.runId);
    assert.equal(f.service.conversation(message.conversationId).messages.length, 3);
  } finally {
    f.database.close();
  }
});

test('dry-run estimates stages and blockers without spending, and nl-edit returns a validated draft diff without mutating stored workflow', async () => {
  const requests: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    requests.push(body);
    const parsed = JSON.parse(body);
    const userPayload = JSON.parse(parsed.messages[1].content);
    const updated = structuredClone(userPayload.currentDocument);
    updated.name = '故事场景创作（慢节奏版）';
    updated.description = '按自然语言要求调整为更细致的对话节奏。';
    return Response.json({
      choices: [{
        message: {
          content: JSON.stringify({
            summary: '已将流程名称与说明调整为慢节奏版本，结构保持完整。',
            document: updated,
          }),
        },
      }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });
  };
  const f = fixture(undefined, fetcher);
  try {
    const story = workflow(f.service, '故事场景创作');
    const unconfiguredDryRun = await f.service.dryRunWorkflow(story.document);
    assert.equal(unconfiguredDryRun.valid, true);
    assert.equal(unconfiguredDryRun.ready, false);
    assert.ok(unconfiguredDryRun.blockers.length > 0);
    assert.ok(unconfiguredDryRun.stages.length >= 6);
    assert.equal(unconfiguredDryRun.estimatedCalls.minTextCalls, 3);
    assert.ok(unconfiguredDryRun.estimatedCalls.maxTextCalls > unconfiguredDryRun.estimatedCalls.minTextCalls);
    assert.equal(requests.length, 0);

    freezeRoles(f.service);
    const readyDryRun = await f.service.dryRunWorkflow(story.document);
    assert.equal(readyDryRun.ready, true);
    assert.deepEqual(readyDryRun.blockers, []);

    const edited = await f.service.nlEditWorkflow(story.id, {
      expectedRevision: story.revision,
      document: story.document,
      instruction: '把流程改成慢节奏细致对话版',
    });
    assert.equal(edited.validation.valid, true);
    assert.equal(edited.document.name, '故事场景创作（慢节奏版）');
    assert.equal(edited.usage.totalTokens, 150);
    assert.ok(edited.changes.length > 0);
    // Stored draft remains untouched until explicit CAS save.
    assert.equal(f.service.workflows().items.find((item) => item.id === story.id)?.document.name, '故事场景创作');

    const external = workflow(f.service, '外部场景候选审核');
    await assert.rejects(
      () => f.service.startRun(runInput(external, projectScope(f.service), 'direct_external_forbidden')),
      (error: unknown) => (error as { code?: string }).code === 'creative_external_workflow_reserved',
    );
  } finally {
    f.database.close();
  }
});

test('style guide, character voices, thread aging, lorebook activation and alternative branch run work end-to-end', async () => {
  const f = fixture();
  try {
    freezeRoles(f.service);
    const scope = projectScope(f.service);
    const savedPolicy = f.service.saveScopePolicy({
      scope,
      expectedRevision: 0,
      policy: {
        schemaVersion: 1,
        enabled: false,
        kind: 'ordinary_image',
        allowedSceneArtifactIds: [],
        styleGuide: {
          tone: '冷峻白描、对话交锋克制',
          bannedCliches: ['深吸一口气', '命运的齿轮'],
          styleSample: '码头起风了。他没有回头，只把烟蒂踩进湿石缝里。',
          pacingHint: '句尾不升华',
        },
        characterVoices: {
          lin: {
            voiceSamples: ['“账本不在我手里，你问错人了。”', '“把门带好，别让风灌进来。”'],
            mannerisms: '习惯用指节轻敲桌面',
            taboos: ['绝不连用两个形容词'],
          },
        },
      },
    });
    assert.equal(savedPolicy.revision, 1);

    const context = f.service.domain.collectScopeContext(scope, { instruction: '港口的密信与lin的对峙' });
    assert.equal(
      (context.data.creativeStyleGuide as { tone?: string }).tone,
      '冷峻白描、对话交锋克制',
    );
    assert.ok(Boolean((context.data.characterVoiceHints as Record<string, unknown>)?.lin));
    const longTerm = (context.data.project as { longTerm: { threadHealth: { pacingSignal: { suggestion: string } } } }).longTerm;
    assert.ok(longTerm.threadHealth.pacingSignal.suggestion.length > 0);

    const story = workflow(f.service, '故事场景创作');
    const run = await f.service.startRun(runInput(story, scope, 'alt_base_run'));
    const alt = await f.service.startAlternativeRun(run.id, {
      angle: '改为高冲突反转走向，两人当场摊牌',
      idempotencyKey: 'alt_branch_1',
    });
    assert.equal(alt.input.alternativeOfRunId, run.id);
    assert.match(alt.instruction, /高冲突反转走向/);
    assert.equal(alt.workflowId, run.workflowId);
  } finally {
    f.database.close();
  }
});
