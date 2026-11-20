import { expect, test, type Browser } from '@playwright/test';
import { readFileSync } from 'node:fs';

/*
 * 动效语言（设计语言 §8，前端视觉计划 P3）：
 * - 列表首次出现：淡入 + 上移 4px，逐项错开 30ms，第 9 项起不再继续错开；
 * - 面板 / 标签切换：淡入 + 横移 4px；
 * - prefers-reduced-motion: reduce 时以上动画全部关闭，内容直接显示。
 * 列表数据来自录好的 HAR（角色库 3 条）与固定的最近工作接口，计数不随共享测试库漂移。
 */

const portalOrigin = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
const manifest = JSON.parse(readFileSync('tests/e2e/visual-fixtures/manifest.json', 'utf8')) as { recordedAt: string };
const RECENT = {
  items: [
    { id: 'motion-story', title: '枫丹雨夜篇章', kind: 'story', updatedAt: '2026-10-15T01:20:00.000Z' },
    { id: 'motion-activity', title: '秋日茶会互动', kind: 'activity', updatedAt: '2026-10-14T09:00:00.000Z' },
    { id: 'motion-note', title: '港口城市的世界观笔记', kind: 'note', updatedAt: '2026-10-13T12:45:00.000Z' },
  ],
};

async function open(browser: Browser, reducedMotion: 'reduce' | 'no-preference') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion, serviceWorkers: 'block' });
  expect((await context.request.post(portalOrigin + '/api/auth/admin-session', { headers: { origin: portalOrigin } })).ok()).toBe(true);
  const page = await context.newPage();
  return { context, page };
}


test('lists enter with a 30ms stagger and tab panels slide in when motion is allowed', async ({ browser }) => {
  const { context, page } = await open(browser, 'no-preference');
  try {
    await page.routeFromHAR('tests/e2e/visual-fixtures/characters.har', { url: /\/api\/admin\//, notFound: 'fallback' });
    await page.clock.setFixedTime(new Date(manifest.recordedAt));
    await page.goto('/apps/characters');
    const items = page.locator('[data-collection-items] > *');
    await expect(items).toHaveCount(3, { timeout: 15_000 });
    const motions = await items.evaluateAll(nodes => nodes.map(node => {
      const style = getComputedStyle(node);
      return { name: style.animationName, delay: style.animationDelay };
    }));
    expect(motions.map(m => m.name)).toEqual(['list-item-in', 'list-item-in', 'list-item-in']);
    expect(motions.map(m => m.delay)).toEqual(['0s', '0.03s', '0.06s']);

    await page.route(/\/api\/admin\/workspace\/recent(?:\?|$)/, route => route.fulfill({ json: RECENT }));
    await page.goto('/');
    const recent = page.getByTestId('recent-work-list').locator('> li');
    await expect(recent).toHaveCount(3, { timeout: 15_000 });
    expect(await recent.nth(2).evaluate(node => ({ name: getComputedStyle(node).animationName, delay: getComputedStyle(node).animationDelay })))
      .toEqual({ name: 'list-item-in', delay: '0.06s' });

    const panel = page.locator('[role="tabpanel"]:not([hidden])').first();
    if (await panel.count()) {
      expect(await panel.evaluate(node => getComputedStyle(node).animationName)).toBe('tab-panel-in');
    }
    const keyframe = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSKeyframesRule && rule.name === 'tab-panel-in') return (rule.cssRules[0] as CSSKeyframeRule).style.transform;
        }
      }
      return null;
    });
    // Chromium 把 translateX(4px) 序列化为 translate(4px)，两种写法都表示横移 4px。
    expect(keyframe, 'tab panels slide horizontally by 4px').toMatch(/^translateX?\(4px\)$/);
  } finally {
    await context.close();
  }
});

test('reduced motion turns off list, panel and save status animations', async ({ browser }) => {
  const { context, page } = await open(browser, 'reduce');
  try {
    await page.routeFromHAR('tests/e2e/visual-fixtures/characters.har', { url: /\/api\/admin\//, notFound: 'fallback' });
    await page.clock.setFixedTime(new Date(manifest.recordedAt));
    await page.goto('/apps/characters');
    const items = page.locator('[data-collection-items] > *');
    await expect(items).toHaveCount(3, { timeout: 15_000 });
    const names = await items.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).animationName));
    expect(names).toEqual(['none', 'none', 'none']);
    // 动画关闭后内容直接可见，不停在 opacity 0。
    expect(await items.first().evaluate(node => getComputedStyle(node).opacity)).toBe('1');

    await page.route(/\/api\/admin\/workspace\/recent(?:\?|$)/, route => route.fulfill({ json: RECENT }));
    await page.goto('/');
    const recent = page.getByTestId('recent-work-list').locator('> li');
    await expect(recent).toHaveCount(3, { timeout: 15_000 });
    expect(await recent.nth(1).evaluate(node => getComputedStyle(node).animationName)).toBe('none');

    const reduced = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.setAttribute('role', 'tabpanel');
      const status = document.createElement('span');
      status.className = 'save-status';
      const icon = document.createElement('span');
      icon.className = 'save-status-icon';
      status.appendChild(icon);
      document.body.appendChild(probe);
      document.body.appendChild(status);
      const result = {
        panel: getComputedStyle(probe).animationName,
        icon: getComputedStyle(icon).animationName,
        statusTransition: getComputedStyle(status).transitionDuration,
      };
      probe.remove();
      status.remove();
      return result;
    });
    expect(reduced).toEqual({ panel: 'none', icon: 'none', statusTransition: '0s' });
  } finally {
    await context.close();
  }
});
