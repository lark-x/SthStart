import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { PublicationDraft, StoryEntryRevision } from '@sthstart/contracts';
import { isOwnedDirectory } from './global-setup';

const portal = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
const service = 'http://127.0.0.1:' + (process.env.E2E_SERVICE_PORT ?? 4200) + '/api/v1/admin';
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
const chapterBody = '出版冻结前的原始正文。';

async function seedStory(request: APIRequestContext) {
  const title = '出版验收 ' + randomUUID().slice(0, 8);
  const projectResponse = await request.post(service + '/story/projects', {
    headers,
    data: { title, summary: '' },
  });
  expect(projectResponse.status()).toBe(201);
  const project = await projectResponse.json() as { id: string };
  const chapterResponse = await request.post(
    service + '/story/projects/' + project.id + '/documents',
    { headers, data: { kind: 'chapter', title: '第一章', body: chapterBody } },
  );
  expect(chapterResponse.status()).toBe(201);
  const chapter = await chapterResponse.json() as { id: string; title: string; body: string };
  return { projectId: project.id, chapter };
}

async function readChapterRevisions(
  request: APIRequestContext,
  projectId: string,
  chapterId: string,
) {
  const response = await request.get(
    service + '/story/projects/' + projectId + '/entries/chapter/' + chapterId + '/revisions',
    { headers },
  );
  expect(response.ok()).toBe(true);
  return (await response.json() as { items: StoryEntryRevision[] }).items;
}

async function readPublication(request: APIRequestContext, activityId: string) {
  const response = await request.get(
    service + '/activities/' + activityId + '/publication',
    { headers },
  );
  expect(response.ok()).toBe(true);
  return response.json() as Promise<PublicationDraft>;
}

async function seedPublication(request: APIRequestContext) {
  const seeded = await seedStory(request);
  const revisions = await readChapterRevisions(request, seeded.projectId, seeded.chapter.id);
  expect(revisions[0]).toBeTruthy();
  const response = await request.post(
    service + '/story/projects/' + seeded.projectId + '/publications',
    { headers, data: { entryRevisionIds: [revisions[0]!.id] } },
  );
  expect(response.status()).toBe(201);
  const draft = await response.json() as PublicationDraft;
  return {
    ...seeded,
    activityId: draft.activityId,
    revisionId: revisions[0]!.id,
  };
}

async function prepareSavedDialogue(page: Page, text: string) {
  await page.getByRole('button', { name: '添加关键镜头', exact: true }).click();
  await page.getByRole('tab', { name: '2. 画面与配音', exact: true }).click();
  const dialogueSection = page.getByRole('region', { name: '对白与配音编辑' });
  await expect(dialogueSection).toBeVisible({ timeout: 10_000 });
  await dialogueSection.getByRole('button', { name: '添加一句对白', exact: true }).click();
  const dialogue = page.getByRole('textbox', { name: '第1句对白', exact: true });
  await dialogue.fill(text);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByTestId('publication-workspace').locator('header').getByText('已保存', { exact: true })).toBeVisible({ timeout: 15_000 });
  return dialogue;
}

test.beforeEach(async ({ context }) => {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  const session = await context.request.post(portal + '/api/auth/admin-session', {
    headers: { origin: portal },
  });
  expect(session.ok()).toBe(true);
});

