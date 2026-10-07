import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildActivityDocument, type StudioBatchRequest, type StudioTarget, type ActivityImagePromptPolicy } from '@sthstart/contracts';
import { ServiceDatabase, nowIso } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { createService } from './server.js';
import { ActivityStore } from './activities/store.js';
import { ComicStore } from './activities/comic-store.js';
import { materializeComicStoryboard } from './activities/comic-storyboard.js';
import { StudioStore } from './activities/studio-store.js';
import { getImageConfigDraft, saveImageConfigDraft } from './activities/image-configs.js';
import { prepareStudioContext, readStudioContext } from './activities/studio-context.js';
import { installVisualTestWorkflow } from './activities/test-support/visual-workflow.js';
import { setDefaultPreset } from './generation/configuration-store.js';
import { createStudioBatch, prepareStudioBatch, startStudioBatch, processStudioBatch, listStudioItems, retryStudioBatch } from './activities/studio-batches.js';
import { studioTextProfileBinding } from './activities/studio-model-binding.js';
import type { StudioOptimizerOverride } from './activities/studio-render-context.js';
import { optimizeActivityImagePrompt, promptOptimizationCallUncertain } from './activities/image-prompt-optimizer.js';
import { createAiCallRecord, fetchAuditedAiResponse, updateAiCallRecord } from './ai-call-trace.js';
import { recoverStudioJobs, resumeStudioJob } from './activities/studio-recovery.js';
import { bindStudioOptimizerCall } from './activities/studio-render-context.js';

const policy:ActivityImagePromptPolicy={workflowId:'visual-flow',workflowVersion:1,createdAt:'2026-10-03T00:00:00.000Z',
  revision:1,enabled:true,instructions:'Rewrite visual facts only.',positiveSuffix:'high quality',negativePrompt:'text, watermark',
  outputFormat:'prose',knowledgeMode:'none'};
