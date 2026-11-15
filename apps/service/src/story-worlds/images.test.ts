import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { WorldDefinition, WorldEvent, WorldRun } from '@sthstart/contracts';
import { readConfig } from '../config.js';
import { ServiceDatabase } from '../database.js';
import { ensureGenerationConsumerApps } from '../generation/consumers.js';
import { executeQueuedTask } from '../generation/execution.js';
import { SecretStore } from '../security.js';
import { StoryWorldImages } from './images.js';
import { STORY_WORLD_MIGRATION_STATEMENTS } from './migration.js';
import { StoryWorldError, StoryWorldStore } from './store.js';

class MemorySecrets extends SecretStore {
  override async status() {
    return { available: true, backend: 'memory', envFallback: false };
  }
  override async get() {
    return { value: 'sk-test-secret-key-12345', source: 'keyring' as const };
  }
}

class BlockingSecrets extends SecretStore {
  private readonly waiters: Array<() => void> = [];
  private credits = 0;

  override async status() {
    return { available: true, backend: 'memory', envFallback: false };
  }

  override async get() {
    if (this.credits > 0) {
      this.credits -= 1;
    } else {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
    return { value: 'sk-test-secret-key-12345', source: 'keyring' as const };
  }

  async waitForWaiters(count: number): Promise<void> {
    const deadline = Date.now() + 3_000;
    while (this.waiters.length < count) {
      if (Date.now() > deadline) throw new Error('等待并发屏障超时');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  releaseOne(): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter();
    else this.credits += 1;
  }
}

const mock1x1PngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function testDefinition(): WorldDefinition {
  return {
    title: '孤云阁的传说',
    summary: '海浪冲击石柱的古老传说。',
    timeLabel: '第一天',
    locations: [
      { id: 'loc-rock', name: '孤云石林', description: '巨大的石柱拔海而起。' },
      { id: 'loc-beach', name: '浅滩', description: '碎石与海浪拍打的岸边。' },
    ],
    actors: [
      {
        id: 'actor-1',
        name: '钟离',
        role: 'main',
        characterId: null,
        characterVersion: null,
        background: '往生堂客卿。',
        personality: '沉稳沉静。',
        speechStyle: '典雅。',
        appearance: '棕色长袍，琥珀色眼眸。',
        goals: ['记录历史'],
        locationId: 'loc-rock',
        referenceArtifactIds: ['art-ref-1'],
      },
      {
        id: 'actor-2',
        name: '荧',
        role: 'main',
        characterId: null,
        characterVersion: null,
        background: '异乡的旅行者。',
        personality: '坚定勇敢。',
        speechStyle: '亲切。',
        appearance: '浅色异域服饰，短发带花饰。',
        goals: ['寻找亲人'],
        locationId: 'loc-beach',
        referenceArtifactIds: ['art-ref-2'],
      },
    ],
    sources: [],
    lockedFacts: ['石柱乃神枪所化。'],
    models: { action: null, adjudication: null, narration: null },
    visualStyle: '水墨写意与厚重光影结合风格',
  };
}

function makeEvent(
  worldId: string,
  branchId: string,
  id: string,
  tick: number,
  participants: string[],
  summary: string,
): WorldEvent {
  return {
    id,
    worldId,
    branchId,
    tick,
    duration: 0,
    title: `事件-${id}`,
    summary,
    locationId: 'loc-rock',
    participantIds: participants,
    facts: [],
    perspectives: [
      { actorId: participants[0], text: `${participants[0]}站在海风中沉思。` },
    ],
    causeEventIds: [],
    storyLineIds: [],
    stateChanges: [
      {
        actorId: participants[0],
        locationId: 'loc-rock',
        goals: ['记录历史'],
        emotion: '凝重',
        relationships: [],
        updatedTick: tick,
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function setupFixture(
  interceptFetcher?: (url: string, init?: RequestInit) => Promise<Response | null>,
  options: { persistent?: boolean } = {},
) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'sthstart-images-test-'));
  const databasePath = options.persistent ? join(tmpDir, 'service.sqlite') : ':memory:';
  const database = new ServiceDatabase(databasePath);
  for (const statement of STORY_WORLD_MIGRATION_STATEMENTS) {
    database.connection.exec(statement);
  }

  // 通过 consumers 注册官方消费端（包含 story-worlds），杜绝假 token 与不安全凭据
  ensureGenerationConsumerApps(database);

  const config = readConfig({
    STHSTART_ADMIN_TOKEN: 'test-admin-token-0123456789abcdef-32chars',
    STHSTART_ARTIFACT_DIR: tmpDir,
  });
  const secrets = new MemorySecrets();

  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (interceptFetcher) {
      const intercepted = await interceptFetcher(url, init);
      if (intercepted) return intercepted;
    }
    // Cloud / OpenAI compatible mock
    if (url.includes('/images/generations') || url.includes('/images/edits')) {
      return Response.json({
        data: [{ b64_json: mock1x1PngBase64 }],
      });
    }
    // ComfyUI mock endpoints
    if (url.includes('/upload/image')) {
      return Response.json({ name: 'art-ref-1.png' });
    }
    if (url.includes('/prompt')) {
      return Response.json({ prompt_id: 'comfy-task-123' });
    }
    if (url.includes('/history/')) {
      return Response.json({
        'comfy-task-123': {
          status: { completed: true, status_str: 'success' },
          outputs: {
            '9': {
              images: [{ filename: 'output.png', subfolder: '', type: 'output' }],
            },
          },
        },
      });
    }
    if (url.includes('/view')) {
      return new Response(Buffer.from(mock1x1PngBase64, 'base64'), {
        headers: { 'content-type': 'image/png' },
      });
    }
    return new Response('ok', { status: 200 });
  };

  const store = new StoryWorldStore(database);
  const images = new StoryWorldImages({ database, config, secrets, fetcher, store });

  // 注册测试用 GPT Image (Cloud) 引擎与对应实际 Magpie 配方工作流（modelId: codex/gpt-image-2，schema 为 prompt/negativePrompt/size/quality）
  database.connection.prepare(`
    INSERT INTO generation_engines(id, name, kind, base_url, credential_account, enabled, concurrency_limit, created_at, updated_at)
    VALUES ('cloud-engine', 'GPT Image Cloud', 'cloud', 'https://api.openai.com/v1', 'openai-key', 1, 2, '2026-01-01', '2026-01-01')
  `).run();

  database.connection.prepare(`
    INSERT INTO generation_workflows(id, name, description, engine_kind, category, latest_version, created_at, updated_at)
    VALUES ('cloud-t2i-wf', 'Cloud T2I', 'GPT Image Recipe Workflow', 'cloud', 'image', 1, '2026-01-01', '2026-01-01')
  `).run();

  database.connection.prepare(`
    INSERT INTO generation_workflow_versions(workflow_id, version, engine_id, input_schema_json, definition_json, is_published, created_at)
    VALUES (
      'cloud-t2i-wf',
      1,
      'cloud-engine',
      '{"prompt":{"type":"string","required":true},"negativePrompt":{"type":"string"},"size":{"type":"string"},"quality":{"type":"string"}}',
      '{"type":"cloud_recipe","modelId":"codex/gpt-image-2","operation":"text-to-image","size":"1536x1024","quality":"medium"}',
      1,
      '2026-01-01'
    )
  `).run();

  // 注册测试用 ComfyUI 引擎与真实形状工作流（使用 negativePrompt camelCase，绑定 reference_image）
  database.connection.prepare(`
    INSERT INTO generation_engines(id, name, kind, base_url, enabled, concurrency_limit, created_at, updated_at)
    VALUES ('comfy-engine', 'ComfyUI Local', 'comfyui', 'http://127.0.0.1:8188', 1, 1, '2026-01-01', '2026-01-01')
  `).run();

  database.connection.prepare(`
    INSERT INTO generation_workflows(id, name, description, engine_kind, category, latest_version, created_at, updated_at)
    VALUES ('comfy-t2i-wf', 'Comfy T2I', 'ComfyUI Workflow', 'comfyui', 'image', 1, '2026-01-01', '2026-01-01')
  `).run();

  database.connection.prepare(`
    INSERT INTO generation_workflow_versions(workflow_id, version, engine_id, input_schema_json, node_bindings_json, definition_json, is_published, created_at)
    VALUES (
      'comfy-t2i-wf',
      1,
      'comfy-engine',
      '{"prompt":{"type":"string","required":true},"negativePrompt":{"type":"string"}}',
      '{"prompt":["6","inputs","text"],"negativePrompt":["7","inputs","text"],"reference_image":["1","inputs","image"]}',
      '{"1":{"class_type":"KSampler","inputs":{"amount":1,"image":""}},"6":{"class_type":"CLIPTextEncode","inputs":{"text":""}},"7":{"class_type":"CLIPTextEncode","inputs":{"text":""}}}',
      1,
      '2026-01-01'
    )
  `).run();

  const realArtPath = join(tmpDir, 'art-ref-1.png');
  writeFileSync(realArtPath, Buffer.from(mock1x1PngBase64, 'base64'));

  // 预置可用角色参考媒介（属于 story-worlds 应用）
  database.connection.prepare(`
    INSERT INTO artifacts(id, app_id, local_path, content_type, byte_size, file_status, created_at, updated_at)
    VALUES ('art-ref-1', 'story-worlds', ?, 'image/png', 100, 'ready', '2026-01-01', '2026-01-01')
  `).run(realArtPath);

  const world = store.create(testDefinition());
  const branchA = store.createBranch(world.id, {
    title: '分支A',
    mode: 'canon-gap',
    direction: '正史留白',
    expectedRevision: world.revision,
  });

  const branchB = store.createBranch(world.id, {
    title: '分支B',
    mode: 'adaptation',
    direction: '改编分支',
    expectedRevision: world.revision,
  });

  return {
    tmpDir,
    databasePath: options.persistent ? databasePath : null,
    database,
    config,
    secrets,
    fetcher,
    store,
    images,
    world,
    branchA,
    branchB,
    cleanup: () => {
      database.close();
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    },
  };
}

test('配图规划：基于事件形成建立/行动/结果画面，且具备跨分支隔离与幂等特性', () => {
  const f = setupFixture();
  try {
    const eventA1 = makeEvent(f.world.id, f.branchA.id, 'evt-a-1', 10, ['actor-1'], '钟离登高远眺孤云石林。');
    const freshBranchA = f.store.getBranch(f.world.id, f.branchA.id);
    f.store.commitStep(f.world.id, f.branchA.id, freshBranchA.revision, {
      tick: 10,
      events: [eventA1],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });

    const eventB1 = makeEvent(f.world.id, f.branchB.id, 'evt-b-1', 20, ['actor-2'], '荧在浅滩发现古老遗物。');
    f.store.commitStep(f.world.id, f.branchB.id, f.branchB.revision, {
      tick: 20,
      events: [eventB1],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });

    const branchANew = f.store.getBranch(f.world.id, f.branchA.id);

    // 规划分支 A 的配图
    const planResult = f.images.plan(f.world.id, f.branchA.id, {
      expectedRevision: branchANew.revision,
      eventIds: [eventA1.id],
    });

    assert.equal(planResult.items.length, 3);
    const phases = planResult.items.map((img) => img.phase);
    assert.deepEqual(phases, ['establishing', 'action', 'result']);

    const estImg = planResult.items.find((img) => img.phase === 'establishing')!;
    assert.match(estImg.caption, /场景建立/);
    assert.match(estImg.prompt, /孤云石林/);
    assert.match(estImg.prompt, /钟离/);
    assert.deepEqual(estImg.referenceArtifactIds, ['art-ref-1']);

    // 跨分支隔离证明：分支 B 不含分支 A 的任何规划配图
    const branchBList = f.images.list(f.world.id, f.branchB.id);
    assert.equal(branchBList.items.length, 0);

    // 幂等性证明：对同一事件重复调用 plan，返回相同 ID 的已有规划，不产生重复条目
    const repeatPlan = f.images.plan(f.world.id, f.branchA.id, {
      expectedRevision: branchANew.revision,
      eventIds: [eventA1.id],
    });
    assert.equal(repeatPlan.items.length, 3);
    assert.equal(repeatPlan.items[0].id, planResult.items[0].id);
    assert.equal(repeatPlan.items[1].id, planResult.items[1].id);
    assert.equal(repeatPlan.items[2].id, planResult.items[2].id);

    const totalAImages = f.images.list(f.world.id, f.branchA.id);
    assert.equal(totalAImages.items.length, 3);
  } finally {
    f.cleanup();
  }
});

test('真实两路径接入（ComfyUI 与 GPT Image）：assert 真实 fetch 入参、单图与配置绑定', async () => {
  let capturedCloudBody: any = null;
  let capturedComfyBody: any = null;

  const f = setupFixture(async (url, init) => {
    if (url.includes('/images/generations')) {
      capturedCloudBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        data: [{ b64_json: mock1x1PngBase64 }],
      });
    }
    if (url.includes('/prompt')) {
      capturedComfyBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ prompt_id: 'comfy-task-123' });
    }
    return null;
  });

  try {
    const event = makeEvent(f.world.id, f.branchA.id, 'evt-a-2', 30, ['actor-1'], '钟离召唤岩柱镇压海浪。');
    const freshBranchA = f.store.getBranch(f.world.id, f.branchA.id);
    f.store.commitStep(f.world.id, f.branchA.id, freshBranchA.revision, {
      tick: 30,
      events: [event],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });

    const branch = f.store.getBranch(f.world.id, f.branchA.id);
    const planned = f.images.plan(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      eventIds: [event.id],
    });
    const actionImage = planned.items.find((i) => i.phase === 'action')!;

    // 1. GPT Image (Cloud) 提交测试：不传 model 时自动复用 cloud_recipe 的 codex/gpt-image-2
    const cloudSubmitted = await f.images.submit(f.world.id, f.branchA.id, actionImage.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'idemp-cloud-real-1',
      engineId: 'cloud-engine',
    });

    assert.equal(cloudSubmitted.status, 'queued');
    assert.match(cloudSubmitted.consistencyNote, /文本生图 \/ text-to-image/);
    assert.match(cloudSubmitted.consistencyNote, /不支持参考图（场景锚点、道具或人物外观）与 LoRA 绑定/);

    // 故事配图不覆盖工作流配方的画幅和质量，仍传入事件的正负面描述。
    const cloudTaskRow = f.database.connection.prepare(
      'SELECT request_params_json FROM generation_tasks WHERE id=?',
    ).get(cloudSubmitted.generationTaskId!) as { request_params_json: string };
    const cloudInputs = JSON.parse(cloudTaskRow.request_params_json).inputs;
    assert.ok('negativePrompt' in cloudInputs);
    assert.ok(!('size' in cloudInputs));
    assert.ok(!('quality' in cloudInputs));
    assert.ok(!('n' in cloudInputs)); // 未在 schema 声明的字段不传入

    // 执行任务并同步状态，核对真实 fetch 发送的入参
    await executeQueuedTask(f.config, f.database, f.secrets, cloudSubmitted.generationTaskId!, f.fetcher);
    assert.ok(capturedCloudBody);
    assert.equal(capturedCloudBody.model, 'codex/gpt-image-2'); // 成功读取自 cloud recipe 配置，非硬编码
    assert.equal(capturedCloudBody.size, '1536x1024');
    assert.equal(capturedCloudBody.quality, 'medium');
    assert.match(String(capturedCloudBody.prompt), /钟离/);
    assert.match(String(capturedCloudBody.prompt), /棕色长袍/);

    const syncedCloud = await f.images.syncTask(f.world.id, f.branchA.id, actionImage.id);
    assert.equal(syncedCloud.status, 'succeeded');
    assert.ok(syncedCloud.artifactId);
    assert.ok(syncedCloud.imageUrl?.startsWith('/api/v1/artifacts/'));

    // 已发布字段的显式默认优先于底层配方，仍不能被故事模块固定值覆盖。
    f.database.connection.prepare("UPDATE generation_workflow_versions SET input_schema_json=? WHERE workflow_id='cloud-t2i-wf' AND version=1").run(JSON.stringify({
      prompt: { type: 'string', required: true }, negativePrompt: { type: 'string' },
      size: { type: 'string', default: '1024x1536' }, quality: { type: 'string', default: 'low' },
    }));
    const resultImage = planned.items.find((i) => i.phase === 'result')!;
    const configured = await f.images.submit(f.world.id, f.branchA.id, resultImage.id, {
      expectedRevision: branch.revision, idempotencyKey: 'idemp-cloud-field-defaults', engineId: 'cloud-engine',
    });
    await executeQueuedTask(f.config, f.database, f.secrets, configured.generationTaskId!, f.fetcher);
    assert.equal(capturedCloudBody.size, '1024x1536');
    assert.equal(capturedCloudBody.quality, 'low');

    // 2. ComfyUI 提交测试（换用 establishing 画面）
    const estImage = planned.items.find((i) => i.phase === 'establishing')!;
    const comfySubmitted = await f.images.submit(f.world.id, f.branchA.id, estImage.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'idemp-comfy-real-1',
      engineId: 'comfy-engine',
    });

    assert.equal(comfySubmitted.status, 'queued');
    assert.match(comfySubmitted.consistencyNote, /已连接 ComfyUI 工作流/);
    assert.match(comfySubmitted.consistencyNote, /绑定首张参考图/);

    // 检查 ComfyUI 任务入参：正确映射为 camelCase negativePrompt，绝无未知 negative_prompt / n / size / model
    const comfyTaskRow = f.database.connection.prepare(
      'SELECT request_params_json FROM generation_tasks WHERE id=?',
    ).get(comfySubmitted.generationTaskId!) as { request_params_json: string };
    const comfyInputs = JSON.parse(comfyTaskRow.request_params_json).inputs;
    assert.ok('prompt' in comfyInputs);
    assert.ok('negativePrompt' in comfyInputs);
    assert.ok(!('negative_prompt' in comfyInputs));
    assert.ok(!('n' in comfyInputs));
    assert.ok(!('size' in comfyInputs));
    assert.ok(!('model' in comfyInputs));

    await executeQueuedTask(f.config, f.database, f.secrets, comfySubmitted.generationTaskId!, f.fetcher);
    assert.ok(capturedComfyBody);
  } finally {
    f.cleanup();
  }
});

