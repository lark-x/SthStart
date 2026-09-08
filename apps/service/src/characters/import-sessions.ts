import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, unlink, writeFile } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import type {
  CharacterCardCompatibility,
  CharacterImportCandidate,
  CharacterImportSession,
} from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import { normalizeCharacterDraft } from './draft.js';
import { parseCharacterCard, CARD_PARSER_VERSION } from './card-parser.js';
import { mapCharacterCard, mapCharacterImage } from './card-mapper.js';
import { removeArtifact, streamUploadArtifact } from '../artifacts.js';
import type { CharacterCardProviderRegistry } from './source-providers/registry.js';
import type { CardRemoteDetail } from './source-providers/types.js';

const IMPORT_TTL_MS = 24 * 60 * 60_000;

function digest(value: unknown) {
  return createHash('sha256').update(value instanceof Uint8Array || typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function parseJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}

function sourceSnapshotRow(database: ServiceDatabase, id: string) {
  return database.connection.prepare('SELECT * FROM character_source_snapshots WHERE id=?').get(id) as Record<string, unknown> | undefined;
}

function mapSource(database: ServiceDatabase, snapshotId: string | null): Record<string, unknown> {
  if (!snapshotId) return { providerId: 'local', externalId: null, sourceUrl: null, author: null, remoteVersion: null, remoteUpdatedAt: null, payloadHash: null, format: null, fetchedAt: null };
  const row = sourceSnapshotRow(database, snapshotId);
  if (!row) return { providerId: 'unknown', externalId: null, sourceUrl: null, author: null, remoteVersion: null, remoteUpdatedAt: null, payloadHash: null, format: null, fetchedAt: null };
  return {
    providerId: String(row.provider_id),
    externalId: row.external_id == null ? null : String(row.external_id),
    sourceUrl: row.source_url == null ? null : String(row.source_url),
    author: row.author == null ? null : String(row.author),
    remoteVersion: row.remote_version == null ? null : String(row.remote_version),
    remoteUpdatedAt: row.remote_updated_at == null ? null : String(row.remote_updated_at),
    payloadHash: String(row.payload_hash),
    format: String(row.format),
    fetchedAt: String(row.fetched_at),
    parserVersion: String(row.parser_version),
  };
}

function sessionRow(database: ServiceDatabase, id: string) {
  return database.connection.prepare('SELECT * FROM character_import_sessions WHERE id=?').get(id) as Record<string, unknown> | undefined;
}

function mapSession(database: ServiceDatabase, row: Record<string, unknown>): CharacterImportSession {
  let status = String(row.status) as CharacterImportSession['status'];
  if (['fetching', 'parsing', 'ready'].includes(status) && Date.parse(String(row.expires_at)) <= Date.now()) {
    database.connection.prepare("UPDATE character_import_sessions SET status='expired',updated_at=? WHERE id=? AND status IN ('fetching','parsing','ready')").run(nowIso(), String(row.id));
    status = 'expired';
  }
  return {
    id: String(row.id),
    status,
    expiresAt: String(row.expires_at),
    previewRevision: Number(row.preview_revision),
    previewHash: String(row.preview_hash),
    candidate: parseJson<CharacterImportCandidate | null>(row.candidate_json, null),
    compatibility: parseJson<CharacterCardCompatibility | null>(row.compatibility_json, null),
    source: mapSource(database, row.source_snapshot_id ? String(row.source_snapshot_id) : null),
    targetCharacterId: row.target_character_id ? String(row.target_character_id) : null,
    baseDraftRevision: row.base_draft_revision == null ? null : Number(row.base_draft_revision),
    ...(row.commit_result_json ? { commitResult: parseJson<Record<string, unknown>>(row.commit_result_json, {}) } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function stageRawBytes(config: ServiceConfig, id: string, bytes: Buffer, mimeType: string) {
  const directory = resolve(config.artifactDirectory, 'characters', 'import-sessions');
  await mkdir(directory, { recursive: true });
  const extension = ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'application/json': '.json' } as Record<string, string>)[mimeType] || '.bin';
  const path = resolve(directory, `${id}${extension}`);
  await writeFile(path, bytes, { flag: 'wx' });
  return path;
}

export async function createCharacterImportSession(
  database: ServiceDatabase,
  config: ServiceConfig,
  providers: CharacterCardProviderRegistry,
  input: {
    operatorScope?: string;
    providerId?: string;
    externalId?: string;
    url?: string;
    card?: Record<string, unknown>;
    bytes?: Buffer;
    mimeType?: string;
    filename?: string;
    targetCharacterId?: string;
    baseDraftRevision?: number;
    idempotencyKey?: string;
  },
): Promise<CharacterImportSession> {
  const scope = input.operatorScope || 'admin';
  if (input.idempotencyKey) {
    const existing = database.connection.prepare('SELECT * FROM character_import_sessions WHERE operator_scope=? AND idempotency_key=?').get(scope, input.idempotencyKey) as Record<string, unknown> | undefined;
    if (existing) return mapSession(database, existing);
  }

  let providerId = input.providerId || 'local';
  let externalId = input.externalId || null;
  let sourceUrl = input.url || null;
  let detail: CardRemoteDetail | null = null;
  let bytes = input.bytes;
  let mimeType = input.mimeType || 'application/json';

  if (input.url && !input.card && !input.bytes) {
    for (const provider of providers.list()) {
      const supported = provider.parseSupportedUrl(input.url);
      if (supported) { providerId = provider.id; externalId = supported.externalId; break; }
    }
    if (!externalId || providerId === 'local') throw new Error('unsupported_character_card_url');
  }
  if (providerId !== 'local' && !bytes) {
    if (!externalId) throw new Error('external_id_required');
    const provider = providers.get(providerId);
    detail = await providers.detail(providerId, externalId, AbortSignal.timeout(10_000));
    const downloaded = await provider.download(externalId, AbortSignal.timeout(30_000));
    bytes = downloaded.bytes;
    mimeType = downloaded.contentType;
    sourceUrl = detail.sourceUrl;
  }
  if (!bytes && input.card) {
    bytes = Buffer.from(JSON.stringify(input.card));
    mimeType = 'application/json';
  }
  if (!bytes) throw new Error('character_card_payload_required');

  const parsed = parseCharacterCard({ bytes, mimeType });
  const sessionId = randomUUID();
  const stagedPath = await stageRawBytes(config, sessionId, bytes, parsed.mimeType);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + IMPORT_TTL_MS).toISOString();
  try {
    const mapped = parsed.card ? mapCharacterCard(parsed) : mapCharacterImage(parsed, input.filename);
    const payloadHash = digest(bytes);
    const cardData = parsed.card?.data && typeof parsed.card.data === 'object' ? parsed.card.data as Record<string, unknown> : parsed.card;
    const author = typeof cardData?.creator === 'string' ? cardData.creator : detail?.author ?? null;
    const remoteVersion = typeof cardData?.character_version === 'string' ? cardData.character_version : detail?.remoteVersion ?? null;
    const snapshotId = randomUUID();
    const existingSnapshot = database.connection.prepare('SELECT id FROM character_source_snapshots WHERE provider_id=? AND external_id IS ? AND payload_hash=?').get(providerId, externalId, payloadHash) as { id: string } | undefined;
    const effectiveSnapshotId = existingSnapshot?.id ?? snapshotId;
    const rawPayload = JSON.stringify({ card: parsed.card, remoteDetail: detail ? detail.card : null, mimeType: parsed.mimeType, width: parsed.width, height: parsed.height });
    const previewHash = digest({ candidate: mapped.candidate, compatibility: mapped.compatibility, payloadHash });
    database.transaction(() => {
      if (!existingSnapshot) database.connection.prepare(`INSERT INTO character_source_snapshots
          (id,provider_id,external_id,source_url,author,remote_version,remote_updated_at,fetched_at,payload_hash,format,parser_version,raw_file_path,raw_payload_json,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        snapshotId, providerId, externalId, sourceUrl, author, remoteVersion,
        detail?.remoteUpdatedAt ?? null, createdAt, payloadHash, parsed.format, CARD_PARSER_VERSION, stagedPath, rawPayload, createdAt,
      );
      database.connection.prepare(`INSERT INTO character_import_sessions
        (id,operator_scope,status,expires_at,source_snapshot_id,preview_revision,preview_hash,candidate_json,compatibility_json,target_character_id,base_draft_revision,commit_result_json,idempotency_key,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        sessionId, scope, 'ready', expiresAt, effectiveSnapshotId, 1, previewHash, JSON.stringify(mapped.candidate), JSON.stringify(mapped.compatibility),
        input.targetCharacterId ?? null, input.baseDraftRevision ?? null, null, input.idempotencyKey ?? null, createdAt, createdAt,
      );
    });
    if (existingSnapshot) await unlink(stagedPath).catch(() => undefined);
    return mapSession(database, sessionRow(database, sessionId)!);
  } catch (error) {
    await unlink(stagedPath).catch(() => undefined);
    throw error;
  }
}

export function getCharacterImportSession(database: ServiceDatabase, id: string) {
  const row = sessionRow(database, id);
  return row ? mapSession(database, row) : null;
}

export function updateCharacterImportSession(
  database: ServiceDatabase,
  id: string,
  input: { expectedPreviewRevision: number; candidatePatch?: Record<string, unknown>; cover?: Partial<CharacterImportCandidate['cover']> },
) {
  const row = sessionRow(database, id);
  if (!row) throw new Error('import_session_not_found');
  const session = mapSession(database, row);
  if (session.status === 'expired' || session.status === 'cancelled' || session.status === 'committed') throw new Error(`import_session_${session.status}`);
  if (session.previewRevision !== input.expectedPreviewRevision) throw new Error('import_preview_conflict');
  if (!session.candidate) throw new Error('import_candidate_missing');
  const candidate = JSON.parse(JSON.stringify(session.candidate)) as CharacterImportCandidate;
  const patch = input.candidatePatch || {};
  if (patch.draft && typeof patch.draft === 'object' && !Array.isArray(patch.draft)) {
    const before = candidate.draft;
    const draftPatch = patch.draft as Record<string, unknown>;
    candidate.draft = normalizeCharacterDraft({ ...before, ...draftPatch,
      appearance: { ...before.appearance, ...(draftPatch.appearance as object ?? {}) },
      speech: { ...before.speech, ...(draftPatch.speech as object ?? {}) },
    });
    for (const [key, value] of Object.entries(candidate.draft)) {
      const fields = key === 'appearance' || key === 'speech'
        ? Object.entries(value as Record<string, unknown>).map(([child, childValue]) => ({ path: `/${key}/${child}`, value: childValue, old: (before[key] as unknown as Record<string, unknown>)[child] }))
        : [{ path: `/${key}`, value, old: before[key as keyof typeof before] }];
      for (const field of fields) {
        if (digest(field.value) === digest(field.old ?? null)) continue;
        candidate.mappings = candidate.mappings.filter((mapping) => mapping.fieldPath !== field.path);
        candidate.mappings.push({ fieldPath: field.path, valueHash: digest(field.value), status: 'user_edit', sourcePointer: '', note: '导入预览中修改' });
      }
    }
  }
  if (input.cover) candidate.cover = { ...candidate.cover, ...input.cover };
  const previewRevision = session.previewRevision + 1;
  const previewHash = digest({ candidate, compatibility: session.compatibility });
  const updateResult = database.connection.prepare('UPDATE character_import_sessions SET preview_revision=?,preview_hash=?,candidate_json=?,updated_at=? WHERE id=? AND preview_revision=?')
    .run(previewRevision, previewHash, JSON.stringify(candidate), nowIso(), id, input.expectedPreviewRevision);
  if (Number(updateResult.changes) !== 1) throw new Error('import_preview_conflict');
  return mapSession(database, sessionRow(database, id)!);
}

function selectedCoverPath(database: ServiceDatabase, snapshotId: string | null) {
  if (!snapshotId) return null;
  const row = sourceSnapshotRow(database, snapshotId);
  return row?.raw_file_path ? String(row.raw_file_path) : null;
}

function isImportSessionPath(config: ServiceConfig, path: string | null) {
  if (!path) return false;
  const stagingDirectory = resolve(config.artifactDirectory, 'characters', 'import-sessions');
  const relativePath = relative(stagingDirectory, resolve(path));
  return relativePath.length > 0 && relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !relativePath.startsWith(sep);
}

function snapshotMediaMeta(database: ServiceDatabase, snapshotId: string | null) {
  if (!snapshotId) return { mimeType: 'image/png', width: null as number | null, height: null as number | null };
  const row = sourceSnapshotRow(database, snapshotId);
  const raw = row ? parseJson<Record<string, unknown>>(row.raw_payload_json, {}) : {};
  return {
    mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : 'image/png',
    width: Number.isSafeInteger(raw.width) ? Number(raw.width) : null,
    height: Number.isSafeInteger(raw.height) ? Number(raw.height) : null,
  };
}

function canDeleteSourceSnapshot(database: ServiceDatabase, snapshotId: string, excludingSessionId?: string) {
  const activeSession = database.connection.prepare(`SELECT COUNT(*) AS count
    FROM character_import_sessions
    WHERE source_snapshot_id=? AND id<>? AND status NOT IN ('cancelled','expired','failed')`).get(snapshotId, excludingSessionId ?? '') as { count: number };
  const fieldReference = database.connection.prepare('SELECT COUNT(*) AS count FROM character_field_provenance WHERE source_snapshot_id=?').get(snapshotId) as { count: number };
  return Number(activeSession.count) === 0 && Number(fieldReference.count) === 0;
}

export async function commitCharacterImportSession(
  database: ServiceDatabase,
  config: ServiceConfig,
  id: string,
  input: {
    expectedPreviewRevision: number;
    previewHash?: string;
    idempotencyKey: string;
    targetCharacterId?: string | null;
    baseDraftRevision?: number | null;
  },
) {
  const row = sessionRow(database, id);
  if (!row) throw new Error('import_session_not_found');
  if (row.commit_result_json) {
    if (row.idempotency_key && row.idempotency_key !== input.idempotencyKey) throw new Error('import_idempotency_conflict');
    return parseJson<Record<string, unknown>>(row.commit_result_json, {});
  }
  const session = mapSession(database, row);
  if (session.status !== 'ready') throw new Error(`import_session_${session.status}`);
  if (session.previewRevision !== input.expectedPreviewRevision || (input.previewHash && session.previewHash !== input.previewHash)) throw new Error('import_preview_conflict');
  const candidate = session.candidate;
  if (!candidate) throw new Error('import_candidate_missing');

  const targetId = input.targetCharacterId ?? session.targetCharacterId;
  const profile = targetId ? database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(targetId) as Record<string, unknown> | undefined : undefined;
  if (targetId && !profile) throw new Error('character_not_found');
  const expectedRevision = input.baseDraftRevision ?? session.baseDraftRevision;
  if (targetId && expectedRevision == null) throw new Error('base_draft_revision_required');
  if (targetId && Number(profile?.draft_revision ?? 1) !== Number(expectedRevision)) throw new Error('draft_revision_conflict');

  const snapshotId = row.source_snapshot_id ? String(row.source_snapshot_id) : null;
  const stagedPath = selectedCoverPath(database, snapshotId);
  const isImage = Boolean(candidate.cover.available && stagedPath && /\.(png|jpe?g|webp|gif|avif)$/i.test(stagedPath));
  const now = nowIso();
  const characterId = targetId || randomUUID();
  const newDraftRevision = targetId ? Number(profile?.draft_revision ?? 1) + 1 : 1;
  // Updating an existing character only replaces fields supplied by this card
  // or explicitly edited in the preview, preserving unrelated detailed settings.
  const merged = profile ? normalizeCharacterDraft(JSON.parse(String(profile.draft_json))) : candidate.draft;
  if (profile) for (const mapping of candidate.mappings) {
    const parts = mapping.fieldPath.split('/').filter(Boolean);
    if (parts.length === 1 && Object.hasOwn(candidate.draft, parts[0])) {
      (merged as unknown as Record<string, unknown>)[parts[0]] = (candidate.draft as unknown as Record<string, unknown>)[parts[0]];
    } else if (parts.length === 2 && (parts[0] === 'appearance' || parts[0] === 'speech') && Object.hasOwn(candidate.draft[parts[0]], parts[1])) {
      (merged[parts[0]] as unknown as Record<string, unknown>)[parts[1]] = (candidate.draft[parts[0]] as unknown as Record<string, unknown>)[parts[1]];
    }
  }
  const draft = normalizeCharacterDraft(merged);
  if (!draft.displayName) throw new Error('display_name_required');
  const assetId = (candidate.cover.selectedForAvatar || candidate.cover.selectedForReference) && isImage ? randomUUID() : null;
  const avatarAssetId = candidate.cover.selectedForAvatar ? assetId : null;
  const assetKind = candidate.cover.selectedForAvatar ? 'avatar' : 'reference';
  const formalSourcePath = snapshotId && stagedPath
    ? resolve(config.artifactDirectory, 'characters', 'source-snapshots', `${snapshotId}${extname(stagedPath) || '.bin'}`)
    : null;
  const importSessionPath = isImportSessionPath(config, stagedPath);
  const mediaMeta = snapshotMediaMeta(database, snapshotId);
  const sourcePayloadHash = typeof session.source.payloadHash === 'string' ? session.source.payloadHash : String(row.preview_hash);
  const sourceUrl = typeof session.source.sourceUrl === 'string' ? session.source.sourceUrl : null;
  const providerId = typeof session.source.providerId === 'string' ? session.source.providerId : 'local';
  const externalId = typeof session.source.externalId === 'string' ? session.source.externalId : null;
  let assetArtifactId: string | null = null;
  let assetArtifactPath: string | null = null;
  let assetByteSize = 0;
  let formalSourceCopied = false;
  try {
    if (formalSourcePath && stagedPath && formalSourcePath !== stagedPath) {
      await mkdir(resolve(config.artifactDirectory, 'characters', 'source-snapshots'), { recursive: true });
      await copyFile(stagedPath, formalSourcePath);
      formalSourceCopied = true;
    }

    if (assetId && stagedPath) {
      const artifact = await streamUploadArtifact(config, database, {
        appId: 'characters', stream: createReadStream(stagedPath), contentType: mediaMeta.mimeType,
        originalName: `character-card-${characterId}${extname(stagedPath) || '.png'}`, refType: 'character-asset', refId: assetId,
        metadata: { characterId, kind: assetKind, sourceSnapshotId: snapshotId },
      });
      assetArtifactId = artifact.id;
      assetByteSize = artifact.byteSize;
      assetArtifactPath = (database.connection.prepare('SELECT local_path FROM artifacts WHERE id=?').get(artifact.id) as { local_path: string | null } | undefined)?.local_path ?? null;
    }

    const result = database.transaction(() => {
      if (targetId) {
        const latest = database.connection.prepare('SELECT draft_revision FROM character_profiles WHERE id=?').get(targetId) as { draft_revision: number } | undefined;
        if (latest?.draft_revision !== expectedRevision) throw new Error('draft_revision_conflict');
      }
      if (!targetId) {
        database.connection.prepare(`INSERT INTO character_profiles
          (id,slug,display_name,draft_json,tags_json,avatar_asset_id,latest_version,archived,created_at,updated_at,draft_revision,default_outfit_id)
          VALUES (?,?,?,?,?,NULL,NULL,0,?,?,?,NULL)`).run(characterId, `character-${characterId.slice(0, 8)}`, draft.displayName, JSON.stringify(draft), '[]', now, now, newDraftRevision);
      }
      database.connection.prepare(`UPDATE character_profiles SET display_name=?,draft_json=?,updated_at=?,draft_revision=?${avatarAssetId ? ',avatar_asset_id=?' : ''} WHERE id=?`)
        .run(...(avatarAssetId ? [draft.displayName, JSON.stringify(draft), now, newDraftRevision, avatarAssetId, characterId] : [draft.displayName, JSON.stringify(draft), now, newDraftRevision, characterId]));
      if (assetId && stagedPath && assetArtifactId) {
        database.connection.prepare(`INSERT INTO character_assets
          (id,character_id,kind,local_path,content_type,byte_size,original_name,created_at,artifact_id,sha256,width,height,source_page,source_url,author_note,user_note,purposes_json,outfit_id,enabled,crop_json)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          assetId, characterId, assetKind, assetArtifactPath || '', mediaMeta.mimeType, assetByteSize, `character-card-${characterId}${extname(stagedPath!) || '.png'}`, now,
          assetArtifactId, assetArtifactId ? (database.connection.prepare('SELECT sha256 FROM artifacts WHERE id=?').get(assetArtifactId) as { sha256: string | null } | undefined)?.sha256 ?? sourcePayloadHash : sourcePayloadHash,
          mediaMeta.width, mediaMeta.height, sourceUrl, sourceUrl, '', '', JSON.stringify([...(candidate.cover.selectedForAvatar ? ['avatar'] : []), ...(candidate.cover.selectedForReference ? ['identity'] : [])]), null, 1, null,
        );
        if (candidate.cover.selectedForReference) {
          database.connection.prepare(`INSERT INTO character_visual_references
            (id,character_id,asset_id,artifact_id,sha256,purposes_json,outfit_id,source_page,original_url,author_note,user_note,enabled,crop_json,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            randomUUID(), characterId, assetId, assetArtifactId, assetArtifactId ? (database.connection.prepare('SELECT sha256 FROM artifacts WHERE id=?').get(assetArtifactId) as { sha256: string | null } | undefined)?.sha256 ?? sourcePayloadHash : sourcePayloadHash, JSON.stringify(['identity']), null, sourceUrl, sourceUrl, '', '', 1, null, now, now,
          );
        }
      }
      const sourceId = randomUUID();
      database.connection.prepare(`INSERT INTO character_sources
        (id,character_id,title,url,excerpt,source_type,fetched_at,provider_id,external_id,payload_hash,source_snapshot_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
        sourceId, characterId, `角色卡：${draft.displayName}`, sourceUrl, draft.identity.slice(0, 12_000), providerId === 'local' ? 'tavern-card' : 'character-tavern', now,
        providerId, externalId, sourcePayloadHash, snapshotId,
      );
      for (const mapping of candidate.mappings) {
        database.connection.prepare(`INSERT INTO character_field_provenance
          (id,character_id,version,field_path,value_hash,source_kind,source_snapshot_id,source_pointer,evidence_json,derived_from_json,confirmed,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          randomUUID(), characterId, null, mapping.fieldPath, mapping.valueHash, mapping.status, snapshotId, mapping.sourcePointer, JSON.stringify({ note: mapping.note ?? null }), '[]', 1, now,
        );
      }
      const commitResult = { characterId, created: !targetId, draftRevision: newDraftRevision, sourceSnapshotId: snapshotId, version: null };
      if (formalSourcePath && snapshotId) database.connection.prepare('UPDATE character_source_snapshots SET raw_file_path=? WHERE id=?').run(formalSourcePath, snapshotId);
      const commitUpdate = database.connection.prepare("UPDATE character_import_sessions SET status='committed',target_character_id=?,commit_result_json=?,idempotency_key=?,updated_at=? WHERE id=? AND status='ready'")
        .run(characterId, JSON.stringify(commitResult), input.idempotencyKey, now, id);
      if (Number(commitUpdate.changes) !== 1) throw new Error('import_commit_conflict');
      return commitResult;
    });
    if (importSessionPath) await unlink(stagedPath!).catch(() => undefined);
    return result;
  } catch (error) {
    if (assetArtifactId) await removeArtifact(database, assetArtifactId, 'characters', true).catch(() => undefined);
    if (formalSourceCopied && formalSourcePath) {
      const referenced = database.connection.prepare("SELECT 1 FROM character_import_sessions WHERE source_snapshot_id=? AND status='committed'").get(snapshotId);
      if (!referenced) await unlink(formalSourcePath).catch(() => undefined);
    }
    throw error;
  }
}

export async function cancelCharacterImportSession(database: ServiceDatabase, id: string) {
  const row = sessionRow(database, id);
  if (!row) return false;
  if (row.status === 'committed') throw new Error('import_session_committed');
  const path = row.source_snapshot_id ? selectedCoverPath(database, String(row.source_snapshot_id)) : null;
  let deleteSnapshot = false;
  database.transaction(() => {
    deleteSnapshot = Boolean(row.source_snapshot_id && canDeleteSourceSnapshot(database, String(row.source_snapshot_id), id));
    database.connection.prepare("UPDATE character_import_sessions SET status='cancelled',updated_at=? WHERE id=? AND status NOT IN ('committed','cancelled')").run(nowIso(), id);
    if (deleteSnapshot && row.source_snapshot_id) database.connection.prepare('DELETE FROM character_source_snapshots WHERE id=?').run(String(row.source_snapshot_id));
  });
  if (deleteSnapshot && path) await unlink(path).catch(() => undefined);
  return true;
}

export function cleanupExpiredCharacterImportSessions(database: ServiceDatabase) {
  const rows = database.connection.prepare("SELECT id,source_snapshot_id FROM character_import_sessions WHERE status IN ('fetching','parsing','ready') AND expires_at <= ?").all(nowIso()) as Array<{ id: string; source_snapshot_id: string | null }>;
  return Promise.all(rows.map(async (row) => {
    const path = row.source_snapshot_id ? selectedCoverPath(database, row.source_snapshot_id) : null;
    let deleteSnapshot = false;
    database.transaction(() => {
      deleteSnapshot = Boolean(row.source_snapshot_id && canDeleteSourceSnapshot(database, row.source_snapshot_id, row.id));
      database.connection.prepare("UPDATE character_import_sessions SET status='expired',updated_at=? WHERE id=? AND status IN ('fetching','parsing','ready')").run(nowIso(), row.id);
      if (deleteSnapshot && row.source_snapshot_id) database.connection.prepare('DELETE FROM character_source_snapshots WHERE id=?').run(row.source_snapshot_id);
    });
    if (deleteSnapshot && path) await unlink(path).catch(() => undefined);
    return true;
  }));
}
