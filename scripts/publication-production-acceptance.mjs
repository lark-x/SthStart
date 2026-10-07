#!/usr/bin/env node
/**
 * 生产 Docker + Portal 全链路验收控制脚本（保留人工审批，不绕过）。
 *
 * 本脚本只做编排：通过 @playwright/test 的 APIRequestContext 在 localhost:9320 建立
 * 管理员会话，随后只用 Portal 的 /api/admin/... 管理接口驱动真实的剧情 → 发布链路。
 * 它不读取、不打印任何密钥；管理员会话 Cookie 与 CSRF 令牌按敏感数据处理。
 *
 * 注意：真实付费调用只有付费图片与 TTS。export 的视频封装是调用方本机 CPU 转码，
 * 不是模型付费调用，因此不需要 --confirm-paid；它用 activityId+draftVersion 稳定幂等键防止重复导出。
 *
 * 子命令：
 *   create  --confirm
 *       新建标题带「发布全链路验收」的测试 Story 项目、阿贝多与砂糖、约 300 字的
 *       「雪山回声」章节，以及以该章节版本冻结来源的发布草稿空壳（六个关键镜头的英文
 *       提示词与 768×1024 尺寸，尚未生成任何图片或配音）。只写
 *       artifacts/publication-production/<时间戳>/fixture.json（仅 ID 与输出目录）。
 *       不生成 bridge grant，不配对 DSH（由主进程处理）。
 *   prepare --fixture [路径]
 *       创建独立配音配置（引用 GET publication/speech-models 中的
 *       conn-mut24bmg-stepaudio-2-5-tts，声音 cixingnansheng，语速 1；同 ID 不重复创建），
 *       读取发布草稿供人工审阅，请求 preview 并保存 preview.json，不批准。
 *   run --fixture [路径] --confirm-paid
 *       校验六个镜头、英文提示词字段与 768×1024 尺寸，管理员 approve（图片额度 8 =
 *       首轮 6 + 2 次人工重绘预算，配音额度 = 对白精确字符数）后 start；轮询持久状态，
 *       写安全 report。unknown/failed 立即停止，不自动重试、不自动重绘。stdout 只输出
 *       状态与计数，不打印全文。
 *   export --fixture [路径]
 *       确认六张选图与全部配音齐全后调用 exports（幂等键按 activityId+draftVersion 稳定，
 *       仅本机 CPU 转码，不重新发起任何付费模型调用），下载 zip/cover/video 到输出目录，
 *       并校验 ZIP 的固定结构、确认其中没有疑似密钥文本。不重新生图、不重新配音。
 *   download-images --fixture [路径]
 *       只读把当前草稿的六张选图下载到 output/images 供人工视觉审核；不生成、不修改。
 *   status --fixture [路径]
 *       只读查看项目、草稿、最近审批、运行与媒体可用性。
 *
 * 重要：--confirm-paid 是调用者对本次付费测试预算的显式批准；缺少它时 run 直接拒绝执行。
 * 人工审批机制必须保留：每次真实制作都需要管理员 approve，脚本不会代持长期批准。
 */
