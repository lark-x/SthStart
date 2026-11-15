import { expect, test, type Locator, type Page } from '@playwright/test';

const portal = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);

interface ScrollSnapshot {
  panelScrollWidth: number;
  panelClientWidth: number;
  scrollerScrollWidth: number;
  scrollerClientWidth: number;
}

async function readScroll(panel: Locator): Promise<ScrollSnapshot> {
  return panel.evaluate((element) => {
    const scroller = element.querySelector<HTMLElement>('[data-autohide-scroll]');
    return {
      panelScrollWidth: element.scrollWidth,
      panelClientWidth: element.clientWidth,
      scrollerScrollWidth: scroller?.scrollWidth ?? 0,
      scrollerClientWidth: scroller?.clientWidth ?? 0,
    };
  });
}

async function openFilters(page: Page) {
  await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');
  await page.getByRole('button', { name: '筛选与排序', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '角色筛选', exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

async function openSortSelect(panel: Locator) {
  const select = panel.getByRole('combobox', { name: '排序', exact: true });
  await select.click();
  const menu = panel.page().locator('[data-ui-select-dropdown="true"]');
  await expect(menu).toBeVisible();
  await menu.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
  });
  await expect.poll(async () => menu.evaluate((element) => {
    const transform = getComputedStyle(element).transform;
    return transform === 'none' ? 1 : new DOMMatrixReadOnly(transform).a;
  })).toBeCloseTo(1, 3);
  return { select, menu };
}

test.beforeEach(async ({ context }) => {
  expect((await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } })).ok()).toBe(true);
});

