import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const fixture = await fetch('http://127.0.0.1:4289/fixture').then(response => response.json());
const output = resolve('artifacts/activity-studio-abc', new Date().toISOString().replaceAll(':','-'));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 },
  extraHTTPHeaders: { 'x-sthstart-admin-token': 'activity-studio-fixture-token-not-production' } });
const page = await context.newPage();
const errors = [];
const unexpectedHttp = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
  if (response.status() < 400) return;
  const expected = response.status() === 401 && response.url().endsWith('/api/auth/admin-session')
    || response.status() === 503 && response.url().endsWith('/draft')
    || response.status() === 409 && /\/art-direction\/commit$|\/draft$/.test(response.url());
  if (!expected) unexpectedHttp.push(`${response.status()} ${response.url()}`);
  console.log('HTTP:', response.status(), response.url());
});
page.on('console', message => { if (message.type() === 'error') console.log('BROWSER:', message.text().slice(0, 500)); });
const path = `http://127.0.0.1:4199/apps/activities/${fixture.activityId}`;
try {
  await page.goto(`${path}?tab=script&stageId=${fixture.stageId}&sceneId=${fixture.sceneId}&beatId=${fixture.beatId}`);
  await page.getByRole('button', { name: '美术设置', exact: true }).waitFor({ timeout: 60000 });
  await page.waitForFunction(() => new URL(location.href).searchParams.get('tab') === 'studio');
  await page.screenshot({ path: resolve(output, 'desktop-studio.png'), fullPage: true });
  console.log('BODY:', (await page.locator('body').innerText()).slice(0, 5000));
  assert.equal(new URL(page.url()).searchParams.get('beatId'), fixture.beatId);
  const createPage = await context.newPage();
  const createReady = createPage.waitForResponse(response => response.url().endsWith('/api/admin/story/projects') && response.request().method() === 'GET');
  await createPage.goto('http://127.0.0.1:4199/apps/activities/new');
  await createReady;
  await createPage.getByText('空白画卷起步', { exact: true }).click();
  await createPage.getByRole('button', { name: '直接开启空白工坊', exact: true }).click();
  await createPage.waitForURL(/\/apps\/activities\/[a-f0-9-]+(?:\?|$)/);
  await createPage.getByRole('button', { name: '活动设置', exact: true }).waitFor();
  await createPage.screenshot({ path: resolve(output, 'desktop-new-activity.png'), fullPage: true });
  await createPage.close();
  await page.getByRole('button', { name: '美术设置', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.screenshot({ path: resolve(output, 'desktop-art-direction.png'), fullPage: true });
  console.log('DIALOG:', await page.getByRole('dialog').innerText());
  if (process.argv.includes('--inspect')) { console.log(JSON.stringify({ output, errors })); }
  else {
    const art = page.getByRole('dialog');
    await art.getByRole('textbox').first().fill('temporary-art-direction');
    await page.route('**/art-direction/commit', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'revision_conflict', message: '模拟版本冲突；输入必须保留' }) }));
    await art.getByRole('button', { name: '保存并应用', exact: true }).click();
    await art.getByText('模拟版本冲突；输入必须保留', { exact: true }).waitFor();
    assert.equal(await art.getByRole('textbox').first().inputValue(), 'temporary-art-direction');
    await page.unroute('**/art-direction/commit');
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('dialog', { name: '放弃未应用的美术设置？', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await art.getByRole('textbox').first().inputValue(), 'temporary-art-direction');
    await art.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('dialog', { name: '放弃未应用的美术设置？', exact: true }).getByRole('button', { name: '放弃修改', exact: true }).click();
    await page.getByRole('button', { name: '绘制设置', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('高级设置：负向词、参考图、种子与采样参数', { exact: true }).click();
    await dialog.getByRole('spinbutton', { name: '宽度', exact: true }).waitFor();
    await page.screenshot({ path: resolve(output, 'desktop-drawing-settings.png'), fullPage: true });
    await dialog.getByRole('spinbutton', { name: '宽度', exact: true }).fill('1000');
    await dialog.getByRole('button', { name: '绘制新图', exact: true }).click();
    await dialog.getByText('请先将数值参数填写为工作流允许的值。', { exact: true }).waitFor();
    await dialog.getByRole('spinbutton', { name: '宽度', exact: true }).fill('1280');
    await dialog.getByRole('button', { name: '完成', exact: true }).click();
    const history = page.getByLabel('历史图片缩略图', { exact: true });
    const oldCount = await history.getByRole('button').count();
    await page.getByRole('button', { name: '绘制新图', exact: true }).click();
    await assertEventually(async () => (await history.getByRole('button').count()) > oldCount);
    await page.getByRole('img', { name: '当前镜头画面', exact: true }).waitFor({ timeout: 60000 });
    const firstImage = await page.getByRole('img', { name: '当前镜头画面', exact: true }).getAttribute('src');
    const firstCount = await history.getByRole('button').count();
    await page.getByRole('button', { name: '绘制新图', exact: true }).click();
    await assertEventually(async () => (await history.getByRole('button').count()) > firstCount);
    assert.equal(await page.getByRole('img', { name: '当前镜头画面', exact: true }).getAttribute('src'), firstImage, 'Further renders must not replace the current image');
    await history.getByRole('button', { name: /^新图，/ }).first().click();
    await assertEventually(async () => (await page.getByRole('img', { name: '当前镜头画面', exact: true }).getAttribute('src')) !== firstImage);
    await history.getByRole('button', { name: /^当前，/ }).click();
    await page.getByTestId('activity-beat-card').nth(1).click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get('beatId') === 'beat-two');
    await page.goBack();
    await page.waitForFunction(() => new URL(location.href).searchParams.get('beatId') === 'beat-test');
    await page.screenshot({ path: resolve(output, 'desktop-drawing-completed.png'), fullPage: true });
    await page.getByRole('button', { name: '剧情记录', exact: true }).click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get('view') === 'records');
    await page.getByRole('button', { name: '更多视图', exact: true }).click();
    await page.getByRole('button', { name: /^朋友圈/ }).click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get('recordView') === 'moments');
    await page.goBack();
    await page.waitForFunction(() => new URL(location.href).searchParams.get('recordView') === 'chat');
    await page.getByRole('button', { name: '素材制作', exact: true }).click();
    await page.getByRole('button', { name: '绘制图片', exact: true }).click();
    const media = page.getByRole('dialog', { name: '素材绘制', exact: true });
    await media.getByRole('button', { name: '详细配置与提示词来源', exact: true }).click();
    await media.getByRole('spinbutton', { name: '宽度', exact: true }).waitFor();
    await media.getByRole('combobox', { name: '素材绘制品质', exact: true }).selectOption('final');
    await media.getByText('base.safetensors', { exact: true }).waitFor();
    await page.screenshot({ path: resolve(output, 'desktop-material-settings.png'), fullPage: true });
    await media.getByRole('button', { name: '关闭抽屉', exact: true }).click();
    await media.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: /^从资产库挑选/ }).click();
    await page.getByRole('dialog', { name: '选择绑定素材', exact: true }).getByText('fixture-image', { exact: true }).click();
    await page.getByRole('dialog', { name: '选择绑定素材', exact: true }).getByRole('button', { name: '完成选择', exact: true }).click();
    await page.getByRole('button', { name: '漫画', exact: true }).click();
    await page.getByRole('button', { name: /^(手工新增页面|＋ 新增页)$/ }).first().waitFor();
    const firstPage = page.getByRole('button', { name: '手工新增页面', exact: true });
    if (await firstPage.isVisible()) await firstPage.click();
    else await page.getByRole('button', { name: '＋ 新增页', exact: true }).click();
    await page.getByRole('button', { name: '保存漫画版本', exact: true }).waitFor();
    await page.screenshot({ path: resolve(output, 'desktop-comic.png'), fullPage: true });
    await page.getByRole('button', { name: '阅读与演播', exact: true }).first().click();
    await page.getByRole('button', { name: '漫画阅读', exact: true }).click();
    await page.getByText('漫画逐格阅读', { exact: true }).waitFor();
    await page.screenshot({ path: resolve(output, 'desktop-comic-reading.png'), fullPage: true });
    await page.getByRole('button', { name: '资产与交付', exact: true }).first().click();
    await page.getByRole('button', { name: '活动画廊', exact: true }).click();
    await page.getByRole('img', { name: 'fixture-image', exact: true }).waitFor();
    await page.getByRole('button', { name: '创作工坊', exact: true }).first().click();
    await page.getByRole('button', { name: '分镜', exact: true }).click();
    await page.getByRole('button', { name: '绘制设置', exact: true }).waitFor();
    const logHref = await page.getByRole('link', { name: /调用日志/ }).first().getAttribute('href');
    assert.ok(logHref?.includes('callId='));
    const logPage = await context.newPage();
    await logPage.goto(`http://127.0.0.1:4199${logHref}`);
    await logPage.getByText('AI 调用记录', { exact: true }).first().waitFor();
    await logPage.screenshot({ path: resolve(output, 'desktop-call-log.png'), fullPage: true });
    await logPage.close();
    await page.getByRole('button', { name: '绘制设置', exact: true }).waitFor();
    await page.getByRole('button', { name: '编辑场次', exact: true }).click();
    const scene = page.getByRole('dialog', { name: '编辑场次', exact: true });
    await scene.getByRole('textbox', { name: '场次标题', exact: true }).fill('雪山实验 · 场次编辑验证');
    await scene.getByRole('button', { name: '应用修改', exact: true }).click();
    await page.getByText('雪山实验 · 场次编辑验证', { exact: true }).waitFor();
    await page.getByRole('button', { name: '编辑镜头内容', exact: true }).click();
    const beatEditor = page.getByRole('dialog', { name: '编辑镜头', exact: true });
    const action = beatEditor.getByRole('textbox', { name: '动作 / 发生事件', exact: true });
    const originalAction = await action.inputValue();
    await page.route(`**/activities/${fixture.activityId}/draft`, route => route.request().method() === 'PUT'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'test_save_failure', message: '模拟断网保存失败' }) }) : route.continue());
    await action.fill(`${originalAction}（本地保存保护验证）`);
    await beatEditor.getByRole('button', { name: '完成', exact: true }).click();
    await page.getByText('保存失败', { exact: true }).waitFor();
    await page.getByRole('button', { name: '素材制作', exact: true }).click();
    assert.equal(new URL(page.url()).searchParams.get('view'), 'storyboard');
    await page.getByRole('button', { name: '编辑镜头内容', exact: true }).click();
    assert.equal(await action.inputValue(), `${originalAction}（本地保存保护验证）`);
    await beatEditor.getByRole('button', { name: '完成', exact: true }).click();
    await page.unroute(`**/activities/${fixture.activityId}/draft`);
    await page.getByRole('button', { name: '重试保存', exact: true }).click();
    await page.getByText('已保存', { exact: true }).waitFor();
    await page.getByRole('button', { name: '阅读与演播', exact: true }).first().click();
    await page.getByRole('button', { name: '活动回放', exact: true }).click();
    await page.screenshot({ path: resolve(output, 'desktop-activity-playback.png'), fullPage: true });
    await page.getByRole('button', { name: '资产与交付', exact: true }).first().click();
    await page.getByRole('button', { name: '导出', exact: true }).click();
    await page.screenshot({ path: resolve(output, 'desktop-delivery.png'), fullPage: true });
    await page.getByRole('button', { name: '创作工坊', exact: true }).first().click();
    await page.getByRole('button', { name: '分镜', exact: true }).click();
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      if (viewport.width === 390) {
        await page.waitForFunction(() => {
          const card = document.querySelector('[data-testid="activity-beat-card"]');
          return card && card.getBoundingClientRect().width > 300;
        });
        await page.getByTestId('activity-beat-card').first().click();
        await page.getByRole('button', { name: '绘制设置', exact: true }).waitFor();
      }
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: resolve(output, `studio-${viewport.width}.png`), fullPage: true });
      const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(dimensions.scroll <= dimensions.width + 1, `Page overflow at ${viewport.width}: ${JSON.stringify(dimensions)}`);
    }
    await page.getByRole('button', { name: '美术设置', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.screenshot({ path: resolve(output, 'mobile-art-direction.png'), fullPage: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpectedHttp, []);
    console.log(JSON.stringify({ output, errors, passed: true }));
  }
} catch (error) {
  console.log('FAILURE BODY:', (await page.locator('body').innerText()).slice(0, 12000));
  await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true });
  throw error;
} finally { await browser.close(); }

async function assertEventually(check) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) { if (await check()) return; await page.waitForTimeout(100); }
  assert.fail('Expected UI state was not reached in 60 seconds');
}