import {request} from '@playwright/test';
import {mkdir,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {unzipSync,strFromU8} from 'fflate';

const PORTAL='http://localhost:9320';
const OUTPUT_ROOT=resolve('artifacts/publication-production');
const TITLE_TAG='发布全链路验收';
const SPEECH_MODEL_ID='conn-mut24bmg-stepaudio-2-5-tts';
const SPEECH_PROFILE_ID='production-acceptance-speech';
const VOICE='cixingnansheng';
const SPEECH_SPEED=1;
const SHOT_WIDTH=768;
const SHOT_HEIGHT=1024;
const SHOT_COUNT=6;
const IMAGE_BUDGET=8; // 首轮 6 张 + 2 次人工重绘预算
const RUN_POLL_MS_DEFAULT=10000;
const RUN_POLL_MS_IDLE=20000;
const RUN_TIMEOUT_MS=45*60*1000;
const EXPORT_TIMEOUT_MS=20*60*1000;
const IDEMPOTENCY_INDEX_FILE='idempotency.json';
const TERMINAL=['succeeded','failed','unknown','interrupted','stopped'];
const ZIP_TEXT_ENTRIES=['manifest.json','publish-copy.md','subtitles.srt'];
/**
 * 精确整串令牌：只在字符串整体形如密钥时才命中，避免把正常 manifest 里的
 * revisionId、artifact 十六进制 ID、conn-... 连接 ID 或时间戳误判成密钥。
 */
const SECRET_EXACT=[/^sk-[A-Za-z0-9_-]{16,}$/,/^sk-proj-[A-Za-z0-9_-]{16,}$/,/^pub_[0-9a-fA-F]{32}$/,/^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/];
const SECRET_KEY_NAMES=/^(?:api[_-]?key|apikey|authorization|access[_-]?token|secret|secret[_-]?key|client[_-]?secret|password|credential|bearer|token)$/i;
const SECRET_ASSIGNMENT=/\b(?:api[_-]?key|apikey|secret[_-]?key|client[_-]?secret|access[_-]?token|password)\b\s*[:=]\s*["']?[A-Za-z0-9_\-]{12,}/i;
const BEARER_TOKEN=/\bBearer\s+[A-Za-z0-9._-]{20,}/;
const ADMIN_TOKEN_HEADER=/x-sthstart-admin-token/i;
function findSecretLeaks(value,name){
  const leaks=[];
  const scan=(item,path)=>{
    if(typeof item==='string'){
      if(BEARER_TOKEN.test(item)) leaks.push(path+'：出现 Bearer 令牌');
      else if(SECRET_ASSIGNMENT.test(item)) leaks.push(path+'：出现密钥式赋值');
      else if(SECRET_EXACT.some(pattern=>pattern.test(item))) leaks.push(path+'：疑似令牌字符串');
      return;
    }
    if(Array.isArray(item)){ item.forEach((child,index)=>scan(child,path+'['+index+']')); return; }
    if(item&&typeof item==='object'){
      for(const [key,child] of Object.entries(item)){
        if(SECRET_KEY_NAMES.test(key)&&typeof child==='string'&&child.length>=8) leaks.push(path+'.'+key+'：出现密钥字段名');
        else scan(child,path+'.'+key);
      }
    }
  };
  scan(value,name);
  return [...new Set(leaks)];
}

const CHAPTER_BODY=[
  '傍晚，风雪再次封住山路，雪山营地的灯还亮着。阿贝多发现试管里的星银结晶并没有随温度下降而黯淡，他轻轻举起试管，让晶体靠近灯火。',
  '砂糖翻开实验记录，把每一次闪光的间隔都写下来。她原以为这是危险的失稳反应，想让阿贝多立刻停下实验。',
  '两人把记录并排放在木桌上比对，才发现蓝色闪光的节奏和营地外掠过的风声渐渐重合。阿贝多把试管放回木架，决定今夜只观察、不继续加热。',
  '砂糖在记录末尾写下结论：这不是结束，而是留给下一次实验的问题。雪山似乎也在用风声回答他们，他们把安静的雪夜当作一次漫长的对照实验。',
].join('\n\n');

class AcceptanceError extends Error {}

let ctx=null;
let csrfToken='';
const flags=new Set();
const kv={};

function log(message){ console.log(message); }
function fail(message){ throw new AcceptanceError(message); }
function sleep(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }

async function ensureSession(){
  if(!ctx) ctx=await request.newContext({baseURL:PORTAL,extraHTTPHeaders:{origin:PORTAL}});
  if(csrfToken) return;
  let response;
  try{
    response=await ctx.post('/api/auth/admin-session',{headers:{origin:PORTAL}});
  }catch(error){
    fail('无法连接 Portal '+PORTAL+'（'+describeNetworkError(error)+'）。请确认生产 Docker 与 Portal 已启动。');
  }
  if(!response.ok()){
    const detail=await response.text().catch(()=>'');
    fail('无法建立管理员会话（HTTP '+response.status()+'）'+(detail?'：'+detail.slice(0,200):'')+'。请确认 Portal 已在 '+PORTAL+' 运行且会话密钥已配置。');
  }
  const payload=await response.json().catch(()=>null);
  if(!payload||!payload.csrfToken) fail('管理员会话缺少 CSRF 令牌，拒绝继续。');
  csrfToken=payload.csrfToken;
}

function describeNetworkError(error){
  const message=error instanceof Error?error.message:String(error);
  if(/ECONNREFUSED|fetch failed|connect|ENOTFOUND/i.test(message)) return '连接被拒绝或网络不可达';
  return message.slice(0,160);
}

async function api(method,path,options){
  const data=options&&'data' in options?options.data:undefined;
  await ensureSession();
  const headers={origin:PORTAL};
  if(data!==undefined) headers['content-type']='application/json';
  if(method!=='GET') headers['x-sthstart-csrf']=csrfToken;
  let response;
  try{
    response=await ctx.fetch(path,{method,headers,data:data===undefined?undefined:JSON.stringify(data)});
  }catch(error){
    fail('请求管理接口 '+method+' '+path+' 失败：'+describeNetworkError(error)+'。已停止，不重试。');
  }
  const text=await response.text();
  let body=null;
  try{ body=text?JSON.parse(text):null; }catch{ body=text; }
  if(!response.ok()){
    const message=(body&&typeof body==='object'&&(body.message||body.error))||('HTTP '+response.status());
    fail('管理接口 '+method+' '+path+' 失败：'+message+'（HTTP '+response.status()+'）');
  }
  return body;
}

async function downloadArtifact(artifactId,filePath){
  await ensureSession();
  const response=await ctx.get('/api/admin/artifacts/'+encodeURIComponent(artifactId)+'/file');
  if(!response.ok()) fail('下载产物 '+artifactId+' 失败（HTTP '+response.status()+'）。');
  await writeFile(filePath,await response.body());
  return filePath;
}

async function readIdempotency(outputDir){
  const path=join(outputDir,IDEMPOTENCY_INDEX_FILE);
  if(!existsSync(path)) return {};
  try{ return JSON.parse(await readFile(path,'utf8')); }
  catch{ fail('无法解析 '+path+'；请检查该文件或删除后重试。'); }
}

async function writeIdempotency(outputDir,index){
  await writeFile(join(outputDir,IDEMPOTENCY_INDEX_FILE),JSON.stringify(index,null,2));
}

/** 已存在的 approval 本身即“已确认”，重跑不会重新批准；键随草稿版本+配置指纹固定。 */
async function ensureRunApproval(fixture,draft,preview,speechCharacters){
  const state=await api('GET','/api/admin/activities/'+fixture.activityId+'/publication/state');
  const approval=state.approval;
  const matches=approval&&approval.draftVersion===draft.draftVersion&&approval.configHash===preview.configHash
    &&approval.speechProfileId===SPEECH_PROFILE_ID&&approval.imageBudget===IMAGE_BUDGET&&approval.makeVideo===true
    &&approval.speechCharacterBudget===speechCharacters;
  if(matches){ log('复用已有管理员审批：'+approval.id+'（不重复批准）。'); return {approval,created:false}; }
  const created=await api('POST','/api/admin/activities/'+fixture.activityId+'/publication/approvals',{data:{
    expectedDraftVersion:draft.draftVersion,speechProfileId:SPEECH_PROFILE_ID,makeVideo:true,imageBudget:IMAGE_BUDGET,speechCharacterBudget:speechCharacters,expectedConfigHash:preview.configHash,
  }});
  return {approval:created,created:true};
}

/**
 * 幂等键在运行成功前保持稳定：POST 之前先把键写入 idempotency.json，网络中断后重跑会复用
 * 同一键，而不是生成新键重复制作；成功返回后再补 runId。
 */
async function ensureRunStart(fixture,approvalId){
  const outputDir=fixture.outputDir;
  const index=await readIdempotency(outputDir);
  const existing=index.run;
  const reuse=existing&&existing.approvalId===approvalId&&existing.key;
  const key=reuse?existing.key:'prod-acceptance-run-'+Date.now();
  if(!reuse){ index.run={approvalId,key}; await writeIdempotency(outputDir,index); }
  const run=await api('POST','/api/admin/activities/'+fixture.activityId+'/publication/runs',{data:{approvalId,idempotencyKey:key}});
  index.run={approvalId,key,runId:run.id};
  await writeIdempotency(outputDir,index);
  return run;
}
async function resolveFixturePath(explicit){
  if(explicit){
    const target=resolve(explicit);
    return existsSync(target)&&(await stat(target)).isDirectory()?join(target,'fixture.json'):target;
  }
  if(!existsSync(OUTPUT_ROOT)) fail('尚未找到验收输出目录，请先运行 create --confirm。');
  const names=(await readdir(OUTPUT_ROOT,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort();
  if(!names.length) fail('验收输出目录为空，请先运行 create --confirm。');
  const candidate=join(OUTPUT_ROOT,names[names.length-1],'fixture.json');
  if(!existsSync(candidate)) fail('最新输出目录缺少 fixture.json：'+candidate);
  return candidate;
}

async function loadFixture(explicit){
  let fixturePath;
  try{ fixturePath=await resolveFixturePath(explicit); }
  catch(error){ fail('无法定位 fixture：'+describeNetworkError(error)); }
  if(!existsSync(fixturePath)) fail('找不到 fixture.json：'+fixturePath+'。请先运行 create --confirm，或用 --fixture 指向正确的文件/目录。');
  let fixture;
  try{ fixture=JSON.parse(await readFile(fixturePath,'utf8')); }
  catch{ fail('fixture.json 无法解析：'+fixturePath); }
  if(!fixture||!fixture.activityId||!fixture.projectId||!fixture.outputDir) fail('fixture.json 缺少 activityId、projectId 或 outputDir，请重新运行 create --confirm。');
  const outputDir=resolve(fixture.outputDir);
  if(!existsSync(outputDir)) fail('fixture 指向的输出目录不存在：'+outputDir);
  return {fixturePath,fixture,outputDir};
}

/**
 * 只读校验：fixture 必须指向本次新建的「发布全链路验收」项目，且草稿来源项目一致。
 * prepare/run/export/download-images 共用，避免误把真实项目当成验收对象。
 */
async function assertAcceptanceDraft(draft,fixture){
  let project;
  try{ project=await api('GET','/api/admin/story/projects/'+fixture.projectId); }
  catch(error){ fail('无法读取 fixture 项目 '+fixture.projectId+'：'+(error instanceof Error?error.message:String(error))); }
  if(!project||typeof project.title!=='string'||!project.title.includes(TITLE_TAG)) fail('fixture 项目标题不含「'+TITLE_TAG+'」，已拒绝在非验收项目上操作。');
  const sourceProjectId=draft&&draft.document&&draft.document.source?draft.document.source.storyProjectId:null;
  if(sourceProjectId!==fixture.projectId) fail('草稿来源项目与 fixture 不一致，已拒绝在非新建验收项目上操作。');
  return project;
}

/** 读取草稿并做项目/来源校验，供 prepare/run/export/download-images 复用。 */
async function loadAcceptanceDraft(fixture){
  const draft=await api('GET','/api/admin/activities/'+fixture.activityId+'/publication');
  await assertAcceptanceDraft(draft,fixture);
  return draft;
}

function characterPrompt(actorId,action,kind){
  if(kind==='albedo') return {actorId,identity:['albedo (genshin impact), 1boy'],appearance:['blond braided hair, teal eyes'],clothing:['white alchemist coat, navy blue clothing, black gloves'],action:[action],expression:['focused expression']};
  return {actorId,identity:['sucrose (genshin impact), 1girl'],appearance:['mint-green bob hair, round glasses'],clothing:['white and navy alchemist uniform'],action:[action],expression:['focused expression']};
}

function buildShots(revisionId,albedoId,sucroseId){
  const frames=[
    {ids:[],title:'风雪中的营地',camera:'wide establishing shot',detail:'snowy mountain camp at dusk, wooden alchemy table under an open tent, warm lantern, falling snow',line:'风雪又一次封住了山路，营地的灯却还亮着。新的结晶在试管里发出微光，和往常的反应不太一样。'},
    {ids:[albedoId],title:'阿贝多举起试管',camera:'medium close-up shot',detail:'holding one small glass test tube at eye level, studying tiny glowing blue crystals',line:'阿贝多：温度还在下降，晶体的亮度却没有减弱。先别加热，我想看看它在自然条件下会发生什么。'},
    {ids:[sucroseId],title:'砂糖检查实验记录',camera:'medium shot',detail:'looking down at an open laboratory notebook on a wooden table, one hand holding a pencil',line:'砂糖：前几次实验都没有出现这种变化。会不会是催化剂失稳？我把每一次闪光的时间都记下来。'},
    {ids:[],title:'结晶规律闪光',camera:'extreme close-up detail shot',detail:'a single glass test tube on a wooden rack, tiny icy-blue star-shaped crystals, no people',line:'微弱的蓝光一明一暗。闪光之间的间隔，竟然和营地外一阵阵掠过的风声渐渐重合。'},
    {ids:[albedoId,sucroseId],title:'两人比对记录',camera:'two-person medium shot',detail:'Albedo on the left pointing at one test tube, Sucrose on the right holding an open notebook, separated figures beside a wooden laboratory table',line:'阿贝多：别急着给它取名字。砂糖，把风声也记下来。我们看到的也许不是不稳定，而是还没有理解的规律。'},
    {ids:[sucroseId],title:'砂糖记录新的问题',camera:'medium close-up shot',detail:'smiling softly while writing in a notebook beside a warm camp lantern, snow visible beyond the tent',line:'砂糖：明白了。今天先保留观察结果，不继续加热。这个问题就留给下一次实验吧——雪山似乎也在回答我们。'},
  ];
  return frames.map((frame,index)=>({
    id:'prod-shot-'+(index+1),
    sourceRefs:[revisionId],
    actorIds:frame.ids,
    visualDescription:frame.title,
    structuredPrompt:{
      actors:frame.ids.map(id=>characterPrompt(id,frame.detail,id===albedoId?'albedo':'sucrose')),
      camera:[frame.camera],
      scene:['Dragonspine snowy mountain alchemy camp at dusk'],
      details:[frame.detail],
      naturalLanguage:'Anime illustration of '+frame.detail+'. Clear readable composition with the important action in the center.',
    },
    renderSettings:{parameters:{width:SHOT_WIDTH,height:SHOT_HEIGHT}},
    selectedImage:null,
    utterances:[{id:'prod-utterance-'+(index+1),speakerActorId:frame.ids.length===1?frame.ids[0]:null,text:frame.line,voiceBindingId:null,selectedAudioArtifactId:null}],
    presentation:index===3?'push_in':'still',
  }));
}

async function commandCreate(){
  if(!flags.has('--confirm')) fail('create 需要显式 --confirm：它会在生产 Portal 上创建一个新的测试剧情项目。');
  const outputDir=resolve(OUTPUT_ROOT,new Date().toISOString().replaceAll(':','-'));
  await mkdir(outputDir,{recursive:true});
  await ensureSession();
  log('管理员会话已建立；输出目录 '+outputDir);

  const project=await api('POST','/api/admin/story/projects',{data:{
    title:TITLE_TAG+' · 雪山回声 · '+Date.now(),
    summary:'生产 Docker + Portal 全链路验收专用测试项目；六镜头剧情，不修改任何现有剧情项目。',
  }});
  const albedo=await api('POST','/api/admin/story/projects/'+project.id+'/characters',{data:{name:'阿贝多',notes:'原神，浅金发，青绿色眼睛，白色炼金术士外套。'}});
  const sucrose=await api('POST','/api/admin/story/projects/'+project.id+'/characters',{data:{name:'砂糖',notes:'原神，浅绿色短发，圆眼镜，白蓝色炼金术士服装。'}});
  const chapter=await api('POST','/api/admin/story/projects/'+project.id+'/documents',{data:{kind:'chapter',title:'雪山回声',body:CHAPTER_BODY}});
  const revisions=await api('GET','/api/admin/story/projects/'+project.id+'/entries/chapter/'+chapter.id+'/revisions');
  const revision=revisions&&revisions.items?revisions.items[0]:null;
  if(!revision||!revision.id) fail('未能取得「雪山回声」章节的不可变版本。');

  const draft=await api('POST','/api/admin/story/projects/'+project.id+'/publications',{data:{entryRevisionIds:[revision.id]}});
  const actorIds=new Set(draft.document.actors.map(actor=>actor.id));
  if(!actorIds.has(albedo.id)||!actorIds.has(sucrose.id)) fail('发布草稿未包含本次创建的阿贝多与砂糖。');
  const actors=draft.document.actors.map(actor=>({...actor,universe:'Genshin Impact',visualDescription:actor.id===albedo.id?'blond braided hair, teal eyes, white and navy alchemist coat':'mint-green bob hair, round glasses, white and navy alchemist uniform'}));
  const document={
    ...draft.document,
    actors,
    synopsis:'六个关键画面表现雪山营地里的一次观察与讨论。',
    publishingCopy:{title:'雪山回声｜阿贝多与砂糖的观察记录',description:'原神同人短篇全链路验收，非官方剧情。',tags:['原神','阿贝多','砂糖','同人剧情']},
    shots:buildShots(revision.id,albedo.id,sucrose.id),
  };
  const saved=await api('PUT','/api/admin/activities/'+draft.activityId+'/publication',{data:{expectedDraftVersion:draft.draftVersion,document}});
  if(saved.document.shots.length!==SHOT_COUNT) fail('发布草稿镜头数异常：'+saved.document.shots.length);

  const fixture={
    outputDir,
    projectId:project.id,
    chapterId:chapter.id,
    chapterRevisionId:revision.id,
    characters:{albedo:albedo.id,sucrose:sucrose.id},
    activityId:draft.activityId,
    shotIds:saved.document.shots.map(shot=>shot.id),
  };
  await writeFile(join(outputDir,'fixture.json'),JSON.stringify(fixture,null,2));
  log('测试项目已创建：projectId='+project.id+' activityId='+draft.activityId+' 镜头数='+saved.document.shots.length);
  log('未生成 bridge grant，也未配对 DSH；后续由主进程处理。下一步：prepare --fixture');
}

async function resolveSpeechModel(){
  const models=await api('GET','/api/admin/publication/speech-models');
  const model=models&&models.items?models.items.find(item=>item.modelProfileId===SPEECH_MODEL_ID):null;
  if(!model) fail('未在 publication/speech-models 找到 '+SPEECH_MODEL_ID+'，请先在运行中的 Service 配置该 TTS 模型。');
  if(!model.hasCredential) log('提醒：模型 '+SPEECH_MODEL_ID+' 当前未报告可用凭据，真实配音可能失败。');
  return model;
}

function sameProfile(current,next){
  const keys=['name','baseUrl','model','defaultVoice','speed','secretEnvironment','connectionId'];
  return Boolean(current)&&keys.every(key=>current[key]===next[key])&&JSON.stringify(current.voices)===JSON.stringify(next.voices);
}

async function ensureSpeechProfile(model){
  const profile={
    id:SPEECH_PROFILE_ID,
    revision:1,
    name:model.name,
    baseUrl:model.baseUrl,
    model:model.model,
    voices:[VOICE],
    defaultVoice:VOICE,
    speed:SPEECH_SPEED,
    secretEnvironment:'STHSTART_SECRET_'+String(model.connectionId).toUpperCase().replace(/[^A-Z0-9]/g,'_'),
    connectionId:model.connectionId,
  };
  const list=await api('GET','/api/admin/publication/speech-profiles');
  const current=list&&list.items?list.items.find(item=>item.id===SPEECH_PROFILE_ID):null;
  if(current&&sameProfile(current,profile)) return {profile:current,created:false};
  const expectedRevision=current?current.revision:0;
  const saved=await api('PUT','/api/admin/publication/speech-profiles',{data:{expectedRevision,profile:{...profile,revision:expectedRevision+1}}});
  return {profile:saved,created:!current};
}

async function commandPrepare(){
  const loaded=await loadFixture(kv.fixture);
  const fixture=loaded.fixture,outputDir=loaded.outputDir;
  await ensureSession();
  const draft=await loadAcceptanceDraft(fixture);
  if(draft.document.shots.length!==SHOT_COUNT) fail('草稿镜头数不是 '+SHOT_COUNT+'，请先回到 create 步骤检查。');
  const model=await resolveSpeechModel();
  const result=await ensureSpeechProfile(model);
  log('配音配置'+(result.created?'已创建':'已复用')+'：'+result.profile.id+'（模型 '+model.model+'，声音 '+result.profile.defaultVoice+'，语速 '+result.profile.speed+'）');

  const preview=await api('POST','/api/admin/activities/'+fixture.activityId+'/publication/preview',{data:{
    expectedDraftVersion:draft.draftVersion,speechProfileId:result.profile.id,makeVideo:true,
  }});
  if(preview.shots.length!==SHOT_COUNT) fail('preview 镜头数不是 '+SHOT_COUNT+'。');
  await writeFile(join(outputDir,'preview.json'),JSON.stringify(preview,null,2));
  log('草稿 v'+draft.draftVersion+' 待人工审阅（未批准）：');
  preview.shots.forEach((shot,index)=>{
    const prompt=shot.positivePrompt||'';
    log('  镜头 '+(index+1)+'：'+prompt.slice(0,160)+(prompt.length>160?'…':''));
  });
  log('preview 已保存到 '+join(outputDir,'preview.json')+'；如需制作请人工确认后运行 run --fixture --confirm-paid');
}

function assertPreview(preview){
  preview.shots.forEach((shot,index)=>{
    const parameters=shot.parameters||{};
    if(Number(parameters.width)!==SHOT_WIDTH||Number(parameters.height)!==SHOT_HEIGHT){
      fail('镜头 '+(index+1)+' 的 width/height 未解析为 '+SHOT_WIDTH+'×'+SHOT_HEIGHT+'（实际 '+parameters.width+'×'+parameters.height+'），已停止，不做任何提交。');
    }
    if(!/[a-zA-Z]{3}/.test(String(shot.positivePrompt||''))) fail('镜头 '+(index+1)+' 缺少英文提示词字段，已停止，不做任何提交。');
  });
}

function taskCounts(run){
  const counts={};
  for(const task of run.tasks){
    if(!counts[task.kind]) counts[task.kind]={};
    counts[task.kind][task.status]=(counts[task.kind][task.status]||0)+1;
  }
  return counts;
}

function taskProgress(run){
  const counts=taskCounts(run);
  return Object.keys(counts).sort().map(kind=>{
    const parts=Object.keys(counts[kind]).sort().map(status=>status+'='+counts[kind][status]);
    return kind+'{'+parts.join(',')+'}';
  }).join(' ');
}

async function pollRun(fixture,runId,predicate,timeoutMs){
  const deadline=Date.now()+timeoutMs;
  let lastStatus=null,lastProgress=null,idle=false;
  while(Date.now()<deadline){
    const run=await api('GET','/api/admin/activities/'+fixture.activityId+'/publication/runs/'+runId);
    const progress=taskProgress(run);
    if(run.status!==lastStatus){
      idle=false;
      log('运行 '+runId+' 状态：'+run.status+'（图片 '+run.imagesUsed+'/'+IMAGE_BUDGET+'，配音字 '+run.speechCharactersUsed+'） 任务 '+progress);
    } else if(progress!==lastProgress){
      idle=false;
      log('运行 '+runId+' 子任务进展：'+progress+'（图片 '+run.imagesUsed+'/'+IMAGE_BUDGET+'，配音字 '+run.speechCharactersUsed+'）');
    } else if(!idle){
      idle=true;
      log('运行 '+runId+' 暂无变化（'+run.status+'），等待中… 任务 '+progress);
    }
    lastStatus=run.status;lastProgress=progress;
    if(predicate(run)) return run;
    await sleep(idle?RUN_POLL_MS_IDLE:RUN_POLL_MS_DEFAULT);
  }
  fail('轮询超时；状态仍未确定，脚本不会再提交或重试，请人工检查运行状态。');
}

async function commandRun(){
  if(!flags.has('--confirm-paid')) fail('run 需要显式 --confirm-paid：它代表调用者批准本次真实制作与付费模型预算（付费图片与 TTS），且不会自动重绘或重试。');
  const loaded=await loadFixture(kv.fixture);
  const fixture=loaded.fixture,outputDir=loaded.outputDir;
  await ensureSession();
  const draft=await loadAcceptanceDraft(fixture);
  if(draft.document.shots.length!==SHOT_COUNT) fail('run 只允许 '+SHOT_COUNT+' 个镜头的新建验收项目，当前为 '+draft.document.shots.length+'。');
  const preview=await api('POST','/api/admin/activities/'+fixture.activityId+'/publication/preview',{data:{
    expectedDraftVersion:draft.draftVersion,speechProfileId:SPEECH_PROFILE_ID,makeVideo:true,
  }});
  assertPreview(preview);
  const utterances=draft.document.shots.flatMap(shot=>shot.utterances);
  const speechCharacters=utterances.filter(utterance=>!utterance.selectedAudioArtifactId).reduce((total,utterance)=>total+utterance.text.length,0);
  const approved=await ensureRunApproval(fixture,draft,preview,speechCharacters);
  const approval=approved.approval;
  const started=await ensureRunStart(fixture,approval.id);
  log('已按管理员审批启动运行：approvalId='+approval.id+'（'+(approved.created?'新批准':'复用')+'） runId='+started.id);
  const run=await pollRun(fixture,started.id,candidate=>{
    if(TERMINAL.includes(candidate.status)) return true;
    return candidate.tasks.some(task=>['failed','unknown','interrupted'].includes(task.status));
  },RUN_TIMEOUT_MS);
  if(run.status==='succeeded'){
    const index=await readIdempotency(outputDir);
    index.run={...(index.run||{}),runId:run.id,status:'succeeded',completedAt:new Date().toISOString()};
    await writeIdempotency(outputDir,index);
  }
  const failures=run.tasks.filter(task=>['failed','unknown','interrupted'].includes(task.status)).map(task=>({kind:task.kind,status:task.status,error:(task.error||'').slice(0,200)}));
  const report={
    runId:run.id,approvalId:run.approvalId,status:run.status,
    imagesUsed:run.imagesUsed,speechCharactersUsed:run.speechCharactersUsed,
    imageBudget:IMAGE_BUDGET,speechCharacterBudget:speechCharacters,
    tasks:taskCounts(run),
    failures,
    regeneration:{automaticRetry:false,automaticRedraw:false,manualRedrawBudget:IMAGE_BUDGET-SHOT_COUNT},
  };
  await writeFile(join(outputDir,'run-report.json'),JSON.stringify(report,null,2));
  if(run.status!=='succeeded'){
    const summary=failures.length?('不确定或失败子任务：'+failures.map(item=>item.kind+':'+item.status).join(', ')):('运行状态 '+run.status);
    fail('运行未成功（'+summary+'），已立即停止且不自动重试；详情见 '+join(outputDir,'run-report.json')+'。');
  }
  log('运行成功：imagesUsed='+run.imagesUsed+' speechCharactersUsed='+run.speechCharactersUsed+' 任务='+JSON.stringify(report.tasks));
  log('未自动重绘、未自动重试。下一步：export --fixture');
}

function analyzeZip(buffer){
  let entries;
  try{ entries=unzipSync(new Uint8Array(buffer)); }
  catch{ fail('导出 ZIP 无法解析，可能已损坏。'); }
  const names=Object.keys(entries).sort();
  const images=Array.from({length:SHOT_COUNT},(_,index)=>'images/page-'+String(index+1).padStart(3,'0')+'.png');
  const expected=[...images,'cover.png','video.mp4','subtitles.srt','publish-copy.md','manifest.json'].sort();
  const missing=expected.filter(name=>!names.includes(name));
  const extra=names.filter(name=>!expected.includes(name));
  const leaks=[];
  for(const name of names){
    if(!ZIP_TEXT_ENTRIES.includes(name)) continue;
    const text=strFromU8(entries[name]);
    if(ADMIN_TOKEN_HEADER.test(text)) leaks.push({entry:name,reason:'出现管理令牌请求头名'});
    if(name==='manifest.json'){
      let parsed;
      try{ parsed=JSON.parse(text); }catch{ leaks.push({entry:name,reason:'manifest.json 不是合法 JSON'}); }
      if(parsed){
        // 结构性核验：固定六个镜头/图片/配音，且 manifest 不得内嵌任何密钥式字段。
        if(parsed.cards!==SHOT_COUNT) leaks.push({entry:name,reason:'manifest cards 不是 '+SHOT_COUNT});
        for(const entry of findSecretLeaks(parsed,name)) leaks.push({entry:name,reason:entry});
        for(const shot of parsed.media||[]){
          if(!Array.isArray(shot.utterances)||shot.utterances.some(item=>!item.audioId)) leaks.push({entry:name,reason:'manifest 配音不完整：'+shot.shotId});
          if(!shot.imageId) leaks.push({entry:name,reason:'manifest 缺少图片：'+shot.shotId});
        }
      }
    } else {
      for(const entry of findSecretLeaks(text,name)) leaks.push({entry:name,reason:entry});
    }
  }
  return {names,structureOk:missing.length===0&&extra.length===0,missing,extra,secretLeaks:leaks,images:names.filter(name=>name.startsWith('images/')).length};
}

async function commandExport(){
  const loaded=await loadFixture(kv.fixture);
  const fixture=loaded.fixture,outputDir=loaded.outputDir;
  await ensureSession();
  const draft=await loadAcceptanceDraft(fixture);
  const shots=draft.document.shots;
  if(shots.length!==SHOT_COUNT) fail('export 要求 '+SHOT_COUNT+' 个镜头，当前为 '+shots.length+'。');
  const missingImages=shots.filter(shot=>!shot.selectedImage).map(shot=>shot.id);
  const missingAudio=shots.flatMap(shot=>shot.utterances).filter(utterance=>!utterance.selectedAudioArtifactId).map(utterance=>utterance.id);
  if(missingImages.length||missingAudio.length) fail('导出前必须完成选图与配音：缺图片 '+(missingImages.join(',')||'无')+'；缺配音 '+(missingAudio.join(',')||'无')+'。');
  const media=await api('GET','/api/admin/activities/'+fixture.activityId+'/publication/media');
  const unavailable=(media&&media.items?media.items:[]).filter(item=>!item.available).map(item=>item.artifactId);
  if(unavailable.length) fail('存在不可读取的媒体：'+unavailable.join(',')+'。');

  // 视频封装是本机 CPU 转码，不产生模型费用；幂等键按 activityId+draftVersion 稳定，
  // 且 POST 之前先落盘，重复 export 会复用同一键而不是生成新键重复导出。
  const exportKey='prod-acceptance-export-'+fixture.activityId+'-'+draft.draftVersion;
  const idempotency=await readIdempotency(outputDir);
  idempotency.export={key:exportKey,activityId:fixture.activityId,draftVersion:draft.draftVersion};
  await writeIdempotency(outputDir,idempotency);
  const task=await api('POST','/api/admin/activities/'+fixture.activityId+'/publication/exports',{data:{
    expectedDraftVersion:draft.draftVersion,makeVideo:true,idempotencyKey:exportKey,
  }});
  const run=await pollRun(fixture,task.runId,candidate=>{
    const item=candidate.tasks.find(entry=>entry.kind==='export'&&entry.id===task.id);
    return Boolean(item&&TERMINAL.includes(item.status));
  },EXPORT_TIMEOUT_MS);
  const exportTask=run.tasks.find(entry=>entry.id===task.id);
  if(!exportTask||exportTask.status!=='succeeded') fail('导出任务未成功（状态 '+(exportTask?exportTask.status:'缺失')+'），详情见运行 '+run.id+'。');
  const ids=exportTask.artifactIds;
  if(ids.length!==3) fail('导出产物数量异常（'+ids.length+'），期望 zip、cover、video 三项；请人工检查，不下载以避免误判。');
  const [zipId,coverId,videoId]=ids;
  const zipPath=await downloadArtifact(zipId,join(outputDir,'publication.zip'));
  const coverPath=await downloadArtifact(coverId,join(outputDir,'cover.png'));
  const videoPath=await downloadArtifact(videoId,join(outputDir,'video.mp4'));
  const analysis=analyzeZip(await readFile(zipPath));
  const report={
    runId:run.id,exportTaskId:exportTask.id,exportIdempotencyKey:exportKey,artifactIds:{zip:zipId,cover:coverId,video:videoId},
    files:{zip:zipPath,cover:coverPath,video:videoPath},
    zipStructureOk:analysis.structureOk,zipEntries:analysis.names,zipImages:analysis.images,
    zipMissing:analysis.missing,zipExtra:analysis.extra,secretLeaks:analysis.secretLeaks,
    // 仅复用已生成媒体；视频封装是本机 CPU 转码，不是模型付费调用。
    regeneration:{images:false,speech:false,paidModelCalls:false},
  };
  await writeFile(join(outputDir,'export-report.json'),JSON.stringify(report,null,2));
  if(analysis.secretLeaks.length) fail('ZIP 文本条目中发现疑似密钥内容，已记录但未打印；请人工检查。');
  if(!analysis.structureOk) fail('ZIP 结构不符合固定清单，已记录缺失与多余条目；请人工检查。');
  log('导出完成（本机 CPU 转码，无模型付费调用）：zip='+zipPath+' cover='+coverPath+' video='+videoPath+' 幂等键='+exportKey);
  log('ZIP 条目='+analysis.names.length+' 图片='+analysis.images+' 结构正确='+analysis.structureOk+' 疑似密钥=0；未重新生图或配音。');
}

/** 只读：把当前草稿的六张选图下载到 output/images，供人工视觉审核。不生成、不修改、不重绘。 */
async function commandDownloadImages(){
  const loaded=await loadFixture(kv.fixture);
  const fixture=loaded.fixture,outputDir=loaded.outputDir;
  await ensureSession();
  const draft=await loadAcceptanceDraft(fixture);
  const shots=draft.document.shots;
  const missing=shots.filter(shot=>!shot.selectedImage).map(shot=>shot.id);
  if(missing.length) fail('尚有镜头没有选图，无法完整下载：'+missing.join(',')+'。');
  const imagesDir=join(outputDir,'images');
  await mkdir(imagesDir,{recursive:true});
  const saved=[];
  for(const [index,shot] of shots.entries()){
    const artifactId=shot.selectedImage.artifactId;
    const dot=artifactId.lastIndexOf('.');
    const extension=dot>0&&artifactId.length-dot<=5?artifactId.slice(dot):'.png';
    const name=String(index+1).padStart(3,'0')+'-'+shot.id+extension;
    await downloadArtifact(artifactId,join(imagesDir,name));
    saved.push({shotId:shot.id,file:name,artifactId});
  }
  await writeFile(join(imagesDir,'index.json'),JSON.stringify({activityId:fixture.activityId,draftVersion:draft.draftVersion,images:saved},null,2));
  log('已下载 '+saved.length+' 张选图到 '+imagesDir+'（仅读取，未重生图、未修改任何内容）。');
}

async function commandStatus(){
  const loaded=await loadFixture(kv.fixture);
  const fixture=loaded.fixture,outputDir=loaded.outputDir;
  await ensureSession();
  const project=await api('GET','/api/admin/story/projects/'+fixture.projectId);
  const state=await api('GET','/api/admin/activities/'+fixture.activityId+'/publication/state');
  const runs=await api('GET','/api/admin/activities/'+fixture.activityId+'/publication/runs');
  const media=await api('GET','/api/admin/activities/'+fixture.activityId+'/publication/media');
  const shots=state.draft.document.shots;
  const utterances=shots.flatMap(shot=>shot.utterances);
  log('项目：'+project.title+'（'+project.id+'）');
  log('草稿：v'+state.draft.draftVersion+' 镜头='+shots.length+' 已选图='+shots.filter(shot=>shot.selectedImage).length+' 已配音='+utterances.filter(utterance=>utterance.selectedAudioArtifactId).length+'/'+utterances.length);
  log('最近审批：'+(state.approval?state.approval.id+'（图片额度 '+state.approval.imageBudget+'，视频 '+state.approval.makeVideo+'）':'无'));
  const runItems=runs&&runs.items?runs.items:[];
  log('运行数：'+(runItems.length||0));
  for(const run of runItems){
    const budget=state.approval&&state.approval.imageBudget!=null?state.approval.imageBudget:'?';
    log('  运行 '+run.id.slice(0,8)+'：'+run.status+' 图片 '+run.imagesUsed+'/'+budget+' 配音字 '+run.speechCharactersUsed);
    for(const kind of ['image','speech','export']){
      const items=run.tasks.filter(item=>item.kind===kind);
      for(const item of items){
        const suffix=item.error?' 错误 '+item.error.slice(0,120):(item.artifactIds.length?' 产物 '+item.artifactIds.length:'');
        log('    '+kind+' '+item.targetId+'：'+item.status+suffix);
      }
    }
  }
  const mediaItems=media&&media.items?media.items:[];
  log('媒体可用：'+mediaItems.filter(item=>item.available).length+'/'+mediaItems.length);
  log('输出目录：'+outputDir+'（如需视觉审核运行 download-images --fixture）');
}

function parseArgs(argv){
  const command=argv[0];
  for(const arg of argv){
    if(!arg.startsWith('--')) continue;
    const match=/^--([^=]+)=(.*)$/.exec(arg);
    if(match) kv[match[1]]=match[2];
    else flags.add(arg);
  }
  const index=argv.indexOf('--fixture');
  if(index>=0){ const next=argv[index+1]; if(next&&!next.startsWith('--')) kv.fixture=next; }
  return command;
}

function usage(){
  log('用法：node scripts/publication-production-acceptance.mjs <create|prepare|run|export|download-images|status> [--fixture <path>] [--confirm] [--confirm-paid]');
  log('  create  --confirm                 新建验收测试项目与六镜头发布草稿');
  log('  prepare --fixture                 创建/复用独立配音配置并保存 preview.json（不批准）');
  log('  run     --fixture --confirm-paid  管理员审批后启动真实制作并轮询（无自动重试）');
  log('  export  --fixture                 导出并校验 ZIP/封面/视频（不重新生图或配音）');
  log('  download-images --fixture         只读下载六张选图到 output/images 供视觉审核');
  log('  status  --fixture                 只读查看状态');
}

async function main(){
  const command=parseArgs(process.argv.slice(2));
  if(!command||flags.has('--help')||flags.has('-h')){ usage(); return; }
  if(command==='create') return commandCreate();
  if(command==='prepare') return commandPrepare();
  if(command==='run') return commandRun();
  if(command==='export') return commandExport();
  if(command==='download-images') return commandDownloadImages();
  if(command==='status') return commandStatus();
  fail('未知子命令：'+command);
}

try{
  await main();
}catch(error){
  const message=error instanceof Error?error.message:String(error);
  console.error('验收脚本已停止：'+message);
  process.exitCode=1;
}finally{
  if(ctx) await ctx.dispose().catch(()=>undefined);
}