test('配图幂等与额度事务：双并发同 key 仅扣费一次，不同 payload 相同 key 抛出 409，失败 same key 不再扣费', async () => {
  const f = setupFixture();
  try {
    const event = makeEvent(f.world.id, f.branchA.id, 'evt-a-3', 40, ['actor-1'], '钟离端坐岩石饮茶。');
    const testRun: WorldRun = {
      id: 'run-concurrent-test',
      worldId: f.world.id,
      branchId: f.branchA.id,
      status: 'running',
      settings: { durationTicks: 1440, stepTicks: 60, maxTextCalls: 120, maxImages: 5, autoImages: false },
      startTick: 0,
      targetTick: 1440,
      completedTick: 40,
      textCallsUsed: 0,
      imagesSubmitted: 0,
      pauseReason: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const freshBranchA = f.store.getBranch(f.world.id, f.branchA.id);
    f.store.commitStep(f.world.id, f.branchA.id, freshBranchA.revision, {
      tick: 40,
      events: [event],
      memories: [],
      states: [],
      consumedInterventionIds: [],
      run: testRun,
    });

    const branch = f.store.getBranch(f.world.id, f.branchA.id);
    const planned = f.images.plan(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      eventIds: [event.id],
    });
    const estImage = planned.items[0];

    // 1. 双并发竞态提交同一 idempotencyKey
    const [res1, res2] = await Promise.all([
      f.images.submit(f.world.id, f.branchA.id, estImage.id, {
        expectedRevision: branch.revision,
        idempotencyKey: 'idemp-concurrent-key',
        engineId: 'cloud-engine',
        runId: testRun.id,
      }),
      f.images.submit(f.world.id, f.branchA.id, estImage.id, {
        expectedRevision: branch.revision,
        idempotencyKey: 'idemp-concurrent-key',
        engineId: 'cloud-engine',
        runId: testRun.id,
      }),
    ]);

    assert.equal(res1.id, res2.id);
    const runAfterConcurrent = JSON.parse(
      (f.database.connection.prepare('SELECT data_json FROM sw_runs WHERE id=?').get(testRun.id) as { data_json: string }).data_json,
    ) as WorldRun;
    // 证明：双并发相同 key 只递增了一次额度！
    assert.equal(runAfterConcurrent.imagesSubmitted, 1);

    // 2. 使用相同 idempotencyKey 但不同 payload (不同 engineId) 提交：必须拒绝并抛出 409
    await assert.rejects(
      f.images.submit(f.world.id, f.branchA.id, estImage.id, {
        expectedRevision: branch.revision,
        idempotencyKey: 'idemp-concurrent-key',
        engineId: 'comfy-engine',
        runId: testRun.id,
      }),
      (err: unknown) => err instanceof StoryWorldError && err.code === 'story_idempotency_conflict',
    );

    // 3. 失败任务的同一 key 重试不重复扣费
    const actImage = planned.items[1];
    const failedImg = await f.images.submit(f.world.id, f.branchA.id, actImage.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'idemp-failed-key',
      engineId: 'cloud-engine',
      workflowId: 'non-existent-wf', // 触发失败
      runId: testRun.id,
    });
    assert.equal(failedImg.status, 'failed');

    const runAfterFail = JSON.parse(
      (f.database.connection.prepare('SELECT data_json FROM sw_runs WHERE id=?').get(testRun.id) as { data_json: string }).data_json,
    ) as WorldRun;
    assert.equal(runAfterFail.imagesSubmitted, 2); // 失败也扣除额度

    // 再次以相同 idempotencyKey 调用：返回已有失败记录，绝不再次扣费！
    const retryFail = await f.images.submit(f.world.id, f.branchA.id, actImage.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'idemp-failed-key',
      engineId: 'cloud-engine',
      workflowId: 'non-existent-wf',
      runId: testRun.id,
    });
    assert.equal(retryFail.status, 'failed');

    const runAfterRetry = JSON.parse(
      (f.database.connection.prepare('SELECT data_json FROM sw_runs WHERE id=?').get(testRun.id) as { data_json: string }).data_json,
    ) as WorldRun;
    assert.equal(runAfterRetry.imagesSubmitted, 2); // 额度依然为 2，未被重复扣减
  } finally {
    f.cleanup();
  }
});

