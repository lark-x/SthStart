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

test('portal opens on the work dashboard with full sidebar navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page).toHaveTitle(/SthStart/);
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '最近工作' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '创作模块' })).toBeVisible();

  // 应用入口常驻侧栏，首屏即可到达，不再依赖首页的等权卡片网格。
  const primaryNav = page.getByRole('navigation', { name: '主导航' });
  const neighborLink = await primaryNav.getByRole('link', { name: '邻舍' }).boundingBox();
  expect(neighborLink).not.toBeNull();
  expect((neighborLink?.y ?? 720) + (neighborLink?.height ?? 0)).toBeLessThanOrEqual(720);
});

test('portal home lists the four creative modules and opens them', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  // 首页不再放全部应用目录：四个创作模块卡片直达主要工作区，其余应用走侧栏与命令面板。
  const modules = page.getByRole('navigation', { name: '创作模块' });
  await expect(modules.getByRole('link')).toHaveCount(4);
  for (const [name, href] of [
    ['创作项目', '/apps/projects'],
    ['角色库', '/apps/characters'],
    ['资料库', '/apps/resources'],
    ['媒体库', '/apps/media'],
  ] as const) {
    await expect(modules.getByRole('link', { name: new RegExp(`^${name}`) })).toHaveAttribute('href', href);
  }
  for (const card of await modules.getByRole('link').all()) await expect(card).toBeInViewport();

  await modules.getByRole('link', { name: /^角色库/ }).click();
  await expect(page).toHaveURL(/\/apps\/characters(?:\?.*)?$/);
  await expect(page.getByRole('heading', { name: '角色资料库', level: 1 })).toBeVisible();
  const noHorizontalOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );
  expect(noHorizontalOverflow).toBe(true);
});

test('creative center exposes a safe unconfigured image workspace', async ({ page }) => {
  await page.goto('/apps/creative');
  await expect(page.getByRole('heading', { name: '自由生成', level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: '文本生图' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '图生图' })).toBeVisible();
  await page.locator('summary').filter({ hasText: /服务(已就绪|待配置)/ }).click();
  await expect(page.getByRole('heading', { name: '公共生成状态' })).toBeVisible();
  await expect(page.getByRole('link', { name: '进入生成配置' })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByText('媒体库还是空的')).toBeVisible();

  await page.getByRole('tab', { name: '图生图' }).click();
  await expect(page.getByLabel('参考图片')).toBeVisible();
  await expect(page.getByText('浏览器不会发送 Base64。')).toBeVisible();

  for (const mode of ['文本生图', '图生图', '文生视频', '图生视频', '首尾帧视频']) {
    const tab = page.getByRole('tab', { name: mode });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    /*
     * 图片模式统一走共享的图片生成面板（画面描述 + 生成方案）；
     * 视频模式仍是固定表单。两种形态都必须安全（无密码输入、无裸凭据）。
     */
    if (mode === '文本生图' || mode === '图生图') {
      await expect(page.getByLabel('描述你的画面')).toBeVisible();
    } else {
      await expect(page.getByLabel('正向提示词')).toBeVisible();
    }
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '开始生成' })).toBeVisible();
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
  /*
   * 标签按钮在 hydration 前就已由 SSR 渲染可见，此时点击会被丢弃。
   * 与命令面板、「新建模板」同一处理：重试点击直到面板内容出现，
   * 断言仍然是「切到自启与服务会看到运行参数面板」。
   */
  const startupPanel = page.getByText('运行参数与自启配置');
  for (let attempt = 0; attempt < 12 && !(await startupPanel.isVisible()); attempt += 1) {
    await page.getByRole('tab', { name: '自启与服务' }).click();
    await page.waitForTimeout(150);
  }
  await expect(startupPanel).toBeVisible();

  const executable = page.getByLabel('ComfyUI 独立执行路径');
  const originalExecutable = await executable.inputValue();
  const persistedExecutable = `/tmp/sthstart-e2e-${Date.now().toString(36)}`;
  await executable.fill(persistedExecutable);
  await page.getByRole('button', { name: '保存运行配置' }).click();
  await expect(page.getByText('运行配置已保存')).toBeVisible();
  await page.reload();
  const persistedField = page.getByLabel('ComfyUI 独立执行路径');
  for (let attempt = 0; attempt < 12 && !(await persistedField.isVisible()); attempt += 1) {
    await page.getByRole('tab', { name: '自启与服务' }).click();
    await page.waitForTimeout(150);
  }
  await expect(persistedField).toHaveValue(persistedExecutable);

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

