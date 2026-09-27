import { chromium } from 'playwright';
import { resolve } from 'node:path';

const ARTIFACT_DIR = 'C:/Users/12938/.gemini/antigravity/brain/ab76a116-4d29-4147-9fd0-215e58a51794';

async function run() {
  console.log('--- Starting Modern Studio & Beat Generation Verification ---');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // 1. Verify Character Library
  console.log('1. Navigating to Characters page...');
  await page.goto('http://localhost:9320/apps/characters', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_16_character_library_fixed.png') });
  console.log('Saved verify_16_character_library_fixed.png');

  // 2. Open Activities
  console.log('2. Navigating to Activities list...');
  await page.goto('http://localhost:9320/apps/activities', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const actLinks = page.locator('a[href^="/apps/activities/"]:not([href*="/new"])');
  const count = await actLinks.count();
  if (count === 0) {
    console.error('No activities found!');
    await browser.close();
    return;
  }
  const href = await actLinks.first().getAttribute('href');
  console.log('Opening first activity:', href);
  await page.goto(`http://localhost:9320${href}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // 3. Switch to Step 2 (剧情创作) if not active
  const scriptPill = page.locator('nav[aria-label="流水线阶段"] button:has-text("剧情创作")').first();
  if (await scriptPill.isVisible()) {
    console.log('3. Clicking modern pipeline pill: 剧情创作...');
    await scriptPill.click();
    await page.waitForTimeout(1500);
  }

  // Ensure "场次分镜流" view is selected
  const beatsTab = page.locator('button:has-text("场次分镜流")').first();
  if (await beatsTab.isVisible()) {
    await beatsTab.click();
    await page.waitForTimeout(1000);
  }

  // If there's an upgrade button, click it to ensure beats exist
  const upgradeBtn = page.locator('button:has-text("升级为场次分镜")').first();
  if (await upgradeBtn.isVisible()) {
    console.log('Clicking upgrade to scene beats...');
    await upgradeBtn.click();
    await page.waitForTimeout(1500);
  }

  // Take screenshot of modern studio layout
  console.log('4. Taking screenshot of Modern Studio workspace (56px stage rail + top pills)...');
  await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_17_modern_studio_layout.png') });
  console.log('Saved verify_17_modern_studio_layout.png');

  // 5. Test Advanced Tuning Drawer on Beat 1
  console.log('5. Clicking 微调 button on Beat 1...');
  const tuneBtn = page.locator('button:has-text("微调")').first();
  if (await tuneBtn.isVisible()) {
    await tuneBtn.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_19_tuning_drawer.png') });
    console.log('Saved verify_19_tuning_drawer.png');
  }

  // 6. Scroll down to Beat 2 (砂糖)
  console.log('6. Scrolling to Beat 2 (砂糖)...');
  const beat2 = page.locator('div:has-text("砂糖 (炼金术助手)")').first();
  await beat2.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  // Click 一键生成画面 on Beat 2
  const genBtnBeat2 = page.locator('button:has-text("一键生成画面")').first();
  if (await genBtnBeat2.isVisible()) {
    console.log('Found 一键生成画面 on Beat 2, clicking...');
    await genBtnBeat2.click();
    // Wait for mock/comfy render and state update
    await page.waitForTimeout(3000);
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_18_beat_generation_result.png') });
    console.log('Saved verify_18_beat_generation_result.png');
  }

  // 7. Hover over Stage Rail chip 01 to show tooltip
  console.log('7. Hovering over left Stage Rail chip 01...');
  const railChip = page.locator('nav[aria-label="场次导轨导航"] button:has-text("01")').first();
  if (await railChip.isVisible()) {
    await railChip.hover();
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_20_stage_rail_tooltip.png') });
    console.log('Saved verify_20_stage_rail_tooltip.png');
  }

  console.log('--- Verification Complete ---');
  await browser.close();
}

run().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
