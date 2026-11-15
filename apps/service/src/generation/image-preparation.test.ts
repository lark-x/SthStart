import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { Value } from '@sinclair/typebox/value';
import { ServiceDatabase, nowIso } from '../database.js';
import type { SecretStore } from '../security.js';
import { buildImagePurposeOptions, imageGenerationAudit, resolveImageConfiguration } from './image-configuration.js';
import { prepareImageGeneration, registerImagePreparationRoutes } from './image-preparation.js';
import { publishWorkflowVersion } from './workflow-publish.js';
import { renderWorkflowSnapshot, injectActivityLoras } from './workflows.js';
import { resolveEffectiveActivityVisualPlan } from '../activities/image-render-common.js';
import { saveActivityImagePromptPolicy } from '../activities/image-prompt-policies.js';
import { assertPreparedImageContext } from './image-context.js';
import { createActorSnapshotFromCharacter } from '../activities/characters.js';
import { buildCharacterVisualContext, CloudRecipeDefinitionSchema, CreativePurposeOptionsSchema, ImageConfigurationSchema,
  ImagePreparationRequestSchema, ImagePreparationResponseSchema, type ContentDocument, type ImageConfigDocument } from '@sthstart/contracts';
import { compilePromptRecipe } from '../activities/image-prompt-compiler.js';
import { projectManagedImage } from './managed-image.js';
import { activityImageLore } from './image-context.js';

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

function cloudFixture(options: { negative?: boolean; editor?: boolean; promptKey?: string } = {}) {
  const database = new ServiceDatabase(':memory:'); const now = nowIso();
  database.connection.prepare("INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('creative-center','创作中心','test-token','[]',1,?,?)").run(now, now);
  database.connection.prepare("INSERT INTO generation_engines(id,name,kind,base_url,enabled,concurrency_limit,created_at,updated_at) VALUES ('cloud-image','Cloud GPT Image','cloud','https://image.invalid/v1',1,1,?,?)").run(now, now);
  database.connection.prepare("INSERT INTO generation_workflows(id,name,description,engine_kind,category,latest_version,created_at,updated_at) VALUES ('cloud-recipe','GPT Image','','cloud','image',0,?,?)").run(now, now);
  const promptKey = options.promptKey ?? 'prompt';
  const schema = { [promptKey]: { type: 'string', semantic: 'prompt', required: true },
    ...(options.negative ? { negativePrompt: { type: 'string', semantic: 'negative_prompt', default: 'default negative' } } : {}),
    size: { type: 'string', enum: ['1024x1024', '1536x1024'], default: '1024x1024' },
    quality: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' },
  };
  const recipe = { type: 'cloud_recipe', modelId: 'gpt-image-1', operation: 'text-to-image' };
  assert.equal(Value.Check(CloudRecipeDefinitionSchema, recipe), true);
  const editor = options.editor === false ? undefined : { version: 2, modelSelection: 'preset-locked', loraSlots: [], promptAssembly: 'service-finalized-v1',
    fields: Object.fromEntries(Object.keys(schema).map((key, order) => [key, { key, label: key, description: null, section: 'basic', order,
      type: key === promptKey || key === 'negativePrompt' ? 'long-text' : 'enum' }])), sizePresets: [], constraints: {} };
  const published = publishWorkflowVersion(database, { workflowId: 'cloud-recipe', engineId: 'cloud-image', definition: recipe, inputSchema: schema,
    nodeBindings: {}, inputCapabilities: {}, outputDeclarations: ['image'], outputMediaTypes: ['image/png'], editorConfig: editor });
  database.connection.prepare("INSERT INTO app_generation_assignments(app_id,purpose,workflow_id,workflow_version,engine_id,updated_at) VALUES ('creative-center','text-to-image','cloud-recipe',?,'cloud-image',?)").run(published.version, now);
  database.connection.prepare("INSERT INTO generation_presets(id,app_id,purpose,name,description,workflow_id,workflow_version,engine_id,values_json,enabled,revision,created_at,updated_at) VALUES ('cloud-preset','creative-center','text-to-image','Cloud','','cloud-recipe',?,'cloud-image','{}',1,1,?,?)").run(published.version, now, now);
  const secrets = {} as SecretStore;
  return { database, secrets, input: { appId: 'creative-center' as const, purpose: 'text-to-image', description: '  a harbor at dawn  ', ai: false,
    parameters: {}, idempotencyKey: 'cloud-image-prepare' }, promptKey };
}

