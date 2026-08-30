import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CharacterDraft, CharacterProfile, CharacterRelationship, CharacterSource, CharacterVersion } from '@sthstart/contracts';
import { compileLinshePrompt } from '@sthstart/contracts';
import { authenticateApp, hasCapability } from './access.js';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';
import { resolveAssignedLlmProfile, upstreamHeaders } from './providers.js';
import type { SecretStore } from './security.js';
import { createArtifactReadStream, createArtifactReference, readArtifact, removeArtifactReference } from './artifacts.js';
import { createGenerationTask, getGenerationTask } from './generation.js';
import { sanitizeErrorMessage } from './generation.js';

const EMPTY_DRAFT: CharacterDraft = {
  displayName: '', englishName: '', aliases: [], originType: 'original', work: '', world: '', summary: '',
  identity: '', background: '', currentSituation: '', personality: [], motivations: [], beliefs: [], secrets: [],
  speech: { tone: '', habits: '', catchphrases: [], examples: [] }, likes: [], dislikes: [], fears: [], boundaries: [],
  appearance: { description: '', hair: '', eyes: '', build: '', outfits: [], accessories: [] }, extraRules: '',
};

function text(value: unknown, max = 20_000) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function list(value: unknown, maxItems = 30) {
  return Array.isArray(value) ? [...new Set(value.map((item) => text(item, 1_000)).filter(Boolean))].slice(0, maxItems) : [];
}

export function normalizeCharacterDraft(raw: unknown): CharacterDraft {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const speech = source.speech && typeof source.speech === 'object' ? source.speech as Record<string, unknown> : {};
  const appearance = source.appearance && typeof source.appearance === 'object' ? source.appearance as Record<string, unknown> : {};
  return {
    ...EMPTY_DRAFT,
    displayName: text(source.displayName, 200), englishName: text(source.englishName, 200), aliases: list(source.aliases),
    originType: source.originType === 'ip' ? 'ip' : 'original', work: text(source.work, 300), world: text(source.world, 300),
    summary: text(source.summary, 2_000), identity: text(source.identity), background: text(source.background),
    currentSituation: text(source.currentSituation), personality: list(source.personality), motivations: list(source.motivations),
    beliefs: list(source.beliefs), secrets: list(source.secrets),
    speech: { tone: text(speech.tone, 4_000), habits: text(speech.habits, 4_000), catchphrases: list(speech.catchphrases), examples: list(speech.examples) },
    likes: list(source.likes), dislikes: list(source.dislikes), fears: list(source.fears), boundaries: list(source.boundaries),
    appearance: {
      description: text(appearance.description), hair: text(appearance.hair, 1_000), eyes: text(appearance.eyes, 1_000),
      build: text(appearance.build, 1_000), outfits: list(appearance.outfits), accessories: list(appearance.accessories),
    },
    extraRules: text(source.extraRules), ...(text(source.legacyPrompt) ? { legacyPrompt: text(source.legacyPrompt) } : {}),
  };
}

function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }

function avatarUrl(database: ServiceDatabase, assetId: unknown, assetPath: string) {
  return assetId && database.connection.prepare('SELECT 1 FROM character_assets WHERE id=?').get(String(assetId)) ? `${assetPath}/${assetId}` : null;
}

