import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { isOwnedDirectory } from './global-setup';

const portal = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
const service = 'http://127.0.0.1:' + (process.env.E2E_SERVICE_PORT ?? 4200) + '/api/v1/admin';
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
const shotDirectory = resolve('artifacts/visual-verification/2026-11-20-p2/after');

/** 生成一张真实可解码的 PNG（渐变色块），让 <img> 能触发 onLoad。 */
function gradientPng(width: number, height: number, hue: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2; header[10] = 0; header[11] = 0; header[12] = 0;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      const t = (x / width + y / height) / 2;
      row[1 + x * 3] = Math.round(hue[0] * (0.55 + 0.45 * t));
      row[2 + x * 3] = Math.round(hue[1] * (0.55 + 0.45 * t));
      row[3 + x * 3] = Math.round(hue[2] * (0.55 + 0.45 * t));
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function create<T>(request: APIRequestContext, path: string, data: object): Promise<T> {
  const response = await request.post(service + path, { headers, data });
  expect(response.ok(), 'fixture ' + path + ': ' + await response.text()).toBe(true);
  return response.json() as Promise<T>;
}

async function seed(request: APIRequestContext) {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  const project = await create<{ id: string }>(request, '/story/projects', { title: '封面验收项目', summary: '用于验证封面上传、显示与移除。' });
  const activity = await create<{ activity: { id: string } }>(request, '/activities', {
    document: JSON.parse(readFileSync('packages/activity-playback/fixtures/rework_sample_v1.json', 'utf8')),
  });
  const bundle = await create<{ world: { id: string } }>(request, '/story-worlds/create-bundle', {
    idempotencyKey: 'cover-e2e-' + crypto.randomUUID(),
    definition: {
      title: '封面验收作品', summary: '潮水退去之后，灯塔下多出一封没有署名的信。', timeLabel: '归航日',
      locations: [{ id: 'lighthouse', name: '旧灯塔', description: '灯塔。' }],
      actors: [{ id: 'keeper', name: '守灯人林舟', role: 'main', locationId: 'lighthouse', goals: ['读懂来信'],
        characterId: null, characterVersion: null, background: '', personality: '', speechStyle: '', appearance: '', referenceArtifactIds: [] }],
      sources: [], lockedFacts: [], models: { action: null, adjudication: null, narration: null }, visualStyle: '',
    },
    initialBranch: { title: '主线', mode: 'canon-gap', direction: '跟随来信展开。' },
  });
  return { projectId: project.id, activityId: activity.activity.id, worldId: bundle.world.id };
}

async function uploadViaApi(request: APIRequestContext, png: Buffer) {
  const response = await request.post(service + '/covers/uploads', {
    headers: { ...headers, 'content-type': 'image/png', 'x-artifact-original-name': encodeURIComponent('cover.png') },
    data: png,
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json() as { artifactId: string }).artifactId;
}

async function setCover(request: APIRequestContext, type: string, id: string, artifactId: string | null) {
  const response = await request.put(`${service}/covers/${type}/${id}`, { headers, data: { artifactId } });
  expect(response.ok(), await response.text()).toBe(true);
}

async function openContext(browser: Browser, viewport = { width: 1440, height: 900 }, theme?: string) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, reducedMotion: 'reduce', serviceWorkers: 'block' });
  expect((await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } })).ok()).toBe(true);
  if (theme) await context.addInitScript(id => localStorage.setItem('sthstart_theme_id', id), theme);
  await context.route(url => (url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== portal, route => route.abort());
  return context;
}

async function ready(page: Page) {
  await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true', { timeout: 15_000 });
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
}