function fixture(t:test.TestContext){
  const database=new ServiceDatabase(),secrets=new SecretStore({}),config=readConfig({STHSTART_ARTIFACT_DIR:mkdtempSync(join(tmpdir(),'sthstart-scoped-optimizer-'))});
  t.after(()=>database.close());const now=nowIso();
  database.connection.prepare("INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('activities','测试','hash','[]',1,?,?)").run(now,now);
  const profiles=installVisualTestWorkflow(database);setDefaultPreset(database,profiles.draft.presetId);
  for(const [id,model] of [['original','original-model'],['backup','backup-model']])database.connection.prepare("INSERT INTO provider_profiles(id,name,kind,base_url,model,enabled,created_at,updated_at) VALUES (?,?,'llm','http://optimizer.test/v1',?,1,?,?)").run(id,id,model,now,now);
  database.connection.prepare("INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('activities','text','original',?)").run(now);
  const activities=new ActivityStore(database),content=buildActivityDocument({templateId:'blank',title:'隔离优化覆盖测试',type:'测试',theme:'',location:'营地',rules:'',actors:[{id:'a',displayName:'研究员',persona:{appearance:{baseText:'银发'}},outfitDescription:'蓝衣',activityRole:''}]});
  const stageId=content.stages[0].id;
  content.scenes=[{id:'s',stageId,title:'结晶',timeText:'傍晚',locationText:'营地',beats:[0,1].map(index=>({id:`b${index}`,characterId:'a',action:`观察结晶 ${index}`,dialogue:'稳定。',mediaUrl:'/preserved.png'}))}];
  content.mediaSlots=['m','m2'].map(id=>({id,kind:'image',stageId,caption:'实验台',shotDescription:'蓝衣研究员观察结晶',actorIds:['a'],sourceFactIds:[]}));
  const activity=activities.createActivity({title:content.activity.title,type:'测试',initialDocument:content}).activity;
  const image=getImageConfigDraft(database,activity.id);
  saveImageConfigDraft(database,activity.id,image.draftVersion,{...image.document,artDirection:{selectedStyle:null,quality:'draft',canvas:{width:768,height:768},renderProfiles:profiles,parameterOverrides:{}}});
  prepareStudioContext(database,activity.id,readStudioContext(database,activity.id));
  const override:StudioOptimizerOverride={profileId:'backup',profileHash:studioTextProfileBinding(database,'backup').hash,fallbackOf:'original-failed-job',rootJobId:'original-root',priorCallId:null};
  return {database,secrets,config,activities,activityId:activity.id,stageId,override};
}
function mockUpstream(){
  const texts:Array<{model:string;messages:Array<{content:string}>}>=[],graphs:Record<string,unknown>[]=[];
  let failText:'none'|'empty'|'transport'|'503'='none';
  const fetcher:typeof fetch=async(input,init)=>{
    const url=String(input);
    if(url.endsWith('/chat/completions')){
      texts.push(JSON.parse(String(init?.body)));if(failText==='transport')throw new Error('synthetic connection reset');
      if(failText==='503')return Response.json({error:'gateway'},{status:503});
      return Response.json({choices:[{message:{content:failText==='empty'?'':'silver haired scientist observing a crystal'}}]});
    }
    if(url.endsWith('/object_info'))return Response.json({CLIPTextEncode:{input:{required:{text:['STRING',{}]}}},KSampler:{input:{required:{}}},CheckpointLoaderSimple:{input:{required:{ckpt_name:[['base.safetensors','turbo.safetensors'],{}]}}},SaveImage:{input:{required:{}}},EmptyLatentImage:{input:{required:{}}}});
    if(url.endsWith('/prompt')){graphs.push(JSON.parse(String(init?.body)).prompt);return Response.json({prompt_id:`scope-${graphs.length}`});}
    if(url.includes('/history/')){const id=url.split('/history/')[1];return Response.json({[id]:{status:{status_str:'success',completed:true},outputs:{'5':{images:[{filename:`${id}.png`,type:'output'}]}}}});}
    if(url.includes('/view?'))return new Response(new Uint8Array([137,80,78,71,13,10,26,10]),{headers:{'content-type':'image/png'}});
    if(url.endsWith('/queue'))return Response.json({queue_running:[],queue_pending:[]});
    throw new Error(`Unexpected synthetic request: ${url}`);
  };
  return {texts,graphs,fetcher,set failText(value:typeof failText){failText=value;}};
}
function request(f:ReturnType<typeof fixture>,targets:StudioTarget[],key='scoped-model'):StudioBatchRequest{
  return {kind:'render_batch',versions:readStudioContext(f.database,f.activityId),idempotencyKey:key,input:{targets,candidateCount:1,placement:'history_only'}};
}
async function approve(f:ReturnType<typeof fixture>,mock:ReturnType<typeof mockUpstream>,req:StudioBatchRequest){
  const job=createStudioBatch(f.database,f.config,f.activityId,req,{optimizerOverride:f.override});
  await prepareStudioBatch({...f,jobId:job.id,fetcher:mock.fetcher});const store=new StudioStore(f.database),review=store.get(f.activityId,job.id)!;
  assert.equal(review.status,'awaiting_review',JSON.stringify(review));assert.ok(review.result&&'plans' in review.result);
  assert.ok(review.result.plans.every(plan=>plan.canSubmit),JSON.stringify(review.result));
  assert.ok(review.result.plans.every(plan=>plan.optimizerModel==='backup-model'&&plan.optimizerProfileId==='backup'));
  assert.equal(mock.texts.length,0);assert.equal(mock.graphs.length,0);
  startStudioBatch(f.database,f.config,f.activityId,job.id,{expectedJobRevision:review.revision,planHash:review.planHash!});return job.id;
}

