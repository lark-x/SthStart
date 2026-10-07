import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Fastify from 'fastify';
import {buildActivityDocument,type StudioBatchRequest} from '@sthstart/contracts';
import {ServiceDatabase,nowIso} from './database.js';
import {readConfig} from './config.js';
import {SecretStore} from './security.js';
import {ActivityStore} from './activities/store.js';
import {StudioStore} from './activities/studio-store.js';
import {installVisualTestWorkflow} from './activities/test-support/visual-workflow.js';
import {setDefaultPreset} from './generation/configuration-store.js';
import {getGenerationTask} from './generation/task-store.js';
import {processTaskExecution,pollAndCompleteTask,reconcileGenerationTasks} from './generation/execution.js';
import {resolveArtifactStoragePath} from './artifacts.js';
import {getImageConfigDraft,saveImageConfigDraft} from './activities/image-configs.js';
import {prepareStudioContext} from './activities/studio-context.js';
import {createStudioBatch,prepareStudioBatch,startStudioBatch,processStudioBatch,listStudioItems,resolveStudioBatchTarget,placeStudioBatchImage} from './activities/studio-batches.js';
import {createStudioBeatCandidate} from './activities/beat-renders.js';
import {recoverStudioJobs,resumeStudioJob,reconcileStudioJob} from './activities/studio-recovery.js';
import {collectStudioRenderResult} from './activities/studio-render-results.js';
import {registerStudioRoutes} from './activities/studio-routes.js';

// ------------------------- 第二轮修复（计划 §7.1／§7.2／§7.3／§8）：细化任务的重启恢复
// 用例名统一带 `parity-round2:`，便于按计划 §8 的命令只跑本轮定向用例。
//
// 夹具严格按计划 §8 要求：studio job 已有 callId，item 已关联 generationTaskId，
// 但**生成任务仍处于 queued**（provider_task_id 为空、upstream_may_continue=0）。
// 暂停标记不在夹具里预置——它正是被测恢复逻辑应当写出的结果。

const R2_NOW='2026-10-03T00:00:00.000Z',R2_HELD='studio_resume_required';

