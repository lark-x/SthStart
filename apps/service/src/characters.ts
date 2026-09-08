import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CharacterDraft, CharacterProfile, CharacterRelationship, CharacterSource, CharacterVersion } from '@sthstart/contracts';
import { compileLinshePrompt } from '@sthstart/contracts';
import { authenticateApp, hasCapability } from './access.js';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';
import { resolveAssignedLlmProfile, upstreamHeaders } from './providers.js';
import type { SecretStore } from './security.js';
import { createArtifactReadStream, createArtifactReference, readArtifact, removeArtifactReference, streamUploadArtifact } from './artifacts.js';
import { createGenerationTask, getGenerationTask } from './generation.js';
import { sanitizeErrorMessage } from './generation.js';
import { normalizeCharacterDraft, text, list } from './characters/draft.js';
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

function hash(value: unknown) { return createHash('sha256').update(value instanceof Uint8Array || typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }

function bytesBase64(value: Uint8Array) {
  return (value as unknown as { toString: (encoding: string) => string }).toString('base64');
}

function avatarUrl(database: ServiceDatabase, assetId: unknown, assetPath: string) {
  return assetId && database.connection.prepare('SELECT 1 FROM character_assets WHERE id=?').get(String(assetId)) ? `${assetPath}/${assetId}` : null;
}

function mapProfile(database: ServiceDatabase, row: Record<string, unknown>, assetPath = '/api/admin/characters/assets'): CharacterProfile {
  return {
    id: String(row.id), slug: String(row.slug), displayName: String(row.display_name),
    draft: normalizeCharacterDraft(JSON.parse(String(row.draft_json))), tags: JSON.parse(String(row.tags_json)) as string[],
    avatarUrl: avatarUrl(database, row.avatar_asset_id, assetPath), latestVersion: row.latest_version == null ? null : Number(row.latest_version),
    archived: Boolean(row.archived), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    ...(row.draft_revision != null ? { draftRevision: Number(row.draft_revision) } : {}),
    ...(row.default_outfit_id != null ? { defaultOutfitId: String(row.default_outfit_id) } : {}),
  };
}

function mapVersion(row: Record<string, unknown>): CharacterVersion {
  const appearanceSnapshot = row.appearance_snapshot_json ? normalizeCharacterAppearance(JSON.parse(String(row.appearance_snapshot_json))) : undefined;
  const rawProvenance = row.provenance_json ? JSON.parse(String(row.provenance_json)) : undefined;
  const provenance = Array.isArray(rawProvenance) ? { fields: rawProvenance } : rawProvenance;
  return {
    characterId: String(row.character_id), version: Number(row.version), data: normalizeCharacterDraft(JSON.parse(String(row.data_json))),
    compiledLinshePrompt: String(row.compiled_linshe_prompt), relationships: JSON.parse(String(row.relationships_json ?? '[]')) as CharacterRelationship[], createdAt: String(row.created_at),
    ...(row.draft_revision != null ? { draftRevision: Number(row.draft_revision) } : {}),
    ...(appearanceSnapshot ? { appearanceSnapshot } : {}), ...(provenance ? { provenance } : {}),
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
        (id,slug,display_name,draft_json,tags_json,avatar_asset_id,latest_version,archived,created_at,updated_at,draft_revision,default_outfit_id)
        VALUES (?,?,?,?,?,?,?,0,?,?,?,NULL)`).run(personaId, uniqueSlug(database, personaId), String(persona.display_name), JSON.stringify(draft), String(persona.tags_json), avatarAssetId, versions.length ? Number(persona.latest_version) : null, String(persona.created_at), String(persona.updated_at), 1);
      if (avatarAssetId && legacyAvatar && avatarArtifactId) {
        database.connection.prepare(`INSERT INTO character_assets
          (id,character_id,kind,local_path,content_type,byte_size,original_name,created_at,artifact_id,sha256,width,height)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          avatarAssetId, personaId, 'avatar', String(legacyAvatar.local_path ?? ''), String(legacyAvatar.content_type ?? 'image/png'), Number(legacyAvatar.byte_size ?? 0), legacyAvatar.original_name ? String(legacyAvatar.original_name) : `legacy-avatar-${personaId}.png`, String(persona.created_at), avatarArtifactId,
          legacyAvatar.sha256 == null ? null : String(legacyAvatar.sha256), legacyAvatar.width == null ? null : Number(legacyAvatar.width), legacyAvatar.height == null ? null : Number(legacyAvatar.height),
        );
      }
      for (const version of versions) database.connection.prepare(`INSERT INTO character_versions
        (character_id,version,data_json,compiled_linshe_prompt,created_at,relationships_json,draft_revision,appearance_snapshot_json,provenance_json)
        VALUES (?,?,?,?,?,'[]',1,?,?)`).run(personaId, Number(version.version), JSON.stringify({ ...draft, displayName: String(version.display_name), appearance: { ...draft.appearance, description: String(version.appearance_prompt ?? '') }, legacyPrompt: String(version.persona_prompt) }), String(version.persona_prompt), String(version.created_at), JSON.stringify({ ...draft.appearance, description: String(version.appearance_prompt ?? '') }), JSON.stringify({ legacy: true }));
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

function sourceSnapshotContentType(format: unknown, rawPayloadJson: unknown) {
  try {
    const payload = rawPayloadJson ? JSON.parse(String(rawPayloadJson)) as { mimeType?: unknown } : null;
    if (typeof payload?.mimeType === 'string' && payload.mimeType.startsWith('image/')) return payload.mimeType;
  } catch { /* fall through to the format mapping */ }
  return format === 'json' ? 'application/json; charset=utf-8' : format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : format === 'gif' ? 'image/gif' : format === 'avif' ? 'image/avif' : 'application/octet-stream';
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
  const profile = await resolveAssignedLlmProfile(database, secrets, 'characters', 'text');
  if (!profile?.model) throw new Error('llm_profile_not_assigned');
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
  const response = await fetcher(`${profile.baseUrl}/chat/completions`, { method: 'POST', headers: { ...profile.headers, ...upstreamHeaders(profile.secret) }, body: JSON.stringify({ ...profile.extraBody, model: profile.model, temperature: .3, messages: [{ role: 'system', content: '你是严谨的角色资料编辑，只输出有效 JSON。' }, { role: 'user', content: prompt }] }), signal: AbortSignal.timeout(180_000) });
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
  const raw = payload.choices?.[0]?.message?.content?.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (!raw) throw new Error('empty_generation');
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

function characterAvatarPrompt(draft: CharacterDraft) {
  return [
    `角色：${draft.displayName || '未命名角色'}`,
    draft.identity,
    draft.summary,
    draft.appearance.description,
    draft.appearance.hair && `发型与发色：${draft.appearance.hair}`,
    draft.appearance.eyes && `眼睛：${draft.appearance.eyes}`,
    draft.appearance.build && `体态：${draft.appearance.build}`,
    draft.appearance.outfits.length && `服装：${draft.appearance.outfits.join('；')}`,
    draft.appearance.accessories.length && `饰品：${draft.appearance.accessories.join('；')}`,
    '角色头像，半身肖像，清晰面部，正面或略微侧身，干净背景。',
  ].filter(Boolean).join('\n').slice(0, 4_000);
}

async function sendCharacterAsset(database: ServiceDatabase, assetId: string, reply: FastifyReply) {
  const asset = database.connection.prepare('SELECT local_path,content_type,artifact_id FROM character_assets WHERE id=?').get(assetId) as { local_path: string; content_type: string; artifact_id: string | null } | undefined;
  if (!asset) return reply.code(404).send({ error: 'not_found' });
  if (asset.artifact_id) {
    const artifact = await readArtifact(database, asset.artifact_id);
    if (!artifact || artifact.fileStatus !== 'ready' || !artifact.localPath || !existsSync(artifact.localPath)) return reply.code(404).send({ error: 'file_not_found' });
    reply.type(artifact.contentType || asset.content_type).header('content-length', String(artifact.byteSize));
    return reply.send(createArtifactReadStream(artifact.localPath));
  }
  try { return reply.type(asset.content_type).send(await readFile(asset.local_path)); } catch { return reply.code(404).send({ error: 'file_not_found' }); }
}

function visualReferenceRows(database: ServiceDatabase, characterId: string) {
  return (database.connection.prepare(`SELECT r.*,a.content_type,a.local_path,a.byte_size,a.width AS asset_width,a.height AS asset_height
    FROM character_visual_references r JOIN character_assets a ON a.id=r.asset_id
    WHERE r.character_id=? ORDER BY r.created_at DESC`).all(characterId) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id), characterId: String(row.character_id), assetId: String(row.asset_id), artifactId: row.artifact_id ? String(row.artifact_id) : null,
    sha256: String(row.sha256), width: row.asset_width == null ? null : Number(row.asset_width), height: row.asset_height == null ? null : Number(row.asset_height),
    purposes: JSON.parse(String(row.purposes_json ?? '[]')) as string[], outfitId: row.outfit_id ? String(row.outfit_id) : null,
    sourcePage: row.source_page ? String(row.source_page) : null, originalUrl: row.original_url ? String(row.original_url) : null,
    authorNote: String(row.author_note ?? ''), userNote: String(row.user_note ?? ''), enabled: Boolean(row.enabled), crop: row.crop_json ? JSON.parse(String(row.crop_json)) as Record<string, unknown> : null,
    url: `/api/admin/characters/assets/${row.asset_id}`, createdAt: String(row.created_at),
  }));
}

