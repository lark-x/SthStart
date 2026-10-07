import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAiCallRecord, hashAiSource, syncGenerationAiCall, updateAiCallRecord } from '../ai-call-trace.js';
import test from 'node:test';
import type { BeatRenderPreview, ContentDocument } from '@sthstart/contracts';
import { createService } from '../server.js';
import { ServiceDatabase, nowIso } from '../database.js';
import { readConfig } from '../config.js';
import { SecretStore } from '../security.js';
import { ActivityStore } from './store.js';
import { createPreset, setDefaultPreset, updatePreset } from '../generation/configuration-store.js';

const adminToken = 'beat-render-admin-token-1234567890';
const adminHeaders = { 'x-sthstart-admin-token': adminToken };

function sampleDocument() {
  return {
    schemaVersion: 1 as const,
    activity: { title: '镜头工作流测试', type: '日常生活', theme: '相见', location: '庭院', rules: '', generationMode: 'fill_details' as const },
    actors: [{ id: 'actor-alice', displayName: '爱丽丝', activityRole: '来访者', outfitDescription: '蓝色外套',
    appearanceReferenceAssetKeys: [], persona: { schemaVersion: 2, personaText: '住在森林边的旅人', sourceVersion: 'hidden-source-version',
        appearance: { baseText: '银白长发，绿色眼睛', defaultOutfitText: '不应使用的默认长袍', stableFeatures: ['左耳小银饰'] } }, sourceVersion: 4 }],
    relationships: [],
    stages: [
      { id: 'stage-one', title: '初遇', order: 1, actorIds: ['actor-alice'], location: '庭院', instruction: '走进庭院', requiredBeats: [], locked: false, endCondition: '问候结束' },
      { id: 'stage-two', title: '告别', order: 2, actorIds: ['actor-alice'], location: '门口', instruction: '挥手离开', requiredBeats: [], locked: false, endCondition: '旅程开始' },
    ],
    conversations: [], messages: [], posts: [], comments: [], likes: [], mediaSlots: [], facts: [], stageResults: [],
    scenes: [{ id: 'scene-one', stageId: 'stage-one', title: '庭院相见', timeText: '午后', locationText: '石板路', environment: '树影摇动', beats: [
      { id: 'beat-one', characterId: 'actor-alice', characterName: '错误的重名角色', action: '向朋友挥手', dialogue: '你好，欢迎来访。', outcome: '两人相视微笑', orderIndex: 0 },
    ] }],
  };
}

