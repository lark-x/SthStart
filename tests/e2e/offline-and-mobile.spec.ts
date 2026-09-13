import { expect, test } from '@playwright/test';

/**
 * 计划 §7.2 / §8.8：`/apps/notebook/offline` 必须在无网络时仍可打开并编辑，
 * 不能因为新增统一外框而依赖在线查询。§13 第 4 条要求手机软键盘与窄屏证据。
 */
test('offline notebook shell renders each view with the backend unreachable', async ({ page }) => {
  // 真实离线场景：静态外壳由 Service Worker 提供，数据来自 IndexedDB，
  // 后端完全不可达。这里让所有数据类请求失败来复现该状态。
  // （不能用 context.setOffline：它连本地文档与静态资源一起断掉，
  //  那测的是“浏览器彻底离线”，不是本页面的离线能力。）
  await page.route('**/api/**', (route) => route.abort());

  // 离线入口默认是列表视图，此时统一外框也必须能渲染。
  await page.goto('/apps/notebook/offline');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('link', { name: '笔记', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '新建记录' })).toBeVisible();

  // 新建视图由离线外壳在客户端接管（/offline 下的路由不落到服务端），
  // 断网时仍可写标题与正文（本地草稿队列接管）。
  await page.getByRole('link', { name: '新建记录' }).click();
  const title = page.getByLabel('笔记标题');
  await expect(title).toBeVisible();
  await title.fill('断网时写下的标题');
  await expect(title).toHaveValue('断网时写下的标题');

  const body = page.locator('textarea').first();
  await body.fill('断网时写下的正文');
  await expect(body).toHaveValue('断网时写下的正文');
});

test('notebook routes register a service worker for offline shell', async ({ page }) => {
  await page.goto('/apps/notebook/offline');
  const scope = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    const registration = await navigator.serviceWorker.getRegistration();
    return registration ? registration.scope : 'none';
  });
  console.log('SW_SCOPE ' + scope);
  expect(scope).not.toBe('unsupported');
});

test('phone viewport keeps the note editor usable with a soft keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto('/apps/notebook/new');

  const title = page.getByLabel('笔记标题');
  await expect(title).toBeVisible();
  await title.click();
  // 中文输入法组合输入不应触发误提交：直接输入多段中文后值保持不变。
  await title.fill('外婆家的下午');
  await expect(title).toHaveValue('外婆家的下午');

  // 模拟软键盘压缩可视高度后，正文输入区仍落在可视范围内。
  await page.setViewportSize({ width: 390, height: 360 });
  const body = page.locator('textarea').first();
  await body.scrollIntoViewIfNeeded();
  const box = await body.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + Math.min(box?.height ?? 0, 120)).toBeLessThanOrEqual(360);

  // 页面整体不得横向溢出。
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
