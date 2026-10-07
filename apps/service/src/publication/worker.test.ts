import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {publicationFixture,addPublicationTestWorkflow,publicationObjectInfo} from './fixtures.js';
import {PublicationWorker} from './worker.js';
import {SecretStore} from '../security.js';
import {readConfig} from '../config.js';
import {executeQueuedTask} from '../generation/execution.js';
import {compilePublicationImagePrompt,imagePlan} from './images.js';
import {shotFingerprint,utteranceFingerprint} from './store.js';
import {streamUploadArtifact} from '../artifacts.js';
import {Readable} from 'node:stream';
import {Buffer} from 'node:buffer';
import {probeBinary,type VideoBinaryProbe} from './runtime-preflight.js';
test('harness prompts are submitted once without optimizer and match the logged graph and actual seed',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sthstart-publication-worker-')),f=publicationFixture(dir);addPublicationTestWorkflow(f.db);
  const requests:Array<{url:string;body:unknown}>=[];
  const fetcher:typeof fetch=async(url,init)=>{requests.push({url:String(url),body:typeof init?.body==='string'?JSON.parse(init.body):null});if(String(url).endsWith('/object_info'))return Response.json(publicationObjectInfo());if(String(url).endsWith('/prompt'))return Response.json({prompt_id:'publication-provider-id'});if(String(url).endsWith('/queue'))return Response.json({queue_running:[],queue_pending:[]});return new Response('unexpected',{status:404});};
  const config={...readConfig({}),artifactDirectory:dir},secrets=new SecretStore({}),worker=new PublicationWorker(f.store,config,secrets,fetcher);
  try{
    const p=compilePublicationImagePrompt(f.document,f.document.shots[0]);assert.match(p,/no text/);
    const approved=await worker.approve(f.draft.activityId,{expectedDraftVersion:2,makeVideo:false,speechProfileId:null,imageBudget:9,speechCharacterBudget:0});
    const run=await worker.start(f.draft.activityId,approved.id,'image-start-key');
    // start wakes asynchronous processing; close waits for that one operation without stopping its persisted unified task.
    await worker.close();
    const task=f.store.run(f.draft.activityId,run.id).tasks.find(t=>t.kind==='image'&&t.generationTaskId);assert.ok(task);
    await executeQueuedTask(config,f.db,secrets,task.generationTaskId!,fetcher);
    const submitted=requests.find(r=>r.url.endsWith('/prompt'));assert.ok(submitted);
    assert.ok(!requests.some(r=>r.url.includes('chat/completions')));
    const body=submitted.body as {prompt:Record<string,{inputs:Record<string,unknown>}>};
    const call=f.db.connection.prepare('SELECT positive_prompt,request_snapshot_json FROM ai_call_records WHERE id=?').get(task.callId!);
    assert.equal(body.prompt['1'].inputs.text,call?.positive_prompt);
    const row=f.db.connection.prepare('SELECT actual_seed,workflow_snapshot_json FROM generation_tasks WHERE id=?').get(task.generationTaskId!);
    assert.equal(body.prompt['3'].inputs.seed,row?.actual_seed);
    assert.match(String(call?.request_snapshot_json),/Snowy|snowy/);
    assert.equal(f.store.run(f.draft.activityId,run.id).imagesUsed,1);
    assert.equal((await worker.start(f.draft.activityId,approved.id,'image-start-key')).id,run.id);
  }finally{await worker.close();f.db.close();await rm(dir,{recursive:true,force:true});}
});

