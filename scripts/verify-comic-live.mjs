// Real-service smoke test. Explicit opt-in; creates a separate sample activity and renders through the comic API.
// Run with STHSTART_LIVE_COMIC_TEST=1 and STHSTART_ADMIN_TOKEN set. Never touches an existing activity.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

if (process.env.STHSTART_LIVE_COMIC_TEST !== '1') throw new Error('Set STHSTART_LIVE_COMIC_TEST=1 to create a live sample.');
const token = process.env.STHSTART_ADMIN_TOKEN;
if (!token) throw new Error('STHSTART_ADMIN_TOKEN is required.');
const base = (process.env.STHSTART_LIVE_COMIC_BASE_URL || 'http://127.0.0.1:9320/api/admin').replace(/\/$/, '');
const statePath = process.env.STHSTART_LIVE_COMIC_STATE
  ? resolve(process.env.STHSTART_LIVE_COMIC_STATE)
  : resolve('artifacts/activity-comic-screenshots/live-comic-state.json');
await mkdir(resolve(statePath, '..'), { recursive: true });
const request = async (method, path, body) => {
  const response = await fetch(`${base}${path}`, {
    method, headers: { 'x-sthstart-admin-token': token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
};
const saveState = async (state) => writeFile(statePath, JSON.stringify(state, null, 2));
let state = await readFile(statePath, 'utf8').then(JSON.parse).catch(() => null);

if (!state) {
  const actors = [
    { id: 'albedo', displayName: '阿贝多', activityRole: '炼金术师', outfitDescription: '深蓝与白色炼金术师服装',
      persona: { appearance: { baseText: '浅金色短发，蓝绿色眼睛' } }, appearanceReferenceAssetKeys: [] },
    { id: 'sucrose', displayName: '砂糖', activityRole: '助手', outfitDescription: '白色与绿色的研究员服装',
      persona: { appearance: { baseText: '浅绿色短发，眼镜' } }, appearanceReferenceAssetKeys: [] },
  ];
  const actions = [
    ['albedo', '雪山营地全景，阿贝多与砂糖走进风雪中的炼金实验帐篷', '实验开始。'],
    ['albedo', '阿贝多把发光的晶体放入透明烧瓶，近景展示双手与器皿', '先观察晶体结构。'],
    ['sucrose', '砂糖认真记录温度计数据，侧脸特写，实验台上有笔记本', '温度正在下降。'],
    ['albedo', '烧瓶中的晶体发出柔和蓝光，阿贝多谨慎观察', '反应仍然稳定。'],
    ['sucrose', '砂糖惊讶地看向晶体，背景能看到雪山营地', '它在低温下发生变化！'],
    ['albedo', '阿贝多与砂糖相视而笑，桌上的晶体稳定发光，暖光与雪景形成对比', '记录这次发现。'],
  ];
  const beats = actions.map(([characterId, action, dialogue], index) => ({ id: `beat-${index + 1}`, characterId, action,
    dialogue, outcome: `完成第 ${index + 1} 步观察`, orderIndex: index }));
  const document = {
    schemaVersion: 1,
    activity: { title: '漫画验收样例·阿贝多与砂糖的雪山实验', type: '短篇', theme: '雪山结晶实验', location: '龙脊雪山营地',
      rules: '', generationMode: 'fill_details' },
    actors, relationships: [], stages: [
      { id: 'stage-1', title: '雪山实验', order: 1, actorIds: ['albedo', 'sucrose'], location: '龙脊雪山营地',
        instruction: '', requiredBeats: [], locked: false, endCondition: '' },
      { id: 'stage-2', title: '整理发现', order: 2, actorIds: ['albedo', 'sucrose'], location: '龙脊雪山营地',
        instruction: '', requiredBeats: [], locked: false, endCondition: '' },
    ],
    scenes: [{ id: 'scene-1', stageId: 'stage-1', title: '低温结晶实验', timeText: '傍晚', locationText: '雪山实验帐篷',
      environment: '帐篷外风雪纷飞，室内是温暖的炼金灯光', beats }],
    conversations: [], messages: [], posts: [], comments: [], likes: [], mediaSlots: [], facts: [], stageResults: [],
  };
  const created = await request('POST', '/activities', { document, title: document.activity.title });
  const activityId = created.activity.id;
  const contentRevisionId = created.activity.currentContentRevisionId;
  if (!contentRevisionId) throw new Error('The sample activity was created without a content revision.');
  const first = await request('POST', `/activities/${activityId}/comic/draft`, { contentRevisionId });
  const panels = actions.map(([characterId, action, dialogue], index) => ({
    id: `panel-${index + 1}`, source: { stageId: 'stage-1', sceneId: 'scene-1', beatIds: [`beat-${index + 1}`] },
    actorIds: index === 0 || index === 5 ? ['albedo', 'sucrose'] : [characterId],
    shotSize: index === 0 || index === 5 ? 'wide' : index === 2 ? 'closeup' : 'medium',
    visualDescription: action, composition: index === 0 ? '建立雪山场景，全景中角色位于实验帐篷前' : '人物与实验器材清晰可辨',
    textSafeArea: 'top_left', selectedImage: null, crop: { focalX: 0.5, focalY: 0.5, zoom: 1 },
    bubbles: [{ id: `bubble-${index + 1}`, kind: 'speech', speakerActorId: characterId, text: dialogue,
      rect: { x: 0.06, y: 0.05, width: 0.7, height: 0.25 }, tail: { x: 0.58, y: 0.43 }, fontSize: 32 }],
    presentation: { camera: 'none', impact: 'none', holdMs: null },
    renderSettings: { purpose: 'activity_image_text', presetId: 'f91c31437bbfb056bcda50269ac3579f' },
  }));
  const comic = { schemaVersion: 1, contentRevisionId, style: 'ink-paper-v1', canvas: { width: 1920, height: 1080 },
    pages: [
      { id: 'page-1', title: '雪山实验 · 上', template: 'trio', panelIds: panels.slice(0, 3).map((item) => item.id) },
      { id: 'page-2', title: '雪山实验 · 下', template: 'trio', panelIds: panels.slice(3).map((item) => item.id) },
    ], panels };
  const saved = await request('PUT', `/activities/${activityId}/comic/draft`, { expectedDraftVersion: first.draft.draftVersion, document: comic });
  state = { activityId, draftVersion: saved.draft.draftVersion, panelJobs: {}, panelArtifacts: {},
    createdAt: new Date().toISOString() };
  await saveState(state);
  console.log(`Created isolated sample activity: ${activityId}`);
}

const maxPanels = Math.max(0, Math.min(6, Number(process.env.STHSTART_LIVE_COMIC_COUNT || '1')));
for (let index = 1; index <= maxPanels; index++) {
  const panelId = `panel-${index}`;
  if (state.panelArtifacts[panelId]) continue;
  const root = `/activities/${state.activityId}/comic`;
  const latest = await request('GET', `${root}/draft`);
  state.draftVersion = latest.draft.draftVersion;
  const seed = 2026092600 + index;
  const preview = await request('POST', `${root}/panels/${panelId}/render-preview`, { expectedDraftVersion: state.draftVersion, seed });
  if (!preview.canSubmit) throw new Error(`${panelId} cannot render: ${preview.warnings.join('; ')}`);
  console.log(`${panelId}: ${preview.workflowName}, ${preview.model}, seed ${seed}`);
  const submitted = await request('POST', `${root}/panels/${panelId}/renders`, {
    expectedDraftVersion: state.draftVersion, planHash: preview.planHash, seed,
    idempotencyKey: `comic-live-smoke-${state.activityId}-${panelId}`,
  });
  state.panelJobs[panelId] = submitted.job.id;
  await saveState(state);
  let job = submitted.job;
  const deadline = Date.now() + 8 * 60_000;
  while (!['succeeded', 'failed', 'interrupted', 'unknown'].includes(job.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    job = (await request('GET', `${root}/jobs/${job.id}`)).job;
  }
  if (job.status !== 'succeeded') throw new Error(`${panelId} status=${job.status}, job=${job.id}, error=${job.errorMessage || job.errorCode || 'timeout'}`);
  const history = await request('GET', `${root}/panels/${panelId}/history`);
  const image = history.images.find((item) => item.renderJobId === job.id && item.available);
  if (!image) throw new Error(`${panelId} succeeded without a readable image, job=${job.id}`);
  state.panelArtifacts[panelId] = image.artifactId;
  await saveState(state);
  console.log(`${panelId}: image ${image.artifactId}, job ${job.id}`);
}

if (process.env.STHSTART_LIVE_COMIC_FINALIZE === '1') {
  if (Object.keys(state.panelArtifacts).length !== 6) throw new Error('Six readable images are required before finalizing.');
  const root = `/activities/${state.activityId}/comic`;
  if (process.env.STHSTART_LIVE_COMIC_POLISH === '1') {
    const current = await request('GET', `${root}/draft`);
    const polished = structuredClone(current.draft.document);
    for (const panel of polished.panels) {
      for (const bubble of panel.bubbles) if (bubble.kind === 'speech') bubble.tail = { x: 0.58, y: 0.43 };
    }
    await request('PUT', `${root}/draft`, { expectedDraftVersion: current.draft.draftVersion, document: polished });
  }
  for (let index = 1; index <= 6; index++) {
    const panelId = `panel-${index}`;
    const current = await request('GET', `${root}/draft`);
    if (current.draft.document.panels.find((item) => item.id === panelId)?.selectedImage?.artifactId === state.panelArtifacts[panelId]) continue;
    const selected = await request('POST', `${root}/panels/${panelId}/select-image`, {
      expectedDraftVersion: current.draft.draftVersion, artifactId: state.panelArtifacts[panelId], allowStaleSource: false,
    });
    state.draftVersion = selected.draft.draftVersion;
    await saveState(state);
  }
  const current = await request('GET', `${root}/draft`);
  const revision = await request('POST', `${root}/revisions`, { expectedDraftVersion: current.draft.draftVersion });
  state.comicRevisionId = revision.revision.id;
  const response = await fetch(`${base}${root}/exports/reader`, {
    method: 'POST', headers: { 'x-sthstart-admin-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ revisionId: revision.revision.id }), signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Offline export failed: ${response.status} ${await response.text()}`);
  const outputDir = resolve('artifacts/activity-comic-screenshots', `live-sample-${state.activityId}`);
  await mkdir(outputDir, { recursive: true });
  const archivePath = join(outputDir, 'comic-reader.zip');
  await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
  state.archivePath = archivePath;
  await saveState(state);
  console.log(`Offline reader: ${archivePath}`);
}

console.log(`Sample: http://localhost:9320/apps/activities/${state.activityId}?tab=playback&mode=comic`);
console.log(`State: ${statePath}`);
