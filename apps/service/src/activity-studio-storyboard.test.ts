import assert from 'node:assert/strict';
import test from 'node:test';
import { buildActivityDocument, type StudioStoryboardRequest, type StudioStoryboardOutput } from '@sthstart/contracts';
import { ServiceDatabase, nowIso } from './database.js';
import { readConfig } from './config.js';
import { createService } from './server.js';
import { SecretStore } from './security.js';
import { ActivityStore } from './activities/store.js';
import { StudioStore } from './activities/studio-store.js';
import { getImageConfigDraft } from './activities/image-configs.js';
import { freezeStudioStoryboard, processStudioStoryboard } from './activities/studio-storyboard.js';
import { applyStudioStoryboard } from './activities/studio-apply.js';
import { ComicStore } from './activities/comic-store.js';
import { StoryStore } from './story/store.js';

const token = 'studio-isolated-admin-not-production', headers = { 'x-sthstart-admin-token': token };
test('studio refuses unconfigured administrator credentials instead of allowing anonymous writes', async t => {
  const database = new ServiceDatabase(), { activity,request } = fixture(database);
  const { app } = await createService({ database,secrets: new SecretStore({}),config: readConfig({}) });
  t.after(async () => { await app.close(); database.close(); });
  const response = await app.inject({ method: 'POST',url: `/api/v1/admin/activities/${activity.id}/studio-jobs`,payload: request });
  assert.equal(response.statusCode,503); assert.equal(response.json().error,'admin_not_configured');
  assert.equal(new StudioStore(database).list(activity.id).items.length,0);
});
function fixture(database: ServiceDatabase) {
  const store = new ActivityStore(database);
  const content = buildActivityDocument({ templateId: 'blank',title: '智能制作 · 冻结实验',type: '测试',theme: '观察',location: '营地',rules: '',
    actors: [{ id: 'a',displayName: '研究员',persona: { appearance: { baseText: '银发' } },outfitDescription: '实验外套',activityRole: '主角' }] });
  const stageId = content.stages[0].id;
  content.scenes = [{ id: 's',stageId,title: '原场次',timeText: '傍晚',locationText: '营地',beats: [{ id: 'b',characterId: 'a',action: '观察结晶',dialogue: '稳定。',mediaUrl: '/kept-original-image.png' }] },
    { id: 'other',stageId,title: '应保留的其他场次',timeText: '',locationText: '营地',beats: [{ id: 'old',characterId: 'a',action: '记录' }] }];
  const activity = store.createActivity({ title: content.activity.title,type: '测试',initialDocument: content }).activity;
  const config = getImageConfigDraft(database,activity.id);
  const request: StudioStoryboardRequest = { kind: 'storyboard',idempotencyKey: 'one-click',versions: { headVersion: activity.headVersion,
    contentDraftVersion: 1,contentRevisionId: activity.currentContentRevisionId,imageConfigDraftVersion: config.draftVersion,imageConfigRevisionId: config.baseRevisionId },
    input: { source: { kind: 'text',text: '研究员观察结晶，低温时结晶发出微光，随后将参数记入实验日志。' },actorIds: ['a'],output: 'beats',count: 6,stageId,sceneId: 's',instructions: '' } };
  const now = nowIso();
  database.connection.prepare("INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('activities','活动','studio-test-hash','[]',1,?,?)").run(now,now);
  database.connection.prepare(`INSERT INTO provider_profiles(id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at)
    VALUES ('studio-text','模拟分镜模型','llm','http://studio.test/v1','studio-model',NULL,1,?,?)`).run(now,now);
  database.connection.prepare("INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('activities','text','studio-text',?)").run(now);
  return { store,activity,request };
}
function output(): StudioStoryboardOutput {
  return { scene: { title: '结晶实验',timeText: '傍晚',locationText: '营地',environment: '风雪渐起' },
    beats: Array.from({ length: 6 },(_,index) => ({ actorIds: ['a'],primaryActorId: 'a',action: `观察结晶的第 ${index+1} 个动作`,dialogue: '反应稳定。',outcome: '',
      director: { shotSize: index % 2 ? 'closeup' : 'wide' },composition: '实验台位于前景' })) };
}
async function waitForReview(app: Awaited<ReturnType<typeof createService>>['app'],activityId: string,id: string) {
  for (let i=0;i<100;i++) {
    const response = await app.inject({ method: 'GET',url: `/api/v1/admin/activities/${activityId}/studio-jobs/${id}`,headers });
    const job = response.json(); if (!['queued','preparing','running'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve,5));
  }
  throw new Error('Mock task did not finish');
}
test('studio HTTP flow is admin-only, logs one model request, requires review and applies exactly once',async t => {
  const database = new ServiceDatabase(), { store,activity,request } = fixture(database); let calls = 0;
  const { app } = await createService({ database,secrets: new SecretStore({}),config: readConfig({ STHSTART_ADMIN_TOKEN: token }),
    fetcher: async () => { calls++; return Response.json({ choices: [{ message: { content: JSON.stringify(output()) } }] }); } });
  t.after(async () => { await app.close(); database.close(); });
  const url = `/api/v1/admin/activities/${activity.id}/studio-jobs`, before = store.getDraft(activity.id)!;
  assert.equal((await app.inject({ method: 'POST',url,payload: request })).statusCode,401);
  const oversized = await app.inject({ method: 'POST',url,headers,payload: { ...request,input: { ...request.input,source: { kind: 'text',text: '字'.repeat(12001) } } } });
  assert.equal(oversized.statusCode,400); assert.equal(oversized.json().error,'studio_input_too_large'); assert.equal(calls,0);
  const response = await app.inject({ method: 'POST',url,headers,payload: request }); assert.equal(response.statusCode,202,response.body);
  const id = response.json().id, review = await waitForReview(app,activity.id,id);
  assert.equal(review.status,'awaiting_review'); assert.ok(review.callId); assert.equal(calls,1);
  assert.deepEqual(store.getDraft(activity.id),before,'completed model call must not edit the draft');
  const application = { expectedJobRevision: review.revision,versions: request.versions,resultHash: review.result.resultHash,mode: 'append',sceneId: 's' };
  const applied = await app.inject({ method: 'POST',url: `${url}/${id}/apply`,headers,payload: application }); assert.equal(applied.statusCode,200,applied.body);
  const draft = store.getDraft(activity.id)!; assert.equal(draft.document.scenes!.length,3);
  assert.equal(draft.document.scenes!.find(scene => scene.id === 's')!.beats[0].mediaUrl,'/kept-original-image.png');
  assert.equal(draft.document.scenes!.at(-1)!.beats.length,6);
  const duplicateApply = await app.inject({ method: 'POST',url: `${url}/${id}/apply`,headers,payload: application });
  assert.equal(duplicateApply.statusCode,200); assert.deepEqual(duplicateApply.json(),applied.json());
  const duplicate = await app.inject({ method: 'POST',url,headers,payload: request }); assert.equal(duplicate.json().id,id); assert.equal(calls,1,'retry before newer version validation');
  assert.equal((await app.inject({ method: 'POST',url,headers,payload: { ...request,input: { ...request.input,instructions: '另一次' } } })).statusCode,409);
  assert.equal((await app.inject({ method: 'GET',url: `/api/v1/admin/activities/foreign/studio-jobs/${id}`,headers })).statusCode,404);
});

