import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceDatabase, nowIso } from './database.js';
import {
  getActivityImagePromptPolicy,
  resolveActivityImagePromptPolicy,
  saveActivityImagePromptPolicy,
} from './activities/image-prompt-policies.js';

function seedWorkflow(database: ServiceDatabase) {
  const now = nowIso();
  database.connection.prepare(`INSERT INTO generation_engines
    (id,name,kind,base_url,enabled,concurrency_limit,created_at,updated_at)
    VALUES ('policy-engine','策略测试','comfyui','http://127.0.0.1:8188',1,1,?,?)`).run(now, now);
  database.connection.prepare(`INSERT INTO generation_workflows
    (id,name,description,engine_kind,latest_version,category,created_at,updated_at)
    VALUES ('policy-flow','策略测试','','comfyui',1,'image',?,?)`).run(now, now);
  database.connection.prepare(`INSERT INTO generation_workflow_versions
    (workflow_id,version,engine_id,input_schema_json,node_bindings_json,output_declarations_json,definition_json,is_published,created_at,editor_config_json)
    VALUES ('policy-flow',1,'policy-engine','{"prompt":{"type":"string","semantic":"prompt"}}','{"prompt":["6","inputs","text"]}','["7"]',
      '{"6":{"class_type":"CLIPTextEncode","inputs":{"text":""}},"7":{"class_type":"SaveImage","inputs":{}}}',1,?,'{"version":2,"fields":{},"promptAssembly":"service-finalized-v1"}')`).run(now);
}

test('policy defaults inherit the workflow and round-trip artist, quality and adult opt-in', () => {
  const database = new ServiceDatabase(':memory:');
  try {
    seedWorkflow(database);
    const defaults = resolveActivityImagePromptPolicy(database, 'policy-flow', 1);
    assert.equal(defaults.artistString, '');
    assert.equal(defaults.qualityPrompt, '');
    assert.equal(defaults.adultKnowledgeEnabled, false);

    const saved = saveActivityImagePromptPolicy(database, {
      workflowId: 'policy-flow', workflowVersion: 1, revision: 0, enabled: true,
      instructions: '保留事实', positiveSuffix: '', negativePrompt: 'bad anatomy',
      outputFormat: 'tags', knowledgeMode: 'keyword',
      artistString: ' @ebora ', qualityPrompt: ' masterpiece, best quality ', adultKnowledgeEnabled: true,
    });
    assert.equal(saved.artistString, '@ebora');
    assert.equal(saved.qualityPrompt, 'masterpiece, best quality');
    assert.equal(saved.adultKnowledgeEnabled, true);

    assert.deepEqual(getActivityImagePromptPolicy(database, 'policy-flow', 1), saved);
    const persisted = database.connection.prepare(`SELECT artist_string,quality_prompt,adult_knowledge_enabled
      FROM activity_image_prompt_policy_versions WHERE workflow_id='policy-flow' AND workflow_version=1 AND revision=1`).get() as
      { artist_string: string; quality_prompt: string; adult_knowledge_enabled: number };
    assert.deepEqual({ ...persisted }, { artist_string: '@ebora', quality_prompt: 'masterpiece, best quality', adult_knowledge_enabled: 1 });
  } finally {
    database.close();
  }
});
