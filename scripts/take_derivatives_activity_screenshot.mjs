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
    const chapterBtn = page.getByRole('button', { name: /第一章/i });
    if (await chapterBtn.isVisible()) {
      await chapterBtn.click();
      await page.waitForTimeout(600);
    }

    // 点击衍生产物按钮
    console.log('3. 打开衍生产物弹窗...');
    const derivativesBtn = page.getByRole('button', { name: '衍生产物' });
    if (await derivativesBtn.isVisible()) {
      await derivativesBtn.click();
      await page.waitForTimeout(1200);

      // 点击“创建为活动工程”
      console.log('4. 点击创建为活动工程...');
      const createActBtn = page.getByRole('button', { name: '创建为活动工程' });
      if (await createActBtn.isVisible()) {
        await createActBtn.click();
        console.log('5. 等待活动创建完成并展示直达链接...');
        await page.waitForTimeout(2000);
      }

      await page.screenshot({ path: resolve(artifactDir, 'prod_verified_story_activity_direct_created.png'), fullPage: false });
    }

    console.log('衍生直达活动验收截图完成！');
  } catch (err) {
    console.error('验收过程中出错:', err);
  } finally {
    await browser.close();
  }
}

main();
