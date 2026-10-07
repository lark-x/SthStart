import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceDatabase, migrateDatabase, SERVICE_DATABASE_MIGRATIONS } from '../database.js';
import { DatabaseSync } from 'node:sqlite';
import { StoryStore } from '../story/store.js';
import { PublicationStore, contentFingerprint, shotFingerprint, utteranceFingerprint } from './store.js';
import type { PublicationDocument } from '@sthstart/contracts';

export function fixture() {
  const db = new ServiceDatabase(':memory:'), story = new StoryStore(db), store = new PublicationStore(db, '/unused-test-artifacts');
  const project = story.createProject({ title: '测试制作' });
  const chapter = story.createDocument(project.id, { kind: 'chapter', title: '雪山', body: '阿贝多与砂糖发现新结晶。' });
  const revision = story.listEntryRevisions(project.id, 'chapter', chapter.id)[0];
  const draft = store.create(project.id, [revision.id]);
  const doc: PublicationDocument = { ...draft.document, shots: Array.from({ length: 6 }, (_, i) => ({
    id: `shot-${i}`, sourceRefs: [revision.id], actorIds: [], visualDescription: '雪山营地',
    structuredPrompt: { actors: [], camera: ['wide shot'], scene: ['snowy mountain'], details: ['laboratory'], naturalLanguage: 'Snowy camp.' },
    renderSettings: {}, selectedImage: null, utterances: [{ id: `utterance-${i}`, speakerActorId: null, text: '新的发现。', voiceBindingId: null, selectedAudioArtifactId: null }], presentation: 'still',
  })) };
  return { db, story, store, project, chapter, revision, draft: store.save(draft.activityId, 1, doc), doc };
}
test('publication freezes actual chapters and CAS never writes Story or legacy activity content', () => {
  const f = fixture();
  try {
    const oldLegacy = f.db.connection.prepare('SELECT document_json FROM activity_drafts WHERE activity_id=?').get(f.draft.activityId);
    const saved = f.store.save(f.draft.activityId, 2, { ...f.doc, title: '作品' });
    assert.equal(saved.draftVersion, 3);
    assert.throws(() => f.store.save(f.draft.activityId, 2, f.doc), /版本冲突|其他窗口/);
    assert.equal(f.story.getDocument(f.project.id, f.chapter.id)?.body, f.chapter.body);
    assert.deepEqual(f.db.connection.prepare('SELECT document_json FROM activity_drafts WHERE activity_id=?').get(f.draft.activityId), oldLegacy);
    assert.throws(() => f.store.create(f.project.id, ['invented']), /不属于/);
    const another=f.story.createDocument(f.project.id,{kind:'chapter',title:'另一章',body:'另一个冻结来源'});
    const revision=f.story.listEntryRevisions(f.project.id,'chapter',another.id)[0];
    const bundle=f.store.sourceBundle(f.project.id,[revision.id]);
    const replaced={...saved.document,source:{...saved.document.source,entryRevisionIds:[revision.id],sourceHash:bundle.sourceHash},shots:saved.document.shots.map(s=>({...s,sourceRefs:[revision.id]}))};
    assert.throws(()=>f.store.save(f.draft.activityId,saved.draftVersion,replaced),/来源已冻结/);
    assert.equal(f.db.connection.prepare('PRAGMA quick_check').get()?.quick_check, 'ok');
    assert.equal(f.db.connection.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { f.db.close(); }
});
test('validation rejects foreign project versions, unknown speakers and duplicate IDs', () => {
  const f = fixture();
  try {
    const doc = structuredClone(f.doc); doc.shots[1].id = doc.shots[0].id;
    assert.throws(() => f.store.validate(doc), /重复/);
    doc.shots[1].id = 'second'; doc.shots[0].utterances[0].speakerActorId = 'foreign';
    assert.throws(() => f.store.validate(doc), /发言人/);
    doc.shots[0].utterances[0].speakerActorId = null; doc.source.sourceHash = 'invalid';
    assert.throws(() => f.store.validate(doc), /指纹/);
  } finally { f.db.close(); }
});
test('approval preserves immutable content, one run per approval and idempotency conflict', () => {
  const f = fixture();
  try {
    const approval = f.store.approve(f.draft.activityId, { expectedDraftVersion: 2, speechProfileId: null, makeVideo: false, imageBudget: 9, speechCharacterBudget: 0 }, { frozen: true });
    const run = f.store.createRun(f.draft.activityId, approval.id, 'test-key-1');
    assert.equal(f.store.createRun(f.draft.activityId, approval.id, 'test-key-2').id, run.id);
    f.store.save(f.draft.activityId, 2, { ...f.doc, title: '人工新标题' });
    assert.equal(f.store.revisionDocument(f.draft.activityId, approval.revisionId).title, f.doc.title);
    assert.throws(() => f.store.createRun(f.draft.activityId, approval.id, 'test-key-3'), /重新人工确认/);
    assert.equal(f.store.createRun(f.draft.activityId, approval.id, 'test-key-1').id, run.id);
  } finally { f.db.close(); }
});
test('child claims and budget reservation are atomic; unknown also consumes its reserved allowance', () => {
  const f = fixture();
  try {
    const approval = f.store.approve(f.draft.activityId, { expectedDraftVersion: 2, speechProfileId: null, makeVideo: false, imageBudget: 6, speechCharacterBudget: 0 }, {});
    const run = f.store.createRun(f.draft.activityId, approval.id, 'budget-key');
    for (let i = 0; i < 6; i++) {
      const task = f.store.createTask(run.id, 'image', `shot-${i}`, { seed: i }, `image-${i}`);
      assert.equal(f.store.claim(task.id), true); assert.equal(f.store.claim(task.id), false);
      f.store.reserve(task.id, 1); f.store.updateTask(task.id, { status: 'unknown' });
    }
    const retry = f.store.createTask(run.id, 'image', 'shot-0', {}, 'retry-key'); f.store.claim(retry.id);
    assert.throws(() => f.store.reserve(retry.id, 1), /额度已用完/);
    assert.equal(f.store.run(f.draft.activityId, run.id).imagesUsed, 6);
  } finally { f.db.close(); }
});
test('project production grants are distinct from Story, hashed, scoped, rotated and revocable', () => {
  const f = fixture();
  try {
    const old = f.story.createBridgeGrant(f.project.id);
    const grant = f.store.grant(f.project.id);
    assert.equal(f.store.authorize(f.project.id, old.token), false);
    assert.equal(f.store.authorize('other', grant.token), false);
    assert.equal(f.store.authorize(f.project.id, grant.token), true);
    assert.ok(!JSON.stringify(f.db.connection.prepare('SELECT * FROM publication_bridge_grants').all()).includes(grant.token));
    f.store.grant(f.project.id); assert.equal(f.store.authorize(f.project.id, grant.token), false);
    f.store.revoke(f.project.id); assert.equal(f.store.grantStatus(f.project.id).paired, false);
  } finally { f.db.close(); }
});
test('fingerprints invalidate image and speech locally, not on media selection', () => {
  const f = fixture();
  try {
    const doc = structuredClone(f.doc); doc.shots[0].utterances[0].text = '修改对白';
    assert.equal(shotFingerprint(doc, 'shot-0'), shotFingerprint(f.doc, 'shot-0'));
    assert.notEqual(utteranceFingerprint(doc, 'utterance-0'), utteranceFingerprint(f.doc, 'utterance-0'));
    doc.shots[0].presentation = 'push_in';
    assert.equal(shotFingerprint(doc, 'shot-0'), shotFingerprint(f.doc, 'shot-0'));
    doc.shots[0].presentation = 'still';
    doc.shots[0].selectedImage = { artifactId: 'selected', renderTaskId: 'task' }; doc.shots[0].utterances[0].text = f.doc.shots[0].utterances[0].text;
    assert.equal(contentFingerprint(doc), contentFingerprint(f.doc));
  } finally { f.db.close(); }
});

test('migration 50 upgrades a populated version-49 database without changing canonical chapters',()=>{
  const connection=new DatabaseSync(':memory:');
  try{
    connection.exec('PRAGMA foreign_keys=ON');
    migrateDatabase(connection,SERVICE_DATABASE_MIGRATIONS.filter(m=>m.version<=49),'service');
    const time=new Date().toISOString();
    connection.prepare('INSERT INTO story_projects(id,title,summary,revision,context_settings_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('migration-project','保留项目','原有摘要',3,'{}',time,time);
    connection.prepare('INSERT INTO story_documents(id,project_id,kind,title,body,position,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run('migration-chapter','migration-project','chapter','旧章节','迁移不能改动这段正文。',0,4,time,time);
    const before=connection.prepare('SELECT * FROM story_documents WHERE id=?').get('migration-chapter');
    migrateDatabase(connection,SERVICE_DATABASE_MIGRATIONS.filter(m=>m.version<=50),'service');
    assert.deepEqual(connection.prepare('SELECT * FROM story_documents WHERE id=?').get('migration-chapter'),before);
    assert.equal(connection.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version,50);
    assert.equal(connection.prepare('SELECT COUNT(*) AS count FROM publication_drafts').get()?.count,0);
    assert.equal(connection.prepare('PRAGMA integrity_check').get()?.integrity_check,'ok');
    assert.deepEqual(connection.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{connection.close();}
});
