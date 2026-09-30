import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const baseUrl = process.env.STHSTART_SCREENSHOT_BASE_URL || 'http://localhost:9320';
const configuredActivityUrl = process.env.STHSTART_SCREENSHOT_ACTIVITY_URL;
const outputDir = resolve(process.env.STHSTART_SCREENSHOT_OUTPUT_DIR || 'artifacts/activity-editor-screenshots');
const consoleErrors = [];
const pageErrors = [];

async function main() {
  await mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const detail = `[browser] ${message.text()}`;
      consoleErrors.push(detail);
      console.error(detail);
    }
  });
  page.on('pageerror', (error) => {
    const detail = `[browser error] ${error.message}`;
    pageErrors.push(detail);
    console.error(detail);
  });

  try {
    await page.request.post(new URL('/api/auth/admin-session', baseUrl).toString(), { headers: { origin: new URL(baseUrl).origin } });
    let activityUrl = configuredActivityUrl
      ? new URL(configuredActivityUrl, baseUrl).toString()
      : null;

    if (!activityUrl) {
      await page.goto(new URL('/apps/activities', baseUrl).toString(), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const links = await page.locator('a[href*="/apps/activities/"]').evaluateAll((anchors) =>
        anchors.map((anchor) => anchor.href)
          .filter((href) => /\/apps\/activities\/[^/?#]+\/?(?:[?#].*)?$/.test(href)
            && !/\/apps\/activities\/new\/?(?:[?#].*)?$/.test(href)),
      );
      activityUrl = links[0] || null;
    }

    if (!activityUrl) {
      console.warn('当前数据库没有活动详情，跳过活动工作台截图，继续验收 AI 调用记录页。');
    } else {
      await page.goto(activityUrl, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-embed="true"]').waitFor({ state: 'visible', timeout: 30_000 });
      await page.locator('main').waitFor({ state: 'visible', timeout: 10_000 });
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.getByRole('navigation', { name: '工坊产物阶段' }).waitFor({ state: 'visible', timeout: 30_000 });
      await page.waitForTimeout(1000);
      await assertWorkspaceNavigation(page, '工坊产物阶段');
      await page.screenshot({ path: resolve(outputDir, 'wide-1920.png'), fullPage: false });

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(400);
      await assertWorkspaceNavigation(page, '工坊产物阶段');
      await page.screenshot({ path: resolve(outputDir, 'desktop-1440.png'), fullPage: false });
      await assertNoPageOverflow(page, '桌面视口');

      await page.setViewportSize({ width: 768, height: 1024 });
      await page.waitForTimeout(600);
      await assertWorkspaceNavigation(page, '活动流程');
      await page.screenshot({ path: resolve(outputDir, 'tablet-768.png'), fullPage: false });
      await verifyStagePicker(page, 'tablet-768-stage-picker.png', 'tablet-768-stage-switched.png');
      await verifyCopilot(page, 'tablet-768-ai.png');
      await assertNoPageOverflow(page, '中屏视口');

      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(600);
      await assertWorkspaceNavigation(page, '活动流程');
      await page.screenshot({ path: resolve(outputDir, 'mobile-390.png'), fullPage: false });
      await verifyStagePicker(page, 'mobile-390-stage-picker.png', 'mobile-390-stage-switched.png');
      await verifyCopilot(page, 'mobile-390-ai.png');
      await verifyMobileBeatWorkbench(page, 'mobile-390-beat-workbench.png');
      await assertNoPageOverflow(page, '窄屏视口');
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await installAiLogFixtures(page);
    await page.goto(new URL('/settings/ai-logs?callId=sample-call-001', baseUrl).toString(), { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'AI 调用记录', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByRole('heading', { name: '生成产物' }).waitFor({ state: 'visible', timeout: 15_000 });
    const detailPanel = page.getByRole('region', { name: 'AI 调用详情', exact: true });
    await detailPanel.locator('img').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(outputDir, 'ai-logs-desktop-1440.png'), fullPage: false });
    await assertNoPageOverflow(page, 'AI 调用记录桌面视口');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(outputDir, 'ai-logs-mobile-390.png'), fullPage: false });
    await assertNoPageOverflow(page, 'AI 调用记录窄屏视口');

    if (pageErrors.length) throw new Error(`页面发生 ${pageErrors.length} 个未捕获异常，详见上方输出。`);
    if (consoleErrors.length) console.warn(`浏览器报告 ${consoleErrors.length} 条控制台错误，截图已保留，请结合页面检查。`);

    console.log(`Screenshots saved under ${outputDir}`);
  } finally {
    await browser.close();
  }
}

async function installAiLogFixtures(page) {
  const traceId = 'trace-demo-whole-text-job';
  const requestedAt = '2026-09-24T02:00:00.000Z';
  const firstCall = {
    id: 'sample-call-001', traceId, parentId: null, retryOf: null, applicationId: 'activities', feature: 'beat-render',
    businessEvent: 'activity.beat.render', objectType: 'activity-beat', objectId: 'sample-activity:stage-1:scene-1:beat-1',
    callType: 'image', status: 'succeeded', requestedAt, endedAt: '2026-09-24T02:00:18.000Z', durationMs: 18000,
    provider: 'comfyui', models: ['v1-5-pruned-emaonly-fp16.safetensors'], workflowId: 'sample-workflow', workflowVersion: 4,
    upstreamTaskId: 'sample-upstream-job', artifactIds: ['sample-image-001'], errorCode: null, error: null,
  };
  const secondCall = { ...firstCall, id: 'sample-call-002', businessEvent: 'activity.text.stage', callType: 'llm', status: 'failed',
    requestedAt: '2026-09-24T02:00:20.000Z', endedAt: '2026-09-24T02:00:21.000Z', durationMs: 1000,
    workflowId: null, workflowVersion: null, models: ['story-model'], artifactIds: [], errorCode: 'provider_timeout', error: '上游响应超时' };
  const longPrompt = `主体角色：爱丽丝，必须出现在画面中；银白长发、绿色眼睛，身穿蓝色旅行外套。\n可见动作：她正向朋友挥手，手臂和表情需要清楚可见。\n场景：午后的石板庭院，树影落在地面，远处是安静的木门。\n镜头构图：中景，角色完整入镜，主体位于画面中央，柔和自然光。\n${'请确保画面内容忠实于镜头描述，突出人物可见动作并保持环境细节清楚。'.repeat(32)}`;
  const detail = {
    ...firstCall,
    parameters: { seed: 308160, steps: 8, width: 512, height: 512 },
    positivePrompt: longPrompt,
    negativePrompt: null,
    requestSnapshot: { workflow: { '1': { class_type: 'CLIPTextEncode', inputs: { text: longPrompt } }, '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'v1-5-pruned-emaonly-fp16.safetensors' } } } },
    responseText: 'data: {"choices":[{"delta":{"content":"分镜文本已生成。"}}]}\n\ndata: [DONE]\n\n',
    usage: {}, sourceUrl: 'http://comfy.local/prompt', generationTaskId: 'sample-task-001',
    events: [
      { id: 1, createdAt: requestedAt, phase: 'requested', detail: { feature: 'beat-render' } },
      { id: 2, createdAt: '2026-09-24T02:00:01.000Z', phase: 'submitted', detail: { providerTaskId: 'sample-upstream-job' } },
      { id: 3, createdAt: '2026-09-24T02:00:18.000Z', phase: 'artifacts_attached', detail: { artifactIds: ['sample-image-001'] } },
    ],
    traceCalls: [
      { id: firstCall.id, businessEvent: firstCall.businessEvent, callType: firstCall.callType, status: firstCall.status, requestedAt: firstCall.requestedAt, endedAt: firstCall.endedAt, durationMs: firstCall.durationMs, models: firstCall.models, errorCode: null, error: null },
      { id: secondCall.id, businessEvent: secondCall.businessEvent, callType: secondCall.callType, status: secondCall.status, requestedAt: secondCall.requestedAt, endedAt: secondCall.endedAt, durationMs: secondCall.durationMs, models: secondCall.models, errorCode: secondCall.errorCode, error: secondCall.error },
    ],
    artifactDetails: [{ id: 'sample-image-001', sha256: 'e8a0c24b788c35aa9f449847c430af1baf851ee25e70091231f591cc490b48a2', available: true,
      previewUrl: '/api/admin/ai-calls/sample-call-001/artifacts/sample-image-001' }],
  };
  await page.route('**/api/admin/ai-calls/stats', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ databaseBytes: 2_400_000, walBytes: 64_000, totalBytes: 2_464_000, recordCount: 286, eventCount: 1_204 }) }));
  await page.route('**/api/admin/ai-calls/sample-call-001/artifacts/sample-image-001', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="#c9d8df"/><stop offset="1" stop-color="#e5cfa9"/></linearGradient></defs><rect width="960" height="540" fill="url(#g)"/><circle cx="750" cy="105" r="52" fill="#fff5d4"/><path d="M0 370 Q240 330 480 380 T960 355 V540 H0Z" fill="#879781"/><path d="M445 210 q55 -80 110 0 l42 220 h-195z" fill="#5274a4"/><circle cx="500" cy="160" r="47" fill="#efd4bb"/><path d="M455 155 q35 -90 95 -5" fill="none" stroke="#e7e5df" stroke-width="24"/><text x="480" y="500" text-anchor="middle" fill="#26313a" font-size="25" font-family="sans-serif">镜头候选预览 · 示例截图</text></svg>' }));
  await page.route('**/api/admin/ai-calls/sample-call-001', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) }));
  await page.route('**/api/admin/ai-calls?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [firstCall, secondCall], nextCursor: null }) }));
}