test('public services creates a connection, imports discovered models, and assigns them to an app', async ({ page }) => {
  /*
   * 这条用例串行走完“新建连接 → 发现并导入模型 → 编辑模型 → 建应用令牌 → 绑定 → 解绑”，
   * 与其余用例并发、且测试库里的连接与应用会逐次累积时，30 秒的默认上限容易被击穿。
   * 这里只放宽时限，断言内容不变。
   */
  test.setTimeout(90_000);
  const suffix = Date.now().toString(36);
  const connectionId = `conn-e2e-${suffix}`;
  const connectionName = `测试连接 ${suffix}`;
  const textModelId = `${connectionId}-text-model`;
  const visionModelId = `${connectionId}-vision-model`;
  const visionModelName = `测试视觉模型 ${suffix}`;
  const appId = `writer-${suffix}`;
  // 模型发现会请求远端 /models，这里拦截为固定结果，不访问外部服务。
  await page.route('**/api/admin/connections/discover-models', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ models: ['text-model', 'vision-model'], endpoint: 'https://provider.example/v1/models' }),
    })
  );
  await page.goto('/settings/public-services');
  await expect(page.getByRole('heading', { name: '模型与公共服务', level: 1 })).toBeVisible();

  // 服务连接页签：新建一条 OpenAI 兼容文本连接（不填密钥，保存时不做远端探测）。
  const connectionDialog = page.getByRole('dialog', { name: '新建服务连接' });
  const newConnection = page.getByRole('button', { name: '新建连接' });
  for (let attempt = 0; attempt < 12 && !(await connectionDialog.isVisible()); attempt += 1) {
    await newConnection.click();
    await page.waitForTimeout(150);
  }
  await expect(connectionDialog).toBeVisible();
  await connectionDialog.getByPlaceholder('e.g. openai-main').fill(connectionId);
  await connectionDialog.getByPlaceholder('OpenAI 官方连接').fill(connectionName);
  await connectionDialog.getByPlaceholder('https://api.openai.com/v1').fill('https://provider.example/v1');
  await connectionDialog.getByRole('button', { name: '立即创建' }).click();
  await expect(connectionDialog).toBeHidden();
  /*
   * 测试库里的连接会随每次运行累积，列表首屏不保证包含刚建的那条。
   * 用本次运行的唯一后缀过滤，断言「保存后这条记录真的出现在列表里」。
   */
  await page.getByPlaceholder('搜索连接名称、地址或 ID...').fill(suffix);
  await expect(page.getByRole('heading', { name: connectionName })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: `更多连接操作：${connectionName}` }).click();
  await page.getByRole('menuitem', { name: '发现模型' }).click();
  const discoverDrawer = page.getByRole('dialog', { name: '发现并导入远端模型' });
  await expect(discoverDrawer.getByText('共发现 2 个模型')).toBeVisible();
  await discoverDrawer.getByRole('button', { name: '一键添加为模型配置 (2)' }).click();
  await expect(page.getByText('成功导入 2 个模型配置。')).toBeVisible();

  // 文本模型页签：导入的两条模型都在；把其中一条改名并标记为多模态。
  await page.getByRole('tab', { name: /^文本模型/ }).click();
  await page.getByPlaceholder('搜索模型名称、ID 或实际模型名称...').fill(suffix);
  await expect(page.getByRole('heading', { name: `${connectionName} - text-model` })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: `更多模型操作：${connectionName} - vision-model` }).click();
  await page.getByRole('menuitem', { name: '编辑配置' }).click();
  const modelDialog = page.getByRole('dialog', { name: '编辑模型配置' });
  await modelDialog.getByPlaceholder('GPT-4o Mini 主力').fill(visionModelName);
  await modelDialog.getByLabel('多模态视觉 (multimodal)').check();
  await modelDialog.getByRole('button', { name: '保存修改' }).click();
  await expect(modelDialog).toBeHidden();
  await expect(page.getByRole('heading', { name: visionModelName })).toBeVisible({ timeout: 15_000 });

  // 其他服务页签：为新应用签发令牌。
  await page.getByRole('tab', { name: '其他服务' }).click();
  const appForm = page.locator('form').filter({ has: page.getByPlaceholder('应用 ID，例如 my-app') });
  await appForm.getByPlaceholder('应用 ID，例如 my-app').fill(appId);
  await appForm.getByPlaceholder('应用名称').fill(`测试应用 ${suffix}`);
  await appForm.getByRole('button', { name: '创建应用令牌' }).click();
  await expect(page.getByText('应用令牌已生成。')).toBeVisible();

  // 用途绑定页签：给新应用指定文本与多模态模型，再清空。
  await page.getByRole('tab', { name: /^用途绑定/ }).click();
  const assignment = page.locator('#panel-purposes section').filter({ has: page.getByRole('heading', { name: new RegExp(appId) }) });
  const [textSelect, visionSelect] = [assignment.getByRole('combobox').nth(0), assignment.getByRole('combobox').nth(1)];
  await textSelect.selectOption(textModelId);
  await visionSelect.selectOption(visionModelId);
  await assignment.getByRole('button', { name: '保存绑定' }).click();
  await expect(page.getByText('应用模型绑定已保存。')).toBeVisible();
  await expect(textSelect).toHaveValue(textModelId);
  await expect(visionSelect).toHaveValue(visionModelId);

  await textSelect.selectOption('');
  await visionSelect.selectOption('');
  await assignment.getByRole('button', { name: '保存绑定' }).click();
  await expect(page.getByText('应用模型绑定已保存。').first()).toBeVisible();
});

