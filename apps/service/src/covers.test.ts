import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  EntityCoverSchema, RecentWorkResponseSchema, STORY_WORLD_METADATA_KEYS, StoryProjectSchema, StoryWorldSchema,
  type StoryWorld, type WorldDefinition,
} from '@sthstart/contracts';
import { readConfig } from './config.js';
import { COVER_APP_ID, COVER_REF_TYPE } from './covers.js';
import { ServiceDatabase, nowIso } from './database.js';
import { SecretStore } from './security.js';
import { createService } from './server.js';

const adminToken = 'admin-cover-test-token-1234567890';
const headers = { 'x-sthstart-admin-token': adminToken };
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

async function fixture() {
  const database = new ServiceDatabase(':memory:');
  const artifactDirectory = await mkdtemp(resolve(tmpdir(), 'sthstart-covers-'));
  const config = readConfig({ STHSTART_ADMIN_TOKEN: adminToken, STHSTART_ARTIFACT_DIR: artifactDirectory });
  const { app } = await createService({ config, database, secrets: new SecretStore({}), fetcher: async () => { throw new Error('no upstream'); } });
  const now = nowIso();
  database.connection.prepare("INSERT INTO activities(id,title,type,created_at,updated_at) VALUES ('act-1','海边制作','daily',?,?)").run(now, now);
  const world = {
    title: '海雾中的末班船', summary: '', timeLabel: '', locations: [{ id: 'l', name: '灯塔', description: '' }],
    actors: [{ id: 'a', name: '林舟', role: 'main', locationId: 'l', goals: [], characterId: null, characterVersion: null, background: '', personality: '', speechStyle: '', appearance: '', referenceArtifactIds: [] }],
    sources: [], lockedFacts: [], models: { action: null, adjudication: null, narration: null }, visualStyle: '',
  };
  database.connection.prepare('INSERT INTO sw_worlds(id,revision,data_json,created_at,updated_at) VALUES (?,?,?,?,?)')
    .run('world-1', 1, JSON.stringify({ ...world, id: 'world-1', revision: 1, createdAt: now, updatedAt: now }), now, now);
  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/story/projects', headers, payload: { title: '封面项目' } });
  assert.equal(created.statusCode, 201);
  return { app, database, projectId: created.json().id as string };
}

async function upload(app: Awaited<ReturnType<typeof fixture>>['app'], contentType = 'image/png', payload = png) {
  return app.inject({
    method: 'POST', url: '/api/v1/admin/covers/uploads',
    headers: { ...headers, 'content-type': contentType, 'x-artifact-original-name': encodeURIComponent('封面.png') },
    payload,
  });
}

const refs = (database: ServiceDatabase) => database.connection
  .prepare('SELECT artifact_id AS artifactId, app_id AS appId, ref_id AS refId FROM artifact_references WHERE ref_type=? ORDER BY ref_id')
  .all(COVER_REF_TYPE) as Array<{ artifactId: string; appId: string; refId: string }>;

