import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { isOwnedDirectory } from './global-setup';

const portal = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
const service = 'http://127.0.0.1:' + (process.env.E2E_SERVICE_PORT ?? 4200) + '/api/v1/admin';
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
const longChapter = Array.from({ length: 100 }, (_, index) => `第 ${index + 1} 段。用长正文确认编辑器可独立滚动。`).join('\n\n');

async function seed(request: APIRequestContext) {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  const create = async <T,>(path: string, data: object): Promise<T> => {
    const response = await request.post(service + path, { headers, data });
    expect(response.ok(), 'fixture: ' + path).toBe(true);
    return response.json();
  };
  const project = await create<{ id: string }>('/story/projects', { title: '全站验收样本', summary: '测试项目。' });
  await create('/story/projects/' + project.id + '/documents', {
    kind: 'chapter', title: '海边来信', body: longChapter,
  });
  const character = await create<{ id?: string; character?: { id: string } }>('/characters', {
    displayName: '全站验收角色', tags: ['验收'], draft: { displayName: '全站验收角色', work: '样本作品' },
  });
  const note = await create<{ id: string }>('/notebook/notes', {
    title: '全站验收笔记', kind: 'note', stage: 'reference', summary: '', tags: [],
    content: [{ id: 'body', type: 'text', text: '这是验收用笔记。' }],
    knowledge: { schemaVersion: 1, nature: 'personal', authorship: 'handwritten', usage: 'reference', works: [], characters: [], locations: [], sources: [] },
  });
  const activity = await create<{ activity: { id: string } }>('/activities', {
    document: JSON.parse(readFileSync('packages/activity-playback/fixtures/rework_sample_v1.json', 'utf8')),
  });
  const characterId = character.character?.id ?? character.id;
  expect(characterId, 'fixture character ID').toBeTruthy();
  return [
    '/', '/apps/projects', '/apps/projects/' + project.id, '/apps/story', '/apps/story/' + project.id,
    '/apps/activities', '/apps/activities/new', '/apps/activities/' + activity.activity.id,
    '/apps/characters', '/apps/characters/new', '/apps/characters/' + characterId,
    '/apps/story-worlds', '/apps/narrative', '/apps/calendar',
    '/apps/notebook', '/apps/notebook/new', '/apps/notebook/' + note.id, '/apps/notebook/offline', '/apps/resources',
    '/apps/media', '/apps/inspiration', '/apps/creative',
    '/settings', '/settings/public-services', '/settings/generation', '/settings/control-center', '/settings/ai-logs', '/settings/backups', '/apps/linshe',
  ];
}

async function seedWorldForVisualAudit(request: APIRequestContext) {
  const response = await request.post(service + '/story-worlds/create-bundle', {
    headers,
    data: {
      idempotencyKey: 'visual-audit-' + crypto.randomUUID(),
      definition: {
        title: '海雾中的末班船',
        summary: '潮水在夜色中退去，守灯人发现今晚的归航名单上多了一个人。'.repeat(5),
        timeLabel: '归航日',
        locations: [{ id: 'lighthouse', name: '旧灯塔', description: '一座照亮回程海路的灯塔。' }],
        actors: [{
          id: 'keeper', name: '守灯人林舟', role: 'main', locationId: 'lighthouse', goals: ['确认这艘船的来历'],
          characterId: null, characterVersion: null, background: '', personality: '', speechStyle: '',
          appearance: '', referenceArtifactIds: [],
        }],
        sources: [],
        lockedFacts: [],
        models: { action: null, adjudication: null, narration: null },
        visualStyle: '',
      },
      initialBranch: { title: '主线', mode: 'canon-gap', direction: '跟随归航名单展开悬念。' },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return await response.json() as { world: { id: string }; branch: { id: string } };
}

async function openContext(browser: Browser, baseURL: string | undefined, viewport: { width: number; height: number }, theme?: string) {
  // The matrix intercepts all network traffic to isolate external integrations.
  // Offline behavior is covered with real service workers in offline-and-mobile.spec.ts.
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, reducedMotion: 'reduce', serviceWorkers: 'block' });
  expect((await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } })).ok()).toBe(true);
  if (theme) {
    await context.addInitScript(id => { if (location.protocol === 'http:') localStorage.setItem('sthstart_theme_id', id); }, theme);
  }
  // Keep the embedded app and external integrations outside the acceptance fixture.
  await context.route(
    url => (url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== (baseURL ?? portal),
    route => route.abort(),
  );
  return context;
}

