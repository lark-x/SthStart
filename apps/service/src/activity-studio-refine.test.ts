import assert from 'node:assert/strict';
import test from 'node:test';
import { buildActivityDocument, type StudioRefineRequest, type StudioRefineResult } from '@sthstart/contracts';
import { ServiceDatabase,nowIso } from './database.js';
import { SecretStore } from './security.js';
import { ActivityStore } from './activities/store.js';
import { ComicStore } from './activities/comic-store.js';
import { getImageConfigDraft } from './activities/image-configs.js';
import { materializeComicStoryboard } from './activities/comic-storyboard.js';
import { StudioStore } from './activities/studio-store.js';
import { freezeStudioRefine,processStudioRefine,applyStudioRefine } from './activities/studio-refine.js';

function fixture(database: ServiceDatabase) {
  const activities = new ActivityStore(database), now = nowIso();
  const content = buildActivityDocument({ templateId: 'blank',title: '微调隔离验收',type: '测试',theme: '',location: '营地',rules: '',
    actors: [{ id: 'a',displayName: '研究员',persona: { appearance: { baseText: '银发' } },outfitDescription: '实验外套',activityRole: '' }] });
  const stageId = content.stages[0].id;
  content.scenes = [{ id: 's',stageId,title: '原场次',timeText: '傍晚',locationText: '营地',beats: [{ id: 'b',characterId: 'a',
    action: '观察结晶',dialogue: '稳定。',outcome: '记录变化',mediaUrl: '/original.png',renderSettings: { customPrompt: '保留用户补充',parameters: { seed: 42 } } }] }];
  const activity = activities.createActivity({ title: content.activity.title,type: '测试',initialDocument: content }).activity;
  const image = getImageConfigDraft(database,activity.id);
  database.connection.prepare("INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('activities','活动','isolated-refine-hash','[]',1,?,?)").run(now,now);
  database.connection.prepare("INSERT INTO provider_profiles(id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at) VALUES ('refine-llm','测试模型','llm','http://test/v1','test',NULL,1,?,?)").run(now,now);
  database.connection.prepare("INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('activities','text','refine-llm',?)").run(now);
  const request: StudioRefineRequest = { kind: 'refine',idempotencyKey: 'refine-one',versions: { headVersion: activity.headVersion,
    contentDraftVersion: 1,contentRevisionId: activity.currentContentRevisionId,imageConfigDraftVersion: image.draftVersion,imageConfigRevisionId: image.baseRevisionId },
    input: { target: { kind: 'beat',stageId,sceneId: 's',beatId: 'b' },instructions: '拉远一点，换俯视，暖光，表情更平静。' } };
  return { activities,activity,request,stageId };
}
async function generate(database: ServiceDatabase, activityId: string, request: StudioRefineRequest, raw: unknown) {
  const jobs = new StudioStore(database), job = jobs.create({ activityId,kind: 'refine',idempotencyKey: request.idempotencyKey,request,
    freeze: () => ({ ...freezeStudioRefine(database,activityId,request) }) }).job;
  await processStudioRefine({ database,secrets: new SecretStore({}),activityId,jobId: job.id,
    fetcher: async () => Response.json({ choices: [{ message: { content: JSON.stringify(raw) } }] }) });
  return jobs.get(activityId,job.id)!;
}
const valid = { patch: { director: { shotSize: 'wide',angle: 'high',lighting: 'warm',mood: 'calm' },expression: '放松眉眼，平静地注视结晶' },explanation: '拉远景别，使用俯视暖光；只调整视觉，不改变原动作。' };

test('refine whitelists visual changes and only explicit application updates settings while retaining original picture, dialogue and configuration', async t => {
  const database = new ServiceDatabase(), { activities,activity,request } = fixture(database); t.after(() => database.close());
  const before = activities.getDraft(activity.id)!, job = await generate(database,activity.id,request,valid);
  assert.equal(job.status,'awaiting_review'); assert.ok(job.callId); assert.deepEqual(activities.getDraft(activity.id),before);
  const result = job.result as StudioRefineResult;
  const applied = applyStudioRefine(database,activity.id,job.id,{ expectedJobRevision: job.revision,versions: request.versions,resultHash: result.resultHash });
  const beat = activities.getDraft(activity.id)!.document.scenes![0].beats[0], old = before.document.scenes![0].beats[0];
  for (const key of ['action','dialogue','outcome','mediaUrl','characterId'] as const) assert.equal(beat[key],old[key]);
  assert.equal(beat.renderSettings!.customPrompt,'保留用户补充'); assert.deepEqual(beat.renderSettings!.parameters,{ seed: 42 });
  assert.equal(beat.renderSettings!.director!.lighting,'warm'); assert.equal(beat.renderSettings!.director!.angle,'high');
  assert.equal(applied.appliedResult!.childJobId,null);
  assert.equal(applyStudioRefine(database,activity.id,job.id,{ expectedJobRevision: 1,versions: request.versions,resultHash: result.resultHash }).revision,applied.revision);
});

