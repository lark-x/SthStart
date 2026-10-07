/** Explicitly isolated acceptance fixture. Never loads .env or a user database. */
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {createCanvas} from '@napi-rs/canvas';
import {publicationFixture,addPublicationTestWorkflow,publicationObjectInfo} from '../apps/service/src/publication/fixtures.js';
import {createService} from '../apps/service/src/server.js';
import {readConfig} from '../apps/service/src/config.js';
import {SecretStore} from '../apps/service/src/security.js';

if(!process.argv.includes('--isolated'))throw new Error('Pass --isolated; this script uses only memory databases and temporary media.');
const directory=await mkdtemp(join(tmpdir(),'sthstart-publication-browser-'));
const fixture=publicationFixture(directory);addPublicationTestWorkflow(fixture.db);
const canvas=createCanvas(768,1024),ctx=canvas.getContext('2d');
ctx.fillStyle='#6b8497';ctx.fillRect(0,0,768,1024);ctx.fillStyle='#e0cc99';ctx.fillRect(120,520,540,120);ctx.fillStyle='#b4f3e5';ctx.beginPath();ctx.arc(380,480,100,0,2*Math.PI);ctx.fill();
const png=await canvas.encode('png'),tonePath=join(directory,'tone.mp3');
await promisify(execFile)('ffmpeg',['-y','-f','lavfi','-i','sine=frequency=440:duration=1','-c:a','libmp3lame',tonePath],{windowsHide:true});
const tone=await readFile(tonePath),requests:Array<{url:string;body:unknown}>=[];
let sequence=0;
const fetcher:typeof fetch=async(input,init)=>{
  const url=String(input);requests.push({url,body:typeof init?.body==='string'?JSON.parse(init.body):null});
  if(url.endsWith('/object_info'))return Response.json(publicationObjectInfo());
  if(url.endsWith('/audio/speech'))return new Response(new Uint8Array(tone),{headers:{'content-type':'audio/mpeg'}});
  if(url.endsWith('/prompt'))return Response.json({prompt_id:`synthetic-${++sequence}`});
  if(url.includes('/history/')){const id=url.split('/').pop()!;return Response.json({[id]:{outputs:{'5':{images:[{filename:`${id}.png`,subfolder:'',type:'output'}]}},status:{completed:true,status_str:'success'}}});}
  if(url.includes('/view?'))return new Response(new Uint8Array(png),{headers:{'content-type':'image/png'}});
  if(url.endsWith('/queue'))return Response.json({queue_running:[],queue_pending:[]});
  if(url.endsWith('/interrupt'))return Response.json({});
  return new Response('Unexpected synthetic endpoint',{status:404});
};
const token='publication-isolated-admin-token-12345678';
const config=readConfig({SERVICE_PORT:'4287',STHSTART_ADMIN_TOKEN:token,STHSTART_ARTIFACT_DIR:directory,STHSTART_LOG_DIR:join(directory,'logs'),PORTAL_ORIGINS:'http://127.0.0.1:4197'});
const {app}=await createService({config,database:fixture.db,secrets:new SecretStore({PUBLICATION_FIXTURE_KEY:'not-a-real-provider-key'}),fetcher});
fixture.store.saveSpeechProfile(0,{id:'fixture-speech',revision:1,name:'模拟配音（提示音）',baseUrl:'http://speech.fixture/v1',model:'fixture-tts',voices:['fixture'],defaultVoice:'fixture',speed:1,secretEnvironment:'PUBLICATION_FIXTURE_KEY'});
app.get('/fixture',async()=>({isolated:true,activityId:fixture.draft.activityId,projectId:fixture.project.id,chapterId:fixture.chapter.id}));
app.get('/fixture/requests',async()=>requests);
await app.listen({host:'127.0.0.1',port:4287});
console.log(JSON.stringify({isolated:true,service:'http://127.0.0.1:4287',activityId:fixture.draft.activityId,projectId:fixture.project.id,mediaDirectory:directory}));
let closing=false;
const close=async()=>{if(closing)return;closing=true;await app.close();fixture.db.close();await rm(directory,{recursive:true,force:true});process.exit(0);};
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