test('upstreamMayContinue 必须判定为 uncertain 且禁止 new key 再提交；无 run 手动配图受 12 幅预算限制', async () => {
  const f = setupFixture();
  try {
    const event = makeEvent(f.world.id, f.branchA.id, 'evt-a-4', 50, ['actor-1'], '测试 upstreamMayContinue 与预算。');
    const freshBranchA = f.store.getBranch(f.world.id, f.branchA.id);
    f.store.commitStep(f.world.id, f.branchA.id, freshBranchA.revision, {
      tick: 50,
      events: [event],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });

    const branch = f.store.getBranch(f.world.id, f.branchA.id);
    const planned = f.images.plan(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      eventIds: [event.id],
    });
    const img = planned.items[0];

    // 提交任务
    const sub = await f.images.submit(f.world.id, f.branchA.id, img.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'idemp-upstream-test',
      engineId: 'cloud-engine',
    });

    // 人工模拟上游执行超时/中断，但 upstream_may_continue = 1
    f.database.connection.prepare(
      "UPDATE generation_tasks SET status = 'abandoned', upstream_may_continue = 1 WHERE id = ?",
    ).run(sub.generationTaskId!);

    // 同步后状态必须被严格映射为 uncertain
    const synced = await f.images.syncTask(f.world.id, f.branchA.id, img.id);
    assert.equal(synced.status, 'uncertain');

    // 尝试以全新 key 再次提交：必须抛出 409 拒绝
    await assert.rejects(
      f.images.submit(f.world.id, f.branchA.id, img.id, {
        expectedRevision: branch.revision,
        idempotencyKey: 'idemp-new-key-forbidden',
        engineId: 'cloud-engine',
      }),
      (err: unknown) => err instanceof StoryWorldError && err.code === 'story_image_busy',
    );
  } finally {
    f.cleanup();
  }
});

