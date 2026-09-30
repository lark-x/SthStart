import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = 'http://127.0.0.1:4173';
const artifactDir = '/Users/watermelon/.gemini/antigravity/brain/4a15b53d-7087-4e8d-8c7a-28856f59d332';
const projectId = '743a1f55-b32c-449b-bf89-501a94cde1c6';

async function main() {
  await mkdir(artifactDir, { recursive: true });

  // 1. 获取管理员会话
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

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  if (sessionValue) {
    await context.addCookies([
      {
        name: 'sthstart_admin_session',
        value: sessionValue,
        domain: '127.0.0.1',
        path: '/',
      },
    ]);
  }

  const page = await context.newPage();
  console.log(`Navigating to ${baseUrl}/apps/story/${projectId} ...`);
  await page.goto(`${baseUrl}/apps/story/${projectId}`, { waitUntil: 'networkidle' });

  // 等待页面加载完成
  await page.waitForTimeout(1500);

  // 截图 1: 全屏水墨小说创作工作台（彻底移除 iframe 与拖拽分割条）
  const workspacePath = resolve(artifactDir, 'prod_verified_story_fullscreen_zen_workspace.png');
  await page.screenshot({ path: workspacePath });
  console.log(`Saved workspace screenshot to: ${workspacePath}`);

  // 点击顶栏的「AI 协作 (MCP)」按钮
  const mcpBtn = page.getByRole('button', { name: /AI 协作 \(MCP\)/i });
  if (await mcpBtn.isVisible()) {
    await mcpBtn.click();
    await page.waitForTimeout(800);

    // 截图 2: AI 协作与 MCP 基础设施向导弹窗
    const dialogPath = resolve(artifactDir, 'prod_verified_story_agent_connect_dialog.png');
    await page.screenshot({ path: dialogPath });
    console.log(`Saved agent connect dialog screenshot to: ${dialogPath}`);
  } else {
    console.warn('AI 协作 (MCP) button not found!');
  }

  await browser.close();
}

main().catch((err) => {
  console.error('Verification error:', err);
  process.exit(1);
});
