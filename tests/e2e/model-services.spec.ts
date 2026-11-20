import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const service = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT ?? 4200}`;
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
const evidence = join(process.cwd(), 'artifacts/visual-verification/suppliers-search');
test.use({ serviceWorkers: 'block' });

test('supplier load failures do not offer creation, and credential warnings preserve the retry input', async ({ page }) => {
  let failLoad = true;
  await page.route('**/api/admin/connections', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: failLoad ? 503 : 200, json: failLoad ? { message: '供应商列表暂不可用' } : { items: [] } });
    } else await route.fallback();
  });
  await page.goto('/settings/public-services');
  await expect(page.getByRole('button', { name: '重新加载供应商与模型' })).toBeVisible();
  await expect(page.getByRole('button', { name: '添加供应商', exact: true })).toBeHidden();
  failLoad = false;
  await page.getByRole('button', { name: '重新加载供应商与模型' }).click();
  await page.getByRole('button', { name: '添加供应商', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '添加供应商', exact: true });
  await editor.getByLabel('供应商名称').fill('密钥重试供应商');
  await editor.getByLabel('API 地址').fill('https://provider.example/v1');
  await editor.getByLabel('API Key', { exact: true }).fill('fixture-retry-value');
  const saves: Array<{ id: string; secret?: string }> = [];
  await page.route('**/api/admin/connections', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const payload = route.request().postDataJSON();
    saves.push(payload);
    await route.fulfill({ status: 201, json: { id: payload.id, secretStored: saves.length > 1,
      warning: saves.length === 1 ? '密钥写入失败，请重试。' : null } });
  });
  await editor.getByRole('button', { name: '保存供应商' }).click();
  await expect(editor.getByText('密钥写入失败，请重试。')).toBeVisible();
  await expect(editor.getByLabel('API Key', { exact: true })).toHaveValue('fixture-retry-value');
  await editor.getByRole('button', { name: '保存供应商' }).click();
  await expect(editor).toBeHidden();
  expect(saves).toHaveLength(2);
  expect(saves[1].id).toBe(saves[0].id);
  expect(saves[1].secret).toBe('fixture-retry-value');
});

test('disabled suppliers accept manual models and explain a blocked delete', async ({ page, request }) => {
  const supplierId = `disabled-${Date.now().toString(36)}`;
  const name = `停用供应商 ${supplierId}`;
  const saved = await request.post(`${service}/api/v1/admin/connections`, { headers, data: {
    id: supplierId, name, kind: 'openai-compatible-text', baseUrl: `https://${supplierId}.example/v1`, enabled: false,
  } });
  expect(saved.status()).toBe(201);
  await page.goto('/settings/public-services');
  const supplier = page.locator(`[data-supplier-id="${supplierId}"]`);
  await supplier.getByRole('button', { name: `添加模型 · ${name}`, exact: true }).click();
  const picker = page.getByRole('dialog', { name: `添加模型 · ${name}`, exact: true });
  await expect(picker.getByRole('button', { name: '获取模型列表' })).toBeDisabled();
  await picker.getByLabel('手动添加模型 ID').fill('disabled-manual-model');
  await picker.getByRole('button', { name: '加入', exact: true }).click();
  await picker.getByRole('button', { name: '保存所选模型（1）' }).click();
  await expect(picker).toBeHidden();
  await expect(supplier.getByText('停用', { exact: true })).toBeVisible();
  await supplier.getByRole('button', { name: `供应商操作：${name}` }).click();
  await page.getByRole('menuitem', { name: '删除供应商' }).click();
  const confirm = page.getByRole('dialog', { name: `删除供应商“${name}”` });
  await confirm.getByRole('button', { name: '删除供应商', exact: true }).click();
  await expect(confirm.getByText(/仍有 1 个模型/)).toBeVisible();
});

