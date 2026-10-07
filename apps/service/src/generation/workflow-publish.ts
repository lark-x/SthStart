import type { GenerationEditorConfig } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import { validateEditorConfig, type InputSchemaMap } from './configuration.js';
import { validateActivityLoraInjection, validateCloudRecipeStructure, validateWorkflowVersionStructure } from './workflows.js';
import { applyWorkflowPresetTemplates, markDraftSynced } from './configuration-store.js';
import { promptInputKey } from '../activities/image-render-common.js';
import { checkDirectTextEncoderBindings } from '../activities/image-prompt-snapshot.js';

/**
 * 工作流版本的发布路径。
 *
 * 管理 HTTP 路由与配置注册脚本共用这一份校验与写入，避免脚本绕过发布机制，
 * 也避免两处校验逐渐漂移。这里不注册路由、不读请求对象。
 */

export type WorkflowEngineKind = 'comfyui' | 'worker' | 'cloud';
export type WorkflowCategory = 'image' | 'video' | 'audio' | 'transform';

export function codedError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function jsonObject(value: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  return value as Record<string, unknown>;
}

export function jsonStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
}

export function normalizeOutputMediaTypes(value: unknown, category: WorkflowCategory): string[] {
  const fallback = category === 'video' ? ['video/mp4'] : category === 'audio' ? ['audio/wav'] : ['image/png'];
  const mediaTypes = jsonStringArray(value, fallback);
  if (!mediaTypes.length || mediaTypes.some((item) => !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(item))) {
    throw codedError('invalid_output_media_types', 'outputMediaTypes 必须是非空 MIME 类型数组。');
  }
  return mediaTypes;
}

export interface ValidatedWorkflowStructure {
  validatedDefinition: Record<string, unknown>;
  validatedInputSchema: Record<string, unknown>;
  validatedNodeBindings: Record<string, unknown>;
  validatedOutputDeclarations: string[];
}

export function validateWorkflowPayload(input: {
  engineKind: WorkflowEngineKind;
  definition: unknown;
  inputSchema: unknown;
  nodeBindings: unknown;
  outputDeclarations: unknown;
}): ValidatedWorkflowStructure {
  if (input.engineKind === 'cloud') {
    return validateCloudRecipeStructure(
      input.definition,
      input.inputSchema,
      input.nodeBindings,
      Array.isArray(input.outputDeclarations) && input.outputDeclarations.length > 0 ? input.outputDeclarations : ['image'],
    );
  }
  return validateWorkflowVersionStructure(input.definition, input.inputSchema, input.nodeBindings, input.outputDeclarations);
}

export interface ValidatedEditorConfig {
  editorConfig: GenerationEditorConfig;
  editorConfigJson: string;
  configFormatVersion: number;
}

/**
 * V2 编辑器配置校验。声明服务端组装方式的版本必须把正／负提示词直接绑定到文本编码器，
 * 否则阻止发布并指出具体节点与字段。
 */
export function validateEditorConfigForPublish(
  validated: ValidatedWorkflowStructure,
  editorConfig: unknown,
  engineKind: WorkflowEngineKind,
): ValidatedEditorConfig {
  const parsed = validateEditorConfig(editorConfig);
  if (engineKind !== 'cloud') validateActivityLoraInjection(validated.validatedDefinition, parsed);
  if (parsed.promptAssembly === 'service-finalized-v1' && engineKind !== 'cloud') {
    const schema = validated.validatedInputSchema as InputSchemaMap;
    const check = checkDirectTextEncoderBindings(
      validated.validatedDefinition,
      validated.validatedNodeBindings as Record<string, string[]>,
      { positiveKey: promptInputKey(schema), negativeKey: promptInputKey(schema, true) },
    );
    if (!check.ok) {
      throw codedError('prompt_assembly_binding_invalid',
        `服务端组装方式要求提示词直接绑定文本编码器：${check.issues.join(' ')}`);
    }
  }
  return { editorConfig: parsed, editorConfigJson: JSON.stringify(parsed), configFormatVersion: 2 };
}

export interface PublishWorkflowVersionInput {
  workflowId: string;
  engineId: string | null;
  definition: unknown;
  inputSchema: unknown;
  nodeBindings: unknown;
  outputDeclarations: unknown;
  inputCapabilities?: unknown;
  outputMediaTypes?: unknown;
  outputSchema?: unknown;
  editorConfig?: unknown;
  category?: WorkflowCategory;
  /** 发布后把尚未应用的导入预设模板绑定到该版本。 */
  applyPresetTemplates?: boolean;
}

