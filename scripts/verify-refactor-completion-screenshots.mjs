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

  for (const res of resolutions) {
    const page = await browser.newPage({
      viewport: { width: res.width, height: res.height },
    });

    console.log(`[${res.name}] 1. 验证公共服务 - 服务连接...`);
    await page.goto('http://127.0.0.1:4173/settings/public-services?tab=connections', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: resolve(ARTIFACT_DIR, `completion_connections_${res.name}.png`),
      fullPage: false,
    });

    console.log(`[${res.name}] 2. 验证公共服务 - 文本模型...`);
    await page.goto('http://127.0.0.1:4173/settings/public-services?tab=text-models', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: resolve(ARTIFACT_DIR, `completion_text_models_${res.name}.png`),
      fullPage: false,
    });

    // 打开测试抽屉并截图
    const testButton = page.locator('button', { hasText: '测试推理' }).first();
    if (await testButton.isVisible()) {
      await testButton.click();
      await page.waitForTimeout(600);
      await page.screenshot({
        path: resolve(ARTIFACT_DIR, `completion_test_drawer_${res.name}.png`),
        fullPage: false,
      });

      // 关闭抽屉
      const closeBtn = page.locator('button[aria-label="关闭"]').or(page.locator('button:has(svg.lucide-x)')).first();
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
        await page.waitForTimeout(400);
      }
    }

    console.log(`[${res.name}] 3. 验证公共服务 - 用途绑定...`);
    await page.goto('http://127.0.0.1:4173/settings/public-services?tab=purposes', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: resolve(ARTIFACT_DIR, `completion_purposes_${res.name}.png`),
      fullPage: false,
    });

    console.log(`[${res.name}] 4. 验证生成设置...`);
    await page.goto('http://127.0.0.1:4173/settings/generation', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: resolve(ARTIFACT_DIR, `completion_generation_${res.name}.png`),
      fullPage: false,
    });

    // 5. 验证统一任务中心抽屉
    console.log(`[${res.name}] 5. 验证任务中心...`);
    const taskCenterBtn = page.locator('button[aria-label="打开任务中心"]').or(page.locator('button:has(svg.lucide-list-todo)')).first();
    if (await taskCenterBtn.isVisible()) {
      await taskCenterBtn.click();
      await page.waitForTimeout(800);
      await page.screenshot({
        path: resolve(ARTIFACT_DIR, `completion_task_center_${res.name}.png`),
        fullPage: false,
      });
    }

    await page.close();
  }

  await browser.close();
  console.log('所有截图采集完成喵！');
}

main().catch((err) => {
  console.error('截图脚本执行失败:', err);
  process.exit(1);
});
