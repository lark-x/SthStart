import { chromium } from 'playwright';
import { resolve } from 'node:path';

const ARTIFACT_DIR = 'C:/Users/12938/.gemini/antigravity/brain/ab76a116-4d29-4147-9fd0-215e58a51794';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:9320/apps/activities/fd2650c3-ed4f-4b4a-aba7-c3fafc85c90d');
  await page.waitForTimeout(2000);

  console.log('Scrolling container down...');
  await page.locator('main div.overflow-y-auto').first().evaluate(el => { el.scrollTop = 500; });
  await page.waitForTimeout(600);

  const rerollBtns = page.locator('button:has-text("重抽")');
  const count = await rerollBtns.count();
  console.log(`Found ${count} 重抽 buttons, clicking the second one (Beat 2)...`);
  if (count >= 2) {
    await rerollBtns.nth(1).click();
    console.log('Clicked 重抽 on Beat 2, waiting for render...');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_24_beat2_rerolled.png') });
    console.log('Saved verify_24_beat2_rerolled.png');
  }

  await browser.close();
}

main().catch(console.error);
