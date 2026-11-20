import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { CreativeRole, CreativeRun } from '@sthstart/contracts';
import { readConfig } from '../config.js';
import { nowIso, ServiceDatabase } from '../database.js';
import { resolveEffectiveModelProfile } from '../providers.js';
import { SecretStore } from '../security.js';
import { StoryStore } from '../story/store.js';
import { CreativeDomain } from './domain.js';
import {
  CREATIVE_APP_ID,
  createCreativeExecutor,
  profileFingerprint,
} from './executor.js';
import { CreativeRuntime } from './runtime.js';
import { CreativeStore } from './store.js';
import {
  createDefaultCreativeRoles,
  createDefaultVideoPlanWorkflow,
} from './templates.js';
import {
  type CreativeVideoPlan,
  validateCreativeVideoPlan,
} from './video.js';

const MODEL_ID = 'creative-video-plan-model';
const FAKE_CREDENTIAL = 'video-test-isolated-credential';
const terminalStatuses = new Set<CreativeRun['status']>([
  'completed',
  'failed',
  'cancelled',
  'uncertain',
  'waiting_approval',
]);

class MemorySecrets extends SecretStore {
  override async status() {
    return { available: true, backend: 'memory', envFallback: false };
  }

  override async get(account: string) {
    return account === 'creative-video-plan-provider'
      ? { value: FAKE_CREDENTIAL, source: 'keyring' as const }
      : { value: null, source: 'none' as const };
  }

  override async set(): Promise<void> {}
  override async delete(): Promise<void> {}
}

function validPlan(overrides: Partial<CreativeVideoPlan> = {}): CreativeVideoPlan {
  return {
    kind: 'video-plan',
    title: '港口重逢',
    brief: '两名旧友在潮汐港口重逢。',
    shots: [{
      id: 'shot-1',
      durationSeconds: 2.5,
      description: '远景建立港口后切到两人对视。',
      dialogue: '“你终于回来了。”',
      visualPrompt: 'rain-soaked harbor, two friends, cinematic composition',
      camera: 'slow push-in',
      referenceArtifactIds: [],
    }],
    totalDurationSeconds: 2.5,
    requiresHumanApproval: true,
    executionStatus: 'planning_only',
    ...overrides,
  };
}

