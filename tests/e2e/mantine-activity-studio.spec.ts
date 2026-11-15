import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isOwnedDirectory } from './global-setup';

/*
 * B3 activity studio presentation coverage. The activity, content revision and
 * playback revision are real local records; only preview compilation and export
 * packaging are intercepted. No generation task or external service is called.
 */
test.use({ serviceWorkers: 'block' });

const portal = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
const service = 'http://127.0.0.1:' + (process.env.E2E_SERVICE_PORT ?? 4200) + '/api/v1/admin';
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };

async function seedPlaybackActivity(request: APIRequestContext) {
  const fixture = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  fixture.activity.title = 'Mantine 试演样本-' + randomUUID().slice(0, 8);
  const created = await request.post(service + '/activities', { headers, data: { document: fixture } });
  expect(created.status()).toBe(201);
  const activityId = (await created.json() as { activity: { id: string } }).activity.id;
  const base = service + '/activities/' + activityId;

  const generated = await request.post(base + '/playback/generate', { headers, data: {} });
  expect(generated.ok()).toBe(true);
  const playback = (await generated.json() as {
    playbackDocument: { contentRevisionId: string; mediaRevisionId: string; actions: unknown[] } & Record<string, unknown>;
  }).playbackDocument;
  const saved = await request.post(base + '/playback-revisions', {
    headers,
    data: {
      contentRevisionId: playback.contentRevisionId,
      mediaRevisionId: playback.mediaRevisionId,
      document: playback,
    },
  });
  expect(saved.ok()).toBe(true);
  const playbackRevisionId = (await saved.json() as { id: string }).id;
  const current = await request.get(base, { headers });
  expect(current.ok()).toBe(true);
  const detail = await current.json() as {
    activity: { currentContentRevisionId: string; currentMediaRevisionId: string; currentPlaybackRevisionId: string };
  };
  return { activityId, playback, playbackRevisionId, detail: detail.activity };
}

async function openExport(page: Page) {
  await page.getByRole('button', { name: '更多工作台操作' }).click();
  await page.getByRole('menuitem', { name: '导出交付' }).click();
  await expect(page.getByRole('heading', { name: '导出离线包与可渲染工程' })).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  const session = await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } });
  expect(session.ok()).toBe(true);
});

test('an empty act gives phone users a direct way to start the first scene', async ({ page, request }, info) => {
  const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/rework_sample_v1.json', 'utf8'));
  const created = await request.post(service + '/activities', { headers, data: { document } });
  expect(created.status()).toBe(201);
  const { activity } = await created.json() as { activity: { id: string } };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/apps/activities/' + activity.id);
  await expect(page.getByRole('heading', { name: '本幕暂无场次', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '当前场次', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '镜头绘制', exact: true })).toBeDisabled();
  const add = page.getByRole('button', { name: '新增场次', exact: true });
  await expect(add).toBeInViewport();
  await page.screenshot({ path: info.outputPath('empty-act-390.png'), animations: 'disabled' });
  await add.click();
  await expect(page.getByRole('textbox', { name: '场次标题', exact: true })).toHaveValue('新场次 1');
  await expect(page.getByRole('button', { name: '镜头绘制', exact: true })).toBeEnabled();
});

test('saved playback preview uses shared controls and recompiles with the selected device dimensions', async ({ page, request }) => {
  const seeded = await seedPlaybackActivity(request);
  const previewBodies: Array<{
    layout: { width: number; height: number };
    output: { width: number; height: number };
    viewerActorId: string;
    actions: unknown[];
  }> = [];
  await page.route('**/api/admin/activities/*/playback-preview', async (route) => {
    const body = route.request().postDataJSON() as { playback: typeof previewBodies[number] };
    previewBodies.push(body.playback);
    const output = body.playback.output;
    const device = output.width > output.height ? 'desktop' : 'phone';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        html: `<!doctype html><html><body><div id="root" class="device-${device}"><p id="preview-size">${output.width}x${output.height}</p><p id="preview-viewer">${body.playback.viewerActorId}</p></div></body></html>`,
      }),
    });
  });

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/apps/activities/' + seeded.activityId);
    await page.getByRole('button', { name: '试演', exact: true }).click();

    const modeTabs = page.getByRole('tablist', { name: '活动回放模式' });
    await expect(modeTabs.getByRole('tab', { name: '原回放' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: '手机', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: '1x', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('回放动作序列 (' + seeded.playback.actions.length + ')')).toBeVisible();

    const frame = page.frameLocator('iframe[title="活动真实回放预览"]');
    await expect(frame.locator('#preview-size')).toHaveText('1080x1920');
    await expect(frame.locator('#preview-viewer')).toHaveText('actor_lan');
    await expect.poll(() => previewBodies.length).toBe(1);
    expect(previewBodies[0].layout).toEqual({ width: 360, height: 640 });
    expect(previewBodies[0].output).toMatchObject({ width: 1080, height: 1920 });

    await page.getByRole('button', { name: '电脑', exact: true }).click();
    await expect(page.getByRole('button', { name: '电脑', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(frame.locator('#preview-size')).toHaveText('1920x1080');
    await expect.poll(() => previewBodies.length).toBe(2);
    expect(previewBodies[1].layout).toEqual({ width: 1280, height: 720 });
    expect(previewBodies[1].output).toMatchObject({ width: 1920, height: 1080 });
    expect(previewBodies[1].actions).toEqual(previewBodies[0].actions);

    await page.getByRole('button', { name: '关闭试演预览' }).click();
    await expect(page.getByText('回放编排与设备模拟预览')).toBeHidden();
  } finally {
    await request.delete(service + '/activities/' + seeded.activityId, { headers });
  }
});

test('export keeps the chosen format, reports a failed package in place and allows a retry', async ({ page, request }) => {
  const seeded = await seedPlaybackActivity(request);
  const exportBodies: Array<{
    mode: string;
    contentRevisionId: string;
    mediaRevisionId: string;
    playbackRevisionId: string;
  }> = [];
  let attempts = 0;
  await page.route('**/api/admin/activities/*/export', async (route) => {
    attempts += 1;
    exportBodies.push(route.request().postDataJSON() as typeof exportBodies[number]);
    if (attempts === 1) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'export_failed', message: 'fixture 打包器拒绝生成空媒体包' }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/zip', body: Buffer.from('PK\u0005\u0006' + '\0'.repeat(18)) });
  });

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/apps/activities/' + seeded.activityId);
    await openExport(page);

    await page.getByRole('button', { name: /阅读分享包/ }).click();
    await expect(page.getByRole('button', { name: /阅读分享包/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '开始打包并下载 ZIP' }).click();

    const failure = page.getByRole('alert').filter({ hasText: '导出失败' });
    await expect(failure).toContainText('fixture 打包器拒绝生成空媒体包');
    await expect(page.getByRole('button', { name: '开始打包并下载 ZIP' })).toBeEnabled();
    expect(exportBodies[0]).toMatchObject({
      mode: 'reader',
      contentRevisionId: seeded.detail.currentContentRevisionId,
      mediaRevisionId: seeded.detail.currentMediaRevisionId,
      playbackRevisionId: seeded.playbackRevisionId,
    });

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '开始打包并下载 ZIP' }).click();
    await expect((await download).suggestedFilename()).toMatch(/-reader-\d+\.zip$/);
    await expect(failure).toBeHidden();
    expect(exportBodies[1]).toMatchObject({ mode: 'reader' });
    expect(attempts).toBe(2);
  } finally {
    await request.delete(service + '/activities/' + seeded.activityId, { headers });
  }
});
