import { expect, test } from '@playwright/test';

/**
 * 计划 §11.3 的可量化验收：形状与尺寸刻度必须真的落到计算样式上，
 * 并且测的是真实内容表面，不是遮罩容器。
 */
test('shape and shell tokens resolve to the planned computed values', async ({ page }) => {
  await page.goto('/');

  const tokens = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    return {
      control: css.getPropertyValue('--radius-control').trim(),
      panel: css.getPropertyValue('--radius-panel').trim(),
      dialog: css.getPropertyValue('--radius-dialog').trim(),
      sidebar: css.getPropertyValue('--shell-sidebar').trim(),
      sidebarCollapsed: css.getPropertyValue('--shell-sidebar-collapsed').trim(),
      reading: css.getPropertyValue('--shell-reading').trim(),
      navSurface: css.getPropertyValue('--nav-surface').trim(),
      bgApp: css.getPropertyValue('--bg-app').trim(),
    };
  });

  // Keep the existing compact workspace geometry from workspace-b.css.
  expect(tokens.control).toBe('8px');
  expect(tokens.panel).toBe('12px');
  expect(tokens.dialog).toBe('16px');
  expect(tokens.sidebar).toBe('224px');
  expect(tokens.sidebarCollapsed).toBe('56px');
  expect(Number.parseFloat(tokens.reading)).toBeGreaterThan(600);
  // The warm-paper theme uses separate tokens for the navigation and canvas.
  expect(tokens.navSurface).not.toBe('');
  expect(tokens.bgApp).not.toBe('');
  expect(tokens.navSurface).not.toBe(tokens.bgApp);

  // 真实内容表面（首页模块卡片）使用 panel 圆角。
  await expect(page.locator('.home-module').first()).toHaveCSS('border-radius', tokens.panel);
});

test('interactive controls use the control radius', async ({ page }) => {
  await page.goto('/apps/characters');
  const controlRadius = await page.locator('html').evaluate(
    el => getComputedStyle(el).getPropertyValue('--radius-control').trim(),
  );
  expect(controlRadius).not.toBe('');
  await expect(page.getByRole('link', { name: '新建角色', exact: true })).toHaveCSS('border-radius', controlRadius);

  // 页级 tab 的分段容器与内部按钮使用 control 圆角规范。
  await page.goto('/settings/generation');
  const tabs = page.getByRole('tablist', { name: '生成配置分类' });
  await expect(tabs).toHaveCSS('border-radius', controlRadius);
  await expect(tabs.getByRole('tab', { name: '常用设置' })).toHaveCSS('border-radius', controlRadius);

  // 表单控件最小高度 36px，移动端热区 44px。
  await page.goto('/settings/public-services');
  const appIdInput = page.getByPlaceholder('应用 ID，例如 my-app');
  const extensionsTab = page.getByRole('tab', { name: '扩展服务', exact: true });
  // 应用访问授权改为「扩展服务」页内默认折叠的高级区；先切到该页签，再展开折叠区。
  const advanced = page.locator('details').filter({ has: page.locator('summary', { hasText: '应用访问授权（高级）' }) });
  for (let attempt = 0; attempt < 12 && !(await advanced.isVisible().catch(() => false)); attempt += 1) {
    await extensionsTab.click();
    await page.waitForTimeout(150);
  }
  if (!(await advanced.evaluate(el => (el as HTMLDetailsElement).open))) await advanced.locator('summary').click();
  await expect(appIdInput).toBeVisible({ timeout: 10_000 });
  const inputHeight = await appIdInput.evaluate((el) => el.getBoundingClientRect().height);
  expect(inputHeight).toBeGreaterThanOrEqual(36);
});

test('reduced motion removes non-essential transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const duration = await page.locator('a.shell-nav-link').first().evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(Number.parseFloat(duration)).toBeLessThan(0.02);
});
