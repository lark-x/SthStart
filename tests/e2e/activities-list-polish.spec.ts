import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isOwnedDirectory } from './global-setup';

/*
 * 制作项目列表的浏览与破坏性操作：
 *   - 计数在数据到达前不谎报 0；
 *   - 搜索无结果时给出针对搜索的空状态，并能一键清空；
 *   - 删除走共享确认弹窗（含对象名称、后果、默认聚焦取消），取消后不删除；
 *   - 归档后列表切换到「已归档」仍可找回，并可恢复。
 */
const service = 'http://127.0.0.1:' + (process.env.E2E_SERVICE_PORT ?? 4200) + '/api/v1/admin';
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
const prefix = '列表打磨-' + randomUUID().slice(0, 8);

async function seedActivity(request: APIRequestContext, title: string) {
  const fixture = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  fixture.activity.title = title;
  const created = await request.post(service + '/activities', { headers, data: { document: fixture } });
  expect(created.status()).toBe(201);
  return (await created.json() as { activity: { id: string; headVersion: number } }).activity;
}

test.beforeAll(async ({ request }) => {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  await seedActivity(request, prefix + '待删除');
  await seedActivity(request, prefix + '待归档');
});

test.beforeEach(async ({ context }) => {
  const portal = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
  expect((await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } })).ok()).toBe(true);
});

test('列表计数、搜索空状态与清空搜索', async ({ page }) => {
  await page.goto('/apps/activities?q=' + encodeURIComponent(prefix));
  // 总数只在分页处出现一次（同一状态不重复）；列表页头不再另写「共 N 个制作项目」。
  const count = page.getByRole('navigation', { name: '分页', exact: true });
  await expect(count).toContainText('共 2 条');
  await expect(page.getByRole('link', { name: prefix + '待删除' })).toBeVisible();

  const search = page.getByLabel('搜索制作项目');
  await search.fill('不存在的关键词-' + randomUUID().slice(0, 6));
  await expect(page.getByRole('heading', { name: /没有匹配/ })).toBeVisible();
  await expect(count).toContainText('共 0 条');

  await page.getByRole('button', { name: '清空搜索' }).first().click();
  await expect(search).toHaveValue('');
  await expect(page.getByRole('link', { name: prefix + '待删除' })).toBeVisible();
  // 清空后列出全部制作项目；共享测试库里其他用例也会写入，只要求至少包含本用例的两条。
  await expect.poll(async () => Number((await count.innerText()).match(/共\s*(\d+)\s*条/)?.[1] ?? 0)).toBeGreaterThanOrEqual(2);
});

test('删除需要确认弹窗，取消不会删除，确认后才移除', async ({ page, request }) => {
  const target = prefix + '待删除';
  await page.goto('/apps/activities?q=' + encodeURIComponent(prefix));
  const row = page.getByRole('listitem').filter({ hasText: target });
  await row.getByRole('button', { name: `管理制作项目 ${target}` }).click();
  await page.getByRole('menuitem', { name: '删除制作项目' }).click();

  const dialog = page.getByRole('dialog', { name: '彻底删除制作项目？' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`《${target}》`);
  await expect(dialog).toContainText('无法撤销');
  await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused();

  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('link', { name: target })).toBeVisible();
  expect((await request.get(service + '/activities?q=' + encodeURIComponent(target), { headers })).ok()).toBe(true);

  await row.getByRole('button', { name: `管理制作项目 ${target}` }).click();
  await page.getByRole('menuitem', { name: '删除制作项目' }).click();
  await dialog.getByRole('button', { name: '彻底删除' }).click();
  await expect(page.getByRole('link', { name: target })).toBeHidden();
  await expect(page.getByRole('navigation', { name: '分页', exact: true })).toContainText('共 1 条');
});

test('删除失败时错误留在页面内，确认框保持打开', async ({ page }) => {
  const target = prefix + '待归档';
  await page.goto('/apps/activities?q=' + encodeURIComponent(prefix));
  const row = page.getByRole('listitem').filter({ hasText: target });

  await page.route('**/api/admin/activities/*', async route => {
    if (route.request().method() !== 'DELETE') return route.continue();
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '服务端暂时不可用' }) });
  });

  await row.getByRole('button', { name: `管理制作项目 ${target}` }).click();
  await page.getByRole('menuitem', { name: '删除制作项目' }).click();
  const dialog = page.getByRole('dialog', { name: '彻底删除制作项目？' });
  await dialog.getByRole('button', { name: '彻底删除' }).click();

  await expect(dialog).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: '操作失败' })).toBeVisible();
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('link', { name: target })).toBeVisible();
});

test('归档后进入「已归档」可找回并恢复', async ({ page }) => {
  const target = prefix + '待归档';
  await page.goto('/apps/activities?q=' + encodeURIComponent(prefix));
  const row = page.getByRole('listitem').filter({ hasText: target });
  await row.getByRole('button', { name: `管理制作项目 ${target}` }).click();
  await page.getByRole('menuitem', { name: '归档制作项目' }).click();
  await expect(page.getByRole('link', { name: target })).toBeHidden();

  await page.getByRole('tab', { name: '已归档' }).click();
  await expect(page.getByRole('link', { name: target })).toBeVisible();
  const archivedRow = page.getByRole('listitem').filter({ hasText: target });
  await expect(archivedRow.getByText('已归档', { exact: true })).toBeVisible();
  await archivedRow.getByRole('button', { name: `管理制作项目 ${target}` }).click();
  await page.getByRole('menuitem', { name: '恢复制作项目' }).click();
  /* 恢复后该行离开已归档；此时搜索词仍在，因此先给搜索空状态，清空后才给归档空状态。 */
  await expect(page.getByRole('link', { name: target })).toBeHidden();
  await expect(page.getByRole('heading', { name: /没有匹配/ })).toBeVisible();
  await page.getByRole('button', { name: '清空搜索' }).first().click();
  await expect(page.getByRole('heading', { name: '暂无已归档制作项目' })).toBeVisible();
  await expect(page.getByRole('link', { name: '查看活跃制作项目' })).toBeVisible();
});
