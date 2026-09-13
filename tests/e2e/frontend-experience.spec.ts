import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const service = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT ?? 4200}`;
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };

test('activity merges edits during slow saving and commits the latest title once', async ({ page, request }) => {
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
  await page.getByRole('tab', { name: '设定', exact: true }).click();
  await page.getByLabel('活动标题', { exact: true }).fill('正在修改');
  await first;
  await page.getByLabel('活动标题', { exact: true }).fill('最终生日会标题');
  await page.getByRole('button', { name: '保存新版本', exact: true }).click();
  await expect(page.getByText('版本 2', { exact: true })).toBeVisible();
  expect(peakWrites).toBe(1);
  expect(saves.at(-1)).toBe('最终生日会标题');
  const saved = await (await request.get(service + '/api/v1/admin/activities/' + activity.id, { headers })).json();
  expect(saved.activity.title).toBe('最终生日会标题');
  expect(saved.currentContentRevision.document.activity.title).toBe('最终生日会标题');
});

test('activity keeps local input on a real version conflict and lets the user compare', async ({ page, request }) => {
  const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  const { activity } = await (await request.post(service + '/api/v1/admin/activities', { headers, data: { document } })).json();
  await page.goto('/apps/activities/' + activity.id);
  await page.getByRole('tab', { name: '设定', exact: true }).click();
  await expect(page.getByLabel('活动标题', { exact: true })).toBeVisible();
  document.activity.title = '另一个窗口的标题';
  expect((await request.put(service + `/api/v1/admin/activities/${activity.id}/draft`, { headers, data: { expectedDraftVersion: 1, document } })).ok()).toBeTruthy();
  await page.getByLabel('活动标题', { exact: true }).fill('保留我的输入');
  await expect(page.getByRole('button', { name: '比较与恢复' })).toBeVisible();
  await expect(page.getByLabel('活动标题', { exact: true })).toHaveValue('保留我的输入');
  await page.getByRole('button', { name: '比较与恢复' }).click();
  await page.getByRole('button', { name: '保留本地输入并保存' }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const draft = await (await request.get(service + `/api/v1/admin/activities/${activity.id}/draft`, { headers })).json();
  expect(draft.document.activity.title).toBe('保留我的输入');
});

/**
 * 导航契约：应用入口常驻侧栏（>=1024px），窄屏改由抽屉提供同一份注册表。
 * 原先的“每页都应有切换应用下拉框”断言随外框改造失效——下拉框已被常驻导航取代，
 * 这里改为断言同一意图：任意应用页都能到达其他应用入口。
 */
const ROUTE_NAV_LABEL: Record<string, string> = {
  '/apps/activities': '活动',
  '/apps/creative': '图像与视频',
  '/apps/characters': '角色',
  '/apps/notebook': '笔记',
  '/apps/narrative': '叙事档案',
  '/settings/public-services': '模型与公共服务',
  '/settings/generation': '生成配置',
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
      if (width >= 1024) {
        await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: label })).toBeVisible();
      } else {
        const drawer = page.getByRole('dialog', { name: '导航' });
        /*
         * 「打开导航」按钮在 hydration 前就已由 SSR 渲染可见，此时点击会被丢弃。
         * 全量并发跑时这段窗口变长，因此重试点击直到抽屉真正出现；
         * 断言仍然是「窄屏下能从导航抽屉到达每个应用」。
         */
        const openNav = page.getByRole('button', { name: '打开导航' });
        for (let attempt = 0; attempt < 12 && !(await drawer.isVisible()); attempt += 1) {
          await openNav.click();
          await page.waitForTimeout(150);
        }
        await expect(drawer.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: label })).toBeInViewport();
        await page.keyboard.press('Escape');
        await expect(drawer).toBeHidden();
      }
    }
  });
}
