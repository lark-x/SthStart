import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {publicationFixture} from './fixtures.js';
import {synthesizeSpeech,speechKey} from './speech.js';
import {readConfig} from '../config.js';
import {SecretStore} from '../security.js';
import {checkFfmpeg} from '../video-utils.js';
import type {SpeechProfile} from '@sthstart/contracts';
import type {VideoBinaryProbe} from './runtime-preflight.js';
test('speech can reuse an existing connection key but cannot redirect it, bypass disabled state or fall back to another key',async()=>{
  const f=publicationFixture('unused-test-media'),time=new Date().toISOString();
  try{
    f.db.connection.prepare(`INSERT INTO service_connections(id,name,kind,base_url,credential_account,created_at,updated_at) VALUES ('speech-conn','语音','openai-compatible-text','https://speech.invalid/v1','test:connection',?,?)`).run(time,time);
    f.db.connection.prepare(`INSERT INTO model_profiles(id,connection_id,name,model_id,created_at,updated_at) VALUES ('speech-model','speech-conn','语音','stepaudio-2.5-tts',?,?)`).run(time,time);
    const secrets=new SecretStore({STHSTART_SECRET_SPEECH_CONN:'connection-only-key',UNRELATED_KEY:'do-not-fallback'});
    const profile:SpeechProfile={id:'shared',revision:1,name:'共享语音',connectionId:'speech-conn',baseUrl:'https://speech.invalid/v1',model:'stepaudio-2.5-tts',voices:['cixingnansheng'],defaultVoice:'cixingnansheng',speed:1,secretEnvironment:'UNRELATED_KEY'};
    assert.equal(await speechKey(secrets,profile,f.db),'connection-only-key');
    await assert.rejects(()=>speechKey(secrets,{...profile,baseUrl:'https://different.invalid/v1'},f.db),/地址\/模型改变/);
    await assert.rejects(()=>speechKey(secrets,{...profile,model:'unknown-model'},f.db),/地址\/模型改变/);
    f.db.connection.prepare("UPDATE model_profiles SET enabled=0 WHERE id='speech-model'").run();
    await assert.rejects(()=>speechKey(secrets,profile,f.db),/停用/);
    f.db.connection.prepare("UPDATE model_profiles SET enabled=1 WHERE id='speech-model'").run();
    await assert.rejects(()=>speechKey(new SecretStore({UNRELATED_KEY:'do-not-fallback'}),profile,f.db),/缺少可用密钥/);
    f.db.connection.prepare("UPDATE service_connections SET enabled=0 WHERE id='speech-conn'").run();
    await assert.rejects(()=>speechKey(secrets,profile,f.db),/停用/);
  }finally{f.db.close();}
});
test('speech streams persist durations, redact credentials and invalidate only the changed utterance',async t=>{
  if(!await checkFfmpeg()){t.skip('FFprobe未安装，音频探测未验证。');return;}
  const dir=await mkdtemp(join(tmpdir(),'sthstart-publication-speech-')),f=publicationFixture(dir);
  try{
    const profile:SpeechProfile={id:'speech-test',revision:1,name:'测试语音',baseUrl:'https://speech.example.invalid/v1',model:'test-speech',voices:['test'],defaultVoice:'test',speed:1,secretEnvironment:'PUBLICATION_TEST_KEY'};
    const key='private-speech-key-never-in-logs',secrets=new SecretStore({PUBLICATION_TEST_KEY:key}),config={...readConfig({}),artifactDirectory:dir};
    const path=join(dir,'tone.mp3');await promisify(execFile)('ffmpeg',['-y','-f','lavfi','-i','sine=frequency=300:duration=1','-c:a','libmp3lame',path],{windowsHide:true});
    const buffer=await readFile(path);
    const approval=f.store.approve(f.draft.activityId,{expectedDraftVersion:2,speechProfileId:null,makeVideo:false,imageBudget:6,speechCharacterBudget:100},{}),run=f.store.createRun(f.draft.activityId,approval.id,'speech-start-key');
    const task=f.store.createTask(run.id,'speech','utterance-0',{text:f.document.shots[0].utterances[0].text},'speech-key');f.store.claim(task.id);f.store.reserve(task.id,10);
    let requestCount=0;
    const artifact=await synthesizeSpeech({store:f.store,config,secrets,activityId:f.draft.activityId,taskId:task.id,profile,text:'测试对白',voice:'test',fetcher:async(_url,init)=>{requestCount++;assert.equal((init?.headers as {authorization:string}).authorization,`Bearer ${key}`);return new Response(buffer,{headers:{'content-type':'audio/mpeg'}});}});
    assert.equal(requestCount,1);assert.ok(Number(f.store.artifact(artifact,'audio').duration_ms)>=1000);
    f.store.taskHistory(task.id,[artifact]);f.store.selectAudio(f.draft.activityId,2,'utterance-0',artifact);
    const current=f.store.requireDraft(f.draft.activityId),changed=structuredClone(current.document);changed.shots[0].utterances[0].text='新一句';
    const saved=f.store.save(f.draft.activityId,current.draftVersion,changed);assert.equal(saved.document.shots[0].utterances[0].selectedAudioArtifactId,null);
    assert.ok(!JSON.stringify(f.db.connection.prepare('SELECT * FROM ai_call_records').all()).includes(key));
    const unknown=f.store.createTask(run.id,'speech','utterance-1',{text:'unknown'},'speech-unknown');f.store.claim(unknown.id);f.store.reserve(unknown.id,5);
    await assert.rejects(()=>synthesizeSpeech({store:f.store,config,secrets,activityId:f.draft.activityId,taskId:unknown.id,profile,text:'超时',voice:'test',fetcher:async()=>{throw new Error('network timeout');}}),/不确定/);
    const call=f.db.connection.prepare('SELECT status FROM ai_call_records WHERE id=?').get(f.store.task(unknown.id).callId!);assert.equal(call?.status,'unknown');
    assert.equal(f.store.run(f.draft.activityId,run.id).speechCharactersUsed,15);
  }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});
