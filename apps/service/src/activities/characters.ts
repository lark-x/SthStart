import crypto from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import type { ActorSnapshot, ActivityAsset, ContentDocument } from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import { createArtifactReference, streamUploadArtifact } from '../artifacts.js';
import { normalizeCharacterDraft } from '../characters/draft.js';
import { normalizeCharacterAppearance, projectCharacterPersona } from '../characters/persona-compiler.js';

export function listAvailableCharacters(database: ServiceDatabase): {
  id: string;
  slug: string;
  displayName: string;
  summary: string;
  latestVersion: number | null;
  avatarAssetId: string | null;
}[] {
  const rows = database.connection.prepare(
    `SELECT id, slug, display_name, draft_json, latest_version, avatar_asset_id
     FROM character_profiles WHERE archived = 0 ORDER BY updated_at DESC`
  ).all() as Record<string, unknown>[];

  return rows.map((row) => {
    let summary = '';
    try {
      const draft = JSON.parse(String(row.draft_json)) as Record<string, unknown>;
      summary = typeof draft.summary === 'string' ? draft.summary : typeof draft.identity === 'string' ? draft.identity : '';
    } catch { /* malformed legacy row */ }
    return {
      id: String(row.id), slug: String(row.slug), displayName: String(row.display_name), summary,
      latestVersion: row.latest_version == null ? null : Number(row.latest_version), avatarAssetId: row.avatar_asset_id ? String(row.avatar_asset_id) : null,
    };
  });
}

function parseDraft(value: unknown) {
  try { return normalizeCharacterDraft(JSON.parse(String(value))); } catch { return normalizeCharacterDraft({}); }
}

function characterVersionRow(database: ServiceDatabase, characterId: string, version: number | null | undefined) {
  const profile = database.connection.prepare('SELECT * FROM character_profiles WHERE id=? AND archived=0').get(characterId) as Record<string, unknown> | undefined;
  if (!profile) return null;
  if (version === null) return { profile, version: null, draft: parseDraft(profile.draft_json), draftRevision: Number(profile.draft_revision ?? 1), appearanceSnapshot: null, status: 'draft' as const };
  const selectedVersion = version === undefined ? (profile.latest_version == null ? null : Number(profile.latest_version)) : version;
  if (selectedVersion === null) return { profile, version: null, draft: parseDraft(profile.draft_json), draftRevision: Number(profile.draft_revision ?? 1), appearanceSnapshot: null, status: 'draft' as const };
  const row = database.connection.prepare('SELECT version,data_json,draft_revision,appearance_snapshot_json FROM character_versions WHERE character_id=? AND version=?').get(characterId, selectedVersion) as { version: number; data_json: string; draft_revision?: number; appearance_snapshot_json?: string } | undefined;
  if (!row) return null;
  let appearanceSnapshot: Record<string, unknown> | null = null;
  if (row.appearance_snapshot_json && row.appearance_snapshot_json !== '{}') {
    try { appearanceSnapshot = JSON.parse(row.appearance_snapshot_json) as Record<string, unknown>; } catch { appearanceSnapshot = null; }
  }
  return { profile, version: Number(row.version), draft: parseDraft(row.data_json), draftRevision: Number(row.draft_revision ?? profile.draft_revision ?? 1), appearanceSnapshot, status: 'published' as const };
}

