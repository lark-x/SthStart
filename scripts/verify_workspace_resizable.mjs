import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = 'http://127.0.0.1:4173';
const artifactDir = '/Users/watermelon/.gemini/antigravity/brain/4a15b53d-7087-4e8d-8c7a-28856f59d332';

async function main() {
  await mkdir(artifactDir, { recursive: true });

  const sessionRes = await fetch(`${baseUrl}/api/auth/admin-session`, {
    method: 'POST',
    headers: { origin: baseUrl },
  });
  const sessionData = await sessionRes.json();
  const csrfToken = sessionData.csrfToken;
  const cookieHeader = sessionRes.headers.get('set-cookie');
  let sessionValue = '';
  if (cookieHeader) {
    const match = cookieHeader.match(/sthstart_admin_session=([^;]+)/);
    if (match) sessionValue = match[1];
  }

  // 获取具有章节的项目
  const projectId = '743a1f55-b32c-449b-bf89-501a94cde1c6';

  // 1. 静默拉起 DSH 守护进程
  console.log('1. 拉起原生 DSH 守护进程...');
  await fetch(`${baseUrl}/api/admin/story/projects/${projectId}/dsh/start`, {
    method: 'POST',
    headers: {
      cookie: `sthstart_admin_session=${sessionValue}`,
      origin: baseUrl,
      'x-sthstart-csrf': csrfToken,
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (sessionValue) {
    await context.addCookies([
      {
        name: 'sthstart_admin_session',
        value: sessionValue,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
  }

  const page = await context.newPage();

  try {
    console.log('2. 访问工作台...');
    await page.goto(`${baseUrl}/apps/story/${projectId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    // 点击左侧大纲树中的第一章
    console.log('3. 点击左侧章节列表选择第一幕...');
    const chapterItem = page.locator('button:has-text("离岛迷航"), button:has-text("第一章"), button:has-text("第 1 章")').first();
    if (await chapterItem.isVisible()) {
      await chapterItem.click();
      await page.waitForTimeout(800);
    }

    // 截取带有章节底部穿梭翻页条的稿纸视图
    console.log('4. 截取带有底部翻页条的正文视图...');
    await page.screenshot({ path: resolve(artifactDir, 'prod_verified_story_chapter_nav.png'), fullPage: false });
    console.log('已截图: prod_verified_story_chapter_nav.png');

    // 折叠左栏大纲
    console.log('5. 折叠左栏大纲...');
    const collapseBtn = page.locator('button[title*="收起大纲资料树"], button[title*="大纲资料树"]').first();
    if (await collapseBtn.isVisible()) {
      await collapseBtn.click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: resolve(artifactDir, 'prod_verified_story_sidebar_collapsed.png'), fullPage: false });
      console.log('已截图: prod_verified_story_sidebar_collapsed.png');
    }

    // 点击 680px 宽度预设
    console.log('6. 切换 DSH 至宽屏模式 (680px)...');
    const widePresetBtn = page.getByRole('button', { name: '宽' }).first();
    if (await widePresetBtn.isVisible()) {
      await widePresetBtn.click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: resolve(artifactDir, 'prod_verified_story_dsh_expanded.png'), fullPage: false });
      console.log('已截图: prod_verified_story_dsh_expanded.png');
    }

    // 全屏沉浸展开 DSH
    console.log('7. 全屏沉浸展开 DSH...');
    const maximizeBtn = page.locator('button[title*="全屏展开 DSH 终端"]').first();
    if (await maximizeBtn.isVisible()) {
      await maximizeBtn.click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: resolve(artifactDir, 'prod_verified_story_dsh_maximized.png'), fullPage: false });
      console.log('已截图: prod_verified_story_dsh_maximized.png');
    }

    console.log('所有截图验证已完成！');
  } finally {
    await browser.close();
    // 停止 DSH 守护进程
    console.log('8. 停止 DSH 守护进程...');
    await fetch(`${baseUrl}/api/admin/story/projects/${projectId}/dsh/stop`, {
      method: 'POST',
      headers: {
        cookie: `sthstart_admin_session=${sessionValue}`,
        origin: baseUrl,
        'x-sthstart-csrf': csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });
  }
}

main().catch(console.error);
