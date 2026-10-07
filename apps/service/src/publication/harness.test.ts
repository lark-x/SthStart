import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createCanvas} from '@napi-rs/canvas';
import {publicationFixture,addPublicationTestWorkflow,publicationObjectInfo} from './fixtures.js';
import {PublicationHarness} from './harness.js';
import {PublicationWorker} from './worker.js';
import {registerPublicationRoutes} from './routes.js';
import {SecretStore} from '../security.js';
import {readConfig} from '../config.js';
import {streamUploadArtifact} from '../artifacts.js';
import {fingerprint,utteranceFingerprint,shotFingerprint} from './store.js';

test('discovery uses stable cursors; validation/patches are atomic and keep canon unchanged',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mcp-discovery-')),f=publicationFixture(dir);addPublicationTestWorkflow(f.db);
  const worker=new PublicationWorker(f.store,{...readConfig({}),artifactDirectory:dir},new SecretStore({})),h=new PublicationHarness(f.store,worker);
  try{
    const second=f.store.create(f.project.id,[f.revision.id]),first=h.publications(f.project.id,{limit:1});
    assert.equal(first.items[0].activityId,second.activityId);assert.ok(first.nextCursor);
    f.store.create(f.project.id,[f.revision.id]);assert.equal(h.publications(f.project.id,{cursor:first.nextCursor!,limit:1}).items[0].activityId,f.draft.activityId);
    assert.deepEqual(h.publications('other',{}).items,[]);
    assert.throws(()=>h.owned('foreign',f.draft.activityId),/不属于/);
    const validation=h.validate(f.draft.activityId,f.document);assert.equal(validation.executable,true);
    assert.equal(f.store.requireDraft(f.draft.activityId).draftVersion,2);
    assert.throws(()=>h.patch(f.draft.activityId,{expectedDraftVersion:2,operations:[{kind:'publication',changes:{title:'不应保存'}},{kind:'utterance',id:'missing',changes:{text:'不存在'}}]}),/整批/);
    assert.equal(f.store.requireDraft(f.draft.activityId).draftVersion,2);
    const result=h.patch(f.draft.activityId,{expectedDraftVersion:2,operations:[{kind:'utterance',id:'utterance-0',changes:{text:'仅改这一句'}}]});
    assert.equal(result.draft.draftVersion,3);assert.equal(result.draft.document.shots[1].utterances[0].text,f.document.shots[1].utterances[0].text);
    assert.throws(()=>h.patch(f.draft.activityId,{expectedDraftVersion:2,operations:[{kind:'publication',changes:{title:'旧版本'}}]}),e=>(e as any).currentVersion===3);
    assert.equal(f.story.getDocument(f.project.id,f.chapter.id)?.body,f.chapter.body);
    const preview=await h.preview(f.draft.activityId,{expectedDraftVersion:3,speechProfileId:null,makeVideo:false});assert.equal(preview.approvalValid,false);assert.equal(preview.approvalReason,'missing');assert.equal(preview.imageCount,6);
    const options=h.options(f.draft.activityId);assert.ok(!JSON.stringify(options).includes('secretEnvironment'));
  }finally{await worker.close();f.db.close();await rm(dir,{recursive:true,force:true});}
});

