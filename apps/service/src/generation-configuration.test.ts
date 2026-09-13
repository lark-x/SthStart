import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { ServiceDatabase, nowIso } from './database.js';
import { readConfig } from './config.js';
import { createService } from './server.js';
import { SecretStore } from './security.js';
import { activeGenerationExecutions } from './generation.js';
import { analyzeComfyApiJson, buildSuggestedDraft, mergeGenerationValues, parseEditorConfig, validateCombinedConstraints, validateModelSelection, validateValuesAgainstSchema } from './generation/configuration.js';
import { getWorkflowDraft, resolveDefaultPreset, resolveEnabledPreset, saveWorkflowDraft, setDefaultPreset, updatePreset } from './generation/configuration-store.js';

const adminToken = 'admin-config-workspace-test-token-12345';
const adminHeaders = { 'x-sthstart-admin-token': adminToken };

const SAMPLE_GRAPH = {
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd15/model.safetensors', stop_at_clip_layer: -1 } },
  '5': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat', clip: ['4', 1] } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry', clip: ['4', 1] } },
  '7': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 768, batch_size: 1 } },
  '3': { class_type: 'KSampler', inputs: { seed: 42, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['7', 0] } },
  '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'sth', images: ['3', 0] } },
};

async function waitForTaskStatus(
  app: Awaited<ReturnType<typeof createService>>['app'],
  url: string,
  taskId: string,
): Promise<Record<string, unknown>> {
  for (let index = 0; index < 120; index++) {
    const response = await app.inject({ method: 'GET', url: `${url}/${taskId}`, headers: adminHeaders });
    const payload = response.json() as { status?: string };
    if (['succeeded', 'failed', 'abandoned', 'cancelled'].includes(String(payload.status))) return payload;
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 50));
  }
  throw new Error(`task ${taskId} did not reach a terminal status`);
}

test('analyzeComfyApiJson identifies prompt, negative prompt, model and sampler inputs; links are never parameters', () => {
  const analysis = analyzeComfyApiJson(SAMPLE_GRAPH);
  const byKey = new Map(analysis.inputs.map((item) => [item.key, item]));

  const prompt = byKey.get('prompt');
  assert.ok(prompt, 'prompt input should be mapped');
  assert.equal(prompt!.semantic, 'prompt');
  assert.equal(prompt!.nodeId, '5');
  assert.equal(prompt!.confidence, 'known');

  const negative = byKey.get('negativePrompt');
  assert.ok(negative, 'negative prompt should be mapped via KSampler.negative link');
  assert.equal(negative!.nodeId, '6');

  const checkpoint = byKey.get('checkpoint');
  assert.ok(checkpoint);
  assert.equal(checkpoint!.kind, 'model');
  assert.equal(checkpoint!.modelCategory, 'checkpoints');
  assert.equal(checkpoint!.currentValue, 'sd15/model.safetensors');

  assert.equal(byKey.get('seed')!.kind, 'seed');
  assert.equal(byKey.get('steps')!.semantic, 'steps');
  assert.equal(byKey.get('width')!.nodeId, '7');
  // 连线数组（model/clip/latent_image 等引用）绝不能暴露为参数
  for (const item of analysis.inputs) {
    assert.ok(!['model', 'clip', 'latent_image', 'positive', 'negative', 'images'].includes(item.inputName) || item.nodeId !== '3',
      `connection input ${item.inputName} must not become a parameter`);
  }

  assert.ok(analysis.outputCandidates.includes('9'));
  // 未知节点输入保留为技术字段
  const stopLayer = analysis.inputs.find((item) => item.inputName === 'stop_at_clip_layer');
  assert.ok(stopLayer);
  assert.equal(stopLayer!.autoMapped, false);
});

test('analysis reads Comfy required and optional combo metadata', () => {
  const analysis = analyzeComfyApiJson(SAMPLE_GRAPH, {
    KSampler: { input: { required: { sampler_name: [['euler', 'dpmpp_2m'], {}] }, optional: { scheduler: [['normal', 'karras']] } } },
  });
  assert.deepEqual(analysis.inputs.find((field) => field.key === 'sampler_name')?.enumValues, ['euler', 'dpmpp_2m']);
  assert.deepEqual(analysis.inputs.find((field) => field.key === 'scheduler')?.enumValues, ['normal', 'karras']);
});

