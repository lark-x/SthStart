import type { ActivityLora } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import type { SecretStore } from '../security.js';
import { mergeGenerationValues, type InputSchemaMap } from '../generation/configuration.js';
import { listPresets, resolveDefaultPreset, resolveEnabledPreset } from '../generation/configuration-store.js';
import { resolveWorkflowAndEngine } from '../generation/task-store.js';
import { injectActivityLoras, renderWorkflowSnapshot } from '../generation/workflows.js';
import { inspectWorkflowRuntime } from '../generation/runtime-preflight.js';

export function parseInputCapabilities(value: unknown): Record<string, Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key,
    item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {},]));
}

export function promptInputKey(schema: InputSchemaMap, negative = false): string | null {
  for (const [key, entry] of Object.entries(schema)) {
    const semantic = String(entry.semantic ?? '').toLowerCase();
    const normalized = key.toLowerCase().replaceAll('_', '');
    if (negative ? semantic === 'negative_prompt' || normalized === 'negativeprompt'
      : semantic === 'prompt' || normalized === 'prompt' || normalized === 'positiveprompt') return key;
  }
  return null;
}

export function referenceInputKey(resolved: ReturnType<typeof resolveWorkflowAndEngine>): string | null {
  const capabilities = parseInputCapabilities(resolved.workflow.inputCapabilities);
  for (const [key, capability] of Object.entries(capabilities)) {
    const semantic = String(capability.semantic ?? '');
    const mediaTypes = Array.isArray(capability.mediaTypes) ? capability.mediaTypes.map(String) : [];
    const imageCapable = !mediaTypes.length || mediaTypes.some((item) => item === 'image/*' || item.startsWith('image/'));
    if (resolved.workflow.nodeBindings[key] && imageCapable && ['identity', 'init_image', 'outfit', 'pose', 'style', 'composition'].includes(semantic)) return key;
  }
  return null;
}

export function isCompatibleImageWorkflow(resolved: ReturnType<typeof resolveWorkflowAndEngine>) {
  const schema = resolved.workflow.inputSchema as InputSchemaMap;
  return resolved.workflow.category === 'image'
    && resolved.workflow.outputMediaTypes.some((mediaType) => mediaType.startsWith('image/'))
    && Boolean(promptInputKey(schema) && resolved.workflow.nodeBindings[promptInputKey(schema)!]);
}

export function listActivityImageWorkflowOptions(database: ServiceDatabase) {
  const rows = database.connection.prepare(`SELECT purpose,workflow_id,workflow_version FROM app_generation_assignments
      WHERE app_id='activities' AND (purpose LIKE 'activity_image_%' OR purpose='activity_media_slot')
    UNION SELECT purpose,workflow_id,workflow_version FROM generation_presets
      WHERE app_id='activities' AND enabled=1 AND (purpose LIKE 'activity_image_%' OR purpose='activity_media_slot')
    ORDER BY purpose,workflow_id,workflow_version`).all() as Array<{ purpose: string; workflow_id: string; workflow_version: number }>;
  const options: Array<{ purpose: string; workflowId: string; workflowName: string; workflowVersion: number; engineId: string; engineName: string; modelSelection: 'individual' | 'preset-locked'; presetId: string | null }> = [];
  for (const row of rows) {
    try {
      const resolved = resolveWorkflowAndEngine(database, 'activities', {
        purpose: row.purpose, workflowId: row.workflow_id, workflowVersion: Number(row.workflow_version), isInternal: true,
      });
      if (!isCompatibleImageWorkflow(resolved)) continue;
      const defaultPreset = resolveDefaultPreset(database, 'activities', row.purpose);
      options.push({ purpose: row.purpose, workflowId: resolved.workflow.id, workflowName: resolved.workflow.name,
        workflowVersion: resolved.workflow.version, engineId: resolved.engine.id, engineName: resolved.engine.name,
        modelSelection: resolved.workflow.editorConfig?.modelSelection === 'preset-locked' ? 'preset-locked' : 'individual',
        presetId: defaultPreset?.preset.workflowId === resolved.workflow.id && defaultPreset.preset.workflowVersion === resolved.workflow.version ? defaultPreset.preset.id : null });
    } catch { /* invalid/unavailable assignments are not selectable */ }
  }
  return options;
}