test('dialog select menu uses viewport geometry without widening or scrolling the panel', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/apps/characters');
  const panel = await openFilters(page);
  const before = await readScroll(panel);

  const { select, menu } = await openSortSelect(panel);
  const selectBox = await select.boundingBox();
  const menuBox = await menu.boundingBox();
  const menuInfo = await menu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      position: getComputedStyle(element).position,
      parentIsFloatingRoot: element.parentElement?.hasAttribute('data-overlay-floating-root') ?? false,
      insideDialog: Boolean(element.closest('[role="dialog"]')),
    };
  });
  const after = await readScroll(panel);
  console.log('dialog geometry', JSON.stringify({ selectBox, menuBox, menuInfo, before, after }));

  expect(selectBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(menuInfo.position).toBe('fixed');
  expect(menuInfo.parentIsFloatingRoot).toBe(true);
  expect(menuInfo.insideDialog).toBe(false);
  expect(Math.abs(menuInfo.left - (selectBox?.x ?? 0))).toBeLessThanOrEqual(1.5);
  expect(menuInfo.left).toBeGreaterThanOrEqual(0);
  expect(menuInfo.right).toBeLessThanOrEqual(1024);
  expect(menuInfo.top).toBeGreaterThanOrEqual(0);
  expect(menuInfo.bottom).toBeLessThanOrEqual(768);
  expect(after.panelScrollWidth).toBe(before.panelScrollWidth);
  expect(after.scrollerScrollWidth).toBe(before.scrollerScrollWidth);
  expect(after.scrollerScrollWidth).toBeLessThanOrEqual(after.scrollerClientWidth);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(panel).toBeVisible();
  await expect(select).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(menu).toBeVisible();
  await menu.getByRole('option', { name: '全部', exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(panel).toBeVisible();
  await expect(select).toBeFocused();
  await expect(select).toHaveValue('');

  await page.keyboard.press('ArrowDown');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(select).toHaveValue('updated');
  await expect(select).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(menu).toBeHidden();

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('dialog select menu flips above near the viewport bottom', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/apps/characters');
  const panel = await openFilters(page);
  await panel.evaluate((element) => {
    const scroller = element.querySelector<HTMLElement>('[data-autohide-scroll]');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });

  const { select, menu } = await openSortSelect(panel);
  const selectBox = await select.boundingBox();
  const menuBox = await menu.boundingBox();
  console.log('dialog flip geometry', JSON.stringify({ selectBox, menuBox }));

  expect(selectBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect((menuBox?.y ?? 0) + (menuBox?.height ?? 0)).toBeLessThanOrEqual((selectBox?.y ?? 0) + 1);
  expect(menuBox?.y ?? -1).toBeGreaterThanOrEqual(0);
});

test('drawer select menu stays in viewport and outside the bottom sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/apps/characters');
  const panel = await openFilters(page);
  expect(await panel.evaluate((element) => element.closest('[data-position]')?.getAttribute('data-position'))).toBe('bottom');
  const before = await readScroll(panel);

  const { select, menu } = await openSortSelect(panel);
  const selectBox = await select.boundingBox();
  const menuBox = await menu.boundingBox();
  const menuInfo = await menu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      position: getComputedStyle(element).position,
      parentIsFloatingRoot: element.parentElement?.hasAttribute('data-overlay-floating-root') ?? false,
      insideDialog: Boolean(element.closest('[role="dialog"]')),
    };
  });
  const after = await readScroll(panel);
  console.log('drawer geometry', JSON.stringify({ selectBox, menuBox, menuInfo, before, after }));

  expect(selectBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(menuInfo.position).toBe('fixed');
  expect(menuInfo.parentIsFloatingRoot).toBe(true);
  expect(menuInfo.insideDialog).toBe(false);
  expect(Math.abs(menuInfo.left - (selectBox?.x ?? 0))).toBeLessThanOrEqual(1.5);
  expect(menuInfo.left).toBeGreaterThanOrEqual(0);
  expect(menuInfo.right).toBeLessThanOrEqual(390);
  expect(menuInfo.top).toBeGreaterThanOrEqual(0);
  expect(menuInfo.bottom).toBeLessThanOrEqual(844);
  expect(after.panelScrollWidth).toBe(before.panelScrollWidth);
  expect(after.scrollerScrollWidth).toBe(before.scrollerScrollWidth);
  expect(after.scrollerScrollWidth).toBeLessThanOrEqual(after.scrollerClientWidth);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

  const scrollResult = await panel.evaluate((element) => {
    const scroller = element.querySelector<HTMLElement>('[data-autohide-scroll]');
    if (!scroller) return null;
    const before = scroller.scrollTop;
    scroller.scrollTop = Math.max(0, before - 60);
    return { before, after: scroller.scrollTop };
  });
  expect(scrollResult).not.toBeNull();
  expect(scrollResult!.after).toBeLessThan(scrollResult!.before);
  await expect.poll(async () => {
    const nextSelect = await select.boundingBox();
    const nextMenu = await menu.boundingBox();
    if (!nextSelect || !nextMenu) return Number.POSITIVE_INFINITY;
    const belowGap = Math.abs(nextMenu.y - (nextSelect.y + nextSelect.height + 4));
    const aboveGap = Math.abs(nextSelect.y - (nextMenu.y + nextMenu.height) - 4);
    return Math.abs(nextMenu.x - nextSelect.x) + Math.min(belowGap, aboveGap);
  }).toBeLessThanOrEqual(2);

  await page.setViewportSize({ width: 360, height: 844 });
  await expect.poll(async () => {
    const resizedMenu = await menu.boundingBox();
    const resizedSelect = await select.boundingBox();
    if (!resizedMenu || !resizedSelect) return Number.POSITIVE_INFINITY;
    return Math.abs(resizedMenu.x - resizedSelect.x);
  }).toBeLessThanOrEqual(1.5);
  await expect.poll(async () => {
    const resizedMenu = await menu.boundingBox();
    return resizedMenu ? resizedMenu.x + resizedMenu.width : Number.POSITIVE_INFINITY;
  }).toBeLessThanOrEqual(360);
  const resizedMenuBox = await menu.boundingBox();
  expect((resizedMenuBox?.x ?? 0) + (resizedMenuBox?.width ?? 0)).toBeLessThanOrEqual(360);

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(panel).toBeVisible();
  await expect(select).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});
