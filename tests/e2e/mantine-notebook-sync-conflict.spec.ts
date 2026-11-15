import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { isOwnedDirectory } from './global-setup';

const portal = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
const notes = 'http://127.0.0.1:' + (process.env.E2E_SERVICE_PORT ?? 4200) + '/api/v1/admin/notebook/notes';
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };

// The delayed-response case needs the browser route to hold the real PUT.
// A separate offline suite exercises the installed worker without interception.
test.use({ serviceWorkers: 'block' });

test('a real outside notebook edit keeps the local draft and never overwrites the server version', async ({ page, context, request }) => {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  expect((await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } })).ok()).toBe(true);
  const title = '笔记外部冲突 ' + randomUUID().slice(0, 8);
  const created = await request.post(notes, {
    headers,
    data: { title, kind: 'note', stage: 'draft', summary: '', tags: [], content: [{ id: 'body', type: 'text', text: '原正文' }] },
  });
  expect(created.status()).toBe(201);
  const initial = await created.json();
  const editUrl = notes + '/' + initial.id;
  await page.goto(portal + '/apps/notebook/' + initial.id);
  const body = page.getByRole('region', { name: '笔记正文' }).getByRole('textbox', { name: '第 1 段正文' });
  await expect(body).toHaveValue('原正文');

  const remote = await request.put(editUrl, { headers, data: { ...initial, content: [{ id: 'body', type: 'text', text: '外部编辑已保存' }] } });
  expect(remote.ok(), await remote.text()).toBe(true);
  const remoteRevision = (await remote.json()).revision;
  expect(remoteRevision).toBe(initial.revision + 1);

  const conflictResponse = page.waitForResponse(response => response.request().method() === 'PUT'
    && new URL(response.url()).pathname.endsWith('/notebook/notes/' + initial.id) && response.status() === 409);
  await body.fill('本机后来写的内容');
  await page.keyboard.press('Control+s');
  const conflict = await conflictResponse;
  expect(conflict.request().postDataJSON().revision).toBe(initial.revision);
  await expect(page.getByText('笔记版本冲突，本机内容已保留', { exact: true })).toBeVisible();
  await expect(body).toHaveValue('本机后来写的内容');

  await page.reload();
  await expect(body).toHaveValue('本机后来写的内容');
  await expect(page.getByText('笔记版本冲突，本机内容已保留', { exact: true })).toBeVisible();
  const untouched = await request.get(editUrl, { headers });
  expect(untouched.ok()).toBe(true);
  const latest = await untouched.json();
  expect(latest.revision).toBe(remoteRevision);
  expect(latest.content).toEqual([{ id: 'body', type: 'text', text: '外部编辑已保存' }]);
});

test('a notebook edit made while its first save is in flight uses the acknowledged revision', async ({ page, context, request }) => {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  expect((await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } })).ok()).toBe(true);
  const created = await request.post(notes, {
    headers,
    data: { title: '笔记连续保存 ' + randomUUID().slice(0, 8), kind: 'note', stage: 'draft', summary: '', tags: [], content: [{ id: 'body', type: 'text', text: '原正文' }] },
  });
  expect(created.status()).toBe(201);
  const initial = await created.json();
  const editUrl = notes + '/' + initial.id;
  const notePath = '/api/admin/notebook/notes/' + initial.id;
  let seenFirstWrite!: () => void;
  const firstSent = new Promise<void>(resolve => { seenFirstWrite = resolve; });
  let release!: () => void;
  const releaseFirst = new Promise<void>(resolve => { release = resolve; });
  const puts: Array<{ revision: number; status: number; text: string }> = [];
  let sending = 0;
  await page.route(url => url.pathname === notePath, async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    const data = route.request().postDataJSON();
    const current = ++sending;
    // Real endpoint and revision validation. Only delivery of the first response is held.
    const response = await route.fetch();
    puts.push({ revision: data.revision, status: response.status(), text: data.content[0].text });
    if (current === 1) {
      seenFirstWrite();
      await releaseFirst;
    }
    await route.fulfill({ response });
  });
  await page.goto(portal + '/apps/notebook/' + initial.id);
  const body = page.getByRole('region', { name: '笔记正文' }).getByRole('textbox', { name: '第 1 段正文' });
  await expect(body).toHaveValue('原正文');
  try {
    await body.fill('第一段保存内容');
    await page.keyboard.press('Control+s');
    await firstSent;
    expect(puts[0]).toEqual({ revision: initial.revision, status: 200, text: '第一段保存内容' });
    await body.fill('第一段保存内容，追加第二次编辑');
  } finally {
    release();
  }
  await expect.poll(() => puts.find(entry => entry.text === '第一段保存内容，追加第二次编辑')).toEqual({
    revision: initial.revision + 1, status: 200, text: '第一段保存内容，追加第二次编辑',
  });
  await expect(page.locator('.notebook-editor-header').getByRole('status')).toHaveText('已同步');
  expect(puts.every(entry => entry.status === 200)).toBe(true);
  const latest = await request.get(editUrl, { headers });
  expect(latest.ok()).toBe(true);
  const saved = await latest.json();
  expect(saved.revision).toBe(initial.revision + 2);
  expect(saved.content).toEqual([{ id: 'body', type: 'text', text: '第一段保存内容，追加第二次编辑' }]);
  await page.reload();
  await expect(body).toHaveValue('第一段保存内容，追加第二次编辑');
});
