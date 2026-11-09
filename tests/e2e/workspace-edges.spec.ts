import { test, expect } from '@playwright/test';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
const portal = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
const service = 'http://127.0.0.1:' + (process.env.E2E_SERVICE_PORT ?? 4200) + '/api/v1/admin';
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
declare global { interface Window { syntheticKeys: number; storageBlocked: boolean } }
let noteId: string, projectId: string, chapterId: string, activityId: string;
const body = '隔离验收正文，保留编辑内容与滚动能力。\n'.repeat(50);
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
test.beforeAll(async ({ request }) => {
  const directory = process.env.STHSTART_E2E_DIRECTORY!;
  expect(directory).toBeTruthy();
  const rel = relative(resolve(tmpdir()), resolve(directory));
  expect(Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel)).toBe(true);
  async function post(path: string, data: unknown) {
    const r = await request.post(service + path, { headers, data });
    expect(r.ok(), await r.text()).toBe(true); return r.json();
  }
  noteId = (await post('/notebook/notes', { title: '四项边界验收笔记', kind: 'note', stage: 'reference', summary: '', tags: [], content: [{ id: 'text', type: 'text', text: body }] })).id;
  projectId = (await post('/story/projects', { title: '四项边界验收项目', summary: '' })).id;
  chapterId = (await post('/story/projects/' + projectId + '/documents', { kind: 'chapter', title: '第一章', body })).id;
  activityId = (await post('/activities', { title: '矮视口制作', type: '分镜漫剧', stageTitles: ['第一场', '第二场'], actors: [{ displayName: '主角', activityRole: '登场角色' }] })).activity.id;
});
test.beforeEach(async ({ context }) => {
  expect((await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } })).ok()).toBe(true);
});

test('resource return removes old navigation context across three real roundtrips', async ({ page }) => {
  await page.goto(portal + '/apps/resources?view=notes&q=四项&from=resources&returnTo=old&tag=a&tag=b');
  await expect(page).toHaveURL(/pageSize=20/);
  for (let i = 0; i < 3; i++) {
    const start = new URL(page.url()); start.searchParams.delete('from'); start.searchParams.delete('returnTo');
    const expected = start.pathname + start.search;
    const link = page.getByRole('link', { name: '原作档案', exact: true });
    const href = new URL((await link.getAttribute('href'))!, portal);
    expect(href.searchParams.get('returnTo')).toBe(expected);
    await link.click();
    await expect(page.getByRole('link', { name: '返回资料库', exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(expected);
    await page.getByRole('link', { name: '返回资料库', exact: true }).click();
    await expect(page).toHaveURL(portal + expected);
  }
});

test('semantic search events, buttons, keyboard and IME', async ({ page }) => {
  for (const path of ['/apps/resources', '/apps/story/' + projectId]) {
    await page.goto(portal + path);
    if (path.startsWith('/apps/story/')) await expect(page.locator('.workspace-header')).toBeVisible();
    await page.evaluate(() => {
      window.syntheticKeys = 0;
      document.addEventListener('keydown', e => { if (!e.isTrusted && e.key === 'k') window.syntheticKeys++; });
    });
    const button = page.getByRole('button', { name: /^搜索与命令/ }).last();
    await button.click();
    const dialog = page.getByRole('dialog', { name: '命令快捷菜单' });
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => window.syntheticKeys)).toBe(0);
    await page.evaluate(() => { window.dispatchEvent(new CustomEvent('sthstart:open-command-palette')); window.dispatchEvent(new CustomEvent('sthstart:open-command-palette')); });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
    for (const key of ['Control+k', 'Meta+k']) {
      await page.keyboard.press(key); await expect(dialog).toBeVisible();
      await page.keyboard.press(key); await expect(dialog).toBeHidden();
    }
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, isComposing: true, bubbles: true })));
    await expect(dialog).toBeHidden();
    await button.focus();
    await page.keyboard.press('/'); await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
  }
});

