import crypto from 'node:crypto';
import type { ActorSnapshot } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';

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
     FROM character_profiles
     WHERE archived = 0
     ORDER BY updated_at DESC`
  ).all() as Record<string, unknown>[];

  return rows.map((r) => {
    let summary = '';
    try {
      const draft = JSON.parse(String(r.draft_json));
      summary = draft.summary || draft.identity || '';
    } catch {}

    return {
      id: String(r.id),
      slug: String(r.slug),
      displayName: String(r.display_name),
      summary,
      latestVersion: r.latest_version ? Number(r.latest_version) : null,
      avatarAssetId: r.avatar_asset_id ? String(r.avatar_asset_id) : null,
    };
  });
}

export function createActorSnapshotFromCharacter(
  database: ServiceDatabase,
  characterId: string,
  overrides: {
    activityRole?: string;
    outfitDescription?: string;
    avatarAssetKey?: string;
  } = {}
): ActorSnapshot | null {
  const profileRow = database.connection.prepare(
    `SELECT id, slug, display_name, draft_json, latest_version, avatar_asset_id
     FROM character_profiles WHERE id = ?`
  ).get(characterId) as Record<string, unknown> | undefined;

  if (!profileRow) return null;

  let persona: Record<string, unknown> = {};
  let sourceVersion: number | undefined;

  // Try reading published latest version first
  if (profileRow.latest_version) {
    const revRow = database.connection.prepare(
      `SELECT version, data_json FROM character_revisions
       WHERE character_id = ? AND version = ?`
    ).get(characterId, Number(profileRow.latest_version)) as Record<string, unknown> | undefined;

    if (revRow) {
      sourceVersion = Number(revRow.version);
      try {
        persona = JSON.parse(String(revRow.data_json));
      } catch {}
    }
  }

  // Fallback to draft_json
  if (Object.keys(persona).length === 0) {
    try {
      persona = JSON.parse(String(profileRow.draft_json));
    } catch {
      persona = {};
    }
  }

  const actorId = `actor_${crypto.randomUUID().slice(0, 8)}`;
  const displayName = String(profileRow.display_name || persona.displayName || '角色');

  // Check avatar artifact
  let avatarAssetKey: string | undefined = overrides.avatarAssetKey;
  if (!avatarAssetKey && profileRow.avatar_asset_id) {
    avatarAssetKey = `asset_avatar_${actorId}`;
  }

  return {
    id: actorId,
    sourceCharacterId: String(profileRow.id),
    sourceVersion,
    displayName,
    persona,
    avatarAssetKey,
    activityRole: overrides.activityRole || '活动参与者',
    outfitDescription: overrides.outfitDescription || String((persona.appearance as Record<string, unknown>)?.description || '日常便服'),
    appearanceReferenceAssetKeys: [],
  };
}

export function extractCharacterPersonaDraft(
  database: ServiceDatabase,
  characterId: string,
  version?: number,
): Record<string, unknown> | null {
  const profileRow = database.connection.prepare(
    `SELECT draft_json, latest_version FROM character_profiles WHERE id = ?`
  ).get(characterId) as { draft_json: string; latest_version: number | null } | undefined;

  if (!profileRow) return null;

  if (version || profileRow.latest_version) {
    const v = version ?? profileRow.latest_version;
    const revRow = database.connection.prepare(
      `SELECT data_json FROM character_revisions WHERE character_id = ? AND version = ?`
    ).get(characterId, v) as { data_json: string } | undefined;
    if (revRow) {
      try {
        return JSON.parse(revRow.data_json);
      } catch {}
    }
  }

  try {
    return JSON.parse(profileRow.draft_json);
  } catch {
    return null;
  }
}