test('one supplier card combines legacy text and image connections with purpose tabs', async ({ page, request }) => {
  const suffix = Date.now().toString(36);
  const textId = `group-text-${suffix}`;
  const imageId = `group-image-${suffix}`;
  const shortName = `合并供应商 ${suffix}`;
  const longName = `${shortName} · 图像`;
  const baseUrl = `https://group-${suffix}.example/v1`;
  for (const [id, name, kind] of [[textId, shortName, 'openai-compatible-text'], [imageId, longName, 'openai-compatible-image']] as const) {
    expect((await request.post(`${service}/api/v1/admin/connections`, { headers, data: { id, name, kind, baseUrl } })).status()).toBe(201);
  }
  expect((await request.post(`${service}/api/v1/admin/models`, { headers, data: {
    id: `group-chat-${suffix}`, connectionId: textId, name: '合并文本模型', modelId: 'vendor-chat', modelType: 'chat', capabilities: ['text'],
  } })).status()).toBe(201);
  expect((await request.post(`${service}/api/v1/admin/models`, { headers, data: {
    id: `group-image-model-${suffix}`, connectionId: imageId, name: '合并图像模型', modelId: 'vendor-image', modelType: 'image', capabilities: [],
  } })).status()).toBe(201);

  await page.goto('/settings/public-services');
  const card = page.locator(`[data-supplier-connections*="${textId}"]`);
  await expect(card).toContainText(shortName);
  await expect(card).toContainText('2 条连接');
  await expect(page.getByRole('heading', { name: longName, exact: true })).toHaveCount(0);
  await card.getByRole('button', { name: `详情：打开供应商 ${shortName}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: shortName, exact: true });
  await expect(dialog.getByRole('tab', { name: /文本 \/ 看图.*1/ })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: /绘图.*1/ })).toBeVisible();
  await dialog.getByRole('tab', { name: /绘图.*1/ }).click();
  await expect(dialog.getByText('合并图像模型', { exact: true })).toBeVisible();
  await dialog.getByText('连接明细（2）', { exact: true }).click();
  await expect(dialog.getByText(textId, { exact: false })).toBeVisible();
  await expect(dialog.getByText(imageId, { exact: false })).toBeVisible();
});

test('supplier detail keeps per-connection settings and supports repeated additions of every model type', async ({ page, request }) => {
  const suffix = Date.now().toString(36);
  const name = `持续管理 ${suffix}`;
  const ids = [`manage-text-${suffix}`, `manage-image-${suffix}`];
  for (const [index, id] of ids.entries()) {
    expect((await request.post(`${service}/api/v1/admin/connections`, { headers, data: {
      id, name: index ? `${name} 绘图` : name,
      kind: index ? 'openai-compatible-image' : 'openai-compatible-text',
      baseUrl: `https://manage-${suffix}.example/v1`,
      timeoutMs: index ? 90000 : 30000,
      headers: { 'X-Route': index ? 'image' : 'text' }, options: { route: index },
    } })).status()).toBe(201);
  }
  await page.goto('/settings/public-services');
  const card = page.locator(`[data-supplier-connections*="${ids[0]}"]`);
  await card.getByRole('button', { name: `详情：打开供应商 ${name}`, exact: true }).click();
  let detail = page.getByRole('dialog', { name, exact: true });
  await detail.getByRole('button', { name: '编辑供应商', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑供应商', exact: true });
  await expect(detail).toBeHidden();
  const renamed = `${name} 已修改`;
  await editor.getByLabel('供应商名称').fill(renamed);
  await editor.getByRole('button', { name: '保存供应商' }).click();
  await expect(editor).toBeHidden();
  detail = page.getByRole('dialog', { name: renamed, exact: true });
  await expect(detail).toBeVisible();
  const stored = await (await request.get(`${service}/api/v1/admin/connections`, { headers })).json();
  for (const [index, id] of ids.entries()) {
    const connection = stored.items.find((item: { id: string }) => item.id === id);
    expect(connection.name).toBe(renamed);
    expect(connection.timeoutMs).toBe(index ? 90000 : 30000);
    expect(connection.headers).toEqual({ 'X-Route': index ? 'image' : 'text' });
    expect(connection.options).toEqual({ route: index });
  }
  for (const [type, label] of [['chat', '文本 / 看图'], ['embedding', '向量计算'], ['image', '绘图']]) {
    await detail.getByRole('tab', { name: new RegExp(label.replace('/', '\\/')) }).click();
    await detail.getByRole('button', { name: '添加模型', exact: true }).first().click();
    const picker = page.getByRole('dialog', { name: `添加模型 · ${renamed}`, exact: true });
    await expect(detail).toBeHidden();
    await expect(picker.getByLabel('模型用途')).toHaveValue(type);
    await picker.getByLabel('手动添加模型 ID').fill(`managed-${type}`);
    await picker.getByRole('button', { name: '加入', exact: true }).click();
    await picker.getByRole('button', { name: '保存所选模型（1）' }).click();
    await expect(picker).toBeHidden();
    await expect(detail.getByText(`managed-${type}`, { exact: true })).toBeVisible();
  }
  await detail.getByRole('button', { name: '模型操作：managed-image' }).click();
  await page.getByRole('menuitem', { name: '编辑模型', exact: true }).click();
  const modelEditor = page.getByRole('dialog', { name: '编辑模型', exact: true });
  await modelEditor.getByLabel('显示名称').fill('已修改绘图模型');
  await modelEditor.getByRole('button', { name: '保存模型', exact: true }).click();
  await expect(modelEditor).toBeHidden();
  await expect(detail.getByText('已修改绘图模型', { exact: true })).toBeVisible();
  await page.reload();
  await card.getByRole('button', { name: `详情：打开供应商 ${renamed}`, exact: true }).click();
  for (const label of ['文本 / 看图', '向量计算', '绘图']) {
    await expect(detail.getByRole('tab', { name: new RegExp(`${label.replace('/', '\\/')}.*1`) })).toBeVisible();
  }
});

