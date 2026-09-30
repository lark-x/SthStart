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

  // 获取首个项目
  const projectsRes = await fetch(`${baseUrl}/api/admin/story/projects`, {
    headers: { cookie: `sthstart_admin_session=${sessionValue}` },
  });
  const { items } = await projectsRes.json();
  const projectId = items[0].id;

  // 1. 静默拉起 DSH 守护进程
  console.log('1. 拉起原生 DSH 守护进程...');
  const startRes = await fetch(`${baseUrl}/api/admin/story/projects/${projectId}/dsh/start`, {
    method: 'POST',
    headers: {
      cookie: `sthstart_admin_session=${sessionValue}`,
      origin: baseUrl,
      'x-sthstart-csrf': csrfToken,
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  console.log('启动响应:', await startRes.json());

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
    console.log('2. 访问工作台并等待 DSH iframe 载入...');
    await page.goto(`${baseUrl}/apps/story/${projectId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // 截取右侧真实 iframe 嵌入运行中的画面
    await page.screenshot({ path: resolve(artifactDir, 'prod_verified_story_dsh_running.png'), fullPage: false });
    console.log('已截图: prod_verified_story_dsh_running.png');
  } finally {
    await browser.close();
    // 停止 DSH 守护进程
    console.log('3. 停止 DSH 守护进程...');
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
