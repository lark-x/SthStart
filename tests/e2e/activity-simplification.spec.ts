import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const service = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT || 4200}`;
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };

/* 工作室改为「剧情大纲 / 分镜流 / 镜头工坊」三栏后，活动设定统一在「更多 → 活动设置」抽屉里。 */
async function openSettings(page: Page) {
  await page.getByRole('button', { name: '更多工作台操作' }).click();
  await page.getByRole('menuitem', { name: '活动设置' }).click();
  const drawer = page.getByRole('dialog', { name: '活动全局设置' });
  await expect(drawer).toBeVisible();
  return drawer;
}

test('activity opens on the current screenplay and creates scenes from a single focused action', async ({ page, request }) => {
  const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  document.activity.title = '简明流程验收活动';
  for (const key of ['messages', 'posts', 'comments', 'likes', 'facts', 'mediaSlots', 'stageResults']) document[key] = [];
  const response = await request.post(`${service}/api/v1/admin/activities`, { headers, data: { document } });
  expect(response.ok()).toBeTruthy();
  const { activity } = await response.json();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/apps/activities/${activity.id}`);
  await expect(page.getByRole('heading', { name: '简明流程验收活动', level: 1 })).toBeAttached();
  await expect(page.getByLabel('活动标题', { exact: true })).toHaveValue('简明流程验收活动');
  // 「场次导轨导航」改为左侧「剧情大纲」：幕列表 + 当前幕的「加场」单一主动作。
  await expect(page.getByText('剧情大纲', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '本幕暂无场次' })).toBeVisible();
  const addScene = page.getByRole('button', { name: '加场', exact: true });
  await expect(addScene).toHaveCount(1);
  await expect(page.getByText('not_configured', { exact: true })).toHaveCount(0);
  await addScene.click();
  /*
   * 原来场次标题收在「编辑场次」对话框里；现在场次工具条直接提供行内标题输入，
   * 新场次自带第一个空镜头，可立即写台词。
   */
  await expect(page.getByLabel('场次标题')).toHaveValue('新场次 1');
  await expect(page.getByRole('heading', { name: '本幕暂无场次' })).toHaveCount(0);
  await expect(page.getByLabel('分镜 1 对白')).toBeVisible();
  await expect(page.getByRole('button', { name: '添加分镜', exact: true })).toBeVisible();
});

test('activity view switch stays in the header when there is room and moves into the more menu otherwise', async ({ page, request }) => {
  const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  const response = await request.post(`${service}/api/v1/admin/activities`, { headers, data: { document } });
  expect(response.ok()).toBeTruthy();
  const { activity } = await response.json();

  /*
   * 「活动流程 / 流水线阶段」两套流程导航已合并为页头的「工作台视图」切换
   * （分镜漫剧 / 漫画工坊 / 素材制作）。1280px 下它留在单行页头里；
   * 页头放不下时收进「更多工作台操作」菜单，同样不能撑出横向滚动。
   */
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/apps/activities/${activity.id}`);
  const views = page.getByRole('group', { name: '工作台视图' });
  await expect(views).toBeVisible();
  expect(await views.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(40);
  expect(await views.evaluate((element) => element.closest('header')!.getBoundingClientRect().height)).toBeLessThanOrEqual(52);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();

  await page.setViewportSize({ width: 900, height: 900 });
  await expect(views).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.getByRole('button', { name: '更多工作台操作' }).click();
  const menu = page.getByRole('menu', { name: '更多工作台操作' });
  await expect(menu.getByRole('menuitem', { name: '素材制作' })).toBeVisible();
  await menu.getByRole('menuitem', { name: '素材制作' }).click();
  await expect(page.getByRole('heading', { name: '图片与视频' })).toBeVisible();

  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(views).toBeVisible();
  await expect(views.getByRole('button', { name: '素材制作' })).toHaveAttribute('aria-pressed', 'true');
  expect(await views.evaluate((element) => element.closest('header')!.getBoundingClientRect().height)).toBeLessThanOrEqual(52);
});

test('moving from editing to preview prepares the latest content once without a manual version step', async ({ page, request }) => {
  const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  const response = await request.post(`${service}/api/v1/admin/activities`, { headers, data: { document } });
  expect(response.ok()).toBeTruthy();
  const { activity } = await response.json();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/apps/activities/${activity.id}`);
  /*
   * 群聊台词编辑已随记录视图移除；回放的阶段卡片取自幕次标题，
   * 因此改一个幕次标题作为「进入回放前必须带上的新内容」。
   * 「回放预览」流程按钮改为页头「试演」。
   */
  const stageTitle = '进入试演前自动准备这条新内容';
  const settings = await openSettings(page);
  await settings.getByRole('tab', { name: /幕次目标/ }).click();
  await settings.getByLabel('幕次标题').first().fill(stageTitle);
  await settings.getByRole('button', { name: '完成' }).click();
  await expect(page.getByRole('status').getByText('已保存')).toBeVisible({ timeout: 15_000 });
  const read = async () => (await (await request.get(`${service}/api/v1/admin/activities/${activity.id}`, { headers })).json());
  const draft = await (await request.get(`${service}/api/v1/admin/activities/${activity.id}/draft`, { headers })).json();
  expect(draft.document.stages[0].title).toBe(stageTitle);

  await page.getByRole('button', { name: '试演', exact: true }).click();
  await expect(page.getByText('回放编排与设备模拟预览')).toBeVisible();
  /*
   * 进入预览时应把已保存的草稿准备成正式内容版本，无需手动「保存新版本」。
   * 注意（2026-11-06）：当前 StudioShell 的「试演」只打开浮层，不调用 commit / prepare-context，
   * 浮层按旧的 currentContentRevisionId 编排，预览不到新内容。这是产品回归，断言保持不变。
   */
  await expect.poll(async () => (await read()).currentContentRevision.document.stages[0].title, { timeout: 10_000 }).toBe(stageTitle);
  const version = (await read()).activity.headVersion;
  await page.getByRole('button', { name: '关闭试演预览' }).click();
  await page.getByRole('button', { name: '试演', exact: true }).click();
  await expect(page.getByText('回放编排与设备模拟预览')).toBeVisible();
  expect((await read()).activity.headVersion).toBe(version);
});