test('published cloud recipe with no node or media bindings exposes ready UI contracts and prepares exact direct inputs', async () => {
  const { database, secrets, input } = cloudFixture();
  const app = Fastify(); let calls = 0;
  registerImagePreparationRoutes(app, database, secrets, async () => { calls++; throw new Error('no upstream calls allowed'); });
  try {
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/generation/image/options?appId=creative-center&purpose=text-to-image' });
    assert.equal(response.statusCode, 200); const options = response.json();
    assert.equal(Value.Check(CreativePurposeOptionsSchema, options), true);
    assert.equal(Value.Check(ImageConfigurationSchema, options.configuration), true);
    assert.equal(options.ready, true); assert.equal(options.status, 'ready');
    assert.equal(options.configuration.promptKey, 'prompt'); assert.equal(options.configuration.negativePromptKey, null);
    assert.equal(options.configuration.promptMode, 'service-finalized-v1');
    assert.deepEqual(options.configuration.inputCapabilities, {}); assert.equal(options.configuration.referenceInputKey, null);
    assert.deepEqual(options.configuration.warnings, []);
    assert.equal(options.presets[0].configuration.promptKey, 'prompt');
    const request = { ...input, parameters: { size: '1536x1024', quality: 'high' } };
    assert.equal(Value.Check(ImagePreparationRequestSchema, request), true);
    const preparedResponse = await app.inject({ method: 'POST', url: '/api/v1/admin/generation/image/prepare', payload: request });
    assert.equal(preparedResponse.statusCode, 200, preparedResponse.body); const prepared = preparedResponse.json();
    assert.equal(Value.Check(ImagePreparationResponseSchema, prepared), true);
    assert.equal(prepared.promptMode, 'service-finalized-v1'); assert.equal(prepared.positivePrompt, input.description);
    assert.equal(prepared.negativePrompt, null);
    assert.deepEqual(prepared.parameters, { prompt: input.description, size: '1536x1024', quality: 'high' });
    assert.deepEqual(prepared.warnings, []); assert.equal(prepared.optimizerCallId, null);
    assert.doesNotThrow(() => assertPreparedImageContext(database, input.appId, prepared.preparationId, prepared.contextHash));
    assert.doesNotThrow(() => imageGenerationAudit(database, input, prepared.configurationHash));
    assert.equal(calls, 0);
    const resolved = resolveImageConfiguration(database, input);
    assert.deepEqual(resolved.workflow.nodeBindings, {}); assert.deepEqual(resolved.workflow.inputCapabilities, {});
    assert.equal(resolved.workflow.definition.type, 'cloud_recipe');
    const rendered = renderWorkflowSnapshot(resolved.workflow.definition, resolved.workflow.nodeBindings, prepared.parameters);
    assert.deepEqual(rendered, resolved.workflow.definition);
    assert.deepEqual(injectActivityLoras(rendered, resolved.workflow.editorConfig, prepared.diagnostics.loras), resolved.workflow.definition);
  } finally { await app.close(); database.close(); }
});

