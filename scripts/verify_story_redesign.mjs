import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const baseUrl = 'http://127.0.0.1:4173';
const artifactDir = '/Users/watermelon/.gemini/antigravity/brain/4a15b53d-7087-4e8d-8c7a-28856f59d332';
const targetProjectId = '743a1f55-b32c-449b-bf89-501a94cde1c6';

async function main() {
  await mkdir(artifactDir, { recursive: true });

  const sessionRes = await fetch(`${baseUrl}/api/auth/admin-session`, {
    method: 'POST',
    headers: { origin: baseUrl },
  });
  const cookieHeader = sessionRes.headers.get('set-cookie');
  let sessionValue = '';
  if (cookieHeader) {
    const match = cookieHeader.match(/sthstart_admin_session=([^;]+)/);
    if (match) sessionValue = match[1];
  }

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
    console.log('1. 打开富章节剧情项目工作台...');
    await page.goto(`${baseUrl}/apps/story/${targetProjectId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // 截取章节目录模式 + 宽屏正文
    console.log('2. 截取宽屏正文与章节导航...');
    await page.screenshot({
      path: `${artifactDir}/prod_verified_story_wide_workspace.png`,
      fullPage: false,
    });

    // 切换到第二章查看正文展示
    console.log('3. 切换到第二章...');
    const chapter2 = page.getByRole('button', { name: /第二章/i }).first();
    if (await chapter2.isVisible()) {
      await chapter2.click();
      await page.waitForTimeout(800);
      await page.screenshot({
        path: `${artifactDir}/prod_verified_story_chapter2_wide.png`,
        fullPage: false,
      });
    }

    // 切换到设定集 Tab
    console.log('4. 切换到设定集 Tab...');
    const bibleTab = page.getByRole('button', { name: /设定集/i });
    if (await bibleTab.isVisible()) {
      await bibleTab.click();
      await page.waitForTimeout(800);
      await page.screenshot({
        path: `${artifactDir}/prod_verified_story_bible_workspace.png`,
        fullPage: false,
      });
    }

    // 打开排版偏好 popover 验证画布宽度选项
    console.log('5. 打开排版偏好...');
    const prefsBtn = page.getByTitle('排版偏好');
    if (await prefsBtn.isVisible()) {
      await prefsBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: `${artifactDir}/prod_verified_story_canvas_settings.png`,
        fullPage: false,
      });
    }

    console.log('所有验证截图抓取完成喵！');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('截图执行异常:', err);
  process.exit(1);
});