async function referenceBytes(database: ServiceDatabase, row: Record<string, unknown>) {
  if (row.artifact_id) {
    const artifact = await readArtifact(database, String(row.artifact_id));
    if (artifact?.localPath && existsSync(artifact.localPath)) return { bytes: await readFile(artifact.localPath), contentType: artifact.contentType || String(row.content_type || 'image/png') };
  }
  const path = row.local_path ? String(row.local_path) : '';
  if (!path || !existsSync(path)) throw new Error('reference_file_not_found');
  return { bytes: await readFile(path), contentType: String(row.content_type || 'image/png') };
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
  const code = error instanceof Error ? error.message : String(error);
  const status = code.includes('conflict') || code === 'base_draft_revision_required' || code.startsWith('import_session_') ? 409 : code === 'not_found' || code.endsWith('_not_found') ? 404 : 400;
  return reply.code(status).send({ error: code });
}

export function registerCharacterRoutes(app: FastifyInstance, config: ServiceConfig, database: ServiceDatabase, secrets: SecretStore, fetcher: typeof fetch = fetch) {
  migrateLegacyPersonas(database);
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

  app.get<{ Querystring: { q?: string; archived?: string } }>('/api/v1/admin/characters', async (request) => {
    const archived = request.query.archived === 'true' ? 1 : 0; const query = request.query.q?.trim();
    const rows = database.connection.prepare(`SELECT * FROM character_profiles WHERE archived=? ${query ? 'AND (display_name LIKE ? OR slug LIKE ? OR tags_json LIKE ? OR draft_json LIKE ?)' : ''} ORDER BY updated_at DESC LIMIT 500`).all(...(query ? [archived, ...Array(4).fill(`%${query}%`)] : [archived])) as Record<string, unknown>[];
    return { items: rows.map((row) => mapProfile(database, row)) };
  });

  app.post<{ Body: { slug?: string; displayName?: string; draft?: unknown; tags?: string[] } }>('/api/v1/admin/characters', async (request, reply) => {
    const draft = normalizeCharacterDraft({ ...(request.body?.draft as object ?? {}), displayName: request.body?.displayName ?? (request.body?.draft as CharacterDraft | undefined)?.displayName });
    if (!draft.displayName) return reply.code(400).send({ error: 'display_name_required' });
    const id = randomUUID(); const now = nowIso(); const slug = uniqueSlug(database, request.body?.slug || draft.englishName || draft.displayName);
    database.connection.prepare(`INSERT INTO character_profiles
      (id,slug,display_name,draft_json,tags_json,avatar_asset_id,latest_version,archived,created_at,updated_at,draft_revision,default_outfit_id)
      VALUES (?,?,?,?,?,NULL,NULL,0,?,?,1,NULL)`).run(id, slug, draft.displayName, JSON.stringify(draft), JSON.stringify(list(request.body?.tags, 50)), now, now);
    return reply.code(201).send(mapProfile(database, database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(id) as Record<string, unknown>));
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
    if (!snapshot.raw_file_path || !existsSync(snapshot.raw_file_path)) return reply.code(404).send({ error: 'source_snapshot_file_not_found' });
    try {
      const bytes = await readFile(snapshot.raw_file_path);
      return reply.type(sourceSnapshotContentType(snapshot.format, snapshot.raw_payload_json)).send(bytes);
    } catch { return reply.code(404).send({ error: 'source_snapshot_file_not_found' }); }
  });

  app.put<{ Params: { id: string }; Body: { slug?: string; draft?: unknown; tags?: string[]; avatarAssetId?: string | null; expectedDraftRevision?: number } }>('/api/v1/admin/characters/:id', async (request, reply) => {
    const current = database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!current) return reply.code(404).send({ error: 'not_found' });
    const currentRevision = Number(current.draft_revision ?? 1);
    if (request.body?.expectedDraftRevision != null && Number(request.body.expectedDraftRevision) !== currentRevision) return reply.code(409).send({ error: 'draft_revision_conflict', draftRevision: currentRevision });
    const draft = normalizeCharacterDraft(request.body?.draft ?? JSON.parse(String(current.draft_json)));
    if (!draft.displayName) return reply.code(400).send({ error: 'display_name_required' });
    const slug = request.body?.slug ? uniqueSlug(database, request.body.slug, request.params.id) : String(current.slug);
    const tags = request.body?.tags ? list(request.body.tags, 50) : JSON.parse(String(current.tags_json));
    const rawAvatar = request.body?.avatarAssetId === undefined ? current.avatar_asset_id : request.body.avatarAssetId;
    const avatar = rawAvatar ? String(rawAvatar) : null;
    if (avatar && !database.connection.prepare('SELECT 1 FROM character_assets WHERE id=? AND character_id=?').get(avatar, request.params.id)) return reply.code(400).send({ error: 'invalid_avatar' });
    const nextRevision = currentRevision + 1;
    const statement = database.connection.prepare(`UPDATE character_profiles SET slug=?,display_name=?,draft_json=?,tags_json=?,avatar_asset_id=?,draft_revision=?,updated_at=? WHERE id=?${request.body?.expectedDraftRevision != null ? ' AND draft_revision=?' : ''}`);
    const result = request.body?.expectedDraftRevision != null
      ? statement.run(slug, draft.displayName, JSON.stringify(draft), JSON.stringify(tags), avatar, nextRevision, nowIso(), request.params.id, currentRevision)
      : statement.run(slug, draft.displayName, JSON.stringify(draft), JSON.stringify(tags), avatar, nextRevision, nowIso(), request.params.id);
    if (Number(result.changes) !== 1) return reply.code(409).send({ error: 'draft_revision_conflict', draftRevision: currentRevision });
    return mapProfile(database, database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(request.params.id) as Record<string, unknown>);
  });

  app.post<{ Params: { id: string }; Body: { expectedDraftRevision?: number } }>('/api/v1/admin/characters/:id/publish', async (request, reply) => {
    const row = database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (request.body?.expectedDraftRevision != null && Number(request.body.expectedDraftRevision) !== Number(row.draft_revision ?? 1)) return reply.code(409).send({ error: 'draft_revision_conflict', draftRevision: Number(row.draft_revision ?? 1) });
    const draft = normalizeCharacterDraft(JSON.parse(String(row.draft_json)));
    if (!draft.displayName || (!draft.identity && !draft.summary && !draft.legacyPrompt)) return reply.code(400).send({ error: 'character_incomplete', message: '发布前至少需要角色名称，以及身份、摘要或兼容提示词。' });
    const version = Number(row.latest_version ?? 0) + 1; const prompt = compileLinshePrompt(draft); const now = nowIso();
    const appearance = normalizeCharacterAppearance(draft.appearance);
    const publishedReferences = database.connection.prepare('SELECT id FROM character_visual_references WHERE character_id=? AND enabled=1 ORDER BY created_at ASC').all(request.params.id) as Array<{ id: string }>;
    appearance.referenceIds = [...new Set([...(appearance.referenceIds ?? []), ...publishedReferences.map((reference) => reference.id)])];
    const appearanceSnapshot = JSON.stringify({ ...appearance, avatarAssetId: row.avatar_asset_id ?? null, references: visualReferenceRows(database, request.params.id).filter((reference) => reference.enabled) });
    const provenance = JSON.stringify(database.connection.prepare('SELECT field_path,value_hash,source_kind,source_snapshot_id,source_pointer,evidence_json,confirmed FROM character_field_provenance WHERE character_id=? ORDER BY created_at DESC').all(request.params.id));
    database.transaction(() => {
      database.connection.prepare(`INSERT INTO character_versions
        (character_id,version,data_json,compiled_linshe_prompt,created_at,relationships_json,draft_revision,appearance_snapshot_json,provenance_json)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(request.params.id, version, JSON.stringify(draft), prompt, now, JSON.stringify(relationshipRows(database, request.params.id)), Number(row.draft_revision ?? 1), appearanceSnapshot, provenance);
      const frozenAssets = database.connection.prepare(`SELECT DISTINCT a.artifact_id FROM character_assets a
        WHERE a.character_id=? AND a.artifact_id IS NOT NULL AND (a.id=? OR a.id IN (SELECT asset_id FROM character_visual_references WHERE character_id=? AND enabled=1))`).all(request.params.id, row.avatar_asset_id ? String(row.avatar_asset_id) : null, request.params.id) as Array<{ artifact_id: string }>;
      for (const asset of frozenAssets) createArtifactReference(database, { artifactId: asset.artifact_id, appId: 'characters', refType: 'character-version', refId: `${request.params.id}:${version}` });
      database.connection.prepare('UPDATE character_profiles SET latest_version=?,updated_at=? WHERE id=?').run(version, now, request.params.id);
      database.connection.prepare(`INSERT INTO personas(id,display_name,tags_json,source,latest_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,tags_json=excluded.tags_json,latest_version=excluded.latest_version,updated_at=excluded.updated_at`).run(request.params.id, draft.displayName, String(row.tags_json), 'character-library', version, String(row.created_at), now);
      database.connection.prepare('INSERT OR REPLACE INTO persona_versions VALUES (?,?,?,?,?,?,?,?)').run(request.params.id, version, draft.displayName, prompt, draft.appearance.description || null, row.avatar_asset_id ? String(row.avatar_asset_id) : null, JSON.stringify({ characterData: draft }), now);
    });
    return reply.code(201).send(mapVersion(database.connection.prepare('SELECT * FROM character_versions WHERE character_id=? AND version=?').get(request.params.id, version) as Record<string, unknown>));
  });

  app.post<{ Params: { id: string }; Body: { description?: string; useWeb?: boolean } }>('/api/v1/admin/characters/:id/generate', async (request, reply) => {
    const row = database.connection.prepare('SELECT draft_revision FROM character_profiles WHERE id=?').get(request.params.id) as { draft_revision: number } | undefined; if (!row) return reply.code(404).send({ error: 'not_found' });
    const description = text(request.body?.description, 4_000); if (description.length < 2) return reply.code(400).send({ error: 'description_required' });
    try {
      const found = request.body?.useWeb === false ? [] : await researchCharacter(description, fetcher);
      const draft = await generateDraft(database, secrets, fetcher, description, found);
      const now = nowIso(); database.transaction(() => {
        database.connection.prepare('UPDATE character_profiles SET display_name=?,draft_json=?,draft_revision=?,updated_at=? WHERE id=?').run(draft.displayName, JSON.stringify(draft), Number(row.draft_revision ?? 1) + 1, now, request.params.id);
        for (const source of found) database.connection.prepare(`INSERT INTO character_sources
          (id,character_id,title,url,excerpt,source_type,fetched_at,provider_id,external_id,payload_hash,source_snapshot_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,NULL)`).run(randomUUID(), request.params.id, source.title, source.url, source.excerpt, source.sourceType, now, null, null, null);
      });
      return { draft, sources: sourceRows(database, request.params.id) };
    } catch (error) { return reply.code(502).send({ error: 'generation_failed', message: error instanceof Error ? error.message : String(error) }); }
  });

  app.post<{ Params: { id: string }; Body: { prompt?: string; seed?: number | null } }>('/api/v1/admin/characters/:id/generate-avatar', async (request, reply) => {
    const row = database.connection.prepare('SELECT draft_json FROM character_profiles WHERE id=?').get(request.params.id) as { draft_json: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const draft = normalizeCharacterDraft(JSON.parse(row.draft_json));
    const prompt = text(request.body?.prompt, 4_000) || characterAvatarPrompt(draft);
    if (prompt.length < 2) return reply.code(400).send({ error: 'appearance_required', message: '请先补充角色外观描述。' });
    const seed = request.body?.seed == null ? null : Number(request.body.seed);
    if (seed !== null && (!Number.isSafeInteger(seed) || seed < 0)) return reply.code(400).send({ error: 'invalid_seed' });
    const header = request.headers['idempotency-key'];
    try {
      const task = await createGenerationTask(config, database, secrets, {
        appId: 'characters', purpose: 'character-avatar',
        inputs: { prompt, width: 768, height: 1024, steps: 24, characterId: request.params.id },
        seed, priority: 'interactive', idempotencyKey: typeof header === 'string' ? header : null,
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
    if (!characterGenerationTask(database, request.params.taskId, request.params.id)) return reply.code(404).send({ error: 'not_found' });
    const task = getGenerationTask(database, request.params.taskId, 'characters');
    if (!task) return reply.code(404).send({ error: 'not_found' });
    if (task.status !== 'succeeded') return reply.code(409).send({ error: 'task_not_succeeded', status: task.status });
    const output = task.artifacts.find((artifact) => artifact.mediaKind === 'image' || artifact.contentType?.startsWith('image/'));
    if (!output) return reply.code(409).send({ error: 'image_output_missing' });
    const artifact = await readArtifact(database, output.artifactId);
    if (!artifact || artifact.fileStatus !== 'ready' || !artifact.localPath || !existsSync(artifact.localPath)) return reply.code(404).send({ error: 'artifact_not_ready' });
    const current = database.connection.prepare('SELECT avatar_asset_id FROM character_profiles WHERE id=?').get(request.params.id) as { avatar_asset_id: string | null };
    const oldAsset = current.avatar_asset_id
      ? database.connection.prepare('SELECT artifact_id FROM character_assets WHERE id=?').get(current.avatar_asset_id) as { artifact_id: string | null } | undefined
      : undefined;
    const assetId = randomUUID(); const now = nowIso();
    try {
      database.transaction(() => {
        database.connection.prepare(`INSERT INTO character_assets
          (id,character_id,kind,local_path,content_type,byte_size,original_name,created_at,artifact_id)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(assetId, request.params.id, 'avatar', artifact.localPath, artifact.contentType || 'image/png', artifact.byteSize, artifact.originalName || `avatar-${assetId}.png`, now, artifact.id);
        database.connection.prepare('UPDATE character_profiles SET avatar_asset_id=?,updated_at=? WHERE id=?').run(assetId, now, request.params.id);
        createArtifactReference(database, { artifactId: artifact.id, appId: 'characters', refType: 'character-avatar', refId: request.params.id });
        if (oldAsset?.artifact_id && oldAsset.artifact_id !== artifact.id) removeArtifactReference(database, { artifactId: oldAsset.artifact_id, appId: 'characters', refId: request.params.id });
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
    return { spec: 'chara_card_v2', spec_version: '2.0', data: { name: draft.displayName, description: [draft.identity, draft.background].filter(Boolean).join('\n\n'), personality: draft.personality.join('\n'), scenario: draft.currentSituation, first_mes: '', mes_example: draft.speech.examples.join('\n'), creator_notes: draft.extraRules, system_prompt: compileLinshePrompt(draft), post_history_instructions: '', alternate_greetings: [], tags: [], creator: 'SthStart', character_version: '1.0' } };
  });

  app.put<{ Params: { id: string }; Body: { toCharacterId?: string; relationType?: string; description?: string } }>('/api/v1/admin/characters/:id/relationship', async (request, reply) => {
    const target = request.body?.toCharacterId; if (!target || target === request.params.id || !database.connection.prepare('SELECT 1 FROM character_profiles WHERE id=?').get(target)) return reply.code(400).send({ error: 'invalid_relationship_target' });
    const existing = database.connection.prepare('SELECT id FROM character_relationships WHERE from_character_id=? AND to_character_id=?').get(request.params.id, target) as { id: string } | undefined; const id = existing?.id ?? randomUUID();
    database.connection.prepare(`INSERT INTO character_relationships VALUES (?,?,?,?,?,?) ON CONFLICT(from_character_id,to_character_id) DO UPDATE SET relation_type=excluded.relation_type,description=excluded.description,updated_at=excluded.updated_at`).run(id, request.params.id, target, text(request.body.relationType, 200), text(request.body.description, 4_000), nowIso());
    return { id };
  });

  app.delete<{ Params: { id: string; relationshipId: string } }>('/api/v1/admin/characters/:id/relationships/:relationshipId', async (request, reply) => {
    const result = database.connection.prepare('DELETE FROM character_relationships WHERE id=? AND (from_character_id=? OR to_character_id=?)').run(request.params.relationshipId, request.params.id, request.params.id);
    return result.changes ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  app.post<{ Params: { id: string }; Body: { dataUrl?: string; filename?: string; kind?: 'avatar' | 'reference'; purposes?: string[]; sourcePage?: string; originalUrl?: string; authorNote?: string; userNote?: string; outfitId?: string | null } }>('/api/v1/admin/characters/:id/assets', async (request, reply) => {
    if (!database.connection.prepare('SELECT 1 FROM character_profiles WHERE id=?').get(request.params.id)) return reply.code(404).send({ error: 'not_found' });
    const match = request.body?.dataUrl?.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/); if (!match) return reply.code(400).send({ error: 'invalid_image' });
    const bytes = Buffer.from(match[2], 'base64'); if (bytes.length > 8 * 1024 * 1024) return reply.code(413).send({ error: 'image_too_large' });
    const id = randomUUID(); const now = nowIso(); const originalName = request.body.filename?.slice(0, 255) || `${id}.${match[1].split('/')[1].replace('jpeg', 'jpg')}`;
    const artifact = await streamUploadArtifact(config, database, { appId: 'characters', stream: Readable.from([bytes]), contentType: match[1], originalName, refType: 'character-asset', refId: id, metadata: { characterId: request.params.id, kind: request.body.kind === 'reference' ? 'reference' : 'avatar' } });
    const artifactRow = database.connection.prepare('SELECT local_path FROM artifacts WHERE id=?').get(artifact.id) as { local_path: string | null } | undefined;
    const purposes = Array.isArray(request.body.purposes) ? [...new Set(request.body.purposes.filter((purpose): purpose is string => ['avatar', 'identity', 'outfit', 'pose', 'style', 'init_image'].includes(purpose)))].slice(0, 10) : (request.body.kind === 'reference' ? ['identity'] : ['avatar']);
    try {
      database.connection.prepare(`INSERT INTO character_assets
        (id,character_id,kind,local_path,content_type,byte_size,original_name,created_at,artifact_id,sha256,width,height,source_page,source_url,author_note,user_note,purposes_json,outfit_id,enabled,crop_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, request.params.id, request.body.kind === 'reference' ? 'reference' : 'avatar', artifactRow?.local_path || '', match[1], bytes.length, originalName, now, artifact.id, artifact.sha256, artifact.width, artifact.height, request.body.sourcePage?.slice(0, 2_000) || null, request.body.originalUrl?.slice(0, 2_000) || null, request.body.authorNote?.slice(0, 4_000) || '', request.body.userNote?.slice(0, 4_000) || '', JSON.stringify(purposes), request.body.outfitId ?? null, 1, null);
      if (request.body.kind === 'reference') {
        database.connection.prepare(`INSERT INTO character_visual_references
          (id,character_id,asset_id,artifact_id,sha256,purposes_json,outfit_id,source_page,original_url,author_note,user_note,enabled,crop_json,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), request.params.id, id, artifact.id, artifact.sha256, JSON.stringify(purposes), request.body.outfitId ?? null, request.body.sourcePage?.slice(0, 2_000) || null, request.body.originalUrl?.slice(0, 2_000) || null, request.body.authorNote?.slice(0, 4_000) || '', request.body.userNote?.slice(0, 4_000) || '', 1, null, now, now);
      }
    } catch (error) { throw error; }
    if (request.body.kind !== 'reference') database.connection.prepare('UPDATE character_profiles SET avatar_asset_id=?,updated_at=? WHERE id=?').run(id, now, request.params.id);
    const reference = request.body.kind === 'reference' ? visualReferenceRows(database, request.params.id).find((item) => item.assetId === id) : null;
    return reply.code(201).send({ id, url: `/api/v1/admin/characters/assets/${id}`, ...(reference ? { reference } : {}) });
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/characters/assets/:id', async (request, reply) => sendCharacterAsset(database, request.params.id, reply));

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
    const reference = database.connection.prepare(`SELECT r.*,a.local_path,a.content_type,a.artifact_id
      FROM character_visual_references r JOIN character_assets a ON a.id=r.asset_id
      WHERE r.id=? AND r.character_id=? AND r.enabled=1`).get(referenceId, request.params.id) as Record<string, unknown> | undefined;
    if (!reference) return reply.code(404).send({ error: 'reference_not_found' });
    if (request.body?.expectedDraftRevision != null && Number(request.body.expectedDraftRevision) !== Number(profile.draft_revision ?? 1)) return reply.code(409).send({ error: 'draft_revision_conflict', draftRevision: Number(profile.draft_revision ?? 1) });
    try {
      const model = await resolveCharacterLlmProfile(database, secrets, request.params.id, 'multimodal');
      if (!model?.model) throw new Error('multimodal_profile_not_assigned');
      const media = await referenceBytes(database, reference);
      const prompt = `请观察这张角色参考图，只输出 JSON，不要 Markdown。不要从画面推断未观察到的身份、作品或性格；不确定项放入 unknowns，视觉与已有人设冲突放入 conflicts。严格使用此格式：
{"description":"观察到的整体外观","hair":"发型发色","eyes":"眼睛","build":"体态","accessories":[],"observedOutfit":"本图服装","unknowns":[],"conflicts":[],"evidence":["可见证据"]}
已有角色名：${JSON.parse(profile.draft_json).displayName || '未命名'}。`;
      const response = await fetcher(`${model.baseUrl}/chat/completions`, { method: 'POST', headers: { ...model.headers, ...upstreamHeaders(model.secret) }, body: JSON.stringify({ ...model.extraBody, model: model.model, temperature: 0.1, messages: [{ role: 'system', content: '你是谨慎的视觉资料提取器，只输出有效 JSON。' }, { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${media.contentType};base64,${bytesBase64(media.bytes)}` } }] }] }), signal: AbortSignal.timeout(180_000) });
      const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }>; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
      const extraction = appearanceExtraction(modelJson(payload.choices?.[0]?.message?.content));
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
    const appearance = normalizeCharacterAppearance(draft.appearance);
    if (selected.has('/appearance/description') && extraction.description) appearance.description = extraction.description;
    if (selected.has('/appearance/hair') && extraction.hair) appearance.hair = extraction.hair;
    if (selected.has('/appearance/eyes') && extraction.eyes) appearance.eyes = extraction.eyes;
    if (selected.has('/appearance/build') && extraction.build) appearance.build = extraction.build;
    if (selected.has('/appearance/accessories') && extraction.accessories.length) appearance.accessories = extraction.accessories;
    if (selected.has('/appearance/outfits') && extraction.observedOutfit) appearance.outfits = [...new Set([...appearance.outfits, extraction.observedOutfit])];
    const nextDraft = normalizeCharacterDraft({ ...draft, appearance });
    const nextRevision = Number(profile.draft_revision ?? 1) + 1; const now = nowIso();
    database.transaction(() => {
      const update = database.connection.prepare('UPDATE character_profiles SET draft_json=?,draft_revision=?,updated_at=? WHERE id=? AND draft_revision=?').run(JSON.stringify(nextDraft), nextRevision, now, request.params.id, profile.draft_revision ?? 1);
      if (Number(update.changes) !== 1) throw new Error('draft_revision_conflict');
      for (const fieldPath of selected) {
        if (!['/appearance/description', '/appearance/hair', '/appearance/eyes', '/appearance/build', '/appearance/accessories', '/appearance/outfits'].includes(fieldPath)) continue;
        const field = fieldPath.split('/').at(-1)!;
        if (JSON.stringify((draft.appearance as unknown as Record<string, unknown>)[field]) === JSON.stringify((appearance as unknown as Record<string, unknown>)[field])) continue;
        const value = fieldPath === '/appearance/description' ? appearance.description : fieldPath === '/appearance/hair' ? appearance.hair : fieldPath === '/appearance/eyes' ? appearance.eyes : fieldPath === '/appearance/build' ? appearance.build : fieldPath === '/appearance/accessories' ? appearance.accessories : appearance.outfits;
        database.connection.prepare(`INSERT INTO character_field_provenance
          (id,character_id,version,field_path,value_hash,source_kind,source_snapshot_id,source_pointer,evidence_json,derived_from_json,confirmed,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), request.params.id, null, fieldPath, hash(value), 'image_observed', null, `/character-ai-candidates/${request.params.taskId}`, JSON.stringify({ evidence: extraction.evidence, conflicts: extraction.conflicts }), '[]', 1, now);
      }
      database.connection.prepare("UPDATE character_ai_candidates SET status='applied' WHERE id=?").run(request.params.taskId);
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
      if (!model?.model) throw new Error('text_profile_not_assigned');
      const draft = normalizeCharacterDraft(JSON.parse(profile.draft_json));
      const prompt = buildAuditionPrompt(draft, scenario, text(request.body?.feedback, 4_000));
      const response = await fetcher(`${model.baseUrl}/chat/completions`, { method: 'POST', headers: { ...model.headers, ...upstreamHeaders(model.secret) }, body: JSON.stringify({ ...model.extraBody, model: model.model, temperature: 0.7, messages: [{ role: 'system', content: '你是严格遵循已保存角色资料的试演助手，只输出有效 JSON。' }, { role: 'user', content: prompt }] }), signal: AbortSignal.timeout(180_000) });
      const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }>; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
      const value = modelJson(payload.choices?.[0]?.message?.content);
      const suggestions = Array.isArray(value.suggestions) ? value.suggestions.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const itemRecord = item as Record<string, unknown>;
        return [{ fieldPath: text(itemRecord.fieldPath, 200), before: text(itemRecord.before, 4_000), after: text(itemRecord.after, 4_000), reason: text(itemRecord.reason, 500) }];
      }).slice(0, 20) : [];
      const output = text(value.output, 8_000); if (!output) throw new Error('audition_output_empty');
      const id = randomUUID();
      database.connection.prepare(`INSERT INTO character_auditions
        (id,character_id,draft_revision,scenario,output,feedback,suggestions_json,compiler_version,model_profile_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, request.params.id, Number(profile.draft_revision ?? 1), scenario, output, text(request.body?.feedback, 4_000) || null, JSON.stringify(suggestions), 'character-persona-v1', model.id, nowIso());
      return { id, scenario, output, ...(request.body?.feedback ? { feedback: text(request.body.feedback, 4_000) } : {}), suggestions, draftRevision: Number(profile.draft_revision ?? 1), compilerVersion: 'character-persona-v1', profileId: model.id };
    } catch (error) { return characterImportError(reply, error); }
  });

  app.get('/api/v1/characters', async (request, reply) => {
    const identity = requirePersonaApp(database, request, reply); if (!identity) return;
    const rows = database.connection.prepare('SELECT * FROM character_profiles WHERE archived=0 AND latest_version IS NOT NULL ORDER BY display_name').all();
    return { items: rows.map((row) => mapProfile(database, row as Record<string, unknown>, '/api/v1/characters/assets')) };
  });
  app.get<{ Params: { id: string } }>('/api/v1/characters/assets/:id', async (request, reply) => {
    const identity = requirePersonaApp(database, request, reply); if (!identity) return;
    return sendCharacterAsset(database, request.params.id, reply);
  });
  app.get<{ Params: { id: string }; Querystring: { version?: string } }>('/api/v1/characters/:id', async (request, reply) => {
    const identity = requirePersonaApp(database, request, reply); if (!identity) return;
    const profile = database.connection.prepare('SELECT id,slug,display_name,tags_json,latest_version,avatar_asset_id FROM character_profiles WHERE id=? AND archived=0').get(request.params.id) as Record<string, unknown> | undefined; if (!profile?.latest_version) return reply.code(404).send({ error: 'not_found' });
    const version = Number(request.query.version || profile.latest_version); const row = database.connection.prepare('SELECT * FROM character_versions WHERE character_id=? AND version=?').get(request.params.id, version) as Record<string, unknown> | undefined; if (!row) return reply.code(404).send({ error: 'version_not_found' });
    const snapshot = mapVersion(row);
    return { ...profile, avatar_url: profile.avatar_asset_id ? `/api/v1/characters/assets/${profile.avatar_asset_id}` : null, version: snapshot, relationships: snapshot.relationships };
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
