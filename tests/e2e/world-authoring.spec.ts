import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  StoryWorld,
  WorldAuthoringDraft,
  WorldBranchDetail,
  WorldSuggestionResponse,
} from '@sthstart/contracts';

const service = 'http://127.0.0.1:4984';
const portal = 'http://127.0.0.1:4983';
const token = 'story-worlds-isolated-e2e-admin-token-4974';
const adminHeaders = { 'x-sthstart-admin-token': token };
const api = '/api/v1/admin/story-worlds';
const output = resolve('artifacts/visual-verification/world-authoring');

interface FixtureState {
  suggestionCalls: number;
  searchCalls: number;
  extractCalls: number;
  models: string[];
  searchQueries: string[];
  extractUrls: string[][];
  hosts: string[];
  rejected: string[];
}

interface SeededWorld {
  worldId: string;
  branchId: string;
}

async function auth(page: Page) {
  const session = await page.request.post('/api/auth/admin-session', { headers: { origin: portal } });
  expect(session.ok()).toBe(true);
}

async function fixtureState(request: APIRequestContext): Promise<FixtureState> {
  const response = await request.get(`${service}/__fixture`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<FixtureState>;
}

async function resetFixture(request: APIRequestContext) {
  const response = await request.post(`${service}/__fixture/reset`);
  expect(response.ok()).toBe(true);
}

async function branchDetail(request: APIRequestContext, worldId: string, branchId: string) {
  const response = await request.get(`${service}${api}/${worldId}/branches/${branchId}`, { headers: adminHeaders });
  expect(response.ok()).toBe(true);
  return response.json() as Promise<WorldBranchDetail>;
}

async function worldDetail(request: APIRequestContext, worldId: string): Promise<StoryWorld> {
  const response = await request.get(`${service}${api}/${worldId}`, { headers: adminHeaders });
  expect(response.ok()).toBe(true);
  return (await response.json() as { world: StoryWorld }).world;
}

async function checkCheckbox(box: Locator) {
  if (await box.isChecked()) return;
  await box.focus();
  await box.press('Space');
  await expect(box).toBeChecked();
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

/** 人物详细档案默认收起；填写定位/性格等字段前先展开。 */
async function openActorDetail(card: Locator) {
  const details = card.locator('details').filter({ hasText: /详细档案/ }).first();
  if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open))) {
    await details.locator('summary').first().click();
  }
  await expect(details).toHaveJSProperty('open', true);
  return details;
}

function draft(overrides: Partial<WorldAuthoringDraft['definition']> = {}): WorldAuthoringDraft {
  return {
    definition: {
      title: '雾港纪事',
      summary: '退潮后的港口靠一本公开的潮汐记录维持出海秩序。'.repeat(12),
      timeLabel: '第三次退潮 · 雨季',
      locations: [
        { id: 'harbor', name: '港口', description: '石阶、盐渍与一排系船桩。' },
        { id: 'lighthouse', name: '旧灯塔', description: '潮位刻度墙与只亮一盏的灯室。' },
      ],
      visualReferences: [],
      actors: [
        {
          id: 'actor-lin', name: '林舟', role: 'main',
          characterId: null, characterVersion: null,
          background: '在港口长大，负责每天第一次水位校准。',
          personality: '克制、耐心', speechStyle: '句子短，常引用潮位。',
          appearance: '深蓝防水外套', goals: ['把本月潮汐记录整理成册'],
          locationId: 'harbor', referenceArtifactIds: [],
        },
      ],
      sources: [
        {
          id: 'source-setting', title: '港口设定', nature: 'author',
          content: '港口以两次水位校准决定出海窗口，记录册公开可查。'.repeat(6),
          sourceUrl: '', sourceVersion: '1', capturedAt: new Date().toISOString(),
        },
      ],
      lockedFacts: ['潮汐记录公开可查'],
      models: { action: null, adjudication: null, narration: null },
      visualStyle: '日式动画赛璐璐画风，潮湿石材与冷灰海雾。',
      ...overrides,
    },
    initialBranch: { title: '主线', mode: 'canon-gap', direction: '从一次异常低潮开始。' },
  };
}

