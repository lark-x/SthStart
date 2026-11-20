import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { registerLinsheBridgeRoutes, resolveLinsheImageUrl } from './linshe-bridge.js';
import { ServiceDatabase, nowIso } from './database.js';
import { readConfig } from './config.js';
import { hashToken } from './security.js';
import { publishCharacterSnapshot } from './characters/snapshots.js';

async function fixture(t: test.TestContext, fetcher: typeof fetch) {
  const database = new ServiceDatabase();
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'sthstart-linshe-bridge-'));
  const config = { ...readConfig({}), artifactDirectory };
  const app = Fastify(); registerLinsheBridgeRoutes(app, config, database, fetcher);
  t.after(async () => { await app.close(); database.close(); await rm(artifactDirectory, { recursive: true, force: true }); });
  return { database, config, app };
}

function profile(database: ServiceDatabase, originType: 'original' | 'ip' = 'original') {
  const now = nowIso();
  database.connection.prepare(`INSERT INTO character_profiles(id,slug,display_name,draft_json,tags_json,archived,created_at,updated_at,draft_revision)
    VALUES ('char-1','char-1','测试角色',?,'[]',0,?,?,1)`)
    .run(JSON.stringify({ schemaVersion: 2, displayName: '测试角色', englishName: 'Test', originType, work: '测试作品', personaText: '稳定人设', appearance: { baseText: '银发', defaultOutfitText: '白衣' } }), now, now);
}

test('bridge rejects pull, never auto-publishes original drafts, sends the exact published stage on update', async t => {
  const calls: Array<{ url: string; body: any }> = [];
  const { app, database } = await fixture(t, (async (url, init) => { calls.push({ url: String(url), body: JSON.parse(String(init?.body)) }); return Response.json({ id: 7 }); }) as typeof fetch);
  profile(database);
  const push = () => app.inject({ method: 'POST', url: '/api/v1/admin/linshe-bridge/sync-character', payload: { characterId: 'char-1', action: 'push_to_linshe' } });
  const rejected = await app.inject({ method: 'POST', url: '/api/v1/admin/linshe-bridge/sync-character', payload: { characterId: 'char-1', action: 'pull_from_linshe' } });
  assert.equal(rejected.statusCode, 400);
  const missing = await push(); assert.equal(missing.statusCode, 409); assert.equal(missing.json().error, 'published_stage_required'); assert.equal(calls.length, 0);
  publishCharacterSnapshot(database, 'char-1', { allowIncomplete: true });
  database.connection.prepare('UPDATE character_profiles SET draft_revision=2,draft_json=json_set(draft_json,\'$.personaText\',\'未发布草稿\') WHERE id=\'char-1\'').run();
  assert.equal((await push()).statusCode, 200); assert.equal(calls[0].body.version, 1);
  const now = nowIso(); database.connection.prepare("INSERT INTO managed_apps VALUES('linshe','邻舍','hash','[]',1,?,?)").run(now, now);
  database.connection.prepare("INSERT INTO app_character_links(app_id,character_id,local_id,source_version,imported_hash,created_at,updated_at) VALUES ('linshe','char-1','7',1,'hash',?,?)").run(now, now);
  assert.equal((await push()).statusCode, 200); assert.equal(calls[1].body.version, 1); assert.match(calls[1].url, /\/7\/update-public$/);
  assert.equal(database.connection.prepare('SELECT COUNT(*) AS c FROM character_versions').get()?.c, 1);
});

test('non-original push captures the latest revision without repeated publication', async t => {
  const { app, database } = await fixture(t, (async () => Response.json({ id: 7 })) as typeof fetch); profile(database, 'ip');
  for (let i = 0; i < 2; i++) assert.equal((await app.inject({ method: 'POST', url: '/api/v1/admin/linshe-bridge/sync-character', payload: { characterId: 'char-1', action: 'push_to_linshe' } })).statusCode, 200);
  assert.equal(database.connection.prepare('SELECT COUNT(*) AS c FROM character_versions').get()?.c, 1);
});

