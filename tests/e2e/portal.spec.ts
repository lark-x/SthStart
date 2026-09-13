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
  await expect(page.getByRole('heading', { name: '全部应用' })).toBeVisible();

  // 应用入口常驻侧栏，首屏即可到达，不再依赖首页的等权卡片网格。
  const primaryNav = page.getByRole('navigation', { name: '主导航' });
  const neighborLink = await primaryNav.getByRole('link', { name: '邻舍' }).boundingBox();
  expect(neighborLink).not.toBeNull();
  expect((neighborLink?.y ?? 720) + (neighborLink?.height ?? 0)).toBeLessThanOrEqual(720);
});

test('creative center exposes a safe unconfigured image workspace', async ({ page }) => {
  await page.goto('/apps/creative');
  await expect(page.getByRole('heading', { name: '创作中心' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '文本生图' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '图生图' })).toBeVisible();
  await page.locator('summary').filter({ hasText: '生成服务' }).click();
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

test('public services creates, discovers, clones, and assigns application models', async ({ page }) => {
  /*
   * 这条用例串行走完“新建模板 → 获取模型 → 保存 → 复制 → 编辑 → 建应用 → 绑定 → 解绑”，
   * 独占跑约 23 秒；它与其余用例并发、且测试库里的模板会逐次累积时，
   * 30 秒的默认上限会被击穿。这里只放宽时限，断言内容不变。
   */
  test.setTimeout(90_000);
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
  await expect(page.getByRole('heading', { name: /^模型模板/ })).toBeVisible();
  const editor = page.locator('form.llm-editor');
  /*
   * 页面首帧由服务端渲染，按钮在 hydration 完成前就可见，此时点击会被丢弃。
   * 高并发跑用例时这段窗口变长，因此重试点击直到表单真正出现，
   * 断言仍然是“点击新建模板会打开编辑表单”。
   */
  const newTemplate = page.getByRole('button', { name: '新建模板' });
  for (let attempt = 0; attempt < 12 && !(await editor.isVisible()); attempt += 1) {
    await newTemplate.click();
    await page.waitForTimeout(150);
  }
  await expect(editor).toBeVisible();
  await editor.getByLabel('配置 ID').fill(profileId);
  await editor.getByLabel('显示名称').fill(`测试模型 ${suffix}`);
  await editor.getByLabel('API Base URL').fill('https://provider.example/v1');
  await editor.getByRole('button', { name: '获取模型' }).click();
  await expect(page.getByText('已获取 2 个模型')).toBeVisible();
  await editor.getByLabel('模型 ID').fill('vision-model');
  await editor.getByLabel(/多模态/).check();
  await editor.getByRole('button', { name: '保存模板配置' }).click();
  /*
   * 测试库里的模板会随每次运行累积（本轮已到 160+ 条），列表首屏不再保证包含刚建的那条，
   * 而且保存后要等后端写入再重新拉取。用本次运行的唯一后缀过滤，
   * 断言仍然是「保存后这条记录真的出现在列表里」，不依赖列表规模与排序。
   */
  await page.getByLabel('搜索模型模板').fill(suffix);
  await expect(page.getByText(`测试模型 ${suffix}`).first()).toBeVisible({ timeout: 15_000 });

  const sourceCard = page.getByTestId('model-card').filter({ hasText: `测试模型 ${suffix}` });
  await sourceCard.getByRole('button', { name: '复制配置' }).click();
  await expect(editor).toBeVisible();
  await editor.getByLabel('配置 ID').fill(cloneId);
  await editor.getByLabel('显示名称').fill(`测试副本 ${suffix}`);
  await editor.getByLabel('模型 ID').fill('text-model');
  await editor.getByRole('button', { name: '创建独立副本' }).click();
  await expect(page.getByText(`测试副本 ${suffix}`).first()).toBeVisible({ timeout: 15_000 });

  const updatedName = `测试模板已更新 ${suffix}`;
  await sourceCard.getByRole('button', { name: '编辑' }).click();
  await expect(editor).toBeVisible();
  await editor.getByLabel('显示名称').fill(updatedName);
  await editor.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByText(updatedName).first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: '访问与其他能力', exact: true }).click();
  const appForm = page.locator('form').filter({ has: page.getByPlaceholder('应用 ID，例如 my-app') });
  await appForm.getByPlaceholder('应用 ID，例如 my-app').fill(appId);
  await appForm.getByPlaceholder('应用名称').fill(`测试应用 ${suffix}`);
  await appForm.getByRole('button', { name: '创建应用令牌' }).click();
  await page.getByRole('button', { name: '应用路由', exact: true }).click();
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
  // V2 编辑器只维护四块内容：人设正文、说话方式、基础外貌、默认穿着。
  await expect(page.getByRole('tab', { name: '身份与经历' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '身份与人设' })).toBeVisible();

  /*
   * §8.3：宽屏右侧内联预览，小屏改用抽屉。
   * 宽屏不应出现「预览」按钮（内容已在右栏）；小屏应出现按钮并能打开抽屉。
   */
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('button', { name: '预览' })).toHaveCount(0);
  await expect(page.getByText('资料检查').first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const previewButton = page.getByRole('button', { name: '预览' });
  await expect(previewButton).toBeVisible();
  await previewButton.click();
  const previewDrawer = page.getByRole('dialog', { name: '角色卡片预览' });
  await expect(previewDrawer).toBeVisible();
  await expect(previewDrawer.getByText('资料检查')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(previewDrawer).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.getByLabel('角色名称').fill(characterName);
  await page.getByLabel('英文名 / 拼音').fill(`Character ${suffix}`);
  await page.getByLabel('所属作品').fill('SthStart Origin');
  await page.getByLabel('一句话人物摘要').fill('测试角色的简要身份描述。');
  await page.getByLabel('人设正文').fill('### 身份\n测试角色，来自港口城市。\n\n### 性格\n- 冷静，习惯先观察再行动');

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

  // 性格相关的创作内容留在人设正文；这里只维护说话方式与行为约束。
  await page.getByRole('tab', { name: '性格与表达' }).click();
  await expect(page.getByRole('heading', { name: '说话方式与行为约束' })).toBeVisible();

  await page.getByLabel('说话方式').fill('语气：冷静克制，很少提高音量');
  await page.getByRole('button', { name: '添加' }).first().click();
  await page.getByRole('textbox', { name: '对话示例 1' }).fill('示例：先看完证据再说结论。');
  await page.getByLabel('行为约束').fill('不代替其他参与者做决定');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText('草稿已保存')).toBeVisible();

  // 刷新后仍要从权威草稿里读回这几块内容。
  await page.reload();
  await page.getByRole('tab', { name: '性格与表达' }).click();
  await expect(page.getByLabel('说话方式')).toHaveValue('语气：冷静克制，很少提高音量');
  await expect(page.getByRole('textbox', { name: '对话示例 1' })).toHaveValue('示例：先看完证据再说结论。');
  await expect(page.getByLabel('行为约束')).toHaveValue('不代替其他参与者做决定');

  await page.getByRole('tab', { name: '外观与素材' }).click();
  await page.getByLabel('基础外貌').fill('短发，佩戴圆框眼镜；身材娇小、步态轻盈。');
  await page.getByLabel('默认穿着').fill('深色风衣与围巾。');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText('草稿已保存')).toBeVisible();

  await expect(page.getByRole('button', { name: '导出' })).toBeEnabled();
  await page.getByRole('button', { name: '保存并使用' }).click();
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
  await expect(page.getByRole('heading', { name: '创作笔记' })).toBeVisible();

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

test('notebook mobile roundtrip returns to the list and picks another note', async ({ page }) => {
  const suffix = Date.now().toString(36);
  const titleA = `往返甲${suffix}`;
  const titleB = `往返乙${suffix}`;
  for (const t of [titleA, titleB]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/apps/notebook/new');
    await page.getByPlaceholder('输入笔记标题…').fill(t);
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('已保存到本机').first()).toBeVisible();
    await page.waitForTimeout(1200);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/apps/notebook');
  await expect(page.getByRole('heading', { name: titleA })).toBeVisible();
  await page.getByRole('heading', { name: titleA }).click();
  await page.waitForTimeout(2000);
  await expect(page.getByPlaceholder('输入笔记标题…')).toHaveValue(titleA);

  // 返回列表后不得被 initialNoteId 自动拉回编辑器
  await page.getByRole('button', { name: '返回笔记列表' }).click();
  await page.waitForTimeout(1200);
  await expect(page.locator('.notebook-master-pane')).toBeVisible();
  await expect(page.getByPlaceholder('输入笔记标题…')).toHaveCount(0);

  await expect(page.getByRole('heading', { name: titleB })).toBeVisible();
  await page.getByRole('heading', { name: titleB }).click();
  await page.waitForTimeout(2000);
  await expect(page.getByPlaceholder('输入笔记标题…')).toHaveValue(titleB);
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

  // 分区导航改为页级 tab（§8.11），断言随之使用 tab 语义。
  await page.getByRole('tab', { name: '引擎与执行器', exact: true }).click();
  await page.getByLabel('引擎 ID').fill(engineId);
  await page.getByLabel('引擎名称').fill(`测试引擎 ${suffix}`);
  await page.getByLabel('ComfyUI 地址').fill('http://127.0.0.1:8188');
  await page.getByLabel('并发限制').fill('1');
  await page.getByRole('button', { name: '保存引擎' }).click();
  await expect(page.getByText(`测试引擎 ${suffix}`).first()).toBeVisible();

  await page.getByRole('tab', { name: '工作流', exact: true }).click();
  await page.getByLabel('工作流 ID').fill(workflowId);
  await page.getByLabel('工作流名称').fill(`测试工作流 ${suffix}`);
  await page.getByRole('button', { name: '创建工作流' }).click();
  await expect(page.getByText(`测试工作流 ${suffix}`).first()).toBeVisible();
  await page.getByRole('tab', { name: '应用绑定', exact: true }).click();
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
  await page.getByRole('button', { name: '打开导航' }).click();
  const drawerNav = page.getByRole('dialog', { name: '导航' }).getByRole('navigation', { name: '主导航' });
  await expect(drawerNav.getByRole('link', { name: '邻舍' })).toBeInViewport();
  await expect(drawerNav.getByRole('link', { name: '活动' })).toBeInViewport();
  await page.getByRole('button', { name: '关闭导航' }).click();

  for (const [route, selector] of [
    ['/apps/characters/new', '.character-editor-tabs button'],
    ['/apps/notebook', '.notebook-filter-options button'],
    // 控制中心分区已改用共享页级 tabs（§8.12），选择器随之更新。
    ['/settings/control-center', '.page-tabs button'],
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

test('character editor tabs stay inside a 390px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/apps/characters/new');
  await expect(page.getByRole('tab', { name: '身份与经历' })).toBeVisible();

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
  for (const name of ['性格与表达', '外观与素材', '应用与版本']) {
    await page.getByRole('tab', { name }).click();
    const geometry = await measure();
    expect(geometry.document, `${name} 不应横向溢出`).toBeLessThanOrEqual(geometry.viewport + 1);
  }

  // 「关系与来源」要先进更多设置才可见。
  await page.getByRole('button', { name: /更多设置|更多/ }).click();
  await page.getByRole('tab', { name: '关系与来源' }).click();
  const relations = await measure();
  expect(relations.document, '关系与来源不应横向溢出').toBeLessThanOrEqual(relations.viewport + 1);
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
