import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceDatabase, nowIso } from './database.js';
import { applyParityConfig, listParityEngines, planParityConfig, type ParityPlanItem } from './activities/parity-config.js';
import { buildParityTextWorkflow, PARITY_BASE_UNET, PARITY_TEXT_WORKFLOW_ID, PARITY_TURBO_UNET } from './activities/parity-workflows.js';
import { parseEditorConfig } from './generation/configuration.js';
import { getActivityImagePromptPolicy } from './activities/image-prompt-policies.js';
import { listPresets, resolveDefaultPreset } from './generation/configuration-store.js';
import { listActivityArtStyles } from './activities/art-styles.js';
import { readActualEncodedTexts } from './activities/image-prompt-snapshot.js';
import { renderWorkflowSnapshot } from './generation/workflows.js';
import {
  DEFAULT_ACTIVITY_IMAGE_PROMPT_INSTRUCTIONS,
  DEFAULT_ACTIVITY_IMAGE_STRUCTURED_INSTRUCTIONS,
} from '@sthstart/contracts';
import { buildStructuredSystemPrompt } from './activities/image-prompt-structured.js';

// ------------------------------------------- 第二轮修复（计划 §5.2／§8）：tags 输出协议
// 用例名统一带 `parity-round2:`，便于按计划 §8 的命令只跑本轮定向用例。

test('parity-round2: tags 系统指令在历史 prose 默认文本下仍强制 JSON 协议', () => {
  // 复现原缺陷：策略的 outputFormat='tags'，但 instructions 沿用了 prose 默认文本。
  const prompt = buildStructuredSystemPrompt({
    instructions: DEFAULT_ACTIVITY_IMAGE_PROMPT_INSTRUCTIONS,
    actorScope: [{ actorId: 'a1', displayName: '研究员' }],
  });

  // 固定协议必须在场。
  assert.ok(prompt.includes('Return JSON only'), 'tags 请求必须包含固定 JSON 协议');
  assert.ok(prompt.includes('"actors"'), 'tags 请求必须包含完整合法示例');
  // prose 语义必须消失，否则模型会被要求“只返回一行英文提示词”。
  assert.ok(!prompt.includes('Return one English prompt line only'),
    'prose 默认文本不得作为 tags 指令下发');
  // actorScope 必须在场且写明取值范围。
  assert.ok(prompt.includes('a1'), 'tags 请求必须包含合法 actorId');
  // 末尾重申协议不可被覆盖。
  assert.ok(prompt.includes('不可被补充规则覆盖'), '必须重申 JSON 协议不可被补充规则覆盖');
});

test('parity-round2: tags 指令已是协议本身时不重复拼接，且自定义规则被保留', () => {
  const already = buildStructuredSystemPrompt({
    instructions: DEFAULT_ACTIVITY_IMAGE_STRUCTURED_INSTRUCTIONS,
    actorScope: [{ actorId: 'a1' }],
  });
  const occurrences = already.split('Return JSON only').length - 1;
  assert.equal(occurrences, 1, 'instructions 已是 tags 默认协议时不得把协议重复加入');

  // 自定义改写规则必须原样保留，不能被模糊匹配删掉。
  const custom = buildStructuredSystemPrompt({
    instructions: '始终把“结晶”写成 crystal，并优先保留天气描述。',
    actorScope: [{ actorId: 'a1' }],
  });
  assert.ok(custom.includes('crystal'), '自定义规则必须保留');
  assert.ok(custom.includes('Return JSON only'), '自定义规则不得让固定协议消失');
});

test('parity-round2: 无人物时 actorScope 明确要求 actors 为空数组', () => {
  const prompt = buildStructuredSystemPrompt({ instructions: '', actorScope: [] });
  assert.ok(prompt.includes('actors 必须是空数组'), '无人物时必须明确禁止补人物');
  assert.ok(prompt.includes('Return JSON only'));
});

