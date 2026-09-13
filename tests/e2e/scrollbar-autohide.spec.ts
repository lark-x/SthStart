import { expect, test } from '@playwright/test';

/**
 * 滚动条自动隐藏（shell.css 的规则 + AutoHideScrollbars）。
 *
 * 断言四件事：静止时滑块透明、滚动时显形、停止后复隐，以及只给真正滚动的元素打标记。
 * 最后一组守住实现前提：新规则不得声明滚动条宽度。一旦声明，浏览器会从 overlay
 * 滚动条切换到占位滚动条，所有滚动容器凭空多出沟槽，页面版式整体位移。
 */

/** 解析计算后的 `scrollbar-color`，返回滑块（第一个通道）的透明度。 */
const thumbAlpha = (value: string) => {
  /*
   * 不能用空白切分：Chromium 把 `scrollbar-color` 序列化成 `rgba(0, 0, 0, 0) rgba(...)`，
   * 颜色值内部自带空格。直接抓第一个 `rgb()`/`rgba()` 即为滑块。
   */
  const match = /rgba?\(([^)]+)\)/.exec(value);
  if (!match) return value.trim().startsWith('transparent') ? 0 : 1;
  const parts = match[1].split(/[,/]/).map((part) => part.trim()).filter(Boolean);
  return parts.length >= 4 ? Number.parseFloat(parts[3]) : 1;
};

test('scrollbars stay invisible until the reader scrolls, then hide again', async ({ page }) => {
  // 用确实超出一屏的页面：日历页首屏刚好放得下，滚不动就收不到 scroll 事件。
  await page.goto('/apps/characters');
  await expect(page.getByRole('heading', { name: '角色资料库' })).toBeVisible();

  const htmlColor = () => page.evaluate(() => getComputedStyle(document.documentElement).scrollbarColor);
  const htmlMarked = () => page.evaluate(() => document.documentElement.hasAttribute('data-scrolling'));
  const sidebarMarked = () =>
    page.evaluate(() => document.querySelector('.shell-sidebar')?.hasAttribute('data-scrolling') ?? false);

  // 尚未滚动：滑块透明，等于看不见。
  expect(thumbAlpha(await htmlColor())).toBe(0);
  expect(await htmlMarked()).toBe(false);

  await page.mouse.move(700, 500);
  /*
   * 滚动监听是水合之后才挂上的，而页面首帧由 SSR 直接可见；
   * 立刻滚会落在水合之前、收不到事件。这里重试滚动直到标记出现，
   * 与仓库中命令面板、窄屏抽屉等用例处理水合窗口的写法一致。
   */
  await expect
    .poll(
      async () => {
        await page.mouse.wheel(0, 600);
        return htmlMarked();
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  expect(thumbAlpha(await htmlColor())).toBeGreaterThan(0);
  // 只标记真正滚动的那个元素，侧栏不应被牵连。
  expect(await sidebarMarked()).toBe(false);

  // 停手约 800ms 后滑块复隐。
  await expect.poll(async () => thumbAlpha(await htmlColor()), { timeout: 5000 }).toBe(0);
  expect(await htmlMarked()).toBe(false);
});

test('auto-hide keeps the platform scrollbar width untouched', async ({ page }) => {
  await page.goto('/apps/calendar');
  await expect(page.getByRole('heading', { name: '角色日历' })).toBeVisible();

  /*
   * 测试跑在 headless Chromium 上，用的是 overlay 滚动条、沟槽恒为 0，
   * 量不出真实浏览器的占位宽度。所以这里断言的是实现前提本身：
   * 相关选择器都保持 `scrollbar-width: auto`，即只改颜色、不改宽度。
   */
  const widths = await page.evaluate(() => {
    const sidebar = document.querySelector('.shell-sidebar');
    const pane = document.querySelector('.split-panes');
    const sample = pane ? pane.firstElementChild : null;
    const read = (el: Element | null) => (el ? getComputedStyle(el).scrollbarWidth : null);
    return {
      html: getComputedStyle(document.documentElement).scrollbarWidth,
      sidebar: read(sidebar),
      paneChild: read(sample),
    };
  });

  expect(widths.html).toBe('auto');
  expect(widths.sidebar).toBe('auto');
  expect(widths.paneChild).toBe('auto');
});
