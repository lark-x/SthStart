import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { isOwnedDirectory } from './global-setup';

/*
 * 主路由无障碍扫描（frontend-visual-qa §1）。serious / critical 必须为 0。
 * 造数据与隔离上下文沿用 mantine-route-matrix.spec.ts：独立临时数据库、拦截所有外部请求。
 * 不关闭规则、不排除区域；确需延后处理的问题在 KNOWN_ISSUES 里写明路由、规则和原因。
 */

const portal = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
const service = 'http://127.0.0.1:' + (process.env.E2E_SERVICE_PORT ?? 4200) + '/api/v1/admin';
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
const BLOCKING = new Set(['serious', 'critical']);

/** 已知且暂不在本轮修复的问题：`${route} ${ruleId}` → 原因与收敛任务。为空表示没有豁免。 */
const KNOWN_ISSUES: Record<string, string> = {};

async function seed(request: APIRequestContext) {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  const create = async <T,>(path: string, data: object): Promise<T> => {
    const response = await request.post(service + path, { headers, data });
    expect(response.ok(), 'fixture: ' + path).toBe(true);
    return response.json();
  };
  const project = await create<{ id: string }>('/story/projects', { title: '无障碍验收项目', summary: '测试项目。' });
  await create('/story/projects/' + project.id + '/documents', { kind: 'chapter', title: '海边来信', body: '第一段。\n\n第二段。' });
  const character = await create<{ id?: string; character?: { id: string } }>('/characters', {
    displayName: '无障碍验收角色', tags: ['验收'], draft: { displayName: '无障碍验收角色', work: '样本作品' },
  });
  const note = await create<{ id: string }>('/notebook/notes', {
    title: '无障碍验收笔记', kind: 'note', stage: 'reference', summary: '', tags: [],
    content: [{ id: 'body', type: 'text', text: '这是验收用笔记。' }],
    knowledge: { schemaVersion: 1, nature: 'personal', authorship: 'handwritten', usage: 'reference', works: [], characters: [], locations: [], sources: [] },
  });
  const activity = await create<{ activity: { id: string } }>('/activities', {
    document: JSON.parse(readFileSync('packages/activity-playback/fixtures/rework_sample_v1.json', 'utf8')),
  });
  const characterId = character.character?.id ?? character.id;
  expect(characterId, 'fixture character ID').toBeTruthy();
  return [
    '/', '/apps/projects', '/apps/projects/' + project.id, '/apps/story/' + project.id,
    '/apps/activities', '/apps/activities/' + activity.activity.id,
    '/apps/characters', '/apps/characters/' + characterId,
    '/apps/story-worlds', '/apps/narrative', '/apps/calendar',
    '/apps/notebook', '/apps/notebook/' + note.id, '/apps/resources', '/apps/media', '/apps/inspiration', '/apps/creative',
    '/settings/public-services', '/settings/generation', '/settings/control-center', '/settings/ai-logs', '/settings/backups',
  ];
}

async function openContext(browser: Browser, theme: string, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce', serviceWorkers: 'block' });
  expect((await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } })).ok()).toBe(true);
  await context.addInitScript(id => { if (location.protocol === 'http:') localStorage.setItem('sthstart_theme_id', id); }, theme);
  await context.route(
    url => (url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== portal,
    route => route.abort(),
  );
  return context;
}

async function ready(page: Page, theme: string) {
  await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true', { timeout: 10_000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/* 桌面与手机宽度各扫一遍：窄屏会换用抽屉、折叠标签和精简日历格，读屏名称可能与桌面不同。 */
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];

// 默认扫两套代表主题；需要四套基础主题时设 STHSTART_A11Y_THEMES=light-paper,light-zinc,dark-espresso,dark-obsidian。
const A11Y_THEMES = process.env.STHSTART_A11Y_THEMES?.split(',').filter(Boolean) ?? ['light-paper', 'dark-espresso'];
for (const viewport of VIEWPORTS) for (const theme of A11Y_THEMES) {
  test(`main routes have no serious or critical axe violations at ${viewport.width}px in ${theme}`, async ({ browser, request }, info) => {
    test.setTimeout(240_000);
    const routes = await seed(request);
    const context = await openContext(browser, theme, viewport);
    const page = await context.newPage();
    const blocking: Array<{ route: string; rule: string; impact: string; help: string; targets: string[] }> = [];
    const known: typeof blocking = [];
    const minor: Record<string, number> = {};
    try {
      for (const route of routes) {
        const response = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        expect(response?.status(), route).toBeLessThan(400);
        await ready(page, theme);
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        for (const violation of result.violations) {
          const impact = violation.impact ?? 'unknown';
          if (!BLOCKING.has(impact)) {
            minor[violation.id] = (minor[violation.id] ?? 0) + violation.nodes.length;
            continue;
          }
          const item = { route, rule: violation.id, impact, help: violation.help, targets: violation.nodes.slice(0, 5).map(node => `${node.target.join(' ')} → ${node.html.slice(0, 240)}`) };
          (KNOWN_ISSUES[`${route.replace(/[0-9a-f-]{36}/g, ':id')} ${violation.id}`] ? known : blocking).push(item);
        }
      }
    } finally {
      const body = JSON.stringify({ viewport: viewport.width, theme, blocking, known, minor }, null, 2);
      writeFileSync(info.outputPath(`axe-${viewport.width}-${theme}.json`), body);
      await info.attach(`axe-${viewport.width}-${theme}.json`, { body, contentType: 'application/json' });
      await context.close();
    }
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
}