test('cloud image edit exposes declared reference media without graph bindings and text-only recipes do not', () => {
  const { database, input } = cloudFixture();
  try {
    const publish = (operation: string, mediaTypes: string[]) => {
      const version = publishWorkflowVersion(database, { workflowId: 'cloud-recipe', engineId: 'cloud-image',
        definition: { type: 'cloud_recipe', modelId: 'gpt-image-1', operation },
        inputSchema: { prompt: { type: 'string', required: true } }, nodeBindings: {},
        inputCapabilities: { referenceImage: { semantic: 'init_image', mediaTypes, required: true, maxCount: 1 } },
        outputDeclarations: ['image'], outputMediaTypes: ['image/png'] });
      database.connection.prepare("UPDATE app_generation_assignments SET workflow_version=? WHERE workflow_id='cloud-recipe'").run(version.version);
      return resolveImageConfiguration(database, input).configuration;
    };
    const edits = publish('image-to-image', ['image/png', 'image/jpeg']);
    assert.equal(edits.referenceInputKey, 'referenceImage');
    assert.equal(edits.inputCapabilities?.referenceImage.required, true);
    assert.equal(Value.Check(ImageConfigurationSchema, edits), true);
    assert.equal(publish('text-to-image', ['image/png']).referenceInputKey, null);
    assert.equal(publish('image-to-image', ['audio/mpeg']).referenceInputKey, null);
  } finally { database.close(); }
});

test('cloud direct negative inputs preserve defaults and explicit empty text without a node binding', async () => {
  const { database, secrets, input } = cloudFixture({ negative: true });
  try {
    const configuration = resolveImageConfiguration(database, input).configuration;
    assert.equal(configuration.promptKey, 'prompt'); assert.equal(configuration.negativePromptKey, 'negativePrompt');
    const noNetwork: typeof fetch = async () => { throw new Error('no upstream calls allowed'); };
    const defaults = await prepareImageGeneration(database, secrets, input, noNetwork);
    assert.equal(defaults.negativePrompt, 'default negative'); assert.equal(defaults.parameters.negativePrompt, 'default negative');
    const empty = await prepareImageGeneration(database, secrets, { ...input, parameters: { negativePrompt: '' }, idempotencyKey: 'cloud-negative-empty' }, noNetwork);
    assert.equal(empty.negativePrompt, ''); assert.equal(empty.parameters.negativePrompt, '');
    assert.equal(Value.Check(ImagePreparationResponseSchema, empty), true);
  } finally { database.close(); }
});

test('cloud legacy schemas use direct finalized prompts but undeclared inputs never become phantom mappings', async () => {
  for (const promptKey of ['prompt', 'positivePrompt']) {
    const { database, secrets, input } = cloudFixture({ editor: false, promptKey });
    try {
      const resolved = resolveImageConfiguration(database, input);
      assert.equal(resolved.configuration.promptKey, promptKey); assert.equal(resolved.configuration.promptMode, 'service-finalized-v1');
      const prepared = await prepareImageGeneration(database, secrets, input, async () => { throw new Error('no upstream'); });
      assert.equal(prepared.parameters[promptKey], input.description);
      database.connection.prepare("UPDATE generation_workflow_versions SET input_schema_json='{}' WHERE workflow_id='cloud-recipe'").run();
      assert.equal(buildImagePurposeOptions(database, input.appId, input.purpose).ready, false);
      await assert.rejects(prepareImageGeneration(database, secrets, input), (error: any) => error.code === 'prompt_binding_required');
    } finally { database.close(); }
  }
});

test('cloud semantic aliases unsupported by execution never become usable prompt mappings', async () => {
  const { database, secrets, input } = cloudFixture({ negative: true });
  try {
    const row = database.connection.prepare("SELECT input_schema_json,editor_config_json FROM generation_workflow_versions WHERE workflow_id='cloud-recipe'").get() as { input_schema_json: string; editor_config_json: string };
    const schema = JSON.parse(row.input_schema_json); const editor = JSON.parse(row.editor_config_json);
    schema.avoid = schema.negativePrompt; delete schema.negativePrompt;
    editor.fields.avoid = { ...editor.fields.negativePrompt, key: 'avoid' }; delete editor.fields.negativePrompt;
    database.connection.prepare("UPDATE generation_workflow_versions SET input_schema_json=?,editor_config_json=? WHERE workflow_id='cloud-recipe'").run(JSON.stringify(schema), JSON.stringify(editor));
    const negativeAlias = resolveImageConfiguration(database, input).configuration;
    assert.equal(negativeAlias.promptKey, 'prompt'); assert.equal(negativeAlias.negativePromptKey, null);
    schema.caption = schema.prompt; delete schema.prompt;
    editor.fields.caption = { ...editor.fields.prompt, key: 'caption' }; delete editor.fields.prompt;
    database.connection.prepare("UPDATE generation_workflow_versions SET input_schema_json=?,editor_config_json=? WHERE workflow_id='cloud-recipe'").run(JSON.stringify(schema), JSON.stringify(editor));
    const options = buildImagePurposeOptions(database, input.appId, input.purpose);
    assert.equal(options.ready, false); assert.equal(options.configuration?.promptKey, null);
    await assert.rejects(prepareImageGeneration(database, secrets, input, async () => { throw new Error('no upstream'); }),
      (error: any) => error.code === 'prompt_binding_required');
  } finally { database.close(); }
});

