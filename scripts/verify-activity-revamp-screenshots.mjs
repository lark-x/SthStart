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
    console.log('2. 访问新建视觉工坊入口 (/apps/activities/new)...');
    await page.goto(`${baseUrl}/apps/activities/new`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // 截图 1：新建活动入口（小说章节派生推荐卡片）
    const shotNewStory = resolve(artifactDir, 'prod_verified_activity_new_story_mode.png');
    await page.screenshot({ path: shotNewStory });
    console.log(`已截取新建工坊 (小说派生模式): ${shotNewStory}`);

    // 点击切换到第二个模式：挑选角色与题材生成
    console.log('3. 切换到【挑选角色与题材】模式...');
    const charTabBtn = page.getByRole('button', { name: /挑选角色与题材/i });
    if (await charTabBtn.isVisible()) {
      await charTabBtn.click();
      await page.waitForTimeout(800);
      const shotNewChar = resolve(artifactDir, 'prod_verified_activity_new_character_mode.png');
      await page.screenshot({ path: shotNewChar });
      console.log(`已截取新建工坊 (角色与题材模式): ${shotNewChar}`);
    }

    // 访问活动列表以找到一个已有活动进行工作室截图
    console.log('4. 访问活动列表页 (/apps/activities)...');
    await page.goto(`${baseUrl}/apps/activities`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // 尝试点击进入第一个活动
    const activityCards = page.locator('a[href^="/apps/activities/"]');
    const cardCount = await activityCards.count();
    console.log(`发现活动卡片数量: ${cardCount}`);

    let targetActivityUrl = '';
    for (let i = 0; i < cardCount; i++) {
      const href = await activityCards.nth(i).getAttribute('href');
      if (href && href !== '/apps/activities/new' && !href.endsWith('/new')) {
        targetActivityUrl = href;
        break;
      }
    }

    if (targetActivityUrl) {
      console.log(`5. 进入活动工作室: ${targetActivityUrl}...`);
      await page.goto(`${baseUrl}${targetActivityUrl}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);

      // 截图 2：新版分镜漫剧工作室工作台全貌
      const shotStudio = resolve(artifactDir, 'prod_verified_activity_studio_revamp.png');
      await page.screenshot({ path: shotStudio });
      console.log(`已截取新版活动视觉工坊全貌: ${shotStudio}`);

      // 尝试展开镜头详情或滚动查看镜头卡片
      const shotCard = page.locator('text=第 1 镜').first();
      if (await shotCard.isVisible()) {
        await shotCard.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        const shotDetail = resolve(artifactDir, 'prod_verified_activity_shot_card_detail.png');
        await page.screenshot({ path: shotDetail });
        console.log(`已截取分镜镜号工作台特写: ${shotDetail}`);
      }
    } else {
      console.log('未找到已有活动，跳过工作室工作台详情截图。');
    }

    console.log('验证截图完成喵！');
  } catch (err) {
    console.error('截图测试异常:', err);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
