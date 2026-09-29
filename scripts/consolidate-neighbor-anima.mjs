import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

// One-time, deliberately guarded configuration cleanup. Run only after
// db:check + db:backup, with the service stopped; old rows remain for history.
const databasePath = resolve('data/sthstart.db');
const apply = process.argv.includes('--apply');
const database = new DatabaseSync(databasePath, { readOnly: !apply });
const workflowId = 'anima-activity-1080p-eval';
const previousVersion = 3;
const nextVersion = 4;
const oldWorkflowIds = ['activity-beat-sd15-simple', 'anima-activity'];
const now = new Date().toISOString();

function requireRow(sql, ...params) {
  const row = database.prepare(sql).get(...params);
  if (!row) throw new Error(`Expected database row missing: ${sql}`);
  return row;
}

const workflow = requireRow('SELECT * FROM generation_workflows WHERE id = ?', workflowId);
if (workflow.latest_version !== previousVersion || workflow.archived_at) {
  throw new Error('Canonical Anima workflow has changed; inspect it before running this cleanup.');
}
const source = requireRow('SELECT * FROM generation_workflow_versions WHERE workflow_id = ? AND version = ?', workflowId, previousVersion);
const assignment = requireRow('SELECT * FROM app_generation_assignments WHERE app_id = ? AND purpose = ?', 'activities', 'activity_image_text');
if (!['activity-beat-sd15-simple', workflowId, 'anima-activity'].includes(assignment.workflow_id)) {
  throw new Error('Activity image assignment has changed; inspect it before running this cleanup.');
}
for (const id of oldWorkflowIds) requireRow('SELECT id FROM generation_workflows WHERE id = ?', id);
const originalPresets = database.prepare('SELECT * FROM generation_presets WHERE workflow_id = ? AND workflow_version = ?').all(workflowId, previousVersion);
const base = originalPresets.find((row) => JSON.parse(row.values_json).unet_name === 'anima_baseV10.safetensors');
const turbo = originalPresets.find((row) => JSON.parse(row.values_json).unet_name === 'anima_turboV10.safetensors');
if (!base || !turbo) throw new Error('Expected Base and Turbo presets are missing.');

const definition = JSON.parse(source.definition_json);
// Match the neighbor graph's actual encoding order: artist -> quality ->
// optimized description. Keep SaveImage and the existing LoRA insertion point.
definition['5'].inputs = {
  string_a: ',masterpiece, best quality, score_9, score_8，highres, absurdres,anime screenshot,year 2025,',
  string_b: ['117', 0],
  delimiter: '',
};
definition['4'].inputs = { string_a: '@ebora', string_b: ['5', 0], delimiter: '' };
definition['6'].inputs.text = ['4', 0];
const editorConfig = JSON.parse(source.editor_config_json);
const draftRow = requireRow('SELECT * FROM generation_workflow_drafts WHERE workflow_id = ?', workflowId);
const workflowDraft = JSON.parse(draftRow.draft_json);
workflowDraft.definition = definition;
workflowDraft.name = '邻舍 Anima 制图';
workflowDraft.description = '沿用邻舍的 Anima Base 模型链、画师词与质量词；保留项目的图片保存和 LoRA 接口。';

console.log(JSON.stringify({
  databasePath,
  action: apply ? 'apply' : 'preview',
  keep: `${workflowId} v${nextVersion}`,
  archive: oldWorkflowIds,
  newPresets: ['Anima Base · 邻舍原版', 'Anima Turbo · 快速实验'],
  default: 'Anima Base · 邻舍原版',
  existingDraftsToRetarget: ['activity_drafts', 'activity_comic_drafts'],
}, null, 2));
if (!apply) {
  database.close();
  process.exit(0);
}

