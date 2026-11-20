import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { isOwnedDirectory } from './global-setup';

const portal = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
const service = 'http://127.0.0.1:' + (process.env.E2E_SERVICE_PORT ?? 4200) + '/api/v1/admin';
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
const prefix = '分页样本-' + randomUUID().slice(0, 8);
let projectId: string;

test.beforeAll(async ({ request }) => {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  for (let n = 1; n <= 45; n++) {
    const note = await request.post(service + '/notebook/notes', { headers, data: {
      title: `${prefix}-${n}`, kind: 'note', stage: 'reference', summary: '', tags: [],
      content: [{ id: 'body', type: 'text', text: '雨后的街角，远处的路灯亮了。' }],
      knowledge: { schemaVersion: 1, nature: 'personal', authorship: 'handwritten', usage: 'reference', works: [], characters: [], locations: [], sources: [] },
    } });
    expect(note.status()).toBe(201);
  }
  const project = await request.post(service + '/story/projects', { headers, data: { title: prefix, summary: '' } });
  expect(project.ok()).toBe(true);
  projectId = (await project.json()).id;
  for (const suffix of ['甲', '乙', ...Array.from({ length: 23 }, (_, i) => String(i + 1))]) {
    const displayName = prefix + suffix;
    const character = await request.post(service + '/characters', { headers, data: {
      displayName, tags: ['甲', '乙'].includes(suffix) ? [prefix + '标签' + suffix] : [], draft: { displayName, work: prefix + '作品' + suffix },
    } });
    expect(character.ok()).toBe(true);
  }
});

test.beforeEach(async ({ context }) => {
  expect((await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } })).ok()).toBe(true);
});

test('notebook paging is local to the footer, validates input and restores URL state', async ({ context, page }, info) => {
  await context.addInitScript(() => localStorage.setItem('sthstart_theme_id', 'dark-espresso'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/apps/resources?q=' + encodeURIComponent(prefix));
  const nav = page.getByRole('navigation', { name: '分页', exact: true });
  const jump = nav.getByRole('button', { name: /跳到指定页/ });
  const panel = page.getByRole('dialog', { name: '跳到指定页', exact: true });
  await expect(nav).toContainText('当前 1–20 条');
  await jump.press('Enter');
  const field = panel.getByRole('textbox', { name: '跳转页码' });
  await expect(field).toBeFocused();
  await field.fill('4');
  await field.press('Enter');
  await expect(panel).toContainText('请输入 1–3 之间的整数页码');
  await expect(nav).toContainText('当前 1–20 条');
  await field.press('Escape');
  await expect(panel).toBeHidden();
  await expect(jump).toBeFocused();
  await jump.click();
  await page.screenshot({ path: info.outputPath('notebook-jump.png'), clip: { x: 64, y: 596, width: 354, height: 296 } });
  await panel.getByRole('button', { name: '末页', exact: true }).click();
  await expect(nav).toContainText('当前 41–45 条');
  await jump.click();
  await panel.getByRole('button', { name: '首页', exact: true }).click();
  await expect(nav).toContainText('当前 1–20 条');
  await jump.click();
  await field.fill('2');
  await field.press('Enter');
  await expect(panel).toBeHidden();
  await expect(nav).toContainText('当前 21–40 条');
  await page.reload();
  await expect(nav).toContainText('当前 21–40 条');

  await nav.getByRole('button', { name: /每页条数/ }).click();
  const sizes = page.getByRole('dialog', { name: '每页条数', exact: true });
  await expect(sizes.getByRole('button', { name: '20 条' })).toBeFocused();
  await page.screenshot({ path: info.outputPath('notebook-page-size.png'), clip: { x: 64, y: 596, width: 354, height: 296 } });
  await sizes.getByRole('button', { name: '50 条' }).click();
  await expect(nav).toContainText('共 45 条');
  await expect(jump).toHaveCount(0);
  await expect(page).toHaveURL(/pageSize=50/);
  await expect.poll(() => new URL(page.url()).searchParams.get('page') ?? '1').toBe('1');
});

test('nested paging popover accepts keyboard input and Escape only closes the top layer', async ({ page }) => {
  await page.goto('/apps/projects/' + projectId);
  await page.getByRole('tab', { name: /^参考/ }).click();
  await page.getByRole('button', { name: '添加参考资料', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '添加参考资料', exact: true });
  await picker.getByRole('textbox', { name: '搜索资料', exact: true }).fill(prefix);
  await expect(picker.getByRole('navigation', { name: '分页' })).toContainText('共 45 条');
  const trigger = picker.getByRole('button', { name: /跳到指定页/ });
  await trigger.click();
  const jump = picker.getByRole('dialog', { name: '跳到指定页', exact: true });
  const input = jump.getByRole('textbox', { name: '跳转页码' });
  await expect(input).toBeFocused();
  await input.press('Tab');
  await expect(jump.getByRole('button', { name: '末页' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(jump).toBeHidden();
  await expect(picker).toBeVisible();
  await expect(trigger).toBeFocused();
});

test('character facet popover searches, filters and dismisses without losing the applied choice', async ({ page }, info) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/apps/characters');
  await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');
  // 标签筛选收进「筛选」面板（页头控件预算）；面板内的多选弹层行为不变。
  await page.getByRole('button', { name: /^筛选(?:\s*\(\d+\))?$/ }).click();
  const filterPanel = page.getByRole('dialog', { name: '角色筛选与排序', exact: true });
  await expect(filterPanel).toBeVisible();
  const tagButton = filterPanel.getByRole('button', { name: /^标签( \(\d+\))?$/ });
  await tagButton.click();
  const popup = page.getByRole('dialog', { name: '按标签筛选' });
  const search = popup.getByRole('textbox', { name: '搜索标签' });
  await search.fill(prefix);
  await expect(popup.getByRole('checkbox')).toHaveCount(2);
  await page.screenshot({ path: info.outputPath('character-filter.png') });
  await popup.getByRole('checkbox', { name: prefix + '标签甲' }).check();
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  await expect(tagButton).toHaveText('标签 (1)');
  await expect(page.getByRole('navigation', { name: '分页' })).toContainText('共 1 条');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1025);
});

test('directory paging keeps numbered navigation on desktop and fits a touch viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/apps/characters');
  const nav = page.getByRole('navigation', { name: '分页', exact: true });
  await expect(nav).toBeVisible();
  await page.getByRole('searchbox', { name: '搜索角色', exact: true }).fill(prefix);
  await expect(nav).toContainText('共 25 条');
  await nav.getByRole('button', { name: '第 2 页', exact: true }).click();
  await expect(nav.getByRole('button', { name: '第 2 页', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(nav.getByRole('button', { name: '第 2 页', exact: true })).toBeHidden();
  await nav.getByRole('button', { name: /每页条数/ }).click();
  const sizes = page.getByRole('dialog', { name: '每页条数', exact: true });
  await expect(sizes).toBeInViewport({ ratio: 1 });
  await sizes.getByRole('button', { name: '100 条' }).click();
  await expect(nav.getByRole('button', { name: /^每页 100 条/ })).toBeVisible();
  await expect(nav.getByRole('button', { name: '下一页' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
});