test('character library opens, creates a character and edits fields', async ({ page }) => {
  const suffix = Date.now().toString(36);
  const characterName = `测试角色 ${suffix}`;

  await page.goto('/apps/characters');
  await expect(page.getByRole('heading', { name: '角色资料库' })).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/apps/characters/new');
  // 编辑器按「人设 / 外貌 / 资产 / LoRA」分段；角色名称、作品与标签在分段上方行内编辑。
  await expect(page.getByRole('heading', { name: '新建角色档案', level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: '人设' })).toHaveAttribute('aria-selected', 'true');

  await page.getByLabel('角色名称').fill(characterName);
  await page.getByPlaceholder('如：原神、星穹铁道、原创世界').fill('SthStart Origin');
  await page.getByLabel('一句话概述').fill('测试角色的简要身份描述。');
  await page.getByLabel('详细人设背景').fill('### 身份\n测试角色，来自港口城市。\n\n### 性格\n- 冷静，习惯先观察再行动');

  const createdDetailResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'GET' &&
      response.status() === 200 &&
      /^\/api\/admin\/characters\/[^/]+$/.test(url.pathname)
    );
  });
  await page.getByRole('button', { name: '保存档案' }).click();
  // 整套并发跑时多个 worker 同时写库，创建请求可能超过默认 5 秒。
  await expect(page.getByText('角色档案创建成功')).toBeVisible({ timeout: 15_000 });
  await createdDetailResponse;
  await expect(page).toHaveURL(/\/apps\/characters\/[^/]+$/);
  await expect(page.getByLabel('角色名称')).toHaveValue(characterName);

  await page.getByRole('tab', { name: '外貌' }).click();
  await page.getByLabel('基础外貌特征').fill('短发，佩戴圆框眼镜；身材娇小、步态轻盈。');
  await page.getByLabel('代表性装扮与配饰').fill('深色风衣与围巾。');
  await page.getByRole('button', { name: '保存档案' }).click();
  await expect(page.getByText('角色档案已保存')).toBeVisible();

  // 刷新后仍要从权威草稿里读回这几块内容。
  await page.reload();
  await expect(page.getByLabel('一句话概述')).toHaveValue('测试角色的简要身份描述。');
  await expect(page.getByPlaceholder('如：原神、星穹铁道、原创世界')).toHaveValue('SthStart Origin');
  await page.getByRole('tab', { name: '外貌' }).click();
  await expect(page.getByLabel('基础外貌特征')).toHaveValue('短发，佩戴圆框眼镜；身材娇小、步态轻盈。');
  await expect(page.getByLabel('代表性装扮与配饰')).toHaveValue('深色风衣与围巾。');

  // 导出收在视觉预览卡的「更多」菜单里。
  await page.getByRole('button', { name: '更多', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出酒馆卡 (JSON)' }).click();
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
  await expect(page.getByRole('heading', { name: '创作资料库', level: 1 })).toBeVisible();

  await page.goto('/apps/notebook/new');
  await page.getByPlaceholder('无标题笔记').fill(noteTitle);
  await page.getByPlaceholder('添加标签，按回车确定...').fill('灵感, 测试');
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
  await page.getByPlaceholder('无标题笔记').fill(editedTitle);
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
  // 列表默认展开；只有之前被收起时才需要再展开。
  const expandList = page.getByRole('button', { name: '展开笔记列表' });
  if (await expandList.isVisible().catch(() => false)) await expandList.click();
  await page.getByText(editedTitle).first().click();
  await expect(page.getByPlaceholder('无标题笔记')).toHaveValue(editedTitle);

  expectedOfflineDisconnects = true;
  await page.context().setOffline(true);
  const offlineTitle = `${editedTitle}（离线）`;
  await page.getByPlaceholder('无标题笔记').fill(offlineTitle);
  await expect(page.getByText('离线 · 待同步')).toBeVisible();
  expect(noteWrites).toBe(2);
  const resumedSync = page.waitForResponse((response) => response.request().method() === 'PUT'
    && /\/api\/admin\/notebook\/notes\/[^/]+$/.test(new URL(response.url()).pathname));
  await page.context().setOffline(false);
  await resumedSync;
  await expect(page.getByText('已同步')).toBeVisible();
  expect(noteWrites).toBe(3);
});

