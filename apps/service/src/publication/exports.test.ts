import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {Readable} from 'node:stream';
import {createCanvas} from '@napi-rs/canvas';
import {compilePublicationTimeline,renderPublicationCard} from '@sthstart/activity-playback';
import {publicationFixture} from './fixtures.js';
import {renderPublicationVideo,exportPublication,loadPublicationFont} from './exports.js';
import {readConfig} from '../config.js';
import {streamUploadArtifact} from '../artifacts.js';
import {readZip} from '../activities/zip.js';
import {checkFfmpeg} from '../video-utils.js';
import {PublicationWorker} from './worker.js';
import {SecretStore} from '../security.js';
const exec=promisify(execFile);
test('shared canvas detects overflow; comic ZIP is immutable, secret-free and contains every card',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sthstart-publication-export-')),f=publicationFixture(dir),config={...readConfig({}),artifactDirectory:dir};
  try{
    loadPublicationFont();const canvas=createCanvas(400,600);canvas.getContext('2d').fillRect(0,0,400,600);const png=await canvas.encode('png');
    const artifact=await streamUploadArtifact(config,f.db,{appId:'activities',stream:Readable.from([png]),contentType:'image/png',originalName:'test.png',refType:'publication_upload',refId:`publication:${f.draft.activityId}:test`});
    const doc=structuredClone(f.document);for(const s of doc.shots)s.selectedImage={artifactId:artifact.id,renderTaskId:null};
    f.store.save(f.draft.activityId,2,doc);
    const revisionId=f.db.transaction(()=>f.store.revision(f.draft.activityId,doc));
    const approval=f.store.approve(f.draft.activityId,{expectedDraftVersion:3,speechProfileId:null,makeVideo:false,imageBudget:6,speechCharacterBudget:0},{});
    const run=f.store.createRun(f.draft.activityId,approval.id,'export-start-key'),task=f.store.createTask(run.id,'export','publication',{revisionId,makeVideo:false},'export-key');
    const assets=await exportPublication({store:f.store,config,activityId:f.draft.activityId,taskId:task.id,revisionId,makeVideo:false});
    assert.equal(assets.length,2);
    const path=f.store.artifact(assets[0],'file').path,entries=[...readZip(await readFile(path))].map(([path,data])=>({path,data}));
    assert.equal(entries.filter(e=>e.path.startsWith('images/')).length,6);
    const manifest=JSON.parse(entries.find(e=>e.path==='manifest.json')!.data.toString());assert.equal(manifest.revisionId,revisionId);
    assert.ok(entries.some(e=>e.path==='cover.png'));
    assert.ok(!entries.some(e=>/prompt|token|secret|log/i.test(e.path)));
    assert.ok(!JSON.stringify(manifest).includes('structuredPrompt'));
    const overflow=structuredClone(doc);overflow.shots[0].utterances[0].text='长文本'.repeat(300);
    const card=createCanvas(1080,1440);
    const issues=renderPublicationCard(card.getContext('2d') as unknown as CanvasRenderingContext2D,overflow,{shotId:overflow.shots[0].id,utteranceIds:[overflow.shots[0].utterances[0].id]},null);
    assert.ok(issues.some(i=>i.includes('溢出')));
    assert.ok(f.db.connection.prepare('SELECT * FROM artifact_references WHERE ref_type=?').all('publication_revision').length>=1);
    const failed=f.store.createTask(run.id,'image','shot-0',{sourceFingerprint:'old'},'failed-drawing');
    f.store.updateTask(failed.id,{status:'failed',error:'旧绘制失败'});f.store.updateRun(run.id,'failed');
    const worker=new PublicationWorker(f.store,config,new SecretStore({}));
    try{
      const requested=await worker.export(f.draft.activityId,3,false,'manual-export-after-failure');
      await worker.close();
      assert.equal(f.store.task(requested.id).status,'succeeded');
      assert.equal(f.store.run(f.draft.activityId,run.id).imagesUsed,0);
      assert.equal(f.store.run(f.draft.activityId,run.id).speechCharactersUsed,0);
    }finally{await worker.close();}
    f.store.taskHistory(failed.id,[artifact.id]);
    f.db.connection.prepare("UPDATE artifacts SET file_status='quarantined' WHERE id=?").run(artifact.id);
    assert.equal(f.store.history(f.draft.activityId,'shot-0').items[0].available,false);
    assert.equal(f.db.connection.prepare('SELECT file_status FROM artifacts WHERE id=?').get(artifact.id)?.file_status,'quarantined');
    f.db.connection.prepare("UPDATE artifacts SET file_status='ready' WHERE id=?").run(artifact.id);
    const sourcePath=f.store.artifact(artifact.id,'image').path;
    await rm(sourcePath); // Only this test's temporary artifact is removed.
    f.db.connection.prepare("UPDATE artifacts SET file_status='missing' WHERE id=?").run(artifact.id);
    assert.equal(f.store.history(f.draft.activityId,'shot-0').items[0].available,false);
    await assert.rejects(()=>exportPublication({store:f.store,config,activityId:f.draft.activityId,taskId:task.id,revisionId,makeVideo:false}),/不可读取/);
  }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});
test('ten-second real FFmpeg export has H264, AAC, correct orientation and actual audio timing',{timeout:120000},async t=>{
  if(!await checkFfmpeg()) {t.skip('本机无 FFmpeg/FFprobe，视频编码未验证。');return;}
  const dir=await mkdtemp(join(tmpdir(),'sthstart-publication-video-')),f=publicationFixture(dir);
  try{
    const doc=structuredClone(f.document);doc.shots=doc.shots.slice(0,1);doc.shots[0].utterances[0].text='这是一段实际十秒视频的小样，字幕会拆为多段，但音频必须从第一段开始播放。';doc.shots[0].presentation='push_in';
    const imagePath=join(dir,'source.png'),audioPath=join(dir,'voice.wav'),canvas=createCanvas(768,1024),ctx=canvas.getContext('2d');ctx.fillStyle='#6c849a';ctx.fillRect(0,0,768,1024);await writeFile(imagePath,await canvas.encode('png'));
    await exec('ffmpeg',['-y','-f','lavfi','-i','sine=frequency=440:duration=9.35','-c:a','pcm_s16le',audioPath],{windowsHide:true,timeout:10000});
    const timeline=compilePublicationTimeline(doc,{'utterance-0':{artifactId:'audio',durationMs:9350}});assert.equal(timeline.durationMs,10000);
    const path=await renderPublicationVideo(doc,timeline,{'shot-0':imagePath},{'utterance-0':audioPath},dir);
    const {stdout}=await exec('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_name,codec_type,width,height,r_frame_rate','-of','json',path],{windowsHide:true});
    const data=JSON.parse(stdout);assert.ok(Math.abs(Number(data.format.duration)-10)<0.1);
    const video=data.streams.find((s:{codec_type:string})=>s.codec_type==='video');assert.equal(video.codec_name,'h264');assert.equal(video.width,1080);assert.equal(video.height,1920);
    assert.equal(data.streams.find((s:{codec_type:string})=>s.codec_type==='audio').codec_name,'aac');
    const {stderr}=await exec('ffmpeg',['-i',path,'-t','1','-af','volumedetect','-f','null','-'],{windowsHide:true});
    assert.ok(!stderr.includes('mean_volume: -inf')); // first second must not be delayed to the last subtitle.
  }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});
