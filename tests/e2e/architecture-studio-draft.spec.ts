import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { buildActivityDocument, type ContentDocument } from '@sthstart/contracts';
import { isOwnedDirectory } from './global-setup';

const portal = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
const service = 'http://127.0.0.1:' + (process.env.E2E_SERVICE_PORT ?? 4200) + '/api/v1/admin';
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
const sceneTitle = '原始场次标题';

function studioDocument(title: string): ContentDocument {
  const document = buildActivityDocument({
    templateId: 'blank',
    title,
    type: '测试',
    theme: '',
    location: '街角',
    rules: '',
    actors: [{
      id: 'actor-1',
      displayName: '主角',
      persona: {},
      activityRole: '主角',
      outfitDescription: '便装',
    }],
  });
  const stage = document.stages[0];
  if (!stage) throw new Error('buildActivityDocument did not create a stage');
  document.scenes = [{
    id: 'scene-1',
    stageId: stage.id,
    title: sceneTitle,
    timeText: '傍晚',
    locationText: '街角',
    beats: [{
      id: 'beat-1',
      characterId: 'actor-1',
      characterName: '主角',
      action: '站在路灯下等待',
      dialogue: '原始对白。',
      orderIndex: 0,
    }],
    orderIndex: 0,
  }];
  return document;
}

async function seedStudioActivity(request: APIRequestContext) {
  const title = 'Studio 草稿 ' + randomUUID().slice(0, 8);
  const document = studioDocument(title);
  const response = await request.post(service + '/activities', {
    headers,
    data: { document },
  });
  expect(response.status()).toBe(201);
  const created = await response.json() as {
    activity: { id: string };
    draft: { draftVersion: number };
    draftVersion: number;
  };
  return {
    activityId: created.activity.id,
    baseDraftVersion: created.draft.draftVersion,
    title,
  };
}

async function readDraft(request: APIRequestContext, activityId: string) {
  const response = await request.get(service + '/activities/' + activityId + '/draft', { headers });
  expect(response.ok()).toBe(true);
  const payload = await response.json() as {
    draft: {
      draftVersion: number;
      document: ContentDocument;
    };
  };
  return payload.draft;
}

function draftTitle(document: ContentDocument) {
  return document.scenes?.find((scene) => scene.id === 'scene-1')?.title;
}

test.beforeEach(async ({ context }) => {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  const session = await context.request.post(portal + '/api/auth/admin-session', {
    headers: { origin: portal },
  });
  expect(session.ok()).toBe(true);
});

test('Studio 保存请求未返回时继续输入，最终草稿包含后一次编辑', async ({ page, request }) => {
  const seeded = await seedStudioActivity(request);
  const pattern = new RegExp('/api/admin/activities/' + seeded.activityId + '/draft$');
  const writes: Array<{ expectedDraftVersion: number; document: ContentDocument }> = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let holdFirst = true;

  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    writes.push(route.request().postDataJSON() as {
      expectedDraftVersion: number;
      document: ContentDocument;
    });
    if (holdFirst) {
      holdFirst = false;
      await firstGate;
    }
    await route.continue();
  });

  try {
    await page.goto('/apps/activities/' + seeded.activityId);
    const titleField = page.getByRole('textbox', { name: '场次标题', exact: true });
    await expect(titleField).toHaveValue(sceneTitle, { timeout: 15_000 });
    await expect(page.getByRole('status').filter({ hasText: '已保存' }).first()).toBeVisible({ timeout: 15_000 });

    const firstTitle = '保存中的场次标题';
    await titleField.fill(firstTitle);
    const firstRequest = page.waitForRequest((candidate) =>
      candidate.method() === 'PUT'
      && candidate.url().endsWith('/activities/' + seeded.activityId + '/draft'),
    );
    await page.keyboard.press('Control+s');
    await firstRequest;
    await expect(page.getByRole('status').filter({ hasText: '保存中…' }).first()).toBeVisible();

    const continuedTitle = '保存中继续输入的场次标题';
    await titleField.fill(continuedTitle);
    releaseFirst();

    await expect.poll(() => writes.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    await expect(page.getByRole('status').filter({ hasText: '已保存' }).first()).toBeVisible({ timeout: 10_000 });

    const saved = await readDraft(request, seeded.activityId);
    expect(saved.draftVersion).toBeGreaterThan(seeded.baseDraftVersion);
    expect(draftTitle(saved.document)).toBe(continuedTitle);
    expect(draftTitle(writes[0]!.document)).toBe(firstTitle);
    expect(draftTitle(writes.at(-1)!.document)).toBe(continuedTitle);
    expect(writes[0]!.expectedDraftVersion).toBe(seeded.baseDraftVersion);
    expect(writes.at(-1)!.expectedDraftVersion).toBe(writes[0]!.expectedDraftVersion + 1);
  } finally {
    releaseFirst();
    await request.delete(service + '/activities/' + seeded.activityId, { headers });
  }
});

test('Studio 409 冲突保留本机输入，刷新后从本机会话恢复且不覆盖服务器草稿', async ({ page, request }) => {
  const seeded = await seedStudioActivity(request);
  const pattern = new RegExp('/api/admin/activities/' + seeded.activityId + '/draft$');
  const conflictTitle = '冲突后仍需保留的本机场次标题';

  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'draft_version_conflict',
        message: '草稿已被其他人或在其他标签页修改。',
      }),
    });
  });

  try {
    await page.goto('/apps/activities/' + seeded.activityId);
    const titleField = page.getByRole('textbox', { name: '场次标题', exact: true });
    await expect(titleField).toHaveValue(sceneTitle, { timeout: 15_000 });

    await titleField.fill(conflictTitle);
    const failedSave = page.waitForResponse((response) =>
      response.request().method() === 'PUT'
      && response.url().endsWith('/activities/' + seeded.activityId + '/draft'),
    );
    await page.keyboard.press('Control+s');
    expect((await failedSave).status()).toBe(409);

    await expect(page.getByRole('alert').filter({ hasText: '服务器草稿已更新。你的输入仍保留在此页面。' })).toBeVisible({ timeout: 10_000 });
    await expect(titleField).toHaveValue(conflictTitle);
    expect(draftTitle((await readDraft(request, seeded.activityId)).document)).toBe(sceneTitle);

    await page.reload();
    const recoveredTitle = page.getByRole('textbox', { name: '场次标题', exact: true });
    await expect(recoveredTitle).toHaveValue(conflictTitle, { timeout: 15_000 });
    await expect(page.getByRole('alert').filter({ hasText: '已找回离开前未保存的输入' })).toBeVisible({ timeout: 10_000 });
    expect(draftTitle((await readDraft(request, seeded.activityId)).document)).toBe(sceneTitle);
  } finally {
    await request.delete(service + '/activities/' + seeded.activityId, { headers });
  }
});
