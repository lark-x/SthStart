import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { normalizeCharacterDraftV2, type CreativePurposeOptions, type ImageConfiguration } from '@sthstart/contracts';
import { isOwnedDirectory } from './global-setup';

const portal = `http://127.0.0.1:${process.env.E2E_PORTAL_PORT ?? 4273}`;
const admin = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT ?? 4200}/api/v1/admin`;
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
const directory = resolve(import.meta.dirname, '../../artifacts/character-editor-regression');
mkdirSync(directory, { recursive: true });
test.use({ serviceWorkers: 'block', deviceScaleFactor: 2 });
const draft = normalizeCharacterDraftV2({ schemaVersion: 2, displayName: '阶段测试角色', originType: 'original', work: '隔离测试作品', summary: '完整概述', personaText: '## 核心经历\n完整正文第一段。\n## 性格\n完整正文最后一段。', speechText: '说话严谨，有自己的节奏。', behaviorRules: '不跨越自身认知边界。', dialogueExamples: ['情境：面对质疑\n回答：先核实证据，再作判断。'], aliases: [], appearance: { baseText: '银发蓝眼', defaultOutfitText: '白色旅行装' } });
async function create(request: APIRequestContext, extra: Record<string, unknown> = {}) {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY || '')).toBe(true);
  const response = await request.post(`${admin}/characters`, { headers, data: { displayName: draft.displayName, draft, ...extra } });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function open(page: Page, _request: APIRequestContext, id: string) {
  expect((await page.context().request.post(`${portal}/api/auth/admin-session`, { headers: { origin: portal } })).ok()).toBe(true);
  await page.goto(`/apps/characters/${id}`);
  await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');
  await expect(page.getByRole('button', { name: '编辑档案', exact: true })).toBeVisible();
}

test('default dossier reads complete persona, three labelled panels and narrow layouts', async ({ page, request }) => {
  const profile = await create(request);
  await open(page, request, profile.id);
  await expect(page.getByRole('textbox', { name: '角色名称', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tabpanel', { name: '人设演绎', exact: true })).toContainText('完整正文最后一段。');
  const personaTab = page.getByRole('tab', { name: '人设演绎', exact: true });
  await personaTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '外貌生图', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: '外貌生图', exact: true })).toContainText('白色旅行装');
  await page.getByRole('tab', { name: /图片皮肤/ }).click();
  await expect(page.getByRole('tabpanel', { name: '图片皮肤', exact: true })).toBeVisible();
  await personaTab.click();
  for (const [width, height] of [[1920, 1080], [1440, 900], [1024, 768], [390, 844], [320, 844]]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: resolve(directory, `dossier-${width}.png`), fullPage: true });
  }
});

test('empty name blocks stage publication and keeps the dialog open', async ({ page, request }) => {
  const profile = await create(request);
  await open(page, request, profile.id);
  await page.getByRole('button', { name: '编辑档案', exact: true }).click();
  await page.getByRole('textbox', { name: '角色名称', exact: true }).fill('');
  let publications = 0;
  page.on('request', req => { if (req.url().endsWith(`/characters/${profile.id}/publish`)) publications += 1; });
  await page.getByRole('button', { name: '保存为新阶段', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '保存原创角色阶段版本', exact: true });
  await dialog.getByRole('button', { name: '确认保存阶段', exact: true }).click();
  await expect(page.getByText('请先填写角色名称', { exact: true }).first()).toBeVisible();
  await expect(dialog).toBeVisible();
  const detail = await (await request.get(`${admin}/characters/${profile.id}`, { headers })).json();
  expect(detail.latestVersion).toBeNull();
  expect(publications).toBe(0);
});

test('failed network save cannot publish the previous stage or report success', async ({ page, request }) => {
  const profile = await create(request);
  await open(page, request, profile.id);
  await page.getByRole('button', { name: '编辑档案', exact: true }).click();
  await page.getByRole('textbox', { name: '一句话概述', exact: true }).fill('尚未成功保存的新摘要');
  let publications = 0;
  page.on('request', req => { if (req.url().endsWith(`/characters/${profile.id}/publish`)) publications += 1; });
  await page.route(`**/api/admin/characters/${profile.id}`, async route => {
    if (route.request().method() === 'PUT') return route.fulfill({ status: 503, json: { error: 'isolated_save_failure', message: '隔离测试：保存失败' } });
    return route.continue();
  });
  await page.getByRole('button', { name: '保存为新阶段', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '保存原创角色阶段版本', exact: true });
  await dialog.getByRole('button', { name: '确认保存阶段', exact: true }).click();
  await expect(page.getByText('隔离测试：保存失败', { exact: true }).first()).toBeVisible();
  await expect(dialog).toBeVisible();
  expect(publications).toBe(0);
  const detail = await (await request.get(`${admin}/characters/${profile.id}`, { headers })).json();
  expect(detail.latestVersion).toBeNull();
  expect(detail.draft.summary).toBe(draft.summary);
});

test('tags and variant-only changes are saved and frozen with the exact saved revision', async ({ page, request }) => {
  const profile = await create(request);
  await open(page, request, profile.id);
  await page.getByRole('button', { name: '编辑档案', exact: true }).click();
  await page.getByRole('textbox', { name: '角色标签', exact: true }).fill('阶段新标签');
  await page.getByRole('textbox', { name: '角色标签', exact: true }).press('Enter');
  await page.getByRole('button', { name: '更多档案操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '新增衍生形态', exact: true }).click();
  const variantDialog = page.getByRole('dialog', { name: '新增衍生形态', exact: true });
  await variantDialog.getByRole('textbox', { name: '形态名称', exact: true }).fill('觉醒SP');
  await variantDialog.getByRole('combobox', { name: '形态类型', exact: true }).selectOption('sp');
  await variantDialog.getByRole('button', { name: '确认添加', exact: true }).click();
  await page.getByRole('textbox', { name: '形态服装描述（用于生图与出装）', exact: true }).fill('新形态金色装甲');
  await page.getByRole('textbox', { name: '形态背景故事（阶段设定）', exact: true }).fill('觉醒后保留的新故事');
  const publishRequest = page.waitForRequest(req => req.url().endsWith(`/characters/${profile.id}/publish`));
  await page.getByRole('button', { name: '保存为新阶段', exact: true }).click();
  await page.getByRole('dialog', { name: '保存原创角色阶段版本', exact: true }).getByRole('button', { name: '确认保存阶段', exact: true }).click();
  const req = await publishRequest;
  await expect(page.getByText('已保存阶段版本 v1', { exact: true })).toBeVisible();
  const detail = await (await request.get(`${admin}/characters/${profile.id}`, { headers })).json();
  expect(req.postDataJSON().expectedDraftRevision).toBe(detail.draftRevision);
  expect(detail.versions[0].tags).toContain('阶段新标签');
  expect(detail.versions[0].variants[0].variantKind).toBe('sp');
  expect(detail.versions[0].variants[0].appearance.defaultOutfitText).toBe('新形态金色装甲');
  expect(detail.versions[0].variants[0].personaText).toBe('觉醒后保留的新故事');
});

test('text-only costume appears, reads and edits without image actions', async ({ page, request }) => {
  const profile = await create(request);
  const result = await request.post(`${admin}/characters/${profile.id}/apply-upstream`, { headers, data: { draft, expectedDraftRevision: profile.draftRevision, applyTextFields: {}, selectedSkins: [{ id: 'text-costume', name: '节庆礼服', classification: 'skin', outfitDescription: '红色丝绸配金色纹样', loreStory: '来自家乡节庆的服装故事', selected: true, source: '隔离样本' }] } });
  expect(result.ok(), await result.text()).toBe(true);
  await open(page, request, profile.id);
  await page.getByRole('tab', { name: /图片皮肤/ }).click();
  await expect(page.getByText('皮肤文字档案', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '设头像', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '预览资产：皮肤 · 节庆礼服', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '皮肤 · 节庆礼服', exact: true });
  await expect(preview).toContainText('红色丝绸配金色纹样');
  await expect(preview).toContainText('来自家乡节庆的服装故事');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '编辑资产信息', exact: true }).click();
  const edit = page.getByRole('dialog', { name: '编辑资产信息', exact: true });
  await edit.getByRole('textbox', { name: '背景故事 / 出处说明', exact: true }).fill('文字皮肤故事可继续编辑');
  await edit.getByRole('button', { name: '保存更改', exact: true }).click();
  await expect(edit).not.toBeVisible();
  const assets = await (await request.get(`${admin}/characters/${profile.id}/assets`, { headers })).json();
  expect(assets.items[0].url).toBeNull();
  expect(assets.items[0].metadata.loreStory).toBe('文字皮肤故事可继续编辑');
});

test('fork request clones current derivative rather than its family root', async ({ page, request }) => {
  expect((await request.put(`${admin}/characters/works`, { headers, data: { name: draft.work, aliases: [], mediaType: 'game', workNature: 'canon' } })).ok()).toBe(true);
  const source = await create(request, { draft: { ...draft, originType: 'ip' } });
  const fork = await request.post(`${admin}/characters/${source.id}/fork-derivative`, { headers, data: { targetWork: '当前AU', parentWork: draft.work, summary: 'AU专属故事', shareAssets: true } });
  expect(fork.ok(), await fork.text()).toBe(true);
  const derivative = (await fork.json()).character;
  await open(page, request, derivative.id);
  await page.getByRole('button', { name: '复制到同人作品', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /复制.*为同人衍生版/ });
  await dialog.getByRole('textbox').first().fill('第二代AU');
  const reqPromise = page.waitForRequest(req => req.url().endsWith('/fork-derivative'));
  await dialog.getByRole('button', { name: '创建同人衍生版', exact: true }).click();
  expect((await reqPromise).url()).toContain(`/characters/${derivative.id}/fork-derivative`);
});

test('upstream partial import preserves warnings and never repeats a completed apply', async ({ page, request }) => {
  const profile = await create(request);
  await page.route('**/api/admin/characters/upstream-research', route => route.fulfill({ json: {
    query: draft.displayName, resolvedName: draft.displayName, resolvedWork: draft.work, draft, tags: [], skinsAndVariants: [], assets: [], sources: [], evidenceSummary: '隔离采集样本', warnings: ['语音原文尚未获取'],
  } }));
  let applies = 0;
  await page.route(`**/api/admin/characters/${profile.id}/apply-upstream`, async route => {
    applies += 1;
    await route.fulfill({ json: { profile, importedAssetCount: 0, createdVariantCount: 0, createdSkinCount: 1, warnings: ['皮肤图片下载失败，文字已保存'] } });
  });
  await open(page, request, profile.id);
  await page.getByRole('button', { name: '上游重构 RP 卡', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /从上游重构 RP 卡/ });
  await dialog.getByRole('button', { name: '开始采集', exact: true }).click();
  await expect(dialog).toContainText('语音原文尚未获取');
  await dialog.getByRole('button', { name: '确认合并到角色档案', exact: true }).click();
  await expect(dialog).toContainText('皮肤图片下载失败，文字已保存');
  await expect(dialog.getByRole('button', { name: '本次内容已保存', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '开始采集', exact: true })).toBeDisabled();
  expect(applies).toBe(1);
  await page.screenshot({ path: resolve(directory, 'upstream-partial-result.png'), fullPage: true });
  await dialog.getByRole('button', { name: '完成并查看角色', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test('new upstream apply failure retries the same created character', async ({ page }) => {
  expect((await page.context().request.post(`${portal}/api/auth/admin-session`, { headers: { origin: portal } })).ok()).toBe(true);
  await page.goto('/apps/characters/new');
  await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');
  let creations = 0;
  const appliedIds: string[] = [];
  page.on('request', req => { if (new URL(req.url()).pathname === '/api/admin/characters' && req.method() === 'POST') creations += 1; });
  await page.route('**/api/admin/characters/upstream-research', route => route.fulfill({ json: { query: draft.displayName, resolvedName: draft.displayName, resolvedWork: draft.work, draft, tags: [], skinsAndVariants: [], assets: [], sources: [], evidenceSummary: '隔离采集样本', warnings: [] } }));
  await page.route('**/api/admin/characters/*/apply-upstream', async route => {
    appliedIds.push(new URL(route.request().url()).pathname.split('/').at(-2)!);
    await route.fulfill({ status: 503, json: { error: 'isolated_failure', message: '隔离测试：暂时无法写入' } });
  });
  await page.getByRole('button', { name: '上游重构 RP 卡', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '从上游采集 RP 角色卡', exact: true });
  await dialog.getByRole('textbox', { name: '采集角色名称', exact: true }).fill(draft.displayName);
  await dialog.getByRole('button', { name: '开始采集', exact: true }).click();
  await dialog.getByRole('button', { name: '创建角色并保存所选内容', exact: true }).click();
  await expect(dialog).toContainText('隔离测试：暂时无法写入');
  await dialog.getByRole('button', { name: '确认合并到角色档案', exact: true }).click();
  await expect.poll(() => appliedIds.length).toBe(2);
  expect(creations).toBe(1);
  expect(new Set(appliedIds).size).toBe(1);
});

test('selected variant generation sends effective costume and variant id without real models', async ({ page, request }) => {
  const variant = { id: 'sp-model', name: 'SP装甲', variantKind: 'sp', summary: 'SP摘要', personaText: 'SP故事', appearance: { baseText: '形态银色短发', defaultOutfitText: '形态独有的金色装甲' } };
  const profile = await create(request, { variants: [variant] });
  const configuration: ImageConfiguration = { configurationHash: 'a'.repeat(64), outputFormat: 'prose', fields: [{ key: 'prompt', label: '正面提示词', type: 'long-text', section: 'basic', order: 0, defaultValue: '', required: true, description: null }], sizePresets: [], promptMode: 'service-finalized-v1', promptKey: 'prompt', negativePromptKey: null, modelChoices: [], modelChoicesStale: false, warnings: [] };
  const options: CreativePurposeOptions = { purpose: 'character-avatar', ready: true, status: 'ready', workflow: { id: 'test', name: '隔离工作流', version: 1 }, engine: { id: 'test', name: '隔离引擎', kind: 'comfyui', enabled: true }, defaultPresetId: null, fields: configuration.fields, presets: [], modelChoices: [], configuration };
  await page.route('**/api/admin/generation/image/options?**', route => route.fulfill({ json: options }));
  let preparation: { description: string; context: { characters: Array<{ variantId?: string }> } } | undefined;
  let submission: { variantId?: string } | undefined;
  await page.route('**/api/admin/generation/image/prepare', async route => {
    preparation = route.request().postDataJSON();
    await route.fulfill({ json: { originalDescription: preparation!.description, positivePrompt: preparation!.description, negativePrompt: null, parameters: { prompt: preparation!.description }, configurationHash: configuration.configurationHash, promptMode: 'service-finalized-v1', optimizerCallId: null, warnings: [], preparationId: 'isolated-prep', contextHash: 'b'.repeat(64) } });
  });
  await page.route(`**/api/admin/characters/${profile.id}/generate-avatar`, async route => {
    submission = route.request().postDataJSON();
    await route.fulfill({ status: 503, json: { error: 'isolated_no_model', message: '隔离测试已拦截，未调用真实模型' } });
  });
  await open(page, request, profile.id);
  await page.getByRole('button', { name: variant.name, exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: '人设演绎', exact: true })).toContainText('SP故事');
  await page.getByRole('button', { name: 'AI 生图', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `生成形态头像 · ${variant.name}`, exact: true });
  await expect(dialog.getByRole('textbox', { name: '头像补充要求', exact: true })).toHaveValue(/形态独有的金色装甲/);
  await dialog.getByRole('button', { name: '开始生成', exact: true }).click();
  await expect(dialog).toContainText('隔离测试已拦截，未调用真实模型');
  expect(preparation?.context.characters[0].variantId).toBe(variant.id);
  expect(submission?.variantId).toBe(variant.id);
});

test('multi-source image import displays partial warnings and blocks duplicate import', async ({ page, request }) => {
  const profile = await create(request);
  const imageUrl = 'https://isolated.test/portrait.png';
  await page.route('https://isolated.test/**', route => route.fulfill({ status: 404, body: '' }));
  await page.route(`**/api/admin/characters/${profile.id}/preview-official-assets`, route => route.fulfill({ json: {
    characterId: profile.id, displayName: draft.displayName,
    items: [{ id: 'missing-portrait', title: '缺失的立绘', kind: 'portrait', category: 'portrait', url: imageUrl, source: 'isolated', recommended: true }],
  } }));
  let imports = 0;
  await page.route(`**/api/admin/characters/${profile.id}/import-assets`, async route => {
    imports += 1;
    await route.fulfill({ json: { imported: [], warnings: ['立绘下载失败：图片返回404'] } });
  });
  await open(page, request, profile.id);
  await page.getByRole('button', { name: '更换图片', exact: true }).click();
  await page.getByRole('button', { name: '主档案：多源获取图片', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `多源获取头像与立绘 · ${draft.displayName}`, exact: true });
  await dialog.getByRole('button', { name: '导入选中的资产 (1)', exact: true }).click();
  await expect(dialog).toContainText('立绘下载失败：图片返回404');
  await expect(dialog.getByRole('button', { name: '本次导入已结束', exact: true })).toBeDisabled();
  expect(imports).toBe(1);
  await dialog.getByRole('button', { name: '完成并关闭', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});