test('video approve and start both re-check FFmpeg dependencies before any paid request',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sthstart-publication-video-preflight-')),f=publicationFixture(dir);addPublicationTestWorkflow(f.db);
  let deps=true;const probe:VideoBinaryProbe=async()=>deps;
  let count=0;const fetcher:typeof fetch=async()=>{count++;return Response.json(publicationObjectInfo());};
  const worker=new PublicationWorker(f.store,{...readConfig({}),artifactDirectory:dir},new SecretStore({VIDEO_PREFLIGHT_KEY:'configured'}),fetcher,probe);
  try{
    const profile=f.store.saveSpeechProfile(0,{id:'video-profile',revision:1,name:'视频配音',baseUrl:'https://speech.example.invalid/v1',model:'test-speech',voices:['test'],defaultVoice:'test',speed:1,secretEnvironment:'VIDEO_PREFLIGHT_KEY'});
    const approval=await worker.approve(f.draft.activityId,{expectedDraftVersion:2,speechProfileId:profile.id,makeVideo:true,imageBudget:6,speechCharacterBudget:100});
    assert.equal(approval.makeVideo,true);
    // The host loses FFmpeg/FFprobe between approve and the actual run.
    deps=false;const before=count;
    await assert.rejects(()=>worker.start(f.draft.activityId,approval.id,'video-start-key'),(error:{code?:string})=>{assert.equal(error.code,'publication_ffmpeg_missing');return true;});
    assert.equal(f.store.listRuns(f.draft.activityId).length,0); // No run, so no task could have spent budget.
    assert.equal(count,before); // The early dependency failure never reached ComfyUI object_info.
    deps=true;const run=await worker.start(f.draft.activityId,approval.id,'video-start-key');
    assert.ok(run.tasks.length>=12); // 6 images + 6 speech, all still queued before execution.
  }finally{await worker.close();f.db.close();await rm(dir,{recursive:true,force:true});}
});

