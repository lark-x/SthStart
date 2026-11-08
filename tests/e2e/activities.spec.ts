import { expect, test } from '@playwright/test';

let browserErrors: string[] = [];
/* 用例明确预期、且已核对过响应体的浏览器错误条数（按完整文本匹配后逐条抵消）。 */
let expectedBrowserErrors: string[] = [];

test.beforeEach(({ page }) => {
  browserErrors = [];
  expectedBrowserErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    browserErrors.push(`pageerror: ${error.message}`);
  });
});

test.afterEach(() => {
  const expected = [...expectedBrowserErrors];
  const unexpectedErrors = browserErrors.filter((msg) => {
    if (msg.includes('401') || msg.includes('net::ERR_')) return false;
    const index = expected.indexOf(msg);
    if (index >= 0) { expected.splice(index, 1); return false; }
    return true;
  });
  expect(unexpectedErrors, unexpectedErrors.join('\n')).toEqual([]);
});

test('Activity Studio: full navigation, wizard creation and workstation tabs', async ({ page, request }) => {
  const service = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT ?? 4200}`;
  const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
  // 1. 制作列表页：标题与入口已随改版改名为「制作项目 / 导入制作 / 新建制作」。
  await page.goto('/apps/activities');
  await expect(page.getByRole('heading', { name: '制作项目', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: '导入制作' })).toBeVisible();
  await expect(page.getByRole('link', { name: '新建制作' })).toBeVisible();

  // 2. 新建入口默认是「新建制作工坊」快速页；企划向导需要显式切换。
  await page.getByRole('link', { name: '新建制作' }).click();
  await expect(page).toHaveURL(/\/apps\/activities\/new/);
  await expect(page.getByRole('heading', { name: '新建制作工坊' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: '创建方式' })).toBeVisible();
  await page.getByRole('button', { name: '切换传统企划向导' }).click();
  await expect(page.getByRole('heading', { name: '新建活动' })).toBeVisible();

  // 3. 向导：自定义参与者 + 「从空白开始」直接建活动，不需要文本模型。
  await page.getByLabel('活动标题').fill('海边露营自动化测试');
  await page.getByLabel('活动主题与梗概').fill('海风与晚餐合照');
  await page.getByRole('button', { name: '自定义参与者' }).first().click();
  await page.getByLabel('自定义参与者 1 名称').fill('旅行者');
  await expect(page.getByLabel('自定义参与者 1 身份描述')).toBeVisible();
  await page.getByRole('button', { name: '从空白开始' }).click();

  /*
   * 创建活动会在服务端落库并做角色快照，全量并发跑时明显变慢。
   * 这里只放宽导航等待时间，仍然断言进入了新建活动的详情路由。
   */
  // 4. 工作室外壳：页头标题、自动保存状态，以及服务端已有第 1 个正式版本。
  await expect(page).toHaveURL(/\/apps\/activities\/[a-f0-9-]+$/, { timeout: 20_000 });
  const activityId = page.url().split('/').pop()!;
  await expect(page.getByRole('heading', { name: '海边露营自动化测试', level: 1 })).toBeAttached();
  await expect(page.getByLabel('活动标题', { exact: true })).toHaveValue('海边露营自动化测试');
  await expect(page.getByRole('status').getByText('已保存')).toBeVisible();
  const created = await (await request.get(`${service}/api/v1/admin/activities/${activityId}`, { headers })).json();
  expect(created.activity.headVersion).toBe(1);

  /*
   * 5. 工作台视图：旧的「内容 / 素材 / 回放 / 导出」页级 tab 已改为
   * 「分镜漫剧 / 漫画工坊 / 素材制作」三视图，回放改为页头「试演」浮层，
   * 设定与导出收进「更多工作台操作」菜单。群聊 / 朋友圈 / 剧情事实三类记录
   * 与记录详情栏已随分镜工作台改版移除，分镜编辑由下面的场次与镜头覆盖。
   */
  await page.setViewportSize({ width: 1440, height: 900 });
  const views = page.getByRole('group', { name: '工作台视图' });
  await expect(views.getByRole('button', { name: '分镜漫剧' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('剧情大纲', { exact: true })).toBeVisible();

  // 分镜视图：新建场次与镜头，镜头工坊随选中镜头展示绘制面板。
  await page.getByRole('button', { name: '加场', exact: true }).first().click();
  await expect(page.getByLabel('场次标题')).toHaveValue('新场次 1');
  await page.getByLabel('分镜 1 对白').fill('记录详情用例台词');
  await expect(page.getByRole('region', { name: '当前镜头画面' })).toBeVisible();
  await expect(page.getByRole('status').getByText('已保存')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '添加分镜', exact: true }).click();
  await expect(page.getByLabel('分镜 2 对白')).toBeVisible();
  /* 镜头流是工作台内独立滚动，不应把页面撑出横向滚动。 */
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
  ).toBeTruthy();

  // 1280px 以下右侧镜头工坊默认收起，可再展开。
  await page.setViewportSize({ width: 1180, height: 800 });
  await expect(page.getByRole('button', { name: '展开镜头工坊' })).toBeVisible();
  await page.getByRole('button', { name: '展开镜头工坊' }).click();
  await expect(page.getByRole('button', { name: '收起镜头工坊' })).toBeVisible();

  // 窄屏：大纲与场次改为下拉选择，镜头绘制单独切换，且无横向溢出。
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('当前幕')).toBeVisible();
  await expect(page.getByLabel('当前场次')).toHaveValue(/.+/);
  await page.getByRole('button', { name: '镜头绘制' }).click();
  await expect(page.getByLabel('选择镜头')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
  ).toBeTruthy();
  await page.getByRole('button', { name: '返回剧情' }).click();
  await page.setViewportSize({ width: 1440, height: 900 });

  // 设定：活动设置抽屉含基本资料 / 登场演员 / 幕次目标。
  const more = page.getByRole('button', { name: '更多工作台操作' });
  await more.click();
  await page.getByRole('menuitem', { name: '活动设置' }).click();
  const settings = page.getByRole('dialog', { name: '活动全局设置' });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('tab', { name: '基本资料' })).toBeVisible();
  await expect(settings.getByLabel('活动标题')).toHaveValue('海边露营自动化测试');
  await settings.getByRole('tab', { name: /幕次目标/ }).click();
  await expect(settings.getByLabel('幕次标题').first()).toBeVisible();
  await settings.getByRole('button', { name: '完成' }).click();
  await expect(settings).toBeHidden();

  // 素材制作视图
  await views.getByRole('button', { name: '素材制作' }).click();
  await expect(page.getByRole('heading', { name: '图片与视频' })).toBeVisible();
  await expect(page.getByRole('button', { name: '新增镜头' })).toBeVisible();

  // 漫画工坊视图
  await views.getByRole('button', { name: '漫画工坊' }).click();
  await expect(views.getByRole('button', { name: '漫画工坊' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: '图片与视频' })).toHaveCount(0);
  await views.getByRole('button', { name: '分镜漫剧' }).click();
  await expect(page.getByText('剧情大纲', { exact: true })).toBeVisible();

  // 试演（原「回放」tab）：全屏浮层，Escape 关闭。
  await page.getByRole('button', { name: '试演', exact: true }).click();
  await expect(page.getByText('回放编排与设备模拟预览')).toBeVisible();
  await expect(page.getByText('观众视角：')).toBeVisible();
  await expect(page.getByRole('button', { name: '自动生成编排' })).toBeVisible();
  await page.getByRole('button', { name: '关闭试演预览' }).click();
  await expect(page.getByText('回放编排与设备模拟预览')).toBeHidden();

  /*
   * 「版本回溯」抽屉已随旧工作台移除（新菜单只有美术指导 / 批量出图 / 活动设置 / 导出交付），
   * 这里不再检查。导出改为「更多 → 导出交付」浮层。
   */
  await more.click();
  await page.getByRole('menuitem', { name: '导出交付' }).click();
  await expect(page.getByText('导出离线包与可渲染工程')).toBeVisible();
  await expect(page.getByText('视频制作工程 (HyperFrames Project)')).toBeVisible();
});

test('Activity Studio: prompt source opens its exact local field and publishes a changed recipe', async ({ page, request }) => {
  const { readFileSync } = await import('node:fs');
  const content = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  content.actors.forEach((actor: any) => { actor.outfitDescription = '蓝色活动礼服'; });
  const service = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT ?? 4200}`;
  const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
  const create = await request.post(service + '/api/v1/admin/activities', { headers, data: { document: content } });
  expect(create.ok()).toBeTruthy();
  const { activity } = await create.json();
  /*
   * 测试环境没有绑定 activity_image_text 图片工作流，素材绘制工作台打开时的
   * 配置检查（slot-visual-preview）会如实返回 409 generation_assignment_not_found，
   * 页面以提示文字展示。只放过这一种已核对响应体的 409，其余浏览器错误仍然报错。
   */
  page.on('response', async (response) => {
    if (!response.url().includes('/slot-visual-preview') || response.status() !== 409) return;
    const body = await response.json().catch(() => null);
    if (body?.error === 'generation_assignment_not_found') {
      expectedBrowserErrors.push('console: Failed to load resource: the server responded with a status of 409 (Conflict)');
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/apps/activities/' + activity.id);
  /*
   * 记录里的「点击打开 AI 生图 / 提示词溯源工作台」入口已随群聊记录视图移除；
   * 现在从「素材制作」视图的镜头卡片「绘制图片」打开同一个素材绘制工作台。
   * 配方准备与提示词溯源只在「专业模式」显示，简单模式会自动完成。
   */
  await page.getByRole('group', { name: '工作台视图' }).getByRole('button', { name: '素材制作' }).click();
  await page.getByRole('button', { name: '绘制图片' }).first().click();
  const workbench = page.getByRole('dialog', { name: '素材绘制' });
  await expect(workbench).toBeVisible();
  await workbench.getByRole('group', { name: '生图设置模式' }).getByRole('button', { name: '专业模式' }).click();
  await page.getByRole('button', { name: '准备配方 / 编译' }).click();
  await expect(page.getByText('服装', { exact: true }).first()).toBeVisible();
  await page.getByText('服装', { exact: true }).first().click();
  await page.getByRole('button', { name: '定位源头字段' }).first().click();
  const field = page.getByRole('textbox', { name: '当前字段值' });
  await expect(field).toHaveValue('蓝色活动礼服');
  await field.fill('白色生日礼服');
  await page.getByRole('button', { name: '保存本场来源并发布版本' }).click();
  await expect(field).not.toBeVisible();
  await page.getByRole('button', { name: '准备配方 / 编译' }).click();
  await expect(page.getByText(/白色生日礼服/).first()).toBeVisible();
  const current = await request.get(service + '/api/v1/admin/activities/' + activity.id, { headers });
  const result = await current.json();
  expect(result.currentContentRevision.document.actors.some((actor: any) => actor.outfitDescription === '白色生日礼服')).toBeTruthy();
});

test('Activity Studio: compiled playback has the same state after direct and reverse seeks', async ({ page }) => {
  const { readFileSync } = await import('node:fs');
  const { compileHyperFramesComposition } = await import('@sthstart/activity-playback');
  const content = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  const playback = JSON.parse(readFileSync('packages/activity-playback/fixtures/playback_sample_v1.json', 'utf8'));
  const gsapSource = readFileSync('packages/activity-playback/templates/phone-v1/assets/gsap.min.js', 'utf8');
  const html = compileHyperFramesComposition(content, { schemaVersion: 1, slotBindings: [] }, playback, { gsapSource }).html;
  // Block fixture asset loads: this test measures text/layout timeline state, not media decoding.
  await page.route('**/*', route => route.fulfill({ status: 200, body: '' }));
  await page.setContent(html);
  await page.waitForFunction(() => Boolean((window as any).__timelines?.main));
  const state = (time: number) => page.evaluate(t => {
    (window as any).__timelines.main.seek(t);
    return Array.from(document.querySelectorAll('#nav-title-text,#chat-view,#moments-view,#chat-scroll,#moments-scroll,.msg-row,#device-content')).map(el => {
      const style = getComputedStyle(el);
      return { id: el.id, display: style.display, opacity: style.opacity, visibility: style.visibility, transform: style.transform, text: el.id === 'nav-title-text' ? el.textContent : null };
    });
  }, time);
  const direct = await state(18);
  await state(24); await state(1); await state(12);
  expect(await state(18)).toEqual(direct);
  const rewind = await state(1);
  await state(23); await state(0);
  expect(await state(1)).toEqual(rewind);
});

test('Activity Studio: device preview loads the same compiled video and audio as export', async ({ page, request }) => {
  const { readFileSync } = await import('node:fs');
  const content = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  const service = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT ?? 4200}`;
  const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
  const create = await request.post(service + '/api/v1/admin/activities', { headers, data: { document: content } });
  const { activity } = await create.json();
  const base = service + '/api/v1/admin/activities/' + activity.id;
  const bindings = [];
  for (const slot of content.mediaSlots) {
    const video = slot.kind === 'video';
    const uploaded = await request.post(base + '/uploads', { headers: { ...headers, 'content-type': video ? 'video/mp4' : 'image/png', 'x-artifact-original-name': video ? 'camp.mp4' : 'camp.png' }, data: readFileSync('packages/activity-playback/fixtures/' + (video ? 'camp_video.mp4' : 'camp_photo.png')) });
    expect(uploaded.ok()).toBeTruthy();
    bindings.push({ slotId: slot.id, slotFingerprint: '', assets: [{ assetKey: (await uploaded.json()).assetKey, order: 1 }] });
  }
  const media = await request.post(base + '/media-revisions', { headers, data: { contentRevisionId: activity.currentContentRevisionId, slotBindings: bindings } });
  expect(media.ok()).toBeTruthy();
  const mediaId = (await media.json()).id;
  const generated = await request.post(base + '/playback/auto', { headers, data: {} });
  const playback = (await generated.json()).document;
  const saved = await request.post(base + '/playback-revisions', { headers, data: { contentRevisionId: activity.currentContentRevisionId, mediaRevisionId: mediaId, document: playback } });
  expect(saved.ok()).toBeTruthy();
  /*
   * 「回放」tab 已改为页头「试演」全屏浮层。浮层只在打开时读取已保存的回放版本，
   * 因此等这份版本加载完再打开，断言仍是「预览与导出用同一份编译结果」。
   */
  const savedRevisionId = (await saved.json()).id;
  const revisionLoaded = page.waitForResponse(response => response.url().includes(`/playback-revisions/${savedRevisionId}`) && response.ok());
  await page.goto('/apps/activities/' + activity.id);
  await revisionLoaded;
  await page.getByRole('button', { name: '试演', exact: true }).click();
  const frame = page.frameLocator('iframe[title="活动真实回放预览"]');
  await expect(frame.locator('video[src]').first()).toBeAttached();
  await expect(frame.locator('audio[id][src]').first()).toBeAttached();
  await expect.poll(() => frame.locator('video').first().evaluate((el: HTMLVideoElement) => el.readyState)).toBeGreaterThan(0);
  const videoAction = playback.actions.find((a: any) => a.type === 'open_media' && a.kind === 'video');
  const scrubber = page.locator('input[type="range"]').first();
  await scrubber.fill(String(videoAction.atMs + 1000));
  await expect(frame.locator('video').first()).toBeVisible();
  await expect.poll(() => frame.locator('video').first().evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThan(0.9);
});

/*
 * 设备布局切换：手机是单列滑动（有状态栏、无阶段导航），电脑是三栏常驻
 * （无状态栏、有阶段导航）。切换只重编译预览，不需要重新生成动作序列。
 */
test('Activity Studio: device layout switch swaps phone and desktop compositions', async ({ page, request }) => {
  const { readFileSync } = await import('node:fs');
  const content = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  const service = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT ?? 4200}`;
  const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
  const create = await request.post(service + '/api/v1/admin/activities', { headers, data: { document: content } });
  const { activity } = await create.json();
  const base = service + '/api/v1/admin/activities/' + activity.id;

  /*
   * 预览要求内容与素材版本同时存在；本用例只关心版式，因此绑定空素材集。
   * 服务端保存回放时要求文档内的 mediaRevisionId 与请求一致，所以先建素材版本，
   * 再按它生成两种布局的动作序列（此前先生成后绑定，会被判为 playback_document_revision_mismatch）。
   */
  const media = await request.post(base + '/media-revisions', { headers, data: { contentRevisionId: activity.currentContentRevisionId, slotBindings: [] } });
  expect(media.ok()).toBeTruthy();
  const mediaId = (await media.json()).id;

  // 电脑布局生成：画布 1920x1080、模板 desktop-v1。
  const desktop = await request.post(base + '/playback/auto', { headers, data: { deviceLayout: 'desktop', mediaRevisionId: mediaId } });
  expect(desktop.ok()).toBeTruthy();
  const desktopDoc = (await desktop.json()).document;
  expect(desktopDoc.output).toMatchObject({ width: 1920, height: 1080 });
  expect(desktopDoc.template.id).toBe('desktop-v1');
  expect(desktopDoc.layout).toMatchObject({ width: 1280, height: 720 });

  // 手机布局生成：画布 1080x1920、模板 phone-v1。
  const phone = await request.post(base + '/playback/auto', { headers, data: { deviceLayout: 'phone', mediaRevisionId: mediaId } });
  expect(phone.ok()).toBeTruthy();
  const phoneDoc = (await phone.json()).document;
  expect(phoneDoc.output).toMatchObject({ width: 1080, height: 1920 });
  expect(phoneDoc.template.id).toBe('phone-v1');
  expect(phoneDoc.mediaRevisionId).toBe(mediaId);

  // 保存手机版本后进入工作台，预览应为手机版式。
  const saved = await request.post(base + '/playback-revisions', { headers, data: { contentRevisionId: activity.currentContentRevisionId, mediaRevisionId: mediaId, document: phoneDoc } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  // 「回放」tab 已改为页头「试演」浮层；等已保存的回放版本加载后再打开。
  const savedRevisionId = (await saved.json()).id;
  const revisionLoaded = page.waitForResponse(response => response.url().includes(`/playback-revisions/${savedRevisionId}`) && response.ok());
  await page.goto('/apps/activities/' + activity.id);
  await revisionLoaded;
  await page.getByRole('button', { name: '试演', exact: true }).click();

  const frame = page.frameLocator('iframe[title="活动真实回放预览"]');
  await expect(frame.locator('#root.device-phone')).toHaveCount(1);

  // 切到电脑：预览重编译为三栏常驻，动作序列不变。
  await page.getByRole('button', { name: '电脑', exact: true }).click();
  await expect(frame.locator('#root.device-desktop')).toHaveCount(1);
  await expect(frame.locator('#stage-nav')).toHaveCount(1);
  await expect(frame.locator('#chat-view.pane')).toHaveCount(1);
  await expect(frame.locator('#moments-view.pane')).toHaveCount(1);
});
