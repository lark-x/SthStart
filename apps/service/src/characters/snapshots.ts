import {
  CHARACTER_PERSONA_COMPILER_VERSION, compileLinshePrompt, toCharacterRuntime,
  type CharacterAssetDetail, type CharacterRelationship, type CharacterVariant,
  type CharacterVersion, type CharacterVisualReference,
} from '@sthstart/contracts';
import { createArtifactReference } from '../artifacts.js';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import { normalizeCharacterDraft, text } from './draft.js';
import { normalizeCharacterAppearance } from './persona-compiler.js';

function json<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}

/** Stored alongside the draft, so old draft readers remain compatible. Never rebuilt from live data. */
export interface StoredCharacterSnapshot {
  variants: CharacterVariant[];
  assets: CharacterAssetDetail[];
  visualReferences: CharacterVisualReference[];
  tags: string[];
  avatarAssetId: string | null;
  portraitAssetId: string | null;
}

export function readStoredCharacterSnapshot(dataJson: unknown): StoredCharacterSnapshot | null {
  const data = json<Record<string, unknown>>(dataJson, {});
  const value = data.snapshot;
  return value && typeof value === 'object' && !Array.isArray(value) ? value as StoredCharacterSnapshot : null;
}

export function characterVisualReferenceRows(database: ServiceDatabase, characterId: string): CharacterVisualReference[] {
  return (database.connection.prepare(`SELECT r.id,r.character_id,r.asset_id,r.purposes_json,r.enabled,r.crop_json,r.created_at,
      a.artifact_id,art.sha256,art.width,art.height,a.source_page,a.source_url,a.author_note,a.user_note
    FROM character_visual_references r JOIN character_assets a ON a.id=r.asset_id
    LEFT JOIN artifacts art ON art.id=a.artifact_id WHERE r.character_id=? ORDER BY r.created_at DESC,r.id`).all(characterId) as Record<string, unknown>[]).map(row => ({
    id: String(row.id), characterId: String(row.character_id), assetId: String(row.asset_id), artifactId: row.artifact_id ? String(row.artifact_id) : null,
    sha256: String(row.sha256 ?? ''), width: row.width == null ? null : Number(row.width), height: row.height == null ? null : Number(row.height),
    purposes: json<CharacterVisualReference['purposes']>(row.purposes_json, []), outfitId: null, sourcePage: row.source_page ? String(row.source_page) : null,
    originalUrl: row.source_url ? String(row.source_url) : null, authorNote: String(row.author_note ?? ''), userNote: String(row.user_note ?? ''),
    enabled: Boolean(row.enabled), crop: row.crop_json ? json(row.crop_json, null) : null,
    url: `/api/admin/characters/assets/${row.asset_id}`, createdAt: String(row.created_at),
  }));
}

export function mapCharacterVersion(row: Record<string, unknown>): CharacterVersion {
  const snapshot = readStoredCharacterSnapshot(row.data_json);
  const frozenUrl = (assetId: string) => `/api/admin/characters/${row.character_id}/versions/${row.version}/assets/${assetId}`;
  const rawProvenance = json<unknown>(row.provenance_json, undefined);
  return {
    characterId: String(row.character_id), version: Number(row.version),
    ...(row.version_label ? { versionLabel: String(row.version_label) } : {}),
    data: normalizeCharacterDraft(json(row.data_json, {})), compiledLinshePrompt: String(row.compiled_linshe_prompt),
    relationships: json<CharacterRelationship[]>(row.relationships_json, []), createdAt: String(row.created_at),
    ...(row.draft_revision != null ? { draftRevision: Number(row.draft_revision) } : {}),
    ...(row.compiler_version != null ? { compilerVersion: String(row.compiler_version) } : {}),
    ...(row.appearance_snapshot_json ? { appearanceSnapshot: normalizeCharacterAppearance(json(row.appearance_snapshot_json, {})) } : {}),
    ...(rawProvenance ? { provenance: Array.isArray(rawProvenance) ? { fields: rawProvenance } : rawProvenance as Record<string, unknown> } : {}),
    variants: (snapshot?.variants ?? []).map(variant => ({ ...variant,
      ...(variant.avatarAssetId ? { avatarUrl: frozenUrl(variant.avatarAssetId) } : {}),
      ...(variant.portraitAssetId ? { portraitUrl: frozenUrl(variant.portraitAssetId) } : {}),
    })),
    assets: (snapshot?.assets ?? []).map(asset => ({ ...asset, url: asset.artifactId ? frozenUrl(asset.id) : null })),
    visualReferences: (snapshot?.visualReferences ?? []).map(reference => ({ ...reference, url: frozenUrl(reference.assetId) })), tags: snapshot?.tags ?? [],
    avatarAssetId: snapshot?.avatarAssetId ?? null, portraitAssetId: snapshot?.portraitAssetId ?? null,
  };
}

