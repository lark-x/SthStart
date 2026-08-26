import { expect, test } from '@playwright/test';

test('portal exposes its primary applications', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/SthStart/);
  await expect(page.getByRole('link', { name: '打开笔记' })).toBeVisible();
  await expect(page.getByRole('link', { name: '进入档案' })).toBeVisible();
});

test('local admin session opens the control center', async ({ page }) => {
  await page.goto('/settings/control-center');
  await expect(page.getByRole('heading', { name: '邻舍运行栈' })).toBeVisible();
  await expect(page.getByText('正在加载控制中心…')).toHaveCount(0);
});

test('public services creates, discovers, clones, and assigns application models', async ({ page }) => {
  const suffix = Date.now().toString(36);
  const profileId = `model-${suffix}`;
  const cloneId = `model-copy-${suffix}`;
  const appId = `writer-${suffix}`;
  await page.route('**/api/admin/llm/models/discover', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: ['text-model', 'vision-model'] }) }));
  await page.goto('/settings/public-services');
  await expect(page.getByRole('heading', { name: '公共模型' })).toBeVisible();
  const editor = page.locator('form.llm-editor');
  await editor.getByLabel('配置 ID').fill(profileId);
  await editor.getByLabel('显示名称').fill(`测试模型 ${suffix}`);
  await editor.getByLabel('API Base URL').fill('https://provider.example/v1');
  await editor.getByRole('button', { name: '获取模型' }).click();
  await expect(page.getByText('已获取 2 个模型')).toBeVisible();
  await editor.getByLabel('模型 ID').fill('vision-model');
  await editor.getByLabel(/多模态/).check();
  await editor.getByRole('button', { name: '保存模型配置' }).click();
  await expect(page.getByText(`测试模型 ${suffix}`).first()).toBeVisible();

  const sourceCard = page.locator('.model-card').filter({ hasText: `测试模型 ${suffix}` });
  await sourceCard.getByRole('button', { name: '复制配置' }).click();
  await editor.getByLabel('配置 ID').fill(cloneId);
  await editor.getByLabel('显示名称').fill(`测试副本 ${suffix}`);
  await editor.getByLabel('模型 ID').fill('text-model');
  await editor.getByRole('button', { name: '创建独立副本' }).click();
  await expect(page.getByText(`测试副本 ${suffix}`).first()).toBeVisible();

  const appForm = page.locator('form').filter({ has: page.getByPlaceholder('应用 ID，例如 my-app') });
  await appForm.getByPlaceholder('应用 ID，例如 my-app').fill(appId);
  await appForm.getByPlaceholder('应用名称').fill(`测试应用 ${suffix}`);
  await appForm.getByRole('button', { name: '创建应用令牌' }).click();
  const assignment = page.locator('form.assignment-card').filter({ hasText: `测试应用 ${suffix}` });
  await assignment.getByLabel('文本模型').selectOption(cloneId);
  await assignment.getByLabel('多模态模型').selectOption(profileId);
  await assignment.getByRole('button', { name: '保存应用选择' }).click();
  await expect(page.getByText('应用的生效模型已更新。')).toBeVisible();
});
