import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const evidence = resolve('artifacts/visual-verification/world-authoring');

/**
 * 外框顶栏去重：页面自带 WorkspaceHeader 时，外框不能再画一条全局指令条。
 * 这里同时检查可见性与实际高度，避免只靠 display 断言漏掉叠罗汉。
 */
const routes = [
  { path: '/', owner: 'shell' },
  { path: '/apps/characters', owner: 'shell' },
  // 不带 world 参数时是作品目录（普通页面，外框顶栏）；进入某部作品后才是工作台。
  { path: '/apps/story-worlds', owner: 'shell' },
  { path: '/apps/narrative', owner: 'workspace' },
  { path: '/apps/resources', owner: 'shell' },
  { path: '/apps/notebook', owner: 'shell' },
] as const;

test.describe('shell top bar', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const route of routes) {
    test(`${route.path} renders exactly one top bar owned by the ${route.owner}`, async ({ page }) => {
      await page.goto(route.path);
      await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');

      const bars = await page.evaluate(() => {
        const selectors = ['.shell-toolbar', '.workspace-header', '.tpl-header'];
        const visible = selectors.flatMap((selector) => [...document.querySelectorAll<HTMLElement>(selector)])
          .filter((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.height > 0;
          });
        const tops = visible.map((element) => Math.round(element.getBoundingClientRect().top));
        return { count: visible.length, tops, shell: document.querySelectorAll('.shell-toolbar').length };
      });

      expect(bars.count, `${route.path} visible top bars`).toBe(1);
      if (route.owner === 'workspace') {
        expect(bars.shell, `${route.path} shell toolbar suppressed`).toBe(0);
      } else {
        expect(bars.shell, `${route.path} shell toolbar present`).toBe(1);
      }
    });
  }

  test('workspace sidebar expands in place instead of opening the navigation drawer', async ({ page }, info) => {
    await page.addInitScript(() => {
      if (localStorage.getItem('sthstart_nav_collapsed') === null) localStorage.setItem('sthstart_nav_collapsed', 'true');
    });
    await page.goto('/apps/story-worlds');
    await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');

    const sidebar = page.getByRole('complementary', { name: '侧边导航' });
    const expand = sidebar.getByRole('button', { name: '展开导航', exact: true });
    await expect(expand).toHaveAttribute('aria-pressed', 'true');
    await expand.click();

    const collapse = sidebar.getByRole('button', { name: '收起导航', exact: true });
    await expect(collapse).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('dialog', { name: '导航' })).toBeHidden();
    await expect(sidebar.getByText('作品', { exact: true })).toBeVisible();
    await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeGreaterThan(200);
    await page.screenshot({ path: info.outputPath('workspace-sidebar-expanded.png'), animations: 'disabled' });
    await sidebar.getByRole('link', { name: '工作台' }).last().click();
    await expect(page).toHaveURL(/\/$/);
    await expect(collapse).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/apps\/story-worlds$/);
    await expect(collapse).toBeVisible();
    await page.reload();
    await expect(collapse).toBeVisible();
    const beforeHydration = await page.context().newPage();
    await beforeHydration.route('**/*', (route) =>
      route.request().resourceType() === 'script' ? route.abort() : route.continue());
    await beforeHydration.goto('/');
    expect((await beforeHydration.locator('.shell-sidebar').boundingBox())?.width).toBeGreaterThan(200);
    await beforeHydration.close();

    await collapse.click();
    await expect(expand).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThan(80);

    const otherTab = await page.context().newPage();
    await otherTab.goto('/');
    await otherTab.evaluate(() => localStorage.setItem('sthstart_nav_collapsed', 'false'));
    await expect(collapse).toBeVisible();
    await otherTab.close();

    // 作品目录是普通页面；用自带页头的工作台路由检查「打开全站导航」。
    await page.goto('/apps/narrative');
    await page.getByRole('button', { name: '打开全站导航' }).click();
    await expect(page.getByRole('dialog', { name: '导航' })).toBeVisible();
  });

  test('settings categories remain reachable at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/settings/public-services');
    const navigation = page.getByRole('navigation', { name: '设置中心二级导航' });
    const links = navigation.getByRole('link');
    await expect(links).toHaveCount(6);
    for (const label of ['外观', '模型与连接', '生成方案', '运行诊断', '调用记录', '数据备份']) {
      await expect(links.getByText(label, { exact: true })).toBeVisible();
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('the navigation thumb appears only while scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 470 });
    await page.addInitScript(() => localStorage.setItem('sthstart_nav_collapsed', 'false'));
    await page.goto('/');
    await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');
    const nav = page.getByRole('complementary', { name: '侧边导航' }).getByRole('navigation');
    await nav.hover();
    const thumbColor = () => nav.evaluate((el) => CSS.supports('scrollbar-color', 'red transparent')
      ? getComputedStyle(el).getPropertyValue('scrollbar-color').split(') ')[0] + ')'
      : getComputedStyle(el, '::-webkit-scrollbar-thumb').backgroundColor);
    await expect.poll(thumbColor).toBe('rgba(0, 0, 0, 0)');
    const width = await nav.evaluate((el) => el.clientWidth);
    await nav.focus();
    await page.mouse.wheel(0, 150);
    await expect(nav).toHaveAttribute('data-scrolling', '');
    await expect.poll(thumbColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(await nav.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(nav).not.toHaveAttribute('data-scrolling', '');
    expect(await nav.evaluate((el) => el.clientWidth)).toBe(width);
    await expect.poll(thumbColor).toBe('rgba(0, 0, 0, 0)');
  });

  test('day/night is direct and appearance previews are local until applied', async ({ page }, info) => {
    await page.goto('/settings/appearance');
    const html = page.locator('html');
    const nav = page.getByRole('complementary', { name: '侧边导航' });
    await nav.getByRole('button', { name: '切换至夜间模式' }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark-espresso');
    await expect(page.getByRole('menu', { name: '主题与外观' })).toHaveCount(0);
    await page.getByRole('button', { name: '预览云白' }).click();
    const dialog = page.getByRole('dialog', { name: /预览/ });
    await expect(dialog.locator('[data-appearance-preview]')).toHaveAttribute('data-theme', 'light-zinc');
    await expect(html).toHaveAttribute('data-theme', 'dark-espresso');
    await page.screenshot({ path: info.outputPath('appearance-preview.png'), animations: 'disabled' });
    await dialog.getByRole('button', { name: '取消' }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark-espresso');
    await page.getByRole('button', { name: '预览手账贴纸' }).click();
    await expect(dialog.locator('[data-appearance-preview]')).toHaveAttribute('data-ui-skin', 'sticker');
    await dialog.getByRole('button', { name: '应用' }).click();
    await expect(html).toHaveAttribute('data-ui-skin', 'sticker');
    await page.reload();
    await expect(html).toHaveAttribute('data-ui-skin', 'sticker');
    await nav.getByRole('button', { name: '切换至日间模式' }).click();
    await expect(html).toHaveAttribute('data-theme', 'light-paper');
    await expect(html).toHaveAttribute('data-ui-skin', 'sticker');
  });

  test('search from the mobile navigation hands focus to the command palette and back', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/apps/story-worlds');
    await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');

    const trigger = page.getByRole('button', { name: '打开全站导航', exact: true });
    await trigger.click();
    const drawer = page.getByRole('dialog', { name: '导航', exact: true });
    await drawer.getByRole('button', { name: '搜索与命令快捷键', exact: true }).click();
    await expect(drawer).toBeHidden();

    const palette = page.getByRole('dialog', { name: '命令快捷菜单', exact: true });
    const search = palette.getByRole('textbox', { name: '搜索命令', exact: true });
    await expect(search).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await search.fill('作品');
    await expect(palette.getByRole('option', { name: /作品/ }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('mobile workspace navigation keeps day/night reachable in both directions', async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 570 });
    await page.goto('/apps/story-worlds');
    await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');
    const trigger = page.getByRole('button', { name: '打开全站导航', exact: true });
    await trigger.click();
    const drawer = page.getByRole('dialog', { name: '导航', exact: true });
    await expect(drawer.getByRole('button', { name: '收起导航', exact: true })).toBeHidden();
    const night = drawer.getByRole('button', { name: '切换至夜间模式', exact: true });
    await night.scrollIntoViewIfNeeded();
    await expect(night).toBeVisible();
    await night.focus();
    await night.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark-espresso');
    const day = drawer.getByRole('button', { name: '切换至日间模式', exact: true });
    await expect(day).toBeFocused();
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: resolve(evidence, `${info.project.name}-mobile-nav-day-night.png`), animations: 'disabled' });
    await day.press('Space');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light-paper');
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('classic skin preview resets styled skin shadows without changing the workspace', async ({ page }, info) => {
    await page.goto('/settings/appearance');
    await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');
    const dialog = page.getByRole('dialog', { name: /预览/ });
    const open = async (name: string) => {
      await page.getByRole('button', { name: `预览${name}`, exact: true }).click();
      await expect(dialog).toBeVisible();
    };
    const apply = async (name: string) => {
      await open(name);
      await dialog.getByRole('button', { name: '应用', exact: true }).click();
      await expect(dialog).toBeHidden();
    };
    const styles = () => dialog.locator('[data-appearance-preview]').evaluate((sample) => {
      const card = sample.querySelector('p.font-semibold')!.parentElement!;
      const button = [...sample.querySelectorAll('span')].find((node) => node.textContent === '继续创作')!;
      return {
        shadow: getComputedStyle(card).boxShadow,
        buttonShadow: getComputedStyle(button).boxShadow,
        buttonBorder: getComputedStyle(button).borderColor,
      };
    });
    for (const theme of ['暖白', '暖夜']) {
      await apply(theme);
      await open('经典纸感');
      const baseline = await styles();
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      for (const [skin, id] of [['手账贴纸', 'sticker'], ['原神 · 轻纪行', 'genshin']]) {
        await apply(skin);
        const stored = await page.evaluate(() => JSON.stringify(localStorage));
        await open('经典纸感');
        expect(await styles()).toEqual(baseline);
        if (theme === '暖白' && id === 'sticker') {
          mkdirSync(evidence, { recursive: true });
          await page.screenshot({ path: resolve(evidence, `${info.project.name}-classic-preview-from-sticker.png`), animations: 'disabled' });
        }
        await expect(page.locator('html')).toHaveAttribute('data-ui-skin', id);
        expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(stored);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(page.getByRole('button', { name: '预览经典纸感', exact: true })).toBeFocused();
        await apply('经典纸感');
        await expect(page.locator('html')).not.toHaveAttribute('data-ui-skin', /./);
      }
    }
  });

  test('stopped runtime services use a neutral dot, not a danger dot', async ({ page, context, baseURL }) => {
    const origin = new URL(baseURL ?? page.url()).origin;
    expect((await context.request.post(origin + '/api/auth/admin-session', { headers: { origin } })).ok()).toBe(true);
    await page.goto('/settings/control-center');
    await expect(page.getByRole('heading', { name: '邻舍运行栈', exact: true })).toBeVisible();
    const runtimeTab = page.getByRole('tab', { name: '自启与服务', exact: true });
    await runtimeTab.click();
    await expect(page.getByText('运行参数与自启配置', { exact: true })).toBeVisible();

    const stopped = page.locator('.status-dot[data-status="stopped"]').first();
    await expect(stopped).toBeVisible();
    const styles = await stopped.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, borderWidth: style.borderTopWidth };
    });
    expect(styles.borderWidth).not.toBe('0px');
    expect(styles.background).not.toContain('201, 103, 74');
    expect(await page.locator('.status-dot[data-status="stopped"].bg-danger').count()).toBe(0);
  });
});
