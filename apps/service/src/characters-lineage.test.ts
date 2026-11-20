import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ServiceDatabase, nowIso } from './database.js';
import { createService } from './server.js';
import { readConfig } from './config.js';
import { hashToken, SecretStore } from './security.js';
import { buildImageContext } from './generation/image-context.js';
import { Value } from '@sinclair/typebox/value';
import { CharacterVersionSchema, CharacterAssetListResponseSchema, resolveCharacterVersionSelection } from '@sthstart/contracts';
import { createActorSnapshotFromCharacter } from './activities/characters.js';
import { generationExecutionsFor } from './generation.js';

const ADMIN_TOKEN = 'characters-lineage-admin-token-0123456789abcdef';
const adminHeaders = { 'x-sthstart-admin-token': ADMIN_TOKEN };
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function setup(t: test.TestContext, fetcher?: typeof fetch) {
  const directory = await mkdtemp(join(tmpdir(), 'characters-lineage-'));
  const database = new ServiceDatabase();
  const { app } = await createService({
    config: readConfig({ STHSTART_ADMIN_TOKEN: ADMIN_TOKEN, STHSTART_ARTIFACT_DIR: directory }),
    database,
    secrets: new SecretStore({}),
    ...(fetcher ? { fetcher } : {}),
  });
  t.after(async () => {
    await app.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  const call = async (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    url: string,
    payload?: Record<string, unknown> | string | Buffer,
  ) => app.inject({
    method,
    url,
    headers: adminHeaders,
    ...(payload === undefined ? {} : { payload }),
  });

  return { app, database, call };
}

async function saveWork(
  call: Awaited<ReturnType<typeof setup>>['call'],
  body: Record<string, unknown>,
) {
  const response = await call('PUT', '/api/v1/admin/characters/works', body);
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}

async function browse(
  call: Awaited<ReturnType<typeof setup>>['call'],
  filter: Record<string, unknown>,
) {
  const response = await call(
    'GET',
    `/api/v1/admin/characters/browse?${new URLSearchParams({ filter: JSON.stringify(filter) })}`,
  );
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}

async function createCharacter(
  call: Awaited<ReturnType<typeof setup>>['call'],
  body: Record<string, unknown>,
) {
  const response = await call('POST', '/api/v1/admin/characters', body);
  assert.equal(response.statusCode, 201, response.body);
  return response.json();
}

async function uploadCharacterAsset(
  call: Awaited<ReturnType<typeof setup>>['call'],
  characterId: string,
  body: Record<string, unknown>,
) {
  const response = await call('POST', `/api/v1/admin/characters/${characterId}/assets`, {
    dataUrl: PNG_DATA_URL,
    ...body,
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json();
}

async function getCharacter(
  call: Awaited<ReturnType<typeof setup>>['call'],
  characterId: string,
) {
  const response = await call('GET', `/api/v1/admin/characters/${characterId}`);
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}

async function forkDerivative(
  call: Awaited<ReturnType<typeof setup>>['call'],
  characterId: string,
  body: Record<string, unknown>,
) {
  const response = await call('POST', `/api/v1/admin/characters/${characterId}/fork-derivative`, body);
  assert.equal(response.statusCode, 201, response.body);
  return response.json();
}

const v2Draft = (name: string, work: string, originType: 'ip' | 'derivative' | 'original') => ({
  schemaVersion: 2,
  displayName: name,
  englishName: name,
  aliases: [`${name}别名`],
  originType,
  work,
  summary: `${name}摘要`,
  personaText: `${name}的人设正文`,
  speechText: '语气平稳，措辞清楚。',
  dialogueExamples: [`日常：我是${name}。`],
  behaviorRules: '保持角色认知边界。',
  appearance: {
    baseText: `${name}的稳定外貌`,
    defaultOutfitText: `${name}的默认服装`,
  },
});

test('work hierarchy drives the work directory counts and story world setup sync', async t => {
  const { database, call } = await setup(t);
  const canonWork = '晨曦纪元';
  const derivativeWork = '晨曦纪元：镜海同人';
  const originalWork = '灰烬航路';

  const canon = await saveWork(call, {
    name: canonWork,
    aliases: ['Dawn Era'],
    mediaType: '游戏',
    workNature: 'canon',
    summary: '原作时间线',
  });
  assert.equal(canon.workNature, 'canon');
  assert.equal(canon.parentWork, null);

  const derivative = await saveWork(call, {
    name: derivativeWork,
    aliases: ['镜海 AU'],
    mediaType: '小说',
    workNature: 'derivative',
    parentWork: canonWork,
    summary: '镜海平行世界同人',
  });
  assert.equal(derivative.workNature, 'derivative');
  assert.equal(derivative.parentWork, canonWork);

  const original = await saveWork(call, {
    name: originalWork,
    mediaType: '游戏',
    workNature: 'original',
    summary: '完全原创的作品',
  });
  assert.equal(original.workNature, 'original');
  assert.equal(original.parentWork, null);

  await createCharacter(call, {
    displayName: '晨曦主角',
    draft: v2Draft('晨曦主角', canonWork, 'ip'),
  });
  await createCharacter(call, {
    displayName: '灰烬旅人',
    draft: v2Draft('灰烬旅人', originalWork, 'original'),
  });

  const directory = await browse(call, {});
  const works = new Map<string, Record<string, unknown>>(
    directory.facets.works.map((item: Record<string, unknown>) => [String(item.name), item]),
  );
  assert.equal(works.get(canonWork)?.workNature, 'canon');
  assert.equal(works.get(canonWork)?.parentWork, null);
  assert.equal(works.get(derivativeWork)?.workNature, 'derivative');
  assert.equal(works.get(derivativeWork)?.parentWork, canonWork);
  assert.equal(works.get(originalWork)?.workNature, 'original');
  assert.equal(works.get(originalWork)?.parentWork, null);

  assert.equal((await browse(call, { works: [canonWork] })).total, 1);
  assert.equal((await browse(call, { works: [derivativeWork] })).total, 0);
  assert.equal((await browse(call, { works: [originalWork] })).total, 1);

  const setupResponse = await call('POST', '/api/v1/admin/story-worlds/setups', {
    title: '镜海回声',
    idempotencyKey: 'characters-lineage-setup-derivative',
    workNature: 'derivative',
    parentWork: canonWork,
  });
  assert.equal(setupResponse.statusCode, 201, setupResponse.body);
  const worldSetup = setupResponse.json();
  assert.equal(worldSetup.workNature, 'derivative');
  assert.equal(worldSetup.parentWork, canonWork);

  const synced = database.connection.prepare(
    'SELECT work_nature,parent_work,world_id FROM character_works WHERE name=?',
  ).get(worldSetup.title) as { work_nature: string; parent_work: string; world_id: string };
  assert.equal(synced.work_nature, 'derivative');
  assert.equal(synced.parent_work, canonWork);
  assert.equal(synced.world_id, worldSetup.id);

  const refreshedWorks = new Map<string, Record<string, unknown>>(
    (await browse(call, {})).facets.works.map((item: Record<string, unknown>) => [String(item.name), item]),
  );
  assert.equal(refreshedWorks.get(worldSetup.title)?.workNature, 'derivative');
  assert.equal(refreshedWorks.get(worldSetup.title)?.parentWork, canonWork);
  assert.equal((await browse(call, { works: [worldSetup.title] })).total, 0);
});

test('fork-derivative shares artifacts zero-copy, isolates later edits and chains to the family root', async t => {
  const { database, call } = await setup(t);
  const canonWork = '晨曦纪元';
  const derivativeWork = '晨曦纪元：镜海同人';
  await saveWork(call, { name: canonWork, workNature: 'canon' });
  await saveWork(call, { name: derivativeWork, workNature: 'derivative', parentWork: canonWork });

  const source = await createCharacter(call, {
    displayName: '晨曦主角',
    tags: ['主角'],
    variants: [{ id: 'stage-1', name: '学院阶段', variantKind: 'stage', summary: '初入学园' }],
    draft: v2Draft('晨曦主角', canonWork, 'ip'),
  });
  await uploadCharacterAsset(call, source.id, {
    filename: 'avatar.png',
    kind: 'avatar',
    category: 'avatar',
    title: '主角头像',
  });
  const costume = await uploadCharacterAsset(call, source.id, {
    filename: 'costume.png',
    kind: 'reference',
    category: 'costume',
    title: '星辉礼服',
    purposes: ['outfit', 'identity'],
    metadata: { skinName: '星辉礼服', outfitDescription: '深蓝星纹长礼服与银冠' },
  });
  assert.ok(costume.reference, 'costume upload must register a visual reference');
  assert.deepEqual(costume.reference.purposes, ['outfit', 'identity']);

  const sourceAssets = database.connection.prepare(
    'SELECT id,artifact_id,kind,category FROM character_assets WHERE character_id=? ORDER BY created_at ASC',
  ).all(source.id) as Array<{ id: string; artifact_id: string; kind: string; category: string }>;
  const sourceRefs = database.connection.prepare(`
    SELECT r.id,a.artifact_id FROM character_visual_references r
    JOIN character_assets a ON a.id=r.asset_id
    WHERE r.character_id=? ORDER BY r.created_at ASC
  `).all(source.id) as Array<{ id: string; artifact_id: string }>;
  assert.equal(sourceAssets.length, 2);
  assert.equal(sourceRefs.length, 1);

  const shared = await forkDerivative(call, source.id, {
    targetWork: derivativeWork,
    parentWork: canonWork,
    displayName: '镜海同人主角',
    shareAssets: true,
  });
  assert.deepEqual(database.connection.prepare('PRAGMA foreign_key_check').all(), []);
  const derivative = shared.character;
  assert.equal(derivative.draft.originType, 'derivative');
  assert.equal(derivative.parentCharacterId, source.id);
  assert.equal(derivative.familyRootId, source.id);
  assert.ok(derivative.latestVersion >= 1);
  assert.equal(derivative.variants.length, 1);
  assert.equal(shared.work.workNature, 'derivative');
  assert.equal(shared.work.parentWork, canonWork);

  const derivativeAssets = database.connection.prepare(
    'SELECT id,artifact_id,kind,category FROM character_assets WHERE character_id=? ORDER BY created_at ASC',
  ).all(derivative.id) as Array<{ id: string; artifact_id: string; kind: string; category: string }>;
  assert.equal(derivativeAssets.length, sourceAssets.length);
  assert.deepEqual(
    new Set(derivativeAssets.map(asset => asset.artifact_id)),
    new Set(sourceAssets.map(asset => asset.artifact_id)),
  );
  assert.ok(derivativeAssets.every(asset => sourceAssets.every(original => original.id !== asset.id)));

  const derivativeRefs = database.connection.prepare(`
    SELECT r.id,a.artifact_id FROM character_visual_references r
    JOIN character_assets a ON a.id=r.asset_id
    WHERE r.character_id=? ORDER BY r.created_at ASC
  `).all(derivative.id) as Array<{ id: string; artifact_id: string }>;
  assert.equal(derivativeRefs.length, sourceRefs.length);
  assert.deepEqual(
    new Set(derivativeRefs.map(reference => reference.artifact_id)),
    new Set(sourceRefs.map(reference => reference.artifact_id)),
  );

  const derivativeCostume = derivativeAssets.find(asset => asset.category === 'costume');
  assert.ok(derivativeCostume);
  const deleted = await call(
    'DELETE',
    `/api/v1/admin/characters/${derivative.id}/assets/${derivativeCostume.id}`,
  );
  assert.equal(deleted.statusCode, 200, deleted.body);
  assert.equal(
    (database.connection.prepare('SELECT COUNT(*) AS count FROM character_assets WHERE character_id=?')
      .get(source.id) as { count: number }).count,
    sourceAssets.length,
  );
  assert.equal(
    (database.connection.prepare('SELECT COUNT(*) AS count FROM character_visual_references WHERE character_id=?')
      .get(source.id) as { count: number }).count,
    sourceRefs.length,
  );
  assert.equal(
    (database.connection.prepare('SELECT file_status FROM artifacts WHERE id=?')
      .get(derivativeCostume.artifact_id) as { file_status: string }).file_status,
    'ready',
    'the parent artifact must remain readable after the derivative asset is deleted',
  );

  const parentBefore = await getCharacter(call, source.id);
  const savedDerivative = await call('PUT', `/api/v1/admin/characters/${derivative.id}`, {
    draft: { ...derivative.draft, summary: '同人线独立修改' },
  });
  assert.equal(savedDerivative.statusCode, 200, savedDerivative.body);
  assert.equal(savedDerivative.json().latestVersion, 3);
  const parentAfter = await getCharacter(call, source.id);
  assert.equal(parentAfter.draft.summary, parentBefore.draft.summary);
  assert.equal(parentAfter.latestVersion, parentBefore.latestVersion);
  assert.equal(parentAfter.versions.length, parentBefore.versions.length);

  const unshared = await forkDerivative(call, source.id, {
    targetWork: derivativeWork,
    parentWork: canonWork,
    displayName: '无共享同人',
    shareAssets: false,
  });
  assert.equal(unshared.character.parentCharacterId, source.id);
  assert.equal(unshared.character.familyRootId, source.id);
  assert.equal(unshared.character.latestVersion, 1);
  assert.equal(unshared.character.avatarAssetId, null);
  assert.equal(unshared.character.variants.length, 0);
  assert.equal(
    (database.connection.prepare('SELECT COUNT(*) AS count FROM character_assets WHERE character_id=?')
      .get(unshared.character.id) as { count: number }).count,
    0,
  );
  assert.equal(
    (database.connection.prepare('SELECT COUNT(*) AS count FROM character_visual_references WHERE character_id=?')
      .get(unshared.character.id) as { count: number }).count,
    0,
  );

  const chained = await forkDerivative(call, derivative.id, {
    targetWork: derivativeWork,
    parentWork: canonWork,
    displayName: '镜海二代同人',
    shareAssets: false,
  });
  assert.equal(chained.character.parentCharacterId, source.id);
  assert.equal(chained.character.familyRootId, source.id);
  assert.equal(chained.character.latestVersion, 1);
});

test('browse collapses derivative families and applies hierarchy and origin filters', async t => {
  const { call } = await setup(t);
  const canonWork = '晨曦纪元';
  const derivativeWork = '晨曦纪元：镜海同人';
  const originalWork = '灰烬航路';
  await saveWork(call, { name: canonWork, workNature: 'canon' });
  await saveWork(call, { name: derivativeWork, workNature: 'derivative', parentWork: canonWork });
  await saveWork(call, { name: originalWork, workNature: 'original' });

  const root = await createCharacter(call, {
    displayName: '晨曦主角',
    draft: v2Draft('晨曦主角', canonWork, 'ip'),
  });
  const firstFork = await forkDerivative(call, root.id, {
    targetWork: derivativeWork,
    parentWork: canonWork,
    displayName: '镜海同人一',
    shareAssets: false,
  });
  const secondFork = await forkDerivative(call, firstFork.character.id, {
    targetWork: derivativeWork,
    parentWork: canonWork,
    displayName: '镜海同人二',
    shareAssets: false,
  });
  const original = await createCharacter(call, {
    displayName: '灰烬旅人',
    draft: v2Draft('灰烬旅人', originalWork, 'original'),
  });

  const collapsed = await browse(call, { collapseDerivatives: true });
  assert.equal(collapsed.total, 2);
  const collapsedRoot = collapsed.items.find((item: { id: string }) => item.id === root.id);
  assert.ok(collapsedRoot);
  assert.equal(collapsedRoot.familyRootId, root.id);
  assert.equal(collapsedRoot.derivativeCount, 2);
  const familyMemberIds = collapsedRoot.familyMembers.map((member: { id: string }) => member.id);
  assert.equal(familyMemberIds[0], root.id);
  assert.deepEqual(
    new Set(familyMemberIds),
    new Set([root.id, firstFork.character.id, secondFork.character.id]),
  );
  assert.equal(
    collapsed.items.some((item: { id: string }) => item.id === firstFork.character.id),
    false,
  );
  assert.equal(collapsed.items.some((item: { id: string }) => item.id === original.id), true);

  const expanded = await browse(call, { collapseDerivatives: false });
  assert.equal(expanded.total, 4);
  assert.deepEqual(
    new Set(expanded.items.map((item: { id: string }) => item.id)),
    new Set([root.id, firstFork.character.id, secondFork.character.id, original.id]),
  );

  const canonItems = await browse(call, { workNature: 'canon' });
  assert.equal(canonItems.total, 1);
  assert.equal(canonItems.items[0].id, root.id);

  const derivativeItems = await browse(call, { workNature: 'derivative' });
  assert.equal(derivativeItems.total, 2);
  assert.deepEqual(
    new Set(derivativeItems.items.map((item: { id: string }) => item.id)),
    new Set([firstFork.character.id, secondFork.character.id]),
  );

  const originalItems = await browse(call, { workNature: 'original' });
  assert.equal(originalItems.total, 1);
  assert.equal(originalItems.items[0].id, original.id);

  const canonSelection = await browse(call, { works: [canonWork] });
  assert.equal(canonSelection.total, 1);
  assert.equal(canonSelection.items[0].id, root.id);

  const parentWorkItems = await browse(call, { parentWork: canonWork });
  assert.equal(parentWorkItems.total, 2);
  assert.ok(parentWorkItems.items.every((item: { draft: { originType: string }; parentCharacterId: string }) =>
    item.draft.originType === 'derivative' && item.parentCharacterId === root.id));

  const originItems = await browse(call, { originType: 'derivative' });
  assert.equal(originItems.total, 2);
  assert.ok(originItems.items.every((item: { draft: { originType: string } }) =>
    item.draft.originType === 'derivative'));
});

test('ip and derivative characters auto-publish snapshots while explicit stage labels stay manual', async t => {
  const { call } = await setup(t);
  const canonWork = '晨曦纪元';
  const derivativeWork = '晨曦纪元：镜海同人';
  const originalWork = '灰烬航路';
  await saveWork(call, { name: canonWork, workNature: 'canon' });
  await saveWork(call, { name: derivativeWork, workNature: 'derivative', parentWork: canonWork });
  await saveWork(call, { name: originalWork, workNature: 'original' });

  const ip = await createCharacter(call, {
    displayName: '晨曦主角',
    draft: v2Draft('晨曦主角', canonWork, 'ip'),
  });
  assert.equal(ip.latestVersion, 1);
  assert.equal(ip.draftRevision, 1);
  const ipDetail = await getCharacter(call, ip.id);
  assert.equal(ipDetail.versions.length, 1);
  assert.equal(ipDetail.versions[0].version, 1);

  const updatedIp = await call('PUT', `/api/v1/admin/characters/${ip.id}`, {
    draft: { ...ip.draft, summary: '原作线更新摘要' },
  });
  assert.equal(updatedIp.statusCode, 200, updatedIp.body);
  assert.equal(updatedIp.json().latestVersion, 2);
  assert.equal(updatedIp.json().draftRevision, 2);
  const updatedIpDetail = await getCharacter(call, ip.id);
  assert.equal(updatedIpDetail.versions.length, 2);
  assert.equal(updatedIpDetail.versions[0].version, 2);
  assert.equal(updatedIpDetail.versions[0].data.summary, '原作线更新摘要');

  const derivative = await forkDerivative(call, ip.id, {
    targetWork: derivativeWork,
    parentWork: canonWork,
    displayName: '镜海同人主角',
    shareAssets: false,
  });
  assert.equal(derivative.character.latestVersion, 1);
  const derivativeDetail = await getCharacter(call, derivative.character.id);
  assert.equal(derivativeDetail.versions.length, 1);
  const savedDerivative = await call('PUT', `/api/v1/admin/characters/${derivative.character.id}`, {
    draft: { ...derivative.character.draft, summary: '同人线更新摘要' },
  });
  assert.equal(savedDerivative.statusCode, 200, savedDerivative.body);
  assert.equal(savedDerivative.json().latestVersion, 2);
  const savedDerivativeDetail = await getCharacter(call, derivative.character.id);
  assert.equal(savedDerivativeDetail.versions.length, 2);
  assert.equal(savedDerivativeDetail.versions[0].data.summary, '同人线更新摘要');

  const original = await createCharacter(call, {
    displayName: '灰烬旅人',
    draft: v2Draft('灰烬旅人', originalWork, 'original'),
  });
  assert.equal(original.latestVersion, null);
  assert.equal((await getCharacter(call, original.id)).versions.length, 0);

  const savedOriginal = await call('PUT', `/api/v1/admin/characters/${original.id}`, {
    draft: { ...original.draft, summary: '原创线更新摘要' },
  });
  assert.equal(savedOriginal.statusCode, 200, savedOriginal.body);
  assert.equal(savedOriginal.json().latestVersion, null);
  assert.equal(savedOriginal.json().draftRevision, 2);
  assert.equal((await getCharacter(call, original.id)).versions.length, 0);

  const versionLabel = '前期学院篇';
  const published = await call('POST', `/api/v1/admin/characters/${original.id}/publish`, {
    versionLabel,
    expectedDraftRevision: savedOriginal.json().draftRevision,
  });
  assert.equal(published.statusCode, 201, published.body);
  assert.equal(published.json().version, 1);
  assert.equal(published.json().versionLabel, versionLabel);
  assert.equal(published.json().draftRevision, 2);
  const publishedDetail = await getCharacter(call, original.id);
  assert.equal(publishedDetail.latestVersion, 1);
  assert.equal(publishedDetail.versions[0].versionLabel, versionLabel);
  assert.equal(publishedDetail.versions[0].data.summary, '原创线更新摘要');
});

test('Linshe Way A rejects pulls and requires an explicit original stage with frozen costumes', async t => {
  const requests: Array<{ url: string; method?: string; body?: string }> = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return new Response(JSON.stringify({ id: 42 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const { database, call } = await setup(t, fetcher);
  const work = '灰烬航路';
  await saveWork(call, { name: work, workNature: 'original' });

  const character = await createCharacter(call, {
    displayName: '原创主角',
    draft: v2Draft('原创主角', work, 'original'),
  });
  const skins = [
    ['星夜礼服', '深蓝色星纹长礼服与银冠'],
    ['晨光便装', '米白色学院便装与短披肩'],
  ];
  for (const [index, [skinName, outfitDescription]] of skins.entries()) {
    const asset = await uploadCharacterAsset(call, character.id, {
      filename: `skin-${index}.png`,
      kind: 'reference',
      category: 'costume',
      title: skinName,
      metadata: { skinName, outfitDescription },
    });
    assert.equal(asset.metadata.skinName, skinName);
    assert.equal(asset.metadata.outfitDescription, outfitDescription);
  }

  const updated = await call('PUT', `/api/v1/admin/characters/${character.id}`, {
    draft: { ...character.draft, summary: '推送前的最新草稿' },
  });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().draftRevision, 4);
  assert.equal(updated.json().latestVersion, null);
  requests.length = 0;

  const pull = await call('POST', '/api/v1/admin/linshe-bridge/sync-character', {
    characterId: character.id,
    action: 'pull_from_linshe',
  });
  assert.equal(pull.statusCode, 400);
  assert.equal(pull.json().error, 'unsupported_action');
  assert.equal(requests.length, 0, 'a rejected pull must not contact Linshe');

  const unpublished = await call('POST', '/api/v1/admin/linshe-bridge/sync-character', {
    characterId: character.id,
    action: 'push_to_linshe',
  });
  assert.equal(unpublished.statusCode, 409, unpublished.body);
  assert.equal(requests.length, 0);
  const stage = await call('POST', `/api/v1/admin/characters/${character.id}/publish`, { expectedDraftRevision: updated.json().draftRevision });
  assert.equal(stage.statusCode, 201, stage.body);
  const push = await call('POST', '/api/v1/admin/linshe-bridge/sync-character', {
    characterId: character.id,
    action: 'push_to_linshe',
  });
  assert.equal(push.statusCode, 200, push.body);
  assert.equal(push.json().action, 'push_to_linshe');
  assert.equal(push.json().version, 1);
  assert.equal(push.json().localId, '42');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.match(requests[0].url, /\/api\/characters\/import-public$/);
  assert.deepEqual(JSON.parse(requests[0].body ?? '{}'), {
    characterId: character.id,
    version: 1,
  });

  const versionRow = database.connection.prepare(`
    SELECT version,draft_revision,version_label,data_json,compiled_linshe_prompt
    FROM character_versions WHERE character_id=? ORDER BY version DESC LIMIT 1
  `).get(character.id) as {
    version: number;
    draft_revision: number;
    version_label: string;
    data_json: string;
    compiled_linshe_prompt: string;
  };
  assert.equal(versionRow.version, 1);
  assert.equal(versionRow.draft_revision, 4);
  assert.equal(versionRow.version_label, '');
  assert.equal(JSON.parse(versionRow.data_json).summary, '推送前的最新草稿');

  const prompt = versionRow.compiled_linshe_prompt;
  const appearanceIndex = prompt.lastIndexOf('## 你的外观');
  const appearanceSection = '\n\n## 你的外观\n';
  const skinSectionIndex = prompt.indexOf('## 可选皮肤与装扮参考');
  assert.ok(appearanceIndex >= 0, 'the compiled prompt must keep the final appearance section');
  assert.equal(prompt.slice(appearanceIndex).startsWith('## 你的外观'), true);
  assert.ok(skinSectionIndex >= 0);
  assert.ok(skinSectionIndex < appearanceIndex);
  for (const [skinName, outfitDescription] of skins) {
    assert.ok(prompt.includes(skinName) && prompt.includes(outfitDescription));
    assert.ok(prompt.indexOf(skinName) < appearanceIndex);
    assert.equal(prompt.slice(appearanceIndex).includes(skinName), false);
    assert.ok(prompt.indexOf(outfitDescription) < appearanceIndex);
  }
  const costumeBlockStart = prompt.indexOf('## 可选皮肤与装扮参考');
  const costumeBlockEnd = prompt.indexOf(appearanceSection);
  assert.ok(costumeBlockStart >= 0 && costumeBlockEnd > costumeBlockStart);
  assert.equal(prompt.slice(costumeBlockEnd).includes('星夜礼服'), false);
});

test('assets invalidate non-original snapshots while original stage revision guards freeze complete evidence', async t => {
  const { database, call } = await setup(t);
  const ip = await createCharacter(call, { draft: v2Draft('资产原作', '原作', 'ip') });
  const uploaded = await uploadCharacterAsset(call, ip.id, { kind: 'reference', category: 'costume', title: '旧皮肤', metadata: { skinName: '旧皮肤', outfitDescription: '旧服装', loreStory: '旧服装完整故事' } });
  let detail = await getCharacter(call, ip.id);
  assert.equal(detail.draftRevision, 2);
  assert.equal(detail.latestVersion, 2);
  assert.match(detail.versions[0].compiledLinshePrompt, /旧服装完整故事/);
  assert.equal(detail.versions[0].assets[0].id, uploaded.id);
  const frozenUrl = detail.versions[0].assets[0].url.replace('/api/admin/', '/api/v1/admin/');
  const edited = await call('PATCH', `/api/v1/admin/characters/${ip.id}/assets/${uploaded.id}`, { metadata: { skinName: '新皮肤', outfitDescription: '新服装', loreStory: '新故事' } });
  assert.equal(edited.statusCode, 200, edited.body);
  detail = await getCharacter(call, ip.id);
  assert.equal(detail.draftRevision, 3);
  assert.equal(detail.latestVersion, 3);
  assert.match(detail.versions[0].compiledLinshePrompt, /新故事/);
  assert.match(detail.versions[1].compiledLinshePrompt, /旧服装完整故事/);
  assert.equal((await call('DELETE', `/api/v1/admin/characters/${ip.id}/assets/${uploaded.id}`)).statusCode, 200);
  detail = await getCharacter(call, ip.id);
  assert.equal(detail.latestVersion, 4);
  assert.equal(detail.versions[0].assets.length, 0);
  assert.doesNotMatch(detail.versions[0].compiledLinshePrompt, /新故事/);
  assert.equal((await call('GET', frozenUrl)).statusCode, 200, 'published artifact stays readable after the live asset is removed');
  const repeated = await call('POST', `/api/v1/admin/characters/${ip.id}/publish`, {});
  assert.equal(repeated.statusCode, 201);
  assert.equal(repeated.json().version, 4, 'consumer publication is idempotent at the same revision');

  const original = await createCharacter(call, { draft: v2Draft('原创阶段', '原创', 'original'), variants: [{ id: 'stage', name: '登顶阶段', appearance: { baseText: '成熟外貌', defaultOutfitText: '登顶礼服' } }] });
  await uploadCharacterAsset(call, original.id, { kind: 'reference', category: 'costume', metadata: { skinName: '典礼', loreStory: '典礼完整故事' } });
  assert.equal((await call('POST', `/api/v1/admin/characters/${original.id}/publish`, {})).statusCode, 409);
  assert.equal((await call('POST', `/api/v1/admin/characters/${original.id}/publish`, { expectedDraftRevision: 1 })).statusCode, 409);
  assert.equal((await getCharacter(call, original.id)).latestVersion, null);
  const stage = await call('POST', `/api/v1/admin/characters/${original.id}/publish`, { expectedDraftRevision: 2, versionLabel: '登顶' });
  assert.equal(stage.statusCode, 201, stage.body);
  assert.equal(Value.Check(CharacterVersionSchema, stage.json()), true);
  assert.equal(stage.json().variants[0].name, '登顶阶段');
  assert.equal(stage.json().visualReferences.length, 1);
  assert.equal(stage.json().assets[0].metadata.loreStory, '典礼完整故事');
  assert.deepEqual(database.connection.prepare('PRAGMA foreign_key_check').all(), []);
});

test('upstream persists image-free skin text, full source evidence and failed-image warnings', async t => {
  const { database, call } = await setup(t, (async () => new Response('missing', { status: 404 })) as typeof fetch);
  const character = await createCharacter(call, { draft: v2Draft('上游角色', '原作', 'ip') });
  const story = '完整来源原文。'.repeat(4000);
  const skin = { id: 'skin', name: '文字礼服', classification: 'skin', selected: true, outfitDescription: '银线礼服', loreStory: '服装的完整故事', source: 'https://source.test/wiki' };
  const response = await call('POST', `/api/v1/admin/characters/${character.id}/apply-upstream`, {
    draft: character.draft, expectedDraftRevision: character.draftRevision,
    selectedSkins: [skin, { ...skin, id: 'failed', name: '下载失败礼服', portraitUrl: 'https://missing.test/skin.png' }],
    selectedVariants: [{ ...skin, id: 'form', name: '新形态', classification: 'variant', variantKind: 'sp', avatarUrl: 'https://missing.test/avatar.png', portraitUrl: 'https://missing.test/portrait.png' }],
    sources: [{ title: '完整来源', url: 'https://source.test/wiki', excerpt: '摘要', sourceType: 'bwiki', provider: 'bwiki', externalId: 'page-1', rawText: story, rawPayload: { content: story, pageId: 1 }, contentHash: 'upstream-content-hash', evidenceKind: 'fulltext', retrievedAt: '2026-11-16T00:00:00.000Z' }],
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().createdSkinCount, 2);
  assert.equal(response.json().createdVariantCount, 1);
  assert.equal(response.json().warnings.length, 3);
  const assetsResponse = await call('GET', `/api/v1/admin/characters/${character.id}/assets`);
  assert.equal(Value.Check(CharacterAssetListResponseSchema, assetsResponse.json()), true);
  assert.equal(assetsResponse.json().items.length, 2);
  for (const asset of assetsResponse.json().items) {
    assert.equal(asset.url, null);
    assert.equal(asset.artifactId, null);
    assert.equal(asset.metadata.loreStory, skin.loreStory);
  }
  const detail = await getCharacter(call, character.id);
  assert.match(detail.versions[0].compiledLinshePrompt, /服装的完整故事/);
  assert.ok(detail.versions[0].variants[0].personaText.includes(character.draft.personaText));
  assert.ok(detail.versions[0].variants[0].personaText.includes(skin.loreStory));
  const source = detail.sources[0];
  assert.equal(source.providerId, 'bwiki');
  assert.equal(source.externalId, 'page-1');
  assert.ok(source.sourceSnapshotId && source.payloadHash);
  const raw = await call('GET', `/api/v1/admin/characters/${character.id}/source-snapshots/${source.sourceSnapshotId}/raw`);
  assert.equal(raw.statusCode, 200, raw.body);
  assert.equal(raw.json().rawText, story);
  assert.equal(raw.json().rawPayload.content, story);
  const provenance = database.connection.prepare('SELECT source_pointer,source_snapshot_id FROM character_field_provenance WHERE character_id=?').get(character.id) as { source_pointer: string; source_snapshot_id: string };
  assert.equal(provenance.source_pointer, '/sources/0');
  assert.equal(provenance.source_snapshot_id, source.sourceSnapshotId);
});

test('imported IP cards auto-snapshot and generation context follows the selected form', async t => {
  const { database, call } = await setup(t);
  const previewResponse = await call('POST', '/api/v1/admin/characters/import-sessions', { card: { spec: 'chara_card_v2', data: { name: '导入原作', description: '卡片完整人设' } } });
  assert.equal(previewResponse.statusCode, 201, previewResponse.body);
  const preview = previewResponse.json();
  const patch = await call('PATCH', `/api/v1/admin/characters/import-sessions/${preview.id}`, { expectedPreviewRevision: 1, candidatePatch: { draft: { originType: 'ip', work: '原作' } } });
  assert.equal(patch.statusCode, 200, patch.body);
  const commit = await call('POST', `/api/v1/admin/characters/import-sessions/${preview.id}/commit`, { expectedPreviewRevision: 2, previewHash: patch.json().previewHash, idempotencyKey: 'imported-ip-behavior' });
  assert.equal(commit.statusCode, 201, commit.body);
  assert.equal(commit.json().version, 1);
  const detail = await getCharacter(call, commit.json().characterId);
  assert.equal(detail.latestVersion, 1);
  assert.equal(detail.versions[0].data.originType, 'ip');
  assert.equal(detail.versions[0].draftRevision, detail.draftRevision);
  const form = await call('PUT', `/api/v1/admin/characters/${detail.id}`, { variants: [{ id: 'form', name: '觉醒', appearance: { baseText: '觉醒瞳色', defaultOutfitText: '觉醒长袍' } }] });
  assert.equal(form.statusCode, 200, form.body);
  const main = buildImageContext(database, { characters: [{ characterId: detail.id }] });
  const variant = buildImageContext(database, { characters: [{ characterId: detail.id, variantId: 'form' }] });
  assert.match(variant.text, /觉醒瞳色/);
  assert.match(variant.text, /觉醒长袍/);
  assert.notEqual(variant.hash, main.hash);
  assert.throws(() => buildImageContext(database, { characters: [{ characterId: detail.id, variantId: 'missing' }] }), /形态/);
});

test('avatar tasks persist selected form and apply the image to that form without replacing the main avatar', async t => {
  const { database, call } = await setup(t, (async () => new Response('mock generation rejected', { status: 400 })) as typeof fetch);
  const character = await createCharacter(call, { draft: v2Draft('形态生成', '原作', 'ip'), variants: [{ id: 'awakened', name: '觉醒', appearance: { baseText: '紫色觉醒瞳孔', defaultOutfitText: '银白觉醒长袍' } }] });
  const mainAvatar = await uploadCharacterAsset(call, character.id, { kind: 'avatar', category: 'avatar' });
  const now = nowIso();
  database.connection.prepare(`INSERT INTO generation_engines(id,name,kind,base_url,enabled,concurrency_limit,created_at,updated_at)
    VALUES ('variant-engine','Variant test','comfyui','https://generation.invalid',1,1,?,?)`).run(now, now);
  database.connection.prepare(`INSERT INTO generation_workflows(id,name,description,engine_kind,category,latest_version,created_at,updated_at)
    VALUES ('variant-workflow','Variant workflow','','comfyui','image',1,?,?)`).run(now, now);
  database.connection.prepare(`INSERT INTO generation_workflow_versions(workflow_id,version,engine_id,input_schema_json,node_bindings_json,output_declarations_json,definition_json,is_published,created_at)
    VALUES ('variant-workflow',1,'variant-engine',?,?,?, ?,1,?)`).run(
    JSON.stringify({ prompt: { type: 'string', semantic: 'prompt' } }), JSON.stringify({ prompt: ['1', 'inputs', 'text'] }), JSON.stringify(['2']),
    JSON.stringify({ '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } }, '2': { class_type: 'SaveImage', inputs: {} } }), now,
  );
  database.connection.prepare(`INSERT INTO app_generation_assignments(app_id,purpose,workflow_id,workflow_version,engine_id,updated_at)
    VALUES ('characters','character-avatar','variant-workflow',1,'variant-engine',?)`).run(now);
  const createdTask = await call('POST', `/api/v1/admin/characters/${character.id}/generate-avatar`, { variantId: 'awakened', idempotencyKey: 'variant-task-behavior' });
  assert.equal(createdTask.statusCode, 202, createdTask.body);
  const task = createdTask.json();
  assert.equal(task.context.character.variantId, 'awakened');
  const taskRow = database.connection.prepare('SELECT request_params_json FROM generation_tasks WHERE id=?').get(task.id) as { request_params_json: string };
  const params = JSON.parse(taskRow.request_params_json);
  assert.equal(params.inputs.variantId, 'awakened');
  assert.match(params.inputs.prompt, /紫色觉醒瞳孔/);
  assert.match(params.inputs.prompt, /银白觉醒长袍/);
  await Promise.all([...generationExecutionsFor(database)]);
  const artifact = database.connection.prepare('SELECT artifact_id FROM character_assets WHERE id=?').get(mainAvatar.id) as { artifact_id: string };
  // Use a local existing fixture as the completed output; no image provider runs in this test.
  database.connection.prepare("UPDATE generation_tasks SET status='succeeded' WHERE id=?").run(task.id);
  database.connection.prepare('INSERT INTO generation_task_artifacts(task_id,artifact_id,output_name,sort_order,created_at) VALUES (?,?,?,?,?)').run(task.id, artifact.artifact_id, 'default', 0, now);
  const applied = await call('POST', `/api/v1/admin/characters/${character.id}/generation-tasks/${task.id}/apply-avatar`, {});
  assert.equal(applied.statusCode, 201, applied.body);
  const detail = await getCharacter(call, character.id);
  assert.equal(detail.avatarAssetId, mainAvatar.id);
  assert.equal(detail.variants[0].avatarAssetId, applied.json().id);
  assert.equal(detail.versions[0].variants[0].avatarAssetId, applied.json().id);
  const deleted = await call('PUT', `/api/v1/admin/characters/${character.id}`, { variants: [] });
  assert.equal(deleted.statusCode, 200, deleted.body);
  const blocked = await call('POST', `/api/v1/admin/characters/${character.id}/generation-tasks/${task.id}/apply-avatar`, {});
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal((await getCharacter(call, character.id)).avatarAssetId, mainAvatar.id);
});

test('upstream network waits cannot overwrite a newer draft and remove staged assets on conflict', async t => {
  let concurrentEdit: (() => Promise<void>) | undefined;
  const { database, call } = await setup(t, (async () => {
    await concurrentEdit?.();
    concurrentEdit = undefined;
    return new Response(Buffer.from(PNG_DATA_URL.split(',')[1], 'base64'), { headers: { 'content-type': 'image/png' } });
  }) as typeof fetch);
  const character = await createCharacter(call, { draft: v2Draft('并发上游', '原作', 'ip') });
  concurrentEdit = async () => {
    const response = await call('PUT', `/api/v1/admin/characters/${character.id}`, { draft: { ...character.draft, summary: '下载期间用户刚修改的摘要' } });
    assert.equal(response.statusCode, 200, response.body);
  };
  const response = await call('POST', `/api/v1/admin/characters/${character.id}/apply-upstream`, {
    draft: { ...character.draft, summary: '已经过期的上游摘要' }, expectedDraftRevision: 1,
    selectedAssets: [{ kind: 'avatar', url: 'https://source.invalid/avatar.png', setAsActive: true }],
  });
  assert.equal(response.statusCode, 409, response.body);
  const detail = await getCharacter(call, character.id);
  assert.equal(detail.draft.summary, '下载期间用户刚修改的摘要');
  assert.equal(detail.avatarAssetId, null);
  assert.equal(detail.latestVersion, 2);
  assert.equal(database.connection.prepare('SELECT COUNT(*) count FROM character_assets WHERE character_id=?').get(character.id)!.count, 0);
  assert.equal(database.connection.prepare("SELECT COUNT(*) count FROM artifact_references WHERE ref_type='character-asset'").get()!.count, 0);
});

test('public consumers receive only explicit original stages and their frozen avatar and portrait', async t => {
  const { database, call, app } = await setup(t);
  const token = 'local-public-stage-test';
  const now = nowIso();
  database.connection.prepare(`INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
    VALUES ('public-stage-test','Public stage test',?,'["persona"]',1,?,?)`).run(hashToken(token), now, now);
  const original = await createCharacter(call, { draft: v2Draft('公开阶段', '原创', 'original') });
  const avatar = await uploadCharacterAsset(call, original.id, { kind: 'avatar' });
  const portrait = await uploadCharacterAsset(call, original.id, { kind: 'portrait' });
  const stage = await call('POST', `/api/v1/admin/characters/${original.id}/publish`, { expectedDraftRevision: 3 });
  assert.equal(stage.statusCode, 201, stage.body);
  await call('PUT', `/api/v1/admin/characters/${original.id}`, { draft: { ...original.draft, displayName: '未发布的新名称', summary: '未发布的新摘要' } });
  await uploadCharacterAsset(call, original.id, { kind: 'avatar' });
  const remote = await app.inject({ method: 'GET', url: `/api/v1/characters/${original.id}`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(remote.statusCode, 200, remote.body);
  assert.equal(remote.json().display_name, '公开阶段');
  assert.equal(remote.json().avatar_asset_id, avatar.id);
  assert.equal(remote.json().portrait_asset_id, portrait.id);
  assert.match(remote.json().avatar_url, /\/versions\/1\/assets\//);
  assert.match(remote.json().portrait_url, /\/versions\/1\/assets\//);
  assert.equal(remote.json().version.assets[0].url.startsWith('/api/v1/characters/'), true);
  const directory = await app.inject({ method: 'GET', url: '/api/v1/characters', headers: { authorization: `Bearer ${token}` } });
  assert.equal(directory.statusCode, 200, directory.body);
  assert.equal(directory.json().items[0].displayName, '公开阶段');
  assert.equal(directory.json().items[0].draft.summary, original.draft.summary);
  assert.equal(directory.json().items[0].avatarAssetId, avatar.id);
});

test('fork refuses to reclassify a canon work and keeps the chosen derivative as the clone source', async t => {
  const { call } = await setup(t);
  await saveWork(call, { name: '原作', workNature: 'canon' });
  const root = await createCharacter(call, { draft: v2Draft('根角色', '原作', 'ip') });
  const invalid = await call('POST', `/api/v1/admin/characters/${root.id}/fork-derivative`, { targetWork: '原作', parentWork: '原作' });
  assert.equal(invalid.statusCode, 409, invalid.body);
  const first = await forkDerivative(call, root.id, { targetWork: '平行线', parentWork: '原作', summary: '第一派生独有摘要', shareAssets: false });
  const chained = await forkDerivative(call, first.character.id, { targetWork: '平行线', parentWork: '原作', shareAssets: false });
  assert.equal(chained.character.draft.summary, '第一派生独有摘要');
  assert.equal(chained.character.familyRootId, root.id);
});

test('upstream form evidence supplements the complete persona and missing fields inherit through published selection', async t => {
  const { call, database } = await setup(t);
  const character = await createCharacter(call, { draft: v2Draft('装甲继承', '原作', 'ip') });
  const proposal = { id: 'unknown', name: '待考装甲', classification: 'variant', variantKind: 'form', selected: true, outfitDescription: '', loreStory: '', source: '公开资料' };
  const applied = await call('POST', `/api/v1/admin/characters/${character.id}/apply-upstream`, {
    expectedDraftRevision: 1, draft: character.draft, selectedVariants: [
      proposal,
      { ...proposal, id: 'story', name: '纪事装甲', loreStory: '这段经历只描述装甲的由来，不能代替角色基础身份。' },
      { ...proposal, id: 'outfit', name: '银翼装甲', outfitDescription: '银白色翼状肩甲与轻便战袍。' },
    ],
  });
  assert.equal(applied.statusCode, 200, applied.body);
  assert.equal(applied.json().warnings.length, 3);
  const detail = await getCharacter(call, character.id);
  const version = detail.versions[0];
  const unknown = version.variants.find((variant: { name: string }) => variant.name === '待考装甲');
  const withStory = version.variants.find((variant: { name: string }) => variant.name === '纪事装甲');
  const withOutfit = version.variants.find((variant: { name: string }) => variant.name === '银翼装甲');
  assert.equal(Object.hasOwn(unknown, 'personaText'), false);
  assert.equal(Object.hasOwn(unknown, 'appearance'), false);
  assert.equal(Object.hasOwn(unknown, 'summary'), false);
  assert.equal(Object.hasOwn(withStory, 'appearance'), false);
  assert.equal(Object.hasOwn(withOutfit, 'personaText'), false);
  const inherited = resolveCharacterVersionSelection(version, { variantId: unknown.id });
  assert.equal(inherited.draft.personaText, character.draft.personaText);
  assert.equal(inherited.draft.summary, character.draft.summary);
  assert.deepEqual(inherited.appearance, character.draft.appearance);
  const story = resolveCharacterVersionSelection(version, { variantId: withStory.id });
  assert.ok(story.draft.personaText.startsWith(character.draft.personaText));
  assert.match(story.prompt, /这段经历只描述装甲的由来/);
  assert.deepEqual(story.appearance, character.draft.appearance);
  const outfit = resolveCharacterVersionSelection(version, { variantId: withOutfit.id });
  assert.equal(outfit.draft.personaText, character.draft.personaText);
  assert.equal(outfit.appearance.baseText, character.draft.appearance.baseText);
  assert.equal(outfit.appearance.defaultOutfitText, '银白色翼状肩甲与轻便战袍。');
  const actor = createActorSnapshotFromCharacter(database, character.id, { sourceVersion: version.version, sourceVariantId: withStory.id })!;
  assert.equal(actor.persona.personaText, story.draft.personaText);
  assert.equal(actor.outfitDescription, character.draft.appearance.defaultOutfitText);
  const visualContext = buildImageContext(database, { characters: [{ characterId: character.id, variantId: unknown.id }] });
  assert.ok(visualContext.text.includes(character.draft.appearance.baseText));
  assert.ok(visualContext.text.includes(character.draft.appearance.defaultOutfitText));

  // Manual explicit clears are still complete overrides, including empty strings.
  const cleared = await call('PUT', `/api/v1/admin/characters/${character.id}`, {
    expectedDraftRevision: detail.draftRevision,
    variants: [{ ...withStory, personaText: '', summary: '', appearance: { baseText: '', defaultOutfitText: '' } }],
  });
  assert.equal(cleared.statusCode, 200, cleared.body);
  const manualVersion = (await getCharacter(call, character.id)).versions[0];
  const manual = resolveCharacterVersionSelection(manualVersion, { variantId: withStory.id });
  assert.equal(manual.draft.personaText, '');
  assert.equal(manual.draft.summary, '');
  assert.deepEqual(manual.appearance, { baseText: '', defaultOutfitText: '' });
  const repeated = await call('POST', `/api/v1/admin/characters/${character.id}/apply-upstream`, {
    expectedDraftRevision: cleared.json().draftRevision, draft: cleared.json().draft,
    selectedVariants: [{ ...proposal, name: withStory.name }],
  });
  assert.equal(repeated.statusCode, 200, repeated.body);
  const preserved = (await getCharacter(call, character.id)).versions[0];
  assert.equal(resolveCharacterVersionSelection(preserved, { variantId: withStory.id }).draft.personaText, '', 'missing upstream evidence preserves an existing manual clear');
  assert.ok(resolveCharacterVersionSelection(version, { variantId: withStory.id }).draft.personaText.startsWith(character.draft.personaText), 'earlier published selection remains complete');
});
