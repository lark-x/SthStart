// Read-only browser review. Research data is mocked; generation and publishing are never triggered.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.env.STHSTART_SCREENSHOT_BASE_URL || 'http://127.0.0.1:4180';
const out = resolve(process.env.STHSTART_SCREENSHOT_OUTPUT_DIR || 'artifacts/frontend-upgrade-review/after');
const time = '2026-09-30T00:00:00Z';
const project = { id: 'layout-review', workId: 'layout-work', title: '书籍线索与人物动机', question: '如何验证人物动机？', scope: { workId: 'layout-work' }, origin: 'user-defined', status: 'review', selectedTopicId: null, latestRunId: null, publishedNoteId: null, revision: 1, createdAt: time, updatedAt: time };
const evidence = { id: 'layout-evidence', projectId: project.id, runId: null, claimRole: 'support', providerId: 'local', workId: project.workId, targetType: 'node', targetId: 'layout-node', nodeId: null, sceneId: null, locator: '示例书籍 · 第一章', quoteSnapshot: '这是用于审核布局的原文快照。'.repeat(40), contextBefore: '前文背景。'.repeat(15), contextAfter: '后文线索。'.repeat(15), contentHash: 'fixture', valid: true, validationMessage: null, createdAt: time };
const claims = Array.from({ length: 16 }, (_, i) => ({ id: `claim-${i}`, workId: project.workId, projectId: project.id, runId: null, title: `线索 ${i + 1}：人物动机的验证`, claimType: 'inference', body: '结论正文与人物动机分析。'.repeat(35), explanation: '支持证据之间存在时间上的关联。'.repeat(15), uncertainty: '仍需核对时间顺序。', status: 'pending', origin: 'ai', revision: 1, createdAt: time, updatedAt: time, evidence: [evidence] }));
const draft = { id: 'layout-draft', projectId: project.id, runId: null, title: '专题总稿', summary: '可编辑的事实概述。', content: {}, status: 'draft', contentHash: 'fixture', revision: 1, createdAt: time, updatedAt: time };

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext();
const errors = [];
const results = [];
try {
  await context.request.post(`${base}/api/auth/admin-session`, { headers: { origin: new URL(base).origin } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${page.url()}: ${error.message}`));
  const navigate = async (path) => {
    await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
    await page.locator('h1').first().waitFor({ state: 'visible' });
    await page.waitForTimeout(1000);
  };
  const capture = async (name) => {
    await page.screenshot({ path: resolve(out, `${name}.png`), fullPage: false });
    const dimensions = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, height: innerHeight, documentHeight: document.documentElement.scrollHeight }));
    assert.ok(dimensions.documentWidth <= dimensions.width + 1, `${name}: horizontal overflow`);
    results.push({ name, ...dimensions });
  };
  const routes = ['/', '/apps/activities', '/apps/activities/new', '/apps/story', '/apps/characters', '/apps/characters/new', '/apps/notebook', '/apps/notebook/offline', '/apps/narrative', '/apps/inspiration', '/apps/creative', '/apps/calendar', '/settings/public-services', '/settings/generation', '/settings/ai-logs', '/settings/control-center', '/settings/backups'];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of routes) {
      await navigate(path);
      await capture(`${path.replaceAll('/', '_') || 'home'}-${width}`);
      console.log(`${width}px ${path}`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await navigate('/apps/notebook/new');
  await expect(page.getByRole('button', { name: '打开全站导航', exact: true })).toBeVisible();
  await capture('notebook-editor-mobile');
  assert.equal(results.at(-1).documentHeight, 844, 'notebook editor must remain inside the viewport');
  await page.getByRole('button', { name: '打开全站导航', exact: true }).click();
  await expect(page.getByRole('dialog').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await navigate('/apps/narrative');
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '作品目录' })).toBeVisible();
  await capture('narrative-tree-mobile');
  await page.keyboard.press('Escape');
  await context.route('**/api/admin/narrative/research/**', async (route) => {
    const url = new URL(route.request().url());
    let body;
    if (url.pathname.endsWith('/provider')) body = { id: 'local', name: '布局审核资料', kind: 'local', status: 'ready', message: '', workCount: 1 };
    else if (url.pathname.endsWith('/projects')) body = { items: [project] };
    else if (url.pathname.endsWith(`/projects/${project.id}`)) body = { project, runs: [], claims, drafts: [draft], latestDraft: draft, evidence: [evidence] };
    else throw new Error(`Unexpected fixture request: ${route.request().method()} ${url.pathname}`);
    await route.fulfill({ json: body });
  });
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await navigate(`/apps/narrative?mode=research&project=${project.id}&view=review`);
    await expect(page.getByRole('heading', { name: `${project.title} · 研究审核` })).toBeVisible();
    const editor = page.getByLabel('总稿标题');
    await editor.fill('未保存草稿保留验证');
    if (width < 1200) {
      await page.getByRole('button', { name: /查看证据/ }).click();
      await expect(page.getByRole('dialog', { name: '证据原文与来源' })).toBeVisible();
      await capture(`research-evidence-${width}`);
      await page.keyboard.press('Escape');
    } else {
      await page.getByRole('button', { name: '展开更宽证据视口' }).click();
      await capture(`research-wide-evidence-${width}`);
    }
    await expect(editor).toHaveValue('未保存草稿保留验证');
    await capture(`research-review-${width}`);
    assert.equal(results.at(-1).documentHeight, 900, 'research editor must remain inside the viewport');
    await page.getByRole('button', { name: '退出审核', exact: true }).click();
    await page.waitForURL((url) => !url.searchParams.has('view'));
    assert.equal(new URL(page.url()).searchParams.has('view'), false, 'review exit must update the URL');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await expect(page.getByRole('heading', { name: `${project.title} · 研究审核` })).toHaveCount(0);
  }
  await writeFile(resolve(out, 'review-results.json'), JSON.stringify({ results, errors }, null, 2));
  assert.deepEqual(errors, [], 'uncaught browser errors');
  console.log(`Verified ${results.length} browser states; screenshots: ${out}`);
} finally {
  await browser.close();
}
