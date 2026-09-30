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

  const createAuthedContext = async (width, height) => {
    const ctx = await browser.newContext({ viewport: { width, height } });
    if (sessionValue) {
      await ctx.addCookies([
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
    return ctx;
  };

  try {
    // 1. 桌面端标杆 1440x900 - 首页
    console.log('1. 正在截取桌面端首页 (1440x900)...');
    const ctx1440 = await createAuthedContext(1440, 900);
    const page1440 = await ctx1440.newPage();
    await page1440.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    await page1440.waitForTimeout(1000);
    await page1440.screenshot({ path: `${artifactDir}/prod_verified_01_home_1440.png` });

    // 2. 叙事研究审核独立专注工作区 (1440x900)
    console.log('2. 正在截取叙事研究审核专注工作区 (1440x900)...');
    await page1440.goto(`${baseUrl}/apps/narrative`, { waitUntil: 'networkidle' });
    await page1440.waitForTimeout(1200);
    // 切换到“研究专题”标签
    const researchTab = page1440.getByRole('tab', { name: /研究专题/i });
    if (await researchTab.isVisible()) {
      await researchTab.click();
      await page1440.waitForTimeout(1200);
      // 检查是否有“进入审核”按钮并点击
      const enterReviewBtn = page1440.getByRole('button', { name: /进入审核/i }).first();
      if (await enterReviewBtn.isVisible()) {
        await enterReviewBtn.click();
        await page1440.waitForTimeout(1200);
      }
    }
    await page1440.screenshot({ path: `${artifactDir}/prod_verified_02_research_review_1440.png` });

    // 3. 创作资料库 (1440x900 & 1280x800)
    console.log('3. 正在截取创作资料库 (1440x900 & 1280x800)...');
    await page1440.goto(`${baseUrl}/apps/notebook`, { waitUntil: 'networkidle' });
    await page1440.waitForTimeout(1000);
    await page1440.screenshot({ path: `${artifactDir}/prod_verified_03_notebook_1440.png` });

    const ctx1280 = await createAuthedContext(1280, 800);
    const page1280 = await ctx1280.newPage();
    await page1280.goto(`${baseUrl}/apps/notebook`, { waitUntil: 'networkidle' });
    await page1280.waitForTimeout(1000);
    await page1280.screenshot({ path: `${artifactDir}/prod_verified_03_notebook_1280.png` });

    // 4. 角色新建与编辑 (1440x900)
    console.log('4. 正在截取角色新建与编辑 (1440x900)...');
    await page1440.goto(`${baseUrl}/apps/characters/new`, { waitUntil: 'networkidle' });
    await page1440.waitForTimeout(1000);
    await page1440.screenshot({ path: `${artifactDir}/prod_verified_04_character_editor_1440.png` });

    // 5. 剧情工作室 (1440x900，统一 WorkspaceHeader 与章节正文)
    console.log('5. 正在截取剧情工作室工作台 (1440x900)...');
    await page1440.goto(`${baseUrl}/apps/story/${targetProjectId}`, { waitUntil: 'networkidle' });
    await page1440.waitForTimeout(1200);
    await page1440.screenshot({ path: `${artifactDir}/prod_verified_05_story_workspace_1440.png` });

    // 6. 活动工作室 (1440x900)
    console.log('6. 正在截取活动工作室 (1440x900)...');
    const actListRes = await fetch(`${baseUrl}/api/admin/activities`, {
      headers: { cookie: `sthstart_admin_session=${sessionValue}` },
    });
    let targetActId = '';
    if (actListRes.ok) {
      const actData = await actListRes.json();
      targetActId = actData.items?.[0]?.id || '';
    }
    if (targetActId) {
      await page1440.goto(`${baseUrl}/apps/activities/${targetActId}`, { waitUntil: 'networkidle' });
      await page1440.waitForTimeout(1500);
      await page1440.screenshot({ path: `${artifactDir}/prod_verified_06_activity_workspace_1440.png` });
    }

    // 7. 创意中心与矮窗口 900x600 滚动兜底
    console.log('7. 正在截取创意生成中心 (1440x900 & 900x600)...');
    await page1440.goto(`${baseUrl}/apps/creative`, { waitUntil: 'domcontentloaded' });
    await page1440.waitForTimeout(1500);
    await page1440.screenshot({ path: `${artifactDir}/prod_verified_07_creative_1440.png` });

    const ctx900x600 = await createAuthedContext(900, 600);
    const page900 = await ctx900x600.newPage();
    await page900.goto(`${baseUrl}/apps/creative`, { waitUntil: 'domcontentloaded' });
    await page900.waitForTimeout(1500);
    await page900.screenshot({ path: `${artifactDir}/prod_verified_07_creative_900x600.png` });

    // 8. 移动端 390x844 响应式
    console.log('8. 正在截取移动端 (390x844)...');
    const ctxMobile = await createAuthedContext(390, 844);
    const pageMobile = await ctxMobile.newPage();
    await pageMobile.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await pageMobile.waitForTimeout(1000);
    await pageMobile.screenshot({ path: `${artifactDir}/prod_verified_08_mobile_home_390.png` });

    await pageMobile.goto(`${baseUrl}/apps/notebook`, { waitUntil: 'domcontentloaded' });
    await pageMobile.waitForTimeout(1000);
    await pageMobile.screenshot({ path: `${artifactDir}/prod_verified_08_mobile_notebook_390.png` });

    console.log('全部多分辨率自动化截图完成！');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('截图执行失败:', err);
  process.exit(1);
});
