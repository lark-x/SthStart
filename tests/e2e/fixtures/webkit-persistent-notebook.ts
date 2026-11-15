/* eslint-disable react-hooks/rules-of-hooks -- 这是 Playwright 夹具文件，第二个回调参数按惯例叫 use，与 React Hook 无关。 */
import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

/*
 * Playwright 的 WebKit 在临时（非持久化）配置目录下无法把 Blob/File 写进 IndexedDB：
 * 事务以 UnknownError「Error preparing Blob/File data to be stored in object store」中止，
 * 笔记选图后 addLocalAsset 失败，图片块永远不插入。空白页面的最小复现证明这与产品代码、
 * 服务线程和夹具文件无关；换成持久化配置目录后同一写入成功。
 *
 * 只有 WebKit 换成持久化上下文，Chromium 等浏览器仍用 Playwright 原生 context/page 夹具。
 * 用户数据目录建在系统临时目录下并逐例删除，IndexedDB 与 Cookie 仍从空白开始；
 * 服务端数据库、媒体和日志继续由 global-setup 的本轮临时目录提供。
 */
const PROFILE_PREFIX = 'sthstart-notebook-webkit-profile-';

/** 只删除系统临时目录下、带本夹具前缀的一级目录，避免误删用户数据。 */
function isOwnedProfile(path: string) {
  const child = relative(resolve(tmpdir()), resolve(path));
  return child.startsWith(PROFILE_PREFIX) && !/[\\/]/.test(child);
}

export const test = base.extend<{ page: Page; context: BrowserContext }>({
  context: async ({ context, browserName, playwright, baseURL, headless }, use) => {
    if (browserName !== 'webkit') {
      await use(context);
      return;
    }

    const profile = await mkdtemp(join(tmpdir(), PROFILE_PREFIX));
    try {
      // 原生 context 只在 Chromium 等浏览器使用；WebKit 换成持久化上下文后先释放它，
      // 避免留下一个闲置的浏览器上下文。Playwright 对已关闭上下文的二次关闭是安全的。
      await context.close();
      // 与全局配置的桌面 Safari 项目一致；用例随后会显式设置 1440×900。
      const persistent = await playwright.webkit.launchPersistentContext(profile, {
        baseURL,
        headless,
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 2,
        reducedMotion: 'reduce',
      });
      try {
        await use(persistent);
      } finally {
        await persistent.close();
      }
    } finally {
      if (isOwnedProfile(profile)) {
        await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
      }
    }
  },
  /*
   * 持久化上下文启动时自带一个空白页，原生 page 夹具随后又开一页。这里关掉多出来的空白页，
   * 让用例始终只有一个页面，调度行为与普通上下文一致；该空白页本身没有加载应用。
   * 第二个 PUT 携带过期版本号是独立的真实保存竞态，由同步任务单独复现和修复。
   */
  page: async ({ page, context, browserName }, use) => {
    if (browserName === 'webkit') {
      for (const extra of context.pages()) {
        if (extra !== page && extra.url() === 'about:blank') await extra.close();
      }
    }
    await use(page);
  },
});
