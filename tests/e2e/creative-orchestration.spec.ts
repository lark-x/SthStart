import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type {
  CreativeRunDetail,
  CreativeRole,
  CreativeWorkflow,
  CreativeWorkflowDocument,
} from '@sthstart/contracts';
import { isOwnedDirectory } from './global-setup';

test.use({ serviceWorkers: 'block' });
const portal = `http://127.0.0.1:${process.env.E2E_PORTAL_PORT ?? '4273'}`;
const admin = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT ?? '4200'}/api/v1/admin`;
const api = `${admin}/creative-orchestration`;
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };

async function enter(page: Page) {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY || '')).toBe(true);
  const auth = await page.request.post(`${portal}/api/auth/admin-session`, { headers: { origin: portal } });
  expect(auth.ok()).toBe(true);
  await page.goto('/apps/ai-studio');
  await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');
  await expect(page.getByRole('heading', { name: 'AI 创作工作台', exact: true })).toBeVisible();
}

// This runs the real persisted scheduler and approval API. video_plan is a local,
// deterministic planning tool: no provider or paid model request is dispatched.
function fixtureDocument(name: string): CreativeWorkflowDocument {
  return {
    name,
    description: '无付费本地视频方案流程，用于验证候选与人工确认。',
    purpose: 'video-plan',
    nodes: [
      {
        id: 'context',
        label: '读取故事资料',
        kind: 'context',
        outputKind: 'context',
        inputs: {},
        config: {},
        position: { x: 20, y: 60 },
      },
      {
        id: 'plan',
        label: '准备视频方案',
        kind: 'tool',
        outputKind: 'plan',
        inputs: { context: { nodeId: 'context', kind: 'context' } },
        config: { tool: 'video_plan', importance: 'key' },
        position: { x: 280, y: 60 },
      },
      {
        id: 'approval',
        label: '确认视频方案',
        kind: 'approval',
        outputKind: 'decision',
        inputs: { plan: { nodeId: 'plan', kind: 'plan' } },
        config: { reviewerRoleIds: ['production_manager'] },
        position: { x: 540, y: 60 },
      },
      {
        id: 'adopt',
        label: '归档已确认方案',
        kind: 'adopt',
        outputKind: 'result',
        inputs: { decision: { nodeId: 'approval', kind: 'decision' } },
        config: {},
        position: { x: 800, y: 60 },
      },
    ],
    edges: [
      { id: 'context_plan', source: 'context', target: 'plan', when: 'always' },
      { id: 'plan_approval', source: 'plan', target: 'approval', when: 'always' },
      { id: 'approval_adopt', source: 'approval', target: 'adopt', when: 'approved' },
    ],
  };
}
async function createWorkflow(request: APIRequestContext, name: string) {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY || '')).toBe(true);
  const response = await request.post(`${api}/workflows`, {
    headers,
    data: { document: fixtureDocument(name) },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<CreativeWorkflow>;
}
async function getRun(request: APIRequestContext, id: string) {
  const response = await request.get(`${api}/runs/${id}`, { headers });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<CreativeRunDetail>;
}

test('default studio, graph editing, publish and revision-safe subsequent save', async ({
  page,
  request,
}, testInfo) => {
  const name = `可视流程-${randomUUID().slice(0, 8)}`;
  const workflow = await createWorkflow(request, name);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await enter(page);
  await expect(page.getByRole('tab', { name: '对话与任务' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '创作流程', exact: true }).click();
  await page.getByRole('combobox', { name: '创作流程', exact: true }).selectOption(workflow.id);
  await expect(page.getByRole('textbox', { name: '流程名称', exact: true })).toHaveValue(name);
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await page.getByRole('tab', { name: '节点列表' }).click();
  await page.getByRole('combobox', { name: '从节点', exact: true }).selectOption('context');
  await page.getByRole('combobox', { name: '到节点', exact: true }).selectOption('approval');
  await page.getByRole('button', { name: '连接', exact: true }).click();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('流程草稿已保存。', { exact: true })).toBeVisible();
  const current = (await (await request.get(`${api}/workflows`, { headers })).json()) as {
    items: CreativeWorkflow[];
  };
  const saved = current.items.find((item) => item.id === workflow.id)!;
  expect(Object.values(saved.document.nodes.find((node) => node.id === 'approval')!.inputs)).toContainEqual({
    nodeId: 'context',
    kind: 'context',
  });
  await page.getByRole('button', { name: '验证', exact: true }).click();
  await expect(page.getByText('流程验证通过', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '发布版本', exact: true }).click();
  await expect(page.getByText('第 1 版已发布，新任务将固定使用该版本。', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '流程名称', exact: true }).fill(`${name}-已调整`);
  await page.getByRole('tab', { name: '岗位与模型' }).click();
  await page.getByRole('tab', { name: '创作流程', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '流程名称', exact: true })).toHaveValue(`${name}-已调整`);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('流程草稿已保存。', { exact: true })).toBeVisible();
  let releaseSave: (() => void) | undefined;
  let requestReached: (() => void) | undefined;
  const reached = new Promise<void>((resolve) => {
    requestReached = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route(`**/api/admin/creative-orchestration/workflows/${workflow.id}`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    const response = await route.fetch();
    requestReached?.();
    await release;
    await route.fulfill({ response });
  });
  await page.getByRole('textbox', { name: '流程名称', exact: true }).fill(`${name}-保存中的版本`);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await reached;
  await page.getByRole('textbox', { name: '流程名称', exact: true }).fill(`${name}-继续编辑`);
  releaseSave?.();
  await expect(
    page.getByText('已保存提交时的版本，之后的编辑仍保留为未保存修改。', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: '流程名称', exact: true })).toHaveValue(`${name}-继续编辑`);
  await page.unroute(`**/api/admin/creative-orchestration/workflows/${workflow.id}`);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('流程草稿已保存。', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '可视画布' }).click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
      .toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`workflow-${width}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

