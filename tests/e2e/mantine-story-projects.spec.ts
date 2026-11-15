import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { isOwnedDirectory } from './global-setup';

// WebKit 里页面一旦被 notebook 离线 Service Worker 接管，page.route 就拦不到后续请求：
// 故障注入的 PUT 会直接落到真实服务（两发都 200）。本文件全部依赖真实 portal + 路由模拟，
// 所以在测试上下文里禁用 Service Worker；notebook 离线行为由它自己的规格与配置覆盖。
test.use({ serviceWorkers: 'block' });

const portal = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
const service = 'http://127.0.0.1:' + (process.env.E2E_SERVICE_PORT ?? 4200) + '/api/v1/admin';
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
const prefix = 'B2 项目样板-' + randomUUID().slice(0, 8);

async function seedStory(request: APIRequestContext) {
  const projectResponse = await request.post(service + '/story/projects', {
    headers,
    data: { title: prefix, summary: '项目总览与 Story 编辑器回归样本。', workId: '海港' },
  });
  expect(projectResponse.status()).toBe(201);
  const project = await projectResponse.json() as { id: string };
  const root = service + '/story/projects/' + project.id;
  const create = async (title: string, body: string) => {
    const response = await request.post(root + '/documents', {
      headers,
      data: { kind: 'chapter', title, body },
    });
    expect(response.status()).toBe(201);
    return response.json() as Promise<{ id: string; title: string; body: string }>;
  };
  return {
    projectId: project.id,
    root,
    first: await create('第一章 潮声', '海风穿过旧灯塔，林舟把信收进衣袋。'),
    second: await create('第二章 退潮', '石阶上的水痕还没有干。'),
  };
}

async function readChapter(request: APIRequestContext, root: string, id: string) {
  const response = await request.get(root + '/documents', { headers });
  expect(response.ok()).toBe(true);
  return (await response.json() as { items: Array<{ id: string; body: string; revision: number }> })
    .items.find((item) => item.id === id)!;
}

test.beforeAll(async ({ request }) => {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  for (let index = 0; index < 24; index += 1) {
    const note = await request.post(service + '/notebook/notes', {
      headers,
      data: {
        title: `${prefix} 资料 ${index + 1}`, kind: 'note', stage: 'reference', summary: '', tags: [],
        content: [{ id: 'body', type: 'text', text: '可供项目引用的参考正文。' }],
        knowledge: { schemaVersion: 1, nature: 'personal', authorship: 'handwritten', usage: 'reference', works: [], characters: [], locations: [], sources: [] },
      },
    });
    expect(note.status()).toBe(201);
  }
});

test.beforeEach(async ({ context }) => {
  expect((await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } })).ok()).toBe(true);
});

