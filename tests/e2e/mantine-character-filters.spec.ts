import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { isOwnedDirectory } from './global-setup';

const portal = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
const service = 'http://127.0.0.1:' + (process.env.E2E_SERVICE_PORT ?? 4200) + '/api/v1/admin';
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
const prefix = '角色筛选-' + randomUUID().slice(0, 8);
const work = prefix + '作品';
const tagA = prefix + '标签甲';
const group = prefix + '分组';

test.beforeAll(async ({ request }) => {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  for (let n = 1; n <= 25; n++) {
    const displayName = `${prefix}-${n}`;
    const character = await request.post(service + '/characters', { headers, data: {
      displayName,
      tags: [n === 1 ? tagA : n === 2 ? `${prefix}标签乙` : `${prefix}批量`],
      draft: { displayName, work, identity: '角色筛选回归样本' },
    } });
    expect(character.ok()).toBe(true);
    if (n <= 2) {
      const { id } = await character.json() as { id: string };
      const organization = await request.put(service + '/characters/organization', { headers, data: {
        ids: [id], groups: [group], favorite: n === 1,
      } });
      expect(organization.ok()).toBe(true);
    }
  }
});

test.beforeEach(async ({ context }) => {
  expect((await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } })).ok()).toBe(true);
});

async function openCharacterFilters(page: import('@playwright/test').Page) {
  // The SSR markup paints the trigger before its handler attaches; wait for the shell's
  // client-ready flag so the first click cannot land on an inert button.
  await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');
  await page.getByRole('button', { name: '筛选与排序', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '角色筛选', exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * 分页摘要里的总数。整套 E2E 共用隔离数据库，其他 spec 也会写入角色，
 * 所以“未筛选”的总数只能取本页当时的实测值，不能写死 25。
 */
async function readTotalCount(page: import('@playwright/test').Page) {
  const summary = page.getByRole('navigation', { name: '分页', exact: true });
  const text = await summary.innerText();
  const match = text.match(/共\s*(\d+)\s*条/);
  expect(match, `分页摘要应包含总数：${text}`).not.toBeNull();
  return Number(match![1]);
}

test.describe('B1 character filters', () => {
  test('one arrangement exposes works, tags, groups, favorites and every existing option at desktop and phone widths', async ({ page }) => {
    for (const width of [1024, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/apps/characters');
      const quick = page.getByRole('group', { name: '常用筛选', exact: true });
      if (width === 1024) {
        await expect(quick).toBeVisible();
        for (const label of ['作品', '标签', '分组']) {
          await expect(quick.getByRole('button', { name: new RegExp(`^${label}(?: \\(\\d+\\))?$`) })).toBeVisible();
        }
        await expect(quick.getByRole('checkbox', { name: '仅收藏', exact: true })).toBeVisible();
      } else {
        await expect(quick).toBeHidden();
      }

      const panel = await openCharacterFilters(page);
      await expect(quick).toHaveCount(0);

      const common = panel.getByRole('group', { name: '作品、标签与分组', exact: true });
      await expect(common).toBeVisible();
      for (const label of ['作品', '标签', '分组']) {
        await expect(common.getByRole('button', { name: new RegExp(`^${label}(?: \\(\\d+\\))?$`) })).toHaveCount(1);
      }
      await expect(common.getByRole('checkbox', { name: '仅收藏', exact: true })).toHaveCount(1);
      await expect(panel.getByRole('group', { name: '资料条件', exact: true })).toBeVisible();
      await expect(panel.getByRole('group', { name: '生日与排序', exact: true })).toBeVisible();
      await expect(panel.getByRole('combobox')).toHaveCount(11);
      for (const label of ['作品类型', '创作类型', '外观参考图', '外观描述', '人设演绎', '导入来源', '待整理', '标签匹配', '生日状态', '生日月份', '排序']) {
        await expect(panel.getByRole('combobox', { name: label, exact: true })).toBeVisible();
      }
      await expect(panel.getByRole('button', { name: '重置筛选', exact: true })).toBeVisible();
      await expect(panel.getByRole('button', { name: '确认筛选', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

      await panel.getByRole('button', { name: '确认筛选', exact: true }).click();
      await expect(panel).toBeHidden();
    }
  });

  test('works selection keeps URL state through reload and page history', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/apps/characters');
    const panel = await openCharacterFilters(page);
    await panel.getByRole('button', { name: '作品', exact: true }).click();
    const works = page.getByRole('dialog', { name: '按作品筛选', exact: true });
    await works.getByRole('checkbox', { name: work, exact: true }).check();
    await page.keyboard.press('Escape');
    await expect(works).toBeHidden();
    await panel.getByRole('button', { name: '确认筛选', exact: true }).click();

    await expect(page.getByRole('button', { name: `移除筛选：作品：${work}`, exact: true })).toBeVisible();
    const filterTrigger = page.getByRole('button', { name: '筛选与排序', exact: true });
    await expect(filterTrigger).toHaveAccessibleDescription('已启用 1 个筛选条件');
    await expect(page.getByRole('navigation', { name: '分页', exact: true })).toContainText('共 25 条');
    await expect(page).toHaveURL(/cf=/);

    const paging = page.getByRole('navigation', { name: '分页', exact: true });
    await paging.getByRole('button', { name: '第 2 页', exact: true }).click();
    await expect(paging).toContainText('当前 21–25 条');
    await page.reload();
    await expect(page.getByRole('navigation', { name: '分页', exact: true })).toContainText('当前 21–25 条');
    await expect(page.getByRole('button', { name: `移除筛选：作品：${work}`, exact: true })).toBeVisible();
  });

  test('tag, group, favorite and an existing select combine in the shared panel and reset together', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/apps/characters');
    const unfilteredTotal = await readTotalCount(page);
    let panel = await openCharacterFilters(page);

    await panel.getByRole('button', { name: '标签', exact: true }).click();
    const tags = page.getByRole('dialog', { name: '按标签筛选', exact: true });
    await tags.getByRole('checkbox', { name: tagA, exact: true }).check();
    await page.keyboard.press('Escape');

    await panel.getByRole('button', { name: '分组', exact: true }).click();
    const groups = page.getByRole('dialog', { name: '按分组筛选', exact: true });
    await groups.getByRole('checkbox', { name: group, exact: true }).check();
    await page.keyboard.press('Escape');

    await panel.getByRole('checkbox', { name: '仅收藏', exact: true }).check();
    await panel.getByRole('combobox', { name: '标签匹配', exact: true }).selectOption('all');
    await panel.getByRole('button', { name: '确认筛选', exact: true }).click();

    await expect(page.getByRole('button', { name: `移除筛选：标签：${tagA}`, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: `移除筛选：分组：${group}`, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '移除筛选：仅收藏', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '移除筛选：标签：全部匹配', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '筛选与排序', exact: true }))
      .toHaveAccessibleDescription('已启用 4 个筛选条件');
    await expect(page.getByRole('navigation', { name: '分页', exact: true })).toContainText('共 1 条');

    panel = await openCharacterFilters(page);
    await panel.getByRole('button', { name: '重置筛选', exact: true }).click();
    await expect(page.getByRole('button', { name: '移除筛选：仅收藏', exact: true })).toHaveCount(0);
    // 重置回到进入页面时的未筛选集合；总数随共享库中其他 spec 的写入变化。
    expect(await readTotalCount(page)).toBe(unfilteredTotal);
    await panel.getByRole('button', { name: '确认筛选', exact: true }).click();
  });

  test('CJK composition in the outer search does not apply an intermediate query or act as a shortcut', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/apps/characters');
    const search = page.getByRole('textbox', { name: '搜索角色', exact: true });
    await search.click();
    await search.evaluate((element) => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'fu' })));
    await search.fill('芙');
    const prevented = await search.evaluate((element) => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
      Object.defineProperty(event, 'isComposing', { configurable: true, value: true });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(false);
    await expect(search).toHaveValue('芙');
    await expect.poll(() => decodeURIComponent(page.url())).not.toContain('芙');
    await search.evaluate((element) => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '芙' })));
    await expect(search).toHaveValue('芙');
    await expect.poll(() => decodeURIComponent(page.url())).toContain('芙');
    await expect(page.getByRole('button', { name: '筛选与排序', exact: true })).toBeVisible();
  });

  test('the last view tab is reachable at phone width through the shared tab adapter', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/apps/characters');
    await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');
    const first = page.getByRole('tab', { name: '专属角色卡', exact: true });
    await first.focus();
    await page.keyboard.press('End');
    const last = page.getByRole('tab', { name: '邻舍角色', exact: true });
    await expect(last).toHaveAttribute('aria-selected', 'true');
    await expect(last).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });

  test.describe('isolated neighbor fixtures', () => {
    // Service workers can bypass Playwright route interception. Offline worker
    // behavior is verified with real requests in offline-and-mobile.spec.ts.
    test.use({ serviceWorkers: 'block' });

    test('the neighbor vault keeps a named diary action visible and touch sized', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      let fixtureHits = 0;
      await page.route('**/api/admin/linshe-bridge/characters', route => {
        fixtureHits += 1;
        return route.fulfill({ json: {
          characters: [{
            id: 'neighbor-mobile-example', name: 'mobile', display_name: '邻舍手机样本',
            is_sleeping: false, is_temp_woken: false, was_door_woken: 0, wake_attempts: 0, reply_delay: 0, pinned: false,
          }],
        } });
      });
      await page.goto('/apps/characters');
      await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');
      await page.getByRole('tab', { name: '邻舍角色', exact: true }).click();
      const panel = page.getByRole('tabpanel', { name: '邻舍角色', exact: true });
      await expect(panel.getByText('邻舍手机样本', { exact: true })).toBeVisible();
      expect(fixtureHits).toBeGreaterThan(0);
      const diary = panel.getByRole('button', { name: '翻开日记本', exact: true });
      await expect(diary).toBeVisible();
      await expect(diary).toHaveCSS('opacity', '1');
      expect((await diary.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    });
  });
});