function installCreativeModel(database: ServiceDatabase): void {
  const now = nowIso();
  database.connection.prepare(
    `INSERT OR IGNORE INTO managed_apps
      (id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    CREATIVE_APP_ID,
    '视频方案测试应用',
    'creative-video-plan-isolated-token-hash',
    '["story","image","generation"]',
    1,
    now,
    now,
  );
  database.connection.prepare(
    `INSERT INTO service_connections
      (id,name,kind,base_url,credential_account,timeout_ms,headers_json,options_json,enabled,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,1,?,?)`,
  ).run(
    'creative-video-plan-connection',
    '视频方案 mock 模型',
    'openai-compatible-text',
    'http://video-plan.invalid/v1',
    'creative-video-plan-provider',
    1_000,
    '{}',
    '{}',
    now,
    now,
  );
  database.connection.prepare(
    `INSERT INTO model_profiles
      (id,connection_id,name,model_id,capabilities_json,default_params_json,advanced_json,
       test_status,enabled,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,'passed',1,?,?)`,
  ).run(
    MODEL_ID,
    'creative-video-plan-connection',
    '视频方案 mock 模型',
    'mock-video-plan',
    '["text","multimodal"]',
    '{}',
    '{"thinkingMode":"omit"}',
    now,
    now,
  );
}

function chatResponse(content: Record<string, unknown>): Response {
  return Response.json({
    choices: [{ message: { content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 },
  });
}

function createHarness(
  t: { after(callback: () => void | Promise<void>): void },
  responsePlan: Record<string, unknown> = validPlan(),
) {
  const artifactDirectory = mkdtempSync(join(tmpdir(), 'sthstart-video-plan-'));
  const database = new ServiceDatabase(':memory:');
  const config = readConfig({ STHSTART_ARTIFACT_DIR: artifactDirectory });
  const secrets = new MemorySecrets({});
  const store = new CreativeStore(database);
  const domain = new CreativeDomain(database);
  const roles: CreativeRole[] = createDefaultCreativeRoles()
    .map((role) => ({ ...role, modelId: MODEL_ID }));
  for (const role of roles) store.saveRole(role);
  installCreativeModel(database);

  const calls = { llm: 0 };
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.match(request.url, /\/chat\/completions$/);
    const body = JSON.parse(await request.text()) as {
      messages: Array<{
        role: string;
        content: string | Array<{ type?: string; text?: string }>;
      }>;
    };
    const system = body.messages.find((message) => message.role === 'system')?.content;
    const instruction = typeof system === 'string' ? system : '';
    assert.match(instruction, /完整视频分镜方案/);
    calls.llm += 1;
    assert.ok(request.headers.get('authorization')?.includes(FAKE_CREDENTIAL));
    return chatResponse(responsePlan);
  };

  t.after(() => {
    if (database.connection.isOpen) {
      try { database.close(); } catch {}
    }
    rmSync(artifactDirectory, { recursive: true, force: true });
  });

  async function startRun() {
    const project = new StoryStore(database).createProject({
      title: '视频方案执行测试',
      summary: '用于验证默认视频方案模板的隔离项目。',
    });
    const workflow = store.createWorkflow(createDefaultVideoPlanWorkflow());
    const version = store.publishWorkflow(workflow.id, workflow.revision);
    const run = store.startRun({
      workflowId: workflow.id,
      workflowVersion: version.version,
      idempotencyKey: `video-plan-${Date.now()}-${calls.llm}`,
      scope: {
        workName: null,
        worldId: null,
        branchId: null,
        projectId: project.id,
      },
      instruction: '制作一份完整、可人工审核的短视频分镜方案。',
      budget: {
        maxTextCalls: 1,
        maxImages: 0,
        maxTokens: 100_000,
        maxRevisions: 0,
      },
      input: { brief: '港口重逢，克制温暖。' },
    }, roles);
    for (const role of roles) {
      const profile = await resolveEffectiveModelProfile(
        database,
        secrets,
        CREATIVE_APP_ID,
        role.capability === 'multimodal' ? 'vision' : undefined,
        role.modelId ?? undefined,
      );
      assert.ok(profile);
      database.connection.prepare(
        `INSERT INTO co_run_models(run_id,role_id,profile_id,profile_hash)
         VALUES (?,?,?,?)`,
      ).run(run.id, role.id, profile.id, profileFingerprint(profile));
    }
    return { workflow, version, run };
  }

  const executor = createCreativeExecutor({
    config,
    database,
    secrets,
    store,
    domain,
    fetcher,
  });
  const runtime = new CreativeRuntime(store, executor, {
    pollIntervalMs: 10,
    leaseMs: 1_000,
    maxParallel: 1,
  });
  return { database, store, calls, runtime, startRun };
}

async function advance(
  runtime: CreativeRuntime,
  store: CreativeStore,
  runId: string,
) {
  for (let index = 0; index < 100; index += 1) {
    await runtime.tick(runId);
    const detail = store.detail(runId);
    if (terminalStatuses.has(detail.run.status)) return detail;
    await delay(10);
  }
  assert.fail('video-plan runtime did not settle');
}

test('video plan validator rejects empty shots, invalid schema, duration drift and duplicate ids', () => {
  assert.deepEqual(validateCreativeVideoPlan(validPlan()), validPlan());

  assert.throws(
    () => validateCreativeVideoPlan(validPlan({ shots: [], totalDurationSeconds: 1 })),
    /完整分镜/,
  );
  assert.throws(
    () => validateCreativeVideoPlan({
      ...validPlan(),
      executionStatus: 'completed',
    }),
    /完整分镜/,
  );
  assert.throws(
    () => validateCreativeVideoPlan({
      ...validPlan(),
      totalDurationSeconds: 3,
    }),
    /总时长必须与各镜头之和一致/,
  );

  const duplicate = validPlan();
  duplicate.shots.push({
    ...duplicate.shots[0]!,
    durationSeconds: 1,
  });
  duplicate.totalDurationSeconds = 3.5;
  assert.throws(
    () => validateCreativeVideoPlan(duplicate),
    /镜头编号必须唯一/,
  );
});

test('real executor runs the default video template through LLM, validation, approval and adoption', async (t) => {
  const f = createHarness(t);
  const started = await f.startRun();
  try {
    const waiting = await advance(f.runtime, f.store, started.run.id);
    assert.equal(
      waiting.run.status,
      'waiting_approval',
      `${waiting.run.status}: ${waiting.run.error}; ${waiting.nodes.map((node) =>
        `${node.nodeId}:${node.status}:${node.error ?? ''}`
      ).join(',')}`,
    );
    assert.equal(f.calls.llm, 1);

    const approval = waiting.approvals.find((item) => item.status === 'pending');
    assert.ok(approval);
    const approvalNode = waiting.nodes.find((node) => node.id === approval.nodeRunId);
    assert.equal(approvalNode?.nodeId, 'video_approval');
    const approvedArtifacts = approval.artifactIds.map((artifactId) =>
      waiting.artifacts.find((artifact) => artifact.id === artifactId)!
    );
    assert.ok(approvedArtifacts.some((artifact) => artifact.kind === 'context'));
    assert.ok(approvedArtifacts.some((artifact) => artifact.kind === 'plan'));

    const directorNode = waiting.nodes.find((node) => node.nodeId === 'video_director_plan')!;
    const toolNode = waiting.nodes.find((node) => node.nodeId === 'video_plan')!;
    const directorArtifact = waiting.artifacts.find((artifact) =>
      artifact.id === directorNode.outputArtifactId
    )!;
    const toolArtifact = waiting.artifacts.find((artifact) =>
      artifact.id === toolNode.outputArtifactId
    )!;
    assert.equal(toolArtifact.contentHash, directorArtifact.contentHash);
    assert.equal(toolArtifact.content.kind, 'video-plan');
    assert.ok(Array.isArray(toolArtifact.content.shots));
    assert.equal((toolArtifact.content.shots as unknown[]).length, 1);
    assert.equal(toolArtifact.content.totalDurationSeconds, 2.5);
    assert.equal(toolArtifact.content.executionStatus, 'planning_only');

    f.store.decideApproval(approval.id, {
      expectedRevision: approval.revision,
      bundleHash: approval.bundleHash,
      decision: 'approve',
      comment: '已核对实际分镜、时长和 planning_only 状态。',
    });
    const completed = await advance(f.runtime, f.store, started.run.id);
    assert.equal(completed.run.status, 'completed', completed.run.error ?? undefined);
    const adopted = completed.artifacts.find((artifact) =>
      artifact.kind === 'result' && artifact.runId === started.run.id
    );
    assert.equal(adopted?.content.executionStatus, 'plan_archived');
    assert.equal(f.calls.llm, 1);
  } finally {
    await f.runtime.close();
  }
});

test('video_plan rejects an unknown media reference before tool dispatch and approval', async (t) => {
  const invalidReference = validPlan();
  invalidReference.shots[0]!.referenceArtifactIds = ['unknown-reference'];
  const f = createHarness(t, invalidReference);
  const started = await f.startRun();
  try {
    const detail = await advance(f.runtime, f.store, started.run.id);
    assert.equal(detail.run.status, 'failed');
    assert.equal(detail.approvals.some((approval) => approval.status === 'pending'), false);
    const toolNode = detail.nodes.find((node) => node.nodeId === 'video_plan')!;
    assert.equal(toolNode.status, 'failed');
    assert.match(toolNode.error ?? '', /未授权的媒体/);
    assert.equal(toolNode.dispatchedAt, null);
    assert.equal(f.calls.llm, 1);
  } finally {
    await f.runtime.close();
  }
});
