import { randomUUID } from 'node:crypto';
import type { GenerationDraftPayload, GenerationPreset } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import {
  parseEditorConfig,
  parseInputSchema,
  validateEditorConfig,
  validateValuesAgainstSchema,
  type InputSchemaMap,
} from './configuration.js';

/**
 * 草稿与预设的持久化（规划 §11.2 / §11.3）。
 * 草稿是编辑状态而非第二份权威配置；执行永远读取不可变版本。
 * 预设只存覆盖值；引用确切工作流版本，不自动追随 latest。
 */

export interface WorkflowDraftRow {
  workflowId: string;
  baseVersion: number;
  revision: number;
  draft: GenerationDraftPayload;
  updatedAt: string;
}

function codedError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseDraftPayload(value: unknown): GenerationDraftPayload | null {
  if (!isRecord(value)) return null;
  const formatVersion = Number(value.formatVersion);
  if (formatVersion !== 1 && formatVersion !== 2) return null;
  if (!isRecord(value.definition) || !isRecord(value.inputSchema) || !isRecord(value.nodeBindings)) return null;
  if (!Array.isArray(value.outputDeclarations)) return null;
  return value as unknown as GenerationDraftPayload;
}

export function getWorkflowDraft(database: ServiceDatabase, workflowId: string): WorkflowDraftRow | null {
  const row = database.connection.prepare(
    'SELECT * FROM generation_workflow_drafts WHERE workflow_id = ?',
  ).get(workflowId) as { workflow_id: string; base_version: number; revision: number; draft_json: string; updated_at: string } | undefined;
  if (!row) return null;
  const draft = parseDraftPayload(JSON.parse(row.draft_json) as unknown);
  if (!draft) return null;
  return {
    workflowId: row.workflow_id,
    baseVersion: Number(row.base_version),
    revision: Number(row.revision),
    draft,
    updatedAt: row.updated_at,
  };
}

export interface SaveDraftResult {
  draft: WorkflowDraftRow;
  conflict: boolean;
}

/**
 * 带 revision 乐观锁的草稿保存。revision 不匹配时返回服务端当前草稿（conflict=true），
 * 由界面呈现冲突，绝不静默覆盖。
 */
export function saveWorkflowDraft(
  database: ServiceDatabase,
  workflowId: string,
  input: { revision: number; draft: unknown },
): SaveDraftResult {
  const workflow = database.connection.prepare('SELECT id, latest_version FROM generation_workflows WHERE id = ?')
    .get(workflowId) as { id: string; latest_version: number } | undefined;
  if (!workflow) throw codedError('workflow_not_found', `未找到工作流 ${workflowId}。`);
  const draft = parseDraftPayload(input.draft);
  if (!draft) throw codedError('invalid_draft', '草稿内容无效：需要包含 definition、inputSchema、nodeBindings 与 outputDeclarations。');
  if (draft.editorConfig !== null && draft.editorConfig !== undefined) validateEditorConfig(draft.editorConfig);

  const current = database.connection.prepare(
    'SELECT revision, base_version FROM generation_workflow_drafts WHERE workflow_id = ?',
  ).get(workflowId) as { revision: number; base_version: number } | undefined;
  if (current && input.revision !== Number(current.revision)) {
    return { conflict: true, draft: getWorkflowDraft(database, workflowId)! };
  }

  const now = nowIso();
  const nextRevision = (current?.revision ?? 0) + 1;
  database.connection.prepare(`
    INSERT INTO generation_workflow_drafts (workflow_id, base_version, revision, draft_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(workflow_id) DO UPDATE SET base_version = excluded.base_version,
      revision = excluded.revision, draft_json = excluded.draft_json, updated_at = excluded.updated_at
  `).run(workflowId, Number(current?.base_version ?? workflow.latest_version), nextRevision, JSON.stringify(draft), now);
  return { conflict: false, draft: getWorkflowDraft(database, workflowId)! };
}

/** 保存工作流版本成功后调用：把草稿标记为已同步到该版本。 */
export function markDraftSynced(database: ServiceDatabase, workflowId: string, baseVersion: number): void {
  database.connection.prepare(
    'UPDATE generation_workflow_drafts SET base_version = ?, updated_at = ? WHERE workflow_id = ?',
  ).run(baseVersion, nowIso(), workflowId);
}

