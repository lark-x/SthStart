/** Isolated test project with REAL local ComfyUI; never opens the user's database. */
import {mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {ServiceDatabase} from '../apps/service/src/database.js';
import {StoryStore} from '../apps/service/src/story/store.js';
import {PublicationStore} from '../apps/service/src/publication/store.js';
import {applyParityConfig} from '../apps/service/src/activities/parity-config.js';
import {PARITY_BASE_PRESET,buildParityTextWorkflow} from '../apps/service/src/activities/parity-workflows.js';
import {importWorkflow} from '../apps/service/src/generation/workflow-publish.js';
import {createService} from '../apps/service/src/server.js';
import {readConfig} from '../apps/service/src/config.js';
import {SecretStore} from '../apps/service/src/security.js';
import type {PublicationDocument,StructuredVisualPrompt} from '@sthstart/contracts';

if(!process.argv.includes('--confirm-real'))throw new Error('Explicit --confirm-real required: six local images, no automatic retries or paid speech.');
const comfy='http://127.0.0.1:8188';
const queue=await fetch(`${comfy}/queue`,{signal:AbortSignal.timeout(5000)}).then(r=>r.json()) as {queue_running:unknown[];queue_pending:unknown[]};
if(queue.queue_running.length||queue.queue_pending.length)throw new Error('ComfyUI is busy; no queue interruption is permitted by this test.');
const directory=resolve('artifacts/story-publication-live',new Date().toISOString().replaceAll(':','-'));
await mkdir(directory,{recursive:true});
const databasePath=join(directory,'acceptance.db'),artifactDirectory=join(directory,'media');
const db=new ServiceDatabase(databasePath),story=new StoryStore(db),store=new PublicationStore(db,artifactDirectory);
const time=new Date().toISOString();
db.connection.prepare(`INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('activities','真实链路隔离验收','test-only','[]',1,?,?)`).run(time,time);
db.connection.prepare(`INSERT INTO generation_engines(id,name,kind,base_url,enabled,concurrency_limit,created_at,updated_at) VALUES ('publication-live-comfy','本机真实 ComfyUI','comfyui',?,1,1,?,?)`).run(comfy,time,time);
const bundle=buildParityTextWorkflow();
const initial=importWorkflow(db,{...bundle,engineId:'publication-live-comfy'});
db.connection.prepare(`INSERT INTO app_generation_assignments(app_id,purpose,workflow_id,workflow_version,engine_id,updated_at) VALUES ('activities','activity_image_text',?,?,?,?)`).run(bundle.id,initial.version,'publication-live-comfy',time);
const parity=applyParityConfig(db,{engineId:'publication-live-comfy'}),preset=parity.presets.find(p=>p.name===PARITY_BASE_PRESET.name)!;

const project=story.createProject({title:'真实验收 · 雪山回声',summary:'独立测试项目；六个关键画面，不修改现有剧情。'});
const albedo=story.createCharacter(project.id,{name:'阿贝多',notes:'原神，浅金发，青绿色眼睛，白色炼金术士外套。'});
const sucrose=story.createCharacter(project.id,{name:'砂糖',notes:'原神，浅绿色短发，圆眼镜，白蓝色炼金术士服装。'});
const chapter=story.createDocument(project.id,{kind:'chapter',title:'雪山回声',body:`# 雪山回声\n\n傍晚，风雪包围营地。阿贝多发现试管中的星银结晶不再随温度下降而黯淡。\n\n阿贝多轻轻举起试管，砂糖翻开实验记录。他们观察到晶体在轻微振动之后出现规律的蓝色闪光。砂糖误以为这是危险的失稳反应，阿贝多让她先比较记录。\n\n两人在实验桌旁确认闪光与营地外的风声同步。阿贝多将试管放回木架，决定只做观察，不继续加热。砂糖记录了结论：这不是结束，而是下一次实验的问题。`});
const revision=story.listEntryRevisions(project.id,'chapter',chapter.id)[0],created=store.create(project.id,[revision.id]);
const actors=created.document.actors.map(a=>({...a,universe:'Genshin Impact',visualDescription:a.id===albedo.id?'blond braided hair, teal eyes, white and navy alchemist coat':'mint-green bob hair, round glasses, white and navy alchemist uniform'}));
const characterPrompt=(id:string,action:string):StructuredVisualPrompt['actors'][number]=>({actorId:id,identity:[id===albedo.id?'albedo (genshin impact), 1boy':'sucrose (genshin impact), 1girl'],appearance:[id===albedo.id?'blond hair, teal eyes':'mint-green hair, round glasses'],clothing:[id===albedo.id?'white alchemist coat, navy blue clothing, black gloves':'white and navy alchemist uniform'],action:[action],expression:['focused expression']});
const frames=[
  {ids:[],title:'风雪中的营地',camera:'wide establishing shot',detail:'snowy mountain camp at dusk, wooden alchemy table under an open tent, warm lantern',line:'风雪又一次封住了山路，营地的灯却还亮着。新的结晶在试管里发出微光，和往常的反应不太一样。'},
  {ids:[albedo.id],title:'阿贝多举起试管',camera:'medium close-up shot',detail:'holding one small glass test tube at eye level, studying tiny glowing blue crystals',line:'阿贝多：温度还在下降，晶体的亮度却没有减弱。先别加热，我想看看它在自然条件下会发生什么。'},
  {ids:[sucrose.id],title:'砂糖检查实验记录',camera:'medium shot',detail:'looking down at an open laboratory notebook on a wooden table, one hand holding a pencil',line:'砂糖：前几次实验都没有出现这种变化。会不会是催化剂发生了失稳？我把每一次闪光的时间都记下来。'},
  {ids:[],title:'结晶发出规律闪光',camera:'extreme close-up detail shot',detail:'a single glass test tube on a wooden test tube rack, tiny icy-blue star-shaped crystals, no people',line:'微弱的蓝光一明一暗。仔细听，闪光之间的间隔，竟然和营地外一阵阵掠过的风声渐渐重合。'},
  {ids:[albedo.id,sucrose.id],title:'两人比对记录',camera:'two-person medium shot',detail:'Albedo on the left pointing at one test tube, Sucrose on the right holding an open notebook, separated figures beside a wooden laboratory table',line:'阿贝多：别急着给它取名字。砂糖，把风声也记下来。我们看到的也许不是不稳定，而是还没有理解的规律。'},
  {ids:[sucrose.id],title:'砂糖记录新的问题',camera:'medium close-up shot',detail:'smiling softly while writing in a notebook beside a warm camp lantern, snow visible beyond the tent',line:'砂糖：明白了。今天先保留观察结果，不继续加热。这个问题就留给下一次实验吧——雪山似乎也在回答我们。'},
];
const document:PublicationDocument={...created.document,actors,synopsis:'六个关键画面表现雪山中的一次观察与讨论。',shots:frames.map((f,i)=>({id:`live-shot-${i}`,sourceRefs:[revision.id],actorIds:f.ids,visualDescription:f.title,structuredPrompt:{actors:f.ids.map(id=>characterPrompt(id,f.detail)),camera:[f.camera],scene:['Dragonspine snowy mountain alchemy camp at dusk'],details:[f.detail],naturalLanguage:`Anime illustration of ${f.detail}. Clear readable composition with the important action in the center.`},renderSettings:{presetId:preset.id,presetRevision:1,workflowId:parity.workflowId,workflowVersion:parity.workflowVersion,parameters:{width:768,height:1024}},selectedImage:null,presentation:i===3?'push_in':'still',utterances:[{id:`live-utterance-${i}`,speakerActorId:null,text:f.line,voiceBindingId:null,selectedAudioArtifactId:null}]})),publishingCopy:{title:'雪山回声｜阿贝多与砂糖的观察记录',description:'原神同人短篇技术验收，非官方剧情。画面由本机 ComfyUI 生成，文字单独排版。',tags:['原神','阿贝多','砂糖','同人剧情']}};
store.save(created.activityId,1,document);
const requests:Array<{url:string;status?:number}>=[];
const fetcher:typeof fetch=async(input,init)=>{
  const url=String(input);requests.push({url});
  if(!url.startsWith(comfy+'/'))throw new Error('This acceptance fixture only permits the local ComfyUI; no paid provider calls.');
  const response=await fetch(input,init);requests[requests.length-1].status=response.status;return response;
};
const config={...readConfig({SERVICE_PORT:'4287',STHSTART_ADMIN_TOKEN:'publication-isolated-admin-token-12345678',STHSTART_ARTIFACT_DIR:artifactDirectory,STHSTART_LOG_DIR:join(directory,'logs'),PORTAL_ORIGINS:'http://127.0.0.1:4197'}),databasePath,narrativeDatabasePath:join(directory,'narrative.db')};
const {app}=await createService({config,database:db,secrets:new SecretStore({}),fetcher});
app.get('/fixture',async()=>({isolated:true,realImageProvider:true,makeVideo:false,outputDirectory:directory,activityId:created.activityId,projectId:project.id,chapterId:chapter.id,workflowId:parity.workflowId,model:'anima_baseV10.safetensors'}));
app.get('/fixture/requests',async()=>requests);
await app.listen({host:'127.0.0.1',port:4287});
console.log(JSON.stringify({isolated:true,realImageProvider:true,outputDirectory:directory,activityId:created.activityId,projectId:project.id}));
let closing=false;
const close=async()=>{if(closing)return;closing=true;await app.close();db.close();process.exit(0);};
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