test('strict validation enforces string enums, steps and safe integers', () => {
  const schema = { sampler: { type: 'string', enum: ['euler'] }, width: { type: 'integer', minimum: 64, step: 8 }, cfg: { type: 'number', minimum: 0, step: 0.1 }, count: { type: 'integer' } };
  const validate = (values: Record<string, unknown>) => validateValuesAgainstSchema(schema, null, values, { mode: 'strict', context: 'request' });
  assert.throws(() => validate({ sampler: 'invalid' }), /枚举/);
  assert.throws(() => validate({ sampler: '' }), /枚举/);
  assert.throws(() => validate({ width: 65 }), /步长/);
  assert.throws(() => validate({ count: Number.MAX_SAFE_INTEGER + 1 }), /整数/);
  assert.deepEqual(validate({ width: 512, cfg: 0.3, sampler: 'euler' }), { width: 512, cfg: 0.3, sampler: 'euler' });
});

test('analyzeComfyApiJson keeps GUI format rejection and demotes duplicated semantics', () => {
  assert.throws(() => analyzeComfyApiJson({ nodes: [], links: [] }), (error: Error & { code?: string }) => error.code === 'invalid_workflow_format_gui_rejected');

  const doubleSampler = {
    ...SAMPLE_GRAPH,
    '13': { class_type: 'KSampler', inputs: { seed: 7, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['7', 0] } },
  };
  const analysis = analyzeComfyApiJson(doubleSampler);
  const seedInputs = analysis.inputs.filter((item) => item.semantic === 'seed');
  assert.equal(seedInputs.length, 2);
  assert.equal(seedInputs.filter((item) => item.autoMapped).length, 1, 'only one seed may auto-map');
  assert.ok(analysis.warnings.some((warning) => warning.includes('种子')));
});

test('buildSuggestedDraft maps confirmed values into schema/bindings/editorConfig without losing the definition', () => {
  const analysis = analyzeComfyApiJson(SAMPLE_GRAPH);
  const draft = buildSuggestedDraft(SAMPLE_GRAPH, analysis) as unknown as {
    inputSchema: Record<string, Record<string, unknown>>;
    nodeBindings: Record<string, string[]>;
    editorConfig: { version: number; fields: Record<string, { section: string; label: string }>; modelSelection: string };
    outputDeclarations: string[];
    definition: unknown;
  };
  assert.equal(draft.definition, SAMPLE_GRAPH);
  assert.equal(draft.inputSchema.prompt?.default, 'a cat');
  assert.equal(draft.inputSchema.prompt?.required, true);
  assert.deepEqual(draft.nodeBindings.prompt, ['5', 'inputs', 'text']);
  assert.deepEqual(draft.nodeBindings.checkpoint, ['4', 'inputs', 'ckpt_name']);
  assert.equal(draft.editorConfig.version, 2);
  assert.equal(draft.editorConfig.fields.prompt.section, 'basic');
  assert.equal(draft.editorConfig.fields.steps.section, 'advanced');
  assert.equal(draft.editorConfig.modelSelection, 'individual');
  assert.deepEqual(draft.outputDeclarations, ['9']);
  const customSchema = { myPrompt: { type: 'string', default: 'custom' } };
  const customBindings = { myPrompt: ['5', 'inputs', 'text'] };
  const restored = buildSuggestedDraft(SAMPLE_GRAPH, analysis, { inputSchema: customSchema, nodeBindings: customBindings });
  assert.deepEqual(restored.inputSchema, customSchema, 'restoring must not inject auto-discovered defaults');
  assert.deepEqual(restored.nodeBindings, customBindings, 'restoring must retain a renamed binding on the same node');
});

