import { browseCharacters, canonicalWork, editCharacterOrganization, normalizeOrganization, upsertCharacterWorkHierarchy } from './characters/organization.js';
import type { OrganizationEdit } from './characters/organization.js';
import type {
  CharacterBrowseQuery,
  CharacterFamilyMemberSummary,
  CharacterForkDerivativeRequest,
  CharacterOriginType,
  CharacterWork,
} from '@sthstart/contracts';
import { createHash, randomUUID } from 'node:crypto';
import {
  CharacterAvatarGenerationRequestSchema,
  CharacterBatchAvatarRequestSchema,
  CharacterBatchEnrichRpRequestSchema,
  CharacterBatchImportLocalCardsRequestSchema,
  CharacterForkDerivativeRequestSchema,
  CharacterUpstreamApplyRequestSchema,
  CharacterUpstreamResearchRequestSchema,
  stripMachineCharacterIndex,
  type CharacterAssetCategory,
  type CharacterAvatarGenerationRequest,
  type CharacterBatchAvatarRequest,
  type CharacterBatchEnrichRpRequest,
  type CharacterBatchImportLocalCardsRequest,
  type CharacterUpstreamApplyRequest,
  type CharacterUpstreamResearchRequest,
  type CharacterVariant,
  type CharacterUpstreamEvidenceSource,
} from '@sthstart/contracts';
import { runUpstreamCharacterResearch } from './characters/upstream/orchestrator.js';
import { imageGenerationAudit, mergeImageParameters, resolveImageConfiguration } from './generation/image-configuration.js';
import { existsSync } from 'node:fs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CharacterDraftV2, CharacterMigrationReview, CharacterProfile, CharacterRelationship, CharacterSource } from '@sthstart/contracts';
import { CHARACTER_PERSONA_COMPILER_VERSION, compileLinshePrompt, migrateCharacterDraftToV2 } from '@sthstart/contracts';
import { authenticateApp, hasCapability } from './access.js';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';
import { collectAiCallRedactionSecrets, fetchAuditedAiResponse, updateAiCallRecord } from './ai-call-trace.js';
import { resolveAssignedLlmProfile, upstreamHeaders } from './providers.js';
import { errorConfigurationPath, llmNotReadyError, resolveAppLlmBindingStatus, resolveCharacterLlmBindingStatus } from './llm-status.js';
import type { SecretStore } from './security.js';
import { createArtifactReadStream, createArtifactReference, readArtifact, removeArtifactReference, streamUploadArtifact } from './artifacts.js';
import { createGenerationTask, getGenerationTask } from './generation.js';
import { sanitizeErrorMessage } from './generation.js';
import { characterDraftForVariant, isV2Draft, normalizeCharacterDraft, text, list, toAuthorityDraft } from './characters/draft.js';
import { effectiveBirthday, rebuildCharacterBirthdays, upsertCharacterBirthday } from './characters/birthday.js';
export { normalizeCharacterDraft } from './characters/draft.js';
import { CharacterCardProviderRegistry } from './characters/source-providers/registry.js';
import { CharacterCardProviderError } from './characters/source-providers/types.js';
import { mapCharacterCardForDetail } from './characters/card-mapper.js';
import {
  cancelCharacterImportSession,
  commitCharacterImportSession,
  createCharacterImportSession,
  getCharacterImportSession,
  updateCharacterImportSession,
} from './characters/import-sessions.js';
import { listCharacterLlmAssignments, resolveCharacterLlmProfile, setCharacterLlmAssignment } from './characters/model-assignments.js';
import { buildAuditionPrompt, normalizeCharacterAppearance } from './characters/persona-compiler.js';
import { buildCharacterVisualContext, previewAppearanceCandidateApplication, toCharacterRuntime } from '@sthstart/contracts';
import { assertPreparedImageContext, buildImageContext } from './generation/image-context.js';
import { previewCharacterMultiSourceAssets, resolveCharacterOfficialAssetBundle } from './characters/official-avatars.js';
import {
  repairCharacterAssetsMetadata,
  runBatchEnrichRpCards,
  runBatchImportLocalPersonaCards,
  runBatchOfficialAssets,
} from './characters/batch-enrichment.js';
import { characterVisualReferenceRows as visualReferenceRows, mapCharacterVersion as mapVersion, publishCharacterSnapshot, readStoredCharacterSnapshot, syncCharacterSnapshotAfterChange } from './characters/snapshots.js';
export { publishCharacterSnapshot } from './characters/snapshots.js';

function hash(value: unknown) { return createHash('sha256').update(value instanceof Uint8Array || typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }

function bytesBase64(value: Uint8Array) {
  return (value as unknown as { toString: (encoding: string) => string }).toString('base64');
}

function avatarUrl(database: ServiceDatabase, assetId: unknown, assetPath: string) {
  if (!assetId) return null;
  // 资产记录可能只剩元数据，文件被清理后继续返回 URL 会让前端产生无意义的 404 破图。
  // URL 只在 artifact 真正可读时暴露；记录本身保留，便于资产页显式清理或重新关联。
  const artifact = database.connection.prepare(`SELECT art.local_path, art.file_status
    FROM character_assets a JOIN artifacts art ON art.id=a.artifact_id WHERE a.id=?`).get(String(assetId)) as
    { local_path: string | null; file_status: string } | undefined;
  return artifact?.file_status === 'ready' && artifact.local_path && existsSync(artifact.local_path)
    ? `${assetPath}/${assetId}`
    : null;
}

function resolveFamilyMembers(
  database: ServiceDatabase,
  characterId: string,
  parentCharacterId: string | null,
  assetPath: string,
): { familyRootId: string; members: CharacterFamilyMemberSummary[] } {
  const rootId = parentCharacterId || characterId;
  const rows = database.connection.prepare(
    `SELECT id, display_name, draft_json, organization_json, avatar_asset_id
     FROM character_profiles
     WHERE archived = 0 AND (id = ? OR parent_character_id = ?)
     ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, created_at ASC`,
  ).all(rootId, rootId, rootId) as Record<string, unknown>[];
  const members: CharacterFamilyMemberSummary[] = rows.map((item) => {
    let work = '';
    let originType: CharacterOriginType = 'original';
    try {
      const d = normalizeCharacterDraft(JSON.parse(String(item.draft_json)));
      work = d.work || '';
      originType = d.originType;
    } catch { /* ignore invalid draft */ }
    let interpretation = '';
    try {
      interpretation = normalizeOrganization(JSON.parse(String(item.organization_json || '{}'))).interpretation;
    } catch { /* ignore */ }
    return {
      id: String(item.id),
      displayName: String(item.display_name),
      work,
      originType,
      interpretation,
      avatarUrl: avatarUrl(database, item.avatar_asset_id, assetPath),
    };
  });
  return { familyRootId: rootId, members };
}

function mapProfile(database: ServiceDatabase, row: Record<string, unknown>, assetPath = '/api/admin/characters/assets'): CharacterProfile {
  const draft = normalizeCharacterDraft(JSON.parse(String(row.draft_json)));
  let variants: import('@sthstart/contracts').CharacterVariant[] = [];
  try {
    if (row.variants_json) {
      variants = JSON.parse(String(row.variants_json));
    }
  } catch {
    variants = [];
  }
  const parentCharacterId = row.parent_character_id ? String(row.parent_character_id) : null;
  const { familyRootId, members } = resolveFamilyMembers(database, String(row.id), parentCharacterId, assetPath);
  return {
    organization: normalizeOrganization(JSON.parse(String(row.organization_json || '{}'))),
    birthday: effectiveBirthday(draft),
    id: String(row.id), slug: String(row.slug), displayName: String(row.display_name),
    // draft 即权威存储形态（V2；未迁移的历史数据仍为 V1）。
    draft,
    tags: JSON.parse(String(row.tags_json)) as string[],
    avatarUrl: avatarUrl(database, row.avatar_asset_id, assetPath),
    avatarAssetId: row.avatar_asset_id ? String(row.avatar_asset_id) : null,
    portraitUrl: avatarUrl(database, row.portrait_asset_id, assetPath),
    portraitAssetId: row.portrait_asset_id ? String(row.portrait_asset_id) : null,
    latestVersion: row.latest_version == null ? null : Number(row.latest_version),
    archived: Boolean(row.archived), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    ...(row.draft_revision != null ? { draftRevision: Number(row.draft_revision) } : {}),
    variants,
    parentCharacterId,
    familyRootId,
    derivativeCount: Math.max(0, members.filter((m) => m.id !== familyRootId).length),
    familyMembers: members,
  };
}


function uniqueSlug(database: ServiceDatabase, input: string, except?: string) {
  const base = input.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 54) || `character-${Date.now()}`;
  let candidate = base; let number = 2;
  while (database.connection.prepare(`SELECT 1 FROM character_profiles WHERE slug=? ${except ? 'AND id<>?' : ''}`).get(...(except ? [candidate, except] : [candidate]))) candidate = `${base}-${number++}`;
  return candidate;
}

export function migrateLegacyPersonas(database: ServiceDatabase) {
  const personas = database.connection.prepare('SELECT * FROM personas').all() as Record<string, unknown>[];
  for (const persona of personas) {
    const personaId = String(persona.id);
    if (database.connection.prepare('SELECT 1 FROM character_profiles WHERE id=?').get(personaId)) continue;
    const versions = database.connection.prepare('SELECT * FROM persona_versions WHERE persona_id=? ORDER BY version').all(personaId) as Record<string, unknown>[];
    const latest = versions.at(-1);
    const draft = normalizeCharacterDraft({ displayName: persona.display_name, appearance: { description: latest?.appearance_prompt ?? '' }, legacyPrompt: latest?.persona_prompt ?? '', summary: String(latest?.persona_prompt ?? '').slice(0, 180) });
    const avatarArtifactId = latest?.avatar_artifact_id ? String(latest.avatar_artifact_id) : null;
    const legacyAvatar = avatarArtifactId
      ? database.connection.prepare('SELECT local_path,content_type,byte_size,original_name,sha256,width,height FROM artifacts WHERE id=?').get(avatarArtifactId) as Record<string, unknown> | undefined
      : undefined;
    const avatarAssetId = legacyAvatar ? randomUUID() : null;
    database.transaction(() => {
      database.connection.prepare(`INSERT INTO character_profiles
        (id,slug,display_name,draft_json,tags_json,avatar_asset_id,latest_version,archived,created_at,updated_at,draft_revision)
        VALUES (?,?,?,?,?,?,?,0,?,?,?)`).run(personaId, uniqueSlug(database, personaId), String(persona.display_name), JSON.stringify(draft), String(persona.tags_json), avatarAssetId, versions.length ? Number(persona.latest_version) : null, String(persona.created_at), String(persona.updated_at), 1);
      if (avatarAssetId && legacyAvatar && avatarArtifactId) {
        database.connection.prepare(`INSERT INTO character_assets
          (id,character_id,kind,created_at,artifact_id)
          VALUES (?,?,?,?,?)`).run(
          avatarAssetId, personaId, 'avatar', String(persona.created_at), avatarArtifactId,
        );
      }
      for (const version of versions) database.connection.prepare(`INSERT INTO character_versions
        (character_id,version,data_json,compiled_linshe_prompt,created_at,relationships_json,draft_revision,appearance_snapshot_json,provenance_json)
        VALUES (?,?,?,?,?,'[]',1,?,?)`).run(personaId, Number(version.version), JSON.stringify({ ...draft, displayName: String(version.display_name), appearance: { ...draft.appearance, description: String(version.appearance_prompt ?? '') }, legacyPrompt: String(version.persona_prompt) }), String(version.persona_prompt), String(version.created_at), JSON.stringify({ ...draft.appearance, description: String(version.appearance_prompt ?? '') }), JSON.stringify({ legacy: true }));
      upsertCharacterBirthday(database, personaId, draft);
    });
  }
}

function requirePersonaApp(database: ServiceDatabase, request: FastifyRequest, reply: FastifyReply) {
  const identity = authenticateApp(database, request);
  if (!identity) { void reply.code(401).send({ error: 'invalid_app_token' }); return null; }
  if (!hasCapability(identity, 'persona')) { void reply.code(403).send({ error: 'capability_denied' }); return null; }
  return identity;
}

function relationshipRows(database: ServiceDatabase, characterId: string): CharacterRelationship[] {
  return (database.connection.prepare('SELECT * FROM character_relationships WHERE from_character_id=? OR to_character_id=? ORDER BY updated_at DESC').all(characterId, characterId) as Record<string, unknown>[]).map((row) => ({ id: String(row.id), fromCharacterId: String(row.from_character_id), toCharacterId: String(row.to_character_id), relationType: String(row.relation_type), description: String(row.description), updatedAt: String(row.updated_at) }));
}

function sourceRows(database: ServiceDatabase, characterId: string): CharacterSource[] {
  return (database.connection.prepare('SELECT * FROM character_sources WHERE character_id=? ORDER BY fetched_at DESC').all(characterId) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id), characterId: String(row.character_id), title: String(row.title), url: row.url ? String(row.url) : null, excerpt: String(row.excerpt), sourceType: row.source_type as CharacterSource['sourceType'], fetchedAt: String(row.fetched_at),
    ...(row.provider_id != null ? { providerId: String(row.provider_id) } : {}), ...(row.external_id != null ? { externalId: String(row.external_id) } : {}), ...(row.payload_hash != null ? { payloadHash: String(row.payload_hash) } : {}), ...(row.source_snapshot_id != null ? { sourceSnapshotId: String(row.source_snapshot_id) } : {}),
  }));
}

function saveUpstreamEvidence(database: ServiceDatabase, characterId: string, sources: CharacterUpstreamEvidenceSource[], now: string) {
  for (const [sourceIndex, src] of sources.entries()) {
    const provider = src.provider || src.sourceType || 'web';
    const evidenceKind = src.evidenceKind || (src.rawText ? 'fulltext' : src.rawPayload ? 'structured' : 'snippet');
    const sourcePayload = JSON.stringify({ ...src, evidenceKind });
    const { retrievedAt: _retrievedAt, ...stableEvidence } = src;
    const payloadHash = hash({ ...stableEvidence, evidenceKind });
    const externalId = src.externalId || src.url || src.title;
    const existingSnapshot = database.connection.prepare('SELECT id FROM character_source_snapshots WHERE provider_id=? AND external_id=? AND payload_hash=?').get(provider, externalId, payloadHash) as { id: string } | undefined;
    const snapshotId = existingSnapshot?.id || randomUUID();
    if (!existingSnapshot) database.connection.prepare(`INSERT INTO character_source_snapshots
      (id,provider_id,external_id,source_url,fetched_at,payload_hash,format,parser_version,raw_payload_json,created_at)
      VALUES (?,?,?,?,?,?,'upstream-evidence-json-v1','upstream-evidence-v1',?,?)`).run(snapshotId, provider, externalId, src.url, src.retrievedAt || now, payloadHash, sourcePayload, now);
    database.connection.prepare(`INSERT INTO character_sources
      (id,character_id,title,url,excerpt,source_type,fetched_at,provider_id,external_id,payload_hash,source_snapshot_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), characterId, src.title, src.url, src.excerpt.slice(0, 12_000), src.sourceType || 'web', now, provider, externalId, payloadHash, snapshotId);
    database.connection.prepare(`INSERT INTO character_field_provenance
      (id,character_id,field_path,value_hash,source_kind,source_snapshot_id,source_pointer,evidence_json,confirmed,created_at)
      VALUES (?,?,?,?,?,?,?,?,1,?)`).run(randomUUID(), characterId, `/sources/${sourceIndex}`, payloadHash, 'source_extract', snapshotId, `/sources/${sourceIndex}`, JSON.stringify({ evidenceKind, contentHash: src.contentHash || null, url: src.url }), now);
  }
}


/**
 * 迁移复核：从归档原文现场重算冲突，不另存一份可能漂移的复核状态。
 *
 * 归档是当初不可变的 V1 载荷，migrateCharacterDraftToV2 是确定性纯函数，
 * 因此这里的结论与迁移当时一致，且不需要新增表或列。
 */
const MIGRATION_PROVIDER_ID = 'sthstart-draft-migration';

function migrationReview(database: ServiceDatabase, characterId: string, displayName: string, draft: unknown, draftRevision: number): CharacterMigrationReview {
  const archived = database.connection.prepare(`SELECT s.raw_payload_json,s.fetched_at
    FROM character_source_snapshots s JOIN character_sources c ON c.source_snapshot_id=s.id
    WHERE c.character_id=? AND s.provider_id=? AND s.format='sthstart-draft-json-v1'
    ORDER BY s.fetched_at DESC LIMIT 1`).get(characterId, MIGRATION_PROVIDER_ID) as { raw_payload_json: string; fetched_at: string } | undefined;
  const runtime = toCharacterRuntime(draft);
  const current = { baseText: runtime.appearance.baseText, defaultOutfitText: runtime.appearance.defaultOutfitText };
  if (!archived) {
    return { characterId, displayName, hasArchive: false, archivedAt: null, conflicts: [], archivedOutfits: [], current, draftRevision };
  }
  let original: Record<string, unknown> | null = null;
  try { original = JSON.parse(String(archived.raw_payload_json)) as Record<string, unknown>; } catch { original = null; }
  const migrated = original === null ? null : migrateCharacterDraftToV2(original);
  const legacyAppearance = normalizeCharacterAppearance(original?.appearance);
  return {
    characterId, displayName, hasArchive: true, archivedAt: String(archived.fetched_at),
    conflicts: (migrated?.conflicts ?? []).map((conflict) => ({ kind: conflict.kind, detail: conflict.detail })),
    // 旧多套服装只是「未生效的备选」，不搬回草稿；但要在复核入口里看得到、能选用。
    archivedOutfits: [...new Set(legacyAppearance.outfits.filter(Boolean))],
    current,
    draftRevision,
  };
}

function sourceSnapshotContentType(format: unknown, rawPayloadJson: unknown) {
  try {
    const payload = rawPayloadJson ? JSON.parse(String(rawPayloadJson)) as { mimeType?: unknown } : null;
    if (typeof payload?.mimeType === 'string' && payload.mimeType.startsWith('image/')) return payload.mimeType;
  } catch { /* fall through to the format mapping */ }
  const normalized = String(format ?? '');
  // 卡片的格式名带前缀（json / v1-json / v2-json / sthstart-draft-json-v1），都应按 JSON 返回。
  if (normalized.includes('json')) return 'application/json; charset=utf-8';
  return normalized === 'png' ? 'image/png' : normalized === 'jpeg' ? 'image/jpeg' : normalized === 'webp' ? 'image/webp' : normalized === 'gif' ? 'image/gif' : normalized === 'avif' ? 'image/avif' : 'application/octet-stream';
}

async function researchCharacter(query: string, fetcher: typeof fetch) {
  const parts = query.match(/^(.+?)[（(](.+?)[）)]$/); const name = (parts?.[1] ?? query).trim(); const work = (parts?.[2] ?? '').trim();
  const endpoint = new URL('https://mzh.moegirl.org.cn/api.php'); endpoint.search = new URLSearchParams({ action: 'query', titles: work ? `${name}(${work})` : name, redirects: '1', prop: 'extracts', explaintext: '1', format: 'json', origin: '*' }).toString();
  try {
    const response = await fetcher(endpoint, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    const payload = await response.json() as { query?: { pages?: Record<string, { title?: string; extract?: string; missing?: boolean }> } };
    const page = Object.values(payload.query?.pages ?? {})[0];
    if (response.ok && page && !page.missing && page.extract?.trim()) return [{ title: page.title ?? name, url: `https://zh.moegirl.org.cn/${encodeURIComponent(page.title ?? name)}`, excerpt: page.extract.trim().slice(0, 12_000), sourceType: 'moegirl' as const }];
  } catch { /* fallback below */ }
  try {
    const response = await fetcher(`https://www.bing.com/search?q=${encodeURIComponent(`${name} ${work} 角色 设定`)}`, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000) });
    const html = await response.text(); const plain = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim();
    if (response.ok && plain.length > 200) return [{ title: `Bing：${name}${work ? `（${work}）` : ''}`, url: response.url, excerpt: plain.slice(0, 8_000), sourceType: 'web' as const }];
  } catch { /* no source */ }
  return [];
}