test('covers upload into the central media store and can be set, replaced and cleared for all three entity types', async () => {
  const { app, database, projectId } = await fixture();
  try {
    const first = await upload(app);
    assert.equal(first.statusCode, 201);
    const firstId = first.json().artifactId as string;
    const artifact = database.connection.prepare('SELECT app_id,content_type,byte_size FROM artifacts WHERE id=?').get(firstId) as Record<string, unknown>;
    assert.deepEqual({ ...artifact }, { app_id: COVER_APP_ID, content_type: 'image/png', byte_size: png.length });

    for (const [type, id] of [['story-project', projectId], ['story-world', 'world-1'], ['activity', 'act-1']] as const) {
      const set = await app.inject({ method: 'PUT', url: `/api/v1/admin/covers/${type}/${id}`, headers, payload: { artifactId: firstId } });
      assert.equal(set.statusCode, 200, set.body);
      assert.equal(Value.Check(EntityCoverSchema, set.json()), true);
      assert.equal(set.json().coverArtifactId, firstId);
      const read = await app.inject({ method: 'GET', url: `/api/v1/admin/covers/${type}/${id}`, headers });
      assert.equal(read.json().coverArtifactId, firstId);
    }
    assert.deepEqual(refs(database).map(ref => ref.refId), [`activity:act-1`, `story-project:${projectId}`, 'story-world:world-1']);
    assert.ok(refs(database).every(ref => ref.appId === COVER_APP_ID && ref.artifactId === firstId));

    // 实体读取接口带出封面字段，并仍通过各自的响应 Schema。
    const project = (await app.inject({ method: 'GET', url: `/api/v1/admin/story/projects/${projectId}`, headers })).json();
    assert.equal(Value.Check(StoryProjectSchema, project), true);
    assert.equal(project.coverArtifactId, firstId);
    const recent = (await app.inject({ method: 'GET', url: '/api/v1/admin/workspace/recent?limit=20', headers })).json();
    assert.equal(Value.Check(RecentWorkResponseSchema, recent), true);
    const images = Object.fromEntries(recent.items.map((item: { kind: string; imageArtifactId?: string | null }) => [item.kind, item.imageArtifactId]));
    assert.equal(images.story, firstId); assert.equal(images.world, firstId); assert.equal(images.activity, firstId);

    const second = (await upload(app, 'image/webp')).json().artifactId as string;
    const replaced = await app.inject({ method: 'PUT', url: `/api/v1/admin/covers/activity/act-1`, headers, payload: { artifactId: second } });
    assert.equal(replaced.json().coverArtifactId, second);
    assert.equal(refs(database).find(ref => ref.refId === 'activity:act-1')?.artifactId, second);
    assert.equal(refs(database).filter(ref => ref.refId === 'activity:act-1').length, 1, 'replacing keeps a single reference');

    const cleared = await app.inject({ method: 'PUT', url: `/api/v1/admin/covers/activity/act-1`, headers, payload: { artifactId: null } });
    assert.equal(cleared.json().coverArtifactId, null);
    assert.equal(refs(database).some(ref => ref.refId === 'activity:act-1'), false);
    assert.equal(database.connection.prepare('SELECT COUNT(*) n FROM artifacts WHERE id=?').get(second)!.n, 1, 'clearing keeps the media file');
  } finally { await app.close(); }
});

test('cover validation rejects missing entities, missing or non-image media and oversized uploads', async () => {
  const { app, database, projectId } = await fixture();
  try {
    assert.equal((await upload(app, 'text/plain', Buffer.from('hello'))).statusCode, 415);
    const tooLarge = await app.inject({
      method: 'POST', url: '/api/v1/admin/covers/uploads',
      headers: { ...headers, 'content-type': 'image/png', 'content-length': String(13 * 1024 * 1024) }, payload: png,
    });
    assert.ok([413, 400].includes(tooLarge.statusCode), `oversized upload rejected (${tooLarge.statusCode})`);

    const missingEntity = await app.inject({ method: 'PUT', url: '/api/v1/admin/covers/story-project/nope', headers, payload: { artifactId: null } });
    assert.equal(missingEntity.statusCode, 404); assert.equal(missingEntity.json().error, 'cover_entity_not_found');
    const missingArtifact = await app.inject({ method: 'PUT', url: `/api/v1/admin/covers/story-project/${projectId}`, headers, payload: { artifactId: 'nope' } });
    assert.equal(missingArtifact.statusCode, 404); assert.equal(missingArtifact.json().error, 'cover_artifact_not_found');
    const badType = await app.inject({ method: 'PUT', url: '/api/v1/admin/covers/user/x', headers, payload: { artifactId: null } });
    assert.equal(badType.statusCode, 400);
    const missingField = await app.inject({ method: 'PUT', url: `/api/v1/admin/covers/story-project/${projectId}`, headers, payload: {} });
    assert.equal(missingField.statusCode, 400, 'clearing must be explicit');

    const now = nowIso();
    database.connection.prepare("INSERT INTO artifacts(id,app_id,local_path,content_type,byte_size,created_at) VALUES ('doc',?,?, 'application/pdf', 10, ?)")
      .run(COVER_APP_ID, resolve(tmpdir(), 'cover-doc.pdf'), now);
    const notImage = await app.inject({ method: 'PUT', url: `/api/v1/admin/covers/story-project/${projectId}`, headers, payload: { artifactId: 'doc' } });
    assert.equal(notImage.statusCode, 422); assert.equal(notImage.json().error, 'cover_artifact_invalid_type');
    database.connection.prepare("UPDATE artifacts SET content_type='image/png', file_status='missing' WHERE id='doc'").run();
    const missingFile = await app.inject({ method: 'PUT', url: `/api/v1/admin/covers/story-project/${projectId}`, headers, payload: { artifactId: 'doc' } });
    assert.equal(missingFile.statusCode, 422); assert.equal(missingFile.json().error, 'cover_artifact_unavailable');
    assert.equal(refs(database).length, 0, 'rejected writes leave no references');
  } finally { await app.close(); }
});