test('confirmed replacement is scoped, and a late comic save failure rolls back the content version and job together',async t => {
  const database = new ServiceDatabase(), { store,activity,request } = fixture(database); t.after(() => database.close());
  const jobs = new StudioStore(database);
  const execute = async (key: string, input: StudioStoryboardRequest) => {
    const job = jobs.create({ activityId: activity.id,kind: 'storyboard',idempotencyKey: key,request: input,
      freeze: () => ({ ...freezeStudioStoryboard(database,activity.id,input) }) }).job;
    await processStudioStoryboard({ database,secrets: new SecretStore({}),activityId: activity.id,jobId: job.id,
      fetcher: async () => Response.json({ choices: [{ message: { content: JSON.stringify(output()) } }] }) });
    return jobs.get(activity.id,job.id)!;
  };
  const review = await execute('replace-success',request), originalOther = store.getDraft(activity.id)!.document.scenes!.find(scene => scene.id==='other');
  applyStudioStoryboard(database,activity.id,review.id,{ expectedJobRevision: review.revision,versions: request.versions,resultHash: review.result!.resultHash,
    mode: 'replace_scene',sceneId: 's',confirmReplace: true });
  assert.equal(store.getDraft(activity.id)!.document.scenes!.length,2);
  assert.equal(store.getDraft(activity.id)!.document.scenes!.find(scene => scene.id==='s')!.beats.length,6);
  assert.deepEqual(store.getDraft(activity.id)!.document.scenes!.find(scene => scene.id==='other'),originalOther);
  const comicInput: StudioStoryboardRequest = { ...request,versions: { ...request.versions,contentDraftVersion: store.getDraft(activity.id)!.draftVersion },
    input: { ...request.input,output: 'comic' } };
  const comicReview = await execute('rollback-comic',comicInput), beforeDraft = store.getDraft(activity.id), beforeActivity = store.getActivity(activity.id);
  database.connection.exec("CREATE TRIGGER reject_comic_save BEFORE INSERT ON activity_comic_drafts BEGIN SELECT RAISE(ABORT, 'synthetic late comic failure'); END");
  assert.throws(() => applyStudioStoryboard(database,activity.id,comicReview.id,{ expectedJobRevision: comicReview.revision,versions: comicInput.versions,
    resultHash: comicReview.result!.resultHash,mode: 'append',sceneId: 's' }), /synthetic late comic failure/);
  assert.deepEqual(store.getDraft(activity.id),beforeDraft); assert.deepEqual(store.getActivity(activity.id),beforeActivity);
  assert.equal(jobs.get(activity.id,comicReview.id)!.status,'awaiting_review'); assert.equal(jobs.get(activity.id,comicReview.id)!.applyState,'not_applied');
  database.connection.exec('DROP TRIGGER reject_comic_save');
});