test('parameter validation rejects unknown, fixed, out-of-range and non-finite values without clamping', () => {
  const schema = {
    steps: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
    cfg: { type: 'number', default: 7 },
    style: { type: 'enum', enum: ['a', 'b'] },
    name: { type: 'string' },
  };
  const editorConfig = parseEditorConfig({ version: 2, fields: { steps: { key: 'steps', label: '步数', section: 'fixed', order: 1 } } });

  assert.throws(() => validateValuesAgainstSchema(schema, null, { unknownKey: 1 }, { mode: 'strict', context: 'request' }),
    (error: Error & { code?: string }) => error.code === 'unknown_parameter');
  assert.throws(() => validateValuesAgainstSchema(schema, editorConfig, { steps: 30 }, { mode: 'strict', context: 'request' }),
    (error: Error & { code?: string }) => error.code === 'fixed_parameter');
  assert.throws(() => validateValuesAgainstSchema(schema, null, { steps: 51 }, { mode: 'strict', context: 'request' }),
    (error: Error & { code?: string }) => error.code === 'parameter_out_of_range');
  assert.throws(() => validateValuesAgainstSchema(schema, null, { steps: 1.5 }, { mode: 'strict', context: 'request' }),
    (error: Error & { code?: string }) => error.code === 'invalid_parameter_value');
  assert.throws(() => validateValuesAgainstSchema(schema, null, { style: 'c' }, { mode: 'strict', context: 'request' }),
    (error: Error & { code?: string }) => error.code === 'parameter_not_in_enum');
  assert.throws(() => validateValuesAgainstSchema(schema, null, { cfg: Number.NaN }, { mode: 'lenient', context: 'request' }),
    (error: Error & { code?: string }) => error.code === 'invalid_parameter_value');
  // lenient（V1 兼容）允许未知键
  const lenient = validateValuesAgainstSchema(schema, null, { legacyExtra: 'x', steps: 10 }, { mode: 'lenient', context: 'request' });
  assert.deepEqual(lenient, { legacyExtra: 'x', steps: 10 });
});

test('combined constraints and model selection enforce allowlist ∩ inventory without auto-switching', () => {
  assert.throws(() => validateCombinedConstraints(parseEditorConfig({ version: 2, fields: {}, constraints: { maxPixels: 1024 * 1024 } }), { width: 1024, height: 2048 }),
    (error: Error & { code?: string }) => error.code === 'invalid_size_combination');
  assert.throws(() => validateCombinedConstraints(parseEditorConfig({ version: 2, fields: {}, constraints: { allowedSizes: [{ width: 512, height: 512 }] } }), { width: 768, height: 512 }),
    (error: Error & { code?: string }) => error.code === 'invalid_size_combination');

  const editorConfig = parseEditorConfig({ version: 2, fields: { checkpoint: { key: 'checkpoint', label: '主模型', section: 'basic', order: 1, type: 'model', allowedModels: ['a.safetensors'] } } });
  assert.throws(() => validateModelSelection(editorConfig, { checkpoint: 'b.safetensors' }, ['a.safetensors', 'b.safetensors']),
    (error: Error & { code?: string }) => error.code === 'model_not_allowed');
  assert.throws(() => validateModelSelection(editorConfig, { checkpoint: 'a.safetensors' }, ['b.safetensors']),
    (error: Error & { code?: string }) => error.code === 'model_unavailable');
  validateModelSelection(editorConfig, { checkpoint: 'a.safetensors' }, ['a.safetensors']);
  assert.throws(() => mergeGenerationValues({ checkpoint: { type: 'string' } }, editorConfig, {}, { checkpoint: 'b.safetensors' }, 'strict'),
    (error: Error & { code?: string }) => error.code === 'model_not_allowed');
});

test('mergeGenerationValues follows workflow defaults → preset → request priority', () => {
  const schema = { width: { type: 'integer', default: 512 }, steps: { type: 'integer', default: 20 }, prompt: { type: 'string', required: true } };
  const merged = mergeGenerationValues(schema, null, { steps: 30 }, { width: 768, prompt: 'cat' }, 'strict');
  assert.deepEqual(merged.values, { width: 768, steps: 30, prompt: 'cat' });
  assert.throws(() => mergeGenerationValues({ width: { type: 'integer', default: 65, minimum: 64, step: 8 } }, null, {}, {}, 'strict'), /步长/);
  const locked = parseEditorConfig({ version: 2, modelSelection: 'preset-locked', fields: { checkpoint: { key: 'checkpoint', label: '主模型', section: 'basic', type: 'model' } } });
  const modelSchema = { checkpoint: { type: 'string', default: 'a.safetensors' } };
  assert.throws(() => mergeGenerationValues(modelSchema, locked, {}, { checkpoint: 'b.safetensors' }, 'strict'), /锁定/);
  assert.equal(mergeGenerationValues(modelSchema, locked, { checkpoint: 'b.safetensors' }, { checkpoint: 'b.safetensors' }, 'strict').values.checkpoint, 'b.safetensors');
});