function seed(database: ServiceDatabase, options: { engines?: Array<{ id: string; name: string }> } = {}) {
  const now = nowIso();
  const engines = options.engines ?? [{ id: 'parity-engine', name: '本地 ComfyUI' }];
  database.connection.prepare(`INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
    VALUES ('activities','活动','parity-hash','[]',1,?,?)`).run(now, now);
  for (const engine of engines) {
    database.connection.prepare(`INSERT INTO generation_engines(id,name,kind,base_url,enabled,concurrency_limit,created_at,updated_at)
      VALUES (?,?,'comfyui','http://127.0.0.1:8188',1,1,?,?)`).run(engine.id, engine.name, now, now);
  }
  const primaryEngine = engines[0].id;
  // 既有绑定必须保持不动。
  database.connection.prepare(`INSERT INTO generation_workflows(id,name,description,engine_kind,latest_version,category,created_at,updated_at)
    VALUES ('legacy-flow','旧工作流','','comfyui',1,'image',?,?)`).run(now, now);
  database.connection.prepare(`INSERT INTO generation_workflow_versions
    (workflow_id,version,engine_id,input_schema_json,node_bindings_json,output_declarations_json,definition_json,is_published,created_at,
     input_capabilities_json,output_media_types_json,output_schema_json,config_format_version,editor_config_json)
    VALUES ('legacy-flow',1,?,'{"prompt":{"type":"string","semantic":"prompt"}}','{"prompt":["6","inputs","text"]}','["11"]',
      '{"6":{"class_type":"CLIPTextEncode","inputs":{"text":""}},"11":{"class_type":"SaveImage","inputs":{"images":["6",0]}}}',1,?,'{}','["image/png"]','{}',2,NULL)`)
    .run(primaryEngine, now);
  database.connection.prepare(`INSERT INTO app_generation_assignments(app_id,purpose,workflow_id,workflow_version,engine_id,updated_at)
    VALUES ('activities','activity_image_text','legacy-flow',1,?,?)`).run(primaryEngine, now);
}

test('check plan is read-only and lists every artifact it would create', () => {
  const database = new ServiceDatabase();
  seed(database);
  try {
    const before = database.connection.prepare('SELECT COUNT(*) AS count FROM generation_workflows').get() as { count: number };
    const plan = planParityConfig(database);
    assert.equal(plan.selectedEngineId, 'parity-engine');
    assert.equal(plan.engineIssue, null);
    const kinds = plan.items.map((item) => item.kind);
    const requiredKinds: Array<ParityPlanItem['kind']> = ['workflow', 'workflow_version', 'preset', 'art_style', 'prompt_policy'];
    for (const kind of requiredKinds) {
      assert.ok(kinds.includes(kind), `plan must list ${kind}`);
    }
    assert.equal(plan.items.find((item) => item.kind === 'workflow')!.action, 'create');
    assert.equal(plan.items.find((item) => item.kind === 'workflow_version')!.action, 'create');
    assert.equal(plan.items.filter((item) => item.kind === 'preset').length, 2);
    assert.ok(plan.missing.some((entry) => entry.includes('ComfyUI')));
    const after = database.connection.prepare('SELECT COUNT(*) AS count FROM generation_workflows').get() as { count: number };
    assert.equal(after.count, before.count, 'check must not write');
  } finally { database.close(); }
});

