import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/*
 * C3 fixture coverage. These tests never submit a generation task: every
 * creative response is a fixed fixture, and any non-GET creative request is
 * recorded and rejected. The media file endpoint uses a local PNG so
 * ready, missing and load-failed records remain distinguishable.
 */
test.use({ serviceWorkers: 'block' });

/*
 * SSR paints the shell and its controls before React attaches handlers, so a
 * click in that window is dropped. Gate the first real click on the shell's
 * hydration marker; the assertions themselves stay unchanged.
 */
async function expectHydrated(page: Page) {
  await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');
}

// Screenshot evidence is opt-in and never part of the pass/fail contract.
const captureEvidence = Boolean(process.env.STHSTART_ROUTE_MATRIX || process.env.STHSTART_E2E_SCREENSHOTS);

const portal = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
const MEDIA_SAMPLE = readFileSync(new URL('./fixtures/mantine-media-sample.png', import.meta.url));
const SAMPLE_WIDTH = 320;
const SAMPLE_HEIGHT = 180;

type MediaMode = 'ready' | 'empty' | 'error' | 'loading';

function mediaItem(id: string, name: string, fileStatus: 'ready' | 'missing' | 'quarantined') {
  return {
    id,
    appId: 'creative-center',
    appName: '自由生成',
    appHref: '/apps/creative',
    contentType: 'image/png',
    byteSize: MEDIA_SAMPLE.byteLength,
    sha256: null,
    fileStatus,
    originalName: name,
    mediaType: 'image',
    mediaKind: 'image',
    width: SAMPLE_WIDTH,
    height: SAMPLE_HEIGHT,
    durationMs: null,
    createdAt: '2026-11-14T08:00:00.000Z',
    updatedAt: null,
    fileUrl: '/api/v1/admin/media-library/' + id + '/file',
    thumbnailArtifactId: null,
    references: [],
    referenceSummary: { totalCount: 0, appCounts: {}, topRefs: [] },
  };
}

async function installMediaRoutes(page: Page) {
  const state = {
    mode: 'ready' as MediaMode,
    listRequests: 0,
    fileRequests: [] as string[],
  };
  await page.route('**/api/admin/media-library**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/media-library') {
      state.listRequests += 1;
      if (state.mode === 'error') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'fixture_failure', message: '媒体索引暂时不可用' }),
        });
        return;
      }
      if (state.mode === 'loading') await new Promise((resolve) => setTimeout(resolve, 900));
      const items = state.mode === 'empty'
        ? []
        : [
            mediaItem('ready-1', 'ready.png', 'ready'),
            mediaItem('missing-1', 'missing.png', 'missing'),
            mediaItem('failed-1', 'failed.png', 'ready'),
          ];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items, total: items.length, limit: 24, offset: 0 }),
      });
      return;
    }
    const match = /^\/api\/admin\/media-library\/([^/]+)\/file$/.exec(url.pathname);
    if (match) {
      const id = decodeURIComponent(match[1]);
      state.fileRequests.push(id);
      if (id === 'failed-1') {
        await route.fulfill({ status: 404, contentType: 'text/plain', body: 'fixture file missing' });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'image/png', body: MEDIA_SAMPLE });
      return;
    }
    await route.continue();
  });
  return state;
}

test.beforeEach(async ({ context }) => {
  expect((await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } })).ok()).toBe(true);
});

