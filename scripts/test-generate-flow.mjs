import { chromium } from 'playwright';
import { resolve } from 'node:path';

const ARTIFACT_DIR = 'C:/Users/12938/.gemini/antigravity/brain/ab76a116-4d29-4147-9fd0-215e58a51794';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('BROWSER PAGEERROR:', err));
  page.on('requestfailed', req => console.log('REQ FAILED:', req.url(), req.failure()?.errorText));
  page.on('dialog', async dialog => {
    console.log('BROWSER DIALOG:', dialog.type(), dialog.message());
    await dialog.dismiss();
  });
  page.on('response', async res => {
    if (res.status() >= 400) {
      console.log('HTTP ERROR:', res.status(), res.url());
    }
    if (res.url().includes('generate-beat-media')) {
      console.log('MEDIA RES:', res.status(), res.url());
      try {
        const body = await res.text();
        console.log('MEDIA BODY:', body);
      } catch (e) {
        console.log('Could not read body:', e);
      }
    }
  });
  await page.goto('http://localhost:9320/apps/activities/fd2650c3-ed4f-4b4a-aba7-c3fafc85c90d');
  await page.waitForTimeout(2000);

  const tuneBtn = page.locator('button:has-text("微调")').first();
  if (await tuneBtn.isVisible()) {
    console.log('1. Opening tune drawer...');
    await tuneBtn.click();
    await page.waitForTimeout(600);

    const submitBtn = page.locator('button:has-text("立即生成")').first();
    console.log('2. Clicking 立即生成...');
    await submitBtn.click();

    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_21_generating_progress.png') });
    console.log('Saved verify_21_generating_progress.png');

    await page.waitForTimeout(6000);
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'verify_22_generated_done.png') });
    console.log('Saved verify_22_generated_done.png');
  }

  await browser.close();
}

main().catch(console.error);