test('apply registers the workflow, presets, art style and policy without touching existing bindings', () => {
  const database = new ServiceDatabase();
  seed(database);
  try {
    const assignmentBefore = database.connection.prepare(
      "SELECT workflow_id,workflow_version,default_preset_id FROM app_generation_assignments WHERE app_id='activities' AND purpose='activity_image_text'",
    ).get();
    const result = applyParityConfig(database, { engineId: 'parity-engine' });

    assert.equal(result.workflowId, PARITY_TEXT_WORKFLOW_ID);
    assert.equal(result.workflowPublished, true);
    assert.equal(result.presets.length, 2);
    assert.equal(result.artStyle.action, 'create');
    assert.equal(result.policy.action, 'create');

    // 既有用途绑定完全未变。
    const assignmentAfter = database.connection.prepare(
      "SELECT workflow_id,workflow_version,default_preset_id FROM app_generation_assignments WHERE app_id='activities' AND purpose='activity_image_text'",
    ).get();
    assert.deepEqual(assignmentAfter, assignmentBefore);
    assert.equal(resolveDefaultPreset(database, 'activities', 'activity_image_text'), null);

    // 预设启用但非默认，且引用新版本。
    const presets = listPresets(database, { appId: 'activities', purpose: 'activity_image_text', workflowId: PARITY_TEXT_WORKFLOW_ID });
    assert.equal(presets.length, 2);
    for (const preset of presets) {
      assert.equal(preset.enabled, true);
      assert.equal(preset.isDefault, false);
      assert.equal(preset.workflowVersion, result.workflowVersion);
    }
    const base = presets.find((preset) => preset.name === '邻舍对齐 · Base')!;
    const turbo = presets.find((preset) => preset.name === '邻舍对齐 · Turbo')!;
    assert.equal(base.values.unet_name, PARITY_BASE_UNET);
    assert.equal(base.values.steps, 31);
    assert.equal(base.values.cfg, 5);
    assert.equal(base.values.sampler_name, 'er_sde');
    assert.equal(base.values.scheduler, 'beta');
    assert.equal(base.values.width, 768);
    assert.equal(base.values.height, 512);
    assert.equal(turbo.values.unet_name, PARITY_TURBO_UNET);
    assert.equal(turbo.values.steps, 12);
    assert.equal(turbo.values.cfg, 1);
    assert.equal(turbo.values.sampler_name, 'er_sde');
    assert.equal(turbo.values.scheduler, 'beta');

    // 画风：draft=Turbo、final=Base、默认画布 768×512。
    const styles = listActivityArtStyles(database);
    const style = styles.find((item) => item.name === '邻舍对齐 · Anima')!;
    assert.ok(style);
    const payload = style.payload as { renderProfiles: { draft: { presetId: string }; final: { presetId: string } }; defaultCanvas: { width: number; height: number }; positiveStylePrompt: string; negativePrompt: string };
    assert.equal(payload.renderProfiles.draft.presetId, turbo.id);
    assert.equal(payload.renderProfiles.final.presetId, base.id);
    assert.deepEqual(payload.defaultCanvas, { width: 768, height: 512 });
    assert.match(payload.positiveStylePrompt, /@ebora/);
    assert.match(payload.negativePrompt, /score_1/);

    // 策略：tags + keyword，画风后缀留空。
    const policy = getActivityImagePromptPolicy(database, PARITY_TEXT_WORKFLOW_ID, result.workflowVersion)!;
    assert.equal(policy.outputFormat, 'tags');
    assert.equal(policy.knowledgeMode, 'keyword');
    assert.equal(policy.positiveSuffix, '');
  } finally { database.close(); }
});

test('published parity version declares service-finalized assembly and encodes the final text directly', () => {
  const database = new ServiceDatabase();
  seed(database);
  try {
    const result = applyParityConfig(database, { engineId: 'parity-engine' });
    const row = database.connection.prepare(`SELECT definition_json,node_bindings_json,input_schema_json,editor_config_json
      FROM generation_workflow_versions WHERE workflow_id=? AND version=?`).get(PARITY_TEXT_WORKFLOW_ID, result.workflowVersion) as
      { definition_json: string; node_bindings_json: string; input_schema_json: string; editor_config_json: string };
    const editorConfig = parseEditorConfig(row.editor_config_json)!;
    assert.equal(editorConfig.promptAssembly, 'service-finalized-v1');

    const definition = JSON.parse(row.definition_json) as Record<string, unknown>;
    const bindings = JSON.parse(row.node_bindings_json) as Record<string, string[]>;
    assert.deepEqual(bindings.prompt, ['6', 'inputs', 'text']);
    assert.deepEqual(bindings.negativePrompt, ['7', 'inputs', 'text']);
    // 定义里不存在任何 StringConcatenate 分支。
    assert.equal(Object.values(definition).some((node) => String((node as { class_type?: string }).class_type) === 'StringConcatenate'), false);

    // 渲染后读回的实际编码文本等于服务端写入的最终文本。
    const rendered = renderWorkflowSnapshot(definition, bindings, {
      prompt: '@ebora, masterpiece, 1girl, alice, long hair, full body',
      negativePrompt: 'score_1, score_2',
    }, 42);
    const texts = readActualEncodedTexts(rendered);
    assert.equal(texts.positive.resolvable && texts.positive.text, '@ebora, masterpiece, 1girl, alice, long hair, full body');
    assert.equal(texts.negative.resolvable && texts.negative.text, 'score_1, score_2');
  } finally { database.close(); }
});