function compileWithCostumes(draft: unknown, assets: CharacterAssetDetail[]) {
  const base = compileLinshePrompt(draft);
  const lines = assets.filter(asset => asset.category === 'costume').map(asset => {
    const name = text(asset.metadata.skinName ?? asset.title, 200);
    const outfit = typeof asset.metadata.outfitDescription === 'string' ? asset.metadata.outfitDescription : asset.userNote;
    const story = typeof asset.metadata.loreStory === 'string' ? asset.metadata.loreStory : asset.authorNote;
    return [name && `### ${name}`, outfit && `服装：${outfit}`, story && `服饰故事：${story}`].filter(Boolean).join('\n');
  }).filter(Boolean);
  if (!lines.length) return base;
  const section = `\n\n## 可选皮肤与装扮参考\n${lines.join('\n\n')}`;
  const index = base.indexOf('\n\n## 你的外观\n');
  return index >= 0 ? `${base.slice(0, index)}${section}${base.slice(index)}` : `${base}${section}`;
}

export function publishCharacterSnapshot(database: ServiceDatabase, characterId: string,
  options?: { versionLabel?: string; allowIncomplete?: boolean; expectedDraftRevision?: number }): CharacterVersion | null {
  const write = (): CharacterVersion | null => {
    const row = database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(characterId) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (options?.expectedDraftRevision != null && options.expectedDraftRevision !== Number(row.draft_revision ?? 1)) throw new Error('draft_revision_conflict');
    const draft = normalizeCharacterDraft(json(row.draft_json, {}));
    const runtime = toCharacterRuntime(draft);
    if (!options?.allowIncomplete && (!runtime.displayName || (!runtime.personaText.trim() && !runtime.summary.trim()))) return null;
    const version = Number(row.latest_version ?? 0) + 1;
    const frozenUrl = (assetId: string) => `/api/admin/characters/${characterId}/versions/${version}/assets/${assetId}`;
    const assets = (database.connection.prepare('SELECT * FROM character_assets WHERE character_id=? ORDER BY created_at,id').all(characterId) as Record<string, unknown>[]).map(asset => ({
      id: String(asset.id), characterId, kind: String(asset.kind) as CharacterAssetDetail['kind'],
      category: String(asset.category || (asset.kind === 'reference' ? 'concept' : asset.kind)) as CharacterAssetDetail['category'],
      title: String(asset.title ?? ''), url: asset.artifact_id ? frozenUrl(String(asset.id)) : null,
      artifactId: asset.artifact_id ? String(asset.artifact_id) : null, tags: json<string[]>(asset.tags_json, []),
      metadata: json<Record<string, unknown>>(asset.metadata_json, {}), createdAt: String(asset.created_at),
      sourceUrl: asset.source_url ? String(asset.source_url) : null, sourcePage: asset.source_page ? String(asset.source_page) : null,
      authorNote: String(asset.author_note ?? ''), userNote: String(asset.user_note ?? ''),
    }));
    const references = characterVisualReferenceRows(database, characterId).filter(reference => reference.enabled)
      .map(reference => ({ ...reference, url: frozenUrl(reference.assetId) }));
    const snapshot: StoredCharacterSnapshot = {
      variants: json<CharacterVariant[]>(row.variants_json, []).map(variant => ({ ...variant,
        ...(variant.avatarAssetId ? { avatarUrl: frozenUrl(variant.avatarAssetId) } : {}),
        ...(variant.portraitAssetId ? { portraitUrl: frozenUrl(variant.portraitAssetId) } : {}),
      })), assets, visualReferences: references, tags: json<string[]>(row.tags_json, []),
      avatarAssetId: row.avatar_asset_id ? String(row.avatar_asset_id) : null, portraitAssetId: row.portrait_asset_id ? String(row.portrait_asset_id) : null,
    };
    const prompt = compileWithCostumes(draft, assets);
    const now = nowIso();
    const appearance = normalizeCharacterAppearance(runtime.appearance.legacy);
    appearance.description = runtime.appearance.baseText;
    appearance.referenceIds = [...new Set([...(appearance.referenceIds ?? []), ...references.map(reference => reference.id)])];
    const relationships = (database.connection.prepare('SELECT * FROM character_relationships WHERE from_character_id=? OR to_character_id=? ORDER BY updated_at DESC').all(characterId, characterId) as Record<string, unknown>[]).map(relation => ({
      id: String(relation.id), fromCharacterId: String(relation.from_character_id), toCharacterId: String(relation.to_character_id), relationType: String(relation.relation_type), description: String(relation.description), updatedAt: String(relation.updated_at),
    }));
    const provenance = database.connection.prepare('SELECT field_path,value_hash,source_kind,source_snapshot_id,source_pointer,evidence_json,confirmed FROM character_field_provenance WHERE character_id=? ORDER BY created_at DESC').all(characterId);
    database.connection.prepare(`INSERT INTO character_versions
      (character_id,version,version_label,data_json,compiled_linshe_prompt,created_at,relationships_json,draft_revision,appearance_snapshot_json,provenance_json,compiler_version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(characterId, version, text(options?.versionLabel, 120), JSON.stringify({ ...draft, snapshot }), prompt, now,
        JSON.stringify(relationships), Number(row.draft_revision ?? 1), JSON.stringify({ ...appearance, avatarAssetId: snapshot.avatarAssetId, references }), JSON.stringify(provenance), CHARACTER_PERSONA_COMPILER_VERSION);
    for (const artifactId of new Set(assets.map(asset => asset.artifactId).filter((id): id is string => Boolean(id)))) {
      createArtifactReference(database, { artifactId, appId: 'characters', refType: 'character-version', refId: `${characterId}:${version}` });
    }
    database.connection.prepare('UPDATE character_profiles SET latest_version=?,updated_at=? WHERE id=?').run(version, now, characterId);
    database.connection.prepare(`INSERT INTO personas(id,display_name,tags_json,source,latest_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,tags_json=excluded.tags_json,latest_version=excluded.latest_version,updated_at=excluded.updated_at`).run(characterId, runtime.displayName, String(row.tags_json), 'character-library', version, String(row.created_at), now);
    const avatarArtifactId = assets.find(asset => asset.id === snapshot.avatarAssetId)?.artifactId ?? null;
    database.connection.prepare('INSERT OR REPLACE INTO persona_versions VALUES (?,?,?,?,?,?,?,?)').run(characterId, version, runtime.displayName, prompt, runtime.appearance.baseText || null, avatarArtifactId, JSON.stringify({ characterData: draft }), now);
    return mapCharacterVersion(database.connection.prepare('SELECT * FROM character_versions WHERE character_id=? AND version=?').get(characterId, version) as Record<string, unknown>);
  };
  return database.connection.isTransaction ? write() : database.transaction(write);
}

/** Asset writers increment the same revision as draft writers; original stages remain explicit. */
export function syncCharacterSnapshotAfterChange(database: ServiceDatabase, characterId: string, options?: { incrementRevision?: boolean }): CharacterVersion | null {
  const sync = () => {
    if (options?.incrementRevision) database.connection.prepare('UPDATE character_profiles SET draft_revision=draft_revision+1,updated_at=? WHERE id=?').run(nowIso(), characterId);
    const row = database.connection.prepare('SELECT draft_json,draft_revision,latest_version FROM character_profiles WHERE id=?').get(characterId) as Record<string, unknown> | undefined;
    if (!row || normalizeCharacterDraft(json(row.draft_json, {})).originType === 'original') return null;
    const previous = row.latest_version == null ? undefined : database.connection.prepare('SELECT * FROM character_versions WHERE character_id=? AND version=?').get(characterId, Number(row.latest_version)) as Record<string, unknown> | undefined;
    if (previous && Number(previous.draft_revision) === Number(row.draft_revision) && readStoredCharacterSnapshot(previous.data_json)) return mapCharacterVersion(previous);
    return publishCharacterSnapshot(database, characterId, { allowIncomplete: true });
  };
  return database.connection.isTransaction ? sync() : database.transaction(sync);
}
