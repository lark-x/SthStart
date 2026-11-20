import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { CreativeApproval, CreativeRole, CreativeRun } from '@sthstart/contracts';
import { readConfig } from '../config.js';
import { nowIso, ServiceDatabase } from '../database.js';
import { getGenerationTask } from '../generation/task-store.js';
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
  createDefaultIllustrationWorkflow,
  createDefaultStorySceneWorkflow,
} from './templates.js';

const FAKE_CREDENTIAL = 'executor-local-provider-credential';
const MODEL_ID = 'creative-executor-model';
const IMAGE_WORKFLOW_ID = 'creative-executor-image-workflow';
const IMAGE_ENGINE_ID = 'creative-executor-image-engine';
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const terminalRun = new Set<CreativeRun['status']>([
  'completed', 'failed', 'cancelled', 'uncertain', 'waiting_approval',
]);

class MemorySecrets extends SecretStore {
  override async status() {
    return { available: true, backend: 'memory', envFallback: false };
  }

  override async get(account: string) {
    return account === 'creative-executor-provider'
      ? { value: FAKE_CREDENTIAL, source: 'keyring' as const }
      : { value: null, source: 'none' as const };
  }

  override async set(): Promise<void> {}

  override async delete(): Promise<void> {}
}

type LlmMode = 'success' | 'timeout' | 'invalid-json' | 'client-refusal';

function responseFor(
  content: string | Record<string, unknown>,
  totalTokens: number | null = 20,
): Response {
  return Response.json({
    choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
    ...(totalTokens === null
      ? {}
      : { usage: { prompt_tokens: totalTokens, completion_tokens: 0, total_tokens: totalTokens } }),
  });
}

function llmPayload(bodyText: string) {
  const body = JSON.parse(bodyText) as {
    messages: Array<{ role: string; content: string | Array<{ type?: string; text?: string }> }>;
  };
  const system = body.messages.find((message) => message.role === 'system')?.content;
  const user = body.messages.find((message) => message.role === 'user')?.content;
  const promptText = typeof user === 'string'
    ? user
    : user?.find((part) => part.type === 'text')?.text ?? '{}';
  return {
    system: typeof system === 'string' ? system : '',
    payload: JSON.parse(promptText) as {
      context: Record<string, unknown>;
      inputs: Record<string, {
        artifactId: string;
        contentHash: string;
        kind: string;
        content: Record<string, unknown>;
      }>;
      revision?: unknown;
    },
  };
}

function targetInput(payload: ReturnType<typeof llmPayload>['payload']) {
  const inputs = Object.values(payload.inputs);
  for (const kind of ['image', 'scene', 'plan', 'visual-brief']) {
    const found = inputs.find((input) => input.kind === kind);
    if (found) return found;
  }
  throw new Error('mock LLM request has no review target');
}

