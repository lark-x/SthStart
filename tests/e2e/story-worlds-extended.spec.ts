import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
/*
 * 作品工作台改版（分支上已确认的有意改动）：主标题为作品名，事件阅读 / 轨迹流 / 图像叙事留在
 * 「沙盒调试视图 (旧)」（?view=sandbox），运行设置收进「作品操作菜单」。
 */
const worldHeading = (page: Page) => page.getByRole('main').first().getByRole('heading', { level: 1 }).first();
async function openRunSettings(page: Page) {
  await page.getByRole('button', { name: '作品操作菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '沙盒引擎运行设置', exact: true }).click();
}


const service = 'http://127.0.0.1:4974';
const headers = { 'x-sthstart-admin-token': 'story-worlds-isolated-e2e-admin-token-4974' };
const api = '/api/v1/admin/story-worlds';
const output = resolve('artifacts/visual-verification/story-worlds');

interface ExtendedFixture {
  worldId: string;
  branchId: string;
  comparisonBranchId: string;
  mobileBranchId: string;
  performanceWorldId: string;
  performanceBranchId: string;
  performanceLine1Id?: string;
  performanceLine2Id?: string;
  uncertainWorldId: string;
  uncertainBranchId: string;
  uncertainRunId: string;
  uncertainCallId: string;
  projectId: string;
  calls: number;
}

async function fixture(request: APIRequestContext): Promise<ExtendedFixture> {
  const response = await request.get(service + '/__fixture');
  expect(response.ok()).toBe(true);
  return response.json();
}

async function auth(page: Page) {
  const session = await page.request.post('/api/auth/admin-session', {
    headers: { origin: 'http://127.0.0.1:4973' },
  });
  expect(session.ok()).toBe(true);
}

/** 步长与配图额度收在折叠区；按需展开，不假设默认展开状态。 */
async function ensureRunStepFields(dialog: Locator) {
  const step = dialog.getByLabel('单步时长（分钟）');
  if (await step.count() === 0 || !(await step.first().isVisible())) {
    await dialog.locator('details').filter({ hasText: '步长与配图额度' }).locator('summary').click();
  }
  await expect(dialog.getByLabel('单步时长（分钟）')).toBeVisible();
}

/** 高级设定默认收起；只在收起时展开，避免重复点击把已展开区域关掉。 */
async function ensureAdvancedSection(page: Page) {
  // 折叠按钮的可访问名包含副标题（“高级设定 时间、锁定事实……”），因此不能精确匹配。
  const toggle = page.getByRole('button', { name: /^高级设定/ });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/** 人物详细档案默认收起；填写性格/外貌/角色定位等字段前先展开。 */
async function openActorDetail(card: Locator) {
  const details = card.locator('details').filter({ hasText: /详细档案/ }).first();
  if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open))) {
    await details.locator('summary').first().click();
  }
  await expect(details).toHaveJSProperty('open', true);
  return details;
}

/*
 * 新建作品是两步（分支上已确认的有意改动）：快速新建只填作品名并生成待配置作品（setups 接口），
 * 详细设定在 /apps/story-worlds/:id/setup 补全，「完成配置」后才成为正式作品并建立主线。
 */
async function startWorkFromMenu(page: Page, title: string) {
  await page.getByRole('button', { name: '作品操作菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建作品', exact: true }).click();
  await page.waitForURL(/\/apps\/story-worlds\/new$/, { timeout: 20000 });
  await expect(page.getByRole('heading', { name: '新建作品', exact: true })).toBeVisible();
  const created = page.waitForResponse((r) => r.url().endsWith('/api/admin/story-worlds/setups') && r.request().method() === 'POST' && r.ok());
  await page.getByLabel(/^作品名称/).fill(title);
  await page.getByRole('button', { name: '创建作品', exact: true }).first().click();
  const pendingId = (await (await created).json() as { id: string }).id;
  await page.waitForURL(/\/apps\/story-worlds\?created=/, { timeout: 20000 });
  await page.goto(`/apps/story-worlds/${encodeURIComponent(pendingId)}/setup`);
  await expect(page.getByRole('heading', { name: '补全作品设定', exact: true })).toBeVisible();
  return pendingId;
}

/** 「完成配置」把待配置作品转为正式作品，回到工作台；返回服务端读回的作品与主线 ID。 */
async function completeSetup(page: Page, request: APIRequestContext, pendingId: string) {
  await page.getByRole('button', { name: '完成配置', exact: true }).click();
  await page.waitForURL(/\/apps\/story-worlds\?world=/, { timeout: 20000 });
  const url = new URL(page.url());
  expect(url.searchParams.get('world')).toBe(pendingId);
  const branchId = url.searchParams.get('branch');
  expect(branchId).toBeTruthy();
  const listResponse = await request.get(service + api, { headers });
  expect(listResponse.ok()).toBe(true);
  const world = (await listResponse.json()).items.find((item: { id: string }) => item.id === pendingId);
  expect(world).toBeTruthy();
  const branchResponse = await request.get(service + api + '/' + pendingId + '/branches/' + branchId, { headers });
  expect(branchResponse.ok()).toBe(true);
  const detail = await branchResponse.json();
  return { world, branch: detail.branch, definition: detail.definition, branchId: branchId! };
}