export function deleteWorkflowDraft(database: ServiceDatabase, workflowId: string): void {
  database.connection.prepare('DELETE FROM generation_workflow_drafts WHERE workflow_id = ?').run(workflowId);
}

// ── 预设 ──

interface PresetRow {
  id: string; name: string; description: string; app_id: string; purpose: string;
  workflow_id: string; workflow_version: number; engine_id: string | null;
  values_json: string; enabled: number; revision: number; created_at: string; updated_at: string;
}

function presetFromRow(database: ServiceDatabase, row: PresetRow): GenerationPreset {
  let values: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.values_json);
    if (isRecord(parsed)) values = parsed;
  } catch { /* keep empty */ }
  const defaultRow = database.connection.prepare(
    'SELECT app_id, purpose FROM app_generation_assignments WHERE default_preset_id = ?',
  ).get(row.id) as { app_id: string; purpose: string } | undefined;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    appId: row.app_id,
    purpose: row.purpose,
    workflowId: row.workflow_id,
    workflowVersion: Number(row.workflow_version),
    engineId: row.engine_id,
    values,
    enabled: Boolean(row.enabled),
    revision: Number(row.revision),
    isDefault: Boolean(defaultRow && defaultRow.app_id === row.app_id && defaultRow.purpose === row.purpose),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listPresets(
  database: ServiceDatabase,
  filter?: { appId?: string; purpose?: string; workflowId?: string },
): GenerationPreset[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filter?.appId) { clauses.push('app_id = ?'); params.push(filter.appId); }
  if (filter?.purpose) { clauses.push('purpose = ?'); params.push(filter.purpose); }
  if (filter?.workflowId) { clauses.push('workflow_id = ?'); params.push(filter.workflowId); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = database.connection.prepare(
    `SELECT * FROM generation_presets ${where} ORDER BY app_id, purpose, name`,
  ).all(...params) as unknown as PresetRow[];
  return rows.map((row) => presetFromRow(database, row));
}

export function getPreset(database: ServiceDatabase, presetId: string): GenerationPreset | null {
  const row = database.connection.prepare('SELECT * FROM generation_presets WHERE id = ?')
    .get(presetId) as unknown as PresetRow | undefined;
  return row ? presetFromRow(database, row) : null;
}

function requirePublishedVersion(database: ServiceDatabase, workflowId: string, workflowVersion: number) {
  const version = database.connection.prepare(
    'SELECT engine_id, config_format_version, input_schema_json, editor_config_json FROM generation_workflow_versions WHERE workflow_id = ? AND version = ? AND is_published = 1',
  ).get(workflowId, workflowVersion) as { engine_id: string | null; config_format_version: number; input_schema_json: string; editor_config_json: string | null } | undefined;
  if (!version) throw codedError('workflow_version_not_found', `未找到工作流 ${workflowId} 的已发布版本 v${workflowVersion}。`);
  return version;
}

export interface CreatePresetInput {
  appId: string;
  purpose: string;
  name: string;
  description?: string;
  workflowId: string;
  workflowVersion?: number;
  engineId?: string | null;
  values?: Record<string, unknown>;
  enabled?: boolean;
}