test('notebook mobile roundtrip returns to the list and picks another note', async ({ page }) => {
  const suffix = Date.now().toString(36);
  const titleA = `往返甲${suffix}`;
  const titleB = `往返乙${suffix}`;
  for (const t of [titleA, titleB]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/apps/notebook/new');
    /*
     * 并发跑时 hydration 可能晚于 fill，受控输入会被重置为空，最后存成「未命名笔记」。
     * 填完稍等再确认值仍在，丢了就重填。
     */
    const titleInput = page.getByPlaceholder('无标题笔记');
    await expect(async () => {
      await titleInput.fill(t);
      await page.waitForTimeout(300);
      await expect(titleInput).toHaveValue(t, { timeout: 500 });
    }).toPass({ timeout: 15_000 });
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('已保存到本机').first()).toBeVisible();
    await page.waitForTimeout(1200);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/apps/notebook');
  await expect(page.getByRole('heading', { name: titleA })).toBeVisible();
  await page.getByRole('heading', { name: titleA }).click();
  await page.waitForTimeout(2000);
  await expect(page.getByPlaceholder('无标题笔记')).toHaveValue(titleA);

  // 返回列表后不得被 initialNoteId 自动拉回编辑器
  await page.getByRole('link', { name: '返回资料列表' }).click();
  await page.waitForTimeout(1200);
  await expect(page.locator('.notebook-master-pane')).toBeVisible();
  await expect(page.getByPlaceholder('无标题笔记')).toHaveCount(0);

  await expect(page.getByRole('heading', { name: titleB })).toBeVisible();
  await page.getByRole('heading', { name: titleB }).click();
  await page.waitForTimeout(2000);
  await expect(page.getByPlaceholder('无标题笔记')).toHaveValue(titleB);
});

test('notebook mobile layout stays compact and within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/apps/notebook');

  await expect(page.getByRole('heading', { name: '创作资料库', level: 1 })).toBeVisible();
  await expect(page.getByPlaceholder('搜索标题、正文或标签…')).toBeVisible();
  await expect(page.locator('.notebook-list-header .page-header-actions a')).toHaveText(/新建/);

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
  await expect(page.getByPlaceholder('无标题笔记')).toBeVisible();
  await expect(page.getByPlaceholder('写下一段文字记录…')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存' })).toBeVisible();
  await expect(page.getByRole('button', { name: '段落文本' })).toBeVisible();

  const editorGeometry = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(editorGeometry.documentWidth).toBeLessThanOrEqual(editorGeometry.viewportWidth + 1);

  await page.getByPlaceholder('无标题笔记').fill('移动端布局验收');
  await page.getByPlaceholder('写下一段文字记录…').fill('手机端输入保持稳定，不应触发页面缩放。');
  await expect(page.getByPlaceholder('无标题笔记')).toHaveValue('移动端布局验收');
  await expect(page.getByPlaceholder('写下一段文字记录…')).toHaveValue('手机端输入保持稳定，不应触发页面缩放。');
});