test('role models persist and vision roles only offer multimodal models', async ({ page, request }) => {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY || '')).toBe(true);
  const suffix = randomUUID().slice(0, 8);
  const connectionId = `co-connection-${suffix}`;
  const connection = await request.post(`${admin}/connections`, {
    headers,
    data: {
      id: connectionId,
      name: '创作岗位测试供应商',
      kind: 'openai-compatible-text',
      baseUrl: 'http://127.0.0.1:9/v1',
      enabled: true,
    },
  });
  expect(connection.ok(), await connection.text()).toBe(true);
  const textId = `co-text-${suffix}`;
  const visionId = `co-vision-${suffix}`;
  for (const [id, capabilities] of [
    [textId, ['text']],
    [visionId, ['text', 'multimodal']],
  ] as const) {
    const response = await request.post(`${admin}/models`, {
      headers,
      data: { id, connectionId, name: id, modelId: id, modelType: 'chat', capabilities, enabled: true },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
  await enter(page);
  await page.getByRole('tab', { name: '岗位与模型' }).click();
  const roles = (await (await request.get(`${api}/roles`, { headers })).json()) as { items: CreativeRole[] };
  const producer = roles.items.find((role) => role.id === 'production_manager')!;
  const visual = roles.items.find((role) => role.capability === 'multimodal')!;
  const form = page.getByRole('form', { name: `${producer.name}岗位设置` });
  await form.getByRole('combobox', { name: '使用模型', exact: true }).selectOption(textId);
  await form.getByRole('button', { name: '保存岗位', exact: true }).click();
  await expect(form.getByText('岗位已保存。', { exact: true })).toBeVisible();
  const vision = page
    .getByRole('form', { name: `${visual.name}岗位设置` })
    .getByRole('combobox', { name: '使用模型', exact: true });
  await expect(vision.locator(`option[value="${textId}"]`)).toHaveCount(0);
  await expect(vision.locator(`option[value="${visionId}"]`)).toHaveCount(1);
  await page.getByRole('button', { name: '添加专业岗位', exact: true }).click();
  const roleDialog = page.getByRole('dialog', { name: '添加专业岗位', exact: true });
  const dynamicName = `支线主笔-${suffix}`;
  await roleDialog.getByRole('combobox', { name: '岗位模板', exact: true }).selectOption('lead_writer');
  await roleDialog.getByRole('textbox', { name: '岗位名称', exact: true }).fill(dynamicName);
  await roleDialog.getByRole('button', { name: '添加岗位', exact: true }).click();
  await expect(roleDialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: dynamicName, exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: '岗位与模型' }).click();
  await expect(
    page
      .getByRole('form', { name: `${producer.name}岗位设置` })
      .getByRole('combobox', { name: '使用模型', exact: true }),
  ).toHaveValue(textId);
});

