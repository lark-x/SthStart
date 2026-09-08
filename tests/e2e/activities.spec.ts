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

  // 3. Fill creation wizard form
  await page.fill('input[placeholder*="海边营地烧烤"]', '海边露营自动化测试');
  await page.fill('input[placeholder*="夏日傍晚"]', '海风与晚餐合照');

  // Verify at least 2 stages are present
  await expect(page.getByRole('textbox', { name: '阶段名称（如：海边营地布置）' }).nth(0)).toBeVisible();
  await expect(page.getByRole('textbox', { name: '阶段名称（如：海边营地布置）' }).nth(1)).toBeVisible();

  // Verify actor snapshot exists
  await expect(page.getByText('旅行者')).toBeVisible();

  // Submit and enter workspace
  await page.click('button:has-text("创建并进入工作室")');

  // 4. Verify Studio Workspace Shell
  await expect(page).toHaveURL(/\/apps\/activities\/[a-f0-9-]+/);
  await expect(page.getByText('海边露营自动化测试')).toBeVisible();
  await expect(page.getByText(/版本 1/)).toBeVisible();
  await expect(page.getByText(/草稿已就绪/)).toBeVisible();

  // 5. Test 4 Workstation Tabs
  // Tab 1: Records (Chat & Moments)
  await expect(page.getByRole('button', { name: /群聊记录/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /朋友圈动态/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /本阶段发生的事/ })).toBeVisible();

  // Tab 2: Settings & Stages
  await page.click('button:has-text("设定")');
  await expect(page.getByText('活动基本属性')).toBeVisible();
  await expect(page.getByText('活动阶段设定')).toBeVisible();

  // Tab 3: Media Workstation
  await page.click('button:has-text("素材")');
  await expect(page.getByText('图片与视频')).toBeVisible();
  await expect(page.getByRole('button', { name: '新增镜头' })).toBeVisible();

  // Tab 4: Playback & Preview
  await page.click('button:has-text("回放")');
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
  await page.getByRole('button', { name: '回放' }).click();
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
