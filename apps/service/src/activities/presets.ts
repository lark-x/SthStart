import { instantiateTemplateDocument, suggestRoleMappings, normalizeRoleMappings, normalizeCreationProfile, buildActivityDocument } from '@sthstart/contracts';
import crypto from 'node:crypto';
import type {
  ActivityPresetKind,
  ActivityReusablePreset,
  CreateActivityPresetInput,
  InstantiateTemplateInput,
  UpdateActivityPresetInput,
  StageDefinition,
  ContentDocument,
} from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';

function nowIso(): string {
  return new Date().toISOString();
}

interface PresetRow {
  id: string;
  kind: string;
  name: string;
  version: number;
  schema_version: number;
  payload_json: string;
  created_at: string;
  updated_at: string;
}

function mapRowToPreset(row: PresetRow): ActivityReusablePreset {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payload_json || '{}');
  } catch {
    payload = {};
  }
  return {
    id: row.id,
    kind: row.kind as ActivityPresetKind,
    name: row.name,
    version: row.version,
    schemaVersion: row.schema_version,
    payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listActivityPresets(
  database: ServiceDatabase,
  kind?: ActivityPresetKind,
): ActivityReusablePreset[] {
  let query = `
    SELECT id, kind, name, version, schema_version, payload_json, created_at, updated_at
    FROM activity_reusable_presets
  `;
  const params: string[] = [];
  if (kind) {
    query += ` WHERE kind = ?`;
    params.push(kind);
  }
  query += ` ORDER BY updated_at DESC`;

  const rows = database.connection.prepare(query).all(...params) as unknown as PresetRow[];
  return rows.map(mapRowToPreset);
}

export function getActivityPreset(
  database: ServiceDatabase,
  id: string,
): ActivityReusablePreset | null {
  const row = database.connection.prepare(`
    SELECT id, kind, name, version, schema_version, payload_json, created_at, updated_at
    FROM activity_reusable_presets
    WHERE id = ?
  `).get(id) as unknown as PresetRow | undefined;

  return row ? mapRowToPreset(row) : null;
}

export function createActivityPreset(
  database: ServiceDatabase,
  input: CreateActivityPresetInput,
): ActivityReusablePreset {
  const id = `preset_${crypto.randomUUID().replace(/-/g, '')}`;
  const now = nowIso();
  const version = 1;
  const schemaVersion = input.kind==='activity_template'&&input.payload?.schemaVersion===2?2:1;
  if (input.kind === 'creation_profile') input.payload = { ...normalizeCreationProfile(input.payload || {}) };
  const payloadJson = JSON.stringify(input.payload || {});

  database.connection.prepare(`
    INSERT INTO activity_reusable_presets (id, kind, name, version, schema_version, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.kind, input.name.trim(), version, schemaVersion, payloadJson, now, now);

  return {
    id,
    kind: input.kind,
    name: input.name.trim(),
    version,
    schemaVersion,
    payload: input.payload,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateActivityPreset(
  database: ServiceDatabase,
  id: string,
  input: UpdateActivityPresetInput,
): ActivityReusablePreset {
  const existing = getActivityPreset(database, id);
  if (!existing) {
    const err = new Error(`预设 ${id} 未找到`);
    (err as unknown as { statusCode: number; code: string }).statusCode = 404;
    (err as unknown as { code: string }).code = 'preset_not_found';
    throw err;
  }

  const now = nowIso();
  const nextVersion = existing.version + 1;
  const nextName = input.name !== undefined ? input.name.trim() : existing.name;
  const rawPayload = input.payload !== undefined ? input.payload : existing.payload;
  const nextPayload = existing.kind === 'creation_profile' ? { ...normalizeCreationProfile(rawPayload) } : rawPayload;
  const payloadJson = JSON.stringify(nextPayload);

  database.connection.prepare(`
    UPDATE activity_reusable_presets
    SET name = ?, version = ?, payload_json = ?, updated_at = ?
    WHERE id = ?
  `).run(nextName, nextVersion, payloadJson, now, id);

  return {
    ...existing,
    name: nextName,
    version: nextVersion,
    payload: nextPayload,
    updatedAt: now,
  };
}

export function deleteActivityPreset(
  database: ServiceDatabase,
  id: string,
): boolean {
  const res = database.connection.prepare(`
    DELETE FROM activity_reusable_presets
    WHERE id = ?
  `).run(id);

  if(res.changes>0)database.connection.prepare("DELETE FROM runtime_settings WHERE key='activities.creation_profile_default' AND value_json=?").run(JSON.stringify(id));
  return res.changes > 0;
}

export interface TemplateInstantiatedResult {
  title: string;
  type: string;
  theme: string;
  location: string;
  rules: string;
  stages: StageDefinition[];
  templateMetadata: {
    presetId: string;
    presetName: string;
    presetVersion: number;
  };
}

export function instantiateActivityTemplate(
  preset: ActivityReusablePreset,
  input: InstantiateTemplateInput,
): TemplateInstantiatedResult {
  if (preset.kind !== 'activity_template') {
    const err = new Error('该预设不是活动模板，无法实例化');
    (err as unknown as { statusCode: number; code: string }).statusCode = 400;
    (err as unknown as { code: string }).code = 'invalid_preset_kind';
    throw err;
  }

  const payload = preset.payload as { activityType?: string; theme?: string; location?: string; rules?: string };
  const mappings = normalizeRoleMappings(input.actorMappings);
  const actors = [...new Set(Object.values(mappings).flat())].map(id => ({ id, displayName: id,
    persona: {}, activityRole: '', outfitDescription: '', appearanceReferenceAssetKeys: [] }));
  const document = buildActivityDocument({ templateId: 'blank', title: input.title, type: payload.activityType || '',
    theme: payload.theme || '', location: input.location || payload.location || '', rules: '', actors });
  const instantiated = instantiateTemplateDocument(document, preset, mappings);
  const stages = instantiated.stages;

  return {
    title: input.title.trim(),
    type: payload.activityType || '自定义活动',
    theme: payload.theme || '',
    location: input.location?.trim() || payload.location || '活动现场',
    rules: instantiated.activity.rules,
    stages,
    templateMetadata: {
      presetId: preset.id,
      presetName: preset.name,
      presetVersion: preset.version,
    },
  };
}

/** Apply a saved template to planning while freezing its source version in the document. */
export function applySavedActivityTemplate(
  database: ServiceDatabase,
  document: ContentDocument,
  templateId: string,
  previous?: ContentDocument,
  explicitMappings?: Record<string, string[]>,
): ContentDocument {
  const frozen = previous?.activity.templateSnapshot?.presetId === templateId ? previous.activity.templateSnapshot : undefined;
  if (!frozen && !templateId.startsWith('preset_')) return document;
  const stored = frozen ? null : getActivityPreset(database, templateId);
  if (!frozen && (!stored || stored.kind !== 'activity_template')) {
    throw Object.assign(new Error('活动模板不存在，请重新选择模板。'), { statusCode: 400, code: 'template_not_found' });
  }
  const snapshot = frozen || { presetId: stored!.id, name: stored!.name, version: stored!.version, payload: structuredClone(stored!.payload) };
  const preset: ActivityReusablePreset = { id: snapshot.presetId, kind: 'activity_template', name: snapshot.name,
    version: snapshot.version, schemaVersion: 1, payload: snapshot.payload, createdAt: '', updatedAt: '' };
  const mappings = explicitMappings || (frozen && 'actorMappings' in frozen ? frozen.actorMappings : undefined)
    || suggestRoleMappings(snapshot.payload,document.actors,document.activity.birthdayActorIds?.[0]);
  const result = instantiateTemplateDocument(document,preset,mappings,previous?.activity.templateId===templateId?previous:undefined);
  Object.assign(document,result);
  return document;
}