function r2RecoveryFixture(){
  const database=new ServiceDatabase();
  // 本组用例只验证恢复扫描的状态判定，不验证外键图，故显式关闭外键强制并注明。
  database.connection.exec('PRAGMA foreign_keys=OFF');
  database.connection.prepare('INSERT INTO activities(id,title,type,created_at,updated_at) VALUES (?,?,?,?,?)')
    .run('act-1','验收活动','general',R2_NOW,R2_NOW);
  database.connection.prepare(`INSERT INTO generation_tasks
    (id,app_id,engine_id,workflow_id,workflow_version,request_hash,request_params_json,workflow_snapshot_json,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run('gt-1','activities','engine-1','wf-1',1,'rh-1','{}','{}','queued',R2_NOW,R2_NOW);
  database.connection.prepare(`INSERT INTO activity_studio_jobs
    (id,activity_id,kind,status,revision,idempotency_key,request_hash,input_json,call_id,trace_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('job-1','act-1','render_batch','queued',1,'key-1','rh-job-1',
      JSON.stringify({operation:'hires',sourceFingerprint:'fp-1'}),'call-1','trace-1',R2_NOW,R2_NOW);
  database.connection.prepare(`INSERT INTO activity_studio_job_items
    (id,job_id,target_key,target_json,candidate_index,attempt_no,state,input_json,source_fingerprint,submission_key,generation_task_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('item-1','job-1','tk-1',JSON.stringify({kind:'media_slot',slotId:'s1'}),0,0,'submitted',
      '{}','fp-1','sk-1','gt-1',R2_NOW,R2_NOW);
  return {database,config:{artifactDirectory:R2_NOW} as never};
}

const r2TaskErrorCode=(database:ServiceDatabase)=>
  (database.connection.prepare('SELECT error_code FROM generation_tasks WHERE id=?').get('gt-1') as {error_code:string|null}).error_code;
const r2JobStatus=(database:ServiceDatabase)=>
  (database.connection.prepare('SELECT status FROM activity_studio_jobs WHERE id=?').get('job-1') as {status:string}).status;

test('parity-round2: 细化任务的 queued 关联任务必须被加上暂停标记（§7.2 第 2 行）', () => {
  const {database,config}=r2RecoveryFixture();
  try{
    // 前置断言：夹具里没有任何暂停标记，标记只能由恢复逻辑写出。
    assert.equal(r2TaskErrorCode(database),null,'夹具不应预置暂停标记');
    recoverStudioJobs(database,config,{startup:true});
    assert.equal(r2TaskErrorCode(database),R2_HELD,
      '细化任务已排队但未提交上游时，必须给关联生成任务加 studio_resume_required 暂停标记，'
      +'否则用户无法区分「等待确认」与「可继续提交」');
  }finally{database.close();}
});

test('parity-round2: 细化任务恢复扫描后 studio job 标记为 interrupted', () => {
  const {database,config}=r2RecoveryFixture();
  try{
    recoverStudioJobs(database,config,{startup:true});
    assert.equal(r2JobStatus(database),'interrupted','恢复扫描应把细化 job 置为 interrupted，等待明确恢复');
  }finally{database.close();}
});

test('parity-round2: 已有 callId 不影响「未提交上游」的判定（§7.1）', () => {
  const {database,config}=r2RecoveryFixture();
  try{
    recoverStudioJobs(database,config,{startup:true});
    // callId 存在只说明统一生成任务已落库，不说明请求到达了 ComfyUI。
    const recovery=JSON.parse((database.connection.prepare('SELECT input_json FROM activity_studio_jobs WHERE id=?')
      .get('job-1') as {input_json:string}).input_json).recovery as {canResumeBeforeNetwork?:boolean}|undefined;
    assert.equal(recovery?.canResumeBeforeNetwork,true,
      'job 仍是 queued 且任务从未提交上游时，canResumeBeforeNetwork 不应因为存在 callId 而变成 false');
  }finally{database.close();}
});

test('parity-round2: 恢复扫描可重复执行，不重复插入或反复改状态（§7.3）', () => {
  const {database,config}=r2RecoveryFixture();
  try{
    const snapshot=()=>({
      status:r2JobStatus(database),
      revision:(database.connection.prepare('SELECT revision FROM activity_studio_jobs WHERE id=?').get('job-1') as {revision:number}).revision,
      marker:r2TaskErrorCode(database),
      items:(database.connection.prepare('SELECT COUNT(*) AS n FROM activity_studio_job_items WHERE job_id=?').get('job-1') as {n:number}).n,
    });
    recoverStudioJobs(database,config,{startup:true});
    const afterFirst=snapshot();
    recoverStudioJobs(database,config,{startup:true});
    assert.deepEqual(snapshot(),afterFirst,'第二次恢复扫描不应改变状态、版本或条目数');
    assert.equal(afterFirst.items,1,'恢复扫描不得重复插入 job item');
    assert.equal(afterFirst.marker,R2_HELD,'暂停标记应保持，而不是被清掉或换成别的值');
  }finally{database.close();}
});

test('parity-round2: 已停止的细化 job 记取消意图，不写暂停标记（§7.2 第 7 行）', () => {
  const {database,config}=r2RecoveryFixture();
  try{
    database.connection.prepare('UPDATE activity_studio_jobs SET stop_requested=1 WHERE id=?').run('job-1');
    recoverStudioJobs(database,config,{startup:true});
    const task=database.connection.prepare('SELECT status,error_code,upstream_may_continue FROM generation_tasks WHERE id=?')
      .get('gt-1') as {status:string;error_code:string|null;upstream_may_continue:number};
    assert.equal(task.status,'cancelled','停止的 job 关联任务应记为 cancelled');
    assert.equal(task.error_code,'studio_stopped_before_submission','应写明「未提交上游」，而不是暂停等待确认');
    assert.equal(task.upstream_may_continue,0,'上游不会继续，不能标记为可能继续');
    assert.notEqual(task.error_code,R2_HELD,'已停止的任务不应被写成等待恢复');
  }finally{database.close();}
});

test('parity-round2: 上游仍在运行时只核对等待，不打暂停标记、不新建任务（§7.2 第 3 行）', () => {
  const {database,config}=r2RecoveryFixture();
  try{
    database.connection.prepare("UPDATE generation_tasks SET status='running', provider_task_id='comfy-42' WHERE id=?").run('gt-1');
    const before=(database.connection.prepare('SELECT COUNT(*) AS n FROM generation_tasks').get() as {n:number}).n;
    recoverStudioJobs(database,config,{startup:true});
    const task=database.connection.prepare('SELECT status,error_code,provider_task_id FROM generation_tasks WHERE id=?')
      .get('gt-1') as {status:string;error_code:string|null;provider_task_id:string|null};
    assert.equal(task.status,'running','运行中的任务状态不得被恢复扫描改动');
    assert.equal(task.provider_task_id,'comfy-42','已写入的 providerTaskId 不得被清除');
    assert.notEqual(task.error_code,R2_HELD,'已提交上游的任务不应被写成「等待恢复」，那会误导用户重投');
    assert.equal((database.connection.prepare('SELECT COUNT(*) AS n FROM generation_tasks').get() as {n:number}).n,before,'恢复扫描不得新建生成任务');
  }finally{database.close();}
});

test('parity-round2: 上游失败的细化任务按真实终态记录，不偷偷重画（§7.2 第 6 行）', () => {
  const {database,config}=r2RecoveryFixture();
  try{
    database.connection.prepare("UPDATE generation_tasks SET status='failed', error_code='upstream_failed', upstream_may_continue=0 WHERE id=?").run('gt-1');
    recoverStudioJobs(database,config,{startup:true});
    const task=database.connection.prepare('SELECT status,error_code FROM generation_tasks WHERE id=?')
      .get('gt-1') as {status:string;error_code:string|null};
    assert.equal(task.status,'failed','失败是真实终态，不得被改回 queued 或 paused');
    assert.equal(task.error_code,'upstream_failed','真实错误码应保留，不被覆盖成暂停标记');
    assert.equal((database.connection.prepare('SELECT COUNT(*) AS n FROM generation_tasks').get() as {n:number}).n,1,'恢复扫描不得为失败任务偷偷新建生成任务');
  }finally{database.close();}
});

const admin='isolated-recovery-admin-token-32-characters',headers={'x-sthstart-admin-token':admin};
function fixture(t:test.TestContext){
  const database=new ServiceDatabase(),config=readConfig({STHSTART_ADMIN_TOKEN:admin,STHSTART_ARTIFACT_DIR:mkdtempSync(join(tmpdir(),'sthstart-studio-recovery-'))}),secrets=new SecretStore({});
  t.after(()=>database.close());
  const now=nowIso();
  database.connection.prepare("INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('activities','测试','hash','[]',1,?,?)").run(now,now);
  const profiles=installVisualTestWorkflow(database);setDefaultPreset(database,profiles.draft.presetId);
  database.connection.prepare("INSERT INTO provider_profiles(id,name,kind,base_url,model,enabled,created_at,updated_at) VALUES ('recovery-text','测试','llm','http://text.test/v1','synthetic',1,?,?)").run(now,now);
  database.connection.prepare("INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('activities','text','recovery-text',?)").run(now);
  const activities=new ActivityStore(database),content=buildActivityDocument({templateId:'blank',title:'隔离恢复测试',type:'测试',theme:'',location:'营地',rules:'',actors:[]});
  const stageId=content.stages[0].id;
  content.scenes=[{id:'s',stageId,title:'结晶',timeText:'',locationText:'营地',beats:[0,1].map(index=>({id:`b${index}`,characterId:'',action:`晶体 ${index}`,dialogue:''}))}];
  const activity=activities.createActivity({title:content.activity.title,type:'测试',initialDocument:content}).activity;
  const image=getImageConfigDraft(database,activity.id);
  saveImageConfigDraft(database,activity.id,image.draftVersion,{...image.document,artDirection:{selectedStyle:null,quality:'draft',canvas:{width:768,height:768},renderProfiles:profiles,parameterOverrides:{}}});
  const versions=()=>{const a=activities.getActivity(activity.id)!,d=activities.getDraft(activity.id)!,i=getImageConfigDraft(database,activity.id);
    return {headVersion:a.headVersion,contentDraftVersion:d.draftVersion,contentRevisionId:a.currentContentRevisionId,imageConfigDraftVersion:i.draftVersion,imageConfigRevisionId:i.baseRevisionId};};
  prepareStudioContext(database,activity.id,versions());
  let prompts=0,optimizations=0,historyMode:'success'|'empty'|'forbidden'='success';
  const fetcher:typeof fetch=async(input)=>{
    const url=String(input);
    if(url.endsWith('/object_info'))return Response.json({CLIPTextEncode:{input:{required:{text:['STRING',{}]}}},KSampler:{input:{required:{}}},CheckpointLoaderSimple:{input:{required:{ckpt_name:[['base.safetensors','turbo.safetensors'],{}]}}},SaveImage:{input:{required:{}}},EmptyLatentImage:{input:{required:{}}}});
    if(url.endsWith('/chat/completions')){optimizations++;return Response.json({choices:[{message:{content:'crystals on a laboratory table, no text'}}]});}
    if(url.endsWith('/prompt')){prompts++;return Response.json({prompt_id:`live-${prompts}`});}
    if(url.includes('/history/')){if(historyMode==='forbidden')return Response.json({error:'quota or permission'},{status:403});if(historyMode==='empty')return Response.json({});
      const id=url.split('/history/')[1];return Response.json({[id]:{status:{status_str:'success',completed:true},outputs:{'5':{images:[{filename:`${id}-a.png`,type:'output'},{filename:`${id}-b.png`,type:'output'}]}}}});}
    if(url.endsWith('/queue'))return Response.json({queue_running:[],queue_pending:[]});
    if(url.includes('/view?'))return new Response(new Uint8Array([137,80,78,71,13,10,26,10]),{headers:{'content-type':'image/png'}});
    throw new Error(`Unexpected recovery request ${url}`);
  };
  const request:StudioBatchRequest={kind:'render_batch',versions:versions(),idempotencyKey:'recover-batch',input:{targets:[0,1].map(index=>({kind:'beat',stageId,sceneId:'s',beatId:`b${index}`})),candidateCount:1,placement:'history_only'}};
  return {database,config,secrets,activityId:activity.id,activities,request,fetcher,store:new StudioStore(database),get prompts(){return prompts;},get optimizations(){return optimizations;},set historyMode(value:typeof historyMode){historyMode=value;}};
}
async function approved(f:ReturnType<typeof fixture>){
  const job=createStudioBatch(f.database,f.config,f.activityId,f.request);await prepareStudioBatch({...f,jobId:job.id});
  const review=f.store.get(f.activityId,job.id)!;startStudioBatch(f.database,f.config,f.activityId,job.id,{expectedJobRevision:review.revision,planHash:review.planHash!});return job.id;
}
function expire(f:ReturnType<typeof fixture>,jobId:string){
  f.database.connection.prepare("UPDATE activity_studio_jobs SET status='running',lease_owner='old-process',lease_expires_at='2000-01-01',revision=revision+1 WHERE id=?").run(jobId);
}
function resumeControl(f:ReturnType<typeof fixture>,jobId:string){
  const job=f.store.get(f.activityId,jobId)!;
  return {expectedJobRevision:job.revision,planHash:job.planHash!,itemIds:listStudioItems(f.database,f.activityId,jobId).items.filter(item=>['waiting','submitted','unknown'].includes(item.state)).map(item=>item.id)};
}
function link(f:ReturnType<typeof fixture>,jobId:string,index:number,status='accepted',providerId:string|null='original-prompt'){
  const item=listStudioItems(f.database,f.activityId,jobId).items[index],actual=resolveStudioBatchTarget(f.database,f.config,f.activityId,item.target,item.seed,item.submissionKey);
  const native=createStudioBeatCandidate(f.database,f.activityId,actual.beatRequest!),taskId=`durable-${index}-${jobId}`,now=nowIso();
  f.database.connection.prepare(`INSERT INTO generation_tasks(id,app_id,purpose,engine_id,workflow_id,workflow_version,request_hash,request_params_json,workflow_snapshot_json,status,provider_task_id,actual_seed,created_at,updated_at)
    VALUES (?,'activities','activity_image_text','visual-engine','visual-flow',1,'frozen',?,?,?,?,?,?,?)`)
    .run(taskId,JSON.stringify({inputs:actual.preview.parameters,inputArtifacts:[]}),JSON.stringify(actual.graph),status,providerId,item.seed,now,now);
  f.database.connection.prepare("UPDATE activity_beat_render_candidates SET task_id=?,status='running' WHERE id=?").run(taskId,native.candidateId);
  const input={...JSON.parse(String(f.database.connection.prepare('SELECT input_json FROM activity_studio_job_items WHERE id=?').get(item.id)!.input_json)),nativeId:native.candidateId,beatRequest:actual.beatRequest};
  f.database.connection.prepare("UPDATE activity_studio_job_items SET state='submitted',generation_task_id=?,candidate_id=?,input_json=? WHERE id=?").run(taskId,native.candidateId,JSON.stringify(input),item.id);
  return {itemId:item.id,taskId,candidateId:native.candidateId};
}

test('restart before any request freezes queued work; explicit resume retains seeds and sends each image once',async t=>{
  const f=fixture(t),jobId=await approved(f),before=listStudioItems(f.database,f.activityId,jobId).items;
  recoverStudioJobs(f.database,f.config,{startup:true});let job=f.store.get(f.activityId,jobId)!;
  assert.equal(job.status,'interrupted');assert.equal(f.prompts,0);assert.equal(f.optimizations,0);
  await processStudioBatch({...f,jobId});assert.equal(f.prompts,0,'interrupted never gets claimed automatically');
  const control=resumeControl(f,jobId);resumeStudioJob(f.database,f.config,f.activityId,jobId,control);
  await processStudioBatch({...f,jobId});job=f.store.get(f.activityId,jobId)!;
  assert.equal(job.status,'succeeded');assert.equal(f.prompts,2);assert.equal(f.optimizations,2);
  assert.deepEqual(listStudioItems(f.database,f.activityId,jobId).items.map(item=>[item.seed,item.submissionKey]),before.map(item=>[item.seed,item.submissionKey]));
  assert.equal(resumeStudioJob(f.database,f.config,f.activityId,jobId,control).id,jobId,'lost accepted response returns same operation even after finish');
  assert.equal(f.prompts,2);
});

test('linked queued snapshot is held before generation scheduler and released only by explicit confirmation',async t=>{
  const f=fixture(t),jobId=await approved(f),linked=link(f,jobId,0,'queued',null);expire(f,jobId);
  recoverStudioJobs(f.database,f.config,{startup:true});
  assert.equal(getGenerationTask(f.database,linked.taskId)!.errorCode,'studio_resume_required');
  await reconcileGenerationTasks(f.config,f.database,f.secrets,f.fetcher);await processTaskExecution(f.config,f.database,f.secrets,linked.taskId,f.fetcher);
  assert.equal(f.prompts,0);const job=f.store.get(f.activityId,jobId)!;
  resumeStudioJob(f.database,f.config,f.activityId,jobId,resumeControl(f,jobId));
  await processTaskExecution(f.config,f.database,f.secrets,linked.taskId,f.fetcher);
  await processStudioBatch({...f,jobId});
  assert.equal(f.prompts,2,'one preserved task plus one remaining item');assert.equal(f.optimizations,1,'held image never reoptimizes');
  assert.equal(listStudioItems(f.database,f.activityId,jobId).items[0].generationTaskId,linked.taskId);
  assert.equal(f.store.get(f.activityId,jobId)!.status,'succeeded');
});

test('accepted upstream reconciles all images with no prompt; successful item is never regenerated on resume',async t=>{
  const f=fixture(t),jobId=await approved(f),linked=link(f,jobId,0);expire(f,jobId);f.historyMode='empty';
  recoverStudioJobs(f.database,f.config,{startup:true});let job=f.store.get(f.activityId,jobId)!;
  assert.throws(()=>resumeStudioJob(f.database,f.config,f.activityId,jobId,resumeControl(f,jobId)),{code:'studio_resume_unsafe'});
  f.historyMode='success';job=await reconcileStudioJob({...f,jobId});
  assert.equal(f.prompts,0);assert.equal(f.optimizations,0);assert.equal(job.status,'interrupted');
  const first=listStudioItems(f.database,f.activityId,jobId).items[0];assert.equal(first.state,'succeeded');assert.equal(first.artifactIds.length,2);
  assert.equal(f.database.connection.prepare('SELECT COUNT(*) n FROM activity_beat_render_candidate_outputs WHERE candidate_id=?').get(linked.candidateId)!.n,2);
  assert.ok(f.database.connection.prepare("SELECT 1 FROM artifact_references WHERE ref_type='activity_studio_render' AND artifact_id=?").get(first.artifactIds[0]));
  resumeStudioJob(f.database,f.config,f.activityId,jobId,resumeControl(f,jobId));await processStudioBatch({...f,jobId});
  assert.equal(f.prompts,1);assert.deepEqual(listStudioItems(f.database,f.activityId,jobId).items[0].artifactIds,first.artifactIds);
});

test('receiptless submissions remain unknown; known ID probes do not treat 403/empty history as failure or retry',async t=>{
  const f=fixture(t),jobId=await approved(f),linked=link(f,jobId,0,'submitting',null);expire(f,jobId);
  recoverStudioJobs(f.database,f.config,{startup:true});await reconcileGenerationTasks(f.config,f.database,f.secrets,f.fetcher);recoverStudioJobs(f.database,f.config);
  assert.equal(getGenerationTask(f.database,linked.taskId)!.upstreamMayContinue,true);
  let job=await reconcileStudioJob({...f,jobId});assert.equal(job.status,'unknown');assert.equal(f.prompts,0);
  assert.throws(()=>resumeStudioJob(f.database,f.config,f.activityId,jobId,resumeControl(f,jobId)),{code:'studio_resume_unsafe'});
  f.database.connection.prepare("UPDATE generation_tasks SET provider_task_id='late-confirmed-id' WHERE id=?").run(linked.taskId);
  for(const mode of ['forbidden','empty'] as const){f.historyMode=mode;job=await reconcileStudioJob({...f,jobId});assert.equal(job.status,'unknown');assert.equal(getGenerationTask(f.database,linked.taskId)!.upstreamMayContinue,true);}
  f.historyMode='success';job=await reconcileStudioJob({...f,jobId});assert.equal(job.status,'interrupted');assert.equal(getGenerationTask(f.database,linked.taskId)!.upstreamMayContinue,false);
  assert.equal(listStudioItems(f.database,f.activityId,jobId).items[0].state,'succeeded');assert.equal(f.prompts,0);
});

test('preparing optimizer is interrupted not reset, live lease is protected, and changed sources block safe remaining items',async t=>{
  const f=fixture(t),jobId=await approved(f),item=listStudioItems(f.database,f.activityId,jobId).items[0];
  f.database.connection.prepare("UPDATE activity_studio_jobs SET status='running',lease_owner='live',lease_expires_at=? WHERE id=?").run(new Date(Date.now()+180000).toISOString(),jobId);
  f.database.connection.prepare("UPDATE activity_studio_job_items SET state='preparing' WHERE id=?").run(item.id);
  recoverStudioJobs(f.database,f.config,{startup:true});assert.equal(f.store.get(f.activityId,jobId)!.status,'running');
  expire(f,jobId);recoverStudioJobs(f.database,f.config);assert.equal(listStudioItems(f.database,f.activityId,jobId).items[0].state,'interrupted');
  const draft=f.activities.getDraft(f.activityId)!;f.activities.updateDraft(f.activityId,draft.draftVersion,{...draft.document,scenes:draft.document.scenes!.map(scene=>({...scene,beats:scene.beats.map(beat=>beat.id==='b1'?{...beat,action:'changed'}:beat)}))});
  const job=f.store.get(f.activityId,jobId)!;assert.throws(()=>resumeStudioJob(f.database,f.config,f.activityId,jobId,resumeControl(f,jobId)),{code:'studio_plan_changed'});
  assert.equal(f.prompts,0);assert.equal(f.optimizations,0);
});

test('cancelled late results remain history-only, unavailable files retain all references, and imported snapshots are read-only',async t=>{
  const f=fixture(t);f.request.input.placement='fill_empty';const jobId=await approved(f),linked=link(f,jobId,0);expire(f,jobId);
  const current=f.store.get(f.activityId,jobId)!;f.store.stop(f.activityId,jobId,current.revision);
  await pollAndCompleteTask(f.config,f.database,f.secrets,linked.taskId,f.fetcher,{singleCheck:true});recoverStudioJobs(f.database,f.config,{startup:true});
  assert.equal(f.store.get(f.activityId,jobId)!.status,'cancelled');assert.equal(f.activities.getDraft(f.activityId)!.document.scenes![0].beats[0].mediaUrl,undefined);
  const first=listStudioItems(f.database,f.activityId,jobId).items[0];assert.equal(first.artifactIds.length,2);
  placeStudioBatchImage(f.database,f.config,f.activityId,jobId,first.id,first.artifactIds[0]);
  assert.equal(listStudioItems(f.database,f.activityId,jobId).items[0].placementState,'ineligible');
  assert.equal(f.activities.getDraft(f.activityId)!.document.scenes![0].beats[0].mediaUrl,undefined);
  for(const id of first.artifactIds){const path=resolveArtifactStoragePath(f.database,id,f.config.artifactDirectory)!;assert.ok(path.startsWith(f.config.artifactDirectory));unlinkSync(path);}
  const result=collectStudioRenderResult(f.database,f.config,f.activityId,jobId,first.id)!;
  assert.equal(result.state,'failed');assert.equal(result.unavailableArtifactIds.length,2);assert.equal(listStudioItems(f.database,f.activityId,jobId).items[0].artifactIds.length,2);
  assert.throws(()=>resumeStudioJob(f.database,f.config,f.activityId,jobId,resumeControl(f,jobId)),{code:'studio_resume_unsafe'});
  const history=f.store.get(f.activityId,jobId)!;f.database.connection.prepare("UPDATE activity_studio_jobs SET input_json=?,status='interrupted',stop_requested=0 WHERE id=?").run(JSON.stringify({...history.input,readOnly:true}),jobId);
  const restored=f.store.get(f.activityId,jobId)!;assert.equal(restored.readOnly,true);assert.equal(f.store.claim(f.activityId,jobId,'any'),false);
  assert.throws(()=>resumeStudioJob(f.database,f.config,f.activityId,jobId,resumeControl(f,jobId)),{code:'studio_job_read_only'});
  await assert.rejects(()=>reconcileStudioJob({...f,jobId}),{code:'studio_job_read_only'});assert.equal(f.prompts,0);
});

test('resume honors selected scope and rejects changed confirmations, foreign IDs and previously succeeded items',async t=>{
  const f=fixture(t),jobId=await approved(f);recoverStudioJobs(f.database,f.config,{startup:true});
  const all=resumeControl(f,jobId),control={...all,itemIds:all.itemIds.slice(0,1)};
  assert.throws(()=>resumeStudioJob(f.database,f.config,f.activityId,jobId,{...control,itemIds:['foreign']}),{code:'studio_item_not_found'});
  resumeStudioJob(f.database,f.config,f.activityId,jobId,control);await processStudioBatch({...f,jobId});
  assert.equal(f.prompts,1);assert.equal(f.store.get(f.activityId,jobId)!.status,'paused');
  assert.deepEqual(listStudioItems(f.database,f.activityId,jobId).items.map(item=>item.state),['succeeded','waiting']);
  assert.throws(()=>resumeStudioJob(f.database,f.config,f.activityId,jobId,{...control,itemIds:all.itemIds}),{code:'idempotency_conflict'});
  const next=resumeControl(f,jobId);
  assert.throws(()=>resumeStudioJob(f.database,f.config,f.activityId,jobId,{...next,itemIds:[control.itemIds[0]]}),{code:'studio_resume_no_waiting'});
  resumeStudioJob(f.database,f.config,f.activityId,jobId,next);await processStudioBatch({...f,jobId});assert.equal(f.prompts,2);
  assert.equal(f.store.get(f.activityId,jobId)!.status,'succeeded');
});

test('queued text tasks can resume before network but interrupted model requests cannot; route auth and ownership remain strict',async t=>{
  const f=fixture(t),queued=f.store.create({activityId:f.activityId,kind:'storyboard',idempotencyKey:'queued-text',request:{},freeze:()=>({request:{}})}).job;
  const preparing=f.store.create({activityId:f.activityId,kind:'refine',idempotencyKey:'interrupted-text',request:{},freeze:()=>({request:{}})}).job;
  expire(f,preparing.id);recoverStudioJobs(f.database,f.config,{startup:true});
  const q=f.store.get(f.activityId,queued.id)!;assert.equal(resumeStudioJob(f.database,f.config,f.activityId,q.id,{expectedJobRevision:q.revision}).status,'queued');
  const p=f.store.get(f.activityId,preparing.id)!;assert.throws(()=>resumeStudioJob(f.database,f.config,f.activityId,p.id,{expectedJobRevision:p.revision}),{code:'studio_resume_unsafe'});
  const app=Fastify();registerStudioRoutes(app,f.config,f.database,f.secrets,(req,reply)=>{if(req.headers['x-sthstart-admin-token']===admin)return true;reply.code(401).send({error:'unauthorized'});return false;},f.fetcher);t.after(()=>app.close());
  const url=`/api/v1/admin/activities/${f.activityId}/studio-jobs/${p.id}/reconcile`;
  assert.equal((await app.inject({method:'POST',url,payload:{}})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:url.replace(f.activityId,'foreign'),headers,payload:{}})).statusCode,404);
  assert.equal((await app.inject({method:'POST',url,headers,payload:{force:true}})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url,headers,payload:{}})).statusCode,200);
  assert.equal(f.prompts,0);assert.equal(f.optimizations,0);
});

test('explicit reconciliation verifies completed files without scanning unrelated jobs or replaying any request',async t=>{
  const f=fixture(t),jobId=await approved(f),otherId=f.store.create({activityId:f.activityId,kind:'storyboard',idempotencyKey:'unrelated-queued',request:{},freeze:()=>({})}).job.id;
  await processStudioBatch({...f,jobId});assert.equal(f.store.get(f.activityId,jobId)!.status,'succeeded');
  const before=listStudioItems(f.database,f.activityId,jobId).items,missing=before[0].artifactIds;
  for(const id of missing){const path=resolveArtifactStoragePath(f.database,id,f.config.artifactDirectory)!;assert.ok(path.startsWith(f.config.artifactDirectory));unlinkSync(path);}
  const calls=f.prompts,models=f.optimizations,job=await reconcileStudioJob({...f,jobId});
  assert.equal(job.status,'partially_succeeded');const after=listStudioItems(f.database,f.activityId,jobId).items;
  assert.equal(after[0].state,'failed');assert.deepEqual(after[0].artifactIds,missing);assert.deepEqual(after[0].unavailableArtifactIds,missing);
  assert.equal(after[1].state,'succeeded');assert.deepEqual(after[1].artifactIds,before[1].artifactIds);
  assert.equal(f.store.get(f.activityId,otherId)!.status,'queued');assert.equal(f.prompts,calls);assert.equal(f.optimizations,models);
});
