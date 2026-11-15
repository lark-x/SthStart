import { expect, test } from '@playwright/test';

test('mobile navigation keeps focus and scroll inside the drawer until it closes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 400 });
  await page.goto('/apps/calendar');
  await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');
  const scroll = () => page.evaluate(() => window.scrollY);
  await page.mouse.move(195, 300);
  await page.mouse.wheel(0, 140);
  await expect.poll(scroll).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(scroll).toBe(0);

  const trigger = page.getByRole('button', { name: '打开全站导航', exact: true });
  const nav = page.getByRole('dialog', { name: '导航', exact: true });
  await trigger.click();
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('button', { name: '关闭抽屉', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await nav.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  // Focusing the underlying invoker while the modal is open must not move focus out of it.
  await trigger.evaluate(el => (el as HTMLElement).focus());
  expect(await nav.evaluate((el) => el.contains(document.activeElement))).toBe(true);

  const command = page.getByRole('dialog', { name: '命令快捷菜单' });
  await page.keyboard.press('Control+k');
  await expect(nav).toBeVisible();
  await expect(command).toBeHidden();
  await page.mouse.move(195, 290);
  await page.mouse.wheel(0, 1200);
  await page.mouse.wheel(0, 1200);
  // Scroll is asynchronous. The same two wheel gestures below move the page when the drawer is closed.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await scroll()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(nav).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(command).toBeVisible();
  await expect(command.getByRole('textbox', { name: '搜索命令' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(command).toBeHidden();
  await page.mouse.wheel(0, 1200);
  await expect.poll(scroll).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await trigger.click();
  await expect(nav).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 400 });
  await expect(nav).toBeHidden();
  await expect(page.getByRole('complementary', { name: '侧边导航' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 400 });
  await expect(trigger).toBeVisible();
  await expect(nav).toBeHidden();
  await page.mouse.move(195, 290);
  await page.mouse.wheel(0, 1200);
  await expect.poll(scroll).toBeGreaterThan(0);
});

test('split panes recompute their scroll boundary on height-only resize', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/apps/creative');
  await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');
  const panes = page.locator('.creative-split');
  const left = panes.locator(':scope > [aria-label="生成参数"]');
  const right = panes.locator(':scope > [aria-label="生成结果"]');
  const heights = () => panes.evaluate(el => [...el.children]
    .filter(child => child.hasAttribute('aria-label') && child.getAttribute('role') !== 'separator')
    .map(child => child.getBoundingClientRect().height));
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();
  const before = await heights();
  expect(before).toHaveLength(2);
  expect(Math.min(...before)).toBeGreaterThan(600);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(async () => Math.max(...(await heights()).map((height, index) =>
    Math.abs(before[index] - height - 200)))).toBeLessThanOrEqual(2);
  for (const pane of [left, right]) {
    await expect(pane).toHaveCSS('overflow-y', 'auto');
    const box = await pane.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(901);
  }
  const scroll = () => page.evaluate(() => window.scrollY);
  await page.setViewportSize({ width: 1440, height: 620 });
  await page.getByRole('tab', { name: '首尾帧视频', exact: true }).click();
  await expect(page.getByRole('tab', { name: '首尾帧视频', exact: true })).toHaveAttribute('aria-selected', 'true');
  const box = (await left.boundingBox())!;
  await expect.poll(() => left.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 240);
  await expect.poll(() => left.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await right.evaluate(el => el.scrollTop)).toBe(0);
  expect(await scroll()).toBe(0);
});

test.describe('runtime failure response', () => {
  test.use({ serviceWorkers: 'block' });
  test('runtime errors do not masquerade as stopped services', async ({ page }) => {
    const injected = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/runtime/overview') && response.status() === 503);
    await page.route('**/runtime/overview', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
    await page.goto('/');
    await injected;
    const strip = page.getByRole('region', { name: '本地服务状态' });
    await expect(strip).toContainText('暂时无法确认服务状态', { timeout: 20_000 });
    await expect(strip).not.toContainText('尚未启动');
    await expect(strip).not.toContainText('最近异常 0');
  });
});
