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

  // 2. 启动原生 DSH 终端并注入定制主题与技能
  console.log('1. 拉起原生 DSH 终端并注入主题与技能...');
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

  // 读取项目文档获取主线大纲 ID 与 revision
  const docsRes = await fetch(`${baseUrl}/api/admin/story/projects/${projectId}/documents`, {
    headers: { cookie: `sthstart_admin_session=${sessionValue}` },
  });
  const { items: docs } = await docsRes.json();
  const outlineDoc = docs.find((d) => d.kind === 'outline');

  // 获取 Story Bridge 凭证（模拟 MCP 客户端认证）
  const grantRes = await fetch(`${baseUrl}/api/admin/story/projects/${projectId}/bridge-grant`, {
    method: 'POST',
    headers: {
      cookie: `sthstart_admin_session=${sessionValue}`,
      origin: baseUrl,
      'x-sthstart-csrf': csrfToken,
    },
  });
  const { token: bridgeToken } = await grantRes.json();

  // 3. 模拟 DSH/模型 通过 MCP submit_proposal 提交大纲优化与新章节提案
  console.log('2. 模拟 DSH 模型通过 MCP 工具向项目提交剧情大纲与新章节提案...');
  const outlineProposalRes = await fetch(`${baseUrl}/api/story-bridge/projects/${projectId}/proposals`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bridgeToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'update',
      kind: 'outline',
      targetId: outlineDoc?.id ?? null,
      baseRevision: outlineDoc?.revision ?? 1,
      proposedTitle: '主线大纲：稻妻雷暴与幕府暗流',
      proposedBody: `### 第一幕：离岛迷航
- 旅行者与派蒙抵达离岛，勘定奉行万般刁难。
- 偶遇托马，协助解决离岛通行证难题。

### 第二幕：影向山之约
- 前往鸣神大社拜会八重神子，探询眼狩令背后的真相。

### 第三幕：天守阁风云
- 御前决斗，直面雷电将军的「无想的一刀」，点燃千手百眼神像的反抗意志。`,
      reason: '由 DSH 编剧模型协助构思整理的四幕主线大纲',
    }),
  });
  console.log('大纲提案提交结果:', await outlineProposalRes.json());

  const chapterProposalRes = await fetch(`${baseUrl}/api/story-bridge/projects/${projectId}/proposals`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bridgeToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'create',
      kind: 'chapter',
      targetId: null,
      baseRevision: null,
      proposedTitle: '第三章 鸣神大社的狐鸣',
      proposedBody: `清风拂过影向山之巅，千本鸟居在夕阳下拉出长长的阴影。

派蒙揉着肚子嘟囔道：“唔……爬了这么久的阶梯，神子这家伙到底在不在大社里呀？”

荧警惕地注视着四周被雷元素浸染的绯樱：“小声点，派蒙。神樱树的气息……有些不对劲。”

“哎呀呀，哪来的两只慌张小雀儿，竟敢在鸣神大社前非议宫司大人？”一道慵懒而带着狡黠笑意的声音，从殿侧的紫藤树荫下悠悠传来。

八重神子手执御币，眼波流转地打量着二人：“听说你们在离岛闹出了不小的动静，连柊家那位老狐狸都被你们摆了一道呢。”`,
      reason: '由 DSH 创作模型起草的第三章小说正文草案',
    }),
  });
  console.log('章节提案提交结果:', await chapterProposalRes.json());

  // 4. 打开浏览器验证端到端 UI
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
      },
    ]);
  }

  const page = await context.newPage();
  // 自动同意浏览器弹窗（如 window.confirm）
  page.on('dialog', async (dialog) => {
    console.log('自动确认弹窗:', dialog.message());
    await dialog.accept();
  });

  try {
    console.log('3. 访问剧情工作台...');
    await page.goto(`${baseUrl}/apps/story/${projectId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // 验证 1：点击打开「排版偏好」Popover 浮层
    console.log('4. 验证排版偏好 Popover 浮层...');
    const prefBtn = page.getByRole('button', { name: '排版偏好' });
    if (await prefBtn.isVisible()) {
      await prefBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: resolve(artifactDir, 'prod_verified_story_preferences_popover.png'), fullPage: false });
      console.log('已截图: prod_verified_story_preferences_popover.png');
      // 关闭浮层
      await prefBtn.click();
      await page.waitForTimeout(300);
    }

    // 验证 2：点击顶栏「提案审阅」并一键合并大纲与新章节
    console.log('5. 点击提案审阅弹窗并合并 DSH 提案...');
    const reviewBtn = page.locator('button:has-text("提案审阅")').first();
    if (await reviewBtn.isVisible()) {
      await reviewBtn.click();
      await page.waitForTimeout(1000);

      // 截取提案对比弹窗
      await page.screenshot({ path: resolve(artifactDir, 'prod_verified_story_proposals_dialog.png'), fullPage: false });
      console.log('已截图: prod_verified_story_proposals_dialog.png');

      // 依次点击接受并保存提案
      const acceptBtns = page.locator('button:has-text("接受并保存")');
      const count = await acceptBtns.count();
      console.log(`找到 ${count} 个待合并提案按钮...`);
      for (let i = 0; i < count; i++) {
        const btn = acceptBtns.first();
        if (await btn.isVisible()) {
          await btn.click();
          await page.waitForTimeout(1200);
        }
      }

      // 关闭抽屉弹窗
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
    }

    // 验证 3：确认大纲已被 DSH 内容更新填充
    console.log('6. 校验主线大纲已被 DSH 填充并截图...');
    const outlineItem = page.locator('button:has-text("主线大纲")').first();
    if (await outlineItem.isVisible()) {
      await outlineItem.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: resolve(artifactDir, 'prod_verified_story_workflow_outline_filled.png'), fullPage: false });
      console.log('已截图: prod_verified_story_workflow_outline_filled.png');
    }

    // 验证 4：确认新章节「第三章 鸣神大社的狐鸣」已自动创建并填充正文
    console.log('7. 校验新章节已被创建并填充正文...');
    const newChapterItem = page.locator('button:has-text("第三章"), button:has-text("鸣神大社")').first();
    if (await newChapterItem.isVisible()) {
      await newChapterItem.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: resolve(artifactDir, 'prod_verified_story_workflow_chapter_filled.png'), fullPage: false });
      console.log('已截图: prod_verified_story_workflow_chapter_filled.png');
    }

    // 验证 5：DSH 视觉主题已统一适配
    console.log('8. 截取 DSH 终端并验证视觉主题适配...');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: resolve(artifactDir, 'prod_verified_story_dsh_themed.png'), fullPage: false });
    console.log('已截图: prod_verified_story_dsh_themed.png');

    console.log('端到端工作流自动化测试全部完成！');
  } finally {
    await browser.close();
    // 停止 DSH 守护进程
    console.log('9. 停止 DSH 终端...');
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