test('a missing FFprobe blocks an independent speech call before any paid request',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sthstart-publication-speech-preflight-')),f=publicationFixture(dir);
  try{
    const profile:SpeechProfile={id:'speech-preflight',revision:1,name:'预检语音',baseUrl:'https://speech.example.invalid/v1',model:'test-speech',voices:['test'],defaultVoice:'test',speed:1,secretEnvironment:'PUBLICATION_TEST_KEY'};
    const secrets=new SecretStore({PUBLICATION_TEST_KEY:'should-never-be-sent'}),config={...readConfig({}),artifactDirectory:dir};
    const approval=f.store.approve(f.draft.activityId,{expectedDraftVersion:2,speechProfileId:null,makeVideo:false,imageBudget:6,speechCharacterBudget:100},{}),run=f.store.createRun(f.draft.activityId,approval.id,'speech-preflight-run');
    const task=f.store.createTask(run.id,'speech','utterance-0',{text:f.document.shots[0].utterances[0].text},'speech-preflight');
    f.store.claim(task.id);
    let requests=0;
    const ffprobeMissing:VideoBinaryProbe=async binary=>binary!=='ffprobe';
    await assert.rejects(()=>synthesizeSpeech({store:f.store,config,secrets,activityId:f.draft.activityId,taskId:task.id,profile,text:'不会发送',voice:'test',probe:ffprobeMissing,
      fetcher:async()=>{requests++;return new Response('audio',{headers:{'content-type':'audio/mpeg'}});}}),(error:{code?:string})=>{assert.equal(error.code,'publication_ffprobe_missing');return true;});
    assert.equal(requests,0); // The paid request never left the process.
    assert.equal(f.store.run(f.draft.activityId,run.id).speechCharactersUsed,0);
    const calls=f.db.connection.prepare('SELECT count(*) AS n FROM ai_call_records').get() as {n:number};
    assert.equal(calls.n,0);
  }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});