test('a second apply is idempotent and does not create duplicate revisions', () => {
  const database = new ServiceDatabase();
  seed(database);
  try {
    const first = applyParityConfig(database, { engineId: 'parity-engine' });
    const second = applyParityConfig(database, { engineId: 'parity-engine' });
    assert.equal(second.workflowVersion, first.workflowVersion);
    assert.equal(second.workflowPublished, false);
    assert.ok(second.presets.every((preset) => preset.action === 'up_to_date'));
    assert.equal(second.artStyle.action, 'up_to_date');
    assert.equal(second.policy.action, 'up_to_date');

    const versions = database.connection.prepare('SELECT COUNT(*) AS count FROM generation_workflow_versions WHERE workflow_id=?')
      .get(PARITY_TEXT_WORKFLOW_ID) as { count: number };
    assert.equal(versions.count, 1);
    const policies = database.connection.prepare('SELECT COUNT(*) AS count FROM activity_image_prompt_policy_versions WHERE workflow_id=?')
      .get(PARITY_TEXT_WORKFLOW_ID) as { count: number };
    assert.equal(policies.count, 1);
    const styles = listActivityArtStyles(database).filter((item) => item.name === '邻舍对齐 · Anima');
    assert.equal(styles.length, 1);

    // 变更后再次 check：全部为 up_to_date。
    const plan = planParityConfig(database);
    assert.equal(plan.items.find((item) => item.kind === 'workflow_version')!.action, 'up_to_date');
    assert.ok(plan.items.filter((item) => item.kind === 'preset').every((item) => item.action === 'up_to_date'));
    assert.equal(plan.items.find((item) => item.kind === 'prompt_policy')!.action, 'up_to_date');
  } finally { database.close(); }
});

test('multiple engines require an explicit --engine-id and never guess the first', () => {
  const database = new ServiceDatabase();
  seed(database, { engines: [{ id: 'engine-a', name: 'A' }, { id: 'engine-b', name: 'B' }] });
  try {
    assert.equal(listParityEngines(database).length, 2);
    const plan = planParityConfig(database);
    assert.equal(plan.selectedEngineId, null);
    assert.match(plan.engineIssue ?? '', /--engine-id/);
    assert.throws(() => applyParityConfig(database), /--engine-id/);
    const applied = applyParityConfig(database, { engineId: 'engine-b' });
    assert.equal(applied.engineId, 'engine-b');
  } finally { database.close(); }
});

test('the parity workflow definition stays consistent with its schema and content hash', () => {
  const bundle = buildParityTextWorkflow();
  assert.equal(bundle.editorConfig.promptAssembly, 'service-finalized-v1');
  assert.equal(Object.keys(bundle.inputCapabilities).length, 0);
  assert.deepEqual(bundle.editorConfig.sizePresets.map((preset) => `${preset.width}x${preset.height}`),
    ['768x512', '1024x768', '1280x720', '1920x1080']);
  assert.equal(bundle.editorConfig.constraints.maxPixels, 1920 * 1080);
  assert.equal(bundle.contentHash.length, 64);
  // 编辑器字段必须都有对应 inputSchema 键，否则界面出现无法提交的字段。
  const schemaKeys = new Set(Object.keys(bundle.inputSchema as Record<string, unknown>));
  for (const key of Object.keys(bundle.editorConfig.fields)) {
    assert.ok(schemaKeys.has(key), `editor field ${key} has no input schema entry`);
  }
  // 每个绑定都指向定义里存在的节点与输入。
  for (const [key, [nodeId, category, paramName]] of Object.entries(bundle.nodeBindings)) {
    assert.equal(category, 'inputs', key);
    const node = bundle.definition[nodeId] as { inputs?: Record<string, unknown> } | undefined;
    assert.ok(node, `binding ${key} targets a missing node`);
    assert.ok(paramName in (node!.inputs ?? {}), `binding ${key} targets a missing input`);
  }
});