export function createActorSnapshotFromCharacter(
  database: ServiceDatabase,
  characterId: string,
  overrides: { activityRole?: string; outfitDescription?: string; avatarAssetKey?: string; sourceVersion?: number | null } = {},
): ActorSnapshot | null {
  const selected = characterVersionRow(database, characterId, overrides.sourceVersion);
  if (!selected) return null;
  const { profile, draft, version, draftRevision, appearanceSnapshot, status } = selected;
  const appearance = normalizeCharacterAppearance(draft.appearance);
  const referenceIds = Array.isArray(appearanceSnapshot?.referenceIds)
    ? appearanceSnapshot.referenceIds.filter((value): value is string => typeof value === 'string')
    : null;
  const referenceRows = referenceIds
    ? (referenceIds.length ? database.connection.prepare(`SELECT id,asset_id FROM character_visual_references WHERE character_id=? AND enabled=1 AND id IN (${referenceIds.map(() => '?').join(',')})`).all(characterId, ...referenceIds) as Array<{ id: string; asset_id: string }> : [])
    : database.connection.prepare(`SELECT id,asset_id FROM character_visual_references WHERE character_id=? AND enabled=1 ORDER BY created_at DESC`).all(characterId) as Array<{ id: string; asset_id: string }>;
  const referenceById = new Map(referenceRows.map((row) => [row.id, row.asset_id]));
  const orderedReferenceAssetIds = referenceIds ? referenceIds.flatMap((id) => { const assetId = referenceById.get(id); return assetId ? [assetId] : []; }) : referenceRows.map((row) => String(row.asset_id));
  const actorId = `actor_${crypto.randomUUID().slice(0, 8)}`;
  const frozenAvatar = appearanceSnapshot && Object.hasOwn(appearanceSnapshot, 'avatarAssetId') ? appearanceSnapshot.avatarAssetId : profile.avatar_asset_id;
  const avatarAssetId = frozenAvatar ? String(frozenAvatar) : undefined;
  const projected = projectCharacterPersona(draft);
  const selectedOutfit = appearance.defaultOutfitId && appearance.outfits.includes(appearance.defaultOutfitId)
    ? appearance.defaultOutfitId
    : appearance.outfits[0] || '';
  return {
    id: actorId,
    sourceCharacterId: String(profile.id),
    ...(version == null ? {} : { sourceVersion: version }),
    sourceVersionStatus: status,
    characterDraftRevision: draftRevision,
    displayName: draft.displayName || String(profile.display_name || '角色'),
    persona: projected,
    ...(overrides.avatarAssetKey ? { avatarAssetKey: overrides.avatarAssetKey } : {}),
    ...(avatarAssetId ? { avatarAssetId } : {}),
    ...(avatarAssetId ? { avatarUrl: `/api/admin/characters/assets/${avatarAssetId}` } : {}),
    activityRole: overrides.activityRole?.trim() || '活动参与者',
    outfitDescription: overrides.outfitDescription?.trim() || selectedOutfit,
    appearanceReferenceAssetKeys: [],
    appearanceReferenceAssetIds: orderedReferenceAssetIds,
  };
}

export function extractCharacterPersonaDraft(database: ServiceDatabase, characterId: string, version?: number): Record<string, unknown> | null {
  const selected = characterVersionRow(database, characterId, version);
  return selected ? selected.draft as unknown as Record<string, unknown> : null;
}