test('a makeVideo run halts tasks that lack FFprobe without any paid request or budget use',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sthstart-publication-task-preflight-')),f=publicationFixture(dir);addPublicationTestWorkflow(f.db);
  const probe:VideoBinaryProbe=async binary=>binary!=='ffprobe';
  let comfy=0;const fetcher:typeof fetch=async()=>{comfy++;return new Response('unexpected',{status:404});};
  const worker=new PublicationWorker(f.store,{...readConfig({}),artifactDirectory:dir},new SecretStore({}),fetcher,probe);
  try{
    const profile=f.store.saveSpeechProfile(0,{id:'blocked-profile',revision:1,name:'失联配音',baseUrl:'https://speech.example.invalid/v1',model:'test-speech',voices:['test'],defaultVoice:'test',speed:1,secretEnvironment:'PUBLICATION_BLOCKED_KEY'});
    const approvalInput={expectedDraftVersion:2,speechProfileId:profile.id,makeVideo:true,imageBudget:6,speechCharacterBudget:100};
    const approval=f.store.approve(f.draft.activityId,approvalInput,{});
    const speechRun=f.store.createRun(f.draft.activityId,approval.id,'blocked-speech-run');
    const speech=f.store.createTask(speechRun.id,'speech','utterance-0',{text:f.document.shots[0].utterances[0].text,voice:'test',profile,sourceFingerprint:utteranceFingerprint(f.document,'utterance-0')},'blocked-speech');
    await worker.pump();
    assert.equal(f.store.task(speech.id).status,'failed');
    assert.equal(f.store.task(speech.id).callId,null); // No AI call record means no upstream submission at all.
    assert.equal(f.store.run(f.draft.activityId,speechRun.id).speechCharactersUsed,0);
    // Each approval owns a single run, so the image branch needs its own approval.
    const imageApproval=f.store.approve(f.draft.activityId,approvalInput,{});
    const imageRun=f.store.createRun(f.draft.activityId,imageApproval.id,'blocked-image-run');
    const plan=imagePlan(f.db,f.document,f.document.shots[0]);
    const image=f.store.createTask(imageRun.id,'image','shot-0',{plan,seed:1,sourceFingerprint:shotFingerprint(f.document,'shot-0')},'blocked-image');
    await worker.pump();
    assert.equal(f.store.task(image.id).status,'failed');
    assert.equal(f.store.task(image.id).generationTaskId,null); // nothing reached ComfyUI.
    assert.equal(f.store.run(f.draft.activityId,imageRun.id).imagesUsed,0);
    assert.equal(comfy,0);
    assert.equal((f.db.connection.prepare('SELECT count(*) AS n FROM ai_call_records').get() as {n:number}).n,0);
  }finally{await worker.close();f.db.close();await rm(dir,{recursive:true,force:true});}
});
test('without an injected probe the speech gate still uses the real binary check',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sthstart-publication-default-probe-')),f=publicationFixture(dir);
  const worker=new PublicationWorker(f.store,{...readConfig({}),artifactDirectory:dir},new SecretStore({}));
  try{
    // Regression guard: production constructs the worker without a probe. The default must be the
    // real host probe, never a null that skips the pre-reserve gate.
    assert.equal((worker as unknown as {videoProbe:VideoBinaryProbe}).videoProbe,probeBinary);
    assert.equal(typeof (worker as unknown as {videoProbe:unknown}).videoProbe,'function');
  }finally{await worker.close();f.db.close();await rm(dir,{recursive:true,force:true});}
});
test('a makeVideo speech task is gated on FFmpeg, not only FFprobe',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sthstart-publication-speech-ffmpeg-')),f=publicationFixture(dir);
  const probe:VideoBinaryProbe=async binary=>binary!=='ffmpeg'; // FFprobe present, FFmpeg missing.
  let upstream=0;
  const worker=new PublicationWorker(f.store,{...readConfig({}),artifactDirectory:dir},new SecretStore({}),async()=>{upstream++;return new Response('audio',{headers:{'content-type':'audio/mpeg'}});},probe);
  try{
    const profile=f.store.saveSpeechProfile(0,{id:'ffmpeg-only-missing',revision:1,name:'缺FFmpeg',baseUrl:'https://speech.example.invalid/v1',model:'test-speech',voices:['test'],defaultVoice:'test',speed:1,secretEnvironment:'PUBLICATION_FFMPEG_KEY'});
    const approval=f.store.approve(f.draft.activityId,{expectedDraftVersion:2,speechProfileId:profile.id,makeVideo:true,imageBudget:6,speechCharacterBudget:100},{});
    const run=f.store.createRun(f.draft.activityId,approval.id,'ffmpeg-missing-speech');
    const task=f.store.createTask(run.id,'speech','utterance-0',{text:f.document.shots[0].utterances[0].text,voice:'test',profile,sourceFingerprint:utteranceFingerprint(f.document,'utterance-0')},'ffmpeg-missing-speech-task');
    await worker.pump();
    assert.equal(f.store.task(task.id).status,'failed');
    assert.match(String(f.store.task(task.id).error),/FFmpeg/);
    assert.equal(f.store.task(task.id).callId,null);
    assert.equal(f.store.run(f.draft.activityId,run.id).speechCharactersUsed,0);
    assert.equal(upstream,0);
  }finally{await worker.close();f.db.close();await rm(dir,{recursive:true,force:true});}
});
test('missing models, changed config, LoRA files and unknown recovery cannot silently resubmit',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sthstart-publication-recovery-')),f=publicationFixture(dir);addPublicationTestWorkflow(f.db);
  let missing=true,count=0;
  const fetcher:typeof fetch=async()=>{count++;return Response.json(publicationObjectInfo(missing));};
  const worker=new PublicationWorker(f.store,{...readConfig({}),artifactDirectory:dir},new SecretStore({}),fetcher);
  try{
    const input={expectedDraftVersion:2,makeVideo:false,speechProfileId:null,imageBudget:6,speechCharacterBudget:0};
    await assert.rejects(()=>worker.approve(f.draft.activityId,input),/缺|模型|anima/);
    assert.equal(f.store.listRuns(f.draft.activityId).length,0);
    missing=false;const approval=await worker.approve(f.draft.activityId,input);
    const run=f.store.createRun(f.draft.activityId,approval.id,'recover-key');
    const task=f.store.createTask(run.id,'speech','utterance-0',{input:'frozen'},'speech-key');f.store.claim(task.id);f.store.reserve(task.id,0);
    worker.recover();assert.equal(f.store.task(task.id).status,'unknown');
    const before=count;await worker.pump();assert.equal(count,before);assert.equal(f.store.run(f.draft.activityId,run.id).status,'unknown');
    const doc=structuredClone(f.document);doc.shots[0].renderSettings.loraOverrides=[{model:'missing.safetensors',strength:1,enabled:true}];
    f.store.save(f.draft.activityId,2,doc);
    await assert.rejects(()=>worker.approve(f.draft.activityId,{...input,expectedDraftVersion:3}),/missing|LoRA/);
    assert.notEqual(imagePlan(f.db,doc,doc.shots[0]).configurationHash,imagePlan(f.db,f.document,f.document.shots[0]).configurationHash);
  }finally{await worker.close();f.db.close();await rm(dir,{recursive:true,force:true});}
});

