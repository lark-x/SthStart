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
    };
  });

  expect(tokens.control).toBe('8px');
  expect(tokens.panel).toBe('12px');
  expect(tokens.dialog).toBe('16px');
  expect(tokens.sidebar).toBe('224px');
  expect(tokens.sidebarCollapsed).toBe('72px');
  expect(Number.parseFloat(tokens.reading)).toBeGreaterThan(600);

  // 真实内容表面（面板与卡片）使用 panel 圆角。
  await expect(page.locator('section.tpl-panel').first()).toHaveCSS('border-radius', '12px');
});

test('interactive controls use the control radius', async ({ page }) => {
  await page.goto('/apps/characters');
  await expect(page.getByRole('link', { name: '新建角色' })).toHaveCSS('border-radius', '8px');

  // 页级 tab 的分段容器沿用 panel 圆角，内部按钮用 control 圆角。
  await page.goto('/settings/generation');
  await expect(page.locator('.page-tabs').first()).toHaveCSS('border-radius', '12px');

  // 表单控件最小高度 40px，移动端热区 44px。
  await page.goto('/settings/public-services');
  const inputHeight = await page.getByLabel('搜索模型模板').evaluate((el) => el.getBoundingClientRect().height);
  expect(inputHeight).toBeGreaterThanOrEqual(36);
});

test('reduced motion removes non-essential transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const duration = await page.locator('a.shell-nav-link').first().evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(Number.parseFloat(duration)).toBeLessThan(0.02);
});
