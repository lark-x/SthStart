import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { SceneAction, SceneBrief, SceneEvidence, StorySceneActionRequest, StorySceneDraft } from '@sthstart/contracts';
import { isOwnedDirectory } from './global-setup';

test.use({ serviceWorkers: 'block', deviceScaleFactor: 2 });

const portal = `http://127.0.0.1:${process.env.E2E_PORTAL_PORT ?? '4273'}`;
const admin = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT ?? '4200'}/api/v1/admin`;
const adminHeaders = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };

test.beforeEach(async ({ context }) => {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY || '')).toBe(true);
  const session = await context.request.post(`${portal}/api/auth/admin-session`, { headers: { origin: portal } });
  expect(session.ok()).toBe(true);
});

const textbox = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true });
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const progress = (page: Page) => page.getByRole('navigation', { name: '一幕故事进度' });

async function expectNoHorizontalScroll(page: Page) {
  await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
}

test('目录进入手写，刷新恢复本机稿，并能处理双标签版本冲突', async ({ context, page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/apps/story-worlds');
  await expect(page.getByRole('link', { name: '新建作品' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '最近草稿' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('directory-1440.png'), animations: 'disabled' });
  const created: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/admin/story-scene-drafts') created.push(request.url());
  });
  await page.getByRole('link', { name: '新建一幕' }).click();
  const name = `原创-季澄-${randomUUID().slice(0, 6)}`;
  await page.getByRole('radio', { name: '手输角色名' }).check();
  await textbox(page, '角色名（必填）').fill(name);
  await textbox(page, '一句角色设定（可选）').fill('深夜替别人修表的邮差。');
  expect(created).toHaveLength(0);
  await button(page, '手动填写').click();
  await expect(page).toHaveURL(/\/apps\/story-worlds\/scenes\/[^/]+$/);
  expect(created).toHaveLength(1);
  await textbox(page, '时间').fill('停电之后');
  await button(page, '确认时地').click();
  await expect(page.getByText('停电之后 · 地点待定')).toBeVisible();
  await button(page, '手写正文').click();
  await textbox(page, '草稿标题').fill('邮差的最后一封信');
  await textbox(page, '正文').fill('季澄把时钟放在信封上，等指针走完这一圈。');
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('status').filter({ hasText: /^已保存$/ })).toBeVisible();
  const address = page.url();
  await page.reload();
  await expect(textbox(page, '正文')).toHaveValue('季澄把时钟放在信封上，等指针走完这一圈。');

  const another = await context.newPage();
  await another.goto(address);
  await expect(textbox(another, '正文')).toBeVisible();
  await textbox(another, '正文').fill('服务器稿尝试：邮差把表带走。');
  await another.keyboard.press('Control+s');
  await expect(another.getByRole('status').filter({ hasText: /^已保存$/ })).toBeVisible();
  await textbox(page, '正文').fill('本机稿尝试：邮差留下了表。');
  await page.keyboard.press('Control+s');
  await expect(page.getByText('有版本冲突', { exact: true }).first()).toBeVisible();
  const conflict = page.getByRole('status', { name: '有版本冲突' });
  await expect(conflict.getByText('服务器稿尝试：邮差把表带走。', { exact: true })).toBeVisible();
  await expect(conflict.getByText('本机稿尝试：邮差留下了表。', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('服务器稿尝试：邮差把表带走。', { exact: true })).toBeVisible();
  await expect(textbox(page, '正文')).toHaveValue('本机稿尝试：邮差留下了表。');
  await button(page, '保存本机修改').click();
  await expect(page.getByRole('status').filter({ hasText: /^已保存$/ })).toBeVisible();

  const drafts = '**/api/admin/story-scene-drafts/*';
  const offline: Parameters<Page['route']>[1] = route => route.request().method() === 'PATCH' ? route.abort('failed') : route.fallback();
  await page.route(drafts, offline);
  await textbox(page, '正文').fill('断网修改：邮差把信留在门口。');
  await page.keyboard.press('Control+s');
  await expect(page.getByText('仅保存到本机', { exact: true })).toBeVisible();
  await page.reload();
  await expect(textbox(page, '正文')).toHaveValue('断网修改：邮差把信留在门口。');
  await page.unroute(drafts, offline);
  await button(page, '尝试同步').click();
  await expect(page.getByRole('status').filter({ hasText: /^已保存$/ })).toBeVisible();
  await page.getByRole('link', { name: '返回作品目录' }).click();
  await page.getByRole('link', { name: new RegExp('邮差的最后一封信') }).click();
  await expect(textbox(page, '正文')).toHaveValue('断网修改：邮差把信留在门口。');
});

const evidence: SceneEvidence = { status: 'supported', sourceIds: ['comic'], note: '原文含会面的位置描述。' };
const brief: SceneBrief = { viewpoint: '温妮莎', action: '她在栏杆边作出决定。', change: '她不再等风神先开口。', constraints: ['保留两人在狱栏两侧。'] };
const originalText = '温妮莎停在栏杆前。她握住冰冷的铁，等风从高窗吹进来。';
const updatedText = '她先松开左手。风从高窗吹进来，石地上还有白天的水。';

test('窄屏精读出处、输入法与长对话、写稿、构图确认、丢失响应后恢复图片', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const timestamp = new Date().toISOString();
  const draft: StorySceneDraft = {
    id: 'vannessa-mock', revision: 1, title: '栏杆两侧', character: { name: '温妮莎', work: '原神', origin: 'gi' }, progress: 'start', createdAt: timestamp, updatedAt: timestamp,
    start: null, sources: [], candidates: [], messages: [], discovery: null, direction: null, brief: null,
    briefConfirmed: false, notes: '', lockedConstraints: [], authorSources: [], body: '', bodyVersion: 1, format: 'story',
    writingCandidate: null, imagePlan: null, images: [], adoption: null, currentAction: null,
  };
  const calls: StorySceneActionRequest[] = [];
  let statusReads = 0;
  await page.route('**/api/admin/story-scene-drafts/vannessa-mock', async route => {
    if (route.request().method() === 'PATCH') {
      const { expectedRevision, start, body, imagePlan, ...edits } = route.request().postDataJSON();
      expect(expectedRevision).toBe(draft.revision);
      Object.assign(draft, edits);
      if (start) {
        draft.start = { ...start, timeEvidence: { ...evidence, status: 'inferred' }, locationEvidence: evidence };
        draft.progress = 'discuss';
      }
      if (body !== undefined && body !== draft.body) { draft.body = body; draft.bodyVersion++; }
      if (imagePlan) draft.imagePlan = { ...imagePlan, id: 'composition', version: (draft.imagePlan?.version ?? 0) + 1, bodyVersion: draft.bodyVersion };
      draft.revision++;
    } else if (draft.images[0]?.status === 'queued' && ++statusReads >= 3) {
      draft.images[0].status = 'succeeded';
      draft.images[0].artifactId = 'mock-artifact';
      draft.currentAction!.status = 'succeeded';
      draft.revision++;
    }
    await route.fulfill({ json: draft });
  });
  await page.route('**/api/admin/story-scene-drafts/vannessa-mock/actions', async route => {
    const input = route.request().postDataJSON() as StorySceneActionRequest;
    expect(input.expectedRevision).toBe(draft.revision);
    calls.push(input);
    const action: SceneAction = {
      id: randomUUID(), idempotencyKey: input.idempotencyKey, action: input.action, inputRevision: input.expectedRevision,
      createdAt: timestamp, updatedAt: timestamp, status: input.action === 'generate-image' ? 'queued' : 'succeeded',
    };
    switch (input.action) {
      case 'discover':
        draft.sources = [{ id: 'comic', title: '温妮莎传奇·下篇', work: '原神', locator: 'visual-fixture', startLine: 31, endLine: 33, excerpt: '**这是自动化测试用的原文片段。**', fullText: '## 原作记载\n\n| 作品 | 名称 |\n|---|---|\n| 阅读物 | 温妮莎传奇 |\n\n> [这是自动化测试用的完整原文。](https://example.test/book)', fullTextComplete: true, kind: 'canon' }];
        draft.candidates = [{ id: 'meet', time: '风神到访时', location: '监牢', hook: '选一个动作表现她作出的决定。', timeEvidence: { ...evidence, status: 'inferred' }, locationEvidence: evidence }];
        draft.discovery = { status: 'ready', message: '' };
        break;
      case 'refresh-sources':
        draft.sources = [{ id: 'comic-refreshed', title: '温妮莎传奇·下篇', work: '原神', locator: 'visual-fixture', startLine: 31, endLine: 33, excerpt: '更新后的原文行段。', fullText: '更新后的完整原文。', fullTextComplete: true, kind: 'canon' }];
        draft.discovery = { status: 'ready', message: '参考资料已更新。' };
        break;
      case 'discuss':
        if (input.message) draft.messages.push({ id: randomUUID(), role: 'author', text: input.message, createdAt: timestamp });
        draft.messages.push({ id: randomUUID(), role: 'assistant', text: input.message ? `使用温妮莎视角。${'保留狱栏两侧的动作细节。'.repeat(125)}` : '可以用动作、冲突或情绪来展开。', createdAt: timestamp, ...(input.message ? { suggestedBrief: brief } : { approaches: [{ id: 'idea', title: '隔栏的选择', description: '让动作先于对白。', brief }] }) });
        break;
      case 'write':
        expect(draft.briefConfirmed).toBe(true);
        draft.body = originalText;
        draft.bodyVersion++;
        draft.progress = 'write';
        break;
      case 'plan-image':
        draft.imagePlan = { id: 'composition', version: 1, bodyVersion: draft.bodyVersion, moment: '停在栏杆前', subject: '温妮莎与访客', camera: '从栏杆斜后方观察', blocking: '温妮莎在栏内，访客在栏外', action: '攥住栏杆', occlusion: '铁栏挡住部分空间', style: '水彩与铅笔' };
        draft.progress = 'image';
        break;
      case 'generate-image':
        expect(draft.imagePlan?.blocking).toBe('栏内温妮莎靠近前景，访客在栏外远处。');
        action.taskId = 'mock-task';
        draft.images.push({ id: action.id, taskId: action.taskId, bodyVersion: draft.bodyVersion, planVersion: draft.imagePlan!.version, status: 'queued', createdAt: timestamp });
        break;
    }
    draft.currentAction = action;
    draft.revision++;
    // Simulate an accepted request whose response does not reach the browser.
    if (input.action === 'generate-image') await route.abort('failed');
    else await route.fulfill({ json: { draft, action } });
  });
  await page.route('**/api/admin/creative/artifacts/mock-artifact', route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="320"><rect width="512" height="320" fill="#756a59"/><rect x="145" y="45" width="175" height="230" fill="#e7d2b2"/><path d="M170 45v230m35-230v230m35-230v230m35-230v230" stroke="#53493e" stroke-width="8"/></svg>',
  }));

  await page.goto('/apps/story-worlds/scenes/vannessa-mock');
  await button(page, '联想时地').click();
  await expect(page.getByRole('heading', { name: /监牢/ })).toBeVisible();
  await expect(page.getByText('推测', { exact: true })).toBeVisible();
  await expect(page.getByText('有据', { exact: true })).toBeVisible();
  await button(page, '温妮莎传奇·下篇').first().click();
  const drawer = page.getByRole('dialog', { name: '参考资料' });
  await expect(drawer.getByText('这是自动化测试用的原文片段。')).toBeVisible();
  await drawer.getByText('查看完整原文').click();
  await expect(drawer.getByText('这是自动化测试用的完整原文。')).toBeVisible();
  await expect(drawer.getByLabel('原文出处')).not.toContainText(/\*\*|##|\|---|https:\/\/example/);
  await page.screenshot({ path: info.outputPath('sources-390.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await button(page, '选这组时地').click();
  await textbox(page, '地点').fill('监牢南端');
  await expect(page.getByText('作者指定', { exact: true })).toBeVisible();
  await button(page, '确认时地').click();
  await page.getByRole('radio', { name: /补写留白/ }).check();
  await button(page, '想几个讲法').click();
  await expect(page.getByText('隔栏的选择')).toBeVisible();
  const feedback = textbox(page, '反馈给 AI');
  await feedback.fill('换成温妮莎视角');
  await feedback.dispatchEvent('compositionstart', { data: '温妮莎' });
  await feedback.press('Enter');
  await feedback.dispatchEvent('compositionend', { data: '温妮莎' });
  expect(calls.filter(input => input.action === 'discuss')).toHaveLength(1);
  await feedback.press('Enter');
  await expect(button(page, '将建议填入提要')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expect.poll(() => page.getByLabel('讨论消息').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await page.screenshot({ path: info.outputPath('discussion-390.png'), animations: 'disabled' });
  await button(page, '将建议填入提要').click();
  await expect(textbox(page, '视角人物')).toHaveValue('温妮莎');
  await button(page, '写成一幕').click();
  await expect(textbox(page, '正文')).toHaveValue(originalText);
  await button(page, '前往画面设计').click();
  await button(page, '推荐一个画面').click();
  await expect(textbox(page, '构图说明')).toHaveValue(/人物前后站位：温妮莎在栏内，访客在栏外/);
  await expect(textbox(page, '构图说明')).toHaveCount(1);
  expect(calls.filter(input => input.action === 'generate-image')).toHaveLength(0);
  await textbox(page, '构图说明').fill([
    '正文中的瞬间：温妮莎停在栏杆前',
    '画面主体：温妮莎与访客',
    '构图与机位：从栏杆斜后方观察',
    '人物前后站位：栏内温妮莎靠近前景，访客在栏外远处。',
    '关键动作：攥住栏杆',
    '空间遮挡：铁栏挡住部分空间',
    '画风或参考说明：水彩与铅笔',
  ].join('\n'));
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: info.outputPath('composition-390.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('separator')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: info.outputPath('composition-1440.png'), animations: 'disabled' });
  await button(page, '生成这张图').dblclick();
  await expect(page.getByText('等待生成', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('img', { name: '一幕故事的代表画面' })).toBeVisible({ timeout: 8000 });
  expect(calls.filter(input => input.action === 'generate-image')).toHaveLength(1);
  await progress(page).getByRole('button', { name: '正文', exact: true }).click();
  await textbox(page, '正文').fill(updatedText);
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('status').filter({ hasText: /^已保存$/ })).toBeVisible();
  await progress(page).getByRole('button', { name: '画面', exact: true }).click();
  await expect(page.getByText(/基于旧稿/)).toBeVisible();
  const bodyBeforeRefresh = draft.body;
  const planBeforeRefresh = draft.imagePlan;
  await button(page, '更新参考资料').click();
  await expect.poll(() => calls.at(-1)?.action).toBe('refresh-sources');
  expect(draft.body).toBe(bodyBeforeRefresh);
  expect(draft.imagePlan).toEqual(planBeforeRefresh);
  await expect(page.getByText('更新后的原文行段')).toBeVisible();
});

test('另开 IF 线后收入已建立作品，并能从草稿打开对应手稿', async ({ page, request }) => {
  const worldName = `场景验收-${randomUUID().slice(0, 6)}`;
  const world = await request.post(`${admin}/story-worlds`, { headers: adminHeaders, data: {
    title: worldName, summary: '', timeLabel: '', locations: [{ id: 'cell', name: '监牢', description: '' }],
    actors: [{ id: 'actor', name: '访客', role: 'main', characterId: null, characterVersion: null, background: '', personality: '', speechStyle: '', appearance: '', goals: [], locationId: 'cell', referenceArtifactIds: [] }],
    sources: [], lockedFacts: [], models: { action: null, adjudication: null, narration: null }, visualStyle: '',
  } });
  expect(world.ok(), await world.text()).toBe(true);
  const worldId = (await world.json()).id;
  const created = await request.post(`${admin}/story-scene-drafts`, { headers: adminHeaders, data: {
    idempotencyKey: randomUUID(), character: { name: '温妮莎', origin: 'gi', work: '原神' },
    start: { time: '到访之后', location: '监牢' },
  } });
  expect(created.ok(), await created.text()).toBe(true);
  const original = await created.json() as StorySceneDraft;
  const updated = await request.patch(`${admin}/story-scene-drafts/${original.id}`, { headers: adminHeaders, data: {
    expectedRevision: original.revision, direction: 'canon-gap', body: originalText,
  } });
  expect(updated.ok(), await updated.text()).toBe(true);

  await page.goto(`/apps/story-worlds/scenes/${original.id}`);
  await button(page, '从这里另开一幕').click();
  const dialog = page.getByRole('dialog', { name: '从这里另开一幕' });
  await dialog.getByRole('radio', { name: 'IF 线', exact: true }).check();
  await dialog.getByRole('button', { name: '创建变体草稿' }).click();
  await expect(page.getByRole('heading', { name: '讨论这一幕怎么讲' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /IF 线/ })).toBeChecked();
  await expect(page.getByText('到访之后 · 监牢')).toBeVisible();
  await textbox(page, '原来发生了什么').fill('她等访客先开口。');
  await textbox(page, '这次改变哪一件事').fill('她先伸手，接住了访客掷来的钥匙。');
  await button(page, '手写正文').click();
  const variantText = '温妮莎先伸手。钥匙贴过铁条，落进她掌心。';
  await textbox(page, '草稿标题').fill('钥匙的去向');
  await textbox(page, '正文').fill(variantText);
  await progress(page).getByRole('button', { name: '收入作品' }).click();
  await page.getByRole('combobox', { name: '目标作品' }).selectOption(worldId);
  await expect(page.getByText('确认后将为该作品创建手稿项目。')).toBeVisible();
  await expect(page.getByText('钥匙的去向 · IF 线', { exact: true })).toBeVisible();
  await button(page, '确认收入作品').click();
  await expect(page.getByRole('link', { name: '打开手稿', exact: true })).toHaveAttribute('href', /\/apps\/story\/[^?]+\?entry=/);
  const variantAddress = page.url();
  await page.getByRole('link', { name: '返回原稿与画面' }).click();
  await expect(textbox(page, '正文')).toHaveValue(originalText);
  await page.goto(variantAddress);
  await page.getByRole('link', { name: '打开手稿', exact: true }).click();
  await expect(page).toHaveURL(/\/apps\/story\/[^?]+\?entry=/);
  await expect(page.getByText(variantText, { exact: false }).first()).toBeVisible();
});
