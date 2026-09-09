import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServiceDatabase } from './database.js';
import { createService } from './server.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { normalizeCharacterDraft } from './characters/draft.js';

const headers = { 'x-sthstart-admin-token': 'character-organization-test-token-12345' };
async function setup(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'character-organization-'));
  const database = new ServiceDatabase();
  const { app } = await createService({ config: readConfig({ STHSTART_ADMIN_TOKEN: headers['x-sthstart-admin-token'], STHSTART_ARTIFACT_DIR: directory }), database, secrets: new SecretStore({}) });
  t.after(async () => { await app.close(); database.close(); await rm(directory, { recursive: true, force: true }); });
  const browse = async (filter: Record<string, unknown> = {}) => {
    const response = await app.inject({ url: `/api/v1/admin/characters/browse?${new URLSearchParams({ filter: JSON.stringify(filter) })}`, headers });
    assert.equal(response.statusCode, 200, response.body); return response.json();
  };
  const create = async (name: string, work = '', tags: string[] = []) => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/admin/characters', headers, payload: { displayName: name, draft: { displayName: name, work, identity: '用于测试的身份', aliases: ['别名_' + name] }, tags } });
    assert.equal(response.statusCode, 201, response.body); return response.json();
  };
  const edit = async (body: Record<string, unknown>) => {
    const response = await app.inject({ method: 'PUT', url: '/api/v1/admin/characters/organization', headers, payload: body });
    assert.equal(response.statusCode, 200, response.body); return response.json();
  };
  return { app, database, browse, create, edit };
}

test('browse paginates beyond 500, searches aliases literally, and applies work aliases across all pages', async t => {
  const { database, browse } = await setup(t);
  const insert = database.connection.prepare("INSERT INTO character_profiles(id,slug,display_name,draft_json,tags_json,archived,created_at,updated_at,draft_revision) VALUES (?,?,?,?,?,0,'now','now',1)");
  database.transaction(() => {
    for (let i = 0; i < 507; i++) {
      const id = String(i).padStart(4, '0');
      insert.run(id, id, `角色${id}`, JSON.stringify(normalizeCharacterDraft({ displayName: `角色${id}`, aliases: [`别名_${id}`], work: i === 506 ? '星铁' : '原神' })), JSON.stringify([i === 506 ? '尾页标签' : '普通']));
    }
  });
  assert.equal((await browse()).total, 507);
  const pages = await Promise.all([1, 2, 3, 4, 5, 6].map(page => browse({ page, pageSize: 100 })));
  assert.equal(new Set(pages.flatMap(p => p.items.map((c: { id: string }) => c.id))).size, 507);
  assert.equal((await browse({ q: '别名_0506' })).items[0].id, '0506');
  assert.equal((await browse({ q: '%' })).total, 0);
  assert.equal((await browse({ q: 'Honkai: Star Rail' })).total, 1);
  assert.equal((await browse({ works: ['崩坏：星穹铁道'] })).total, 1);
  assert.equal((await browse()).facets.tags.includes('尾页标签'), true);
  assert.equal((await browse({ excludeIds: ['0506'], works: ['星铁'] })).total, 0);
});

test('shared filters combine tags, groups, favorite, classification and preserve published snapshots', async t => {
  const { app, browse, create, edit } = await setup(t);
  const one = await create('一号', '原神', ['沉稳', '主持']);
  const two = await create('二号', '', ['沉稳']);
  const published = await app.inject({ method: 'POST', url: `/api/v1/admin/characters/${one.id}/publish`, headers, payload: { expectedDraftRevision: one.draftRevision } });
  assert.equal(published.statusCode, 201, published.body);
  await edit({ ids: [one.id, two.id], work: '星铁', tags: ['摄影'], groups: ['生日会'], favorite: true, fillEmpty: true });
  assert.equal((await browse({ works: ['原神'], favorite: true, groups: ['生日会'], tags: ['主持', '摄影'], tagMode: 'all' })).total, 1);
  assert.equal((await browse({ tags: ['主持', '不存在'], tagMode: 'any' })).total, 1);
  assert.equal((await browse({ tags: ['主持', '不存在'], tagMode: 'all' })).total, 0);
  assert.equal((await browse({ works: ['星铁'] })).items[0].draft.work, '崩坏：星穹铁道');
  assert.equal((await browse({ mediaType: '游戏' })).total, 2);
  assert.equal((await browse({ mediaType: '小说' })).total, 0);
  assert.equal((await browse({ reference: 'no', appearance: 'no' })).total, 2);
  const detail = await app.inject({ url: `/api/v1/admin/characters/${one.id}`, headers });
  assert.equal(detail.json().versions[0].data.work, '原神');
  await edit({ ids: [two.id], work: '新作品', fillEmpty: false, replaceTags: true, tags: [], replaceGroups: true, groups: [] });
  assert.equal((await browse({ groups: ['生日会'] })).total, 1);
  assert.equal((await browse({ unclassified: 'tags' })).total, 1);
  const invalid = await app.inject({ method: 'PUT', url: '/api/v1/admin/characters/organization', headers, payload: { ids: [one.id, 'missing'], work: '不应写入' } });
  assert.equal(invalid.statusCode, 400);
  assert.equal((await browse({ works: ['原神'] })).total, 1);
});