export function createPreset(database: ServiceDatabase, input: CreatePresetInput): GenerationPreset {
  const name = input.name?.trim();
  if (!name || name.length > 120) throw codedError('invalid_preset', '预设名称必须为 1–120 个字符。');
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(input.appId)) throw codedError('invalid_preset', '预设所属应用 ID 无效。');
  if (!database.connection.prepare('SELECT 1 FROM managed_apps WHERE id = ?').get(input.appId)) {
    throw codedError('app_not_found', `目标应用 ${input.appId} 不存在。`);
  }
  const purpose = input.purpose?.trim();
  if (!purpose || purpose.length > 80) throw codedError('invalid_preset', '预设用途必须为非空字符串。');

  const workflow = database.connection.prepare('SELECT id, engine_kind FROM generation_workflows WHERE id = ? AND archived_at IS NULL')
    .get(input.workflowId) as { id: string; engine_kind: string } | undefined;
  if (!workflow) throw codedError('workflow_not_found', `未找到工作流 ${input.workflowId}。`);

  let workflowVersion = input.workflowVersion;
  if (workflowVersion == null) {
    const latest = database.connection.prepare('SELECT latest_version FROM generation_workflows WHERE id = ?')
      .get(input.workflowId) as { latest_version: number } | undefined;
    workflowVersion = Number(latest?.latest_version ?? 0);
  }
  if (!Number.isInteger(workflowVersion) || workflowVersion < 1) throw codedError('invalid_preset', '预设必须引用明确的工作流版本。');
  const version = requirePublishedVersion(database, input.workflowId, workflowVersion);

  let engineId = input.engineId?.trim() || version.engine_id;
  if (!engineId) {
    const fallback = database.connection.prepare('SELECT id FROM generation_engines WHERE enabled = 1 ORDER BY created_at ASC LIMIT 1')
      .get() as { id: string } | undefined;
    engineId = fallback?.id ?? null;
  }
  if (engineId) {
    const engine = database.connection.prepare('SELECT id, kind, enabled FROM generation_engines WHERE id = ?')
      .get(engineId) as { id: string; kind: string; enabled: number } | undefined;
    if (!engine || !engine.enabled) throw codedError('generation_engine_unavailable', `生成连接 ${engineId} 不存在或已禁用。`);
    if (engine.kind !== workflow.engine_kind) {
      throw codedError('engine_kind_mismatch', `连接类型 (${engine.kind}) 与工作流类型 (${workflow.engine_kind}) 不匹配。`);
    }
  }

  const inputSchema: InputSchemaMap = parseInputSchema(version.input_schema_json);
  const editorConfig = parseEditorConfig(version.editor_config_json);
  const configFormatVersion = Number(version.config_format_version ?? 1);
  const values = validateValuesAgainstSchema(
    inputSchema,
    editorConfig,
    input.values ?? {},
    { mode: configFormatVersion >= 2 ? 'strict' : 'lenient', context: 'preset' },
  );

  const id = randomUUID();
  const now = nowIso();
  database.connection.prepare(`
    INSERT INTO generation_presets (id, name, description, app_id, purpose, workflow_id, workflow_version, engine_id, values_json, enabled, revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, name, input.description?.trim() ?? '', input.appId, purpose, input.workflowId, workflowVersion, engineId, JSON.stringify(values), input.enabled === false ? 0 : 1, now, now);
  return getPreset(database, id)!;
}

export interface UpdatePresetInput {
  name?: string;
  description?: string;
  values?: Record<string, unknown>;
  enabled?: boolean;
  workflowId?: string;
  workflowVersion?: number;
  engineId?: string | null;
  revision: number;
  /** 禁用或改引用的默认预设要求显式取消默认（规划 §11.3）。 */
  clearDefault?: boolean;
}

export function updatePreset(database: ServiceDatabase, presetId: string, input: UpdatePresetInput): GenerationPreset {
  const existing = database.connection.prepare('SELECT * FROM generation_presets WHERE id = ?')
    .get(presetId) as unknown as PresetRow | undefined;
  if (!existing) throw codedError('preset_not_found', '未找到指定预设。');
  if (!Number.isInteger(input.revision) || input.revision !== Number(existing.revision)) {
    throw codedError('preset_revision_conflict', '预设已被其他人修改，请刷新后重试。');
  }
  const wasDefault = Boolean(database.connection.prepare(
    'SELECT 1 FROM app_generation_assignments WHERE default_preset_id = ?',
  ).get(presetId));

  let workflowId = existing.workflow_id;
  let workflowVersion = Number(existing.workflow_version);
  let engineId = existing.engine_id;
  const refChange = input.workflowId !== undefined || input.workflowVersion !== undefined || input.engineId !== undefined;
  if (refChange) {
    if (wasDefault && !input.clearDefault) {
      throw codedError('preset_is_default', '该预设是默认预设；修改工作流/连接引用会改变默认执行，请先显式确认（clearDefault）或更换默认预设。');
    }
    if (input.workflowId !== undefined) {
      workflowId = input.workflowId;
      const workflow = database.connection.prepare('SELECT id FROM generation_workflows WHERE id = ? AND archived_at IS NULL')
        .get(workflowId);
      if (!workflow) throw codedError('workflow_not_found', `未找到工作流 ${workflowId}。`);
    }
    if (input.workflowId !== undefined || input.workflowVersion !== undefined) {
      const latest = database.connection.prepare('SELECT latest_version FROM generation_workflows WHERE id = ?')
        .get(workflowId) as { latest_version: number } | undefined;
      workflowVersion = input.workflowVersion ?? Number(latest?.latest_version ?? 0);
    }
    engineId = input.engineId !== undefined ? input.engineId : engineId;
    const version = requirePublishedVersion(database, workflowId, workflowVersion);
    if (!engineId) engineId = version.engine_id;
    if (engineId) {
      const engine = database.connection.prepare('SELECT id, enabled, kind FROM generation_engines WHERE id = ?')
        .get(engineId) as { id: string; enabled: number; kind: string } | undefined;
      if (!engine || !engine.enabled) throw codedError('generation_engine_unavailable', `生成连接 ${engineId} 不存在或已禁用。`);
      const workflow = database.connection.prepare('SELECT engine_kind FROM generation_workflows WHERE id = ?')
        .get(workflowId) as { engine_kind: string };
      if (engine.kind !== workflow.engine_kind) throw codedError('generation_engine_kind_mismatch', '连接类型与工作流类型不匹配。');
    }
  }

  if (input.enabled === false && wasDefault && !input.clearDefault) {
    throw codedError('preset_is_default', '该预设是默认预设；请先显式取消默认（clearDefault）再禁用。');
  }

  // 注意：校验与写入放在同一事务里执行需要把校验提前；SQLite 单连接下先校验后写即可。
  const version = requirePublishedVersion(database, workflowId, workflowVersion);
  const inputSchema = parseInputSchema(version.input_schema_json);
  const editorConfig = parseEditorConfig(version.editor_config_json);
  const configFormatVersion = Number(version.config_format_version ?? 1);
  const values = validateValuesAgainstSchema(inputSchema, editorConfig,
    input.values ?? JSON.parse(existing.values_json),
    { mode: configFormatVersion >= 2 ? 'strict' : 'lenient', context: 'preset' });

  const now = nowIso();
  database.transaction(() => {
    database.connection.prepare(`
      UPDATE generation_presets SET name = ?, description = ?, workflow_id = ?, workflow_version = ?, engine_id = ?,
        values_json = ?, enabled = ?, revision = revision + 1, updated_at = ?
      WHERE id = ?
    `).run(
      input.name?.trim() || existing.name,
      input.description !== undefined ? input.description.trim() : existing.description,
      workflowId,
      workflowVersion,
      engineId,
      values !== undefined ? JSON.stringify(values) : existing.values_json,
      input.enabled !== undefined ? (input.enabled ? 1 : 0) : Number(existing.enabled),
      now,
      presetId,
    );

    // 默认预设的工作流/连接引用被显式确认修改后，同一事务同步用途绑定（规划 §11.3），
    // 避免预设与绑定指向不同版本导致两种客户端执行出不同结果。
    if (wasDefault && refChange && input.enabled !== false) {
      const updated = getPreset(database, presetId)!;
      syncDefaultPresetAssignment(database, updated);
    }
    if (input.clearDefault && wasDefault && input.enabled === false) clearDefaultPreset(database, existing.app_id, existing.purpose);
  });

  return getPreset(database, presetId)!;
}

export function deletePreset(database: ServiceDatabase, presetId: string): void {
  const existing = getPreset(database, presetId);
  if (!existing) throw codedError('preset_not_found', '未找到指定预设。');
  if (existing.isDefault) throw codedError('preset_is_default', '该预设是默认预设；请先更换默认预设或取消默认后再删除。');
  database.connection.prepare('DELETE FROM generation_presets WHERE id = ?').run(presetId);
}

/**
 * 「设为默认」：短事务里同步既有用途绑定与 default_preset_id（规划 §10.2），
 * 保证默认执行使用同一套工作流版本与连接，不会出现两种客户端各跑各的。
 */
function syncDefaultPresetAssignment(database: ServiceDatabase, preset: GenerationPreset): void {
  const version = requirePublishedVersion(database, preset.workflowId, preset.workflowVersion);
  if (!preset.engineId && !version.engine_id) throw codedError('generation_engine_unavailable', '预设引用的版本没有可用连接。');
  const now = nowIso();
  database.connection.prepare(`
    INSERT INTO app_generation_assignments (app_id, purpose, workflow_id, workflow_version, engine_id, default_preset_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(app_id, purpose) DO UPDATE SET workflow_id = excluded.workflow_id,
      workflow_version = excluded.workflow_version, engine_id = excluded.engine_id,
      default_preset_id = excluded.default_preset_id, updated_at = excluded.updated_at
  `).run(preset.appId, preset.purpose, preset.workflowId, preset.workflowVersion, preset.engineId ?? version.engine_id, preset.id, now);
}

export function setDefaultPreset(database: ServiceDatabase, presetId: string): GenerationPreset {
  const preset = getPreset(database, presetId);
  if (!preset) throw codedError('preset_not_found', '未找到指定预设。');
  if (!preset.enabled) throw codedError('preset_disabled', '禁用中的预设不能设为默认。');
  database.transaction(() => {
    syncDefaultPresetAssignment(database, preset);
  });
  return getPreset(database, presetId)!;
}

export function clearDefaultPreset(database: ServiceDatabase, appId: string, purpose: string): void {
  database.connection.prepare(
    'UPDATE app_generation_assignments SET default_preset_id = NULL, updated_at = ? WHERE app_id = ? AND purpose = ?',
  ).run(nowIso(), appId, purpose);
}

// ── 任务创建时的预设解析 ──

export interface ResolvedPreset {
  preset: GenerationPreset;
  values: Record<string, unknown>;
}

/**
 * 解析显式选择的预设：必须属于当前应用/用途、已启用、版本有效、连接有效（规划 §10.2）。
 * presetRevision 提供时必须匹配，否则返回过期冲突。
 */
export function resolveEnabledPreset(
  database: ServiceDatabase,
  appId: string,
  purpose: string,
  presetId: string,
  presetRevision?: number | null,
): ResolvedPreset {
  const preset = getPreset(database, presetId);
  if (!preset || preset.appId !== appId || preset.purpose !== purpose) {
    throw codedError('preset_not_available', '预设不存在，或不属于当前应用/用途。');
  }
  if (!preset.enabled) throw codedError('preset_not_available', '该预设已被禁用。');
  if (presetRevision != null && preset.revision !== presetRevision) {
    throw codedError('preset_revision_conflict', '所选预设已更新，请重新确认后再提交。');
  }
  requirePublishedVersion(database, preset.workflowId, preset.workflowVersion);
  const engineId = preset.engineId;
  if (engineId) {
    const engine = database.connection.prepare('SELECT id, enabled FROM generation_engines WHERE id = ?')
      .get(engineId) as { id: string; enabled: number } | undefined;
    if (!engine || !engine.enabled) throw codedError('generation_engine_unavailable', `预设引用的生成连接 ${engineId} 不可用。`);
  }
  return { preset, values: preset.values };
}

/** 未显式选择预设时的默认预设解析；旧配置（无默认预设）返回 null，行为不变。 */
export function resolveDefaultPreset(database: ServiceDatabase, appId: string, purpose: string): ResolvedPreset | null {
  const assignment = database.connection.prepare(
    'SELECT default_preset_id FROM app_generation_assignments WHERE app_id = ? AND purpose = ?',
  ).get(appId, purpose) as { default_preset_id: string | null } | undefined;
  const presetId = assignment?.default_preset_id;
  if (!presetId) return null;
  const preset = getPreset(database, presetId);
  if (!preset || !preset.enabled || preset.appId !== appId || preset.purpose !== purpose) return null;
  try {
    requirePublishedVersion(database, preset.workflowId, preset.workflowVersion);
  } catch {
    return null;
  }
  return { preset, values: preset.values };
}