test('cloud preparation rejects an enabled role LoRA without an insertion anchor before any model dispatch', async () => {
  const { database, secrets, input } = cloudFixture();
  try {
    const now = nowIso();
    const draft = { schemaVersion: 2, displayName: 'Alice', appearance: { baseText: 'silver hair', defaultOutfitText: 'coat', stableFeatures: [] },
      visualLoras: [{ model: 'alice.safetensors', strength: 0.7, triggerWord: 'alice_trigger', enabled: true }] };
    database.connection.prepare("INSERT INTO character_profiles(id,slug,display_name,draft_json,tags_json,archived,created_at,updated_at,draft_revision) VALUES ('cloud-alice','cloud-alice','Alice',?,'[]',0,?,?,1)").run(JSON.stringify(draft), now, now);
    let calls = 0;
    await assert.rejects(prepareImageGeneration(database, secrets, { ...input, ai: true, manualFinal: false, context: { characters: [{ characterId: 'cloud-alice' }] } },
      async () => { calls++; throw new Error('no upstream'); }), /未声明活动 LoRA 插入点/);
    assert.equal(calls, 0);
  } finally { database.close(); }
});

test('Comfy prompt bindings and legacy prompt assembly still require the existing graph mapping', async () => {
  const { database, input, secrets } = fixture();
  try {
    const before = resolveImageConfiguration(database, input).configuration;
    assert.equal(before.promptKey, 'prompt'); assert.equal(before.negativePromptKey, 'negativePrompt');
    database.connection.prepare("UPDATE generation_workflow_versions SET node_bindings_json='{}',editor_config_json=NULL WHERE workflow_id='flow-a'").run();
    const after = resolveImageConfiguration(database, input).configuration;
    assert.equal(after.promptKey, null); assert.equal(after.negativePromptKey, null); assert.equal(after.promptMode, 'workflow-internal');
    assert.equal(buildImagePurposeOptions(database, input.appId, input.purpose).ready, false);
    await assert.rejects(prepareImageGeneration(database, secrets, input), (error: any) => error.code === 'prompt_binding_required');
  } finally { database.close(); }
});

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