test('narrative workspace opens and supports reading and import views', async ({ page }) => {
  await page.goto('/apps/narrative');
  await expect(page.getByRole('heading', { name: '叙事档案', level: 1 })).toBeVisible();
  await expect(page.getByLabel('当前作品')).toBeVisible();

  // Switch to import view
  // 工作模式改为页级 tab 语义（§8.9），不再是自绘分段按钮。
  await page.getByRole('tab', { name: '数据源与导入' }).click();
  await expect(page.getByText('把来源变成可追溯的本地档案')).toBeVisible();
  await expect(page.getByText('规范化剧情 JSON 工作台')).toBeVisible();

  await page.getByRole('button', { name: '校验并预览' }).click();
  await expect(page.getByText('JSON 校验成功')).toBeVisible();
  await page.getByRole('button', { name: '确认写入本地档案' }).click();
  /*
   * 导入完成后同一标题会同时出现在左侧目录树与右侧正文标题里，
   * getByText 会因 strict mode 命中两个元素。这里明确断言正文标题，
   * 语义比“页面上随便出现一次”更强。
   */
  await expect(page.getByRole('heading', { name: '雨夜来信' })).toBeVisible();

  const search = page.getByPlaceholder('搜索当前作品原文…');
  await page.getByRole('button', { name: '检索原文' }).click();
  await search.fill('雨夜');
  const result = page.getByRole('button', { name: /雨夜来信|末班车站/ }).first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.getByText('雨落在空无一人的站台。')).toBeVisible();

  // Switch back to read view
  await page.getByRole('tab', { name: '阅读' }).click();

  const saveToNotebook = page.getByRole('button', { name: /^摘录到笔记/ }).first();
  await expect(saveToNotebook).toBeAttached();
  await saveToNotebook.click({ force: true });
  await expect(page).toHaveURL(/\/apps\/notebook\//);
});

test('generation settings creates isolated engine and workflow records', async ({ page }) => {
  const suffix = Date.now().toString(36);
  const engineName = `测试引擎 ${suffix}`;
  await page.goto('/settings/generation');
  await expect(page.getByRole('heading', { name: '生成配置', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: '刷新' }).click();

  // 连接页签：新建连接默认 ComfyUI 直连，只需名称与地址。
  const connectionsTab = page.getByRole('tab', { name: '连接' });
  for (let attempt = 0; attempt < 12 && !(await page.getByRole('button', { name: '新建连接' }).isVisible().catch(() => false)); attempt += 1) {
    await connectionsTab.click();
    await page.waitForTimeout(150);
  }
  await page.getByRole('button', { name: '新建连接' }).click();
  const connectionDialog = page.getByRole('dialog');
  await connectionDialog.getByLabel('名称').fill(engineName);
  await connectionDialog.getByLabel('地址').fill('http://127.0.0.1:8188');
  await connectionDialog.getByRole('button', { name: '保存连接' }).click();
  await expect(page.getByText(engineName).first()).toBeVisible();

  // 工作流页签：导入原生 API JSON（先分析后创建），ID 由系统生成，不再手填。
  // 空库时只有空状态里的「导入工作流」，已有工作流时是头部的「导入」，两种入口打开同一个导入对话框。
  const workflowsTab = page.getByRole('tab', { name: '工作流', exact: true });
  const importWorkflow = page.getByRole('button', { name: /^导入(?:工作流)?$/ }).first();
  for (let attempt = 0; attempt < 12 && !(await importWorkflow.isVisible().catch(() => false)); attempt += 1) {
    await workflowsTab.click();
    await page.waitForTimeout(150);
  }
  await importWorkflow.click();
  const importDialog = page.getByRole('dialog');
  await importDialog.getByLabel('工作流 JSON 内容').fill(JSON.stringify({
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd15/model.safetensors' } },
    '9': { class_type: 'SaveImage', inputs: { images: [['4', 0]] } },
  }));
  await importDialog.getByRole('button', { name: '分析' }).click();
  await importDialog.getByLabel('工作流名称').fill(`测试工作流 ${suffix}`);
  await importDialog.getByRole('button', { name: '创建并打开编辑器' }).click();
  const workspace = page.getByTestId('workflow-workspace');
  await expect(workspace).toBeVisible({ timeout: 15_000 });
  await expect(workspace.getByRole('option', { name: `测试工作流 ${suffix}` })).toBeAttached();
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
  await page.getByRole('button', { name: '打开导航' }).click();
  const drawerNav = page.getByRole('dialog', { name: '导航' }).getByRole('navigation', { name: '主导航' });
  await expect(drawerNav.getByRole('link', { name: '邻舍' })).toBeInViewport();
  // 侧栏最后一项是系统设置：它在视口内就说明整列导航都没有被裁掉。
  await expect(drawerNav.getByRole('link', { name: '系统设置' })).toBeInViewport();
  await page.getByRole('button', { name: '关闭导航' }).click();

  for (const [route, selector] of [
    ['/apps/characters/new', '.character-editor-tabs button'],
    ['/apps/notebook', '.notebook-filter-options button'],
    // 控制中心分区已改用共享页级 tabs（§8.12），选择器随之更新。
    ['/settings/control-center', '.page-tabs button'],
  ] as const) {
    await page.goto(route);
    const controls = page.locator(selector);
    await expect(controls.first(), route).toBeVisible();
    const viewport = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(viewport.documentWidth, route).toBeLessThanOrEqual(viewport.viewportWidth + 1);
    const count = await controls.count();
    expect(count, route).toBeGreaterThan(0);
    // 窄屏 tab 条按设计横向滚动（globals.css .page-tabs），逐个滚入视野后再量，确认每项都能完整露出。
    for (let index = 0; index < count; index += 1) {
      const control = controls.nth(index);
      await control.scrollIntoViewIfNeeded();
      const rect = await control.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, height: box.height };
      });
      expect(rect.left, route).toBeGreaterThanOrEqual(-1);
      expect(rect.right, route).toBeLessThanOrEqual(viewport.viewportWidth + 1);
      expect(rect.height, route).toBeGreaterThanOrEqual(40);
    }
  }
});