test('work directory updates support aliases and reject ambiguous registered aliases', async t => {
  const { app, create, browse } = await setup(t);
  await create('原创测试', '我的动画');
  const saved = await app.inject({ method: 'PUT', url: '/api/v1/admin/characters/works', headers, payload: { name: '我的动画', aliases: ['My Anime'], mediaType: '动画' } });
  assert.equal(saved.statusCode, 200);
  assert.equal((await browse({ q: 'My Anime', mediaType: '动画' })).total, 1);
  const conflict = await app.inject({ method: 'PUT', url: '/api/v1/admin/characters/works', headers, payload: { name: '另一作品', aliases: ['星铁'], mediaType: '游戏' } });
  assert.equal(conflict.statusCode, 409);
  const invalid = await app.inject({ url: '/api/v1/admin/characters/browse?filter=%7B%22works%22%3A1%7D', headers });
  assert.equal(invalid.statusCode, 400);
});

test('import metadata commits atomically with source tags and identifies exact/name duplicates; retry is idempotent', async t => {
  const { app, browse, edit } = await setup(t);
  const card = { name: '批量角色', description: '完整描述', tags: ['原卡标签'] };
  const previewResponse = await app.inject({ method: 'POST', url: '/api/v1/admin/characters/import-sessions', headers, payload: { card } });
  assert.equal(previewResponse.statusCode, 201, previewResponse.body);
  const preview = previewResponse.json();
  assert.deepEqual(preview.candidate.tags, ['原卡标签']);
  assert.equal((await browse()).total, 0);
  const patched = await app.inject({ method: 'PATCH', url: `/api/v1/admin/characters/import-sessions/${preview.id}`, headers, payload: { expectedPreviewRevision: 1, candidatePatch: { draft: { work: '星铁', originType: 'ip' }, tags: ['原卡标签', '主持'], organization: { favorite: false, groups: ['生日会'], interpretation: '原作向' } } } });
  assert.equal(patched.statusCode, 200, patched.body);
  const session = patched.json();
  assert.equal(session.candidate.draft.work, '崩坏：星穹铁道');
  const request = { method: 'POST' as const, url: `/api/v1/admin/characters/import-sessions/${session.id}/commit`, headers: { ...headers, 'idempotency-key': 'batch-test-1' }, payload: { expectedPreviewRevision: session.previewRevision, previewHash: session.previewHash } };
  const committed = await app.inject(request);
  assert.equal(committed.statusCode, 201, committed.body);
  const repeated = await app.inject(request);
  assert.equal(repeated.json().characterId, committed.json().characterId);
  assert.equal((await browse()).total, 1);
  const character = (await browse({ works: ['星铁'], groups: ['生日会'], tags: ['原卡标签', '主持'], tagMode: 'all' })).items[0];
  assert.equal(character.organization.interpretation, '原作向');
  await edit({ ids: [character.id], favorite: true, groups: ['旧分组'] });
  const duplicatePreview = await app.inject({ method: 'POST', url: '/api/v1/admin/characters/import-sessions', headers, payload: { card } });
  const duplicate = duplicatePreview.json();
  const matches = await app.inject({ url: `/api/v1/admin/characters/import-sessions/${duplicate.id}/duplicates`, headers });
  assert.equal(matches.json().items.some((item: { kind: string }) => item.kind === 'exact'), true);
  const updated = await app.inject({ method: 'PATCH', url: `/api/v1/admin/characters/import-sessions/${duplicate.id}`, headers, payload: { expectedPreviewRevision: 1, candidatePatch: { organization: { favorite: false, groups: ['新分组'], interpretation: '' } } } });
  const updateCommit = await app.inject({ method: 'POST', url: `/api/v1/admin/characters/import-sessions/${duplicate.id}/commit`, headers: { ...headers, 'idempotency-key': 'batch-test-2' }, payload: { expectedPreviewRevision: updated.json().previewRevision, targetCharacterId: character.id, baseDraftRevision: character.draftRevision } });
  assert.equal(updateCommit.statusCode, 201, updateCommit.body);
  const saved = (await browse()).items[0];
  assert.equal(saved.organization.favorite, true);
  assert.deepEqual(saved.organization.groups, ['生日会', '旧分组', '新分组']);
  assert.equal(saved.organization.interpretation, '原作向');
  assert.equal(saved.draft.work, '崩坏：星穹铁道');
});
