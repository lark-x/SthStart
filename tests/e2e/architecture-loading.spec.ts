import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { isOwnedDirectory } from './global-setup';

// A service worker can serve cached modules without entering Playwright's request routing.
test.use({ serviceWorkers: 'block' });

test('工作台加载失败可重试，保留外层编辑内容且重复打开正常', async ({ page, request, baseURL }) => {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  const service = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT ?? 4200}/api/v1/admin`;
  const config = readFileSync('playwright.config.ts', 'utf8');
  const headers = { 'x-sthstart-admin-token': /const testSecret = '([^']+)'/.exec(config)![1] };
  const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  const response = await request.post(service + '/activities', { headers, data: { document } });
  expect(response.ok()).toBe(true);
  const { activity } = await response.json();
  await page.context().request.post(baseURL + '/api/auth/admin-session', { headers: { origin: baseURL! } });
  let blocked = 0;
  await page.route('**/media-workstation-*.js', route => {
    blocked++;
    return route.abort('failed');
  });
  await page.goto('/apps/activities/' + activity.id);
  const title = page.getByRole('textbox', { name: '活动标题', exact: true });
  await expect(title).toBeVisible();
  const edited = document.activity.title + '保留编辑';
  await title.fill(edited);
  const views = page.getByRole('tablist', { name: '工作台视图' });
  await views.getByRole('tab', { name: '素材制作' }).click();
  await expect(page.getByRole('alert')).toContainText('无法加载素材制作');
  expect(blocked).toBeGreaterThan(0);
  await expect(title).toHaveValue(edited);
  await page.unroute('**/media-workstation-*.js');
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByRole('heading', { name: '图片与视频', exact: true })).toBeVisible();
  await expect(title).toHaveValue(edited);
  await views.getByRole('tab', { name: '分镜漫剧' }).click();
  await views.getByRole('tab', { name: '素材制作' }).click();
  await expect(page.getByRole('heading', { name: '图片与视频', exact: true })).toBeVisible();
  await expect(title).toHaveValue(edited);
});
