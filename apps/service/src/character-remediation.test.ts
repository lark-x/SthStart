import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import { CharacterDetailSchema, CharacterVersionSchema } from '@sthstart/contracts';
import { buildCharacterVisualPrompt } from './characters/persona-compiler.js';
import { normalizeCharacterDraft } from './characters/draft.js';
import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createService } from './server.js';
import { ServiceDatabase } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { createActorSnapshotFromCharacter, extractCharacterPersonaDraft } from './activities/characters.js';

const ADMIN_TOKEN = 'character-remediation-test-token-1234567890';
const adminHeaders = { 'x-sthstart-admin-token': ADMIN_TOKEN };
const defaultAvatarPath = fileURLToPath(new URL('../../../packages/activity-playback/templates/phone-v1/assets/default_avatar.png', import.meta.url));

async function setup() {
  const artifactDirectory = await mkdtemp(resolve(tmpdir(), 'sthstart-character-remediation-'));
  const database = new ServiceDatabase();
  const { app } = await createService({ config: readConfig({ STHSTART_ADMIN_TOKEN: ADMIN_TOKEN, STHSTART_ARTIFACT_DIR: artifactDirectory }), database, secrets: new SecretStore({}) });
  return { app, database, artifactDirectory };
}

const card = (name: string) => ({ spec: 'chara_card_v2', spec_version: '2.0', data: { name, description: `${name}的身份描述`, personality: '冷静\n敏锐', appearance: { description: '白发，深色眼睛' }, system_prompt: '只归档，不执行', character_book: { entries: [{ keys: ['港口'], content: '世界书内容' }] } } });