function mapProfile(database: ServiceDatabase, row: Record<string, unknown>, assetPath = '/api/admin/characters/assets'): CharacterProfile {
  return {
    id: String(row.id), slug: String(row.slug), displayName: String(row.display_name),
    draft: normalizeCharacterDraft(JSON.parse(String(row.draft_json))), tags: JSON.parse(String(row.tags_json)) as string[],
    avatarUrl: avatarUrl(database, row.avatar_asset_id, assetPath), latestVersion: row.latest_version == null ? null : Number(row.latest_version),
    archived: Boolean(row.archived), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapVersion(row: Record<string, unknown>): CharacterVersion {
  return { characterId: String(row.character_id), version: Number(row.version), data: normalizeCharacterDraft(JSON.parse(String(row.data_json))), compiledLinshePrompt: String(row.compiled_linshe_prompt), relationships: JSON.parse(String(row.relationships_json ?? '[]')) as CharacterRelationship[], createdAt: String(row.created_at) };
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
    database.transaction(() => {
      database.connection.prepare('INSERT INTO character_profiles VALUES (?,?,?,?,?,?,?,0,?,?)').run(personaId, uniqueSlug(database, personaId), String(persona.display_name), JSON.stringify(draft), String(persona.tags_json), latest?.avatar_artifact_id ? String(latest.avatar_artifact_id) : null, versions.length ? Number(persona.latest_version) : null, String(persona.created_at), String(persona.updated_at));
      for (const version of versions) database.connection.prepare('INSERT INTO character_versions(character_id,version,data_json,compiled_linshe_prompt,created_at) VALUES (?,?,?,?,?)').run(personaId, Number(version.version), JSON.stringify({ ...draft, displayName: String(version.display_name), appearance: { ...draft.appearance, description: String(version.appearance_prompt ?? '') }, legacyPrompt: String(version.persona_prompt) }), String(version.persona_prompt), String(version.created_at));
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
  return (database.connection.prepare('SELECT * FROM character_sources WHERE character_id=? ORDER BY fetched_at DESC').all(characterId) as Record<string, unknown>[]).map((row) => ({ id: String(row.id), characterId: String(row.character_id), title: String(row.title), url: row.url ? String(row.url) : null, excerpt: String(row.excerpt), sourceType: row.source_type as CharacterSource['sourceType'], fetchedAt: String(row.fetched_at) }));
}

function tavernDraft(card: Record<string, unknown>) {
  const source = card.data && typeof card.data === 'object' ? card.data as Record<string, unknown> : card;
  return normalizeCharacterDraft({
    displayName: source.name, summary: source.description, identity: source.description, personality: text(source.personality).split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    currentSituation: source.scenario, speech: { examples: text(source.mes_example).split(/\r?\n/).map((item) => item.trim()).filter(Boolean), tone: '', habits: '', catchphrases: [] },
    extraRules: [text(source.system_prompt), text(source.post_history_instructions), text(source.creator_notes)].filter(Boolean).join('\n\n'),
    aliases: [], originType: 'original', work: '', world: '', background: '', motivations: [], beliefs: [], secrets: [], likes: [], dislikes: [], fears: [], boundaries: [],
    appearance: { description: '', hair: '', eyes: '', build: '', outfits: [], accessories: [] },
  });
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
  const profile = await resolveAssignedLlmProfile(database, secrets, 'linshe', 'text');
  if (!profile?.model) throw new Error('llm_profile_not_assigned');
  const prompt = `请根据用户描述和参考资料生成结构化角色草稿。不得编造与资料冲突的事实。只输出 JSON，不要 Markdown。字段：displayName,englishName,aliases,originType(original|ip),work,world,summary,identity,background,currentSituation,personality[],motivations[],beliefs[],secrets[],speech{tone,habits,catchphrases[],examples[]},likes[],dislikes[],fears[],boundaries[],appearance{description,hair,eyes,build,outfits[],accessories[]},extraRules。\n\n用户描述：${description}\n\n参考资料：\n${sources.map((source) => `【${source.title}】\n${source.excerpt}`).join('\n\n').slice(0, 24_000)}`;
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

export function registerCharacterRoutes(app: FastifyInstance, config: ServiceConfig, database: ServiceDatabase, secrets: SecretStore, fetcher: typeof fetch = fetch) {
  migrateLegacyPersonas(database);

  app.get<{ Querystring: { q?: string; archived?: string } }>('/api/v1/admin/characters', async (request) => {
    const archived = request.query.archived === 'true' ? 1 : 0; const query = request.query.q?.trim();
    const rows = database.connection.prepare(`SELECT * FROM character_profiles WHERE archived=? ${query ? 'AND (display_name LIKE ? OR slug LIKE ? OR tags_json LIKE ? OR draft_json LIKE ?)' : ''} ORDER BY updated_at DESC LIMIT 500`).all(...(query ? [archived, ...Array(4).fill(`%${query}%`)] : [archived])) as Record<string, unknown>[];
    return { items: rows.map((row) => mapProfile(database, row)) };
  });

  app.post<{ Body: { slug?: string; displayName?: string; draft?: unknown; tags?: string[] } }>('/api/v1/admin/characters', async (request, reply) => {
    const draft = normalizeCharacterDraft({ ...(request.body?.draft as object ?? {}), displayName: request.body?.displayName ?? (request.body?.draft as CharacterDraft | undefined)?.displayName });
    if (!draft.displayName) return reply.code(400).send({ error: 'display_name_required' });
    const id = randomUUID(); const now = nowIso(); const slug = uniqueSlug(database, request.body?.slug || draft.englishName || draft.displayName);
    database.connection.prepare('INSERT INTO character_profiles VALUES (?,?,?,?,?,NULL,NULL,0,?,?)').run(id, slug, draft.displayName, JSON.stringify(draft), JSON.stringify(list(request.body?.tags, 50)), now, now);
    return reply.code(201).send(mapProfile(database, database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(id) as Record<string, unknown>));
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/characters/:id', async (request, reply) => {
    const row = database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const versions = database.connection.prepare('SELECT * FROM character_versions WHERE character_id=? ORDER BY version DESC').all(request.params.id) as Record<string, unknown>[];
    const links = database.connection.prepare('SELECT app_id,local_id,source_version,local_modified,updated_at FROM app_character_links WHERE character_id=? ORDER BY app_id').all(request.params.id);
    return { ...mapProfile(database, row), versions: versions.map(mapVersion), sources: sourceRows(database, request.params.id), relationships: relationshipRows(database, request.params.id), links };
  });

  app.put<{ Params: { id: string }; Body: { slug?: string; draft?: unknown; tags?: string[]; avatarAssetId?: string | null } }>('/api/v1/admin/characters/:id', async (request, reply) => {
    const current = database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!current) return reply.code(404).send({ error: 'not_found' });
    const draft = normalizeCharacterDraft(request.body?.draft ?? JSON.parse(String(current.draft_json)));
    if (!draft.displayName) return reply.code(400).send({ error: 'display_name_required' });
    const slug = request.body?.slug ? uniqueSlug(database, request.body.slug, request.params.id) : String(current.slug);
    const tags = request.body?.tags ? list(request.body.tags, 50) : JSON.parse(String(current.tags_json));
    const rawAvatar = request.body?.avatarAssetId === undefined ? current.avatar_asset_id : request.body.avatarAssetId;
    const avatar = rawAvatar ? String(rawAvatar) : null;
    if (avatar && !database.connection.prepare('SELECT 1 FROM character_assets WHERE id=? AND character_id=?').get(avatar, request.params.id)) return reply.code(400).send({ error: 'invalid_avatar' });
    database.connection.prepare('UPDATE character_profiles SET slug=?,display_name=?,draft_json=?,tags_json=?,avatar_asset_id=?,updated_at=? WHERE id=?').run(slug, draft.displayName, JSON.stringify(draft), JSON.stringify(tags), avatar, nowIso(), request.params.id);
    return mapProfile(database, database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(request.params.id) as Record<string, unknown>);
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/characters/:id/publish', async (request, reply) => {
    const row = database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const draft = normalizeCharacterDraft(JSON.parse(String(row.draft_json)));
    if (!draft.displayName || (!draft.identity && !draft.summary && !draft.legacyPrompt) || (!draft.appearance.description && !draft.legacyPrompt)) return reply.code(400).send({ error: 'character_incomplete', message: '发布前至少需要角色名称、身份或摘要，以及外观描述。' });
    const version = Number(row.latest_version ?? 0) + 1; const prompt = compileLinshePrompt(draft); const now = nowIso();
    database.transaction(() => {
      database.connection.prepare('INSERT INTO character_versions(character_id,version,data_json,compiled_linshe_prompt,created_at,relationships_json) VALUES (?,?,?,?,?,?)').run(request.params.id, version, JSON.stringify(draft), prompt, now, JSON.stringify(relationshipRows(database, request.params.id)));
      database.connection.prepare('UPDATE character_profiles SET latest_version=?,updated_at=? WHERE id=?').run(version, now, request.params.id);
      database.connection.prepare(`INSERT INTO personas(id,display_name,tags_json,source,latest_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,tags_json=excluded.tags_json,latest_version=excluded.latest_version,updated_at=excluded.updated_at`).run(request.params.id, draft.displayName, String(row.tags_json), 'character-library', version, String(row.created_at), now);
      database.connection.prepare('INSERT OR REPLACE INTO persona_versions VALUES (?,?,?,?,?,?,?,?)').run(request.params.id, version, draft.displayName, prompt, draft.appearance.description || null, row.avatar_asset_id ? String(row.avatar_asset_id) : null, JSON.stringify({ characterData: draft }), now);
    });
    return reply.code(201).send(mapVersion(database.connection.prepare('SELECT * FROM character_versions WHERE character_id=? AND version=?').get(request.params.id, version) as Record<string, unknown>));
  });

  app.post<{ Params: { id: string }; Body: { description?: string; useWeb?: boolean } }>('/api/v1/admin/characters/:id/generate', async (request, reply) => {
    const row = database.connection.prepare('SELECT 1 FROM character_profiles WHERE id=?').get(request.params.id); if (!row) return reply.code(404).send({ error: 'not_found' });
    const description = text(request.body?.description, 4_000); if (description.length < 2) return reply.code(400).send({ error: 'description_required' });
    try {
      const found = request.body?.useWeb === false ? [] : await researchCharacter(description, fetcher);
      const draft = await generateDraft(database, secrets, fetcher, description, found);
      const now = nowIso(); database.transaction(() => {
        database.connection.prepare('UPDATE character_profiles SET display_name=?,draft_json=?,updated_at=? WHERE id=?').run(draft.displayName, JSON.stringify(draft), now, request.params.id);
        for (const source of found) database.connection.prepare('INSERT INTO character_sources VALUES (?,?,?,?,?,?,?)').run(randomUUID(), request.params.id, source.title, source.url, source.excerpt, source.sourceType, now);
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
    const draft = tavernDraft(request.body.card); if (!draft.displayName) return reply.code(400).send({ error: 'card_name_required' });
    const id = randomUUID(); const now = nowIso();
    database.transaction(() => {
      database.connection.prepare('INSERT INTO character_profiles VALUES (?,?,?,?,?,NULL,NULL,0,?,?)').run(id, uniqueSlug(database, draft.displayName), draft.displayName, JSON.stringify(draft), '[]', now, now);
      database.connection.prepare('INSERT INTO character_sources VALUES (?,?,?,?,?,?,?)').run(randomUUID(), id, `Tavern Card：${draft.displayName}`, null, JSON.stringify(request.body.card).slice(0, 20_000), 'tavern-card', now);
    });
    return reply.code(201).send(mapProfile(database, database.connection.prepare('SELECT * FROM character_profiles WHERE id=?').get(id) as Record<string, unknown>));
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

  app.post<{ Params: { id: string }; Body: { dataUrl?: string; filename?: string; kind?: 'avatar' | 'reference' } }>('/api/v1/admin/characters/:id/assets', async (request, reply) => {
    if (!database.connection.prepare('SELECT 1 FROM character_profiles WHERE id=?').get(request.params.id)) return reply.code(404).send({ error: 'not_found' });
    const match = request.body?.dataUrl?.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/); if (!match) return reply.code(400).send({ error: 'invalid_image' });
    const bytes = Buffer.from(match[2], 'base64'); if (bytes.length > 8 * 1024 * 1024) return reply.code(413).send({ error: 'image_too_large' });
    const id = randomUUID(); const extension = extname(request.body.filename ?? '') || `.${match[1].split('/')[1].replace('jpeg', 'jpg')}`; const directory = resolve(config.artifactDirectory, 'characters'); const path = resolve(directory, `${id}${extension}`);
    await mkdir(directory, { recursive: true }); await writeFile(path, bytes, { flag: 'wx' });
    try { database.connection.prepare('INSERT INTO character_assets (id,character_id,kind,local_path,content_type,byte_size,original_name,created_at,artifact_id) VALUES (?,?,?,?,?,?,?,?,NULL)').run(id, request.params.id, request.body.kind === 'reference' ? 'reference' : 'avatar', path, match[1], bytes.length, request.body.filename?.slice(0, 255) || null, nowIso()); }
    catch (error) { await unlink(path).catch(() => undefined); throw error; }
    if (request.body.kind !== 'reference') database.connection.prepare('UPDATE character_profiles SET avatar_asset_id=?,updated_at=? WHERE id=?').run(id, nowIso(), request.params.id);
    return reply.code(201).send({ id, url: `/api/admin/characters/assets/${id}` });
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/characters/assets/:id', async (request, reply) => sendCharacterAsset(database, request.params.id, reply));

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
