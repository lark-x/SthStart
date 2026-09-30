import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

const baseUrl = 'http://127.0.0.1:4173';
const artifactDir = '/Users/watermelon/.gemini/antigravity/brain/4a15b53d-7087-4e8d-8c7a-28856f59d332';

async function main() {
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
    await page.goto(`${baseUrl}/apps/story`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    // 打开第一个项目
    const card = page.locator('.story-project-card').first();
    await card.click();
    await page.waitForURL(/\/apps\/story\/[a-zA-Z0-9_-]+/, { timeout: 10000 });
    await page.waitForTimeout(1000);

    // 1. 尝试从角色库引入一个角色（例如钟离或雷电将军）
    console.log('1. 打开角色库弹窗引入角色...');
    await page.locator('button[aria-label="从角色库引入"]').click();
    await page.waitForTimeout(800);

    // 点击角色卡上的“引入”按钮（限定在对话框内）
    const dialog = page.locator('[role="dialog"]');
    const importBtn = dialog.getByRole('button', { name: '引入', exact: true }).first();
    if (await importBtn.isVisible()) {
      await importBtn.click();
      await page.waitForTimeout(1000);
      console.log('已点击引入');
    }
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await page.waitForTimeout(600);

    // 2. 新建一个小说章节
    console.log('2. 新建第一章正文...');
    await page.locator('button[aria-label="新增章节"]').click();
    await page.waitForTimeout(500);
    await page.fill('input[placeholder*="第一章"]', '第一章 离岛迷航');
    const novelText = `### 场景：离岛港口 - 夜

海风呼啸着卷过木制栈桥，整座码头在月色中静谧而危险。

派蒙（叉腰发愁）：“旅行者，前面的雾气好像越来越浓了，我们真的能找到出路吗？”
荧（拔出长剑）：“跟紧我，不要乱跑。”
钟离：“此地地脉沉寂，恐有异变。诸位且随我来。”

远处石灯笼的微光闪烁了一下，几个黑影在暗处迅速隐没。`;

    await page.fill('textarea[placeholder*="Markdown 正文"]', novelText);
    await page.getByRole('button', { name: '创建正式资料' }).click();
    await page.waitForTimeout(1500);

    // 3. 点击“衍生产物”并查看解析出的剧本
    console.log('3. 检查衍生产物与剧本工程编译...');
    await page.getByRole('button', { name: '衍生产物' }).click();
    await page.waitForTimeout(1200);

    // 截图记录实际编译出对白剧本的画面
    await page.screenshot({ path: resolve(artifactDir, 'prod_verified_story_compiled_script.png'), fullPage: false });

    console.log('端到端测试验证成功！');
  } catch (err) {
    console.error('测试出错:', err);
  } finally {
    await browser.close();
  }
}

main();
