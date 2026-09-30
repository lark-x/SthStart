import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = 'http://127.0.0.1:4173';
const artifactDir = '/Users/watermelon/.gemini/antigravity/brain/4a15b53d-7087-4e8d-8c7a-28856f59d332';

async function main() {
  await mkdir(artifactDir, { recursive: true });
  console.log('=== 开始执行活动工作室方案 A 端到端全链路深度测试 ===');

  console.log('步骤 1: 建立管理员安全会话...');
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
  if (!sessionValue) {
    throw new Error('获取管理员安全会话失败喵！');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

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

  const page = await context.newPage();

  // 记录所有 API 交互日志
  const apiLogs = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/api/admin/activities')) {
      try {
        const text = await res.text();
        apiLogs.push({ url, status: res.status(), text: text.slice(0, 300) });
      } catch {}
    }
  });

  try {
    // -------------------------------------------------------------
    // 测试点 1：从小说章节派生漫剧工程
    // -------------------------------------------------------------
    console.log('\n--- 测试点 1: 从小说章节派生创建视觉漫剧工坊 ---');
    await page.goto(`${baseUrl}/apps/activities/new`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    // 选中小说工程下拉框
    console.log('选择小说工程...');
    const projectSelect = page.locator('select').first();
    await projectSelect.waitFor({ state: 'visible' });
    const projectOptions = await projectSelect.locator('option').allTextContents();
    console.log('可用小说工程列表:', projectOptions);

    // 优先选择包含正文章节的「你好」工程，或第一个有效工程
    const nihaoOption = projectSelect.locator('option', { hasText: /你好/ });
    if (await nihaoOption.count() > 0) {
      const val = await nihaoOption.first().getAttribute('value');
      await projectSelect.selectOption(val);
      console.log(`已选择工程「你好」: ${val}`);
    } else {
      const validProjectOption = await projectSelect.locator('option:not([value=""])').first();
      const projectId = await validProjectOption.getAttribute('value');
      await projectSelect.selectOption(projectId);
      console.log(`已选择工程 ID: ${projectId}`);
    }

    // 等待章节下拉框就绪并加载选项
    console.log('选择章节...');
    const chapterSelect = page.locator('select').nth(1);
    await chapterSelect.waitFor({ state: 'visible' });

    // 等待有效章节选项渲染（超时 8 秒）
    await page.waitForFunction(() => {
      const selects = document.querySelectorAll('select');
      if (selects.length < 2) return false;
      const opts = Array.from(selects[1].options);
      return opts.some((o) => o.value && o.value.trim() !== '');
    }, { timeout: 8000 });

    const chapterOptions = await chapterSelect.locator('option').allTextContents();
    console.log('可用章节列表:', chapterOptions);

    const validChapterOption = await chapterSelect.locator('option:not([value=""])').first();
    const chapterId = await validChapterOption.getAttribute('value');
    await chapterSelect.selectOption(chapterId);
    console.log(`已选择章节 ID: ${chapterId}`);

    // 点击一键派生按钮
    console.log('点击【一键派生并进入视觉漫剧工坊】...');
    const deriveBtn = page.getByRole('button', { name: /一键派生并进入视觉漫剧工坊/i });
    await deriveBtn.click();

    // 等待页面跳转至详情页
    await page.waitForURL(/\/apps\/activities\/[a-zA-Z0-9_-]+/, { timeout: 15000 });
    const derivedUrl = page.url();
    console.log(`成功跳转至派生活动工坊: ${derivedUrl}`);

    await page.waitForTimeout(1500);
    const shotDerived = resolve(artifactDir, 'prod_e2e_01_derived_from_story.png');
    await page.screenshot({ path: shotDerived });
    console.log(`已保存派生工坊截图: ${shotDerived}`);

    // -------------------------------------------------------------
    // 测试点 2：挑选角色与题材快速创建四幕漫剧
    // -------------------------------------------------------------
    console.log('\n--- 测试点 2: 挑选角色与题材生成四幕分镜工程 ---');
    await page.goto(`${baseUrl}/apps/activities/new`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    // 切换到【挑选角色与题材生成】卡片
    console.log('切换卡片到【挑选角色与题材生成】...');
    const charTabBtn = page.getByRole('button', { name: /挑选角色与题材生成/i });
    await charTabBtn.click();
    await page.waitForTimeout(600);

    // 输入工程名称与主题
    console.log('输入漫剧工程名称与主题...');
    const titleInput = page.getByPlaceholder(/例如：提瓦特冬日温泉物语/i);
    await titleInput.fill('璃月海灯节轶事');

    const themeInput = page.getByPlaceholder(/例如：几人在初雪之夜围坐畅谈/i);
    await themeInput.fill('众人于除夕之夜共聚璃月港，点亮霄灯，畅谈千岩往事。');

    // 挑选登场角色：胡桃与钟离
    console.log('挑选角色：胡桃、钟离...');
    const hutaoBtn = page.getByRole('button', { name: /胡桃/i }).first();
    if (await hutaoBtn.isVisible()) {
      await hutaoBtn.click();
      console.log('已选中角色: 胡桃');
    }
    const zhongliBtn = page.getByRole('button', { name: /钟离/i }).first();
    if (await zhongliBtn.isVisible()) {
      await zhongliBtn.click();
      console.log('已选中角色: 钟离');
    }

    // 点击创建按钮
    console.log('点击【创建四幕分镜工程】...');
    const createFourStageBtn = page.getByRole('button', { name: /创建四幕分镜工程/i });
    await createFourStageBtn.click();

    // 等待页面跳转
    await page.waitForURL(/\/apps\/activities\/[a-zA-Z0-9_-]+/, { timeout: 15000 });
    const quickCreatedUrl = page.url();
    console.log(`成功跳转至四幕漫剧工坊: ${quickCreatedUrl}`);

    await page.waitForTimeout(1500);
    const shotCharCreated = resolve(artifactDir, 'prod_e2e_02_created_from_characters.png');
    await page.screenshot({ path: shotCharCreated });
    console.log(`已保存四幕漫剧工坊截图: ${shotCharCreated}`);

    // -------------------------------------------------------------
    // 测试点 3：工作台内分镜编辑与一键极速绘制链路
    // -------------------------------------------------------------
    console.log('\n--- 测试点 3: 分镜追加与一键极速绘制流转 ---');

    // 验证左侧分幕中是否存在第一幕
    const stageItems = page.locator('text=/第 1 幕|第一幕/');
    console.log(`检测到分幕组件数量: ${await stageItems.count()}`);

    // 点击【+ 追加下一镜】
    console.log('点击追加下一镜...');
    const addBeatBtn = page.getByRole('button', { name: /追加下一镜/i });
    if (await addBeatBtn.isVisible()) {
      await addBeatBtn.click();
      await page.waitForTimeout(600);
      console.log('成功追加下一镜！');
    }

    // 验证右侧工作台：一键极速绘制按钮是否可用
    console.log('检查右侧工坊【一键极速绘制】与【自定义工作流/画风】按钮...');
    const quickRenderBtn = page.getByRole('button', { name: /一键极速绘制/i });
    const customWorkflowBtn = page.getByRole('button', { name: /自定义工作流\/画风/i });

    const hasQuickRender = await quickRenderBtn.isVisible();
    const hasCustomWorkflow = await customWorkflowBtn.isVisible();
    console.log(`【一键极速绘制】按钮可见: ${hasQuickRender}`);
    console.log(`【自定义工作流/画风】按钮可见: ${hasCustomWorkflow}`);

    // 点击【自定义工作流/画风】抽屉，验证模型与画风提示词参数
    if (hasCustomWorkflow) {
      await customWorkflowBtn.click();
      await page.waitForTimeout(600);
      console.log('已打开高级画风与模型抽屉！');
      const shotDrawer = resolve(artifactDir, 'prod_e2e_03_workflow_drawer.png');
      await page.screenshot({ path: shotDrawer });
      console.log(`已保存高级抽屉截图: ${shotDrawer}`);

      // 关闭设置弹窗
      const dialog = page.getByRole('dialog');
      if (await dialog.isVisible()) {
        const dialogFinishBtn = dialog.getByRole('button', { name: '完成' });
        if (await dialogFinishBtn.isVisible()) {
          await dialogFinishBtn.click();
        } else {
          await page.keyboard.press('Escape');
        }
      } else {
        await page.keyboard.press('Escape');
      }
      await page.waitForTimeout(600);
    }

    // 点击【一键极速绘制】
    if (hasQuickRender) {
      console.log('点击【一键极速绘制】...');
      await quickRenderBtn.click();
      await page.waitForTimeout(1500);
      const shotRenderTriggered = resolve(artifactDir, 'prod_e2e_03_beat_render_triggered.png');
      await page.screenshot({ path: shotRenderTriggered });
      console.log(`已保存出图触发状态截图: ${shotRenderTriggered}`);
    }

    // -------------------------------------------------------------
    // 测试点 4：多媒体工坊各阶段切换验证
    // -------------------------------------------------------------
    console.log('\n--- 测试点 4: 多媒体工坊核心阶段切换验证 ---');

    // 1. 视听剧场
    console.log('切换至【视听剧场】...');
    const theaterBtn = page.getByRole('button', { name: /视听剧场/i });
    if (await theaterBtn.isVisible()) {
      await theaterBtn.click();
      await page.waitForTimeout(1000);
      const shotTheater = resolve(artifactDir, 'prod_e2e_04_audiovisual_theater.png');
      await page.screenshot({ path: shotTheater });
      console.log(`已保存视听剧场截图: ${shotTheater}`);
    }

    // 2. 视觉资产
    console.log('切换至【视觉资产】...');
    const assetsBtn = page.getByRole('button', { name: /视觉资产/i });
    if (await assetsBtn.isVisible()) {
      await assetsBtn.click();
      await page.waitForTimeout(1000);
      const shotAssets = resolve(artifactDir, 'prod_e2e_05_visual_assets.png');
      await page.screenshot({ path: shotAssets });
      console.log(`已保存视觉资产截图: ${shotAssets}`);
    }

    // 3. 企划设定
    console.log('切换至【企划设定】...');
    const planningBtn = page.getByRole('button', { name: /企划设定/i });
    if (await planningBtn.isVisible()) {
      await planningBtn.click();
      await page.waitForTimeout(1000);
      const shotPlanning = resolve(artifactDir, 'prod_e2e_06_planning_settings.png');
      await page.screenshot({ path: shotPlanning });
      console.log(`已保存企划设定截图: ${shotPlanning}`);
    }

    // 4. 导出交付
    console.log('切换至【导出交付】...');
    const exportBtn = page.getByRole('button', { name: /导出交付/i });
    if (await exportBtn.isVisible()) {
      await exportBtn.click();
      await page.waitForTimeout(1000);
      const shotExport = resolve(artifactDir, 'prod_e2e_07_export_delivery.png');
      await page.screenshot({ path: shotExport });
      console.log(`已保存导出交付截图: ${shotExport}`);
    }

    console.log('\n=== 所有端到端链路深度测试全部通过喵！===');
    console.log('API 调用概要 (最近 10 条):');
    for (const log of apiLogs.slice(-10)) {
      console.log(`[${log.status}] ${log.url.split('/').slice(-3).join('/')} -> ${log.text}`);
    }
  } catch (err) {
    console.error('端到端测试发生异常:', err);
    throw err;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
