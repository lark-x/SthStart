import { test, expect, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { BeatRenderCandidate } from '@sthstart/contracts';

const service = 'http://127.0.0.1:4374/api/v1/admin';
const headers = { 'x-sthstart-admin-token': 'comfy-ui-offline-token-0123456789' };
test.beforeEach(async ({ page }) => {
  // The development Worker does not inherit Node's service URL. Forward browser API
  // calls directly to the fixture, preserving actual service validation and responses.
  await page.route('**/api/auth/admin-session', route => route.fulfill({ json: { csrfToken: 'offline-csrf' } }));
  await page.route('**/api/admin/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': offline\n\n' });
    const response = await route.fetch({ url: `${service}/${url.pathname.split('/api/admin/')[1]}${url.search}`,
      headers: { ...route.request().headers(), ...headers } });
    return route.fulfill({ response });
  });
});
async function seedImageWorkflow(request: APIRequestContext, appId: string, purpose: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const engine = await request.post(`${service}/generation/engines`, { headers, data: {
    id: `offline-${suffix}`, name: '离线验证连接', kind: 'comfyui', baseUrl: 'http://127.0.0.1:9', concurrencyLimit: 1,
  } });
  expect(engine.ok()).toBeTruthy();
  const engineId = (await engine.json()).id;
  const definition = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'offline.safetensors' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry', clip: ['1', 1] } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 512, batch_size: 1 } },
    '5': { class_type: 'KSampler', inputs: { seed: 42, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0] } },
    '6': { class_type: 'SaveImage', inputs: { images: ['5', 0], filename_prefix: 'offline' } },
  };
  const analysis = await request.post(`${service}/generation/workflows/analyze`, { headers, data: { definition, connectionId: engineId } });
  expect(analysis.ok()).toBeTruthy();
  const { suggestedDraft } = await analysis.json();
  const created = await request.post(`${service}/generation/workflows`, { headers, data: { name: `离线图片方案 ${suffix}` } });
  const workflowId = (await created.json()).id;
  const version = await request.post(`${service}/generation/workflows/${workflowId}/versions`, { headers, data: {
    engineId, definition, inputSchema: suggestedDraft.inputSchema, nodeBindings: suggestedDraft.nodeBindings,
    inputCapabilities: {}, outputDeclarations: ['6'], outputMediaTypes: ['image/png'], outputSchema: {},
    editorConfig: { ...suggestedDraft.editorConfig, promptAssembly: 'service-finalized-v1' },
  } });
  expect(version.ok(), await version.text()).toBeTruthy();
  const preset = await request.post(`${service}/generation/presets`, { headers, data: {
    appId, purpose, name: `离线预设 ${suffix}`, workflowId, workflowVersion: (await version.json()).version, engineId, values: {},
  } });
  expect(preset.ok(), await preset.text()).toBeTruthy();
  const setDefault = await request.post(`${service}/generation/presets/${(await preset.json()).id}/set-default`, { headers });
  expect(setDefault.ok()).toBeTruthy();
}

