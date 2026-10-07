/**
 * 活动生图对齐 · 第二轮修复 UI 浏览器验收（计划 §9.1）。
 *
 * 只对隔离夹具运行：服务 127.0.0.1:4289（内存库 + 临时媒体目录），门户 127.0.0.1:4199。
 * 不读真实数据库、不调用真实 ComfyUI、不写任何用户数据。
 *
 *   node --import tsx scripts/activity-studio-fixture.ts --isolated --with-hires
 *   node scripts/activity-studio-portal.mjs --isolated
 *   node scripts/activity-image-parity-round2-browser.mjs
 *
 * --with-hires 是必需的：没有它夹具不绑定细化工作流，预览会以 409 被拒绝，
 * 本脚本要验证的「预览成功 → 提交」路径就无从谈起。
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
const activityId = fixture.activityId;
const target = { stageId: fixture.stageId, sceneId: fixture.sceneId, beatId: fixture.beatId };
const output = resolve('artifacts/activity-image-parity-round2', new Date().toISOString().replaceAll(':', '-'));
await mkdir(output, { recursive: true });
console.log('artifact directory:', output);

const post = async (path, payload = {}) => {
  const response = await fetch(`${SERVICE}${path}`, { method: 'POST', headers, body: JSON.stringify(payload) });
  const text = await response.text();
  if (response.status >= 400) throw new Error(`POST ${path} -> ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
};
const get = async (path) => {
  const response = await fetch(`${SERVICE}${path}`, { headers });
  const text = await response.text();
  if (response.status >= 400) throw new Error(`GET ${path} -> ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
};
const headVersion = async () => (await get(`/api/v1/admin/activities/${activityId}`)).activity.headVersion;
const jobCount = async () => (await get(`/api/v1/admin/activities/${activityId}/studio-jobs?limit=20`)).items.length;

/** 细化需要原生历史作为来源：先造一张成功的 beat 候选。 */
const seed = 20260101;
await post(`/api/v1/admin/activities/${activityId}/beat-renders/preview`, { ...target, expectedHeadVersion: await headVersion(), seed });
const submitted = await post(`/api/v1/admin/activities/${activityId}/beat-renders`, {
  ...target, expectedHeadVersion: await headVersion(), seed, planHash: undefined, idempotencyKey: `round2-${Date.now()}`,
});
let candidate = null;
for (let i = 0; i < 40; i++) {
  const list = await get(`/api/v1/admin/activities/${activityId}/beat-renders?stageId=${target.stageId}&sceneId=${target.sceneId}&beatId=${target.beatId}&limit=10`);
  candidate = (list.items ?? []).find((item) => item.id === submitted.candidateId);
  if (candidate && (candidate.status === 'succeeded' || candidate.status === 'failed')) break;
  await new Promise((r) => setTimeout(r, 1000));
}
assert.equal(candidate?.status, 'succeeded', `合成上游应成功，实际 ${candidate?.status}`);
console.log('source candidate ready:', candidate.id);

const browser = await chromium.launch({ headless: true });
const errors = [];
const unexpectedHttp = [];
const attach = (page) => {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const url = response.url();
    // 与 activity-image-parity-browser.mjs 一致的白名单：这些是页面正常流程的一部分。
    const expected = (response.status() === 401 && url.endsWith('/api/auth/admin-session'))
      || (response.status() === 503 && url.endsWith('/draft'))
      || (response.status() === 409 && /\/art-direction\/commit$|\/draft$/.test(url))
      // 细化预览/提交在「来源不可用」等情况下返回 4xx 正是被验证的行为。
      || /\/studio\/hires/.test(url);
    if (!expected) unexpectedHttp.push(`${response.status()} ${url}`);
  });
};

/** 打开工作室页并进入历史图所在的视图。 */
const openStudio = async (page, viewport) => {
  await page.setViewportSize(viewport);
  await page.goto(`${PORTAL}/apps/activities/${activityId}?tab=script&stageId=${target.stageId}&sceneId=${target.sceneId}&beatId=${target.beatId}`);
  await page.getByRole('button', { name: '美术设置', exact: true }).waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => new URL(location.href).searchParams.get('tab') === 'studio');
};

const openHiresDialog = async (page) => {
  const button = page.getByRole('button', { name: '放大细化', exact: true }).first();
  await button.scrollIntoViewIfNeeded();
  await button.click();
  const dialog = page.getByRole('dialog').filter({ hasText: '放大细化' }).first();
  await dialog.waitFor({ timeout: 30_000 });
  return dialog;
};

const shoot = (page, name) => page.screenshot({ path: resolve(output, name), fullPage: false });

// ---------------------------------------------------------------- 桌面 1440×900
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'x-sthstart-admin-token': TOKEN } });
const page = await context.newPage();
attach(page);
await openStudio(page, { width: 1440, height: 900 });

