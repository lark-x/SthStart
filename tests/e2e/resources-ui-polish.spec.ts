import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { isOwnedDirectory } from './global-setup';

const portal = `http://127.0.0.1:${process.env.E2E_PORTAL_PORT ?? 4273}`;
const service = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT ?? 4200}/api/v1/admin`;
const output = resolve('artifacts/visual-verification/resources-polish');
test.use({ deviceScaleFactor: 2 });

test('resource spacing, inline focus and five views across skins and viewports', async ({ page, context, request }) => {
  test.setTimeout(180_000);
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  expect(new URL(portal).port).not.toBe('9320');
  mkdirSync(output, { recursive: true });
  const response = await request.post(`${service}/notebook/notes`, {
    headers: { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' },
    data: { title: '过去的某一个下午', kind: 'diary', stage: 'draft', tags: [],
      summary: '回忆起小时候的某天下午，在外婆家看着动画片。',
      content: [{ id: 'body', type: 'text', text: '回忆起小时候的某天下午，在外婆家看着动画片。老旧电视机放在房间的柜子上，窗外透进一束安静的光。我坐在靠近房门的凳子上，看着故事慢慢展开。' }] },
  });
  expect(response.status()).toBe(201);
  const { id } = await response.json();
  expect((await context.request.post(`${portal}/api/auth/admin-session`, { headers: { origin: portal } })).ok()).toBe(true);
  for (const [theme, skin] of [['dark-espresso', 'genshin'], ['light-paper', 'genshin'], ['light-zinc', 'default'], ['dark-obsidian', 'sticker']]) {
    await context.addInitScript(({ theme, skin }) => {
      localStorage.setItem('sthstart_theme_id', theme);
      localStorage.setItem('sthstart_ui_skin', skin);
    }, { theme, skin });
    for (const [width, height] of [[1920, 1080], [1440, 900], [1024, 768], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`/apps/resources?note=${id}`);
      await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');
      const title = page.getByRole('textbox', { name: '笔记标题', exact: true });
      await expect(title).toHaveValue('过去的某一个下午');
      await page.waitForLoadState('networkidle');
      await title.click();
      await expect(title).toBeFocused();
      await expect(title).toHaveAttribute('data-ui-variant', 'inline');
      await expect(title).toHaveCSS('outline-style', 'none');
      await expect(title).toHaveCSS('box-shadow', 'none');
      await expect(title).toHaveCSS('border-top-width', '0px');
      await expect(title).toHaveCSS('border-bottom-width', '2px');
      await expect.poll(() => title.evaluate(node => getComputedStyle(node).borderBottomColor === getComputedStyle(node).color)).toBe(true);
      await expect(page.getByRole('textbox', { name: '第 1 段正文' })).toHaveCSS('box-shadow', 'none');
      await expect(page.getByRole('textbox', { name: '第 1 段正文' })).toHaveCSS('border-top-width', '0px');
      const gap = await page.evaluate(() => {
        const header = document.querySelector('.resources-workspace-header')!.getBoundingClientRect();
        const content = document.querySelector('.resources-workspace-content')!.getBoundingClientRect();
        return content.top - header.bottom;
      });
      expect(gap).toBeGreaterThanOrEqual(width >= 1024 ? 16 : 12);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await page.waitForTimeout(450);
      await page.screenshot({ path: `${output}/${theme}-${skin}-${width}-focus.png`, animations: 'disabled' });
      // Keyboard entry must retain the same visible underline without a box.
      await title.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(title).toBeFocused();
      await expect(title).toHaveCSS('outline-style', 'none');
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const label of ['灵感素材', '搜集任务', '待整理箱', '数据源']) {
    await page.getByRole('tab', { name: label, exact: true }).click();
    await expect(page.getByRole('tab', { name: label, exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(450);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${output}/view-${label}.png`, animations: 'disabled' });
  }
});
