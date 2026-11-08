import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import fs from 'node:fs';

const ARTIFACT_DIR = process.env.ARTIFACT_DIR || resolve(process.cwd(), 'artifacts/visual-verification/features');
const IMAGES_DIR = resolve(ARTIFACT_DIR, 'images');

if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  page.on('console', msg => console.log(`[PAGE LOG]: ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => console.log(`[PAGE ERROR]: ${err.message}`));
  page.on('response', resp => {
    if (resp.status() >= 400) {
      console.log(`[HTTP ${resp.status()}]: ${resp.url()}`);
    }
  });

  // 获取并预置管理会话 Cookie，保证所有页面 API 和资源请求直接通过
  const authRes = await fetch('http://127.0.0.1:9320/api/auth/admin-session', { method: 'POST' });
  const setCookieHeader = authRes.headers.get('set-cookie') || '';
  const tokenMatch = setCookieHeader.match(/sthstart_admin_session=([^;]+)/);
  if (tokenMatch) {
    await context.addCookies([
      {
        name: 'sthstart_admin_session',
        value: tokenMatch[1],
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
  }

  console.log('1. 正在访问角色资料库: http://127.0.0.1:9320/apps/characters ...');
  await page.goto('http://127.0.0.1:9320/apps/characters', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Tab 1: 专属角色卡
  const tab1Path = resolve(IMAGES_DIR, 'character_library_cards.png');
  await page.screenshot({ path: tab1Path, fullPage: false });
  console.log(`📸 已保存专属角色卡截图: ${tab1Path}`);

  // Tab 2: 多角色公共资产库 (瀑布流 Masonry)
  console.log('2. 切换到「多角色公共资产库」标签页...');
  await page.click('button:has-text("多角色公共资产库")');
  await page.waitForTimeout(2500);

  const tab2Path = resolve(IMAGES_DIR, 'shared_asset_vault_masonry.png');
  await page.screenshot({ path: tab2Path, fullPage: false });
  console.log(`📸 已保存公共资产库瀑布流截图: ${tab2Path}`);

  // 弹窗预览 Lightbox
  const firstAsset = await page.$('.break-inside-avoid img');
  if (firstAsset) {
    console.log('2.1 点击资产卡片打开高清预览弹窗...');
    await firstAsset.click();
    await page.waitForTimeout(1000);
    const lightboxPath = resolve(IMAGES_DIR, 'shared_asset_lightbox.png');
    await page.screenshot({ path: lightboxPath, fullPage: false });
    console.log(`📸 已保存资产高清预览弹窗截图: ${lightboxPath}`);

    // 关闭弹窗 (按 ESC 或点击关闭按钮)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  // Tab 3: 邻舍角色
  console.log('3. 切换到「邻舍角色」标签页...');
  await page.click('button:has-text("邻舍角色")');
  await page.waitForTimeout(2500);

  const tab3Path = resolve(IMAGES_DIR, 'linshe_characters_replica.png');
  await page.screenshot({ path: tab3Path, fullPage: false });
  console.log(`📸 已保存邻舍角色卡复刻截图: ${tab3Path}`);

  await browser.close();
  console.log('🎉 所有页面与功能验证截图完成！');
}

main().catch(err => {
  console.error('Verification error:', err);
  process.exit(1);
});
