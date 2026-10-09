import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceDatabase, nowIso } from '../database.js';
import type { SecretStore } from '../security.js';
import { buildImagePurposeOptions, imageGenerationAudit, resolveImageConfiguration } from './image-configuration.js';
import { prepareImageGeneration } from './image-preparation.js';
import { renderWorkflowSnapshot } from './workflows.js';
import { resolveEffectiveActivityVisualPlan } from '../activities/image-render-common.js';
import { saveActivityImagePromptPolicy } from '../activities/image-prompt-policies.js';

function fixture() {
  const database = new ServiceDatabase();
  const now = nowIso();
  for (const app of ['creative-center', 'characters', 'activities']) database.connection.prepare(`INSERT INTO managed_apps
    (id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES (?,?,?,'[]',1,?,?)`).run(app, app, `${app}-token`, now, now);
  database.connection.prepare(`INSERT INTO generation_engines(id,name,kind,base_url,enabled,concurrency_limit,created_at,updated_at)
    VALUES ('image-engine','ComfyUI','comfyui','http://comfy.invalid',1,1,?,?)`).run(now, now);
  const definition = {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: 'default negative' } },
    '3': { class_type: 'KSampler', inputs: { seed: 1, steps: 20 } },
    '4': { class_type: 'KSampler', inputs: { seed: 333, steps: 8 } },
    '5': { class_type: 'SaveImage', inputs: {} },
  };
  const schema = { prompt: { type: 'string', semantic: 'prompt', required: true },
    negativePrompt: { type: 'string', semantic: 'negative_prompt', default: 'default negative' },
    steps: { type: 'integer', minimum: 1, maximum: 40, default: 20 },
    width: { type: 'integer', minimum: 256, maximum: 1024, step: 8, default: 768 },
    height: { type: 'integer', minimum: 256, maximum: 1024, step: 8, default: 512 },
    seed: { type: 'integer', minimum: 0 }, secondarySeed: { type: 'integer', minimum: 0 },
  };
  const bindings = { prompt: ['1', 'inputs', 'text'], negativePrompt: ['2', 'inputs', 'text'], seed: ['3', 'inputs', 'seed'],
    secondarySeed: ['4', 'inputs', 'seed'], steps: ['3', 'inputs', 'steps'] };
  const editor = { version: 2, modelSelection: 'preset-locked', loraSlots: [], promptAssembly: 'service-finalized-v1',
    sizePresets: [{ label: '横图', width: 768, height: 512 }], constraints: { maxPixels: 1048576 },
    fields: Object.fromEntries(Object.entries(schema).map(([key, value], index) => [key, { key, label: key, description: null,
      section: key === 'prompt' ? 'basic' : 'advanced', order: index, type: value.type === 'integer' ? 'integer' : 'long-text' }])) };
  for (const flow of ['flow-a', 'flow-b']) {
    database.connection.prepare(`INSERT INTO generation_workflows(id,name,description,engine_kind,category,latest_version,created_at,updated_at)
      VALUES (?,?,'','comfyui','image',1,?,?)`).run(flow, flow, now, now);
    database.connection.prepare(`INSERT INTO generation_workflow_versions(workflow_id,version,engine_id,input_schema_json,node_bindings_json,
      output_declarations_json,definition_json,is_published,created_at,config_format_version,editor_config_json)
      VALUES (?,1,'image-engine',?,?,?, ?,1,?,2,?)`).run(flow, JSON.stringify(flow === 'flow-a' ? schema : { ...schema, steps: { ...schema.steps, maximum: 12 } }),
      JSON.stringify(bindings), '["5"]', JSON.stringify(definition), now, JSON.stringify(editor));
  }
  for (const [app, purpose] of [['creative-center', 'text-to-image'], ['characters', 'character-avatar'], ['activities', 'activity_image_text']])
    database.connection.prepare(`INSERT INTO app_generation_assignments(app_id,purpose,workflow_id,workflow_version,engine_id,updated_at)
      VALUES (?,?,'flow-a',1,'image-engine',?)`).run(app, purpose, now);
  for (const [id, flow, steps] of [['base', 'flow-a', 24], ['turbo', 'flow-b', 8]] as const)
    database.connection.prepare(`INSERT INTO generation_presets(id,app_id,purpose,name,description,workflow_id,workflow_version,engine_id,values_json,enabled,revision,created_at,updated_at)
      VALUES (?,'creative-center','text-to-image',?,'',?,1,'image-engine',?,1,1,?,?)`).run(id, id, flow, JSON.stringify({ steps }), now, now);
  const secrets = {} as SecretStore;
  const input = { appId: 'creative-center' as const, purpose: 'text-to-image', presetId: 'base', presetRevision: 1,
    description: '一个女孩在窗边读书', ai: false, parameters: { negativePrompt: '' }, idempotencyKey: 'image-test-request' };
  return { database, secrets, input, definition, bindings };
}

