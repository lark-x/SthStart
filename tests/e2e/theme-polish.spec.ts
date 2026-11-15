import { expect, test, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { isOwnedDirectory } from './global-setup';

const portal = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
const service = 'http://127.0.0.1:' + (process.env.E2E_SERVICE_PORT ?? 4200) + '/api/v1/admin';
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
let noteId: string;
const fixtureKey = '外观验收-' + randomUUID().slice(0, 8);
const notebookPath = () => `/apps/resources?q=${encodeURIComponent(fixtureKey)}&note=${noteId}`;

test.beforeAll(async ({ request }) => {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  for (const title of ['雨后的街角', '海边来信']) {
    const note = await request.post(service + '/notebook/notes', { headers, data: {
      title: `${title} · ${fixtureKey}`, kind: 'diary', stage: 'draft', summary: '创作资料 · 场景记录', tags: [],
      content: [{ id: 'body', type: 'text', text: '雨后的街角亮起一排路灯。刚收摊的小店门前，还有两把椅子。' }],
    } });
    expect(note.status()).toBe(201);
    noteId = (await note.json()).id;
  }
});

async function contrast(locator: Locator) {
  return locator.evaluate(node => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    const backgrounds = [];
    for (let element: Element | null = node; element; element = element.parentElement) {
      backgrounds.push(getComputedStyle(element).backgroundColor);
    }
    const luminance = (pixel: Uint8ClampedArray) => [0.2126, 0.7152, 0.0722].reduce((sum, weight, i) => {
      const c = pixel[i] / 255;
      return sum + weight * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    }, 0);
    for (const background of backgrounds.reverse()) { ctx.fillStyle = background; ctx.fillRect(0, 0, 1, 1); }
    const bg = luminance(ctx.getImageData(0, 0, 1, 1).data);
    ctx.fillStyle = getComputedStyle(node).color; ctx.fillRect(0, 0, 1, 1);
    const fg = luminance(ctx.getImageData(0, 0, 1, 1).data);
    return (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05);
  });
}

