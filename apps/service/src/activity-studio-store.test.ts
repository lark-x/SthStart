import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { buildActivityDocument, StudioJobSchema, type StudioStoryboardResult } from '@sthstart/contracts';
import { Value } from '@sinclair/typebox/value';
import { ServiceDatabase, SERVICE_DATABASE_MIGRATIONS, migrateDatabase } from './database.js';
import { ActivityStore } from './activities/store.js';
import { StudioStore, studioHash } from './activities/studio-store.js';
import { enforceRetention } from './artifacts.js';

test('migrating from version 47 to head appends later tables without modifying version 47 user content',t => {
  const connection = new DatabaseSync(':memory:'); t.after(() => connection.close());
  connection.exec('PRAGMA foreign_keys=ON');
  migrateDatabase(connection,SERVICE_DATABASE_MIGRATIONS.filter(migration => migration.version<=47),'service');
  connection.prepare(`INSERT INTO activities(id,title,type,theme,location,rules,archived,head_version,created_at,updated_at)
    VALUES ('legacy','已有活动','测试','','','',0,1,'2026-10-01','2026-10-01')`).run();
  const before = connection.prepare("SELECT * FROM activities WHERE id='legacy'").get();
  migrateDatabase(connection,SERVICE_DATABASE_MIGRATIONS,'service');
  assert.deepEqual(connection.prepare("SELECT * FROM activities WHERE id='legacy'").get(),before);
  // 断言迁移到当前头部版本，而不是写死某一个编号：新增迁移时不需要改这条用例。
  assert.equal(connection.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version,
    SERVICE_DATABASE_MIGRATIONS.at(-1)!.version);
  assert.equal(connection.prepare('PRAGMA quick_check').get()?.quick_check,'ok');
  assert.deepEqual(connection.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('studio tasks persist first, enforce idempotency and a single claimed lease, and do not revive terminal tasks', t => {
  const database = new ServiceDatabase(); t.after(() => database.close());
  const activity = new ActivityStore(database).createActivity({ title: '智能任务验收', type: '测试', initialDocument: buildActivityDocument({ templateId: 'blank',
    title: '智能任务验收', type: '测试', theme: '', location: '', rules: '', actors: [] }) }).activity;
  const store = new StudioStore(database); let freezes = 0;
  const request = { kind: 'storyboard', text: '一次实验', nested: { a: 1, b: 2 } };
  const create = (body: unknown = request) => store.create({ activityId: activity.id, kind: 'storyboard', idempotencyKey: 'single-click', request: body,
    freeze() { freezes++; return { text: '冻结的一次实验' }; } });
  const created = create(); assert.equal(created.existing,false); assert.equal(created.job.status,'queued'); assert.ok(Value.Check(StudioJobSchema,created.job));
  const duplicate = create({ nested: { b: 2, a: 1 }, text: '一次实验', kind: 'storyboard' });
  assert.equal(duplicate.job.id,created.job.id); assert.equal(freezes,1,'retry must read the original before checking newer source versions');
  assert.throws(() => create({ text: '不同实验' }), /不同内容/);
  assert.equal(store.claim(activity.id,created.job.id,'worker-one'),true);
  assert.equal(store.claim(activity.id,created.job.id,'worker-two'),false);
  assert.equal(store.renew(activity.id,created.job.id,'worker-two'),false);
  assert.equal(store.renew(activity.id,created.job.id,'worker-one'),true);
  const preparing = store.get(activity.id,created.job.id)!;
  assert.throws(() => store.transition(activity.id,created.job.id,1,'running'), /已改变/);
  const running = store.transition(activity.id,created.job.id,preparing.revision,'running');
  const result: StudioStoryboardResult = { output: { scene: { title: '实验', timeText: '', locationText: '', environment: '' },
    beats: [1,2].map(() => ({ actorIds: [],primaryActorId: null,action: '结晶发光',dialogue: '',outcome: '',director: {},composition: '' })) },
    comic: null, sourceLabel: '测试正文',sourceFingerprint: studioHash('source'),resultHash: studioHash('result') };
  const review = store.transition(activity.id,created.job.id,running.revision,'awaiting_review',{ result, callId: 'test-call' });
  assert.ok(Value.Check(StudioJobSchema,review));
  assert.equal(store.stop(activity.id,review.id,review.revision).status,'cancelled');
  assert.equal(store.stop(activity.id,review.id,1).status,'cancelled','duplicate stop is idempotent');
  assert.equal(store.claim(activity.id,review.id,'worker-three'),false);
  assert.throws(() => store.transition(activity.id,review.id,store.get(activity.id,review.id)!.revision,'preparing'), /不能进行/);
  assert.equal(store.get('other-activity',review.id),null);
  assert.equal(database.connection.prepare('PRAGMA quick_check').get()?.quick_check,'ok');
  assert.deepEqual(database.connection.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('studio proposal application is atomic and preserves its result for retries', t => {
  const database = new ServiceDatabase(); t.after(() => database.close());
  const activity = new ActivityStore(database).createActivity({ title: '应用事务', type: '测试', initialDocument: buildActivityDocument({ templateId: 'blank',
    title: '应用事务', type: '测试', theme: '', location: '', rules: '', actors: [] }) }).activity;
  const store = new StudioStore(database);
  let job = store.create({ activityId: activity.id,kind: 'storyboard',idempotencyKey: 'apply-one',request: {},freeze: () => ({}) }).job;
  store.claim(activity.id,job.id,'worker'); job=store.get(activity.id,job.id)!;
  job=store.transition(activity.id,job.id,job.revision,'running'); job=store.transition(activity.id,job.id,job.revision,'awaiting_review');
  const applied = { sceneId: 'new-scene',beatIds: ['beat-one'],pageIds: [],panelIds: [],contentDraftVersion: 2,contentRevisionId: null,comicDraftVersion: null,childJobId: null };
  assert.throws(() => database.transaction(() => { store.recordApplied(activity.id,job.id,job.revision,applied); throw new Error('rollback'); }),/rollback/);
  assert.equal(store.get(activity.id,job.id)!.applyState,'not_applied');
  const done = database.transaction(() => store.recordApplied(activity.id,job.id,job.revision,applied));
  assert.equal(done.applyState,'applied'); assert.deepEqual(done.appliedResult,applied);
  assert.equal(store.list(activity.id,{ limit: 1 }).items[0].id,job.id);
});

test('studio frozen image references survive retention, and a foreign reference rolls back job insertion', async t => {
  const database = new ServiceDatabase(); t.after(() => database.close());
  const activities = new ActivityStore(database), createActivity = (title: string) => activities.createActivity({ title,type: '测试',initialDocument:
    buildActivityDocument({ templateId: 'blank',title,type: '测试',theme: '',location: '',rules: '',actors: [] }) }).activity;
  const a = createActivity('本活动'), b = createActivity('其他活动'), now = new Date().toISOString();
  database.connection.prepare("INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('activities','活动','isolated-ref-hash','[]',1,?,?)").run(now,now);
  for (const [activity, artifactId] of [[a,'own-image'],[b,'foreign-image']] as const) {
    database.connection.prepare("INSERT INTO artifacts(id,app_id,content_type,byte_size,created_at,media_type,file_status) VALUES (?,'activities','image/png',1,'2001-01-01','image/png','ready')").run(artifactId);
    activities.saveAsset({ activityId: activity.id,assetKey: artifactId,artifactId,type: 'image',source: 'upload',hash: artifactId,createdAt: now });
  }
  const jobs = new StudioStore(database), job = jobs.create({ activityId: a.id,kind: 'storyboard',idempotencyKey: 'protected',request: {},
    freeze: () => ({ referenceArtifactIds: ['own-image'] }) }).job;
  assert.ok(database.connection.prepare('SELECT 1 FROM artifact_references WHERE artifact_id=? AND ref_type=? AND ref_id=?').get('own-image','activity_studio_job',`studio-job:${job.id}`));
  assert.throws(() => jobs.create({ activityId: a.id,kind: 'storyboard',idempotencyKey: 'foreign',request: {},freeze: () => ({ referenceArtifactIds: ['foreign-image'] }) }), /不属于本活动/);
  assert.equal(jobs.list(a.id).items.length,1);
  database.connection.prepare("UPDATE artifacts SET pinned=1 WHERE id='foreign-image'").run();
  database.connection.prepare("INSERT INTO artifacts(id,app_id,content_type,byte_size,created_at,media_type,file_status) VALUES ('orphan','activities','image/png',1,'2001-01-01','image/png','ready')").run();
  database.connection.prepare("INSERT INTO storage_policies(app_id,mode,ttl_days) VALUES ('activities','ttl',1) ON CONFLICT(app_id) DO UPDATE SET mode='ttl',ttl_days=1").run();
  assert.equal(await enforceRetention(database,'activities'),1);
  assert.ok(database.connection.prepare("SELECT 1 FROM artifacts WHERE id='own-image'").get());
  assert.equal(database.connection.prepare("SELECT 1 FROM artifacts WHERE id='orphan'").get(),undefined);
});