test('character import sessions preview, preserve provenance, commit with idempotency, and enforce draft CAS', async () => {
  const { app, database } = await setup();
  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/characters/import-sessions', headers: adminHeaders, payload: { card: card('会话角色') } });
  assert.equal(created.statusCode, 201);
  const preview = created.json();
  assert.equal(preview.status, 'ready');
  assert.equal(preview.compatibility.worldBookEntries, 1);
  assert.deepEqual(preview.candidate.draft.personality, ['冷静', '敏锐']);
  assert.equal(preview.candidate.mappings.some((mapping: { fieldPath: string }) => mapping.fieldPath === '/appearance/description'), true);

  const duplicatePreviewResponse = await app.inject({ method: 'POST', url: '/api/v1/admin/characters/import-sessions', headers: adminHeaders, payload: { card: card('会话角色') } });
  assert.equal(duplicatePreviewResponse.statusCode, 201);
  assert.equal(duplicatePreviewResponse.json().source.payloadHash, preview.source.payloadHash);
  assert.equal(duplicatePreviewResponse.json().source.providerId, preview.source.providerId);
  const sharedSnapshot = database.connection.prepare('SELECT id FROM character_source_snapshots WHERE payload_hash=?').get(preview.source.payloadHash) as { id: string };
  const cancelledDuplicate = await app.inject({ method: 'DELETE', url: `/api/v1/admin/characters/import-sessions/${duplicatePreviewResponse.json().id}`, headers: adminHeaders });
  assert.equal(cancelledDuplicate.statusCode, 200);
  assert.ok(database.connection.prepare('SELECT id FROM character_source_snapshots WHERE id=?').get(sharedSnapshot.id));

  const edited = await app.inject({ method: 'PATCH', url: `/api/v1/admin/characters/import-sessions/${preview.id}`, headers: adminHeaders, payload: {
    expectedPreviewRevision: preview.previewRevision,
    candidatePatch: { draft: { summary: '用户确认的摘要' } },
  } });
  assert.equal(edited.statusCode, 200);
  const committed = await app.inject({ method: 'POST', url: `/api/v1/admin/characters/import-sessions/${preview.id}/commit`, headers: { ...adminHeaders, 'idempotency-key': 'commit-session-1' }, payload: {
    expectedPreviewRevision: edited.json().previewRevision,
    previewHash: edited.json().previewHash,
  } });
  assert.equal(committed.statusCode, 201);
  const characterId = committed.json().characterId as string;
  assert.equal(committed.json().draftRevision, 1);
  const provenanceCount = database.connection.prepare('SELECT COUNT(*) count FROM character_field_provenance WHERE character_id=?').get(characterId) as { count: number };
  assert.equal(provenanceCount.count > 0, true);
  const snapshot = database.connection.prepare('SELECT raw_file_path FROM character_source_snapshots WHERE id=?').get(committed.json().sourceSnapshotId) as { raw_file_path: string };
  assert.equal(Boolean(snapshot.raw_file_path), true);
  const detail = await app.inject({ method: 'GET', url: `/api/v1/admin/characters/${characterId}`, headers: adminHeaders });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().sources[0].sourceSnapshotId, committed.json().sourceSnapshotId);
  const rawSnapshot = await app.inject({ method: 'GET', url: `/api/v1/admin/characters/${characterId}/source-snapshots/${committed.json().sourceSnapshotId}/raw`, headers: adminHeaders });
  assert.equal(rawSnapshot.statusCode, 200);
  assert.match(rawSnapshot.body, /chara_card_v2/);

  const replay = await app.inject({ method: 'POST', url: `/api/v1/admin/characters/import-sessions/${preview.id}/commit`, headers: { ...adminHeaders, 'idempotency-key': 'commit-session-1' }, payload: { expectedPreviewRevision: 999 } });
  assert.equal(replay.statusCode, 201);
  assert.equal(replay.json().characterId, characterId);

  const targetSession = await app.inject({ method: 'POST', url: '/api/v1/admin/characters/import-sessions', headers: adminHeaders, payload: { card: card('覆盖角色'), targetCharacterId: characterId, baseDraftRevision: 1 } });
  assert.equal(targetSession.statusCode, 201);
  const targetCommit = await app.inject({ method: 'POST', url: `/api/v1/admin/characters/import-sessions/${targetSession.json().id}/commit`, headers: { ...adminHeaders, 'idempotency-key': 'commit-target-1' }, payload: { expectedPreviewRevision: 1, baseDraftRevision: 1, targetCharacterId: characterId } });
  assert.equal(targetCommit.statusCode, 201);
  assert.equal(targetCommit.json().draftRevision, 2);

  const staleSession = await app.inject({ method: 'POST', url: '/api/v1/admin/characters/import-sessions', headers: adminHeaders, payload: { card: card('过期覆盖'), targetCharacterId: characterId, baseDraftRevision: 1 } });
  const staleCommit = await app.inject({ method: 'POST', url: `/api/v1/admin/characters/import-sessions/${staleSession.json().id}/commit`, headers: { ...adminHeaders, 'idempotency-key': 'commit-stale-1' }, payload: { expectedPreviewRevision: 1, baseDraftRevision: 1, targetCharacterId: characterId } });
  assert.equal(staleCommit.statusCode, 409);
  await app.close(); database.close();
});