test('V2 role context and outfit inheritance survive preparation; changed sources invalidate submission', async () => {
  const { database, secrets, input } = fixture();
  try {
    const now = nowIso();
    const draft = { schemaVersion: 2, displayName: 'Alice', englishName: 'Alice', appearance: {
      baseText: 'silver hair, blue eyes', defaultOutfitText: 'blue coat', stableFeatures: ['star hairpin'] } };
    database.connection.prepare(`INSERT INTO character_profiles(id,slug,display_name,draft_json,tags_json,archived,created_at,updated_at,draft_revision)
      VALUES ('alice','alice','Alice',?,'[]',0,?,?,1)`).run(JSON.stringify(draft), now, now);
    const actor = createActorSnapshotFromCharacter(database, 'alice')!;
    assert.equal(actor.outfitDescription, 'blue coat');
    const content: ContentDocument = { schemaVersion: 1, activity: { title: 'test', type: 'story', theme: '', location: '', rules: '', generationMode: 'autonomous' },
      actors: [actor], relationships: [], stages: [], scenes: [], facts: [], conversations: [], messages: [], posts: [], comments: [], likes: [], stageResults: [],
      mediaSlots: [{ id: 'slot', kind: 'image', stageId: 'stage', actorIds: [actor.id], sourceFactIds: [], caption: '', shotDescription: 'standing' }] };
    const imageConfig: ImageConfigDocument = { schemaVersion: 1, stylePreset: 'custom', globalStylePrompt: '', globalNegativePrompt: '', slotConfigs: [], defaultParams: {} };
    const recipe = compilePromptRecipe({ activityId: 'act', contentRevisionId: 'content', contentDoc: content,
      imageConfigRevisionId: 'config', imageConfigDoc: imageConfig, slotId: 'slot' });
    assert.match(recipe.compilation.channels.prompt, /silver hair/); assert.match(recipe.compilation.channels.prompt, /blue coat/);
    assert.match(buildCharacterVisualContext(actor.persona, { outfitOverride: actor.outfitDescription }).text, /silver hair/);
    assert.equal(createActorSnapshotFromCharacter(database, 'alice', { outfitDescription: '' })!.outfitDescription, '');
    const request = { ...input, manualFinal: false, context: { characters: [{ characterId: 'alice', draftRevision: 1 }] } };
    const result = await prepareImageGeneration(database, secrets, request, async () => { throw new Error('no AI'); });
    assert.match(result.positivePrompt, /silver hair/); assert.match(result.positivePrompt, /blue coat/);
    assert.equal(result.diagnostics?.contextSources[0].revision, '1');
    assert.doesNotThrow(() => assertPreparedImageContext(database, input.appId, result.preparationId, result.contextHash));
    assert.throws(() => assertPreparedImageContext(database, input.appId, result.preparationId, result.contextHash, undefined,
      { workflowId: 'flow-b', workflowVersion: 1, configurationHash: result.configurationHash }), /工作流/);
    database.connection.prepare("UPDATE character_profiles SET draft_revision=2 WHERE id='alice'").run();
    assert.throws(() => assertPreparedImageContext(database, input.appId, result.preparationId, result.contextHash), /变化/);
  } finally { database.close(); }
});

test('role LoRA is frozen once and managed aliases preserve declared fields or reject missing capabilities', async () => {
  const { database, secrets, input } = fixture();
  try {
    const now = nowIso();
    const lora = { model: 'char\\alice.safetensors', strength: 0.7, triggerWord: 'alice_trigger', enabled: true };
    const draft = { schemaVersion: 2, displayName: 'Alice', appearance: { baseText: 'silver hair', defaultOutfitText: 'coat', stableFeatures: [] }, visualLoras: [lora] };
    database.connection.prepare("INSERT INTO character_profiles(id,slug,display_name,draft_json,tags_json,archived,created_at,updated_at,draft_revision) VALUES ('alice','alice','Alice',?,'[]',0,?,?,1)").run(JSON.stringify(draft), now, now);
    const row = database.connection.prepare("SELECT editor_config_json,definition_json,node_bindings_json FROM generation_workflow_versions WHERE workflow_id='flow-a'").get() as { editor_config_json: string; definition_json: string; node_bindings_json: string };
    const editor = JSON.parse(row.editor_config_json); editor.activityLoraInjection = { targetNodeId: '3', targetInput: 'model' };
    const definition = JSON.parse(row.definition_json); definition['6'] = { class_type: 'UNETLoader', inputs: { unet_name: 'base' } }; definition['3'].inputs.model = ['6', 0];
    database.connection.prepare("UPDATE generation_workflow_versions SET editor_config_json=?,definition_json=? WHERE workflow_id='flow-a'").run(JSON.stringify(editor), JSON.stringify(definition));
    const result = await prepareImageGeneration(database, secrets, { ...input, manualFinal: false, context: { characters: [{ characterId: 'alice' }] } }, async () => { throw new Error('isolated test'); });
    assert.equal(result.diagnostics?.loras[0].model, 'char/alice.safetensors');
    assert.equal(result.positivePrompt.split('alice_trigger').length - 1, 1);
    const frozen = injectActivityLoras(renderWorkflowSnapshot(definition, JSON.parse(row.node_bindings_json), result.parameters), editor, result.diagnostics!.loras);
    assert.equal(Object.values(frozen).filter(node => (node as { class_type: string }).class_type === 'LoraLoaderModelOnly').length, 1);
    database.connection.prepare("INSERT INTO app_generation_assignments(app_id,purpose,workflow_id,workflow_version,engine_id,updated_at) VALUES ('creative-center','linshe-chat-image','flow-a',1,'image-engine',?)").run(now);
    assert.throws(() => projectManagedImage(database, 'creative-center', 'linshe-chat-image', { version: 1, loras: [] }, {}), /已授权/);
    database.connection.prepare("INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('linshe','linshe','token','[]',1,?,?)").run(now, now);
    database.connection.prepare("INSERT INTO app_generation_assignments(app_id,purpose,workflow_id,workflow_version,engine_id,updated_at) VALUES ('linshe','linshe-chat-image','flow-a',1,'image-engine',?)").run(now);
    const bindings = JSON.parse(row.node_bindings_json); bindings.sampler_name = ['3', 'inputs', 'sampler_name'];
    database.connection.prepare("UPDATE generation_workflow_versions SET node_bindings_json=? WHERE workflow_id='flow-a'").run(JSON.stringify(bindings));
    const projected = projectManagedImage(database, 'linshe', 'linshe-chat-image', { version: 1, loras: [lora] }, { prompt: 'alice', sampler: 'euler', negativePrompt: '' });
    assert.equal(projected.inputs.sampler_name, 'euler'); assert.equal(projected.inputs.negativePrompt, '');
    assert.equal(projected.loras[0].model, 'char/alice.safetensors');
    assert.throws(() => projectManagedImage(database, 'linshe', 'linshe-chat-image', { version: 1, loras: [] }, { unavailable: 1 }), /无法消费/);
    const assembled = projectManagedImage(database, 'linshe', 'linshe-chat-image', { version: 1, loras: [] }, { prompt: 'one girl', artist: '@artist', qualityPrompt: 'best quality', loraTriggers: 'trigger' });
    assert.match(String(assembled.inputs.prompt), /@artist/); assert.match(String(assembled.inputs.prompt), /trigger/);
  } finally { database.close(); }
});

