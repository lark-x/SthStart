import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { isOwnedDirectory } from './global-setup';

const portal = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
const service = 'http://127.0.0.1:' + (process.env.E2E_SERVICE_PORT ?? 4200) + '/api/v1/admin';
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
const unique = (label: string) => label + '-' + randomUUID().slice(0, 8);

async function seedStory(request: APIRequestContext) {
  const projectResponse = await request.post(service + '/story/projects', {
    headers,
    data: { title: unique('S6 编辑验收'), summary: '' },
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
  const first = await create('第一章', '第一章原始正文。');
  const second = await create('第二章', '第二章原始正文。');
  return { projectId: project.id, root, first, second };
}

async function createCharacter(request: APIRequestContext, displayName: string) {
  const response = await request.post(service + '/characters', {
    headers,
    data: {
      displayName,
      tags: ['S6'],
      draft: { displayName, work: '架构验收' },
    },
  });
  expect(response.ok()).toBe(true);
  return response.json() as Promise<{ id: string }>;
}

async function createWorldNote(request: APIRequestContext, title: string) {
  const response = await request.post(service + '/notebook/notes', {
    headers,
    data: {
      title,
      kind: 'world',
      stage: 'reference',
      summary: '',
      tags: ['S6'],
      content: [{ id: 'body', type: 'text', text: '世界观来源正文。' }],
      knowledge: {
        schemaVersion: 1,
        nature: 'personal',
        authorship: 'handwritten',
        usage: 'reference',
        works: [],
        characters: [],
        locations: [],
        sources: [],
      },
    },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ id: string }>;
}

async function readStoryDocument(request: APIRequestContext, root: string, id: string) {
  const response = await request.get(root + '/documents', { headers });
  expect(response.ok()).toBe(true);
  const payload = await response.json() as { items: Array<{ id: string; body: string }> };
  const document = payload.items.find((item) => item.id === id);
  expect(document).toBeTruthy();
  return document!;
}

function characterRequests(page: Page, pathname: string) {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') return;
    const url = new URL(request.url());
    if (url.pathname === pathname) requests.push(url.toString());
  });
  return requests;
}

function worldNoteRequests(page: Page) {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') return;
    const url = new URL(request.url());
    if (url.pathname === '/api/admin/notebook/notes' && url.searchParams.get('kind') === 'world') {
      requests.push(url.toString());
    }
  });
  return requests;
}

async function openConnectedSources(page: Page, panel: ReturnType<Page['getByRole']>) {
  await expect(panel.getByText('角色与设定来源', { exact: true })).toBeVisible();
  await panel.getByText('角色与设定来源', { exact: true }).click();
}

test.beforeEach(async ({ context }) => {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  const session = await context.request.post(portal + '/api/auth/admin-session', {
    headers: { origin: portal },
  });
  expect(session.ok()).toBe(true);
});

test('Story 保存未返回时继续输入，后一段文字仍进入最终修订', async ({ page, request }) => {
  const seeded = await seedStory(request);
  const { projectId, root, first } = seeded;
  const editor = page.getByRole('textbox', { name: '小说正文编辑' });
  const toolbar = page.locator('.story-editor-toolbar');
  const bodies: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let holdFirst = true;

  await page.route(new RegExp('/api/admin/story/projects/' + projectId + '/documents/' + first.id + '$'), async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    bodies.push(route.request().postData() ?? '');
    if (holdFirst) {
      holdFirst = false;
      await firstGate;
    }
    await route.continue();
  });

  try {
    await page.goto('/apps/story/' + projectId);
    await expect(editor).toHaveValue(first.body);
    const initial = '保存中的第一段。';
    await editor.fill(initial);
    const firstRequest = page.waitForRequest((candidate) =>
      candidate.method() === 'PUT'
      && candidate.url().endsWith('/documents/' + first.id),
    );
    await page.keyboard.press('Control+s');
    await firstRequest;
    await expect(toolbar.getByRole('status')).toHaveText('保存中…');

    const continued = initial + '请求返回前继续输入的第二段。';
    await editor.fill(continued);
    releaseFirst();

    await expect.poll(() => bodies.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => (await readStoryDocument(request, root, first.id)).body, { timeout: 10_000 }).toBe(continued);
    await expect(toolbar.getByRole('status')).toHaveText('已保存');

    const firstPayload = JSON.parse(bodies[0]) as { body: string };
    const lastPayload = JSON.parse(bodies.at(-1)!) as { body: string };
    expect(firstPayload.body).toBe(initial);
    expect(lastPayload.body).toBe(continued);
    expect(continued.slice(initial.length)).toContain('第二段');
  } finally {
    releaseFirst();
    await request.delete(root, { headers });
  }
});

