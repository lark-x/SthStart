import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

const ARTIFACT_DIR = 'C:/Users/12938/.gemini/antigravity/brain/42d31ee0-4479-41bb-9369-11750b3efbc9';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('console', msg => console.log(`[PAGE LOG]: ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => console.log(`[PAGE ERROR]: ${err.message}`));

  console.log('Navigating to http://localhost:9320/apps/activities...');
  await page.goto('http://localhost:9320/apps/activities', { waitUntil: 'networkidle' });

  const enterLink = await page.$('a:has-text("阿贝多的生日聚会")') || await page.$('a:has-text("进入")');
  if (!enterLink) {
    console.error('No activity link found!');
    await browser.close();
    return;
  }

  const href = await enterLink.getAttribute('href');
  console.log(`Navigating to activity detail: ${href}`);
  await page.goto(`http://localhost:9320${href}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Switch to "2. 剧本分镜" if not already selected
  const scriptTab = await page.$('button:has-text("2. 剧本分镜")');
  if (scriptTab) {
    console.log('Clicking 2. 剧本分镜 tab...');
    await scriptTab.click();
    await page.waitForTimeout(1000);
  }

  // 1. Screenshot of default compact rail + 4:6 ratio layout
  const defaultPath = resolve(ARTIFACT_DIR, 'storyboard_upgraded_default.png');
  await page.screenshot({ path: defaultPath });
  console.log(`1. Saved upgraded default screenshot to: ${defaultPath}`);

  // 2. Click left stage rail expand toggle button (title="展开分幕大纲")
  const expandBtn = await page.$('button[title*="展开"]') || await page.$('button:has-text("展开")');
  if (expandBtn) {
    console.log('Expanding left stage rail...');
    await expandBtn.click();
    await page.waitForTimeout(600);
    const expandedPath = resolve(ARTIFACT_DIR, 'storyboard_left_expanded.png');
    await page.screenshot({ path: expandedPath });
    console.log(`2. Saved left expanded screenshot to: ${expandedPath}`);
  }

  // 3. Click first beat card in timeline to focus and inspect
  const firstBeatCard = await page.$('div[role="button"][tabindex="0"]');
  if (firstBeatCard) {
    console.log('Selecting first beat card...');
    await firstBeatCard.click();
    await page.waitForTimeout(600);
  }

  // Also toggle Img2Img console
  const img2imgToggle = await page.$('button:has-text("图生图/参考图")') || await page.$('button:has-text("图生图修正")');
  if (img2imgToggle) {
    console.log('Opening Img2Img redraw console...');
    await img2imgToggle.click();
    await page.waitForTimeout(500);
    const img2imgPath = resolve(ARTIFACT_DIR, 'storyboard_img2img_open.png');
    await page.screenshot({ path: img2imgPath });
    console.log(`Saved Img2Img open screenshot to: ${img2imgPath}`);
  }

  const inspectorPath = resolve(ARTIFACT_DIR, 'storyboard_beat_inspector.png');
  await page.screenshot({ path: inspectorPath });
  console.log(`3. Saved beat inspector screenshot to: ${inspectorPath}`);

  // 4. Test clicking "+ 新增下一幕" in the left rail
  const addStageBtn = await page.$('button:has-text("新增下一幕")') || await page.$('button[title*="新增下一幕"]');
  if (addStageBtn) {
    console.log('Clicking + 新增下一幕...');
    await addStageBtn.click();
    await page.waitForTimeout(1000);
    const addedStagePath = resolve(ARTIFACT_DIR, 'storyboard_new_stage_added.png');
    await page.screenshot({ path: addedStagePath });
    console.log(`4. Saved new stage added screenshot to: ${addedStagePath}`);
  }

  await browser.close();
  console.log('Screenshots completed successfully!');
}

main().catch(err => {
  console.error('Error in screenshot script:', err);
  process.exit(1);
});