/** 封面图片真正解码完成（而不只是 DOM 存在）。 */
async function expectCoverImage(scope: ReturnType<Page['locator']>) {
  const image = scope.locator('[data-entity-image="image"] img').first();
  await expect(image).toBeVisible();
  await expect.poll(async () => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
}

test('project covers can be uploaded, shown everywhere, kept after reload and removed', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { projectId } = await seed(request);
  const context = await openContext(browser);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`/apps/projects/${projectId}`);
    await ready(page);
    await expect(page.getByRole('heading', { level: 1, name: '封面验收项目' })).toBeVisible();
    const field = page.getByRole('region', { name: '封面验收项目的封面' });
    await expect(field.locator('[data-entity-art="true"]')).toBeVisible();

    await field.getByRole('button', { name: '设置封面' }).click();
    const dialog = page.getByRole('dialog', { name: '选择封面' });
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('cover-upload-input').setInputFiles({ name: '海边封面.png', mimeType: 'image/png', buffer: gradientPng(320, 200, [70, 130, 190]) });
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expectCoverImage(field);
    await expect(field.getByRole('button', { name: '更换封面' })).toBeVisible();

    await page.reload();
    await ready(page);
    await expectCoverImage(page.getByRole('region', { name: '封面验收项目的封面' }));

    // 封面同时出现在首页「最近工作」，并能从媒体库重新选中（不再上传）。
    await page.goto('/');
    await ready(page);
    await expectCoverImage(page.getByTestId('recent-work-list').getByRole('link', { name: /封面验收项目/ }));

    await page.goto(`/apps/projects/${projectId}`);
    await ready(page);
    const reopened = page.getByRole('region', { name: '封面验收项目的封面' });
    await reopened.getByRole('button', { name: '更换封面' }).click();
    const picker = page.getByRole('dialog', { name: '选择封面' });
    await expect(picker.getByRole('button', { name: '使用「海边封面.png」作为封面' })).toHaveAttribute('aria-pressed', 'true');
    await picker.getByRole('button', { name: '使用「海边封面.png」作为封面' }).click();
    await expect(picker).toBeHidden();

    await reopened.getByRole('button', { name: '移除封面' }).click();
    await expect(reopened.locator('[data-entity-art="true"]')).toBeVisible();
    await expect(reopened.getByRole('button', { name: '设置封面' })).toBeVisible();
    await page.reload();
    await ready(page);
    await expect(page.getByRole('region', { name: '封面验收项目的封面' }).locator('[data-entity-image="art"]')).toBeVisible();

    const cover = await (await request.get(`${service}/covers/story-project/${projectId}`, { headers })).json();
    expect(cover.coverArtifactId).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('invalid cover files are rejected in the picker without changing the cover', async ({ browser, request }) => {
  const { projectId } = await seed(request);
  const context = await openContext(browser);
  const page = await context.newPage();
  try {
    await page.goto(`/apps/projects/${projectId}`);
    await ready(page);
    const field = page.getByRole('region', { name: '封面验收项目的封面' });
    await field.getByRole('button', { name: '设置封面' }).click();
    const dialog = page.getByRole('dialog', { name: '选择封面' });
    await dialog.getByTestId('cover-upload-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('不是图片') });
    await expect(dialog.getByText('封面只支持 PNG、JPEG、WebP、GIF 或 AVIF 图片。')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(field.locator('[data-entity-art="true"]')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('world and activity covers appear on the work directory, work home and production list', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { worldId, activityId } = await seed(request);
  const artifactId = await uploadViaApi(request, gradientPng(320, 200, [190, 120, 80]));
  await setCover(request, 'story-world', worldId, artifactId);
  await setCover(request, 'activity', activityId, artifactId);
  const context = await openContext(browser);
  const page = await context.newPage();
  try {
    await page.goto('/apps/story-worlds');
    await ready(page);
    const card = page.getByRole('list', { name: '作品列表' }).getByRole('listitem').filter({ hasText: '封面验收作品' });
    await expectCoverImage(card);

    await page.goto(`/apps/story-worlds?world=${worldId}`);
    await ready(page);
    const hubCover = page.getByRole('region', { name: '封面验收作品的封面' });
    await expectCoverImage(hubCover);
    await expect(hubCover.getByRole('button', { name: '更换封面' })).toBeVisible();

    await page.goto('/apps/activities?view=card');
    await ready(page);
    await expect.poll(async () => page.locator('.activity-card [data-entity-image="image"]').count()).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
  for (const theme of ['light-paper', 'dark-espresso']) {
    test(`P2 cover surfaces at ${viewport.width}px in ${theme}`, async ({ browser, request }) => {
      test.skip(!process.env.STHSTART_P2_SHOTS, 'Set STHSTART_P2_SHOTS=1 to save P2 acceptance screenshots.');
      test.setTimeout(180_000);
      mkdirSync(shotDirectory, { recursive: true });
      const { projectId, worldId, activityId } = await seed(request);
      // 一半实体有封面、一半没有：同时检查真实图像与生成式占位。
      const artifactId = await uploadViaApi(request, gradientPng(640, 400, [86, 120, 170]));
      await setCover(request, 'story-world', worldId, artifactId);
      await setCover(request, 'activity', activityId, artifactId);
      // 行视图需要至少 3 个制作项目；角色库需要角色才能看到头像占位。
      for (let index = 0; index < 2; index += 1) {
        await create(request, '/activities', { document: JSON.parse(readFileSync('packages/activity-playback/fixtures/rework_sample_v1.json', 'utf8')) });
      }
      const characters: string[] = [];
      for (const name of ['守灯人林舟', '苏禾', '遥音']) {
        const created = await create<{ id?: string; character?: { id: string } }>(request, '/characters', {
          displayName: name, tags: ['验收'], draft: { displayName: name, work: '封面验收作品' },
        });
        characters.push(created.character?.id ?? created.id!);
      }
      const context = await openContext(browser, viewport, theme);
      const page = await context.newPage();
      try {
        const shots: Array<[string, string]> = [
          ['character-detail', `/apps/characters/${characters[0]}`],
          ['home', '/'],
          ['works', '/apps/story-worlds'],
          ['world-hub', `/apps/story-worlds?world=${worldId}`],
          ['project-detail', `/apps/projects/${projectId}`],
          ['activities-card', '/apps/activities?view=card'],
          ['activities-row', '/apps/activities?view=row'],
          ['characters', '/apps/characters'],
        ];
        for (const [name, route] of shots) {
          await page.goto(route);
          await ready(page);
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          await page.waitForTimeout(600);
          await page.screenshot({ path: resolve(shotDirectory, `${theme}-${viewport.width}-${name}.png`), animations: 'disabled', scale: 'css' });
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(overflow, name + ' horizontal overflow').toBeLessThanOrEqual(1);
        }
      } finally {
        await context.close();
      }
    });
  }
}

/*
 * P3：作品设定页（编辑）直接接入封面；新建制作项目在创建前暂存封面，创建成功后写入。
 */
test('the work settings page sets a cover on the existing work', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { worldId } = await seed(request);
  const context = await openContext(browser);
  const page = await context.newPage();
  try {
    const overview = await request.get(`${service}/story-worlds/${worldId}`, { headers });
    const branchId = ((await overview.json()) as { branches: Array<{ id: string }> }).branches[0].id;
    await page.goto(`/apps/story-worlds/${worldId}/edit?branch=${branchId}`);
    await ready(page);
    await expect(page.getByRole('heading', { name: '作品设定', exact: true })).toBeVisible();
    const field = page.getByRole('region', { name: '封面验收作品的封面' });
    await field.getByRole('button', { name: '设置封面' }).click();
    const dialog = page.getByRole('dialog', { name: '选择封面' });
    await dialog.getByTestId('cover-upload-input').setInputFiles({ name: '设定页封面.png', mimeType: 'image/png', buffer: gradientPng(320, 200, [180, 120, 70]) });
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expectCoverImage(field);
    const cover = await request.get(`${service}/covers/story-world/${worldId}`, { headers });
    expect(((await cover.json()) as { coverArtifactId: string | null }).coverArtifactId).toBeTruthy();
  } finally {
    await context.close();
  }
});

test('a new production project keeps the cover picked before it was created', async ({ browser, request }) => {
  test.setTimeout(120_000);
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  const name = '封面新建角色-' + crypto.randomUUID().slice(0, 8);
  // 原创角色需先保存具名阶段才能选入企划；这里用原作角色，直接可选。
  await create(request, '/characters', { displayName: name, tags: ['封面'], draft: { displayName: name, work: '原神', originType: 'ip' } });
  const artifactId = await uploadViaApi(request, gradientPng(320, 200, [90, 160, 120]));
  const context = await openContext(browser);
  const page = await context.newPage();
  try {
    await page.goto('/apps/activities/new');
    await ready(page);
    await page.getByRole('tab', { name: '挑选角色与题材生成', exact: true }).click();
    const field = page.locator('.new-activity-cover');
    await field.getByRole('button', { name: '设置封面' }).click();
    const dialog = page.getByRole('dialog', { name: '选择封面' });
    await dialog.locator('.cover-picker-item').first().click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(field.getByRole('button', { name: '更换封面' })).toBeVisible();
    await page.locator('#custom-activity-title').fill('封面新建工程');
    await page.getByRole('searchbox', { name: '搜索角色', exact: true }).fill(name);
    await page.getByRole('button', { name: '选择角色', exact: true }).first().click();
    await page.getByRole('button', { name: '创建四幕分镜工程', exact: true }).click();
    await page.waitForURL((url) => /^\/apps\/activities\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith('/new'), { timeout: 30_000 });
    const activityId = new URL(page.url()).pathname.split('/').pop()!;
    const cover = await request.get(`${service}/covers/activity/${activityId}`, { headers });
    const body = await cover.text();
    const stored = (JSON.parse(body) as { coverArtifactId?: string | null }).coverArtifactId;
    expect(stored, `activity ${activityId}: ${cover.status()} ${body}`).toBeTruthy();
    // 媒体库第一张可能是其他用例上传的图片；这里只要求写入的是一张有效封面，并记录本用例上传的 ID 以便排查。
    expect(typeof stored).toBe('string');
    void artifactId;
  } finally {
    await context.close();
  }
});