for (const theme of ['light-paper', 'light-zinc', 'dark-espresso', 'dark-obsidian']) {
  test(`theme ${theme} renders consistent selection and legible controls`, async ({ context }, info) => {
    test.setTimeout(180_000);
    expect((await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } })).ok()).toBe(true);
    await context.addInitScript(id => localStorage.setItem('sthstart_theme_id', id), theme);
    const errors: string[] = [];
    for (const path of ['/', '/apps/projects', notebookPath(), '/apps/characters', '/apps/media', '/apps/creative', '/apps/calendar', '/apps/activities', '/apps/story', '/apps/narrative', '/settings/public-services']) {
      // A fresh page per route keeps the previous route's in-flight RSC prefetches
      // from being cancelled by this navigation; WebKit reports those aborts as
      // page errors, which would otherwise be attributed to the next route.
      const page = await context.newPage();
      const routeErrors: string[] = [];
      page.on('pageerror', error => routeErrors.push(error.message));
      try {
        await page.setViewportSize({ width: 1440, height: 900 });
        const response = await page.goto(path);
        expect(response?.ok(), path).toBe(true);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const main = page.locator('main');
        await expect(main).toBeVisible();
        await expect(main).not.toContainText(/This page couldn.t load|Internal Server Error/);
        // Hydrate before the error snapshot: hydration failures surface after the
        // first paint, so closing the page early would hide them.
        await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true', { timeout: 10_000 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), path).toBeLessThanOrEqual(1);
        if (path.startsWith('/apps/resources')) {
          const note = page.getByRole('button', { name: /^海边来信/ });
          await expect(note).toHaveAttribute('aria-current', 'page');
          const tab = page.getByRole('tab', { name: '创作笔记', exact: true });
          await expect(tab).toHaveAttribute('aria-selected', 'true');
          expect(await contrast(tab)).toBeGreaterThanOrEqual(4.5);
          expect(await contrast(note.locator('h4'))).toBeGreaterThanOrEqual(4.5);
          const selected = await tab.evaluate(node => getComputedStyle(node).backgroundColor);
          await tab.hover();
          await expect.poll(() => tab.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(selected);
          await page.screenshot({ path: info.outputPath('resources.png'), animations: 'disabled' });
          await page.getByRole('button', { name: /^雨后的街角/ }).click();
          await expect(page.getByRole('button', { name: /^雨后的街角/ })).toHaveAttribute('aria-current', 'page');
        } else if (path === '/apps/characters') {
          await expect(page.getByRole('link', { name: '新建角色', exact: true })).toHaveCount(1);
          await expect(page.getByRole('link', { name: '新建角色', exact: true })).toBeVisible();
          await expect(page.getByRole('textbox', { name: '搜索角色' })).toBeVisible();
          if (theme === 'light-paper') {
            const cards = page.getByRole('tab', { name: '专属角色卡', exact: true });
            const assets = page.getByRole('tab', { name: '多角色公共资产库', exact: true });
            await cards.press('ArrowRight');
            await expect(assets).toHaveAttribute('aria-selected', 'true');
            await expect(page.getByRole('button', { name: '上传公共资产', exact: true })).toBeVisible();
            await assets.press('ArrowLeft');
            await expect(cards).toHaveAttribute('aria-selected', 'true');
            await page.screenshot({ path: info.outputPath('characters.png'), animations: 'disabled' });
          }
        } else if (path === '/settings/public-services') {
          await expect(page.getByRole('button', { name: '添加模型', exact: true })).toBeVisible({ timeout: 15_000 });
          await expect(page.getByRole('button', { name: /^刷新/ })).toHaveCount(1);
          await expect(page.getByRole('tab', { name: '模型', exact: true })).toBeVisible();
          await expect(page.getByRole('tab', { name: '扩展服务', exact: true })).toBeVisible();
          await expect(page.getByRole('tab', { name: /用途绑定/ })).toHaveCount(0);
          await expect(page.getByRole('button', { name: '新建连接', exact: true })).toBeHidden();
          if (theme === 'dark-espresso') await page.screenshot({ path: info.outputPath('settings.png'), animations: 'disabled' });
        }
      } finally {
        // Snapshot before closing: aborting this page's own pending requests on
        // close is teardown, not a defect in the route that was just checked.
        errors.push(...routeErrors.map(message => `${path}: ${message}`));
        await page.close();
      }
    }
    expect(errors).toEqual([]);
  });
}

