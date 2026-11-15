import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceDatabase, nowIso } from './database.js';
import { buildMossImageWorkflow, MOSS_WORKFLOW_ID } from './activities/moss-workflow.js';
import { registerMossImageWorkflow } from './activities/moss-config.js';

function seedEngine(database: ServiceDatabase) {
  const now = nowIso();
  database.connection.prepare('INSERT INTO generation_engines(id,name,kind,base_url,enabled,concurrency_limit,created_at,updated_at) '
    + "VALUES ('moss-engine','ComfyUI','comfyui','http://127.0.0.1:8188',1,1,?,?)").run(now, now);
}

test('the MOSS workflow encodes the prompt directly and keeps the official model stack', () => {
  const bundle = buildMossImageWorkflow();
  assert.equal(bundle.id, MOSS_WORKFLOW_ID);
  assert.equal(bundle.editorConfig.promptAssembly, 'service-finalized-v1');
  assert.equal(bundle.editorConfig.promptLanguage, 'en');
  assert.equal(bundle.contentHash.length, 64);
  // 9B 文本扩展节点必须不存在：故事配图不接受模型自行改写事实。
  assert.equal(Object.values(bundle.definition).some((node) =>
    ['TextGenerate', 'ComfySwitchNode', 'PreviewAny'].includes(String((node as { class_type?: string }).class_type))), false);
  assert.equal((bundle.definition['2'] as { inputs: Record<string, unknown> }).inputs.type, 'moss_image');
  assert.equal((bundle.definition['8'] as { class_type: string }).class_type, 'EmptyFlux2LatentImage');
  // 编辑器字段必须都有 inputSchema 键，绑定必须指向真实节点输入。
  const schemaKeys = new Set(Object.keys(bundle.inputSchema as Record<string, unknown>));
  for (const key of Object.keys(bundle.editorConfig.fields)) assert.ok(schemaKeys.has(key), key);
  for (const [key, [nodeId, category, paramName]] of Object.entries(bundle.nodeBindings)) {
    assert.equal(category, 'inputs', key);
    const node = bundle.definition[nodeId] as { inputs?: Record<string, unknown> } | undefined;
    assert.ok(node && paramName in (node.inputs ?? {}), key);
  }
  // 尺寸预设必须落在 schema 范围内且不超过像素预算。
  for (const preset of bundle.editorConfig.sizePresets) {
    assert.ok(preset.width >= 512 && preset.width <= 1536 && preset.height >= 512 && preset.height <= 1536);
    assert.ok(preset.width * preset.height <= 1024 * 1024);
    assert.equal(preset.width % 16, 0);
    assert.equal(preset.height % 16, 0);
  }
});

test('registering the MOSS workflow is idempotent and does not bind it to any purpose', () => {
  const database = new ServiceDatabase(':memory:');
  try {
    seedEngine(database);
    const first = registerMossImageWorkflow(database, 'moss-engine');
    assert.equal(first.published, true);
    const second = registerMossImageWorkflow(database, 'moss-engine');
    assert.equal(second.published, false);
    assert.equal(second.workflowVersion, first.workflowVersion);
    const versions = database.connection.prepare('SELECT COUNT(*) AS count FROM generation_workflow_versions WHERE workflow_id=?')
      .get(MOSS_WORKFLOW_ID) as { count: number };
    assert.equal(versions.count, 1);
    const bound = database.connection.prepare('SELECT COUNT(*) AS count FROM app_generation_assignments WHERE workflow_id=?')
      .get(MOSS_WORKFLOW_ID) as { count: number };
    assert.equal(bound.count, 0, 'MOSS 与 Anima 并存，注册时不改任何用途绑定');
  } finally { database.close(); }
});