for (const mode of ['write-only', 'read-write']) {
  test('outline storage restriction: ' + mode, async ({ context, page }) => {
    await context.addInitScript(mode => {
      const key = 'sthstart_story_outline_width';
      localStorage.setItem(key, '256');
      const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
      window.storageBlocked = true;
      Storage.prototype.getItem = function(k) { if (k === key && mode === 'read-write' && window.storageBlocked) throw new DOMException('blocked'); return get.call(this, k); };
      Storage.prototype.setItem = function(k, v) { if (k === key && window.storageBlocked) throw new DOMException('blocked'); return set.call(this, k, v); };
    }, mode);
    await page.goto(portal + '/apps/story/' + projectId);
    const separator = page.getByRole('separator', { name: '调整大纲宽度', exact: true });
    await separator.press('Shift+ArrowRight');
    await expect(separator).toHaveAttribute('aria-valuenow', '296');
    await page.getByRole('button', { name: '收起大纲资料树', exact: true }).click();
    await page.getByRole('button', { name: '展开大纲资料树', exact: true }).click();
    await expect(separator).toHaveAttribute('aria-valuenow', '296');
    await page.evaluate(() => { window.storageBlocked = false; });
    await separator.press('ArrowRight');
    await expect(separator).toHaveAttribute('aria-valuenow', '306');
    expect(await page.evaluate(() => localStorage.getItem('sthstart_story_outline_width'))).toBe('306');
    const other = await context.newPage();
    await other.goto(portal + '/');
    await other.evaluate(() => { window.storageBlocked = false; localStorage.setItem('sthstart_story_outline_width', '350'); });
    await expect(separator).toHaveAttribute('aria-valuenow', '350');
    await other.close();
  });
}

for (const size of [{ width: 1440, height: 400 }, { width: 844, height: 390 }, { width: 390, height: 320 }]) {
  test('short viewport routes and draft recovery ' + size.width, async ({ page }, info) => {
    await page.setViewportSize(size);
    for (const path of ['/apps/resources?note=' + noteId, '/apps/notebook/' + noteId, '/apps/story/' + projectId + '?entry=' + chapterId, '/apps/activities/' + activityId, '/apps/narrative', '/apps/creative']) {
      await page.goto(portal + path);
      const shell = page.locator('.shell-root[data-workspace]');
      await expect(shell).toBeVisible();
      await expect.poll(() => shell.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(600);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width + 1);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      if (path.includes('note=') || path.includes('/notebook/')) {
        const editor = page.locator('.notebook-textarea').first();
        await expect(editor).toBeVisible();
        const draft = body + '矮窗口新增内容' + size.width;
        await editor.fill(draft);
        await editor.evaluate(el => el.setAttribute('data-edge-instance', 'same-editor'));
        const detail = page.locator('.notebook-detail-pane');
        if (await detail.count()) {
          await detail.evaluate(el => { el.scrollTop = el.scrollHeight; });
          expect(await detail.evaluate(el => el.scrollHeight <= el.clientHeight || el.scrollTop > 0)).toBe(true);
        }
        const save = page.locator('.notebook-save-button');
        await save.scrollIntoViewIfNeeded();
        await expect(save).toBeInViewport();
        await save.click();
        await page.setViewportSize({ width: 1440, height: 900 });
        await expect(editor).toHaveValue(draft);
        await expect(editor).toHaveAttribute('data-edge-instance', 'same-editor');
        await expect.poll(() => shell.evaluate(el => Math.round(el.getBoundingClientRect().height))).toBe(900);
        await page.setViewportSize(size);
        await expect(page.locator('.notebook-save-status').first()).not.toContainText(/等待本机保存|正在保存到本机/);
        await page.reload();
        await expect(page.locator('.notebook-textarea').first()).toHaveValue(draft);
      }
      await page.screenshot({ path: info.outputPath(path.split('?')[0].split('/').slice(1,3).join('-') + '.png'), animations: 'disabled', fullPage: true });
    }
  });
}