for(const kind of ['beat','comic_panel','media_slot'] as const)test(`scoped optimizer reaches actual ${kind} executor, preserves source/defaults, and records exact calls and graph`,async t=>{
  const f=fixture(t),mock=mockUpstream();const {app}=await createService({...f,fetcher:mock.fetcher});t.after(()=>app.close());
  let target:StudioTarget={kind:'beat',stageId:f.stageId,sceneId:'s',beatId:'b0'};
  if(kind==='media_slot')target={kind,slotId:'m'};
  if(kind==='comic_panel'){
    const comics=new ComicStore(f.database),draft=comics.createComicDraft(f.activityId,f.activities.getActivity(f.activityId)!.currentContentRevisionId!);
    const panels=materializeComicStoryboard({panels:Array.from({length:4},()=>({sourceBeatIds:['b0'],actorIds:['a'],shotSize:'medium',visualDescription:'观察结晶',composition:'实验台在前景',textSafeArea:'none',bubbles:[]}))},f.activities.getDraft(f.activityId)!.document,{stageId:f.stageId,sceneId:'s',panelCount:4});
    comics.saveComicDraft(f.activityId,draft.draftVersion,{...draft.document,...panels});target={kind,panelId:panels.panels[0].id};
  }
  const before=f.activities.getDraft(f.activityId),imageBefore=getImageConfigDraft(f.database,f.activityId),comicBefore=new ComicStore(f.database).getComicDraft(f.activityId);
  const req=request(f,[target]),id=await approve(f,mock,req);
  // Mutable defaults are deliberately unusable. A scoped override cannot fall
  // back to them, nor may their change invalidate this selected profile.
  f.database.connection.prepare("UPDATE provider_profiles SET enabled=0,model='changed-default' WHERE id='original'").run();
  await processStudioBatch({...f,jobId:id,fetcher:mock.fetcher});const job=new StudioStore(f.database).get(f.activityId,id)!;
  assert.equal(job.status,'succeeded',JSON.stringify(job));assert.equal(mock.texts.length,1);assert.equal(mock.texts[0].model,'backup-model');assert.equal(mock.graphs.length,1);
  assert.deepEqual(f.activities.getDraft(f.activityId),before);assert.deepEqual(getImageConfigDraft(f.database,f.activityId),imageBefore);assert.deepEqual(new ComicStore(f.database).getComicDraft(f.activityId),comicBefore);
  assert.equal(f.database.connection.prepare("SELECT profile_id FROM app_llm_assignments WHERE app_id='activities' AND role='text'").get()!.profile_id,'original');
  const item=listStudioItems(f.database,f.activityId,id).items[0];assert.equal(item.state,'succeeded');assert.equal(item.artifactIds.length,1);
  const task=f.database.connection.prepare('SELECT workflow_snapshot_json,actual_seed FROM generation_tasks WHERE id=?').get(item.generationTaskId!)!;
  assert.deepEqual(JSON.parse(String(task.workflow_snapshot_json)),mock.graphs[0]);assert.equal(Number(task.actual_seed),item.seed);
  const optimizer=f.database.connection.prepare("SELECT * FROM ai_call_records WHERE business_event='activity.image.prompt.optimize'").get()!;
  assert.equal(optimizer.object_type,'activity-studio-job');assert.equal(optimizer.object_id,`${f.activityId}:${id}`);assert.equal(optimizer.trace_id,job.traceId);assert.equal(optimizer.status,'succeeded');
  assert.deepEqual(JSON.parse(String(optimizer.models_json)),['backup-model']);assert.equal(JSON.parse(String(optimizer.request_snapshot_json)).body.model,'backup-model');
  assert.equal(optimizer.source_url,`/apps/activities/${f.activityId}?tab=studio&studioJobId=${id}`);
  assert.equal(JSON.parse(String(optimizer.request_snapshot_json)).url,'http://optimizer.test/v1/chat/completions');
  const imageCall=f.database.connection.prepare('SELECT * FROM ai_call_records WHERE id=?').get(item.callId!)!;
  assert.equal(imageCall.parent_id,optimizer.id);assert.equal(imageCall.trace_id,job.traceId);
  assert.equal(JSON.parse(String(imageCall.parameters_json)).visualConfiguration.fallbackOf,f.override.fallbackOf);
  assert.equal(JSON.parse(String(optimizer.parameters_json)).studioItemId,item.id);
  const run=f.database.connection.prepare('SELECT optimizer_call_id,generation_task_id FROM activity_prompt_optimization_runs').get()!;
  assert.equal(run.optimizer_call_id,optimizer.id);assert.equal(run.generation_task_id,item.generationTaskId);
  assert.equal(createStudioBatch(f.database,f.config,f.activityId,req,{optimizerOverride:f.override}).id,id);
  await processStudioBatch({...f,jobId:id,fetcher:mock.fetcher});assert.equal(mock.texts.length,1);assert.equal(mock.graphs.length,1);
});