test('selected actors use the same structured protocol and reject an invented actor before image dispatch', async () => {
  const { database, secrets, input } = fixture();
  try {
    const now = nowIso();
    const draft = { schemaVersion: 2, displayName: 'Alice', appearance: { baseText: 'silver hair', defaultOutfitText: 'coat', stableFeatures: [] } };
    database.connection.prepare("INSERT INTO character_profiles(id,slug,display_name,draft_json,tags_json,archived,created_at,updated_at,draft_revision) VALUES ('alice','alice','Alice',?,'[]',0,?,?,1)").run(JSON.stringify(draft), now, now);
    database.connection.prepare("INSERT INTO provider_profiles(id,name,kind,base_url,model,enabled,created_at,updated_at) VALUES ('llm','llm','llm','http://llm.invalid','test',1,?,?)").run(now, now);
    database.connection.prepare("INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('creative-center','text','llm',?)").run(now);
    saveActivityImagePromptPolicy(database, { workflowId: 'flow-a', workflowVersion: 1, revision: 0, enabled: true,
      instructions: '', positiveSuffix: '', negativePrompt: '', outputFormat: 'tags', knowledgeMode: 'keyword' });
    const output = { actors: [{ actorId: 'alice', identity: ['alice'], appearance: ['silver hair'], clothing: ['coat'], action: ['standing'], expression: ['smile'] }], camera: ['full body'], scene: ['night'], details: [], naturalLanguage: '' };
    const request = { ...input, ai: true, context: { characters: [{ characterId: 'alice' }] } };
    const fetcher: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)); assert.match(body.messages[0].content, /actorId/);
      assert.match(body.messages[1].content, /silver hair/);
      return Response.json({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }] });
    };
    const result = await prepareImageGeneration(database, secrets, request, fetcher);
    assert.match(result.positivePrompt, /silver hair/); assert.match(result.positivePrompt, /coat/);
    output.actors[0].actorId = 'invented';
    await assert.rejects(prepareImageGeneration(database, secrets, { ...request, idempotencyKey: 'invented-actor-key' }, fetcher),
      error => (error as { code: string }).code === 'prompt_optimizer_actor_scope_invalid');
  } finally { database.close(); }
});

