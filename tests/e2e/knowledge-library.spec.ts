import { expect, test } from '@playwright/test';

test('knowledge workspace filters server results and keeps cached pages out of the selection', async ({ page, request }) => {
  const suffix = Date.now().toString(36);
  const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
  const root = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT ?? 4200}/api/v1/admin`;
  const ids: string[] = [];
  try {
    for (const [title, work, name, text] of [
      ['目标资料', '原神', '钟离', '只在正文中的检索词'],
      ['其他作品', '星铁', '三月七', '另一份正文'],
    ]) {
      const response = await request.post(root + '/notebook/notes', { headers, data: {
        title: title + suffix, kind: 'note', stage: 'reference', summary: '', tags: [],
        content: [{ id: 'text', type: 'text', text }],
        knowledge: { schemaVersion: 1, works: [{ key: work, name: work }], characters: [{ work, name }], locations: [], nature: 'canon', authorship: 'handwritten', usage: 'reference', sources: [] },
      } });
      expect(response.status()).toBe(201);
      ids.push((await response.json()).id);
    }
    await page.addInitScript(() => localStorage.setItem('sthstart_notebook_sidebar_collapsed', 'false'));
    await page.goto('/apps/notebook');
    const list = page.locator('.notebook-master-list');
    await expect(list.getByText('目标资料' + suffix)).toBeVisible();
    await expect(list.getByText('其他作品' + suffix)).toBeVisible();
    await page.getByRole('combobox', { name: '作品', exact: true }).selectOption('原神');
    await expect(list.getByText('目标资料' + suffix)).toBeVisible();
    await expect(list.getByText('其他作品' + suffix)).toHaveCount(0);
    await page.getByPlaceholder('搜索标题、正文或标签…').fill('只在正文中的检索词');
    await expect(list.getByText('目标资料' + suffix)).toBeVisible();
    await page.getByRole('combobox', { name: '角色', exact: true }).selectOption('钟离');
    await expect(list.getByText('目标资料' + suffix)).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/apps/notebook');
    await expect(page.getByRole('combobox', { name: '作品', exact: true })).toBeVisible();
  } finally {
    for (const id of ids) await request.delete(root + '/notebook/notes/' + id, { headers });
  }
});
