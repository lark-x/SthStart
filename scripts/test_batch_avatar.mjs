import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

const ARTIFACT_DIR = 'C:/Users/12938/.gemini/antigravity/brain/ab76a116-4d29-4147-9fd0-215e58a51794';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('console', msg => console.log(`[PAGE LOG]: ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => console.log(`[PAGE ERROR]: ${err.message}`));

  console.log('1. Navigating to http://localhost:9320/apps/characters...');
  await page.goto('http://localhost:9320/apps/characters', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // 1. Screenshot library page with "批量获取头像" button
  await page.screenshot({ path: resolve(ARTIFACT_DIR, 'batch_avatar_01_library.png'), fullPage: false });
  console.log('Saved batch_avatar_01_library.png');

  // 2. Click "批量获取头像"
  console.log('2. Clicking 批量获取头像 button...');
  const batchBtn = await page.getByRole('button', { name: /批量获取头像/ });
  if (batchBtn) {
    await batchBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'batch_avatar_02_dialog_open.png'), fullPage: false });
    console.log('Saved batch_avatar_02_dialog_open.png');

    // 3. Click "开始获取"
    console.log('3. Clicking 开始获取 button...');
    const startBtn = await page.getByRole('button', { name: '开始获取' });
    await startBtn.click();

    // Wait for the completion (either '完成' button appears or timeout 60s)
    console.log('4. Waiting for batch matching to finish...');
    await page.waitForSelector('button:has-text("完成")', { timeout: 60000 });
    await page.waitForTimeout(1000);

    // Screenshot dialog results
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'batch_avatar_03_dialog_result.png'), fullPage: false });
    console.log('Saved batch_avatar_03_dialog_result.png');

    // 4. Click "完成"
    console.log('5. Clicking 完成 button...');
    const finishBtn = await page.getByRole('button', { name: '完成' });
    await finishBtn.click();
    await page.waitForTimeout(2000);

    // Screenshot updated character library
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'batch_avatar_04_library_updated.png'), fullPage: false });
    console.log('Saved batch_avatar_04_library_updated.png');
  } else {
    console.error('批量获取头像 button not found!');
  }

  await browser.close();
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
