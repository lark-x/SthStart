import { expect, test, type Page } from '@playwright/test';

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

test('1280×720 下主生成动作与活动阶段入口可见', async ({ page }) => {
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

  // 活动页：当前阶段与生成入口。
  await page.goto('/apps/activities');
  await page.waitForTimeout(400);
  const hrefs = await page
    .locator('a[href]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
  const activityPath = hrefs.find(
    (href) =>
      href.indexOf('/apps/activities/') === 0 &&
      href !== '/apps/activities/new' &&
      href.length > '/apps/activities/'.length + 6
  );
  if (!activityPath) {
    test.info().annotations.push({ type: 'warning', description: '没有可打开的活动，跳过活动页检查' });
  } else {
    await page.goto(activityPath);
    await page.waitForTimeout(600);
    const stage = page.getByText('当前阶段').first();
    if (!(await stage.isVisible())) failures.push('活动页在 1280×720 下看不到当前阶段');
    const generate = page.getByRole('button', { name: 'AI 生成内容' }).first();
    if ((await generate.count()) === 0) failures.push('活动页找不到生成入口');
    else if (!(await generate.isVisible())) failures.push('活动页生成入口不可见');
  }

  expect(failures.length, failures.join('\n')).toBe(0);
});

test('主题切换与侧栏收起不丢输入、不重置选择、不跳滚动', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/apps/activities/new');

  const title = page.getByLabel('活动标题');
  await expect(title).toBeVisible();
  await title.fill('保持输入的验证标题');

  // 选一个非默认的下拉值，确认选项不被重置。
  const template = page.getByLabel('选择活动模板');
  await template.selectOption({ label: '日常聚会' });
  /*
   * 切换模板会先弹确认框（「应用模板会替换下面列出的内容」），这是产品为
   * 防止误覆盖阶段内容做的保护（§7.2 离开与覆盖保护），不是缺陷。
   * 这里确认它，同时断言已填写的标题没有被覆盖。
   */
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText('应用模板会替换下面列出的内容')).toBeVisible();
  await confirm.getByRole('button', { name: '应用模板' }).click();
  await expect(confirm).toBeHidden();
  await expect(title, '确认模板后标题不应被覆盖').toHaveValue('保持输入的验证标题');
  const chosenTemplate = await template.inputValue();
  expect(chosenTemplate).not.toBe('blank');

  // 滚动到页面中部，确认切换后不跳回顶部。
  await page.evaluate(() => window.scrollTo(0, 400));
  const before = await page.evaluate(() => window.scrollY);

  // 切换主题（侧栏底部的护眼开关）。
  await page.getByRole('button', { name: /护眼/ }).first().click();
  await expect(page.locator('html')).toHaveAttribute('data-eye-care', 'true');

  // 收起侧栏。
  await page.getByRole('button', { name: /收起|展开/ }).first().click();
  await page.waitForTimeout(300);

  await expect(title, '主题与侧栏变化后标题输入应保留').toHaveValue('保持输入的验证标题');
  await expect(template, '主题与侧栏变化后下拉选择应保留').toHaveValue(chosenTemplate);

  const after = await page.evaluate(() => window.scrollY);
  expect(Math.abs(after - before), `滚动位置从 ${before} 跳到 ${after}`).toBeLessThanOrEqual(8);

  // 复原，避免影响后续用例的显示偏好。
  await page.getByRole('button', { name: /护眼/ }).first().click();
  await page.getByRole('button', { name: /收起|展开/ }).first().click();
});
