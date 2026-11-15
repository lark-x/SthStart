import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { isOwnedDirectory } from './global-setup';

const portal = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
const service = 'http://127.0.0.1:' + (process.env.E2E_SERVICE_PORT ?? 4200) + '/api/v1/admin';
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
const prefix = '浮层分页-' + randomUUID().slice(0, 8);
let projectId: string;

/* The picker only renders paging with more than one result page. Use the same
 * 45-note fixture as pagination.spec.ts so the nested jump control is real. */
test.beforeAll(async ({ request }) => {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  for (let n = 1; n <= 45; n++) {
    const note = await request.post(service + '/notebook/notes', { headers, data: {
      title: `${prefix}-${n}`, kind: 'note', stage: 'reference', summary: '', tags: [],
      content: [{ id: 'body', type: 'text', text: '用于验证嵌套分页、焦点与单层 Escape。' }],
      knowledge: { schemaVersion: 1, nature: 'personal', authorship: 'handwritten', usage: 'reference', works: [], characters: [], locations: [], sources: [] },
    } });
    expect(note.status()).toBe(201);
  }
  const project = await request.post(service + '/story/projects', { headers, data: { title: prefix, summary: '' } });
  expect(project.ok()).toBe(true);
  projectId = (await project.json()).id;
});

test.beforeEach(async ({ context }) => {
  expect((await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } })).ok()).toBe(true);
});

/* SSR renders these controls before their click handlers mount. Wait for the
 * shell's client marker so the real first click tests the hydrated product. */
async function expectHydrated(page: import('@playwright/test').Page) {
  await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');
}

test('native drawer exposes one named dialog and returns focus to its trigger', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/apps/calendar');
  await expectHydrated(page);
  const trigger = page.getByRole('button', { name: '打开全站导航', exact: true });
  await trigger.click();
  const nav = page.getByRole('dialog', { name: '导航', exact: true });
  await expect(nav).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(nav.getByRole('button', { name: '关闭抽屉', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(nav).toBeHidden();
  await expect(trigger).toBeFocused();
});

/* Bottom sheets must dock to the viewport edge. The route matrix screenshot
 * showed the role filter pinned to the top with the backdrop showing below,
 * so measure the opened surface instead of trusting the class list. */
async function measureSheetBottom(page: import('@playwright/test').Page, name: string) {
  return page.evaluate((panelName) => {
    const panels = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'));
    const panel = panels.find((node) => node.textContent?.includes(panelName) && !node.hasAttribute('data-hidden'));
    if (!panel) return null;
    const rect = panel.getBoundingClientRect();
    const scroller = panel.querySelector<HTMLElement>('[data-autohide-scroll]');
    return {
      viewportHeight: window.innerHeight,
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      scroller: scroller ? { clientHeight: scroller.clientHeight, scrollHeight: scroller.scrollHeight } : null,
    };
  }, name);
}

test('role filter sheet docks to the viewport bottom and scrolls on a short screen', async ({ page }) => {
  for (const height of [844, 560]) {
    await page.setViewportSize({ width: 390, height });
    await page.goto('/apps/characters');
    await expectHydrated(page);
    await page.getByRole('button', { name: '筛选与排序', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: '角色筛选', exact: true });
    await expect(sheet).toBeVisible();

    /* 抽屉打开与布局完成后测量稳定几何位置。 */
    await expect.poll(async () => (await measureSheetBottom(page, '角色筛选'))?.bottom).toBe(height);
    const box = await measureSheetBottom(page, '角色筛选');
    expect(box).not.toBeNull();
    // 面板底边贴住视口底边，上方留出遮罩；不能浮在顶部。
    expect(box!.top).toBeGreaterThan(0);
    expect(box!.scroller).not.toBeNull();

    const confirm = sheet.getByRole('button', { name: '确认筛选', exact: true });
    if (height < 844) {
      // 短视口下内容确实超出面板，正文在面板内滚动即可到达页脚动作。
      expect(box!.scroller!.scrollHeight).toBeGreaterThan(box!.scroller!.clientHeight);
      await confirm.scrollIntoViewIfNeeded();
    }
    // 两种高度下页脚动作都必须在可视区内，不能被挤出屏幕。
    await expect(confirm).toBeInViewport();

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  }
});

test('command palette is absent while a modal is open and toggles with Ctrl or Meta K', async ({ page }) => {
  await page.goto('/apps/characters');
  await expectHydrated(page);
  await page.getByRole('button', { name: '筛选与排序', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '角色筛选', exact: true });
  await expect(modal).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: '命令快捷菜单' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();

  const palette = page.getByRole('dialog', { name: '命令快捷菜单' });
  await page.keyboard.press('Control+k');
  await expect(palette).toBeVisible();
  await expect(page.getByRole('textbox', { name: '搜索命令' })).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(palette).toBeHidden();
  await page.keyboard.press('Meta+k');
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});

test('nested paging opens inside the native dialog and Escape closes only the top popover', async ({ page }) => {
  await page.goto('/apps/projects/' + projectId);
  await expectHydrated(page);
  await page.getByRole('tab', { name: /^参考资料/ }).click();
  const panel = page.getByRole('tabpanel', { name: '参考资料' });
  await panel.getByRole('button', { name: '添加参考资料', exact: true }).first().click();

  const picker = page.getByRole('dialog', { name: '添加参考资料', exact: true });
  await expect(picker).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await picker.getByRole('textbox', { name: '搜索资料', exact: true }).fill(prefix);
  await expect(picker.getByRole('navigation', { name: '分页' })).toContainText('共 45 条');
  const trigger = picker.getByRole('button', { name: /^跳到指定页/ });
  await trigger.click();

  const jump = picker.getByRole('dialog', { name: '跳到指定页', exact: true });
  await expect(jump).toBeVisible();
  await expect(jump.getByRole('textbox', { name: '跳转页码' })).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(2);
  await jump.getByRole('textbox', { name: '跳转页码' }).press('Tab');
  await expect(jump.getByRole('button', { name: '末页', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(jump).toBeHidden();
  await expect(picker).toBeVisible();
  await expect(trigger).toBeFocused();
});