test('project continues into Story and returns through the same filtered directory', async ({ page, request }) => {
  const seeded = await seedStory(request);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/apps/projects?q=' + encodeURIComponent(prefix) + '&sort=title&pageSize=50');
    const card = page.getByRole('link', { name: new RegExp(prefix) }).first();
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(new RegExp('/apps/projects/' + seeded.projectId + '\\?returnTo='));
    await expect(page.getByRole('heading', { name: prefix, level: 1 })).toBeVisible();
    const continueLink = page.getByRole('link', { name: '继续写作', exact: true });
    await expect(continueLink).toBeVisible();
    await expect(continueLink).toHaveCount(1);

    await continueLink.click();
    await expect(page).toHaveURL(new RegExp('/apps/story/' + seeded.projectId + '\\?returnTo='));
    const editor = page.getByRole('textbox', { name: '小说正文编辑' });
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue(seeded.first.body);

    await page.getByRole('link', { name: '返回项目总览', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/apps/projects/' + seeded.projectId + '\\?returnTo='));
    await page.getByRole('link', { name: '返回创作项目列表', exact: true }).click();
    await expect(page).toHaveURL(/\/apps\/projects\?/);
    await expect(page).toHaveURL(/q=B2/);
    await expect(page.getByRole('link', { name: new RegExp(prefix) }).first()).toBeVisible();
  } finally {
    await request.delete(seeded.root, { headers });
  }
});

test('reopening the project sample restores the chapter and both chapters stay selectable', async ({ page, request }) => {
  const seeded = await seedStory(request);
  try {
    await page.goto('/apps/projects/' + seeded.projectId);
    await expect(page.getByRole('heading', { name: prefix, level: 1 })).toBeVisible();
    await page.getByRole('link', { name: '继续写作', exact: true }).click();
    const editor = page.getByRole('textbox', { name: '小说正文编辑' });
    await expect(editor).toBeVisible();
    const chapterList = page.getByRole('complementary', { name: '正式剧情资料树' });
    await expect(chapterList).toBeVisible();
    await expect(editor).toHaveValue(seeded.first.body);
    await expect(chapterList.getByText('第二章 退潮', { exact: false }).first()).toBeVisible();

    await chapterList.getByText('第二章 退潮', { exact: false }).first().click();
    await expect(editor).toHaveValue(seeded.second.body);
    await chapterList.getByText('第一章 潮声', { exact: false }).first().click();
    await expect(editor).toHaveValue(seeded.first.body);
  } finally {
    await request.delete(seeded.root, { headers });
  }
});

test('project states expose one action and nested reference paging keeps only the top overlay closing', async ({ page, request }) => {
  const seeded = await seedStory(request);
  try {
    await page.goto('/apps/projects/' + seeded.projectId);
    await page.getByRole('tab', { name: /^参考资料/ }).click();
    await expect(page.getByRole('button', { name: '添加参考资料', exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: '添加参考资料', exact: true }).click();
    const picker = page.getByRole('dialog', { name: '添加参考资料', exact: true });
    await picker.getByRole('textbox', { name: '搜索资料', exact: true }).fill(prefix);
    const paging = picker.getByRole('navigation', { name: '分页', exact: true });
    await expect(paging).toContainText('共 24 条');
    const trigger = paging.getByRole('button', { name: /^跳到指定页/ });
    await trigger.click();
    const jump = picker.getByRole('dialog', { name: '跳到指定页', exact: true });
    await expect(jump.getByRole('textbox', { name: '跳转页码' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(jump).toBeHidden();
    await expect(picker).toBeVisible();
    await expect(trigger).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await page.getByRole('tab', { name: /^角色/ }).click();
    await expect(page.getByRole('button', { name: '从角色库加入', exact: true })).toHaveCount(1);
  } finally {
    await request.delete(seeded.root, { headers });
  }
});

test('Chinese draft autosaves, survives a failed save, and IME Enter does not leave the title', async ({ page, request }) => {
  const seeded = await seedStory(request);
  try {
    await page.goto('/apps/story/' + seeded.projectId + '?entry=' + seeded.first.id);
    const title = page.getByRole('textbox', { name: '条目标题' });
    const editor = page.getByRole('textbox', { name: '小说正文编辑' });
    const editorPanel = page.getByRole('region', { name: '正式资料编辑器' });
    await expect(editor).toHaveValue(seeded.first.body);
    const draft = '第一章 潮声：中文草稿在自动保存中。';
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(draft);
    await expect.poll(async () => (await readChapter(request, seeded.root, seeded.first.id)).body, { timeout: 15_000 }).toBe(draft);
    // 等第一稿确认保存后再装故障路由，避免拦截落在上一笔还在排队的保存上。
    await expect(editorPanel.getByRole('status')).toHaveText('已保存');

    const failed = draft + '服务器暂不可用时的本机草稿。';
    const savePath = '/api/admin/story/projects/' + seeded.projectId + '/documents/' + seeded.first.id;
    const failedSaves: string[] = [];
    const failSave = async (route: import('@playwright/test').Route) => {
      const intercepted = route.request();
      if (intercepted.method() !== 'PUT') { await route.continue(); return; }
      failedSaves.push(intercepted.method() + ' ' + new URL(intercepted.url()).pathname);
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'service_unavailable' }) });
    };
    const saveFailure = page.waitForResponse(
      (response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === savePath,
      { timeout: 15_000 },
    );
    await page.route((url) => url.pathname === savePath, failSave);
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(failed);
    // 先确认失败请求确实发生且只发生一次，再验证界面，避免真实 200 被误当成「本机草稿」。
    expect((await saveFailure).status()).toBe(503);
    expect(failedSaves).toEqual(['PUT ' + savePath]);
    await expect(editorPanel.getByRole('status')).toHaveText('仅保存在本机');
    await expect(editor).toHaveValue(failed);
    expect((await readChapter(request, seeded.root, seeded.first.id)).body).toBe(draft);

    await page.unroute((url) => url.pathname === savePath, failSave);
    await title.click();
    await title.press('End');
    const prevented = await title.evaluate((element) => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '章' }));
      const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
      Object.defineProperty(event, 'isComposing', { configurable: true, value: true });
      const dispatchResult = element.dispatchEvent(event);
      element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '章' }));
      return { dispatchResult, prevented: event.defaultPrevented };
    });
    expect(prevented.dispatchResult).toBe(true);
    expect(prevented.prevented).toBe(false);
    await expect(title).toBeFocused();
    await expect(editor).not.toBeFocused();
    await title.press('Enter');
    await expect(editor).toBeFocused();
  } finally {
    await request.delete(seeded.root, { headers });
  }
});

test('publication preview freezes the latest saved revision and returns a safe action set', async ({ page, request }) => {
  const seeded = await seedStory(request);
  try {
    await page.goto('/apps/story/' + seeded.projectId + '?entry=' + seeded.first.id);
    await expect(page.getByRole('textbox', { name: '小说正文编辑' })).toHaveValue(seeded.first.body);
    await page.getByRole('button', { name: '更多项目操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '制作作品', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '创建制作版本' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('checkbox').first()).toBeChecked();
    await expect(dialog.getByRole('button', { name: '创建制作版本', exact: true })).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: '更多项目操作', exact: true })).toBeVisible();
  } finally {
    await request.delete(seeded.root, { headers });
  }
});
