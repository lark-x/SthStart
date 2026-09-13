import { expect, test } from '@playwright/test';

let browserErrors: string[] = [];

test.beforeEach(({ page }) => {
  browserErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    browserErrors.push(`pageerror: ${error.message}`);
  });
});

test.afterEach(() => {
  const unexpectedErrors = browserErrors.filter((msg) => {
    if (msg.includes('401') || msg.includes('net::ERR_')) return false;
    return true;
  });
  expect(unexpectedErrors, unexpectedErrors.join('\n')).toEqual([]);
});

test('Activity Studio: full navigation, wizard creation and workstation tabs', async ({ page }) => {
  // 1. Visit Activities list page
  await page.goto('/apps/activities');
  await expect(page.getByRole('heading', { name: '活动工作室' })).toBeVisible();
  await expect(page.getByRole('button', { name: '导入活动' })).toBeVisible();
  await expect(page.getByRole('link', { name: '新建活动' })).toBeVisible();

  // 2. Click New Activity
  await page.getByRole('link', { name: '新建活动' }).click();
  await expect(page).toHaveURL(/\/apps\/activities\/new/);
  await expect(page.getByRole('heading', { name: '新建活动' })).toBeVisible();

  // 3. Fill the creation form: templates are applied by default, and participants come from the library or manual entries.
  await page.getByLabel('活动标题').fill('海边露营自动化测试');
  await page.getByLabel('活动主题与梗概').fill('海风与晚餐合照');
  await page.getByRole('button', { name: '添加自定义参与者' }).click();

  // 阶段一次只展开一个：先确认两个阶段条目存在，再展开第二个核对字段。
  await expect(page.getByLabel('阶段 1 标题')).toBeVisible();
  await expect(page.getByRole('button', { name: /02.*第二阶段|02.*未命名阶段/ })).toBeVisible();
  await page.getByRole('button', { name: /02.*第二阶段|02.*未命名阶段/ }).click();
  await expect(page.getByLabel('阶段 2 标题')).toBeVisible();

  // Verify the participant snapshot exists
  await expect(page.getByText('旅行者')).toBeVisible();

  // Submit and enter workspace
  await page.getByRole('button', { name: '直接创建活动' }).click();

  /*
   * 创建活动会在服务端落库并做角色快照，全量并发跑时明显变慢。
   * 这里只放宽导航等待时间，仍然断言进入了新建活动的详情路由。
   */
  // 4. Verify Studio Workspace Shell
  await expect(page).toHaveURL(/\/apps\/activities\/[a-f0-9-]+/, { timeout: 20_000 });
  await expect(page.getByText('海边露营自动化测试')).toBeVisible();
  await expect(page.getByText(/版本 1/)).toBeVisible();
  await expect(page.getByRole('status').getByText('已保存')).toBeVisible();

  // 5. Test 4 Workstation Tabs
  // Tab 1: Records (Chat & Moments)
  await expect(page.getByRole('button', { name: /群聊记录/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /朋友圈动态/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /本阶段发生的事/ })).toBeVisible();

  /*
   * 记录详情（计划 §8.5）：内容模式右栏「当前记录详情按需显示」，
   * 1280px 及以下改为页级详情抽屉。这里自己发一条群聊记录，
   * 保证不依赖测试库里是否恰好存在带消息的活动。
   */
  await page.getByPlaceholder('在此输入群聊内容，按回车添加…').fill('记录详情用例消息');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('记录详情用例消息')).toBeVisible();

  const detailTrigger = page.getByRole('button', { name: '查看第 1 条记录的详情' });

  // 宽屏：右侧固定详情栏
  await page.setViewportSize({ width: 1440, height: 900 });
  await detailTrigger.click();
  const detailAside = page.getByRole('complementary', { name: '当前记录详情' });
  await expect(detailAside).toBeVisible();
  await expect(detailAside.getByText('说话人')).toBeVisible();
  await expect(detailAside.getByText('叙事顺序')).toBeVisible();
  await detailAside.getByRole('button', { name: '关闭记录详情' }).click();
  await expect(detailAside).toBeHidden();

  // 1280px 及以下：底部详情抽屉
  await page.setViewportSize({ width: 1280, height: 800 });
  await detailTrigger.click();
  const detailDrawer = page.getByRole('dialog', { name: '当前记录详情' });
  await expect(detailDrawer).toBeVisible();
  await expect(detailDrawer.getByText('说话人')).toBeVisible();
  /* 抽屉是浮层，打开后不应把页面撑出横向滚动。 */
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
  ).toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(detailDrawer).toBeHidden();

  // 窄屏同样走抽屉，并保持无横向溢出。
  await page.setViewportSize({ width: 390, height: 844 });
  await detailTrigger.click();
  await expect(page.getByRole('dialog', { name: '当前记录详情' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
  ).toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '当前记录详情' })).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 720 });

  // Tab 2: Settings & Stages
  // 工作模式改为页级 tab 语义（§8.5）。
  await page.getByRole('tab', { name: '设定' }).click();
  await expect(page.getByText('活动基本属性')).toBeVisible();
  await expect(page.getByText('活动阶段设定')).toBeVisible();

  // Tab 3: Media Workstation
  await page.getByRole('tab', { name: '素材' }).click();
  await expect(page.getByRole('heading', { name: '图片与视频' })).toBeVisible();
  await expect(page.getByRole('button', { name: '新增镜头' })).toBeVisible();

  // Tab 4: Playback & Preview
  await page.getByRole('tab', { name: '回放' }).click();
  await expect(page.getByText('回放编排与设备模拟预览')).toBeVisible();
  await expect(page.getByText('观众视角：')).toBeVisible();
  await expect(page.getByRole('button', { name: '自动生成编排' })).toBeVisible();

  // 6. Test Drawers & Modals
  // Checkpoints drawer
  await page.click('button:has-text("版本回溯")');
  await expect(page.getByText('版本回溯与检查点快照')).toBeVisible();
  await page.click('button:has-text("关闭")');

  // Export modal
  await page.click('button:has-text("导出工程")');
  await expect(page.getByText('导出离线包与可渲染工程')).toBeVisible();
  await expect(page.getByText('完整自包含 HyperFrames 工程包')).toBeVisible();
  await page.click('button:has-text("取消")');
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
  await page.goto('/apps/activities/' + activity.id);
  await page.getByTitle('点击打开 AI 生图 / 提示词溯源工作台').first().click();
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
  await page.goto('/apps/activities/' + activity.id);
  await page.getByRole('tab', { name: '回放' }).click();
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
