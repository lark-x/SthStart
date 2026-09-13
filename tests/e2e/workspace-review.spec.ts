import { expect, test } from '@playwright/test';

test('mobile navigation and command menu share focus and scroll locking', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/apps/calendar');
  const nav = page.getByRole('dialog', { name: '导航', exact: true });
  await expect(async () => {
    if (!(await nav.isVisible())) await page.getByRole('button', { name: '打开导航', exact: true }).click();
    await expect(nav).toBeVisible({ timeout: 500 });
  }).toPass();
  await expect(page.getByRole('button', { name: '关闭导航', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await nav.evaluate((el) => el.contains(document.activeElement))).toBe(true);

  await page.keyboard.press('Control+k');
  const command = page.getByRole('dialog', { name: '命令快捷菜单' });
  await expect(command).toBeVisible();
  await expect(page.getByRole('textbox', { name: '搜索命令' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await command.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: '搜索命令' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(command).not.toBeVisible();
  await expect(nav).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await page.setViewportSize({ width: 1440, height: 844 });
  await expect(nav).not.toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('split panes recompute their scroll boundary on height-only resize', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/apps/calendar');
  const panes = page.locator('.split-panes').first();
  const available = () => panes.evaluate((el) => Number.parseFloat((el as HTMLElement).style.getPropertyValue('--split-available')));
  await expect.poll(available).toBeGreaterThan(600);
  const before = await available();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(available).toBe(before - 200);
});

test('runtime errors do not masquerade as stopped services', async ({ page }) => {
  await page.route('**/runtime/overview', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.goto('/');
  const strip = page.getByRole('region', { name: '本地服务状态' });
  await expect(strip).toContainText('暂时无法确认服务状态', { timeout: 20_000 });
  await expect(strip).not.toContainText('尚未启动');
  await expect(strip).not.toContainText('最近异常 0');
});