database.exec('BEGIN IMMEDIATE');
try {
  database.prepare(`INSERT INTO generation_workflow_versions
    (workflow_id, version, engine_id, input_schema_json, node_bindings_json, output_declarations_json,
     definition_json, input_capabilities_json, output_media_types_json, output_schema_json,
     config_format_version, editor_config_json, is_published, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .run(workflowId, nextVersion, source.engine_id, source.input_schema_json, source.node_bindings_json,
      source.output_declarations_json, JSON.stringify(definition), source.input_capabilities_json,
      source.output_media_types_json, source.output_schema_json, source.config_format_version,
      JSON.stringify(editorConfig), now);
  database.prepare(`INSERT INTO generation_workflow_media_versions
    (workflow_id, version, category, input_capabilities_json, output_media_types_json, output_schema_json, updated_at)
    VALUES (?, ?, 'image', ?, ?, ?, ?)`)
    .run(workflowId, nextVersion, source.input_capabilities_json, source.output_media_types_json,
      source.output_schema_json, now);
  database.prepare('UPDATE generation_workflows SET name=?, description=?, latest_version=?, updated_at=? WHERE id=?')
    .run(workflowDraft.name, workflowDraft.description, nextVersion, now, workflowId);
  database.prepare('UPDATE generation_workflow_drafts SET base_version=?, revision=revision+1, draft_json=?, updated_at=? WHERE workflow_id=?')
    .run(nextVersion, JSON.stringify(workflowDraft), now, workflowId);

  // A fresh policy must not inherit the former one-off Albedo/Sucrose test
  // instructions or repeat quality tags already encoded in the graph.
  database.prepare(`INSERT INTO activity_image_prompt_policy_versions
    (workflow_id, workflow_version, revision, enabled, instructions, positive_suffix, negative_prompt, created_at)
    VALUES (?, ?, 1, 1, ?, '', ?, ?)`)
    .run(workflowId, nextVersion,
      'Rewrite the supplied scene description as one coherent English image prompt. Preserve the named characters, appearance, clothing, visible action, setting, composition and any requested text-safe area. Describe only details supported by the source. Do not include quality tags, artist tags, dialogue lettering, UI, logos, watermarks or borders. Return only the prompt.',
      JSON.parse(source.input_schema_json).negativePrompt.default, now);

  const presetIds = {};
  for (const [mode, original] of [['base', base], ['turbo', turbo]]) {
    const id = randomUUID();
    const values = JSON.parse(original.values_json);
    values.width = 768;
    values.height = 512;
    presetIds[mode] = id;
    database.prepare(`INSERT INTO generation_presets
      (id, name, description, app_id, purpose, workflow_id, workflow_version,
       engine_id, values_json, enabled, revision, created_at, updated_at)
      VALUES (?, ?, ?, 'activities', 'activity_image_text', ?, ?, ?, ?, 1, 1, ?, ?)`)
      .run(id, mode === 'base' ? 'Anima Base · 邻舍原版' : 'Anima Turbo · 快速实验',
        mode === 'base' ? '与邻舍默认参数一致：768×512、31 步、CFG 5、er_sde/beta。' : '同一工作流，Turbo 模型 8 步、CFG 1；效果需自行确认。',
        workflowId, nextVersion, source.engine_id, JSON.stringify(values), now, now);
  }
  database.prepare('UPDATE generation_presets SET enabled=0, updated_at=? WHERE workflow_id IN (?, ?) OR (workflow_id=? AND workflow_version=?)')
    .run(now, 'anima-activity', 'activity-beat-sd15-simple', workflowId, previousVersion);
  database.prepare(`UPDATE app_generation_assignments SET workflow_id=?, workflow_version=?, engine_id=?,
    default_preset_id=?, updated_at=? WHERE app_id='activities' AND purpose='activity_image_text'`)
    .run(workflowId, nextVersion, source.engine_id, presetIds.base, now);

  let retargeted = 0;
  const oldPresetMode = new Map(database.prepare('SELECT id,values_json FROM generation_presets WHERE workflow_id IN (?, ?) OR workflow_id=?')
    .all(...oldWorkflowIds, workflowId)
    .map((row) => [row.id, JSON.parse(row.values_json).unet_name === 'anima_turboV10.safetensors' ? 'turbo' : 'base']));
  for (const table of ['activity_drafts', 'activity_comic_drafts']) {
    for (const row of database.prepare(`SELECT activity_id,draft_version,document_json FROM ${table}`).all()) {
      const document = JSON.parse(row.document_json);
      let changed = false;
      const visit = (value) => {
        if (!value || typeof value !== 'object') return;
        if (value.renderSettings && typeof value.renderSettings === 'object') {
          const settings = value.renderSettings;
          if ([...oldWorkflowIds, workflowId].includes(settings.workflowId)) {
            const mode = oldPresetMode.get(settings.presetId)
              ?? (settings.parameterOverrides?.unet_name === 'anima_turboV10.safetensors' ? 'turbo' : 'base');
            settings.workflowId = workflowId;
            settings.workflowVersion = nextVersion;
            settings.presetId = presetIds[mode];
            settings.presetRevision = 1;
            changed = true;
          }
        }
        for (const child of Object.values(value)) visit(child);
      };
      visit(document);
      if (changed) {
        const updated = database.prepare(`UPDATE ${table} SET document_json=?, draft_version=draft_version+1,
          updated_at=? WHERE activity_id=? AND draft_version=?`)
          .run(JSON.stringify(document), now, row.activity_id, row.draft_version);
        if (updated.changes !== 1) throw new Error(`Draft conflict: ${table}/${row.activity_id}`);
        retargeted++;
      }
    }
  }
  database.prepare('UPDATE generation_workflows SET archived_at=?, updated_at=? WHERE id IN (?, ?)')
    .run(now, now, ...oldWorkflowIds);
  const violations = database.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) throw new Error(`Foreign key violations: ${JSON.stringify(violations)}`);
  database.exec('COMMIT');
  console.log(JSON.stringify({ presetIds, retargetedDrafts: retargeted, integrity: database.prepare('PRAGMA integrity_check').get() }, null, 2));
} catch (error) {
  database.exec('ROLLBACK');
  throw error;
} finally {
  database.close();
}