test('exact optimizer ownership prevents shared-trace cross-linking and duplicate concurrent requests; cached success retains optimized status',async t=>{
  const f=fixture(t),traceId='shared-trace',other=createAiCallRecord(f.database,{applicationId:'activities',traceId,feature:'unrelated',businessEvent:'activity.image.prompt.optimize',callType:'llm'});
  updateAiCallRecord(f.database,other,{status:'succeeded',responseText:'unrelated'});
  const input={activityId:f.activityId,workflowId:'visual-flow',workflowVersion:1,policy,sourcePrompt:'观察结晶',idempotencyKey:'one-optimizer',traceId};
  let calls=0,release!:()=>void,entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
  const fetcher:typeof fetch=async()=>{calls++;entered();await gate;return Response.json({choices:[{message:{content:'scientist and crystal'}}]});};
  const first=optimizeActivityImagePrompt(f.database,f.secrets,input,fetcher);await started;
  await assert.rejects(optimizeActivityImagePrompt(f.database,f.secrets,input,fetcher),{code:'prompt_optimization_in_progress'});assert.equal(calls,1);
  const during=f.database.connection.prepare('SELECT optimizer_call_id FROM activity_prompt_optimization_runs WHERE idempotency_key=?').get(input.idempotencyKey)!;
  assert.ok(during.optimizer_call_id);assert.notEqual(during.optimizer_call_id,other);release();const result=await first;
  assert.equal(result.optimizerCallId,during.optimizer_call_id);const cached=await optimizeActivityImagePrompt(f.database,f.secrets,input,fetcher);
  assert.equal(cached.status,'optimized');assert.equal(cached.optimizerCallId,result.optimizerCallId);assert.equal(calls,1);
  assert.equal(f.database.connection.prepare('SELECT response_text FROM ai_call_records WHERE id=?').get(other)!.response_text,'unrelated');
});

test('transport and gateway uncertainty keep original audit evidence, exact failure ID, no image, and stop later batch targets',async t=>{
  for(const mode of ['transport','503'] as const)for(const kind of ['beat','comic_panel','media_slot'] as const){
    const f=fixture(t),mock=mockUpstream();mock.failText=mode;
    let targets:StudioTarget[]=[{kind:'beat',stageId:f.stageId,sceneId:'s',beatId:'b0'},{kind:'beat',stageId:f.stageId,sceneId:'s',beatId:'b1'}];
    if(kind==='media_slot')targets=['m','m2'].map(slotId=>({kind,slotId}));
    if(kind==='comic_panel'){
      const comics=new ComicStore(f.database),draft=comics.createComicDraft(f.activityId,f.activities.getActivity(f.activityId)!.currentContentRevisionId!);
      const panels=materializeComicStoryboard({panels:Array.from({length:4},()=>({sourceBeatIds:['b0'],actorIds:['a'],shotSize:'medium',visualDescription:'观察结晶',composition:'实验台',textSafeArea:'none',bubbles:[]}))},f.activities.getDraft(f.activityId)!.document,{stageId:f.stageId,sceneId:'s',panelCount:4});
      comics.saveComicDraft(f.activityId,draft.draftVersion,{...draft.document,...panels});targets=panels.panels.slice(0,2).map(panel=>({kind,panelId:panel.id}));
    }
    const req=request(f,targets,`${mode}-${kind}`);
    const id=await approve(f,mock,req);await processStudioBatch({...f,jobId:id,fetcher:mock.fetcher});
    const job=new StudioStore(f.database).get(f.activityId,id)!;assert.equal(job.status,'unknown',JSON.stringify(job));assert.equal(mock.texts.length,1);assert.equal(mock.graphs.length,0);
    const items=listStudioItems(f.database,f.activityId,id).items;assert.equal(items[0].state,'unknown');assert.equal(items[1].state,'waiting');assert.ok(items[0].callId);
    const call=f.database.connection.prepare('SELECT status,error_code FROM ai_call_records WHERE id=?').get(items[0].callId!)!;
    assert.equal(call.status,mode==='transport'?'abandoned':'failed');assert.equal(call.error_code,mode==='transport'?'upstream_unavailable':'http_503');
    assert.ok(promptOptimizationCallUncertain(f.database,items[0].callId!));
    await processStudioBatch({...f,jobId:id,fetcher:mock.fetcher});assert.equal(mock.texts.length,1);
  }
});