test('changing model type ignores an older catalog response', async ({ page, request }) => {
  const id = `catalog-race-${Date.now().toString(36)}`;
  expect((await request.post(`${service}/api/v1/admin/connections`, { headers, data: {
    id, name: id, kind: 'openai-compatible-text', baseUrl: `https://${id}.example/v1`,
  } })).status()).toBe(201);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/admin/connections/discover-models', async route => {
    await pending;
    await route.fulfill({ json: { models: ['old-chat-catalog'] } });
  });
  await page.goto('/settings/public-services');
  await page.getByRole('button', { name: `添加模型 · ${id}`, exact: true }).click();
  const picker = page.getByRole('dialog', { name: `添加模型 · ${id}`, exact: true });
  const started = page.waitForRequest('**/api/admin/connections/discover-models');
  await picker.getByRole('button', { name: '获取模型列表' }).click();
  await started;
  await picker.getByLabel('模型用途').selectOption('embedding');
  const finished = page.waitForResponse('**/api/admin/connections/discover-models');
  release();
  await finished;
  await expect(picker.getByRole('checkbox', { name: 'old-chat-catalog' })).toBeHidden();
  await expect(picker.getByRole('button', { name: '获取模型列表' })).toBeEnabled();
});

test('partial model saves remain retryable when refreshing the list also fails', async ({ page, request }) => {
  const id = `partial-models-${Date.now().toString(36)}`;
  expect((await request.post(`${service}/api/v1/admin/connections`, { headers, data: {
    id, name: id, kind: 'openai-compatible-text', baseUrl: `https://${id}.example/v1`,
  } })).status()).toBe(201);
  await page.goto('/settings/public-services');
  await page.getByRole('button', { name: `添加模型 · ${id}`, exact: true }).click();
  const picker = page.getByRole('dialog', { name: `添加模型 · ${id}`, exact: true });
  for (const model of ['saved-once', 'retry-model']) {
    await picker.getByLabel('手动添加模型 ID').fill(model);
    await picker.getByRole('button', { name: '加入', exact: true }).click();
  }
  let fail = true;
  const saves: string[] = [];
  await page.route('**/api/admin/models', async route => {
    if (route.request().method() === 'GET') {
      if (fail) return route.fulfill({ status: 503, json: { message: '刷新暂不可用' } });
      return route.fallback();
    }
    const payload = route.request().postDataJSON();
    saves.push(payload.modelId);
    if (fail && payload.modelId === 'retry-model') {
      return route.fulfill({ status: 503, json: { message: '模型保存暂不可用' } });
    }
    return route.fallback();
  });
  await picker.getByRole('button', { name: '保存所选模型（2）' }).click();
  await expect(picker.getByText(/部分模型未保存.*列表刷新失败/)).toBeVisible();
  await expect(picker.getByRole('button', { name: '保存所选模型（1）' })).toBeVisible();
  fail = false;
  await picker.getByRole('button', { name: '保存所选模型（1）' }).click();
  await expect(picker).toBeHidden();
  expect(saves).toEqual(['saved-once', 'retry-model', 'retry-model']);
  const stored = await (await request.get(`${service}/api/v1/admin/models`, { headers })).json();
  expect(stored.items.filter((item: { connectionId: string }) => item.connectionId === id)).toHaveLength(2);
});