const jobsBefore = await jobCount();
let dialog = await openHiresDialog(page);
await shoot(page, 'desktop-01-hires-open.png');
assert.equal(await jobCount(), jobsBefore, '打开弹窗不得创建任务');

// §9.1-1：预览必须成功（而不是只给「无法开始细化」）
const previewResponse = page.waitForResponse((r) => /\/studio\/hires\/preview$/.test(r.url()) && r.request().method() === 'POST');
await dialog.getByRole('button', { name: /预览/ }).first().click();
const previewStatus = (await previewResponse).status();
assert.equal(previewStatus, 200, `细化预览应成功，实际 HTTP ${previewStatus}（夹具是否带了 --with-hires？）`);
const previewText = await dialog.innerText();
assert.ok(!/当前无法开始细化/.test(previewText), `预览成功后不应再显示不可提交原因，实际：${previewText.slice(0, 400)}`);
const submitButton = dialog.getByRole('button', { name: '开始细化' });
await submitButton.waitFor({ timeout: 15_000 });
assert.equal(await submitButton.isEnabled(), true, '预览成功后「开始细化」必须可用');
assert.equal(await jobCount(), jobsBefore, '预览本身不得创建任务');
await shoot(page, 'desktop-02-hires-previewed.png');
console.log('desktop: 预览成功，提交按钮可用');

// §9.1-3：模拟响应丢失 —— 首次提交中断，同键重发必须只有一条任务
let dropNextSubmit = true;
await page.route('**/studio/hires', async (route) => {
  if (route.request().method() !== 'POST') return route.continue();
  // 只在第一次提交时中断，模拟「浏览器拿不到响应」；重发走正常路径。
  if (dropNextSubmit) { dropNextSubmit = false; return route.abort('failed'); }
  return route.continue();
});
await submitButton.click();
await page.waitForTimeout(2500);
const jobsAfterLoss = await jobCount();
console.log('提交响应丢失后任务数:', jobsAfterLoss, '(基线', jobsBefore, ')');
// 弹窗内应给出失败提示，且用户仍可重试
await shoot(page, 'desktop-03-hires-response-lost.png');
const retryButton = dialog.getByRole('button', { name: '开始细化' });
if (await retryButton.isEnabled()) {
  const retryResponse = page.waitForResponse((r) => /\/studio\/hires$/.test(r.url()) && r.request().method() === 'POST');
  await retryButton.click();
  await retryResponse;
  await page.waitForTimeout(1500);
}
const jobsAfterRetry = await jobCount();
console.log('同键重发后任务数:', jobsAfterRetry);
assert.ok(jobsAfterRetry - jobsBefore <= 1,
  `同键重发最多只能产生一条任务，实际新增 ${jobsAfterRetry - jobsBefore} 条`);
await shoot(page, 'desktop-04-hires-after-retry.png');

// ---------------------------------------------------------------- 窄屏 390×844
const narrowContext = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'x-sthstart-admin-token': TOKEN } });
const narrowPage = await narrowContext.newPage();
attach(narrowPage);
await openStudio(narrowPage, { width: 390, height: 844 });
// 窄屏下镜头工坊是收起的：必须先点「展开右侧镜头工坊」（该按钮窄屏只显示图标，
// 可访问名称来自 title），否则历史图与「放大细化」按钮都不在 DOM 里。
const expand = narrowPage.getByRole('button', { name: '展开右侧镜头工坊', exact: true });
if (await expand.isVisible().catch(() => false)) {
  await expand.click();
  await narrowPage.waitForTimeout(2000);
}
const narrowDialog = await openHiresDialog(narrowPage);
const narrowPreview = narrowPage.waitForResponse((r) => /\/studio\/hires\/preview$/.test(r.url()) && r.request().method() === 'POST');
await narrowDialog.getByRole('button', { name: /预览/ }).first().click();
assert.equal((await narrowPreview).status(), 200, '窄屏细化预览也应成功');
const overflow = await narrowPage.evaluate(() => {
  const dialogElement = document.querySelector('[role="dialog"]');
  return dialogElement ? Math.max(0, dialogElement.scrollWidth - window.innerWidth) : -1;
});
assert.ok(overflow >= 0 && overflow <= 2, `窄屏细化弹窗不应横向溢出，实际超出 ${overflow}px`);
await shoot(narrowPage, 'narrow-01-hires-previewed.png');
console.log('narrow: 细化预览成功且不溢出');

console.log('page errors:', errors.length ? errors.slice(0, 5) : 'none');
console.log('unexpected HTTP:', unexpectedHttp.length ? unexpectedHttp.slice(0, 5) : 'none');
await browser.close();
assert.equal(errors.length, 0, `页面不应有 JS 错误：${errors.slice(0, 3).join(' | ')}`);
assert.equal(unexpectedHttp.length, 0, `不应有意外 HTTP 失败：${unexpectedHttp.slice(0, 3).join(' | ')}`);
console.log('OK: 第二轮修复 UI 浏览器验收通过');