async function generateDraft(database: ServiceDatabase, secrets: SecretStore, fetcher: typeof fetch, description: string, sources: Array<{ title: string; url: string; excerpt: string; sourceType: string }>) {
  const bindingStatus = await resolveAppLlmBindingStatus(database, secrets, 'characters', 'text');
  if (!bindingStatus.ready) throw llmNotReadyError(bindingStatus);
  const profile = await resolveAssignedLlmProfile(database, secrets, 'characters', 'text');
  if (!profile?.model) throw llmNotReadyError(bindingStatus);
  const prompt = `请根据用户描述和参考资料生成结构化角色草稿。不得编造与资料冲突的事实；没有可靠证据的字段请留空或使用空数组。只输出 JSON，不要 Markdown。严格遵守以下完整格式，不新增字段：
{
  "displayName": "角色名",
  "englishName": "",
  "aliases": [],
  "originType": "original",
  "work": "",
  "world": "",
  "summary": "一句话摘要",
  "identity": "身份与背景事实",
  "background": "",
  "currentSituation": "",
  "personality": [],
  "motivations": [],
  "beliefs": [],
  "secrets": [],
  "speech": { "tone": "", "habits": "", "catchphrases": [], "examples": [] },
  "likes": [],
  "dislikes": [],
  "fears": [],
  "boundaries": [],
  "appearance": { "description": "", "hair": "", "eyes": "", "build": "", "outfits": [], "accessories": [], "stableFeatures": [], "defaultOutfitId": null, "referenceIds": [] },
  "extraRules": ""
}

用户描述：${description}

参考资料：
${sources.map((source) => `【${source.title}】\n${source.excerpt}`).join('\n\n').slice(0, 24_000)}`;
  const requestBody = { ...profile.extraBody, model: profile.model, temperature: .3, messages: [{ role: 'system', content: '你是严谨的角色资料编辑，只输出有效 JSON。' }, { role: 'user', content: prompt }] };
  const audited = await fetchAuditedAiResponse(database, { applicationId: 'characters', feature: 'characters', businessEvent: 'character.draft.generate', objectType: 'character', callType: 'llm', provider: profile.name, models: [profile.model], parameters: { temperature: .3 }, positivePrompt: prompt, redactionSecrets: collectAiCallRedactionSecrets({ secret: profile.secret, headers: profile.headers, extraBody: profile.extraBody }) }, fetcher, `${profile.baseUrl}/chat/completions`, { method: 'POST', headers: { ...profile.headers, ...upstreamHeaders(profile.secret) }, body: JSON.stringify(requestBody), signal: AbortSignal.timeout(180_000) });
  const response = audited.response;
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
  const raw = payload.choices?.[0]?.message?.content?.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (!raw) throw new Error('empty_generation');
  updateAiCallRecord(database, audited.callId, { responseText: raw, event: 'content_parsed', redactionSecrets: audited.redactionSecrets });
  return normalizeCharacterDraft(JSON.parse(raw));
}

function generationError(reply: FastifyReply, error: unknown) {
  const code = (error as { code?: string })?.code || (error instanceof Error ? error.message : 'generation_failed');
  const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
  const status = code === 'generation_assignment_not_found' || code === 'workflow_not_found' || code === 'workflow_version_not_found'
    ? 409
    : code === 'generation_engine_unavailable' || code === 'worker_token_missing'
      ? 503
      : code === 'not_found'
        ? 404
        : 400;
  return reply.code(status).send({ error: code, message });
}

function characterGenerationTask(database: ServiceDatabase, taskId: string, characterId: string) {
  const row = database.connection.prepare('SELECT app_id,purpose,request_params_json FROM generation_tasks WHERE id=?').get(taskId) as { app_id: string; purpose: string; request_params_json: string } | undefined;
  if (!row || row.app_id !== 'characters' || row.purpose !== 'character-avatar') return null;
  try {
    const request = JSON.parse(row.request_params_json) as { inputs?: { characterId?: unknown } };
    return request.inputs?.characterId === characterId ? row : null;
  } catch {
    return null;
  }
}

/**
 * 头像提示词。走与活动生图相同的统一视觉编译，稳定辨识特征与默认穿着口径一致，
 * 只追加头像任务的取景要求，不再单独拼一套外观文本。
 */
function characterAvatarPrompt(draft: unknown) {
  const runtime = toCharacterRuntime(draft);
  const visual = buildCharacterVisualContext(runtime);
  return [
    `角色：${runtime.displayName || '未命名角色'}`,
    runtime.personaText,
    runtime.summary,
    visual.text,
    '角色头像，半身肖像，清晰面部，正面或略微侧身，干净背景。',
  ].filter(Boolean).join('\n').slice(0, 4_000);
}

async function sendCharacterAsset(database: ServiceDatabase, assetId: string, reply: FastifyReply, config?: ServiceConfig) {
  // 角色资产只指向 artifacts 中的文件；没有 artifact 关联就无法提供内容。
  const asset = database.connection.prepare('SELECT artifact_id, source_url, kind, character_id FROM character_assets WHERE id=?').get(assetId) as { artifact_id: string | null; source_url?: string | null; kind?: string; character_id?: string } | undefined;
  if (!asset) return reply.code(404).send({ error: 'not_found' });
  if (!asset.artifact_id) return reply.code(404).send({ error: 'artifact_missing' });
  let artifact = await readArtifact(database, asset.artifact_id);

  // 自愈机制：若本地文件因清理或首次迁移缺失，自动按 source_url 回源下载并更新 artifacts
  if ((!artifact || artifact.fileStatus !== 'ready' || !artifact.localPath || !existsSync(artifact.localPath)) && asset.source_url) {
    try {
      let buffer: Buffer | null = null;
      let contentType = 'image/png';

      // 1. 本地相对路径回源 (例如 /images/xxx.png 或 /avatars/xxx.png)
      if (asset.source_url.startsWith('/')) {
        const localCandidates = [
          resolve(process.cwd(), `data${asset.source_url}`),
          resolve(process.cwd(), `data/${asset.source_url.replace(/^\/(?:images|avatars)\//, '')}`),
          resolve(process.cwd(), `upstream/linshe/agent-core/data${asset.source_url}`),
        ];
        for (const candidate of localCandidates) {
          if (existsSync(candidate)) {
            buffer = await readFile(candidate);
            break;
          }
        }
      }

      // 2. HTTP/HTTPS 远程下载
      if (!buffer && (asset.source_url.startsWith('http://') || asset.source_url.startsWith('https://'))) {
        const res = await fetch(asset.source_url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          buffer = Buffer.from(await res.arrayBuffer());
          contentType = res.headers.get('content-type') || 'image/png';
        }
      }

      if (buffer) {
        const ext = contentType.includes('webp') ? '.webp' : contentType.includes('jpeg') ? '.jpg' : '.png';
        const artifactDir = config?.artifactDirectory || process.env.STHSTART_ARTIFACT_DIR || resolve(process.cwd(), 'data/artifacts');
        const directory = resolve(artifactDir, 'characters');
        await mkdir(directory, { recursive: true });
        const filePath = resolve(directory, `${asset.artifact_id}${ext}`);
        await writeFile(filePath, buffer);

        const now = nowIso();
        const byteSize = buffer.length;
        const sha256 = createHash('sha256').update(buffer).digest('hex');

        database.connection.prepare(`UPDATE artifacts SET local_path=?, content_type=?, byte_size=?, sha256=?, file_status='ready', updated_at=? WHERE id=?`)
          .run(filePath, contentType, byteSize, sha256, now, asset.artifact_id);

        artifact = await readArtifact(database, asset.artifact_id);
      }
    } catch (e) {
      console.warn(`[characters] Failed to self-heal asset ${assetId} from ${asset.source_url}:`, e);
    }
  }

  if (!artifact || artifact.fileStatus !== 'ready' || !artifact.localPath || !existsSync(artifact.localPath)) return reply.code(404).send({ error: 'file_not_found' });
  reply.type(artifact.contentType || 'application/octet-stream').header('content-length', String(artifact.byteSize));
  return reply.send(createArtifactReadStream(artifact.localPath));
}

async function sendFrozenCharacterAsset(database: ServiceDatabase, characterId: string, version: number, assetId: string, reply: FastifyReply) {
  const row = database.connection.prepare('SELECT data_json FROM character_versions WHERE character_id=? AND version=?').get(characterId, version) as { data_json: string } | undefined;
  const asset = row && readStoredCharacterSnapshot(row.data_json)?.assets.find(item => item.id === assetId);
  if (!asset?.artifactId) return reply.code(404).send({ error: 'version_asset_not_found' });
  const artifact = await readArtifact(database, asset.artifactId);
  if (!artifact?.localPath || artifact.fileStatus !== 'ready' || !existsSync(artifact.localPath)) return reply.code(404).send({ error: 'artifact_not_ready' });
  return reply.type(artifact.contentType || 'application/octet-stream').send(createArtifactReadStream(artifact.localPath));
}


async function referenceBytes(database: ServiceDatabase, row: Record<string, unknown>) {
  if (!row.artifact_id) throw new Error('reference_artifact_missing');
  const artifact = await readArtifact(database, String(row.artifact_id));
  if (!artifact?.localPath || !existsSync(artifact.localPath)) throw new Error('reference_file_not_found');
  return { bytes: await readFile(artifact.localPath), contentType: artifact.contentType || 'image/png' };
}

function modelJson(content: unknown): Record<string, unknown> {
  const raw = typeof content === 'string' ? content : Array.isArray(content) ? content.map((item) => item && typeof item === 'object' && 'text' in item ? String((item as { text?: unknown }).text ?? '') : '').join('') : '';
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(stripped) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('model_json_invalid');
  return parsed as Record<string, unknown>;
}

function appearanceExtraction(value: Record<string, unknown>) {
  const stringValue = (input: unknown, max = 4_000) => typeof input === 'string' ? input.trim().slice(0, max) : '';
  const stringList = (input: unknown) => Array.isArray(input) ? [...new Set(input.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))].slice(0, 30) : [];
  return {
    description: stringValue(value.description), hair: stringValue(value.hair, 1_000), eyes: stringValue(value.eyes, 1_000), build: stringValue(value.build, 1_000),
    accessories: stringList(value.accessories), observedOutfit: stringValue(value.observedOutfit), unknowns: stringList(value.unknowns), conflicts: stringList(value.conflicts), evidence: stringList(value.evidence),
  };
}

function characterImportError(reply: FastifyReply, error: unknown) {
  if (error instanceof CharacterCardProviderError) {
    const status = error.code === 'provider_rate_limited' ? 429 : error.code === 'provider_auth_required' ? 403 : error.code === 'provider_unavailable' ? 503 : 400;
    return reply.code(status).send({ error: error.code, message: error.message, retryAfterSeconds: error.retryAfterSeconds });
  }
  // 结构化错误（如模型未就绪）携带明确的 HTTP 状态与配置路径，原样透出给前端。
  const structuredStatus = (error as { statusCode?: unknown }).statusCode;
  if (typeof structuredStatus === 'number' && structuredStatus >= 400) {
    const code = (error as { code?: string }).code || 'generation_failed';
    const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
    const configurationPath = errorConfigurationPath(error);
    return reply.code(structuredStatus).send({ error: code, message, ...(configurationPath ? { configurationPath } : {}) });
  }
  const code = error instanceof Error ? error.message : String(error);
  const status = code.includes('conflict') || code === 'base_draft_revision_required' || code.startsWith('import_session_') ? 409 : code === 'not_found' || code.endsWith('_not_found') ? 404 : 400;
  return reply.code(status).send({ error: code });
}

