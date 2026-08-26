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
};

test('portal desktop visual baseline', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '已接入应用' })).toBeVisible();
  await expect(page).toHaveScreenshot('portal-desktop.png', {
    ...screenshotOptions,
    fullPage: true,
    mask: [page.locator('[data-visual-dynamic]')],
    maskColor: '#f4f0e7',
  });
});

test('portal mobile visual baseline', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '已接入应用' })).toBeVisible();
  await expect(page).toHaveScreenshot('portal-mobile.png', {
    ...screenshotOptions,
    fullPage: true,
    mask: [page.locator('[data-visual-dynamic]')],
    maskColor: '#f4f0e7',
  });
});

test('control center overview visual baseline', async ({ page }) => {
  await page.goto('/settings/control-center');
  await expect(page.getByRole('heading', { name: '邻舍运行栈' })).toBeVisible();
  await expect(page).toHaveScreenshot('control-center-overview.png', {
    ...screenshotOptions,
    fullPage: true,
    mask: [page.locator('[data-visual-dynamic]')],
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
  await expect(page.getByRole('heading', { name: '身份与经历' })).toBeVisible();
  await expect(page).toHaveScreenshot('character-editor.png', {
    ...screenshotOptions,
    fullPage: true,
  });
});

test('notebook visual baseline', async ({ page }) => {
  await page.goto('/apps/notebook/new');
  await expect(page.getByPlaceholder('给这一页一个标题…')).toBeVisible();
  await expect(page).toHaveScreenshot('notebook.png', {
    ...screenshotOptions,
    fullPage: true,
  });
});

test('narrative visual baseline', async ({ page }) => {
  await page.goto('/apps/narrative');
  await page.getByRole('button', { name: '数据源与导入' }).click();
  await expect(page.getByText('规范化剧情 JSON 工作台')).toBeVisible();
  await expect(page).toHaveScreenshot('narrative.png', {
    ...screenshotOptions,
    fullPage: true,
  });
});