test('beat render preview is read-only, submit is idempotent, and adoption checks source changes', async () => {
  const artifactDirectory = mkdtempSync(join(tmpdir(), 'sthstart-beat-render-'));
  const database = new ServiceDatabase(':memory:');
  const calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  let failNextOptimization = false;
  let missingCheckpoint = false;
  let runtimePreflightCalls = 0;
  let missingCheckpointAtPreflight: number | null = null;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ url, body });
    if (url.endsWith('/chat/completions')) {
      if (failNextOptimization) { failNextOptimization = false; return Response.json({ error: 'mock optimizer failure' }, { status: 503 }); }
      return Response.json({ choices: [{ message: { content: 'cinematic illustration of Alice visibly waving to a friend in a leafy courtyard, afternoon light' } }] });
    }
    if (url.endsWith('/object_info')) {
      runtimePreflightCalls++;
      const omitSelectedModel = missingCheckpoint || runtimePreflightCalls === missingCheckpointAtPreflight;
      return Response.json({
        CLIPTextEncode: { input: { required: { text: ['STRING', {}] } } },
        KSampler: { input: { required: { seed: ['INT', {}] } } },
        CheckpointLoaderSimple: { input: { required: { ckpt_name: [[...(omitSelectedModel ? [] : ['portrait-model.safetensors', 'baked-checkpoint.safetensors']), 'other-model.safetensors'], {}] } } },
        LoraLoaderModelOnly: { input: { required: { model: ['MODEL', {}], lora_name: [['portrait-style.safetensors'], {}], strength_model: ['FLOAT', { default: 1 }] } } },
        SaveImage: { input: { required: { images: ['IMAGE', {}] } } },
      });
    }
    if (url.endsWith('/prompt')) return Response.json({ prompt_id: 'beat_prompt_123' });
    if (url.includes('/history/beat_prompt_123')) return Response.json({ beat_prompt_123: {
      status: { status_str: 'success', completed: true },
      outputs: { '5': { images: [
        { filename: 'candidate.png', subfolder: '', type: 'output', content_type: 'image/png' },
        { filename: 'candidate-2.png', subfolder: '', type: 'output', content_type: 'image/png' },
      ] } },
    } });
    if (url.includes('/view?')) return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { 'content-type': 'image/png' } });
    if (url.endsWith('/queue')) return Response.json({ queue_running: [], queue_pending: [] });
    return new Response('not found', { status: 404 });
  };
  const config = readConfig({ STHSTART_ADMIN_TOKEN: adminToken, STHSTART_ARTIFACT_DIR: artifactDirectory });
  const secrets = new SecretStore({});
  const { app } = await createService({ config, database, secrets, fetcher });
  let currentApp = app;
  const now = nowIso();
  database.connection.prepare(`INSERT INTO provider_profiles(id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at)
    VALUES ('beat-text','Mock text','llm','http://llm.mock/v1','mock-text-model',NULL,1,?,?)`).run(now, now);
  database.connection.prepare(`INSERT INTO provider_profile_options(profile_id,thinking_mode) VALUES ('beat-text','enabled')`);
  database.connection.prepare("INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('activities','text','beat-text',?)").run(now);
  database.connection.prepare('INSERT INTO generation_engines(id,name,kind,base_url,credential_account,enabled,concurrency_limit,created_at,updated_at) VALUES (?,?,?,?,NULL,1,2,?,?)')
    .run('beat-engine', 'Mock Comfy', 'comfyui', 'http://comfy.mock', now, now);
  database.connection.prepare('INSERT INTO generation_workflows(id,name,description,engine_kind,latest_version,created_at,updated_at,category) VALUES (?,?,?,?,1,?,?,\'image\')')
    .run('beat-workflow', '镜头图片工作流', '', 'comfyui', now, now);
  const inputSchema = {
    prompt: { semantic: 'prompt', type: 'long-text', required: true },
    negative: { semantic: 'negative_prompt', type: 'long-text' },
    seed: { semantic: 'seed', type: 'seed', minimum: 0, maximum: 2147483647 },
    checkpoint: { semantic: 'checkpoint', type: 'model', default: 'portrait-model.safetensors' },
  };
  const nodeBindings = {
    prompt: ['1', 'inputs', 'text'], negative: ['2', 'inputs', 'text'], seed: ['3', 'inputs', 'seed'], checkpoint: ['4', 'inputs', 'ckpt_name'],
  };
  const editorConfig = {
    version: 2,
    modelSelection: 'individual',
    fields: {
      prompt: { key: 'prompt', label: '正向提示词', section: 'basic', order: 1, type: 'long-text' },
      negative: { key: 'negative', label: '反向提示词', section: 'basic', order: 2, type: 'long-text' },
      seed: { key: 'seed', label: '随机种子', section: 'basic', order: 3, type: 'seed' },
      checkpoint: { key: 'checkpoint', label: '主模型', section: 'basic', order: 4, type: 'model', modelCategory: 'checkpoints', allowedModels: ['portrait-model.safetensors'] },
    },
    activityLoraInjection: { targetNodeId: '3', targetInput: 'model' },
    loraSlots: [], sizePresets: [], constraints: {},
  };
  const workflow = {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
    '3': { class_type: 'KSampler', inputs: { seed: 0, model: ['4', 0] } },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'portrait-model.safetensors' } },
    '5': { class_type: 'SaveImage', inputs: { images: ['3', 0] } },
  };
  database.connection.prepare(`INSERT INTO generation_workflow_versions
    (workflow_id,version,engine_id,input_schema_json,node_bindings_json,output_declarations_json,definition_json,is_published,created_at,input_capabilities_json,output_media_types_json,output_schema_json,config_format_version,editor_config_json)
    VALUES (?,?,?,?,?,?,?,1,?,'{}','["image/png"]','{}',2,?)`)
    .run('beat-workflow', 1, 'beat-engine', JSON.stringify(inputSchema), JSON.stringify(nodeBindings), '["5"]', JSON.stringify(workflow), now, JSON.stringify(editorConfig));
  database.connection.prepare(`INSERT INTO app_generation_assignments(app_id,purpose,workflow_id,workflow_version,engine_id,updated_at)
    VALUES ('activities','activity_image_text','beat-workflow',1,'beat-engine',?)`).run(now);
  const beatPreset = createPreset(database, { appId: 'activities', purpose: 'activity_image_text', name: '镜头测试预设',
    workflowId: 'beat-workflow', workflowVersion: 1, engineId: 'beat-engine', values: { checkpoint: 'portrait-model.safetensors' } });
  setDefaultPreset(database, beatPreset.id);
  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/activities', headers: adminHeaders, payload: { document: sampleDocument() } });
  assert.equal(created.statusCode, 201, created.body);
  const activityId = String(created.json().activity.id);
  const store = new ActivityStore(database);
  const endpoint = `/api/v1/admin/activities/${activityId}/beat-renders`;
  const previewResponse = await app.inject({ method: 'POST', url: `${endpoint}/preview`, headers: adminHeaders,
    payload: { stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one' } });
  assert.equal(previewResponse.statusCode, 200, previewResponse.body);
  let preview = previewResponse.json() as BeatRenderPreview;
  assert.match(preview.positivePrompt, /爱丽丝/);
  assert.match(preview.positivePrompt, /银白长发/);
  assert.match(preview.positivePrompt, /左耳小银饰/);
  assert.match(preview.positivePrompt, /蓝色外套/);
  assert.doesNotMatch(preview.positivePrompt, /不应使用的默认长袍/);
  assert.match(preview.positivePrompt, /向朋友挥手/);
  assert.match(preview.positivePrompt, /主体角色[\s\S]*可见动作[\s\S]*场景[\s\S]*镜头构图/);
  assert.doesNotMatch(preview.positivePrompt, /主体角色：主体角色：/);
  assert.doesNotMatch(preview.positivePrompt, /住在森林边的旅人|温和|hidden-source-version|sourceVersion|来访者/);
  assert.doesNotMatch(preview.positivePrompt, /错误的重名角色/);
  assert.equal(preview.model, 'portrait-model.safetensors');
  assert.equal(database.connection.prepare('SELECT COUNT(*) count FROM ai_call_records').get()!.count, 0);
  assert.equal(database.connection.prepare('SELECT COUNT(*) count FROM generation_tasks').get()!.count, 0);

  const policyUpdate = await app.inject({ method: 'PUT', url: '/api/v1/admin/generation/activity-image-prompt-policy', headers: adminHeaders,
    payload: { workflowId: preview.workflowId, workflowVersion: preview.workflowVersion, revision: 0, enabled: true,
      instructions: '保持镜头主体与动作准确。', positiveSuffix: 'policy-revision-one', negativePrompt: '' } });
  assert.equal(policyUpdate.statusCode, 200, policyUpdate.body);
  const stalePolicySubmission = await app.inject({ method: 'POST', url: endpoint, headers: adminHeaders, payload: {
    stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one', purpose: preview.purpose,
    presetId: preview.selectedPresetId, presetRevision: preview.selectedPresetRevision,
    workflowId: preview.workflowId, workflowVersion: preview.workflowVersion, parameters: preview.parameters,
    seed: preview.seed, negativePrompt: preview.negativePrompt, planHash: preview.planHash, idempotencyKey: 'beat-render-stale-policy',
  } });
  assert.equal(stalePolicySubmission.statusCode, 409);
  assert.equal(stalePolicySubmission.json().error, 'beat_render_plan_conflict');
  assert.equal(database.connection.prepare('SELECT COUNT(*) count FROM activity_beat_render_candidates').get()!.count, 0,
    'a prompt-policy revision change after preview rejects the stale request before candidate creation');
  assert.equal(database.connection.prepare('SELECT COUNT(*) count FROM ai_call_records').get()!.count, 0);
  const refreshedPreviewResponse = await app.inject({ method: 'POST', url: `${endpoint}/preview`, headers: adminHeaders,
    payload: { stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one' } });
  assert.equal(refreshedPreviewResponse.statusCode, 200, refreshedPreviewResponse.body);
  preview = refreshedPreviewResponse.json() as BeatRenderPreview;
  assert.equal(preview.promptOptimization.policyRevision, 1);
  // 计划 §15.1：常用页要说明模式来自哪个工作流；测试夹具的工作流在图内拼接提示词。
  assert.equal(preview.promptAssembly, 'workflow-internal');
  assert.equal(typeof preview.workflowName, 'string');
  assert.equal(typeof preview.workflowVersion, 'number');

  updatePreset(database, beatPreset.id, { revision: beatPreset.revision, name: '镜头测试预设（修订）' });
  const stalePresetSubmission = await app.inject({ method: 'POST', url: endpoint, headers: adminHeaders, payload: {
    stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one', purpose: preview.purpose,
    presetId: preview.selectedPresetId, presetRevision: preview.selectedPresetRevision,
    workflowId: preview.workflowId, workflowVersion: preview.workflowVersion, parameters: preview.parameters,
    seed: preview.seed, negativePrompt: preview.negativePrompt, planHash: preview.planHash, idempotencyKey: 'beat-render-stale-preset',
  } });
  assert.equal(stalePresetSubmission.statusCode, 409);
  assert.equal(stalePresetSubmission.json().error, 'preset_revision_conflict');
  assert.equal(database.connection.prepare('SELECT COUNT(*) count FROM activity_beat_render_candidates').get()!.count, 0,
    'a preset revision change after preview rejects the stale request before candidate creation');
  assert.equal(database.connection.prepare('SELECT COUNT(*) count FROM ai_call_records').get()!.count, 0);
  const refreshedPresetPreviewResponse = await app.inject({ method: 'POST', url: `${endpoint}/preview`, headers: adminHeaders,
    payload: { stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one' } });
  assert.equal(refreshedPresetPreviewResponse.statusCode, 200, refreshedPresetPreviewResponse.body);
  preview = refreshedPresetPreviewResponse.json() as BeatRenderPreview;
  assert.equal(preview.promptOptimization.policyRevision, 1);

  missingCheckpoint = true;
  const unavailablePreviewResponse = await app.inject({ method: 'POST', url: `${endpoint}/preview`, headers: adminHeaders,
    payload: { stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one' } });
  const unavailablePreview = unavailablePreviewResponse.json() as BeatRenderPreview;
  assert.equal(unavailablePreview.canSubmit, false);
  assert.match(unavailablePreview.warnings.join(' '), /portrait-model\.safetensors/);
  const optimizerCallsBeforeUnavailableSubmit = calls.filter((item) => item.url.endsWith('/chat/completions')).length;
  const unavailableSubmit = await app.inject({ method: 'POST', url: endpoint, headers: adminHeaders, payload: {
    stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one', purpose: unavailablePreview.purpose,
    presetId: unavailablePreview.selectedPresetId, presetRevision: unavailablePreview.selectedPresetRevision,
    workflowId: unavailablePreview.workflowId, workflowVersion: unavailablePreview.workflowVersion, parameters: unavailablePreview.parameters,
    seed: unavailablePreview.seed, negativePrompt: unavailablePreview.negativePrompt, planHash: unavailablePreview.planHash, idempotencyKey: 'beat-render-missing-model',
  } });
  assert.equal(unavailableSubmit.statusCode, 409);
  assert.equal(unavailableSubmit.json().error, 'workflow_runtime_requirements_missing');
  assert.match(unavailableSubmit.json().message, /portrait-model\.safetensors/);
  assert.equal(database.connection.prepare('SELECT COUNT(*) count FROM activity_beat_render_candidates').get()!.count, 0,
    'missing model is rejected before a candidate, optimizer call, or ComfyUI task is created');
  assert.equal(database.connection.prepare('SELECT COUNT(*) count FROM generation_tasks').get()!.count, 0);
  assert.equal(calls.filter((item) => item.url.endsWith('/chat/completions')).length, optimizerCallsBeforeUnavailableSubmit);
  missingCheckpoint = false;

  const racePreviewResponse = await app.inject({ method: 'POST', url: `${endpoint}/preview`, headers: adminHeaders,
    payload: { stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one' } });
  const racePreview = racePreviewResponse.json() as BeatRenderPreview;
  missingCheckpointAtPreflight = runtimePreflightCalls + 2;
  const tasksBeforeAsyncPreflightFailure = Number(database.connection.prepare('SELECT COUNT(*) count FROM generation_tasks').get()!.count);
  const optimizerCallsBeforeAsyncPreflightFailure = calls.filter((item) => item.url.endsWith('/chat/completions')).length;
  const promptsBeforeAsyncPreflightFailure = calls.filter((item) => item.url.endsWith('/prompt')).length;
  const asyncPreflightFailure = await app.inject({ method: 'POST', url: endpoint, headers: adminHeaders, payload: {
    stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one', purpose: racePreview.purpose,
    presetId: racePreview.selectedPresetId, presetRevision: racePreview.selectedPresetRevision,
    workflowId: racePreview.workflowId, workflowVersion: racePreview.workflowVersion, parameters: racePreview.parameters,
    seed: racePreview.seed, negativePrompt: racePreview.negativePrompt, planHash: racePreview.planHash, idempotencyKey: 'beat-render-async-preflight-failure',
  } });
  assert.equal(asyncPreflightFailure.statusCode, 202, asyncPreflightFailure.body);
  let asyncFailureCandidate: { status: string; task_id: string | null; call_id: string | null; error_message: string | null } | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    asyncFailureCandidate = database.connection.prepare('SELECT status,task_id,call_id,error_message FROM activity_beat_render_candidates WHERE id=?')
      .get(asyncPreflightFailure.json().candidateId) as typeof asyncFailureCandidate;
    if (asyncFailureCandidate?.status === 'failed') break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  assert.equal(asyncFailureCandidate?.status, 'failed');
  assert.equal(asyncFailureCandidate?.task_id, null);
  assert.equal(asyncFailureCandidate?.call_id, null);
  assert.match(asyncFailureCandidate?.error_message ?? '', /portrait-model\.safetensors/);
  assert.equal(Number(database.connection.prepare('SELECT COUNT(*) count FROM generation_tasks').get()!.count), tasksBeforeAsyncPreflightFailure,
    'a dependency disappearing during async dispatch leaves a visible failed candidate but never creates a Comfy task');
  assert.equal(calls.filter((item) => item.url.endsWith('/chat/completions')).length, optimizerCallsBeforeAsyncPreflightFailure,
    'the second runtime preflight runs before prompt optimization');
  assert.equal(calls.filter((item) => item.url.endsWith('/prompt')).length, promptsBeforeAsyncPreflightFailure);

  const submitPayload = {
    stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one', purpose: preview.purpose,
    presetId: preview.selectedPresetId, presetRevision: preview.selectedPresetRevision,
    workflowId: preview.workflowId, workflowVersion: preview.workflowVersion, parameters: preview.parameters,
    seed: preview.seed, negativePrompt: preview.negativePrompt, planHash: preview.planHash, idempotencyKey: 'beat-render-request-001',
  };
  const submitted = await app.inject({ method: 'POST', url: endpoint, headers: adminHeaders, payload: submitPayload });
  assert.equal(submitted.statusCode, 202, submitted.body);
  const duplicate = await app.inject({ method: 'POST', url: endpoint, headers: adminHeaders, payload: submitPayload });
  assert.equal(duplicate.statusCode, 202, duplicate.body);
  assert.equal(duplicate.json().candidateId, submitted.json().candidateId, 'duplicate submission returns the same candidate without creating another task');
  assert.equal(store.getDraft(activityId)!.document.scenes![0].beats[0].mediaUrl, undefined);
  assert.equal(store.getDraft(activityId)!.document.scenes![0].beats[0].mediaUrl, undefined);

  let candidateStatus = '';
  let autoApplyState = '';
  let candidateTaskId: string | null = null;
  for (let attempt = 0; attempt < 100; attempt++) {
    const row = database.connection.prepare('SELECT status,task_id,auto_apply_state FROM activity_beat_render_candidates WHERE id=?').get(submitted.json().candidateId) as { status: string; task_id: string | null; auto_apply_state: string };
    candidateStatus = row.status; candidateTaskId = row.task_id; autoApplyState = row.auto_apply_state;
    if (candidateStatus === 'failed' || candidateStatus === 'succeeded' && autoApplyState !== 'pending') break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  assert.equal(candidateStatus, 'succeeded');
  const taskId = String(candidateTaskId);
  assert.equal(database.connection.prepare('SELECT COUNT(*) count FROM generation_tasks').get()!.count, 1);
  assert.equal(database.connection.prepare('SELECT COUNT(*) count FROM ai_call_records').get()!.count, 2,
    'one audited optimizer call and one generation call are recorded');
  const candidateRow = database.connection.prepare('SELECT call_id,original_prompt,positive_prompt FROM activity_beat_render_candidates WHERE id=?')
    .get(submitted.json().candidateId) as { call_id: string; original_prompt: string; positive_prompt: string };
  assert.match(candidateRow.original_prompt, /向朋友挥手/);
  assert.match(candidateRow.positive_prompt, /cinematic illustration of Alice/);
  const optimizerRequest = calls.find((item) => item.url.endsWith('/chat/completions'))?.body;
  assert.deepEqual(optimizerRequest?.thinking, { type: 'disabled' },
    'image prompt rewriting disables long reasoning even when the shared profile enables it');
  const promptRequest = calls.find((item) => item.url.endsWith('/prompt'))?.body;
  const graph = promptRequest?.prompt as Record<string, { inputs: Record<string, unknown> }> | undefined;
  assert.ok(graph);
  assert.equal(graph['1'].inputs.text, candidateRow.positive_prompt);
  assert.equal(graph['2'].inputs.text, preview.negativePrompt);
  assert.equal(graph['3'].inputs.seed, preview.seed);
  assert.equal(graph['4'].inputs.ckpt_name, 'portrait-model.safetensors');
  const trace = database.connection.prepare('SELECT request_snapshot_json,models_json,positive_prompt,negative_prompt,parent_id,trace_id FROM ai_call_records WHERE id=?').get(candidateRow.call_id) as { request_snapshot_json: string; models_json: string; positive_prompt: string; negative_prompt: string | null; parent_id: string | null; trace_id: string };
  const actualSnapshot = JSON.parse(trace.request_snapshot_json) as Record<string, unknown>;
  assert.deepEqual(actualSnapshot, graph);
  assert.deepEqual(JSON.parse(trace.models_json), ['portrait-model.safetensors']);
  assert.equal(trace.positive_prompt, graph['1'].inputs.text, 'audit prompt is read from the final bound graph');
  assert.equal(trace.negative_prompt, graph['2'].inputs.text);
  assert.equal(trace.parent_id, database.connection.prepare("SELECT id FROM ai_call_records WHERE business_event='activity.image.prompt.optimize' AND trace_id=?").get(trace.trace_id)!.id);
  assert.equal(autoApplyState, 'applied', 'first successful image is automatically written into the empty shot');
  const firstMediaUrl = store.getDraft(activityId)!.document.scenes![0].beats[0].mediaUrl;
  assert.match(firstMediaUrl ?? '', /\/api\/admin\/artifacts\//);
  const history = await app.inject({ method: 'GET', url: `${endpoint}?stageId=stage-one&sceneId=scene-one&beatId=beat-one`, headers: adminHeaders });
  assert.equal(history.statusCode, 200, history.body);
  assert.equal(history.json().imageTotal, 2, 'the history count includes images, not render jobs');
  assert.equal(history.json().items[0].images.length, 2);
  assert.equal(history.json().items[0].images[0].available, true);
  assert.equal(history.json().items[0].images[0].isCurrent, true);
  assert.equal(history.json().items[0].images[1].available, true);
  const secondImageId = String(history.json().items[0].images[1].artifactId);
  const selectedSecondImage = await app.inject({ method: 'POST', url: `${endpoint}/${submitted.json().candidateId}/images/${secondImageId}/select`, headers: adminHeaders, payload: {} });
  assert.equal(selectedSecondImage.statusCode, 200, selectedSecondImage.body);
  assert.equal(selectedSecondImage.json().mediaUrl, `/api/admin/artifacts/${secondImageId}/file`);
  const secondMediaUrl = store.getDraft(activityId)!.document.scenes![0].beats[0].mediaUrl;
  const repeatedSecondSelection = await app.inject({ method: 'POST', url: `${endpoint}/${submitted.json().candidateId}/images/${secondImageId}/select`, headers: adminHeaders, payload: {} });
  assert.equal(repeatedSecondSelection.statusCode, 200, repeatedSecondSelection.body);
  assert.equal(repeatedSecondSelection.json().mediaUrl, secondMediaUrl, 'selecting the already-current image is an idempotent success');
  const restoreFirstImage = await app.inject({ method: 'POST', url: `${endpoint}/${submitted.json().candidateId}/images/${String(history.json().items[0].images[0].artifactId)}/select`, headers: adminHeaders, payload: {} });
  assert.equal(restoreFirstImage.statusCode, 200, restoreFirstImage.body);

  let draft = store.getDraft(activityId)!;
  const unrelatedEdit = { ...draft.document, activity: { ...draft.document.activity, theme: '保留的无关编辑' } };
  store.updateDraft(activityId, draft.draftVersion, unrelatedEdit);
  const adopted = await app.inject({ method: 'POST', url: `${endpoint}/${submitted.json().candidateId}/adopt`, headers: adminHeaders });
  assert.equal(adopted.statusCode, 200, adopted.body);
  const adoptedResponse = adopted.json() as { document: ContentDocument; draftVersion: number };
  assert.equal(adoptedResponse.document.activity.theme, '保留的无关编辑');
  assert.equal(adoptedResponse.document.scenes![0].beats[0].mediaType, 'image');
  draft = store.getDraft(activityId)!;
  assert.equal(adoptedResponse.draftVersion, draft.draftVersion);
  const savedReturnedDocument = store.updateDraft(activityId, adoptedResponse.draftVersion, adoptedResponse.document);
  assert.equal(savedReturnedDocument.document.activity.theme, '保留的无关编辑', 'resaving the returned complete document keeps another page’s unrelated edit');
  assert.equal(draft.document.activity.theme, '保留的无关编辑');
  assert.equal(draft.document.scenes![0].beats[0].mediaType, 'image');
  assert.equal(draft.document.scenes![0].beats[0].mediaUrl, firstMediaUrl, 'the compatibility endpoint is idempotent for the already selected image');

  const beforeLegacySwitch = store.getDraft(activityId)!;
  const legacyDocument = structuredClone(beforeLegacySwitch.document);
  delete legacyDocument.actors[0].appearanceReferenceAssetKeys;
  store.updateDraft(activityId, beforeLegacySwitch.draftVersion, legacyDocument);
  const legacySwitch = await app.inject({ method: 'POST', url: `${endpoint}/${submitted.json().candidateId}/images/${secondImageId}/select`,
    headers: adminHeaders, payload: { allowStaleSource: true } });
  assert.equal(legacySwitch.statusCode, 200, 'an old actor snapshot without appearanceReferenceAssetKeys must not fail after saving the image');
  assert.equal(legacySwitch.json().mediaUrl, `/api/admin/artifacts/${secondImageId}/file`);
  const legacyRepeat = await app.inject({ method: 'POST', url: `${endpoint}/${submitted.json().candidateId}/images/${secondImageId}/select`,
    headers: adminHeaders, payload: {} });
  assert.equal(legacyRepeat.statusCode, 200, 'reselecting a current image in an old document must also serialize successfully');
  const legacyRestore = await app.inject({ method: 'POST', url: `${endpoint}/${submitted.json().candidateId}/images/${String(history.json().items[0].images[0].artifactId)}/select`,
    headers: adminHeaders, payload: { allowStaleSource: true } });
  assert.equal(legacyRestore.statusCode, 200);
  const normalizedDraft = store.getDraft(activityId)!;
  const normalizedDocument = structuredClone(normalizedDraft.document);
  normalizedDocument.actors[0].appearanceReferenceAssetKeys = [];
  store.updateDraft(activityId, normalizedDraft.draftVersion, normalizedDocument);

  const beforeLoraEdit = store.getDraft(activityId)!;
  const loraDocument = structuredClone(beforeLoraEdit.document);
  loraDocument.actors[0].visualLoras = [{ model: 'portrait-style.safetensors', strength: 0.4, triggerWord: 'character-only trigger', enabled: true }];
  loraDocument.scenes![0].beats[0].renderSettings = { loraOverrides: [
    { model: 'portrait-style.safetensors', strength: 0.85, triggerWord: 'shot-only trigger', enabled: true },
  ] };
  store.updateDraft(activityId, beforeLoraEdit.draftVersion, loraDocument);
  const loraPolicy = await app.inject({ method: 'PUT', url: '/api/v1/admin/generation/activity-loras', headers: adminHeaders,
    payload: { workflowId: 'beat-workflow', workflowVersion: 1, expectedRevision: 0,
      entries: [{ model: 'portrait-style.safetensors', strength: 0.65, triggerWord: 'global-only trigger', enabled: true }] } });
  assert.equal(loraPolicy.statusCode, 200, loraPolicy.body);
  assert.equal(loraPolicy.json().policy.insertionSupported, true);
  assert.deepEqual(loraPolicy.json().models, ['portrait-style.safetensors']);

  const missingLoraBefore = Number(database.connection.prepare('SELECT COUNT(*) count FROM generation_tasks').get()!.count);
  const candidatesBeforeMissingLora = Number(database.connection.prepare('SELECT COUNT(*) count FROM activity_beat_render_candidates').get()!.count);
  const missingLoraPreviewResponse = await app.inject({ method: 'POST', url: `${endpoint}/preview`, headers: adminHeaders,
    payload: { stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one',
      loraOverrides: [{ model: 'not-installed.safetensors', strength: 1, triggerWord: '', enabled: true }] } });
  assert.equal(missingLoraPreviewResponse.statusCode, 200, missingLoraPreviewResponse.body);
  const missingLoraPreview = missingLoraPreviewResponse.json() as BeatRenderPreview;
  assert.equal(missingLoraPreview.canSubmit, false);
  assert.match(missingLoraPreview.warnings.join(' '), /not-installed\.safetensors/);
  const blockedMissingLora = await app.inject({ method: 'POST', url: endpoint, headers: adminHeaders, payload: {
    stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one', purpose: missingLoraPreview.purpose,
    presetId: missingLoraPreview.selectedPresetId, presetRevision: missingLoraPreview.selectedPresetRevision,
    workflowId: missingLoraPreview.workflowId, workflowVersion: missingLoraPreview.workflowVersion, parameters: missingLoraPreview.parameters,
    loraOverrides: [{ model: 'not-installed.safetensors', strength: 1, triggerWord: '', enabled: true }],
    seed: missingLoraPreview.seed, planHash: missingLoraPreview.planHash, idempotencyKey: 'beat-render-missing-lora',
  } });
  assert.equal(blockedMissingLora.statusCode, 409);
  assert.equal(Number(database.connection.prepare('SELECT COUNT(*) count FROM generation_tasks').get()!.count), missingLoraBefore,
    'a LoRA missing from the selected ComfyUI instance is rejected before any task is created');
  assert.equal(Number(database.connection.prepare('SELECT COUNT(*) count FROM activity_beat_render_candidates').get()!.count), candidatesBeforeMissingLora,
    'an invalid LoRA never creates a visible render candidate');

  const secondPreviewResponse = await app.inject({ method: 'POST', url: `${endpoint}/preview`, headers: adminHeaders,
    payload: { stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one' } });
  const secondPreview = secondPreviewResponse.json() as BeatRenderPreview;
  assert.equal(secondPreview.loras[0].model, 'portrait-style.safetensors');
  assert.equal(secondPreview.loras[0].source, 'shot');
  assert.equal(secondPreview.loras[0].strength, 0.85, 'shot LoRA overrides role and global strength');
  assert.equal(secondPreview.loras[0].triggerWord, 'shot-only trigger', 'shot trigger word overrides role and global trigger words');
  assert.equal(secondPreview.loras[0].available, true);
  const secondSubmission = await app.inject({ method: 'POST', url: endpoint, headers: adminHeaders, payload: {
    stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one', purpose: secondPreview.purpose,
    presetId: secondPreview.selectedPresetId, presetRevision: secondPreview.selectedPresetRevision,
    workflowId: secondPreview.workflowId, workflowVersion: secondPreview.workflowVersion, parameters: secondPreview.parameters,
    seed: secondPreview.seed, negativePrompt: secondPreview.negativePrompt, planHash: secondPreview.planHash, idempotencyKey: 'beat-render-request-002',
  } });
  assert.equal(secondSubmission.statusCode, 202, secondSubmission.body);
  const secondCandidate = database.connection.prepare('SELECT auto_apply_state FROM activity_beat_render_candidates WHERE id=?').get(secondSubmission.json().candidateId) as { auto_apply_state: string };
  assert.equal(secondCandidate.auto_apply_state, 'ineligible', 'a shot that already has an image never auto-replaces it');
  for (let attempt = 0; attempt < 100; attempt++) {
    const row = database.connection.prepare('SELECT status FROM activity_beat_render_candidates WHERE id=?').get(secondSubmission.json().candidateId) as { status: string };
    if (row.status === 'succeeded' || row.status === 'failed') break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  const repairId = String(secondSubmission.json().candidateId);
  const repairTask = database.connection.prepare('SELECT task_id,call_id FROM activity_beat_render_candidates WHERE id=?')
    .get(repairId) as { task_id: string; call_id: string };
  database.connection.prepare("UPDATE activity_beat_render_candidates SET status='queued',artifact_id=NULL,media_url=NULL WHERE id=?").run(repairId);
  const repairedList = await app.inject({ method: 'GET', url: `${endpoint}?stageId=stage-one&sceneId=scene-one&beatId=beat-one`, headers: adminHeaders });
  assert.equal(repairedList.statusCode, 200, repairedList.body);
  assert.equal(repairedList.json().items[0].status, 'succeeded', 'listing repairs a task that finished before candidate state was saved');
  assert.equal(repairedList.json().items[0].images.length, 2);
  database.connection.prepare('UPDATE ai_call_records SET generation_task_id=NULL WHERE id=?').run(repairTask.call_id);
  database.connection.prepare("UPDATE activity_beat_render_candidates SET status='queued',artifact_id=NULL,media_url=NULL WHERE id=?").run(repairId);
  syncGenerationAiCall(database, repairTask.task_id, 'succeeded');
  const repairedWithoutCall = database.connection.prepare('SELECT status,artifact_id FROM activity_beat_render_candidates WHERE id=?')
    .get(repairId) as { status: string; artifact_id: string | null };
  assert.equal(repairedWithoutCall.status, 'succeeded', 'candidate synchronization does not require an AI-call row');
  assert.ok(repairedWithoutCall.artifact_id);
  database.connection.prepare('UPDATE ai_call_records SET generation_task_id=? WHERE id=?').run(repairTask.task_id, repairTask.call_id);
  const loraPromptRequest = calls.filter((item) => item.url.endsWith('/prompt')).slice(-1)[0]?.body;
  const loraGenerationGraph = loraPromptRequest?.prompt as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  assert.equal(loraGenerationGraph['6'].class_type, 'LoraLoaderModelOnly');
  assert.deepEqual(loraGenerationGraph['6'].inputs.model, ['4', 0]);
  assert.equal(loraGenerationGraph['6'].inputs.lora_name, 'portrait-style.safetensors');
  assert.equal(loraGenerationGraph['6'].inputs.strength_model, 0.85);
  assert.deepEqual(loraGenerationGraph['3'].inputs.model, ['6', 0]);
  assert.match(String(loraGenerationGraph['1'].inputs.text), /shot-only trigger/);
  assert.doesNotMatch(String(loraGenerationGraph['1'].inputs.text), /global-only trigger|character-only trigger/);

  const secondCandidateId = String(secondSubmission.json().candidateId);
  const sourceCandidate = database.connection.prepare(`SELECT c.call_id,t.actual_seed FROM activity_beat_render_candidates c
    JOIN generation_tasks t ON t.id=c.task_id WHERE c.id=?`).get(secondCandidateId) as { call_id: string; actual_seed: number };
  const optimizerCountBeforeRerender = calls.filter((item) => item.url.endsWith('/chat/completions')).length;
  const rerender = await app.inject({ method: 'POST', url: `${endpoint}/${secondCandidateId}/rerender`, headers: adminHeaders, payload: {} });
  assert.equal(rerender.statusCode, 202, rerender.body);
  assert.ok(rerender.json().callId, 'the rerender response exposes its linked AI call');
  let rerenderState = '';
  for (let attempt = 0; attempt < 100; attempt++) {
    const row = database.connection.prepare('SELECT status FROM activity_beat_render_candidates WHERE id=?').get(rerender.json().candidateId) as { status: string };
    rerenderState = row.status;
    if (rerenderState === 'succeeded' || rerenderState === 'failed') break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  assert.equal(rerenderState, 'succeeded');
  assert.equal(calls.filter((item) => item.url.endsWith('/chat/completions')).length, optimizerCountBeforeRerender,
    'rerender reuses the saved final prompt without calling the prompt optimizer again');
  const rerenderCandidate = database.connection.prepare(`SELECT c.call_id,c.auto_apply_state,c.positive_prompt,t.actual_seed,t.request_params_json
    FROM activity_beat_render_candidates c JOIN generation_tasks t ON t.id=c.task_id WHERE c.id=?`).get(rerender.json().candidateId) as
    { call_id: string; auto_apply_state: string; positive_prompt: string; actual_seed: number; request_params_json: string };
  assert.equal(rerenderCandidate.auto_apply_state, 'ineligible');
  assert.notEqual(rerenderCandidate.actual_seed, sourceCandidate.actual_seed);
  assert.match(rerenderCandidate.positive_prompt, /shot-only trigger/);
  assert.deepEqual(JSON.parse(rerenderCandidate.request_params_json).activityLoras, [
    { model: 'portrait-style.safetensors', strength: 0.85, triggerWord: 'shot-only trigger', enabled: true },
  ]);
  const rerenderCall = database.connection.prepare('SELECT parent_id,trace_id,business_event FROM ai_call_records WHERE id=?')
    .get(rerenderCandidate.call_id) as { parent_id: string; trace_id: string; business_event: string };
  assert.equal(rerenderCall.parent_id, sourceCandidate.call_id);
  assert.equal(rerenderCall.business_event, 'activity.beat.render.rerender');
  assert.equal(store.getDraft(activityId)!.document.scenes![0].beats[0].mediaUrl, firstMediaUrl, 'rerender results stay in history and do not replace the current image');

  draft = store.getDraft(activityId)!;
  const changedDocument = structuredClone(draft.document);
  changedDocument.scenes![0].beats[0].action = '转身离开';
  store.updateDraft(activityId, draft.draftVersion, changedDocument);
  const staleAdopt = await app.inject({ method: 'POST', url: `${endpoint}/${secondSubmission.json().candidateId}/adopt`, headers: adminHeaders });
  assert.equal(staleAdopt.statusCode, 409);
  const staleCandidate = database.connection.prepare('SELECT status FROM activity_beat_render_candidates WHERE id=?').get(secondSubmission.json().candidateId) as { status: string };
  assert.equal(staleCandidate.status, 'succeeded');

  const beforeFixedWorkflow = store.getDraft(activityId)!;
  const noShotLoraDocument = structuredClone(beforeFixedWorkflow.document);
  noShotLoraDocument.actors[0].visualLoras = [];
  noShotLoraDocument.scenes![0].beats[0].renderSettings = undefined;
  store.updateDraft(activityId, beforeFixedWorkflow.draftVersion, noShotLoraDocument);

  // A baked-in negative text and fixed checkpoint are reported from the
  // immutable graph; neither is claimed as an editable bound prompt/model.
  database.connection.prepare(`INSERT INTO generation_workflows(id,name,description,engine_kind,latest_version,created_at,updated_at,category)
    VALUES ('fixed-workflow','固定模型工作流','', 'comfyui',1,?,?,'image')`).run(now, now);
  const fixedSchema = {
    prompt: { semantic: 'prompt', type: 'long-text', required: true },
    seed: { semantic: 'seed', type: 'seed', minimum: 0, maximum: 2147483647 },
  };
  const fixedBindings = { prompt: ['1', 'inputs', 'text'], seed: ['3', 'inputs', 'seed'] };
  const fixedDefinition = {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: 'workflow-baked negative phrase' } },
    '3': { class_type: 'KSampler', inputs: { seed: 0 } },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'baked-checkpoint.safetensors' } },
    '5': { class_type: 'SaveImage', inputs: { images: ['3', 0] } },
  };
  database.connection.prepare(`INSERT INTO generation_workflow_versions
    (workflow_id,version,engine_id,input_schema_json,node_bindings_json,output_declarations_json,definition_json,is_published,created_at,input_capabilities_json,output_media_types_json,output_schema_json,config_format_version,editor_config_json)
    VALUES ('fixed-workflow',1,'beat-engine',?,?,?, ?,1,?,'{}','["image/png"]','{}',2,'{"version":2,"modelSelection":"preset-locked","fields":{},"loraSlots":[],"sizePresets":[],"constraints":{}}')`)
    .run(JSON.stringify(fixedSchema), JSON.stringify(fixedBindings), '["5"]', JSON.stringify(fixedDefinition), now);
  database.connection.prepare(`UPDATE app_generation_assignments SET workflow_id='fixed-workflow',workflow_version=1,engine_id='beat-engine',default_preset_id=NULL,updated_at=?
    WHERE app_id='activities' AND purpose='activity_image_text'`).run(now);
  database.connection.prepare(`UPDATE generation_workflow_versions SET input_schema_json=? WHERE workflow_id='fixed-workflow' AND version=1`)
    .run(JSON.stringify({ ...fixedSchema, negative: { semantic: 'negative_prompt', type: 'long-text' } }));
  const unboundNegativePreview = await app.inject({ method: 'POST', url: `${endpoint}/preview`, headers: adminHeaders,
    payload: { stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one' } });
  assert.equal(unboundNegativePreview.statusCode, 409);
  assert.equal(unboundNegativePreview.json().error, 'negative_prompt_binding_missing');
  assert.equal(database.connection.prepare('SELECT COUNT(*) count FROM generation_tasks').get()!.count, 3);
  const unboundNegativeSubmit = await app.inject({ method: 'POST', url: endpoint, headers: adminHeaders, payload: {
    stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one', planHash: 'invalid-configuration', idempotencyKey: 'unbound-negative',
  } });
  assert.equal(unboundNegativeSubmit.statusCode, 409);
  assert.equal(unboundNegativeSubmit.json().error, 'negative_prompt_binding_missing');
  assert.equal(database.connection.prepare('SELECT COUNT(*) count FROM generation_tasks').get()!.count, 3,
    'an unbound negative prompt is rejected before dispatch');
  database.connection.prepare(`UPDATE generation_workflow_versions SET input_schema_json=? WHERE workflow_id='fixed-workflow' AND version=1`)
    .run(JSON.stringify(fixedSchema));
  const fixedPreviewResponse = await app.inject({ method: 'POST', url: `${endpoint}/preview`, headers: adminHeaders,
    payload: { stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one' } });
  assert.equal(fixedPreviewResponse.statusCode, 200, fixedPreviewResponse.body);
  const fixedPreview = fixedPreviewResponse.json() as BeatRenderPreview;
  assert.equal(fixedPreview.negativePrompt, null);
  assert.equal(fixedPreview.model, 'baked-checkpoint.safetensors');
  assert.equal(fixedPreview.referenceInputKey, null);
  const fixedSubmission = await app.inject({ method: 'POST', url: endpoint, headers: adminHeaders, payload: {
    stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one', purpose: fixedPreview.purpose,
    workflowId: fixedPreview.workflowId, workflowVersion: fixedPreview.workflowVersion, parameters: fixedPreview.parameters,
    seed: fixedPreview.seed, planHash: fixedPreview.planHash, idempotencyKey: 'beat-render-fixed-003',
  } });
  assert.equal(fixedSubmission.statusCode, 202, fixedSubmission.body);
  let fixedCandidateStatus = '';
  for (let attempt = 0; attempt < 100; attempt++) {
    const row = database.connection.prepare('SELECT status FROM activity_beat_render_candidates WHERE id=?').get(fixedSubmission.json().candidateId) as { status: string };
    fixedCandidateStatus = row.status;
    if (fixedCandidateStatus === 'succeeded' || fixedCandidateStatus === 'failed') break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  assert.equal(fixedCandidateStatus, 'succeeded');
  const fixedCandidate = database.connection.prepare('SELECT call_id FROM activity_beat_render_candidates WHERE id=?').get(fixedSubmission.json().candidateId) as { call_id: string };
  const fixedCall = database.connection.prepare('SELECT request_snapshot_json,negative_prompt FROM ai_call_records WHERE id=?').get(fixedCandidate.call_id) as { request_snapshot_json: string; negative_prompt: string | null };
  const fixedGraph = JSON.parse(fixedCall.request_snapshot_json) as Record<string, { inputs: Record<string, unknown> }>;
  assert.equal(fixedCall.negative_prompt, null);
  assert.equal(fixedGraph['2'].inputs.text, 'workflow-baked negative phrase');
  assert.equal(fixedGraph['4'].inputs.ckpt_name, 'baked-checkpoint.safetensors');

  const taskCountBeforeOptimizerFailure = database.connection.prepare('SELECT COUNT(*) count FROM generation_tasks').get()!.count;
  failNextOptimization = true;
  const failedOptimizationPreview = await app.inject({ method: 'POST', url: `${endpoint}/preview`, headers: adminHeaders,
    payload: { stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one' } });
  const failedPlan = failedOptimizationPreview.json() as BeatRenderPreview;
  const failedSubmit = await app.inject({ method: 'POST', url: endpoint, headers: adminHeaders, payload: {
    stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one', purpose: failedPlan.purpose,
    workflowId: failedPlan.workflowId, workflowVersion: failedPlan.workflowVersion, parameters: failedPlan.parameters,
    seed: failedPlan.seed, planHash: failedPlan.planHash, idempotencyKey: 'beat-render-optimizer-failure',
  } });
  assert.equal(failedSubmit.statusCode, 202, failedSubmit.body);
  for (let attempt = 0; attempt < 100; attempt++) {
    const row = database.connection.prepare('SELECT status FROM activity_beat_render_candidates WHERE id=?').get(failedSubmit.json().candidateId) as { status: string };
    if (row.status === 'failed') break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  const failedCandidate = database.connection.prepare('SELECT status,call_id,prompt_optimization_status FROM activity_beat_render_candidates WHERE id=?')
    .get(failedSubmit.json().candidateId) as { status: string; call_id: string; prompt_optimization_status: string };
  assert.equal(failedCandidate.status, 'failed');
  assert.equal(failedCandidate.prompt_optimization_status, 'failed');
  assert.ok(failedCandidate.call_id);
  assert.equal(database.connection.prepare('SELECT COUNT(*) count FROM generation_tasks').get()!.count, taskCountBeforeOptimizerFailure,
    'optimizer failure must not dispatch a ComfyUI task');

  database.connection.prepare(`INSERT INTO generation_engines(id,name,kind,base_url,enabled,created_at,updated_at)
    VALUES ('other-comfy-engine','Other Comfy','comfyui','http://other-comfy.mock',1,?,?)`).run(now, now);
  const callsBeforeLegacy = database.connection.prepare('SELECT COUNT(*) count FROM ai_call_records').get()!.count;
  const engineConflict = await app.inject({ method: 'POST', url: `/api/v1/admin/activities/${activityId}/generate-beat-media`, headers: adminHeaders,
    payload: { stageId: 'stage-one', beatId: 'beat-one', mediaType: 'image', engineId: 'other-comfy-engine' } });
  assert.equal(engineConflict.statusCode, 409);
  assert.equal(engineConflict.json().error, 'generation_engine_assignment_managed');
  assert.equal(database.connection.prepare('SELECT COUNT(*) count FROM ai_call_records').get()!.count, callsBeforeLegacy,
    'an engine conflict is rejected without dispatching a fixed or alternate workflow');
  const legacyResponse = await app.inject({ method: 'POST', url: `/api/v1/admin/activities/${activityId}/generate-beat-media`, headers: adminHeaders,
    payload: { stageId: 'stage-one', beatId: 'beat-one', mediaType: 'image', engineId: 'beat-engine' } });
  assert.equal(legacyResponse.statusCode, 200, legacyResponse.body);
  assert.equal(typeof legacyResponse.json().success, 'boolean');
  assert.equal(database.connection.prepare("SELECT COUNT(*) count FROM ai_call_records WHERE business_event='activity.beat.render.legacy'").get()!.count, 1,
    'the compatible legacy entry point records its generation call');

  const orphanKey = 'beat-render-restart-orphan';
  const orphanCandidateId = 'beat-render-restart-candidate';
  const orphanTraceId = 'beat-render-restart-trace';
  const stableCandidate = database.connection.prepare(`SELECT source_fingerprint,draft_version FROM activity_beat_render_candidates WHERE id=?`)
    .get(fixedSubmission.json().candidateId) as { source_fingerprint: string; draft_version: number };
  const orphanCallId = createAiCallRecord(database, {
    traceId: orphanTraceId, applicationId: 'activities', feature: 'activity-image-prompt-optimization',
    businessEvent: 'activity.image.prompt.optimize', objectType: 'activity', objectId: activityId,
    callType: 'llm', provider: 'Mock text', models: ['mock-text-model'], workflowId: fixedPreview.workflowId,
    workflowVersion: fixedPreview.workflowVersion, positivePrompt: fixedPreview.positivePrompt,
    requestSnapshot: { sourcePrompt: fixedPreview.positivePrompt },
  });
  updateAiCallRecord(database, orphanCallId, { status: 'submitted', event: 'submitted', detail: { method: 'POST' } });
  const scopedOrphanKey = `beat-${hashAiSource(activityId).slice(0, 12)}-${orphanKey}`;
  database.connection.prepare(`INSERT INTO activity_prompt_optimization_runs
    (id,activity_id,idempotency_key,request_hash,trace_id,workflow_id,workflow_version,policy_revision,policy_snapshot_json,
      source_prompt,optimized_prompt,status,optimizer_call_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'preparing',?,?,?)`)
    .run('beat-render-restart-prompt-run', activityId, scopedOrphanKey, 'restart-test-hash', orphanTraceId,
      fixedPreview.workflowId, fixedPreview.workflowVersion, fixedPreview.promptOptimization.policyRevision, '{}',
      fixedPreview.positivePrompt, '', orphanCallId, nowIso(), nowIso());
  const orphanFingerprint = hashAiSource({ planHash: fixedPreview.planHash, sourceFingerprint: stableCandidate.source_fingerprint });
  database.connection.prepare(`INSERT INTO activity_beat_render_candidates
    (id,activity_id,stage_id,scene_id,beat_id,idempotency_key,request_fingerprint,source_fingerprint,draft_version,task_id,call_id,
      status,positive_prompt,negative_prompt,created_at,original_prompt,prompt_optimization_status)
    VALUES (?,?,?,?,?,?,?,?,?,NULL,?,'preparing',?,?,?,?,?)`)
    .run(orphanCandidateId, activityId, 'stage-one', 'scene-one', 'beat-one', orphanKey, orphanFingerprint,
      stableCandidate.source_fingerprint, stableCandidate.draft_version, orphanCallId, fixedPreview.positivePrompt,
      fixedPreview.negativePrompt ?? '', nowIso(), fixedPreview.positivePrompt, 'optimizing');

  await currentApp.close();
  const restartedService = await createService({ config, database, secrets, fetcher });
  currentApp = restartedService.app;
  const recoveredCandidate = database.connection.prepare(`SELECT status,task_id,call_id,prompt_optimization_status,error_message
    FROM activity_beat_render_candidates WHERE id=?`).get(orphanCandidateId) as {
      status: string; task_id: string | null; call_id: string | null; prompt_optimization_status: string; error_message: string | null;
    };
  assert.equal(recoveredCandidate.status, 'failed');
  assert.equal(recoveredCandidate.task_id, null);
  assert.equal(recoveredCandidate.call_id, orphanCallId);
  assert.equal(recoveredCandidate.prompt_optimization_status, 'failed');
  assert.match(recoveredCandidate.error_message ?? '', /服务在镜头生图任务创建前重启/);
  const recoveredPromptRun = database.connection.prepare(`SELECT status,error_code FROM activity_prompt_optimization_runs WHERE id=?`)
    .get('beat-render-restart-prompt-run') as { status: string; error_code: string | null };
  assert.equal(recoveredPromptRun.status, 'failed');
  assert.equal(recoveredPromptRun.error_code, 'beat_render_interrupted_on_restart');
  const recoveredCall = database.connection.prepare('SELECT status,error_code FROM ai_call_records WHERE id=?')
    .get(orphanCallId) as { status: string; error_code: string | null };
  assert.equal(recoveredCall.status, 'abandoned');
  assert.equal(recoveredCall.error_code, 'beat_render_interrupted_on_restart');
  assert.equal(database.connection.prepare(`SELECT COUNT(*) count FROM ai_call_events WHERE call_id=? AND phase='service_restart_before_generation_task'`)
    .get(orphanCallId)!.count, 1);

  const orphanRequest = {
    stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one', purpose: fixedPreview.purpose,
    workflowId: fixedPreview.workflowId, workflowVersion: fixedPreview.workflowVersion, parameters: fixedPreview.parameters,
    seed: fixedPreview.seed, planHash: fixedPreview.planHash, idempotencyKey: orphanKey,
  };
  const beforeDuplicateTasks = Number(database.connection.prepare('SELECT COUNT(*) count FROM generation_tasks').get()!.count);
  const duplicateAfterRestart = await currentApp.inject({ method: 'POST', url: endpoint, headers: adminHeaders, payload: orphanRequest });
  assert.equal(duplicateAfterRestart.statusCode, 202, duplicateAfterRestart.body);
  assert.equal(duplicateAfterRestart.json().candidateId, orphanCandidateId);
  assert.equal(duplicateAfterRestart.json().taskId, null);
  assert.equal(database.connection.prepare('SELECT status FROM activity_beat_render_candidates WHERE id=?').get(orphanCandidateId)!.status, 'failed');
  assert.equal(Number(database.connection.prepare('SELECT COUNT(*) count FROM generation_tasks').get()!.count), beforeDuplicateTasks,
    'a duplicate idempotency key returns the terminal failed candidate and never silently restarts generation');

  const retryPreviewResponse = await currentApp.inject({ method: 'POST', url: `${endpoint}/preview`, headers: adminHeaders,
    payload: { stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one' } });
  assert.equal(retryPreviewResponse.statusCode, 200, retryPreviewResponse.body);
  const retryPreview = retryPreviewResponse.json() as BeatRenderPreview;
  const retryAfterRestart = await currentApp.inject({ method: 'POST', url: endpoint, headers: adminHeaders, payload: {
    stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one', purpose: retryPreview.purpose,
    workflowId: retryPreview.workflowId, workflowVersion: retryPreview.workflowVersion, parameters: retryPreview.parameters,
    seed: retryPreview.seed, planHash: retryPreview.planHash, idempotencyKey: 'beat-render-after-restart-retry',
  } });
  assert.equal(retryAfterRestart.statusCode, 202, retryAfterRestart.body);
  let retryState: { status: string; task_id: string | null } | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    retryState = database.connection.prepare('SELECT status,task_id FROM activity_beat_render_candidates WHERE id=?')
      .get(retryAfterRestart.json().candidateId) as typeof retryState;
    if (retryState?.status === 'succeeded' || retryState?.status === 'failed') break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  assert.equal(retryState?.status, 'succeeded', 'a new idempotency key can retry the interrupted render');
  assert.ok(retryState?.task_id);

  // A normal click no longer needs a browser preview or a client-generated
  // snapshot. Repeating that click must reuse the same candidate and seed.
  const directPayload = { stageId: 'stage-one', sceneId: 'scene-one', beatId: 'beat-one', idempotencyKey: 'beat-direct-without-preview' };
  const direct = await currentApp.inject({ method: 'POST', url: endpoint, headers: adminHeaders, payload: directPayload });
  assert.equal(direct.statusCode, 202, direct.body);
  const repeated = await currentApp.inject({ method: 'POST', url: endpoint, headers: adminHeaders, payload: directPayload });
  assert.equal(repeated.statusCode, 202, repeated.body);
  assert.equal(repeated.json().candidateId, direct.json().candidateId);
  let directState: { status: string; task_id: string | null } | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    directState = database.connection.prepare('SELECT status,task_id FROM activity_beat_render_candidates WHERE id=?')
      .get(direct.json().candidateId) as typeof directState;
    if (directState?.status === 'succeeded' || directState?.status === 'failed') break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  assert.equal(directState?.status, 'succeeded', 'background configuration must keep the same seed without a preview');
  const changedClick = await currentApp.inject({ method: 'POST', url: endpoint, headers: adminHeaders,
    payload: { ...directPayload, customPrompt: 'different composition' } });
  assert.equal(changedClick.statusCode, 409, 'same key with a different request must not generate twice');

  assert.equal(database.connection.prepare("SELECT COUNT(*) count FROM ai_call_events WHERE call_id=? AND phase='candidate_image_selected'").get(candidateRow.call_id)!.count, 7,
    'ordinary and legacy history selections, including idempotent retries, remain auditable');
  assert.ok(database.connection.prepare('SELECT id FROM ai_call_records WHERE id=?').get(candidateRow.call_id));
  assert.notEqual(taskId, '');
  await currentApp.close();
  database.close();
  rmSync(artifactDirectory, { recursive: true, force: true });
});
