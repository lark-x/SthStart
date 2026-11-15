import { expect, test } from '@playwright/test';
import { connect, createServer, type AddressInfo, type Socket } from 'node:net';

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
  await expect(page.getByRole('heading', { name: '创作笔记', level: 1 })).toBeVisible();
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('link', { name: '资料库', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '新建笔记' })).toBeVisible();

  // 新建视图由离线外壳在客户端接管（/offline 下的路由不落到服务端），
  // 断网时仍可写标题与正文（本地草稿队列接管）。
  // 标题不再经由「编辑资料」弹层修改，而是文档头部的行内标题输入框。
  await page.getByRole('link', { name: '新建笔记' }).click();
  const title = page.getByRole('region', { name: '文档标题与元信息' }).getByPlaceholder('无标题笔记');
  await expect(title).toBeVisible();
  await title.fill('断网时写下的标题');
  await expect(title).toHaveValue('断网时写下的标题');

  const body = page.getByRole('region', { name: '笔记正文' }).getByPlaceholder('写下一段文字记录…');
  await body.fill('断网时写下的正文');
  await expect(body).toHaveValue('断网时写下的正文');
});

test('notebook routes register a service worker for offline shell', async ({ page, baseURL }) => {
  // Playwright 的 Windows WebKit setOffline 会直接拦截顶层导航，连独立样例的
  // Service Worker 都无法接管。关闭本用例专属的 TCP 转发则让真实请求失败，
  // Chromium 和 WebKit 都必须从自己刚建立的缓存返回文档。
  const origin = new URL(baseURL!);
  let reachable = true;
  let rejected = 0;
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.once('close', () => sockets.delete(socket));
  };
  const gateway = createServer((client) => {
    if (!reachable) {
      rejected += 1;
      client.destroy();
      return;
    }
    const upstream = connect(Number(origin.port), origin.hostname);
    track(client);
    track(upstream);
    client.once('close', () => upstream.destroy());
    upstream.once('close', () => client.destroy());
    client.pipe(upstream).pipe(client);
  });
  await new Promise<void>((resolve, reject) => {
    gateway.once('error', reject);
    gateway.listen(0, '127.0.0.1', resolve);
  });
  const port = (gateway.address() as AddressInfo).port;
  const offlineUrl = `http://127.0.0.1:${port}/apps/notebook/offline`;
  try {
    await page.goto(offlineUrl);
    await expect.poll(() => page.evaluate(async () => {
      const controlled = navigator.serviceWorker.controller?.scriptURL;
      const cached = await caches.match('/apps/notebook/offline');
      return { worker: controlled ? new URL(controlled).pathname : null, cached: cached?.status ?? null };
    }), { timeout: 15_000 }).toEqual({ worker: '/notebook-sw.js', cached: 200 });

    reachable = false;
    for (const socket of sockets) socket.destroy();
    const response = await page.goto(offlineUrl, { waitUntil: 'domcontentloaded' });
    expect(rejected).toBeGreaterThan(0);
    expect(response?.status()).toBe(200);
    expect(response?.fromServiceWorker()).toBe(true);
    await expect(page.getByRole('link', { name: '新建笔记' })).toBeVisible();
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
  }
});

test('phone viewport keeps the note editor usable with a soft keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto('/apps/notebook/new');

  // 标题在文档头部行内编辑，窄屏下同样直接可写，无需打开弹层。
  const title = page.getByRole('region', { name: '文档标题与元信息' }).getByPlaceholder('无标题笔记');
  await expect(title).toBeVisible();
  await title.click();
  // 中文输入法组合输入不应触发误提交：直接输入多段中文后值保持不变。
  await title.fill('外婆家的下午');
  await expect(title).toHaveValue('外婆家的下午');

  // 模拟软键盘压缩可视高度后，正文输入区仍落在可视范围内。
  await page.setViewportSize({ width: 390, height: 360 });
  const body = page.getByRole('region', { name: '笔记正文' }).getByPlaceholder('写下一段文字记录…');
  await body.scrollIntoViewIfNeeded();
  const box = await body.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + Math.min(box?.height ?? 0, 120)).toBeLessThanOrEqual(360);

  // 页面整体不得横向溢出。
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
