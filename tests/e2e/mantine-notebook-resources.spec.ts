import { expect, test, type Locator, type Page } from '@playwright/test';

/*
 * C2 presentation coverage. Server responses are fixed fixtures, so these
 * tests do not depend on accumulated notes, and no notebook write is allowed.
 * The local-draft case seeds IndexedDB directly and rejects the background PUT
 * so it exercises the unsynced presentation without changing save semantics.
 */

const THEMES = ['light-paper', 'light-zinc', 'dark-espresso', 'dark-obsidian'] as const;
const STAMP = '2026-11-14T02:00:00.000Z';

test.use({ serviceWorkers: 'block' });

const NOTES = [
  {
    id: 'fixture-note-a', title: '港口的风向记录', kind: 'note', summary: '潮汐与码头灯光的随记。',
    content: [{ id: 'body-a', type: 'text', text: '午后风向转为东南。' }], tags: ['港口'],
    stage: 'reference', favorite: false, revision: 1, createdAt: STAMP, updatedAt: '2026-11-14T03:00:00.000Z',
  },
  {
    id: 'fixture-note-b', title: '灯塔值守表', kind: 'world', summary: '轮班与灯油补给安排。',
    content: [{ id: 'body-b', type: 'text', text: '每两小时检查一次灯芯。' }], tags: ['世界'],
    stage: 'draft', favorite: false, revision: 1, createdAt: STAMP, updatedAt: '2026-11-14T04:00:00.000Z',
  },
];

async function installNotebookRoutes(page: Page, options: { detailFails?: boolean; writesFail?: boolean } = {}) {
  await page.route('**/api/auth/admin-session', async (route) => {
    await route.fulfill({ json: { authenticated: true, csrfToken: 'c2-fixture-csrf', source: 'local' } });
  });
  await page.route('**/api/admin/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { items: [], total: 0 } });
      return;
    }
    await route.fulfill({ status: 503, json: { error: 'fixture_read_only' } });
  });
  await page.route('**/api/admin/notebook/notes**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/references')) {
      await route.fulfill({ json: { items: [] } });
      return;
    }
    if (request.method() === 'PUT') {
      if (options.writesFail) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'offline', message: '本机草稿等待联网。' }) });
        return;
      }
      await route.continue();
      return;
    }
    if (request.method() !== 'GET') {
      await route.continue();
      return;
    }
    if (url.pathname === '/api/admin/notebook/notes') {
      await route.fulfill({ json: { items: NOTES, total: NOTES.length, page: 1, pageSize: 20 } });
      return;
    }
    const id = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
    const note = NOTES.find((item) => item.id === id);
    if (!note || options.detailFails) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'offline', message: '详情暂时不可用。' }) });
      return;
    }
    await route.fulfill({ json: note });
  });
  await page.route('**/api/admin/mcp-sources**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { items: [] } });
      return;
    }
    await route.continue();
  });
}