test('image task setup lists real published image plans and schema fields without dispatching generation', async ({
  page,
  request,
}, testInfo) => {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY || '')).toBe(true);
  const suffix = randomUUID().slice(0, 8);
  const connectionId = `co-image-provider-${suffix}`;
  const modelId = `co-image-model-${suffix}`;
  const modelName = `插图方案模型-${suffix}`;
  for (const [path, data] of [
    [
      '/connections',
      {
        id: connectionId,
        name: '插图配置验收',
        kind: 'openai-compatible-text',
        baseUrl: 'http://127.0.0.1:9/v1',
        enabled: true,
      },
    ],
    [
      '/models',
      {
        id: modelId,
        connectionId,
        name: modelName,
        modelId: 'image-fixture',
        modelType: 'image',
        capabilities: [],
        enabled: true,
      },
    ],
    [`/models/${modelId}/image-workflow`, {}],
  ] as const) {
    const response = await request.post(admin + path, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
  }
  const available = (await (await request.get(`${api}/workflows`, { headers })).json()) as {
    items: CreativeWorkflow[];
  };
  const illustration = available.items.find((item) => item.document.purpose === 'illustration')!;
  expect(illustration).toBeTruthy();
  if (!illustration.publishedVersion) {
    const publish = await request.post(`${api}/workflows/${illustration.id}/publish`, {
      headers,
      data: { expectedRevision: illustration.revision },
    });
    expect(publish.ok(), await publish.text()).toBe(true);
  }
  await enter(page);
  let dispatched = false;
  page.on('request', (incoming) => {
    if (incoming.method() === 'POST' && incoming.url().endsWith('/creative-orchestration/runs'))
      dispatched = true;
  });
  await page.getByRole('button', { name: '从流程启动', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '启动创作任务', exact: true });
  await dialog.getByRole('combobox', { name: '创作流程', exact: true }).selectOption(illustration.id);
  const plans = dialog.getByRole('combobox', { name: '已发布图片方案', exact: true });
  await expect(plans.locator('option').filter({ hasText: modelName })).toHaveCount(1);
  const option = await plans.locator('option').filter({ hasText: modelName }).getAttribute('value');
  await plans.selectOption(option!);
  await expect(dialog.getByText('以下参数使用该图片方案的真实输入定义。', { exact: false })).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
      .toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`image-setup-${width}.png`), fullPage: true });
  }
  expect(dispatched).toBe(false);
});

