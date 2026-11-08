import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const service = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT ?? 4200}`;
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };

test('activity merges edits during slow saving and saves the latest title once', async ({ page, request }) => {
  const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  const created = await request.post(service + '/api/v1/admin/activities', { headers, data: { document } });
  const { activity } = await created.json();
  let activeWrites = 0, peakWrites = 0;
  const saves: string[] = [];
  let firstStarted!: () => void;
  const first = new Promise<void>(resolve => { firstStarted = resolve; });
  await page.route(`**/api/admin/activities/${activity.id}/draft`, async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    activeWrites++; peakWrites = Math.max(peakWrites, activeWrites);
    saves.push(route.request().postDataJSON().document.activity.title);
    if (saves.length === 1) firstStarted();
    await new Promise(resolve => setTimeout(resolve, 600));
    await route.fulfill({ response: await route.fetch() });
    activeWrites--;
  });
  await page.goto('/apps/activities/' + activity.id);
  /*
   * 「内容 → 设定」tab 已移除：活动标题改在工作室页头行内编辑，
   * 回车（或失焦）后并入草稿，停止输入后自动保存。
   */
  const title = page.getByLabel('活动标题', { exact: true });
  await title.fill('正在修改');
  await title.press('Enter');
  await first;
  // 第一次写入仍在进行（被拦截延迟 600ms）时继续修改，新输入必须排在其后合并写入，不能并发写。
  await title.fill('最终生日会标题');
  await title.press('Enter');
  await expect.poll(() => saves.at(-1), { timeout: 15_000 }).toBe('最终生日会标题');
  await expect(page.getByRole('status').getByText('已保存')).toBeVisible({ timeout: 15_000 });
  expect(peakWrites).toBe(1);
  /*
   * 「保存新版本」手动提交按钮已随工作室改版移除（菜单中只剩美术指导 / 批量出图 / 活动设置 / 导出交付），
   * 因此不再断言「版本 2」与内容版本标题，改为核对草稿与页头都保留了最后一次输入。
   */
  await expect(title).toHaveValue('最终生日会标题');
  await expect(page.getByRole('heading', { name: '最终生日会标题', level: 1 })).toBeAttached();
  const draft = await (await request.get(service + `/api/v1/admin/activities/${activity.id}/draft`, { headers })).json();
  expect(draft.document.activity.title).toBe('最终生日会标题');
});

test('activity keeps local input on a real version conflict and lets the user compare', async ({ page, request }) => {
  const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  const { activity } = await (await request.post(service + '/api/v1/admin/activities', { headers, data: { document } })).json();
  await page.goto('/apps/activities/' + activity.id);
  const title = page.getByLabel('活动标题', { exact: true });
  await expect(title).toHaveValue(document.activity.title);
  document.activity.title = '另一个窗口的标题';
  expect((await request.put(service + `/api/v1/admin/activities/${activity.id}/draft`, { headers, data: { expectedDraftVersion: 1, document } })).ok()).toBeTruthy();
  await title.fill('保留我的输入');
  await title.press('Enter');
  /*
   * 「比较与恢复」对话框已改为页头下方的冲突提示条：说明本机输入仍保留，
   * 并提供「保留本机内容并重试 / 载入服务器版本」两个动作（各自先弹确认框）。
   * 旧对话框里的逐字段差异对比已随改版移除。
   */
  const conflict = page.getByRole('alert').filter({ hasText: '服务器草稿已更新。你的输入仍保留在此页面。' });
  await expect(conflict).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('status').getByText('草稿冲突，请在设置中处理')).toBeVisible();
  await expect(title).toHaveValue('保留我的输入');
  await expect(conflict.getByRole('button', { name: '载入服务器版本' })).toBeVisible();
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await conflict.getByRole('button', { name: '保留本机内容并重试' }).click();
  await expect(conflict).toBeHidden();
  await expect(page.getByRole('status').getByText('已保存', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(title).toHaveValue('保留我的输入');
  const draft = await (await request.get(service + `/api/v1/admin/activities/${activity.id}/draft`, { headers })).json();
  expect(draft.document.activity.title).toBe('保留我的输入');
});

/**
 * 导航契约：应用入口常驻侧栏（>=1024px），窄屏改由抽屉提供同一份注册表。
 * 原先的“每页都应有切换应用下拉框”断言随外框改造失效——下拉框已被常驻导航取代，
 * 这里改为断言同一意图：任意应用页都能到达其他应用入口。
 */
/*
 * 主导航随产品重构收敛为 工作台/创作项目/资料库/角色库/媒体库/自由生成/创作日历/邻舍/系统设置。
 * 旧入口（制作、笔记、叙事档案、设置子页）不再单独出现在侧栏，而是归到所属的新入口下
 * （navigation.tsx 的 activePaths）。这里断言每个页面都能到达所属入口，且该入口被标为当前页。
 */
const ROUTE_NAV_LABEL: Record<string, string> = {
  '/apps/projects': '创作项目',
  '/apps/activities': '创作项目',
  '/apps/resources': '资料库',
  '/apps/notebook': '资料库',
  '/apps/narrative': '资料库',
  '/apps/characters': '角色库',
  '/apps/media': '媒体库',
  '/apps/creative': '自由生成',
  '/apps/calendar': '创作日历',
  '/settings/public-services': '系统设置',
  '/settings/generation': '系统设置',
};

for (const width of [390, 1440]) {
  test(`working surfaces fit ${width}px and retain application navigation`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', ...Object.keys(ROUTE_NAV_LABEL)]) {
      await page.goto(route);
      await expect(page.locator('main')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), route).toBeTruthy();
      if (route === '/') continue;

      const label = ROUTE_NAV_LABEL[route];
      /*
       * 叙事档案的阅读模式是专注工作台（app-shell 的 embed 外框）：没有常驻侧栏，
       * 由页头「打开全站导航」打开同一份导航抽屉。其余页面宽屏走常驻侧栏、窄屏走「打开导航」。
       */
      const sidebar = page.getByRole('complementary', { name: '侧边导航' });
      if (width >= 1024 && await sidebar.count()) {
        const link = sidebar.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: label, exact: true });
        await expect(link, route).toBeVisible();
        await expect(link, route).toHaveAttribute('aria-current', 'page');
      } else {
        const drawer = page.getByRole('dialog', { name: '导航' });
        /*
         * 打开导航的按钮在 hydration 前就已由 SSR 渲染可见，此时点击会被丢弃。
         * 全量并发跑时这段窗口变长，因此重试点击直到抽屉真正出现；
         * 断言仍然是「能从导航抽屉到达每个应用」。
         */
        const openNav = page.getByRole('button', { name: '打开导航', exact: true }).or(page.getByRole('button', { name: '打开全站导航', exact: true }));
        await expect(openNav.first(), route).toBeVisible();
        for (let attempt = 0; attempt < 12 && !(await drawer.isVisible()); attempt += 1) {
          await openNav.first().click();
          await page.waitForTimeout(150);
        }
        const link = drawer.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: label, exact: true });
        await expect(link, route).toBeInViewport();
        await expect(link, route).toHaveAttribute('aria-current', 'page');
        await page.keyboard.press('Escape');
        await expect(drawer).toBeHidden();
      }
    }
  });
}