test('character and resource controls remain reachable at tablet and phone widths', async ({ page, context }) => {
  expect((await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } })).ok()).toBe(true);
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/apps/characters');
    await expect(page.getByRole('link', { name: '新建角色', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '筛选与排序', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '角色筛选', exact: true }).getByRole('combobox', { name: '作品类型' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.goto('/apps/resources');
    await expect(page.getByRole('tab', { name: '创作笔记', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
});

test('theme switch updates an open page and survives reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true', { timeout: 10_000 });
  const nav = page.getByRole('complementary', { name: '侧边导航' });
  await nav.getByRole('button', { name: '切换至夜间模式' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark-espresso');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark-espresso');
  await expect(nav.getByRole('button', { name: '切换至日间模式' })).toBeVisible();
});

test('custom accent previews, persists across skins, and restores defaults', async ({ page, context }, info) => {
  expect((await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } })).ok()).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/settings/appearance');
  await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true', { timeout: 10_000 });
  const root = page.locator('html');
  const switcher = page.getByRole('button', { name: '自定义主题色', exact: true });
  const chooseSkin = async (name: string) => {
    await page.getByRole('button', { name: '预览' + name, exact: true }).click();
    await page.getByRole('dialog', { name: /预览/ }).getByRole('button', { name: '应用' }).click();
  };
  const openAccent = async () => {
    await switcher.click();
    return page.getByRole('dialog', { name: '自定义主题色' });
  };
  const token = (name: string) => root.evaluate((element, property) => getComputedStyle(element).getPropertyValue(property).trim(), name);
  await chooseSkin('暖夜');
  const base = await token('--surface-raised');
  const defaultAccent = await token('--accent');
  let dialog = await openAccent();
  let field = dialog.getByRole('textbox', { name: '颜色代码' });
  await expect(field).toBeFocused();
  await field.fill('oops');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByRole('button', { name: '应用' })).toBeDisabled();
  await dialog.getByRole('button', { name: '玫瑰' }).click();
  await expect(field).toHaveValue('#B55D7B');
  await page.screenshot({ path: info.outputPath('accent-picker.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(switcher).toBeFocused();
  expect(await token('--accent')).toBe(defaultAccent);

  dialog = await openAccent();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(switcher).toBeFocused();

  dialog = await openAccent();
  field = dialog.getByRole('textbox', { name: '颜色代码' });
  await field.fill('#331022');
  await field.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(root).toHaveAttribute('data-custom-accent', '#331022');
  const darkAccent = await token('--accent');
  expect(darkAccent).not.toBe(defaultAccent);
  expect(darkAccent).not.toBe('#331022');
  expect(await token('--surface-raised')).toBe(base);
  await page.reload();
  await expect(root).toHaveAttribute('data-custom-accent', '#331022');
  expect(await token('--accent')).toBe(darkAccent);
  await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true', { timeout: 10_000 });
  await chooseSkin('暖白');
  await expect(root).toHaveAttribute('data-color-mode', 'light');
  expect(await token('--accent')).toBe('#331022');
  // Blocking hydration confirms the saved color is present at first paint.
  const preHydration = await context.newPage();
  await preHydration.route('**/*', route => route.request().resourceType() === 'script' ? route.abort() : route.continue());
  await preHydration.goto('/apps/resources');
  await expect(preHydration.locator('html')).toHaveAttribute('data-custom-accent', '#331022');
  await preHydration.close();
  dialog = await openAccent();
  await dialog.getByRole('button', { name: '恢复默认' }).click();
  await page.reload();
  await expect(root).not.toHaveAttribute('data-custom-accent', /./);
});

test('note sections are distinct and block controls work in the writing pane', async ({ page, context }, info) => {
  expect((await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } })).ok()).toBe(true);
  await context.addInitScript(() => localStorage.setItem('sthstart_theme_id', 'dark-espresso'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(notebookPath());
  await expect(page.getByRole('textbox', { name: '笔记标题' })).toHaveValue(`海边来信 · ${fixtureKey}`);
  await expect(page.getByRole('group', { name: '资料信息' })).toBeVisible();
  const body = page.getByRole('region', { name: '笔记正文' });
  const insert = page.locator('.notebook-editor-header').getByRole('button', { name: '插入内容', exact: true });
  const actions = page.getByRole('dialog', { name: '插入内容', exact: true });
  const first = body.getByRole('textbox', { name: '第 1 段正文' });
  const block = body.locator(".notebook-block[data-block-type='text']").first();
  await first.focus();
  expect(await first.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
  await expect.poll(() => block.evaluate(el => el.matches(':focus-within'))).toBe(true);
  await expect.poll(() => block.evaluate(el => getComputedStyle(el, '::before').opacity)).toBe('1');
  await page.screenshot({ path: info.outputPath('notebook-editor.png'), animations: 'disabled' });
  await insert.click();
  await actions.getByRole('button', { name: '段落', exact: true }).click();
  await expect(body).toContainText('2 个内容块');
  await body.getByRole('textbox', { name: '第 2 段正文' }).fill('给海边的第二封信。');
  await body.locator('.notebook-block').nth(1).hover();
  await body.getByRole('button', { name: '上移第 2 个内容块' }).click();
  await expect(first).toHaveValue('给海边的第二封信。');
  await page.getByRole('button', { name: '更多笔记操作', exact: true }).click();
  await page.getByRole('menu', { name: '更多笔记操作', exact: true }).getByRole('menuitem', { name: '立即保存', exact: true }).click();
  await expect(page.getByText('已同步', { exact: true })).toBeVisible();
  await page.reload();
  await expect(first).toHaveValue('给海边的第二封信。');
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(first).toBeVisible();
    await expect(insert).toBeVisible();
    await insert.click();
    await expect(actions.getByRole('button', { name: '段落', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
});