test.describe('C3 media library', () => {
  // Retina captures keep dialog text legible when evidence is enabled.
  test.use({ ...(captureEvidence ? { deviceScaleFactor: 2 } : {}) });

  test('ready, missing and load-failed records stay distinguishable and only usable bytes are previewed', async ({ page }, info) => {
    const media = await installMediaRoutes(page);
    await page.goto('/apps/media');

    const readyCard = page.locator('article').filter({ hasText: 'ready.png' });
    const missingCard = page.locator('article').filter({ hasText: 'missing.png' });
    const failedCard = page.locator('article').filter({ hasText: 'failed.png' });
    await expect(readyCard.getByRole('button', { name: '预览 ready.png' })).toBeVisible();
    await expect(missingCard.getByText('缺失', { exact: true })).toBeVisible();
    await expect(failedCard.getByText('缩略图加载失败')).toBeVisible();

    expect(media.fileRequests).toContain('ready-1');
    expect(media.fileRequests).toContain('failed-1');
    expect(media.fileRequests.filter((id) => id === 'missing-1')).toHaveLength(0);

    await page.getByRole('button', { name: '预览 ready.png' }).click();
    const readyDialog = page.getByRole('dialog', { name: 'ready.png' });
    await expect(readyDialog.getByText('可用', { exact: true })).toBeVisible();
    await expect(readyDialog.getByRole('img', { name: 'ready.png' })).toHaveJSProperty('naturalWidth', SAMPLE_WIDTH);
    await expect.poll(() => readyDialog.evaluate(el => {
      const box = el.getBoundingClientRect();
      return Math.max(Math.abs((box.left + box.right - innerWidth) / 2), Math.abs((box.top + box.bottom - innerHeight) / 2));
    })).toBeLessThanOrEqual(2);
    if (captureEvidence) {
      const path = info.outputPath('media-ready-preview.png');
      await page.screenshot({ path, animations: 'disabled' });
      await info.attach('media-ready-preview', { path, contentType: 'image/png' });
    }
    await page.mouse.click(8, 8);
    await expect(readyDialog).toBeHidden();
    await expect(readyCard.getByRole('button', { name: '预览 ready.png' })).toBeFocused();

    const missingFileRequests = media.fileRequests.filter((id) => id === 'missing-1').length;
    await page.getByRole('button', { name: '预览 missing.png' }).click();
    const missingDialog = page.getByRole('dialog', { name: 'missing.png' });
    await expect(missingDialog.getByText('源文件缺失或不可访问')).toBeVisible();
    await expect(missingDialog.getByRole('button', { name: '打开原文件' })).toBeDisabled();
    expect(media.fileRequests.filter((id) => id === 'missing-1')).toHaveLength(missingFileRequests);
    if (captureEvidence) {
      const path = info.outputPath('media-missing-file.png');
      await missingDialog.screenshot({ path, animations: 'disabled' });
      await info.attach('media-missing-file', { path, contentType: 'image/png' });
    }
    await missingDialog.getByRole('button', { name: '关闭对话框' }).click();

    await page.getByRole('button', { name: '预览 failed.png' }).click();
    const failedDialog = page.getByRole('dialog', { name: 'failed.png' });
    await expect(failedDialog.getByRole('alert')).toContainText('文件加载失败');
    await expect(failedDialog.getByRole('button', { name: '重试预览' })).toBeVisible();
  });

  test('loading, empty and request failure use the shared feedback and recover through the visible actions', async ({ page }) => {
    const media = await installMediaRoutes(page);
    media.mode = 'loading';
    await page.goto('/apps/media');
    await expect(page.getByText('加载中', { exact: true })).toBeAttached();
    await expect(page.getByText('ready.png', { exact: true }).first()).toBeVisible({ timeout: 5_000 });

    media.mode = 'empty';
    await page.getByRole('button', { name: '刷新媒体库' }).click();
    await expect(page.getByText('媒体库暂无产物')).toBeVisible();

    media.mode = 'error';
    await page.getByRole('button', { name: '刷新媒体库' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '媒体库暂时无法读取' })).toContainText('媒体索引暂时不可用');

    media.mode = 'ready';
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await expect(page.getByText('ready.png', { exact: true }).first()).toBeVisible();
  });

  test('a phone-width short viewport keeps the preview action reachable without horizontal overflow', async ({ page }) => {
    const media = await installMediaRoutes(page);
    await page.setViewportSize({ width: 390, height: 640 });
    await page.goto('/apps/media');
    await expect(page.getByRole('button', { name: '预览 ready.png' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

    await page.getByRole('button', { name: '预览 ready.png' }).click();
    const dialog = page.getByRole('dialog', { name: 'ready.png' });
    await dialog.getByRole('button', { name: '打开原文件' }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole('button', { name: '打开原文件' })).toBeVisible();
    await expect(dialog.getByText('可用', { exact: true })).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(391);
    expect(box.y + box.height).toBeLessThanOrEqual(641);
    expect(media.fileRequests).toContain('ready-1');
  });
});

type CreativeMode = 'empty' | 'loading' | 'artifacts-error' | 'tasks-error' | 'tasks';

function creativeBinding(purpose: string) {
  return {
    purpose,
    ready: false,
    status: 'not_configured',
    workflow: null,
    engine: null,
  };
}

function creativeStatus() {
  return {
    app: { id: 'creative-center', name: '自由生成' },
    modes: {
      textToImage: creativeBinding('text-to-image'),
      imageToImage: creativeBinding('image-to-image'),
      h3T2v: creativeBinding('h3-t2v'),
      h3I2v: creativeBinding('h3-i2v'),
      h3Fl2va: creativeBinding('h3-fl2va'),
    },
  };
}

function creativeTask(id: string, status: 'running' | 'failed') {
  return {
    id,
    appId: 'creative-center',
    engineId: 'fixture-engine',
    workflowId: 'fixture-workflow',
    workflowVersion: 3,
    purpose: 'text-to-image',
    idempotencyKey: null,
    status,
    priority: 'normal',
    ...(status === 'running' ? { progress: { value: 0.42, stage: 'sampling', message: '正在采样' } } : {}),
    actualSeed: 20261114,
    providerTaskId: null,
    errorCode: status === 'failed' ? 'fixture_failure' : null,
    errorMessage: status === 'failed' ? '固定数据模拟的上游失败' : null,
    upstreamMayContinue: false,
    cancellationScope: 'none',
    retryOf: null,
    createdAt: '2026-11-14T08:00:00.000Z',
    updatedAt: '2026-11-14T08:00:02.000Z',
    finishedAt: status === 'failed' ? '2026-11-14T08:00:03.000Z' : null,
    artifacts: [],
    replay: {
      mode: 'text-to-image',
      inputs: { prompt: '固定任务提示词', steps: 20 },
      inputArtifactIds: [],
    },
  };
}

async function installCreativeRoutes(page: Page) {
  const state = {
    mode: 'empty' as CreativeMode,
    writes: [] as Array<{ method: string; path: string }>,
  };
  await page.route('**/api/admin/creative/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') {
      state.writes.push({ method: request.method(), path: url.pathname });
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'fixture_no_generation' }) });
      return;
    }
    if (url.pathname === '/api/admin/creative/status') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(creativeStatus()) });
      return;
    }
    if (url.pathname === '/api/admin/creative/options') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ app: { id: 'creative-center', name: '自由生成' }, purposes: [] }) });
      return;
    }
    if (url.pathname === '/api/admin/creative/tasks') {
      if (state.mode === 'loading') await new Promise((resolve) => setTimeout(resolve, 900));
      if (state.mode === 'tasks-error') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'fixture_tasks', message: '固定任务列表失败' }) });
        return;
      }
      const items = state.mode === 'tasks' ? [creativeTask('task-running', 'running'), creativeTask('task-failed', 'failed')] : [];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items }) });
      return;
    }
    if (url.pathname === '/api/admin/creative/artifacts') {
      if (state.mode === 'loading') await new Promise((resolve) => setTimeout(resolve, 900));
      if (state.mode === 'artifacts-error') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'fixture_artifacts', message: '固定媒体列表失败' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'fixture_not_found' }) });
  });
  await page.route('**/api/admin/generation/events**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
  });
  return state;
}

