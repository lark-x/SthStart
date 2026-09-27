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

  const libraryPath = resolve(ARTIFACT_DIR, 'character_library_cards.png');
  await page.screenshot({ path: libraryPath, fullPage: false });
  console.log(`Saved character library screenshot to: ${libraryPath}`);

  // Find first character card link
  const firstCardLink = await page.$('article a[href^="/apps/characters/"]');
  if (firstCardLink) {
    const href = await firstCardLink.getAttribute('href');
    console.log(`2. Navigating to character editor: ${href}`);
    await page.goto(`http://localhost:9320${href}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const editorPath = resolve(ARTIFACT_DIR, 'character_editor_detail.png');
    await page.screenshot({ path: editorPath, fullPage: false });
    console.log(`Saved character editor screenshot to: ${editorPath}`);
  } else {
    console.log('No character card link found on library page.');
  }

  await browser.close();
}

main().catch(err => {
  console.error('Screenshot script error:', err);
  process.exit(1);
});
