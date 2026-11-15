import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isOwnedDirectory } from './global-setup';

const portal = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
const service = 'http://127.0.0.1:' + (process.env.E2E_SERVICE_PORT ?? 4200) + '/api/v1/admin';
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
const output = resolve('artifacts/visual-verification/2026-11-10-optimization');
let noteId: string;

// Real records in the runner's owned temporary database, without API fixtures.
test.beforeAll(async ({ request }) => {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  await mkdir(output, { recursive: true });
  for (const title of ['海港来信', '雨夜与旧灯塔', '山间的第二个春天']) {
    const response = await request.post(service + '/story/projects', { headers, data: {
      title, summary: '围绕一座海港城市，整理人物、场景与章节。',
    } });
    expect(response.status()).toBe(201);
  }
  for (const displayName of ['林舟', '许知夏', '陈望', '方遥']) {
    const response = await request.post(service + '/characters', { headers, data: {
      displayName, draft: { displayName, work: '海港来信' }, tags: ['原创角色', '主要人物'],
    } });
    expect(response.status()).toBe(201);
  }
  for (const title of ['旧灯塔的场景记录', '海港城市的清晨']) {
    const response = await request.post(service + '/notebook/notes', { headers, data: {
      title, kind: 'world', stage: 'reference', tags: ['场景', '海港'], summary: '潮声、石阶和守灯人的来信。',
      content: [{ id: 'opening', type: 'text', text: '清晨的潮水刚刚退去，码头边留下了一道深色的水痕。守灯人把昨夜的来信叠好，放在旧木桌的一角。' },
        { id: 'detail', type: 'text', text: '沿着石阶往上，可以看到整片海港。这里的设定将作为第一章的场景参考，人物在灯塔下相遇。' }],
    } });
    expect(response.status()).toBe(201);
    noteId = (await response.json()).id;
  }
  const connection = await request.post(service + '/connections', { headers, data: {
    id: 'visual-local-text', name: '本地文本服务 · 验收样本', kind: 'openai-compatible-text',
    baseUrl: 'http://127.0.0.1:9/v1', enabled: false,
  } });
  expect(connection.status()).toBe(201);
});