test('owned media previews, history and local invalidation reject foreign files and stale selection',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mcp-media-')),f=publicationFixture(dir),config={...readConfig({}),artifactDirectory:dir};
  const worker=new PublicationWorker(f.store,config,new SecretStore({})),h=new PublicationHarness(f.store,worker);
  try{
    const approval=f.store.approve(f.draft.activityId,{expectedDraftVersion:2,speechProfileId:null,makeVideo:false,imageBudget:6,speechCharacterBudget:0},{}),run=f.store.createRun(f.draft.activityId,approval.id,'media-run');
    const canvas=createCanvas(1200,1000);canvas.getContext('2d').fillRect(0,0,1200,1000);
    for(let i=0;i<2;i++){
      const t=f.store.createTask(run.id,'image','shot-0',{sourceFingerprint:shotFingerprint(f.document,'shot-0'),seed:i},`image-${i}`);
      const image=await streamUploadArtifact(config,f.db,{appId:'activities',stream:Readable.from([canvas.toBuffer('image/png')]),contentType:'image/png',originalName:'test.png',refType:'publication_history',refId:`publication:${f.draft.activityId}:${t.id}`});f.store.taskHistory(t.id,[image.id]);
    }
    const history=h.images(f.draft.activityId,'shot-0',{limit:1});assert.equal(history.items.length,1);assert.ok(history.nextCursor);assert.equal(h.images(f.draft.activityId,'shot-0',{cursor:history.nextCursor!,limit:1}).items.length,1);
    const imageId=history.items[0].artifactId,preview=await h.readArtifact(f.draft.activityId,imageId,'preview');assert.equal(preview.preview?.type,'image');assert.equal(preview.preview?.transformed,true);assert.ok(!JSON.stringify(preview).includes(dir));
    f.store.selectImage(f.draft.activityId,2,'shot-0',imageId);
    const audio=await streamUploadArtifact(config,f.db,{appId:'activities',stream:Readable.from([Buffer.from('test audio')]),contentType:'audio/wav',originalName:'test.wav',refType:'publication_upload',refId:`publication:${f.draft.activityId}:utterance-0`,metadata:{sourceFingerprint:utteranceFingerprint(f.document,'utterance-0')}});
    f.db.connection.prepare('UPDATE artifacts SET duration_ms=1000 WHERE id=?').run(audio.id);h.selectAudio(f.draft.activityId,'utterance-0',{expectedDraftVersion:3,artifactId:audio.id,allowStaleSource:false});
    const patch=h.patch(f.draft.activityId,{expectedDraftVersion:4,operations:[{kind:'utterance',id:'utterance-0',changes:{text:'新对白'}}]});assert.deepEqual(patch.invalidatedAudio,['utterance-0']);assert.deepEqual(patch.invalidatedImages,[]);
    assert.throws(()=>h.selectAudio(f.draft.activityId,'utterance-0',{expectedDraftVersion:5,artifactId:audio.id,allowStaleSource:false}),/旧对白/);
    h.selectAudio(f.draft.activityId,'utterance-0',{expectedDraftVersion:5,artifactId:audio.id,allowStaleSource:true});
    const other=f.store.create(f.project.id,[f.revision.id]);await assert.rejects(()=>h.readArtifact(other.activityId,imageId,'preview'),/不属于/);
    assert.throws(()=>h.task(other.activityId,run.tasks[0]?.id??f.store.run(f.draft.activityId,run.id).tasks[0].id),/不存在/);
    const changed=h.patch(f.draft.activityId,{expectedDraftVersion:6,operations:[{kind:'shot',id:'shot-0',changes:{visualDescription:'新构图'}}]});assert.deepEqual(changed.invalidatedImages,['shot-0']);assert.equal(h.images(f.draft.activityId,'shot-0',{}).items[0].staleSource,true);
  }finally{await worker.close();f.db.close();await rm(dir,{recursive:true,force:true});}
});

test('new project bridge routes validate bodies, retain response fields and reject admin/foreign/revoked access',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mcp-routes-')),f=publicationFixture(dir),app=Fastify({logger:false});addPublicationTestWorkflow(f.db);
  const {worker}=registerPublicationRoutes(app,{...readConfig({STHSTART_ADMIN_TOKEN:'test-admin-credential-12345678901234567890'}),artifactDirectory:dir},f.db,new SecretStore({}));
  try{
    const grant=f.store.grant(f.project.id),headers={authorization:`Bearer ${grant.token}`},root=`/api/v1/publication-bridge/projects/${f.project.id}`,base=`${root}/publications/${f.draft.activityId}`;
    const discover=await app.inject({url:`${root}/publications?limit=1`,headers});assert.equal(discover.statusCode,200,discover.body);assert.equal(discover.json().items[0].draftVersion,2);assert.ok('nextCursor' in discover.json());
    for(const path of ['/runs','/shots/shot-0/history','/utterances/utterance-0/history','/media','/options'])assert.equal((await app.inject({url:`${base}${path}`,headers})).statusCode,200);
    const check=await app.inject({method:'POST',url:`${base}/validate`,headers,payload:{document:f.document}});assert.equal(check.json().executable,true,check.body);
    assert.equal((await app.inject({method:'POST',url:`${base}/patch`,headers,payload:{expectedDraftVersion:2,operations:[{kind:'publication',changes:{source:{}}}]}})).statusCode,400);
    const saved=await app.inject({method:'POST',url:`${base}/patch`,headers,payload:{expectedDraftVersion:2,operations:[{kind:'publication',changes:{title:'新标题'}}]}});assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().draft.draftVersion,3);assert.ok(saved.json().approvalRequiresReview);
    const conflict=await app.inject({method:'POST',url:`${base}/patch`,headers,payload:{expectedDraftVersion:2,operations:[{kind:'publication',changes:{title:'冲突'}}]}});assert.equal(conflict.statusCode,409);assert.equal(conflict.json().currentVersion,3);
    assert.equal((await app.inject({url:`${root}/publications`,headers:{authorization:'Bearer test-admin'}})).statusCode,401);
    const other=f.story.createProject({title:'其他'}),otherGrant=f.store.grant(other.id);assert.equal((await app.inject({url:`${base}/media`,headers:{authorization:`Bearer ${otherGrant.token}`}})).statusCode,401);
    f.store.revoke(f.project.id);assert.equal((await app.inject({url:`${base}/options`,headers})).statusCode,401);
  }finally{await app.close();await worker.close();f.db.close();await rm(dir,{recursive:true,force:true});}
});

