import type { ActivityArtStylePayload, GenerationEditorConfig } from '@sthstart/contracts';
import {
  DEFAULT_ACTIVITY_IMAGE_PROMPT_INSTRUCTIONS,
  DEFAULT_ACTIVITY_IMAGE_STRUCTURED_INSTRUCTIONS,
} from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import { parseEditorConfig, parseInputSchema } from '../generation/configuration.js';
import { createPreset, listPresets, updatePreset } from '../generation/configuration-store.js';
import { importWorkflow, publishWorkflowVersion } from '../generation/workflow-publish.js';
import { listActivityPresets } from './presets.js';
import { saveActivityArtStyle } from './art-styles.js';
import { resolveActivityImagePromptPolicy, saveActivityImagePromptPolicy } from './image-prompt-policies.js';
import {
  buildParityHiresWorkflow, buildParityTextWorkflow, LINSHE_PARITY_NEGATIVE_PROMPT, LINSHE_PARITY_STYLE_PROMPT,
  PARITY_BASE_PRESET, PARITY_HIRES_PURPOSE, PARITY_HIRES_WORKFLOW_ID, PARITY_TEXT_WORKFLOW_ID, PARITY_TURBO_PRESET, parityContentHash,
} from './parity-workflows.js';

/**
 * 邻舍对齐配置注册（计划 §10.3）。
 *
 * 只使用现有管理存储与发布校验：工作流走 importWorkflow / publishWorkflowVersion，
 * 预设走 createPreset / updatePreset，画风走 saveActivityArtStyle，策略走 saveActivityImagePromptPolicy。
 * 不修改旧发布行，不更改 app_generation_assignments 的既有绑定。
 */

export const PARITY_PURPOSE = 'activity_image_text';
export const PARITY_ART_STYLE_NAME = '邻舍对齐 · Anima';

export interface ParityEngineCandidate {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
}

export interface ParityPlanItem {
  kind: 'workflow' | 'workflow_version' | 'preset' | 'art_style' | 'prompt_policy' | 'binding';
  logicalId: string;
  action: 'create' | 'update' | 'up_to_date' | 'skip' | 'blocked';
  detail: string;
  contentHash?: string;
}

export interface ParityConfigPlan {
  engines: ParityEngineCandidate[];
  selectedEngineId: string | null;
  engineIssue: string | null;
  items: ParityPlanItem[];
  missing: string[];
  warnings: string[];
}

/**
 * 计划阶段只读取数据库，因此接受一个仅含 `connection` 的只读包装。
 * CLI 的 --check 分支用 `DatabaseSync(path, { readOnly: true })` 构造它，绝不写入。
 */
type DatabaseLike = Pick<ServiceDatabase, 'connection'>;

/** 计划路径只使用读取函数；这里把只读包装显式交给它们。 */
function asReadable(database: DatabaseLike): ServiceDatabase {
  return database as ServiceDatabase;
}

interface VersionRow {
  version: number;
  definition_json: string;
  input_schema_json: string;
  node_bindings_json: string;
  output_declarations_json: string;
  output_media_types_json: string;
  input_capabilities_json: string;
  editor_config_json: string | null;
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== 'string') return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function listParityEngines(database: DatabaseLike): ParityEngineCandidate[] {
  return (database.connection.prepare(
    "SELECT id,name,kind,enabled FROM generation_engines WHERE kind='comfyui' ORDER BY created_at ASC",
  ).all() as Array<{ id: string; name: string; kind: string; enabled: number }>)
    .map((row) => ({ id: String(row.id), name: String(row.name), kind: String(row.kind), enabled: Boolean(row.enabled) }));
}