/** 设定页的地点不预置；第 index 个地点不存在时先添加。 */
async function locationCard(page: Page, index: number) {
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: '开场地点', exact: true }) });
  // 只数真正的地点卡：外层 section 还可能包含高级设定等其他 rounded-panel。
  const cards = section.locator('div.rounded-panel').filter({ has: page.getByLabel(/^地点名称/) });
  while (await cards.count() <= index) await page.getByRole('button', { name: '添加地点', exact: true }).click();
  return cards.nth(index);
}

/** 待配置作品的「名称与简介」默认收起；填写简介前先展开。 */
async function openOptionalSection(page: Page, title: string) {
  const details = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: title }) }).first();
  if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open))) {
    await details.locator('summary').first().click();
  }
  await expect(details).toHaveJSProperty('open', true);
}

/** 地点描述默认收起；填写前先展开该地点的描述折叠区。 */
async function openLocationDescription(card: Locator) {
  const details = card.locator('details').filter({ hasText: /地点描述|补充地点描述/ }).first();
  if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open))) {
    await details.locator('summary').first().click();
  }
  await expect(details).toHaveJSProperty('open', true);
  return details;
}

test.describe('Story Worlds Extended Verification', () => {
  test('1. create world and branch from list view', async ({ page, request }) => {
    const f = await fixture(request);
    await auth(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto(`/apps/story-worlds?world=${f.worldId}&branch=${f.branchId}&view=sandbox`);
    await expect(worldHeading(page)).toBeVisible();

    // 入口仍从作品操作菜单进入；快速新建后在设定页补全。
    const pendingId = await startWorkFromMenu(page, '林间工坊');
    await ensureAdvancedSection(page);
    await openOptionalSection(page, '名称与简介');
    await page.getByLabel(/^作品简介/).fill('工坊中研究自然生灵的日常。');
    await page.getByLabel(/^时间标签/).fill('谷雨');

    const firstLocation = await locationCard(page, 0);
    await firstLocation.getByLabel(/^地点名称/).fill('实验木屋');
    const locationDetail = await openLocationDescription(firstLocation);
    await locationDetail.getByLabel(/^地点描述/).fill('木屋里有晒干的草药和一张长桌。');

    // Add original character; detailed档案 fields require expanding the card.
    await page.getByRole('button', { name: '新建人物', exact: true }).first().click();
    const actorSection = page.locator('section').filter({
      has: page.getByRole('heading', { name: '登场人物', exact: true }),
    });
    const actorCard = actorSection.locator('div.rounded-panel').first();
    await actorCard.getByLabel(/^人物名称/).fill('白芷');
    await actorCard.getByLabel(/^处境/).fill('常驻工坊的草药学者。');
    const actorDetail = await openActorDetail(actorCard);
    await actorDetail.getByLabel(/^角色定位/).selectOption('main');
    await actorDetail.getByLabel(/^性格/).fill('安静、对植物格外有耐心。');
    await actorDetail.getByLabel(/^外貌/).fill('袖口沾着草汁，随身带一本标本册。');

    // 完成配置后同时得到正式作品和主线；原创作品的主线默认是平行改编。
    const bundle = await completeSetup(page, request, pendingId);
    expect(bundle.world.title).toBe('林间工坊');
    expect(bundle.world.summary).toBe('工坊中研究自然生灵的日常。');
    expect(bundle.branch.title).toBe('主线');
    expect(bundle.branch.mode).toBe('alternate');
    // 创建成功后必须不刷新就能在新作品下工作（列表缓存由页面更新）。
    await expect(worldHeading(page)).toHaveText('林间工坊');
    expect(bundle.definition.locations[0]).toMatchObject({
      name: '实验木屋', description: '木屋里有晒干的草药和一张长桌。',
    });
    expect(bundle.definition.actors[0]).toMatchObject({
      name: '白芷', role: 'main',
      background: '常驻工坊的草药学者。',
      personality: '安静、对植物格外有耐心。',
      appearance: '袖口沾着草汁，随身带一本标本册。',
    });

    // 平行分支在沙盒视图里创建并切换。
    await page.goto(`/apps/story-worlds?world=${pendingId}&branch=${bundle.branchId}&view=sandbox`);
    await expect(worldHeading(page)).toHaveText('林间工坊');

    // Create a new branch on the created world
    await page.getByRole('button', { name: '作品操作菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '新建平行分支', exact: true }).click();

    const branchDialog = page.getByRole('dialog', { name: '新建世界分支' });
    await expect(branchDialog).toBeVisible();

    await branchDialog.getByLabel('分支标题').fill('草药采集初记');
    await branchDialog.getByLabel('与原作的关系', { exact: true }).selectOption('canon-gap');
    await branchDialog.getByLabel('创作方向').fill('春季采集第一份标本。');

    const createBranchResponsePromise = page.waitForResponse(
      (r) => r.url().includes(`/branches`) && r.request().method() === 'POST',
    );
    await branchDialog.getByRole('button', { name: '创建分支', exact: true }).click();
    const createBranchResponse = await createBranchResponsePromise;
    expect(createBranchResponse.status()).toBe(201);
    await expect(branchDialog).not.toBeVisible();

    // Verify workspace now shows the branch and mode badge
    await expect(page.locator('.sw-canvas-title')).toHaveText('草药采集初记');
    await expect(page.locator('.sw-canvas-head').getByText('原作留白')).toBeVisible();
  });

  test('2. mobile viewport reading, filtering, event drawer, start and pause', async ({ page, request }) => {
    const seed = await fixture(request);
    const f = { ...seed, branchId: seed.mobileBranchId };
    await auth(page);
    await page.setViewportSize({ width: 390, height: 844 });

    // Open workspace directly in reading view
    await page.goto(`/apps/story-worlds?world=${f.worldId}&branch=${f.branchId}&view=reading`);
    await expect(worldHeading(page)).toBeVisible();

    // Verify mobile layout renders the reader
    // This spec owns its initial events and must not depend on the other spec.
    const current = await (await request.get(service + api + '/' + f.worldId + '/branches/' + f.branchId, { headers })).json();
    await request.post(service + api + '/' + f.worldId + '/branches/' + f.branchId + '/runs', { headers, data: {
      expectedRevision: current.branch.revision, idempotencyKey: 'extended-mobile-prepare',
      settings: { durationTicks: 60, stepTicks: 60, maxTextCalls: 40, maxImages: 0, autoImages: false },
    } });
    await expect.poll(async () => (await (await request.get(service + api + '/' + f.worldId + '/branches/' + f.branchId, { headers })).json()).run?.status, { timeout: 25000 }).toBe('completed');
    await page.reload();
    await expect(page.getByRole('tab', { name: /事件阅读/ })).toBeVisible();
    await expect(page.getByText('港口的重逢').first()).toBeVisible();

    // Test mobile actor filter navigation pills
    const actorPill = page.locator('.sw-reader').getByRole('button', { name: /林舟/ }).first();
    await expect(actorPill).toBeVisible();
    await actorPill.click();

    // Ensure the reading view responds to actor filtering
    await expect(page.getByText('林舟的清晨').first()).toBeVisible();

    // Reset actor filter
    const allPill = page.getByRole('button', { name: /全部事件长卷/ });
    await allPill.click();

    // Test clicking event to open mobile bottom detail drawer
    const eventCardTitle = page.getByRole('button', { name: '港口的重逢' }).first();
    await eventCardTitle.click();

    // Drawer titled '事件详情' should open from bottom on mobile
    const detailDrawer = page.getByRole('dialog', { name: '事件详情' });
    await expect(detailDrawer).toBeVisible();
    await expect(detailDrawer.getByText(/码头相遇/)).toBeVisible();

    // Close the drawer
    await detailDrawer.getByRole('button', { name: '关闭抽屉' }).click();
    await expect(detailDrawer).not.toBeVisible();

    // Test Start and Pause run with controllable fixture delay
    await request.post(service + '/__fixture/delay', { data: { ms: 1200 } });

    await openRunSettings(page);
    const runDialog = page.getByRole('dialog', { name: '运行设置' });
    await expect(runDialog).toBeVisible();

    await runDialog.getByLabel('推进时长（分钟）').fill('60');
    await ensureRunStepFields(runDialog);
    await runDialog.getByLabel('单步时长（分钟）').fill('60');
    await runDialog.getByLabel('文本调用硬额度').fill('40');
    await runDialog.getByRole('button', { name: '启动运行', exact: true }).click();
    await expect(runDialog).not.toBeVisible();

    // Runbar should show running/queued status and pause button in mobile view
    const pauseButton = page.locator('.sw-runbar-actions').getByRole('button', { name: '暂停' });
    await expect(pauseButton).toBeVisible({ timeout: 10000 });
    await pauseButton.click();

    // Assert paused state reached
    await expect(page.locator('.sw-runbar-main').getByText('已暂停')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.sw-runbar-actions').getByRole('button', { name: '恢复' })).toBeVisible();

    // Reset delay back to normal
    await request.post(service + '/__fixture/delay', { data: { ms: 30 } });
  });

  test('3. side-by-side branch comparison operations', async ({ page, request }) => {
    const f = await fixture(request);
    await auth(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto(`/apps/story-worlds?world=${f.worldId}&branch=${f.branchId}&view=sandbox`);
    await expect(worldHeading(page)).toBeVisible();

    // Open branch comparison dialog from canvas actions
    const compareButton = page.getByRole('button', { name: '比较', exact: true });
    await expect(compareButton).toBeVisible();
    await compareButton.click();

    const compareDialog = page.getByRole('dialog', { name: '并排比较分支' });
    await expect(compareDialog).toBeVisible();

    // Left branch defaults to current branch; select right branch to comparison branch
    await compareDialog.getByLabel('右侧分支').selectOption(f.comparisonBranchId);

    // Verify side-by-side branch columns
    await expect(compareDialog.getByRole('heading', { name: '归航主线', exact: true })).toBeVisible();
    await expect(compareDialog.getByRole('heading', { name: '海潮平行线', exact: true })).toBeVisible();

    // Verify branch tags/badges respect canonical blank vs parallel world
    await expect(compareDialog.getByText('原作留白').first()).toBeVisible();
    await expect(compareDialog.getByText('平行世界').first()).toBeVisible();

    // Verify right branch displays its distinct independent events
    await expect(compareDialog.getByText('平行世界的雾气')).toBeVisible();
    await expect(compareDialog.getByText('海面上弥漫着未曾见过的浓雾。')).toBeVisible();

    // Test selection guard when selecting same branch on both sides
    await compareDialog.getByLabel('右侧分支').selectOption(f.branchId);
    await expect(compareDialog.getByText('请选择两个不同分支')).toBeVisible();

    // Close the dialog
    await compareDialog.getByRole('button', { name: '关闭对话框' }).click();
    await expect(compareDialog).not.toBeVisible();
  });

  test('4. text unknown recovery dialog with mandatory human evidence', async ({ page, request }) => {
    const f = await fixture(request);
    await auth(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    // Navigate to the pre-seeded branch with an uncertain run
    await page.goto(`/apps/story-worlds?world=${f.uncertainWorldId}&branch=${f.uncertainBranchId}&view=sandbox`);
    await expect(worldHeading(page)).toBeVisible();

    // Runbar should display uncertain status badge and recovery button
    await expect(page.locator('.sw-runbar-main').getByText('结果不明')).toBeVisible();
    await expect(page.getByText('模型调用结果不明，已停止派发；核对成功前不会重放。')).toBeVisible();

    const recoverButton = page.getByRole('button', { name: '处理异常调用', exact: true });
    await expect(recoverButton).toBeVisible();
    await recoverButton.click();

    const recoveryDialog = page.getByRole('dialog', { name: '推进异常调用恢复' });
    await expect(recoveryDialog).toBeVisible();

    // Verify rule constraint alert is prominently shown
    await expect(recoveryDialog.getByText('不可自动重试约束')).toBeVisible();

    // Verify call information is presented
    await expect(recoveryDialog.getByText(`调用 ID: ${f.uncertainCallId}`)).toBeVisible();
    await expect(recoveryDialog.getByText('模型调用结果不明。请核对供应商记录或已经收到的原始响应。')).toBeVisible();

    // Test validation constraint: submitting without evidence must be rejected
    await recoveryDialog.getByRole('button', { name: '提交人工决议', exact: true }).click();
    expect(await recoveryDialog.getByLabel('核查证据').evaluate((node: HTMLTextAreaElement) => node.validity.valueMissing)).toBe(true);

    // Fill valid evidence
    await recoveryDialog.getByLabel('核查证据').fill(
      '测试核查凭据：经平台控制台 TraceID 审查与调用日志核对，该请求触发 524 超时未实际到达模型，上游无计费。',
    );

    // Submit resolution (default: not-executed)
    const resolveResponsePromise = page.waitForResponse(
      (r) => r.url().includes(`/recovery/${f.uncertainCallId}`) && r.request().method() === 'POST',
    );
    await recoveryDialog.getByRole('button', { name: '提交人工决议', exact: true }).click();
    const resolveResponse = await resolveResponsePromise;
    expect(resolveResponse.status()).toBe(200);

    // Verify success confirmation card
    await expect(recoveryDialog.getByText(/当前运行没有挂起的不明调用/)).toBeVisible();
    const restored = await (await request.get(service + api + '/' + f.uncertainWorldId + '/branches/' + f.uncertainBranchId, { headers })).json();
    expect(restored.run.status).toBe('paused');

    // Close dialog
    await recoveryDialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(recoveryDialog).not.toBeVisible();
  });

  test('5. 12 actors 1000 events: character filter, storyline filter, time window, pan/zoom, mobile reading and pause', async ({ page, request }) => {
    test.setTimeout(90000);
    const f = await fixture(request);
    await auth(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    // Step A: Load the 12-actors 1000-events performance branch
    const tLoadStart = performance.now();
    await page.goto(`/apps/story-worlds?world=${f.performanceWorldId}&branch=${f.performanceBranchId}&view=sandbox`);
    await expect(worldHeading(page)).toBeVisible();
    await expect(page.locator('.sw-canvas-title')).toHaveText('一千段经历');
    const loadDuration = performance.now() - tLoadStart;
    test.info().annotations.push({
      type: 'timing',
      description: `12-actors-1000-events ready in ${loadDuration.toFixed(1)}ms (local verification only)`,
    });
    // Lenient upper bound verifying local capability without claiming fixed SLA
    expect(loadDuration).toBeLessThan(15000);

    // Step B: Time Window (时间窗口)
    const fromInput = page.locator('.sw-rail-left').getByLabel('从', { exact: true });
    const toInput = page.locator('.sw-rail-left').getByLabel('到', { exact: true });
    await expect(fromInput).toBeVisible();
    await expect(toInput).toBeVisible();

    const tWindowStart = performance.now();
    const windowEventsPromise = page.waitForResponse(
      (r) => r.url().includes('/events?') && r.url().includes('from=100') && r.url().includes('to=300') && r.status() === 200,
    );
    await fromInput.fill('100');
    await toInput.fill('300');
    const windowEventsRes = await windowEventsPromise;
    const windowBody = await windowEventsRes.json();
    expect(windowBody.items.length).toBeGreaterThan(0);
    expect(windowBody.items.every((e: { tick: number }) => e.tick >= 100 && e.tick <= 300)).toBe(true);
    await expect(page.locator('.sw-event-row').first()).toBeVisible();
    const windowFilterDuration = performance.now() - tWindowStart;
    test.info().annotations.push({
      type: 'timing',
      description: `time-window filter 100~300 applied in ${windowFilterDuration.toFixed(1)}ms`,
    });
    expect(windowFilterDuration).toBeLessThan(10000);

    // Reset time window back to full
    await page.locator('.sw-rail-left').getByRole('button', { name: '全部', exact: true }).click();
    await expect(fromInput).toHaveValue('0');
    await expect(toInput).toHaveValue('1440');

    // Step C: Character Filter (角色筛选)
    const actorSelect = page.getByRole('combobox', { name: '人物' });
    await expect(actorSelect).toBeVisible();
    const tActorStart = performance.now();
    const actorEventsPromise = page.waitForResponse(
      (r) => r.url().includes('/events?') && r.url().includes('actorId=actor-0') && r.status() === 200,
    );
    await actorSelect.selectOption('actor-0');
    const actorEventsRes = await actorEventsPromise;
    const actorEventsBody = await actorEventsRes.json();
    expect(actorEventsBody.items.length).toBeGreaterThan(0);
    expect(actorEventsBody.items.every((e: { participantIds: string[] }) => e.participantIds.includes('actor-0'))).toBe(true);
    await expect(page.locator('.sw-event-row').first()).toBeVisible();
    const actorFilterDuration = performance.now() - tActorStart;
    test.info().annotations.push({
      type: 'timing',
      description: `character filter actor-0 applied in ${actorFilterDuration.toFixed(1)}ms`,
    });
    expect(actorFilterDuration).toBeLessThan(8000);

    // Reset character filter
    await actorSelect.selectOption('');
    await expect(actorSelect).toHaveValue('');

    // Step D: Storyline Filter (故事线筛选)
    const storyLineSelect = page.getByRole('combobox', { name: '故事线' });
    await expect(storyLineSelect).toBeVisible();
    const targetLineId = f.performanceLine1Id!;
    expect(targetLineId).toBeTruthy();

    const tLineStart = performance.now();
    const lineEventsPromise = page.waitForResponse(
      (r) => r.url().includes('/events?') && r.url().includes(`storyLineId=${targetLineId}`) && r.status() === 200,
    );
    await storyLineSelect.selectOption(targetLineId);
    const lineEventsRes = await lineEventsPromise;
    const lineEventsBody = await lineEventsRes.json();
    expect(lineEventsBody.items.length).toBeGreaterThan(0);
    expect(lineEventsBody.items.every((e: { storyLineIds: string[] }) => e.storyLineIds.includes(targetLineId))).toBe(true);
    await expect(page.locator('.sw-event-row').first()).toBeVisible();
    const lineFilterDuration = performance.now() - tLineStart;
    test.info().annotations.push({
      type: 'timing',
      description: `storyline filter ${targetLineId} applied in ${lineFilterDuration.toFixed(1)}ms`,
    });
    expect(lineFilterDuration).toBeLessThan(8000);

    // Reset storyline filter
    await storyLineSelect.selectOption('');
    await expect(storyLineSelect).toHaveValue('');

    // Step E: Pan and Zoom (平移与缩放)
    await page.getByRole('tab', { name: /沙盒轨迹流/ }).click();
    await expect(page.locator('.react-flow')).toBeVisible();
    await expect(page.locator('.react-flow__node').first()).toBeVisible();

    // Zoom test
    const tZoomStart = performance.now();
    const transformBeforeZoom = await page.locator('.react-flow__viewport').getAttribute('style');
    await page.getByRole('button', { name: '放大', exact: true }).click();
    await expect(page.locator('.react-flow__viewport')).not.toHaveAttribute('style', transformBeforeZoom!);
    const zoomDuration = performance.now() - tZoomStart;
    test.info().annotations.push({
      type: 'timing',
      description: `canvas zoom action in ${zoomDuration.toFixed(1)}ms`,
    });
    expect(zoomDuration).toBeLessThan(5000);

    // Pan test
    const tPanStart = performance.now();
    const transformBeforePan = await page.locator('.react-flow__viewport').getAttribute('style');
    const pane = page.locator('.react-flow__pane');
    const box = await pane.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 - 150, box!.y + box!.height / 2 - 40);
    await page.mouse.up();
    await expect(page.locator('.react-flow__viewport')).not.toHaveAttribute('style', transformBeforePan!);
    const panDuration = performance.now() - tPanStart;
    test.info().annotations.push({
      type: 'timing',
      description: `canvas pan drag in ${panDuration.toFixed(1)}ms`,
    });
    expect(panDuration).toBeLessThan(5000);

    // Step F: Mobile Viewport Reading & Event Drawer (移动阅读与事件详情)
    await page.setViewportSize({ width: 390, height: 844 });
    const tMobileReadStart = performance.now();
    await page.getByRole('tab', { name: /事件阅读/ }).click();
    await expect(page.locator('.sw-reader')).toBeVisible();
    const firstEventButton = page.locator('.sw-reader article h2 button').first();
    await expect(firstEventButton).toBeVisible();
    const mobileReadDuration = performance.now() - tMobileReadStart;
    test.info().annotations.push({
      type: 'timing',
      description: `mobile reading view ready in ${mobileReadDuration.toFixed(1)}ms`,
    });
    expect(mobileReadDuration).toBeLessThan(8000);

    // Mobile actor navigation pill
    const tMobileActorStart = performance.now();
    const actorPill = page.locator('.sw-reader').getByRole('button', { name: /林舟/ }).first();
    await expect(actorPill).toBeVisible();
    await actorPill.click();
    await expect(page.locator('.sw-reader article').first()).toBeVisible();
    const mobileActorDuration = performance.now() - tMobileActorStart;
    test.info().annotations.push({
      type: 'timing',
      description: `mobile actor pill navigation in ${mobileActorDuration.toFixed(1)}ms`,
    });
    expect(mobileActorDuration).toBeLessThan(5000);

    // Reset mobile actor filter
    const allPill = page.locator('.sw-reader').getByRole('button', { name: /全部事件长卷/ });
    await allPill.click();

    // Mobile event drawer click
    const tDrawerStart = performance.now();
    await firstEventButton.click();
    const detailDrawer = page.getByRole('dialog', { name: '事件详情' });
    await expect(detailDrawer).toBeVisible();
    await expect(detailDrawer.getByText(/日常/).first()).toBeVisible();
    const drawerDuration = performance.now() - tDrawerStart;
    test.info().annotations.push({
      type: 'timing',
      description: `mobile bottom event drawer opened in ${drawerDuration.toFixed(1)}ms`,
    });
    expect(drawerDuration).toBeLessThan(5000);

    // Close drawer
    await detailDrawer.getByRole('button', { name: '关闭抽屉' }).click();
    await expect(detailDrawer).not.toBeVisible();

    // Step G: Mobile Start & Pause on the Same Performance Branch using fixture fake provider
    // Using fixture fake provider explicitly, not upstream model
    await request.post(service + '/__fixture/delay', { data: { ms: 600 } });

    await openRunSettings(page);
    const runDialog = page.getByRole('dialog', { name: '运行设置' });
    await expect(runDialog).toBeVisible();

    await runDialog.getByLabel('推进时长（分钟）').fill('60');
    await ensureRunStepFields(runDialog);
    await runDialog.getByLabel('单步时长（分钟）').fill('60');
    await runDialog.getByLabel('文本调用硬额度').fill('40');
    await runDialog.getByRole('button', { name: '启动运行', exact: true }).click();
    await expect(runDialog).not.toBeVisible();

    // Locate pause button in mobile runbar actions
    const pauseButton = page.locator('.sw-runbar-actions').getByRole('button', { name: '暂停' });
    await expect(pauseButton).toBeVisible({ timeout: 10000 });
    const tPauseStart = performance.now();
    await pauseButton.click();

    // Assert paused status reached
    await expect(page.locator('.sw-runbar-main').getByText('已暂停')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.sw-runbar-actions').getByRole('button', { name: '恢复' })).toBeVisible();
    const pauseReachDuration = performance.now() - tPauseStart;
    test.info().annotations.push({
      type: 'timing',
      description: `mobile pause transition completed in ${pauseReachDuration.toFixed(1)}ms`,
    });
    expect(pauseReachDuration).toBeLessThan(15000);

    // Reset fixture delay to normal
    await request.post(service + '/__fixture/delay', { data: { ms: 30 } });
  });

  test('6. world form keeps start minute and scene/prop references on create and read', async ({ page, request }) => {
    const f = await fixture(request);
    await auth(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/apps/story-worlds?world=' + f.worldId + '&branch=' + f.branchId + '&view=sandbox');
    await expect(worldHeading(page)).toBeVisible();

    const pendingId = await startWorkFromMenu(page, '港口时辰与道具参考');
    await ensureAdvancedSection(page);
    await openOptionalSection(page, '名称与简介');
    await page.getByLabel(/^作品简介/).fill('验证世界起点时刻与场景道具参考的保存与读取。');
    await page.getByLabel(/^时间标签/).fill('谷雨');
    // 结构字段：08:00 必须保存为日内分钟 480，而不是自由文本。
    await page.getByLabel(/^起点时刻/).fill('08:00');

    const stoneForest = await locationCard(page, 0);
    await stoneForest.getByLabel(/^地点名称/).fill('孤云石林');
    await (await openLocationDescription(stoneForest)).getByLabel(/^地点描述/).fill('灰白石柱间终年有雾。');
    const harborCard = await locationCard(page, 1);
    await harborCard.getByLabel(/^地点名称/).fill('港口');
    await (await openLocationDescription(harborCard)).getByLabel(/^地点描述/).fill('三号码头、系船柱与吊机。');

    await page.getByRole('button', { name: '新建人物', exact: true }).first().click();
    const actorSection = page.locator('section').filter({
      has: page.getByRole('heading', { name: '登场人物', exact: true }),
    });
    const firstActor = actorSection.locator('div.rounded-panel').first();
    await firstActor.getByLabel(/^人物名称/).fill('林舟');
    await firstActor.getByLabel(/^处境/).fill('在港口记录潮汐的旅人。');
    const firstActorDetail = await openActorDetail(firstActor);
    await firstActorDetail.getByLabel(/^角色定位/).selectOption('main');
    await firstActorDetail.getByLabel(/^性格/).fill('沉默，习惯先记录再开口。');
    await firstActorDetail.getByLabel(/^外貌/).fill('深蓝防水外套，袖口有盐渍。');

    // “画面”FormSection 嵌在“高级设定”section 内，祖先与自身都可能命中，取最内层。
    const visualReferences = page.locator('section')
      .filter({ has: page.getByRole('heading', { name: '画面', exact: true }) }).last();
    await visualReferences.getByRole('button', { name: '添加场景锚点', exact: true }).click();
    await visualReferences.getByRole('textbox', { name: /^名称/ }).first().fill('港口锚点');
    await visualReferences.getByLabel(/^对应地点/).first().selectOption({ label: '港口' });
    await visualReferences.getByLabel(/^画面说明/).first().fill('三号码头、系船柱与吊机的固定位置关系。');

    await visualReferences.getByRole('button', { name: '添加道具参考', exact: true }).click();
    await visualReferences.getByRole('textbox', { name: /^名称/ }).nth(1).fill('黄铜灯');
    await visualReferences.getByLabel(/^画面说明/).nth(1).fill('提手缠旧布条，灯罩有缺口。');

    // 参考素材只能从真实媒体库勾选；空库时必须明确说明，而不是手填 ID。
    await visualReferences.getByRole('button', { name: '选择参考素材', exact: true }).first().click();
    const mediaDialog = page.getByRole('dialog', { name: '选择参考素材' });
    await expect(mediaDialog).toBeVisible();
    await expect(mediaDialog.getByText(/从媒体库选择参考素材，最多 10 个/)).toBeVisible();
    await expect(mediaDialog.getByRole('heading', { name: '没有匹配的媒体', exact: true })).toBeVisible();
    await expect(mediaDialog.getByText(/媒体库还是空的/)).toBeVisible();
    await mediaDialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(mediaDialog).not.toBeVisible();
    await expect(visualReferences.getByText('最多 10 个；只保存素材 ID。').first()).toBeVisible();

    const bundle = await completeSetup(page, request, pendingId);
    const created = bundle.world;
    expect(bundle.branch.title).toBe('主线');

    expect(created.startMinuteOfDay).toBe(480);
    expect(created.visualReferences).toHaveLength(2);
    const harbor = created.locations.find((location: { name: string }) => location.name === '港口');
    expect(harbor).toBeTruthy();
    expect(created.visualReferences[0]).toMatchObject({
      name: '港口锚点', kind: 'location', locationId: harbor.id,
      description: '三号码头、系船柱与吊机的固定位置关系。',
      referenceArtifactIds: [],
    });
    expect(created.visualReferences[1]).toMatchObject({
      name: '黄铜灯', kind: 'prop',
      description: '提手缠旧布条，灯罩有缺口。',
      referenceArtifactIds: [],
    });

    // 服务端独立读取：列表响应保留结构时刻和两条场景/道具参考。
    const listResponse = await request.get(service + api, { headers });
    expect(listResponse.ok()).toBe(true);
    const persisted = (await listResponse.json()).items.find((item: { id: string }) => item.id === created.id);
    expect(persisted).toBeTruthy();
    expect(persisted.startMinuteOfDay).toBe(480);
    expect(persisted.visualReferences.map((reference: { name: string }) => reference.name))
      .toEqual(['港口锚点', '黄铜灯']);

    // 重新加载并打开编辑页：UI 读回必须仍是 08:00 和同两条参考。
    await page.goto('/apps/story-worlds/' + created.id + '/edit?branch=' + bundle.branchId);
    await expect(page.getByRole('heading', { name: '作品设定', exact: true })).toBeVisible();
    await ensureAdvancedSection(page);
    await expect(page.getByLabel(/^起点时刻/)).toHaveValue('08:00');

    const editVisualReferences = page.locator('section')
      .filter({ has: page.getByRole('heading', { name: '画面', exact: true }) }).last();
    await expect(editVisualReferences.getByRole('textbox', { name: /^名称/ }).first()).toHaveValue('港口锚点');
    await expect(editVisualReferences.getByRole('textbox', { name: /^名称/ }).nth(1)).toHaveValue('黄铜灯');
    await expect(editVisualReferences.getByLabel(/^类型/).first()).toHaveValue('location');
    await expect(editVisualReferences.getByLabel(/^类型/).nth(1)).toHaveValue('prop');
    await expect(editVisualReferences.getByLabel(/^对应地点/).first()).toHaveValue(harbor.id);
    await expect(editVisualReferences.getByLabel(/^画面说明/).first()).toHaveValue('三号码头、系船柱与吊机的固定位置关系。');

    // 编辑态原样保存一次，验证 PUT 往返不会丢失结构时刻或两条参考。
    const updateResponsePromise = page.waitForResponse(
      (r) => r.url().endsWith('/story-worlds/' + created.id) && r.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: '保存全部', exact: true }).first().click();
    const updateResponse = await updateResponsePromise;
    expect(updateResponse.status()).toBe(200);
    const updated = await updateResponse.json();
    expect(updated.startMinuteOfDay).toBe(480);
    expect(updated.visualReferences).toHaveLength(2);
    expect(updated.visualReferences.map((reference: { name: string }) => reference.name))
      .toEqual(['港口锚点', '黄铜灯']);
    await expect(page.getByRole('status').filter({ hasText: /^已保存$/ })).toBeVisible();

    // 390 窄屏：直接进入编辑页，展开高级设定与参考区并留证。
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/apps/story-worlds/' + created.id + '/edit?branch=' + bundle.branchId);
    await expect(page.getByRole('heading', { name: '作品设定', exact: true })).toBeVisible();
    await ensureAdvancedSection(page);
    mkdirSync(output, { recursive: true });
    await expect(page.getByLabel(/^起点时刻/)).toHaveValue('08:00');
    await page.screenshot({ path: resolve(output, 'world-form-390.png'), fullPage: true });

    // 展开参考区并滚到首条参考，留一张可核对场景/道具行的 390 截图。
    const mobileVisualReferences = page.locator('section')
      .filter({ has: page.getByRole('heading', { name: '画面', exact: true }) }).last();
    const firstReferenceName = mobileVisualReferences.getByRole('textbox', { name: /^名称/ }).first();
    await expect(firstReferenceName).toHaveValue('港口锚点');
    await firstReferenceName.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, 'world-form-390-references.png'), fullPage: true });
    test.info().annotations.push({
      type: 'screenshot',
      description: '390px world form start minute and expanded references (artifacts/visual-verification/story-worlds/world-form-390.png, world-form-390-references.png)',
    });
  });
});