test('search service switches explicitly, keeps settings across reload, and previews without real upstream calls', async ({ page, request }) => {
  const reset = await request.put(`${service}/api/v1/admin/web-search/settings`, { headers, data: { provider: 'tavily', enabled: false, anonymous: false } });
  expect(reset.ok()).toBe(true);
  await page.goto('/settings/public-services?tab=extensions');
  const panel = page.locator('section[aria-labelledby="web-search-heading"]');
  await expect(panel.getByRole('heading', { name: '联网搜索' })).toBeVisible();
  await expect(page.getByPlaceholder('应用 ID，例如 my-app')).toBeHidden();
  await panel.getByLabel('搜索服务').selectOption('anysearch');
  await expect(panel.getByRole('checkbox', { name: '使用免密钥模式' })).toBeChecked();
  await panel.getByRole('switch', { name: '启用联网搜索' }).check();
  await expect(panel.getByRole('button', { name: '测试连接', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByText('搜索设置已保存。', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: '测试连接', exact: true })).toBeEnabled();
  await page.reload();
  await expect(panel.getByLabel('搜索服务')).toHaveValue('anysearch');
  await expect(panel.getByRole('checkbox', { name: '使用免密钥模式' })).toBeChecked();

  await panel.getByLabel('搜索服务').selectOption('exa');
  await panel.getByLabel('Exa API Key').fill('unsaved-exa-value');
  await panel.getByLabel('搜索服务').selectOption('tavily');
  await expect(panel.getByLabel('Tavily API Key')).toHaveValue('');
  await panel.getByLabel('搜索服务').selectOption('anysearch');

  await page.route('**/api/admin/web-search/search', async route => route.fulfill({ json: {
    query: '资料搜索验证', items: [{ id: 'fixture-result', provider: 'anysearch', title: '公开资料示例',
      url: 'https://example.com/research', siteName: 'example.com', snippet: '搜索摘要内容', content: '搜索摘要内容',
      retrievedAt: '2026-11-15T00:00:00.000Z', contentHash: 'fixture-hash', status: 'snippet', truncated: false }],
  } }));
  await page.route('**/api/admin/web-search/extract', async route => {
    const { items } = route.request().postDataJSON();
    await route.fulfill({ json: { items: items.map((item: object) => ({ ...item, status: 'extracted', content: '提取后的完整正文内容' })) } });
  });
  await panel.getByText('试搜一下', { exact: true }).click();
  await panel.getByRole('textbox', { name: '搜索主题' }).fill('资料搜索验证');
  await panel.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(panel.getByRole('link', { name: '公开资料示例' })).toBeVisible();
  await panel.getByRole('checkbox', { name: '选择提取：公开资料示例' }).check();
  await panel.getByRole('button', { name: '提取所选正文' }).click();
  await expect(panel.getByText('已提取正文', { exact: true })).toBeVisible();
});

test('supplier and search layouts fit desktop, tablet and mobile with readable dialogs', async ({ page, request, browser, browserName }) => {
  test.setTimeout(120_000);
  mkdirSync(evidence, { recursive: true });
  const suffix = Date.now().toString(36);
  const supplierId = `visual-supplier-${suffix}`;
  for (const [id, name] of [[supplierId, '共享模型供应商'], [`visual-empty-${suffix}`, '已连接，暂未选择模型']]) {
    const response = await request.post(`${service}/api/v1/admin/connections`, { headers, data: {
      id, name, kind: 'openai-compatible-text', baseUrl: `https://${id}.example.com/v1`,
    } });
    expect(response.status()).toBe(201);
  }
  for (const [type, name] of [['chat', '日常文本与看图'], ['embedding', '资料向量模型'], ['image', '插画生成模型']]) {
    const response = await request.post(`${service}/api/v1/admin/models`, { headers, data: {
      id: `visual-${type}-${suffix}`, connectionId: supplierId, name,
      modelId: `${type}-model-with-a-long-upstream-name/preview-2026`, modelType: type,
      capabilities: type === 'chat' ? ['text', 'multimodal'] : [],
    } });
    expect(response.status()).toBe(201);
  }

  const context = await browser.newContext({ deviceScaleFactor: 2, serviceWorkers: 'block' });
  const view = await context.newPage();
  await context.addInitScript(() => {
    if (!localStorage.getItem('sthstart_theme_id')) localStorage.setItem('sthstart_theme_id', 'light-paper');
  });
  try {
    for (const width of [1920, 1440, 1024, 390]) {
      await view.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await view.goto('/settings/public-services', { waitUntil: 'networkidle' });
      await expect(view.getByRole('heading', { name: '供应商与模型' })).toBeVisible();
      expect(await view.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await view.screenshot({ path: join(evidence, `${browserName}-models-${width}-light.png`), fullPage: true, animations: 'disabled' });
      await view.locator(`[data-supplier-id="${supplierId}"]`).getByRole('button', { name: '添加模型 · 共享模型供应商', exact: true }).click();
      const dialog = view.getByRole('dialog', { name: '添加模型 · 共享模型供应商' });
      await expect(dialog.getByLabel('模型用途')).toBeVisible();
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await view.screenshot({ path: join(evidence, `${browserName}-picker-${width}-light.png`), animations: 'disabled' });
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await view.getByRole('tab', { name: '扩展服务', exact: true }).click();
      await expect(view.getByRole('heading', { name: '联网搜索', exact: true })).toBeVisible();
      await view.screenshot({ path: join(evidence, `${browserName}-extensions-${width}-light.png`), fullPage: true, animations: 'disabled' });
      expect(await view.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }
    await view.evaluate(() => localStorage.setItem('sthstart_theme_id', 'dark-espresso'));
    await view.reload({ waitUntil: 'networkidle' });
    await expect(view.locator('html')).toHaveAttribute('data-theme', 'dark-espresso');
    await expect(view.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
    await view.screenshot({ path: join(evidence, `${browserName}-extensions-390-dark.png`), fullPage: true, animations: 'disabled' });
    await view.getByRole('tab', { name: '模型', exact: true }).click();
    await view.screenshot({ path: join(evidence, `${browserName}-models-390-dark.png`), fullPage: true, animations: 'disabled' });
  } finally { await context.close(); }
  await page.goto('/settings/public-services');
});