function selectEngine(engines: ParityEngineCandidate[], explicit: string | null | undefined): { id: string | null; issue: string | null } {
  const enabled = engines.filter((engine) => engine.enabled);
  if (!enabled.length) return { id: null, issue: '没有启用的 ComfyUI 引擎；请先在生成配置中启用连接。' };
  if (explicit) {
    const match = enabled.find((engine) => engine.id === explicit);
    return match ? { id: match.id, issue: null } : { id: null, issue: `--engine-id ${explicit} 不是已启用的 ComfyUI 引擎。` };
  }
  if (enabled.length > 1) {
    return { id: null, issue: `存在多个可用引擎（${enabled.map((engine) => engine.id).join('、')}），--apply 必须显式给出 --engine-id，不猜选第一条。` };
  }
  return { id: enabled[0].id, issue: null };
}

function workflowVersionRows(database: DatabaseLike, workflowId: string): VersionRow[] {
  return database.connection.prepare(`SELECT version,definition_json,input_schema_json,node_bindings_json,output_declarations_json,
    output_media_types_json,input_capabilities_json,editor_config_json
    FROM generation_workflow_versions WHERE workflow_id=? ORDER BY version ASC`)
    .all(workflowId) as unknown as VersionRow[];
}

function rowContentHash(row: VersionRow): string {
  return parityContentHash({
    definition: parseJson(row.definition_json, {}),
    inputSchema: parseJson(row.input_schema_json, {}),
    nodeBindings: parseJson(row.node_bindings_json, {}),
    editorConfig: parseEditorConfig(row.editor_config_json),
    outputDeclarations: parseJson(row.output_declarations_json, []),
    outputMediaTypes: parseJson(row.output_media_types_json, []),
    inputCapabilities: parseJson(row.input_capabilities_json, {}),
  });
}

function sameValues(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) return false;
  return true;
}

/** 画风按名称匹配，并要求它确实是画风载荷而不是同表的其它预设。 */
function findArtStyle(database: DatabaseLike, name: string) {
  return listActivityPresets(asReadable(database), 'production_preset')
    .filter((preset) => (preset.payload as { schemaKind?: string }).schemaKind === 'activity_art_style_v1')
    .find((preset) => preset.name === name);
}

export interface ParityPlanOptions {
  engineId?: string | null;
  /** 细化工作流族本轮一并注册；此选项只用于核对调用方期望的标识。 */
  hiresWorkflowId?: string | null;
}