test('Story 快速切章先保存当前条目，两个章节正文不互相串写', async ({ page, request }) => {
  const seeded = await seedStory(request);
  const { projectId, root, first, second } = seeded;
  const editor = page.getByRole('textbox', { name: '小说正文编辑' });
  const writes: Array<{ id: string; body: string }> = [];

  await page.route(new RegExp('/api/admin/story/projects/' + projectId + '/documents/[^/]+$'), async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    writes.push({
      id: new URL(route.request().url()).pathname.split('/').at(-1)!,
      body: (route.request().postDataJSON() as { body: string }).body,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });

  try {
    await page.goto('/apps/story/' + projectId);
    await expect(editor).toHaveValue(first.body);
    const firstText = '甲章唯一内容，切换后仍应只属于第一章。';
    await editor.fill(firstText);
    await page.getByRole('button', { name: '下一章：第二章' }).click();
    await expect(editor).toHaveValue(second.body);
    await expect(editor).not.toHaveValue(firstText);

    const secondText = '乙章唯一内容，回到第一章后不得出现在甲章。';
    await editor.fill(secondText);
    await page.getByRole('button', { name: '上一章：第一章' }).click();
    await expect(editor).toHaveValue(firstText);
    await expect(editor).not.toHaveValue(secondText);

    const savedFirst = await readStoryDocument(request, root, first.id);
    const savedSecond = await readStoryDocument(request, root, second.id);
    expect(savedFirst.body).toBe(firstText);
    expect(savedSecond.body).toBe(secondText);
    expect(savedFirst.body).not.toContain('乙章唯一内容');
    expect(savedSecond.body).not.toContain('甲章唯一内容');
    expect(writes.some((write) => write.id === first.id && write.body === firstText)).toBe(true);
    expect(writes.some((write) => write.id === second.id && write.body === secondText)).toBe(true);
  } finally {
    await request.delete(root, { headers });
  }
});

test('Story 中文输入法组合态 Enter 不离开标题，结束组合后 Enter 才进入正文', async ({ page, request }) => {
  const seeded = await seedStory(request);
  const { projectId, root, first } = seeded;

  try {
    await page.goto('/apps/story/' + projectId);
    const title = page.getByRole('textbox', { name: '条目标题' });
    const editor = page.getByRole('textbox', { name: '小说正文编辑' });
    await expect(title).toHaveValue(first.title);
    await title.click();
    await title.press('End');

    const prevented = await title.evaluate((element) => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '章' }));
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      });
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
    expect(await editor.evaluate((element) => (element as HTMLTextAreaElement).selectionStart)).toBe(0);
  } finally {
    await request.delete(root, { headers });
  }
});

test('资料库笔记切到其他视图再回来，未同步输入仍留在同一编辑会话', async ({ page, request }) => {
  const title = unique('页签保留笔记');
  const noteResponse = await request.post(service + '/notebook/notes', {
    headers,
    data: {
      title,
      kind: 'note',
      stage: 'draft',
      summary: '',
      tags: [],
      content: [{ id: 'body', type: 'text', text: '原始段落。' }],
    },
  });
  expect(noteResponse.status()).toBe(201);
  const note = await noteResponse.json() as { id: string };

  try {
    await page.goto('/apps/resources?note=' + note.id);
    const body = page.getByRole('region', { name: '笔记正文' });
    const first = body.getByRole('textbox', { name: '第 1 段正文' });
    const toolbar = page.locator('.notebook-editor-header');
    await expect(page.getByRole('textbox', { name: '笔记标题' })).toHaveValue(title);
    await expect(first).toHaveValue('原始段落。');
    const draft = '切换页签前写入、尚未同步的内容。';
    await first.fill(draft);

    await page.getByRole('tab', { name: '灵感素材', exact: true }).click();
    await expect(page).toHaveURL(/view=inspiration/);
    await expect(first).toBeHidden();
    await page.getByRole('tab', { name: '创作笔记', exact: true }).click();
    await expect(page).not.toHaveURL(/view=inspiration/);
    await expect(first).toBeVisible();
    await expect(first).toHaveValue(draft);

    await page.keyboard.press('Control+s');
    await expect(toolbar.getByRole('status')).toHaveText('已同步', { timeout: 10_000 });
    await page.reload();
    await expect(page.getByRole('textbox', { name: '笔记标题' })).toHaveValue(title);
    await expect(page.getByRole('region', { name: '笔记正文' }).getByRole('textbox', { name: '第 1 段正文' }))
      .toHaveValue(draft);
  } finally {
    await request.delete(service + '/notebook/notes/' + note.id, { headers });
  }
});