test('HTTP 同步接口 sync 与自动模拟配图 processRun 行为验证', async () => {
  const f = setupFixture();
  try {
    const event = makeEvent(f.world.id, f.branchA.id, 'evt-a-5', 60, ['actor-1'], '自动配图推进事件。');
    const testRun: WorldRun = {
      id: 'run-auto-test',
      worldId: f.world.id,
      branchId: f.branchA.id,
      status: 'running',
      settings: {
        durationTicks: 1440,
        stepTicks: 60,
        maxTextCalls: 120,
        maxImages: 2,
        autoImages: true,
        imageConfig: { engineId: 'cloud-engine' },
      },
      startTick: 0,
      targetTick: 1440,
      completedTick: 60,
      textCallsUsed: 0,
      imagesSubmitted: 0,
      pauseReason: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const freshBranchA = f.store.getBranch(f.world.id, f.branchA.id);
    f.store.commitStep(f.world.id, f.branchA.id, freshBranchA.revision, {
      tick: 60,
      events: [event],
      memories: [],
      states: [],
      consumedInterventionIds: [],
      run: testRun,
    });

    // 触发 processRun 自动配图
    const autoResult = await f.images.processRun(f.world.id, f.branchA.id, testRun);
    assert.equal(autoResult.planned.length, 3);
    assert.equal(autoResult.submitted.length, 2); // 额度限制为 2 幅，已满自动停止

    // 超出预算的第 3 张图片保留 planned 且状态可见
    const allImages = f.images.list(f.world.id, f.branchA.id, { runId: testRun.id }).items;
    const unsubmitted = allImages.find((img) => img.status === 'planned');
    assert.ok(unsubmitted);
    assert.match(unsubmitted.consistencyNote, /超出本轮剩余配图额度|待配图规划/);

    // 重启后重复调用 processRun：幂等且不堵塞，已提交的任务不被重复提交
    const replayResult = await f.images.processRun(f.world.id, f.branchA.id, testRun);
    assert.equal(replayResult.planned.length, 0); // 已规划过的事件不再重复规划

    // 执行 HTTP detail 批量同步接口
    const syncResult = await f.images.sync(f.world.id, f.branchA.id);
    assert.equal(syncResult.items.length, 3);
  } finally {
    f.cleanup();
  }
});

test('processRun 严格使用 imageConfig、事件范围约束与大批量分批不遗漏', async () => {
  const f = setupFixture();
  try {
    // 1. 测试 imageConfig 缺失场景：不选默认，不扣预算，仅保留 planned
    const event1 = makeEvent(f.world.id, f.branchA.id, 'evt-cfg-1', 70, ['actor-1'], '未配置引擎事件。');
    const runNoConfig: WorldRun = {
      id: 'run-no-cfg',
      worldId: f.world.id,
      branchId: f.branchA.id,
      status: 'running',
      settings: {
        durationTicks: 1440,
        stepTicks: 60,
        maxTextCalls: 120,
        maxImages: 5,
        autoImages: true,
        // imageConfig 未配置
      },
      startTick: 60,
      targetTick: 1500,
      completedTick: 70,
      textCallsUsed: 0,
      imagesSubmitted: 0,
      pauseReason: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const freshBranchA = f.store.getBranch(f.world.id, f.branchA.id);
    f.store.commitStep(f.world.id, f.branchA.id, freshBranchA.revision, {
      tick: 70,
      events: [event1],
      memories: [],
      states: [],
      consumedInterventionIds: [],
      run: runNoConfig,
    });

    const resNoConfig = await f.images.processRun(f.world.id, f.branchA.id, runNoConfig);
    assert.equal(resNoConfig.planned.length, 3);
    assert.equal(resNoConfig.submitted.length, 0); // 严格不提交！不扣预算！
    assert.match(resNoConfig.planned[0].consistencyNote, /未配置生图引擎/);

    // 2. 测试事件范围与精确 eventIds 传参（afterStep 可选第四参）
    // 完成上一个 runNoConfig，以便开启下一个 runScoped
    f.database.connection.prepare("UPDATE sw_runs SET status='completed' WHERE id=?").run(runNoConfig.id);

    // event1 发生在 tick 70（属于上一个 runNoConfig），新事件 eventNew 发生在当前步（tick: 80）
    const eventNew = makeEvent(f.world.id, f.branchA.id, 'evt-new-step', 80, ['actor-1'], '当前步新事件。');
    const runScoped: WorldRun = {
      id: 'run-scoped-test',
      worldId: f.world.id,
      branchId: f.branchA.id,
      status: 'running',
      settings: {
        durationTicks: 1440,
        stepTicks: 60,
        maxTextCalls: 120,
        maxImages: 10,
        autoImages: true,
        imageConfig: { engineId: 'cloud-engine' },
      },
      startTick: 70, // 只接受 > 70 的事件
      targetTick: 1510,
      completedTick: 80,
      textCallsUsed: 0,
      imagesSubmitted: 0,
      pauseReason: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const freshBranchA2 = f.store.getBranch(f.world.id, f.branchA.id);
    f.store.commitStep(f.world.id, f.branchA.id, freshBranchA2.revision, {
      tick: 80,
      events: [eventNew],
      memories: [],
      states: [],
      consumedInterventionIds: [],
      run: runScoped,
    });

    // afterStep 传入 eventNew.id 作为第四参
    const resScoped = await f.images.processRun(f.world.id, f.branchA.id, runScoped, [eventNew.id]);
    assert.equal(resScoped.planned.length, 3);

    // 验证先前 run 的 event1 绝未计入此 runScoped
    const scopedRunImages = f.images.list(f.world.id, f.branchA.id, { runId: runScoped.id }).items;
    assert.equal(scopedRunImages.length, 3);
    assert.ok(scopedRunImages.every((img) => img.eventId === eventNew.id));
    assert.ok(!scopedRunImages.some((img) => img.eventId === event1.id));

    // 3. 超过 12 个事件的大批量自动规划：分批规划不遗漏
    const manyEvents: WorldEvent[] = [];
    for (let i = 1; i <= 14; i++) {
      manyEvents.push(makeEvent(f.world.id, f.branchB.id, `evt-batch-${i}`, 100 + i, ['actor-1'], `批量事件 ${i}`));
    }
    const runMany: WorldRun = {
      id: 'run-many-test',
      worldId: f.world.id,
      branchId: f.branchB.id,
      status: 'running',
      settings: {
        durationTicks: 1440,
        stepTicks: 60,
        maxTextCalls: 120,
        maxImages: 50,
        autoImages: true,
        imageConfig: { engineId: 'cloud-engine' },
      },
      startTick: 100,
      targetTick: 1540,
      completedTick: 120,
      textCallsUsed: 0,
      imagesSubmitted: 0,
      pauseReason: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    f.store.commitStep(f.world.id, f.branchB.id, f.branchB.revision, {
      tick: 120,
      events: manyEvents,
      memories: [],
      states: [],
      consumedInterventionIds: [],
      run: runMany,
    });

    // 14 个事件全部被规划（14 * 3 = 42 幅），绝不因 12 上限截断遗漏剩余 2 个事件
    const resMany = await f.images.processRun(f.world.id, f.branchB.id, runMany);
    assert.equal(resMany.planned.length, 42);
    assert.equal(resMany.submitted.length, 42);
  } finally {
    f.cleanup();
  }
});

test('手动配图在途安全上限与完成释放（杜绝终生 12 限制）以及已有 run 自动关联', async () => {
  const f = setupFixture();
  try {
    // 规划 5 个事件共 15 幅图片
    const events: WorldEvent[] = [];
    for (let i = 1; i <= 5; i++) {
      events.push(makeEvent(f.world.id, f.branchA.id, `evt-manual-${i}`, 10 + i, ['actor-1'], `手动事件 ${i}`));
    }
    const freshBranchA = f.store.getBranch(f.world.id, f.branchA.id);
    f.store.commitStep(f.world.id, f.branchA.id, freshBranchA.revision, {
      tick: 20,
      events,
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });

    const branch = f.store.getBranch(f.world.id, f.branchA.id);
    const planned = f.images.plan(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      eventIds: events.map((e) => e.id),
    });
    assert.equal(planned.items.length, 15);

    // 1. 无 run 状态下连续提交 12 幅手动图片：全部成功
    const submittedList = [];
    for (let i = 0; i < 12; i++) {
      const sub = await f.images.submit(f.world.id, f.branchA.id, planned.items[i].id, {
        expectedRevision: branch.revision,
        idempotencyKey: `idemp-manual-batch-${i}`,
        engineId: 'cloud-engine',
      });
      submittedList.push(sub);
    }
    assert.equal(submittedList.length, 12);

    // 2. 尝试提交第 13 幅：触发在途安全上限 (12) 阻断
    await assert.rejects(
      f.images.submit(f.world.id, f.branchA.id, planned.items[12].id, {
        expectedRevision: branch.revision,
        idempotencyKey: 'idemp-manual-batch-12',
        engineId: 'cloud-engine',
      }),
      (err: unknown) =>
        err instanceof StoryWorldError &&
        err.code === 'story_image_budget_exceeded' &&
        err.message.includes('在途任务已达到 12 幅安全上限'),
    );

    // 3. 执行并完成前 2 个任务，模拟上游生图成功，并通过 syncTask 同步释放
    await executeQueuedTask(f.config, f.database, f.secrets, submittedList[0].generationTaskId!, f.fetcher);
    await f.images.syncTask(f.world.id, f.branchA.id, submittedList[0].id);

    await executeQueuedTask(f.config, f.database, f.secrets, submittedList[1].generationTaskId!, f.fetcher);
    await f.images.syncTask(f.world.id, f.branchA.id, submittedList[1].id);

    // 4. 在途任务释放后（降至 10 幅），第 13 幅图片立即可成功提交！证明不是终生 12 限制！
    const sub13 = await f.images.submit(f.world.id, f.branchA.id, planned.items[12].id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'idemp-manual-batch-12',
      engineId: 'cloud-engine',
    });
    assert.equal(sub13.status, 'queued');

    // 5. 验证已有 run 自动关联：当分支上存在活跃 run 时，手动提交自动绑定到该 run
    const activeRun: WorldRun = {
      id: 'run-active-branch-test',
      worldId: f.world.id,
      branchId: f.branchA.id,
      status: 'running',
      settings: {
        durationTicks: 1440,
        stepTicks: 60,
        maxTextCalls: 120,
        maxImages: 10,
        autoImages: false,
      },
      startTick: 0,
      targetTick: 1440,
      completedTick: 20,
      textCallsUsed: 0,
      imagesSubmitted: 0,
      pauseReason: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    f.database.connection.prepare(
      'INSERT INTO sw_runs (id, world_id, branch_id, status, data_json, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(activeRun.id, f.world.id, f.branchA.id, activeRun.status, JSON.stringify(activeRun), 'key-run-active', '2026-01-01', '2026-01-01');

    // 手动提交第 14 幅图片时不传 runId，应自动关联 activeRun 并扣除 run 额度
    const sub14 = await f.images.submit(f.world.id, f.branchA.id, planned.items[13].id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'idemp-manual-auto-run-14',
      engineId: 'cloud-engine',
    });
    assert.equal(sub14.runId, activeRun.id);

    const freshRun = JSON.parse(
      (f.database.connection.prepare('SELECT data_json FROM sw_runs WHERE id=?').get(activeRun.id) as { data_json: string }).data_json,
    ) as WorldRun;
    assert.equal(freshRun.imagesSubmitted, 1);
  } finally {
    f.cleanup();
  }
});

test('历史事件配图规划使用该事件 tick 时的定义快照（防后续角色外貌/地点变更污染历史分镜）', () => {
  const f = setupFixture();
  try {
    // 1. tick 10: 提交事件 1（此时 actor-1 外貌为 "棕色长袍，琥珀色眼眸。"）
    const event1 = makeEvent(f.world.id, f.branchA.id, 'evt-hist-1', 10, ['actor-1'], '钟离在孤云石林漫步。');
    let branch = f.store.getBranch(f.world.id, f.branchA.id);
    f.store.commitStep(f.world.id, f.branchA.id, branch.revision, {
      tick: 10,
      events: [event1],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });

    // 2. 推进分支至 tick 30，并在 tick 30 更改角色定义（换装为 "纯白礼服，头戴金色面具。"）
    branch = f.store.getBranch(f.world.id, f.branchA.id);
    f.store.commitStep(f.world.id, f.branchA.id, branch.revision, {
      tick: 30,
      events: [],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });
    branch = f.store.getBranch(f.world.id, f.branchA.id);

    const newDef = testDefinition();
    newDef.actors[0].appearance = '纯白礼服，头戴金色面具。';
    branch = f.store.updateDefinitionAtCurrentTick(f.world.id, f.branchA.id, branch.revision, newDef);

    // 3. tick 50: 提交事件 2（此时 actor-1 已换装为 "纯白礼服"）
    const event2 = makeEvent(f.world.id, f.branchA.id, 'evt-hist-2', 50, ['actor-1'], '钟离换上礼服主持祭典。');
    f.store.commitStep(f.world.id, f.branchA.id, branch.revision, {
      tick: 50,
      events: [event2],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });
    branch = f.store.getBranch(f.world.id, f.branchA.id);

    // 4. 同时规划两事件的配图
    const planRes = f.images.plan(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      eventIds: [event1.id, event2.id],
    });

    const evt1Action = planRes.items.find((img) => img.eventId === event1.id && img.phase === 'action')!;
    const evt2Action = planRes.items.find((img) => img.eventId === event2.id && img.phase === 'action')!;

    // 历史事件 1 (tick 10) 严格使用历史定义快照（棕色长袍），绝不受当前分支最新定义的污染！
    assert.match(evt1Action.prompt, /棕色长袍/);
    assert.doesNotMatch(evt1Action.prompt, /纯白礼服/);

    // 当前事件 2 (tick 50) 使用更新后的定义快照（纯白礼服）
    assert.match(evt2Action.prompt, /纯白礼服/);
    assert.doesNotMatch(evt2Action.prompt, /棕色长袍/);
  } finally {
    f.cleanup();
  }
});

test('配图提交幂等 Hash 严格包含 runId 且重放校验正确', async () => {
  const f = setupFixture();
  try {
    const event = makeEvent(f.world.id, f.branchA.id, 'evt-idemp-run-1', 10, ['actor-1'], '钟离眺望远方。');
    let branch = f.store.getBranch(f.world.id, f.branchA.id);
    f.store.commitStep(f.world.id, f.branchA.id, branch.revision, {
      tick: 10,
      events: [event],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });
    branch = f.store.getBranch(f.world.id, f.branchA.id);

    const planned = f.images.plan(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      eventIds: [event.id],
    });
    const imgId = planned.items[0].id;

    const run1: WorldRun = {
      id: 'run-hash-1',
      worldId: f.world.id,
      branchId: f.branchA.id,
      status: 'running',
      settings: { durationTicks: 100, stepTicks: 10, maxTextCalls: 10, maxImages: 10, autoImages: false },
      startTick: 0,
      targetTick: 100,
      completedTick: 10,
      textCallsUsed: 0,
      imagesSubmitted: 0,
      pauseReason: '',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    };
    const run2: WorldRun = {
      id: 'run-hash-2',
      worldId: f.world.id,
      branchId: f.branchA.id,
      status: 'running',
      settings: { durationTicks: 100, stepTicks: 10, maxTextCalls: 10, maxImages: 10, autoImages: false },
      startTick: 0,
      targetTick: 100,
      completedTick: 10,
      textCallsUsed: 0,
      imagesSubmitted: 0,
      pauseReason: '',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    };

    f.database.connection.prepare(
      'INSERT INTO sw_runs (id, world_id, branch_id, status, data_json, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(run1.id, f.world.id, f.branchA.id, run1.status, JSON.stringify(run1), 'k1', '2026-01-01', '2026-01-01');

    // 1. 使用 run1 提交
    const sub1 = await f.images.submit(f.world.id, f.branchA.id, imgId, {
      expectedRevision: branch.revision,
      idempotencyKey: 'idemp-key-shared-run-test',
      engineId: 'cloud-engine',
      runId: run1.id,
    });
    assert.equal(sub1.runId, run1.id);

    // 完成 run1 并写入 run2（分支单活跃运行约束），验证同分支后续 run 使用相同幂等键时的参数冲突
    f.database.connection.prepare("UPDATE sw_runs SET status='completed' WHERE id=?").run(run1.id);
    f.database.connection.prepare(
      'INSERT INTO sw_runs (id, world_id, branch_id, status, data_json, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(run2.id, f.world.id, f.branchA.id, run2.status, JSON.stringify(run2), 'k2', '2026-01-01', '2026-01-01');

    // 2. 相同幂等键，改用 run2 提交：因 requestHash 包含 runId，必须抛出 409 冲突拒绝！
    await assert.rejects(
      f.images.submit(f.world.id, f.branchA.id, imgId, {
        expectedRevision: branch.revision,
        idempotencyKey: 'idemp-key-shared-run-test',
        engineId: 'cloud-engine',
        runId: run2.id,
      }),
      (err: unknown) =>
        err instanceof StoryWorldError &&
        err.code === 'story_idempotency_conflict' &&
        err.message.includes('同一幂等键不能提交不同的配图参数'),
    );

    // 3. 相同幂等键 + 相同 run1 重放：成功返回已有记录，不重复扣费
    const replay = await f.images.submit(f.world.id, f.branchA.id, imgId, {
      expectedRevision: branch.revision,
      idempotencyKey: 'idemp-key-shared-run-test',
      engineId: 'cloud-engine',
      runId: run1.id,
    });
    assert.equal(replay.id, sub1.id);
    assert.equal(replay.runId, run1.id);
  } finally {
    f.cleanup();
  }
});

test('云端引擎区分图生图与文生图能力：图生图支持参考图，文生图求真提示依赖提示词', async () => {
  const f = setupFixture();
  try {
    // 注册云端图生图兼容工作流
    f.database.connection.prepare(`
      INSERT INTO generation_workflows(id, name, description, engine_kind, category, latest_version, created_at, updated_at)
      VALUES ('cloud-i2i-wf', 'Cloud I2I', 'Cloud Image-to-Image Workflow', 'cloud', 'image', 1, '2026-01-01', '2026-01-01')
    `).run();

    f.database.connection.prepare(`
      INSERT INTO generation_workflow_versions(workflow_id, version, engine_id, input_schema_json, definition_json, is_published, created_at)
      VALUES (
        'cloud-i2i-wf',
        1,
        'cloud-engine',
        '{"prompt":{"type":"string","required":true},"referenceImage":{"type":"string","semantic":"reference_image"}}',
        '{"type":"cloud_recipe","modelId":"codex/gpt-image-2","operation":"image-to-image"}',
        1,
        '2026-01-01'
      )
    `).run();

    const event = makeEvent(f.world.id, f.branchA.id, 'evt-i2i-ref-1', 10, ['actor-1'], '钟离漫步海滩。');
    let branch = f.store.getBranch(f.world.id, f.branchA.id);
    f.store.commitStep(f.world.id, f.branchA.id, branch.revision, {
      tick: 10,
      events: [event],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });
    branch = f.store.getBranch(f.world.id, f.branchA.id);

    const planned = f.images.plan(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      eventIds: [event.id],
    });
    const estImg = planned.items.find((i) => i.phase === 'establishing')!;
    const actionImg = planned.items.find((i) => i.phase === 'action')!;

    // 1. 提交至云端图生图工作流：应成功绑定参考图媒介，并在一致性说明中如实体现已连接图生图路径
    const i2iSubmitted = await f.images.submit(f.world.id, f.branchA.id, estImg.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'idemp-cloud-i2i-1',
      engineId: 'cloud-engine',
      workflowId: 'cloud-i2i-wf',
    });

    assert.equal(i2iSubmitted.status, 'queued');
    assert.match(i2iSubmitted.consistencyNote, /已连接云端图生图（image-to-image）生成路径并绑定首张参考图/);

    const i2iTaskRow = f.database.connection.prepare(
      'SELECT request_params_json FROM generation_tasks WHERE id=?',
    ).get(i2iSubmitted.generationTaskId!) as { request_params_json: string };
    const i2iArtifacts = JSON.parse(i2iTaskRow.request_params_json).inputArtifacts || [];
    assert.equal(i2iArtifacts.length, 1);
    assert.equal(i2iArtifacts[0].artifactId, 'art-ref-1');
    assert.equal(i2iArtifacts[0].inputKey, 'referenceImage');

    // 2. 提交至云端普通文生图工作流（cloud-t2i-wf）：如实告知文生图不支持人物参考图，画面一致性依赖提示词
    const t2iSubmitted = await f.images.submit(f.world.id, f.branchA.id, actionImg.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'idemp-cloud-t2i-1',
      engineId: 'cloud-engine',
      workflowId: 'cloud-t2i-wf',
    });

    assert.equal(t2iSubmitted.status, 'queued');
    assert.match(t2iSubmitted.consistencyNote, /当前生成路径（文本生图 \/ text-to-image）不支持参考图（场景锚点、道具或人物外观）/);

    const t2iTaskRow = f.database.connection.prepare(
      'SELECT request_params_json FROM generation_tasks WHERE id=?',
    ).get(t2iSubmitted.generationTaskId!) as { request_params_json: string };
    const t2iArtifacts = JSON.parse(t2iTaskRow.request_params_json).inputArtifacts || [];
    assert.equal(t2iArtifacts.length, 0);
  } finally {
    f.cleanup();
  }
});

