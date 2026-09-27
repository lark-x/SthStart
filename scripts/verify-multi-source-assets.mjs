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

  await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_01_character_library.png') });
  console.log('Saved verify_01_character_library.png');

  // Find a character or create/find "奥黛塔" or any character
  console.log('2. Finding or opening a character detail...');
  const firstCard = page.locator('article a').first();
  const hasCards = (await firstCard.count()) > 0;
  if (hasCards) {
    await firstCard.click();
  } else {
    await page.goto('http://localhost:9320/apps/characters/new', { waitUntil: 'networkidle' });
  }

  await page.waitForURL('**/apps/characters/**', { timeout: 10000 });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_02_character_editor.png') });
  console.log('Saved verify_02_character_editor.png');

  // Check if "多源获取头像与立绘" button is present
  const multiSourceBtn = page.locator('button:has-text("多源获取头像与立绘")');
  if (await multiSourceBtn.isVisible()) {
    console.log('3. Clicking "多源获取头像与立绘"...');
    await multiSourceBtn.click();
    await page.waitForTimeout(5000); // wait for probe

    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_03_multi_source_dialog.png') });
    console.log('Saved verify_03_multi_source_dialog.png');

    // If import button is enabled, click import
    const importBtn = page.locator('button:has-text("导入选中的资产")');
    if (await importBtn.isEnabled()) {
      console.log('4. Importing selected assets...');
      await importBtn.click();
      await page.waitForTimeout(3500);
      await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_04_assets_imported.png') });
      console.log('Saved verify_04_assets_imported.png');
    }
  }

  // 5. Navigate to Activity Studio
  console.log('5. Navigating to Activities...');
  await page.goto('http://localhost:9320/apps/activities', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const firstActivity = page.locator('article a, div a[href^="/apps/activities/"]').first();
  if ((await firstActivity.count()) > 0) {
    const href = await firstActivity.getAttribute('href');
    if (href && !href.includes('/new')) {
      console.log('6. Opening Activity Workspace:', href);
      await page.goto(`http://localhost:9320${href}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);

      await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_05_activity_workspace.png') });
      console.log('Saved verify_05_activity_workspace.png');

      const pickAssetBtn = page.locator('button:has-text("选头像/立绘")').first();
      if (await pickAssetBtn.isVisible()) {
        console.log('7. Clicking "选头像/立绘"...');
        await pickAssetBtn.click();
        await page.waitForTimeout(1500);

        await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_06_actor_asset_dialog.png') });
        console.log('Saved verify_06_actor_asset_dialog.png');
      }
    }
  }

  await browser.close();
  console.log('All verification steps completed!');
}

run().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
