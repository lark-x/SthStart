import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { ComicDocument, ComicJob, ContentDocument } from '@sthstart/contracts';
import { ComicStore } from './activities/comic-store.js';
import { compileComicPanelSource } from './activities/comic-renders.js';
import { ActivityStore } from './activities/store.js';
import { createPreset, setDefaultPreset } from './generation/configuration-store.js';
import { createService } from './server.js';
import { readConfig } from './config.js';
import { ServiceDatabase, nowIso } from './database.js';
import { SecretStore } from './security.js';

const adminToken = 'comic-renders-test-admin-token-1234567890';
const adminHeaders = { 'x-sthstart-admin-token': adminToken };

function story(): ContentDocument {
  return {
    schemaVersion: 1,
    activity: { title: '雪山实验', type: '短篇', theme: '发现结晶', location: '龙脊雪山', rules: '', generationMode: 'fill_details' },
    actors: [{ id: 'actor-albedo', displayName: '阿贝多', activityRole: '研究者', outfitDescription: '深蓝色炼金术师服装',
      persona: { appearance: { baseText: '浅金色短发，青绿色眼睛' } }, appearanceReferenceAssetKeys: [] }],
    relationships: [],
    stages: [
      { id: 'stage-one', title: '雪山实验', order: 1, actorIds: ['actor-albedo'], location: '阿贝多的营地', instruction: '观察结晶反应', requiredBeats: [], locked: false, endCondition: '' },
      { id: 'stage-two', title: '记录结果', order: 2, actorIds: ['actor-albedo'], location: '阿贝多的营地', instruction: '记录实验结论', requiredBeats: [], locked: false, endCondition: '' },
    ],
    conversations: [], messages: [], posts: [], comments: [], likes: [], mediaSlots: [], facts: [], stageResults: [],
    scenes: [{ id: 'scene-one', stageId: 'stage-one', title: '低温萃取', timeText: '傍晚', locationText: '营地实验桌', environment: '风雪渐起，烧瓶泛出浅金色微光', beats: [
      { id: 'beat-one', characterId: 'actor-albedo', action: '阿贝多轻轻摇晃试管，注视着结晶的分子重组', dialogue: '反应比预期更稳定。', outcome: '结晶发出微光', orderIndex: 0 },
    ] }],
  } as ContentDocument;
}

function comicDocument(revisionId: string): ComicDocument {
  return {
    schemaVersion: 1, contentRevisionId: revisionId, style: 'ink-paper-v1', canvas: { width: 1920, height: 1080 },
    pages: [{ id: 'page-one', title: '雪山实验', template: 'single', panelIds: ['panel-one'] }],
    panels: [{ id: 'panel-one', source: { stageId: 'stage-one', sceneId: 'scene-one', beatIds: ['beat-one'] }, actorIds: ['actor-albedo'],
      shotSize: 'medium', visualDescription: '阿贝多观察发光结晶', composition: '人物与试管位于画面中央', textSafeArea: 'top_left', selectedImage: null,
      crop: { focalX: 0.5, focalY: 0.5, zoom: 1 }, bubbles: [], presentation: { camera: 'none', impact: 'none', holdMs: null }, renderSettings: {} }],
  };
}