test('saved-scene comic proposals reuse real beat IDs without altering content or original media',async t => {
  const database = new ServiceDatabase(), { store,activity,request } = fixture(database); t.after(() => database.close());
  request.input = { ...request.input,output: 'comic',source: { kind: 'scene',contentRevisionId: activity.currentContentRevisionId!,stageId: request.input.stageId,sceneId: 's' } };
  const jobs = new StudioStore(database), job = jobs.create({ activityId: activity.id,kind: 'storyboard',idempotencyKey: 'saved-comic',request,
    freeze: () => ({ ...freezeStudioStoryboard(database,activity.id,request) }) }).job;
  const before = store.getDraft(activity.id);
  await processStudioStoryboard({ database,secrets: new SecretStore({}),activityId: activity.id,jobId: job.id,
    fetcher: async () => Response.json({ choices: [{ message: { content: JSON.stringify({ panels: Array.from({ length: 6 },() => ({
      sourceBeatIds: ['b'],actorIds: ['a'],shotSize: 'medium',visualDescription: '研究员观察结晶',composition: '',textSafeArea: 'top_left',
      bubbles: [{ kind: 'speech',speakerActorId: 'a',text: '稳定。' }] })) }) } }] }) });
  const review = jobs.get(activity.id,job.id)!; assert.equal(review.status,'awaiting_review'); assert.ok(review.result && 'output' in review.result); assert.equal(review.result.output,null);
  applyStudioStoryboard(database,activity.id,review.id,{ expectedJobRevision: review.revision,versions: request.versions,resultHash: review.result!.resultHash,mode: 'append',sceneId: 's' });
  assert.deepEqual(store.getDraft(activity.id),before);
  const comic = new ComicStore(database).getComicDraft(activity.id)!;
  assert.equal(comic.document.panels.length,6); assert.ok(comic.document.panels.every(panel => panel.source.beatIds[0]==='b'));
});
test('comic from prose applies a new frozen scene and two pages atomically, without changing original media',async t => {
  const database = new ServiceDatabase(), { store,activity,request } = fixture(database); t.after(() => database.close());
  request.input.output='comic';
  const jobs = new StudioStore(database), created = jobs.create({ activityId: activity.id,kind: 'storyboard',idempotencyKey: 'comic',request,
    freeze: () => ({ ...freezeStudioStoryboard(database,activity.id,request) }) });
  await processStudioStoryboard({ database,secrets: new SecretStore({}),activityId: activity.id,jobId: created.job.id,
    fetcher: async () => Response.json({ choices: [{ message: { content: JSON.stringify(output()) } }] }) });
  const review = jobs.get(activity.id,created.job.id)!; assert.equal(review.status,'awaiting_review');
  const applied = applyStudioStoryboard(database,activity.id,review.id,{ expectedJobRevision: review.revision,versions: request.versions,
    resultHash: review.result!.resultHash,mode: 'append',sceneId: 's' });
  const comic = new ComicStore(database).getComicDraft(activity.id)!;
  assert.deepEqual(comic.document.pages.map(page => page.template),['trio','trio']); assert.equal(comic.document.panels.length,6);
  assert.equal(comic.document.contentRevisionId,store.getActivity(activity.id)!.currentContentRevisionId);
  assert.equal(applied.appliedResult!.contentDraftVersion,store.getDraft(activity.id)!.draftVersion);
  assert.equal(store.getDraft(activity.id)!.document.scenes!.find(scene => scene.id === 's')!.beats[0].mediaUrl,'/kept-original-image.png');
  assert.deepEqual(database.connection.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('invalid model JSON and unknown actors fail with logs, timeout does not resubmit, and late cancellation cannot publish a proposal',async t => {
  for (const mode of ['json','actor','timeout','cancel'] as const) {
    const database = new ServiceDatabase(), { activity,request } = fixture(database); t.after(() => database.close());
    const jobs = new StudioStore(database), job = jobs.create({ activityId: activity.id,kind: 'storyboard',idempotencyKey: mode,request,
      freeze: () => ({ ...freezeStudioStoryboard(database,activity.id,request) }) }).job;
    let resolve!: (response: Response) => void, called = 0;
    const unknown = output(); unknown.beats[2].actorIds=['unknown'];
    const pending = processStudioStoryboard({ database,secrets: new SecretStore({}),activityId: activity.id,jobId: job.id,timeoutMs: 20,
      fetcher: async (_input,init) => { called++;
        if (mode==='json' || mode==='actor') return Response.json({ choices: [{ message: { content: mode==='json' ? '{bad JSON' : JSON.stringify(unknown) } }] });
        return new Promise<Response>((done,reject) => { resolve=done; init?.signal?.addEventListener('abort',() => reject(new Error('aborted')),{ once: true }); });
      } });
    if (mode==='cancel') {
      for (let i=0;!resolve && i<100;i++) await new Promise(done => setTimeout(done,1));
      const current = jobs.get(activity.id,job.id)!; jobs.stop(activity.id,job.id,current.revision);
      resolve(Response.json({ choices: [{ message: { content: JSON.stringify(output()) } }] }));
    }
    await pending;
    const final = jobs.get(activity.id,job.id)!;
    assert.equal(final.status,mode==='cancel' ? 'cancelled' : 'failed'); assert.equal(final.result,null); assert.equal(called,1);
    if (mode!=='cancel') assert.ok(final.callId);
    if (mode==='actor') assert.equal(final.errorCode,'studio_actor_unknown');
    if (mode==='timeout') assert.equal(final.errorCode,'studio_model_timeout');
  }
});
test('frozen formal chapter sources reject wrong revisions and oversized text; proposal conflicts never replace another scene',async t => {
  const database = new ServiceDatabase(), { store,activity,request } = fixture(database); t.after(() => database.close());
  const stories = new StoryStore(database), project = stories.createProject({ title: '正式剧情' });
  const chapter = stories.createDocument(project.id,{ kind: 'chapter',title: '实验',body: '冻结章节正文' });
  const revision = stories.listEntryRevisions(project.id,'chapter',chapter.id)[0];
  request.input.source={ kind: 'story_chapter',projectId: project.id,chapterId: chapter.id,revisionId: revision.id };
  assert.equal(freezeStudioStoryboard(database,activity.id,request).text,'冻结章节正文');
  const longChapter = stories.createDocument(project.id,{ kind: 'chapter',title: '过长章节',body: '字'.repeat(12001) });
  const longRevision = stories.listEntryRevisions(project.id,'chapter',longChapter.id)[0];
  assert.throws(() => freezeStudioStoryboard(database,activity.id,{ ...request,input: { ...request.input,
    source: { kind: 'story_chapter',projectId: project.id,chapterId: longChapter.id,revisionId: longRevision.id } } }), /12,000/);
  assert.throws(() => freezeStudioStoryboard(database,activity.id,{ ...request,input: { ...request.input,source: { kind: 'story_chapter',projectId: project.id,chapterId: 'wrong',revisionId: revision.id } } }), /指定修订/);
  const jobs = new StudioStore(database), job=jobs.create({ activityId: activity.id,kind: 'storyboard',idempotencyKey: 'stale',request,
    freeze: () => ({ ...freezeStudioStoryboard(database,activity.id,request) }) }).job;
  await processStudioStoryboard({ database,secrets: new SecretStore({}),activityId: activity.id,jobId: job.id,fetcher: async () => Response.json({ choices: [{ message: { content: JSON.stringify(output()) } }] }) });
  const review=jobs.get(activity.id,job.id)!;
  const apply = { expectedJobRevision: review.revision,versions: request.versions,resultHash: review.result!.resultHash,mode: 'replace_scene' as const,sceneId: 's' };
  assert.throws(() => applyStudioStoryboard(database,activity.id,job.id,apply), /明确确认/);
  assert.throws(() => applyStudioStoryboard(database,activity.id,job.id,{ ...apply,confirmReplace: true,sceneId: 'other' }), /同一场次/);
  const old = store.getDraft(activity.id)!;
  store.updateDraft(activity.id,old.draftVersion,{ ...old.document,scenes: old.document.scenes!.map(scene => scene.id==='s' ? { ...scene,title: '手工修改' } : scene) });
  assert.throws(() => applyStudioStoryboard(database,activity.id,job.id,{ ...apply,confirmReplace: true,versions: { ...request.versions,contentDraftVersion: 2 } }), /已变化/);
  assert.equal(jobs.get(activity.id,job.id)!.applyState,'not_applied');
  assert.equal(store.getDraft(activity.id)!.document.scenes!.find(scene => scene.id==='other')!.title,'应保留的其他场次');
  const changed = store.getDraft(activity.id)!;
  store.updateDraft(activity.id,changed.draftVersion,{ ...changed.document,stages: changed.document.stages.map(stage => stage.id===request.input.stageId ? { ...stage,locked: true } : stage) });
  const lockedRequest = { ...request,versions: { ...request.versions,contentDraftVersion: store.getDraft(activity.id)!.draftVersion } };
  assert.throws(() => freezeStudioStoryboard(database,activity.id,lockedRequest), /已锁定/);
  assert.throws(() => applyStudioStoryboard(database,activity.id,job.id,{ ...apply,confirmReplace: true,versions: lockedRequest.versions }), /已锁定/);
});