test('real local task creates candidate, binds approval hash, rejects stale decision and archives after confirmation', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(60000);
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY || '')).toBe(true);
  const name = `视频方案验收-${randomUUID().slice(0, 8)}`;
  const projectResponse = await request.post(`${admin}/story/projects`, {
    headers,
    data: { title: name, summary: '港口重逢的独立写作项目' },
  });
  expect(projectResponse.ok(), await projectResponse.text()).toBe(true);
  const project = await projectResponse.json();
  const workflow = await createWorkflow(request, name);
  const publish = await request.post(`${api}/workflows/${workflow.id}/publish`, {
    headers,
    data: { expectedRevision: workflow.revision },
  });
  expect(publish.ok(), await publish.text()).toBe(true);
  await enter(page);
  await page.getByRole('combobox', { name: '创作范围', exact: true }).selectOption(`project:${project.id}`);
  await page.locator('summary').filter({ hasText: '普通插图自动采用策略' }).click();
  const policyForm = page.getByRole('form', { name: '普通插图自动采用策略', exact: true });
  const policyToggle = policyForm.getByRole('checkbox', {
    name: '允许指定场景的普通插图通过审核后自动采用',
    exact: true,
  });
  await expect(policyToggle).not.toBeChecked();
  await policyToggle.check();
  const policySaved = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().includes('/scope-policy'),
  );
  await policyForm.getByRole('button', { name: '保存当前范围策略', exact: true }).click();
  expect((await policySaved).ok()).toBe(true);
  await expect(policyToggle).toBeChecked();
  await page.locator('summary').filter({ hasText: '普通插图自动采用策略' }).click();
  await page.getByRole('button', { name: '从流程启动', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '启动创作任务', exact: true });
  await dialog.getByRole('combobox', { name: '创作流程', exact: true }).selectOption(workflow.id);
  await dialog
    .getByRole('textbox', { name: '这次要完成什么', exact: true })
    .fill('为港口重逢准备三镜头的视频计划，先审核用途和额度。');
  const startResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/creative-orchestration/runs') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '启动创作任务', exact: true }).click();
  const response = await startResponse;
  expect(response.ok(), await response.text()).toBe(true);
  const started = await response.json();
  await expect(dialog).not.toBeVisible();
  await expect
    .poll(async () => (await getRun(request, started.id)).run.status, { timeout: 20000 })
    .toBe('waiting_approval');
  await page.reload();
  await expect(page.getByRole('heading', { name: '这组产物等待你的决定', exact: true })).toBeVisible();
  const detail = await getRun(request, started.id);
  expect(detail.run.usage).toEqual({ textCalls: 0, images: 0, tokens: 0 });
  const pending = detail.approvals.find((approval) => approval.status === 'pending')!;
  expect(
    detail.artifacts.some((artifact) => artifact.kind === 'plan' && artifact.status === 'candidate'),
  ).toBe(true);
  const stale = await request.post(`${api}/approvals/${pending.id}/decision`, {
    headers,
    data: {
      expectedRevision: pending.revision,
      bundleHash: '0'.repeat(64),
      decision: 'approve',
      comment: '故意过期的内容指纹',
    },
  });
  expect(stale.status()).toBe(409);
  await page.getByRole('button', { name: '创作方案', exact: true }).click();
  await expect(
    page.getByText('为港口重逢准备三镜头的视频计划，先审核用途和额度。', { exact: true }).first(),
  ).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
      .toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`approval-${width}.png`), fullPage: true });
  }
  await page.getByRole('textbox', { name: '意见 / 修改要求', exact: true }).fill('方案范围明确，可以归档。');
  const decision = page.waitForRequest(
    (request) => request.url().includes(`/approvals/${pending.id}/decision`) && request.method() === 'POST',
  );
  await page.getByRole('button', { name: '确认这组产物', exact: true }).click();
  expect((await decision).postDataJSON()).toMatchObject({
    expectedRevision: pending.revision,
    bundleHash: pending.bundleHash,
    decision: 'approve',
  });
  await expect
    .poll(async () => (await getRun(request, started.id)).run.status, { timeout: 20000 })
    .toBe('completed');
  const finished = await getRun(request, started.id);
  expect(
    finished.artifacts.some((artifact) => artifact.kind === 'plan' && artifact.status === 'accepted'),
  ).toBe(true);
  expect(finished.run.usage).toEqual({ textCalls: 0, images: 0, tokens: 0 });
});