export function planParityConfig(database: DatabaseLike, options: ParityPlanOptions = {}): ParityConfigPlan {
  const bundle = buildParityTextWorkflow();
  const engines = listParityEngines(database);
  const engine = selectEngine(engines, options.engineId);
  const items: ParityPlanItem[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];

  const workflowRow = database.connection.prepare('SELECT id,latest_version FROM generation_workflows WHERE id=?')
    .get(PARITY_TEXT_WORKFLOW_ID) as { id: string; latest_version: number } | undefined;
  const versions = workflowRow ? workflowVersionRows(database, PARITY_TEXT_WORKFLOW_ID) : [];
  const matchingVersion = versions.find((row) => rowContentHash(row) === bundle.contentHash);
  items.push({
    kind: 'workflow', logicalId: PARITY_TEXT_WORKFLOW_ID,
    action: workflowRow ? 'up_to_date' : 'create',
    detail: workflowRow ? `工作流已存在，最新版本 v${workflowRow.latest_version}。` : '将创建工作流族。',
  });
  items.push({
    kind: 'workflow_version', logicalId: `${PARITY_TEXT_WORKFLOW_ID}@${bundle.contentHash.slice(0, 12)}`,
    action: matchingVersion ? 'up_to_date' : (workflowRow ? 'update' : 'create'),
    detail: matchingVersion
      ? `内容哈希已存在于已发布版本 v${matchingVersion.version}，不重复发布。`
      : `将发布新版本（当前已发布：${versions.map((row) => `v${row.version}`).join('、') || '无'}）。`,
    contentHash: bundle.contentHash,
  });

  // 预设：按名称 + 工作流版本匹配；内容相同不重复修订。
  const existingPresets = listPresets(asReadable(database), { appId: 'activities', purpose: PARITY_PURPOSE, workflowId: PARITY_TEXT_WORKFLOW_ID });
  for (const template of bundle.presets) {
    const existing = existingPresets.find((preset) => preset.name === template.name);
    let action: ParityPlanItem['action'] = 'create';
    let detail = `${template.name}（enabled=true，isDefault=false，不改变既有默认绑定）。`;
    if (existing) {
      const versionMatches = workflowRow ? existing.workflowVersion === workflowRow.latest_version : false;
      const upToDate = versionMatches && sameValues(existing.values, template.values);
      action = upToDate ? 'up_to_date' : 'update';
      detail = upToDate
        ? `${template.name} 已是最新，不重复修订。`
        : `${template.name} 将指向新版本并同步参数（当前 revision ${existing.revision}）。`;
    }
    items.push({ kind: 'preset', logicalId: `${PARITY_PURPOSE}/${template.templateKey}`, action, detail });
  }

  // 画风：按名称 + schemaKind 匹配。
  const existingStyle = findArtStyle(database, PARITY_ART_STYLE_NAME);
  items.push({
    kind: 'art_style', logicalId: PARITY_ART_STYLE_NAME,
    action: existingStyle ? 'update' : 'create',
    detail: existingStyle
      ? `画风已存在（v${existingStyle.version}）；内容一致时跳过，不一致时提升版本。`
      : '将创建画风：质量／画师串一次、负向词为邻舍模板快照、draft=Turbo、final=Base、默认画布 768×512。',
  });

  // 策略：仅在工作流版本已发布后才可写入。
  const targetVersion = matchingVersion?.version ?? null;
  if (targetVersion) {
    const policy = resolveActivityImagePromptPolicy(asReadable(database), PARITY_TEXT_WORKFLOW_ID, targetVersion);
    const matches = policy.revision > 0
      && policy.outputFormat === 'tags'
      && policy.knowledgeMode === 'keyword'
      && policy.positiveSuffix === '';
    items.push({
      kind: 'prompt_policy', logicalId: `${PARITY_TEXT_WORKFLOW_ID}@v${targetVersion}`,
      action: matches ? 'up_to_date' : 'create',
      detail: '邻舍对齐策略：结构化混合（tags）+ 关键词补全（keyword），positiveSuffix 留空由活动画风管理。',
    });
  } else {
    items.push({
      kind: 'prompt_policy', logicalId: `${PARITY_TEXT_WORKFLOW_ID}@pending`,
      action: 'skip',
      detail: '需要先发布工作流版本，才能为该版本写入 tags/keyword 策略。',
    });
  }

  // 细化工作流：与文生图同样按内容哈希判断，内容相同不重复发布；细化不创建任何预设。
  const hiresBundle = buildParityHiresWorkflow();
  const hiresRow = database.connection.prepare('SELECT id,latest_version FROM generation_workflows WHERE id=?')
    .get(PARITY_HIRES_WORKFLOW_ID) as { id: string; latest_version: number } | undefined;
  const hiresVersions = hiresRow ? workflowVersionRows(database, PARITY_HIRES_WORKFLOW_ID) : [];
  const hiresMatching = hiresVersions.find((row) => rowContentHash(row) === hiresBundle.contentHash);
  items.push({
    kind: 'workflow', logicalId: PARITY_HIRES_WORKFLOW_ID,
    action: hiresRow ? 'up_to_date' : 'create',
    detail: hiresRow ? `细化工作流已存在，最新版本 v${hiresRow.latest_version}。` : '将创建细化工作流族（不创建预设）。',
  });
  items.push({
    kind: 'workflow_version', logicalId: `${PARITY_HIRES_WORKFLOW_ID}@${hiresBundle.contentHash.slice(0, 12)}`,
    action: hiresMatching ? 'up_to_date' : (hiresRow ? 'update' : 'create'),
    detail: hiresMatching
      ? `内容哈希已存在于已发布版本 v${hiresMatching.version}，不重复发布。`
      : `将发布细化新版本（当前已发布：${hiresVersions.map((row) => `v${row.version}`).join('、') || '无'}）。`,
    contentHash: hiresBundle.contentHash,
  });

  // 细化用途绑定：只在尚无同用途绑定时建立，不覆盖既有绑定。
  const existingBinding = database.connection.prepare('SELECT 1 FROM app_generation_assignments WHERE app_id=? AND purpose=?')
    .get('activities', PARITY_HIRES_PURPOSE);
  items.push({
    kind: 'binding', logicalId: `activities/${PARITY_HIRES_PURPOSE}`,
    action: existingBinding ? 'skip' : 'create',
    detail: existingBinding ? '已存在同用途绑定，不覆盖。' : '将建立细化专用用途绑定（指向本轮细化工作流版本）。',
  });
  if (options.hiresWorkflowId && options.hiresWorkflowId !== PARITY_HIRES_WORKFLOW_ID) {
    warnings.push(`--hires-workflow-id ${options.hiresWorkflowId} 与内置细化工作流 ${PARITY_HIRES_WORKFLOW_ID} 不一致；本轮只注册内置细化工作流。`);
  }

  missing.push('未检查 LoRA 与超分模型文件：ComfyUI 实例当前离线，清单记为 unknown 而不是 missing。');
  missing.push('未验证真实模型文件是否存在；以预检实际文件为准，缺失不自动替换其他文件。');

  if (engines.length > 1) warnings.push('存在多个 ComfyUI 引擎候选；--apply 必须显式 --engine-id。');
  if (!engine.id) warnings.push(engine.issue ?? '未选定引擎。');

  return { engines, selectedEngineId: engine.id, engineIssue: engine.issue, items, missing, warnings };
}

