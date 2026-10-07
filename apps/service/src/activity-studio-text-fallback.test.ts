import assert from 'node:assert/strict';
import test from 'node:test';
import {Value} from '@sinclair/typebox/value';
import {buildActivityDocument,StudioTextFallbackOptionsSchema,StudioTextFallbackPreviewSchema,type StudioStoryboardRequest,type StudioRefineRequest} from '@sthstart/contracts';
import {ServiceDatabase,nowIso} from './database.js';
import {SecretStore} from './security.js';
import {readConfig} from './config.js';
import {createService} from './server.js';
import {ActivityStore} from './activities/store.js';
import {getImageConfigDraft} from './activities/image-configs.js';
import {StudioStore,studioHash} from './activities/studio-store.js';
import {freezeStudioStoryboard,processStudioStoryboard} from './activities/studio-storyboard.js';
import {freezeStudioRefine,processStudioRefine} from './activities/studio-refine.js';
import {listStudioTextFallbackOptions,previewStudioTextFallback,createStudioTextFallback} from './activities/studio-text-fallback.js';

const token='studio-fallback-isolated-admin-not-production',headers={'x-sthstart-admin-token':token},secrets=new SecretStore({});
const good={scene:{title:'实验',timeText:'',locationText:'营地',environment:''},beats:[1,2].map(i=>({actorIds:['a'],primaryActorId:'a',action:`观察${i}`,dialogue:'',outcome:'',director:{},composition:''}))};
const response=(value:unknown)=>Response.json({choices:[{message:{content:typeof value==='string'?value:JSON.stringify(value)}}]});
function fixture(){
  const database=new ServiceDatabase(),activities=new ActivityStore(database),content=buildActivityDocument({templateId:'blank',title:'备用验收',type:'测试',theme:'实验',location:'营地',rules:'',
    actors:[{id:'a',displayName:'研究员',persona:{appearance:{baseText:'银发'}},activityRole:'',outfitDescription:'外套'}]});
  const stageId=content.stages[0].id;
  content.scenes=[{id:'s',stageId,title:'实验',timeText:'',locationText:'营地',beats:[{id:'b',characterId:'a',action:'观察',dialogue:'不改',mediaUrl:'/original.png'}]}];
  const activity=activities.createActivity({title:content.activity.title,type:'测试',initialDocument:content}).activity;
  const config=getImageConfigDraft(database,activity.id),now=nowIso();
  database.connection.prepare("INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('activities','活动','fallback-test-hash','[]',1,?,?)").run(now,now);
  for(const [id,enabled,account] of [['original',1,null],['backup',1,null],['disabled',0,null],['missing-key',1,'unavailable-fallback-credential']] as const)
    database.connection.prepare(`INSERT INTO provider_profiles(id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at) VALUES (?,?, 'llm','http://fallback.test/v1',?,?,?,?,?)`)
      .run(id,`配置 ${id}`,`${id}-model`,account,enabled,now,now);
  database.connection.prepare("INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('activities','text','original',?)").run(now);
  const request:StudioStoryboardRequest={kind:'storyboard',idempotencyKey:'original',versions:{headVersion:activity.headVersion,contentDraftVersion:1,contentRevisionId:activity.currentContentRevisionId,
    imageConfigDraftVersion:config.draftVersion,imageConfigRevisionId:config.baseRevisionId},input:{source:{kind:'text',text:'研究员观察结晶再记录参数。'},actorIds:['a'],output:'beats',count:2,stageId,sceneId:'s',instructions:''}};
  const jobs=new StudioStore(database),job=jobs.create({activityId:activity.id,kind:'storyboard',idempotencyKey:'original',request,freeze:()=>({...freezeStudioStoryboard(database,activity.id,request)})}).job;
  return {database,activities,activity,request,jobs,job};
}
async function failed(f:ReturnType<typeof fixture>,fetcher:typeof fetch=async()=>response('{bad JSON')){
  await processStudioStoryboard({database:f.database,secrets,activityId:f.activity.id,jobId:f.job.id,fetcher});return f.jobs.get(f.activity.id,f.job.id)!;
}
const confirm=(preview:Awaited<ReturnType<typeof previewStudioTextFallback>>,key='once')=>({profileId:preview.profileId,expectedJobRevision:preview.expectedJobRevision,planHash:preview.planHash,idempotencyKey:key});

