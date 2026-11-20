import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { isOwnedDirectory } from './global-setup';
test.use({ serviceWorkers: 'block', deviceScaleFactor: 2 });

const portal = `http://127.0.0.1:${process.env.E2E_PORTAL_PORT ?? '4273'}`;
const admin = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT ?? '4200'}/api/v1/admin`;
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };

test('name-only creation is immediately visible after reload, without story configuration', async ({ page, context }, testInfo) => {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY || '')).toBe(true);
  await context.request.post(`${portal}/api/auth/admin-session`, { headers: { origin: portal } });
  const name = `新建即显示-${randomUUID().slice(0, 8)}`;
  await page.goto('/apps/story-worlds/new');
  await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');
  await page.getByRole('textbox', { name: '作品名称' }).fill(name);
  await expect(page.getByRole('textbox')).toHaveCount(1);
  await page.getByRole('button', { name: '创建作品', exact: true }).click();
  await expect(page).toHaveURL(/\/apps\/story-worlds\?created=/);
  await expect(page.getByRole('status').filter({ hasText: name })).toBeVisible();
  await page.reload();
  const row = page.getByRole('list', { name: '作品列表' }).getByRole('listitem').filter({ hasText: name });
  await expect(row.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(row.getByRole('link', { name: '配置故事' })).toBeVisible();
  for (const width of [390, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`works-${width}.png`), fullPage: true });
  }
  await row.getByRole('link', { name: '查看角色' }).click();
  await expect(page).toHaveURL(/\/apps\/characters\?/);
  const browse = await context.request.get(`${admin}/characters/browse`, { headers });
  expect((await browse.json()).facets.works.some((work: { name: string }) => work.name === name)).toBe(true);
});

test('catalog-only and derivative works remain visible without characters and can configure a story', async ({ page, context }) => {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY || '')).toBe(true);
  await context.request.post(`${portal}/api/auth/admin-session`, { headers: { origin: portal } });
  const name = `纯目录-${randomUUID().slice(0, 8)}`;
  const mother = await context.request.put(`${admin}/characters/works`, { headers, data: { name, workNature: 'canon', aliases: ['检索别名' + name], mediaType: '' } });
  expect(mother.ok(), await mother.text()).toBe(true);
  await page.goto('/apps/story-worlds');
  const row = page.getByRole('listitem').filter({ hasText: name });
  await expect(row.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: '搜索作品' }).fill('检索别名' + name);
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: '配置故事' }).click();
  await expect(page.getByRole('textbox', { name: '作品名称' })).toHaveValue(name);
  await page.getByRole('button', { name: '继续配置故事' }).click();
  await expect(page).toHaveURL(/\/setup$/);
  await page.goto('/apps/story-worlds');
  await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(1);
  await page.getByRole('link', { name: '新建作品', exact: true }).click();
  await page.getByRole('radio', { name: '同人', exact: true }).check();
  await page.getByRole('textbox', { name: '作品名称' }).fill(name + '-同人');
  await page.getByRole('combobox', { name: '所属母原作' }).fill(name);
  await page.getByRole('button', { name: '创建作品', exact: true }).click();
  await expect(page).toHaveURL(/\?created=/);
  await expect(page.getByRole('heading', { name: name + '-同人', exact: true })).toBeVisible();
});

test('a failed pending list remains visible as an error beside other works', async ({ page, context }) => {
  await context.request.post(`${portal}/api/auth/admin-session`, { headers: { origin: portal } });
  await page.route('**/api/admin/story-worlds/setups', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable', message: '暂时不可用' }) }));
  await page.goto('/apps/story-worlds');
  await expect(page.getByText('部分作品暂时无法读取')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: '重新读取' })).toBeVisible();
});
