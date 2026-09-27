import { chromium } from 'playwright';
import { resolve } from 'node:path';

const ARTIFACT_DIR = 'C:/Users/12938/.gemini/antigravity/brain/ab76a116-4d29-4147-9fd0-215e58a51794';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log('1. Navigating to Character Editor...');
  await page.goto('http://localhost:9320/apps/characters', { waitUntil: 'networkidle' });
  await page.locator('article a').first().click();
  await page.waitForURL('**/apps/characters/**', { timeout: 10000 });
  await page.waitForTimeout(1000);

  // Click multi source dialog
  console.log('2. Clicking 多源获取头像与立绘...');
  await page.locator('button:has-text("多源获取头像与立绘")').click();

  // Wait for candidates or empty state inside dialog
  console.log('3. Waiting for candidates inside dialog to load...');
  await page.locator('[role="dialog"] button:has-text("导入选中的资产")')
    .filter({ hasText: /\([1-9]\d*\)/ })
    .waitFor({ timeout: 25000 })
    .catch((e) => console.log('Wait for candidate count in button timed out:', e.message));

  await page.waitForTimeout(1000);
  await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_07_dialog_loaded.png') });
  console.log('Saved verify_07_dialog_loaded.png');

  // Check if we can import
  const importBtn = page.locator('button:has-text("导入选中的资产")');
  if (await importBtn.isEnabled()) {
    console.log('4. Clicking import...');
    await importBtn.click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_08_after_import.png') });
    console.log('Saved verify_08_after_import.png');
  } else {
    // Close dialog
    await page.locator('button:has-text("取消")').click();
  }

  // 5. Navigate to an activity
  console.log('5. Navigating to activities list...');
  await page.goto('http://localhost:9320/apps/activities', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const actLink = page.locator('a[href^="/apps/activities/"]').first();
  if (await actLink.count() > 0) {
    const href = await actLink.getAttribute('href');
    if (href && !href.includes('/new')) {
      console.log('6. Opening activity:', href);
      await page.goto(`http://localhost:9320${href}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);

      // Look for "选头像/立绘" button
      const pickBtn = page.locator('button:has-text("选头像/立绘")').first();
      if (await pickBtn.isVisible()) {
        console.log('7. Clicking 选头像/立绘...');
        await pickBtn.click();
        await page.waitForTimeout(1500);

        await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_09_actor_asset_picker.png') });
        console.log('Saved verify_09_actor_asset_picker.png');
      }
    }
  }

  await browser.close();
  console.log('Done!');
}

run().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