test('configuration workspace: draft, analyze, V2 versions, presets, test runs and creative options work end to end', async () => {
  const database = new ServiceDatabase();
  const artifactDirectory = await mkdtemp(resolve(tmpdir(), 'sthstart-config-ws-'));
  const config = readConfig({
    STHSTART_ADMIN_TOKEN: adminToken,
    STHSTART_IMAGE_SIGNING_SECRET: 'config-workspace-signing-secret-1234',
    STHSTART_ARTIFACT_DIR: artifactDirectory,
  });
  const promptBodies: Array<Record<string, unknown>> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/prompt')) {
      promptBodies.push(JSON.parse(String(init?.body ?? '{}')).prompt as Record<string, unknown>);
      return Response.json({ prompt_id: `cfg-${promptBodies.length}` });
    }
    if (url.includes('/history/cfg-')) {
      return Response.json({ [`cfg-${promptBodies.length}`]: { status: { status_str: 'success' }, outputs: { '9': { images: [{ filename: 'out.png', type: 'output' }] } } } });
    }
    if (url.includes('/view')) return new Response(Buffer.from('png'), { status: 200, headers: { 'content-type': 'image/png' } });
    if (url.endsWith('/queue')) return Response.json({ queue_running: [], queue_pending: [] });
    if (url.endsWith('/system_stats')) return Response.json({ system: { comfyui_version: '0.3.40' }, devices: [{ name: 'RTX 4090' }] });
    return new Response(null, { status: 404 });
  };

  const { app } = await createService({ config, database, secrets: new SecretStore({}), fetcher });
  const now = nowIso();
  database.connection.prepare("INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run('creative-center', '创作中心', 'hash', '[]', 1, now, now);
  database.connection.prepare("INSERT INTO generation_engines(id,name,kind,base_url,enabled,concurrency_limit,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run('ws-engine', '工作台直连', 'comfyui', 'http://comfy.test:8188', 1, 2, now, now);

  // 连接测试（后端发起，返回脱敏状态）
  const testResult = await app.inject({ method: 'POST', url: '/api/v1/admin/generation/engines/ws-engine/test', headers: adminHeaders });
  assert.equal(testResult.statusCode, 200);
  assert.equal(testResult.json().ok, true);
  assert.ok(String(testResult.json().summary).includes('可达'));

  // 导入分析：原生 API JSON
  const analyze = await app.inject({ method: 'POST', url: '/api/v1/admin/generation/workflows/analyze', headers: adminHeaders, payload: { definition: SAMPLE_GRAPH } });
  assert.equal(analyze.statusCode, 200);
  const analysis = analyze.json();
  assert.equal(analysis.source, 'api-json');
  assert.ok(analysis.inputs.some((item: { key: string }) => item.key === 'checkpoint'));
  assert.ok(analysis.suggestedDraft.nodeBindings.checkpoint);

  // GUI JSON 明确拒绝
  const guiAnalyze = await app.inject({ method: 'POST', url: '/api/v1/admin/generation/workflows/analyze', headers: adminHeaders, payload: { definition: { nodes: [], links: [] } } });
  assert.equal(guiAnalyze.statusCode, 400);
  assert.equal(guiAnalyze.json().error, 'invalid_workflow_format_gui_rejected');

  // 创建工作流外壳（ID 由系统生成）+ 保存草稿
  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/generation/workflows', headers: adminHeaders, payload: { name: '工作台样本工作流' } });
  assert.equal(created.statusCode, 201);
  const workflowId = created.json().id as string;
  assert.match(workflowId, /^wf-/);

  const suggestedDraft = { ...analysis.suggestedDraft, name: '工作台样本工作流', engineId: 'ws-engine' };
  const draftSaved = await app.inject({ method: 'PUT', url: `/api/v1/admin/generation/workflows/${workflowId}/draft`, headers: adminHeaders, payload: { revision: 1, draft: suggestedDraft } });
  assert.equal(draftSaved.statusCode, 200);
  const draftRevision = draftSaved.json().revision as number;

  // 草稿乐观锁：过期 revision 再次保存 → 409 + 服务端草稿
  const conflict = await app.inject({ method: 'PUT', url: `/api/v1/admin/generation/workflows/${workflowId}/draft`, headers: adminHeaders, payload: { revision: draftRevision + 100, draft: suggestedDraft } });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error, 'draft_revision_conflict');
  assert.ok(conflict.json().draft);

  // 保存版本（V2，含 editorConfig）→ config_format_version=2，草稿同步 base_version
  const versionSaved = await app.inject({
    method: 'POST', url: `/api/v1/admin/generation/workflows/${workflowId}/versions`, headers: adminHeaders,
    payload: {
      engineId: 'ws-engine',
      definition: suggestedDraft.definition,
      inputSchema: suggestedDraft.inputSchema,
      inputCapabilities: suggestedDraft.inputCapabilities ?? {},
      nodeBindings: suggestedDraft.nodeBindings,
      outputDeclarations: suggestedDraft.outputDeclarations,
      outputMediaTypes: ['image/png'],
      outputSchema: {},
      editorConfig: suggestedDraft.editorConfig,
    },
  });
  assert.equal(versionSaved.statusCode, 201);
  assert.equal(versionSaved.json().configFormatVersion, 2);
  const savedDraft = getWorkflowDraft(database, workflowId);
  assert.equal(savedDraft!.baseVersion, 1);

  // 模型选择校验：允许列表之外的模型在提交前被拒绝（试运行 400）
  const forbiddenModelRun = await app.inject({
    method: 'POST', url: `/api/v1/admin/generation/workflows/${workflowId}/test-runs`, headers: adminHeaders,
    payload: { version: 1, values: { checkpoint: 'forbidden/model.safetensors', prompt: 'x' } },
  });
  assert.equal(forbiddenModelRun.statusCode, 400);
  assert.equal(forbiddenModelRun.json().error, 'model_not_allowed');

  // 未知参数在 V2 版本上被拒绝
  const unknownParamRun = await app.inject({
    method: 'POST', url: `/api/v1/admin/generation/workflows/${workflowId}/test-runs`, headers: adminHeaders,
    payload: { version: 1, values: { prompt: 'x', notAField: 1 } },
  });
  assert.equal(unknownParamRun.statusCode, 400);
  assert.equal(unknownParamRun.json().error, 'unknown_parameter');

  // 试运行：创建真实任务并落到原任务核心；快照包含写入的模型与提示词
  const testRun = await app.inject({
    method: 'POST', url: `/api/v1/admin/generation/workflows/${workflowId}/test-runs`, headers: adminHeaders,
    payload: { version: 1, values: { prompt: 'a test cat', checkpoint: 'sd15/model.safetensors' }, seed: 123 },
  });
  assert.equal(testRun.statusCode, 202);
  const testRunId = testRun.json().id as string;
  assert.equal(testRun.json().purpose, 'configuration-test');
  await waitForTaskStatus(app, '/api/v1/admin/generation/test-runs', testRunId);
  const runList = await app.inject({ method: 'GET', url: `/api/v1/admin/generation/test-runs?workflowId=${workflowId}`, headers: adminHeaders });
  assert.equal(runList.statusCode, 200);
  assert.equal(runList.json().items.length, 1);
  const runDetail = await app.inject({ method: 'GET', url: `/api/v1/admin/generation/test-runs/${testRunId}`, headers: adminHeaders });
  assert.equal(runDetail.json().selection.testMode, true);
  assert.equal(runDetail.json().requestInputs.prompt, 'a test cat');
  assert.equal(runDetail.json().actualSeed, 123);
  const runSamplerNode = promptBodies[0]!['4'] as { inputs: Record<string, unknown> };
  assert.equal(runSamplerNode.inputs.ckpt_name, 'sd15/model.safetensors', 'model selection must land on the loader node input');

  // 预设：引用确切版本；默认预设与用途绑定在同一事务同步
  const presetCreated = await app.inject({
    method: 'POST', url: '/api/v1/admin/generation/presets', headers: adminHeaders,
    payload: { appId: 'creative-center', purpose: 'text-to-image', name: '角色立绘', workflowId, workflowVersion: 1, engineId: 'ws-engine', values: { steps: 28 } },
  });
  assert.equal(presetCreated.statusCode, 201);
  const preset = presetCreated.json();
  assert.equal(preset.values.steps, 28, 'preset only stores overrides');

  const setDefault = await app.inject({ method: 'POST', url: `/api/v1/admin/generation/presets/${preset.id}/set-default`, headers: adminHeaders });
  assert.equal(setDefault.statusCode, 200);
  const assignments = database.connection.prepare("SELECT * FROM app_generation_assignments WHERE app_id='creative-center' AND purpose='text-to-image'").get() as Record<string, unknown>;
  assert.equal(assignments.default_preset_id, preset.id);
  assert.equal(assignments.workflow_id, workflowId, 'default assignment must sync to the preset workflow');

  // 默认预设禁用需要显式 clearDefault
  const disableDefault = await app.inject({ method: 'PUT', url: `/api/v1/admin/generation/presets/${preset.id}`, headers: adminHeaders, payload: { enabled: false, revision: preset.revision } });
  assert.equal(disableDefault.statusCode, 409);
  assert.equal(disableDefault.json().error, 'preset_is_default');

  // 预设 revision 乐观锁
  const staleUpdate = await app.inject({ method: 'PUT', url: `/api/v1/admin/generation/presets/${preset.id}`, headers: adminHeaders, payload: { values: { steps: 30 }, revision: 99 } });
  assert.equal(staleUpdate.statusCode, 409);

  // 创作中心 options：预设与字段契约投影
  const options = await app.inject({ method: 'GET', url: '/api/v1/admin/creative/options', headers: adminHeaders });
  assert.equal(options.statusCode, 200);
  const t2i = options.json().purposes.find((item: { purpose: string }) => item.purpose === 'text-to-image');
  assert.equal(t2i.presets.length, 1);
  assert.equal(t2i.defaultPresetId, preset.id);
  const promptField = t2i.fields.find((field: { key: string }) => field.key === 'prompt');
  assert.ok(promptField);
  assert.equal(promptField.required, true);

  // 旧请求（无 presetId）：默认预设合并到输入；提交成功
  const legacyTask = await app.inject({
    method: 'POST', url: '/api/v1/admin/creative/tasks',
    headers: { ...adminHeaders, 'idempotency-key': 'ws-legacy-1' },
    payload: { mode: 'text-to-image', prompt: 'legacy cat' },
  });
  assert.equal(legacyTask.statusCode, 202);
  await waitForTaskStatus(app, '/api/v1/admin/creative/tasks', (legacyTask.json() as { id: string }).id);
  const legacySamplerNode = promptBodies[1]!['3'] as { inputs: Record<string, unknown> };
  assert.equal(legacySamplerNode.inputs.steps, 28, 'default preset values must apply for legacy requests');

  // 显式预设 + parameters：模型/参数变化必须改变请求哈希（同幂等键 → 冲突）
  const presetTask = await app.inject({
    method: 'POST', url: '/api/v1/admin/creative/tasks',
    headers: { ...adminHeaders, 'idempotency-key': 'ws-preset-1' },
    payload: { mode: 'text-to-image', presetId: preset.id, presetRevision: 1, parameters: { prompt: 'preset cat', steps: 30 } },
  });
  assert.equal(presetTask.statusCode, 202);
  await waitForTaskStatus(app, '/api/v1/admin/creative/tasks', (presetTask.json() as { id: string }).id);
  const presetSamplerNode = promptBodies[2]!['3'] as { inputs: Record<string, unknown> };
  assert.equal(presetSamplerNode.inputs.steps, 30);
  const ambiguous = await app.inject({
    method: 'POST', url: '/api/v1/admin/creative/tasks',
    headers: { ...adminHeaders, 'idempotency-key': 'ws-ambiguous-1' },
    payload: { mode: 'text-to-image', presetId: preset.id, prompt: 'top', parameters: { prompt: 'nested' } },
  });
  assert.equal(ambiguous.statusCode, 400);
  assert.equal(ambiguous.json().error, 'ambiguous_parameter');

  // 同一幂等键、预设已修改（steps 30→31）→ 必须冲突，不能静默再执行
  const presetEdit = await app.inject({ method: 'PUT', url: `/api/v1/admin/generation/presets/${preset.id}`, headers: adminHeaders, payload: { values: { steps: 31 }, revision: 1 } });
  assert.equal(presetEdit.statusCode, 200);
  const editedRevision = presetEdit.json().revision as number;
  const replayed = await app.inject({
    method: 'POST', url: '/api/v1/admin/creative/tasks',
    headers: { ...adminHeaders, 'idempotency-key': 'ws-preset-1' },
    payload: { mode: 'text-to-image', presetId: preset.id, presetRevision: editedRevision, parameters: { prompt: 'preset cat', steps: 31 } },
  });
  assert.equal(replayed.statusCode, 409);
  assert.equal(replayed.json().error, 'idempotency_conflict');

  // 导出配置包：不含凭据；duplicate 复制版本
  const exported = await app.inject({ method: 'GET', url: `/api/v1/admin/generation/workflows/${workflowId}/versions/1/export`, headers: adminHeaders });
  assert.equal(exported.statusCode, 200);
  assert.equal(exported.json().format, 'sthstart-generation-config@1');
  assert.equal(exported.json().version.configFormatVersion, 2);
  const duplicated = await app.inject({ method: 'POST', url: `/api/v1/admin/generation/workflows/${workflowId}/duplicate`, headers: adminHeaders, payload: {} });
  assert.equal(duplicated.statusCode, 201);
  assert.match(duplicated.json().id as string, new RegExp(`^${workflowId}-copy-`));
});

