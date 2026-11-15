import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const portal = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
const service = 'http://127.0.0.1:' + (process.env.E2E_SERVICE_PORT ?? 4200) + '/api/v1/admin';
const adminHeaders = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
const screenshotDirectory = join(process.cwd(), 'artifacts', 'visual-verification', 'model-settings');

test('model settings stays compact with populated routes on desktop and phone', async ({ context }) => {
  test.setTimeout(90_000);
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  const connectionId = `conn-visual-${suffix}`;
  const connectionName = `视觉验收供应商 ${suffix}`;
  const textId = `model-visual-text-${suffix}`;
  const longModelId = 'sample-reasoning/model-with-long-id-for-narrow-screen';
  const visionId = `model-visual-vision-${suffix}`;
  const fallbackId = `model-visual-fallback-${suffix}`;

  const createdConnection = await context.request.post(`${service}/connections`, {
    headers: adminHeaders,
    data: {
      id: connectionId,
      name: connectionName,
      kind: 'openai-compatible-text',
      baseUrl: `https://visual-${suffix}.example/v1`,
      timeoutMs: 60_000,
      headers: {},
      enabled: true,
    },
  });
  expect(createdConnection.status()).toBe(201);

  for (const model of [
    {
      id: textId,
      name: `视觉验收文本 ${suffix}`,
      modelId: longModelId,
      capabilities: ['text'],
      thinkingLevel: 'medium',
    },
    {
      id: visionId,
      name: `视觉验收看图 ${suffix}`,
      modelId: 'vision-large',
      capabilities: ['multimodal'],
      thinkingLevel: 'low',
    },
    {
      id: fallbackId,
      name: `视觉验收备用 ${suffix}`,
      modelId: 'text-fast',
      capabilities: ['text', 'multimodal'],
      thinkingLevel: 'off',
    },
  ]) {
    const created = await context.request.post(`${service}/models`, {
      headers: adminHeaders,
      data: {
        ...model,
        connectionId,
        contextLength: 128_000,
        maxOutputTokens: 8_192,
        timeoutMs: 45_000,
        enabled: true,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
  }

  for (const route of [
    { capability: 'text', primaryModelId: textId, fallbackModelIds: [fallbackId] },
    { capability: 'multimodal', primaryModelId: visionId, fallbackModelIds: [fallbackId] },
  ]) {
    const saved = await context.request.put(`${service}/model-routes`, {
      headers: adminHeaders,
      data: { scope: 'public', ...route, inheritPublicFallbacks: false },
    });
    expect(saved.status(), await saved.text()).toBe(201);
  }

  expect(
    (await context.request.post(`${portal}/api/auth/admin-session`, {
      headers: { origin: portal },
    })).ok(),
  ).toBe(true);
  await context.addInitScript(() => localStorage.setItem('sthstart_theme_id', 'dark-espresso'));
  mkdirSync(screenshotDirectory, { recursive: true });

  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/settings/public-services');
  const common = page.locator('section[aria-labelledby="common-models-title"]');
  await expect(common.getByLabel('主模型', { exact: true })).toHaveValue(textId);
  await expect(common.getByLabel('备用 1', { exact: true }).first()).toHaveValue(fallbackId);
  await expect(common.getByLabel('看图主模型', { exact: true })).toHaveValue(visionId);
  await expect(page.getByLabel(/temperature|top[_\s-]?p/i)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({
    path: join(screenshotDirectory, 'model-settings-1440-dark.png'),
    animations: 'disabled',
  });

  await page.setViewportSize({ width: 320, height: 750 });
  await page.reload();
  const textPrimary = common.getByLabel('主模型', { exact: true });
  await expect(textPrimary).toHaveValue(textId);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    'long configured model names must not widen the 320px page').toBeLessThanOrEqual(1);
  await textPrimary.press('Space');
  const longOption = page.locator('[data-ui-select-dropdown]').getByRole('option', { name: `视觉验收文本 ${suffix} — ${longModelId}`, exact: true });
  const label = longOption.locator('span').first();
  await expect(label).toBeVisible();
  expect(await label.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  await expect(longOption).toBeHidden();
  await expect(textPrimary).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('tab', { name: '模型', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({
    path: join(screenshotDirectory, 'model-settings-390-dark.png'),
    fullPage: true,
    animations: 'disabled',
  });

  await page.getByRole('button', { name: '管理', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '应用模型例外' });
  await expect(drawer).toBeVisible();
  const drawerBox = await drawer.boundingBox();
  expect(drawerBox).not.toBeNull();
  expect(drawerBox!.x).toBeGreaterThanOrEqual(0);
  expect(drawerBox!.x + drawerBox!.width).toBeLessThanOrEqual(391);
  await expect(
    drawer.getByRole('heading', { name: '应用模型例外' }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({
    path: join(screenshotDirectory, 'model-settings-390-drawer-dark.png'),
    animations: 'disabled',
  });

  const row = drawer.locator('#app-exception-linshe');
  const toggle = row.locator('button[aria-expanded]').first();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await row.getByLabel('文本模型', { exact: true }).click();
  const menu = page.locator('[data-ui-select-dropdown]');
  await expect(menu).toBeVisible();
  const menuBox = await menu.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(391);
  await page.screenshot({
    path: join(screenshotDirectory, 'model-settings-390-drawer-select-dark.png'),
    animations: 'disabled',
  });

  await page.keyboard.press('Escape');
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  await context.addInitScript(() => localStorage.setItem('sthstart_theme_id', 'light-paper'));
  await page.reload();
  await expect(page.getByRole('tab', { name: '模型', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({
    path: join(screenshotDirectory, 'model-settings-390-light.png'),
    fullPage: true,
    animations: 'disabled',
  });
});