test('text fallback freezes one existing profile, actual source and scope; no global setting/content writes, exact request audit and stable idempotency',async t=>{
  const f=fixture();t.after(()=>f.database.close());const parent=await failed(f),before=f.activities.getDraft(f.activity.id),old=f.jobs.get(f.activity.id,parent.id);
  const options=await listStudioTextFallbackOptions(f.database,secrets,f.activity.id,parent.id);
  assert.ok(Value.Check(StudioTextFallbackOptionsSchema,options));assert.equal(options.allowed,true);assert.equal(options.originalModel,'original-model');
  assert.deepEqual(options.profiles.map(p=>p.id).sort(),['backup','original']);
  const preview=await previewStudioTextFallback(f.database,secrets,f.activity.id,parent.id,{profileId:'backup'});
  assert.ok(Value.Check(StudioTextFallbackPreviewSchema,preview));assert.equal(preview.modelRequestCount,1);assert.equal(preview.imageTaskCount,0);assert.match(preview.scope,/2 镜/);
  assert.equal(f.database.connection.prepare('SELECT COUNT(*) n FROM ai_call_records').get()!.n,1);
  const request=confirm(preview),child=await createStudioTextFallback(f.database,secrets,f.activity.id,parent.id,request);
  assert.equal(child.parentJobId,parent.id);assert.equal(child.traceId,parent.traceId);assert.equal(child.callId,null);assert.equal(child.status,'queued');
  assert.equal(f.database.connection.prepare('SELECT COUNT(*) n FROM generation_tasks').get()!.n,0);
  assert.equal((await createStudioTextFallback(f.database,secrets,f.activity.id,parent.id,request)).id,child.id);
  await assert.rejects(createStudioTextFallback(f.database,secrets,f.activity.id,parent.id,{...request,profileId:'original'}),/同一个提交/);
  let calls=0;
  await processStudioStoryboard({database:f.database,secrets,activityId:f.activity.id,jobId:child.id,fetcher:async(_url,init)=>{
    calls++;const body=JSON.parse(String(init?.body));assert.equal(body.model,'backup-model');assert.match(body.messages[1].content,/研究员观察结晶再记录参数/);return response(good);}});
  const final=f.jobs.get(f.activity.id,child.id)!;assert.equal(final.status,'awaiting_review');assert.equal(calls,1);assert.notEqual(final.callId,parent.callId);
  const call=f.database.connection.prepare('SELECT * FROM ai_call_records WHERE id=?').get(final.callId!)!;
  assert.equal(call.retry_of,parent.callId);assert.equal(call.parent_id,parent.callId);assert.equal(call.trace_id,parent.traceId);assert.equal(call.object_id,child.id);
  assert.equal(JSON.parse(String(call.parameters_json)).fallbackOf,parent.id);assert.equal(JSON.parse(String(call.request_snapshot_json)).body.model,'backup-model');
  assert.deepEqual(f.activities.getDraft(f.activity.id),before);assert.deepEqual(f.jobs.get(f.activity.id,parent.id),old);
  assert.equal(f.database.connection.prepare("SELECT profile_id FROM app_llm_assignments WHERE app_id='activities' AND role='text'").get()!.profile_id,'original');
  assert.equal((await createStudioTextFallback(f.database,secrets,f.activity.id,parent.id,request)).id,child.id,'lost response retry after completion still reads original attempt');
  await assert.rejects(createStudioTextFallback(f.database,secrets,f.activity.id,parent.id,{...request,idempotencyKey:'another'}),/已经使用过一次/);
});

test('second model failure pauses, never loops, and a same-trace call cannot prove a new job was dispatched',async t=>{
  const f=fixture();t.after(()=>f.database.close());const parent=await failed(f),preview=await previewStudioTextFallback(f.database,secrets,f.activity.id,parent.id,{profileId:'backup'});
  const child=await createStudioTextFallback(f.database,secrets,f.activity.id,parent.id,confirm(preview));let calls=0;
  await processStudioStoryboard({database:f.database,secrets,activityId:f.activity.id,jobId:child.id,fetcher:async()=>{calls++;return response('{again bad');}});
  const final=f.jobs.get(f.activity.id,child.id)!;assert.equal(final.status,'paused');assert.notEqual(final.callId,parent.callId);assert.equal(calls,1);
  await processStudioStoryboard({database:f.database,secrets,activityId:f.activity.id,jobId:child.id,fetcher:async()=>{calls++;return response(good);}});
  assert.equal(calls,1);assert.equal((await listStudioTextFallbackOptions(f.database,secrets,f.activity.id,child.id)).allowed,false);
  await assert.rejects(previewStudioTextFallback(f.database,secrets,f.activity.id,child.id,{profileId:'original'}),/已经使用过一次/);
});

