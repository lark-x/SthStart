import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from './server.js';
import { ServiceDatabase } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { resolveEffectiveModelProfile } from './providers.js';
import { executeTextLlm } from './llm/common-llm.js';
import { ExecutionRegistry } from './generation/execution-registry.js';
import { listUnifiedTasks, getActiveTasksCount } from './tasks/adapters.js';

const ADMIN_TOKEN = 'test-admin-secret-token-completion';
const adminHeaders = { 'x-sthstart-admin-token': ADMIN_TOKEN };

class MemorySecrets extends SecretStore {
  readonly values = new Map<string, string>();
  override async status() { return { available: true, backend: 'memory', envFallback: false }; }
  override async get(account: string) {
    const value = this.values.get(account);
    return value === undefined ? { value: null, source: 'none' as const } : { value, source: 'keyring' as const };
  }
  override async set(account: string, value: string) { this.values.set(account, value); }
  override async delete(account: string) { this.values.delete(account); }
}

test('Phase 1 & 2: 下划线ID、凭据账号保留、高级参数合并与能力测试真实性', async () => {
  const db = new ServiceDatabase();
  const secrets = new MemorySecrets();
  const config = readConfig({ STHSTART_ADMIN_TOKEN: ADMIN_TOKEN });

  let lastSentBody: Record<string, unknown> | null = null;
  let mockJsonResponse = '这是普通文本，不是JSON喵。';

  const mockFetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (init?.body) {
      try {
        lastSentBody = JSON.parse(String(init.body)) as Record<string, unknown>;
      } catch {}
    }
    if (url.endsWith('/models')) {
      return Response.json({ data: [{ id: 'gpt-4o' }] });
    }
    if (url.endsWith('/chat/completions')) {
      return Response.json({
        id: 'chatcmpl-mock',
        choices: [{ message: { role: 'assistant', content: mockJsonResponse } }],
      });
    }
    return new Response('ok', { status: 200 });
  };

  const { app } = await createService({ config, database: db, secrets, fetcher: mockFetcher });

  try {
    // 1. 创建带有下划线的连接 ID
    const connRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/connections',
      headers: adminHeaders,
      payload: {
        id: 'conn_openai_test',
        name: 'OpenAI 历史连接',
        kind: 'openai-compatible-text',
        baseUrl: 'https://api.openai.com/v1',
        secret: 'sk-orig-secret',
      },
    });
    assert.equal(connRes.statusCode, 201, '允许包含下划线的连接ID');

    // 2. 更新连接时不传 secret，验证原有 credential_account 不被覆写清空
    const connRowBefore = db.connection.prepare('SELECT credential_account FROM service_connections WHERE id = ?').get('conn_openai_test') as { credential_account: string };
    const updateConnRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/connections',
      headers: adminHeaders,
      payload: {
        id: 'conn_openai_test',
        name: 'OpenAI 连接已改名',
        kind: 'openai-compatible-text',
        baseUrl: 'https://api.openai.com/v1',
      },
    });
    assert.equal(updateConnRes.statusCode, 201);
    const connRowAfter = db.connection.prepare('SELECT credential_account FROM service_connections WHERE id = ?').get('conn_openai_test') as { credential_account: string };
    assert.equal(connRowAfter.credential_account, connRowBefore.credential_account, '不传密码时保留原凭据账号引用');
    const secretVal = await secrets.get(connRowAfter.credential_account);
    assert.equal(secretVal.value, 'sk-orig-secret', '原有凭据依然完整可用');

    // 3. 创建带有下划线的模型配置，并设置高级参数
    const modelRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/models',
      headers: adminHeaders,
      payload: {
        id: 'model_gpt_4o',
        connectionId: 'conn_openai_test',
        name: 'GPT-4o 高级模型',
        modelId: 'gpt-4o',
        defaultParams: { temperature: 0.25 },
        advancedJson: { thinkingMode: 'enabled' },
      },
    });
    assert.equal(modelRes.statusCode, 201, '允许包含下划线的模型配置ID');

    // 4. 更新模型配置时未传递 defaultParams 和 advancedJson，验证不被清空为 {}
    const updateModelRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/models',
      headers: adminHeaders,
      payload: {
        id: 'model_gpt_4o',
        connectionId: 'conn_openai_test',
        name: 'GPT-4o 名称变更',
        modelId: 'gpt-4o',
      },
    });
    assert.equal(updateModelRes.statusCode, 201);
    const modelRowAfter = db.connection.prepare('SELECT default_params_json, advanced_json FROM model_profiles WHERE id = ?').get('model_gpt_4o') as { default_params_json: string; advanced_json: string };
    assert.deepEqual(JSON.parse(modelRowAfter.default_params_json), { temperature: 0.25 }, '未传默认参数时保留原配置');
    assert.deepEqual(JSON.parse(modelRowAfter.advanced_json), { thinkingMode: 'enabled' }, '未传高级参数时保留原配置');

    // 5. 显式指定不存在模型时报错拒绝回退
    await assert.rejects(
      async () => {
        await resolveEffectiveModelProfile(db, secrets, 'activities', 'activity-text-whole', 'non_existent_model');
      },
      /explicit_model_not_found/,
      '显式指定不存在模型必须拒绝回退',
    );

    // 6. JSON 能力测试：若返回非 JSON，必须标记测试失败
    mockJsonResponse = '普通文本，非合法JSON';
    const jsonTestRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/models/model_gpt_4o/test',
      headers: adminHeaders,
      payload: { type: 'json' },
    });
    const jsonTestBody = jsonTestRes.json();
    assert.equal(jsonTestBody.success, false, '非JSON响应必须标记为测试失败');
    const modelTestRow = db.connection.prepare('SELECT test_status FROM model_profiles WHERE id = ?').get('model_gpt_4o') as { test_status: string };
    assert.equal(modelTestRow.test_status, 'failed', '数据库状态标记为 failed');

    // 7. JSON 能力测试：若返回合法 JSON，标记通过
    mockJsonResponse = '{"status":"ok"}';
    const jsonPassRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/models/model_gpt_4o/test',
      headers: adminHeaders,
      payload: { type: 'json' },
    });
    assert.equal(jsonPassRes.json().success, true, '合法JSON响应标记测试通过');

    // 8. Vision 能力测试：验证向上游发送了带有 image_url 的多模态内容
    lastSentBody = null;
    const visionTestRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/models/model_gpt_4o/test',
      headers: adminHeaders,
      payload: { type: 'vision' },
    });
    assert.equal(visionTestRes.json().success, true);
    assert.ok(lastSentBody, '向模型发送了请求');
    const messages = (lastSentBody as { messages?: Array<{ role: string; content: unknown }> }).messages;
    const userMsg = messages?.find((m) => m.role === 'user');
    assert.ok(Array.isArray(userMsg?.content), 'Vision 测试消息 content 为数组');
    const hasImage = (userMsg?.content as Array<{ type: string }>).some((p) => p.type === 'image_url');
    assert.ok(hasImage, 'Vision 测试消息中包含真实 image_url');
  } finally {
    await app.close();
    db.close();
  }
});