test('三阶段提示词锚定全要素（人物外貌/同一地点/事件事实/道具设定）、允许日常平静场景且负向词禁止未经提及道具与时空穿越', () => {
  const f = setupFixture();
  try {
    const peacefulEvent: WorldEvent = {
      id: 'evt-lamp-peaceful',
      worldId: f.world.id,
      branchId: f.branchA.id,
      tick: 30,
      duration: 0,
      title: '码头修好的黄铜灯',
      summary: '清晨，钟离在孤云石林木桌旁检查旧黄铜灯。荧停下脚步，为他递来一块干布。钟离擦净灯罩，修好松动的提手，两人确认灯已可以提起，灯仍未点燃。',
      locationId: 'loc-rock',
      participantIds: ['actor-1', 'actor-2'],
      facts: [
        {
          id: 'fact-lamp-fixed',
          content: '钟离在荧帮助下修好了黄铜灯提手，灯没有点燃。',
          knownBy: ['actor-1', 'actor-2'],
          nature: 'author',
        },
      ],
      perspectives: [],
      causeEventIds: [],
      storyLineIds: [],
      stateChanges: [
        {
          actorId: 'actor-1',
          locationId: 'loc-rock',
          goals: ['修好提手'],
          emotion: '平静专注',
          relationships: [],
          updatedTick: 30,
        },
        {
          actorId: 'actor-2',
          locationId: 'loc-rock',
          goals: ['协助递布'],
          emotion: '欣慰微喜',
          relationships: [],
          updatedTick: 30,
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    let branch = f.store.getBranch(f.world.id, f.branchA.id);
    f.store.commitStep(f.world.id, f.branchA.id, branch.revision, {
      tick: 30,
      events: [peacefulEvent],
      memories: [],
      states: [],
      consumedInterventionIds: [],
    });
    branch = f.store.getBranch(f.world.id, f.branchA.id);

    const planned = f.images.plan(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      eventIds: [peacefulEvent.id],
    });

    assert.equal(planned.items.length, 3);
    const est = planned.items.find((i) => i.phase === 'establishing')!;
    const act = planned.items.find((i) => i.phase === 'action')!;
    const res = planned.items.find((i) => i.phase === 'result')!;

    // 1. 三幅画面必须共享同批参与角色且具备详尽外观特征（解决 result 丢失外观缺陷）
    for (const img of [est, act, res]) {
      assert.match(img.prompt, /钟离（棕色长袍，琥珀色眼眸。）/);
      assert.match(img.prompt, /荧（浅色异域服饰，短发带花饰。）/);
      assert.match(img.prompt, /孤云石林/);
      assert.match(img.prompt, /巨大的石柱拔海而起/);
    }

    // 2. Establishing (初始前奏全景)：必须引入事件背景与关键事实/道具（黄铜灯、木桌），且明确限定在动作发生前，严禁提前绘制后续行动或结果
    assert.match(est.prompt, /旧黄铜灯/);
    assert.match(est.prompt, /涉及关键事实与道具设定：钟离在荧帮助下修好了黄铜灯提手，灯没有点燃/);
    assert.match(est.prompt, /尚未展开具体动作与最终结果，严禁提前绘制后续行动或最终结果/);
    assert.match(est.prompt, /严禁产生时空穿越、场景突变或未经提及的突兀现代物品及全新主要道具/);

    // 3. Action (核心过程)：必须展现实际动作，且绝对移除强制冲突词，允许日常平静协作，并禁止擅自编造冲突对抗
    assert.match(act.prompt, /行动过程：清晨，钟离在孤云石林木桌旁检查旧黄铜灯/);
    assert.match(act.prompt, /允许日常平静生活、专注劳作、协作交谈等和平场景/);
    assert.match(act.prompt, /严禁擅自凭空添加冲突对抗或夸张戏剧性/);
    assert.doesNotMatch(act.prompt, /即时冲突/);

    // 4. Result (结果变化)：必须包含实际落定事实，延续相同固定人物外观，呈现道具最终状态与人物反应
    assert.match(res.prompt, /实际落定事实：钟离在荧帮助下修好了黄铜灯提手，灯没有点燃/);
    assert.match(res.prompt, /在场见证人物（保持同一批固定人物与外观）：钟离（棕色长袍，琥珀色眼眸。）、荧（浅色异域服饰，短发带花饰。）/);
    assert.match(res.prompt, /钟离（情绪呈现平静专注）/);
    assert.match(res.prompt, /荧（情绪呈现欣慰微喜）/);
    assert.match(res.prompt, /延续相同的固定人物外貌与着装，严禁篡改角色外观或时空环境/);

    // 5. 负向提示词约束：严禁未经提及的新主要道具、突兀现代物品、时空穿越与擅自添加冲突
    for (const img of [est, act, res]) {
      assert.match(img.negativePrompt, /突兀现代物品/);
      assert.match(img.negativePrompt, /未经提及的新主要道具/);
      assert.match(img.negativePrompt, /时空穿越/);
      assert.match(img.negativePrompt, /场景剧烈突变/);
      assert.match(img.negativePrompt, /擅自添加的冲突打斗/);
    }

    // 6. 初始 consistencyNote：客观且条件化声明，杜绝“一刀切断言 GPT 回退”
    assert.match(est.consistencyNote, /已纳入人物外观 2 位；提交时按工作流能力绑定参考图/);
    assert.match(est.consistencyNote, /仅发送首张参考图/);
    assert.doesNotMatch(est.consistencyNote, /GPT Image 等云端引擎，将回退为纯提示词约束/);

    // 7. 规划幂等性：重复对同一事件调用 plan 不会静默覆写已有规划对象
    const repeatPlan = f.images.plan(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      eventIds: [peacefulEvent.id],
    });
    assert.equal(repeatPlan.items.length, 3);
    assert.equal(repeatPlan.items[0].id, est.id);
    assert.equal(repeatPlan.items[0].prompt, est.prompt);
    assert.equal(repeatPlan.items[1].id, act.id);
    assert.equal(repeatPlan.items[1].prompt, act.prompt);
    assert.equal(repeatPlan.items[2].id, res.id);
    assert.equal(repeatPlan.items[2].prompt, res.prompt);
  } finally {
    f.cleanup();
  }
});

test('场景锚点与重要道具按事件地点和历史定义匹配，视觉备注不写成事实', () => {
  const f = setupFixture();
  try {
    const harbor = { id: 'loc-harbor', name: '三号码头', description: '吊机与货箱堆叠的码头。' };

    // tick 0：配置初版画面参考（石林锚点、浅滩锚点、黄铜灯、码头木箱、未限定地点的航海图）
    const original = testDefinition();
    original.locations = [...original.locations, harbor];
    original.visualReferences = [
      {
        id: 'vis-rock', name: '石林锚点', kind: 'location', locationId: 'loc-rock',
        description: '三根主石柱围住木桌，海雾从东侧涌入。', referenceArtifactIds: ['art-scene-rock'],
      },
      {
        id: 'loc-beach', name: '浅滩锚点', kind: 'location',
        description: '潮线处的碎石与木栈桥。', referenceArtifactIds: ['art-scene-beach'],
      },
      {
        id: 'vis-lamp', name: '黄铜灯', kind: 'prop', locationId: 'loc-rock',
        description: '提手上缠着旧布条，灯罩有缺口。', referenceArtifactIds: ['art-prop-lamp'],
      },
      {
        id: 'vis-crate', name: '漂流木箱', kind: 'prop', locationId: 'loc-harbor',
        description: '', referenceArtifactIds: ['art-prop-crate'],
      },
      {
        id: 'vis-map', name: '航海图', kind: 'prop',
        description: '', referenceArtifactIds: ['art-prop-map'],
      },
    ];
    let branch = f.store.getBranch(f.world.id, f.branchA.id);
    branch = f.store.updateDefinitionAtCurrentTick(f.world.id, f.branchA.id, branch.revision, original);

    const event1 = makeEvent(
      f.world.id, f.branchA.id, 'evt-vis-1', 10, ['actor-1'],
      '清晨，钟离在木桌旁检查旧黄铜灯，灯没有点燃。',
    );
    f.store.commitStep(f.world.id, f.branchA.id, branch.revision, {
      tick: 10, events: [event1], memories: [], states: [], consumedInterventionIds: [],
    });

    // tick 30：更换石林锚点与黄铜灯的画面说明，历史事件必须仍使用 tick 10 的定义
    branch = f.store.getBranch(f.world.id, f.branchA.id);
    f.store.commitStep(f.world.id, f.branchA.id, branch.revision, {
      tick: 30, events: [], memories: [], states: [], consumedInterventionIds: [],
    });
    branch = f.store.getBranch(f.world.id, f.branchA.id);
    const changed = testDefinition();
    changed.locations = [...changed.locations, harbor];
    changed.visualReferences = [
      {
        id: 'vis-rock', name: '石林锚点', kind: 'location', locationId: 'loc-rock',
        description: '石柱已被震裂，木桌翻倒。', referenceArtifactIds: ['art-scene-rock-v2'],
      },
      {
        id: 'vis-lamp', name: '黄铜灯', kind: 'prop', locationId: 'loc-rock',
        description: '灯已熔毁，只剩底座。', referenceArtifactIds: ['art-prop-lamp-v2'],
      },
      {
        id: 'loc-beach', name: '浅滩锚点', kind: 'location',
        description: '潮线处的碎石与木栈桥。', referenceArtifactIds: ['art-scene-beach'],
      },
      {
        id: 'vis-crate', name: '漂流木箱', kind: 'prop', locationId: 'loc-harbor',
        description: '', referenceArtifactIds: ['art-prop-crate'],
      },
      {
        id: 'vis-map', name: '航海图', kind: 'prop',
        description: '', referenceArtifactIds: ['art-prop-map'],
      },
    ];
    branch = f.store.updateDefinitionAtCurrentTick(f.world.id, f.branchA.id, branch.revision, changed);

    // tick 40：浅滩事件只提及航海图，不应注入石林锚点、黄铜灯或码头木箱
    const event2Base = makeEvent(
      f.world.id, f.branchA.id, 'evt-vis-2', 40, ['actor-2'],
      '荧在浅滩展开航海图，对照潮线确认方向。',
    );
    const event2: WorldEvent = {
      ...event2Base,
      locationId: 'loc-beach',
      stateChanges: event2Base.stateChanges.map((state) => ({ ...state, locationId: 'loc-beach' })),
    };
    f.store.commitStep(f.world.id, f.branchA.id, branch.revision, {
      tick: 40, events: [event2], memories: [], states: [], consumedInterventionIds: [],
    });
    branch = f.store.getBranch(f.world.id, f.branchA.id);

    const planned = f.images.plan(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      eventIds: [event1.id, event2.id],
    });
    const evt1 = planned.items.find((img) => img.eventId === event1.id && img.phase === 'establishing')!;
    const evt2 = planned.items.find((img) => img.eventId === event2.id && img.phase === 'establishing')!;

    // 1. 历史事件使用 tick 10 的快照：旧说明、旧素材，且只出现匹配地点/提及的道具
    assert.match(evt1.prompt, /场景锚点「石林锚点」/);
    assert.match(evt1.prompt, /三根主石柱围住木桌/);
    assert.match(evt1.prompt, /道具参考「黄铜灯」/);
    assert.match(evt1.prompt, /提手上缠着旧布条/);
    assert.doesNotMatch(evt1.prompt, /石柱已被震裂/);
    assert.doesNotMatch(evt1.prompt, /灯已熔毁/);
    assert.doesNotMatch(evt1.prompt, /浅滩锚点|漂流木箱|航海图/);
    assert.deepEqual(evt1.referenceArtifactIds, ['art-scene-rock', 'art-prop-lamp', 'art-ref-1']);
    assert.match(evt1.consistencyNote, /场景锚点 1 组、道具参考 1 组、人物外观 1 位/);
    assert.match(evt1.consistencyNote, /仅发送首张参考图/);

    // 2. 视觉备注只作为画面参考，不冒充事件事实
    assert.match(evt1.prompt, /仅用于画面一致性，不代表本次事件新增事实或设定/);

    // 3. 浅滩事件使用新快照，场景锚点可省略 locationId（用 id 匹配地点）；
    //    航海图因事件明确提及而出现，石林/黄铜灯/码头木箱都被排除。
    assert.match(evt2.prompt, /场景锚点「浅滩锚点」/);
    assert.match(evt2.prompt, /道具参考「航海图」/);
    assert.doesNotMatch(evt2.prompt, /石林锚点|黄铜灯|漂流木箱/);
    assert.deepEqual(evt2.referenceArtifactIds, ['art-scene-beach', 'art-prop-map', 'art-ref-2']);
  } finally {
    f.cleanup();
  }
});

