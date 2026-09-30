import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = 'http://127.0.0.1:4173';
const artifactDir = '/Users/watermelon/.gemini/antigravity/brain/4a15b53d-7087-4e8d-8c7a-28856f59d332';

async function main() {
  await mkdir(artifactDir, { recursive: true });

  console.log('1. 获取 Admin 授权会话...');
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
    console.log('2. 访问剧情项目列表...');
    await page.goto(`${baseUrl}/apps/story`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    const projectCards = page.locator('.story-project-card');
    await projectCards.first().click();
    await page.waitForURL(/\/apps\/story\/[a-zA-Z0-9_-]+/, { timeout: 10000 });

    await page.waitForTimeout(1000);

    // 选中第一章
    console.log('3. 点击选择第一章...');
    const chapterBtn = page.getByRole('button', { name: /第一章/i });
    if (await chapterBtn.isVisible()) {
      await chapterBtn.click();
      await page.waitForTimeout(800);
    }

    // 4. 截取带有章节正文的水墨暖白稿纸
    console.log('4. 截取章节正文水墨暖白主画布...');
    await page.screenshot({ path: resolve(artifactDir, 'prod_verified_story_chapter_canvas.png'), fullPage: false });

    // 5. 切换到“深阁夜读”暗色护眼主题
    console.log('5. 切换到深阁夜读主题...');
    const midnightBtn = page.getByRole('button', { name: '深阁' });
    if (await midnightBtn.isVisible()) {
      await midnightBtn.click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: resolve(artifactDir, 'prod_verified_story_midnight_theme.png'), fullPage: false });
    }

    // 切回水墨暖白
    const parchmentBtn = page.getByRole('button', { name: '水墨' });
    if (await parchmentBtn.isVisible()) {
      await parchmentBtn.click();
      await page.waitForTimeout(400);
    }

    // 6. 切换到剧本流模式，截取精美对话气泡流
    console.log('6. 切换到剧本流演出模式...');
    const scriptBtn = page.getByRole('button', { name: '剧本流' });
    if (await scriptBtn.isVisible()) {
      await scriptBtn.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: resolve(artifactDir, 'prod_verified_story_script_bubbles.png'), fullPage: false });
    }

    console.log('详细视觉验收截图全部完成！');
  } catch (err) {
    console.error('验收过程中出错:', err);
  } finally {
    await browser.close();
  }
}

main();