test('Phase 2 & 3: common-llm stream 过滤、温度优先级与云端工作流配方发布', async () => {
  const db = new ServiceDatabase();
  const secrets = new MemorySecrets();
  const config = readConfig({ STHSTART_ADMIN_TOKEN: ADMIN_TOKEN });

  let capturedPayload: Record<string, unknown> | null = null;
  const mockFetcher: typeof fetch = async (_input, init) => {
    if (init?.body) {
      capturedPayload = JSON.parse(String(init.body)) as Record<string, unknown>;
    }
    return Response.json({
      choices: [{ message: { role: 'assistant', content: '测试成功' } }],
    });
  };

  // 1. 验证 common-llm 剔除 stream 且允许配置温度
  await executeTextLlm({
    profile: {
      baseUrl: 'https://api.openai.com/v1',
      model: 'test-model',
      extraBody: { stream: true, temperature: 0.15 },
    },
    prompt: 'hello',
    fetchFn: mockFetcher,
  });
  const sentPayload = capturedPayload as Record<string, unknown> | null;
  assert.equal(sentPayload?.stream, undefined, 'stream 参数被完全剔除');
  assert.equal(sentPayload?.temperature, 0.15, '采用了 extraBody 中的温度配置');

  // 2. 验证云端工作流版本发布
  const { app } = await createService({ config, database: db, secrets, fetcher: mockFetcher });
  try {
    // 创建一个 engine_kind 为 cloud 的工作流
    db.connection.prepare(`
      INSERT INTO generation_workflows (id, name, description, engine_kind, category, latest_version, created_at, updated_at)
      VALUES ('cloud_wf_test', '云端配方测试', '用于验证云端校验', 'cloud', 'image', 0, '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00.000Z')
    `).run();

    const publishRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/generation/workflows/cloud_wf_test/versions',
      headers: adminHeaders,
      payload: {
        definition: {
          promptTemplate: 'masterpiece, {{prompt}}',
          size: '1024x1024',
          model: 'dall-e-3',
        },
        inputSchema: { prompt: { type: 'string' } },
        nodeBindings: {},
        outputDeclarations: ['image'],
      },
    });

    assert.equal(publishRes.statusCode, 201, '云端生图配方版本顺利发布，未被 ComfyUI 结构校验拦截');
    const versionRow = db.connection.prepare('SELECT version, is_published FROM generation_workflow_versions WHERE workflow_id = ?').get('cloud_wf_test') as { version: number; is_published: number };
    assert.equal(versionRow.version, 1);
    assert.equal(versionRow.is_published, 1);
  } finally {
    await app.close();
    db.close();
  }
});