test('旧世界没有 visualReferences 时保持原有规划与人物参考顺序', () => {
  const f = setupFixture();
  try {
    const event = makeEvent(f.world.id, f.branchA.id, 'evt-vis-legacy', 10, ['actor-1'], '钟离登高远眺孤云石林。');
    let branch = f.store.getBranch(f.world.id, f.branchA.id);
    f.store.commitStep(f.world.id, f.branchA.id, branch.revision, {
      tick: 10, events: [event], memories: [], states: [], consumedInterventionIds: [],
    });
    branch = f.store.getBranch(f.world.id, f.branchA.id);

    const planned = f.images.plan(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      eventIds: [event.id],
    });
    const est = planned.items.find((img) => img.phase === 'establishing')!;

    assert.doesNotMatch(est.prompt, /固定场景与道具参考/);
    assert.deepEqual(est.referenceArtifactIds, ['art-ref-1']);
    assert.match(est.consistencyNote, /已纳入人物外观 1 位/);
  } finally {
    f.cleanup();
  }
});

test('云端多图路径只发送首张参考图：透明标注限制并优先场景锚点', async () => {
  const f = setupFixture();
  try {
    f.database.connection.prepare(`
      INSERT INTO generation_workflows(id, name, description, engine_kind, category, latest_version, created_at, updated_at)
      VALUES ('cloud-i2i-vis-wf', 'Cloud I2I Visual', 'Cloud Image-to-Image Workflow', 'cloud', 'image', 1, '2026-01-01', '2026-01-01')
    `).run();
    f.database.connection.prepare(`
      INSERT INTO generation_workflow_versions(workflow_id, version, engine_id, input_schema_json, definition_json, is_published, created_at)
      VALUES (
        'cloud-i2i-vis-wf',
        1,
        'cloud-engine',
        '{"prompt":{"type":"string","required":true},"referenceImage":{"type":"string","semantic":"reference_image"}}',
        '{"type":"cloud_recipe","modelId":"codex/gpt-image-2","operation":"image-to-image"}',
        1,
        '2026-01-01'
      )
    `).run();

    const scenePath = join(f.tmpDir, 'art-scene-rock.png');
    writeFileSync(scenePath, Buffer.from(mock1x1PngBase64, 'base64'));
    f.database.connection.prepare(`
      INSERT INTO artifacts(id, app_id, local_path, content_type, byte_size, file_status, created_at, updated_at)
      VALUES ('art-scene-rock', 'story-worlds', ?, 'image/png', 100, 'ready', '2026-01-01', '2026-01-01')
    `).run(scenePath);

    const definition = testDefinition();
    definition.visualReferences = [
      {
        id: 'vis-rock', name: '石林锚点', kind: 'location', locationId: 'loc-rock',
        description: '三根主石柱围住木桌。', referenceArtifactIds: ['art-scene-rock'],
      },
      {
        id: 'vis-lamp', name: '黄铜灯', kind: 'prop', locationId: 'loc-rock',
        description: '', referenceArtifactIds: ['art-prop-lamp'],
      },
    ];
    let branch = f.store.getBranch(f.world.id, f.branchA.id);
    branch = f.store.updateDefinitionAtCurrentTick(f.world.id, f.branchA.id, branch.revision, definition);

    const event = makeEvent(
      f.world.id, f.branchA.id, 'evt-vis-i2i', 10, ['actor-1'],
      '钟离在孤云石林木桌旁检查黄铜灯。',
    );
    f.store.commitStep(f.world.id, f.branchA.id, branch.revision, {
      tick: 10, events: [event], memories: [], states: [], consumedInterventionIds: [],
    });
    branch = f.store.getBranch(f.world.id, f.branchA.id);

    const planned = f.images.plan(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      eventIds: [event.id],
    });
    const est = planned.items.find((img) => img.phase === 'establishing')!;
    assert.deepEqual(est.referenceArtifactIds, ['art-scene-rock', 'art-prop-lamp', 'art-ref-1']);

    const submitted = await f.images.submit(f.world.id, f.branchA.id, est.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'idemp-vis-i2i-first',
      engineId: 'cloud-engine',
      workflowId: 'cloud-i2i-vis-wf',
    });

    // 说明必须如实：仅首张发送、场景锚点优先，且明确其余参考未发送
    assert.match(submitted.consistencyNote, /已连接云端图生图（image-to-image）生成路径并绑定首张参考图/);
    assert.match(submitted.consistencyNote, /实际仅发送这一张/);
    assert.match(submitted.consistencyNote, /另有 2 张参考图未发送/);
    assert.match(submitted.consistencyNote, /场景锚点优先/);
    assert.doesNotMatch(submitted.consistencyNote, /已发送 3 张/);

    const taskRow = f.database.connection.prepare(
      'SELECT request_params_json FROM generation_tasks WHERE id=?',
    ).get(submitted.generationTaskId!) as { request_params_json: string };
    const inputArtifacts = JSON.parse(taskRow.request_params_json).inputArtifacts || [];
    assert.equal(inputArtifacts.length, 1);
    assert.equal(inputArtifacts[0].artifactId, 'art-scene-rock');
    assert.equal(inputArtifacts[0].inputKey, 'referenceImage');
  } finally {
    f.cleanup();
  }
});