async function assertNoPageOverflow(page, label) {
  const state = await page.evaluate(() => ({
    width: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    offenders: Array.from(document.querySelectorAll('body *')).map((element) => {
      const rect = element.getBoundingClientRect();
      return { tag: element.tagName, className: typeof element.className === 'string' ? element.className : '',
        left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width),
        scrollWidth: element.scrollWidth, text: (element.textContent || '').trim().slice(0, 80) };
    }).filter((element) => element.right > window.innerWidth + 1 || element.left < -1 || element.scrollWidth > element.width + 2)
      .sort((a, b) => b.right - a.right).slice(0, 12),
  }));
  if (state.document > state.width + 1 || state.body > state.width + 1) {
    throw new Error(`${label}出现横向溢出：视口 ${state.width}px，文档 ${state.document}px，页面 ${state.body}px。元素：${JSON.stringify(state.offenders)}`);
  }
}

async function verifyCopilot(page, screenshotName) {
  const openAssistant = page.locator('header').getByRole('button', { name: '展开 AI 助手' });
  if (!(await openAssistant.isVisible())) return false;
  await openAssistant.click();
  await page.getByText('AI 创作伴侣').waitFor({ state: 'visible', timeout: 5_000 });
  await page.screenshot({ path: resolve(outputDir, screenshotName), fullPage: false });
  const close = page.locator('aside').getByRole('button', { name: '收起 AI 助手' });
  if (await close.isVisible()) await close.click();
  return true;
}

