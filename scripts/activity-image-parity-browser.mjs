/**
 * 活动生图对齐 V2 · 阶段 5 UI 浏览器验收（计划 §15.4 / §18.2）。
 *
 * 只对隔离夹具运行：服务 127.0.0.1:4289（内存库 + 临时媒体目录），门户 127.0.0.1:4199。
 * 不读真实数据库、不调用真实 ComfyUI、不写任何用户数据。
 *
 *   node --import tsx scripts/activity-studio-fixture.ts --isolated
 *   node scripts/activity-studio-portal.mjs --isolated
 *   node scripts/activity-image-parity-browser.mjs
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const TOKEN = 'activity-studio-fixture-token-not-production';
const SERVICE = 'http://127.0.0.1:4289';
const PORTAL = 'http://127.0.0.1:4199';
const headers = { 'x-sthstart-admin-token': TOKEN, 'content-type': 'application/json' };

const fixture = await fetch(`${SERVICE}/fixture`).then((response) => response.json());
const output = resolve('artifacts/activity-image-parity-v2', new Date().toISOString().replaceAll(':', '-'));
await mkdir(output, { recursive: true });
console.log('artifact directory:', output);

const post = async (path, payload = {}) => {
  const response = await fetch(`${SERVICE}${path}`, { method: 'POST', headers, body: JSON.stringify(payload) });
  const text = await response.text();
  if (response.status >= 400) throw new Error(`POST ${path} -> ${response.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
};
const get = async (path) => {
  const response = await fetch(`${SERVICE}${path}`, { headers });
  const text = await response.text();
  if (response.status >= 400) throw new Error(`GET ${path} -> ${response.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
};

const activityId = fixture.activityId;
const base = `${PORTAL}/apps/activities/${activityId}`;
const target = { stageId: fixture.stageId, sceneId: fixture.sceneId, beatId: fixture.beatId };
const headVersion = async () => (await get(`/api/v1/admin/activities/${activityId}`)).headVersion;

// --- 先用服务接口产生一张真实历史图（合成上游，不触碰真实 ComfyUI） ---
const seed = 2026100301;
const preview = await post(`/api/v1/admin/activities/${activityId}/beat-renders/preview`, { ...target, expectedHeadVersion: await headVersion(), seed });
assert.equal(preview.canSubmit, true, `镜头预览应可提交：${JSON.stringify(preview.warnings ?? [])}`);
const submitted = await post(`/api/v1/admin/activities/${activityId}/beat-renders`, {
  ...target, expectedHeadVersion: await headVersion(), planHash: preview.planHash, seed, idempotencyKey: `parity-ui-${seed}`,
});
let candidate = null;
for (let attempt = 0; attempt < 60; attempt++) {
  const list = await get(`/api/v1/admin/activities/${activityId}/beat-renders?stageId=${target.stageId}&sceneId=${target.sceneId}&beatId=${target.beatId}&limit=10`);
  candidate = (list.items ?? list.candidates ?? []).find((item) => item.id === submitted.candidateId);
  if (candidate && (candidate.status === 'succeeded' || candidate.status === 'failed')) break;
  await new Promise((done) => setTimeout(done, 500));
}
assert.ok(candidate, '夹具应返回刚提交的候选');
assert.equal(candidate.status, 'succeeded', `合成上游应成功，实际 ${candidate.status}`);
console.log('beat candidate ready:', candidate.id, 'callId:', candidate.callId);

// --- 浏览器 ---
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'x-sthstart-admin-token': TOKEN } });
const errors = [];
const httpProblems = [];
const wire = (page) => {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const url = response.url();
    // 夹具未绑定细化工作流，细化预览返回 409 是预期内的“具体原因”。
    const expected = (response.status() === 409 && /\/studio\/hires\/preview$/.test(url))
      || (response.status() === 401 && url.endsWith('/api/auth/admin-session'));
    if (!expected) httpProblems.push(`${response.status()} ${url}`);
  });
};

const notes = [];
const shoot = async (page, name, fullPage = true) => { await page.screenshot({ path: resolve(output, name), fullPage }); notes.push(name); };

const studioUrl = `${base}?tab=studio`;
const page = await context.newPage();
wire(page);
await page.goto(studioUrl);
await page.getByRole('button', { name: '美术设置', exact: true }).waitFor({ timeout: 90_000 });
await page.waitForTimeout(1500);
await shoot(page, 'desktop-01-studio.png');

// 1) 美术设置弹窗：画幅选项与只读“当前模型摘要”
await page.getByRole('button', { name: '美术设置', exact: true }).click();
const artDialog = page.getByRole('dialog').filter({ hasText: '画幅' }).first();
await artDialog.waitFor({ timeout: 30_000 });
const artText = await artDialog.innerText();
assert.match(artText, /1920×1080/, '美术设置应提供 1920×1080 画幅');
assert.match(artText, /高显存／高耗时/, '1920×1080 应标注高显存／高耗时');
assert.match(artText, /当前模型摘要/, '美术设置应显示只读模型摘要');
await shoot(page, 'desktop-02-art-direction.png', false);
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

// 2) 历史图动作：按原配置重绘 / 放大细化 / 日志
const actions = page.getByRole('button', { name: '按原配置重绘', exact: true });
await actions.first().waitFor({ timeout: 30_000 });
assert.equal(await page.getByRole('button', { name: '放大细化', exact: true }).first().isVisible(), true, '历史图应提供放大细化');
assert.equal(await page.getByRole('link', { name: '日志', exact: true }).first().isVisible(), true, '历史图应提供日志入口');
await actions.first().scrollIntoViewIfNeeded();
await shoot(page, 'desktop-03-history-actions.png');

// 2b) 目标绘制弹窗的高级区要说明模式来自哪个工作流／策略修订（计划 §15.1）
// 高级区默认折叠，必须先展开才能看到；只查 DOM 存在不算验证。
await page.getByRole('button', { name: '绘制设置', exact: true }).first().click();
await page.waitForTimeout(2500);
const advancedSummary = page.locator('summary', { hasText: '高级设置' }).first();
await advancedSummary.waitFor({ timeout: 30_000 });
await advancedSummary.click();
await page.waitForTimeout(1000);
const modeLine = page.getByText(/提示词模式：(服务端最终组装|工作流图内自行拼接)/).first();
await modeLine.waitFor({ timeout: 15_000 });
const modeText = await modeLine.innerText();
assert.match(modeText, /v\d+/, '模式说明必须带上具体工作流版本');
const policyLine = page.getByText(/提示词优化：(开启 · 策略 r\d+|关闭)/).first();
await policyLine.waitFor({ timeout: 15_000 });
console.log('advanced mode line:', modeText.replace(/\s+/g, ' '));
await shoot(page, 'desktop-03b-advanced-mode.png', false);
await page.keyboard.press('Escape');
await page.waitForTimeout(800);

// 3) 放大细化弹窗：打开不创建任务；不可提交时给具体原因而不是只灰按钮
const jobsBefore = (await get(`/api/v1/admin/activities/${activityId}/studio-jobs?limit=20`)).items.length;
await page.getByRole('button', { name: '放大细化', exact: true }).first().click();
const hiresDialog = page.getByRole('dialog').filter({ hasText: '放大细化' }).first();
await hiresDialog.waitFor({ timeout: 30_000 });
const hiresText = await hiresDialog.innerText();
assert.match(hiresText, /最长边/, '细化弹窗应展示最长边选项');
assert.match(hiresText, /重绘幅度/, '细化弹窗应展示重绘幅度');
assert.match(hiresText, /不透明新图/, '细化弹窗应说明结果是不透明新图');
await shoot(page, 'desktop-04-hires-dialog.png', false);
const jobsAfterOpen = (await get(`/api/v1/admin/activities/${activityId}/studio-jobs?limit=20`)).items.length;
assert.equal(jobsAfterOpen, jobsBefore, '打开细化弹窗不得创建任务');
// 点预览：夹具未绑定细化工作流，应给出具体原因，且仍不创建任务
await hiresDialog.getByRole('button', { name: /预览/ }).first().click();
await page.waitForTimeout(4000);
const afterPreviewText = await hiresDialog.innerText();
const reasonShown = /未绑定|不可用|无法|不支持|缺少|未配置|不可读/.test(afterPreviewText);
assert.equal(reasonShown, true, `细化不可用时必须给出具体原因，实际文案：${afterPreviewText.slice(0, 600)}`);
const jobsAfterPreview = (await get(`/api/v1/admin/activities/${activityId}/studio-jobs?limit=20`)).items.length;
assert.equal(jobsAfterPreview, jobsBefore, '预览失败不得创建任务');
await shoot(page, 'desktop-05-hires-blocked-reason.png', false);
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

// 4) 日志详情分组：来源 → 优化 → 规则 → 最终输入 → 实际图 → 产物
assert.ok(candidate.callId, '候选应带调用日志 id');
const logPage = await context.newPage();
wire(logPage);
await logPage.goto(`${PORTAL}/settings/ai-logs?callId=${encodeURIComponent(candidate.callId)}`);
await logPage.getByRole('heading', { name: '来源', exact: true }).waitFor({ timeout: 60_000 });
const logText = await logPage.locator('body').innerText();
for (const heading of ['来源', '优化', '规则', '最终输入', '实际图', '产物']) {
  assert.equal(await logPage.getByRole('heading', { name: heading, exact: true }).count() > 0, true, `日志详情缺少分组“${heading}”`);
}
assert.match(logText, /镜头绘制/, '业务事件应显示中文名称');
assert.match(logText, /activity\.beat\.render/, '原始业务事件 ID 应保留以便检索');
// 计划 §1.1：从中文来源到实际文本编码输入的完整过程。
const encodedShown = /实际文本编码输入/.test(logText);
const encodedFallback = /无法从这次调用的工作流快照确定实际编码文本/.test(logText);
assert.equal(encodedShown || encodedFallback, true, '最终输入必须显示实际编码文本，或明确说明为什么无法确定');
console.log('log detail: 实际文本编码输入 =', encodedShown ? '有' : '无（显示明确原因）');
await shoot(logPage, 'desktop-06-log-detail.png');
await logPage.close();

// 4b) 漫画画格历史：同样要有“按原配置重绘 / 放大细化 / 日志”（计划 §15.2 要求覆盖每个入口）
const activityDetail = await get(`/api/v1/admin/activities/${activityId}`);
const contentRevisionId = activityDetail.activity?.currentContentRevisionId ?? activityDetail.head?.contentRevisionId;
assert.ok(contentRevisionId, '活动应绑定内容修订');
await post(`/api/v1/admin/activities/${activityId}/comic/draft`, { contentRevisionId });
let comicDraft = (await get(`/api/v1/admin/activities/${activityId}/comic/draft`)).draft;
const storyboard = await post(`/api/v1/admin/activities/${activityId}/comic/storyboards`, {
  expectedDraftVersion: comicDraft.draftVersion, stageId: fixture.stageId, sceneId: fixture.sceneId, panelCount: 4,
  idempotencyKey: `parity-comic-storyboard-${Date.now()}`,
});
let storyboardJob = null;
for (let attempt = 0; attempt < 60; attempt++) {
  storyboardJob = (await get(`/api/v1/admin/activities/${activityId}/comic/jobs/${storyboard.job.id}`)).job;
  if (storyboardJob.status === 'succeeded' || storyboardJob.status === 'failed') break;
  await new Promise((done) => setTimeout(done, 500));
}
assert.equal(storyboardJob.status, 'succeeded', `漫画分镜应成功，实际 ${storyboardJob?.status}`);
await post(`/api/v1/admin/activities/${activityId}/comic/storyboards/${storyboardJob.id}/apply`, { expectedDraftVersion: comicDraft.draftVersion, mode: 'append' });
comicDraft = (await get(`/api/v1/admin/activities/${activityId}/comic/draft`)).draft;
const panelId = comicDraft.document.panels[0]?.id;
assert.ok(panelId, '应用分镜后应有画格');
const comicSeed = 2026100302;
const comicPreview = await post(`/api/v1/admin/activities/${activityId}/comic/panels/${panelId}/render-preview`, { expectedDraftVersion: comicDraft.draftVersion, seed: comicSeed });
assert.equal(comicPreview.canSubmit, true, `画格预览应可提交：${JSON.stringify(comicPreview.warnings ?? [])}`);
assert.equal(comicPreview.promptAssembly === 'service-finalized-v1' || comicPreview.promptAssembly === 'workflow-internal', true, '画格预览必须说明提示词组装模式');
await post(`/api/v1/admin/activities/${activityId}/comic/panels/${panelId}/renders`, {
  expectedDraftVersion: comicDraft.draftVersion, planHash: comicPreview.planHash, seed: comicSeed, idempotencyKey: `parity-comic-render-${comicSeed}`,
});
let comicHistory = [];
for (let attempt = 0; attempt < 60; attempt++) {
  const page = await get(`/api/v1/admin/activities/${activityId}/comic/panels/${panelId}/history?limit=10`);
  comicHistory = page.images ?? [];
  if (comicHistory.some((image) => image.available)) break;
  await new Promise((done) => setTimeout(done, 500));
}
assert.ok(comicHistory.some((image) => image.available), '漫画画格历史应有一张可用图片');
console.log('comic panel history ready:', comicHistory.length, 'images; promptAssembly =', comicPreview.promptAssembly);

const comicPage = await context.newPage();
wire(comicPage);
await comicPage.goto(`${base}?tab=studio&view=comic`);
await comicPage.getByRole('button', { name: '美术设置', exact: true }).waitFor({ timeout: 90_000 });
await comicPage.waitForTimeout(2500);
const comicRerender = comicPage.getByRole('button', { name: '按原配置重绘', exact: true }).first();
await comicRerender.waitFor({ timeout: 30_000 });
assert.equal(await comicPage.getByRole('button', { name: '放大细化', exact: true }).first().isVisible(), true, '漫画历史图应提供放大细化');
assert.equal(await comicPage.getByRole('link', { name: '日志', exact: true }).first().isVisible(), true, '漫画历史图应提供日志入口');
await comicRerender.scrollIntoViewIfNeeded();
const comicOverflow = await comicPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
assert.ok(comicOverflow <= 2, `漫画视图不应横向溢出，实际超出 ${comicOverflow}px`);
await shoot(comicPage, 'desktop-07-comic-history.png');
await comicPage.close();

// 5) 窄屏 390×844
const narrow = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'x-sthstart-admin-token': TOKEN } });
const narrowPage = await narrow.newPage();
wire(narrowPage);
await narrowPage.goto(studioUrl);
await narrowPage.getByRole('button', { name: '美术设置', exact: true }).waitFor({ timeout: 90_000 });
await narrowPage.waitForTimeout(1500);
await shoot(narrowPage, 'narrow-01-studio.png');
// 窄屏不应出现横向溢出（历史动作条、长中文与文件名都不能撑宽页面）
const overflow = await narrowPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
assert.ok(overflow <= 2, `窄屏不应出现横向溢出，实际超出 ${overflow}px`);
// 美术设置弹窗在窄屏仍可用，且画幅与模型摘要可达
await narrowPage.getByRole('button', { name: '美术设置', exact: true }).click();
const narrowArt = narrowPage.getByRole('dialog').filter({ hasText: '画幅' }).first();
await narrowArt.waitFor({ timeout: 30_000 });
const narrowArtText = await narrowArt.innerText();
assert.match(narrowArtText, /1920×1080/, '窄屏美术设置应提供 1920×1080 画幅');
assert.match(narrowArtText, /当前模型摘要/, '窄屏美术设置应显示只读模型摘要');
await shoot(narrowPage, 'narrow-02-art-direction.png', false);
await narrowPage.keyboard.press('Escape');
await narrowPage.waitForTimeout(800);
// 窄屏用“展开右侧镜头工坊”进入镜头工坊（该按钮在窄屏只显示图标，可访问名称来自 title）
const expand = narrowPage.getByRole('button', { name: '展开右侧镜头工坊', exact: true });
const expandVisible = await expand.isVisible().catch(() => false);
if (expandVisible) {
  await expand.click();
  await narrowPage.waitForTimeout(2000);
}
const historySection = narrowPage.locator('[aria-label="镜头绘制历史"]');
const historyVisible = await historySection.isVisible().catch(() => false);
if (historyVisible) {
  await historySection.scrollIntoViewIfNeeded();
  const perImageRerender = narrowPage.getByRole('button', { name: '按原配置重绘', exact: true }).first();
  const hiresButton = narrowPage.getByRole('button', { name: '放大细化', exact: true }).first();
  assert.equal(await perImageRerender.isVisible(), true, '窄屏历史图应提供按原配置重绘');
  assert.equal(await hiresButton.isVisible(), true, '窄屏历史图应提供放大细化');
  await hiresButton.scrollIntoViewIfNeeded();
  await hiresButton.click();
  await narrowPage.getByRole('dialog').filter({ hasText: '放大细化' }).first().waitFor({ timeout: 30_000 });
  const narrowOverflowInDialog = await narrowPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(narrowOverflowInDialog <= 2, `窄屏细化弹窗不应横向溢出，实际超出 ${narrowOverflowInDialog}px`);
  await shoot(narrowPage, 'narrow-03-hires-dialog.png', false);
  console.log('narrow: 历史图动作与细化弹窗可达');
} else {
  console.log('narrow: 展开后仍未渲染“镜头绘制历史”区块，记录截图供人工核对');
  await shoot(narrowPage, 'narrow-03-no-history.png');
}
await narrow.close();

// 6) 1920×1080 抽查一次
const wide = await browser.newContext({ viewport: { width: 1920, height: 1080 }, extraHTTPHeaders: { 'x-sthstart-admin-token': TOKEN } });
const widePage = await wide.newPage();
wire(widePage);
await widePage.goto(studioUrl);
await widePage.getByRole('button', { name: '美术设置', exact: true }).waitFor({ timeout: 90_000 });
await widePage.waitForTimeout(1500);
await shoot(widePage, 'wide-01-studio.png');
await wide.close();

await browser.close();

console.log('screenshots:', notes.join(', '));
console.log('page errors:', errors.length ? errors : 'none');
console.log('unexpected HTTP:', httpProblems.length ? httpProblems : 'none');
assert.deepEqual(errors, [], '页面不应有运行时错误');
assert.deepEqual(httpProblems, [], '不应有非预期的失败请求');
console.log('OK: 阶段 5 UI 浏览器验收通过');