export function resolveActivityImageWorkflow(database: ServiceDatabase, input: {
  purpose?: string | null; workflowId?: string | null; workflowVersion?: number | null; presetId?: string | null; presetRevision?: number | null; referenceAssetKey?: string | null;
}) {
  let purpose = input.purpose?.trim() || (input.referenceAssetKey ? 'activity_image_edit' : 'activity_image_text');
  const assigned = (value: string) => Boolean(database.connection.prepare('SELECT 1 FROM app_generation_assignments WHERE app_id=? AND purpose=?').get('activities', value));
  if (!assigned(purpose)) {
    const fallback = input.referenceAssetKey ? 'activity_image_edit' : 'activity_media_slot';
    if (!input.purpose && assigned(fallback)) purpose = fallback;
    else throw Object.assign(new Error(`尚未为活动配置用途 ${purpose} 的图片工作流，请先到生成配置中绑定已发布的图片工作流。`), { code: 'generation_assignment_not_found', statusCode: 409 });
  }
  const availableWorkflows = listActivityImageWorkflowOptions(database);
  let selectedPresetId = input.presetId ?? null;
  let selectedPresetRevision = input.presetRevision ?? null;
  let presetValues: Record<string, unknown> = {};
  let workflowId = input.workflowId ?? null;
  let workflowVersion = input.workflowVersion ?? null;
  let hasPreset = false;
  if (selectedPresetId) {
    const preset = resolveEnabledPreset(database, 'activities', purpose, selectedPresetId, selectedPresetRevision);
    if (workflowId && (workflowId !== preset.preset.workflowId || (workflowVersion != null && workflowVersion !== preset.preset.workflowVersion))) {
      throw Object.assign(new Error('所选预设与工作流不匹配，请重新选择。'), { code: 'preset_workflow_conflict', statusCode: 409 });
    }
    selectedPresetId = preset.preset.id;
    selectedPresetRevision = preset.preset.revision;
    presetValues = preset.values;
    workflowId = preset.preset.workflowId;
    workflowVersion = preset.preset.workflowVersion;
    hasPreset = true;
  } else if (!workflowId) {
    const defaultPreset = resolveDefaultPreset(database, 'activities', purpose);
    if (defaultPreset) {
      selectedPresetId = defaultPreset.preset.id;
      selectedPresetRevision = defaultPreset.preset.revision;
      presetValues = defaultPreset.values;
      workflowId = defaultPreset.preset.workflowId;
      workflowVersion = defaultPreset.preset.workflowVersion;
      hasPreset = true;
    }
  }
  const resolved = resolveWorkflowAndEngine(database, 'activities', { purpose, workflowId, workflowVersion, isInternal: true });
  if (!availableWorkflows.some((item) => item.purpose === purpose && item.workflowId === resolved.workflow.id && item.workflowVersion === resolved.workflow.version)) {
    throw Object.assign(new Error('所选工作流未通过活动用途绑定或活动预设开放，请先在生成配置中为活动开放此工作流。'), { code: 'activity_workflow_not_available', statusCode: 409 });
  }
  if (!isCompatibleImageWorkflow(resolved)) throw Object.assign(new Error('所选已发布工作流必须声明图片输出，并绑定正向提示词输入。'), { code: 'image_workflow_incompatible', statusCode: 409 });
  const presets = listPresets(database, { appId: 'activities', purpose, workflowId: resolved.workflow.id })
    .filter((preset) => preset.enabled)
    .map((preset) => ({ id: preset.id, name: preset.name, revision: preset.revision, workflowId: preset.workflowId, workflowVersion: preset.workflowVersion, isDefault: preset.isDefault }));
  return { purpose, selectedPresetId, selectedPresetRevision, presetValues, hasPreset, resolved, availableWorkflows, presets };
}