/**
* 幕次字段精简：「活动设置 → 幕次目标」每一幕只显示标题与「本幕目标与核心事件」。
* 旧阶段编辑器里收在「更多」的地点 / 结束条件 / 必须发生的行动已随改版移除，不再有编辑入口。
*/
test('stage fields stay compact in the activity settings drawer and save to the draft', async ({ page, request }) => {
  const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  const response = await request.post(`${service}/api/v1/admin/activities`, { headers, data: { document } });
  expect(response.ok()).toBeTruthy();
  const { activity } = await response.json();
  await page.goto(`/apps/activities/${activity.id}`);

  const settings = await openSettings(page);
  await settings.getByRole('tab', { name: /幕次目标/ }).click();
  await expect(settings.getByLabel('幕次标题')).toHaveCount(document.stages.length);
  await expect(settings.getByLabel('本幕目标与核心事件')).toHaveCount(document.stages.length);
  await expect(settings.getByLabel('幕次标题').first()).toHaveValue(document.stages[0].title);
  await expect(settings.getByText('阶段地点')).toHaveCount(0);
  await expect(settings.getByText('阶段结束条件')).toHaveCount(0);

  const instruction = settings.getByLabel('本幕目标与核心事件').first();
  await instruction.fill('确认到场名单');
  await expect(instruction).toHaveValue('确认到场名单');
  await settings.getByRole('button', { name: '完成' }).click();
  await expect(page.getByRole('status').getByText('已保存')).toBeVisible({ timeout: 15_000 });
  /*
   * 编辑先落在草稿上；这里读草稿来验证改动确实被保存了，其余幕次字段原样保留。
   */
  const draft = await (await request.get(`${service}/api/v1/admin/activities/${activity.id}/draft`, { headers })).json();
  expect(draft.document.stages[0].instruction).toBe('确认到场名单');
  expect(draft.document.stages[0].location).toBe(document.stages[0].location);
  expect(draft.document.stages[0].requiredBeats).toEqual(document.stages[0].requiredBeats);
});

/*
 * 「编辑场次」临时对话框（含放弃确认）已随分镜工作台改版移除：场次标题改在场次工具条上
 * 行内编辑并自动保存，时间与地点作为只读信息显示。这里验证行内编辑只改标题、不丢设定字段，
 * 并且窄屏下可从「当前场次」选择器到达同一场次且无横向溢出。
 */
test('scene title is edited inline in the scene toolbar and keeps its setting fields', async ({ page, request }) => {
  const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  const stageId = document.stages[0].id;
  document.scenes = [{
    id: 'scene-compact-edit-test',
    stageId,
    title: '雪山低温萃取',
    timeText: '傍晚 18:30',
    locationText: '龙脊雪山营地',
    environment: '风雪渐起',
    orderIndex: 0,
    beats: [{
      id: 'beat-compact-edit-test',
      sceneId: 'scene-compact-edit-test',
      stageId,
      characterId: 'narrator',
      characterName: '旁白',
      action: '检查实验记录',
      dialogue: '',
      outcome: '',
      orderIndex: 0,
    }],
  }];
  const response = await request.post(`${service}/api/v1/admin/activities`, { headers, data: { document } });
  expect(response.ok()).toBeTruthy();
  const { activity } = await response.json();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/apps/activities/${activity.id}`);

  const sceneTitle = page.getByLabel('场次标题');
  await expect(sceneTitle).toHaveValue('雪山低温萃取');
  await expect(page.getByText('龙脊雪山营地', { exact: true })).toBeVisible();
  await expect(page.getByText('傍晚 18:30', { exact: true })).toBeVisible();
  await expect(page.getByLabel('分镜 1 动作')).toHaveValue('检查实验记录');

  await sceneTitle.fill('新的场次标题');
  await sceneTitle.press('Enter');
  await expect(sceneTitle).toHaveValue('新的场次标题');
  await expect(page.getByRole('status').getByText('已保存')).toBeVisible({ timeout: 15_000 });
  const draft = await (await request.get(`${service}/api/v1/admin/activities/${activity.id}/draft`, { headers })).json();
  const savedScene = draft.document.scenes.find((item: { id: string }) => item.id === 'scene-compact-edit-test');
  expect(savedScene.title).toBe('新的场次标题');
  expect(savedScene.locationText).toBe('龙脊雪山营地');
  expect(savedScene.timeText).toBe('傍晚 18:30');
  expect(savedScene.environment).toBe('风雪渐起');
  expect(savedScene.beats.map((beat: { id: string }) => beat.id)).toEqual(['beat-compact-edit-test']);

  await page.setViewportSize({ width: 390, height: 844 });
  const sceneSelect = page.getByLabel('当前场次');
  await expect(sceneSelect).toBeVisible();
  await expect(sceneSelect.locator('option:checked')).toHaveText('新的场次标题');
  await expect(page.getByLabel('场次标题')).toHaveValue('新的场次标题');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
});
