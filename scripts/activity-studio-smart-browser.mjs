/** Stage-three UI gate. Runs only against the explicitly isolated fixture on 4289/4199. */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const token = 'activity-studio-fixture-token-not-production';
const fixture = await fetch('http://127.0.0.1:4289/fixture').then(response => response.json());
const output = resolve('artifacts/activity-studio-abc', `smart-${new Date().toISOString().replaceAll(':', '-')}`);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'x-sthstart-admin-token': token } });
const page = await context.newPage(), errors = [], requests = [], unexpectedHttp = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
  if (response.status() < 400) return;
  if (response.status() === 401 && response.url().endsWith('/api/auth/admin-session') || response.status() === 503 && /\/studio-jobs$/.test(response.url())) return;
  unexpectedHttp.push(`${response.status()} ${response.url()}`);
});
page.on('request', request => { if (request.method() === 'POST' && /\/studio-jobs$/.test(request.url())) requests.push(request.postDataJSON()); });
const path = `http://127.0.0.1:4199/apps/activities/${fixture.activityId}`;
const service = `http://127.0.0.1:4289/api/v1/admin/activities/${fixture.activityId}`;
const get = suffix => fetch(`${service}${suffix}`, { headers: { 'x-sthstart-admin-token': token } }).then(response => response.json());
const before = await get('/draft');
try {
  await page.goto(`${path}?tab=studio&view=storyboard&stageId=${fixture.stageId}&sceneId=${fixture.sceneId}`);
  await page.getByRole('button', { name: '智能制作', exact: true }).waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: '智能制作', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '智能制作', exact: true });
  await dialog.getByRole('textbox', { name: '分镜来源正文', exact: true }).fill('字'.repeat(12001));
  await dialog.getByRole('button', { name: '生成待审分镜', exact: true }).click();
  await dialog.getByText('正文超过 12000 字，请自行分段；输入仍保留。', { exact: true }).waitFor();
  assert.equal(requests.length, 0);
  await page.reload();
  await dialog.getByRole('textbox', { name: '分镜来源正文', exact: true }).waitFor({ timeout: 60_000 });
  assert.equal((await dialog.getByRole('textbox', { name: '分镜来源正文', exact: true }).inputValue()).length, 12001);
  await dialog.getByRole('textbox', { name: '分镜来源正文', exact: true }).fill('研究员在雪山营地轻轻摇晃试管，观察结晶发出的微光，将实验变化记录进日志。');
  await page.screenshot({ path: resolve(output, 'desktop-smart-input.png'), fullPage: true });
  // The server accepts the request, but the browser loses its response. Retry must retain the exact payload and key.
  await page.route('**/studio-jobs', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fetch();
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'synthetic_lost_response', message: '模拟响应丢失，使用同一请求重试。' }) });
  });
  await dialog.getByRole('button', { name: '生成待审分镜', exact: true }).click();
  await dialog.getByText('模拟响应丢失，使用同一请求重试。', { exact: true }).waitFor();
  await page.unroute('**/studio-jobs');
  await dialog.getByRole('button', { name: '生成待审分镜', exact: true }).click();
  await dialog.getByRole('button', { name: '追加到活动', exact: true }).waitFor({ timeout: 30_000 });
  assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]);
  assert.deepEqual(await get('/draft'), before, 'Review-ready tasks must not alter content');
  const beatJobId = new URL(page.url()).searchParams.get('studioJobId'); assert.ok(beatJobId);
  await page.reload();
  await dialog.getByRole('button', { name: '追加到活动', exact: true }).waitFor({ timeout: 60_000 });
  await page.screenshot({ path: resolve(output, 'desktop-smart-review.png'), fullPage: true });
  await dialog.getByRole('button', { name: '追加到活动', exact: true }).click();
  await dialog.getByText('已应用。重复操作不会再次新增分镜。', { exact: true }).waitFor();
  const after = await get('/draft'); assert.equal(after.draft.document.scenes.length, before.draft.document.scenes.length + 1);
  assert.equal(after.draft.document.scenes.at(-1).beats.length, 6);
  assert.deepEqual(after.draft.document.scenes[0], before.draft.document.scenes[0]);
  await dialog.getByRole('button', { name: '新建任务', exact: true }).click();
  await dialog.getByRole('combobox', { name: '分镜形式', exact: true }).selectOption('comic');
  await dialog.getByRole('button', { name: '生成待审分镜', exact: true }).click();
  await dialog.getByRole('button', { name: '追加到活动', exact: true }).waitFor({ timeout: 30_000 });
  await dialog.getByRole('button', { name: '追加到活动', exact: true }).click();
  await dialog.getByText('已应用。重复操作不会再次新增分镜。', { exact: true }).waitFor();
  const comic = await get('/comic/draft'); assert.equal(comic.draft.document.pages.length, 2); assert.equal(comic.draft.document.panels.length, 6);
  const comicJobId = new URL(page.url()).searchParams.get('studioJobId');
  // Read-only saved-scene comic generation must not create another content version before application.
  await dialog.getByRole('button', { name: '新建任务', exact: true }).click();
  await dialog.getByRole('combobox', { name: '分镜正文来源', exact: true }).selectOption('scene');
  const savedSceneBefore = await get('/draft');
  await dialog.getByRole('button', { name: '生成待审分镜', exact: true }).click();
  await dialog.getByRole('button', { name: '追加到活动', exact: true }).waitFor({ timeout: 30_000 });
  assert.deepEqual(await get('/draft'), savedSceneBefore);
  await dialog.getByRole('button', { name: '新建任务', exact: true }).click();
  await dialog.getByRole('combobox', { name: '分镜正文来源', exact: true }).selectOption('story_chapter');
  // Create only in the isolated in-memory Story database.
  const postStory = async (suffix, body) => {
    const response = await fetch(`http://127.0.0.1:4289/api/v1/admin/story/projects${suffix}`, { method: 'POST',
      headers: { 'x-sthstart-admin-token': token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  };
  const project = await postStory('', { title: '分镜来源隔离测试' });
  const chapter = await postStory(`/${project.id}/documents`, { kind: 'chapter', title: '结晶实验章节', body: '研究员观察结晶，再把观察记录在日志里。' });
  // Refresh source dropdown queries through a close/reopen, without recreating native DSH sessions.
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '智能制作', exact: true }).click();
  await dialog.getByRole('combobox', { name: '来源剧情项目', exact: true }).selectOption(project.id);
  await dialog.getByRole('combobox', { name: '来源正式章节', exact: true }).selectOption(chapter.id);
  const revisionSelect = dialog.getByRole('combobox', { name: '来源章节版本', exact: true });
  await page.waitForFunction(() => document.querySelector('select[aria-label="来源章节版本"]')?.options.length > 1);
  const revisionId = await revisionSelect.locator('option').nth(1).getAttribute('value');
  await revisionSelect.selectOption(revisionId);
  await dialog.getByRole('combobox', { name: '分镜形式', exact: true }).selectOption('beats');
  await dialog.getByRole('button', { name: '生成待审分镜', exact: true }).click();
  await dialog.getByRole('button', { name: '追加到活动', exact: true }).waitFor({ timeout: 30_000 });
  await dialog.getByText('冻结输入与版本', { exact: true }).click();
  await dialog.getByText(/结晶实验章节 · 正式修订/).waitFor();
  await page.screenshot({ path: resolve(output, 'desktop-formal-chapter-review.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: resolve(output, 'mobile-smart-review.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '漫画', exact: true }).click();
  await page.getByText('漫画页', { exact: true }).waitFor();
  await page.screenshot({ path: resolve(output, 'mobile-applied-comic.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpectedHttp, []);
  console.log(JSON.stringify({ passed: true, output, beatJobId, comicJobId, requestRetryIdentical: true }));
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true });
  console.log('BODY', (await page.locator('body').innerText()).slice(-12000)); throw error;
} finally { await browser.close(); }