test('AI manager starts a budgeted real run, stores its answer and applies a human-approved work creation', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(60000);
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY || '')).toBe(true);
  const suffix = randomUUID().slice(0, 8);
  const workName = `总管创建作品-${suffix}`;
  let calls = 0;
  const provider = createServer(async (incoming, response) => {
    for await (const chunk of incoming) void chunk;
    calls++;
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        id: 'fixture-chat',
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                kind: 'assistant-proposal',
                intent: 'apply_action',
                answer: `我建议创建原创作品《${workName}》。请核对下面的名称与作品属性，确认后才会写入作品目录。`,
                action: { tool: 'work.create', args: { name: workName, nature: 'original' } },
              }),
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 40, completion_tokens: 80, total_tokens: 120 },
      }),
    );
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const address = provider.address();
  if (!address || typeof address === 'string') throw new Error('fixture provider unavailable');
  try {
    const connectionId = `co-manager-provider-${suffix}`;
    const modelId = `co-manager-model-${suffix}`;
    for (const [path, data] of [
      [
        '/connections',
        {
          id: connectionId,
          name: '总管本地验收模型',
          kind: 'openai-compatible-text',
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          enabled: true,
        },
      ],
      [
        '/models',
        {
          id: modelId,
          connectionId,
          name: '总管本地验收模型',
          modelId: 'fixture-manager',
          modelType: 'chat',
          capabilities: ['text'],
          enabled: true,
        },
      ],
    ] as const) {
      const response = await request.post(admin + path, { headers, data });
      expect(response.ok(), await response.text()).toBe(true);
    }
    const roles = (await (await request.get(`${api}/roles`, { headers })).json()) as {
      items: CreativeRole[];
    };
    const producer = roles.items.find((role) => role.id === 'production_manager')!;
    const assigned = await request.put(`${api}/roles/${producer.id}`, {
      headers,
      data: { ...producer, modelId },
    });
    expect(assigned.ok(), await assigned.text()).toBe(true);
    await enter(page);
    await expect(page.getByRole('combobox', { name: '协作方式', exact: true })).toHaveValue('ai');
    await page
      .getByRole('textbox', { name: '创作需求或反馈', exact: true })
      .fill(`请帮我新建原创作品《${workName}》，先给我可审核的提案。`);
    const messageResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/conversations/message') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '启动总管分析', exact: true }).click();
    const response = await messageResponse;
    expect(response.ok(), await response.text()).toBe(true);
    const message = await response.json();
    expect(message.runId).toBeTruthy();
    await expect(page.getByRole('textbox', { name: '创作需求或反馈', exact: true })).toHaveValue('');
    await expect.poll(() => page.getByRole('textbox', { name: '创作需求或反馈', exact: true }).evaluate(element => element.matches(':user-invalid'))).toBe(false);
    await expect
      .poll(async () => (await getRun(request, message.runId)).run.status, { timeout: 20000 })
      .toBe('waiting_approval');
    await expect(page.getByRole('heading', { name: '创作总管的建议', exact: true })).toBeVisible();
    await expect(page.getByText('修改前', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('修改后', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(workName, { exact: true }).first()).toBeVisible();
    const before = await request.get(`${admin}/characters/browse`, { headers });
    expect((await before.json()).facets.works.some((work: { name: string }) => work.name === workName)).toBe(
      false,
    );
    await page.screenshot({ path: testInfo.outputPath('manager-action-preview.png'), fullPage: true });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath(`manager-action-preview-${width}.png`), fullPage: true });
    }
    await page.getByRole('button', { name: '确认这组产物', exact: true }).click();
    await expect
      .poll(async () => (await getRun(request, message.runId)).run.status, { timeout: 20000 })
      .toBe('completed');
    const after = await request.get(`${admin}/characters/browse`, { headers });
    expect((await after.json()).facets.works.some((work: { name: string }) => work.name === workName)).toBe(
      true,
    );
    const conversation = await (
      await request.get(`${api}/conversations/${message.conversationId}`, { headers })
    ).json();
    expect(
      conversation.messages.some((item: { content: string }) =>
        item.content.includes('请核对下面的名称与作品属性'),
      ),
    ).toBe(true);
    expect(calls).toBe(1);
    await page.reload();
    await expect(page.getByText(/请核对下面的名称与作品属性/).first()).toBeVisible();
  } finally {
    await new Promise<void>((resolve, reject) =>
      provider.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('budget presets, system workflow filter, custom flow canvas dry-run and global AI drawer', async ({
  page,
  request,
}) => {
  const workflowName = `直观流程-${randomUUID().slice(0, 8)}`;
  const workflow = await createWorkflow(request, workflowName);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await enter(page);

  await page.getByRole('button', { name: '从流程启动', exact: true }).click();
  await expect(page.getByText(/当前上限：80 次调用 · 150 万 tokens · 12 张图 · 最多返修 2 轮/)).toBeVisible();
  await page.getByRole('button', { name: /长篇充足/ }).click();
  await expect(page.getByText(/当前上限：200 次调用 · 500 万 tokens · 30 张图 · 最多返修 2 轮/)).toBeVisible();
  const launchSelectOptions = await page
    .locator('form[aria-label="创作任务与额度"] select option')
    .allTextContents();
  expect(launchSelectOptions.some((text) => text.includes('外部视频方案候选审核'))).toBe(false);
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: '创作流程', exact: true }).click();
  const workflowOptions = await page.getByRole('combobox', { name: '创作流程', exact: true }).locator('option').allTextContents();
  expect(workflowOptions.some((text) => text.includes('故事场景创作'))).toBe(true);
  expect(workflowOptions.some((text) => text.includes('重要剧情精修（导演+双审）'))).toBe(true);
  expect(workflowOptions.some((text) => text.includes('外部视频方案候选审核'))).toBe(false);
  expect(workflowOptions.some((text) => text.includes('AI 创作总管对话'))).toBe(false);

  // Simplified visual view collapses `join` relay nodes until explicitly expanded
  const standardId = await page
    .getByRole('combobox', { name: '创作流程', exact: true })
    .locator('option', { hasText: '故事场景创作' })
    .first()
    .getAttribute('value');
  if (standardId) {
    await page.getByRole('combobox', { name: '创作流程', exact: true }).selectOption(standardId);
    await expect(page.getByRole('button', { name: '显示完整调度节点', exact: true })).toBeVisible();
    await expect(page.locator('.co-flow-node')).toHaveCount(9);
    await page.getByRole('button', { name: '显示完整调度节点', exact: true }).click();
    await expect(page.locator('.co-flow-node')).toHaveCount(10);
  }

  await page.getByRole('checkbox', { name: '显示系统托管流程（总管对话与外部候选审核）' }).check();
  const allWorkflowOptions = await page
    .getByRole('combobox', { name: '创作流程', exact: true })
    .locator('option')
    .allTextContents();
  expect(allWorkflowOptions.some((text) => text.includes('外部视频方案候选审核'))).toBe(true);
  await page.getByRole('checkbox', { name: '显示系统托管流程（总管对话与外部候选审核）' }).uncheck();

  await page.getByRole('combobox', { name: '创作流程', exact: true }).selectOption(workflow.id);
  await expect(page.locator('.co-flow-node')).toHaveCount(4);
  await page.getByRole('button', { name: '自动整理布局', exact: true }).click();
  await page.getByRole('button', { name: '模拟试跑', exact: true }).click();
  await expect(page.getByText(/零付费试跑校验/)).toBeVisible();

  await page.goto('/apps/story');
  await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');
  await page.getByRole('button', { name: /打开.*AI 创作助手/ }).first().click();
  await expect(page.getByRole('heading', { name: 'AI 创作助手', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '在 AI 工作台展开' }).click();
  await expect(page).toHaveURL(/\/apps\/ai-studio/);
  await expect(page.getByRole('heading', { name: 'AI 创作工作台', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