test('deleting an entity drops its cover reference and force-deleted media clears the cover column', async () => {
  const { app, database, projectId } = await fixture();
  try {
    const artifactId = (await upload(app)).json().artifactId as string;
    for (const [type, id] of [['story-project', projectId], ['activity', 'act-1']] as const) {
      await app.inject({ method: 'PUT', url: `/api/v1/admin/covers/${type}/${id}`, headers, payload: { artifactId } });
    }
    database.connection.prepare("DELETE FROM activities WHERE id='act-1'").run();
    assert.deepEqual(refs(database).map(ref => ref.refId), [`story-project:${projectId}`]);

    database.connection.prepare('DELETE FROM artifact_references WHERE artifact_id=?').run(artifactId);
    database.connection.prepare('DELETE FROM artifacts WHERE id=?').run(artifactId);
    const row = database.connection.prepare('SELECT cover_artifact_id FROM story_projects WHERE id=?').get(projectId) as { cover_artifact_id: string | null };
    assert.equal(row.cover_artifact_id, null);
  } finally { await app.close(); }
});

test('worlds expose the cover as entity metadata and saving a definition never carries it back', async () => {
  const { app, database } = await fixture();
  try {
    const artifactId = (await upload(app)).json().artifactId as string;
    await app.inject({ method: 'PUT', url: '/api/v1/admin/covers/story-world/world-1', headers, payload: { artifactId } });
    const world = (await app.inject({ method: 'GET', url: '/api/v1/admin/story-worlds/world-1', headers })).json() as StoryWorld | { world: StoryWorld };
    const current = 'world' in world ? world.world : world;
    assert.equal(Value.Check(StoryWorldSchema, current), true);
    assert.equal(current.coverArtifactId, artifactId);

    const definition = Object.fromEntries(Object.entries(current).filter(([key]) => !STORY_WORLD_METADATA_KEYS.includes(key))) as WorldDefinition;
    const saved = await app.inject({ method: 'PUT', url: '/api/v1/admin/story-worlds/world-1', headers, payload: { expectedRevision: current.revision, definition: { ...definition, title: '新标题' } } });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().coverArtifactId, artifactId, 'saving the definition keeps the cover');
    assert.equal(saved.json().title, '新标题');

    // 即使调用方把封面混进 definition，也不会写入 data_json 快照；封面只由封面接口改变。
    const leaked = await app.inject({ method: 'PUT', url: '/api/v1/admin/story-worlds/world-1', headers, payload: { expectedRevision: saved.json().revision, definition: { ...definition, coverArtifactId: 'other' } } });
    assert.ok(leaked.statusCode < 500, leaked.body);
    const stored = database.connection.prepare("SELECT data_json, cover_artifact_id FROM sw_worlds WHERE id='world-1'").get() as { data_json: string; cover_artifact_id: string };
    assert.equal('coverArtifactId' in JSON.parse(stored.data_json), false);
    assert.equal(stored.cover_artifact_id, artifactId);
  } finally { await app.close(); }
});