test('activity snapshots select exact character_versions and reference transfer copies into the activities app', async () => {
  const { app, database, artifactDirectory } = await setup();
  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/characters', headers: adminHeaders, payload: { displayName: '快照角色', draft: { displayName: '快照角色', identity: 'v1 身份', summary: 'v1 摘要', appearance: { description: 'v1 外观' } } } });
  const characterId = created.json().id as string;
  await app.inject({ method: 'POST', url: `/api/v1/admin/characters/${characterId}/publish`, headers: adminHeaders });
  await app.inject({ method: 'PUT', url: `/api/v1/admin/characters/${characterId}`, headers: adminHeaders, payload: { draft: { displayName: '快照角色', identity: 'draft 身份', summary: 'draft 摘要', appearance: { description: 'draft 外观' } } } });
  const snapshot = createActorSnapshotFromCharacter(database, characterId, { sourceVersion: 1 });
  assert.ok(snapshot);
  assert.equal(snapshot.sourceVersionStatus, 'published');
  assert.equal((snapshot.persona as Record<string, unknown>).identity, 'v1 身份');
  assert.equal(((snapshot.persona as Record<string, unknown>).appearance as Record<string, unknown>).description, 'v1 外观');
  assert.equal(extractCharacterPersonaDraft(database, characterId, 1)?.identity, 'v1 身份');
  assert.equal(createActorSnapshotFromCharacter(database, characterId, { sourceVersion: 99 }), null);

  const png = await readFile(defaultAvatarPath);
  const pngBase64 = (png as unknown as { toString: (encoding: string) => string }).toString('base64');
  const uploaded = await app.inject({ method: 'POST', url: `/api/v1/admin/characters/${characterId}/assets`, headers: adminHeaders, payload: { dataUrl: `data:image/png;base64,${pngBase64}`, filename: 'reference.png', kind: 'reference', purposes: ['identity', 'outfit'] } });
  assert.equal(uploaded.statusCode, 201);
  const referenceId = uploaded.json().reference.id as string;
  const activity = await app.inject({ method: 'POST', url: '/api/v1/admin/activities', headers: adminHeaders, payload: { title: '参考图活动', stageTitles: ['一', '二'] } });
  assert.equal(activity.statusCode, 201);
  const activityId = activity.json().activity.id as string;
  const transfer = await app.inject({ method: 'POST', url: `/api/v1/admin/activities/${activityId}/character-references`, headers: { ...adminHeaders, 'idempotency-key': 'transfer-1' }, payload: { characterId, referenceId, version: null } });
  assert.equal(transfer.statusCode, 201);
  const transferRow = database.connection.prepare(`SELECT source.app_id source_app,target.app_id target_app,source.local_path source_path,target.local_path target_path
    FROM activity_character_asset_transfers t JOIN artifacts source ON source.id=t.source_artifact_id JOIN artifacts target ON target.id=t.target_artifact_id WHERE t.activity_id=?`).get(activityId) as { source_app: string; target_app: string; source_path: string; target_path: string };
  assert.equal(transferRow.source_app, 'characters');
  assert.equal(transferRow.target_app, 'activities');
  assert.notEqual(transferRow.source_path, transferRow.target_path);
  const targetArtifact = database.connection.prepare('SELECT target_artifact_id FROM activity_character_asset_transfers WHERE activity_id=?').get(activityId) as { target_artifact_id: string };
  assert.equal(transfer.json().artifactId, targetArtifact.target_artifact_id);
  assert.ok(artifactDirectory);
  await app.close(); database.close();
});

test('ordinary image imports become character-owned artifacts before activity transfer', async () => {
  const { app, database } = await setup();
  const png = await readFile(defaultAvatarPath);
  const session = await app.inject({ method: 'POST', url: '/api/v1/admin/characters/import-sessions', headers: adminHeaders, payload: {
    dataBase64: (png as unknown as { toString: (encoding: string) => string }).toString('base64'), mimeType: 'image/png', filename: '普通参考图.png',
  } });
  assert.equal(session.statusCode, 201, session.body);
  const preview = session.json();
  const edited = await app.inject({ method: 'PATCH', url: `/api/v1/admin/characters/import-sessions/${preview.id}`, headers: adminHeaders, payload: {
    expectedPreviewRevision: preview.previewRevision, cover: { selectedForAvatar: false, selectedForReference: true },
  } });
  assert.equal(edited.statusCode, 200);
  const committed = await app.inject({ method: 'POST', url: `/api/v1/admin/characters/import-sessions/${preview.id}/commit`, headers: { ...adminHeaders, 'idempotency-key': 'commit-ordinary-image-1' }, payload: {
    expectedPreviewRevision: edited.json().previewRevision, previewHash: edited.json().previewHash,
  } });
  assert.equal(committed.statusCode, 201);
  const characterId = committed.json().characterId as string;
  const profile = database.connection.prepare('SELECT avatar_asset_id FROM character_profiles WHERE id=?').get(characterId) as { avatar_asset_id: string | null };
  assert.equal(profile.avatar_asset_id, null);
  const asset = database.connection.prepare('SELECT artifact_id FROM character_assets WHERE character_id=? AND kind=?').get(characterId, 'reference') as { artifact_id: string | null };
  assert.ok(asset.artifact_id);
  const reference = database.connection.prepare('SELECT id,artifact_id FROM character_visual_references WHERE character_id=?').get(characterId) as { id: string; artifact_id: string | null };
  assert.equal(reference.artifact_id, asset.artifact_id);
  const activity = await app.inject({ method: 'POST', url: '/api/v1/admin/activities', headers: adminHeaders, payload: { title: '普通图片活动', stageTitles: ['一', '二'] } });
  const transfer = await app.inject({ method: 'POST', url: `/api/v1/admin/activities/${activity.json().activity.id}/character-references`, headers: { ...adminHeaders, 'idempotency-key': 'transfer-ordinary-image-1' }, payload: { characterId, referenceId: reference.id } });
  assert.equal(transfer.statusCode, 201);
  assert.notEqual(transfer.json().artifactId, asset.artifact_id);
  await app.close(); database.close();
});


