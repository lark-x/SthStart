// Comparison-only: read existing test assets, never write the business database.
import {DatabaseSync} from 'node:sqlite';
import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createCanvas, loadImage} from '@napi-rs/canvas';

const root=resolve(import.meta.dirname,'../..');
const output=resolve(root,'artifacts/publication-motion-comparison-20261004');
const source=resolve(root,'artifacts/publication-production/2026-10-04T07-25-32.657Z');
const db=new DatabaseSync(join(root,'data/sthstart.db'),{readOnly:true});
const fixture=JSON.parse(await readFile(join(source,'fixture.json'),'utf8'));
const row=db.prepare('SELECT document_json,draft_version FROM publication_drafts WHERE activity_id=?').get(fixture.activityId);
if(!row) throw new Error('Existing test publication not found');
const doc=JSON.parse(row.document_json);
const media=join(output,'media'); await mkdir(media,{recursive:true});
const crops=[{x:0,y:238,w:768,h:548},{x:0,y:118,w:768,h:806},{x:0,y:20,w:768,h:995},
 {x:200,y:620,w:230,h:210},{x:0,y:178,w:768,h:668},{x:0,y:233,w:768,h:558}];
const chapters=[['风雪未停','营地的灯，还亮着。'],['观察','温度下降，亮度不减。'],['记录','每一次闪光，都留下证据。'],
 ['发现','蓝光，正在回应风声。'],['理解','不是失稳，是未知的规律。'],['未完','把答案，留给下一次实验。']];
const manifest={schemaVersion:1,title:'雪山回声',subtitle:'阿贝多 × 砂糖 · 雪夜观察记录',width:1080,height:1920,fps:30,
 introMs:2400,outroMs:2200,shots:[],sourceActivityId:fixture.activityId,sourceDraftVersion:row.draft_version,
 captionTiming:'Sentence duration proportional to character count; not word-level forced alignment',
 soundtrack:'Existing Step TTS, plus locally synthesized wind and crystal tones; no third-party music'};
