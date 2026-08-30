import { expect, test } from '@playwright/test';

const e2eAdminToken = 'sthstart-e2e-secret-0123456789abcdef';
const e2eServiceUrl = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT ?? 4200}`;
let browserErrors: string[] = [];
let expectedAdminSessionProbes = 0;
let expectedOfflineDisconnects = false;

test.beforeEach(({ page }) => {
  browserErrors = [];
  expectedAdminSessionProbes = 0;
  expectedOfflineDisconnects = false;
  page.on('response', (response) => {
    if (response.url().includes('/api/auth/admin-session') && response.status() === 401) {
      expectedAdminSessionProbes += 1;
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    browserErrors.push(`pageerror: ${error.message}`);
  });
});

test.afterEach(() => {
  const unexpectedErrors = browserErrors.filter((message) => {
    if (message === 'console: Failed to load resource: the server responded with a status of 401 (Unauthorized)' && expectedAdminSessionProbes > 0) {
      expectedAdminSessionProbes -= 1;
      return false;
    }
    if (expectedOfflineDisconnects && /^console: Failed to load resource: net::ERR_(?:INTERNET_DISCONNECTED|FAILED)$/.test(message)) {
      return false;
    }
    return true;
  });
  expect(unexpectedErrors, unexpectedErrors.join('\n')).toEqual([]);
});

test('portal exposes its primary applications and lucide modern navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page).toHaveTitle(/SthStart/);
  await expect(page.locator('.app-card')).toHaveCount(5);
  await expect(page.getByRole('link', { name: '开始创作' })).toBeVisible();
  await expect(page.getByRole('link', { name: '打开笔记' })).toBeVisible();
  await expect(page.getByRole('link', { name: '进入档案' })).toBeVisible();
  await expect(page.getByRole('link', { name: '打开资料库' })).toBeVisible();
  await expect(page.getByRole('link', { name: '进入邻舍' })).toBeVisible();

  const firstAction = await page.getByRole('link', { name: '进入邻舍' }).boundingBox();
  expect(firstAction).not.toBeNull();
  expect((firstAction?.y ?? 720) + (firstAction?.height ?? 0)).toBeLessThanOrEqual(720);
});

test('creative center exposes a safe unconfigured image workspace', async ({ page }) => {
  await page.goto('/apps/creative');
  await expect(page.getByRole('heading', { name: '创作中心' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '文本生图' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '图生图' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '公共生成状态' })).toBeVisible();
  await expect(page.getByRole('link', { name: '进入生成配置' })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByText('媒体文件不会复制到邻舍数据库。')).toBeVisible();

  await page.getByRole('tab', { name: '图生图' }).click();
  await expect(page.getByLabel('参考图片')).toBeVisible();
  await expect(page.getByText('浏览器不会发送 Base64。')).toBeVisible();

  for (const mode of ['文本生图', '图生图', '文生视频', '图生视频', '首尾帧视频']) {
    const tab = page.getByRole('tab', { name: mode });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('正向提示词')).toBeVisible();
    await expect(page.getByRole('button', { name: '开始生成' })).toBeDisabled();
  }

  await page.getByRole('tab', { name: '图生视频' }).click();
  await expect(page.getByLabel('首帧图片')).toBeVisible();
  await page.getByRole('tab', { name: '首尾帧视频' }).click();
  await expect(page.getByLabel('首帧图片')).toBeVisible();
  await expect(page.getByLabel('尾帧图片')).toBeVisible();
});

test('local admin session opens the control center and switches tabs', async ({ page }) => {
  await page.goto('/settings/control-center');
  await expect(page.getByRole('heading', { name: '邻舍运行栈' })).toBeVisible();

  // Tab switching
  await page.getByRole('tab', { name: '自启与服务' }).click();
  await expect(page.getByText('运行参数与自启配置')).toBeVisible();

  const executable = page.getByLabel('ComfyUI 独立执行路径');
  const originalExecutable = await executable.inputValue();
  const persistedExecutable = `/tmp/sthstart-e2e-${Date.now().toString(36)}`;
  await executable.fill(persistedExecutable);
  await page.getByRole('button', { name: '保存运行配置' }).click();
  await expect(page.getByText('运行配置已保存')).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: '自启与服务' }).click();
  await expect(page.getByLabel('ComfyUI 独立执行路径')).toHaveValue(persistedExecutable);

  // Leave the E2E database in the same state as the test started.
  await page.getByLabel('ComfyUI 独立执行路径').fill(originalExecutable);
  await page.getByRole('button', { name: '保存运行配置' }).click();
  await expect(page.getByText('运行配置已保存')).toBeVisible();

  await page.getByRole('tab', { name: '创作扩展' }).click();
  await expect(page.getByText('创作扩展与生图参数')).toBeVisible();

  await page.getByRole('tab', { name: '模型接入' }).click();
  await expect(page.getByText('邻舍模型接入状态')).toBeVisible();

  await page.getByRole('tab', { name: '实时日志' }).click();
  await expect(page.getByPlaceholder('搜索日志内容…')).toBeVisible();
});

test('public services creates, discovers, clones, and assigns application models', async ({ page }) => {
  const suffix = Date.now().toString(36);
  const profileId = `model-${suffix}`;
  const cloneId = `model-copy-${suffix}`;
  const appId = `writer-${suffix}`;
  await page.route('**/api/admin/llm/models/discover', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ models: ['text-model', 'vision-model'] }),
    })
  );
  await page.goto('/settings/public-services');
  await expect(page.getByRole('heading', { name: '公共 LLM 模板库' })).toBeVisible();
  const editor = page.locator('form.llm-editor');
  await editor.getByLabel('配置 ID').fill(profileId);
  await editor.getByLabel('显示名称').fill(`测试模型 ${suffix}`);
  await editor.getByLabel('API Base URL').fill('https://provider.example/v1');
  await editor.getByRole('button', { name: '获取模型' }).click();
  await expect(page.getByText('已获取 2 个模型')).toBeVisible();
  await editor.getByLabel('模型 ID').fill('vision-model');
  await editor.getByLabel(/多模态/).check();
  await editor.getByRole('button', { name: '保存模板配置' }).click();
  await expect(page.getByText(`测试模型 ${suffix}`).first()).toBeVisible();

  const sourceCard = page.locator('.model-card').filter({ hasText: `测试模型 ${suffix}` });
  await sourceCard.getByRole('button', { name: '复制配置' }).click();
  await editor.getByLabel('配置 ID').fill(cloneId);
  await editor.getByLabel('显示名称').fill(`测试副本 ${suffix}`);
  await editor.getByLabel('模型 ID').fill('text-model');
  await editor.getByRole('button', { name: '创建独立副本' }).click();
  await expect(page.getByText(`测试副本 ${suffix}`).first()).toBeVisible();

  const updatedName = `测试模板已更新 ${suffix}`;
  await sourceCard.getByRole('button', { name: '编辑' }).click();
  await editor.getByLabel('显示名称').fill(updatedName);
  await editor.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByText(updatedName).first()).toBeVisible();

  const appForm = page.locator('form').filter({ has: page.getByPlaceholder('应用 ID，例如 my-app') });
  await appForm.getByPlaceholder('应用 ID，例如 my-app').fill(appId);
  await appForm.getByPlaceholder('应用名称').fill(`测试应用 ${suffix}`);
  await appForm.getByRole('button', { name: '创建应用令牌' }).click();
  const assignment = page.locator('form.assignment-card').filter({ hasText: `测试应用 ${suffix}` });
  await assignment.getByLabel('文本模型').selectOption(cloneId);
  await assignment.getByLabel('多模态模型').selectOption(profileId);
  await assignment.getByRole('button', { name: '保存应用选择' }).click();
  await expect(page.getByText('应用的生效模型已更新。')).toBeVisible();

  await assignment.getByLabel('文本模型').selectOption('');
  await assignment.getByLabel('多模态模型').selectOption('');
  await assignment.getByRole('button', { name: '保存应用选择' }).click();
  await expect(page.getByText('应用的生效模型已更新。').first()).toBeVisible();
});

test('character library opens, creates a character and edits fields', async ({ page }) => {
  const suffix = Date.now().toString(36);
  const characterName = `测试角色 ${suffix}`;

  await page.goto('/apps/characters');
  await expect(page.getByRole('heading', { name: '角色资料库' })).toBeVisible();

  await page.goto('/apps/characters/new');
  await expect(page.getByRole('heading', { name: '身份与经历' })).toBeVisible();

  await page.getByLabel('角色名称').fill(characterName);
  await page.getByLabel('英文名 / 拼音').fill(`Character ${suffix}`);
  await page.getByLabel('所属作品').fill('SthStart Origin');
  await page.getByLabel('一句话人物摘要').fill('测试角色的简要身份描述。');

  const createdDetailResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'GET' &&
      response.status() === 200 &&
      /^\/api\/admin\/characters\/[^/]+$/.test(url.pathname)
    );
  });
  await page.getByRole('button', { name: '保存草稿' }).click();
  await createdDetailResponse;
  await expect(page).toHaveURL(/\/apps\/characters\/[^/]+$/);
  await expect(page.getByText(characterName).first()).toBeVisible();

  // Switch to personality tab
  await page.getByRole('tab', { name: '性格与表达' }).click();
  await expect(page.getByRole('heading', { name: '性格与表达' })).toBeVisible();

  await page.getByRole('button', { name: '添加' }).first().click();
  await page.getByRole('textbox', { name: '性格特点 1' }).fill('谨慎观察每一个细节');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText('草稿已保存')).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: '性格与表达' }).click();
  await expect(page.getByRole('textbox', { name: '性格特点 1' })).toHaveValue('谨慎观察每一个细节');

  await page.getByRole('tab', { name: '外观与素材' }).click();
  await page.getByPlaceholder(/身材娇小、步态轻盈/).fill('短发，佩戴圆框眼镜，穿着深色风衣。');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText('草稿已保存')).toBeVisible();

  await expect(page.getByRole('button', { name: '导入 JSON' })).toBeEnabled();
  await page.getByRole('button', { name: '发布版本' }).click();
  await expect(page.getByText(/已成功发布版本 v\d+/)).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
});

test('notebook block controls update the local draft', async ({ page }) => {
  await page.goto('/apps/notebook/new');
  await expect(page.locator('.notebook-block')).toHaveCount(1);
  await page.getByRole('button', { name: '参考链接' }).click();
  await page.getByRole('button', { name: '角色引用' }).click();
  await expect(page.locator('.notebook-block')).toHaveCount(3);
  await page.getByRole('button', { name: '上移第 3 个内容块' }).click();
  await page.getByRole('button', { name: '删除第 3 个内容块' }).click();
  await expect(page.locator('.notebook-block')).toHaveCount(2);
});

test('notebook creates a note with blocks and tags', async ({ page }) => {
  const suffix = Date.now().toString(36);
  const noteTitle = `灵感记录 ${suffix}`;
  let noteWrites = 0;
  page.on('request', (request) => {
    if (request.method() === 'PUT' && /\/api\/admin\/notebook\/notes\/[^/]+$/.test(new URL(request.url()).pathname)) noteWrites += 1;
  });

  await page.goto('/apps/notebook');
  await expect(page.getByRole('heading', { name: '拾 创作笔记' })).toBeVisible();

  await page.goto('/apps/notebook/new');
  await page.getByPlaceholder('输入笔记标题…').fill(noteTitle);
  await page.getByPlaceholder('添加标签（用逗号分隔，如：灵感，第 2 章）…').fill('灵感, 测试');
  await page.getByPlaceholder('写下一段文字记录…').fill('这是一段通过现代化编辑器记录的灵感正文。');

  const firstSync = page.waitForResponse((response) => response.request().method() === 'PUT'
    && /\/api\/admin\/notebook\/notes\/[^/]+$/.test(new URL(response.url()).pathname));
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('已保存到本机').first()).toBeVisible();
  await firstSync;
  await expect(page).toHaveURL(/\/apps\/notebook\/[^/]+$/);
  await expect(page.getByText('已同步')).toBeVisible();
  expect(noteWrites).toBe(1);

  const editedTitle = `${noteTitle}（已编辑）`;
  await page.getByPlaceholder('输入笔记标题…').fill(editedTitle);
  const secondSync = page.waitForResponse((response) => response.request().method() === 'PUT'
    && /\/api\/admin\/notebook\/notes\/[^/]+$/.test(new URL(response.url()).pathname));
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('已保存到本机').first()).toBeVisible();
  await secondSync;
  expect(noteWrites).toBe(2);
  // 内嵌新建模式下保存不会把 URL 替换为笔记 id，刷新 /new 会得到空白
  // 编辑器；恢复入口是笔记列表（IndexedDB 中已有该记录）。
  await page.reload();
  await page.goto('/apps/notebook');
  await page.getByRole('button', { name: '展开笔记列表' }).click();
  await page.getByText(editedTitle).first().click();
  await expect(page.getByPlaceholder('输入笔记标题…')).toHaveValue(editedTitle);

  expectedOfflineDisconnects = true;
  await page.context().setOffline(true);
  const offlineTitle = `${editedTitle}（离线）`;
  await page.getByPlaceholder('输入笔记标题…').fill(offlineTitle);
  await expect(page.getByText('离线 · 待同步')).toBeVisible();
  expect(noteWrites).toBe(2);
  const resumedSync = page.waitForResponse((response) => response.request().method() === 'PUT'
    && /\/api\/admin\/notebook\/notes\/[^/]+$/.test(new URL(response.url()).pathname));
  await page.context().setOffline(false);
  await resumedSync;
  await expect(page.getByText('已同步')).toBeVisible();
  expect(noteWrites).toBe(3);
});

test('notebook mobile layout stays compact and within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/apps/notebook');

  await expect(page.getByRole('heading', { name: '创作笔记' })).toBeVisible();
  await expect(page.getByPlaceholder('搜索标题、正文或标签…')).toBeVisible();
  await expect(page.locator('.notebook-list-header .page-header-actions a')).toHaveText(/新建记录/);

  const listGeometry = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    pageWidth: document.querySelector('.notebook-list-page')?.getBoundingClientRect().width ?? 0,
  }));
  expect(listGeometry.documentWidth).toBeLessThanOrEqual(listGeometry.viewportWidth + 1);
  expect(listGeometry.pageWidth).toBeLessThanOrEqual(listGeometry.viewportWidth + 1);
  for (const label of ['全部', '日记', '灵感', '随记', '剧情', '角色', '世界']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeInViewport();
  }

  await page.goto('/apps/notebook/new');
  await expect(page.getByPlaceholder('输入笔记标题…')).toBeVisible();
  await expect(page.getByPlaceholder('写下一段文字记录…')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存' })).toBeVisible();
  await expect(page.getByRole('button', { name: '段落文本' })).toBeVisible();

  const editorGeometry = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(editorGeometry.documentWidth).toBeLessThanOrEqual(editorGeometry.viewportWidth + 1);

  await page.getByPlaceholder('输入笔记标题…').fill('移动端布局验收');
  await page.getByPlaceholder('写下一段文字记录…').fill('手机端输入保持稳定，不应触发页面缩放。');
  await expect(page.getByPlaceholder('输入笔记标题…')).toHaveValue('移动端布局验收');
  await expect(page.getByPlaceholder('写下一段文字记录…')).toHaveValue('手机端输入保持稳定，不应触发页面缩放。');
});

test('narrative workspace opens and supports reading and import views', async ({ page }) => {
  await page.goto('/apps/narrative');
  await expect(page.getByRole('heading', { name: '叙事档案', level: 1 })).toBeVisible();
  await expect(page.getByLabel('当前作品')).toBeVisible();

  // Switch to import view
  await page.getByRole('button', { name: '数据源与导入' }).click();
  await expect(page.getByText('把来源变成可追溯的本地档案')).toBeVisible();
  await expect(page.getByText('规范化剧情 JSON 工作台')).toBeVisible();

  await page.getByRole('button', { name: '校验并预览' }).click();
  await expect(page.getByText('JSON 校验成功')).toBeVisible();
  await page.getByRole('button', { name: '确认写入本地档案' }).click();
  await expect(page.getByText('雨夜来信')).toBeVisible();

  const search = page.getByPlaceholder('搜索当前作品原文…');
  await search.fill('雨夜');
  const result = page.getByRole('button', { name: /雨夜来信|末班车站/ }).first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.getByText('雨落在空无一人的站台。')).toBeVisible();

  // Switch back to read view
  await page.getByRole('button', { name: '阅读模式' }).click();

  const saveToNotebook = page.getByRole('button', { name: '存入创作笔记' }).first();
  await expect(saveToNotebook).toBeAttached();
  await saveToNotebook.click({ force: true });
  await expect(page).toHaveURL(/\/apps\/notebook\//);
});

test('generation settings creates isolated engine and workflow records', async ({ page }) => {
  const suffix = Date.now().toString(36);
  const engineId = `engine-${suffix}`;
  const workflowId = `workflow-${suffix}`;
  await page.goto('/settings/generation');
  await expect(page.getByRole('heading', { name: '生成工作流配置', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: '刷新' }).click();

  await page.getByLabel('引擎 ID').fill(engineId);
  await page.getByLabel('引擎名称').fill(`测试引擎 ${suffix}`);
  await page.getByLabel('ComfyUI 地址').fill('http://127.0.0.1:8188');
  await page.getByLabel('并发限制').fill('1');
  await page.getByRole('button', { name: '保存引擎' }).click();
  await expect(page.getByText(`测试引擎 ${suffix}`).first()).toBeVisible();

  await page.getByLabel('工作流 ID').fill(workflowId);
  await page.getByLabel('工作流名称').fill(`测试工作流 ${suffix}`);
  await page.getByRole('button', { name: '创建工作流' }).click();
  await expect(page.getByText(`测试工作流 ${suffix}`).first()).toBeVisible();
  await page.getByRole('button', { name: '保存绑定' }).click();
  await expect(page.getByText('创作中心绑定已保存')).toBeVisible();
});

test('application and settings pages keep one semantic main heading', async ({ page }) => {
  for (const route of [
    '/apps/creative',
    '/apps/characters',
    '/apps/characters/new',
    '/apps/notebook',
    '/apps/notebook/new',
    '/apps/narrative',
    '/settings/control-center',
    '/settings/public-services',
    '/settings/generation',
  ]) {
    await page.goto(route);
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveCount(1);
    const unlabeledControls = await page.locator('input:not([type="hidden"]), textarea, select').evaluateAll((elements) =>
      elements.filter((element) => {
        const id = element.id;
        return !(
          (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) ||
          element.getAttribute('aria-label') ||
          element.getAttribute('aria-labelledby') ||
          element.getAttribute('placeholder') ||
          element.closest('label')
        );
      }).length
    );
    expect(unlabeledControls, route).toBe(0);
  }
});

test('mobile application navigation exposes every action without clipping', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto('/');
  await expect(page.getByRole('link', { name: '进入邻舍' })).toBeInViewport();

  for (const [route, selector] of [
    ['/apps/characters/new', '.character-editor-tabs button'],
    ['/apps/notebook', '.notebook-filter-options button'],
    ['/settings/control-center', '.control-center-tabs button'],
  ] as const) {
    await page.goto(route);
    const geometry = await page.locator(selector).evaluateAll((elements) => ({
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      controls: elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
      }),
    }));
    expect(geometry.documentWidth, route).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.controls.length, route).toBeGreaterThan(0);
    for (const control of geometry.controls) {
      expect(control.left, route).toBeGreaterThanOrEqual(-1);
      expect(control.right, route).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      expect(control.height, route).toBeGreaterThanOrEqual(40);
    }
  }
});

test('runtime polls and logs receive a new SSE event', async ({ page, request }) => {
  let overviewRequests = 0;
  page.on('request', (requestEvent) => {
    const url = new URL(requestEvent.url());
    if (requestEvent.method() === 'GET' && url.pathname === '/api/admin/runtime/overview') {
      overviewRequests += 1;
    }
  });

  await page.goto('/settings/control-center?tab=logs');
  await expect(page.getByPlaceholder('搜索日志内容…')).toBeVisible();
  await expect(page.getByText('LIVE STREAM')).toBeVisible();
  await page.waitForTimeout(4_300);
  expect(overviewRequests).toBeGreaterThanOrEqual(2);

  const suffix = Date.now().toString(36);
  const created = await request.post(`${e2eServiceUrl}/api/v1/admin/apps`, {
    headers: { 'x-sthstart-admin-token': e2eAdminToken },
    data: { id: `sse-${suffix}`, name: `SSE ${suffix}`, capabilities: ['logs'] },
  });
  expect(created.status()).toBe(201);
  const { token } = await created.json() as { token: string };
  const message = `e2e SSE event ${suffix}`;
  const accepted = await request.post(`${e2eServiceUrl}/api/v1/logs`, {
    headers: { authorization: `Bearer ${token}` },
    data: { serviceId: 'e2e', level: 'info', message },
  });
  expect(accepted.status()).toBe(202);
  await expect(page.getByText(message)).toBeVisible();
});

test('command palette opens via keyboard shortcut and shows items', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Meta+k');
  await expect(page.getByPlaceholder(/搜索应用、操作、角色或笔记/)).toBeVisible();
  const commandDialog = page.getByRole('dialog', { name: '命令快捷菜单' });
  await expect(commandDialog.getByRole('button', { name: /^邻舍.EXE/ })).toBeVisible();
  await expect(commandDialog.getByRole('button', { name: /^角色资料库/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('/');
  await expect(page.getByPlaceholder(/搜索应用、操作、角色或笔记/)).toBeVisible();
  await page.keyboard.press('Escape');
});