test('preview edits preserve unrelated character fields, record user provenance and hash actual raw bytes', async () => {
  const { app, database } = await setup();
  try {
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/characters', headers: adminHeaders, payload: { displayName: '原角色', draft: { displayName: '原角色', identity: '原身份', background: '保留的背景', likes: ['红茶'], appearance: { hair: '银发', eyes: '蓝眼' } } } });
    const characterId = created.json().id;
    const rawCard = card('卡片角色');
    const prepared = await app.inject({ method: 'POST', url: '/api/v1/admin/characters/import-sessions', headers: adminHeaders, payload: { card: rawCard, targetCharacterId: characterId, baseDraftRevision: 1 } });
    const preview = prepared.json();
    assert.equal(preview.source.payloadHash, createHash('sha256').update(JSON.stringify(rawCard)).digest('hex'));
    const patch = await app.inject({ method: 'PATCH', url: `/api/v1/admin/characters/import-sessions/${preview.id}`, headers: adminHeaders, payload: { expectedPreviewRevision: 1, candidatePatch: { draft: { identity: '我修改后的身份', appearance: { description: '确认的外貌' } } } } });
    assert.equal(patch.statusCode, 200, patch.body);
    const committed = await app.inject({ method: 'POST', url: `/api/v1/admin/characters/import-sessions/${preview.id}/commit`, headers: { ...adminHeaders, 'idempotency-key': 'edited-preview' }, payload: { expectedPreviewRevision: patch.json().previewRevision, previewHash: patch.json().previewHash } });
    assert.equal(committed.statusCode, 201, committed.body);
    const detail = (await app.inject({ method: 'GET', url: `/api/v1/admin/characters/${characterId}`, headers: adminHeaders })).json();
    assert.equal(detail.draft.identity, '我修改后的身份');
    assert.equal(detail.draft.background, '保留的背景');
    assert.deepEqual(detail.draft.likes, ['红茶']);
    assert.equal(detail.draft.appearance.hair, '银发');
    assert.equal(detail.draft.appearance.description, '确认的外貌');
    const provenance = database.connection.prepare('SELECT source_kind,value_hash FROM character_field_provenance WHERE character_id=? AND field_path=?').get(characterId, '/identity') as { source_kind: string; value_hash: string };
    assert.equal(provenance.source_kind, 'user_edit');
    assert.equal(provenance.value_hash, createHash('sha256').update('我修改后的身份').digest('hex'));
    const published = await app.inject({ method: 'POST', url: `/api/v1/admin/characters/${characterId}/publish`, headers: adminHeaders });
    assert.equal(published.statusCode, 201, published.body);
    assert.equal(Value.Check(CharacterVersionSchema, published.json()), true, 'published response must pass the same schema used by the frontend');
    const publishedDetail = (await app.inject({ method: 'GET', url: `/api/v1/admin/characters/${characterId}`, headers: adminHeaders })).json();
    assert.equal(Value.Check(CharacterDetailSchema, publishedDetail), true);
  } finally { await app.close(); database.close(); }
});

test('sniffed image previews are viewable, cancellable and importable again', async () => {
  const { app, database } = await setup();
  try {
    const png = await readFile(defaultAvatarPath);
    const payload = { dataBase64: (png as unknown as { toString(encoding: string): string }).toString('base64'), mimeType: 'application/octet-stream', filename: 'reference.png' };
    const preview = (await app.inject({ method: 'POST', url: '/api/v1/admin/characters/import-sessions', headers: adminHeaders, payload })).json();
    const cover = await app.inject({ method: 'GET', url: `/api/v1/admin/characters/import-sessions/${preview.id}/cover`, headers: adminHeaders });
    assert.equal(cover.statusCode, 200, cover.body);
    assert.match(cover.headers['content-type'] as string, /image\/png/);
    assert.equal(createHash('sha256').update(cover.rawPayload).digest('hex'), createHash('sha256').update(png).digest('hex'));
    await app.inject({ method: 'DELETE', url: `/api/v1/admin/characters/import-sessions/${preview.id}`, headers: adminHeaders });
    const second = (await app.inject({ method: 'POST', url: '/api/v1/admin/characters/import-sessions', headers: adminHeaders, payload })).json();
    assert.notEqual(second.id, preview.id);
    assert.equal(second.status, 'ready');
    assert.equal((database.connection.prepare('SELECT COUNT(*) AS count FROM character_profiles').get() as { count: number }).count, 0);
  } finally { await app.close(); database.close(); }
});