async function settled(page: Page, name: string) {
  if (name === 'home') {
    await expect(page.getByTestId('recent-work-list').getByRole('listitem').first()).toBeVisible();
    await expect(page.getByRole('region', { name: '本地服务状态' })).not.toContainText('正在获取服务状态');
    await expect(page.locator('.home-module-meta').first()).toContainText('个项目');
  } else if (name === 'projects') {
    await expect(page.getByRole('heading', { name: '海港来信', exact: true }).first()).toBeVisible();
  } else if (name === 'characters') {
    await expect(page.getByRole('link', { name: /林舟/ }).first()).toBeVisible();
  } else if (name === 'resources') {
    await expect(page.getByRole('textbox', { name: '笔记标题' })).toHaveValue('海港城市的清晨');
    await expect(page.getByRole('textbox', { name: '第 1 段正文' })).toHaveValue(/清晨的潮水/);
  } else {
    await expect(page.getByRole('heading', { name: '本地文本服务 · 验收样本', exact: true }).first()).toBeVisible();
  }
  await expect(page.locator('main .skeleton-shimmer')).toHaveCount(0);
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

for (const [width, height] of [[1920, 1080], [1440, 900], [1024, 768], [390, 844]]) {
  for (const theme of ['light-paper', 'dark-espresso']) {
    test('loaded visual matrix ' + width + 'x' + height + ' ' + theme, async ({ browser }, info) => {
      test.setTimeout(90_000);
      const context = await browser.newContext({ baseURL: portal, viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
      try {
        expect((await context.request.post('/api/auth/admin-session', { headers: { origin: portal } })).ok()).toBe(true);
        await context.addInitScript(id => localStorage.setItem('sthstart_theme_id', id), theme);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        for (const [name, path] of [
          ['home', '/'], ['projects', '/apps/projects'], ['characters', '/apps/characters'],
          ['resources', '/apps/resources?note=' + noteId], ['settings', '/settings/public-services'],
        ]) {
          expect((await page.goto(path))?.status()).toBe(200);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await settled(page, name);
          expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), name).toBeLessThanOrEqual(1);
          await expect(page.locator('main')).not.toContainText(/This page couldn.t load|Internal Server Error|加载失败/);
          expect(await page.locator('.tpl-title').evaluate(el => getComputedStyle(el).fontSize), name).toBe('22px');
          if (name === 'home') {
            expect(await page.locator('.tpl-section-title').first().evaluate(el => getComputedStyle(el).fontSize)).toBe('16px');
            expect(await page.locator('.home-module-title').first().evaluate(el => getComputedStyle(el).fontSize)).toBe('16px');
            const colors = await page.locator('.home-module-icon').evaluateAll(elements => elements.map(el => getComputedStyle(el).color));
            expect(new Set(colors).size).toBe(4);
          }
          if (name === 'projects' && width >= 1024) {
            expect((await page.getByRole('combobox', { name: '项目排序' }).boundingBox())!.width).toBeLessThanOrEqual(200);
            expect(await page.getByRole('heading', { name: '海港来信', exact: true }).first().evaluate(el => getComputedStyle(el).fontSize)).toBe('16px');
          }
          const pathToImage = resolve(output, name + '_' + width + 'x' + height + '_' + theme + '.png');
          await page.screenshot({ path: pathToImage, fullPage: true, animations: 'disabled', caret: 'hide' });
          await info.attach(name + '-' + width + '-' + theme, { path: pathToImage, contentType: 'image/png' });
        }
        expect(errors).toEqual([]);
      } finally { await context.close(); }
    });
  }
}

test('four theme surfaces, live contrast and keyboard focus', async ({ page, context }, info) => {
  expect((await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } })).ok()).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/apps/projects');
  await settled(page, 'projects');
  const results = [];
  for (const [theme, name] of [['light-paper', '暖白'], ['light-zinc', '云白'], ['dark-espresso', '暖夜'], ['dark-obsidian', '深空']]) {
    await page.goto('/settings/appearance');
    await page.getByRole('button', { name: '预览' + name, exact: true }).click();
    await page.getByRole('dialog', { name: /预览/ }).getByRole('button', { name: '应用' }).click();
    await page.goto('/apps/projects');
    await settled(page, 'projects');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const sample = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const ctx = document.createElement('canvas').getContext('2d')!;
      const color = (token: string) => {
        ctx.fillStyle = root.getPropertyValue(token).trim(); ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
      };
      const luminance = (rgb: number[]) => rgb.reduce((sum, c, i) => {
        const s = c / 255; return sum + [0.2126, 0.7152, 0.0722][i] * (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
      }, 0);
      const ratio = (a: string, b: string) => {
        const x = luminance(color(a)), y = luminance(color(b));
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      return {
        text: ['--fg-default', '--fg-muted', '--fg-subtle'].flatMap(fg => ['--bg-app', '--surface', '--surface-sunken'].map(bg => ({ fg, bg, ratio: ratio(fg, bg) }))),
        border: ratio('--border-control', '--surface'),
        surfaces: ['--bg-app', '--bg-nav', '--surface', '--surface-raised'].map(token => color(token).join(',')),
      };
    });
    for (const result of sample.text) expect(result.ratio, theme + ' ' + result.fg + '/' + result.bg).toBeGreaterThanOrEqual(4.5);
    expect(sample.border).toBeGreaterThanOrEqual(3);
    expect(new Set(sample.surfaces).size).toBe(4);
    results.push({ theme, ...sample });
    await page.getByRole('combobox', { name: '项目排序' }).focus(); await page.keyboard.press('Tab');
    const refresh = page.getByRole('button', { name: '刷新列表', exact: true });
    await expect(refresh).toBeFocused();
    const focus = await refresh.evaluate(el => { const css = getComputedStyle(el); return { visible: el.matches(':focus-visible'), width: parseFloat(css.outlineWidth), style: css.outlineStyle }; });
    expect(focus.visible).toBe(true); expect(focus.width).toBeGreaterThanOrEqual(2); expect(focus.style).not.toBe('none');
    await page.screenshot({ path: resolve(output, 'focus_' + theme + '.png'), animations: 'disabled' });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  }
  await info.attach('live-contrast', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
});
