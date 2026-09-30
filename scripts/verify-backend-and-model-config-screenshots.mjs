import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

const ARTIFACT_DIR = '/Users/watermelon/.gemini/antigravity/brain/4a15b53d-7087-4e8d-8c7a-28856f59d332';

async function main() {
  const browser = await chromium.launch({ headless: true });

  const resolutions = [
    { name: '1440', width: 1440, height: 900 },
    { name: '1280', width: 1280, height: 800 },
    { name: '390', width: 390, height: 844 },
  ];

  // 1. 测试各尺寸下的服务连接与模型配置页面
  for (const res of resolutions) {
    const page = await browser.newPage({
      viewport: { width: res.width, height: res.height },
    });

    console.log(`Verifying /settings/public-services at ${res.name}...`);
    await page.goto('http://127.0.0.1:4173/settings/public-services', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // 默认页签：服务连接
    await page.screenshot({
      path: resolve(ARTIFACT_DIR, `phase2_public_services_connections_${res.name}.png`),
      fullPage: false,
    });

    // 切换到文本模型
    const textTab = page.locator('button', { hasText: '文本模型' }).first();
    if (await textTab.isVisible()) {
      await textTab.click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: resolve(ARTIFACT_DIR, `phase2_public_services_text_models_${res.name}.png`),
        fullPage: false,
      });
    }

    // 切换到绘图模型与引擎
    const imageTab = page.locator('button', { hasText: '绘图模型与引擎' }).first();
    if (await imageTab.isVisible()) {
      await imageTab.click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: resolve(ARTIFACT_DIR, `phase2_public_services_image_models_${res.name}.png`),
        fullPage: false,
      });
    }

    // 切换到用途绑定
    const purposesTab = page.locator('button', { hasText: '用途绑定' }).first();
    if (await purposesTab.isVisible()) {
      await purposesTab.click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: resolve(ARTIFACT_DIR, `phase2_public_services_purposes_${res.name}.png`),
        fullPage: false,
      });
    }

    // 切换到其他服务
    const othersTab = page.locator('button', { hasText: '其他服务' }).first();
    if (await othersTab.isVisible()) {
      await othersTab.click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: resolve(ARTIFACT_DIR, `phase2_public_services_others_${res.name}.png`),
        fullPage: false,
      });
    }

    // 2. 检查 /settings/generation 页面
    console.log(`Verifying /settings/generation at ${res.name}...`);
    await page.goto('http://127.0.0.1:4173/settings/generation', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: resolve(ARTIFACT_DIR, `phase3_generation_settings_${res.name}.png`),
      fullPage: false,
    });

    await page.close();
  }

  await browser.close();
  console.log('All screenshots captured successfully!');
}

main().catch((err) => {
  console.error('Screenshot verification failed:', err);
  process.exit(1);
});
