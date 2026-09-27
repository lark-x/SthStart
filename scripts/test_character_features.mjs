import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

const ARTIFACT_DIR = 'C:/Users/12938/.gemini/antigravity/brain/ab76a116-4d29-4147-9fd0-215e58a51794';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  page.on('console', msg => console.log(`[PAGE LOG]: ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => console.log(`[PAGE ERROR]: ${err.message}`));

  // Go to Furina's editor (search for 芙宁娜)
  console.log('Navigating to characters library...');
  await page.goto('http://localhost:9320/apps/characters', { waitUntil: 'networkidle' });

  // Click Furina
  const furinaLink = await page.$('a:has-text("芙宁娜")');
  if (furinaLink) {
    console.log('Clicking Furina card...');
    await furinaLink.click();
    await page.waitForTimeout(1500);

    // Click "新增形态"
    const addVariantBtn = await page.$('button:has-text("新增形态")');
    if (addVariantBtn) {
      console.log('Clicking 新增形态 button...');
      await addVariantBtn.click();
      await page.waitForTimeout(500);

      // Type variant name
      const input = await page.$('input[placeholder="例如：雪山特训"]');
      if (input) {
        await input.fill('白芙·日常演出');
        const confirmBtn = await page.$('button:has-text("确认添加")');
        if (confirmBtn) {
          await confirmBtn.click();
          await page.waitForTimeout(1000);
          console.log('Added variant: 白芙·日常演出');
        }
      }
    }

    // Save character
    const saveBtn = await page.$('button:has-text("保存角色")');
    if (saveBtn) {
      console.log('Clicking 保存角色...');
      await saveBtn.click();
      await page.waitForTimeout(1500);
    }

    // Screenshot editor with variant
    const variantEditorPath = resolve(ARTIFACT_DIR, 'character_editor_with_variant.png');
    await page.screenshot({ path: variantEditorPath, fullPage: false });
    console.log(`Saved editor with variant to: ${variantEditorPath}`);

    // Back to library to verify badge
    await page.goto('http://localhost:9320/apps/characters', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const libraryUpdatedPath = resolve(ARTIFACT_DIR, 'character_library_with_variant_badge.png');
    await page.screenshot({ path: libraryUpdatedPath, fullPage: false });
    console.log(`Saved library with variant badge to: ${libraryUpdatedPath}`);
  } else {
    console.log('Furina not found.');
  }

  await browser.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