test('refine refuses character/dialogue/model/path scope and invalid model patch fields; stale content never applies', async t => {
  const database = new ServiceDatabase(), { activities,activity,request } = fixture(database); t.after(() => database.close());
  for (const instructions of ['替换角色为砂糖','修改台词为你好','模型换成新模型','seed=1','JSON Patch /parameters/width'])
    assert.throws(() => freezeStudioRefine(database,activity.id,{ ...request,input: { ...request.input,instructions } }), /只支持景别/);
  for (const patch of [{ actorIds: ['other'] },{ dialogue: '你好' },{ parameters: { seed: 9 } },{ director: { angle: 'random' } },{ url: 'http://test' }]) {
    const job = await generate(database,activity.id,{ ...request,idempotencyKey: JSON.stringify(patch) },{ patch,explanation: '非法补丁' });
    assert.equal(job.status,'failed'); assert.ok(job.callId); assert.equal(activities.getDraft(activity.id)!.draftVersion,1);
  }
  const job = await generate(database,activity.id,request,valid), draft = activities.getDraft(activity.id)!;
  activities.updateDraft(activity.id,draft.draftVersion,{ ...draft.document,scenes: draft.document.scenes!.map(scene => ({ ...scene,beats: scene.beats.map(beat => ({ ...beat,action: '人工修改动作' })) })) });
  assert.throws(() => applyStudioRefine(database,activity.id,job.id,{ expectedJobRevision: job.revision,versions: { ...request.versions,contentDraftVersion: 2 },resultHash: job.result!.resultHash }), /已经变化/);
  assert.equal(new StudioStore(database).get(activity.id,job.id)!.applyState,'not_applied');
});

test('comic refinement only saves comic settings and never writes to the source beat; failed child creation rolls back both', async t => {
  const database = new ServiceDatabase(), { activities,activity,request,stageId } = fixture(database); t.after(() => database.close());
  const comics = new ComicStore(database), draft = comics.createComicDraft(activity.id,activity.currentContentRevisionId!);
  const pages = materializeComicStoryboard({ panels: Array.from({ length: 4 },() => ({ sourceBeatIds: ['b'],actorIds: ['a'],shotSize: 'medium',visualDescription: '观察结晶',composition: '',textSafeArea: 'none',bubbles: [] })) },
    activities.getDraft(activity.id)!.document,{ stageId,sceneId: 's',panelCount: 4 });
  const saved = comics.saveComicDraft(activity.id,draft.draftVersion,{ ...draft.document,...pages });
  request.input.target={ kind: 'comic_panel',panelId: pages.panels[0].id }; request.versions.comicDraftVersion=saved.draftVersion;
  const before = activities.getDraft(activity.id), job = await generate(database,activity.id,request,valid);
  assert.equal(job.status,'awaiting_review');
  const apply = { expectedJobRevision: job.revision,versions: request.versions,resultHash: job.result!.resultHash };
  assert.throws(() => applyStudioRefine(database,activity.id,job.id,{ ...apply,renderAfterApply: true },() => { throw new Error('child insertion rollback'); }), /child insertion rollback/);
  assert.deepEqual(comics.getComicDraft(activity.id),saved); assert.equal(new StudioStore(database).get(activity.id,job.id)!.applyState,'not_applied');
  applyStudioRefine(database,activity.id,job.id,apply);
  const panel = comics.getComicDraft(activity.id)!.document.panels[0];
  assert.equal(panel.shotSize,'wide'); assert.equal(panel.renderSettings.director?.shotSize,undefined); assert.equal(panel.renderSettings.director!.lighting,'warm');
  assert.deepEqual(activities.getDraft(activity.id),before);
});