export interface ParityApplyResult {
  engineId: string;
  workflowId: string;
  workflowVersion: number;
  workflowPublished: boolean;
  contentHash: string;
  /** 细化工作流（阶段 4B）：本轮注册的版本与是否新建。 */
  hires: { workflowId: string; workflowVersion: number; published: boolean; contentHash: string; bindingAction: 'create' | 'skip' | 'advance' };
  presets: Array<{ name: string; id: string; action: 'create' | 'update' | 'up_to_date' }>;
  artStyle: { id: string; version: number; action: 'create' | 'update' | 'up_to_date' };
  policy: { revision: number; action: 'create' | 'up_to_date' };
  skipped: string[];
}

function buildArtStylePayload(
  draft: { id: string; revision: number; workflowId: string; workflowVersion: number },
  final: { id: string; revision: number; workflowId: string; workflowVersion: number },
): ActivityArtStylePayload {
  const ref = (preset: typeof draft) => ({
    purpose: PARITY_PURPOSE, presetId: preset.id, presetRevision: preset.revision,
    workflowId: preset.workflowId, workflowVersion: preset.workflowVersion,
  });
  return {
    schemaKind: 'activity_art_style_v1',
    positiveStylePrompt: LINSHE_PARITY_STYLE_PROMPT,
    negativePrompt: LINSHE_PARITY_NEGATIVE_PROMPT,
    renderProfiles: { draft: ref(draft), final: ref(final) },
    defaultQuality: 'final',
    defaultCanvas: { width: 768, height: 512 },
    previewArtifactId: null,
  };
}

/**
 * 真实写入。调用方必须先完成 db:backup / db:migrate 并显式确认；
 * 本函数只创建新行与显式版本提升，不修改旧发布行，不改动既有用途绑定。
 */