test('visual prompts select one outfit and retain legacy descriptions and long dialogue blocks', () => {
  const visual = { description: '银发', outfits: ['旅行装', '晚礼服'], defaultOutfitId: '晚礼服', stableFeatures: ['蓝眼'] };
  const selected = buildCharacterVisualPrompt(visual);
  assert.match(selected, /晚礼服/); assert.doesNotMatch(selected, /旅行装/);
  const override = buildCharacterVisualPrompt(visual, '生日会围裙');
  assert.match(override, /生日会围裙/); assert.doesNotMatch(override, /晚礼服|旅行装/);
  const draft = normalizeCharacterDraft({ appearance: '旧格式蓝发', speech: { examples: ['对话'.repeat(900)] } });
  assert.equal(draft.appearance.description, '旧格式蓝发');
  assert.equal(draft.speech.examples[0].length, 1800);
});

test('published avatars stay frozen and enter the activity package when adding to an existing activity', async () => {
  const { app, database } = await setup();
  try {
    const created = (await app.inject({ method: 'POST', url: '/api/v1/admin/characters', headers: adminHeaders, payload: { displayName: '头像快照', draft: { displayName: '头像快照', identity: '完整人设' } } })).json();
    const png = await readFile(defaultAvatarPath);
    const payload = { dataUrl: `data:image/png;base64,${(png as unknown as { toString(encoding: string): string }).toString('base64')}`, filename: 'avatar.png', kind: 'avatar' };
    const firstAvatar = (await app.inject({ method: 'POST', url: `/api/v1/admin/characters/${created.id}/assets`, headers: adminHeaders, payload })).json();
    await app.inject({ method: 'POST', url: `/api/v1/admin/characters/${created.id}/publish`, headers: adminHeaders });
    await app.inject({ method: 'POST', url: `/api/v1/admin/characters/${created.id}/assets`, headers: adminHeaders, payload });
    const snapshotResponse = await app.inject({ method: 'GET', url: `/api/v1/admin/activities/characters/${created.id}/snapshot?version=1`, headers: adminHeaders });
    assert.equal(snapshotResponse.statusCode, 200, snapshotResponse.body);
    const actor = snapshotResponse.json();
    assert.equal(actor.persona.identity, '完整人设');
    assert.equal(actor.avatarAssetId, firstAvatar.id);
    const createdActivity = (await app.inject({ method: 'POST', url: '/api/v1/admin/activities', headers: adminHeaders, payload: { title: '已有活动' } })).json();
    const activityId = createdActivity.activity.id;
    const document = { ...createdActivity.draft.document, actors: [actor] };
    const saved = await app.inject({ method: 'PUT', url: `/api/v1/admin/activities/${activityId}/draft`, headers: adminHeaders, payload: { document, expectedDraftVersion: createdActivity.draftVersion } });
    assert.equal(saved.statusCode, 200, saved.body);
    const committed = await app.inject({ method: 'POST', url: `/api/v1/admin/activities/${activityId}/commit`, headers: adminHeaders, payload: { expectedHeadVersion: createdActivity.headVersion, expectedDraftVersion: saved.json().draftVersion } });
    assert.equal(committed.statusCode, 200, committed.body);
    const key = committed.json().draft.document.actors[0].avatarAssetKey;
    assert.ok(key);
    const asset = database.connection.prepare('SELECT ar.app_id,aa.hash FROM activity_assets aa JOIN artifacts ar ON ar.id=aa.artifact_id WHERE aa.activity_id=? AND aa.asset_key=?').get(activityId, key) as { app_id: string; hash: string };
    assert.equal(asset.app_id, 'activities');
    assert.equal(asset.hash, createHash('sha256').update(png).digest('hex'));
  } finally { await app.close(); database.close(); }
});