export function readActivityLoraPolicy(database: ServiceDatabase, workflowId: string, workflowVersion: number) {
  const row = database.connection.prepare(`SELECT revision,entries_json FROM activity_lora_policy_versions
    WHERE workflow_id=? AND workflow_version=? ORDER BY revision DESC LIMIT 1`).get(workflowId, workflowVersion) as
    { revision: number; entries_json: string } | undefined;
  try { return { revision: Number(row?.revision ?? 0), entries: JSON.parse(row?.entries_json ?? '[]') as ActivityLora[] }; }
  catch { return { revision: 0, entries: [] as ActivityLora[] }; }
}

export function mergeActivityLoras(globalEntries: ActivityLora[], actorEntries: ActivityLora[], overrides: Array<{
  model: string; strength?: number; triggerWord?: string; enabled?: boolean;
}>, options: { rejectActorConflicts?: boolean } = {}) {
  const merged = new Map<string, ActivityLora & { source: 'global' | 'character' | 'shot'; available: boolean }>();
  const actorConfig = new Map<string, ActivityLora>();
  for (const item of globalEntries) merged.set(item.model, { ...item, source: 'global', available: false });
  for (const item of actorEntries) {
    const previousActor = actorConfig.get(item.model);
    if (options.rejectActorConflicts && previousActor
      && (previousActor.strength !== item.strength || previousActor.triggerWord !== item.triggerWord || previousActor.enabled !== item.enabled)
      && !overrides.some((override) => override.model === item.model)) {
      throw Object.assign(new Error(`多个角色的 LoRA「${item.model}」配置冲突；请在此画格显式覆盖后再生成。`), { code: 'comic_actor_lora_conflict', statusCode: 409 });
    }
    actorConfig.set(item.model, item);
    merged.set(item.model, { ...item, source: 'character', available: false });
  }
  for (const override of overrides) {
    const previous = merged.get(override.model);
    merged.set(override.model, { model: override.model, strength: override.strength ?? previous?.strength ?? 1,
      triggerWord: override.triggerWord ?? previous?.triggerWord ?? '', enabled: override.enabled ?? previous?.enabled ?? true,
      source: 'shot', available: false });
  }
  return [...merged.values()];
}

export function appendLoraTriggerWords(prompt: string, loras: ActivityLora[]) {
  const result = prompt.trim();
  const existing = result.toLocaleLowerCase();
  const additions = [...new Set(loras.filter((item) => item.enabled).map((item) => item.triggerWord.trim()).filter(Boolean))]
    .filter((word) => !existing.includes(word.toLocaleLowerCase()));
  return additions.length ? `${result}\n${additions.join(', ')}` : result;
}

export function buildActivityImageWorkflowSnapshot(
  resolved: ReturnType<typeof resolveWorkflowAndEngine>, parameters: Record<string, unknown>, seed: number, loras: ActivityLora[],
) {
  const base = renderWorkflowSnapshot(resolved.workflow.definition, resolved.workflow.nodeBindings, parameters, seed);
  return injectActivityLoras(base, resolved.workflow.editorConfig, loras.filter((item) => item.enabled));
}

export function inspectActivityImageWorkflow(
  resolved: ReturnType<typeof resolveWorkflowAndEngine>, parameters: Record<string, unknown>, seed: number, loras: ActivityLora[],
  secrets: SecretStore, fetcher: typeof fetch, refresh = true,
) {
  return inspectWorkflowRuntime(resolved.engine, buildActivityImageWorkflowSnapshot(resolved, parameters, seed, loras), secrets, fetcher, refresh);
}

export function mergeActivityImageInputs(
  resolved: ReturnType<typeof resolveWorkflowAndEngine>, presetValues: Record<string, unknown>, inputs: Record<string, unknown>, hasPreset: boolean,
) {
  const schema = resolved.workflow.inputSchema as InputSchemaMap;
  const mode = resolved.workflow.configFormatVersion >= 2 ? 'strict' : 'lenient';
  return mergeGenerationValues(schema, resolved.workflow.editorConfig, presetValues, inputs, mode, hasPreset ? undefined : { applyDefaults: false }).values;
}
