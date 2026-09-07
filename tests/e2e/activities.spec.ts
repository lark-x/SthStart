import { expect, test } from '@playwright/test';

let browserErrors: string[] = [];

test.beforeEach(({ page }) => {
  browserErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    browserErrors.push(`pageerror: ${error.message}`);
  });
});

test.afterEach(() => {
  const unexpectedErrors = browserErrors.filter((msg) => {
    if (msg.includes('401') || msg.includes('net::ERR_')) return false;
    return true;
  });
  expect(unexpectedErrors, unexpectedErrors.join('\n')).toEqual([]);
});

test('Activity Studio: full navigation, wizard creation and workstation tabs', async ({ page }) => {
  // 1. Visit Activities list page
  await page.goto('/apps/activities');
  await expect(page.getByRole('heading', { name: '活动工作室' })).toBeVisible();
  await expect(page.getByRole('button', { name: '导入活动' })).toBeVisible();
  await expect(page.getByRole('link', { name: '新建活动' })).toBeVisible();

  // 2. Click New Activity
  await page.getByRole('link', { name: '新建活动' }).click();
  await expect(page).toHaveURL(/\/apps\/activities\/new/);
  await expect(page.getByRole('heading', { name: '新建活动' })).toBeVisible();

  // 3. Fill creation wizard form
  await page.fill('input[placeholder*="海边营地烧烤"]', '海边露营自动化测试');
  await page.fill('input[placeholder*="夏日傍晚"]', '海风与晚餐合照');

  // Verify at least 2 stages are present
  await expect(page.getByText('第一阶段：到达与准备')).toBeVisible();
  await expect(page.getByText('第二阶段：高潮与留念')).toBeVisible();

  // Verify actor snapshot exists
  await expect(page.getByText('旅行者')).toBeVisible();

  // Submit and enter workspace
  await page.click('button:has-text("创建并进入工作室")');

  // 4. Verify Studio Workspace Shell
  await expect(page).toHaveURL(/\/apps\/activities\/[a-f0-9-]+/);
  await expect(page.getByText('海边露营自动化测试')).toBeVisible();
  await expect(page.getByText(/Head v1/)).toBeVisible();
  await expect(page.getByText(/草稿已就绪/)).toBeVisible();

  // 5. Test 4 Workstation Tabs
  // Tab 1: Records (Chat & Moments)
  await expect(page.getByRole('button', { name: /群聊记录/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /朋友圈动态/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /阶段事实状态/ })).toBeVisible();

  // Tab 2: Settings & Stages
  await page.click('button:has-text("活动与阶段设定")');
  await expect(page.getByText('活动基本属性')).toBeVisible();
  await expect(page.getByText('活动阶段设定')).toBeVisible();

  // Tab 3: Media Workstation
  await page.click('button:has-text("媒体镜头工作台")');
  await expect(page.getByText('媒体镜头槽位与选片工作台')).toBeVisible();
  await expect(page.getByRole('button', { name: '新增镜头槽位' })).toBeVisible();

  // Tab 4: Playback & Preview
  await page.click('button:has-text("回放编排与预览")');
  await expect(page.getByText('回放编排与设备模拟预览')).toBeVisible();
  await expect(page.getByText('观众视角：')).toBeVisible();
  await expect(page.getByRole('button', { name: '自动生成编排' })).toBeVisible();

  // 6. Test Drawers & Modals
  // Checkpoints drawer
  await page.click('button:has-text("版本回溯")');
  await expect(page.getByText('版本回溯与检查点快照')).toBeVisible();
  await page.click('button:has-text("关闭")');

  // Export modal
  await page.click('button:has-text("导出工程")');
  await expect(page.getByText('导出离线包与可渲染工程')).toBeVisible();
  await expect(page.getByText('完整自包含 HyperFrames 工程包')).toBeVisible();
  await page.click('button:has-text("取消")');
});