export interface PublishWorkflowVersionResult {
  workflowId: string;
  version: number;
  configFormatVersion: number;
  createdPresetCount: number;
}

function workflowRow(database: ServiceDatabase, workflowId: string) {
  return database.connection.prepare('SELECT id, latest_version, engine_kind, category FROM generation_workflows WHERE id = ?')
    .get(workflowId) as { id: string; latest_version: number; engine_kind: string; category: string } | undefined;
}

function requireEngine(database: ServiceDatabase, engineId: string | null, engineKind: string) {
  if (!engineId) return;
  const engine = database.connection.prepare('SELECT id, kind FROM generation_engines WHERE id = ?')
    .get(engineId) as { id: string; kind: string } | undefined;
  if (!engine) throw codedError('engine_not_found', `指定的生成引擎 ${engineId} 不存在。`);
  if (engine.kind !== engineKind) {
    throw codedError('engine_kind_mismatch', `生成引擎类型 (${engine.kind}) 与工作流类型 (${engineKind}) 不匹配。`);
  }
}

/** 发布一个新版本；不修改任何已发布版本行。 */
export function publishWorkflowVersion(
  database: ServiceDatabase,
  input: PublishWorkflowVersionInput,
): PublishWorkflowVersionResult {
  const workflow = workflowRow(database, input.workflowId);
  if (!workflow) throw codedError('workflow_not_found', `未找到工作流 ${input.workflowId}。`);
  const engineKind = workflow.engine_kind as WorkflowEngineKind;
  const category = (input.category ?? (workflow.category as WorkflowCategory | undefined) ?? 'image') as WorkflowCategory;
  requireEngine(database, input.engineId, engineKind);

  const validated = validateWorkflowPayload({
    engineKind, definition: input.definition, inputSchema: input.inputSchema ?? {},
    nodeBindings: input.nodeBindings ?? {}, outputDeclarations: input.outputDeclarations ?? [],
  });
  const editor = input.editorConfig === undefined || input.editorConfig === null
    ? null : validateEditorConfigForPublish(validated, input.editorConfig, engineKind);
  const inputCapabilities = jsonObject(input.inputCapabilities);
  const outputMediaTypes = normalizeOutputMediaTypes(input.outputMediaTypes, category);
  const outputSchema = jsonObject(input.outputSchema);

  const version = Number(workflow.latest_version) + 1;
  const now = nowIso();
  database.transaction(() => {
    database.connection.prepare(`
      INSERT INTO generation_workflow_versions (
        workflow_id, version, engine_id, input_schema_json, node_bindings_json,
        output_declarations_json, definition_json, input_capabilities_json,
        output_media_types_json, output_schema_json, config_format_version, editor_config_json,
        is_published, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      input.workflowId, version, input.engineId,
      JSON.stringify(validated.validatedInputSchema),
      JSON.stringify(validated.validatedNodeBindings),
      JSON.stringify(validated.validatedOutputDeclarations),
      JSON.stringify(validated.validatedDefinition),
      JSON.stringify(inputCapabilities),
      JSON.stringify(outputMediaTypes),
      JSON.stringify(outputSchema),
      editor?.configFormatVersion ?? 1,
      editor?.editorConfigJson ?? null,
      now,
    );
    database.connection.prepare(`
      INSERT INTO generation_workflow_media_versions
        (workflow_id, version, category, input_capabilities_json, output_media_types_json, output_schema_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workflow_id, version) DO UPDATE SET category=excluded.category,
        input_capabilities_json=excluded.input_capabilities_json,
        output_media_types_json=excluded.output_media_types_json,
        output_schema_json=excluded.output_schema_json,
        updated_at=excluded.updated_at
    `).run(input.workflowId, version, category, JSON.stringify(inputCapabilities), JSON.stringify(outputMediaTypes), JSON.stringify(outputSchema), now);
    database.connection.prepare('UPDATE generation_workflows SET latest_version = ?, updated_at = ? WHERE id = ?')
      .run(version, now, input.workflowId);
    markDraftSynced(database, input.workflowId, version);
    if (input.applyPresetTemplates !== false && input.engineId) {
      applyWorkflowPresetTemplates(database, input.workflowId, version, input.engineId);
    }
  });
  const applied = database.connection.prepare(`SELECT COUNT(*) AS count FROM generation_workflow_preset_templates
    WHERE workflow_id=? AND applied_workflow_version=?`).get(input.workflowId, version) as { count: number };
  return {
    workflowId: input.workflowId, version,
    configFormatVersion: editor?.configFormatVersion ?? 1,
    createdPresetCount: Number(applied.count),
  };
}

export interface ImportWorkflowInput extends Omit<PublishWorkflowVersionInput, 'workflowId' | 'category'> {
  id: string;
  name: string;
  description?: string;
  engineKind: WorkflowEngineKind;
  category?: WorkflowCategory;
}

export interface ImportWorkflowResult {
  id: string;
  workflowId: string;
  version: number;
  category: WorkflowCategory;
  engineKind: WorkflowEngineKind;
}

/** 导入（或追加版本）一个工作流。重复导入同一 id 会创建新版本，不改写旧版本。 */
export function importWorkflow(database: ServiceDatabase, input: ImportWorkflowInput): ImportWorkflowResult {
  const id = input.id?.trim() ?? '';
  if (!id || !/^[a-z][a-z0-9-]{1,62}$/.test(id)) {
    throw codedError('invalid_workflow_id', '工作流 ID 必须由小写字母开头，由小写字母、数字和连字符组成（2-63 字符）。');
  }
  const name = input.name?.trim() ?? '';
  if (!name) throw codedError('workflow_name_required', '工作流名称必须为非空字符串。');
  const engineKind = input.engineKind ?? 'comfyui';
  if (!['comfyui', 'worker', 'cloud'].includes(engineKind)) {
    throw codedError('invalid_engine_kind', '引擎类型必须为 comfyui、worker 或 cloud。');
  }
  const category = (input.category ?? 'image') as WorkflowCategory;
  if (!['image', 'video', 'audio', 'transform'].includes(category)) {
    throw codedError('invalid_category', '媒体类别必须为 image、video、audio 或 transform。');
  }
  const description = input.description?.trim() ?? '';
  const engineId = input.engineId?.trim() || null;
  requireEngine(database, engineId, engineKind);

  const validated = validateWorkflowPayload({
    engineKind, definition: input.definition, inputSchema: input.inputSchema ?? {},
    nodeBindings: input.nodeBindings ?? {}, outputDeclarations: input.outputDeclarations ?? [],
  });
  const editor = input.editorConfig === undefined || input.editorConfig === null
    ? null : validateEditorConfigForPublish(validated, input.editorConfig, engineKind);
  const inputCapabilities = jsonObject(input.inputCapabilities);
  const outputMediaTypes = normalizeOutputMediaTypes(input.outputMediaTypes, category);
  const outputSchema = jsonObject(input.outputSchema);

  const existing = workflowRow(database, id);
  const version = Number(existing?.latest_version ?? 0) + 1;
  const now = nowIso();
  database.transaction(() => {
    database.connection.prepare(`
      INSERT INTO generation_workflows (id, name, description, engine_kind, category, latest_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,
        engine_kind=excluded.engine_kind, category=excluded.category,
        latest_version=excluded.latest_version, updated_at=excluded.updated_at
    `).run(id, name, description, engineKind, category, version, now, now);
    database.connection.prepare(`
      INSERT INTO generation_workflow_versions (
        workflow_id, version, engine_id, input_schema_json, node_bindings_json,
        output_declarations_json, definition_json, input_capabilities_json,
        output_media_types_json, output_schema_json, config_format_version, editor_config_json,
        is_published, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      id, version, engineId,
      JSON.stringify(validated.validatedInputSchema),
      JSON.stringify(validated.validatedNodeBindings),
      JSON.stringify(validated.validatedOutputDeclarations),
      JSON.stringify(validated.validatedDefinition),
      JSON.stringify(inputCapabilities),
      JSON.stringify(outputMediaTypes),
      JSON.stringify(outputSchema),
      editor?.configFormatVersion ?? 1,
      editor?.editorConfigJson ?? null,
      now,
    );
    database.connection.prepare(`
      INSERT INTO generation_workflow_media_versions
        (workflow_id, version, category, input_capabilities_json, output_media_types_json, output_schema_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workflow_id, version) DO UPDATE SET category=excluded.category,
        input_capabilities_json=excluded.input_capabilities_json,
        output_media_types_json=excluded.output_media_types_json,
        output_schema_json=excluded.output_schema_json,
        updated_at=excluded.updated_at
    `).run(id, version, category, JSON.stringify(inputCapabilities), JSON.stringify(outputMediaTypes), JSON.stringify(outputSchema), now);
  });
  return { id, workflowId: id, version, category, engineKind };
}