test('configuration store: preset resolution enforces app/purpose/enablement and revision match', async () => {
  const database = new ServiceDatabase();
  const now = nowIso();
  database.connection.prepare("INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run('creative-center', '创作中心', 'hash', '[]', 1, now, now);
  database.connection.prepare("INSERT INTO generation_engines(id,name,kind,base_url,enabled,concurrency_limit,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run('e1', '直连', 'comfyui', 'http://comfy.test', 1, 1, now, now);
  database.connection.prepare("INSERT INTO generation_workflows(id,name,description,engine_kind,latest_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run('wf', 'WF', '', 'comfyui', 1, now, now);
  database.connection.prepare("INSERT INTO generation_workflow_versions(workflow_id,version,engine_id,input_schema_json,node_bindings_json,output_declarations_json,definition_json,is_published,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run('wf', 1, 'e1', JSON.stringify({ prompt: { type: 'string' } }), JSON.stringify({ prompt: ['1', 'inputs', 'text'] }), JSON.stringify(['9']),
      JSON.stringify({ '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } }, '9': { class_type: 'SaveImage', inputs: { images: ['1', 0] } } }), 1, now);
  database.connection.prepare("INSERT INTO app_generation_assignments(app_id,purpose,workflow_id,workflow_version,engine_id,updated_at) VALUES (?,?,?,?,?,?)")
    .run('creative-center', 'text-to-image', 'wf', 1, 'e1', now);
  const preset = await import('./generation/configuration-store.js').then((mod) => mod.createPreset(database, {
    appId: 'creative-center', purpose: 'text-to-image', name: 'P1', workflowId: 'wf', workflowVersion: 1, engineId: 'e1', values: {},
  }));

  assert.ok(resolveEnabledPreset(database, 'creative-center', 'text-to-image', preset.id, 1));
  assert.throws(() => resolveEnabledPreset(database, 'characters', 'text-to-image', preset.id, 1), (error: Error & { code?: string }) => error.code === 'preset_not_available');
  assert.throws(() => resolveEnabledPreset(database, 'creative-center', 'text-to-image', preset.id, 99), (error: Error & { code?: string }) => error.code === 'preset_revision_conflict');

  assert.equal(resolveDefaultPreset(database, 'creative-center', 'text-to-image'), null, 'no default preset configured yet');
  setDefaultPreset(database, preset.id);
  assert.equal(resolveDefaultPreset(database, 'creative-center', 'text-to-image')?.preset.id, preset.id);

  database.connection.prepare("INSERT INTO generation_engines(id,name,kind,base_url,enabled,concurrency_limit,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run('wrong-kind', '错误类型', 'worker', 'http://worker.test', 1, 1, now, now);
  assert.throws(() => updatePreset(database, preset.id, { engineId: 'wrong-kind', revision: 1, clearDefault: true }),
    (error: Error & { code?: string }) => error.code === 'generation_engine_kind_mismatch');
  assert.equal(resolveDefaultPreset(database, 'creative-center', 'text-to-image')?.preset.engineId, 'e1');

  // 换版本时，未显式传 values 也必须检查保留的覆盖值。
  database.connection.prepare('UPDATE generation_presets SET values_json = ? WHERE id = ?').run(JSON.stringify({ obsolete: 1 }), preset.id);
  database.connection.prepare('UPDATE generation_workflow_versions SET config_format_version = 2 WHERE workflow_id = ?').run('wf');
  assert.throws(() => updatePreset(database, preset.id, { workflowVersion: 1, revision: 1, clearDefault: true }),
    (error: Error & { code?: string }) => error.code === 'unknown_parameter');
  database.connection.prepare('UPDATE generation_presets SET values_json = ? WHERE id = ?').run('{}', preset.id);

  await updatePreset(database, preset.id, { enabled: false, revision: 1, clearDefault: true });
  assert.equal(resolveDefaultPreset(database, 'creative-center', 'text-to-image'), null, 'disabled default preset falls back to legacy behavior');
});
