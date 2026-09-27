import { chromium } from 'playwright';
import { resolve } from 'node:path';

const ARTIFACT_DIR = 'C:/Users/12938/.gemini/antigravity/brain/ab76a116-4d29-4147-9fd0-215e58a51794';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log('1. Navigating to activities list...');
  await page.goto('http://localhost:9320/apps/activities', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const actLinks = page.locator('a[href^="/apps/activities/"]:not([href*="/new"])');
  const count = await actLinks.count();
  console.log(`Found ${count} existing activities`);
  if (count === 0) {
    console.error('No existing activity found!');
    await browser.close();
    return;
  }

  const href = await actLinks.first().getAttribute('href');
  console.log('2. Opening activity:', href);
  await page.goto(`http://localhost:9320${href}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Switch to Step 2: 剧情创作 if not already active
  console.log('3. Clicking Step 2: 剧情创作...');
  const step2Btn = page.locator('button:has-text("剧情创作")').first();
  if (await step2Btn.isVisible()) {
    await step2Btn.click();
    await page.waitForTimeout(1500);
  }

  // Ensure "场次分镜流" view is active
  const beatsTab = page.locator('button:has-text("场次分镜流")').first();
  if (await beatsTab.isVisible()) {
    await beatsTab.click();
    await page.waitForTimeout(1000);
  }

  // Click the upgrade/convert button
  const upgradeBtn = page.locator('button:has-text("升级为场次分镜")').first();
  if (await upgradeBtn.isVisible()) {
    console.log('4. Clicking 将现有的剧情升级为场次分镜...');
    await upgradeBtn.click();
    await page.waitForTimeout(1500);
  }

  console.log('5. Taking screenshot of Scene & Beat Flow with converted beats...');
  await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_10_scene_beat_flow.png') });
  console.log('Saved verify_10_scene_beat_flow.png');

  // Look for "快速试演" button
  console.log('6. Looking for 快速试演 button...');
  const previewBtn = page.locator('button:has-text("快速试演")').first();
  if (await previewBtn.isVisible()) {
    console.log('Clicking 快速试演...');
    await previewBtn.click();
    await page.waitForTimeout(2000);

    console.log('7. Taking screenshot of Stage Preview Drawer...');
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_11_stage_preview_drawer.png') });
    console.log('Saved verify_11_stage_preview_drawer.png');

    // Test clicking "下一幕"
    const nextBtn = page.locator('button:has-text("下一幕")').first();
    if (await nextBtn.isVisible() && !(await nextBtn.isDisabled())) {
      console.log('Clicking 下一幕...');
      await nextBtn.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_12_stage_preview_playing.png') });
      console.log('Saved verify_12_stage_preview_playing.png');
    }
  } else {
    console.log('快速试演 button not found!');
  }

  await browser.close();
  console.log('Verification completed successfully!');
}

run().catch((err) => {
  console.error('Error during verification:', err);
  process.exit(1);
});