test('unknown transport/timeout/5xx/missing call, running/cancelled and imported history cannot authorize fallback',async t=>{
  for(const mode of ['transport','500','408','timeout','call_missing','running','cancelled','readonly'] as const){
    const f=fixture();t.after(()=>f.database.close());
    if(mode==='timeout')await processStudioStoryboard({database:f.database,secrets,activityId:f.activity.id,jobId:f.job.id,timeoutMs:5,fetcher:async(_url,init)=>new Promise((_done,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});})});
    else if(mode!=='running')await failed(f,mode==='transport'?async()=>{throw new Error('connection lost');}:mode==='500'||mode==='408'?async()=>new Response('error',{status:Number(mode)}):undefined);
    if(mode==='call_missing')f.database.connection.prepare('DELETE FROM ai_call_records WHERE id=?').run(f.jobs.get(f.activity.id,f.job.id)!.callId!);
    if(mode==='cancelled')f.database.connection.prepare("UPDATE activity_studio_jobs SET status='cancelled',stop_requested=1 WHERE id=?").run(f.job.id);
    if(mode==='readonly')f.database.connection.prepare('UPDATE activity_studio_jobs SET input_json=? WHERE id=?').run(JSON.stringify({...f.job.input,readOnly:true}),f.job.id);
    const options=await listStudioTextFallbackOptions(f.database,secrets,f.activity.id,f.job.id);
    assert.equal(options.allowed,false,mode);assert.deepEqual(options.profiles,[],mode);
    await assert.rejects(previewStudioTextFallback(f.database,secrets,f.activity.id,f.job.id,{profileId:'backup'}));
    assert.equal(f.jobs.list(f.activity.id).items.length,1);
  }
});

test('explicit 403 failure permits manual preview only, never automatically swaps or retries',async t=>{
  const f=fixture();t.after(()=>f.database.close());let calls=0;const parent=await failed(f,async()=>{calls++;return new Response('quota denied',{status:403});});
  assert.equal(calls,1);assert.equal(f.jobs.list(f.activity.id).items.length,1);
  const preview=await previewStudioTextFallback(f.database,secrets,f.activity.id,parent.id,{profileId:'backup'});assert.equal(preview.originalModel,'original-model');assert.equal(calls,1);
});

test('preview and dispatch each reject changed configuration/source, missing credential and untrusted input before another network request',async t=>{
  for(const mode of ['config_before_confirm','config_before_dispatch','source_before_confirm','source_before_dispatch','missing_credential','untrusted'] as const){
    const f=fixture();t.after(()=>f.database.close());const parent=await failed(f),preview=await previewStudioTextFallback(f.database,secrets,f.activity.id,parent.id,{profileId:'backup'}),request=confirm(preview);
    const beforeDispatch=mode.endsWith('dispatch'),child=beforeDispatch?await createStudioTextFallback(f.database,secrets,f.activity.id,parent.id,request):null;
    if(mode.startsWith('config'))f.database.connection.prepare("UPDATE provider_profiles SET model='changed-model' WHERE id='backup'").run();
    if(mode.startsWith('source')){const draft=f.activities.getDraft(f.activity.id)!;f.activities.updateDraft(f.activity.id,draft.draftVersion,{...draft.document,scenes:draft.document.scenes!.map(s=>({...s,beats:s.beats.map(b=>({...b,action:'人工新动作'}))}))});}
    if(child){let calls=0;await processStudioStoryboard({database:f.database,secrets,activityId:f.activity.id,jobId:child.id,fetcher:async()=>{calls++;return response(good);}});
      const final=f.jobs.get(f.activity.id,child.id)!;assert.equal(final.status,'paused');assert.equal(final.callId,null,'do not attach the parent call when this attempt never dispatched');assert.equal(calls,0);}
    else await assert.rejects(createStudioTextFallback(f.database,secrets,f.activity.id,parent.id,mode==='missing_credential'?{...request,profileId:'missing-key'}:mode==='untrusted'?{...request,baseUrl:'http://untrusted'} as typeof request:request));
    assert.equal(f.database.connection.prepare('SELECT COUNT(*) n FROM ai_call_records').get()!.n,1);
  }
});