test('Story 创建制作版本先 flush 活跃章节，冻结最新修订并在出版工作台保存对白', async ({ page, request }) => {
  const seeded = await seedStory(request);
  let activityId = '';
  const documentPattern = new RegExp(
    '/api/admin/story/projects/' + seeded.projectId + '/documents/' + seeded.chapter.id + '$',
  );
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let holdFirst = true;
  const savedBodies: string[] = [];

  await page.route(documentPattern, async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    savedBodies.push((route.request().postDataJSON() as { body: string }).body);
    if (holdFirst) {
      holdFirst = false;
      await firstGate;
    }
    await route.continue();
  });

  try {
    const latestBody = '出版冻结前刚写入的最新正文。';
    await page.goto('/apps/story/' + seeded.projectId);
    const editor = page.getByRole('textbox', { name: '小说正文编辑' });
    await expect(editor).toHaveValue(chapterBody, { timeout: 15_000 });
    await editor.fill(latestBody);
    const firstSave = page.waitForRequest((candidate) =>
      candidate.method() === 'PUT'
      && candidate.url().endsWith('/documents/' + seeded.chapter.id),
    );
    await page.keyboard.press('Control+s');
    await firstSave;

    await page.getByRole('button', { name: '更多项目操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '制作作品', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '创建制作版本' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('checkbox').first()).toBeChecked();
    await dialog.getByRole('button', { name: '创建制作版本', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '创建中…', exact: true })).toBeVisible();
    releaseFirst();

    await page.waitForURL(new RegExp('/apps/activities/[^/]+$'), { timeout: 20_000 });
    activityId = page.url().split('/').at(-1)!;
    await expect(page.getByTestId('publication-workspace')).toBeVisible({ timeout: 20_000 });

    const revisions = await readChapterRevisions(request, seeded.projectId, seeded.chapter.id);
    expect(revisions[0]?.snapshot).toMatchObject({ kind: 'chapter', body: latestBody });
    const publication = await readPublication(request, activityId);
    expect(publication.document.source.entryRevisionIds).toEqual([revisions[0]!.id]);
    expect(savedBodies[0]).toBe(latestBody);

    const dialogueText = '出版工作台中保存的第一句对白。';
    await prepareSavedDialogue(page, dialogueText);
    const saved = await readPublication(request, activityId);
    expect(saved.document.shots[0]?.utterances[0]?.text).toBe(dialogueText);

    await page.reload();
    await expect(page.getByTestId('publication-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('tab', { name: '2. 画面与配音', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '第1句对白', exact: true }))
      .toHaveValue(dialogueText, { timeout: 10_000 });
  } finally {
    releaseFirst();
    if (activityId) await request.delete(service + '/activities/' + activityId, { headers });
    await request.delete(service + '/story/projects/' + seeded.projectId, { headers });
  }
});

test('出版对白保存返回 409 时保留本机输入，刷新后恢复且服务器版本不变', async ({ page, request }) => {
  const seeded = await seedPublication(request);
  const originalDialogue = '服务器已保存的初始对白。';
  const localDialogue = '冲突后仍需保留的本机对白。';
  const pattern = new RegExp('/api/admin/activities/' + seeded.activityId + '/publication$');

  try {
    await page.goto('/apps/activities/' + seeded.activityId);
    await expect(page.getByTestId('publication-workspace')).toBeVisible({ timeout: 20_000 });
    await prepareSavedDialogue(page, originalDialogue);

    await page.route(pattern, async (route) => {
      if (route.request().method() !== 'PUT') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'publication_draft_conflict',
          message: '制作内容已在其他窗口更新。本地输入保留，请检查服务器版本。',
        }),
      });
    });

    const dialogue = page.getByRole('textbox', { name: '第1句对白', exact: true });
    await dialogue.fill(localDialogue);
    const failedSave = page.waitForResponse((response) =>
      response.request().method() === 'PUT'
      && response.url().endsWith('/activities/' + seeded.activityId + '/publication'),
    );
    await page.getByRole('button', { name: '保存', exact: true }).click();
    expect((await failedSave).status()).toBe(409);

    await expect(page.getByRole('alert').filter({ hasText: '本地输入保留' })).toBeVisible({ timeout: 10_000 });
    await expect(dialogue).toHaveValue(localDialogue);
    const serverAfterConflict = await readPublication(request, seeded.activityId);
    expect(serverAfterConflict.document.shots[0]?.utterances[0]?.text).toBe(originalDialogue);

    await page.reload();
    await expect(page.getByTestId('publication-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('tab', { name: '2. 画面与配音', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '第1句对白', exact: true }))
      .toHaveValue(localDialogue, { timeout: 10_000 });
    await expect(page.getByRole('alert').filter({ hasText: '已找回本机未同步内容' })).toBeVisible({ timeout: 10_000 });
    expect((await readPublication(request, seeded.activityId)).document.shots[0]?.utterances[0]?.text)
      .toBe(originalDialogue);
  } finally {
    await request.delete(service + '/activities/' + seeded.activityId, { headers });
    await request.delete(service + '/story/projects/' + seeded.projectId, { headers });
  }
});