async function expectClientReady(page: Page) {
  await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true', { timeout: 10_000 });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
  for (const theme of ['light-paper', 'dark-espresso']) {
    test(`page-by-page visual audit at ${viewport.width}px in ${theme}`, async ({ browser, request, baseURL }, info) => {
      test.skip(!process.env.STHSTART_VISUAL_AUDIT, 'Set STHSTART_VISUAL_AUDIT=1 to save every page screenshot.');
      test.setTimeout(240_000);
      const routes = await seed(request);
      const { world } = await seedWorldForVisualAudit(request);
      routes.push('/apps/story-worlds/new', '/apps/story-worlds/' + world.id + '/edit');
      const selectedRoutes = new Set(process.env.STHSTART_VISUAL_AUDIT_PATHS?.split(',').filter(Boolean));
      expect([...selectedRoutes].every(route => routes.includes(route))).toBe(true);
      const context = await openContext(browser, baseURL, viewport, theme);
      const report = [];
      const page = await context.newPage();
      let errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error' && /hydrat/i.test(message.text())) errors.push(message.text());
      });
      try {
        for (const [index, route] of routes.entries()) {
          if (selectedRoutes.size > 0 && !selectedRoutes.has(route)) continue;
          errors = [];
          const response = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 15_000 });
          await expectClientReady(page);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          const main = page.getByRole('main').first();
          await expect(main.getByRole('heading', { level: 1 })).toBeVisible();
          if (route === '/apps/story-worlds') {
            await expect(main.getByRole('heading', { name: '主线', exact: true })).toBeVisible();
          }
          await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          const name = String(index + 1).padStart(2, '0') + '-' + (route.split('/').filter(Boolean).slice(0, 2).join('-') || 'home');
          await page.screenshot({ path: info.outputPath(name + '.png'), animations: 'disabled', scale: 'css' });
          const metrics = await page.evaluate(() => ({
            title: document.title,
            heading: document.querySelector('main h1')?.textContent?.trim(),
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            scrollableTabs: [...document.querySelectorAll<HTMLElement>('.page-tabs')]
              .filter(el => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
              .map(el => el.getAttribute('aria-label')),
          }));
          report.push({ route, name, status: response?.status(), ...metrics, errors: [...errors] });
          expect.soft(response?.status(), route).toBe(200);
          expect.soft(await page.getByRole('main').count(), route + ': main landmark count').toBe(1);
          expect.soft(metrics.overflow, route + ': horizontal document overflow').toBeLessThanOrEqual(1);
          expect.soft(errors, route + ': runtime/hydration errors').toEqual([]);
        }
      } finally {
        writeFileSync(info.outputPath('audit.json'), JSON.stringify({ viewport, theme, pages: report }, null, 2));
        await context.close();
      }
    });
  }
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test('29 route matrix at ' + viewport.width + 'px', async ({ browser, request, baseURL }, info) => {
    test.skip(!process.env.STHSTART_ROUTE_MATRIX, 'Set STHSTART_ROUTE_MATRIX=1 for the full acceptance matrix.');
    test.setTimeout(240_000);
    const routes = await seed(request);
    expect(new Set(routes).size).toBe(29);
    const context = await openContext(browser, baseURL, viewport);
    const report = [];
    try {
      for (const [index, route] of routes.entries()) {
        // A fresh page prevents pending fetches from the previous route from
        // reporting their navigation cancellation as an error on this route.
        const page = await context.newPage();
        const currentErrors: string[] = [];
        page.on('pageerror', (error) => currentErrors.push(error.message.slice(0, 260)));
        page.on('console', (message) => {
          if (message.type() === 'error' && /hydrat/i.test(message.text())) currentErrors.push(message.text().slice(0, 260));
        });
        try {
          const response = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 15_000 });
          const main = page.getByRole('main').last();
          await main.waitFor({ state: 'visible', timeout: 6_000 });
          const heading = main.getByRole('heading', { level: 1 }).first();
          await heading.waitFor({ state: 'visible', timeout: 6_000 });
          await expectClientReady(page);
          // Detail shells render headings before the real fixture loads.
          if (index === 7) {
            await main.getByRole('textbox', { name: '活动标题', exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 });
          } else if (index === 10) {
            await main.getByRole('textbox', { name: '角色名称', exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 });
          } else if (index === 2 || index === 4) {
            await main.getByText('全站验收样本', { exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 });
          } else if (index === 16) {
            await main.getByRole('textbox', { name: /笔记标题/ }).first().waitFor({ state: 'visible', timeout: 10_000 });
          } else if (route === '/apps/media') {
            // The server shell appears before the authenticated media query. Let
            // the UI settle so the next full navigation cannot abort that query.
            await expect(main.getByRole('navigation', { name: '分页', exact: true }))
              .toHaveAttribute('aria-busy', 'false', { timeout: 10_000 });
          }
          const metrics = await page.evaluate(() => ({
            headings: Array.from(document.querySelectorAll('h1')).filter(el => el.getClientRects().length > 0).map(el => el.textContent?.trim()),
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            theme: document.documentElement.getAttribute('data-theme'),
          }));
          const row = { route, actualPath: new URL(page.url()).pathname, http: response?.status(), ...metrics, errors: [...currentErrors] };
          report.push(row);
          expect.soft(row.http, route).toBe(200);
          if (route === '/settings') expect.soft(row.actualPath, route).toBe('/settings/public-services');
          expect.soft(row.headings.length, route + ': visible main heading count').toBe(1);
          expect.soft(row.overflow, route + ': horizontal document overflow').toBeLessThanOrEqual(1);
          expect.soft(row.errors, route + ': runtime/hydration errors').toEqual([]);
          if ([0, 4, 7, 8, 13, 18, 19, 23, 28].includes(index)) {
            await page.screenshot({ path: info.outputPath(String(index + 1).padStart(2, '0') + '.png'), animations: 'disabled', timeout: 5000 });
          }
          if (index === 8 && viewport.width === 390) {
            await expectClientReady(page);
            await page.getByRole('button', { name: /^筛选(?:\s*\(\d+\))?$/ }).click();
            const filter = page.getByRole('dialog', { name: '角色筛选与排序', exact: true });
            await expect(filter).toBeVisible();
            await expect.poll(() => filter.evaluate(el =>
              Math.abs(window.innerHeight - el.getBoundingClientRect().bottom)
            ), { message: 'mobile filter drawer is docked to the bottom of the viewport' }).toBeLessThanOrEqual(2);
            await page.screenshot({ path: info.outputPath('09-role-filter.png'), animations: 'disabled', timeout: 5000 });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          report.push({ route, actualPath: page.url(), error: message.slice(0, 800), errors: [...currentErrors] });
          expect.soft(message, route + ': route did not render').toBe('');
        } finally {
          await page.close();
        }
      }
    } finally {
      await info.attach('route-matrix-' + viewport.width, { body: JSON.stringify({ viewport, routes: report }, null, 2), contentType: 'application/json' });
      await context.close();
    }
  });
}