test('image options project each preset from its own workflow version and keep defaults isolated', () => {
  const { database } = fixture();
  try {
    const options = buildImagePurposeOptions(database, 'creative-center', 'text-to-image');
    assert.equal(options.presets.find(item => item.id === 'base')?.configuration?.fields.find(item => item.key === 'steps')?.maximum, 40);
    assert.equal(options.presets.find(item => item.id === 'turbo')?.configuration?.fields.find(item => item.key === 'steps')?.maximum, 12);
    assert.equal(options.fields.find(item => item.key === 'steps')?.defaultValue, 20);
  } finally { database.close(); }
});

test('manual prompt preparation is exact, preserves empty negatives and never calls a provider', async () => {
  const { database, secrets, input } = fixture();
  try {
    const prepared = await prepareImageGeneration(database, secrets, { ...input, description: '  (red hair:1.2), reading\n' }, async () => { throw new Error('provider must not be called'); });
    assert.equal(prepared.positivePrompt, '  (red hair:1.2), reading\n');
    assert.equal(prepared.negativePrompt, '');
    assert.equal(prepared.parameters.steps, 24);
    assert.equal(prepared.optimizerCallId, null);
    assert.throws(() => imageGenerationAudit(database, { ...input, presetRevision: 2 }, prepared.configurationHash), /已更新/);
    database.connection.prepare("UPDATE generation_presets SET revision=2 WHERE id='base'").run();
    assert.throws(() => imageGenerationAudit(database, { ...input, presetRevision: 2 }, prepared.configurationHash), /配置已变化/);
  } finally { database.close(); }
});

test('AI preparation is audited and idempotent, detects conflicts and refuses unconfigured models', async () => {
  const { database, secrets, input } = fixture();
  try {
    await assert.rejects(prepareImageGeneration(database, secrets, { ...input, ai: true }), /未配置文本模型/);
    const now = nowIso();
    database.connection.prepare(`INSERT INTO provider_profiles(id,name,kind,base_url,model,enabled,created_at,updated_at)
      VALUES ('prompt-model','文本模型','llm','http://llm.invalid/v1','mock-model',1,?,?)`).run(now, now);
    database.connection.prepare("INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('creative-center','text','prompt-model',?)").run(now);
    let calls = 0;
    const fetcher: typeof fetch = async (_url, init) => { calls++; assert.deepEqual(JSON.parse(String(init?.body)).thinking, { type: 'disabled' }); return Response.json({ choices: [{ message: { content: 'one girl reading by a window' }, finish_reason: 'stop' }] }); };
    const request = { ...input, ai: true, idempotencyKey: 'configured-ai-request' };
    const first = await prepareImageGeneration(database, secrets, request, fetcher);
    const second = await prepareImageGeneration(database, secrets, request, fetcher);
    assert.equal(calls, 1); assert.equal(first.optimizerCallId, second.optimizerCallId);
    assert.equal(first.positivePrompt, second.positivePrompt);
    assert.equal(imageGenerationAudit(database, request, first.configurationHash, first.optimizerCallId!).parentId, first.optimizerCallId);
    const characterSelection = { appId: 'characters', purpose: 'character-avatar' };
    assert.throws(() => imageGenerationAudit(database, characterSelection,
      resolveImageConfiguration(database, characterSelection).configuration.configurationHash, first.optimizerCallId!), /不匹配/);
    await assert.rejects(prepareImageGeneration(database, secrets, { ...request, description: 'changed' }, fetcher), /同一请求键/);
  } finally { database.close(); }
});

