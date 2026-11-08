import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

const e2eAdminToken = 'sthstart-e2e-secret-0123456789abcdef';
const e2eServiceUrl = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT ?? 4200}`;
const adminHeaders = { 'x-sthstart-admin-token': e2eAdminToken };

/** 与配置工作台测试样本一致的 ComfyUI API JSON（checkpoint + 双提示词 + KSampler + SaveImage）。 */
const sampleDefinition = {
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd15/model.safetensors', stop_at_clip_layer: -1 } },
  '5': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat', clip: ['4', 1] } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry', clip: ['4', 1] } },
  '7': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 768, batch_size: 1 } },
  '3': { class_type: 'KSampler', inputs: { seed: 42, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['7', 0] } },
  '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'sth', images: ['3', 0] } },
};

interface SeededWorkspace {
  engineId: string;
  workflowId: string;
  presetId: string;
  workflowName: string;
  presetName: string;
}

async function seedWorkspace(request: APIRequestContext, options?: { setDefault?: boolean }): Promise<SeededWorkspace> {
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  // 连接指向保留端口（unreachable）：连接失败必须如实显示，不伪造成功。
  const engine = await request.post(`${e2eServiceUrl}/api/v1/admin/generation/engines`, {
    headers: adminHeaders,
    data: { id: `e2e-engine-${suffix}`, name: `E2E 直连 ${suffix}`, kind: 'comfyui', baseUrl: 'http://127.0.0.1:9', concurrencyLimit: 1 },
  });
  const engineId = (await engine.json()).id as string;

  const created = await request.post(`${e2eServiceUrl}/api/v1/admin/generation/workflows`, {
    headers: adminHeaders,
    data: { name: `E2E 样本工作流 ${suffix}` },
  });
  const workflowId = (await created.json()).id as string;

  const analyze = await request.post(`${e2eServiceUrl}/api/v1/admin/generation/workflows/analyze`, {
    headers: adminHeaders,
    data: { definition: sampleDefinition, connectionId: engineId },
  });
  const analysis = await analyze.json();
  const draft = { ...analysis.suggestedDraft, name: `E2E 样本工作流 ${suffix}`, engineId };

  await request.put(`${e2eServiceUrl}/api/v1/admin/generation/workflows/${workflowId}/draft`, {
    headers: adminHeaders,
    data: { revision: 1, draft },
  });
  const version = await request.post(`${e2eServiceUrl}/api/v1/admin/generation/workflows/${workflowId}/versions`, {
    headers: adminHeaders,
    data: {
      engineId,
      definition: draft.definition,
      inputSchema: draft.inputSchema,
      inputCapabilities: draft.inputCapabilities ?? {},
      nodeBindings: draft.nodeBindings,
      outputDeclarations: draft.outputDeclarations,
      outputMediaTypes: ['image/png'],
      outputSchema: {},
      editorConfig: draft.editorConfig,
    },
  });
  const versionNumber = (await version.json()).version as number;

  const preset = await request.post(`${e2eServiceUrl}/api/v1/admin/generation/presets`, {
    headers: adminHeaders,
    data: {
      appId: 'creative-center', purpose: 'text-to-image', name: `E2E 预设 ${suffix}`,
      workflowId, workflowVersion: versionNumber, engineId, values: { steps: 24 },
    },
  });
  const presetId = (await preset.json()).id as string;
  if (options?.setDefault) {
    const defaultResponse = await request.post(`${e2eServiceUrl}/api/v1/admin/generation/presets/${presetId}/set-default`, { headers: adminHeaders });
    expect(defaultResponse.status()).toBe(200);
  }

  return { engineId, workflowId, presetId, workflowName: `E2E 样本工作流 ${suffix}`, presetName: `E2E 预设 ${suffix}` };
}

/**
 * 生成配置页默认停在「常用设置」，工作流工作区在「工作流」页签面板里（未选中时 hidden）。
 * hydration 前 SSR 已渲染页签按钮，点击可能被丢弃：重试直到工作区可见。
 */
async function openTab(page: Page, name: string, content: Locator) {
  await expect(async () => {
    if (!(await content.isVisible())) await page.getByRole('tab', { name, exact: true }).click();
    await expect(content).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

async function openWorkflowWorkspace(page: Page) {
  const workspace = page.getByTestId('workflow-workspace');
  await openTab(page, '工作流', workspace);
  return workspace;
}

test('configuration workspace covers import artifacts, editor tabs, connection status and purpose defaults', async ({ page, request }) => {
  const seeded = await seedWorkspace(request, { setDefault: true });

  await page.setViewportSize({ width: 1536, height: 900 });
  await page.goto('/settings/generation');
  await expect(page.getByRole('heading', { name: '生成配置', level: 1 })).toBeVisible();
  const sections = page.getByRole('tablist', { name: '生成配置分类' });
  await expect(sections.getByRole('tab', { name: '常用设置' })).toHaveAttribute('aria-selected', 'true');
  await expect(sections.getByRole('tab', { name: '工作流', exact: true })).toBeVisible();
  await expect(sections.getByRole('tab', { name: '连接与节点' })).toBeVisible();
  await expect(sections.getByRole('tab', { name: '预设与用途' })).toBeVisible();

  // 工作流工作区：列表、编辑页签与试运行入口。
  const workspace = await openWorkflowWorkspace(page);
  await workspace.getByRole('combobox', { name: '选择工作流' }).selectOption({ label: seeded.workflowName });
  await expect(workspace.getByRole('tab', { name: '模型' })).toBeVisible();
  await expect(workspace.getByRole('tab', { name: '参数' })).toBeVisible();
  await expect(workspace.getByRole('tab', { name: '输入与输出' })).toBeVisible();
  await expect(workspace.getByRole('tab', { name: '高级' })).toBeVisible();
  await expect(workspace.getByRole('button', { name: '保存版本' })).toBeVisible();

  // hydration 前 SSR 已渲染页签按钮，点击可能被丢弃：重试直到目标内容出现。
  const clickTab = async (name: string, content: RegExp) => {
    const target = workspace.getByText(content).first();
    for (let attempt = 0; attempt < 12 && !(await target.isVisible()); attempt += 1) {
      await workspace.getByRole('tab', { name }).click();
      await page.waitForTimeout(150);
    }
    await expect(target).toBeVisible();
  };

  // 模型页签：默认模型来自导入分析（原模型），库存不可达时如实提示。
  await clickTab('模型', /允许选择的模型/);
  await expect(workspace.getByLabel(/默认模型/)).toHaveValue('sd15/model.safetensors');
  await expect(workspace.getByText(/读取模型列表失败|没有可用模型/).first()).toBeVisible({ timeout: 25_000 });

  // 参数页签：可视化字段编辑器呈现，不再要求手写 JSON。
  await clickTab('参数', /显示层级/);

  // 高级页签：定义 JSON 与导出入口。
  await clickTab('高级', /ComfyUI API JSON/);
  await expect(workspace.getByRole('link', { name: /导出当前版本配置包/ })).toBeVisible();

  /*
   * 设置中心左侧有二级导航、内容区限宽，工作区可用宽度达不到常驻三栏的 1172px，
   * 试运行一律经抽屉打开。提交到不可达连接必须如实失败（已放弃/失败），不伪造成功。
   */
  await expect(workspace.getByTestId('test-run-panel')).toHaveCount(0);
  await workspace.getByRole('button', { name: '试运行' }).click();
  const testDrawer = page.getByRole('dialog');
  const drawerPanel = testDrawer.getByTestId('test-run-panel');
  await expect(drawerPanel).toBeVisible();
  await drawerPanel.getByLabel('提示词', { exact: true }).fill('e2e smoke');
  await drawerPanel.getByRole('button', { name: '保存并试生成' }).click();
  await expect(drawerPanel.getByTestId('test-run-detail').getByText(/^(失败|已放弃)$/)).toBeVisible({ timeout: 25_000 });
  await testDrawer.getByRole('button', { name: '关闭抽屉' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  // 1280px 下同样经抽屉打开。
  await page.setViewportSize({ width: 1280, height: 900 });
  await workspace.getByRole('button', { name: '试运行' }).click();
  await expect(page.getByRole('dialog').getByTestId('test-run-panel')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '关闭抽屉' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  // 连接页签：直连标识；测试连接后展示真实失败原因。
  const engineCard = page.locator(`[data-testid="engine-card"][data-engine-id="${seeded.engineId}"]`);
  await openTab(page, '连接与节点', engineCard);
  await expect(engineCard.getByText('直连', { exact: true })).toBeVisible();
  await engineCard.getByRole('button', { name: '测试连接' }).click();
  await expect(engineCard.locator(`[data-testid="engine-test-result-${seeded.engineId}"]`)).toContainText('失败', { timeout: 20_000 });

  // 预设与用途页签：预设列表与用途默认配置；默认预设选择器已同步。
  const presetRow = page.getByText(seeded.presetName).first();
  await openTab(page, '预设与用途', presetRow);
  await expect(page.getByText('用途默认配置')).toBeVisible();
  const defaultSelect = page.getByLabel('文本生图默认预设');
  await expect(defaultSelect).toBeVisible();
  await expect(defaultSelect).toHaveValue(seeded.presetId, { timeout: 10_000 });
});

test('creative center selects workflow and preset with a contract-driven form', async ({ page, request }) => {
  const seeded = await seedWorkspace(request);
  await page.setViewportSize({ width: 1536, height: 900 });
  await page.goto('/apps/creative');
  await page.getByRole('tab', { name: '文本生图' }).click();

  /*
   * 简单模式只露出「生成方案」；切到专业模式后，「选择其他工作流」折叠区里才有工作流下拉。
   * 模式按钮在 hydration 完成前是 disabled，等它可点再切换。
   */
  const panel = page.getByRole('region', { name: '图片生成配置' });
  const professional = panel.getByRole('group', { name: '生图设置模式' }).getByRole('button', { name: '专业模式' });
  await expect(professional).toBeEnabled({ timeout: 15_000 });
  await professional.click();
  await expect(professional).toHaveAttribute('aria-pressed', 'true');
  await panel.getByText('选择其他工作流', { exact: true }).click();
  const workflowSelect = panel.getByLabel('工作流', { exact: true });
  await expect(workflowSelect).toBeVisible({ timeout: 15_000 });
  await workflowSelect.selectOption({ label: seeded.workflowName });
  // 选中工作流后，「生成方案」切到该工作流的预设。
  await expect(panel.getByLabel('生成方案', { exact: true })).toHaveValue(seeded.presetId);
  await expect(panel.getByText(new RegExp(`^工作流：${seeded.workflowName} · v\\d+`))).toBeVisible();
  await expect(panel.getByText('提示词', { exact: true })).toBeVisible();
  /*
   * 样本只有一个 checkpoint，导入后允许单独切换主模型；但连接不可达、没有库存缓存，
   * 「模型与 LoRA」里的主模型下拉框保持禁用并保留当前值，不能选到库存外的模型。
   */
  await panel.getByText('模型与 LoRA', { exact: true }).click();
  const model = panel.getByRole('combobox', { name: '主模型', exact: true });
  await expect(model).toBeDisabled();
  await expect(model).toHaveValue('sd15/model.safetensors');
  await expect(panel.getByText('暂无可选模型，保留当前值；请在连接设置中刷新模型发现。')).toBeVisible();
});

test('draft autosaves one edit, preserves edits during saving and flushes before switching', async ({ page, request }) => {
  const first = await seedWorkspace(request);
  const second = await seedWorkspace(request);
  await page.goto('/settings/generation');
  const workspace = await openWorkflowWorkspace(page);
  const selector = workspace.getByRole('combobox', { name: '选择工作流' });
  await selector.selectOption(first.workflowId);
  await workspace.getByRole('tab', { name: '参数', exact: true }).click();
  const width = workspace.locator('#param-default-width');
  await expect(width).toHaveValue('512');
  let releaseSave!: () => void;
  let firstSaved!: () => void;
  const held = new Promise<void>((resolve) => { releaseSave = resolve; });
  const arrived = new Promise<void>((resolve) => { firstSaved = resolve; });
  let saves = 0;
  await page.route(`**/generation/workflows/${first.workflowId}/draft`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    const response = await route.fetch();
    if (++saves === 1) { firstSaved(); await held; }
    await route.fulfill({ response });
  });
  await width.fill('768');
  try {
    await Promise.race([arrived, new Promise((_, reject) => setTimeout(() => reject(new Error('single edit did not autosave')), 8000))]);
    await width.fill('896');
  } finally { releaseSave(); }
  const readWidth = async () => {
    const result = await request.get(`${e2eServiceUrl}/api/v1/admin/generation/workflows/${first.workflowId}/draft`, { headers: adminHeaders });
    return (await result.json()).draft.inputSchema.width.default;
  };
  await expect.poll(readWidth).toBe(896);
  await width.fill('960');
  await selector.selectOption(second.workflowId);
  await expect(selector).toHaveValue(second.workflowId);
  await expect(width).toHaveValue('512');
  await expect.poll(readWidth).toBe(960);
  await selector.selectOption(first.workflowId);
  await expect(width).toHaveValue('960');
  const current = await (await request.get(`${e2eServiceUrl}/api/v1/admin/generation/workflows/${first.workflowId}/draft`, { headers: adminHeaders })).json();
  current.draft.inputSchema.width.default = 1024;
  await request.put(`${e2eServiceUrl}/api/v1/admin/generation/workflows/${first.workflowId}/draft`, { headers: adminHeaders, data: { revision: current.revision, draft: current.draft } });
  await width.fill('1088');
  await expect(workspace.getByRole('button', { name: '采用服务器草稿' })).toBeVisible();
  await workspace.getByRole('button', { name: '采用服务器草稿' }).click();
  await expect(width).toHaveValue('1024');
  await width.fill('1152');
  await expect.poll(readWidth).toBe(1152);
});

test('test request uses fresh version defaults rather than resending stale model and fixed fields', async ({ page, request }) => {
  const seeded = await seedWorkspace(request);
  const current = await (await request.get(`${e2eServiceUrl}/api/v1/admin/generation/workflows/${seeded.workflowId}/draft`, { headers: adminHeaders })).json();
  current.draft.editorConfig.fields.checkpoint.allowedModels.push('changed/model.safetensors');
  await request.put(`${e2eServiceUrl}/api/v1/admin/generation/workflows/${seeded.workflowId}/draft`, { headers: adminHeaders, data: { revision: current.revision, draft: current.draft } });
  await page.setViewportSize({ width: 1700, height: 1000 });
  await page.goto('/settings/generation');
  const workspace = await openWorkflowWorkspace(page);
  await workspace.getByRole('combobox', { name: '选择工作流' }).selectOption(seeded.workflowId);
  await workspace.getByRole('tab', { name: '参数', exact: true }).click();
  await workspace.locator('#param-default-steps').fill('36');
  await workspace.locator('#param-section-steps').selectOption('fixed');
  await workspace.locator('#param-default-checkpoint').fill('changed/model.safetensors');
  // 设置中心内容区限宽，试运行不常驻右栏，经抽屉打开；抽屉里用的是同一份未保存草稿。
  await workspace.getByRole('button', { name: '试运行' }).click();
  const panel = page.getByRole('dialog').getByTestId('test-run-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('#test-seed')).toHaveCount(1);
  await panel.getByLabel('提示词', { exact: true }).fill('fresh defaults');
  const submitted = page.waitForRequest((req) => req.method() === 'POST' && req.url().endsWith(`/workflows/${seeded.workflowId}/test-runs`));
  await panel.getByRole('button', { name: '保存并试生成' }).click();
  const body = (await submitted).postDataJSON();
  expect(body.values).toEqual({ prompt: 'fresh defaults' });
  await expect(panel.getByTestId('test-run-detail').getByText(/^(失败|已放弃)$/)).toBeVisible({ timeout: 25_000 });
  await expect(panel.getByTestId('test-run-detail').locator('pre')).toContainText('changed/model.safetensors');
  await expect(panel.getByTestId('test-run-detail').locator('pre')).toContainText('36');
});

test('workspace stays usable on mobile width without horizontal overflow', async ({ page, request }) => {
  await seedWorkspace(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings/generation');
  await expect(page.getByRole('heading', { name: '生成配置', level: 1 })).toBeVisible();
  await openWorkflowWorkspace(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