test('concurrent distinct confirmation keys reserve just one fallback',async t=>{
  const f=fixture();t.after(()=>f.database.close());const parent=await failed(f),preview=await previewStudioTextFallback(f.database,secrets,f.activity.id,parent.id,{profileId:'backup'});
  const results=await Promise.allSettled(['a','b'].map(key=>createStudioTextFallback(f.database,secrets,f.activity.id,parent.id,confirm(preview,key))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.jobs.list(f.activity.id).items.length,2);
  assert.equal(studioHash(f.jobs.get(f.activity.id,parent.id)),studioHash(parent));assert.deepEqual(f.database.connection.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('late fallback insertion failure rolls back the reservation and never changes the original task or drafts',async t=>{
  const f=fixture();t.after(()=>f.database.close());const parent=await failed(f),before=f.activities.getDraft(f.activity.id),preview=await previewStudioTextFallback(f.database,secrets,f.activity.id,parent.id,{profileId:'backup'});
  f.database.connection.exec("CREATE TRIGGER reject_fallback BEFORE INSERT ON activity_studio_jobs WHEN NEW.parent_job_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'synthetic fallback late insert'); END");
  await assert.rejects(createStudioTextFallback(f.database,secrets,f.activity.id,parent.id,confirm(preview)),/synthetic fallback late insert/);
  assert.equal(f.jobs.list(f.activity.id).items.length,1);assert.deepEqual(f.jobs.get(f.activity.id,parent.id),parent);assert.deepEqual(f.activities.getDraft(f.activity.id),before);
  f.database.connection.exec('DROP TRIGGER reject_fallback');
  const child=await createStudioTextFallback(f.database,secrets,f.activity.id,parent.id,confirm(preview));assert.equal(child.status,'queued');
  assert.equal(f.jobs.list(f.activity.id).items.length,2);assert.deepEqual(f.database.connection.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('managed profile candidates require an enabled text-capable connection/model and safe credentials; no legacy bypass or private options leak',async t=>{
  const f=fixture();t.after(()=>f.database.close());const parent=await failed(f),now=nowIso();
  for(const [id,kind,enabled] of [['conn','openai-compatible-text',1],['off','openai-compatible-text',0],['image','openai-compatible-image',1]] as const)
    f.database.connection.prepare(`INSERT INTO service_connections(id,name,kind,base_url,headers_json,options_json,enabled,created_at,updated_at) VALUES (?,?,?,'http://managed.test/v1',?, '{}',?,?,?)`)
      .run(id,id,kind,JSON.stringify({'x-api-key':'synthetic-private-header-value'}),enabled,now,now);
  for(const [id,connection,enabled,capabilities] of [['managed','conn',1,['text']],['disabled','conn',0,['text']],['not-text','conn',1,['image']],['off-model','off',1,['text']],['image-model','image',1,['text']]] as const)
    f.database.connection.prepare(`INSERT INTO model_profiles(id,connection_id,name,model_id,capabilities_json,enabled,created_at,updated_at) VALUES (?,?,?,'managed-model',?,?,?,?)`)
      .run(id,connection,id,JSON.stringify(capabilities),enabled,now,now);
  const options=await listStudioTextFallbackOptions(f.database,secrets,f.activity.id,parent.id);
  assert.deepEqual(options.profiles.map(p=>p.id).sort(),['backup','managed','original']);
  const preview=await previewStudioTextFallback(f.database,secrets,f.activity.id,parent.id,{profileId:'managed'});
  assert.equal(preview.model,'managed-model');assert.ok(!JSON.stringify(preview).includes('synthetic-private-header-value'));
  for(const id of ['disabled','not-text','off-model','image-model'])await assert.rejects(previewStudioTextFallback(f.database,secrets,f.activity.id,parent.id,{profileId:id}));
  const child=await createStudioTextFallback(f.database,secrets,f.activity.id,parent.id,confirm(preview));
  await processStudioStoryboard({database:f.database,secrets,activityId:f.activity.id,jobId:child.id,fetcher:async(_url,init)=>{
    assert.equal((init?.headers as Record<string,string>)['x-api-key'],'synthetic-private-header-value');assert.equal(JSON.parse(String(init?.body)).model,'managed-model');return response(good);}});
  assert.equal(f.jobs.get(f.activity.id,child.id)!.status,'awaiting_review');
  const raw=f.database.connection.prepare('SELECT * FROM ai_call_records WHERE id=?').get(f.jobs.get(f.activity.id,child.id)!.callId!);
  assert.ok(!JSON.stringify(raw).includes('synthetic-private-header-value'));assert.ok(!JSON.stringify(child.input).includes('synthetic-private-header-value'));
});

test('unavailable original credentials are a known pre-network failure and can be replaced manually without unauthenticated dispatch',async t=>{
  const f=fixture();t.after(()=>f.database.close());f.database.connection.prepare("UPDATE provider_profiles SET credential_account='missing-pre-network-secret' WHERE id='original'").run();
  let calls=0;await processStudioStoryboard({database:f.database,secrets,activityId:f.activity.id,jobId:f.job.id,fetcher:async()=>{calls++;return response(good);}});
  const original=f.jobs.get(f.activity.id,f.job.id)!;assert.equal(original.errorCode,'studio_profile_unavailable');assert.equal(original.callId,null);assert.equal(calls,0);
  const preview=await previewStudioTextFallback(f.database,secrets,f.activity.id,f.job.id,{profileId:'backup'});assert.equal(preview.originalModel,null,'no actual model request is fabricated');
  assert.equal((await createStudioTextFallback(f.database,secrets,f.activity.id,f.job.id,confirm(preview))).status,'queued');assert.equal(calls,0);
});

test('refine fallback keeps frozen scope, requires review, and submits the selected actual model',async t=>{
  const f=fixture();t.after(()=>f.database.close());const request:StudioRefineRequest={kind:'refine',versions:f.request.versions,input:{target:{kind:'beat',stageId:f.request.input.stageId,sceneId:'s',beatId:'b'},instructions:'拉远一点'},idempotencyKey:'refine'};
  const original=f.jobs.create({activityId:f.activity.id,kind:'refine',idempotencyKey:'refine',request,freeze:()=>({...freezeStudioRefine(f.database,f.activity.id,request)})}).job;
  await processStudioRefine({database:f.database,secrets,activityId:f.activity.id,jobId:original.id,fetcher:async()=>response({patch:{action:'非法'},explanation:'非法'})});
  const preview=await previewStudioTextFallback(f.database,secrets,f.activity.id,original.id,{profileId:'backup'}),child=await createStudioTextFallback(f.database,secrets,f.activity.id,original.id,confirm(preview));
  const before=f.activities.getDraft(f.activity.id);
  await processStudioRefine({database:f.database,secrets,activityId:f.activity.id,jobId:child.id,fetcher:async(_url,init)=>{assert.equal(JSON.parse(String(init?.body)).model,'backup-model');return response({patch:{director:{shotSize:'wide'}},explanation:'只拉远景别'});}});
  assert.equal(f.jobs.get(f.activity.id,child.id)!.status,'awaiting_review');assert.deepEqual(f.activities.getDraft(f.activity.id),before);
});

test('admin routes enforce ownership and strict fields; preview makes no calls, accepted confirmation runs exactly once',async t=>{
  const f=fixture();t.after(()=>f.database.close());const parent=await failed(f);let calls=0;
  const {app}=await createService({database:f.database,secrets,config:readConfig({STHSTART_ADMIN_TOKEN:token}),fetcher:async(_url,init)=>{calls++;assert.equal(JSON.parse(String(init?.body)).model,'backup-model');return response(good);}});
  t.after(()=>app.close());const url=`/api/v1/admin/activities/${f.activity.id}/studio-jobs/${parent.id}`;
  assert.equal((await app.inject({method:'GET',url:`${url}/text-fallback-options`})).statusCode,401);
  assert.equal((await app.inject({method:'GET',url:`/api/v1/admin/activities/foreign/studio-jobs/${parent.id}/text-fallback-options`,headers})).statusCode,404);
  assert.equal((await app.inject({method:'POST',url:`${url}/text-fallback-preview`,headers,payload:{profileId:'backup',token:'no'}})).statusCode,400);
  const options=await app.inject({method:'GET',url:`${url}/text-fallback-options`,headers});assert.equal(options.headers['cache-control'],'no-store');assert.ok(Value.Check(StudioTextFallbackOptionsSchema,options.json()));
  const preview=await app.inject({method:'POST',url:`${url}/text-fallback-preview`,headers,payload:{profileId:'backup'}});assert.equal(preview.statusCode,200,preview.body);assert.equal(calls,0);
  const payload=confirm(preview.json()),result=await app.inject({method:'POST',url:`${url}/text-fallback`,headers,payload});assert.equal(result.statusCode,202,result.body);
  for(let i=0;i<100&&f.jobs.get(f.activity.id,result.json().id)!.status!=='awaiting_review';i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(f.jobs.get(f.activity.id,result.json().id)!.status,'awaiting_review');assert.equal(calls,1);
  const duplicate=await app.inject({method:'POST',url:`${url}/text-fallback`,headers,payload});assert.equal(duplicate.statusCode,202);assert.equal(duplicate.json().id,result.json().id);assert.equal(calls,1);
});
