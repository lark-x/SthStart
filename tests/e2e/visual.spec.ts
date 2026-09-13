import { expect, test } from '@playwright/test';

let browserErrors: string[] = [];
let expectedAdminSessionProbes = 0;

test.beforeEach(({ page }) => {
  browserErrors = [];
  expectedAdminSessionProbes = 0;
  page.on('response', (response) => {
    if (response.url().includes('/api/auth/admin-session') && response.status() === 401) {
      expectedAdminSessionProbes += 1;
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    browserErrors.push(`pageerror: ${error.message}`);
  });
});

test.afterEach(() => {
  const unexpectedErrors = browserErrors.filter((message) => {
    if (message === 'console: Failed to load resource: the server responded with a status of 401 (Unauthorized)' && expectedAdminSessionProbes > 0) {
      expectedAdminSessionProbes -= 1;
      return false;
    }
    return true;
  });
  expect(unexpectedErrors, unexpectedErrors.join('\n')).toEqual([]);
});

const screenshotOptions = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  mask: undefined,
  /*
   * 工作台的运行状态条会持续轮询并触发重渲染，全量并发跑时 CPU 争用明显。
   * 默认 5 秒的“两帧一致”窗口不够，放宽到 15 秒；像素比较本身仍然生效。
   */
  timeout: 15_000,
};

/**
 * 工作台两块面板的内容来自真实数据库，且行数由组件按 limit 截断。
 * 截图前先等载入态结束并确认行数达到上限，画面尺寸才由固定行数决定；
 * 行文本本身以 data-visual-dynamic 遮罩，避免测试库中带随机后缀的标题污染基线。
 */
async function waitForDashboardSettled(page: import('@playwright/test').Page) {
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('recent-work-list').getByRole('listitem')).toHaveCount(8, { timeout: 15_000 });
  await expect(page.getByTestId('upcoming-schedule-list').getByRole('listitem')).toHaveCount(5, { timeout: 15_000 });
}

/** 页面本身不得横向溢出；失败时直接给出超宽元素，而不是只报像素差异。 */
async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth + 1) return null;
    const offenders = Array.from(document.querySelectorAll('*'))
      .filter((el) => el.getBoundingClientRect().width > doc.clientWidth + 1)
      .map((el) => `${el.tagName}.${(el.className ?? '').toString().slice(0, 60)}`)
      .slice(0, 5)
      .join(', ');
    return `${doc.scrollWidth} > ${doc.clientWidth}：${offenders}`;
  });
  expect(overflow).toBeNull();
}

test('portal desktop visual baseline', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '全部应用' })).toBeVisible();
  await waitForDashboardSettled(page);
  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot('portal-desktop.png', {
    ...screenshotOptions,
    fullPage: true,
    mask: [page.locator('[data-visual-dynamic]')],
    maskColor: '#f5f6f8',
  });
});

test('portal mobile visual baseline', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '全部应用' })).toBeVisible();
  await waitForDashboardSettled(page);
  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot('portal-mobile.png', {
    ...screenshotOptions,
    fullPage: true,
    mask: [page.locator('[data-visual-dynamic]')],
    maskColor: '#f5f6f8',
  });
});

test('control center overview visual baseline', async ({ page }) => {
  await page.goto('/settings/control-center');
  await expect(page.getByRole('heading', { name: '邻舍运行栈' })).toBeVisible();
  await expect(page).toHaveScreenshot('control-center-overview.png', {
    ...screenshotOptions,
    fullPage: false,
    mask: [page.locator('[data-visual-dynamic]')],
    maskColor: '#f5f6f8',
  });
});

test('control center logs visual baseline', async ({ page }) => {
  await page.goto('/settings/control-center?tab=logs');
  await expect(page.getByPlaceholder('搜索日志内容…')).toBeVisible();
  await expect(page.getByText('LIVE STREAM')).toBeVisible();
  await expect(page).toHaveScreenshot('control-center-logs.png', {
    ...screenshotOptions,
    fullPage: true,
    mask: [page.locator('[data-visual-dynamic]')],
    maskColor: '#18201d',
  });
});

test('character editor visual baseline', async ({ page }) => {
  await page.goto('/apps/characters/new');
  // 分区是 tablist 里的 tab，不是 heading；旧的 heading 断言在 V2 编辑器上已失效。
  await expect(page.getByRole('tab', { name: '身份与经历' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '身份与人设' })).toBeVisible();
  await expect(page).toHaveScreenshot('character-editor.png', {
    ...screenshotOptions,
    fullPage: true,
  });
});

test('notebook visual baseline', async ({ page }) => {
  await page.goto('/apps/notebook/new');
  await expect(page.getByPlaceholder('输入笔记标题…')).toBeVisible();
  await expect(page).toHaveScreenshot('notebook.png', {
    ...screenshotOptions,
    fullPage: true,
  });
});

test('narrative visual baseline', async ({ page }) => {
  await page.goto('/apps/narrative');
  await page.getByRole('tab', { name: '数据源与导入' }).click();
  await expect(page.getByText('规范化剧情 JSON 工作台')).toBeVisible();
  /*
   * 连接器来自异步查询，初始是空数组。不等待就会截到“还没有连接器卡片”的
   * 半加载状态，让基线随请求时序漂移。这里等两张卡片都渲染出来再截图。
   */
  await expect(page.getByTestId('narrative-connectors').locator('> div')).toHaveCount(2, { timeout: 15_000 });
  await expect(page).toHaveScreenshot('narrative.png', {
    ...screenshotOptions,
    fullPage: true,
  });
});