test('image return authenticates Linshe, rejects foreign URLs and redirects, retries, deduplicates and leaves static RP untouched', async t => {
  let calls = 0; let fail = true;
  const { app, database } = await fixture(t, (async (_url, init) => {
    calls++; assert.equal(init?.redirect, 'error');
    if (fail) throw new Error('temporarily unavailable');
    return new Response(Buffer.from('image-test'), { headers: { 'Content-Type': 'image/png' } });
  }) as typeof fetch);
  profile(database);
  const now = nowIso();
  database.connection.prepare("INSERT INTO managed_apps VALUES('linshe','邻舍',?,'[\"artifact\"]',1,?,?)").run(hashToken('test-gallery-token'), now, now);
  database.connection.prepare("INSERT INTO managed_apps VALUES('other','其他',?,'[\"artifact\"]',1,?,?)").run(hashToken('test-other-token'), now, now);
  const payload = { sourceImageId: 'installation:image-1', imageUrl: '/images/chat/generated.png', characterId: 'char-1', title: '聊天生成图' };
  const send = (body = payload, token = 'test-gallery-token') => app.inject({ method: 'POST', url: '/api/v1/linshe/gallery-images', headers: { authorization: `Bearer ${token}` }, payload: body });
  assert.equal((await send(payload, 'bad-token')).statusCode, 401); assert.equal((await send(payload, 'test-other-token')).statusCode, 403);
  for (const imageUrl of ['http://example.test/images/chat/a.png', '/api/config', '/images/chat/a.png?url=http://example.test', '/images/chat/%2e%2e/config.png']) assert.equal((await send({ ...payload, imageUrl })).statusCode, 400, imageUrl);
  assert.equal(calls, 0);
  const before = database.connection.prepare("SELECT * FROM character_profiles WHERE id='char-1'").get();
  assert.equal((await send()).statusCode, 502); fail = false;
  const [created, duplicate] = await Promise.all([send(), send()]);
  assert.equal(created.statusCode, 201); assert.equal(duplicate.statusCode, 200); assert.equal(created.json().sharedAssetId, duplicate.json().sharedAssetId);
  assert.equal((await send()).json().created, false); assert.equal(calls, 2);
  assert.equal(database.connection.prepare('SELECT COUNT(*) AS c FROM shared_assets').get()?.c, 1);
  assert.equal(database.connection.prepare('SELECT COUNT(*) AS c FROM character_assets').get()?.c, 0);
  assert.deepEqual(database.connection.prepare("SELECT * FROM character_profiles WHERE id='char-1'").get(), before);
});

test('image URL resolver accepts only the configured Linshe image origin and generated image paths', () => {
  const base = 'http://127.0.0.1:3099';
  assert.equal(resolveLinsheImageUrl('/images/chat/a.png', base), base + '/images/chat/a.png');
  assert.equal(resolveLinsheImageUrl('/api/images/artifacts/asset-1', base), base + '/api/images/artifacts/asset-1');
  assert.throws(() => resolveLinsheImageUrl('http://127.0.0.1:8188/images/chat/a.png', base));
});

test('manual character gallery import advances non-original authority but keeps original drafts unpublished', async t => {
  const { app, database } = await fixture(t, (async () => new Response(Buffer.from('image'), { headers: { 'Content-Type': 'image/png' } })) as typeof fetch);
  profile(database, 'ip');
  const now = nowIso(); database.connection.prepare("INSERT INTO managed_apps VALUES('characters','角色库','characters-test','[\"artifact\"]',1,?,?)").run(now, now);
  const request = () => app.inject({ method: 'POST', url: '/api/v1/admin/linshe-bridge/import-gallery-image', payload: { imageUrl: '/images/chat/a.png', target: 'character', characterId: 'char-1', title: '服饰参考', setAsActive: 'avatar' } });
  const first = await request(); assert.equal(first.statusCode, 201, first.body);
  const published = database.connection.prepare("SELECT draft_revision,latest_version,avatar_asset_id FROM character_profiles WHERE id='char-1'").get();
  assert.equal(published?.draft_revision, 2); assert.equal(published?.latest_version, 1); assert.ok(published?.avatar_asset_id);
  database.connection.prepare("UPDATE character_profiles SET draft_json=json_set(draft_json,'$.originType','original') WHERE id='char-1'").run();
  assert.equal((await request()).statusCode, 201);
  const original = database.connection.prepare("SELECT draft_revision,latest_version FROM character_profiles WHERE id='char-1'").get();
  assert.equal(original?.draft_revision, 3); assert.equal(original?.latest_version, 1);
  const rejected = await app.inject({ method: 'POST', url: '/api/v1/admin/linshe-bridge/import-gallery-image', payload: { imageUrl: 'http://example.test/a.png', target: 'shared' } });
  assert.equal(rejected.statusCode, 400);
});
