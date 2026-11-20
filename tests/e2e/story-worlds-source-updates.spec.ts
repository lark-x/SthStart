import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type {

  StoryWorld,
  WorldBranch,
  WorldBranchDetail,
  WorldDefinition,
  WorldEventPage,
  WorldOverview,
} from '@sthstart/contracts';
/*
 * 作品工作台改版（分支上已确认的有意改动）：主标题为作品名，事件阅读 / 轨迹流 / 图像叙事留在
 * 「沙盒调试视图 (旧)」（?view=sandbox）。
 */
const worldHeading = (page: Page) => page.getByRole('main').first().getByRole('heading', { level: 1 }).first();

const service = 'http://127.0.0.1:4974';
const headers = { 'x-sthstart-admin-token': 'story-worlds-isolated-e2e-admin-token-4974' };
const api = '/api/v1/admin/story-worlds';
const portalApi = '/api/admin/story-worlds';
const output = resolve('artifacts/visual-verification/story-worlds');
const stamp = new Date().toISOString();

type Fixture = { worldId: string; branchId: string; calls: number };

async function fixture(request: APIRequestContext): Promise<Fixture> {
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

function worldUrl(worldId: string) {
  return `${service}${api}/${worldId}`;
}

function branchUrl(worldId: string, branchId: string) {
  return `${worldUrl(worldId)}/branches/${branchId}`;
}

async function getOverview(request: APIRequestContext, worldId: string): Promise<WorldOverview> {
  const response = await request.get(worldUrl(worldId), { headers });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function getDetail(
  request: APIRequestContext,
  worldId: string,
  branchId: string,
): Promise<WorldBranchDetail> {
  const response = await request.get(branchUrl(worldId, branchId), { headers });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function getEvents(
  request: APIRequestContext,
  worldId: string,
  branchId: string,
): Promise<WorldEventPage> {
  const response = await request.get(branchUrl(worldId, branchId) + '/events?limit=200', { headers });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function updateWorld(
  request: APIRequestContext,
  worldId: string,
  expectedRevision: number,
  definition: WorldDefinition,
): Promise<StoryWorld> {
  const response = await request.put(worldUrl(worldId), {
    headers,
    data: { expectedRevision, definition },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

function definitionOf(world: StoryWorld): WorldDefinition {
  const definition: WorldDefinition = {
    title: world.title,
    summary: world.summary,
    timeLabel: world.timeLabel,
    locations: world.locations,
    actors: world.actors,
    sources: world.sources,
    lockedFacts: world.lockedFacts,
    models: world.models,
    visualStyle: world.visualStyle,
  };
  if (world.startMinuteOfDay !== undefined) definition.startMinuteOfDay = world.startMinuteOfDay;
  if (world.visualReferences !== undefined) definition.visualReferences = world.visualReferences;
  return definition;
}

function baseDefinition(): WorldDefinition {
  return {
    title: '来源预览隔离世界',
    summary: '验证来源和世界起点刷新只影响以后推进。',
    timeLabel: '第一天',
    startMinuteOfDay: 60,
    locations: [{ id: 'loc-harbor', name: '港口', description: '潮声不断的石阶码头。' }],
    visualReferences: [],
    actors: [
      {
        id: 'actor-a', name: '林舟', role: 'main', characterId: null, characterVersion: null,
        background: '在港口生活多年。', personality: '温和谨慎。', speechStyle: '自然简洁。',
        appearance: '亚麻外套。', goals: ['完成日常工作'], locationId: 'loc-harbor',
        referenceArtifactIds: [],
      },
      {
        id: 'actor-b', name: '苏禾', role: 'main', characterId: null, characterVersion: null,
        background: '熟悉码头与茶室。', personality: '直率。', speechStyle: '语速轻快。',
        appearance: '浅色围巾。', goals: ['整理归航记录'], locationId: 'loc-harbor',
        referenceArtifactIds: [],
      },
    ],
    sources: [{
      id: 'source-main', title: '港口设定', nature: 'author', content: '第一版资料：港口没有魔法。',
      sourceUrl: '', sourceVersion: '1', capturedAt: stamp,
    }],
    lockedFacts: ['港口没有魔法。'],
    models: {
      action: 'world-test-model',
      adjudication: 'world-test-model',
      narration: 'world-test-model',
    },
    visualStyle: '柔和纸感插画。',
  };
}

function sourceSection(page: Page) {
  return page.locator('section.sw-section').filter({
    has: page.getByRole('heading', { name: '来源', exact: true }),
  });
}

async function expectDialogFitsViewport(page: Page) {
  const geometry = await page.getByRole('dialog', { name: '纳入新版资料前的影响预览' }).evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect();
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      dialogScrollWidth: dialog.scrollWidth,
      dialogClientWidth: dialog.clientWidth,
      rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
    };
  });
  if (!geometry) throw new Error('Source update preview dialog is missing');
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.innerWidth + 1);
  expect(geometry.dialogScrollWidth).toBeLessThanOrEqual(geometry.dialogClientWidth + 1);
  expect(geometry.rect.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.rect.right).toBeLessThanOrEqual(geometry.innerWidth + 1);
  expect(geometry.rect.top).toBeGreaterThanOrEqual(-1);
  expect(geometry.rect.bottom).toBeLessThanOrEqual(geometry.innerHeight + 1);
}

/*
 * 2026-11-20 P4：此前对话框在视口跨过 1152px 时消失，是功能缺陷而非用例过期——来源面板位于作品左栏，
 * 左栏在侧栏与底部抽屉之间切换时重新挂载，带走了对话框状态。现由工作台持有开关并在左栏之外渲染对话框，
 * 本用例在对话框打开时从 1440 缩到 390 再放回，覆盖这一回归。
 */
test('source preview applies source and clock updates, preserves events, and rejects a stale world revision', async ({ page, request }) => {
  test.setTimeout(90_000);
  await fixture(request);
  await auth(page);

  const createdResponse = await request.post(service + api, { headers, data: baseDefinition() });
  expect(createdResponse.status()).toBe(201);
  const world = await createdResponse.json() as StoryWorld;
  const branchResponse = await request.post(worldUrl(world.id) + '/branches', {
    headers,
    data: { title: '来源预览主线', mode: 'canon-gap', direction: '验证历史不被来源刷新改写。', expectedRevision: world.revision },
  });
  expect(branchResponse.status()).toBe(201);
  const branch = await branchResponse.json() as WorldBranch;

  const runResponse = await request.post(branchUrl(world.id, branch.id) + '/runs', {
    headers,
    data: {
      expectedRevision: branch.revision,
      idempotencyKey: `source-preview-${Date.now()}`,
      settings: { durationTicks: 60, stepTicks: 60, maxTextCalls: 40, maxImages: 0, autoImages: false },
    },
  });
  expect(runResponse.status()).toBe(200);
  await expect.poll(async () => (await getDetail(request, world.id, branch.id)).run?.status, {
    timeout: 20_000,
    intervals: [100, 250, 500],
  }).toBe('completed');

  const initialEvents = await getEvents(request, world.id, branch.id);
  expect(initialEvents.items.length).toBeGreaterThan(0);
  const eventSnapshot = initialEvents.items.map((event) => ({ id: event.id, summary: event.summary }));

  const overviewBeforeFirstUpdate = await getOverview(request, world.id);
  const firstUpdatedDefinition: WorldDefinition = {
    ...definitionOf(overviewBeforeFirstUpdate.world),
    startMinuteOfDay: 660,
    sources: overviewBeforeFirstUpdate.world.sources.map((source) => source.id === 'source-main'
      ? { ...source, content: '第二版资料：港口每天清晨有潮汐记录。', sourceVersion: '2' }
      : source),
  };
  const firstUpdatedWorld = await updateWorld(
    request, world.id, overviewBeforeFirstUpdate.world.revision, firstUpdatedDefinition,
  );
  expect(firstUpdatedWorld.revision).toBe(overviewBeforeFirstUpdate.world.revision + 1);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/apps/story-worlds?world=${world.id}&branch=${branch.id}&view=sandbox`);
  await expect(worldHeading(page)).toBeVisible();
  const source = sourceSection(page);
  await expect(source.getByText('来源有新版本', { exact: true })).toBeVisible();
  await source.getByRole('button', { name: '查看影响', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: '纳入新版资料前的影响预览' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('只影响以后推进', { exact: true })).toBeVisible();
  await expect(dialog.getByText('既有事件、正文、记忆和人物状态不会改写', { exact: false })).toBeVisible();
  await expect(dialog.getByText('世界设定 新增 0 · 修改 1 · 移除 0', { exact: true })).toBeVisible();
  await expect(dialog.getByText('来源 新增 0 · 修改 1 · 移除 0', { exact: true })).toBeVisible();
  await expect(dialog.getByText('世界起点的日内分钟', { exact: true })).toBeVisible();
  await expect(dialog.getByText('660 分钟（11:00）', { exact: true })).toBeVisible();
  await expect(dialog.getByText('第二版资料：港口每天清晨有潮汐记录。', { exact: false })).toBeVisible();

  mkdirSync(output, { recursive: true });
  await expectDialogFitsViewport(page);
  await page.screenshot({ path: resolve(output, 'source-preview-1440.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  await expectDialogFitsViewport(page);
  await page.screenshot({ path: resolve(output, 'source-preview-390.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(250);

  const refreshResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === `${portalApi}/${world.id}/branches/${branch.id}/sources/refresh`);
  await dialog.getByRole('button', { name: '确认纳入新版', exact: true }).click();
  expect((await refreshResponse).status()).toBe(200);
  await expect(dialog).not.toBeVisible();

  const refreshedDetail = await getDetail(request, world.id, branch.id);
  expect(refreshedDetail.branch.sourceRevision).toBe(firstUpdatedWorld.revision);
  expect(refreshedDetail.definition.startMinuteOfDay).toBe(660);
  expect(refreshedDetail.definition.sources.find((item) => item.id === 'source-main')?.content)
    .toContain('第二版资料');
  const eventsAfterFirstRefresh = await getEvents(request, world.id, branch.id);
  expect(eventsAfterFirstRefresh.items.map((event) => event.id)).toEqual(eventSnapshot.map((event) => event.id));
  for (const snapshot of eventSnapshot) {
    expect(eventsAfterFirstRefresh.items.find((event) => event.id === snapshot.id)?.summary).toBe(snapshot.summary);
  }

  const overviewBeforeSecondUpdate = await getOverview(request, world.id);
  const secondUpdatedDefinition: WorldDefinition = {
    ...definitionOf(overviewBeforeSecondUpdate.world),
    startMinuteOfDay: 720,
    sources: overviewBeforeSecondUpdate.world.sources.map((sourceItem) => sourceItem.id === 'source-main'
      ? { ...sourceItem, content: '第三版资料：港口记录必须在中午前归档。', sourceVersion: '3' }
      : sourceItem),
  };
  await updateWorld(request, world.id, overviewBeforeSecondUpdate.world.revision, secondUpdatedDefinition);

  await page.reload();
  await expect(worldHeading(page)).toBeVisible();
  await expect(source.getByText('来源有新版本', { exact: true })).toBeVisible();
  await source.getByRole('button', { name: '查看影响', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/世界修订 3/)).toBeVisible();
  const branchBefore409 = (await getDetail(request, world.id, branch.id)).branch;

  const overviewBeforeThirdUpdate = await getOverview(request, world.id);
  const thirdUpdatedDefinition: WorldDefinition = {
    ...definitionOf(overviewBeforeThirdUpdate.world),
    startMinuteOfDay: 780,
    sources: overviewBeforeThirdUpdate.world.sources.map((sourceItem) => sourceItem.id === 'source-main'
      ? { ...sourceItem, content: '第四版资料：港口在午后换班。', sourceVersion: '4' }
      : sourceItem),
  };
  const thirdUpdatedWorld = await updateWorld(
    request, world.id, overviewBeforeThirdUpdate.world.revision, thirdUpdatedDefinition,
  );

  const staleRefreshResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === `${portalApi}/${world.id}/branches/${branch.id}/sources/refresh`);
  await dialog.getByRole('button', { name: '确认纳入新版', exact: true }).click();
  expect((await staleRefreshResponse).status()).toBe(409);
  await expect(dialog.getByText('纳入未完成', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/世界已在其他窗口更新/)).toBeVisible();

  const branchAfter409 = (await getDetail(request, world.id, branch.id)).branch;
  expect(branchAfter409.revision).toBe(branchBefore409.revision);
  expect(branchAfter409.sourceRevision).toBe(branchBefore409.sourceRevision);

  const retryResponse = page.waitForResponse((response) =>
    response.request().method() === 'GET'
    && new URL(response.url()).pathname === `${portalApi}/${world.id}/branches/${branch.id}/sources/preview`);
  await dialog.getByRole('button', { name: '重新比较', exact: true }).click();
  expect((await retryResponse).status()).toBe(200);
  await expect(dialog.getByText(/世界修订 4/)).toBeVisible();

  const confirmAfterRetry = dialog.getByRole('button', { name: '确认纳入新版', exact: true });
  await expect(confirmAfterRetry).toBeEnabled();

  const recoveredRefreshResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === `${portalApi}/${world.id}/branches/${branch.id}/sources/refresh`);
  await confirmAfterRetry.click();
  expect((await recoveredRefreshResponse).status()).toBe(200);
  await expect(dialog).not.toBeVisible();

  const recoveredDetail = await getDetail(request, world.id, branch.id);
  expect(recoveredDetail.branch.sourceRevision).toBe(thirdUpdatedWorld.revision);
  expect(recoveredDetail.definition.startMinuteOfDay).toBe(780);
  expect(recoveredDetail.definition.sources.find((item) => item.id === 'source-main')?.content)
    .toContain('第四版资料');
  const finalEvents = await getEvents(request, world.id, branch.id);
  expect(finalEvents.items.map((event) => event.id)).toEqual(eventSnapshot.map((event) => event.id));
  for (const snapshot of eventSnapshot) {
    expect(finalEvents.items.find((event) => event.id === snapshot.id)?.summary).toBe(snapshot.summary);
  }
});