test('changed scoped profile, missing credentials, disabled optimization and second failure cannot dispatch or silently use defaults',async t=>{
  const f=fixture(t),mock=mockUpstream(),req=request(f,[{kind:'beat',stageId:f.stageId,sceneId:'s',beatId:'b0'}]);
  const id=await approve(f,mock,req);f.database.connection.prepare("UPDATE provider_profiles SET model='changed-backup' WHERE id='backup'").run();
  await processStudioBatch({...f,jobId:id,fetcher:mock.fetcher});assert.equal(new StudioStore(f.database).get(f.activityId,id)!.status,'paused');assert.equal(mock.texts.length,0);assert.equal(mock.graphs.length,0);
  const context={traceId:'private-override',jobId:'synthetic-job',canContinue:()=>true,optimizerOverride:f.override};
  const input={activityId:f.activityId,workflowId:'visual-flow',workflowVersion:1,policy,sourcePrompt:'观察结晶',idempotencyKey:'changed-backup',studioContext:context};
  await assert.rejects(optimizeActivityImagePrompt(f.database,f.secrets,input,mock.fetcher),{code:'prompt_optimizer_profile_unavailable'});
  assert.equal(mock.texts.length,0);
  await assert.rejects(optimizeActivityImagePrompt(f.database,f.secrets,{...input,idempotencyKey:'off',policy:{...policy,enabled:false}},mock.fetcher),{code:'studio_fallback_optimizer_disabled'});
  f.database.connection.prepare("UPDATE provider_profiles SET credential_account='profile:absent' WHERE id='backup'").run();
  context.optimizerOverride={...f.override,profileHash:studioTextProfileBinding(f.database,'backup').hash};
  await assert.rejects(optimizeActivityImagePrompt(f.database,f.secrets,{...input,idempotencyKey:'missing-secret'},mock.fetcher),{code:'prompt_optimizer_profile_unavailable'});assert.equal(mock.texts.length,0);
  f.database.connection.prepare("UPDATE provider_profiles SET credential_account=NULL,model='backup-model' WHERE id='backup'").run();
  f.override.profileHash=studioTextProfileBinding(f.database,'backup').hash;mock.failText='empty';
  const next=await approve(f,mock,request(f,[{kind:'beat',stageId:f.stageId,sceneId:'s',beatId:'b1'}],'second-failed'));
  await processStudioBatch({...f,jobId:next,fetcher:mock.fetcher});const failed=new StudioStore(f.database).get(f.activityId,next)!;
  assert.equal(failed.status,'paused');assert.equal(mock.texts.length,1);assert.equal(mock.graphs.length,0);
  const item=listStudioItems(f.database,f.activityId,next).items[0];assert.equal(item.state,'failed');assert.equal(promptOptimizationCallUncertain(f.database,item.callId!),false);
  assert.throws(()=>retryStudioBatch(f.database,f.config,f.activityId,next,{expectedJobRevision:failed.revision,itemIds:[item.id],idempotencyKey:'bypass-fallback'}),{code:'studio_fallback_limit'});
  recoverStudioJobs(f.database,f.config,{startup:true});assert.equal(new StudioStore(f.database).get(f.activityId,next)!.status,'paused','restart cannot turn a failed fallback into a runnable attempt');
});

test('audit binding rejection is not dispatched and never invokes upstream',async t=>{
  const f=fixture(t);let calls=0,callId='';
  await assert.rejects(fetchAuditedAiResponse(f.database,{applicationId:'activities',feature:'test',businessEvent:'test.binding',callType:'llm'},
    async()=>{calls++;return Response.json({});},'http://test.invalid',{method:'POST',body:'{}'},
    {onRecord(id){callId=id;throw new Error('synthetic durable binding rejected');}}),/binding rejected/);
  assert.equal(calls,0);assert.equal(f.database.connection.prepare('SELECT status FROM ai_call_records WHERE id=?').get(callId)!.status,'not_dispatched');
});