let cursor=manifest.introMs;
for(let i=0;i<doc.shots.length;i++) {
 const shot=doc.shots[i],crop=crops[i];
 const image=await loadImage(join(source,'images',`00${i+1}-${shot.id}.png`));
 const canvas=createCanvas(crop.w,crop.h);canvas.getContext('2d').drawImage(image,crop.x,crop.y,crop.w,crop.h,0,0,crop.w,crop.h);
 const imageName=`shot-${i+1}.png`;await writeFile(join(media,imageName),await canvas.encode('png'));
 const utterance=shot.utterances[0];
 const audio=db.prepare('SELECT storage_key,local_path FROM artifacts WHERE id=?').get(utterance.selectedAudioArtifactId);
 if(!audio?.storage_key || audio.storage_key.includes('..')) throw new Error('Unsafe/missing audio storage key');
 const audioPath=join(root,'data/artifacts',audio.storage_key);
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-of','json',audioPath],{encoding:'utf8',windowsHide:true}));
 const audioMs=Math.round(Number(probe.format.duration)*1000);
 const speaker=doc.actors.find(a=>a.id===utterance.speakerActorId)?.name??'旁白';
 const text=utterance.text.replace(/^(阿贝多|砂糖)[：:]/u,'');
 const segments=text.match(/[^。！？!?]+[。！？!?]?/gu)??[text];
 const total=segments.reduce((sum,t)=>sum+Array.from(t).length,0);
 const audioStartMs=cursor+360;let position=audioStartMs;
 const captions=segments.map((text,index)=>{
   const end=index===segments.length-1?audioStartMs+audioMs:position+audioMs*Array.from(text).length/total;
   const caption={text,startMs:Math.round(position),endMs:Math.round(end),timestampMs:null,confidence:null};position=end;return caption;
 });
 const durationMs=Math.ceil((audioMs+960)/1000*30)/30*1000;
 await copyFile(audioPath,join(media,`voice-${i+1}.mp3`));
 manifest.shots.push({index:i,id:shot.id,image:imageName,imageWidth:crop.w,imageHeight:crop.h,originalCrop:crop,
  audio:`voice-${i+1}.mp3`,audioStartMs,audioMs,startMs:cursor,durationMs,endMs:cursor+durationMs,
  speaker,text,captions,chapter:chapters[i][0],headline:chapters[i][1],accent:speaker==='砂糖'?'#98c6b0':'#e2bc76'});
 cursor+=durationMs;
}
manifest.durationInFrames=Math.ceil((cursor+manifest.outroMs)/1000*30);
manifest.durationMs=manifest.durationInFrames/30*1000;
// Own deterministic audio, deliberately quiet: ambience must not mask narration.
const rate=48000,samples=Math.ceil(manifest.durationMs/1000*rate),pcm=Buffer.alloc(samples*2);
let random=1234567,low=0;
for(let n=0;n<samples;n++) {
 random=(Math.imul(random,1664525)+1013904223)>>>0;
 const noise=random/4294967296*2-1;low=low*.998+noise*.002;
 const t=n/rate;const fade=Math.min(1,t/1.5,(manifest.durationMs/1000-t)/1.8);
 let value=low*.18*fade;
 for(const shot of [manifest.shots[3]]) {
  const dt=t-shot.startMs/1000;
  if(dt>=0&&dt<1.8) value+=(Math.sin(dt*2*Math.PI*880)+.35*Math.sin(dt*2*Math.PI*1320))*.034*Math.exp(-dt*3);
 }
 pcm.writeInt16LE(Math.round(Math.max(-1,Math.min(1,value))*32767),n*2);
}
const header=Buffer.alloc(44);header.write('RIFF',0);header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);
header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(rate,24);
header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
await writeFile(join(media,'atmosphere.wav'),Buffer.concat([header,pcm]));
const args=['-y','-i',join(media,'atmosphere.wav'),...manifest.shots.flatMap(s=>['-i',join(media,s.audio)])];
const filters=manifest.shots.map((s,i)=>`[${i+1}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${Math.round(s.audioStartMs)}|${Math.round(s.audioStartMs)}[v${i}]`);
filters.push(`[0:a]aformat=sample_rates=48000:channel_layouts=stereo[amb]`);
filters.push(`[amb]${manifest.shots.map((_,i)=>`[v${i}]`).join('')}amix=inputs=7:normalize=0,alimiter=limit=0.95:level=false,apad,atrim=duration=${manifest.durationMs/1000}[a]`);
execFileSync('ffmpeg',[...args,'-filter_complex',filters.join(';'),'-map','[a]','-c:a','pcm_s16le',join(media,'soundtrack.wav')],{windowsHide:true,stdio:['ignore','ignore','pipe']});
await copyFile(join(root,'public/fonts/NotoSansSC-VF.ttf'),join(media,'NotoSansSC-VF.ttf'));
await copyFile(join(root,'public/fonts/NotoSansSC-OFL.txt'),join(media,'NotoSansSC-OFL.txt'));
await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2));
for(const folder of ['remotion/public/media','hyperframes/assets']) {
 const target=resolve(import.meta.dirname,folder);await mkdir(target,{recursive:true});
 for(const name of [...manifest.shots.map(s=>s.image),'soundtrack.wav','NotoSansSC-VF.ttf','NotoSansSC-OFL.txt']) await copyFile(join(media,name),join(target,name));
 await writeFile(join(target,'manifest.json'),JSON.stringify(manifest,null,2));
}
await writeFile(resolve(import.meta.dirname,'remotion/src/manifest.json'),JSON.stringify(manifest,null,2));
db.close();console.log(JSON.stringify({output,duration:manifest.durationMs/1000,frames:manifest.durationInFrames,shots:manifest.shots.map(s=>({start:s.startMs/1000,duration:s.durationMs/1000}))},null,2));
