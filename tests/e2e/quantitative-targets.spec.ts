import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const service = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT ?? 4200}`;
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };

/**
 * 计划 §11.3 中此前没有实测的三条可量化目标：
 *   1. 1440×900 下列表第一页内容顶部距视口顶部不超过约 240px；
 *   2. 1280×720 下生成页能看见主生成动作或明确的配置阻塞入口，活动页能定位当前阶段与生成/编辑入口；
 *   3. 主题切换、侧栏展开不丢输入、不重置选择、不跳滚动。
 */

test.describe.configure({ timeout: 120_000 });

/** 第一个列表项/卡片相对视口的顶部偏移。返回 null 表示该页当前没有可测内容。 */
async function firstItemTop(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    if (rect.height < 4) return null;
    return Math.round(rect.top);
  }, selector);
}

test('列表页首屏内容顶部在 1440×900 下不超过 240px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  const targets: Array<{ path: string; name: string; selector: string }> = [
    { path: '/apps/characters', name: '角色库', selector: 'main article' },
    { path: '/apps/activities', name: '活动列表', selector: 'main a[href*="/apps/activities/"]' },
  ];

  const failures: string[] = [];
  let measured = 0;

  for (const target of targets) {
    const response = await page.goto(target.path, { waitUntil: 'load' });
    if (response && response.status() >= 400) continue;
    await page.waitForTimeout(500);
    const top = await firstItemTop(page, target.selector);
    if (top === null) continue;
    measured += 1;
    if (top > 240) failures.push(`${target.name} 第一项顶部距视口 ${top}px，超过 240px`);
  }

  expect(measured, '至少测到一个列表页').toBeGreaterThan(0);
  expect(failures.length, failures.join('\n')).toBe(0);
});

test('1280×720 下生成配置入口与活动工作区主要操作可见', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });

  const failures: string[] = [];

  // 生成配置页：主生成动作，或明确的配置阻塞入口。
  await page.goto('/settings/generation');
  await page.waitForTimeout(600);
  const generationEntry = page
    .locator('main')
    .getByRole('button', { name: /生成|保存|新建|刷新/ })
    .first();
  if ((await generationEntry.count()) === 0) {
    failures.push('生成配置页在 1280×720 下找不到主生成动作或配置入口');
  } else if (!(await generationEntry.isVisible())) {
    failures.push('生成配置页的主动作存在但不可见');
  } else {
    const box = await generationEntry.boundingBox();
    if (!box || box.y > 720) failures.push('生成配置页主动作在首屏之外');
  }

  /*
   * 活动工作区：左侧「剧情大纲」定位当前幕，展开的当前幕下有「加场」，
   * 中间场次工具条有「添加分镜」。自建一场带场次与分镜的活动，不依赖其他用例留下的数据。
   */
  const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  const stage = document.stages[0];
  document.scenes = [{
    id: 'scene-quantitative-1280', stageId: stage.id, title: '营地搭建', timeText: '午后', locationText: '湖边营地',
    environment: '', orderIndex: 0,
    beats: [{ id: 'beat-quantitative-1280', sceneId: 'scene-quantitative-1280', stageId: stage.id, characterId: 'narrator',
      characterName: '旁白', action: '支起帐篷', dialogue: '', outcome: '', orderIndex: 0 }],
  }];
  const created = await request.post(`${service}/api/v1/admin/activities`, { headers, data: { document } });
  expect(created.ok()).toBeTruthy();
  const { activity } = await created.json();
  await page.goto(`/apps/activities/${activity.id}`);
  const outline = page.getByRole('complementary').filter({ hasText: '剧情大纲' });
  await expect(outline, '活动页应渲染剧情大纲').toBeVisible({ timeout: 15_000 });

  const checkVisible = async (locator: Locator, message: string) => {
    if ((await locator.count()) === 0) failures.push(`${message}：找不到`);
    else if (!(await locator.isVisible())) failures.push(`${message}：存在但不可见`);
    else {
      const box = await locator.boundingBox();
      if (!box || box.y > 720) failures.push(`${message}：在首屏之外`);
    }
  };
  await checkVisible(outline.getByRole('button', { name: new RegExp(stage.title) }).first(), '活动页在 1280×720 下看不到当前幕');
  await checkVisible(outline.getByRole('button', { name: '加场' }), '活动页看不到当前幕的加场入口');
  await checkVisible(page.getByLabel('场次标题'), '活动页看不到当前场次标题');
  await checkVisible(page.getByRole('button', { name: '添加分镜' }), '活动页看不到分镜编辑入口');

  expect(failures.length, failures.join('\n')).toBe(0);
});

test('主题切换与侧栏收起不丢输入、不重置选择、不跳滚动', async ({ page }) => {
  // 主题 ID 与 app/lib/theme-preference.ts 的 THEMES 一致：从云白（light-zinc）切到暖白（light-paper）。
  await page.addInitScript(() => window.localStorage.setItem('sthstart_theme_id', 'light-zinc'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/apps/activities/new');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light-zinc');

  /*
   * 新建页默认是快速制作入口（章节 / 角色 / 空白）；带标题与模板下拉的表单在
   * 「切换传统企划向导」后出现。hydration 前的点击可能被丢弃，重试到标题输入出现为止。
   */
  const title = page.getByLabel('活动标题');
  await expect(async () => {
    if (!(await title.isVisible())) await page.getByRole('button', { name: '切换传统企划向导' }).click();
    await expect(title).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await title.fill('保持输入的验证标题');

  /*
   * 选一个非默认的下拉值，确认选项不被重置。
   * 手动表单已移除，这里用的是向导第一步的「活动模板」下拉；
   * 向导切换模板不弹确认框（模板只带出类型/主题/地点/规则，不覆盖已填标题）。
   */
  const template = page.getByLabel('活动模板');
  await template.selectOption({ label: '日常聚会' });
  await expect(title, '切换模板后标题不应被覆盖').toHaveValue('保持输入的验证标题');
  const chosenTemplate = await template.inputValue();
  expect(chosenTemplate).not.toBe('blank');

  // 滚动到页面中部，确认切换后不跳回顶部。
  await page.evaluate(() => window.scrollTo(0, 400));
  const before = await page.evaluate(() => window.scrollY);

  // 切换主题：侧栏底部的「选择主题与外观」菜单里选暖白。
  const sidebar = page.getByRole('complementary', { name: '侧边导航' });
  const chooseTheme = async (name: string, id: string) => {
    await sidebar.getByRole('button', { name: /^选择主题与外观/ }).click();
    await page.getByRole('menu', { name: '主题与外观' }).getByRole('menuitemradio', { name: new RegExp(`^${name}`) }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', id);
  };
  await chooseTheme('暖白', 'light-paper');

  // 收起侧栏。
  const collapse = sidebar.getByRole('button', { name: '收起导航' });
  await collapse.click();
  await expect(sidebar.getByRole('button', { name: '展开导航' })).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(300);

  await expect(title, '主题与侧栏变化后标题输入应保留').toHaveValue('保持输入的验证标题');
  await expect(template, '主题与侧栏变化后下拉选择应保留').toHaveValue(chosenTemplate);

  const after = await page.evaluate(() => window.scrollY);
  expect(Math.abs(after - before), `滚动位置从 ${before} 跳到 ${after}`).toBeLessThanOrEqual(8);

  // 复原，避免影响后续用例的显示偏好。
  await chooseTheme('云白', 'light-zinc');
  await sidebar.getByRole('button', { name: '展开导航' }).click();
  await expect(collapse).toHaveAttribute('aria-pressed', 'false');
});
