import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { isOwnedDirectory } from './global-setup';
import { test } from './fixtures/webkit-persistent-notebook';

const portal = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
const notes = 'http://127.0.0.1:' + (process.env.E2E_SERVICE_PORT ?? 4200) + '/api/v1/admin/notebook/notes';
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };

test('long-form editor keeps insertion available and persists mixed blocks', async ({ page, context, request }, info) => {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  expect((await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } })).ok()).toBe(true);
  const title = '长文验收 ' + randomUUID().slice(0, 8);
  const longText = Array.from({ length: 110 }, (_, index) => `第 ${index + 1} 行：傍晚的车站还有几盏灯，记下沿途的景色和灵感。`).join('\n');
  const response = await request.post(notes, { headers, data: {
    title, kind: 'diary', stage: 'draft', summary: '', tags: [], content: [
      { id: 'long-text', type: 'text', text: longText },
      { id: 'tail-link', type: 'link', url: 'https://example.com/', label: '参考链接', note: '' },
    ],
  } });
  expect(response.status()).toBe(201);
  const { id } = await response.json();
  await context.addInitScript(() => localStorage.setItem('sthstart_theme_id', 'dark-espresso'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/apps/resources?note=${id}`);

  const body = page.getByRole('region', { name: '笔记正文' });
  const first = body.getByRole('textbox', { name: '第 1 段正文' });
  const pane = page.locator('.notebook-detail-pane');
  const list = page.locator('.notebook-master-list');
  const toolbar = page.locator('.notebook-editor-header');
  const insert = toolbar.getByRole('button', { name: '插入内容', exact: true });
  const popup = page.getByRole('dialog', { name: '插入内容', exact: true });
  await expect(page.getByRole('textbox', { name: '笔记标题' })).toHaveValue(title);
  await expect(first).toHaveValue(longText);
  const topBefore = (await toolbar.boundingBox())!.y;
  const listBefore = await list.evaluate(node => node.scrollTop);
  await first.focus();
  await pane.evaluate(node => { node.scrollTop = Math.floor(node.scrollHeight / 2); });
  expect(await pane.evaluate(node => node.scrollTop)).toBeGreaterThan(800);
  expect(await first.evaluate(node => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs((await toolbar.boundingBox())!.y - topBefore)).toBeLessThan(2);
  await expect(insert).toBeInViewport();
  expect(await list.evaluate(node => node.scrollTop)).toBe(listBefore);

  await insert.click();
  await expect(popup.getByText('插入到第 1 个内容块后')).toBeVisible();
  await page.screenshot({ path: info.outputPath('longform-insert.png'), animations: 'disabled' });
  await popup.getByRole('button', { name: '段落', exact: true }).click();
  const inserted = body.getByRole('textbox', { name: '第 2 段正文' });
  await expect(inserted).toBeFocused();
  await expect(inserted).toBeInViewport();
  await page.keyboard.type('A new draft');
  await expect(inserted).toHaveValue('A new draft');

  await toolbar.getByRole('button', { name: '专注', exact: true }).click();
  await expect(page.getByRole('group', { name: '资料信息' })).toBeHidden();
  await expect(inserted).toHaveValue('A new draft');
  await toolbar.getByRole('button', { name: '退出专注', exact: true }).click();
  await inserted.focus();
  await insert.click();
  const fileChooser = page.waitForEvent('filechooser');
  await popup.getByRole('button', { name: '图片', exact: true }).click();
  await (await fileChooser).setFiles({
    name: 'reference.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nZsAAAAASUVORK5CYII=', 'base64'),
  });
  await expect(body.locator("[data-block-type='image']")).toBeVisible();
  await expect(body.getByPlaceholder('为这张图片写一句说明（可选）')).toBeFocused();
  const types = () => body.locator('.notebook-block').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-block-type')));
  expect(await types()).toEqual(['text', 'text', 'image', 'link']);
  await page.screenshot({ path: info.outputPath('longform-mixed.png'), animations: 'disabled' });
  await page.keyboard.press('Control+s');
  await expect(toolbar.getByRole('status')).toHaveText('已同步');
  await page.reload();
  await expect(inserted).toHaveValue('A new draft');
  expect(await types()).toEqual(['text', 'text', 'image', 'link']);
});