test.describe('C3 creative workspace', () => {
  test('loading, empty, artifact error and task error are fixture-driven and recover without a generation call', async ({ page }) => {
    const creative = await installCreativeRoutes(page);
    creative.mode = 'loading';
    await page.goto('/apps/creative');
    await expect(page.getByRole('heading', { name: '自由生成', level: 1 })).toBeVisible();
    await expect(page.getByText('加载中', { exact: true })).toBeAttached();
    await expect(page.getByText('媒体库还是空的')).toBeVisible({ timeout: 5_000 });

    creative.mode = 'artifacts-error';
    await page.getByRole('button', { name: '刷新生成页面' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '媒体读取失败' })).toBeVisible();

    creative.mode = 'empty';
    await page.getByRole('button', { name: '重新读取媒体' }).click();
    await expect(page.getByText('媒体库还是空的')).toBeVisible();

    creative.mode = 'tasks-error';
    await page.getByRole('button', { name: '刷新生成页面' }).click();
    await page.getByRole('tab', { name: /生成任务/ }).click();
    await expect(page.getByRole('alert').filter({ hasText: '任务读取失败' })).toBeVisible();
    await expect(page.getByRole('button', { name: '重新读取任务' })).toBeVisible();

    creative.mode = 'tasks';
    await page.getByRole('button', { name: '重新读取任务' }).click();
    await expect(page.getByText('正在采样')).toBeVisible();
    await expect(page.getByText('固定数据模拟的上游失败')).toBeVisible();
    await expect(page.getByRole('button', { name: '取消' })).toBeVisible();
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible();
    expect(creative.writes).toEqual([]);
  });

  test('the service popover, result tabs and mobile pane switch stay reachable at a short phone viewport', async ({ page }) => {
    const creative = await installCreativeRoutes(page);
    await page.setViewportSize({ width: 390, height: 640 });
    await page.goto('/apps/creative');
    await expectHydrated(page);

    const service = page.getByRole('button', { name: /服务待配置/ });
    await service.click();
    await expect(page.getByRole('heading', { name: '公共生成状态' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: '公共生成状态' })).toBeHidden();
    await expect(service).toBeFocused();

    const mobilePane = page.getByRole('group', { name: '生图工作区分栏' });
    await mobilePane.getByRole('button', { name: '作品 / 任务', exact: true }).click();
    await expect(mobilePane.getByRole('button', { name: '作品 / 任务', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('媒体库还是空的')).toBeVisible();

    const resultTabs = page.getByRole('tablist', { name: '创作结果视图' });
    const first = resultTabs.getByRole('tab', { name: /媒体库/ });
    await first.focus();
    await page.keyboard.press('End');
    const last = resultTabs.getByRole('tab', { name: /生成任务/ });
    await expect(last).toHaveAttribute('aria-selected', 'true');
    await expect(last).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(creative.writes).toEqual([]);
  });
});

type InspirationMode = 'empty' | 'error';

function topicSettings() {
  return {
    settings: {
      enabled: false,
      works: [],
      keywords: [],
      sources: [],
      dailyTime: '09:00',
      maxNewTopics: 20,
      timezone: 'Asia/Shanghai',
    },
    nextRunLocal: null,
    defaults: { dailyTime: '09:00', timezone: 'Asia/Shanghai' },
  };
}

test.describe('C3 inspiration entry', () => {
  test('the assigned inspiration route exposes empty and request-error states at phone width', async ({ page }) => {
    const state = { mode: 'empty' as InspirationMode };
    await page.route('**/api/admin/topics**', async (route) => {
      if (state.mode === 'error') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'fixture_topics', message: '固定灵感列表失败' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, pageSize: 20, facets: { works: [], kinds: [] } }) });
    });
    await page.route('**/api/admin/topic-collection/settings', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(topicSettings()) });
    });
    await page.route('**/api/admin/topic-collection/runs**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], lastSuccessful: null, retryable: null }) });
    });
    await page.route('**/api/admin/activity-idea-batches**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
    });

    await page.setViewportSize({ width: 390, height: 640 });
    await page.goto('/apps/inspiration');
    await expect(page.getByRole('heading', { name: '灵感素材', level: 1 })).toBeVisible();
    await expect(page.getByText('还没有素材')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

    state.mode = 'error';
    await page.getByRole('button', { name: '刷新列表' }).click();
    await expect(page.getByRole('status').filter({ hasText: '素材加载失败' })).toContainText('固定灵感列表失败');
  });
});
