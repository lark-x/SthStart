import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/*
 * 计划 §13 第 4 条：代表页面同条件前后对照图。
 *
 * 代表页按 §10 的 D3 定义取「角色库、活动编辑、模型配置」三页，另加首页工作台；
 * 条件固定为：同一份测试库数据、同一视口、同一主题、整页截图、动效关闭；
 * 不遮罩：这是给人看的对照图，遮罩会把真实列表内容糊掉、反而看不出构图变化。
 * 唯一不计入对照的是「实时服务状态」这类随进程波动的区域（见交付记录说明）。
 *
 * 用法（前后各跑一次，中间切换 dist）：
 *   $env:CAPTURE_OUT='...'; $env:CAPTURE_TAG='before'
 *   npx playwright test --config tests/capture/playwright.config.ts
 */

const OUT_DIR = process.env.CAPTURE_OUT;
const TAG = process.env.CAPTURE_TAG ?? 'snapshot';

const VIEWPORTS = [
  { key: 'desktop', width: 1440, height: 900 },
  { key: 'mobile', width: 390, height: 844 },
];

const SCREENSHOT = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  timeout: 30_000,
};

if (!OUT_DIR) {
  throw new Error('未设置 CAPTURE_OUT：请指定截图输出目录。');
}

fs.mkdirSync(OUT_DIR, { recursive: true });

/** 等页面稳定：等字体加载完成再静置一段；旧版页面可能缺少新选择器，因此不硬断言。 */
async function settle(page: Page) {
  await page
    .evaluate(() => document.fonts.ready.then(() => undefined))
    .catch(() => undefined);
  await page.waitForTimeout(1200);
}

async function shoot(page: Page, name: string) {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    // 视口变化后让布局重新结算，避免截到重排中间帧。
    await page.waitForTimeout(400);
    await page.screenshot({
      ...SCREENSHOT,
      path: path.join(OUT_DIR as string, TAG + '-' + name + '-' + vp.key + '.png'),
      fullPage: true,
    });
  }
}

test('capture representative pages', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1) 首页工作台
  await page.goto('/', { waitUntil: 'load' });
  await settle(page);
  await shoot(page, 'dashboard');

  // 2) 角色库（D3）
  await page.goto('/apps/characters', { waitUntil: 'load' });
  await settle(page);
  await shoot(page, 'characters');

  // 3) 活动编辑（D3）：从列表取一条真实活动，前后两次取同一条（采集期间数据不变动）
  await page.goto('/apps/activities', { waitUntil: 'load' });
  await settle(page);
  const hrefs = await page
    .locator('a[href]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
  const activityHref =
    hrefs.find(
      (href) =>
        href.indexOf('/apps/activities/') === 0 &&
        href !== '/apps/activities/new' &&
        href.length > '/apps/activities/'.length + 6
    ) ?? null;
  if (activityHref) {
    await page.goto(activityHref, { waitUntil: 'load' });
    await settle(page);
    await shoot(page, 'activity-editor');
  } else {
    test
      .info()
      .annotations.push({ type: 'warning', description: '未找到可采集的活动，跳过活动编辑页' });
  }

  // 4) 模型配置（D3）
  await page.goto('/settings/public-services', { waitUntil: 'load' });
  await settle(page);
  await shoot(page, 'model-config');
});