test('character avatar retains the draft when closing the generation overlay on mobile', async ({ page, request }, info) => {
  await seedImageWorkflow(request, 'characters', 'character-avatar');
  const created = await request.post(`${service}/characters`, { headers, data: {
    displayName: '离线头像角色', draft: { schemaVersion: 2, displayName: '离线头像角色', originType: 'original',
      appearance: { baseText: '红发少女', defaultOutfitText: '蓝色外套' }, personaText: '冷静的旅行者' },
  } });
  expect(created.ok()).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/apps/characters/${(await created.json()).id}`);
  await page.getByRole('button', { name: 'AI 生成头像', exact: true }).click();
  const panel = page.getByLabel('图片生成配置', { exact: true });
  await expect(panel).toHaveAttribute('data-ready', 'true');
  await panel.getByLabel('描述你的画面').fill('保留红发与蓝色外套，正面头像');
  await panel.getByRole('button', { name: '高级模式', exact: true }).click();
  await expect(panel.getByText('最终提示词', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('character-avatar-mobile.png'), fullPage: false, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'AI 生成头像', exact: true }).click();
  await expect(panel.getByLabel('描述你的画面')).toHaveValue('保留红发与蓝色外套，正面头像');
});

test('activity drawing keeps manual prompt overrides when returning to simple mode', async ({ page, request }, info) => {
  await seedImageWorkflow(request, 'activities', 'activity_image_text');
  const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  const created = await request.post(`${service}/activities`, { headers, data: { document } });
  expect(created.ok()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/apps/activities/${(await created.json()).activity.id}`);
  await page.getByRole('button', { name: '素材制作', exact: true }).click();
  await page.getByRole('button', { name: '绘制图片', exact: true }).first().click();
  const drawer = page.getByRole('dialog', { name: '素材绘制' });
  await drawer.getByRole('button', { name: '高级模式', exact: true }).click();
  await drawer.getByRole('button', { name: '以当前描述为基础编辑最终提示词' }).click();
  await drawer.getByLabel('手动最终正面提示词').fill('one traveler by the sea, blue coat');
  await drawer.getByRole('button', { name: '简单模式', exact: true }).click();
  await expect(drawer.getByText('已使用手动最终提示词', { exact: false })).toBeVisible();
  await drawer.getByRole('button', { name: '高级模式', exact: true }).click();
  await expect(drawer.getByLabel('手动最终正面提示词')).toHaveValue('one traveler by the sea, blue coat');
  await page.screenshot({ path: info.outputPath('activity-drawing-desktop.png'), fullPage: false, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await drawer.getByRole('button', { name: '简单模式', exact: true }).click();
  await drawer.getByRole('button', { name: '绘制新图', exact: true }).scrollIntoViewIfNeeded();
  await expect(drawer.getByRole('button', { name: '绘制新图', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('activity-drawing-mobile.png'), fullPage: false, animations: 'disabled' });
});

test('generation settings exposes scoped defaults and remains usable when diagnostics fail', async ({ page }, info) => {
  await page.route('**/api/admin/**/diagnostics*', route => route.fulfill({ status: 503, json: { error: 'offline', message: '诊断暂不可用' } }));
  await page.goto('/settings/generation');
  await expect(page.getByRole('heading', { name: '生成配置', exact: true })).toBeVisible();
  await expect(page.getByText('默认绘制模式', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '高级配置', exact: true }).click();
  await page.getByRole('tab', { name: '提示词策略', exact: true }).click();
  await expect(page.getByText('策略按工作流版本保存', { exact: false })).toBeVisible();
  await page.screenshot({ path: info.outputPath('generation-settings.png'), fullPage: true, animations: 'disabled' });
});

test('real preparation route keeps exact manual text and validates before dispatch', async ({ request }) => {
  await seedImageWorkflow(request, 'creative-center', 'text-to-image');
  const options = await request.get(`${service}/generation/image/options?appId=creative-center&purpose=text-to-image`, { headers });
  const selected = await options.json();
  const input = { appId: 'creative-center', purpose: 'text-to-image', description: '  (red hair:1.2), reading\n', ai: false,
    parameters: {}, presetId: selected.defaultPresetId, presetRevision: 1, idempotencyKey: 'offline-real-manual' };
  const prepared = await request.post(`${service}/generation/image/prepare`, { headers, data: input });
  expect(prepared.ok(), await prepared.text()).toBeTruthy();
  const result = await prepared.json();
  expect(result.positivePrompt).toBe(input.description);
  expect(result.optimizerCallId).toBeNull();
  expect(result.configurationHash).toMatch(/^[a-f0-9]{64}$/);
  const invalid = await request.post(`${service}/generation/image/prepare`, { headers, data: { ...input, workflowId: 'ungranted' } });
  expect(invalid.status()).toBe(400);
});

test('scene and comic drawing use the same mode semantics without changing source dialogue', async ({ page, request }, info) => {
  await seedImageWorkflow(request, 'activities', 'activity_image_text');
  const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  const stage = document.stages[0];
  const actor = document.actors[0];
  document.scenes = [{ id: 'offline-scene', stageId: stage.id, title: '窗边问候', timeText: '午后', locationText: '海边小屋', environment: '阳光透过窗户',
    beats: [{ id: 'offline-beat', characterId: actor.id, action: '坐在窗边挥手', dialogue: '你好。', outcome: '微笑回应', orderIndex: 0 }] }];
  const created = await request.post(`${service}/activities`, { headers, data: { document } });
  expect(created.ok()).toBeTruthy();
  const { activity } = await created.json();
  const imageUrl = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="768" height="512"><rect width="768" height="512" fill="#d4d9cf"/></svg>');
  const candidate: BeatRenderCandidate = { id: 'offline-history', activityId: activity.id, stageId: stage.id, sceneId: 'offline-scene', beatId: 'offline-beat',
    status: 'succeeded', taskId: null, callId: null, artifactId: 'offline-image', mediaUrl: imageUrl,
    images: [{ artifactId: 'offline-image', mediaUrl: imageUrl, sha256: null, available: true, isCurrent: false, index: 0 }],
    originalPrompt: 'traveler', positivePrompt: 'one traveler', negativePrompt: '', promptOptimizationStatus: 'skipped', sourceFingerprint: 'offline-source',
    autoApplyState: 'ineligible', autoApplyReason: null, artifactSha256: null, progress: null, createdAt: new Date().toISOString(), adoptedAt: null, error: null };
  await page.route(`**/api/admin/activities/${activity.id}/beat-renders?*`, route => route.fulfill({ json: {
    items: [candidate], total: 1, imageTotal: 1, limit: 24, offset: 0, draftVersion: 1,
  } }));
  await page.goto(`/apps/activities/${activity.id}`);
  await page.getByRole('button', { name: '绘制设置', exact: true }).first().click();
  const beatDialog = page.getByRole('dialog', { name: '绘制设置', exact: true });
  await beatDialog.getByRole('button', { name: '高级模式', exact: true }).click();
  await beatDialog.getByRole('button', { name: '以当前描述为基础编辑最终提示词' }).click();
  await beatDialog.getByLabel('手动最终正面提示词').fill('one traveler waving by a sunny window');
  await beatDialog.getByRole('button', { name: '简单模式', exact: true }).click();
  await expect(beatDialog.getByText('已使用手动最终提示词', { exact: false })).toBeVisible();
  await page.screenshot({ path: info.outputPath('scene-drawing.png'), fullPage: false, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '放大细化', exact: true }).first().click();
  const hiresDialog = page.getByRole('dialog', { name: '放大细化', exact: true });
  await expect(hiresDialog.getByLabel('细化重绘幅度')).toBeHidden();
  await hiresDialog.getByRole('button', { name: '高级模式', exact: true }).click();
  await hiresDialog.getByLabel('细化重绘幅度').fill('0.3');
  await hiresDialog.getByRole('button', { name: '简单模式', exact: true }).click();
  await expect(hiresDialog.getByText('已自定义 1 项高级参数', { exact: false })).toBeVisible();
  await hiresDialog.getByRole('button', { name: '高级模式', exact: true }).click();
  await expect(hiresDialog.getByLabel('细化重绘幅度')).toHaveValue('0.3');
  await hiresDialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '展开右侧镜头工坊', exact: true }).click();
  await page.getByRole('button', { name: '放大细化', exact: true }).first().click();
  await expect(hiresDialog.getByLabel('细化重绘幅度')).toHaveValue('0.3');
  await page.screenshot({ path: info.outputPath('hires-mobile.png'), fullPage: false, animations: 'disabled' });
  await hiresDialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 720 });

  const draft = await request.post(`${service}/activities/${activity.id}/comic/draft`, { headers, data: { contentRevisionId: activity.currentContentRevisionId } });
  expect(draft.ok()).toBeTruthy();
  const comic = { ...(await draft.json()).draft.document,
    pages: [{ id: 'offline-page', title: '问候', template: 'single', panelIds: ['offline-panel'] }],
    panels: [{ id: 'offline-panel', source: { stageId: stage.id, sceneId: 'offline-scene', beatIds: ['offline-beat'] }, actorIds: [actor.id], shotSize: 'medium',
      visualDescription: '旅人在窗边挥手', composition: '人物位于画面中央', textSafeArea: 'top_left', selectedImage: null,
      crop: { focalX: 0.5, focalY: 0.5, zoom: 1 }, bubbles: [], presentation: { camera: 'none', impact: 'none', holdMs: null }, renderSettings: {} }],
  };
  const saved = await request.put(`${service}/activities/${activity.id}/comic/draft`, { headers, data: { expectedDraftVersion: 1, document: comic } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.getByRole('button', { name: '漫画', exact: true }).click();
  await page.getByRole('button', { name: '✦ 绘制新图', exact: true }).click();
  const comicDialog = page.getByRole('dialog', { name: '画格绘制', exact: true });
  await comicDialog.getByRole('button', { name: '高级模式', exact: true }).click();
  await comicDialog.getByRole('button', { name: '以当前描述为基础编辑最终提示词' }).click();
  await comicDialog.getByLabel('手动最终正面提示词').fill('one traveler, medium shot, waving');
  await comicDialog.getByRole('button', { name: '简单模式', exact: true }).click();
  await expect(comicDialog.getByText('已使用手动最终提示词', { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: info.outputPath('comic-drawing-mobile.png'), fullPage: false, animations: 'disabled' });
});