test('Phase 4: 统一任务中心 SQL 筛选与登记器排空容错', async () => {
  const db = new ServiceDatabase();

  // 1. 模拟 25 条已完成的旧采集任务
  for (let i = 1; i <= 25; i++) {
    db.connection.prepare(`
      INSERT INTO topic_collection_runs (id, status, progress_label, created_count, merged_count, failed_count, created_at, updated_at)
      VALUES (?, 'succeeded', '已完成', 5, 2, 0, ?, ?)
    `).run(`task_old_${i}`, `2026-09-30T10:00:${i < 10 ? '0' + i : i}.000Z`, `2026-09-30T10:00:${i < 10 ? '0' + i : i}.000Z`);
  }

  // 插入 1 条活跃的运行中任务，创建时间较早
  db.connection.prepare(`
    INSERT INTO topic_collection_runs (id, status, progress_label, created_count, merged_count, failed_count, created_at, updated_at)
    VALUES ('task_active_1', 'running', '正在采集', 1, 0, 0, '2026-09-30T09:00:00.000Z', '2026-09-30T09:00:00.000Z')
  `).run();

  // 独立统计活跃数必须精准为 1
  const count = getActiveTasksCount(db);
  assert.equal(count, 1, '活跃任务独立统计数精准为 1');

  // 当 filterState === 'active' 时，limit 设为 10，依然必须查出该运行中任务（不被 25 条完成任务挤出）
  const activeList = listUnifiedTasks(db, { limit: 10, state: 'active' });
  assert.equal(activeList.activeCount, 1, '返回的 activeCount 精准为 1');
  assert.equal(activeList.items.length, 1, '查出了活跃任务');
  assert.equal(activeList.items[0].taskId, 'task_active_1', '活跃任务正确返回');

  // 2. 执行登记器：安全捕获 rejection 与超时追踪
  const registry = new ExecutionRegistry();
  let rejectHandled = false;
  const failingPromise = Promise.reject(new Error('simulated_failure')).catch(() => {
    rejectHandled = true;
  });

  const abortController = registry.register({
    taskId: 'task_failing_test',
    appId: 'test',
    kind: 'test',
    promise: failingPromise,
  });
  assert.ok(abortController);
  await failingPromise;
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(registry.isExecuting('task_failing_test'), false, '任务结束后自动移出登记器');
  assert.ok(rejectHandled);

  // 3. 执行登记器超时排空：记录超时任务
  let neverResolve: () => void = () => {};
  const hangingPromise = new Promise<void>((resolve) => { neverResolve = resolve; });
  registry.register({
    taskId: 'task_hanging_test',
    appId: 'test',
    kind: 'test',
    promise: hangingPromise,
  });

  await registry.drain(30);
  const timedOut = registry.getTimedOutTasks();
  assert.ok(timedOut.some((t) => t.taskId === 'task_hanging_test'), '超时任务被记录在 timedOutTasks 中');

  // 释放挂起的 promise
  neverResolve();
  await new Promise((r) => setTimeout(r, 20));
  db.close();
});