function installCreativeModel(database: ServiceDatabase) {
  const now = nowIso();
  database.connection.prepare(
    `INSERT OR IGNORE INTO managed_apps
      (id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    CREATIVE_APP_ID,
    'AI 创作编排',
    'creative-executor-isolated-token-hash',
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
    'creative-executor-connection',
    'Fake creative LLM',
    'openai-compatible-text',
    'http://llm.invalid/v1',
    'creative-executor-provider',
    120,
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
    'creative-executor-connection',
    'Fake creative model',
    'fake-chat-model',
    '["text","multimodal"]',
    '{}',
    '{"thinkingMode":"omit"}',
    now,
    now,
  );
}

function installImageWorkflow(database: ServiceDatabase) {
  const now = nowIso();
  database.connection.prepare(
    `INSERT INTO generation_engines
      (id,name,kind,base_url,credential_account,enabled,concurrency_limit,created_at,updated_at)
     VALUES (?,?,?,?,?,1,1,?,?)`,
  ).run(IMAGE_ENGINE_ID, 'Fake cloud image', 'cloud', 'http://image.invalid/v1', null, now, now);
  database.connection.prepare(
    `INSERT INTO generation_workflows
      (id,name,description,engine_kind,category,latest_version,created_at,updated_at)
     VALUES (?,?,?,?,?,1,?,?)`,
  ).run(IMAGE_WORKFLOW_ID, 'Fake image workflow', '', 'cloud', 'image', now, now);
  database.connection.prepare(
    `INSERT INTO generation_workflow_versions
      (workflow_id,version,engine_id,input_schema_json,node_bindings_json,output_declarations_json,
       definition_json,is_published,created_at,input_capabilities_json,output_media_types_json,
       output_schema_json,config_format_version)
     VALUES (?,1,?,?,?,?,?,1,?,?,?,?,1)`,
  ).run(
    IMAGE_WORKFLOW_ID,
    IMAGE_ENGINE_ID,
    JSON.stringify({
      prompt: { semantic: 'positive_prompt', type: 'long-text', required: true },
      negativePrompt: { semantic: 'negative_prompt', type: 'long-text' },
    }),
    '{}',
    '["image"]',
    JSON.stringify({ type: 'cloud_recipe', model: 'fake-image-model' }),
    now,
    '{}',
    '["image/png"]',
    '{}',
  );
}

function createHarness(t: {
  after(callback: () => void | Promise<void>): void;
}) {
  const artifactDirectory = mkdtempSync(join(tmpdir(), 'sthstart-creative-executor-'));
  const database = new ServiceDatabase(':memory:');
  const config = readConfig({ STHSTART_ARTIFACT_DIR: artifactDirectory });
  const secrets = new MemorySecrets({});
  const store = new CreativeStore(database);
  const domain = new CreativeDomain(database);
  const roles: CreativeRole[] = createDefaultCreativeRoles()
    .map((role) => ({ ...role, modelId: MODEL_ID }));
  for (const role of roles) store.saveRole(role);
  installCreativeModel(database);

  let llmMode: LlmMode = 'success';
  let llmTotalTokens: number | null = 20;
  const calls = { llm: 0, image: 0 };
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = request.url;
    const bodyText = request.body ? await request.clone().text() : '';
    if (url.endsWith('/chat/completions')) {
      calls.llm++;
      if (!request.headers.get('authorization')?.includes(FAKE_CREDENTIAL)) {
        throw new Error('mock provider did not receive the isolated credential');
      }
      if (llmMode === 'timeout') {
        return await new Promise<Response>((_, reject) => {
          const abort = () => reject(request.signal.reason ?? new DOMException('timeout', 'TimeoutError'));
          if (request.signal.aborted) abort();
          else request.signal.addEventListener('abort', abort, { once: true });
        });
      }
      if (llmMode === 'invalid-json') return responseFor('this is not JSON');
      const respond = (content: string | Record<string, unknown>) =>
        responseFor(content, llmTotalTokens);
      const { system, payload } = llmPayload(bodyText);
      if (system.includes('criticalChanges')) {
        return respond({
          summary: '先写一个克制、完整、可审核的场景。',
          requiresDirectionApproval: false,
          criticalChanges: [],
          beats: [],
          newSettings: [],
          foreshadowing: [],
          visualMoments: [],
        });
      }
      if (system.includes('sourceRefs')) {
        const context = payload.context;
        return respond({
          schemaVersion: 1,
          title: '灯下的约定',
          body: '角色在灯下交换线索，随后决定第二天一起出发。',
          contextHash: context.contextHash,
          scope: context.scope,
          base: context.base,
          sourceRefs: [(context.sources as Array<{ id: string }>)[0].id],
          speculation: null,
          directionApprovalId: null,
          simulation: null,
          newSettings: [],
          foreshadowing: [],
        });
      }
      if (system.includes('targetArtifactId')) {
        if (llmMode === 'client-refusal') {
          return responseFor('本站仅限主流 Coding 客户端/CLI 使用。当前客户端不支持。', 1);
        }
        const target = targetInput(payload);
        return respond({
          verdict: 'approved',
          targetArtifactId: target.artifactId,
          targetHash: target.contentHash,
          issues: [],
          summary: '实际输入完整，未发现阻断问题。',
        });
      }
      if (system.includes('negativePrompt:string')) {
        return respond({
          prompt: 'A character under a quiet lamp, cinematic composition, consistent appearance.',
          negativePrompt: 'text, watermark, duplicate characters',
          brief: '灯下的关键场景',
          visualFacts: ['quiet lamp'],
          presentationChoices: ['medium shot'],
        });
      }
      throw new Error('unexpected creative LLM request');
    }
    if (url.includes('/images/generations')) {
      calls.image++;
      return Response.json({ data: [{ b64_json: PNG_1X1 }] });
    }
    return new Response('not found', { status: 404 });
  };

  t.after(() => {
    if (!database.connection.isOpen) return;
    try { database.close(); } catch {}
    rmSync(artifactDirectory, { recursive: true, force: true });
  });

  async function freeze(run: CreativeRun) {
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
  }

  async function startFromProject(
    document: ReturnType<typeof createDefaultStorySceneWorkflow>
      | ReturnType<typeof createDefaultIllustrationWorkflow>,
    input: Record<string, unknown>,
    budget: CreativeRun['budget'],
    instruction = '生成一个可执行的测试交付。',
  ) {
    const story = new StoryStore(database);
    const project = story.createProject({ title: '执行器测试作品', summary: '灯光下的约定。' });
    const workflow = store.createWorkflow(document);
    const version = store.publishWorkflow(workflow.id, workflow.revision);
    const run = store.startRun({
      workflowId: workflow.id,
      workflowVersion: version.version,
      idempotencyKey: `executor_run_${calls.llm}_${Date.now()}`,
      scope: {
        workName: null, worldId: null, branchId: null, projectId: project.id,
      },
      instruction,
      budget,
      input,
    }, roles);
    await freeze(run);
    return { story, project, workflow, version, run };
  }

  const executor = createCreativeExecutor({ config, database, secrets, store, domain, fetcher });
  const runtime = new CreativeRuntime(store, executor, {
    pollIntervalMs: 20,
    leaseMs: 1_000,
    maxParallel: 2,
  });
  return {
    artifactDirectory, database, config, secrets, store, domain, roles, fetcher, calls,
    setLlmMode(mode: LlmMode) { llmMode = mode; },
    setLlmTotalTokens(totalTokens: number | null) { llmTotalTokens = totalTokens; },
    freeze, startFromProject, executor, runtime,
  };
}

async function advance(
  runtime: CreativeRuntime,
  store: CreativeStore,
  runId: string,
) {
  for (let index = 0; index < 120; index++) {
    await runtime.tick(runId);
    const detail = store.detail(runId);
    if (terminalRun.has(detail.run.status)) return detail;
    await delay(10);
  }
  assert.fail('creative runtime did not settle');
}

function approvePending(store: CreativeStore, approval: CreativeApproval) {
  return store.decideApproval(approval.id, {
    expectedRevision: approval.revision,
    bundleHash: approval.bundleHash,
    decision: 'approve',
    comment: '测试中的人工审核已核对当前完整交付包。',
  });
}

test('default story workflow executes the real agent, review, human approval and adoption chain', async (t) => {
  const f = createHarness(t);
  const started = await f.startFromProject(
    createDefaultStorySceneWorkflow(),
    { criticalChange: false },
    { maxTextCalls: 20, maxImages: 0, maxTokens: 1_000_000, maxRevisions: 2 },
  );
  try {
    let detail = await advance(f.runtime, f.store, started.run.id);
    assert.equal(
      detail.run.status,
      'waiting_approval',
      JSON.stringify({
        error: detail.run.error,
        nodes: detail.nodes,
      }),
    );
    const approval = detail.approvals.find((item) => item.status === 'pending');
    assert.ok(approval);
    assert.equal(detail.artifacts.some((artifact) => artifact.kind === 'scene'), true);
    approvePending(f.store, approval);
    detail = await advance(f.runtime, f.store, started.run.id);
    assert.equal(detail.run.status, 'completed');
    assert.equal(
      started.story.listDocuments(started.project.id).some((document) =>
        document.kind === 'scene' && document.body.includes('灯下交换线索')
      ),
      true,
    );
    assert.equal(
      f.database.connection.prepare('SELECT COUNT(*) AS count FROM co_scene_adoptions').get()!.count,
      1,
    );
    assert.equal(f.calls.llm >= 4, true);
    const auditRows = [
      ...f.database.connection.prepare('SELECT * FROM ai_call_records').all(),
      ...f.database.connection.prepare('SELECT * FROM ai_call_events').all(),
    ];
    assert.equal(JSON.stringify(auditRows).includes(FAKE_CREDENTIAL), false);
  } finally {
    await f.runtime.close();
    f.database.close();
  }
});

test('text execution settles conservative token reservations to provider usage', async (t) => {
  for (const actualTokens of [10, 100]) {
    await t.test(`total_tokens ${actualTokens} replaces the UTF-8 byte reservation`, async () => {
      const f = createHarness(t);
      const started = await f.startFromProject(
        createDefaultStorySceneWorkflow(),
        { criticalChange: false },
        { maxTextCalls: 20, maxImages: 0, maxTokens: 1_000_000, maxRevisions: 2 },
      );
      f.setLlmTotalTokens(actualTokens);
      try {
        const detail = await advance(f.runtime, f.store, started.run.id);
        assert.equal(
          detail.run.status,
          'waiting_approval',
          JSON.stringify({ error: detail.run.error, nodes: detail.nodes }),
        );
        const reservations = f.database.connection.prepare(
          'SELECT node_run_id,reserved,actual,state FROM co_token_reservations WHERE run_id=?',
        ).all(started.run.id) as Array<{
          node_run_id: string;
          reserved: number;
          actual: number | null;
          state: string;
        }>;
        assert.equal(reservations.length, f.calls.llm);
        assert.equal(reservations.length >= 4, true);
        for (const reservation of reservations) {
          assert.equal(reservation.reserved > actualTokens, true);
          assert.equal(reservation.actual, actualTokens);
          assert.equal(reservation.state, 'settled');
        }
        assert.equal(detail.run.usage.tokens, actualTokens * f.calls.llm);
      } finally {
        await f.runtime.close();
        f.database.close();
      }
    });
  }
});

test('missing provider usage keeps the conservative reservation as unknown', async (t) => {
  const f = createHarness(t);
  const started = await f.startFromProject(
    createDefaultStorySceneWorkflow(),
    { criticalChange: false },
    { maxTextCalls: 20, maxImages: 0, maxTokens: 1_000_000, maxRevisions: 2 },
  );
  f.setLlmTotalTokens(null);
  try {
    const detail = await advance(f.runtime, f.store, started.run.id);
    assert.equal(
      detail.run.status,
      'waiting_approval',
      JSON.stringify({ error: detail.run.error, nodes: detail.nodes }),
    );
    const reservations = f.database.connection.prepare(
      'SELECT reserved,actual,state FROM co_token_reservations WHERE run_id=?',
    ).all(started.run.id) as Array<{
      reserved: number;
      actual: number | null;
      state: string;
    }>;
    assert.equal(reservations.length, f.calls.llm);
    assert.equal(reservations.length >= 4, true);
    for (const reservation of reservations) {
      assert.equal(reservation.actual, null);
      assert.equal(reservation.state, 'unknown');
    }
    const reservedTotal = reservations.reduce((sum, reservation) => sum + reservation.reserved, 0);
    assert.equal(detail.run.usage.tokens, reservedTotal);
  } finally {
    await f.runtime.close();
    f.database.close();
  }
});

test('large Chinese input fails the conservative token preflight before any network call', async (t) => {
  const f = createHarness(t);
  const started = await f.startFromProject(
    createDefaultStorySceneWorkflow(),
    { criticalChange: false },
    { maxTextCalls: 20, maxImages: 0, maxTokens: 100_000, maxRevisions: 2 },
  );
  started.story.createDocument(started.project.id, {
    kind: 'chapter',
    title: '大段中文上下文',
    body: '中'.repeat(35_000),
  });
  try {
    const detail = await advance(f.runtime, f.store, started.run.id);
    assert.equal(detail.run.status, 'failed');
    assert.equal(f.calls.llm, 0);
    assert.match(detail.run.error ?? '', /额度/);
    assert.doesNotMatch(detail.run.error ?? '', /网络|连接|供应商/);
    assert.equal(
      f.database.connection.prepare(
        'SELECT COUNT(*) AS count FROM co_token_reservations WHERE run_id=?',
      ).get(started.run.id)!.count,
      0,
    );
  } finally {
    await f.runtime.close();
    f.database.close();
  }
});

test('default illustration workflow registers one real generation task, polls without resubmission, approves and adopts', async (t) => {
  const f = createHarness(t);
  installImageWorkflow(f.database);
  const started = await f.startFromProject(
    createDefaultIllustrationWorkflow(),
    {
      importance: 'ordinary',
      media: { workflowId: IMAGE_WORKFLOW_ID, workflowVersion: 1, inputs: {}, references: [] },
    },
    { maxTextCalls: 10, maxImages: 1, maxTokens: 1_000_000, maxRevisions: 2 },
  );
  try {
    let detail = await advance(f.runtime, f.store, started.run.id);
    assert.equal(
      detail.run.status,
      'waiting_approval',
      JSON.stringify({ error: detail.run.error, nodes: detail.nodes }),
    );
    const generationRows = f.database.connection.prepare(
      'SELECT id FROM generation_tasks WHERE app_id=?',
    ).all(CREATIVE_APP_ID) as Array<{ id: string }>;
    assert.equal(generationRows.length, 1);
    assert.equal(f.calls.image, 1);
    const task = getGenerationTask(f.database, generationRows[0].id, CREATIVE_APP_ID);
    assert.equal(task?.status, 'succeeded');
    assert.equal(task?.artifacts.length, 1);
    const approval = detail.approvals.find((item) => item.status === 'pending');
    assert.ok(approval);
    approvePending(f.store, approval);
    detail = await advance(f.runtime, f.store, started.run.id);
    assert.equal(detail.run.status, 'completed');
    assert.equal(f.database.connection.prepare(
      'SELECT COUNT(*) AS count FROM generation_tasks WHERE app_id=?',
    ).get(CREATIVE_APP_ID)!.count, 1, JSON.stringify({
      calls: f.calls,
      tasks: f.database.connection.prepare(
        'SELECT id,status,idempotency_key,error_code FROM generation_tasks WHERE app_id=?',
      ).all(CREATIVE_APP_ID),
      nodes: detail.nodes,
    }));
    assert.equal(f.calls.image, 1);
    const adoptedReferences = f.database.connection.prepare(
      `SELECT r.id, r.artifact_id, r.ref_id
       FROM artifact_references r
       WHERE r.app_id=? AND r.ref_type='creative-adopted'
       ORDER BY r.id`,
    ).all(CREATIVE_APP_ID);
    assert.equal(
      adoptedReferences.length,
      1,
      JSON.stringify({ adoptedReferences, calls: f.calls, artifacts: detail.artifacts }),
    );
  } finally {
    await f.runtime.close();
    f.database.close();
  }
});

test('timeout, invalid JSON and changed frozen model fail closed without blind retry or secret leakage', async (t) => {
  await t.test('provider timeout is uncertain and retains its one dispatch', async () => {
    const f = createHarness(t);
    const started = await f.startFromProject(
      createDefaultStorySceneWorkflow(),
      { criticalChange: false },
      { maxTextCalls: 10, maxImages: 0, maxTokens: 1_000_000, maxRevisions: 2 },
    );
    f.setLlmMode('timeout');
    try {
      const detail = await advance(f.runtime, f.store, started.run.id);
      assert.equal(
        detail.run.status,
        'uncertain',
        JSON.stringify({ error: detail.run.error, nodes: detail.nodes }),
      );
      assert.equal(f.calls.llm, 1);
      assert.equal(detail.run.usage.textCalls, 1);
      assert.equal(detail.nodes.find((node) => node.nodeId === 'story_director_plan')?.status, 'uncertain');
      const reservation = f.database.connection.prepare(
        'SELECT reserved,actual,state FROM co_token_reservations WHERE run_id=?',
      ).get(started.run.id) as { reserved: number; actual: number | null; state: string };
      assert.equal(reservation.actual, null);
      assert.equal(reservation.state, 'reserved');
      assert.equal(detail.run.usage.tokens, reservation.reserved);
      const rows = [
        ...f.database.connection.prepare('SELECT * FROM ai_call_records').all(),
        ...f.database.connection.prepare('SELECT * FROM ai_call_events').all(),
      ];
      assert.equal(JSON.stringify(rows).includes(FAKE_CREDENTIAL), false);
    } finally {
      await f.runtime.close();
      f.database.close();
    }
  });

  await t.test('invalid JSON is a known failed output and is not retried', async () => {
    const f = createHarness(t);
    const started = await f.startFromProject(
      createDefaultStorySceneWorkflow(),
      { criticalChange: false },
      { maxTextCalls: 10, maxImages: 0, maxTokens: 1_000_000, maxRevisions: 2 },
    );
    f.setLlmMode('invalid-json');
    try {
      const detail = await advance(f.runtime, f.store, started.run.id);
      assert.equal(
        detail.run.status,
        'failed',
        JSON.stringify({ error: detail.run.error, nodes: detail.nodes }),
      );
      assert.equal(f.calls.llm, 1);
      assert.match(detail.run.error ?? '', /非 JSON|格式/);
    } finally {
      await f.runtime.close();
      f.database.close();
    }
  });

  await t.test('a gateway client refusal is reported without retrying or approving the scene', async () => {
    const f = createHarness(t);
    const started = await f.startFromProject(
      createDefaultStorySceneWorkflow(),
      { criticalChange: false },
      { maxTextCalls: 4, maxImages: 0, maxTokens: 150_000, maxRevisions: 0 },
    );
    f.setLlmMode('client-refusal');
    try {
      const detail = await advance(f.runtime, f.store, started.run.id);
      assert.equal(detail.run.status, 'failed');
      assert.equal(f.calls.llm, 4);
      assert.equal(detail.run.usage.textCalls, 4);
      assert.match(detail.run.error ?? '', /供应商拒绝当前客户端/);
      assert.equal(detail.approvals.length, 0);
      assert.ok(detail.artifacts.some((artifact) => artifact.kind === 'scene' && artifact.status === 'candidate'));
    } finally {
      await f.runtime.close();
      f.database.close();
    }
  });

  await t.test('changed model configuration is rejected before a provider call', async () => {
    const f = createHarness(t);
    const started = await f.startFromProject(
      createDefaultStorySceneWorkflow(),
      { criticalChange: false },
      { maxTextCalls: 10, maxImages: 0, maxTokens: 1_000_000, maxRevisions: 2 },
    );
    f.database.connection.prepare(
      "UPDATE model_profiles SET model_id='changed-after-freeze' WHERE id=?",
    ).run(MODEL_ID);
    try {
      const detail = await advance(f.runtime, f.store, started.run.id);
      assert.equal(detail.run.status, 'failed');
      assert.equal(f.calls.llm, 0);
      assert.match(detail.run.error ?? '', /配置.*变化/);
      assert.equal(detail.run.usage.textCalls, 0);
    } finally {
      await f.runtime.close();
      f.database.close();
    }
  });
});

test('image onInsertTask budget rollback leaves no generation task or image dispatch', async (t) => {
  const f = createHarness(t);
  installImageWorkflow(f.database);
  const started = await f.startFromProject(
    createDefaultIllustrationWorkflow(),
    {
      importance: 'ordinary',
      media: { workflowId: IMAGE_WORKFLOW_ID, workflowVersion: 1, inputs: {}, references: [] },
    },
    { maxTextCalls: 10, maxImages: 0, maxTokens: 1_000_000, maxRevisions: 2 },
  );
  try {
    const detail = await advance(f.runtime, f.store, started.run.id);
    assert.equal(
      detail.run.status,
      'failed',
      JSON.stringify({ error: detail.run.error, nodes: detail.nodes }),
    );
    assert.equal(f.calls.image, 0);
    assert.equal(f.database.connection.prepare(
      'SELECT COUNT(*) AS count FROM generation_tasks WHERE app_id=?',
    ).get(CREATIVE_APP_ID)!.count, 0);
    assert.equal(detail.run.usage.images, 0);
    const imageNode = detail.nodes.find((node) => node.nodeId === 'illustration_generate');
    assert.equal(imageNode?.status, 'failed');
    assert.equal(imageNode?.dispatchedAt, null);
  } finally {
    await f.runtime.close();
    f.database.close();
  }
});