test('mapped seeds preserve secondary-stage values and retain legacy unbound behavior', () => {
  const { database, definition, bindings } = fixture();
  try {
    const snapshot = renderWorkflowSnapshot(definition, bindings, { secondarySeed: 222 }, 123) as typeof definition;
    assert.equal(snapshot['3'].inputs.seed, 123); assert.equal(snapshot['4'].inputs.seed, 222);
    const defaults = renderWorkflowSnapshot(definition, bindings, {}, 123) as typeof definition;
    assert.equal(defaults['4'].inputs.seed, 333);
    const custom = renderWorkflowSnapshot(definition, { customSeed: bindings.seed, secondarySeed: bindings.secondarySeed }, { customSeed: 456 }, 123, 'customSeed') as typeof definition;
    assert.equal(custom['3'].inputs.seed, 123); assert.equal(custom['4'].inputs.seed, 333);
    const legacy = renderWorkflowSnapshot(definition, {}, {}, 123) as typeof definition;
    assert.equal(legacy['4'].inputs.seed, 123);
    assert.equal(definition['4'].inputs.seed, 333);
  } finally { database.close(); }
});

test('activity final prompt overrides bypass optimization and are included in configuration hashes', () => {
  const { database } = fixture();
  try {
    const input = { imageConfig: null, settings: {}, actors: [], sourcePrompt: 'original', seed: 12 };
    const original = resolveEffectiveActivityVisualPlan(database, input);
    const manual = resolveEffectiveActivityVisualPlan(database, { ...input, settings: { finalPositivePrompt: 'exact final', negativePrompt: '' } });
    assert.equal(manual.promptPolicy.enabled, false); assert.equal(manual.negativePrompt, '');
    assert.notEqual(manual.configurationHash, original.configurationHash);
    assert.throws(() => resolveEffectiveActivityVisualPlan(database, { ...input, settings: { finalPositivePrompt: ' ' } }), /不能为空/);
    assert.equal(resolveImageConfiguration(database, { appId: 'creative-center', purpose: 'text-to-image' }).configuration.promptMode, 'service-finalized-v1');
    const before = resolveImageConfiguration(database, { appId: 'creative-center', purpose: 'text-to-image' }).configuration.configurationHash;
    saveActivityImagePromptPolicy(database, { workflowId: 'flow-a', workflowVersion: 1, revision: 0, enabled: true, instructions: 'preserve details',
      positiveSuffix: '', negativePrompt: 'new default', outputFormat: 'prose', knowledgeMode: 'none' });
    assert.notEqual(resolveImageConfiguration(database, { appId: 'creative-center', purpose: 'text-to-image' }).configuration.configurationHash, before);
  } finally { database.close(); }
});


test('invalid parameters fail before AI dispatch and blank seeds stay stable across retries', async () => {
  const { database, secrets, input } = fixture();
  try {
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; throw new Error('must not dispatch'); };
    await assert.rejects(prepareImageGeneration(database, secrets, { ...input, ai: true, parameters: { steps: 99 } }, fetcher), /不能大于/);
    assert.equal(calls, 0);
    const row = database.connection.prepare("SELECT editor_config_json FROM generation_workflow_versions WHERE workflow_id='flow-a'").get() as { editor_config_json: string };
    const editor = JSON.parse(row.editor_config_json); editor.fields.seed.type = 'seed';
    database.connection.prepare("UPDATE generation_workflow_versions SET editor_config_json=? WHERE workflow_id='flow-a'").run(JSON.stringify(editor));
    const request = { ...input, parameters: { seed: null } };
    const first = await prepareImageGeneration(database, secrets, request, fetcher);
    const retry = await prepareImageGeneration(database, secrets, request, fetcher);
    assert.equal(first.parameters.seed, retry.parameters.seed);
    assert.equal(typeof first.parameters.seed, 'number');
  } finally { database.close(); }
});