function installWorkflow(database: ServiceDatabase) {
  const now = nowIso();
  database.connection.prepare(`INSERT INTO provider_profiles(id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at)
    VALUES ('comic-text','Mock text','llm','http://llm.mock/v1','mock-text-model',NULL,1,?,?)`).run(now, now);
  database.connection.prepare("INSERT INTO provider_profile_options(profile_id,thinking_mode) VALUES ('comic-text','enabled')");
  database.connection.prepare("INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('activities','text','comic-text',?)").run(now);
  database.connection.prepare(`INSERT INTO generation_engines(id,name,kind,base_url,credential_account,enabled,concurrency_limit,created_at,updated_at)
    VALUES ('comic-engine','Mock Comfy','comfyui','http://comfy.mock',NULL,1,2,?,?)`).run(now, now);
  database.connection.prepare(`INSERT INTO generation_workflows(id,name,description,engine_kind,latest_version,created_at,updated_at,category)
    VALUES ('comic-workflow','漫画测试工作流','', 'comfyui',1,?,?,'image')`).run(now, now);
  const schema = {
    prompt: { semantic: 'prompt', type: 'long-text', required: true },
    negative: { semantic: 'negative_prompt', type: 'long-text' },
    seed: { semantic: 'seed', type: 'seed', minimum: 0, maximum: 2147483647 },
    checkpoint: { semantic: 'model', type: 'model', required: true, default: 'anima-base.safetensors' },
    width: { semantic: 'width', type: 'integer', required: true, default: 768, minimum: 256 },
    height: { semantic: 'height', type: 'integer', required: true, default: 768, minimum: 256 },
  };
  const bindings = { prompt: ['1', 'inputs', 'text'], negative: ['2', 'inputs', 'text'], seed: ['3', 'inputs', 'seed'],
    checkpoint: ['4', 'inputs', 'ckpt_name'], width: ['6', 'inputs', 'width'], height: ['6', 'inputs', 'height'] };
  const editorConfig = { version: 2, modelSelection: 'individual', fields: {}, activityLoraInjection: { targetNodeId: '3', targetInput: 'model' },
    loraSlots: [], sizePresets: [], constraints: {} };
  const graph = {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } }, '2': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
    '3': { class_type: 'KSampler', inputs: { seed: 0, model: ['4', 0], positive: ['1', 0], negative: ['2', 0] } },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'anima-base.safetensors' } },
    '5': { class_type: 'SaveImage', inputs: { images: ['3', 0] } },
    '6': { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 768, batch_size: 1 } },
  };
  database.connection.prepare(`INSERT INTO generation_workflow_versions
    (workflow_id,version,engine_id,input_schema_json,node_bindings_json,output_declarations_json,definition_json,is_published,created_at,input_capabilities_json,output_media_types_json,output_schema_json,config_format_version,editor_config_json)
    VALUES ('comic-workflow',1,'comic-engine',?,?,?,?,1,?,'{}','["image/png"]','{}',2,?)`)
    .run(JSON.stringify(schema), JSON.stringify(bindings), '["5"]', JSON.stringify(graph), now, JSON.stringify(editorConfig));
  database.connection.prepare(`INSERT INTO app_generation_assignments(app_id,purpose,workflow_id,workflow_version,engine_id,updated_at)
    VALUES ('activities','activity_image_text','comic-workflow',1,'comic-engine',?)`).run(now);
  const preset = createPreset(database, { appId: 'activities', purpose: 'activity_image_text', name: 'Anima Base', workflowId: 'comic-workflow',
    workflowVersion: 1, engineId: 'comic-engine', values: { checkpoint: 'anima-base.safetensors', width: 768, height: 768 } });
  setDefaultPreset(database, preset.id);
}