test('跨应用参考媒体边界：只给实际发送的 ready 图建 reference grant，未选媒体不授权', async () => {
  const f = setupFixture();
  try {
    f.database.connection.prepare(`
      INSERT INTO generation_workflows(id, name, description, engine_kind, category, latest_version, created_at, updated_at)
      VALUES ('cloud-i2i-cross-app-wf', 'Cloud I2I Cross App', 'Cross app boundary', 'cloud', 'image', 1, '2026-01-01', '2026-01-01')
    `).run();
    f.database.connection.prepare(`
      INSERT INTO generation_workflow_versions(workflow_id, version, engine_id, input_schema_json, definition_json, is_published, created_at)
      VALUES (
        'cloud-i2i-cross-app-wf',
        1,
        'cloud-engine',
        '{"prompt":{"type":"string","required":true},"referenceImage":{"type":"string","semantic":"reference_image"}}',
        '{"type":"cloud_recipe","modelId":"codex/gpt-image-2","operation":"image-to-image"}',
        1,
        '2026-01-01'
      )
    `).run();

    const foreignPath = join(f.tmpDir, 'foreign-reference.png');
    writeFileSync(foreignPath, Buffer.from(mock1x1PngBase64, 'base64'));
    f.database.connection.prepare(`
      INSERT INTO artifacts(id, app_id, local_path, content_type, byte_size, file_status, created_at, updated_at)
      VALUES ('foreign-ready-image', 'activities', ?, 'image/png', 100, 'ready', '2026-01-01', '2026-01-01')
    `).run(foreignPath);
    const unusedPath = join(f.tmpDir, 'foreign-unused-image.png');
    writeFileSync(unusedPath, Buffer.from(mock1x1PngBase64, 'base64'));
    f.database.connection.prepare(`
      INSERT INTO artifacts(id, app_id, local_path, content_type, byte_size, file_status, created_at, updated_at)
      VALUES ('foreign-unused-image', 'activities', ?, 'image/png', 100, 'ready', '2026-01-01', '2026-01-01')
    `).run(unusedPath);

    const definition = testDefinition();
    definition.actors[0].referenceArtifactIds = ['foreign-ready-image'];
    let branch = f.store.getBranch(f.world.id, f.branchA.id);
    branch = f.store.updateDefinitionAtCurrentTick(f.world.id, f.branchA.id, branch.revision, definition);
    const event = makeEvent(f.world.id, f.branchA.id, 'evt-cross-app', 10, ['actor-1'], '钟离在港口整理衣摆。');
    f.store.commitStep(f.world.id, f.branchA.id, branch.revision, {
      tick: 10, events: [event], memories: [], states: [], consumedInterventionIds: [],
    });
    branch = f.store.getBranch(f.world.id, f.branchA.id);
    const planned = f.images.plan(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      eventIds: [event.id],
    });
    const establishing = planned.items.find((item) => item.phase === 'establishing')!;
    assert.deepEqual(establishing.referenceArtifactIds, ['foreign-ready-image']);

    const submitted = await f.images.submit(f.world.id, f.branchA.id, establishing.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'cross-app-reference',
      engineId: 'cloud-engine',
      workflowId: 'cloud-i2i-cross-app-wf',
    });
    assert.equal(submitted.status, 'queued');
    const grants = f.database.connection.prepare(
      'SELECT artifact_id, owner_app_id, grantee_app_id, access FROM artifact_grants WHERE grantee_app_id=?',
    ).all('story-worlds') as Array<{ artifact_id: string; owner_app_id: string; grantee_app_id: string; access: string }>;
    assert.deepEqual(grants.map((grant) => ({ ...grant })), [{
      artifact_id: 'foreign-ready-image', owner_app_id: 'activities',
      grantee_app_id: 'story-worlds', access: 'reference',
    }]);
    assert.equal(f.database.connection.prepare(
      "SELECT 1 FROM artifact_grants WHERE artifact_id='foreign-unused-image'",
    ).get(), undefined);
    const taskRow = f.database.connection.prepare(
      'SELECT request_params_json FROM generation_tasks WHERE id=?',
    ).get(submitted.generationTaskId!) as { request_params_json: string };
    assert.deepEqual(JSON.parse(taskRow.request_params_json).inputArtifacts, [{
      artifactId: 'foreign-ready-image', inputKey: 'referenceImage',
    }]);
    const createdGrant = f.database.connection.prepare(
      "SELECT expires_at FROM artifact_grants WHERE artifact_id='foreign-ready-image' AND grantee_app_id='story-worlds' AND access='reference'",
    ).get() as { expires_at: string | null };
    assert.ok(createdGrant.expires_at);
    const grantTtlMs = Date.parse(createdGrant.expires_at) - Date.now();
    assert.ok(grantTtlMs > 23 * 60 * 60 * 1000 && grantTtlMs <= 24 * 60 * 60 * 1000 + 60_000);

    const existingGrantPath = join(f.tmpDir, 'foreign-existing-grant.png');
    writeFileSync(existingGrantPath, Buffer.from(mock1x1PngBase64, 'base64'));
    f.database.connection.prepare(`
      INSERT INTO artifacts(id, app_id, local_path, content_type, byte_size, file_status, created_at, updated_at)
      VALUES ('foreign-existing-grant', 'activities', ?, 'image/png', 100, 'ready', '2026-01-01', '2026-01-01')
    `).run(existingGrantPath);
    f.database.connection.prepare(`
      INSERT INTO artifact_grants(id, artifact_id, owner_app_id, grantee_app_id, access, expires_at, created_at)
      VALUES ('existing-perpetual-reference-grant', 'foreign-existing-grant', 'activities', 'story-worlds', 'reference', NULL, '2026-01-01')
    `).run();
    definition.actors[0].referenceArtifactIds = ['foreign-existing-grant'];
    branch = f.store.getBranch(f.world.id, f.branchA.id);
    branch = f.store.updateDefinitionAtCurrentTick(f.world.id, f.branchA.id, branch.revision, definition);
    const existingEvent = makeEvent(f.world.id, f.branchA.id, 'evt-cross-app-existing', 15, ['actor-1'], '钟离在港口整理袖口。');
    f.store.commitStep(f.world.id, f.branchA.id, branch.revision, {
      tick: 15, events: [existingEvent], memories: [], states: [], consumedInterventionIds: [],
    });
    branch = f.store.getBranch(f.world.id, f.branchA.id);
    const existingPlan = f.images.plan(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      eventIds: [existingEvent.id],
    });
    const existingImage = existingPlan.items.find((item) => item.phase === 'establishing')!;
    const existingResult = await f.images.submit(f.world.id, f.branchA.id, existingImage.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'cross-app-existing-grant',
      engineId: 'cloud-engine',
      workflowId: 'cloud-i2i-cross-app-wf',
    });
    assert.equal(existingResult.status, 'queued');
    const existingGrantRows = f.database.connection.prepare(
      "SELECT id, expires_at FROM artifact_grants WHERE artifact_id='foreign-existing-grant'",
    ).all() as Array<{ id: string; expires_at: string | null }>;
    assert.deepEqual(existingGrantRows.map((row) => ({ ...row })), [{
      id: 'existing-perpetual-reference-grant', expires_at: null,
    }]);

    f.database.connection.prepare(`
      INSERT INTO artifacts(id, app_id, local_path, content_type, byte_size, file_status, created_at, updated_at)
      VALUES ('foreign-pending-image', 'activities', ?, 'image/png', 100, 'pending', '2026-01-01', '2026-01-01')
    `).run(unusedPath);
    definition.actors[0].referenceArtifactIds = ['foreign-pending-image'];
    branch = f.store.getBranch(f.world.id, f.branchA.id);
    branch = f.store.updateDefinitionAtCurrentTick(f.world.id, f.branchA.id, branch.revision, definition);
    const pendingEvent = makeEvent(f.world.id, f.branchA.id, 'evt-cross-app-pending', 20, ['actor-1'], '钟离在港口整理衣袖。');
    f.store.commitStep(f.world.id, f.branchA.id, branch.revision, {
      tick: 20, events: [pendingEvent], memories: [], states: [], consumedInterventionIds: [],
    });
    branch = f.store.getBranch(f.world.id, f.branchA.id);
    const pendingPlan = f.images.plan(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      eventIds: [pendingEvent.id],
    });
    const pendingImage = pendingPlan.items.find((item) => item.phase === 'establishing')!;
    const pendingResult = await f.images.submit(f.world.id, f.branchA.id, pendingImage.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'cross-app-pending',
      engineId: 'cloud-engine',
      workflowId: 'cloud-i2i-cross-app-wf',
    });
    assert.equal(pendingResult.status, 'failed');
    assert.match(pendingResult.error, /未就绪|文件不存在/);
    assert.equal(f.database.connection.prepare(
      "SELECT 1 FROM artifact_grants WHERE artifact_id='foreign-pending-image'",
    ).get(), undefined);

    f.database.connection.prepare(`
      INSERT INTO artifacts(id, app_id, local_path, content_type, byte_size, file_status, created_at, updated_at)
      VALUES ('foreign-audio-reference', 'activities', ?, 'audio/mpeg', 100, 'ready', '2026-01-01', '2026-01-01')
    `).run(unusedPath);
    definition.actors[0].referenceArtifactIds = ['foreign-audio-reference'];
    branch = f.store.getBranch(f.world.id, f.branchA.id);
    branch = f.store.updateDefinitionAtCurrentTick(f.world.id, f.branchA.id, branch.revision, definition);
    const audioEvent = makeEvent(f.world.id, f.branchA.id, 'evt-cross-app-audio', 30, ['actor-1'], '钟离在港口整理外袍。');
    f.store.commitStep(f.world.id, f.branchA.id, branch.revision, {
      tick: 30, events: [audioEvent], memories: [], states: [], consumedInterventionIds: [],
    });
    branch = f.store.getBranch(f.world.id, f.branchA.id);
    const audioPlan = f.images.plan(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      eventIds: [audioEvent.id],
    });
    const audioImage = audioPlan.items.find((item) => item.phase === 'establishing')!;
    const audioResult = await f.images.submit(f.world.id, f.branchA.id, audioImage.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'cross-app-audio',
      engineId: 'cloud-engine',
      workflowId: 'cloud-i2i-cross-app-wf',
    });
    assert.equal(audioResult.status, 'failed');
    assert.match(audioResult.error, /不是图片/);
    assert.equal(f.database.connection.prepare(
      "SELECT 1 FROM artifact_grants WHERE artifact_id='foreign-audio-reference'",
    ).get(), undefined);

    const tasksBeforeMissingReference = Number(f.database.connection.prepare(
      'SELECT COUNT(*) AS count FROM generation_tasks WHERE app_id=?',
    ).get('story-worlds')?.count ?? 0);
    definition.actors[0].referenceArtifactIds = ['missing-reference-image'];
    branch = f.store.getBranch(f.world.id, f.branchA.id);
    branch = f.store.updateDefinitionAtCurrentTick(f.world.id, f.branchA.id, branch.revision, definition);
    const missingEvent = makeEvent(f.world.id, f.branchA.id, 'evt-cross-app-missing', 35, ['actor-1'], '钟离在港口整理腰带。');
    f.store.commitStep(f.world.id, f.branchA.id, branch.revision, {
      tick: 35, events: [missingEvent], memories: [], states: [], consumedInterventionIds: [],
    });
    branch = f.store.getBranch(f.world.id, f.branchA.id);
    const missingPlan = f.images.plan(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      eventIds: [missingEvent.id],
    });
    const missingImage = missingPlan.items.find((item) => item.phase === 'establishing')!;
    const missingResult = await f.images.submit(f.world.id, f.branchA.id, missingImage.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'cross-app-missing',
      engineId: 'cloud-engine',
      workflowId: 'cloud-i2i-cross-app-wf',
    });
    assert.equal(missingResult.status, 'failed');
    assert.match(missingResult.error, /未就绪|不存在/);
    assert.equal(f.database.connection.prepare(
      'SELECT COUNT(*) AS count FROM generation_tasks WHERE app_id=?',
    ).get('story-worlds')?.count, tasksBeforeMissingReference);

    f.database.connection.prepare(`
      INSERT INTO artifacts(id, app_id, local_path, content_type, byte_size, file_status, created_at, updated_at)
      VALUES ('foreign-rollback-image', 'activities', ?, 'image/png', 100, 'ready', '2026-01-01', '2026-01-01')
    `).run(unusedPath);
    f.database.connection.prepare(`
      INSERT INTO generation_workflows(id, name, description, engine_kind, category, latest_version, created_at, updated_at)
      VALUES ('cloud-i2i-missing-version', 'Missing Version', '', 'cloud', 'image', 1, '2026-01-01', '2026-01-01')
    `).run();
    f.database.connection.prepare(`
      INSERT INTO generation_workflow_versions(workflow_id, version, engine_id, input_schema_json, definition_json, is_published, created_at)
      VALUES ('cloud-i2i-missing-version', 1, 'cloud-engine',
        '{"prompt":{"type":"string","required":true},"referenceImage":{"type":"string","semantic":"reference_image"}}',
        '{"type":"cloud_recipe","modelId":"codex/gpt-image-2","operation":"image-to-image"}', 0, '2026-01-01')
    `).run();
    definition.actors[0].referenceArtifactIds = ['foreign-rollback-image'];
    branch = f.store.getBranch(f.world.id, f.branchA.id);
    branch = f.store.updateDefinitionAtCurrentTick(f.world.id, f.branchA.id, branch.revision, definition);
    const rollbackEvent = makeEvent(f.world.id, f.branchA.id, 'evt-cross-app-rollback', 40, ['actor-1'], '钟离在港口整理衣襟。');
    f.store.commitStep(f.world.id, f.branchA.id, branch.revision, {
      tick: 40, events: [rollbackEvent], memories: [], states: [], consumedInterventionIds: [],
    });
    branch = f.store.getBranch(f.world.id, f.branchA.id);
    const rollbackPlan = f.images.plan(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      eventIds: [rollbackEvent.id],
    });
    const rollbackImage = rollbackPlan.items.find((item) => item.phase === 'establishing')!;
    const rollbackResult = await f.images.submit(f.world.id, f.branchA.id, rollbackImage.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'cross-app-rollback',
      engineId: 'cloud-engine',
      workflowId: 'cloud-i2i-missing-version',
    });
    assert.equal(rollbackResult.status, 'failed');
    assert.equal(f.database.connection.prepare(
      "SELECT 1 FROM artifact_grants WHERE artifact_id='foreign-rollback-image'",
    ).get(), undefined);
  } finally {
    f.cleanup();
  }
});