export function applyParityConfig(database: ServiceDatabase, options: ParityPlanOptions = {}): ParityApplyResult {
  const bundle = buildParityTextWorkflow();
  const engines = listParityEngines(database);
  const engine = selectEngine(engines, options.engineId);
  if (!engine.id) throw Object.assign(new Error(engine.issue ?? '未选定引擎。'), { code: 'parity_engine_not_selected' });
  const engineId = engine.id;

  // 1. 工作流：内容哈希已发布则跳过；否则发布新版本（不改写旧行）。
  let workflowRow = database.connection.prepare('SELECT id,latest_version FROM generation_workflows WHERE id=?')
    .get(PARITY_TEXT_WORKFLOW_ID) as { id: string; latest_version: number } | undefined;
  let workflowPublished = false;
  let workflowVersion: number;
  const existingHash = workflowRow
    ? workflowVersionRows(database, PARITY_TEXT_WORKFLOW_ID).find((row) => rowContentHash(row) === bundle.contentHash)
    : undefined;
  if (existingHash) {
    workflowVersion = existingHash.version;
  } else if (!workflowRow) {
    const imported = importWorkflow(database, {
      id: bundle.id, name: bundle.name, description: bundle.description,
      engineKind: bundle.engineKind, category: bundle.category, engineId,
      definition: bundle.definition, inputSchema: bundle.inputSchema, nodeBindings: bundle.nodeBindings,
      outputDeclarations: bundle.outputDeclarations, outputMediaTypes: bundle.outputMediaTypes,
      inputCapabilities: bundle.inputCapabilities, editorConfig: bundle.editorConfig,
    });
    workflowVersion = imported.version;
    workflowPublished = true;
    workflowRow = { id: bundle.id, latest_version: imported.version };
  } else {
    const published = publishWorkflowVersion(database, {
      workflowId: bundle.id, engineId,
      definition: bundle.definition, inputSchema: bundle.inputSchema, nodeBindings: bundle.nodeBindings,
      outputDeclarations: bundle.outputDeclarations, outputMediaTypes: bundle.outputMediaTypes,
      inputCapabilities: bundle.inputCapabilities, editorConfig: bundle.editorConfig,
    });
    workflowVersion = published.version;
    workflowPublished = true;
  }

  // 2. 预设：创建或显式更新到新版本；始终 enabled、非默认。
  const presetResults: ParityApplyResult['presets'] = [];
  const presetRefs = new Map<string, { id: string; revision: number; workflowId: string; workflowVersion: number }>();
  for (const template of bundle.presets) {
    const existing = listPresets(database, { appId: 'activities', purpose: PARITY_PURPOSE, workflowId: PARITY_TEXT_WORKFLOW_ID })
      .find((preset) => preset.name === template.name);
    if (!existing) {
      const created = createPreset(database, {
        appId: 'activities', purpose: PARITY_PURPOSE, name: template.name, description: template.description,
        workflowId: PARITY_TEXT_WORKFLOW_ID, workflowVersion, engineId,
        values: template.values, enabled: true,
      });
      presetResults.push({ name: created.name, id: created.id, action: 'create' });
      presetRefs.set(template.templateKey, { id: created.id, revision: created.revision, workflowId: created.workflowId, workflowVersion: created.workflowVersion });
      continue;
    }
    const upToDate = existing.workflowVersion === workflowVersion && sameValues(existing.values, template.values);
    if (upToDate) {
      presetResults.push({ name: existing.name, id: existing.id, action: 'up_to_date' });
      presetRefs.set(template.templateKey, { id: existing.id, revision: existing.revision, workflowId: existing.workflowId, workflowVersion: existing.workflowVersion });
      continue;
    }
    const updated = updatePreset(database, existing.id, {
      workflowId: PARITY_TEXT_WORKFLOW_ID, workflowVersion, engineId,
      values: template.values, enabled: true, revision: existing.revision,
    });
    presetResults.push({ name: updated.name, id: updated.id, action: 'update' });
    presetRefs.set(template.templateKey, { id: updated.id, revision: updated.revision, workflowId: updated.workflowId, workflowVersion: updated.workflowVersion });
  }

  // 3. 画风：内容一致时跳过，否则提升版本（不覆盖其他画风）。
  const draftRef = presetRefs.get(PARITY_TURBO_PRESET.templateKey);
  const finalRef = presetRefs.get(PARITY_BASE_PRESET.templateKey);
  if (!draftRef || !finalRef) throw Object.assign(new Error('预设注册未完成，无法创建画风。'), { code: 'parity_preset_missing' });
  const payload = buildArtStylePayload(draftRef, finalRef);
  const existingStyle = findArtStyle(database, PARITY_ART_STYLE_NAME);
  let artStyleResult: ParityApplyResult['artStyle'];
  if (!existingStyle) {
    const created = saveActivityArtStyle(database, { name: PARITY_ART_STYLE_NAME, payload });
    artStyleResult = { id: created.id, version: created.version, action: 'create' };
  } else if (JSON.stringify(existingStyle.payload) === JSON.stringify(payload)) {
    artStyleResult = { id: existingStyle.id, version: existingStyle.version, action: 'up_to_date' };
  } else {
    const updated = saveActivityArtStyle(database, { name: PARITY_ART_STYLE_NAME, payload },
      { id: existingStyle.id, expectedVersion: existingStyle.version });
    artStyleResult = { id: updated.id, version: updated.version, action: 'update' };
  }

  // 4. 策略：新版本上的 tags + keyword，画风由活动画风管理。
  const currentPolicy = resolveActivityImagePromptPolicy(database, PARITY_TEXT_WORKFLOW_ID, workflowVersion);
  const currentInstructions = (currentPolicy.instructions ?? '').trim();
  // 需要修复的只有「没有指令」或「指令仍是 prose 默认」这两种情况（计划 §5.2.1／§5.2.3）。
  // 用户自定义的 tags 指令视为已满足，不静默覆盖（§5.2.7）。
  const usesProseDefaultInstructions = !currentInstructions
    || currentInstructions === DEFAULT_ACTIVITY_IMAGE_PROMPT_INSTRUCTIONS.trim();
  const policyMatches = currentPolicy.revision > 0 && currentPolicy.outputFormat === 'tags'
    && currentPolicy.knowledgeMode === 'keyword' && currentPolicy.positiveSuffix === ''
    && !usesProseDefaultInstructions;
  // tags 策略的 instructions 必须是 tags 默认协议。此前直接沿用 `currentPolicy.instructions`，
  // 新建策略时会拿到 prose 默认文本，导致 tags 请求下发 prose 指令。
  const instructions = usesProseDefaultInstructions
    ? DEFAULT_ACTIVITY_IMAGE_STRUCTURED_INSTRUCTIONS
    : currentPolicy.instructions;
  const savedPolicy = policyMatches ? currentPolicy : saveActivityImagePromptPolicy(database, {
    workflowId: PARITY_TEXT_WORKFLOW_ID, workflowVersion, revision: currentPolicy.revision,
    enabled: true, instructions,
    positiveSuffix: '', negativePrompt: currentPolicy.negativePrompt || LINSHE_PARITY_NEGATIVE_PROMPT,
    outputFormat: 'tags', knowledgeMode: 'keyword',
  });

  // 5. 细化工作流与专用用途绑定：不创建预设；不覆盖**别的**工作流的既有绑定，
  //    但本工作流自己发布了新版本时必须推进绑定，否则修好的图永远不生效。
  const hires = ensureParityHiresWorkflow(database, engineId);
  const hiresBinding = database.connection.prepare('SELECT workflow_id, workflow_version FROM app_generation_assignments WHERE app_id=? AND purpose=?')
    .get('activities', PARITY_HIRES_PURPOSE) as { workflow_id: string; workflow_version: number } | undefined;
  let hiresBindingAction: 'create' | 'skip' | 'advance';
  if (!hiresBinding) {
    database.connection.prepare('INSERT INTO app_generation_assignments(app_id,purpose,workflow_id,workflow_version,engine_id,updated_at) VALUES (?,?,?,?,?,?)')
      .run('activities', PARITY_HIRES_PURPOSE, PARITY_HIRES_WORKFLOW_ID, hires.workflowVersion, engineId, nowIso());
    hiresBindingAction = 'create';
  } else if (hiresBinding.workflow_id === PARITY_HIRES_WORKFLOW_ID && hiresBinding.workflow_version !== hires.workflowVersion) {
    database.connection.prepare('UPDATE app_generation_assignments SET workflow_version=?, engine_id=?, updated_at=? WHERE app_id=? AND purpose=?')
      .run(hires.workflowVersion, engineId, nowIso(), 'activities', PARITY_HIRES_PURPOSE);
    hiresBindingAction = 'advance';
  } else {
    hiresBindingAction = 'skip';
  }

  return {
    engineId, workflowId: PARITY_TEXT_WORKFLOW_ID, workflowVersion, workflowPublished,
    contentHash: bundle.contentHash,
    hires: { ...hires, bindingAction: hiresBindingAction },
    presets: presetResults,
    artStyle: artStyleResult,
    policy: { revision: savedPolicy.revision, action: policyMatches ? 'up_to_date' : 'create' },
    skipped: [
      '未修改 app_generation_assignments 的既有绑定。',
      '未写入任何活动的当前画风（只有用户显式应用才写入）。',
      hiresBindingAction === 'skip' ? '细化用途绑定：已指向当前版本，未覆盖。'
        : hiresBindingAction === 'advance' ? `细化用途绑定：从 v${hiresBinding!.workflow_version} 推进到 v${hires.workflowVersion}。`
        : `细化用途绑定：本轮建立 activities/${PARITY_HIRES_PURPOSE}。`,
      '细化工作流不注册预设，也不改写活动画风。',
    ],
  };
}