test('restart after optimizer dispatch retains exact item call and unknown state; no response is permission to retry or resume',async t=>{
  const f=fixture(t),mock=mockUpstream(),id=await approve(f,mock,request(f,[{kind:'beat',stageId:f.stageId,sceneId:'s',beatId:'b0'}]));
  const item=listStudioItems(f.database,f.activityId,id).items[0];
  f.database.connection.prepare("UPDATE activity_studio_jobs SET status='running',lease_owner='old',lease_expires_at='2000-01-01' WHERE id=?").run(id);
  f.database.connection.prepare("UPDATE activity_studio_job_items SET state='preparing' WHERE id=?").run(item.id);
  const callId=createAiCallRecord(f.database,{applicationId:'activities',objectType:'activity-studio-job',objectId:id,
    traceId:new StudioStore(f.database).get(f.activityId,id)!.traceId,feature:'activity-image-prompt-optimization',businessEvent:'activity.image.prompt.optimize',callType:'llm'});
  bindStudioOptimizerCall(f.database,{traceId:'unused',jobId:id,itemId:item.id,canContinue:()=>true},callId);
  updateAiCallRecord(f.database,callId,{status:'submitted'});
  recoverStudioJobs(f.database,f.config,{startup:true});const current=new StudioStore(f.database).get(f.activityId,id)!;
  assert.equal(current.status,'unknown');assert.equal(current.callId,callId);
  const recovered=listStudioItems(f.database,f.activityId,id).items[0];assert.equal(recovered.state,'unknown');assert.equal(recovered.callId,callId);assert.equal(recovered.generationTaskId,null);
  assert.throws(()=>resumeStudioJob(f.database,f.config,f.activityId,id,{expectedJobRevision:current.revision,planHash:current.planHash!,itemIds:[item.id]}),{code:'studio_resume_unsafe'});
  await processStudioBatch({...f,jobId:id,fetcher:mock.fetcher});assert.equal(mock.texts.length,0);assert.equal(mock.graphs.length,0);
});

test('stopping while credentials resolve leaves the optimization unsubmitted and never steals another item call on the shared trace',async t=>{
  const f=fixture(t),traceId='stopped-shared-trace',other=createAiCallRecord(f.database,{applicationId:'activities',traceId,feature:'other',businessEvent:'activity.image.prompt.optimize',callType:'llm'});
  updateAiCallRecord(f.database,other,{status:'succeeded'});let active=true,calls=0;
  f.database.connection.prepare("UPDATE provider_profiles SET credential_account='profile:backup' WHERE id='backup'").run();
  class StoppingSecrets extends SecretStore { override async get(){active=false;return {value:'synthetic-secret',source:'environment' as const};} }
  const context={traceId,canContinue:()=>active,optimizerOverride:{...f.override,profileHash:studioTextProfileBinding(f.database,'backup').hash}};
  const input={activityId:f.activityId,workflowId:'visual-flow',workflowVersion:1,policy,sourcePrompt:'结晶',traceId,idempotencyKey:'stopped-creds',studioContext:context};
  await assert.rejects(optimizeActivityImagePrompt(f.database,new StoppingSecrets({}),input,async()=>{calls++;return Response.json({});}),{code:'studio_process_interrupted'});
  const run=f.database.connection.prepare('SELECT status,optimizer_call_id FROM activity_prompt_optimization_runs WHERE idempotency_key=?').get(input.idempotencyKey)!;
  assert.equal(run.status,'failed');assert.equal(run.optimizer_call_id,null);assert.equal(calls,0);assert.equal(f.database.connection.prepare('SELECT status FROM ai_call_records WHERE id=?').get(other)!.status,'succeeded');
});

test('source change while scoped credentials resolve pauses before any optimization or image request',async t=>{
  const f=fixture(t),mock=mockUpstream();
  f.database.connection.prepare("UPDATE provider_profiles SET credential_account='profile:backup' WHERE id='backup'").run();
  f.override.profileHash=studioTextProfileBinding(f.database,'backup').hash;
  f.secrets=new SecretStore({STHSTART_SECRET_BACKUP:'isolated-backup-key'});
  const id=await approve(f,mock,request(f,[{kind:'beat',stageId:f.stageId,sceneId:'s',beatId:'b0'}]));
  class EditingSecrets extends SecretStore { override async get(){
    const draft=f.activities.getDraft(f.activityId)!;
    f.activities.updateDraft(f.activityId,draft.draftVersion,{...draft.document,scenes:draft.document.scenes!.map(scene=>({...scene,beats:scene.beats.map(beat=>beat.id==='b0'?{...beat,action:'新的动作'}:beat)}))});
    return {value:'isolated-backup-key',source:'environment' as const};
  } }
  await processStudioBatch({...f,secrets:new EditingSecrets({}),jobId:id,fetcher:mock.fetcher});
  const current=new StudioStore(f.database).get(f.activityId,id)!;assert.equal(current.status,'paused');assert.equal(current.errorCode,'studio_plan_changed');
  assert.equal(mock.texts.length,0);assert.equal(mock.graphs.length,0);
  assert.equal(listStudioItems(f.database,f.activityId,id).items[0].callId,null);
});