export async function transferCharacterReferenceToActivity(
  config: ServiceConfig,
  database: ServiceDatabase,
  input: { activityId: string; characterId: string; version?: number | null; referenceId: string; idempotencyKey: string },
): Promise<ActivityAsset> {
  if (!database.connection.prepare('SELECT 1 FROM activities WHERE id=?').get(input.activityId)) throw new Error('activity_not_found');
  const selected = characterVersionRow(database, input.characterId, input.version);
  if (!selected) throw new Error('character_version_not_found');
  if (selected.appearanceSnapshot && Array.isArray(selected.appearanceSnapshot.referenceIds) && !selected.appearanceSnapshot.referenceIds.includes(input.referenceId)) throw new Error('reference_not_in_character_version');
  const row = database.connection.prepare(`SELECT r.id,r.asset_id,r.artifact_id,r.sha256,a.local_path,a.content_type,a.artifact_id AS asset_artifact_id
    FROM character_visual_references r JOIN character_assets a ON a.id=r.asset_id
    WHERE r.id=? AND r.character_id=? AND r.enabled=1`).get(input.referenceId, input.characterId) as Record<string, unknown> | undefined;
  if (!row) throw new Error('reference_not_found');

  const existing = database.connection.prepare('SELECT * FROM activity_character_asset_transfers WHERE activity_id=? AND idempotency_key=?').get(input.activityId, input.idempotencyKey) as Record<string, unknown> | undefined;
  if (existing) {
    const asset = database.connection.prepare('SELECT a.*,art.byte_size FROM activity_assets a JOIN artifacts art ON art.id=a.artifact_id WHERE a.activity_id=? AND a.asset_key=?').get(input.activityId, String(existing.asset_key)) as Record<string, unknown> | undefined;
    if (asset) return {
      id: String(asset.asset_key), activityId: input.activityId, assetKey: String(asset.asset_key), artifactId: String(asset.artifact_id), source: 'link',
      type: String(asset.type) as ActivityAsset['type'], byteSize: Number(asset.byte_size ?? 0), sha256: String(asset.hash ?? ''), hash: String(asset.hash ?? ''),
      width: asset.width == null ? undefined : Number(asset.width), height: asset.height == null ? undefined : Number(asset.height), createdAt: String(asset.created_at),
    };
  }

  const existingBySource = database.connection.prepare('SELECT * FROM activity_character_asset_transfers WHERE activity_id=? AND source_reference_id=? AND sha256=?').get(input.activityId, input.referenceId, String(row.sha256)) as Record<string, unknown> | undefined;
  if (existingBySource) {
    const asset = database.connection.prepare('SELECT a.*,art.byte_size FROM activity_assets a JOIN artifacts art ON art.id=a.artifact_id WHERE a.activity_id=? AND a.asset_key=?').get(input.activityId, String(existingBySource.asset_key)) as Record<string, unknown> | undefined;
    if (asset) return {
      id: String(asset.asset_key), activityId: input.activityId, assetKey: String(asset.asset_key), artifactId: String(asset.artifact_id), source: 'link',
      type: String(asset.type) as ActivityAsset['type'], byteSize: Number(asset.byte_size ?? 0), sha256: String(asset.hash ?? ''), hash: String(asset.hash ?? ''),
      width: asset.width == null ? undefined : Number(asset.width), height: asset.height == null ? undefined : Number(asset.height), createdAt: String(asset.created_at),
    };
  }

  const sourceArtifactId = row.artifact_id ? String(row.artifact_id) : row.asset_artifact_id ? String(row.asset_artifact_id) : null;
  if (!sourceArtifactId) throw new Error('reference_artifact_missing');
  const sourceArtifact = sourceArtifactId ? database.connection.prepare("SELECT app_id,local_path,content_type,original_name,file_status FROM artifacts WHERE id=?").get(sourceArtifactId) as Record<string, unknown> | undefined : undefined;
  if (sourceArtifact && String(sourceArtifact.app_id) !== 'characters') throw new Error('reference_artifact_owner_mismatch');
  if (sourceArtifact && String(sourceArtifact.file_status) !== 'ready') throw new Error('reference_artifact_unavailable');
  const sourceContentType = String(sourceArtifact?.content_type ?? row.content_type ?? 'image/png').split(';')[0].trim().toLowerCase();
  if (!sourceContentType.startsWith('image/')) throw new Error('reference_media_type_unsupported');
  const sourcePath = sourceArtifact?.local_path ? String(sourceArtifact.local_path) : row.local_path ? String(row.local_path) : null;
  if (!sourcePath || !existsSync(sourcePath)) throw new Error('reference_file_not_found');
  const artifact = await streamUploadArtifact(config, database, {
    appId: 'activities', stream: createReadStream(sourcePath), contentType: sourceContentType,
    originalName: String(sourceArtifact?.original_name ?? `character-reference-${input.referenceId}.png`), metadata: {
      source: 'character-reference-transfer', sourceCharacterId: input.characterId, sourceVersion: selected.version, sourceReferenceId: input.referenceId,
    },
  });
  const assetKey = `character_ref_${input.referenceId.slice(0, 12)}`;
  const now = nowIso();
  database.transaction(() => {
    database.connection.prepare(`INSERT INTO activity_assets
      (activity_id,asset_key,artifact_id,source,type,width,height,duration_ms,hash,created_at)
      VALUES (?,?,?,'link',?,?,?,?,?,?)`).run(input.activityId, assetKey, artifact.id, artifact.mediaType ?? 'image', artifact.width ?? null, artifact.height ?? null, null, artifact.sha256 ?? String(row.sha256), now);
    createArtifactReference(database, { artifactId: artifact.id, appId: 'activities', refType: 'activity_asset', refId: assetKey });
    database.connection.prepare(`INSERT INTO activity_character_asset_transfers
      (id,activity_id,source_character_id,source_version,source_reference_id,source_artifact_id,target_artifact_id,asset_key,sha256,idempotency_key,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), input.activityId, input.characterId, selected.version, input.referenceId, sourceArtifactId, artifact.id, assetKey, artifact.sha256 ?? String(row.sha256), input.idempotencyKey, now);
  });
  return {
    id: assetKey, activityId: input.activityId, assetKey, artifactId: artifact.id, source: 'link', type: (artifact.mediaType ?? 'image') as ActivityAsset['type'],
    byteSize: artifact.byteSize, sha256: artifact.sha256 ?? undefined, hash: artifact.sha256 ?? undefined, width: artifact.width ?? undefined, height: artifact.height ?? undefined, createdAt: now,
  };
}

/** Register character avatars in the activity package before freezing content. */
export async function materializeCharacterAvatars(config: ServiceConfig, database: ServiceDatabase, activityId: string, document: ContentDocument): Promise<ContentDocument> {
  let changed = false;
  const actors: ActorSnapshot[] = [];
  for (const actor of document.actors) {
    if (actor.avatarAssetKey || !actor.avatarAssetId || !actor.sourceCharacterId) { actors.push(actor); continue; }
    const source = database.connection.prepare(`SELECT a.local_path,a.content_type,a.artifact_id,art.file_status,art.local_path AS artifact_path
      FROM character_assets a LEFT JOIN artifacts art ON art.id=a.artifact_id WHERE a.id=? AND a.character_id=?`).get(actor.avatarAssetId, actor.sourceCharacterId) as Record<string, unknown> | undefined;
    const path = source?.artifact_id ? source.artifact_path : source?.local_path;
    if (!source || typeof path !== 'string' || !existsSync(path) || (source.artifact_id && source.file_status !== 'ready')) { actors.push(actor); continue; }
    const assetKey = `character_avatar_${actor.avatarAssetId}`;
    const existing = database.connection.prepare('SELECT artifact_id FROM activity_assets WHERE activity_id=? AND asset_key=?').get(activityId, assetKey);
    if (!existing) {
      const artifact = await streamUploadArtifact(config, database, { appId: 'activities', stream: createReadStream(path), contentType: String(source.content_type), originalName: `${assetKey}.png`, metadata: { sourceCharacterId: actor.sourceCharacterId, sourceVersion: actor.sourceVersion, sourceAssetId: actor.avatarAssetId } });
      database.transaction(() => {
        database.connection.prepare(`INSERT INTO activity_assets (activity_id,asset_key,artifact_id,source,type,width,height,duration_ms,hash,created_at)
          VALUES (?,?,?,'link','image',?,?,NULL,?,?)`).run(activityId, assetKey, artifact.id, artifact.width ?? null, artifact.height ?? null, artifact.sha256 ?? null, nowIso());
        createArtifactReference(database, { artifactId: artifact.id, appId: 'activities', refType: 'activity_asset', refId: `${activityId}:${assetKey}` });
      });
    }
    actors.push({ ...actor, avatarAssetKey: assetKey });
    changed = true;
  }
  return changed ? { ...document, actors } : document;
}
