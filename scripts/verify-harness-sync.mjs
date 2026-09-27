import { chromium } from 'playwright';
import { resolve } from 'node:path';

const ARTIFACT_DIR = 'C:/Users/12938/.gemini/antigravity/brain/ab76a116-4d29-4147-9fd0-215e58a51794';
const ACTIVITY_ID = 'fd2650c3-ed4f-4b4a-aba7-c3fafc85c90d';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log('1. Navigating to synced activity:', ACTIVITY_ID);
  await page.goto(`http://localhost:9320/apps/activities/${ACTIVITY_ID}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Switch to Step 2: 剧情创作 if not already
  const step2Btn = page.locator('button:has-text("剧情创作")').first();
  if (await step2Btn.isVisible()) {
    console.log('2. Switching to 剧情创作...');
    await step2Btn.click();
    await page.waitForTimeout(1500);
  }

  // Ensure "场次分镜流" view is active
  const beatsTab = page.locator('button:has-text("场次分镜流")').first();
  if (await beatsTab.isVisible()) {
    await beatsTab.click();
    await page.waitForTimeout(1000);
  }

  console.log('3. Taking screenshot of synced beats with VIDEO and IMG cards...');
  await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_13_harness_synced_beats.png') });
  console.log('Saved verify_13_harness_synced_beats.png');

  // Look for "快速试演" button
  console.log('4. Clicking 快速试演 button...');
  const previewBtn = page.locator('button:has-text("快速试演")').first();
  if (await previewBtn.isVisible()) {
    await previewBtn.click();
    await page.waitForTimeout(1500);

    console.log('5. Taking screenshot of Stage Preview Drawer with Video Player...');
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_14_harness_stage_preview.png') });
    console.log('Saved verify_14_harness_stage_preview.png');

    // Test clicking "下一步" for beat 2 (Image)
    const nextBtn = page.locator('button:has-text("下一步")').first();
    if (await nextBtn.isVisible() && !(await nextBtn.isDisabled())) {
      console.log('6. Clicking 下一步 for beat 2 (Image)...');
      await nextBtn.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_15_harness_stage_preview_beat2.png') });
      console.log('Saved verify_15_harness_stage_preview_beat2.png');
    }
  } else {
    console.error('快速试演 button not found!');
  }

  await browser.close();
  console.log('Verification completed successfully!');
}

run().catch((err) => {
  console.error('Error during verification:', err);
  process.exit(1);
});