test('并发 submit 在 createGenerationTask await 期间用引用租约保护共用 grant，失败方不误撤', async () => {
  const f = setupFixture();
  const secrets = new BlockingSecrets();
  const images = new StoryWorldImages({
    database: f.database,
    config: f.config,
    secrets,
    fetcher: f.fetcher,
    store: f.store,
  });
  try {
    f.database.connection.prepare(`
      INSERT INTO generation_workflows(id, name, description, engine_kind, category, latest_version, created_at, updated_at)
      VALUES ('cloud-i2i-race-fail', 'Cloud I2I Race Fail', '', 'cloud', 'image', 1, '2026-01-01', '2026-01-01')
    `).run();
    f.database.connection.prepare(`
      INSERT INTO generation_workflow_versions(
        workflow_id, version, engine_id, input_schema_json, definition_json,
        input_capabilities_json, is_published, created_at
      )
      VALUES (
        'cloud-i2i-race-fail',
        1,
        'cloud-engine',
        '{"prompt":{"type":"string","required":true},"referenceImage":{"type":"string","semantic":"reference_image"}}',
        '{"type":"cloud_recipe","modelId":"codex/gpt-image-2","operation":"image-to-image"}',
        '{"referenceImage":{"mediaTypes":["image/jpeg"]}}',
        1,
        '2026-01-01'
      )
    `).run();
    f.database.connection.prepare(`
      INSERT INTO generation_workflows(id, name, description, engine_kind, category, latest_version, created_at, updated_at)
      VALUES ('cloud-i2i-race-ok', 'Cloud I2I Race Ok', '', 'cloud', 'image', 1, '2026-01-01', '2026-01-01')
    `).run();
    f.database.connection.prepare(`
      INSERT INTO generation_workflow_versions(workflow_id, version, engine_id, input_schema_json, definition_json, is_published, created_at)
      VALUES (
        'cloud-i2i-race-ok',
        1,
        'cloud-engine',
        '{"prompt":{"type":"string","required":true},"referenceImage":{"type":"string","semantic":"reference_image"}}',
        '{"type":"cloud_recipe","modelId":"codex/gpt-image-2","operation":"image-to-image"}',
        1,
        '2026-01-01'
      )
    `).run();

    const racePath = join(f.tmpDir, 'foreign-race-image.png');
    writeFileSync(racePath, Buffer.from(mock1x1PngBase64, 'base64'));
    f.database.connection.prepare(`
      INSERT INTO artifacts(id, app_id, local_path, content_type, byte_size, file_status, created_at, updated_at)
      VALUES ('foreign-race-image', 'activities', ?, 'image/png', 100, 'ready', '2026-01-01', '2026-01-01')
    `).run(racePath);

    const definition = testDefinition();
    definition.actors[0].referenceArtifactIds = ['foreign-race-image'];
    let branch = f.store.getBranch(f.world.id, f.branchA.id);
    branch = f.store.updateDefinitionAtCurrentTick(f.world.id, f.branchA.id, branch.revision, definition);
    const event = makeEvent(f.world.id, f.branchA.id, 'evt-cross-app-race', 60, ['actor-1'], '钟离在港口整理佩饰。');
    f.store.commitStep(f.world.id, f.branchA.id, branch.revision, {
      tick: 60, events: [event], memories: [], states: [], consumedInterventionIds: [],
    });
    branch = f.store.getBranch(f.world.id, f.branchA.id);
    const plan = images.plan(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      eventIds: [event.id],
    });
    const failingImage = plan.items.find((item) => item.phase === 'establishing')!;
    const succeedingImage = plan.items.find((item) => item.phase === 'action')!;

    const failingSubmit = images.submit(f.world.id, f.branchA.id, failingImage.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'race-fail',
      engineId: 'cloud-engine',
      workflowId: 'cloud-i2i-race-fail',
    });
    const succeedingSubmit = images.submit(f.world.id, f.branchA.id, succeedingImage.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'race-ok',
      engineId: 'cloud-engine',
      workflowId: 'cloud-i2i-race-ok',
    });

    await secrets.waitForWaiters(2);
    const concurrentInstance = new StoryWorldImages({
      database: f.database,
      config: f.config,
      secrets: f.secrets,
      fetcher: f.fetcher,
      store: f.store,
    });
    assert.ok(concurrentInstance);
    const leasesBefore = f.database.connection.prepare(
      "SELECT ref_id FROM artifact_references WHERE artifact_id='foreign-race-image' AND app_id=? AND ref_type=?",
    ).all('story-worlds', 'story-world-image-lease') as Array<{ ref_id: string }>;
    assert.equal(leasesBefore.length, 2);
    assert.equal(new Set(leasesBefore.map((row) => row.ref_id)).size, 2);
    assert.ok(f.database.connection.prepare(
      "SELECT 1 FROM artifact_grants WHERE artifact_id='foreign-race-image' AND grantee_app_id='story-worlds' AND access='reference'",
    ).get());

    secrets.releaseOne();
    const failingResult = await failingSubmit;
    assert.equal(failingResult.status, 'failed');
    assert.match(failingResult.error, /MIME/);
    assert.ok(f.database.connection.prepare(
      "SELECT 1 FROM artifact_grants WHERE artifact_id='foreign-race-image' AND grantee_app_id='story-worlds' AND access='reference'",
    ).get());
    const leasesAfterFailure = f.database.connection.prepare(
      "SELECT ref_id FROM artifact_references WHERE artifact_id='foreign-race-image' AND app_id=? AND ref_type=?",
    ).all('story-worlds', 'story-world-image-lease') as Array<{ ref_id: string }>;
    assert.equal(leasesAfterFailure.length, 1);

    secrets.releaseOne();
    const succeedingResult = await succeedingSubmit;
    assert.equal(succeedingResult.status, 'queued');
    assert.ok(succeedingResult.generationTaskId);
    assert.equal(f.database.connection.prepare(
      "SELECT COUNT(*) AS count FROM artifact_references WHERE artifact_id='foreign-race-image' AND app_id=? AND ref_type=?",
    ).get('story-worlds', 'story-world-image-lease')?.count, 0);
    assert.ok(f.database.connection.prepare(
      "SELECT 1 FROM artifact_references WHERE artifact_id='foreign-race-image' AND app_id=? AND ref_type='generation-input' AND ref_id=?",
    ).get('story-worlds', succeedingResult.generationTaskId));
    assert.ok(f.database.connection.prepare(
      "SELECT 1 FROM artifact_grants WHERE artifact_id='foreign-race-image' AND grantee_app_id='story-worlds' AND access='reference'",
    ).get());
  } finally {
    f.cleanup();
  }
});

test('服务重启恢复：清理遗留 lease 并按 generation_tasks 幂等键收敛 reserved submission', async () => {
  const f = setupFixture(undefined, { persistent: true });
  let restartedDatabase: ServiceDatabase | null = null;
  let firstClosed = false;
  try {
    const definition = testDefinition();
    let branch = f.store.getBranch(f.world.id, f.branchA.id);
    branch = f.store.updateDefinitionAtCurrentTick(f.world.id, f.branchA.id, branch.revision, definition);
    const event = makeEvent(f.world.id, f.branchA.id, 'evt-restart-recovery', 80, ['actor-1'], '钟离在港口收整行装。');
    f.store.commitStep(f.world.id, f.branchA.id, branch.revision, {
      tick: 80, events: [event], memories: [], states: [], consumedInterventionIds: [],
    });
    branch = f.store.getBranch(f.world.id, f.branchA.id);
    const plan = f.images.plan(f.world.id, f.branchA.id, {
      expectedRevision: branch.revision,
      eventIds: [event.id],
    });
    const establishingImage = plan.items.find((item) => item.phase === 'establishing')!;
    const actionImage = plan.items.find((item) => item.phase === 'action')!;
    const resultImage = plan.items.find((item) => item.phase === 'result')!;

    const withTaskResult = await f.images.submit(f.world.id, f.branchA.id, actionImage.id, {
      expectedRevision: branch.revision,
      idempotencyKey: 'restart-with-task',
      engineId: 'cloud-engine',
      workflowId: 'cloud-t2i-wf',
    });
    assert.equal(withTaskResult.status, 'queued');
    const withTaskSubmission = f.database.connection.prepare(
      'SELECT id FROM sw_image_submissions WHERE branch_id=? AND idempotency_key=?',
    ).get(f.branchA.id, 'restart-with-task') as { id: string };
    f.database.connection.prepare(`
      UPDATE sw_image_submissions SET status='reserved', task_id=NULL, updated_at='2026-01-02' WHERE id=?
    `).run(withTaskSubmission.id);
    const actionImageRow = f.database.connection.prepare(
      'SELECT data_json FROM sw_images WHERE id=?',
    ).get(actionImage.id) as { data_json: string };
    const actionImageData = JSON.parse(actionImageRow.data_json) as Record<string, unknown>;
    actionImageData.status = 'planned';
    actionImageData.generationTaskId = null;
    actionImageData.artifactId = null;
    actionImageData.imageUrl = null;
    actionImageData.error = '';
    f.database.connection.prepare(
      'UPDATE sw_images SET data_json=?, updated_at=? WHERE id=?',
    ).run(JSON.stringify(actionImageData), '2026-01-02', actionImage.id);

    const crashedRun: WorldRun = {
      id: 'restart-crashed-run',
      worldId: f.world.id,
      branchId: f.branchA.id,
      status: 'paused',
      settings: {
        durationTicks: 1440,
        stepTicks: 60,
        maxTextCalls: 120,
        maxImages: 2,
        autoImages: false,
      },
      startTick: 0,
      targetTick: 1440,
      completedTick: 80,
      textCallsUsed: 0,
      imagesSubmitted: 1,
      pauseReason: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    f.database.connection.prepare(
      'INSERT INTO sw_runs (id, world_id, branch_id, status, data_json, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      crashedRun.id, f.world.id, f.branchA.id, crashedRun.status, JSON.stringify(crashedRun),
      'restart-crashed-run-key', '2026-01-01', '2026-01-01',
    );
    const insertReservedSubmission = f.database.connection.prepare(`
      INSERT INTO sw_image_submissions(
        id, branch_id, image_id, idempotency_key, request_hash, run_id,
        status, task_id, error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'reserved', NULL, NULL, ?, ?)
    `);
    insertReservedSubmission.run(
      'restart-run-submission', f.branchA.id, establishingImage.id,
      'restart-run-crash', 'restart-run-hash', crashedRun.id, '2026-01-02', '2026-01-02',
    );
    insertReservedSubmission.run(
      'restart-manual-submission', f.branchA.id, resultImage.id,
      'restart-manual-crash', 'restart-manual-hash', null, '2026-01-02', '2026-01-02',
    );
    const insertLease = f.database.connection.prepare(`
      INSERT INTO artifact_references(id, artifact_id, app_id, ref_type, ref_id, created_at)
      VALUES (?, 'art-ref-1', 'story-worlds', 'story-world-image-lease', ?, '2026-01-02')
    `);
    insertLease.run('restart-lease-task', withTaskSubmission.id);
    insertLease.run('restart-lease-run', 'restart-run-submission');
    insertLease.run('restart-lease-manual', 'restart-manual-submission');
    insertLease.run('restart-lease-orphan', 'restart-missing-submission');

    f.database.close();
    firstClosed = true;
    restartedDatabase = new ServiceDatabase(f.databasePath!);
    const restartedStore = new StoryWorldStore(restartedDatabase);
    const restartedImages = new StoryWorldImages({
      database: restartedDatabase,
      config: f.config,
      secrets: f.secrets,
      fetcher: f.fetcher,
      store: restartedStore,
    });
    assert.deepEqual(restartedImages.recoverInterruptedSubmissions(), {
      leasesRemoved: 4,
      submissionsReconciled: 1,
      submissionsFailed: 2,
    });
    assert.equal(restartedDatabase.connection.prepare(
      "SELECT COUNT(*) AS count FROM artifact_references WHERE app_id='story-worlds' AND ref_type='story-world-image-lease'",
    ).get()?.count, 0);
    const recoveredSubmission = restartedDatabase.connection.prepare(
      'SELECT status, task_id FROM sw_image_submissions WHERE id=?',
    ).get(withTaskSubmission.id) as { status: string; task_id: string | null };
    assert.equal(recoveredSubmission.status, 'submitted');
    assert.equal(recoveredSubmission.task_id, withTaskResult.generationTaskId);
    const recoveredTaskImage = restartedImages.get(f.world.id, f.branchA.id, actionImage.id);
    assert.equal(recoveredTaskImage.generationTaskId, withTaskResult.generationTaskId);
    assert.equal(recoveredTaskImage.status, 'queued');

    const failedSubmissions = restartedDatabase.connection.prepare(`
      SELECT idempotency_key, status, task_id, error
      FROM sw_image_submissions
      WHERE id IN ('restart-run-submission', 'restart-manual-submission')
      ORDER BY id
    `).all() as Array<{ idempotency_key: string; status: string; task_id: string | null; error: string | null }>;
    assert.deepEqual(failedSubmissions.map((row) => row.idempotency_key), ['restart-manual-crash', 'restart-run-crash']);
    for (const row of failedSubmissions) {
      assert.equal(row.status, 'failed');
      assert.equal(row.task_id, null);
      assert.match(String(row.error), /服务重启/);
    }
    assert.equal(restartedImages.get(f.world.id, f.branchA.id, establishingImage.id).status, 'failed');
    assert.equal(restartedImages.get(f.world.id, f.branchA.id, resultImage.id).status, 'failed');
    assert.equal(
      (JSON.parse((restartedDatabase.connection.prepare(
        'SELECT data_json FROM sw_runs WHERE id=?',
      ).get(crashedRun.id) as { data_json: string }).data_json) as WorldRun).imagesSubmitted,
      0,
    );
    assert.equal(restartedDatabase.connection.prepare(`
      SELECT COUNT(*) AS count FROM sw_image_submissions
      WHERE branch_id=? AND run_id IS NULL AND status IN ('reserved','submitted')
    `).get(f.branchA.id)?.count, 1);
    assert.equal(restartedDatabase.connection.prepare(
      'SELECT COUNT(*) AS count FROM generation_tasks WHERE app_id=?',
    ).get('story-worlds')?.count, 1);
    assert.deepEqual(restartedImages.recoverInterruptedSubmissions(), {
      leasesRemoved: 0,
      submissionsReconciled: 0,
      submissionsFailed: 0,
    });
  } finally {
    restartedDatabase?.close();
    if (!firstClosed) f.database.close();
    rmSync(f.tmpDir, { recursive: true, force: true });
  }
});
