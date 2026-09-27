import { chromium } from 'playwright';
import { resolve } from 'node:path';

const ARTIFACT_DIR = 'C:/Users/12938/.gemini/antigravity/brain/ab76a116-4d29-4147-9fd0-215e58a51794';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log('1. Navigating to Character Library...');
  await page.goto('http://localhost:9320/apps/characters', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  console.log('2. Finding 桑多涅 card...');
  const sandroneCard = page.locator('article', { hasText: '桑多涅' });
  if (await sandroneCard.count() > 0) {
    await sandroneCard.locator('a').first().click();
  } else {
    console.log('桑多涅 not found directly, clicking first card');
    await page.locator('article a').first().click();
  }

  await page.waitForURL('**/apps/characters/**', { timeout: 10000 });
  await page.waitForTimeout(1500);

  console.log('3. Clicking 多源获取头像与立绘 button...');
  await page.locator('button:has-text("多源获取头像与立绘")').click();

  console.log('4. Waiting for candidate assets in dialog...');
  await page.locator('[role="dialog"] button:has-text("导入选中的资产")')
    .filter({ hasText: /\([1-9]\d*\)/ })
    .waitFor({ timeout: 25000 });

  await page.waitForTimeout(2000);
  await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_bwiki_sandrone_dialog.png') });
  console.log('Saved verify_bwiki_sandrone_dialog.png');

  console.log('5. Clicking 导入选中的资产...');
  const importBtn = page.locator('[role="dialog"] button:has-text("导入选中的资产")');
  if (await importBtn.isEnabled()) {
    await importBtn.click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_bwiki_sandrone_imported.png') });
    console.log('Saved verify_bwiki_sandrone_imported.png');
  }

  await browser.close();
  console.log('Done!');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
