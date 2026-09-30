import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = 'http://127.0.0.1:4173';
const artifactDir = '/Users/watermelon/.gemini/antigravity/brain/4a15b53d-7087-4e8d-8c7a-28856f59d332';

async function main() {
  await mkdir(artifactDir, { recursive: true });

  // 1. 获取本地 Admin Session Cookie
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

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[browser error]', msg.text());
  });

  try {
    console.log('2. 访问剧情项目列表...');
    await page.goto(`${baseUrl}/apps/story`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: resolve(artifactDir, 'prod_verified_story_list.png'), fullPage: false });

    // 检查项目列表
    const projectCards = page.locator('.story-project-card');
    const cardCount = await projectCards.count();

    let targetUrl = '';
    if (cardCount > 0) {
      await projectCards.first().click();
      await page.waitForURL(/\/apps\/story\/[a-zA-Z0-9_-]+/, { timeout: 10000 });
      targetUrl = page.url();
      console.log('3. 进入首个项目:', targetUrl);
    } else {
      console.log('3. 自动新建测试项目...');
      await page.getByRole('button', { name: '新建项目' }).click();
      await page.waitForTimeout(500);
      await page.fill('#story-project-title', '雾港夜行');
      await page.fill('#story-project-work', '原神');
      await page.getByRole('button', { name: '创建项目' }).click();
      await page.waitForURL(/\/apps\/story\/[a-zA-Z0-9_-]+/, { timeout: 10000 });
      targetUrl = page.url();
    }

    await page.waitForTimeout(1500);

    // 4. 截取三栏工作台全景（左栏大纲、中栏纯文本小说纸感画布、右栏原生 DSH 终端）
    console.log('4. 截取三栏工作台全景...');
    await page.screenshot({ path: resolve(artifactDir, 'prod_verified_story_3column.png'), fullPage: false });

    // 5. 打开“从角色库引入”弹窗并截图
    console.log('5. 打开角色库按作品引入弹窗...');
    const userPlusBtn = page.locator('button[aria-label="从角色库引入"]');
    if (await userPlusBtn.isVisible()) {
      await userPlusBtn.click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: resolve(artifactDir, 'prod_verified_story_cast_dialog.png'), fullPage: false });
      const closeBtn = page.getByRole('button', { name: '关闭', exact: true });
      if (await closeBtn.isVisible()) await closeBtn.click();
      await page.waitForTimeout(500);
    }

    // 6. 点击“衍生产物”弹窗并截图
    console.log('6. 打开小说衍生产物导出弹窗...');
    const derivativesBtn = page.getByRole('button', { name: '衍生产物' });
    if (await derivativesBtn.isVisible()) {
      await derivativesBtn.click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: resolve(artifactDir, 'prod_verified_story_derivatives_dialog.png'), fullPage: false });
      const finishBtn = page.getByRole('button', { name: '完成', exact: true });
      if (await finishBtn.isVisible()) await finishBtn.click();
      await page.waitForTimeout(500);
    }

    // 7. 切换禅道专注模式并截图
    console.log('7. 切换禅道专注写作模式...');
    const zenBtn = page.getByRole('button', { name: '专注写作' });
    if (await zenBtn.isVisible()) {
      await zenBtn.click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: resolve(artifactDir, 'prod_verified_story_zen.png'), fullPage: false });
    }

    console.log('所有截图验收完成！');
  } catch (err) {
    console.error('验收过程中出错:', err);
  } finally {
    await browser.close();
  }
}

main();