async function downloadAndSaveCharacterAsset(
  config: ServiceConfig,
  database: ServiceDatabase,
  fetcher: typeof fetch,
  characterId: string,
  item: {
    kind: 'avatar' | 'portrait' | 'reference';
    category?: CharacterAssetCategory;
    title?: string;
    url: string;
    source?: string;
    setAsActive?: boolean;
    registerReference?: boolean;
    skinName?: string;
    outfitDescription?: string;
    loreStory?: string;
    tags?: string[];
  },
  deferSnapshot = false,
  stagedWrites?: Array<() => void>,
): Promise<{ id: string; kind: 'avatar' | 'portrait' | 'reference'; category: CharacterAssetCategory; url: string; setAvatar: boolean; setPortrait: boolean } | null> {
  if (!item.url) return null;
  try {
    const res = await fetcher(item.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    if (buffer.length === 0) return null;
    const contentType = res.headers.get('content-type') || 'image/png';
    const assetId = randomUUID();
    const now = nowIso();
    const ext = contentType.includes('webp') ? 'webp' : contentType.includes('jpeg') ? 'jpg' : 'png';
    const category: CharacterAssetCategory = item.category || (item.kind === 'avatar' ? 'avatar' : item.kind === 'portrait' ? 'portrait' : 'concept');
    const title = (item.title || item.skinName || item.source || `${category}_${Date.now()}`).slice(0, 200);
    const filename = `${category}_${Date.now()}.${ext}`;
    const metadata: Record<string, unknown> = {
      ...(item.skinName ? { skinName: item.skinName } : {}),
      ...(item.outfitDescription ? { outfitDescription: item.outfitDescription } : {}),
      ...(item.loreStory ? { loreStory: item.loreStory } : {}),
    };
    const tags = Array.isArray(item.tags) ? item.tags.filter(Boolean).slice(0, 20) : (item.skinName ? [item.skinName] : []);

    const artifact = await streamUploadArtifact(config, database, {
      appId: 'characters',
      stream: Readable.from([buffer]),
      contentType,
      originalName: filename,
      refType: 'character-asset',
      refId: assetId,
      metadata: { characterId, kind: item.kind, category },
    });

    let setAvatar = false;
    let setPortrait = false;
    const saveAsset = () => {
      database.connection.prepare(`INSERT INTO character_assets
        (id,character_id,kind,created_at,artifact_id,source_url,author_note,user_note,category,title,tags_json,metadata_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        assetId,
        characterId,
        item.kind,
        now,
        artifact.id,
        item.url.slice(0, 2_000),
        (item.loreStory || item.source || '').slice(0, 4_000),
        (item.outfitDescription || item.title || item.source || '上游导入').slice(0, 4_000),
        category,
        title,
        JSON.stringify(tags),
        JSON.stringify(metadata),
      );
      if (item.registerReference || item.kind === 'reference' || category === 'costume' || category === 'portrait') {
        const purposes = category === 'costume' ? ['outfit', 'identity'] : ['identity'];
        database.connection.prepare(`INSERT INTO character_visual_references
          (id,character_id,asset_id,purposes_json,enabled,crop_json,created_at,updated_at)
          VALUES (?,?,?,?,1,NULL,?,?)`).run(randomUUID(), characterId, assetId, JSON.stringify(purposes), now, now);
      }
      if (item.setAsActive) {
        if (item.kind === 'avatar' || category === 'avatar') {
          database.connection.prepare('UPDATE character_profiles SET avatar_asset_id=?,updated_at=? WHERE id=?').run(assetId, now, characterId);
          setAvatar = true;
        } else if (item.kind === 'portrait' || category === 'portrait') {
          database.connection.prepare('UPDATE character_profiles SET portrait_asset_id=?,updated_at=? WHERE id=?').run(assetId, now, characterId);
          setPortrait = true;
        }
      }
      if (!deferSnapshot) syncCharacterSnapshotAfterChange(database, characterId, { incrementRevision: true });
    };
    if (stagedWrites) stagedWrites.push(saveAsset);
    else database.transaction(saveAsset);

    return { id: assetId, kind: item.kind, category, url: `/api/admin/characters/assets/${assetId}`, setAvatar, setPortrait };
  } catch {
    return null;
  }
}

export function registerCharacterRoutes(app: FastifyInstance, config: ServiceConfig, database: ServiceDatabase, secrets: SecretStore, fetcher: typeof fetch = fetch) {
  migrateLegacyPersonas(database);
  // 生日投影完全由角色草稿推导，启动时重建可以覆盖旧数据并保持筛选、日历一致。
  rebuildCharacterBirthdays(database);
  // 历史遗留头像/立绘可能未写入 category/title 或产生重复记录，启动时自愈。
  repairCharacterAssetsMetadata(database);
  const cardProviders = new CharacterCardProviderRegistry(fetcher);

  app.get('/api/v1/admin/characters/card-providers', async () => ({
    items: cardProviders.list().map((provider) => ({ id: provider.id, name: provider.name, capabilities: provider.capabilities, enabled: true, status: 'ready' as const })),
  }));

  app.get<{ Querystring: { providerId?: string; q?: string; cursor?: string; limit?: string } }>('/api/v1/admin/characters/card-search', async (request, reply) => {
    const providerId = text(request.query.providerId, 100) || 'character-tavern';
    const query = text(request.query.q, 200);
    if (query.length < 2) return reply.code(400).send({ error: 'search_query_required' });
    try {
      return await cardProviders.search(providerId, query, request.query.cursor, Math.min(30, Math.max(1, Number(request.query.limit) || 12)), AbortSignal.timeout(15_000));
    } catch (error) { return characterImportError(reply, error); }
  });

  app.get<{ Querystring: { providerId?: string; externalId?: string } }>('/api/v1/admin/characters/card-detail', async (request, reply) => {
    const providerId = text(request.query.providerId, 100) || 'character-tavern';
    const externalId = text(request.query.externalId, 300);
    if (!externalId) return reply.code(400).send({ error: 'external_id_required' });
    try {
      const detail = await cardProviders.detail(providerId, externalId, AbortSignal.timeout(15_000));
      return { ...detail, preview: mapCharacterCardForDetail(detail.card, detail.sourceUrl) };
    } catch (error) { return characterImportError(reply, error); }
  });

  app.post<{ Body: Record<string, unknown> }>('/api/v1/admin/characters/import-sessions', { bodyLimit: 30 * 1024 * 1024 }, async (request, reply) => {
    const body = request.body ?? {};
    let bytes: Buffer | undefined;
    if (typeof body.dataBase64 === 'string') {
      try { bytes = Buffer.from(body.dataBase64, 'base64'); } catch { return reply.code(400).send({ error: 'invalid_base64' }); }
    }
    if (bytes && bytes.length > 20 * 1024 * 1024) return reply.code(413).send({ error: 'character_card_too_large' });
    try {
      const session = await createCharacterImportSession(database, config, cardProviders, {
        operatorScope: 'admin', providerId: text(body.providerId, 100) || undefined, externalId: text(body.externalId, 300) || undefined,
        url: text(body.url, 2_000) || undefined, card: body.card && typeof body.card === 'object' && !Array.isArray(body.card) ? body.card as Record<string, unknown> : undefined,
        bytes, mimeType: text(body.mimeType, 100) || undefined, filename: text(body.filename, 255) || undefined,
        targetCharacterId: text(body.targetCharacterId, 200) || undefined, baseDraftRevision: body.baseDraftRevision == null ? undefined : Number(body.baseDraftRevision),
        idempotencyKey: typeof request.headers['idempotency-key'] === 'string' ? request.headers['idempotency-key'] : text(body.idempotencyKey, 200) || undefined,
      });
      return reply.code(201).send(session);
    } catch (error) { return characterImportError(reply, error); }
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/characters/import-sessions/:id', async (request, reply) => {
    const session = getCharacterImportSession(database, request.params.id);
    return session ? session : reply.code(404).send({ error: 'import_session_not_found' });
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/characters/import-sessions/:id/cover', async (request, reply) => {
    const session = getCharacterImportSession(database, request.params.id);
    if (!session || session.status !== 'ready' || !session.candidate?.cover.available) return reply.code(404).send({ error: 'import_cover_not_found' });
    const snapshot = database.connection.prepare(`SELECT s.raw_file_path,s.format,s.raw_payload_json
      FROM character_import_sessions i JOIN character_source_snapshots s ON s.id=i.source_snapshot_id WHERE i.id=?`).get(session.id) as { raw_file_path: string; format: string; raw_payload_json: string } | undefined;
    if (!snapshot?.raw_file_path || !existsSync(snapshot.raw_file_path)) return reply.code(404).send({ error: 'import_cover_not_found' });
    return reply.type(sourceSnapshotContentType(snapshot.format, snapshot.raw_payload_json)).header('cache-control', 'no-store').send(await readFile(snapshot.raw_file_path));
  });

  app.patch<{ Params: { id: string }; Body: { expectedPreviewRevision?: number; candidatePatch?: Record<string, unknown>; cover?: Record<string, unknown> } }>('/api/v1/admin/characters/import-sessions/:id', async (request, reply) => {
    if (!Number.isSafeInteger(request.body?.expectedPreviewRevision)) return reply.code(400).send({ error: 'expected_preview_revision_required' });
    try {
      return updateCharacterImportSession(database, request.params.id, {
        expectedPreviewRevision: Number(request.body.expectedPreviewRevision), candidatePatch: request.body.candidatePatch, cover: request.body.cover as never,
      });
    } catch (error) { return characterImportError(reply, error); }
  });

  app.post<{ Params: { id: string }; Body: { expectedPreviewRevision?: number; previewHash?: string; targetCharacterId?: string | null; baseDraftRevision?: number | null; idempotencyKey?: string } }>('/api/v1/admin/characters/import-sessions/:id/commit', async (request, reply) => {
    const idempotencyKey = typeof request.headers['idempotency-key'] === 'string' ? request.headers['idempotency-key'] : text(request.body?.idempotencyKey, 200);
    if (!Number.isSafeInteger(request.body?.expectedPreviewRevision) || !idempotencyKey) return reply.code(400).send({ error: 'commit_parameters_required' });
    try {
      const result = await commitCharacterImportSession(database, config, request.params.id, {
        expectedPreviewRevision: Number(request.body.expectedPreviewRevision), previewHash: request.body.previewHash, idempotencyKey,
        targetCharacterId: request.body.targetCharacterId, baseDraftRevision: request.body.baseDraftRevision,
      });
      return reply.code(201).send(result);
    } catch (error) { return characterImportError(reply, error); }
  });

  app.delete<{ Params: { id: string } }>('/api/v1/admin/characters/import-sessions/:id', async (request, reply) => {
    try { return { cancelled: await cancelCharacterImportSession(database, request.params.id) }; } catch (error) { return characterImportError(reply, error); }
  });

  app.get<{ Querystring: { filter?: string } }>('/api/v1/admin/characters/browse', async (request, reply) => {
    let query: CharacterBrowseQuery;
    try {
      const raw = JSON.parse(request.query.filter || '{}');
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error();
      for (const key of ['works', 'tags', 'groups', 'excludeIds']) if (raw[key] !== undefined && (!Array.isArray(raw[key]) || raw[key].length > 500 || raw[key].some((v: unknown) => typeof v !== 'string' || v.length > 1000))) throw new Error();
      for (const key of ['q', 'mediaType', 'originType', 'workNature', 'parentWork', 'interpretation', 'source', 'reference', 'appearance', 'unclassified', 'tagMode', 'sort']) if (raw[key] !== undefined && (typeof raw[key] !== 'string' || raw[key].length > 300)) throw new Error();
      for (const key of ['page', 'pageSize']) if (raw[key] !== undefined && (!Number.isSafeInteger(raw[key]) || raw[key] < 1)) throw new Error();
      for (const key of ['favorite', 'collapseDerivatives']) if (raw[key] !== undefined && typeof raw[key] !== 'boolean') throw new Error();
      query = raw;
    } catch { return reply.code(400).send({ error: '筛选参数无效' }); }
    const { rows, ...result } = browseCharacters(database, query);
    return { ...result, items: rows.map(row => mapProfile(database, row)) };
  });
  app.put<{ Body: OrganizationEdit }>('/api/v1/admin/characters/organization', async (request, reply) => {
    try { return editCharacterOrganization(database, request.body || { ids: [] }); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : '整理失败' }); }
  });
  app.put<{ Body: CharacterWork }>('/api/v1/admin/characters/works', async (request, reply) => {
    const name = text(request.body?.name, 200); const aliases = [...new Set(list(request.body?.aliases, 50))];
    if (!name) return reply.code(400).send({ error: '请填写作品名称' });
    try { return upsertCharacterWorkHierarchy(database, {
      name,
      aliases,
      mediaType: request.body?.mediaType,
      workNature: request.body?.workNature,
      parentWork: request.body?.parentWork,
      worldId: request.body?.worldId,
      summary: request.body?.summary,
    }); } catch (error) {
      const detail = error as Error & { statusCode?: number; code?: string };
      return reply.code(detail.statusCode === 409 ? 409 : 400).send({ error: detail.code || detail.message });
    }
  });
  app.get<{ Params: { id: string } }>('/api/v1/admin/characters/import-sessions/:id/duplicates', async (request, reply) => {
    const session = getCharacterImportSession(database, request.params.id);
    if (!session) return reply.code(404).send({ error: 'import_session_not_found' });
    const rows = database.connection.prepare(`SELECT DISTINCT p.id,p.display_name,p.draft_revision,
      CASE WHEN s.payload_hash=? THEN 'exact' WHEN s.provider_id=? AND s.external_id=? AND s.external_id IS NOT NULL THEN 'source' ELSE 'name' END kind
      FROM character_profiles p LEFT JOIN character_sources s ON s.character_id=p.id
      WHERE p.archived=0 AND (s.payload_hash=? OR (s.provider_id=? AND s.external_id=? AND s.external_id IS NOT NULL) OR p.display_name=?)`).all(
      String(session.source.payloadHash || ''), String(session.source.providerId || ''), session.source.externalId == null ? null : String(session.source.externalId),
      String(session.source.payloadHash || ''), String(session.source.providerId || ''), session.source.externalId == null ? null : String(session.source.externalId), session.candidate?.draft.displayName || '',
    );
    return { items: rows.map(r => ({ id: String(r.id), displayName: String(r.display_name), draftRevision: Number(r.draft_revision), kind: String(r.kind) })) };
  });

  app.get<{ Querystring: { q?: string; archived?: string } }>('/api/v1/admin/characters', async (request) => {
    const archived = request.query.archived === 'true' ? 1 : 0; const query = request.query.q?.trim();
    const rows = database.connection.prepare(`SELECT * FROM character_profiles WHERE archived=? ${query ? 'AND (display_name LIKE ? OR slug LIKE ? OR tags_json LIKE ? OR draft_json LIKE ?)' : ''} ORDER BY updated_at DESC LIMIT 500`).all(...(query ? [archived, ...Array(4).fill(`%${query}%`)] : [archived])) as Record<string, unknown>[];
    return { items: rows.map((row) => mapProfile(database, row)) };
  });

  app.post<{ Body: { slug?: string; displayName?: string; draft?: unknown; tags?: string[]; variants?: unknown[]; parentCharacterId?: string | null } }>('/api/v1/admin/characters', async (request, reply) => {
    const body = request.body ?? {};
    const incoming: Record<string, unknown> = { ...(body.draft as object ?? {}) };
    if (body.displayName != null || !incoming.displayName) incoming.displayName = body.displayName ?? incoming.displayName ?? '';
    const draft = toAuthorityDraft(incoming);
    if (!draft.displayName) return reply.code(400).send({ error: 'display_name_required' });
    const id = randomUUID(); const now = nowIso(); const slug = uniqueSlug(database, request.body?.slug || draft.englishName || draft.displayName);
    const variants = Array.isArray(request.body?.variants) ? request.body.variants : [];
    const parentCharacterId = text(body.parentCharacterId ?? incoming.parentCharacterId, 200) || null;
    database.transaction(() => {
      database.connection.prepare(`INSERT INTO character_profiles
        (id,slug,display_name,draft_json,tags_json,avatar_asset_id,latest_version,archived,created_at,updated_at,draft_revision,variants_json,parent_character_id)
        VALUES (?,?,?,?,?,NULL,NULL,0,?,?,1,?,?)`).run(id, slug, draft.displayName, JSON.stringify(draft), JSON.stringify(list(request.body?.tags, 50)), now, now, JSON.stringify(variants), parentCharacterId);
      upsertCharacterBirthday(database, id, draft);
      syncCharacterSnapshotAfterChange(database, id);
    });
    return reply.code(201).send(mapProfile(database, database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(id) as Record<string, unknown>));
  });

  // 批量匹配官方形象（头像 / 立绘 / 全部皮肤，按作品单一默认源去重入库）
  app.post<{ Body: CharacterBatchAvatarRequest }>('/api/v1/admin/characters/batch-match-official-avatars', {
    preValidation: async (request) => { request.body ??= {}; },
    schema: { body: CharacterBatchAvatarRequestSchema },
  }, async (request) => {
    return runBatchOfficialAssets(config, database, fetcher, request.body ?? {});
  });

  // 批量获取并补全角色卡（RP 设定）
  app.post<{ Body: CharacterBatchEnrichRpRequest }>('/api/v1/admin/characters/batch-enrich-rp-cards', {
    preValidation: async (request) => { request.body ??= {}; },
    schema: { body: CharacterBatchEnrichRpRequestSchema },
  }, async (request) => {
    return runBatchEnrichRpCards(database, fetcher, request.body ?? {});
  });

  // 从本地精选人设库一键批量导入（自机 + 剧情 + NPC）
  app.post<{ Body: CharacterBatchImportLocalCardsRequest }>('/api/v1/admin/characters/batch-import-local-cards', {
    preValidation: async (request) => { request.body ??= {}; },
    schema: { body: CharacterBatchImportLocalCardsRequestSchema },
  }, async (request) => {
    return runBatchImportLocalPersonaCards(database, request.body ?? {});
  });

  // 官方角色头像一键匹配抓取（同步兼容单角快速按钮，支持全作品官方源）
  app.post<{ Params: { id: string } }>('/api/v1/admin/characters/:id/match-official-avatar', async (request, reply) => {
    const row = database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const draft = normalizeCharacterDraft(JSON.parse(String(row.draft_json)));
    const bundle = await resolveCharacterOfficialAssetBundle(
      String(row.display_name),
      (draft as Record<string, unknown>).englishName as string | undefined,
      (draft as Record<string, unknown>).work as string | undefined,
      undefined,
      fetcher,
    );
    if (!bundle?.avatar) {
      return reply.code(404).send({ error: 'no_official_avatar_found', message: `未在官方角色库中匹配到角色“${row.display_name}”。` });
    }

    const urls = bundle.avatar.candidateUrls.length ? bundle.avatar.candidateUrls : [bundle.avatar.url];
    let buffer: Buffer | null = null;
    let contentType = 'image/png';
    let resolvedUrl = urls[0];
    for (const u of urls) {
      try {
        const res = await fetcher(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000) });
        if (res.ok) {
          buffer = Buffer.from(await res.arrayBuffer());
          contentType = res.headers.get('content-type') || 'image/png';
          resolvedUrl = u;
          break;
        }
      } catch {
        // try next
      }
    }
    if (!buffer || buffer.length === 0) {
      return reply.code(502).send({ error: 'fetch_official_avatar_failed', message: `下载官方头像失败 (${row.display_name})，请检查网络连接或稍后重试。` });
    }

    const assetId = randomUUID(); const now = nowIso();
    const title = `${row.display_name} 官方头像`;
    const filename = `${row.display_name}_avatar.png`;
    const artifact = await streamUploadArtifact(config, database, {
      appId: 'characters',
      stream: Readable.from([buffer]),
      contentType,
      originalName: filename,
      refType: 'character-asset',
      refId: assetId,
      metadata: { characterId: request.params.id, kind: 'avatar', category: 'avatar' },
    });
    database.transaction(() => {
      database.connection.prepare(`INSERT INTO character_assets
        (id,character_id,kind,created_at,artifact_id,source_url,user_note,category,title,tags_json)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
          assetId, request.params.id, 'avatar', now, artifact.id, resolvedUrl,
          `官方抓取 (${bundle.sourceUsed})`, 'avatar', title, JSON.stringify(['官方头像']),
        );
      database.connection.prepare('UPDATE character_profiles SET avatar_asset_id=?,updated_at=? WHERE id=?').run(assetId, now, request.params.id);
      syncCharacterSnapshotAfterChange(database, request.params.id, { incrementRevision: true });
    });
    const updated = database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(request.params.id) as Record<string, unknown>;
    return mapProfile(database, updated);
  });

  // 从指定 URL 下载头像
  app.post<{ Params: { id: string }; Body: { url?: string } }>('/api/v1/admin/characters/:id/fetch-avatar-url', async (request, reply) => {
    const targetUrl = request.body?.url;
    if (!targetUrl || typeof targetUrl !== 'string') return reply.code(400).send({ error: 'url_required' });
    const row = database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    try {
      const res = await fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) return reply.code(400).send({ error: 'fetch_avatar_failed', message: `无法从提供的链接下载图片 (HTTP ${res.status})` });
      const buffer = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get('content-type') || 'image/png';
      const assetId = randomUUID(); const now = nowIso();
      const title = `${row.display_name} 头像`;
      const artifact = await streamUploadArtifact(config, database, {
        appId: 'characters', stream: Readable.from([buffer]), contentType,
        originalName: `avatar_${assetId}.png`, refType: 'character-asset', refId: assetId,
        metadata: { characterId: request.params.id, kind: 'avatar', category: 'avatar' },
      });
      database.transaction(() => {
        database.connection.prepare(`INSERT INTO character_assets
          (id,character_id,kind,created_at,artifact_id,source_url,user_note,category,title)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(assetId, request.params.id, 'avatar', now, artifact.id, targetUrl, 'URL导入头像', 'avatar', title);
        database.connection.prepare('UPDATE character_profiles SET avatar_asset_id=?,updated_at=? WHERE id=?').run(assetId, now, request.params.id);
        syncCharacterSnapshotAfterChange(database, request.params.id, { incrementRevision: true });
      });
      const updated = database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(request.params.id) as Record<string, unknown>;
      return mapProfile(database, updated);
    } catch (e) {
      return reply.code(500).send({ error: 'fetch_avatar_error', message: String(e) });
    }
  });

  // 迁移复核入口（规划第 7 节）：把「哪些角色还有待确认的迁移冲突、旧服装是什么」变成可查、可处理的接口。
  app.get('/api/v1/admin/character-migration-reviews', async () => {
    const rows = database.connection.prepare(`SELECT p.id,p.display_name,p.draft_json,p.draft_revision
      FROM character_profiles p
      WHERE EXISTS (SELECT 1 FROM character_sources c JOIN character_source_snapshots s ON s.id=c.source_snapshot_id
        WHERE c.character_id=p.id AND s.provider_id=? AND s.format='sthstart-draft-json-v1')
      ORDER BY p.display_name`).all(MIGRATION_PROVIDER_ID) as Record<string, unknown>[];
    const items = rows
      .map((row) => migrationReview(database, String(row.id), String(row.display_name), JSON.parse(String(row.draft_json)), Number(row.draft_revision ?? 1)))
      // 列表只列真正还有复核项的角色；旧服装备选单独看详情。
      .filter((review) => review.conflicts.length > 0);
    return { items, total: items.length };
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/characters/:id/migration-review', async (request, reply) => {
    const row = database.connection.prepare('SELECT id,display_name,draft_json,draft_revision FROM character_profiles WHERE id=?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return migrationReview(database, String(row.id), String(row.display_name), JSON.parse(String(row.draft_json)), Number(row.draft_revision ?? 1));
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/characters/:id', async (request, reply) => {
    const row = database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const versions = database.connection.prepare('SELECT * FROM character_versions WHERE character_id=? ORDER BY version DESC').all(request.params.id) as Record<string, unknown>[];
    const links = database.connection.prepare('SELECT app_id,local_id,source_version,local_modified,updated_at FROM app_character_links WHERE character_id=? ORDER BY app_id').all(request.params.id);
    return { ...mapProfile(database, row), versions: versions.map(mapVersion), sources: sourceRows(database, request.params.id), relationships: relationshipRows(database, request.params.id), links };
  });

  app.get<{ Params: { id: string; snapshotId: string } }>('/api/v1/admin/characters/:id/source-snapshots/:snapshotId/raw', async (request, reply) => {
    const snapshot = database.connection.prepare(`SELECT s.raw_file_path,s.format,s.raw_payload_json
      FROM character_source_snapshots s JOIN character_sources c ON c.source_snapshot_id=s.id
      WHERE c.character_id=? AND s.id=? LIMIT 1`).get(request.params.id, request.params.snapshotId) as { raw_file_path: string | null; format: string; raw_payload_json: string } | undefined;
    if (!snapshot) return reply.code(404).send({ error: 'not_found' });
    // 结构迁移的原文归档只存库内 JSON（raw_file_path 为空），没有磁盘文件。
    // 它本身就是原始载荷，直接返回即可；这不同于「文件丢失」——那种情况仍明确报缺失，不伪造内容。
    if (!snapshot.raw_file_path) {
      const inline = String(snapshot.raw_payload_json ?? '');
      if (!inline) return reply.code(404).send({ error: 'source_snapshot_file_not_found' });
      return reply.type('application/json; charset=utf-8').send(inline);
    }
    if (!existsSync(snapshot.raw_file_path)) return reply.code(404).send({ error: 'source_snapshot_file_not_found' });
    try {
      const bytes = await readFile(snapshot.raw_file_path);
      return reply.type(sourceSnapshotContentType(snapshot.format, snapshot.raw_payload_json)).send(bytes);
    } catch { return reply.code(404).send({ error: 'source_snapshot_file_not_found' }); }
  });

  app.put<{ Params: { id: string }; Body: { slug?: string; draft?: unknown; tags?: string[]; avatarAssetId?: string | null; expectedDraftRevision?: number; variants?: unknown[] } }>('/api/v1/admin/characters/:id', async (request, reply) => {
    const current = database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!current) return reply.code(404).send({ error: 'not_found' });
    const currentRevision = Number(current.draft_revision ?? 1);
    if (request.body?.expectedDraftRevision != null && Number(request.body.expectedDraftRevision) !== currentRevision) return reply.code(409).send({ error: 'draft_revision_conflict', draftRevision: currentRevision });
    // V1 细分字段无法无损还原 V2 正文结构：用旧载荷覆盖已升级角色会持续套叠小标题，
    // 因此明确拒绝，而不是静默降级或破坏结构。
    if (request.body?.draft !== undefined && isV2Draft(JSON.parse(String(current.draft_json))) && !isV2Draft(request.body.draft)) {
      return reply.code(409).send({ error: 'draft_schema_upgrade_required', message: '该角色已使用新版人设结构，请用新版编辑器保存；旧格式载荷不会被自动写回。' });
    }
    const draft = request.body?.draft === undefined
      ? normalizeCharacterDraft(JSON.parse(String(current.draft_json)))
      : toAuthorityDraft(request.body.draft);
    if (!draft.displayName) return reply.code(400).send({ error: 'display_name_required' });
    const slug = request.body?.slug ? uniqueSlug(database, request.body.slug, request.params.id) : String(current.slug);
    const tags = request.body?.tags ? list(request.body.tags, 50) : JSON.parse(String(current.tags_json));
    const rawAvatar = request.body?.avatarAssetId === undefined ? current.avatar_asset_id : request.body.avatarAssetId;
    const avatar = rawAvatar ? String(rawAvatar) : null;
    if (avatar && !database.connection.prepare('SELECT 1 FROM character_assets WHERE id=? AND character_id=?').get(avatar, request.params.id)) return reply.code(400).send({ error: 'invalid_avatar' });
    const nextRevision = currentRevision + 1;
    const variantsJson = request.body?.variants !== undefined ? JSON.stringify(request.body.variants) : String(current.variants_json || '[]');
    const statement = database.connection.prepare(`UPDATE character_profiles SET slug=?,display_name=?,draft_json=?,tags_json=?,avatar_asset_id=?,draft_revision=?,updated_at=?,variants_json=? WHERE id=?${request.body?.expectedDraftRevision != null ? ' AND draft_revision=?' : ''}`);
    const updated = database.transaction(() => {
      const result = request.body?.expectedDraftRevision != null
        ? statement.run(slug, draft.displayName, JSON.stringify(draft), JSON.stringify(tags), avatar, nextRevision, nowIso(), variantsJson, request.params.id, currentRevision)
        : statement.run(slug, draft.displayName, JSON.stringify(draft), JSON.stringify(tags), avatar, nextRevision, nowIso(), variantsJson, request.params.id);
      if (Number(result.changes) !== 1) return false;
      upsertCharacterBirthday(database, request.params.id, draft);
      syncCharacterSnapshotAfterChange(database, request.params.id);
      return true;
    });
    if (!updated) return reply.code(409).send({ error: 'draft_revision_conflict', draftRevision: currentRevision });
    return mapProfile(database, database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(request.params.id) as Record<string, unknown>);
  });

  app.post<{ Params: { id: string }; Body: { expectedDraftRevision?: number; versionLabel?: string } }>('/api/v1/admin/characters/:id/publish', async (request, reply) => {
    const row = database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (normalizeCharacterDraft(JSON.parse(String(row.draft_json))).originType === 'original' && !Number.isSafeInteger(request.body?.expectedDraftRevision)) {
      return reply.code(409).send({ error: 'expected_draft_revision_required', draftRevision: Number(row.draft_revision ?? 1) });
    }
    if (request.body?.expectedDraftRevision != null && Number(request.body.expectedDraftRevision) !== Number(row.draft_revision ?? 1)) return reply.code(409).send({ error: 'draft_revision_conflict', draftRevision: Number(row.draft_revision ?? 1) });
    const original = normalizeCharacterDraft(JSON.parse(String(row.draft_json))).originType === 'original';
    const published = original
      ? publishCharacterSnapshot(database, request.params.id, { versionLabel: request.body?.versionLabel, expectedDraftRevision: request.body?.expectedDraftRevision })
      : syncCharacterSnapshotAfterChange(database, request.params.id);
    if (!published) return reply.code(400).send({ error: 'character_incomplete', message: '发布前至少需要角色名称，以及人设正文或摘要。' });
    return reply.code(201).send(published);
  });

  // 从原作主卡（或同源卡）一键复制派生为某部「同人作品」的衍生角色，默认零拷贝共享原角色视觉资产
  app.post<{ Params: { id: string }; Body: CharacterForkDerivativeRequest }>('/api/v1/admin/characters/:id/fork-derivative', {
    schema: { body: CharacterForkDerivativeRequestSchema },
  }, async (request, reply) => {
    const source = database.connection.prepare('SELECT * FROM character_profiles WHERE id=? AND archived=0').get(request.params.id) as Record<string, unknown> | undefined;
    if (!source) return reply.code(404).send({ error: 'not_found' });

    const sourceDraft = toAuthorityDraft(JSON.parse(String(source.draft_json)));
    const targetWorkName = canonicalWork(database, text(request.body.targetWork, 200));
    if (!targetWorkName) return reply.code(400).send({ error: 'target_work_required', message: '请填写衍生同人作品名称。' });

    const parentWorkName = text(request.body.parentWork, 200) || canonicalWork(database, sourceDraft.work) || null;
    const existingWork = database.connection.prepare('SELECT work_nature,parent_work FROM character_works WHERE name=?').get(targetWorkName) as { work_nature: string; parent_work: string | null } | undefined;
    if (existingWork && (existingWork.work_nature !== 'derivative' || canonicalWork(database, existingWork.parent_work || '') !== canonicalWork(database, parentWorkName || ''))) {
      return reply.code(409).send({ error: 'derivative_work_conflict', message: '目标作品已经存在，请选择母作品一致的同人作品，或先在作品目录中调整分类。' });
    }
    const rootId = source.parent_character_id ? String(source.parent_character_id) : String(source.id);
    const newId = randomUUID();
    const now = nowIso();
    const displayName = text(request.body.displayName, 200) || sourceDraft.displayName;
    const slug = uniqueSlug(database, `${sourceDraft.englishName || displayName}-${targetWorkName}`);
    const derivativeDraft: CharacterDraftV2 = {
      ...structuredClone(sourceDraft),
      schemaVersion: 2,
      displayName,
      originType: 'derivative',
      work: targetWorkName,
      parentCharacterId: rootId,
      summary: text(request.body.summary, 2000) || sourceDraft.summary,
    };
    const interpretation = text(request.body.interpretation, 100) || targetWorkName;
    const org = {
      ...normalizeOrganization(JSON.parse(String(source.organization_json || '{}'))),
      interpretation,
    };
    const shareAssets = request.body.shareAssets !== false;
    const tags = JSON.parse(String(source.tags_json || '[]')) as string[];

    let createdWork!: CharacterWork;
    try { database.transaction(() => {
      createdWork = upsertCharacterWorkHierarchy(database, {
        name: targetWorkName,
        workNature: 'derivative',
        parentWork: parentWorkName,
      });

      const sourceVariants = (() => {
        try { return JSON.parse(String(source.variants_json || '[]')) as CharacterVariant[]; } catch { return []; }
      })();
      const assetIdMap = new Map<string, string>();
      const sourceAssets = shareAssets
        ? (database.connection.prepare('SELECT * FROM character_assets WHERE character_id=? ORDER BY created_at ASC').all(String(source.id)) as Array<Record<string, string | number | bigint | Uint8Array | null>>)
        : [];
      for (const asset of sourceAssets) {
        assetIdMap.set(String(asset.id), randomUUID());
      }

      const clonedAvatarId = source.avatar_asset_id ? (assetIdMap.get(String(source.avatar_asset_id)) ?? null) : null;
      const clonedPortraitId = source.portrait_asset_id ? (assetIdMap.get(String(source.portrait_asset_id)) ?? null) : null;
      const clonedVariants = shareAssets
        ? sourceVariants.map((variant) => ({
            ...variant,
            avatarAssetId: variant.avatarAssetId ? (assetIdMap.get(variant.avatarAssetId) ?? null) : null,
            avatarUrl: variant.avatarAssetId && assetIdMap.has(variant.avatarAssetId)
              ? `/api/admin/characters/assets/${assetIdMap.get(variant.avatarAssetId)}`
              : variant.avatarUrl,
            portraitAssetId: variant.portraitAssetId ? (assetIdMap.get(variant.portraitAssetId) ?? null) : null,
            portraitUrl: variant.portraitAssetId && assetIdMap.has(variant.portraitAssetId)
              ? `/api/admin/characters/assets/${assetIdMap.get(variant.portraitAssetId)}`
              : variant.portraitUrl,
          }))
        : [];

      // Insert character_profiles first so child character_assets/visual_references foreign keys resolve cleanly.
      database.connection.prepare(`INSERT INTO character_profiles
        (id,slug,display_name,draft_json,tags_json,avatar_asset_id,portrait_asset_id,latest_version,archived,created_at,updated_at,draft_revision,organization_json,variants_json,parent_character_id)
        VALUES (?,?,?,?,?,?,?,NULL,0,?,?,1,?,?,?)`).run(
        newId,
        slug,
        derivativeDraft.displayName,
        JSON.stringify(derivativeDraft),
        JSON.stringify(tags),
        clonedAvatarId,
        clonedPortraitId,
        now,
        now,
        JSON.stringify(org),
        JSON.stringify(clonedVariants),
        rootId,
      );

      if (shareAssets) {
        for (const asset of sourceAssets) {
          const clonedAssetId = assetIdMap.get(String(asset.id))!;
          database.connection.prepare(`INSERT INTO character_assets
            (id,character_id,kind,created_at,artifact_id,source_page,source_url,author_note,user_note,category,title,tags_json,metadata_json)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            clonedAssetId,
            newId,
            asset.kind,
            now,
            asset.artifact_id,
            asset.source_page,
            asset.source_url,
            asset.author_note,
            asset.user_note,
            asset.category,
            asset.title,
            asset.tags_json,
            asset.metadata_json,
          );
          if (asset.artifact_id) {
            createArtifactReference(database, {
              artifactId: String(asset.artifact_id),
              appId: 'characters',
              refType: 'character-asset',
              refId: clonedAssetId,
            });
          }
        }
      }

      if (shareAssets) {
        const sourceRefs = database.connection.prepare('SELECT * FROM character_visual_references WHERE character_id=?').all(String(source.id)) as Array<Record<string, string | number | bigint | Uint8Array | null>>;
        for (const ref of sourceRefs) {
          const mappedAssetId = assetIdMap.get(String(ref.asset_id));
          if (!mappedAssetId) continue;
          database.connection.prepare(`INSERT INTO character_visual_references
            (id,character_id,asset_id,purposes_json,enabled,crop_json,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?)`).run(
            randomUUID(),
            newId,
            mappedAssetId,
            ref.purposes_json,
            ref.enabled,
            ref.crop_json,
            now,
            now,
          );
        }
      }

      upsertCharacterBirthday(database, newId, derivativeDraft);
      publishCharacterSnapshot(database, newId, { versionLabel: targetWorkName, allowIncomplete: true });
    }); } catch (error) {
      const detail = error as Error & { statusCode?: number; code?: string };
      if (!detail.statusCode) throw error;
      return reply.code(detail.statusCode === 409 ? 409 : 400).send({ error: detail.code || detail.message });
    }

    const createdProfile = mapProfile(database, database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(newId) as Record<string, unknown>);
    return reply.code(201).send({ character: createdProfile, work: createdWork });
  });

  app.post<{ Params: { id: string }; Body: { description?: string; useWeb?: boolean } }>('/api/v1/admin/characters/:id/generate', async (request, reply) => {
    const row = database.connection.prepare('SELECT draft_revision, draft_json FROM character_profiles WHERE id=?').get(request.params.id) as { draft_revision: number; draft_json: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const description = text(request.body?.description, 4_000);
    if (description.length < 2) return reply.code(400).send({ error: 'description_required' });
    try {
      let existingWork = '';
      try { existingWork = normalizeCharacterDraft(JSON.parse(row.draft_json)).work || ''; } catch {}
      const preview = request.body?.useWeb === false
        ? null
        : await runUpstreamCharacterResearch(database, secrets, config, fetcher, { query: description, work: existingWork });
      const draft = preview ? preview.draft : await generateDraft(database, secrets, fetcher, description, []);
      const found = preview?.sources ?? [];
      const now = nowIso(); database.transaction(() => {
        const latest = database.connection.prepare('SELECT draft_revision FROM character_profiles WHERE id=?').get(request.params.id) as { draft_revision: number } | undefined;
        if (Number(latest?.draft_revision) !== Number(row.draft_revision ?? 1)) throw new Error('draft_revision_conflict');
        database.connection.prepare('UPDATE character_profiles SET display_name=?,draft_json=?,draft_revision=?,updated_at=? WHERE id=?').run(draft.displayName, JSON.stringify(draft), Number(row.draft_revision ?? 1) + 1, now, request.params.id);
        upsertCharacterBirthday(database, request.params.id, draft);
        saveUpstreamEvidence(database, request.params.id, found, now);
        syncCharacterSnapshotAfterChange(database, request.params.id);
      });
      return { draft, sources: sourceRows(database, request.params.id) };
    } catch (error) { return reply.code(error instanceof Error && error.message === 'draft_revision_conflict' ? 409 : 502).send({ error: error instanceof Error && error.message === 'draft_revision_conflict' ? 'draft_revision_conflict' : 'generation_failed', message: error instanceof Error ? error.message : String(error) }); }
  });

  // 上游多源 RP 卡与皮肤/衍生形态预览采集
  app.post<{ Body: CharacterUpstreamResearchRequest }>('/api/v1/admin/characters/upstream-research', {
    schema: { body: CharacterUpstreamResearchRequestSchema },
  }, async (request, reply) => {
    try {
      return await runUpstreamCharacterResearch(database, secrets, config, fetcher, request.body);
    } catch (error) {
      return reply.code(502).send({ error: 'upstream_research_failed', message: error instanceof Error ? error.message : String(error) });
    }
  });

  // 将用户审核后的上游 RP 文本、衍生形态 (variants) 与多皮肤/资产批量写入角色档案
  app.post<{ Params: { id: string }; Body: CharacterUpstreamApplyRequest }>('/api/v1/admin/characters/:id/apply-upstream', {
    schema: { body: CharacterUpstreamApplyRequestSchema },
  }, async (request, reply) => {
    const profileRow = database.connection.prepare('SELECT * FROM character_profiles WHERE id=? AND archived=0').get(request.params.id) as Record<string, unknown> | undefined;
    if (!profileRow) return reply.code(404).send({ error: 'not_found' });

    const currentRevision = Number(profileRow.draft_revision ?? 1);
    if (request.body.expectedDraftRevision != null && Number(request.body.expectedDraftRevision) !== currentRevision) {
      return reply.code(409).send({ error: 'draft_revision_conflict', draftRevision: currentRevision });
    }

    const currentRuntime = toCharacterRuntime(normalizeCharacterDraft(JSON.parse(String(profileRow.draft_json))));
    const incomingRuntime = toCharacterRuntime(normalizeCharacterDraft(request.body.draft));
    const apply = request.body.applyTextFields ?? {};

    const nextDraft: CharacterDraftV2 = {
      schemaVersion: 2,
      displayName: incomingRuntime.displayName || currentRuntime.displayName,
      englishName: incomingRuntime.englishName || currentRuntime.englishName,
      aliases: incomingRuntime.aliases.length ? [...incomingRuntime.aliases] : [...currentRuntime.aliases],
      originType: incomingRuntime.originType || currentRuntime.originType,
      work: incomingRuntime.work || currentRuntime.work,
      summary: apply.summary !== false && incomingRuntime.summary ? incomingRuntime.summary : currentRuntime.summary,
      personaText: apply.personaText !== false && incomingRuntime.personaText ? stripMachineCharacterIndex(incomingRuntime.personaText) : stripMachineCharacterIndex(currentRuntime.personaText),
      speechText: apply.speechText !== false && incomingRuntime.speechText ? incomingRuntime.speechText : currentRuntime.speechText,
      dialogueExamples: apply.dialogueExamples !== false && incomingRuntime.dialogueExamples.length ? [...incomingRuntime.dialogueExamples] : [...currentRuntime.dialogueExamples],
      behaviorRules: apply.behaviorRules !== false && incomingRuntime.behaviorRules ? incomingRuntime.behaviorRules : currentRuntime.behaviorRules,
      appearance: {
        baseText: apply.appearance !== false && incomingRuntime.appearance.baseText ? incomingRuntime.appearance.baseText : currentRuntime.appearance.baseText,
        defaultOutfitText: apply.appearance !== false && incomingRuntime.appearance.defaultOutfitText ? incomingRuntime.appearance.defaultOutfitText : currentRuntime.appearance.defaultOutfitText,
      },
      birthday: request.body.draft.birthday || currentRuntime.birthday,
    };

    const existingTags: string[] = (() => { try { return JSON.parse(String(profileRow.tags_json || '[]')); } catch { return []; } })();
    const nextTags = apply.tags !== false && request.body.tags?.length
      ? [...new Set([...existingTags, ...request.body.tags])]
      : existingTags;

    const existingVariants: CharacterVariant[] = (() => { try { return JSON.parse(String(profileRow.variants_json || '[]')); } catch { return []; } })();
    const warnings: string[] = [];
    const createdAssetIds: string[] = [];
    const stagedAssetWrites: Array<() => void> = [];
    let selectedAvatar: string | undefined;
    let selectedPortrait: string | undefined;
    let importedAssetCount = 0;
    let createdSkinCount = 0;
    let createdVariantCount = 0;

    // 1. 导入选中的通用资产（主头像、主立绘等）
    for (const assetReq of request.body.selectedAssets || []) {
      const saved = await downloadAndSaveCharacterAsset(config, database, fetcher, request.params.id, { ...assetReq, setAsActive: false }, true, stagedAssetWrites);
      if (saved) {
        importedAssetCount += 1; createdAssetIds.push(saved.id);
        if (assetReq.setAsActive && assetReq.kind === 'avatar') selectedAvatar = saved.id;
        if (assetReq.setAsActive && assetReq.kind === 'portrait') selectedPortrait = saved.id;
      }
      else warnings.push(`资产下载失败: ${assetReq.title || assetReq.url}`);
    }

    // 2. 导入选中的「普通多皮肤」（保留各自服装描述与背景故事，入 costume 资产 + 生图参考）
    for (const skin of request.body.selectedSkins || []) {
      if (!skin.selected) continue;
      const targetUrl = skin.portraitUrl || skin.avatarUrl;
      let skinSaved = false;
      if (targetUrl) {
        const saved = await downloadAndSaveCharacterAsset(config, database, fetcher, request.params.id, {
          kind: 'reference',
          category: 'costume',
          title: `皮肤 · ${skin.name}`,
          url: targetUrl,
          source: skin.source,
          registerReference: true,
          skinName: skin.name,
          outfitDescription: skin.outfitDescription,
          loreStory: skin.loreStory,
          tags: [skin.name, '皮肤'],
        }, true, stagedAssetWrites);
        if (saved) { importedAssetCount += 1; skinSaved = true; createdAssetIds.push(saved.id); }
        else warnings.push(`皮肤「${skin.name}」图片下载失败，服装描述和故事已保留。`);
      }
      if (!skinSaved) {
        const textAssetId = randomUUID();
        stagedAssetWrites.push(() => { database.connection.prepare(`INSERT INTO character_assets
          (id,character_id,kind,created_at,artifact_id,source_page,source_url,author_note,user_note,category,title,tags_json,metadata_json)
          VALUES (?,?,'reference',?,NULL,?,?,?,?,'costume',?,?,?)`).run(
          textAssetId, request.params.id, nowIso(), skin.source || null, targetUrl || null, skin.loreStory, skin.outfitDescription,
          `皮肤 · ${skin.name}`, JSON.stringify([skin.name, '皮肤']), JSON.stringify({ skinName: skin.name, outfitDescription: skin.outfitDescription, loreStory: skin.loreStory, imageStatus: 'unavailable', ...(targetUrl ? { imageWarning: '图片下载失败' } : {}) }),
        ); });
        createdAssetIds.push(textAssetId);
      }
      createdSkinCount += 1;
    }

    // 3. 导入选中的「衍生形态」（崩坏三装甲 / 星铁 SP 等，携带独立服装描述、背景故事与立绘）
    const nextVariants = [...existingVariants];
    for (const variant of request.body.selectedVariants || []) {
      if (!variant.selected) continue;
      let avatarAssetId: string | null = null;
      let portraitAssetId: string | null = null;
      if (variant.avatarUrl) {
        const savedAv = await downloadAndSaveCharacterAsset(config, database, fetcher, request.params.id, {
          kind: 'avatar',
          category: 'avatar',
          title: `形态头像 · ${variant.name}`,
          url: variant.avatarUrl,
          source: variant.source,
          skinName: variant.name,
          outfitDescription: variant.outfitDescription,
          loreStory: variant.loreStory,
          tags: [variant.name, '衍生形态'],
          setAsActive: false,
        }, true, stagedAssetWrites);
        if (savedAv) { avatarAssetId = savedAv.id; importedAssetCount += 1; createdAssetIds.push(savedAv.id); }
        else warnings.push(`形态「${variant.name}」头像下载失败，形态文字已保留。`);
      }
      if (variant.portraitUrl) {
        const savedPort = await downloadAndSaveCharacterAsset(config, database, fetcher, request.params.id, {
          kind: 'reference',
          category: 'costume',
          title: `形态立绘 · ${variant.name}`,
          url: variant.portraitUrl,
          source: variant.source,
          registerReference: true,
          skinName: variant.name,
          outfitDescription: variant.outfitDescription,
          loreStory: variant.loreStory,
          tags: [variant.name, '衍生形态'],
        }, true, stagedAssetWrites);
        if (savedPort) { portraitAssetId = savedPort.id; importedAssetCount += 1; createdAssetIds.push(savedPort.id); }
        else warnings.push(`形态「${variant.name}」立绘下载失败，形态文字已保留。`);
      }

      const idx = nextVariants.findIndex((v) => v.name.trim() === variant.name.trim());
      const previousVariant = idx >= 0 ? nextVariants[idx] : undefined;
      const hasStory = Boolean(variant.loreStory.trim());
      const hasOutfit = Boolean(variant.outfitDescription.trim());
      const missingFields = [!hasStory && '形态故事', !hasOutfit && '服装描述'].filter(Boolean);
      if (missingFields.length) warnings.push(`形态「${variant.name}」缺少${missingFields.join('、')}，对应内容沿用主档案或已保存的形态资料。`);
      const builtVariant: CharacterVariant = {
        ...previousVariant,
        id: idx >= 0 ? nextVariants[idx].id : randomUUID(),
        name: variant.name,
        ...(variant.variantKind ? { variantKind: variant.variantKind } : {}),
        // Upstream stories describe a form, not the character's complete identity.
        // Missing evidence inherits the main draft; manual empty-string overrides remain meaningful.
        ...(hasStory ? { personaText: [nextDraft.personaText, `## 形态经历：${variant.name}`, variant.loreStory].filter(Boolean).join('\n\n') } : {}),
        ...(hasOutfit ? { appearance: {
          baseText: previousVariant?.appearance?.baseText ?? nextDraft.appearance.baseText,
          defaultOutfitText: variant.outfitDescription,
        } } : {}),
        ...(avatarAssetId ? { avatarAssetId, avatarUrl: `/api/admin/characters/assets/${avatarAssetId}` } : {}),
        ...(portraitAssetId ? { portraitAssetId, portraitUrl: `/api/admin/characters/assets/${portraitAssetId}` } : {}),
      };
      if (idx >= 0) nextVariants[idx] = builtVariant;
      else { nextVariants.push(builtVariant); createdVariantCount += 1; }
    }

    const now = nowIso();
    try { database.transaction(() => {
      const latest = database.connection.prepare('SELECT draft_revision FROM character_profiles WHERE id=?').get(request.params.id) as { draft_revision: number };
      // Asset downloads await network I/O; never overwrite a draft edited in the meantime.
      if (Number(latest.draft_revision) !== currentRevision) throw new Error('draft_revision_conflict');
      for (const saveAsset of stagedAssetWrites) saveAsset();
      database.connection.prepare(
        'UPDATE character_profiles SET display_name=?,draft_json=?,tags_json=?,variants_json=?,draft_revision=?,updated_at=? WHERE id=?',
      ).run(
        nextDraft.displayName,
        JSON.stringify(nextDraft),
        JSON.stringify(nextTags),
        JSON.stringify(nextVariants),
        currentRevision + 1,
        now,
        request.params.id,
      );
      upsertCharacterBirthday(database, request.params.id, nextDraft);
      if (selectedAvatar) database.connection.prepare('UPDATE character_profiles SET avatar_asset_id=? WHERE id=?').run(selectedAvatar, request.params.id);
      if (selectedPortrait) database.connection.prepare('UPDATE character_profiles SET portrait_asset_id=? WHERE id=?').run(selectedPortrait, request.params.id);
      saveUpstreamEvidence(database, request.params.id, request.body.sources || [], now);
      if (nextDraft.originType !== 'original') {
        publishCharacterSnapshot(database, request.params.id, { allowIncomplete: true });
      }
    }); } catch (error) {
      database.transaction(() => {
        for (const assetId of createdAssetIds) {
          database.connection.prepare('DELETE FROM character_visual_references WHERE asset_id=?').run(assetId);
          database.connection.prepare('DELETE FROM character_assets WHERE id=? AND character_id=?').run(assetId, request.params.id);
          database.connection.prepare('DELETE FROM artifact_references WHERE app_id=? AND ref_id=?').run('characters', assetId);
        }
      });
      if (error instanceof Error && error.message === 'draft_revision_conflict') {
        const latest = database.connection.prepare('SELECT draft_revision FROM character_profiles WHERE id=?').get(request.params.id) as { draft_revision: number };
        return reply.code(409).send({ error: 'draft_revision_conflict', draftRevision: latest.draft_revision });
      }
      throw error;
    }

    const updatedRow = database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(request.params.id) as Record<string, unknown>;
    return {
      profile: mapProfile(database, updatedRow),
      importedAssetCount,
      createdVariantCount,
      createdSkinCount,
      warnings,
    };
  });

  app.post<{ Params: { id: string }; Body: CharacterAvatarGenerationRequest }>('/api/v1/admin/characters/:id/generate-avatar', {
    preValidation: async request => { request.body ??= {}; },
    schema: { body: CharacterAvatarGenerationRequestSchema },
  }, async (request, reply) => {
    const row = database.connection.prepare('SELECT draft_json,variants_json FROM character_profiles WHERE id=?').get(request.params.id) as { draft_json: string; variants_json: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const variant = request.body.variantId ? (JSON.parse(row.variants_json || '[]') as CharacterVariant[]).find(item => item.id === request.body.variantId) : undefined;
    if (request.body.variantId && !variant) return reply.code(404).send({ error: 'variant_not_found' });
    const draft = characterDraftForVariant(JSON.parse(row.draft_json), variant);
    const prompt = text(request.body?.prompt, 10_000) || characterAvatarPrompt(draft);
    if (prompt.length < 2) return reply.code(400).send({ error: 'appearance_required', message: '请先补充角色外观描述。' });
    const seed = request.body?.seed == null ? null : Number(request.body.seed);
    if (seed !== null && (!Number.isSafeInteger(seed) || seed < 0)) return reply.code(400).send({ error: 'invalid_seed' });
    const header = request.headers['idempotency-key'];
    try {
      const body = request.body ?? {};
      if (body.preparationId) {
        const preparation = database.connection.prepare('SELECT request_snapshot_json FROM ai_call_records WHERE id=?').get(body.preparationId) as { request_snapshot_json: string } | undefined;
        const preparedCharacters = preparation ? JSON.parse(preparation.request_snapshot_json)?.context?.characters ?? [] : [];
        if (!preparedCharacters.some((item: { characterId: string; variantId?: string }) => item.characterId === request.params.id && (item.variantId || null) === (body.variantId || null))) {
          return reply.code(409).send({ error: 'prompt_preparation_variant_mismatch', message: '形态已变化，请重新准备提示词。' });
        }
      }
      const avatarConfiguration = resolveImageConfiguration(database, { appId: 'characters', purpose: 'character-avatar', presetId: body.presetId, presetRevision: body.presetRevision });
      const referenceAssetId = variant?.portraitAssetId || variant?.avatarAssetId;
      const referenceArtifact = referenceAssetId ? database.connection.prepare('SELECT artifact_id FROM character_assets WHERE id=? AND character_id=?').get(referenceAssetId, request.params.id) as { artifact_id: string | null } | undefined : undefined;
      const referenceInputKey = avatarConfiguration.configuration.referenceInputKey;
      const preparedContext = body.preparationId
        ? assertPreparedImageContext(database, 'characters', body.preparationId, body.contextHash, request.params.id, {
          workflowId: avatarConfiguration.workflow.id, workflowVersion: avatarConfiguration.workflow.version,
          configurationHash: avatarConfiguration.configuration.configurationHash })
        : { loras: buildImageContext(database, { characters: [{ characterId: request.params.id, ...(body.variantId ? { variantId: body.variantId } : {}) }] }, resolveImageConfiguration(database,
          { appId: 'characters', purpose: 'character-avatar', presetId: body.presetId, presetRevision: body.presetRevision }).workflow).loras };
      const audit = body.configurationHash || body.optimizerCallId
        ? imageGenerationAudit(database, { appId: 'characters', purpose: 'character-avatar', presetId: body.presetId, presetRevision: body.presetRevision }, body.configurationHash, body.optimizerCallId, body.sourceDescription) : {};
      const avatarInputs = body.parameters ? mergeImageParameters(resolveImageConfiguration(database, { appId: 'characters', purpose: 'character-avatar', presetId: body.presetId, presetRevision: body.presetRevision }), body.parameters) : { prompt };
      const task = await createGenerationTask(config, database, secrets, {
        appId: 'characters', purpose: 'character-avatar',
        inputs: { ...avatarInputs, characterId: request.params.id, ...(body.variantId ? { variantId: body.variantId } : {}) },
        ...(referenceArtifact?.artifact_id && referenceInputKey ? { inputArtifacts: [{ artifactId: referenceArtifact.artifact_id, inputKey: referenceInputKey }] } : {}),
        onInsertTask: ({ taskId }) => {
          const stored = database.connection.prepare('SELECT request_params_json FROM generation_tasks WHERE id=?').get(taskId) as { request_params_json: string };
          const params = JSON.parse(stored.request_params_json);
          params.context = { ...params.context, character: { characterId: request.params.id, ...(body.variantId ? { variantId: body.variantId } : {}) } };
          database.connection.prepare('UPDATE generation_tasks SET request_params_json=? WHERE id=?').run(JSON.stringify(params), taskId);
        },
        presetId: body.presetId, presetRevision: body.presetRevision,
        activityLoras: preparedContext.loras,
        audit: { feature: 'character-avatar', ...audit, ...(body.preparationId ? { parentId: body.preparationId } : {}),
          visualConfiguration: { ...('visualConfiguration' in audit ? audit.visualConfiguration as Record<string, unknown> : {}), contextHash: body.contextHash ?? null, preparationId: body.preparationId ?? null } },
        seed, priority: 'interactive', idempotencyKey: typeof header === 'string' ? header : body.idempotencyKey ?? null,
      }, fetcher);
      return reply.code(202).send(task);
    } catch (error) { return generationError(reply, error); }
  });

  app.get<{ Params: { id: string; taskId: string } }>('/api/v1/admin/characters/:id/generation-tasks/:taskId', async (request, reply) => {
    if (!characterGenerationTask(database, request.params.taskId, request.params.id)) return reply.code(404).send({ error: 'not_found' });
    const task = getGenerationTask(database, request.params.taskId, 'characters');
    return task ? task : reply.code(404).send({ error: 'not_found' });
  });

  app.post<{ Params: { id: string; taskId: string } }>('/api/v1/admin/characters/:id/generation-tasks/:taskId/apply-avatar', async (request, reply) => {
    if (!database.connection.prepare('SELECT 1 FROM character_profiles WHERE id=?').get(request.params.id)) return reply.code(404).send({ error: 'not_found' });
    const generationRow = characterGenerationTask(database, request.params.taskId, request.params.id);
    if (!generationRow) return reply.code(404).send({ error: 'not_found' });
    const task = getGenerationTask(database, request.params.taskId, 'characters');
    if (!task) return reply.code(404).send({ error: 'not_found' });
    if (task.status !== 'succeeded') return reply.code(409).send({ error: 'task_not_succeeded', status: task.status });
    const output = task.artifacts.find((artifact) => artifact.mediaKind === 'image' || artifact.contentType?.startsWith('image/'));
    if (!output) return reply.code(409).send({ error: 'image_output_missing' });
    const artifact = await readArtifact(database, output.artifactId);
    if (!artifact || artifact.fileStatus !== 'ready' || !artifact.localPath || !existsSync(artifact.localPath)) return reply.code(404).send({ error: 'artifact_not_ready' });
    const storedRequest = JSON.parse(generationRow.request_params_json);
    const variantId = storedRequest.context?.character?.variantId || storedRequest.inputs?.variantId;
    const current = database.connection.prepare('SELECT avatar_asset_id,variants_json FROM character_profiles WHERE id=?').get(request.params.id) as { avatar_asset_id: string | null; variants_json: string };
    const variants = JSON.parse(current.variants_json || '[]') as CharacterVariant[];
    const variant = variantId ? variants.find(item => item.id === variantId) : undefined;
    if (variantId && !variant) return reply.code(409).send({ error: 'variant_not_found', message: '生成时选择的形态已删除，不能写入主档案。' });
    const assetId = randomUUID(); const now = nowIso();
    try {
      database.transaction(() => {
        database.connection.prepare(`INSERT INTO character_assets
          (id,character_id,kind,created_at,artifact_id,category,title)
          VALUES (?,?,?,?,?,?,?)`).run(assetId, request.params.id, 'avatar', now, artifact.id, 'avatar', variant ? `形态头像 · ${variant.name}` : 'AI 生成头像');
        if (variant) {
          variant.avatarAssetId = assetId;
          variant.avatarUrl = `/api/admin/characters/assets/${assetId}`;
          database.connection.prepare('UPDATE character_profiles SET variants_json=?,updated_at=? WHERE id=?').run(JSON.stringify(variants), now, request.params.id);
        } else database.connection.prepare('UPDATE character_profiles SET avatar_asset_id=?,updated_at=? WHERE id=?').run(assetId, now, request.params.id);
        createArtifactReference(database, { artifactId: artifact.id, appId: 'characters', refType: 'character-asset', refId: assetId });
        syncCharacterSnapshotAfterChange(database, request.params.id, { incrementRevision: true });
      });
    } catch (error) { return generationError(reply, error); }
    return reply.code(201).send({ id: assetId, url: `/api/admin/characters/assets/${assetId}` });
  });

  app.post<{ Body: { card?: Record<string, unknown> } }>('/api/v1/admin/characters/import-tavern', async (request, reply) => {
    if (!request.body?.card || typeof request.body.card !== 'object') return reply.code(400).send({ error: 'invalid_tavern_card' });
    try {
      const session = await createCharacterImportSession(database, config, cardProviders, { card: request.body.card });
      if (!session.candidate?.draft.displayName) return reply.code(400).send({ error: 'card_name_required' });
      const result = await commitCharacterImportSession(database, config, session.id, {
        expectedPreviewRevision: session.previewRevision, previewHash: session.previewHash, idempotencyKey: `legacy-tavern-${session.id}`,
      });
      const row = database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(String(result.characterId)) as Record<string, unknown>;
      return reply.code(201).send(mapProfile(database, row));
    } catch (error) { return characterImportError(reply, error); }
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/characters/:id/export-tavern', async (request, reply) => {
    const row = database.connection.prepare('SELECT draft_json FROM character_profiles WHERE id=?').get(request.params.id) as { draft_json: string } | undefined; if (!row) return reply.code(404).send({ error: 'not_found' });
    const draft = normalizeCharacterDraft(JSON.parse(row.draft_json));
    // 结构化生日写在本应用的扩展命名空间，不向标准格式杜撰顶层必填字段。
    // 酒馆卡没有 V2 的新字段，用运行时视图映射：人设正文与行为约束合并进 description，
    // 说话方式与边界不重复塞进 personality 以外的位置，示例保持完整轮次。
    const runtime = toCharacterRuntime(draft);
    const description = [runtime.personaText, runtime.behaviorRules].filter((part) => part.trim()).join('\n\n');
    return { spec: 'chara_card_v2', spec_version: '2.0', data: { name: runtime.displayName, description, personality: runtime.speechText, scenario: '', first_mes: '', mes_example: runtime.dialogueExamples.join('\n'), creator_notes: '', system_prompt: compileLinshePrompt(draft), post_history_instructions: '', alternate_greetings: [], tags: [], creator: 'SthStart', character_version: '1.0', extensions: { sthstart: { birthday: effectiveBirthday(draft) } } } };
  });

  app.put<{ Params: { id: string }; Body: { toCharacterId?: string; relationType?: string; description?: string } }>('/api/v1/admin/characters/:id/relationship', async (request, reply) => {
    const target = request.body?.toCharacterId; if (!target || target === request.params.id || !database.connection.prepare('SELECT 1 FROM character_profiles WHERE id=?').get(target)) return reply.code(400).send({ error: 'invalid_relationship_target' });
    const existing = database.connection.prepare('SELECT id FROM character_relationships WHERE from_character_id=? AND to_character_id=?').get(request.params.id, target) as { id: string } | undefined; const id = existing?.id ?? randomUUID();
    database.connection.prepare(`INSERT INTO character_relationships VALUES (?,?,?,?,?,?) ON CONFLICT(from_character_id,to_character_id) DO UPDATE SET relation_type=excluded.relation_type,description=excluded.description,updated_at=excluded.updated_at`).run(id, request.params.id, target, text(request.body.relationType, 200), text(request.body.description, 4_000), nowIso());
    for (const affected of [request.params.id, target]) syncCharacterSnapshotAfterChange(database, affected, { incrementRevision: true });
    return { id };
  });

  app.delete<{ Params: { id: string; relationshipId: string } }>('/api/v1/admin/characters/:id/relationships/:relationshipId', async (request, reply) => {
    const relationship = database.connection.prepare('SELECT from_character_id,to_character_id FROM character_relationships WHERE id=? AND (from_character_id=? OR to_character_id=?)').get(request.params.relationshipId, request.params.id, request.params.id) as { from_character_id: string; to_character_id: string } | undefined;
    const result = database.connection.prepare('DELETE FROM character_relationships WHERE id=? AND (from_character_id=? OR to_character_id=?)').run(request.params.relationshipId, request.params.id, request.params.id);
    if (result.changes && relationship) for (const affected of [relationship.from_character_id, relationship.to_character_id]) syncCharacterSnapshotAfterChange(database, affected, { incrementRevision: true });
    return result.changes ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  app.post<{ Params: { id: string }; Body: { dataUrl?: string; filename?: string; kind?: 'avatar' | 'portrait' | 'reference'; category?: string; title?: string; tags?: string[]; metadata?: Record<string, unknown>; setAsActive?: boolean; purposes?: string[]; sourcePage?: string; originalUrl?: string; authorNote?: string; userNote?: string; outfitId?: string | null } }>('/api/v1/admin/characters/:id/assets', async (request, reply) => {
    if (!database.connection.prepare('SELECT 1 FROM character_profiles WHERE id=?').get(request.params.id)) return reply.code(404).send({ error: 'not_found' });
    const match = request.body?.dataUrl?.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/); if (!match) return reply.code(400).send({ error: 'invalid_image' });
    const bytes = Buffer.from(match[2], 'base64'); if (bytes.length > 8 * 1024 * 1024) return reply.code(413).send({ error: 'image_too_large' });
    const id = randomUUID(); const now = nowIso(); const originalName = request.body.filename?.slice(0, 255) || `${id}.${match[1].split('/')[1].replace('jpeg', 'jpg')}`;
    const rawCategory = request.body.category;
    const rawKind = request.body.kind;
    const category = rawCategory || (rawKind === 'avatar' ? 'avatar' : rawKind === 'portrait' ? 'portrait' : 'concept');
    const kind: 'avatar' | 'portrait' | 'reference' = rawKind || (category === 'avatar' ? 'avatar' : category === 'portrait' ? 'portrait' : 'reference');
    const title = request.body.title?.slice(0, 200) || originalName;
    const tags = Array.isArray(request.body.tags) ? request.body.tags.filter(t => typeof t === 'string').map(t => t.trim()).filter(Boolean) : [];
    const metadata = request.body.metadata && typeof request.body.metadata === 'object' ? request.body.metadata : {};
    const artifact = await streamUploadArtifact(config, database, { appId: 'characters', stream: Readable.from([bytes]), contentType: match[1], originalName, refType: 'character-asset', refId: id, metadata: { characterId: request.params.id, kind, category } });
    const purposes = Array.isArray(request.body.purposes) ? [...new Set(request.body.purposes.filter((purpose): purpose is string => ['avatar', 'identity', 'outfit', 'pose', 'style', 'init_image'].includes(purpose)))].slice(0, 10) : (kind === 'reference' ? ['identity'] : [kind]);
    try {
      database.connection.prepare(`INSERT INTO character_assets
        (id,character_id,kind,created_at,artifact_id,source_page,source_url,author_note,user_note,category,title,tags_json,metadata_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          id, request.params.id, kind, now, artifact.id,
          request.body.sourcePage?.slice(0, 2_000) || null,
          request.body.originalUrl?.slice(0, 2_000) || null,
          request.body.authorNote?.slice(0, 4_000) || '',
          request.body.userNote?.slice(0, 4_000) || '',
          category, title, JSON.stringify(tags), JSON.stringify(metadata)
        );
      if (kind === 'reference') {
        database.connection.prepare(`INSERT INTO character_visual_references
          (id,character_id,asset_id,purposes_json,enabled,crop_json,created_at,updated_at)
          VALUES (?,?,?,?,1,NULL,?,?)`).run(randomUUID(), request.params.id, id, JSON.stringify(purposes), now, now);
      }
    } catch (error) { throw error; }
    const setAsActive = request.body.setAsActive !== false;
    if (setAsActive) {
      if (kind === 'avatar' || category === 'avatar') {
        database.connection.prepare('UPDATE character_profiles SET avatar_asset_id=?,updated_at=? WHERE id=?').run(id, now, request.params.id);
      } else if (kind === 'portrait' || category === 'portrait') {
        database.connection.prepare('UPDATE character_profiles SET portrait_asset_id=?,updated_at=? WHERE id=?').run(id, now, request.params.id);
      }
    }
    const reference = kind === 'reference' ? visualReferenceRows(database, request.params.id).find((item) => item.assetId === id) : null;
    syncCharacterSnapshotAfterChange(database, request.params.id, { incrementRevision: true });
    return reply.code(201).send({ id, url: `/api/admin/characters/assets/${id}`, category, title, tags, metadata, ...(reference ? { reference } : {}) });
  });

  // 获取角色的资产列表（含当前生效的头像和立绘）
  app.get<{ Params: { id: string } }>('/api/v1/admin/characters/:id/assets', async (request, reply) => {
    const profile = database.connection.prepare('SELECT id, avatar_asset_id, portrait_asset_id FROM character_profiles WHERE id=?').get(request.params.id) as { id: string; avatar_asset_id: string | null; portrait_asset_id: string | null } | undefined;
    if (!profile) return reply.code(404).send({ error: 'not_found' });
    const rows = database.connection.prepare(`SELECT a.id, a.character_id, a.kind, a.created_at, a.artifact_id,
        a.source_url, a.source_page, a.author_note, a.user_note, a.category, a.title, a.tags_json, a.metadata_json
      FROM character_assets a LEFT JOIN artifacts art ON art.id=a.artifact_id
      WHERE a.character_id=? AND (a.artifact_id IS NULL OR (art.file_status='ready' AND art.local_path IS NOT NULL))
      ORDER BY a.created_at DESC`).all(request.params.id) as Record<string, unknown>[];
    return {
      characterId: profile.id,
      avatarAssetId: profile.avatar_asset_id ? String(profile.avatar_asset_id) : null,
      portraitAssetId: profile.portrait_asset_id ? String(profile.portrait_asset_id) : null,
      items: rows.map((r) => {
        let tags: string[] = [];
        try { tags = JSON.parse(String(r.tags_json || '[]')); } catch {}
        let metadata: Record<string, unknown> = {};
        try { metadata = JSON.parse(String(r.metadata_json || '{}')); } catch {}
        return {
          id: String(r.id),
          characterId: String(r.character_id),
          kind: String(r.kind) as 'avatar' | 'portrait' | 'reference',
          category: (r.category ? String(r.category) : (r.kind === 'avatar' ? 'avatar' : r.kind === 'portrait' ? 'portrait' : 'other')) as any,
          title: String(r.title || ''),
          url: r.artifact_id ? `/api/admin/characters/assets/${r.id}` : null,
          artifactId: r.artifact_id ? String(r.artifact_id) : null,
          tags,
          metadata,
          createdAt: String(r.created_at),
          sourceUrl: r.source_url ? String(r.source_url) : null,
          sourcePage: r.source_page ? String(r.source_page) : null,
          authorNote: r.author_note ? String(r.author_note) : undefined,
          userNote: r.user_note ? String(r.user_note) : undefined,
        };
      }),
    };
  });

  // 更新角色单项资产
  app.patch<{ Params: { id: string; assetId: string }; Body: { title?: string; category?: string; tags?: string[]; metadata?: Record<string, unknown>; userNote?: string; authorNote?: string; setAsActive?: 'avatar' | 'portrait' | 'none' } }>('/api/v1/admin/characters/:id/assets/:assetId', async (request, reply) => {
    const existing = database.connection.prepare('SELECT id, kind, category,artifact_id FROM character_assets WHERE id=? AND character_id=?').get(request.params.assetId, request.params.id) as { id: string; kind: string; category: string; artifact_id: string | null } | undefined;
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if ((request.body?.setAsActive === 'avatar' || request.body?.setAsActive === 'portrait') && !existing.artifact_id) return reply.code(400).send({ error: 'asset_image_required' });
    const now = nowIso();
    const updates: string[] = [];
    const values: any[] = [];
    if (request.body?.title !== undefined) {
      updates.push('title=?');
      values.push(request.body.title.slice(0, 200));
    }
    if (request.body?.category !== undefined) {
      updates.push('category=?');
      values.push(request.body.category);
    }
    if (request.body?.tags !== undefined && Array.isArray(request.body.tags)) {
      updates.push('tags_json=?');
      values.push(JSON.stringify(request.body.tags.filter(t => typeof t === 'string').map(t => t.trim()).filter(Boolean)));
    }
    if (request.body?.metadata !== undefined && typeof request.body.metadata === 'object') {
      updates.push('metadata_json=?');
      values.push(JSON.stringify(request.body.metadata));
    }
    if (request.body?.userNote !== undefined) {
      updates.push('user_note=?');
      values.push(request.body.userNote.slice(0, 4_000));
    }
    if (request.body?.authorNote !== undefined) {
      updates.push('author_note=?');
      values.push(request.body.authorNote.slice(0, 4_000));
    }
    if (updates.length > 0) {
      values.push(existing.id);
      database.connection.prepare(`UPDATE character_assets SET ${updates.join(', ')} WHERE id=?`).run(...values);
    }
    if (request.body?.setAsActive === 'avatar') {
      database.connection.prepare('UPDATE character_profiles SET avatar_asset_id=?, updated_at=? WHERE id=?').run(existing.id, now, request.params.id);
    } else if (request.body?.setAsActive === 'portrait') {
      database.connection.prepare('UPDATE character_profiles SET portrait_asset_id=?, updated_at=? WHERE id=?').run(existing.id, now, request.params.id);
    }
    if (updates.length > 0 || request.body?.setAsActive) syncCharacterSnapshotAfterChange(database, request.params.id, { incrementRevision: true });
    return { ok: true, id: existing.id };
  });

  // 删除角色单项资产
  app.delete<{ Params: { id: string; assetId: string } }>('/api/v1/admin/characters/:id/assets/:assetId', async (request, reply) => {
    const existing = database.connection.prepare('SELECT id, artifact_id FROM character_assets WHERE id=? AND character_id=?').get(request.params.assetId, request.params.id) as { id: string; artifact_id: string | null } | undefined;
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const now = nowIso();
    database.transaction(() => {
      database.connection.prepare('UPDATE character_profiles SET avatar_asset_id=NULL, updated_at=? WHERE id=? AND avatar_asset_id=?').run(now, request.params.id, existing.id);
      database.connection.prepare('UPDATE character_profiles SET portrait_asset_id=NULL, updated_at=? WHERE id=? AND portrait_asset_id=?').run(now, request.params.id, existing.id);
      database.connection.prepare('DELETE FROM character_visual_references WHERE asset_id=?').run(existing.id);
      database.connection.prepare('DELETE FROM character_assets WHERE id=?').run(existing.id);
      const profile = database.connection.prepare('SELECT variants_json FROM character_profiles WHERE id=?').get(request.params.id) as { variants_json: string };
      const variants = (JSON.parse(profile.variants_json || '[]') as CharacterVariant[]).map(variant => ({ ...variant,
        ...(variant.avatarAssetId === existing.id ? { avatarAssetId: null, avatarUrl: null } : {}),
        ...(variant.portraitAssetId === existing.id ? { portraitAssetId: null, portraitUrl: null } : {}),
      }));
      database.connection.prepare('UPDATE character_profiles SET variants_json=? WHERE id=?').run(JSON.stringify(variants), request.params.id);
      if (existing.artifact_id) {
        removeArtifactReference(database, { artifactId: existing.artifact_id, appId: 'characters', refId: existing.id });
      }
      syncCharacterSnapshotAfterChange(database, request.params.id, { incrementRevision: true });
    });
    return { ok: true, id: existing.id };
  });

  // 外部图片反向代理（解决海外 Wiki / 外部 CDN 防盗链或网络问题）
  app.get<{ Querystring: { url?: string } }>('/api/v1/admin/proxy-image', async (request, reply) => {
    const targetUrl = request.query.url;
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
      return reply.code(400).send({ error: 'invalid_url' });
    }
    try {
      const res = await fetcher(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        return reply.code(res.status).send({ error: 'fetch_failed' });
      }
      const contentType = res.headers.get('content-type') || 'image/png';
      reply.header('Content-Type', contentType);
      reply.header('Cache-Control', 'public, max-age=86400');
      const arrayBuf = await res.arrayBuffer();
      return reply.send(Buffer.from(arrayBuf));
    } catch (err: any) {
      return reply.code(502).send({ error: 'proxy_failed', message: err?.message });
    }
  });

  // 预览多源官方头像与立绘
  app.post<{ Params: { id: string } }>('/api/v1/admin/characters/:id/preview-official-assets', async (request, reply) => {
    const profile = database.connection.prepare('SELECT id, display_name, draft_json FROM character_profiles WHERE id=?').get(request.params.id) as { id: string; display_name: string; draft_json: string } | undefined;
    if (!profile) return reply.code(404).send({ error: 'not_found' });
    const draft = normalizeCharacterDraft(JSON.parse(profile.draft_json));
    const items = await previewCharacterMultiSourceAssets(
      profile.display_name,
      (draft as Record<string, unknown>).englishName as string | undefined,
      (draft as Record<string, unknown>).work as string | undefined,
    );
    return {
      characterId: profile.id,
      displayName: profile.display_name,
      items,
    };
  });

  // 导入选中的多源资产
  app.post<{
    Params: { id: string };
    Body: {
      items?: Array<{
        kind: 'avatar' | 'portrait' | 'reference';
        category?: CharacterAssetCategory;
        url: string;
        source?: string;
        title?: string;
        setAsActive?: boolean;
        registerReference?: boolean;
        skinName?: string;
        outfitDescription?: string;
        loreStory?: string;
        tags?: string[];
      }>;
      assets?: Array<{
        kind: 'avatar' | 'portrait' | 'reference';
        category?: CharacterAssetCategory;
        url: string;
        source?: string;
        title?: string;
        setAsActive?: boolean;
        registerReference?: boolean;
        skinName?: string;
        outfitDescription?: string;
        loreStory?: string;
        tags?: string[];
      }>;
    };
  }>('/api/v1/admin/characters/:id/import-assets', async (request, reply) => {
    const profile = database.connection.prepare('SELECT id, avatar_asset_id, portrait_asset_id FROM character_profiles WHERE id=?').get(request.params.id) as { id: string; avatar_asset_id: string | null; portrait_asset_id: string | null } | undefined;
    if (!profile) return reply.code(404).send({ error: 'not_found' });
    const assetsToImport = Array.isArray(request.body?.items) ? request.body.items : Array.isArray(request.body?.assets) ? request.body.assets : [];
    if (assetsToImport.length === 0) return reply.code(400).send({ error: 'no_assets_provided' });

    let activeAvatarAssetId = profile.avatar_asset_id;
    let activePortraitAssetId = profile.portrait_asset_id;
    const warnings: string[] = [];
    const imported: Array<{ id: string; kind: 'avatar' | 'portrait' | 'reference'; url: string }> = [];

    for (const item of assetsToImport) {
      if (!item.url || !['avatar', 'portrait', 'reference'].includes(item.kind)) continue;
      const saved = await downloadAndSaveCharacterAsset(config, database, fetcher, request.params.id, item);
      if (!saved) { warnings.push(`资产下载失败：${item.title || item.url}`); continue; }
      if (saved.setAvatar) activeAvatarAssetId = saved.id;
      if (saved.setPortrait) activePortraitAssetId = saved.id;
      imported.push({ id: saved.id, kind: saved.kind, url: saved.url });
    }

    return {
      imported,
      activeAvatarAssetId,
      activePortraitAssetId,
      warnings,
    };
  });

  // 设定主头像 / 主立绘
  app.put<{
    Params: { id: string };
    Body: { assetId?: string; kind?: 'avatar' | 'portrait' };
  }>('/api/v1/admin/characters/:id/set-active-asset', async (request, reply) => {
    const assetId = text(request.body?.assetId, 200);
    const kind = request.body?.kind;
    if (!assetId || !kind || !['avatar', 'portrait'].includes(kind)) {
      return reply.code(400).send({ error: 'invalid_params' });
    }
    const asset = database.connection.prepare('SELECT id, character_id FROM character_assets WHERE id=? AND character_id=?').get(assetId, request.params.id);
    if (!asset) return reply.code(404).send({ error: 'asset_not_found' });
    const media = database.connection.prepare('SELECT artifact_id FROM character_assets WHERE id=?').get(assetId) as { artifact_id: string | null };
    if (!media.artifact_id) return reply.code(400).send({ error: 'asset_image_required', message: '这条服饰记录只有文字，请先添加图片。' });

    const now = nowIso();
    if (kind === 'avatar') {
      database.connection.prepare('UPDATE character_profiles SET avatar_asset_id=?,updated_at=? WHERE id=?').run(assetId, now, request.params.id);
    } else {
      database.connection.prepare('UPDATE character_profiles SET portrait_asset_id=?,updated_at=? WHERE id=?').run(assetId, now, request.params.id);
    }
    syncCharacterSnapshotAfterChange(database, request.params.id, { incrementRevision: true });

    const row = database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(request.params.id) as Record<string, unknown>;
    return mapProfile(database, row);
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/characters/assets/:id', async (request, reply) => sendCharacterAsset(database, request.params.id, reply, config));
  app.get<{ Params: { id: string; version: string; assetId: string } }>('/api/v1/admin/characters/:id/versions/:version/assets/:assetId', async (request, reply) =>
    sendFrozenCharacterAsset(database, request.params.id, Number(request.params.version), request.params.assetId, reply));

  app.get<{ Params: { id: string } }>('/api/v1/admin/characters/:id/visual-references', async (request, reply) => {
    if (!database.connection.prepare('SELECT 1 FROM character_profiles WHERE id=?').get(request.params.id)) return reply.code(404).send({ error: 'not_found' });
    return { items: visualReferenceRows(database, request.params.id) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/characters/:id/model-assignments', async (request, reply) => {
    if (!database.connection.prepare('SELECT 1 FROM character_profiles WHERE id=?').get(request.params.id)) return reply.code(404).send({ error: 'not_found' });
    return { items: listCharacterLlmAssignments(database, request.params.id) };
  });

  app.put<{ Params: { id: string }; Body: { textProfileId?: string | null; multimodalProfileId?: string | null } }>('/api/v1/admin/characters/:id/model-assignments', async (request, reply) => {
    if (!database.connection.prepare('SELECT 1 FROM character_profiles WHERE id=?').get(request.params.id)) return reply.code(404).send({ error: 'not_found' });
    try {
      if (request.body?.textProfileId !== undefined) setCharacterLlmAssignment(database, request.params.id, 'text', request.body.textProfileId ?? null);
      if (request.body?.multimodalProfileId !== undefined) setCharacterLlmAssignment(database, request.params.id, 'multimodal', request.body.multimodalProfileId ?? null);
      return { items: listCharacterLlmAssignments(database, request.params.id) };
    } catch (error) { return characterImportError(reply, error); }
  });

  app.post<{ Params: { id: string }; Body: { referenceId?: string; expectedDraftRevision?: number } }>('/api/v1/admin/characters/:id/appearance-extractions', async (request, reply) => {
    const profile = database.connection.prepare('SELECT draft_json,draft_revision FROM character_profiles WHERE id=?').get(request.params.id) as { draft_json: string; draft_revision: number } | undefined;
    if (!profile) return reply.code(404).send({ error: 'not_found' });
    const referenceId = text(request.body?.referenceId, 200);
    if (!referenceId) return reply.code(400).send({ error: 'reference_id_required' });
    const reference = database.connection.prepare(`SELECT r.id,r.asset_id,r.enabled,a.local_path,a.content_type,a.artifact_id
      FROM character_visual_references r JOIN character_assets a ON a.id=r.asset_id
      WHERE r.id=? AND r.character_id=? AND r.enabled=1`).get(referenceId, request.params.id) as Record<string, unknown> | undefined;
    if (!reference) return reply.code(404).send({ error: 'reference_not_found' });
    if (request.body?.expectedDraftRevision != null && Number(request.body.expectedDraftRevision) !== Number(profile.draft_revision ?? 1)) return reply.code(409).send({ error: 'draft_revision_conflict', draftRevision: Number(profile.draft_revision ?? 1) });
    try {
      const model = await resolveCharacterLlmProfile(database, secrets, request.params.id, 'multimodal');
      if (!model?.model) {
        const status = await resolveCharacterLlmBindingStatus(database, secrets, request.params.id, 'multimodal');
        throw llmNotReadyError(status);
      }
      const media = await referenceBytes(database, reference);
      const prompt = `请观察这张角色参考图，只输出 JSON，不要 Markdown。不要从画面推断未观察到的身份、作品或性格；不确定项放入 unknowns，视觉与已有人设冲突放入 conflicts。严格使用此格式：
{"description":"观察到的整体外观","hair":"发型发色","eyes":"眼睛","build":"体态","accessories":[],"observedOutfit":"本图服装","unknowns":[],"conflicts":[],"evidence":["可见证据"]}
已有角色名：${JSON.parse(profile.draft_json).displayName || '未命名'}。`;
      const requestBody = { ...model.extraBody, model: model.model, temperature: 0.1, messages: [{ role: 'system', content: '你是谨慎的视觉资料提取器，只输出有效 JSON。' }, { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${media.contentType};base64,${bytesBase64(media.bytes)}` } }] }] };
      const audited = await fetchAuditedAiResponse(database, { applicationId: 'characters', feature: 'characters', businessEvent: 'character.appearance.extract', objectType: 'character', objectId: request.params.id, callType: 'multimodal', provider: model.name, models: [model.model], parameters: { temperature: 0.1, referenceId, imageSha256: hash(media.bytes) }, positivePrompt: prompt, redactionSecrets: collectAiCallRedactionSecrets({ secret: model.secret, headers: model.headers, extraBody: model.extraBody }) }, fetcher, `${model.baseUrl}/chat/completions`, { method: 'POST', headers: { ...model.headers, ...upstreamHeaders(model.secret) }, body: JSON.stringify(requestBody), signal: AbortSignal.timeout(180_000) });
      const response = audited.response;
      const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }>; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
      const extraction = appearanceExtraction(modelJson(payload.choices?.[0]?.message?.content));
      updateAiCallRecord(database, audited.callId, { responseText: JSON.stringify(extraction), event: 'candidate_built', redactionSecrets: audited.redactionSecrets });
      const candidateId = randomUUID();
      database.connection.prepare(`INSERT INTO character_ai_candidates
        (id,character_id,import_session_id,reference_id,input_hash,output_json,model_profile_id,prompt_snapshot_json,status,created_at)
        VALUES (?,?,NULL,?,?,?,?,?,'ready',?)`).run(candidateId, request.params.id, referenceId, hash({ characterId: request.params.id, referenceId, imageHash: hash(media.bytes), prompt, model: model.model }), JSON.stringify(extraction), model.id, JSON.stringify({ prompt, draftRevision: profile.draft_revision, imageHash: hash(media.bytes), referenceId, model: model.model }), nowIso());
      return { id: candidateId, referenceId, extraction, draftRevision: Number(profile.draft_revision ?? 1), profileId: model.id };
    } catch (error) { return characterImportError(reply, error); }
  });

  app.post<{ Params: { id: string; taskId: string }; Body: { expectedDraftRevision?: number; fieldPaths?: string[] } }>('/api/v1/admin/characters/:id/appearance-extractions/:taskId/apply', async (request, reply) => {
    const profile = database.connection.prepare('SELECT draft_json,draft_revision FROM character_profiles WHERE id=?').get(request.params.id) as { draft_json: string; draft_revision: number } | undefined;
    const candidate = database.connection.prepare('SELECT * FROM character_ai_candidates WHERE id=? AND character_id=? AND status=?').get(request.params.taskId, request.params.id, 'ready') as Record<string, unknown> | undefined;
    if (!profile || !candidate) return reply.code(404).send({ error: 'not_found' });
    if (!Number.isSafeInteger(request.body?.expectedDraftRevision) || Number(request.body.expectedDraftRevision) !== Number(profile.draft_revision ?? 1)) return reply.code(409).send({ error: 'draft_revision_conflict', draftRevision: Number(profile.draft_revision ?? 1) });
    const extraction = appearanceExtraction(JSON.parse(String(candidate.output_json)) as Record<string, unknown>);
    const selected = new Set(Array.isArray(request.body?.fieldPaths) ? request.body.fieldPaths : ['/appearance/description', '/appearance/hair', '/appearance/eyes', '/appearance/build', '/appearance/accessories']);
    const draft = normalizeCharacterDraft(JSON.parse(profile.draft_json));
    const authority = toAuthorityDraft(draft);
    const previous = toCharacterRuntime(authority);
    // 识图候选仍是细项（发色/瞳色/体态/配饰/本图服装）；采用时按细项重建基础外貌与默认穿着，
    // 只覆盖用户勾选的项，未勾选的原正文保留。这里与前端差异预览共用同一个纯函数，
    // 避免「预览看到的」和「实际写入的」两套逻辑各自漂移。
    const preview = previewAppearanceCandidateApplication(
      { baseText: previous.appearance.baseText, defaultOutfitText: previous.appearance.defaultOutfitText },
      extraction,
      [...selected],
    );
    const nextDraft: CharacterDraftV2 = {
      ...authority,
      appearance: {
        baseText: preview.baseText,
        defaultOutfitText: preview.defaultOutfitText,
      },
    };
    const nextRevision = Number(profile.draft_revision ?? 1) + 1; const now = nowIso();
    database.transaction(() => {
      const update = database.connection.prepare('UPDATE character_profiles SET draft_json=?,draft_revision=?,updated_at=? WHERE id=? AND draft_revision=?').run(JSON.stringify(nextDraft), nextRevision, now, request.params.id, profile.draft_revision ?? 1);
      if (Number(update.changes) !== 1) throw new Error('draft_revision_conflict');
      upsertCharacterBirthday(database, request.params.id, nextDraft);
      for (const fieldPath of selected) {
        if (!['/appearance/description', '/appearance/hair', '/appearance/eyes', '/appearance/build', '/appearance/accessories', '/appearance/outfits'].includes(fieldPath)) continue;
        const value = fieldPath === '/appearance/description' ? extraction.description
          : fieldPath === '/appearance/hair' ? extraction.hair
          : fieldPath === '/appearance/eyes' ? extraction.eyes
          : fieldPath === '/appearance/build' ? extraction.build
          : fieldPath === '/appearance/accessories' ? extraction.accessories
          : extraction.observedOutfit;
        if (!value || (Array.isArray(value) && value.length === 0)) continue;
        database.connection.prepare(`INSERT INTO character_field_provenance
          (id,character_id,version,field_path,value_hash,source_kind,source_snapshot_id,source_pointer,evidence_json,derived_from_json,confirmed,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), request.params.id, null, fieldPath, hash(value), 'image_observed', null, `/character-ai-candidates/${request.params.taskId}`, JSON.stringify({ evidence: extraction.evidence, conflicts: extraction.conflicts }), '[]', 1, now);
      }
      database.connection.prepare("UPDATE character_ai_candidates SET status='applied' WHERE id=?").run(request.params.taskId);
      syncCharacterSnapshotAfterChange(database, request.params.id);
    });
    return { draft: nextDraft, draftRevision: nextRevision, candidateId: request.params.taskId };
  });

  app.post<{ Params: { id: string }; Body: { scenario?: string; feedback?: string; draftRevision?: number } }>('/api/v1/admin/characters/:id/auditions', async (request, reply) => {
    const profile = database.connection.prepare('SELECT draft_json,draft_revision FROM character_profiles WHERE id=?').get(request.params.id) as { draft_json: string; draft_revision: number } | undefined;
    if (!profile) return reply.code(404).send({ error: 'not_found' });
    if (request.body?.draftRevision != null && Number(request.body.draftRevision) !== Number(profile.draft_revision ?? 1)) return reply.code(409).send({ error: 'draft_revision_conflict', draftRevision: Number(profile.draft_revision ?? 1) });
    const scenario = text(request.body?.scenario, 8_000); if (!scenario) return reply.code(400).send({ error: 'scenario_required' });
    try {
      const model = await resolveCharacterLlmProfile(database, secrets, request.params.id, 'text');
      if (!model?.model) {
        const status = await resolveCharacterLlmBindingStatus(database, secrets, request.params.id, 'text');
        throw llmNotReadyError(status);
      }
      const draft = normalizeCharacterDraft(JSON.parse(profile.draft_json));
      const prompt = buildAuditionPrompt(draft, scenario, text(request.body?.feedback, 4_000));
      const requestBody = { ...model.extraBody, model: model.model, temperature: 0.7, messages: [{ role: 'system', content: '你是严格遵循已保存角色资料的试演助手，只输出有效 JSON。' }, { role: 'user', content: prompt }] };
      const audited = await fetchAuditedAiResponse(database, { applicationId: 'characters', feature: 'characters', businessEvent: 'character.audition.generate', objectType: 'character', objectId: request.params.id, callType: 'llm', provider: model.name, models: [model.model], parameters: { temperature: 0.7 }, positivePrompt: prompt, redactionSecrets: collectAiCallRedactionSecrets({ secret: model.secret, headers: model.headers, extraBody: model.extraBody }) }, fetcher, `${model.baseUrl}/chat/completions`, { method: 'POST', headers: { ...model.headers, ...upstreamHeaders(model.secret) }, body: JSON.stringify(requestBody), signal: AbortSignal.timeout(180_000) });
      const response = audited.response;
      const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }>; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
      const value = modelJson(payload.choices?.[0]?.message?.content);
      const suggestions = Array.isArray(value.suggestions) ? value.suggestions.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const itemRecord = item as Record<string, unknown>;
        return [{ fieldPath: text(itemRecord.fieldPath, 200), before: text(itemRecord.before, 4_000), after: text(itemRecord.after, 4_000), reason: text(itemRecord.reason, 500) }];
      }).slice(0, 20) : [];
      const output = text(value.output, 8_000); if (!output) throw new Error('audition_output_empty');
      updateAiCallRecord(database, audited.callId, { responseText: JSON.stringify(value), event: 'audition_candidate_built', redactionSecrets: audited.redactionSecrets });
      const id = randomUUID();
      database.connection.prepare(`INSERT INTO character_auditions
        (id,character_id,draft_revision,scenario,output,feedback,suggestions_json,compiler_version,model_profile_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, request.params.id, Number(profile.draft_revision ?? 1), scenario, output, text(request.body?.feedback, 4_000) || null, JSON.stringify(suggestions), CHARACTER_PERSONA_COMPILER_VERSION, model.id, nowIso());
      return { id, scenario, output, ...(request.body?.feedback ? { feedback: text(request.body.feedback, 4_000) } : {}), suggestions, draftRevision: Number(profile.draft_revision ?? 1), compilerVersion: CHARACTER_PERSONA_COMPILER_VERSION, profileId: model.id };
    } catch (error) { return characterImportError(reply, error); }
  });

  // 角色实际生效的模型状态：专属绑定优先，失效时如实报错而不是静默回退。
  app.get<{ Params: { id: string } }>('/api/v1/admin/characters/:id/llm-status', async (request, reply) => {
    const profile = database.connection.prepare('SELECT id FROM character_profiles WHERE id=? AND archived=0').get(request.params.id);
    if (!profile) return reply.code(404).send({ error: 'not_found' });
    const [text, multimodal] = await Promise.all([
      resolveCharacterLlmBindingStatus(database, secrets, request.params.id, 'text'),
      resolveCharacterLlmBindingStatus(database, secrets, request.params.id, 'multimodal'),
    ]);
    return { characterId: request.params.id, text, multimodal };
  });

  app.get('/api/v1/characters', async (request, reply) => {
    const identity = requirePersonaApp(database, request, reply); if (!identity) return;
    const rows = database.connection.prepare('SELECT * FROM character_profiles WHERE archived=0 AND latest_version IS NOT NULL ORDER BY display_name').all();
    return { items: rows.map((row) => {
      const profile = mapProfile(database, row as Record<string, unknown>, '/api/v1/characters/assets');
      const latest = database.connection.prepare('SELECT * FROM character_versions WHERE character_id=? AND version=?').get(profile.id, profile.latestVersion!) as Record<string, unknown>;
      const version = mapVersion(latest);
      const frozen = readStoredCharacterSnapshot(latest.data_json);
      const url = (assetId?: string | null) => assetId ? `/api/v1/characters/${profile.id}/versions/${version.version}/assets/${assetId}` : null;
      return { ...profile, draft: version.data, displayName: version.data.displayName, tags: version.tags ?? [], variants: version.variants ?? [],
        familyMembers: (profile.familyMembers ?? []).flatMap(member => {
          const published = database.connection.prepare('SELECT v.data_json,v.version FROM character_profiles p JOIN character_versions v ON v.character_id=p.id AND v.version=p.latest_version WHERE p.id=?').get(member.id) as { data_json: string; version: number } | undefined;
          if (!published) return [];
          const draft = normalizeCharacterDraft(JSON.parse(published.data_json));
          const snapshot = readStoredCharacterSnapshot(published.data_json);
          return [{ ...member, displayName: draft.displayName, work: draft.work, originType: draft.originType,
            avatarUrl: snapshot?.avatarAssetId ? `/api/v1/characters/${member.id}/versions/${published.version}/assets/${snapshot.avatarAssetId}` : null }];
        }),
        draftRevision: version.draftRevision, avatarAssetId: frozen?.avatarAssetId ?? null, portraitAssetId: frozen?.portraitAssetId ?? null,
        avatarUrl: url(frozen?.avatarAssetId), portraitUrl: url(frozen?.portraitAssetId) };
    }) };
  });
  app.get<{ Params: { id: string } }>('/api/v1/characters/assets/:id', async (request, reply) => {
    const identity = requirePersonaApp(database, request, reply); if (!identity) return;
    return sendCharacterAsset(database, request.params.id, reply, config);
  });
  app.get<{ Params: { id: string; version: string; assetId: string } }>('/api/v1/characters/:id/versions/:version/assets/:assetId', async (request, reply) => {
    const identity = requirePersonaApp(database, request, reply); if (!identity) return;
    return sendFrozenCharacterAsset(database, request.params.id, Number(request.params.version), request.params.assetId, reply);
  });
  app.get<{ Params: { id: string }; Querystring: { version?: string } }>('/api/v1/characters/:id', async (request, reply) => {
    const identity = requirePersonaApp(database, request, reply); if (!identity) return;
    const profile = database.connection.prepare('SELECT id,slug,display_name,tags_json,latest_version,avatar_asset_id FROM character_profiles WHERE id=? AND archived=0').get(request.params.id) as Record<string, unknown> | undefined; if (!profile?.latest_version) return reply.code(404).send({ error: 'not_found' });
    const version = Number(request.query.version || profile.latest_version); const row = database.connection.prepare('SELECT * FROM character_versions WHERE character_id=? AND version=?').get(request.params.id, version) as Record<string, unknown> | undefined; if (!row) return reply.code(404).send({ error: 'version_not_found' });
    const snapshot = mapVersion(row);
    const frozen = readStoredCharacterSnapshot(row.data_json);
    const frozenAvatarId = frozen?.avatarAssetId ?? null;
    const frozenPortraitId = frozen?.portraitAssetId ?? null;
    const url = (assetId?: string | null) => assetId ? `/api/v1/characters/${request.params.id}/versions/${version}/assets/${assetId}` : null;
    const publicSnapshot = { ...snapshot,
      assets: snapshot.assets?.map(asset => ({ ...asset, url: asset.artifactId ? url(asset.id) : null })),
      visualReferences: snapshot.visualReferences?.map(reference => ({ ...reference, url: url(reference.assetId)! })),
      variants: snapshot.variants?.map(variant => ({ ...variant, ...(variant.avatarAssetId ? { avatarUrl: url(variant.avatarAssetId) } : {}), ...(variant.portraitAssetId ? { portraitUrl: url(variant.portraitAssetId) } : {}) })),
    };
    return { ...profile, display_name: snapshot.data.displayName, tags_json: JSON.stringify(snapshot.tags ?? []), avatar_asset_id: frozenAvatarId,
      portrait_asset_id: frozenPortraitId, avatar_url: url(frozenAvatarId), portrait_url: url(frozenPortraitId), version: publicSnapshot, relationships: snapshot.relationships };
  });
  app.post<{ Body: { characterId?: string; version?: number; localId?: string } }>('/api/v1/app-characters', async (request, reply) => {
    const identity = requirePersonaApp(database, request, reply); if (!identity) return;
    const characterId = text(request.body?.characterId, 200); if (!characterId) return reply.code(400).send({ error: 'character_id_required' });
    const profile = database.connection.prepare('SELECT latest_version FROM character_profiles WHERE id=?').get(characterId) as { latest_version: number | null } | undefined; if (!profile?.latest_version) return reply.code(404).send({ error: 'not_found' });
    const version = request.body?.version ?? profile.latest_version; const snapshot = database.connection.prepare('SELECT * FROM character_versions WHERE character_id=? AND version=?').get(characterId, version) as Record<string, unknown> | undefined; if (!snapshot) return reply.code(404).send({ error: 'version_not_found' });
    const localId = text(request.body.localId, 200) || randomUUID(); const importedHash = hash(String(snapshot.compiled_linshe_prompt)); const now = nowIso();
    database.connection.prepare(`INSERT INTO app_character_links VALUES (?,?,?,?,?,0,?,?) ON CONFLICT(app_id,local_id) DO UPDATE SET character_id=excluded.character_id,source_version=excluded.source_version,imported_hash=excluded.imported_hash,local_modified=0,updated_at=excluded.updated_at`).run(identity.id, localId, characterId, version, importedHash, now, now);
    return reply.code(201).send({ localId, characterId, sourceVersion: version, importedHash, snapshot: mapVersion(snapshot) });
  });
  app.get('/api/v1/app-characters', async (request, reply) => {
    const identity = requirePersonaApp(database, request, reply); if (!identity) return;
    return { items: database.connection.prepare(`SELECT l.*,p.display_name,p.latest_version FROM app_character_links l JOIN character_profiles p ON p.id=l.character_id WHERE l.app_id=? ORDER BY l.updated_at DESC`).all(identity.id) };
  });
}