for (const { width, height, theme } of [
  { width: 1920, height: 1080, theme: 'light-paper' },
  { width: 1024, height: 768, theme: 'light-zinc' },
  { width: 1024, height: 768, theme: 'dark-espresso' },
  { width: 390, height: 570, theme: 'dark-obsidian' },
]) {
  test(`representative layouts at ${width}x${height} in ${theme}`, async ({ browser, request, baseURL }, info) => {
    test.skip(!process.env.STHSTART_ROUTE_MATRIX, 'Set STHSTART_ROUTE_MATRIX=1 for the full acceptance matrix.');
    test.setTimeout(90_000);
    const routes = await seed(request);
    const context = await openContext(browser, baseURL, { width, height }, theme);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && /hydrat/i.test(message.text())) errors.push(message.text());
    });
    try {
      for (const [name, path] of [
        ['home', routes[0]],
        ['settings', routes[23]],
        ['story', routes[4]],
        ['calendar', routes[13]],
      ] as const) {
        const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
        expect(response?.status(), path).toBe(200);
        await expectClientReady(page);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const main = page.getByRole('main').last();
        await expect(main.getByRole('heading', { level: 1 })).toHaveCount(1);
        if (name === 'story') {
          // A single seeded chapter opens automatically; the directory is collapsed on phones.
          await expect(main.getByRole('textbox', { name: '条目标题', exact: true })).toHaveValue('海边来信');
          const editor = main.getByRole('textbox', { name: '小说正文编辑', exact: true });
          await expect(editor).toHaveValue(longChapter);
          const scroll = await editor.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
            return { editor: element.scrollTop, page: window.scrollY };
          });
          expect.soft(scroll.editor, 'long text must scroll inside the editor').toBeGreaterThan(0);
          expect.soft(scroll.page, 'scrolling the editor must not scroll the page').toBe(0);
          await editor.evaluate(element => { element.scrollTop = 0; });
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect.soft(overflow, path + ': horizontal overflow').toBeLessThanOrEqual(1);
        await page.screenshot({ path: info.outputPath(name + '.png'), animations: 'disabled', timeout: 8_000 });
      }
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
