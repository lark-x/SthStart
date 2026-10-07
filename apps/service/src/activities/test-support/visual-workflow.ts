// Synthetic workflow fixture; consumers must supply an isolated test database.
import type { GenerationPresetRef } from '@sthstart/contracts';
import { ServiceDatabase, nowIso } from '../../database.js';
import { createPreset } from '../../generation/configuration-store.js';

export function installVisualTestWorkflow(database: ServiceDatabase) {
  const now = nowIso();
  database.connection.prepare(`INSERT INTO generation_engines(id,name,kind,base_url,enabled,concurrency_limit,created_at,updated_at)
    VALUES ('visual-engine','测试连接','comfyui','http://visual.test',1,1,?,?)`).run(now, now);
  database.connection.prepare(`INSERT INTO generation_workflows(id,name,description,engine_kind,latest_version,category,created_at,updated_at)
    VALUES ('visual-flow','语义字段工作流','','comfyui',1,'image',?,?)`).run(now, now);
  const schema = {
    description: { type: 'long-text', semantic: 'prompt', required: true },
    unwanted: { type: 'long-text', semantic: 'negative_prompt' },
    latent_w: { type: 'integer', semantic: 'width', minimum: 256, maximum: 2048, step: 64, required: true },
    latent_h: { type: 'integer', semantic: 'height', minimum: 256, maximum: 2048, step: 64, required: true },
    noise_seed: { type: 'seed', semantic: 'seed', minimum: 0, maximum: 2147483647 },
    steps: { type: 'integer', minimum: 1, maximum: 50 },
    model: { type: 'model', semantic: 'checkpoint' },
  };
  const bindings = { description: ['1','inputs','text'], unwanted: ['2','inputs','text'],
    latent_w: ['6','inputs','width'], latent_h: ['6','inputs','height'], noise_seed: ['3','inputs','seed'],
    steps: ['3','inputs','steps'], model: ['4','inputs','ckpt_name'] };
  const graph = {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
    '3': { class_type: 'KSampler', inputs: { seed: 0, steps: 10, model: ['4',0] } },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'base.safetensors' } },
    '5': { class_type: 'SaveImage', inputs: { images: ['3',0] } },
    '6': { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 768 } },
  };
  const editor = { version: 2, modelSelection: 'preset-locked', fields: {}, loraSlots: [], sizePresets: [], constraints: {} };
  database.connection.prepare(`INSERT INTO generation_workflow_versions
    (workflow_id,version,engine_id,input_schema_json,node_bindings_json,output_declarations_json,definition_json,is_published,created_at,
     input_capabilities_json,output_media_types_json,output_schema_json,config_format_version,editor_config_json)
    VALUES ('visual-flow',1,'visual-engine',?,?,?,?,1,?,'{}','["image/png"]','{}',2,?)`)
    .run(JSON.stringify(schema), JSON.stringify(bindings), '["5"]', JSON.stringify(graph), now, JSON.stringify(editor));
  database.connection.prepare(`INSERT INTO app_generation_assignments(app_id,purpose,workflow_id,workflow_version,engine_id,updated_at)
    VALUES ('activities','activity_image_text','visual-flow',1,'visual-engine',?)`).run(now);
  const profile = (name: string, steps: number, model: string): GenerationPresetRef => {
    const preset = createPreset(database, { appId: 'activities', purpose: 'activity_image_text', name, workflowId: 'visual-flow',
      workflowVersion: 1, engineId: 'visual-engine', values: { latent_w: 768, latent_h: 768, steps, model } });
    return { purpose: preset.purpose, presetId: preset.id, presetRevision: preset.revision,
      workflowId: preset.workflowId, workflowVersion: preset.workflowVersion };
  };
  return { draft: profile('草图', 12, 'turbo.safetensors'), final: profile('成稿', 24, 'base.safetensors') };
}