test('identical successful speech is reused without another request or reserved characters',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sthstart-publication-cache-')),f=publicationFixture(dir);
  const config={...readConfig({}),artifactDirectory:dir};
  let calls=0;
  const worker=new PublicationWorker(f.store,config,new SecretStore({}),async()=>{calls++;throw new Error('cached speech must not request an upstream');});
  try{
    const profile=f.store.saveSpeechProfile(0,{id:'cached-profile',revision:1,name:'缓存声音',baseUrl:'https://speech.example.invalid/v1',model:'test-speech',voices:['test'],defaultVoice:'test',speed:1,secretEnvironment:'UNCONFIGURED_CACHE_TEST_KEY'});
    const input={text:f.document.shots[0].utterances[0].text,voice:'test',profile,sourceFingerprint:utteranceFingerprint(f.document,'utterance-0')};
    const approvalInput={expectedDraftVersion:2,speechProfileId:profile.id,makeVideo:false,imageBudget:6,speechCharacterBudget:100};
    const previousApproval=f.store.approve(f.draft.activityId,approvalInput,{}),previousRun=f.store.createRun(f.draft.activityId,previousApproval.id,'previous-run');
    const original=f.store.createTask(previousRun.id,'speech','utterance-0',input,'previous-speech');
    // The cache test starts with an already persisted, duration-verified audio record.
    const audio=await streamUploadArtifact(config,f.db,{appId:'activities',stream:Readable.from([Buffer.from('cached-audio-fixture')]),contentType:'audio/wav',originalName:'cached.wav',refType:'publication_upload',refId:`publication:${f.draft.activityId}:utterance-0`});
    f.db.connection.prepare('UPDATE artifacts SET duration_ms=1000 WHERE id=?').run(audio.id);
    f.store.taskHistory(original.id,[audio.id]);f.store.updateRun(previousRun.id,'succeeded');
    const approval=f.store.approve(f.draft.activityId,approvalInput,{}),run=f.store.createRun(f.draft.activityId,approval.id,'cache-run');
    const task=f.store.createTask(run.id,'speech','utterance-0',input,'cache-speech');f.store.updateRun(run.id,'running');
    await worker.pump();
    assert.equal(f.store.task(task.id).status,'succeeded');assert.deepEqual(f.store.task(task.id).artifactIds,[audio.id]);
    assert.equal(f.store.run(f.draft.activityId,run.id).speechCharactersUsed,0);assert.equal(calls,0);
    assert.equal(f.store.requireDraft(f.draft.activityId).document.shots[0].utterances[0].selectedAudioArtifactId,audio.id);
    assert.equal(f.store.audioHistory(f.draft.activityId,'utterance-0').items.length,1);
  }finally{await worker.close();f.db.close();await rm(dir,{recursive:true,force:true});}
});

test('replaying a completed export preserves the finished run and does not create another task',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sthstart-publication-export-replay-')),f=publicationFixture(dir);
  const config={...readConfig({}),artifactDirectory:dir},worker=new PublicationWorker(f.store,config,new SecretStore({}));
  try{
    const asset=await streamUploadArtifact(config,f.db,{appId:'activities',stream:Readable.from([Buffer.from('image-fixture')]),contentType:'image/png',originalName:'test.png',refType:'publication_history',refId:`publication:${f.draft.activityId}:test`});
    const doc=structuredClone(f.document);
    for(const shot of doc.shots) shot.selectedImage={artifactId:asset.id,renderTaskId:null};
    const draft=f.store.save(f.draft.activityId,2,doc);
    const approval=f.store.approve(f.draft.activityId,{expectedDraftVersion:draft.draftVersion,makeVideo:false,speechProfileId:null,imageBudget:6,speechCharacterBudget:0},{});
    const run=f.store.createRun(f.draft.activityId,approval.id,'export-replay-run');
    const revisionId=f.store.revision(f.draft.activityId,draft.document);
    const task=f.store.createTask(run.id,'export','publication',{revisionId,makeVideo:false},'export-replay-key');
    f.store.updateTask(task.id,{status:'succeeded',artifactIds:[asset.id]});f.store.updateRun(run.id,'succeeded');
    const replay=await worker.export(f.draft.activityId,draft.draftVersion,false,'export-replay-key');
    assert.equal(replay.id,task.id);assert.equal(replay.status,'succeeded');
    assert.equal(f.store.run(f.draft.activityId,run.id).status,'succeeded');
    assert.equal(f.store.run(f.draft.activityId,run.id).tasks.length,1);
  }finally{await worker.close();f.db.close();await rm(dir,{recursive:true,force:true});}
});