async function verifyMobileBeatWorkbench(page, screenshotName) {
  const beatCard = page.getByTestId('activity-beat-card').first();
  if (!(await beatCard.count())) throw new Error('窄屏视口没有可查看的镜头卡片。');
  await beatCard.click();
  await page.getByRole('region', { name: '当前镜头画面' }).waitFor({ state: 'visible', timeout: 5_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(outputDir, screenshotName), fullPage: false });
  await assertNoPageOverflow(page, '窄屏镜头工坊');
}

async function assertWorkspaceNavigation(page, accessibleName) {
  const navigation = page.getByRole('navigation', { name: accessibleName });
  await navigation.waitFor({ state: 'visible', timeout: 10_000 });
  const stepCount = await navigation.getByRole('button').count();
  if (stepCount !== 5) throw new Error(`预期显示 5 个工坊视图，实际为 ${stepCount}。`);
  const activeStepCount = await navigation.locator('button[aria-current="step"]').count();
  if (activeStepCount !== 1) throw new Error(`预期恰有一个当前步骤，实际为 ${activeStepCount}。`);
  const hasHorizontalOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth + 1
      || document.body.scrollWidth > window.innerWidth + 1,
  );
  if (hasHorizontalOverflow) throw new Error(`工作台在 ${window.innerWidth}px 视口出现横向溢出。`);
}

async function verifyStagePicker(page, openScreenshot, switchedScreenshot) {
  const picker = page.getByRole('button', { name: '切换幕' });
  if (!(await picker.isVisible())) return false;
  await picker.click();
  const options = page.getByRole('button', { name: /^第 \d+ 幕 ·/ });
  await options.first().waitFor({ state: 'visible', timeout: 5_000 });
  const count = await options.count();
  await page.screenshot({ path: resolve(outputDir, openScreenshot), fullPage: false });
  if (count < 2) {
    await picker.click();
    return false;
  }

  let activeIndex = -1;
  for (let index = 0; index < count; index += 1) {
    if (await options.nth(index).getAttribute('aria-pressed') === 'true') activeIndex = index;
  }
  const nextIndex = activeIndex === 0 ? 1 : 0;
  const nextStageLabel = await options.nth(nextIndex).innerText();
  const expectedTitle = nextStageLabel.replace(/^第 \d+ 幕 ·\s*/, '').trim();
  await options.nth(nextIndex).click();
  const stagePicker = page.getByRole('button', { name: '切换幕' });
  await expect(stagePicker).toHaveAttribute('aria-expanded', 'false');
  if (expectedTitle) await expect(page.locator('main h2').first()).toContainText(expectedTitle);
  await page.screenshot({ path: resolve(outputDir, switchedScreenshot), fullPage: false });
  return true;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