/**
 * 发布细化工作流族（计划 §12.1）。与文生图工作流同样走 importWorkflow / publishWorkflowVersion，
 * 内容哈希已发布则不重复发布；细化不创建任何预设。
 */
function ensureParityHiresWorkflow(database: ServiceDatabase, engineId: string): { workflowId: string; workflowVersion: number; published: boolean; contentHash: string } {
  const bundle = buildParityHiresWorkflow();
  const workflowRow = database.connection.prepare('SELECT id,latest_version FROM generation_workflows WHERE id=?')
    .get(PARITY_HIRES_WORKFLOW_ID) as { id: string; latest_version: number } | undefined;
  const existingHash = workflowRow
    ? workflowVersionRows(database, PARITY_HIRES_WORKFLOW_ID).find((row) => rowContentHash(row) === bundle.contentHash)
    : undefined;
  if (existingHash) return { workflowId: PARITY_HIRES_WORKFLOW_ID, workflowVersion: existingHash.version, published: false, contentHash: bundle.contentHash };
  if (!workflowRow) {
    const imported = importWorkflow(database, {
      id: bundle.id, name: bundle.name, description: bundle.description,
      engineKind: bundle.engineKind, category: bundle.category, engineId,
      definition: bundle.definition, inputSchema: bundle.inputSchema, nodeBindings: bundle.nodeBindings,
      outputDeclarations: bundle.outputDeclarations, outputMediaTypes: bundle.outputMediaTypes,
      inputCapabilities: bundle.inputCapabilities, editorConfig: bundle.editorConfig,
    });
    return { workflowId: PARITY_HIRES_WORKFLOW_ID, workflowVersion: imported.version, published: true, contentHash: bundle.contentHash };
  }
  const published = publishWorkflowVersion(database, {
    workflowId: bundle.id, engineId,
    definition: bundle.definition, inputSchema: bundle.inputSchema, nodeBindings: bundle.nodeBindings,
    outputDeclarations: bundle.outputDeclarations, outputMediaTypes: bundle.outputMediaTypes,
    inputCapabilities: bundle.inputCapabilities, editorConfig: bundle.editorConfig,
  });
  return { workflowId: PARITY_HIRES_WORKFLOW_ID, workflowVersion: published.version, published: true, contentHash: bundle.contentHash };
}

/** 供测试与脚本复用：把编辑器配置里声明的组装方式读出来。 */
export function parityAssemblyOf(editorConfig: GenerationEditorConfig | null): string | null {
  return editorConfig?.promptAssembly ?? null;
}

/** 供测试使用：编辑器字段里没有对应 inputSchema 的键（注册出的工作流会无法生成）。 */
export function paritySchemaKeys(editorConfig: GenerationEditorConfig | null, inputSchema: unknown): string[] {
  const schema = parseInputSchema(inputSchema);
  return Object.keys(editorConfig?.fields ?? {}).filter((key) => !(key in schema));
}
