import { expect, test, type Page, type Route } from '@playwright/test';

/*
 * C4 narrow acceptance for /apps/linshe.
 *
 * The embed shell keeps a fixed dark canvas (#171d1b) regardless of the portal
 * theme, while the shared EmptyState/Alert/Badge components read theme semantic
 * tokens. Under the two light themes those tokens used to paint dark text onto
 * that dark canvas (measured 1.08–2.34:1). Every response here is mocked, so the
 * spec runs without Linshe, without the bridge service and without real data.
 */

const THEMES = ['light-paper', 'light-zinc'] as const;

const STUB_EMBED = '<!doctype html><meta charset="utf-8"><title>邻舍 stub</title>' +
  '<body style="margin:0;font:16px/1.5 sans-serif;background:#fff;color:#111">' +
  '<h1 id="stub">邻舍 stub 页面</h1></body>';

const BRIDGE_STATUS = {
  ready: true,
  linsheAvailable: true,
  charactersCount: 0,
  sharedAssetsCount: 0,
  linkedCharacters: [],
};

/** 文字与其真实背景的对比度，背景沿 DOM 逐层合成 alpha。 */
const CONTRAST_HELPERS = `
  const parse = (value) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(value || '');
    if (!m) return null;
    const parts = m[1].split(/[,\\/]/).map((p) => parseFloat(p.trim())).filter((n) => !Number.isNaN(n));
    if (parts.length < 3) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = (c) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  const ratio = (a, b) => {
    const x = luminance(a);
    const y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const backgroundUnder = (el) => {
    const layers = [];
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const color = parse(style.backgroundColor);
      if (color && color.a > 0) {
        layers.push(color);
        if (color.a >= 0.999) break;
      }
    }
    const base = { r: 255, g: 255, b: 255, a: 1 };
    return layers.reduceRight((acc, layer) => over(layer, acc), base);
  };
`;

async function installFixtures(page: Page, status: number) {
  await page.route('**/api/apps/linshe', (route: Route) =>
    status === 200
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'linshe',
            name: '邻舍.EXE',
            description: '本地图像工作台',
            launchUrl: 'http://127.0.0.1:5173',
            status: 'online',
            version: '3.9.0',
            sourceRevision: null,
            capabilities: ['embed'],
            checkedAt: new Date().toISOString(),
          }),
        })
      : route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: 'service_unavailable' }) })
  );
  await page.route('http://127.0.0.1:5173/**', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: STUB_EMBED })
  );
  await page.route('**/api/admin/linshe-bridge/**', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BRIDGE_STATUS) })
  );
  await page.route('**/api/admin/characters**', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
  );
}

async function useTheme(page: Page, themeId: string) {
  await page.addInitScript((id) => window.localStorage.setItem('sthstart_theme_id', id), themeId);
}

/** 空态里每一段可见文字的实测对比度，取样值同时用于失败报告。 */
async function measureEmptyState(page: Page) {
  return page.evaluate(`(() => {
    ${CONTRAST_HELPERS}
    const root = document.querySelector('.embed-empty');
    if (!root) return [];
    const out = [];
    for (const el of root.querySelectorAll('h3, p, a, button, span')) {
      const text = (el.textContent || '').trim();
      if (!text || el.closest('[aria-hidden="true"]')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const bg = backgroundUnder(el);
      const raw = parse(style.color);
      if (!raw) continue;
      const fg = raw.a >= 1 ? raw : over(raw, bg);
      out.push({
        text: text.slice(0, 30),
        tag: el.tagName.toLowerCase(),
        color: style.color,
        background: \`rgb(\${Math.round(bg.r)} \${Math.round(bg.g)} \${Math.round(bg.b)})\`,
        ratio: Math.round(ratio(fg, bg) * 100) / 100,
        fontSize: parseFloat(style.fontSize),
        fontWeight: Number(style.fontWeight) || 400,
      });
    }
    return out;
  })()`) as Promise<Array<{ text: string; tag: string; color: string; background: string; ratio: number; fontSize: number; fontWeight: number }>>;
}

test.beforeEach(async ({ context }) => {
  const portal = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
  expect((await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } })).ok()).toBe(true);
});

for (const themeId of THEMES) {
  test(`${themeId}: failed connection keeps the empty state readable on the embed canvas`, async ({ page }) => {
    await useTheme(page, themeId);
    await installFixtures(page, 503);
    await page.goto('/apps/linshe');

    const empty = page.locator('.embed-empty');
    await expect(empty).toBeVisible();
    await expect(empty.getByRole('heading', { name: '邻舍还没有启动', exact: true })).toBeVisible();
    await expect(empty.getByText('公共服务暂时不可用。你仍可以尝试直接加载默认的本地地址。', { exact: true })).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);

    const samples = await measureEmptyState(page);
    // 取样为空说明空态根本没渲染，不能算通过。
    expect(samples.length, '空态取样数量').toBeGreaterThan(3);
    const failures = samples.filter((s) => s.ratio < 4.5);
    expect(
      failures.length,
      '低于 4.5:1：\n' + failures.map((s) => `${s.ratio}:1 "${s.text}" ${s.color} on ${s.background}`).join('\n')
    ).toBe(0);
  });
}

test('failed connection still exposes retry, force load, external open and back navigation', async ({ page }) => {
  await useTheme(page, 'light-paper');
  await installFixtures(page, 503);
  await page.goto('/apps/linshe');

  const empty = page.locator('.embed-empty');
  await expect(empty).toBeVisible();
  // 工具与返回入口在 iframe 之外仍可用。
  await expect(page.getByRole('link', { name: '返回 SthStart 工作台', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '数据互通', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新检测', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '在新窗口打开', exact: true }).last()).toHaveAttribute('href', 'http://127.0.0.1:5173');

  // 强制加载走本地 stub，不触碰真实邻舍。
  await page.getByRole('button', { name: '仍然尝试加载', exact: true }).click();
  const frame = page.locator('iframe.linshe-frame');
  await expect(frame).toBeVisible();
  await expect(frame.contentFrame().locator('#stub')).toHaveText('邻舍 stub 页面');
  await expect(empty).toHaveCount(0);

  // 返回按钮回到工作台。
  await page.getByRole('link', { name: '返回 SthStart 工作台', exact: true }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
});

test('bridge drawer opens over the embed shell, closes and returns focus', async ({ page }) => {
  await useTheme(page, 'light-zinc');
  await installFixtures(page, 200);
  await page.goto('/apps/linshe');

  await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true', { timeout: 10_000 });
  const trigger = page.getByRole('button', { name: '数据互通', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'SthStart × 邻舍 数据互通工作台', exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('the embed token bridge does not leak into the portal shell', async ({ page }) => {
  await useTheme(page, 'light-paper');
  await installFixtures(page, 503);
  await page.goto('/apps/linshe');
  await expect(page.locator('.embed-empty')).toBeVisible();
  const embedInk = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.embed-empty')!).getPropertyValue('--ink').trim()
  );
  expect(embedInk).toBe('#f4f0e7');

  await page.goto('/');
  const shellInk = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--ink').trim());
  expect(shellInk).toBe('#2b2925');
});