test('lore content revision participates in preparation identity without leaking all notebook contents', async () => {
  const { database, secrets, input } = fixture();
  try {
    const now = nowIso();
    database.connection.prepare(`INSERT INTO creative_notes(id,title,kind,summary,content_json,tags_json,stage,favorite,created_at,updated_at)
      VALUES ('world','Glass world','world','floating glass bridges','[]','[]','reference',0,?,?)`).run(now, now);
    const prepared = await prepareImageGeneration(database, secrets, { ...input, manualFinal: false, context: { noteIds: ['world'] } });
    assert.match(prepared.positivePrompt, /floating glass bridges/);
    assert.equal(prepared.diagnostics?.contextSources[0].id, 'world');
    database.connection.prepare("UPDATE creative_notes SET summary='stone bridges' WHERE id='world'").run();
    assert.throws(() => assertPreparedImageContext(database, input.appId, prepared.preparationId, prepared.contextHash), /变化/);
  } finally { database.close(); }
});

test('artist string and quality prompt are prepended in the neighbor order and manual finals stay exact', async () => {
  const { database, secrets, input } = fixture();
  try {
    saveActivityImagePromptPolicy(database, { workflowId: 'flow-a', workflowVersion: 1, revision: 0, enabled: false,
      instructions: '', positiveSuffix: '', negativePrompt: '', outputFormat: 'prose', knowledgeMode: 'none',
      artistString: '@ebora', qualityPrompt: 'masterpiece, best quality' });
    const prepared = await prepareImageGeneration(database, secrets, { ...input, ai: false, manualFinal: false },
      async () => { throw new Error('must not call'); });
    assert.equal(prepared.positivePrompt, 'masterpiece, best quality, @ebora, 一个女孩在窗边读书');
    const manual = await prepareImageGeneration(database, secrets, { ...input, ai: false, manualFinal: true, idempotencyKey: 'manual-style-bypass' });
    assert.equal(manual.positivePrompt, '一个女孩在窗边读书');
  } finally { database.close(); }
});

test('activity lore uses adopted frozen references instead of the mutable notebook', () => {
  const { database } = fixture();
  try {
    const now = nowIso();
    database.connection.prepare("INSERT INTO activities(id,title,type,created_at,updated_at) VALUES ('act','test','story',?,?)").run(now, now);
    database.connection.prepare("INSERT INTO activity_drafts(activity_id,document_json,updated_at) VALUES ('act',?,?)").run(JSON.stringify({ activity: { planningBasis: { knowledge: { references: [{ id: 'ref', sourceId: 'note', sourceKind: 'note', title: 'world', usage: 'background', nature: 'canon', excerpt: 'floating glass bridges' }] } } } }), now);
    assert.match(activityImageLore(database, 'act'), /floating glass bridges/);
  } finally { database.close(); }
});

test('disabled AI policy makes no model call; manual final bypasses keyword and suffix', async () => {
  const { database, secrets, input } = fixture();
  try {
    saveActivityImagePromptPolicy(database, { workflowId: 'flow-a', workflowVersion: 1, revision: 0, enabled: false,
      instructions: '', positiveSuffix: '', negativePrompt: '', outputFormat: 'tags', knowledgeMode: 'keyword' });
    let calls = 0;
    const result = await prepareImageGeneration(database, secrets, { ...input, ai: true, description: 'night, standing', manualFinal: false }, async () => { calls++; throw new Error('must not call'); });
    assert.equal(calls, 0); assert.equal(result.optimizerCallId, null); assert.equal(result.diagnostics?.knowledgeMode, 'keyword');
    const manual = await prepareImageGeneration(database, secrets, { ...input, description: ' exact manual ', ai: true, manualFinal: true, idempotencyKey: 'manual-new-key' });
    assert.equal(manual.positivePrompt, ' exact manual '); assert.equal(manual.diagnostics?.knowledgeMode, 'none');
  } finally { database.close(); }
});