async function seedWorld(request: APIRequestContext, overrides: Partial<WorldAuthoringDraft['definition']> = {}) {
  const response = await request.post(`${service}${api}/create-bundle`, {
    headers: adminHeaders,
    data: {
      idempotencyKey: `world-authoring-${crypto.randomUUID()}`,
      definition: draft(overrides).definition,
      initialBranch: { title: '主线', mode: 'canon-gap', direction: '从一次异常低潮开始。' },
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json() as { world: { id: string }; branch: { id: string } };
  return { worldId: body.world.id, branchId: body.branch.id } satisfies SeededWorld;
}

test('creates a name-only pending world and completes it without auto-running', async ({ page, request }) => {
  const pageErrors: string[] = [];
  const runRequests: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (req) => { if (req.method() === 'POST' && /\/runs(\?|$)/.test(req.url())) runRequests.push(req.url()); });
  await auth(page);

  await page.goto('/apps/story-worlds/new');
  await expect(page.getByRole('heading', { name: '新建世界', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '开场地点' })).toHaveCount(0);
  await page.getByLabel(/^世界名称/).fill('雾港纪事');
  await page.getByRole('button', { name: '创建世界', exact: true }).click();
  await expect(page.getByRole('button', { name: '补全设定' })).toBeVisible();
  const pendingId = new URL(page.url()).searchParams.get('world');
  await page.reload();
  await expect(page.getByRole('button', { name: '补全设定' })).toBeVisible();
  await expect(page.getByRole('button', { name: '启动运行', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '补全设定' }).click();
  await page.getByRole('button', { name: '添加地点' }).click();
  const locationCard = page.locator('section').filter({
    has: page.getByRole('heading', { name: '开场地点', exact: true }),
  }).locator('div.rounded-panel').first();
  await locationCard.getByLabel(/^地点名称/).fill('港口');
  await (await openLocationDescription(locationCard))
    .getByLabel(/^地点描述/)
    .fill('石阶一直延伸到水面，系船桩上挂着盐霜。');
  await page.getByRole('button', { name: '保存设定', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^已保存$/ }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/^地点名称/)).toHaveValue('港口');
  await page.getByRole('button', { name: 'AI 候选', exact: true }).click();
  const ai = page.getByRole('dialog', { name: '生成设定建议' });
  await ai.getByLabel(/^创作要求/).fill('描写雾中的港口');
  await ai.getByRole('button', { name: '关闭抽屉' }).click();
  await page.getByRole('button', { name: 'AI 候选', exact: true }).click();
  await expect(ai.getByLabel(/^创作要求/)).toHaveValue('描写雾中的港口');
  await ai.getByRole('button', { name: '关闭抽屉' }).click();
  await page.getByRole('button', { name: '新建人物', exact: true }).click();
  const actorCard = page.locator('section').filter({
    has: page.getByRole('heading', { name: '登场人物', exact: true }),
  }).locator('div.rounded-panel').first();
  await actorCard.getByLabel(/^人物名称/).fill('林舟');
  const actorDetail = await openActorDetail(actorCard);
  await actorDetail.getByLabel(/^角色定位/).selectOption('main');
  await page.getByRole('button', { name: '完成配置', exact: true }).click();
  await page.waitForURL(/\/apps\/story-worlds\?world=/, { timeout: 20_000 });
  const url = new URL(page.url());
  const worldId = url.searchParams.get('world');
  expect(worldId).toBe(pendingId);
  const branchId = url.searchParams.get('branch');
  expect(worldId).toBeTruthy();
  expect(branchId).toBeTruthy();

  const detail = await branchDetail(request, worldId!, branchId!);
  expect(detail.definition.locations).toHaveLength(1);
  expect(detail.definition.locations[0].name).toBe('港口');
  expect(detail.definition.locations[0].description).toBe('石阶一直延伸到水面，系船桩上挂着盐霜。');
  expect(detail.definition.actors).toHaveLength(1);
  expect(detail.definition.actors[0]).toMatchObject({ name: '林舟', role: 'main', locationId: detail.definition.locations[0].id });
  expect(detail.branch.title).toBe('主线');
  expect(detail.branch.mode).toBe('canon-gap');
  expect(detail.branch.currentTick).toBe(0);
  expect(detail.run).toBeNull();
  expect(detail.images).toHaveLength(0);

  const events = await request.get(`${service}${api}/${worldId}/branches/${branchId}/events`, { headers: adminHeaders });
  expect(events.ok()).toBe(true);
  expect((await events.json()).total).toBe(0);
  expect(runRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('compact creation, pending configuration and appearance preview fit desktop and phone widths', async ({ page }, info) => {
  await auth(page);
  mkdirSync(output, { recursive: true });
  await page.addInitScript(() => {
    localStorage.setItem('sthstart_nav_collapsed', 'false');
    localStorage.setItem('sthstart_theme_id', 'light-paper');
  });
  const sizes = [
    { width: 1920, height: 1080 }, { width: 1440, height: 900 },
    { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 720 },
  ];
  const capture = async (name: string) => {
    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${name} at ${size.width}`).toBeLessThanOrEqual(1);
      await page.screenshot({ path: resolve(output, `${info.project.name}-${name}-${size.width}.png`), animations: 'disabled' });
    }
  };
  await page.goto('/apps/story-worlds/new');
  await expect(page.getByRole('heading', { name: '新建世界', exact: true })).toBeVisible();
  await capture('quick-create');
  await page.getByLabel(/^世界名称/).fill('海边小镇');
  await page.getByRole('button', { name: '创建世界', exact: true }).click();
  await page.getByRole('button', { name: '补全设定', exact: true }).click();
  await expect(page.getByRole('heading', { name: '补全设定', exact: true })).toBeVisible();
  await expect(page.getByLabel(/^世界简介/)).toBeHidden();
  await expect(page.getByLabel(/^创作要求/)).toBeHidden();
  await capture('pending-setup');
  await page.goto('/settings/appearance');
  await expect(page.getByRole('heading', { name: '外观', exact: true })).toBeVisible();
  await capture('appearance');
  await page.getByRole('button', { name: '预览手账贴纸', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '预览：手账贴纸' })).toBeVisible();
  await capture('skin-preview');
});

test('restores an unsaved new-world draft after refresh and discards it on request', async ({ page }) => {
  await auth(page);
  await page.goto('/apps/story-worlds/new');
  await page.evaluate((values) => sessionStorage.setItem('sthstart:story-worlds:draft:create',
    JSON.stringify({ version: 1, isDirty: true, updatedAt: Date.now(), idempotencyKey: 'legacy-draft', values })), draft({ actors: [] }));
  await page.reload();
  await page.getByRole('button', { name: '继续旧草稿' }).click();
  await page.getByLabel(/^世界名称/).fill('雾港草稿');
  const draftLocation = page.locator('section').filter({
    has: page.getByRole('heading', { name: '开场地点', exact: true }),
  }).locator('div.rounded-panel').first();
  await draftLocation.getByLabel(/^地点名称/).fill('旧码头');
  await (await openLocationDescription(draftLocation))
    .getByLabel(/^地点描述/)
    .fill('涨潮时会没过第三级台阶。');
  await page.getByRole('button', { name: '新建人物', exact: true }).click();
  const draftActor = page.locator('section').filter({
    has: page.getByRole('heading', { name: '登场人物', exact: true }),
  }).locator('div.rounded-panel').first();
  await draftActor.getByLabel(/^人物名称/).fill('阿澜');
  await draftActor.getByLabel(/^处境/).fill('替人代写潮汐记录。');
  const draftActorDetail = await openActorDetail(draftActor);
  await draftActorDetail.getByLabel(/^性格/).fill('谨慎，喜欢核对两遍。');

  await expect.poll(async () => page.evaluate(() => {
    const raw = window.sessionStorage.getItem('sthstart:story-worlds:draft:create');
    return raw ? JSON.parse(raw).isDirty === true : false;
  })).toBe(true);

  await page.reload();
  await expect(page.getByLabel(/^世界名称/)).toHaveValue('雾港草稿');
  await expect(page.getByLabel(/^地点名称/).first()).toHaveValue('旧码头');
  const restoredLocation = page.locator('section').filter({
    has: page.getByRole('heading', { name: '开场地点', exact: true }),
  }).locator('div.rounded-panel').first();
  await expect((await openLocationDescription(restoredLocation)).getByLabel(/^地点描述/))
    .toHaveValue('涨潮时会没过第三级台阶。');
  await expect(page.getByLabel(/^人物名称/)).toHaveValue('阿澜');
  await expect(page.getByLabel(/^处境/)).toHaveValue('替人代写潮汐记录。');
  const restoredActor = page.locator('section').filter({
    has: page.getByRole('heading', { name: '登场人物', exact: true }),
  }).locator('div.rounded-panel').first();
  await expect((await openActorDetail(restoredActor)).getByLabel(/^性格/)).toHaveValue('谨慎，喜欢核对两遍。');
  await expect(page.getByRole('status').filter({ hasText: /^草稿未创建$/ })).toBeVisible();

  await page.getByRole('button', { name: '放弃修改', exact: true }).first().click();
  await expect(page.getByLabel(/^世界名称/)).toHaveValue('');
  await expect(page.getByRole('status').filter({ hasText: /^尚未填写$/ })).toBeVisible();
  await expect.poll(async () => page.evaluate(
    () => window.sessionStorage.getItem('sthstart:story-worlds:draft:create'),
  )).toBeNull();
});

test('AI candidates start unselected, require confirmation for a field edited after the request, and undo', async ({ page, request }) => {
  await resetFixture(request);
  await auth(page);
  const world = await seedWorld(request);
  await page.goto(`/apps/story-worlds/${world.worldId}/edit?branch=${world.branchId}`);
  await expect(page.getByRole('heading', { name: '世界设定', exact: true })).toBeVisible();
  const ai = page.getByRole('region', { name: 'AI 候选' });
  await expect(ai).toBeVisible();

  await ai.getByLabel(/^生成范围/).selectOption('world');
  await ai.getByLabel(/^创作要求/).fill('补全世界名称、简介与时间；只写简介能支撑的内容。');
  const suggestionResponse = page.waitForResponse(
    (response) => response.url().includes('/suggestions') && response.request().method() === 'POST',
  );
  await ai.getByRole('button', { name: '生成候选', exact: true }).click();
  const generated = await suggestionResponse;
  expect(generated.status()).toBe(200);
  const body = await generated.json() as WorldSuggestionResponse;
  expect(body.candidates.length).toBeGreaterThanOrEqual(3);
  expect(body.candidates.every((candidate) => ['title', 'summary', 'timeLabel', 'startMinuteOfDay', 'visualStyle', 'lockedFacts'].includes(candidate.target))).toBe(true);

  await expect(ai.getByText(`候选 ${body.candidates.length} 项`, { exact: true })).toBeVisible();
  const candidateBoxes = ai.getByRole('checkbox', { name: /^采纳「/ });
  await expect(candidateBoxes).toHaveCount(body.candidates.length);
  for (const box of await candidateBoxes.all()) await expect(box).not.toBeChecked();
  await expect(ai.getByRole('button', { name: '采纳所选', exact: true })).toBeDisabled();

  const state = await fixtureState(request);
  expect(state.suggestionCalls).toBe(1);
  expect(state.models).toEqual(['fixture-story-model']);
  expect(state.rejected).toEqual([]);

  // Edit the same field the candidate targets after the request, then select it.
  const titleInput = page.getByLabel(/^世界名称/);
  await titleInput.fill('林舟的港口（手改）');
  await ai.getByRole('checkbox', { name: '采纳「世界名称」' }).check();
  await expect(ai.getByText(/「世界名称」在请求后已被修改，请勾选“已核对”后再采纳。/)).toBeVisible();
  await expect(ai.getByRole('button', { name: '采纳所选', exact: true })).toBeDisabled();

  await ai.getByRole('checkbox', { name: /^已核对/ }).check();
  const apply = ai.getByRole('button', { name: '采纳所选', exact: true });
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(titleInput).toHaveValue('潮汐册页');
  await expect(ai.getByText('已写入 1 项候选。如果结果不对，可以用“撤销上次采纳”恢复采纳前的草稿。', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^未保存$/ })).toBeVisible();

  await ai.getByRole('button', { name: '撤销上次采纳', exact: true }).click();
  await expect(titleInput).toHaveValue('林舟的港口（手改）');
  await expect(ai.getByRole('button', { name: '撤销上次采纳', exact: true })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: /^未保存$/ })).toBeVisible();
});

test('web search selects sources, extracts partial failures, and imports them as unverified', async ({ page, request }) => {
  await resetFixture(request);
  await auth(page);
  const world = await seedWorld(request);
  await page.goto(`/apps/story-worlds/${world.worldId}/edit?branch=${world.branchId}`);
  await expect(page.getByRole('heading', { name: '世界设定', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '从资料库添加', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加世界资源' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: '网页', exact: true }).click();
  await dialog.getByLabel('搜索公共网页').fill('港口 潮汐记录 灯塔');
  const searchResponse = page.waitForResponse(
    (response) => response.url().includes('/web-search/search') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '搜索网页', exact: true }).click();
  expect((await searchResponse).status()).toBe(200);

  await expect(dialog.getByText('潮汐记录与港口日常 · 地方志摘录', { exact: true })).toBeVisible();
  await expect(dialog.getByText('旧灯塔维护手册', { exact: true })).toBeVisible();
  await expect(dialog.getByText('搜索摘要', { exact: true })).toHaveCount(2);

  await dialog.getByRole('checkbox', { name: /^选择网页 潮汐记录与港口日常/ }).check();
  await dialog.getByRole('checkbox', { name: /^选择网页 旧灯塔维护手册/ }).check();
  const extractResponse = page.waitForResponse(
    (response) => response.url().includes('/web-search/extract') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '提取正文', exact: true }).click();
  expect((await extractResponse).status()).toBe(200);

  await expect(dialog.getByText('已处理 2 个网页；1 个提取失败，可重试或仅以摘要加入。', { exact: true })).toBeVisible();
  await expect(dialog.getByText('已提取正文', { exact: true })).toHaveCount(1);
  await expect(dialog.getByText('提取失败', { exact: true })).toHaveCount(1);

  await dialog.getByRole('button', { name: '准备加入草稿', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '确认网页来源变更', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '确认加入 2 条新来源', exact: true }).click();
  await expect(dialog.getByText('已加入 2 条网页来源；性质标记为待核实。', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await expect(dialog).not.toBeVisible();

  const sources = page.locator('section').filter({ has: page.getByRole('heading', { name: '参考资料', exact: true }) });
  const extractedItem = sources.getByRole('listitem').filter({ hasText: '潮汐记录与港口日常' });
  const failedItem = sources.getByRole('listitem').filter({ hasText: '旧灯塔维护手册' });
  await expect(extractedItem).toHaveCount(1);
  await expect(failedItem).toHaveCount(1);
  await expect(extractedItem.getByText('待核实', { exact: true })).toBeVisible();
  await expect(failedItem.getByText('待核实', { exact: true })).toBeVisible();
  await expect(failedItem.getByText(/正文提取失败/)).toBeVisible();
  await expect(extractedItem.getByText(/两次水位校准决定出海窗口/)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^未保存$/ })).toBeVisible();

  const state = await fixtureState(request);
  expect(state.searchCalls).toBe(1);
  expect(state.extractCalls).toBe(1);
  expect(state.extractUrls[0]).toHaveLength(2);
  expect(state.rejected).toEqual([]);
});

test('web import never overwrites a project or canon source that shares the same URL', async ({ page, request }) => {
  await resetFixture(request);
  await auth(page);
  const canonId = 'source-canon-archive';
  const canonUrl = 'https://harbor-archive.example.org/tide-records';
  const canonContent = '原作资料：港口地方志明确规定，潮汐记录由守夜人誊抄并公开悬挂。';
  const world = await seedWorld(request, {
    sources: [
      {
        id: canonId,
        title: '港口地方志（原文）',
        nature: 'canon',
        content: canonContent,
        sourceUrl: canonUrl,
        sourceVersion: 'canon:1',
        capturedAt: '2026-10-01T00:00:00.000Z',
      },
    ],
  });
  await page.goto(`/apps/story-worlds/${world.worldId}/edit?branch=${world.branchId}`);
  await expect(page.getByRole('heading', { name: '世界设定', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '从资料库添加', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加世界资源' });
  await dialog.getByRole('tab', { name: '网页', exact: true }).click();
  await dialog.getByLabel('搜索公共网页').fill('港口 潮汐记录 灯塔');
  await dialog.getByRole('button', { name: '搜索网页', exact: true }).click();

  const webCheckbox = dialog.getByRole('checkbox', {
    name: /^选择网页 潮汐记录与港口日常/,
  });
  await expect(webCheckbox).toBeEnabled();
  await webCheckbox.check();
  const extractResponse = page.waitForResponse(
    (response) => response.url().includes('/web-search/extract') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '提取正文', exact: true }).click();
  expect((await extractResponse).status()).toBe(200);
  await dialog.getByRole('button', { name: '准备加入草稿', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '确认网页来源变更', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '确认加入 1 条新来源', exact: true }).click();

  // 同一 URL 的原作资料必须保持原样；网页只能作为独立来源加入。
  await expect(dialog.getByText('已加入 1 条网页来源；性质标记为待核实。', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await expect(dialog).not.toBeVisible();

  const sourcesSection = page.locator('section').filter({
    has: page.getByRole('heading', { name: '参考资料', exact: true }),
  });
  const canonItem = sourcesSection.getByRole('listitem').filter({ hasText: '港口地方志（原文）' });
  await expect(canonItem).toHaveCount(1);
  await expect(canonItem.getByText(canonContent, { exact: true })).toBeVisible();
  await expect(canonItem.getByText('原作有据', { exact: true })).toBeVisible();

  const saveResponse = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().endsWith(`/story-worlds/${world.worldId}`),
  );
  await page.getByRole('button', { name: '保存全部', exact: true }).first().click();
  expect((await saveResponse).status()).toBe(200);
  const saved = await worldDetail(request, world.worldId);
  const canon = saved.sources.find((source) => source.id === canonId);
  expect(canon).toMatchObject({
    title: '港口地方志（原文）',
    nature: 'canon',
    content: canonContent,
    sourceUrl: canonUrl,
    sourceVersion: 'canon:1',
  });
  const sameUrl = saved.sources.filter((source) => source.sourceUrl === canonUrl);
  expect(sameUrl.some((source) => source.id === canonId)).toBe(true);
  for (const source of sameUrl.filter((item) => item.id !== canonId)) {
    expect(source.nature).toBe('unverified');
  }
});

test('authoring layout holds four viewports in warm white and warm night without horizontal overflow', async ({ page, request }) => {
  await auth(page);
  const world = await seedWorld(request);
  await page.addInitScript(() => {
    window.localStorage.setItem('sthstart_theme_id', 'light-paper');
    window.localStorage.setItem('sthstart_theme', 'light-paper');
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`/apps/story-worlds/${world.worldId}/edit?branch=${world.branchId}`);
  await expect(page.getByRole('heading', { name: '世界设定', exact: true })).toBeVisible();
  mkdirSync(output, { recursive: true });

  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    const geometry = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
      theme: document.documentElement.dataset.theme,
    }));
    expect(geometry.page, `page horizontal overflow at ${size.width}`).toBe(0);
    expect(geometry.body, `body horizontal overflow at ${size.width}`).toBe(0);
    expect(geometry.theme).toBe('light-paper');
    await expect(page.getByRole('region', { name: 'AI 候选' })).toBeVisible();
    await expect(page.getByRole('button', { name: '保存全部', exact: true }).first()).toBeVisible();
    await page.screenshot({ path: resolve(output, `authoring-${size.width}.png`), fullPage: true });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark-espresso';
    document.documentElement.dataset.colorMode = 'dark';
    document.documentElement.dataset.mantineColorScheme = 'dark';
    document.documentElement.style.colorScheme = 'dark';
    document.documentElement.removeAttribute('data-eye-care');
  });
  await page.waitForTimeout(600);
  const nightGeometry = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    theme: document.documentElement.dataset.theme,
    background: getComputedStyle(document.body).backgroundColor,
  }));
  expect(nightGeometry.overflow).toBe(0);
  expect(nightGeometry.theme).toBe('dark-espresso');
  await expect(page.getByRole('heading', { name: '世界设定', exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(output, 'authoring-1440-warm-night.png'), fullPage: true });
  expect(pageErrors).toEqual([]);
});

test('service API smoke keeps suggestion and web-search contracts intact', async ({ request }) => {
  await resetFixture(request);
  const health = await request.get(`${service}/api/v1/health`);
  expect(health.ok()).toBe(true);
  expect((await health.json()).status).toBe('ok');

  const unauthorized = await request.post(`${service}${api}/suggestions`, {
    data: { draft: draft(), instruction: '补全', scope: 'world', draftFingerprint: 'fp' },
  });
  expect(unauthorized.status()).toBe(401);

  const fingerprint = 'swd-fixture-smoke';
  const suggestion = await request.post(`${service}${api}/suggestions`, {
    headers: adminHeaders,
    data: { draft: draft(), instruction: '补全世界名称与简介', scope: 'world', draftFingerprint: fingerprint },
  });
  expect(suggestion.status()).toBe(200);
  const suggestionBody = await suggestion.json() as WorldSuggestionResponse;
  expect(suggestionBody.draftFingerprint).toBe(fingerprint);
  expect(suggestionBody.candidates.length).toBeGreaterThan(0);
  expect(suggestionBody.gaps.length).toBeGreaterThan(0);
  for (const candidate of suggestionBody.candidates) {
    expect(['title', 'summary', 'timeLabel', 'startMinuteOfDay', 'visualStyle', 'lockedFacts']).toContain(candidate.target);
    expect(candidate.sourceIds.every((id) => id === 'source-setting')).toBe(true);
  }

  const search = await request.post(`${service}/api/v1/admin/web-search/search`, {
    headers: adminHeaders,
    data: { query: '港口 潮汐', maxResults: 2 },
  });
  expect(search.status()).toBe(200);
  const searchBody = await search.json();
  expect(searchBody.query).toBe('港口 潮汐');
  expect(searchBody.items).toHaveLength(2);
  for (const item of searchBody.items) {
    expect(item.status).toBe('snippet');
    expect(item.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(item.url).toMatch(/^https:\/\//);
  }

  const extract = await request.post(`${service}/api/v1/admin/web-search/extract`, {
    headers: adminHeaders,
    data: { items: searchBody.items },
  });
  expect(extract.status()).toBe(200);
  const extractBody = await extract.json();
  expect(extractBody.items.map((item: { status: string }) => item.status).sort()).toEqual(['extracted', 'failed']);
  const failed = extractBody.items.find((item: { status: string }) => item.status === 'failed');
  expect(failed.error).toContain('403');
  expect(failed.truncated).toBe(false);

  const state = await fixtureState(request);
  expect(state.models).toEqual(['fixture-story-model']);
  expect(new Set(state.hosts)).toEqual(new Set(['world-test.invalid', 'api.tavily.com']));
  expect(state.rejected).toEqual([]);
});

test('editing saves both sides in either order without stale revision conflicts', async ({ page, request }) => {
  await auth(page);
  const first = await seedWorld(request);
  const second = await seedWorld(request);
  const writes = new Map<string, string[]>([
    [first.worldId, []],
    [second.worldId, []],
  ]);
  const conflicts: Array<{ url: string; status: number }> = [];
  page.on('request', (req) => {
    if (req.method() !== 'PUT') return;
    for (const worldId of writes.keys()) {
      if (req.url().endsWith(`/story-worlds/${worldId}`)) writes.get(worldId)!.push('world');
      else if (req.url().includes(`/story-worlds/${worldId}/branches/`)) writes.get(worldId)!.push('branch');
    }
  });
  page.on('response', (response) => {
    if (response.request().method() === 'PUT' && response.status() >= 400) {
      conflicts.push({ url: response.url(), status: response.status() });
    }
  });

  const status = (text: RegExp) => page.getByRole('status').filter({ hasText: text });
  const worldPut = (w: SeededWorld) => page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().endsWith(`/story-worlds/${w.worldId}`),
  );
  const branchPut = (w: SeededWorld) => page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().includes(`/branches/${w.branchId}`),
  );
  const open = async (w: SeededWorld) => {
    await page.goto(`/apps/story-worlds/${w.worldId}/edit?branch=${w.branchId}`);
    await expect(page.getByRole('heading', { name: '世界设定', exact: true })).toBeVisible();
    await expect(status(/^已保存$/)).toBeVisible();
  };
  const titleInput = () => page.getByLabel(/^世界名称/);
  const directionInput = () => page.getByLabel(/^故事方向/);

  // 顺序一：先世界、后分支。
  await open(first);
  await titleInput().fill('雾港纪事（先世界）');
  await directionInput().fill('先保存世界，再保存分支。');
  await expect(status(/^未保存$/)).toBeVisible();

  const firstWorldSave = worldPut(first);
  await page.getByRole('button', { name: '只保存世界设定', exact: true }).click();
  expect((await firstWorldSave).status()).toBe(200);
  await expect(status(/^未保存$/)).toBeVisible();
  await expect(directionInput()).toHaveValue('先保存世界，再保存分支。');
  expect((await worldDetail(request, first.worldId)).title).toBe('雾港纪事（先世界）');
  expect((await branchDetail(request, first.worldId, first.branchId)).branch.direction)
    .toBe('从一次异常低潮开始。');
  expect(writes.get(first.worldId)).toEqual(['world']);

  const firstBranchSave = branchPut(first);
  await page.getByRole('button', { name: '只保存分支设定', exact: true }).click();
  expect((await firstBranchSave).status()).toBe(200);
  await expect(status(/^已保存$/)).toBeVisible();
  expect((await branchDetail(request, first.worldId, first.branchId)).branch.direction)
    .toBe('先保存世界，再保存分支。');
  expect((await worldDetail(request, first.worldId)).title).toBe('雾港纪事（先世界）');
  expect(writes.get(first.worldId)).toEqual(['world', 'branch']);

  // 两侧都保存后再改一次；必须使用同步后的世界/分支修订，不能再发旧 revision 409。
  await titleInput().fill('雾港纪事（先世界·再次保存）');
  await directionInput().fill('再次保存两侧时不得使用旧修订。');
  const firstWorldAgain = worldPut(first);
  const firstBranchAgain = branchPut(first);
  await page.getByRole('button', { name: '保存全部', exact: true }).first().click();
  expect((await firstWorldAgain).status()).toBe(200);
  expect((await firstBranchAgain).status()).toBe(200);
  await expect(status(/^已保存$/)).toBeVisible();
  expect((await worldDetail(request, first.worldId)).title).toBe('雾港纪事（先世界·再次保存）');
  expect((await branchDetail(request, first.worldId, first.branchId)).branch.direction)
    .toBe('再次保存两侧时不得使用旧修订。');
  expect(writes.get(first.worldId)).toEqual(['world', 'branch', 'world', 'branch']);

  // 顺序二：先分支、后世界。
  await open(second);
  await titleInput().fill('雾港纪事（先分支）');
  await directionInput().fill('先保存分支，再保存世界。');
  await expect(status(/^未保存$/)).toBeVisible();

  const secondBranchSave = branchPut(second);
  await page.getByRole('button', { name: '只保存分支设定', exact: true }).click();
  expect((await secondBranchSave).status()).toBe(200);
  await expect(status(/^未保存$/)).toBeVisible();
  expect((await branchDetail(request, second.worldId, second.branchId)).branch.direction)
    .toBe('先保存分支，再保存世界。');
  expect((await worldDetail(request, second.worldId)).title).toBe('雾港纪事');
  expect(writes.get(second.worldId)).toEqual(['branch']);

  const secondWorldSave = worldPut(second);
  await page.getByRole('button', { name: '只保存世界设定', exact: true }).click();
  expect((await secondWorldSave).status()).toBe(200);
  await expect(status(/^已保存$/)).toBeVisible();
  expect((await worldDetail(request, second.worldId)).title).toBe('雾港纪事（先分支）');
  expect((await branchDetail(request, second.worldId, second.branchId)).branch.direction)
    .toBe('先保存分支，再保存世界。');
  expect(writes.get(second.worldId)).toEqual(['branch', 'world']);

  await titleInput().fill('雾港纪事（先分支·再次保存）');
  await directionInput().fill('再次保存两侧时不得使用旧修订。');
  const secondWorldAgain = worldPut(second);
  const secondBranchAgain = branchPut(second);
  await page.getByRole('button', { name: '保存全部', exact: true }).first().click();
  expect((await secondWorldAgain).status()).toBe(200);
  expect((await secondBranchAgain).status()).toBe(200);
  await expect(status(/^已保存$/)).toBeVisible();
  expect((await worldDetail(request, second.worldId)).title).toBe('雾港纪事（先分支·再次保存）');
  expect((await branchDetail(request, second.worldId, second.branchId)).branch.direction)
    .toBe('再次保存两侧时不得使用旧修订。');
  expect(writes.get(second.worldId)).toEqual(['branch', 'world', 'world', 'branch']);
  expect(conflicts).toEqual([]);
});

test('a concurrent edit returns 409 and requires confirming the full field comparison before saving', async ({ page, context, request }) => {
  await auth(page);
  const world = await seedWorld(request);
  const editUrl = `/apps/story-worlds/${world.worldId}/edit?branch=${world.branchId}`;
  await page.goto(editUrl);
  await expect(page.getByRole('heading', { name: '世界设定', exact: true })).toBeVisible();

  // 第二个页面同样基于旧修订打开，确认冲突来自真实并发而不是单页状态。
  const otherPage = await context.newPage();
  await otherPage.goto(editUrl);
  await expect(otherPage.getByRole('heading', { name: '世界设定', exact: true })).toBeVisible();
  // 第二个页面保存成功后，第一个页面的修订基底就真正过期了。
  await otherPage.getByLabel(/^世界名称/).fill('服务器侧标题');
  await otherPage.getByRole('button', { name: '保存全部', exact: true }).first().click();
  await expect(otherPage.getByRole('status').filter({ hasText: /^已保存$/ })).toBeVisible();
  await otherPage.close();

  await page.getByLabel(/^世界名称/).fill('本地草稿标题');
  const conflictResponse = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().endsWith(`/story-worlds/${world.worldId}`),
  );
  await page.getByRole('button', { name: '保存全部', exact: true }).first().click();
  expect((await conflictResponse).status()).toBe(409);

  const conflictAlert = page.getByRole('status').filter({ has: page.getByText('需要确认修订基底', { exact: true }) });
  await expect(conflictAlert).toBeVisible();
  await expect(conflictAlert.getByText(/世界设定已在别处更新|世界或分支已在别处更新/)).toBeVisible();
  await expect(page.getByLabel(/^世界名称/)).toHaveValue('本地草稿标题');

  await conflictAlert.getByRole('button', { name: '对比服务器当前值', exact: true }).click();
  const table = conflictAlert.locator('table');
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader', { name: '服务器当前值', exact: true })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: '你的草稿', exact: true })).toBeVisible();
  const titleRow = table.locator('tr').filter({ has: page.getByRole('rowheader', { name: '世界名称', exact: true }) });
  await expect(titleRow).toHaveCount(1);
  await expect(titleRow.getByRole('cell').nth(0)).toHaveText('服务器侧标题');
  await expect(titleRow.getByRole('cell').nth(1)).toHaveText('本地草稿标题');
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: resolve(output, 'conflict-full-compare-1440.png'), fullPage: true });

  await conflictAlert.getByRole('button', { name: '确认以这个基准保存我的草稿', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /已确认使用世界 rev \d+ \/ 分支 rev \d+ 作为基准/ })).toBeVisible();

  const retriedSave = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().endsWith(`/story-worlds/${world.worldId}`),
  );
  await page.getByRole('button', { name: '保存全部', exact: true }).first().click();
  expect((await retriedSave).status()).toBe(200);
  await expect(page.getByRole('status').filter({ hasText: /^已保存$/ })).toBeVisible();

  const finalOverview = await request.get(`${service}${api}/${world.worldId}`, { headers: adminHeaders });
  expect((await finalOverview.json()).world.title).toBe('本地草稿标题');
});

test('a lost create response is retried with the same key and keeps exactly one world', async ({ page, request }, info) => {
  await auth(page);
  const title = `重试不重复 · ${info.project.name}`;
  let firstCreate: { id: string; title: string } | null = null;
  const keys: string[] = [];
  let intercepted = false;
  await page.route('**/api/admin/story-worlds/setups', async (route) => {
    if (intercepted || route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    intercepted = true;
    keys.push((route.request().postDataJSON() as { idempotencyKey: string }).idempotencyKey);
    // 请求真实到达服务端并创建成功，但响应在回到浏览器前丢失。
    const response = await request.post(`${service}${api}/setups`, {
      headers: adminHeaders, data: route.request().postDataJSON(),
    });
    expect(response.status()).toBe(201);
    firstCreate = await response.json();
    await route.fulfill({ status: 502, json: { message: '创建响应未送达，请重试。' } });
  });

  await page.goto('/apps/story-worlds/new');
  await page.getByLabel(/^世界名称/).fill(title);
  await page.getByRole('button', { name: '创建世界', exact: true }).first().click();

  await expect(page.getByRole('alert')).toBeVisible();
  await expect.poll(() => firstCreate !== null).toBe(true);
  const created = firstCreate!;
  await expect(page.getByLabel(/^世界名称/)).toHaveValue(title);

  const retryResponse = page.waitForResponse(
    (r) => r.url().endsWith('/setups') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '创建世界', exact: true }).first().click();
  const retried = await retryResponse;
  expect(retried.status()).toBe(201);
  const retriedBody = await retried.json();
  keys.push((retried.request().postDataJSON() as { idempotencyKey: string }).idempotencyKey);
  expect(retriedBody.id).toBe(created.id);
  expect(new Set(keys).size).toBe(1);

  await page.waitForURL(/\/apps\/story-worlds\?world=/, { timeout: 20_000 });
  const listResponse = await request.get(`${service}${api}/setups`, { headers: adminHeaders });
  expect(listResponse.ok()).toBe(true);
  const list = await listResponse.json() as { items: Array<{ id: string; title: string }> };
  expect(list.items.filter((item) => item.title === title)).toHaveLength(1);
  expect(list.items.filter((item) => item.id === created.id)).toHaveLength(1);
});

interface AuthoringFixture {
  mediaId: string;
  characterId: string;
  characterVersions: number[];
  noteId: string;
  noteTitle: string;
  noteContentV1: string;
  noteContentV2: string;
  suggestionMode: string;
}

async function authoringFixture(request: APIRequestContext): Promise<AuthoringFixture> {
  const response = await request.get(`${service}/__fixture/world-authoring`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<AuthoringFixture>;
}

async function setSuggestionMode(request: APIRequestContext, mode: string) {
  const response = await request.post(`${service}/__fixture/suggestion-mode`, { data: { mode } });
  expect(response.ok()).toBe(true);
}

test('importing a character version keeps the exact published snapshot', async ({ page, request }) => {
  await resetFixture(request);
  await auth(page);
  const fixture = await authoringFixture(request);
  const world = await seedWorld(request);
  await page.goto(`/apps/story-worlds/${world.worldId}/edit?branch=${world.branchId}`);
  await expect(page.getByRole('heading', { name: '世界设定', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '从资料库添加人物', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加世界资源' });
  await expect(dialog).toBeVisible();
  const characterCheckbox = dialog.getByRole('checkbox', { name: `选择 潮汐记录员`, exact: true });
  await expect(characterCheckbox).toBeEnabled();
  await expect(dialog.getByText(/已发布 v2/)).toBeVisible();
  await checkCheckbox(characterCheckbox);

  const versionSelect = dialog.getByLabel('选择 潮汐记录员 的版本');
  await expect(versionSelect).toBeVisible();
  await expect(versionSelect.locator('option')).toHaveCount(fixture.characterVersions.length);
  // 默认采用最新发布版本；显式改成 v1 验证“不是悄悄用草稿或最新版兜底”。
  await expect(versionSelect).toHaveValue(String(Math.max(...fixture.characterVersions)));
  await versionSelect.selectOption('1');

  await dialog.getByRole('button', { name: '确认加入人物', exact: true }).click();
  await expect(dialog.getByText(/已加入 1 位人物，使用已发布版本快照。/)).toBeVisible();
  await dialog.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await expect(dialog).not.toBeVisible();

  const actorCard = page.locator('section').filter({
    has: page.getByRole('heading', { name: '登场人物', exact: true }),
  }).locator('div.rounded-panel').last();
  await expect(actorCard.getByLabel(/^人物名称/)).toHaveValue('潮汐记录员');
  const detail = await openActorDetail(actorCard);
  await expect(detail.getByText(`${fixture.characterId} · v1`, { exact: true })).toBeVisible();
  await expect(detail.getByText(fixture.characterId, { exact: false })).toBeVisible();

  // v1 快照的正文必须来自 v1，而不是最新 v2。
  await expect(detail.getByLabel(/^性格/)).toHaveValue('潮汐记录员的公开摘要。');
  await expect(actorCard.getByLabel(/^处境/)).toHaveValue('第一版：刚接手灯塔。');
});

test('importing a newer note revision updates the same source instead of duplicating it', async ({ page, request }) => {
  await resetFixture(request);
  await auth(page);
  const fixture = await authoringFixture(request);
  const oldVersion = `note:${fixture.noteId}:r1`;
  const newVersion = `note:${fixture.noteId}:r2`;
  const sourceId = `source-note-${fixture.noteId}`;
  const world = await seedWorld(request, {
    sources: [
      {
        id: sourceId,
        title: fixture.noteTitle,
        nature: 'unverified',
        content: fixture.noteContentV1,
        sourceUrl: '',
        sourceVersion: oldVersion,
        capturedAt: '2026-11-01T00:00:00.000Z',
      },
    ],
  });
  await page.goto(`/apps/story-worlds/${world.worldId}/edit?branch=${world.branchId}`);
  await expect(page.getByRole('heading', { name: '世界设定', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '从资料库添加', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加世界资源' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: '笔记', exact: true }).click();

  const noteCheckbox = dialog.getByRole('checkbox', {
    name: `选择笔记 ${fixture.noteTitle}`,
    exact: true,
  });
  await expect(noteCheckbox).toBeEnabled();
  await expect(dialog.getByText('可更新版本', { exact: true })).toBeVisible();
  await noteCheckbox.check();

  const updatePanel = dialog.locator('div.rounded-panel').filter({
    hasText: '确认笔记版本更新',
  }).first();
  await expect(updatePanel.getByRole('heading', { name: '确认笔记版本更新', exact: true })).toBeVisible();
  await expect(updatePanel.getByText(`${fixture.noteTitle} · ${oldVersion} → ${newVersion}`, { exact: true }))
    .toBeVisible();
  await expect(updatePanel.getByText('正文展开完整对照', { exact: true })).toBeVisible();
  await updatePanel.locator('details').evaluateAll((nodes) => {
    for (const node of nodes) (node as HTMLDetailsElement).open = true;
  });
  await expect(updatePanel.getByText(fixture.noteContentV1, { exact: true })).toBeVisible();
  await expect(updatePanel.getByText(fixture.noteContentV2, { exact: true })).toBeVisible();

  await dialog.getByRole('button', { name: '确认加入笔记', exact: true }).click();
  await expect(dialog.getByText('已更新 1 条笔记版本。', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await expect(dialog).not.toBeVisible();

  const sourcesSection = page.locator('section').filter({
    has: page.getByRole('heading', { name: '参考资料', exact: true }),
  });
  await expect(sourcesSection.getByText(fixture.noteContentV2, { exact: true })).toBeVisible();
  await expect(sourcesSection.getByText(fixture.noteContentV1, { exact: true })).toHaveCount(0);
  await expect(sourcesSection.getByText(fixture.noteTitle, { exact: true })).toHaveCount(1);

  const saveResponse = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().endsWith(`/story-worlds/${world.worldId}`),
  );
  await page.getByRole('button', { name: '保存全部', exact: true }).first().click();
  expect((await saveResponse).status()).toBe(200);
  const saved = await worldDetail(request, world.worldId);
  expect(saved.sources).toHaveLength(1);
  expect(saved.sources[0]).toMatchObject({
    id: sourceId,
    title: fixture.noteTitle,
    content: fixture.noteContentV2,
    sourceVersion: newVersion,
  });
});

test('stale actor candidates cannot restore a deleted or unbound character binding', async ({ page, request }) => {
  await resetFixture(request);
  await auth(page);
  const fixture = await authoringFixture(request);
  const world = await seedWorld(request, {
    actors: [
      {
        id: 'actor-stale', name: '林舟', role: 'main',
        characterId: fixture.characterId, characterVersion: 2,
        background: '在港口长大，负责每天第一次水位校准。',
        personality: '克制、耐心',
        speechStyle: '句子短，常引用潮位。',
        appearance: '深蓝防水外套',
        goals: ['把本月潮汐记录整理成册'],
        locationId: 'harbor', referenceArtifactIds: [fixture.mediaId],
      },
    ],
  });
  await page.goto(`/apps/story-worlds/${world.worldId}/edit?branch=${world.branchId}`);
  await expect(page.getByRole('heading', { name: '世界设定', exact: true })).toBeVisible();

  const ai = page.getByRole('region', { name: 'AI 候选' });
  const actorSection = page.locator('section').filter({
    has: page.getByRole('heading', { name: '登场人物', exact: true }),
  });
  const actorCard = actorSection.locator('div.rounded-panel').first();

  await ai.getByLabel(/^生成范围/).selectOption('actors');
  await ai.getByLabel(/^创作要求/).fill('为已绑定角色补一条目标。');
  await ai.getByRole('button', { name: '生成候选', exact: true }).click();
  await expect(ai.getByText('候选 2 项', { exact: true })).toBeVisible();

  // 候选取材时人物还绑定 v2；随后解除绑定，采纳不得把旧版本重新绑回去。
  const detail = await openActorDetail(actorCard);
  await expect(detail.getByText(`${fixture.characterId} · v2`, { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: '解除绑定', exact: true }).click();
  await expect(detail.getByText('原创人物（未绑定角色库）', { exact: true })).toBeVisible();

  await ai.getByRole('checkbox', { name: '采纳「人物·林舟」', exact: true }).check();
  await ai.getByRole('checkbox', { name: /^已核对/ }).check();
  const apply = ai.getByRole('button', { name: '采纳所选', exact: true });
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(ai.getByText(/已写入 1 项候选/)).toBeVisible();
  await expect(detail.getByText('原创人物（未绑定角色库）', { exact: true })).toBeVisible();
  await expect(detail.getByText(`${fixture.characterId} · v2`, { exact: true })).toHaveCount(0);
  await expect(actorCard).toHaveCount(1);

  // 再生成一批候选后删掉人物：旧候选只能被阻断，不能按“新增”复活人物。
  const regenerated = page.waitForResponse(
    (r) => r.url().includes('/suggestions') && r.request().method() === 'POST',
  );
  await ai.getByRole('button', { name: '生成候选', exact: true }).click();
  expect((await regenerated).status()).toBe(200);
  await expect(ai.getByText('候选 2 项', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '移除人物 林舟', exact: true }).click();
  await expect(actorSection.locator('div.rounded-panel')).toHaveCount(0);
  await ai.getByRole('checkbox', { name: '采纳「人物·林舟」', exact: true }).check();
  await ai.getByRole('checkbox', { name: /^已核对/ }).check();
  await expect(ai.getByText('采纳前还需处理', { exact: true })).toBeVisible();
  await expect(ai.getByText(/actor-stale.*已不在草稿中|已不在草稿中.*actor-stale/)).toBeVisible();
  await expect(ai.getByRole('button', { name: '采纳所选', exact: true })).toBeDisabled();
  await expect(actorSection.locator('div.rounded-panel')).toHaveCount(0);
});

test('AI cannot rewrite a bound actor media or character version', async ({ page, request }) => {
  await resetFixture(request);
  await auth(page);
  const fixture = await authoringFixture(request);
  const world = await seedWorld(request, {
    actors: [
      {
        id: 'actor-lin', name: '林舟', role: 'main',
        characterId: fixture.characterId, characterVersion: 2,
        background: '在港口长大，负责每天第一次水位校准。',
        personality: '克制、耐心', speechStyle: '句子短，常引用潮位。',
        appearance: '深蓝防水外套', goals: ['把本月潮汐记录整理成册'],
        locationId: 'harbor', referenceArtifactIds: [fixture.mediaId],
      },
    ],
  });
  await page.goto(`/apps/story-worlds/${world.worldId}/edit?branch=${world.branchId}`);
  const ai = page.getByRole('region', { name: 'AI 候选' });
  await expect(ai).toBeVisible();

  for (const mode of ['tamper-media', 'tamper-version'] as const) {
    await setSuggestionMode(request, mode);
    await ai.getByLabel(/^生成范围/).selectOption('actors');
    await ai.getByLabel(/^创作要求/).fill('为已绑定角色补充一条目标。');
    await ai.getByRole('button', { name: '生成候选', exact: true }).click();
    await expect(ai.getByText('候选生成失败', { exact: true })).toBeVisible();
    const message = await ai.getByText(/world_suggestion_actor_(media|identity)_changed|参考媒体|角色库身份|角色版本 .* 不存在/).first().textContent();
    expect(message).toBeTruthy();
    // 失败不得静默写入草稿：绑定与媒体保持原值。
    const detail = await openActorDetail(page.locator('section').filter({
      has: page.getByRole('heading', { name: '登场人物', exact: true }),
    }).locator('div.rounded-panel').first());
    await expect(detail.getByText(`${fixture.characterId} · v2`, { exact: true })).toBeVisible();
    await expect(detail.getByText('已选 1 个素材', { exact: false })).toBeVisible();
  }

  const saved = await branchDetail(request, world.worldId, world.branchId);
  expect(saved.definition.actors[0]).toMatchObject({
    characterId: fixture.characterId,
    characterVersion: 2,
    referenceArtifactIds: [fixture.mediaId],
  });
});

test('cancelling an auto-added dependency blocks apply and reverts cleanly', async ({ page, request }) => {
  await resetFixture(request);
  await setSuggestionMode(request, 'dependency');
  await auth(page);
  const world = await seedWorld(request);
  await page.goto(`/apps/story-worlds/${world.worldId}/edit?branch=${world.branchId}`);
  const ai = page.getByRole('region', { name: 'AI 候选' });
  await ai.getByLabel(/^生成范围/).selectOption('all');
  await ai.getByLabel(/^创作要求/).fill('补一个灯塔地点，再补一个需要它的记录员。');
  await ai.getByRole('button', { name: '生成候选', exact: true }).click();

  await expect(ai.getByText('候选 2 项', { exact: true })).toBeVisible();
  const actorCheckbox = ai.getByRole('checkbox', { name: '采纳「人物·潮汐记录员」', exact: true });
  const locationCheckbox = ai.getByRole('checkbox', { name: /^采纳「地点·旧灯塔」/ });
  await actorCheckbox.check();
  await expect(locationCheckbox).toBeChecked();
  await expect(ai.getByText('已自动勾选依赖', { exact: true })).toBeVisible();

  // 取消被自动带入的地点：人物仍在选中，但采纳必须被阻断，且不得静默连带取消人物。
  await locationCheckbox.uncheck();
  await expect(actorCheckbox).toBeChecked();
  await expect(ai.getByText('依赖已调整', { exact: true })).toBeVisible();
  await expect(ai.getByText(/仍依赖它，采纳已被阻止/)).toBeVisible();
  await expect(ai.getByRole('button', { name: '采纳所选', exact: true })).toBeDisabled();

  // 重新勾选依赖后可正常采纳，且地点与人物都写入草稿。
  await locationCheckbox.check();
  await expect(ai.getByRole('button', { name: '采纳所选', exact: true })).toBeEnabled();
  await ai.getByRole('button', { name: '采纳所选', exact: true }).click();
  await expect(page.getByText('已采纳候选', { exact: true })).toBeVisible();
  const locations = page.locator('section').filter({
    has: page.getByRole('heading', { name: '开场地点', exact: true }),
  });
  await expect(locations.getByLabel(/^地点名称/)).toHaveCount(3);
  await expect(locations.getByLabel(/^地点名称/).last()).toHaveValue('旧灯塔');
  await expect(page.locator('section').filter({
    has: page.getByRole('heading', { name: '登场人物', exact: true }),
  }).getByLabel(/^人物名称/)).toHaveCount(2);
});

test('upgrading a bound actor from v1 to v2 shows the diff and replaces the same actor', async ({ page, request }) => {
  await resetFixture(request);
  await auth(page);
  const fixture = await authoringFixture(request);
  const world = await seedWorld(request, {
    actors: [
      {
        id: 'actor-upgrade', name: '潮汐记录员', role: 'supporting',
        characterId: fixture.characterId, characterVersion: 1,
        background: '第一版：刚接手灯塔。',
        personality: '潮汐记录员的公开摘要。',
        speechStyle: '潮汐记录员说话简短，常引用潮位。',
        appearance: '潮汐记录员穿深蓝防水外套。\n值夜装',
        goals: ['把本月潮汐记录整理成册'],
        locationId: 'harbor', referenceArtifactIds: [fixture.mediaId],
      },
    ],
  });
  await page.goto(`/apps/story-worlds/${world.worldId}/edit?branch=${world.branchId}`);
  await expect(page.getByRole('heading', { name: '世界设定', exact: true })).toBeVisible();

  const actorSection = page.locator('section').filter({
    has: page.getByRole('heading', { name: '登场人物', exact: true }),
  });
  const actorCard = actorSection.locator('div.rounded-panel').first();
  await expect(actorCard.getByLabel(/^人物名称/)).toHaveValue('潮汐记录员');
  await expect(actorCard.getByLabel(/^所在地点/)).toHaveValue('harbor');
  const before = await openActorDetail(actorCard);
  await expect(before.getByText(`${fixture.characterId} · v1`, { exact: true })).toBeVisible();
  await expect(before.getByText('已选 1 个素材', { exact: false })).toBeVisible();
  await expect(actorCard.getByLabel(/^处境/)).toHaveValue('第一版：刚接手灯塔。');

  await page.getByRole('button', { name: '从资料库添加人物', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加世界资源' });
  const characterCheckbox = dialog.getByRole('checkbox', { name: '选择 潮汐记录员', exact: true });
  await expect(characterCheckbox).toBeEnabled();
  await expect(dialog.getByText(/已发布 v2/)).toBeVisible();
  await checkCheckbox(characterCheckbox);
  await expect(dialog.getByText('已在当前世界 · v1', { exact: true })).toBeVisible();

  // 默认最新版本即 v2，界面必须明确提示会替换同一个人物快照。
  const versionSelect = dialog.getByLabel('选择 潮汐记录员 的版本');
  await expect(versionSelect).toHaveValue('2');
  await expect(dialog.getByText(/将从 v1 更新到 v2；确认后替换同一个人物快照。/)).toBeVisible();

  const updatePanel = dialog.locator('div.rounded-panel').filter({
    hasText: '确认人物版本更新',
  }).first();
  await expect(updatePanel.getByRole('heading', { name: '确认人物版本更新', exact: true })).toBeVisible();
  await expect(updatePanel.getByText('潮汐记录员 · v1 → v2', { exact: true })).toBeVisible();
  await expect(updatePanel.getByText(/保留：地点「港口」 · 主要人物|保留：地点「港口」 · 配角/)).toBeVisible();
  await expect(updatePanel.getByText('背景展开完整对照', { exact: true })).toBeVisible();
  await updatePanel.locator('details').evaluateAll((nodes) => {
    for (const node of nodes) (node as HTMLDetailsElement).open = true;
  });
  await expect(updatePanel.getByText('第一版：刚接手灯塔。', { exact: true })).toBeVisible();
  await expect(updatePanel.getByText('第二版：已值夜二十年。', { exact: true })).toBeVisible();
  mkdirSync(output, { recursive: true });
  await updatePanel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(output, 'actor-version-upgrade-1440.png'), fullPage: true });

  await updatePanel.getByRole('button', { name: '确认更新 1 位人物', exact: true }).click();
  await expect(dialog.getByText(/已更新 1 位人物；地点、身份和媒体引用保持不变。/)).toBeVisible();
  await dialog.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await expect(dialog).not.toBeVisible();

  // 同一个 actor 就地更新：不新增第二个人物，ID/地点/角色定位/媒体保持不变。
  await expect(actorSection.locator('div.rounded-panel')).toHaveCount(1);
  await expect(actorCard.getByLabel(/^人物名称/)).toHaveValue('潮汐记录员');
  await expect(actorCard.getByLabel(/^所在地点/)).toHaveValue('harbor');
  const after = await openActorDetail(actorCard);
  await expect(after.getByText(`${fixture.characterId} · v2`, { exact: true })).toBeVisible();
  await expect(after.getByText('已选 1 个素材', { exact: false })).toBeVisible();
  await expect(actorCard.getByLabel(/^处境/)).toHaveValue('第二版：已值夜二十年。');
  await expect(after.getByLabel(/^角色定位/)).toHaveValue('supporting');

  const saveResponse = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().endsWith(`/story-worlds/${world.worldId}`),
  );
  await page.getByRole('button', { name: '保存全部', exact: true }).first().click();
  expect((await saveResponse).status()).toBe(200);
  const saved = await worldDetail(request, world.worldId);
  expect(saved.actors).toHaveLength(1);
  expect(saved.actors[0]).toMatchObject({
    id: 'actor-upgrade',
    role: 'supporting',
    locationId: 'harbor',
    characterId: fixture.characterId,
    characterVersion: 2,
    referenceArtifactIds: [fixture.mediaId],
  });
  expect(saved.actors[0].background).toBe('第二版：已值夜二十年。');
});
