import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';

const base = (process.env.STHSTART_DEPLOY_SMOKE_URL ?? 'http://127.0.0.1:9320').replace(/\/+$/, '');
const output = resolve('artifacts/visual-verification/world-authoring');
const jsonPath = resolve(output, 'deploy-9320-smoke.json');
mkdirSync(output, { recursive: true });

interface SurfaceResult {
  id: string;
  path: string;
  viewport: number;
  screenshot: string;
  overflow: number;
  theme: string;
  tavily?: string;
}

const results: SurfaceResult[] = [];
const mutations: string[] = [];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'dark',
  deviceScaleFactor: 2,
});

try {
  const session = await context.request.post(`${base}/api/auth/admin-session`, {
    headers: { origin: base },
  });
  assert.ok(session.ok(), `admin session failed: ${session.status()}`);

  await context.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const authMutation = url.pathname === '/api/auth/admin-session';
    if (mutating && !authMutation) {
      mutations.push(`${method} ${url.pathname}`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    window.localStorage.setItem('sthstart_theme_id', 'dark-espresso');
    window.localStorage.setItem('sthstart_theme', 'dark-espresso');
  });

  const warmNight = async (target: Page) => {
    await target.evaluate(() => {
      document.documentElement.dataset.theme = 'dark-espresso';
      document.documentElement.dataset.colorMode = 'dark';
      document.documentElement.dataset.mantineColorScheme = 'dark';
      document.documentElement.style.colorScheme = 'dark';
      document.documentElement.removeAttribute('data-eye-care');
    });
    await target.waitForTimeout(250);
  };

  const surfaces = [
    {
      id: 'new',
      path: '/apps/story-worlds/new',
      check: async (target: Page) => {
        await target.getByRole('heading', { name: '新建世界', exact: true }).waitFor();
        await target.getByText('尚未填写', { exact: true }).first().waitFor();
      },
    },
    {
      id: 'worlds',
      path: '/apps/story-worlds',
      check: async (target: Page) => {
        await target.getByRole('heading', { name: '故事世界', exact: true }).waitFor();
      },
    },
    {
      id: 'public-services',
      path: '/settings/public-services?tab=other',
      check: async (target: Page) => {
        await target.getByRole('heading', { name: '模型与公共服务', exact: true }).waitFor();
        const tavily = target.locator('section[aria-labelledby="web-search-heading"]');
        await tavily.getByRole('heading', { name: 'Tavily 内置搜索', exact: true }).waitFor();
        await tavily.getByText(/密钥状态：/).waitFor();
        const text = (await tavily.innerText()).replace(/\s+/g, ' ').trim();
        assert.match(text, /已启用|已停用/);
        return text.slice(0, 400);
      },
    },
  ];

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const surface of surfaces) {
      await page.goto(base + surface.path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(350);
      await warmNight(page);
      const tavily = await surface.check(page);
      const geometry = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        theme: document.documentElement.dataset.theme ?? '',
      }));
      assert.ok(geometry.overflow <= 0, `${surface.id} ${viewport.width}: horizontal overflow ${geometry.overflow}`);
      assert.equal(geometry.theme, 'dark-espresso');
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(200);
      const screenshot = resolve(output, `deploy-9320-${surface.id}-${viewport.width}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      results.push({
        id: surface.id,
        path: surface.path,
        viewport: viewport.width,
        screenshot,
        overflow: geometry.overflow,
        theme: geometry.theme,
        ...(tavily ? { tavily } : {}),
      });
    }
  }

  assert.deepEqual(mutations, [], `mutating requests were blocked: ${mutations.join(', ')}`);
  const summary = {
    ok: true,
    baseUrl: base,
    generatedAt: new Date().toISOString(),
    surfaces: results,
    mutations,
  };
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  const summary = {
    ok: false,
    baseUrl: base,
    generatedAt: new Date().toISOString(),
    surfaces: results,
    mutations,
    error: error instanceof Error ? error.message : String(error),
  };
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
  throw error;
} finally {
  await context.close();
  await browser.close();
}