test('character editor tabs stay inside a 390px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/apps/characters/new');
  await expect(page.getByRole('tab', { name: '人设' })).toBeVisible();

  // 头部操作行曾经是 shrink-0，无法收缩就把文档撑到 474px。
  const measure = async () => page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));

  const initial = await measure();
  expect(initial.document, '新建角色不应横向溢出').toBeLessThanOrEqual(initial.viewport + 1);

  const tabs = page.locator('.character-editor-tabs button');
  const tabCount = await tabs.count();
  expect(tabCount).toBeGreaterThan(0);
  for (const control of await tabs.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, height: rect.height };
  }))) {
    expect(control.left).toBeGreaterThanOrEqual(-1);
    expect(control.right).toBeLessThanOrEqual(initial.viewport + 1);
    expect(control.height).toBeGreaterThanOrEqual(40);
  }

  // 逐个分区都要能打开，且都不横向溢出。
  for (const name of ['外貌', '资产', 'LoRA', '人设']) {
    await page.getByRole('tab', { name }).click();
    await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
    const geometry = await measure();
    expect(geometry.document, `${name} 不应横向溢出`).toBeLessThanOrEqual(geometry.viewport + 1);
  }

  // 视觉预览与资产在小屏收进折叠条，展开后同样不能横向溢出。
  await page.getByRole('button', { name: /视觉预览与资产形态/ }).click();
  await expect(page.getByRole('heading', { name: '形象资产库' })).toBeVisible();
  const expanded = await measure();
  expect(expanded.document, '展开视觉预览不应横向溢出').toBeLessThanOrEqual(expanded.viewport + 1);
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
  const searchBox = page.getByPlaceholder(/搜索应用、操作、角色或笔记/);
  /*
   * 快捷键监听在客户端 hydration 后才挂载，而 goto() 返回时首帧可能已渲染但尚未 hydration。
   * 并行跑多条用例时这段窗口会变长，早到的按键会丢失；这里在对话框未出现前重试按键，
   * 既保留“快捷键能打开面板”的断言，又不依赖 hydration 的具体耗时。
   */
  for (let attempt = 0; attempt < 12 && !(await searchBox.isVisible()); attempt += 1) {
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(100);
  }
  await expect(searchBox).toBeVisible();
  const commandDialog = page.getByRole('dialog', { name: '命令快捷菜单' });
  await expect(commandDialog.getByRole('button', { name: /^邻舍.EXE/ })).toBeVisible();
  await expect(commandDialog.getByRole('button', { name: /^角色资料库/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('/');
  await expect(searchBox).toBeVisible();
  await page.keyboard.press('Escape');
});
