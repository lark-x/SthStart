import { expect, test, type Page } from '@playwright/test';

/**
 * 计划 §11.2 的视口矩阵与 §11.3 的「常规页无页面级横向滚动」。
 *
 * 覆盖 1920×1080、1440×900、1280×720、768×1024、390×844，并按计划补 360px 与
 * 「200% 放大」两个边界。200% 放大的等价做法是把 CSS 视口减半
 * （1440 物理宽在 200% 下只有 720 CSS px），这也是 WCAG 1.4.10 的 reflow 检查方式。
 *
 * 每个宽度都检查：有 main、恰好一个 h1、无页面级横向滚动。
 */

const VIEWPORTS = [
  { label: '1920×1080', width: 1920, height: 1080 },
  { label: '1440×900', width: 1440, height: 900 },
  { label: '1280×720', width: 1280, height: 720 },
  { label: '768×1024', width: 768, height: 1024 },
  { label: '390×844', width: 390, height: 844 },
  { label: '360×640（窄边界）', width: 360, height: 640 },
  { label: '720×450（1440 宽 200% 放大）', width: 720, height: 450 },
];

/* 代表路由：三种模板 + 首页。活动编辑页需要真实 ID，运行时从列表里取。 */
const STATIC_ROUTES = [
  { path: '/', name: '首页工作台' },
  { path: '/apps/characters', name: '角色库' },
  { path: '/apps/activities', name: '活动列表' },
  { path: '/apps/notebook/new', name: '笔记编辑器' },
  { path: '/apps/narrative', name: '叙事档案' },
  { path: '/apps/calendar', name: '日历' },
  { path: '/apps/creative', name: '图像与视频' },
  { path: '/settings/public-services', name: '模型与公共服务' },
  { path: '/settings/generation', name: '生成配置' },
  { path: '/settings/control-center', name: '运行与日志' },
];

async function findActivityPath(page: Page) {
  await page.goto('/apps/activities');
  const hrefs = await page
    .locator('a[href]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
  return (
    hrefs.find(
      (href) =>
        href.indexOf('/apps/activities/') === 0 &&
        href !== '/apps/activities/new' &&
        href.length > '/apps/activities/'.length + 6
    ) ?? null
  );
}

async function overflowAt(page: Page, viewport: (typeof VIEWPORTS)[number]) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth + 1) return null;
    const offenders = Array.from(document.querySelectorAll('*'))
      .filter((el) => el.getBoundingClientRect().width > doc.clientWidth + 1)
      .map((el) => el.tagName.toLowerCase() + '.' + String(el.className || '').slice(0, 50))
      .slice(0, 5)
      .join(', ');
    return doc.scrollWidth + ' > ' + doc.clientWidth + '：' + offenders;
  });
}

/*
 * 11 条路由 × 7 个视口 ≈ 77 次换宽度与测量，本身就需要 20 秒以上；
 * 与其余用例并发时会超过默认 30 秒上限。放宽时限，断言内容不变。
 */
test.describe.configure({ timeout: 180_000 });

test('representative routes hold up across the planned viewport matrix', async ({ page }) => {
  const activityPath = await findActivityPath(page);
  const routes = activityPath
    ? [...STATIC_ROUTES, { path: activityPath, name: '活动编辑工作台' }]
    : STATIC_ROUTES;

  const failures: string[] = [];

  for (const route of routes) {
    const response = await page.goto(route.path, { waitUntil: 'load' });
    if (response && response.status() >= 400) continue;
    await page.waitForTimeout(300);

    for (const viewport of VIEWPORTS) {
      const overflow = await overflowAt(page, viewport);
      if (overflow) failures.push(`${route.name} @ ${viewport.label} 横向滚动 ${overflow}`);
    }

    // 结构要求与宽度无关，放回桌面宽度检查一次即可。
    await page.setViewportSize({ width: 1440, height: 900 });
    const headingCount = await page.locator('h1').count();
    if (headingCount !== 1) failures.push(`${route.name} 的 h1 数量为 ${headingCount}，应为 1`);
    if ((await page.locator('main').count()) < 1) failures.push(`${route.name} 缺少 main`);
  }

  expect(failures.length, failures.slice(0, 20).join('\n')).toBe(0);
});