test('speech retry is idempotent and blocks unknown, changed config and insufficient budget before dispatch',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mcp-retry-')),f=publicationFixture(dir);addPublicationTestWorkflow(f.db);
  const worker=new PublicationWorker(f.store,{...readConfig({}),artifactDirectory:dir},new SecretStore({}));worker.wake=()=>{};
  try{
    const profile=f.store.saveSpeechProfile(0,{id:'retry-voice',revision:1,name:'测试',baseUrl:'https://speech.invalid/v1',model:'test',voices:['v'],defaultVoice:'v',speed:1,secretEnvironment:'MISSING_TEST_SPEECH_KEY'});
    const cfg=await worker.configuration(f.document,{speechProfileId:profile.id,makeVideo:true},false),chars=f.document.shots[0].utterances[0].text.length;
    const approval=f.store.approve(f.draft.activityId,{expectedDraftVersion:2,speechProfileId:profile.id,makeVideo:true,imageBudget:6,speechCharacterBudget:chars},cfg),run=f.store.createRun(f.draft.activityId,approval.id,'retry-run');
    const t=await worker.retryUtterance(f.draft.activityId,'utterance-0',run.id,'retry-line');assert.equal((await worker.retryUtterance(f.draft.activityId,'utterance-0',run.id,'retry-line')).id,t.id);
    await assert.rejects(()=>worker.retryUtterance(f.draft.activityId,'utterance-1',run.id,'retry-second'),/剩余/);
    f.store.claim(t.id);f.store.reserve(t.id,chars);f.store.updateTask(t.id,{status:'unknown'});
    await assert.rejects(()=>worker.retryUtterance(f.draft.activityId,'utterance-0',run.id,'retry-unknown'),/未知/);
    f.store.updateTask(t.id,{status:'failed'});await assert.rejects(()=>worker.retryUtterance(f.draft.activityId,'utterance-0',run.id,'retry-exhausted'),/剩余/);
    f.store.save(f.draft.activityId,2,{...f.document,title:'修改后'});await assert.rejects(()=>worker.retryUtterance(f.draft.activityId,'utterance-0',run.id,'retry-stale'),/重新人工/);
    assert.equal(f.store.run(f.draft.activityId,run.id).speechCharactersUsed,chars);assert.equal(f.store.db.connection.prepare('SELECT count(*) AS n FROM publication_tasks').get()?.n,1);
  }finally{await worker.close();f.db.close();await rm(dir,{recursive:true,force:true});}
});

test('preflight distinguishes current approval and changed configuration, reads upstream without submitting work',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mcp-preflight-')),f=publicationFixture(dir);addPublicationTestWorkflow(f.db);
  const requests:string[]=[],worker=new PublicationWorker(f.store,{...readConfig({}),artifactDirectory:dir},new SecretStore({}),async input=>{requests.push(String(input));return Response.json(publicationObjectInfo());}),h=new PublicationHarness(f.store,worker);
  try{
    const configuration=await worker.configuration(f.document,{speechProfileId:null,makeVideo:false},false);
    f.store.approve(f.draft.activityId,{expectedDraftVersion:2,speechProfileId:null,makeVideo:false,imageBudget:6,speechCharacterBudget:0},configuration);
    const local=await h.preview(f.draft.activityId,{expectedDraftVersion:2,speechProfileId:null,makeVideo:false});assert.equal(local.approvalValid,true);assert.equal(local.imagesVerified,false);assert.equal(requests.length,0);
    const checked=await h.preview(f.draft.activityId,{expectedDraftVersion:2,speechProfileId:null,makeVideo:false,checkUpstream:true});assert.equal(checked.imagesVerified,true);assert.equal(checked.providerVerified,false);assert.ok(requests.length>0);assert.ok(requests.every(url=>!url.includes('/prompt')));
    f.db.connection.prepare("UPDATE generation_engines SET base_url='http://changed.mock' WHERE id='publication-engine'").run();
    const changed=await h.preview(f.draft.activityId,{expectedDraftVersion:2,speechProfileId:null,makeVideo:false});assert.equal(changed.approvalValid,false);assert.equal(changed.approvalReason,'configuration_changed');
    assert.equal(f.store.requireDraft(f.draft.activityId).draftVersion,2);assert.equal(f.db.connection.prepare('SELECT count(*) AS n FROM publication_tasks').get()?.n,0);
  }finally{await worker.close();f.db.close();await rm(dir,{recursive:true,force:true});}
});
