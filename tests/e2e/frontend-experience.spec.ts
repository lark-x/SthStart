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
  await page.getByRole('button', { name: '设定', exact: true }).click();
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
  await page.getByRole('button', { name: '设定', exact: true }).click();
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

for (const width of [390, 1440]) {
  test(`working surfaces fit ${width}px and retain application navigation`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', '/apps/activities', '/apps/creative', '/apps/characters', '/apps/notebook', '/apps/narrative', '/settings/public-services', '/settings/generation']) {
      await page.goto(route);
      await expect(page.locator('main')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), route).toBeTruthy();
      if (route !== '/') await expect(page.getByRole('combobox', { name: '切换应用' })).toBeVisible();
    }
  });
}
