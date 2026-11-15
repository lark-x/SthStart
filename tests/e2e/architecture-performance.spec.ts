import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isOwnedDirectory } from './global-setup';

// Explicit opt-in: production-build measurements are kept separate from correctness tests.
test('architecture production route measurements', async ({ browser, request, baseURL }, info) => {
  test.skip(!process.env.ARCHITECTURE_PERF_OUTPUT, 'Set ARCHITECTURE_PERF_OUTPUT to run the five-repeat production benchmark.');
  test.setTimeout(180_000);
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  const service = 'http://127.0.0.1:' + (process.env.E2E_SERVICE_PORT ?? 4200) + '/api/v1/admin';
  const config = readFileSync('playwright.config.ts', 'utf8');
  const secret = /const testSecret = '([^']+)'/.exec(config)![1];
  const headers = { 'x-sthstart-admin-token': secret };
  const create = async (url: string, data: unknown) => {
    const response = await request.post(service + url, { headers, data });
    expect(response.ok(), url + ': ' + await response.text()).toBe(true);
    return response.json();
  };
  const project = await create('/story/projects', { title: 'Architecture performance story', summary: '' });
  await create('/story/projects/' + project.id + '/documents', { kind: 'chapter', title: 'Benchmark chapter', body: '固定测量正文。'.repeat(300) });
  const character = await create('/characters', { displayName: 'Architecture character', tags: [], draft: { displayName: 'Architecture character' } });
  for (let i = 0; i < 25; i++) await create('/notebook/notes', { title: 'Architecture note ' + i, kind: 'note', stage: 'reference', summary: '', tags: [], content: [{ id: 'body', type: 'text', text: '固定笔记正文。'.repeat(30) }], knowledge: { schemaVersion: 1, nature: 'personal', authorship: 'handwritten', usage: 'reference', works: [], characters: [], locations: [], sources: [] } });
  const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/rework_sample_v1.json', 'utf8'));
  const activity = await create('/activities', { document });
  const routes = [
    { name: 'story', path: '/apps/story/' + project.id, field: '小说正文编辑' },
    { name: 'resources', path: '/apps/resources', field: '' },
    { name: 'character', path: '/apps/characters/' + (character.character?.id ?? character.id), field: '角色名称' },
    { name: 'activity', path: '/apps/activities/' + activity.activity.id, field: '活动标题' },
  ];
  const samples: Record<string, unknown>[] = [];
  for (const route of routes) for (let repeat = 0; repeat < 5; repeat++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await context.request.post(baseURL + '/api/auth/admin-session', { headers: { origin: baseURL! } });
    await context.addInitScript(() => {
      const state = window as unknown as { __longTasks: number[] };
      state.__longTasks = [];
      new PerformanceObserver(list => list.getEntries().forEach(entry => state.__longTasks.push(entry.duration))).observe({ type: 'longtask', buffered: true });
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(route.path);
    if (route.name === 'story') await page.getByRole('button', { name: 'Benchmark chapter', exact: false }).first().click();
    if (route.field) await expect(page.getByRole('textbox', { name: route.field, exact: true }).first()).toBeVisible();
    else await expect(page.getByRole('heading', { name: '资料库', exact: true })).toBeVisible();
    const readyMs = await page.evaluate(() => performance.now());
    await page.waitForTimeout(800);
    const navigation = await page.evaluate(() => {
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      const scripts = resources.filter(entry => entry.initiatorType === 'script' || /\.m?js(?:\?|$)/.test(entry.name));
      const stylesheets = resources.filter(entry => new URL(entry.name).pathname.endsWith('.css'));
      let inlineCssBytes = 0;
      const encoder = new TextEncoder();
      const styleTags = document.querySelectorAll('style');
      for (let index = 0; index < styleTags.length; index++) {
        inlineCssBytes += encoder.encode(styleTags[index].textContent ?? '').byteLength;
      }
      return { jsTransferBytes: scripts.reduce((sum, entry) => sum + entry.transferSize, 0), jsDecodedBytes: scripts.reduce((sum, entry) => sum + entry.decodedBodySize, 0), jsRequests: scripts.length, cssTransferBytes: stylesheets.reduce((sum, entry) => sum + entry.transferSize, 0), cssDecodedBytes: stylesheets.reduce((sum, entry) => sum + entry.decodedBodySize, 0), cssRequests: stylesheets.length, inlineCssBytes, apiRequests: resources.filter(entry => new URL(entry.name).pathname.startsWith('/api/')).length, longTasks: (window as unknown as { __longTasks: number[] }).__longTasks };
    });
    const started = performance.now();
    if (route.field) {
      const field = page.getByRole('textbox', { name: route.field, exact: true }).first();
      const original = await field.inputValue();
      await field.fill(original + '测');
      await expect(field).toHaveValue(original + '测');
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    } else {
      await page.getByRole('button', { name: /下一页/ }).last().click();
      await expect(page.getByRole('navigation', { name: '分页', exact: true })).toContainText('21');
    }
    const interactionMs = performance.now() - started;
    if (repeat === 0) await page.screenshot({ path: info.outputPath(route.name + '.png') });
    samples.push({ route: route.name, repeat, readyMs, ...navigation, interactionMs, errors });
    await context.close();
  }
  const output = process.env.ARCHITECTURE_PERF_OUTPUT!;
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({ browser: browser.version(), viewport: '1440x900', conditions: 'production build, fresh context each repeat, local network, reduced motion, 25 notes / 1 story chapter / 1 character / fixture activity, 800ms settling interval', samples }, null, 2));
});