async function contrastOf(locator: Locator) {
  return locator.evaluate((node) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    const chain: string[] = [];
    for (let element: Element | null = node; element; element = element.parentElement) {
      chain.push(getComputedStyle(element).backgroundColor);
    }
    for (const color of chain.reverse()) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
    }
    const background = ctx.getImageData(0, 0, 1, 1).data;
    ctx.fillStyle = getComputedStyle(node).color;
    ctx.fillRect(0, 0, 1, 1);
    const foreground = ctx.getImageData(0, 0, 1, 1).data;
    const luminance = (pixel: Uint8ClampedArray) => [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
      const value = pixel[index] / 255;
      return sum + weight * (value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
    }, 0);
    const a = luminance(background);
    const b = luminance(foreground);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

test('resource tabs keep the last view reachable at phone width', async ({ page }) => {
  await installNotebookRoutes(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/apps/resources');

  const tabs = page.getByRole('tablist', { name: '资料库视图切换', exact: true });
  await expect(tabs).toBeVisible();
  const first = tabs.getByRole('tab', { name: '创作笔记', exact: true });
  const last = tabs.getByRole('tab', { name: '数据源', exact: true });
  await expect(last).toBeInViewport({ ratio: 1 });
  await first.focus();
  await expect(first).toBeFocused();
  await first.press('End');

  await expect(last).toHaveAttribute('aria-selected', 'true');
  await expect(last).toBeInViewport({ ratio: 1 });
  await expect(page).toHaveURL(/view=sources/);
  await expect(page.getByRole('heading', { name: '数据源连接', exact: true })).toBeVisible();
  await expect(page.locator('[aria-label="相关记录通道"]')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('selected notebook row keeps route selection and readable metadata in all four themes', async ({ page }) => {
  test.setTimeout(60_000);
  await installNotebookRoutes(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/apps/resources');

  for (const theme of THEMES) {
    await page.addInitScript((id) => localStorage.setItem('sthstart_theme_id', id), theme);
    await page.goto('/apps/resources?note=fixture-note-a');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    const previous = page.locator('.notebook-list-item').filter({ hasText: '港口的风向记录' });
    const selectedBefore = page.locator('.notebook-list-item[aria-current="page"]');
    await expect(previous).toBeVisible({ timeout: 15_000 });
    await expect(selectedBefore).toHaveCount(1);
    await expect(previous).toHaveAttribute('aria-current', 'page');
    const target = page.locator('.notebook-list-item').filter({ hasText: '灯塔值守表' });
    await target.click();
    await expect(target).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => new URL(page.url()).searchParams.get('note')).toBe('fixture-note-b');
    await expect(page.getByRole('textbox', { name: '笔记标题' })).toHaveValue('灯塔值守表');
    await expect(previous).not.toHaveAttribute('aria-current', 'page');
    await expect(selectedBefore).toHaveCount(1);

    await page.waitForTimeout(250);
    const metadata = target.locator('.notebook-list-meta');
    expect(await metadata.count(), theme + ' metadata labels').toBeGreaterThanOrEqual(3);
    for (let index = 0; index < await metadata.count(); index += 1) {
      expect(await contrastOf(metadata.nth(index)), theme + ' metadata ' + index).toBeGreaterThanOrEqual(4.5);
    }
    expect(await contrastOf(target.locator('h4')), theme + ' selected title').toBeGreaterThanOrEqual(4.5);
  }
});

test('unsynced local draft stays visible and opens when the detail request fails', async ({ page }) => {
  test.setTimeout(60_000);
  await installNotebookRoutes(page, { detailFails: true, writesFail: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/apps/resources');

  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('sthstart-notebook', 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('notes')) {
          const notes = db.createObjectStore('notes', { keyPath: 'noteId' });
          notes.createIndex('by-updated', 'updatedAt');
          notes.createIndex('by-status', 'status');
        }
        if (!db.objectStoreNames.contains('assets')) {
          const assets = db.createObjectStore('assets', { keyPath: 'id' });
          assets.createIndex('by-note', 'noteId');
          assets.createIndex('by-created', 'createdAt');
        }
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('notes', 'readwrite');
        tx.objectStore('notes').put({
          noteId: 'fixture-local-draft',
          note: {
            id: 'fixture-local-draft',
            title: '离线时的潮汐草稿',
            kind: 'diary',
            summary: '',
            content: [{ id: 'local-body', type: 'text', text: '断网时写下的正文。' }],
            tags: ['离线'],
            stage: 'draft',
            favorite: false,
            createdAt: '2026-11-14T05:00:00.000Z',
            updatedAt: '2026-11-14T05:00:00.000Z',
          },
          localVersion: 1,
          status: 'pending',
          updatedAt: Date.now(),
          attemptCount: 0,
          nextAttemptAt: 0,
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  });

  await page.reload();
  const draft = page.locator('.notebook-list-item').filter({ hasText: '离线时的潮汐草稿' });
  await expect(draft).toBeVisible();
  await expect(draft.locator('.notebook-local-badge')).toHaveText('同步失败', { timeout: 15_000 });
  await expect(draft.locator('.notebook-local-badge')).toHaveAttribute('data-local-status', 'error');
  await expect(page.getByText('另有 1 条本机待同步资料，不计入服务器总数。', { exact: true })).toBeVisible();

  await draft.click();
  await expect(draft).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => new URL(page.url()).searchParams.get('note')).toBe('fixture-local-draft');
  await expect(page.getByRole('textbox', { name: '笔记标题' })).toHaveValue('离线时的潮汐草稿');
  await expect(page.getByRole('textbox', { name: '第 1 段正文' })).toHaveValue('断网时写下的正文。');
  await expectNoHorizontalOverflow(page);
});