test('笔记角色选择器关闭时不请求，打开后只读角色数据且不改宿主 URL', async ({ page, request }) => {
  const title = unique('角色引用笔记');
  const characterName = unique('引用角色');
  const character = await createCharacter(request, characterName);
  const noteResponse = await request.post(service + '/notebook/notes', {
    headers,
    data: {
      title,
      kind: 'note',
      stage: 'draft',
      summary: '',
      tags: [],
      content: [
        { id: 'body', type: 'text', text: '带角色引用的笔记。' },
        { id: 'reference', type: 'character-reference', characterId: '', note: '' },
      ],
    },
  });
  expect(noteResponse.status()).toBe(201);
  const note = await noteResponse.json() as { id: string };
  const requests = characterRequests(page, '/api/admin/characters/browse');

  try {
    await page.goto('/apps/resources?note=' + note.id);
    await expect(page.getByRole('textbox', { name: '笔记标题' })).toHaveValue(title);
    await expect(page.getByRole('button', { name: '选择角色', exact: true })).toBeVisible();
    const beforeOpen = page.url();
    await page.waitForTimeout(300);
    expect(requests).toHaveLength(0);

    await page.getByRole('button', { name: '选择角色', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '搜索可引用角色' })).toBeVisible();
    await expect.poll(() => requests.length, { timeout: 10_000 }).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: new RegExp(characterName) })).toBeVisible();
    expect(page.url()).toBe(beforeOpen);
    expect(new URL(page.url()).searchParams.has('characterFilter')).toBe(false);

    await page.getByRole('button', { name: new RegExp(characterName) }).click();
    await expect(page.getByRole('textbox', { name: '搜索可引用角色' })).toBeHidden();
    await expect(page.getByText(characterName, { exact: true }).first()).toBeVisible();
    expect(page.url()).toBe(beforeOpen);
    expect(new URL(page.url()).searchParams.has('characterFilter')).toBe(false);
  } finally {
    await request.delete(service + '/notebook/notes/' + note.id, { headers });
    await request.delete(service + '/characters/' + character.id, { headers });
  }
});

test('自由生成 connected 来源按需加载角色与世界观资料，不提交生成', async ({ page, request }) => {
  test.setTimeout(60_000);
  const characterName = unique('来源角色');
  const worldTitle = unique('世界观来源');
  const character = await createCharacter(request, characterName);
  const note = await createWorldNote(request, worldTitle);
  const characterLoads = characterRequests(page, '/api/admin/characters');
  const worldLoads = worldNoteRequests(page);
  const generationPosts: string[] = [];
  page.on('request', (candidate) => {
    if (candidate.method() !== 'POST') return;
    const pathname = new URL(candidate.url()).pathname;
    if (pathname === '/api/admin/generation/image/prepare' || pathname.startsWith('/api/admin/creative/tasks')) {
      generationPosts.push(pathname);
    }
  });

  try {
    await page.goto('/apps/creative');
    const panel = page.getByRole('region', { name: '图片生成配置' });
    await expect(panel).toHaveAttribute('data-ready', 'true');
    await page.waitForTimeout(300);
    const charactersBefore = characterLoads.length;
    const notesBefore = worldLoads.length;

    await openConnectedSources(page, panel);
    await expect.poll(() => characterLoads.length, { timeout: 10_000 }).toBeGreaterThan(charactersBefore);
    await expect.poll(() => worldLoads.length, { timeout: 10_000 }).toBeGreaterThan(notesBefore);
    await expect(panel.getByRole('checkbox', { name: characterName, exact: true })).toBeVisible();
    await expect(panel.getByRole('checkbox', { name: worldTitle, exact: true })).toBeVisible();
    expect(generationPosts).toEqual([]);
  } finally {
    await request.delete(service + '/notebook/notes/' + note.id, { headers });
    await request.delete(service + '/characters/' + character.id, { headers });
  }
});

test('角色头像 connected 来源加载角色与世界观数据，但不运行生成', async ({ page, request }) => {
  test.setTimeout(60_000);
  const characterName = unique('头像角色');
  const worldTitle = unique('头像世界观');
  const character = await createCharacter(request, characterName);
  const note = await createWorldNote(request, worldTitle);
  const characterLoads = characterRequests(page, '/api/admin/characters');
  const worldLoads = worldNoteRequests(page);
  const generationPosts: string[] = [];
  page.on('request', (candidate) => {
    if (candidate.method() !== 'POST') return;
    const pathname = new URL(candidate.url()).pathname;
    if (pathname === '/api/admin/generation/image/prepare'
      || pathname.includes('/characters/' + character.id + '/avatar')
      || pathname.startsWith('/api/admin/creative/tasks')) {
      generationPosts.push(pathname);
    }
  });

  try {
    await page.goto('/apps/characters/' + character.id);
    await page.getByRole('button', { name: 'AI 生图', exact: true }).click();
    const overlay = page.getByRole('dialog', { name: '生成角色头像' });
    await expect(overlay).toBeVisible();
    const charactersBefore = characterLoads.length;
    const notesBefore = worldLoads.length;

    await openConnectedSources(page, overlay);
    await expect.poll(() => characterLoads.length, { timeout: 10_000 }).toBeGreaterThan(charactersBefore);
    await expect.poll(() => worldLoads.length, { timeout: 10_000 }).toBeGreaterThan(notesBefore);
    await expect(overlay.getByRole('checkbox', { name: worldTitle, exact: true })).toBeVisible();
    await expect(overlay.getByText('自动沿用当前已保存角色的外观、服装与 LoRA，结果预览后再应用。')).toBeVisible();
    expect(generationPosts).toEqual([]);
  } finally {
    await request.delete(service + '/notebook/notes/' + note.id, { headers });
    await request.delete(service + '/characters/' + character.id, { headers });
  }
});