test('comic render submits the previewed workflow, keeps images in comic history, and never mutates scene media', async () => {
  const artifactDirectory = mkdtempSync(join(tmpdir(), 'sthstart-comic-render-'));
  const database = new ServiceDatabase(':memory:');
  const calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  let missingCheckpoint = false;
  let failOptimizer = false;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ url, body });
    if (url.endsWith('/chat/completions')) {
      if (failOptimizer) { failOptimizer = false; return Response.json({ error: 'mock optimizer failure' }, { status: 503 }); }
      return Response.json({ choices: [{ message: { content: 'anime illustration, Albedo carefully observing a glowing crystal vial at a snowy campsite, medium shot, clean space at upper left' } }] });
    }
    if (url.endsWith('/object_info')) return Response.json({
      CLIPTextEncode: { input: { required: { text: ['STRING', {}] } } },
      KSampler: { input: { required: { seed: ['INT', {}] } } },
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [[...(missingCheckpoint ? [] : ['anima-base.safetensors']), 'other.safetensors'], {}] } } },
      EmptyLatentImage: { input: { required: { width: ['INT', {}], height: ['INT', {}], batch_size: ['INT', {}] } } },
      SaveImage: { input: { required: { images: ['IMAGE', {}] } } },
    });
    if (url.endsWith('/prompt')) return Response.json({ prompt_id: 'comic_prompt_1' });
    if (url.includes('/history/comic_prompt_1')) return Response.json({ comic_prompt_1: {
      status: { status_str: 'success', completed: true },
      outputs: { '5': { images: [{ filename: 'comic-panel.png', subfolder: '', type: 'output', content_type: 'image/png' }] } },
    } });
    if (url.includes('/view?')) return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { 'content-type': 'image/png' } });
    if (url.endsWith('/queue')) return Response.json({ queue_running: [], queue_pending: [] });
    return new Response('not found', { status: 404 });
  };
  const config = readConfig({ STHSTART_ADMIN_TOKEN: adminToken, STHSTART_ARTIFACT_DIR: artifactDirectory });
  const { app } = await createService({ config, database, secrets: new SecretStore({}), fetcher });
  try {
    installWorkflow(database);
    const activity = await app.inject({ method: 'POST', url: '/api/v1/admin/activities', headers: adminHeaders, payload: { document: story() } });
    assert.equal(activity.statusCode, 201, activity.body);
    const activityId = String(activity.json().activity.id);
    const contentRevisionId = String(activity.json().activity.currentContentRevisionId);
    const activityStore = new ActivityStore(database);
    const beatMediaBefore = activityStore.getDraft(activityId)!.document.scenes![0].beats[0].mediaUrl ?? null;
    const comicStore = new ComicStore(database);
    comicStore.createComicDraft(activityId, contentRevisionId);
    comicStore.saveComicDraft(activityId, 1, comicDocument(contentRevisionId));
    const api = `/api/v1/admin/activities/${activityId}/comic/panels/panel-one`;

    const previewResponse = await app.inject({ method: 'POST', url: `${api}/render-preview`, headers: adminHeaders,
      payload: { expectedDraftVersion: 2, seed: 1234 } });
    assert.equal(previewResponse.statusCode, 200, previewResponse.body);
    const preview = previewResponse.json() as { planHash: string; canSubmit: boolean; positivePrompt: string; model: string; seed: number };
    assert.equal(preview.canSubmit, true);
    assert.match(preview.positivePrompt, /阿贝多轻轻摇晃试管/);
    assert.equal(preview.model, 'anima-base.safetensors');

    const renderRequest = { expectedDraftVersion: 2, planHash: preview.planHash, seed: preview.seed, idempotencyKey: 'comic-render-one' };
    const submitted = await app.inject({ method: 'POST', url: `${api}/renders`, headers: adminHeaders, payload: renderRequest });
    assert.equal(submitted.statusCode, 202, submitted.body);
    const repeated = await app.inject({ method: 'POST', url: `${api}/renders`, headers: adminHeaders, payload: renderRequest });
    assert.equal(repeated.statusCode, 202, repeated.body);
    assert.equal(repeated.json().job.id, submitted.json().job.id, 'same idempotency key returns the existing comic render');

    let job: { status: ComicJob['status']; generationTaskId: string | null; callId: string | null } = { status: 'queued', generationTaskId: null, callId: null };
    for (let attempt = 0; attempt < 200; attempt++) {
      const response = await app.inject({ method: 'GET', url: `/api/v1/admin/activities/${activityId}/comic/jobs/${submitted.json().job.id}`, headers: adminHeaders });
      job = response.json().job as typeof job;
      if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'unknown') break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
    }
    assert.equal(job.status, 'succeeded');
    assert.ok(job.generationTaskId);
    assert.ok(job.callId);
    const promptCall = calls.find((item) => item.url.endsWith('/prompt'));
    const actualGraph = promptCall?.body?.prompt as Record<string, { inputs?: Record<string, unknown> }> | undefined;
    assert.ok(actualGraph, 'the common generation executor submitted a workflow graph');
    assert.match(String(actualGraph['1'].inputs?.text), /anime illustration/);
    assert.equal(actualGraph['3'].inputs?.seed, 1234);
    assert.equal(actualGraph['4'].inputs?.ckpt_name, 'anima-base.safetensors');
    const callRecord = database.connection.prepare('SELECT request_snapshot_json,positive_prompt,models_json FROM ai_call_records WHERE id=?').get(job.callId) as
      { request_snapshot_json: string; positive_prompt: string; models_json: string };
    assert.deepEqual(JSON.parse(callRecord.request_snapshot_json), actualGraph);
    assert.equal(callRecord.positive_prompt, actualGraph['1'].inputs?.text);
    assert.deepEqual(JSON.parse(callRecord.models_json), ['anima-base.safetensors']);

    const historyResponse = await app.inject({ method: 'GET', url: `${api}/history`, headers: adminHeaders });
    assert.equal(historyResponse.statusCode, 200, historyResponse.body);
    assert.equal(historyResponse.json().images.length, 1);
    const image = historyResponse.json().images[0] as { artifactId: string; available: boolean; sourceChanged: boolean };
    assert.equal(image.available, true);
    assert.equal(image.sourceChanged, false);
    const selected = await app.inject({ method: 'POST', url: `${api}/select-image`, headers: adminHeaders, payload: {
      expectedDraftVersion: 2, artifactId: image.artifactId, allowStaleSource: false,
    } });
    assert.equal(selected.statusCode, 200, selected.body);
    assert.equal(selected.json().draft.document.panels[0].selectedImage.artifactId, image.artifactId);
    const retryAfterSelection = await app.inject({ method: 'POST', url: `${api}/renders`, headers: adminHeaders, payload: renderRequest });
    assert.equal(retryAfterSelection.statusCode, 202, retryAfterSelection.body);
    assert.equal(retryAfterSelection.json().job.id, submitted.json().job.id);
    assert.equal(calls.filter((item) => item.url.endsWith('/prompt')).length, 1, 'a transport retry cannot submit another ComfyUI job');
    assert.equal(activityStore.getDraft(activityId)!.document.scenes![0].beats[0].mediaUrl ?? null, beatMediaBefore,
      'selecting a comic image changes only the comic draft, not the source SceneBeat');

    missingCheckpoint = true;
    const unavailablePreview = await app.inject({ method: 'POST', url: `${api}/render-preview`, headers: adminHeaders,
      payload: { expectedDraftVersion: 3, seed: 5678 } });
    assert.equal(unavailablePreview.statusCode, 200);
    assert.equal(unavailablePreview.json().canSubmit, false);
    const tasksBeforeMissingModel = Number(database.connection.prepare('SELECT COUNT(*) count FROM generation_tasks').get()!.count);
    const rejected = await app.inject({ method: 'POST', url: `${api}/renders`, headers: adminHeaders, payload: {
      expectedDraftVersion: 3, planHash: unavailablePreview.json().planHash, seed: 5678, idempotencyKey: 'comic-missing-model',
    } });
    assert.equal(rejected.statusCode, 409);
    assert.equal(Number(database.connection.prepare('SELECT COUNT(*) count FROM generation_tasks').get()!.count), tasksBeforeMissingModel);
    missingCheckpoint = false;

    failOptimizer = true;
    const retryPreview = await app.inject({ method: 'POST', url: `${api}/render-preview`, headers: adminHeaders,
      payload: { expectedDraftVersion: 3, seed: 2468 } });
    const taskCountBeforeOptimizerFailure = Number(database.connection.prepare('SELECT COUNT(*) count FROM generation_tasks').get()!.count);
    const optimizerFailure = await app.inject({ method: 'POST', url: `${api}/renders`, headers: adminHeaders, payload: {
      expectedDraftVersion: 3, planHash: retryPreview.json().planHash, seed: 2468, idempotencyKey: 'comic-optimizer-failure',
    } });
    assert.equal(optimizerFailure.statusCode, 202);
    let failedJob: { status: ComicJob['status']; errorMessage: string | null; callId: string | null } = { status: 'queued', errorMessage: null, callId: null };
    for (let attempt = 0; attempt < 200; attempt++) {
      const response = await app.inject({ method: 'GET', url: `/api/v1/admin/activities/${activityId}/comic/jobs/${optimizerFailure.json().job.id}`, headers: adminHeaders });
      failedJob = response.json().job as typeof failedJob;
      if (failedJob.status === 'failed') break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
    }
    assert.equal(failedJob.status, 'failed');
    assert.ok(failedJob.callId, 'failed optimizer calls remain traceable');
    assert.equal(Number(database.connection.prepare('SELECT COUNT(*) count FROM generation_tasks').get()!.count), taskCountBeforeOptimizerFailure,
      'optimizer failure never submits an unoptimized prompt to ComfyUI');
    assert.equal(activityStore.getDraft(activityId)!.document.scenes![0].beats[0].mediaUrl ?? null, beatMediaBefore);
  } finally {
    await app.close();
    database.close();
    rmSync(artifactDirectory, { recursive: true, force: true });
  }
});

test('comic prompt source fingerprint ignores selected image, crop, bubbles, and presentation', () => {
  const content = story();
  const panel = comicDocument('revision-one').panels[0];
  const first = compileComicPanelSource({ content, panel });
  const decorated = { ...panel, selectedImage: { artifactId: 'image-one', origin: 'comic_render' as const, renderJobId: 'job-one', sourceFingerprint: first.sourceFingerprint },
    crop: { focalX: 0.1, focalY: 0.9, zoom: 2 }, bubbles: [{ id: 'bubble', kind: 'speech' as const, speakerActorId: 'actor-albedo', text: '不同台词', rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 }, tail: null, fontSize: 32 }],
    presentation: { camera: 'push_in' as const, impact: 'flash' as const, holdMs: 1200 } };
  assert.equal(compileComicPanelSource({ content, panel: decorated }).sourceFingerprint, first.sourceFingerprint);
  assert.notEqual(compileComicPanelSource({ content, panel: { ...panel, composition: '人物位于画面右侧' } }).sourceFingerprint, first.sourceFingerprint);
});
