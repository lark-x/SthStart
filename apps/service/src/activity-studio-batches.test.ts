import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Value} from '@sinclair/typebox/value';
import {buildActivityDocument,StudioJobSchema,StudioItemPageSchema,type StudioBatchRequest,type StudioTarget} from '@sthstart/contracts';
import {ServiceDatabase,nowIso} from './database.js';
import {readConfig} from './config.js';
import {SecretStore} from './security.js';
import {createService} from './server.js';
import {ActivityStore} from './activities/store.js';
import {ComicStore} from './activities/comic-store.js';
import {materializeComicStoryboard} from './activities/comic-storyboard.js';
import {getImageConfigDraft} from './activities/image-configs.js';
import {StudioStore} from './activities/studio-store.js';
import {createStudioBatch,prepareStudioBatch,startStudioBatch,processStudioBatch,listStudioItems,assertStudioBatchLimits,retryStudioBatch} from './activities/studio-batches.js';
import {prepareStudioContext} from './activities/studio-context.js';
import {installVisualTestWorkflow} from './activities/test-support/visual-workflow.js';
import {setDefaultPreset} from './generation/configuration-store.js';

const token='isolated-studio-batch-admin-token',headers={'x-sthstart-admin-token':token};
function upstream(){
  const graphs:Record<string,unknown>[]=[],prompts:string[]=[],requests:string[]=[];
  let onPrompt:(()=>void)|undefined,onOptimize:(()=>void)|undefined,failPrompt=0,unknownPrompt=0,failOptimize=false;
  const fetcher:typeof fetch=async(input,init)=>{
    const url=String(input);requests.push(url);
    if(url.endsWith('/chat/completions')){onOptimize?.();if(failOptimize){failOptimize=false;return Response.json({error:'synthetic optimizer failure'},{status:503});}const storyboard=String(init?.body).includes('剧情分镜导演');
      const output={scene:{title:'AI 新场次',timeText:'傍晚',locationText:'营地',environment:'暖光'},beats:Array.from({length:2},()=>({actorIds:['a'],primaryActorId:'a',action:'观察结晶',dialogue:'稳定。',outcome:'记录参数',director:{shotSize:'wide'},composition:'实验台在前景'}))};
      return Response.json({choices:[{message:{content:storyboard?JSON.stringify(output):'a silver haired scientist observing a crystal, wide shot'}}]});}
    if(url.endsWith('/object_info'))return Response.json({CLIPTextEncode:{input:{required:{text:['STRING',{}]}}},KSampler:{input:{required:{}}},CheckpointLoaderSimple:{input:{required:{ckpt_name:[['base.safetensors','turbo.safetensors'],{}]}}},SaveImage:{input:{required:{}}},EmptyLatentImage:{input:{required:{}}}});
    if(url.endsWith('/prompt')){graphs.push(JSON.parse(String(init?.body)).prompt);const id=`batch-prompt-${graphs.length}`;prompts.push(id);onPrompt?.();
      return graphs.length===unknownPrompt?Response.json({accepted:true}):graphs.length===failPrompt?Response.json({error:'synthetic failure'},{status:400}):Response.json({prompt_id:id});}
    if(url.includes('/history/')){const id=url.split('/history/')[1];return Response.json({[id]:{status:{status_str:'success',completed:true},outputs:{'5':{images:[{filename:`${id}-one.png`,subfolder:'',type:'output'},{filename:`${id}-two.png`,subfolder:'',type:'output'}]}}}});}
    if(url.includes('/view?'))return new Response(new Uint8Array([137,80,78,71,13,10,26,10]),{headers:{'content-type':'image/png'}});
    if(url.endsWith('/queue'))return Response.json({queue_running:[],queue_pending:[]});
    return new Response('not found',{status:404});
  };
  return {fetcher,graphs,requests,prompts,set onPrompt(value:(()=>void)|undefined){onPrompt=value;},set onOptimize(value:(()=>void)|undefined){onOptimize=value;},set failPrompt(value:number){failPrompt=value;},set unknownPrompt(value:number){unknownPrompt=value;},set failOptimize(value:boolean){failOptimize=value;}};
}
async function fixture(t:test.TestContext,kept=false){
  const database=new ServiceDatabase(),mock=upstream(),secrets=new SecretStore({}),config=readConfig({STHSTART_ADMIN_TOKEN:token,STHSTART_ARTIFACT_DIR:mkdtempSync(join(tmpdir(),'sthstart-studio-batch-'))});
  const {app}=await createService({database,config,secrets,fetcher:mock.fetcher});t.after(async()=>{await app.close();database.close();});
  const activities=new ActivityStore(database),now=nowIso(),profiles=installVisualTestWorkflow(database);setDefaultPreset(database,profiles.draft.presetId);
  database.connection.prepare("INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('activities','活动','isolated-batch-hash','[]',1,?,?)").run(now,now);
  database.connection.prepare("INSERT INTO provider_profiles(id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at) VALUES ('batch-text','测试模型','llm','http://test/v1','test',NULL,1,?,?)").run(now,now);
  database.connection.prepare("INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('activities','text','batch-text',?)").run(now);
  const content=buildActivityDocument({templateId:'blank',title:'隔离批量测试',type:'测试',theme:'',location:'营地',rules:'',actors:[{id:'a',displayName:'研究员',persona:{appearance:{baseText:'银发'}},outfitDescription:'蓝衣',activityRole:''}]});
  const stageId=content.stages[0].id;
  content.scenes=[{id:'s',stageId,title:'实验',timeText:'傍晚',locationText:'营地',beats:Array.from({length:6},(_,index)=>({id:`b${index}`,characterId:'a',action:`观察第 ${index+1} 颗结晶`,dialogue:'稳定。',...(index===0&&kept?{mediaUrl:'/kept.png'}:{})}))}];
  content.mediaSlots=Array.from({length:2},(_,index)=>({id:`m${index}`,kind:'image',stageId,caption:`结晶素材 ${index+1}`,shotDescription:'营地实验台',actorIds:['a'],sourceFactIds:[]}));
  const activity=activities.createActivity({title:content.activity.title,type:'测试',initialDocument:content}).activity;
  const image=getImageConfigDraft(database,activity.id);
  const commit=await app.inject({method:'POST',url:`/api/v1/admin/activities/${activity.id}/art-direction/commit`,headers,
    payload:{expectedHeadVersion:activity.headVersion,expectedImageConfigDraftVersion:image.draftVersion,document:{...image.document,artDirection:{selectedStyle:null,quality:'draft',canvas:{width:768,height:768},renderProfiles:profiles,parameterOverrides:{}}}}});
  assert.equal(commit.statusCode,200,commit.body);
  const versions=()=>{const current=activities.getActivity(activity.id)!,draft=activities.getDraft(activity.id)!,image=getImageConfigDraft(database,activity.id),comic=new ComicStore(database).getComicDraft(activity.id);
    return {headVersion:current.headVersion,contentDraftVersion:draft.draftVersion,contentRevisionId:current.currentContentRevisionId,imageConfigDraftVersion:image.draftVersion,imageConfigRevisionId:image.baseRevisionId,...(comic?{comicDraftVersion:comic.draftVersion}:{})};};
  const targets:StudioTarget[]=content.scenes[0].beats.map(beat=>({kind:'beat',stageId,sceneId:'s',beatId:beat.id}));
  const request=(selected=targets,placement:'fill_empty'|'history_only'='fill_empty',key='six-targets'):StudioBatchRequest=>({kind:'render_batch',versions:versions(),input:{targets:selected,candidateCount:1,placement},idempotencyKey:key});
  const options={database,config,secrets,activityId:activity.id,fetcher:mock.fetcher};
  return {...options,app,activities,activity,stageId,targets,request,versions,mock};
}
async function approved(f:Awaited<ReturnType<typeof fixture>>,request:StudioBatchRequest){
  const job=createStudioBatch(f.database,f.config,f.activity.id,request);assert.equal(f.mock.graphs.length,0);
  await prepareStudioBatch({...f,jobId:job.id});const review=new StudioStore(f.database).get(f.activity.id,job.id)!;
  assert.equal(review.status,'awaiting_review',JSON.stringify(review));assert.ok(review.result&&'plans' in review.result);
  assert.equal(review.result.imageTaskCount,request.input.targets.length*request.input.candidateCount);
  assert.ok(review.result.plans.every(plan=>plan.canSubmit),JSON.stringify(review.result));
  assert.ok(Value.Check(StudioJobSchema,review));
  startStudioBatch(f.database,f.config,f.activity.id,job.id,{expectedJobRevision:review.revision,planHash:review.planHash!});return job.id;
}

test('batch preview is read-only, frozen seeds/idempotency survive response loss, limits and API ownership are enforced',async t=>{
  const f=await fixture(t),request=f.request(),before=f.activities.getDraft(f.activity.id);
  const created=createStudioBatch(f.database,f.config,f.activity.id,request);
  assert.equal(createStudioBatch(f.database,f.config,f.activity.id,request).id,created.id);
  assert.throws(()=>createStudioBatch(f.database,f.config,f.activity.id,{...request,input:{...request.input,candidateCount:2}}),{code:'idempotency_conflict'});
  assert.throws(()=>assertStudioBatchLimits({...request,input:{...request.input,targets:[f.targets[0],f.targets[0]]}}),{code:'studio_invalid_request'});
  assert.throws(()=>assertStudioBatchLimits({...request,input:{...request.input,targets:[f.targets[0],{kind:'media_slot',slotId:'m0'}]}}),{code:'studio_invalid_request'});
  assert.throws(()=>assertStudioBatchLimits({...request,input:{...request.input,targets:Array.from({length:9},(_,i)=>({...f.targets[0],beatId:`b${i}`})),candidateCount:3}}),{code:'studio_batch_limit'});
  assert.equal(f.database.connection.prepare('SELECT COUNT(*) n FROM generation_tasks').get()!.n,0);
  await prepareStudioBatch({...f,jobId:created.id});assert.deepEqual(f.activities.getDraft(f.activity.id),before);assert.equal(f.mock.graphs.length,0);
  const listed=listStudioItems(f.database,f.activity.id,created.id,undefined,2);assert.equal(listed.items.length,2);assert.ok(listed.nextCursor);assert.ok(Value.Check(StudioItemPageSchema,listed));
  const next=listStudioItems(f.database,f.activity.id,created.id,listed.nextCursor!,2);assert.ok(next.items.every(item=>!listed.items.some(first=>first.id===item.id)));
  const base=`/api/v1/admin/activities/${f.activity.id}/studio-jobs/${created.id}`;
  assert.equal((await f.app.inject({method:'GET',url:`${base}/items`})).statusCode,401);
  assert.equal((await f.app.inject({method:'GET',url:`${base}/items?limit=21`,headers})).statusCode,400);
  assert.equal((await f.app.inject({method:'GET',url:`/api/v1/admin/activities/foreign/studio-jobs/${created.id}/items`,headers})).statusCode,404);
  const jobs=new StudioStore(f.database),review=jobs.get(f.activity.id,created.id)!;
  const start={expectedJobRevision:review.revision,planHash:review.planHash!};
  assert.throws(()=>startStudioBatch(f.database,f.config,f.activity.id,created.id,{...start,planHash:'wrong'}),{code:'studio_plan_changed'});
  startStudioBatch(f.database,f.config,f.activity.id,created.id,start);assert.equal(startStudioBatch(f.database,f.config,f.activity.id,created.id,start).id,created.id);
  assert.deepEqual(listStudioItems(f.database,f.activity.id,created.id).items.map(item=>item.seed),listed.items.concat(next.items,listStudioItems(f.database,f.activity.id,created.id,next.nextCursor!,2).items).map(item=>item.seed));
});

test('six beat targets fill empty pictures serially despite own draft increases; every output and actual graph remains linked',async t=>{
  const f=await fixture(t,true),id=await approved(f,f.request());await processStudioBatch({...f,jobId:id});
  const job=new StudioStore(f.database).get(f.activity.id,id)!;assert.equal(job.status,'succeeded',JSON.stringify(job));assert.equal(f.mock.graphs.length,6);
  const items=listStudioItems(f.database,f.activity.id,id).items;assert.equal(items.length,6);assert.ok(items.every(item=>item.state==='succeeded'&&item.artifactIds.length===2));
  assert.equal(items.filter(item=>item.placementState==='applied').length,5);assert.equal(items.filter(item=>item.placementState==='ineligible').length,1);
  const draft=f.activities.getDraft(f.activity.id)!;assert.equal(draft.document.scenes![0].beats[0].mediaUrl,'/kept.png');assert.ok(draft.document.scenes![0].beats.slice(1).every(beat=>beat.mediaUrl));
  for(const item of items){const task=f.database.connection.prepare('SELECT workflow_snapshot_json,actual_seed FROM generation_tasks WHERE id=?').get(item.generationTaskId!)!;
    const graph=JSON.parse(String(task.workflow_snapshot_json));assert.ok(f.mock.graphs.some(submitted=>JSON.stringify(submitted)===JSON.stringify(graph)));assert.equal(Number(task.actual_seed),item.seed);assert.ok(item.callId);}
  await processStudioBatch({...f,jobId:id});assert.equal(f.mock.graphs.length,6,'completed batch never replays');
});

test('comic fill-empty uses comic CAS and histories only; material selection changes only slot bindings',async t=>{
  const f=await fixture(t,true),comics=new ComicStore(f.database),comic=comics.createComicDraft(f.activity.id,f.activity.currentContentRevisionId!);
  const materialized=materializeComicStoryboard({panels:Array.from({length:6},(_,index)=>({sourceBeatIds:[`b${index}`],actorIds:['a'],shotSize:'medium',visualDescription:'观察结晶',composition:'实验台',textSafeArea:'none',bubbles:[]}))},f.activities.getDraft(f.activity.id)!.document,{stageId:f.stageId,sceneId:'s',panelCount:6});
  comics.saveComicDraft(f.activity.id,comic.draftVersion,{...comic.document,...materialized});const before=f.activities.getDraft(f.activity.id);
  const comicId=await approved(f,f.request(materialized.panels.map(panel=>({kind:'comic_panel',panelId:panel.id})),'fill_empty','comic-six'));
  await processStudioBatch({...f,jobId:comicId});assert.equal(new StudioStore(f.database).get(f.activity.id,comicId)!.status,'succeeded');
  assert.ok(comics.getComicDraft(f.activity.id)!.document.panels.every(panel=>panel.selectedImage));assert.deepEqual(f.activities.getDraft(f.activity.id),before);
  // The helper's read-only check applies to this second batch relative to already completed comic draws.
  f.mock.graphs.length=0;
  const mediaId=await approved(f,f.request([{kind:'media_slot',slotId:'m0'},{kind:'media_slot',slotId:'m1'}],'fill_empty','media-two'));
  await processStudioBatch({...f,jobId:mediaId});const mediaJob=new StudioStore(f.database).get(f.activity.id,mediaId)!;
  assert.equal(mediaJob.status,'succeeded',JSON.stringify(mediaJob));assert.deepEqual(f.activities.getDraft(f.activity.id),before);
  const current=f.activities.getActivity(f.activity.id)!,selection=f.activities.getMediaRevision(f.activity.id,current.currentMediaRevisionId!)!;
  assert.equal(selection.slotBindings.filter(binding=>binding.assets.length).length,2);assert.ok(listStudioItems(f.database,f.activity.id,mediaId).items.every(item=>item.placementState==='applied'));
});

test('manual image changes are retained, source changes pause further submissions, and stop preserves submitted history without global interrupt',async t=>{
  const f=await fixture(t),id=await approved(f,f.request(f.targets.slice(0,2)));
  f.mock.onPrompt=()=>{f.mock.onPrompt=undefined;const draft=f.activities.getDraft(f.activity.id)!;
    f.activities.updateDraft(f.activity.id,draft.draftVersion,{...draft.document,scenes:draft.document.scenes!.map(scene=>({...scene,beats:scene.beats.map(beat=>beat.id==='b0'?{...beat,mediaUrl:'/manual.png'}:beat.id==='b1'?{...beat,action:'人工新动作'}:beat)}))});};
  await processStudioBatch({...f,jobId:id});assert.equal(new StudioStore(f.database).get(f.activity.id,id)!.status,'paused');assert.equal(f.mock.graphs.length,1);
  assert.equal(f.activities.getDraft(f.activity.id)!.document.scenes![0].beats[0].mediaUrl,'/manual.png');assert.equal(listStudioItems(f.database,f.activity.id,id).items.find(item=>item.target.kind==='beat'&&item.target.beatId==='b0')!.placementState,'ineligible');
  f.mock.graphs.length=0;const stopped=await approved(f,f.request(f.targets.slice(2,4),'history_only','stop-batch'));
  f.mock.onPrompt=()=>{f.mock.onPrompt=undefined;const store=new StudioStore(f.database),job=store.get(f.activity.id,stopped)!;store.stop(f.activity.id,stopped,job.revision);};
  await processStudioBatch({...f,jobId:stopped});assert.equal(new StudioStore(f.database).get(f.activity.id,stopped)!.status,'cancelled');assert.equal(f.mock.graphs.length,1);
  assert.equal(listStudioItems(f.database,f.activity.id,stopped).items.filter(item=>item.state==='succeeded').length,1);assert.ok(!f.mock.requests.some(url=>url.endsWith('/interrupt')));
});

test('real admin HTTP preview/start accepts only the reviewed plan and repeated start never duplicates tasks',async t=>{
  const f=await fixture(t),base=`/api/v1/admin/activities/${f.activity.id}/studio-jobs`,request=f.request(f.targets.slice(0,2),'history_only');
  const created=await f.app.inject({method:'POST',url:base,headers,payload:request});assert.equal(created.statusCode,202,created.body);
  const store=new StudioStore(f.database),id=created.json().id;
  for(let i=0;i<100&&store.get(f.activity.id,id)!.status!=='awaiting_review';i++)await new Promise(resolve=>setTimeout(resolve,10));
  const review=store.get(f.activity.id,id)!;assert.equal(review.status,'awaiting_review');assert.equal(f.mock.graphs.length,0);
  assert.equal((await f.app.inject({method:'POST',url:`${base}/${id}/start`,headers,payload:{expectedJobRevision:review.revision,planHash:'wrong'}})).statusCode,409);
  const payload={expectedJobRevision:review.revision,planHash:review.planHash!};
  for(let i=0;i<2;i++)assert.equal((await f.app.inject({method:'POST',url:`${base}/${id}/start`,headers,payload})).statusCode,202);
  for(let i=0;i<1000&&['queued','preparing','running'].includes(store.get(f.activity.id,id)!.status);i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(store.get(f.activity.id,id)!.status,'succeeded');assert.equal(f.mock.graphs.length,2);
});

test('continuous storyboard apply atomically creates only its new targets; duplicate apply returns the same child and late child failure rolls back',async t=>{
  const f=await fixture(t,true),base=`/api/v1/admin/activities/${f.activity.id}/studio-jobs`,store=new StudioStore(f.database);
  const request={kind:'storyboard',idempotencyKey:'continuous',versions:f.versions(),input:{source:{kind:'text',text:'研究员观察结晶，然后记录温度。'},actorIds:['a'],output:'beats',count:2,stageId:f.stageId,sceneId:null,instructions:''}};
  const created=await f.app.inject({method:'POST',url:base,headers,payload:request});assert.equal(created.statusCode,202,created.body);const id=created.json().id;
  for(let i=0;i<100&&store.get(f.activity.id,id)!.status!=='awaiting_review';i++)await new Promise(resolve=>setTimeout(resolve,10));
  const review=store.get(f.activity.id,id)!;assert.equal(review.status,'awaiting_review',JSON.stringify(review));
  const payload={expectedJobRevision:review.revision,versions:f.versions(),resultHash:review.result!.resultHash,mode:'append',sceneId:null,renderAfterApply:true,placement:'fill_empty'};
  const before=f.activities.getDraft(f.activity.id);
  f.database.connection.exec("CREATE TRIGGER reject_batch_item BEFORE INSERT ON activity_studio_job_items BEGIN SELECT RAISE(ABORT,'synthetic continuous rollback'); END");
  assert.equal((await f.app.inject({method:'POST',url:`${base}/${id}/apply`,headers,payload})).statusCode,500);
  assert.deepEqual(f.activities.getDraft(f.activity.id),before);assert.equal(store.list(f.activity.id).items.length,1);assert.equal(store.get(f.activity.id,id)!.applyState,'not_applied');
  f.database.connection.exec('DROP TRIGGER reject_batch_item');
  const applied=await f.app.inject({method:'POST',url:`${base}/${id}/apply`,headers,payload});assert.equal(applied.statusCode,200,applied.body);
  const childId=applied.json().appliedResult.childJobId;assert.ok(childId);
  const duplicate=await f.app.inject({method:'POST',url:`${base}/${id}/apply`,headers,payload});assert.equal(duplicate.statusCode,200);assert.equal(duplicate.json().appliedResult.childJobId,childId);
  for(let i=0;i<1000&&['queued','preparing','running'].includes(store.get(f.activity.id,childId)!.status);i++)await new Promise(resolve=>setTimeout(resolve,10));
  const child=store.get(f.activity.id,childId)!;assert.equal(child.status,'succeeded',JSON.stringify(child));assert.equal(child.parentJobId,id);assert.equal(child.traceId,review.traceId);assert.equal(f.mock.graphs.length,2);
  const items=listStudioItems(f.database,f.activity.id,childId).items;assert.equal(items.length,2);assert.ok(items.every(item=>item.target.kind==='beat'&&applied.json().appliedResult.beatIds.includes(item.target.beatId)));
  assert.equal(f.activities.getDraft(f.activity.id)!.document.scenes!.find(scene=>scene.id==='s')!.beats[0].mediaUrl,'/kept.png');
});

test('source changes during optimization pause before ComfyUI; explicit failures allow other targets without hiding partial outcomes',async t=>{
  const f=await fixture(t),id=await approved(f,f.request(f.targets.slice(0,2)));
  f.mock.onOptimize=()=>{f.mock.onOptimize=undefined;const draft=f.activities.getDraft(f.activity.id)!;
    f.activities.updateDraft(f.activity.id,draft.draftVersion,{...draft.document,scenes:draft.document.scenes!.map(scene=>({...scene,beats:scene.beats.map(beat=>beat.id==='b0'?{...beat,action:'人工改变动作'}:beat)}))});};
  await processStudioBatch({...f,jobId:id});assert.equal(f.mock.graphs.length,0);assert.equal(new StudioStore(f.database).get(f.activity.id,id)!.status,'paused');
  const next=await approved(f,f.request(f.targets.slice(2,4),'history_only','partial'));
  f.mock.failPrompt=1;await processStudioBatch({...f,jobId:next});const job=new StudioStore(f.database).get(f.activity.id,next)!;
  assert.equal(job.status,'partially_succeeded',JSON.stringify(job));assert.equal(f.mock.graphs.length,2);const items=listStudioItems(f.database,f.activity.id,next).items;
  assert.equal(items.filter(item=>item.state==='failed').length,1);assert.equal(items.filter(item=>item.state==='succeeded').length,1);
});

test('context prepares only changed hashes atomically, preserves configuration binding and blocks stale input',async t=>{
  const f=await fixture(t),before=f.versions(),original=f.activities.getDraft(f.activity.id)!;
  assert.deepEqual(prepareStudioContext(f.database,f.activity.id,before),before);
  const configs=f.database.connection.prepare('SELECT COUNT(*) n FROM activity_image_config_revisions').get()!.n;
  f.activities.updateDraft(f.activity.id,original.draftVersion,{...original.document,scenes:original.document.scenes!.map(scene=>({...scene,title:'保存后的实验'}))});
  const expected=f.versions(),next=prepareStudioContext(f.database,f.activity.id,expected);
  assert.notEqual(next.contentRevisionId,before.contentRevisionId);assert.equal(next.imageConfigRevisionId,before.imageConfigRevisionId);
  assert.equal(f.database.connection.prepare('SELECT COUNT(*) n FROM activity_image_config_revisions').get()!.n,configs);
  assert.deepEqual(prepareStudioContext(f.database,f.activity.id,next),next);assert.equal(f.mock.graphs.length,0);
  assert.throws(()=>prepareStudioContext(f.database,f.activity.id,expected),{code:'studio_version_conflict'});
  const draft=f.activities.getDraft(f.activity.id)!;f.activities.updateDraft(f.activity.id,draft.draftVersion,{...draft.document,scenes:draft.document.scenes!.map(scene=>({...scene,title:'不能部分提交'}))});
  const beforeFailure=f.versions();
  // Late image-configuration failure rolls back the already attempted content commit too.
  f.database.connection.prepare('UPDATE activity_image_config_drafts SET base_revision_id=NULL WHERE activity_id=?').run(f.activity.id);
  f.database.connection.exec("CREATE TRIGGER reject_context_image BEFORE INSERT ON activity_image_config_revisions BEGIN SELECT RAISE(ABORT,'synthetic context rollback'); END");
  const versions=f.versions();assert.throws(()=>prepareStudioContext(f.database,f.activity.id,versions),/synthetic context rollback/);
  assert.equal(f.versions().headVersion,beforeFailure.headVersion);assert.equal(f.versions().contentRevisionId,beforeFailure.contentRevisionId);
  f.database.connection.exec('DROP TRIGGER reject_context_image');
  const response=await f.app.inject({method:'POST',url:`/api/v1/admin/activities/${f.activity.id}/studio-jobs/prepare-context`,headers,payload:{expected:f.versions()}});
  assert.equal(response.statusCode,200,response.body);assert.equal(f.mock.graphs.length,0);
});

test('failed retry creates reviewable new attempts only, preserves successful outputs, and is idempotent before versions',async t=>{
  const f=await fixture(t),id=await approved(f,f.request(f.targets.slice(0,2),'history_only','retry-parent'));
  f.mock.failPrompt=1;await processStudioBatch({...f,jobId:id});
  const store=new StudioStore(f.database),parent=store.get(f.activity.id,id)!,old=listStudioItems(f.database,f.activity.id,id).items;
  const failed=old.find(item=>item.state==='failed')!,successful=old.find(item=>item.state==='succeeded')!;
  const request={expectedJobRevision:parent.revision,itemIds:[failed.id],idempotencyKey:'retry-selected'};
  assert.throws(()=>retryStudioBatch(f.database,f.config,f.activity.id,id,{...request,itemIds:[successful.id]}),{code:'studio_retry_unsafe'});
  assert.throws(()=>retryStudioBatch(f.database,f.config,f.activity.id,id,{...request,itemIds:['foreign']}),{code:'studio_item_not_found'});
  const child=retryStudioBatch(f.database,f.config,f.activity.id,id,request),childItem=listStudioItems(f.database,f.activity.id,child.id).items[0];
  assert.equal(child.parentJobId,id);assert.equal(child.traceId,parent.traceId);assert.equal(childItem.retryOfItemId,failed.id);
  assert.equal(childItem.attemptNo,failed.attemptNo+1);assert.notEqual(childItem.seed,failed.seed);assert.notEqual(childItem.submissionKey,failed.submissionKey);
  assert.equal(childItem.state,'waiting');assert.equal(f.mock.graphs.length,2,'retry does not submit until reviewed');
  assert.equal(retryStudioBatch(f.database,f.config,f.activity.id,id,request).id,child.id);
  await prepareStudioBatch({...f,jobId:child.id});const review=store.get(f.activity.id,child.id)!;
  startStudioBatch(f.database,f.config,f.activity.id,child.id,{expectedJobRevision:review.revision,planHash:review.planHash!});
  await processStudioBatch({...f,jobId:child.id});assert.equal(f.mock.graphs.length,3);assert.equal(store.get(f.activity.id,child.id)!.status,'succeeded');
  assert.deepEqual(listStudioItems(f.database,f.activity.id,id).items,old,'old attempts and outputs are immutable');
  assert.equal(retryStudioBatch(f.database,f.config,f.activity.id,id,request).id,child.id);
  f.database.connection.prepare("UPDATE activity_studio_job_items SET state='unknown' WHERE id=?").run(failed.id);
  assert.throws(()=>retryStudioBatch(f.database,f.config,f.activity.id,id,{...request,idempotencyKey:'cannot-retry-unknown'}),{code:'studio_retry_unsafe'});
});

test('deleted and locked targets skip without images; existing material source changes pause rather than being mistaken for deletion',async t=>{
  const f=await fixture(t),id=await approved(f,f.request(f.targets.slice(0,3)));
  f.mock.onPrompt=()=>{f.mock.onPrompt=undefined;const draft=f.activities.getDraft(f.activity.id)!;
    f.activities.updateDraft(f.activity.id,draft.draftVersion,{...draft.document,scenes:draft.document.scenes!.map(scene=>({...scene,beats:scene.beats.filter(beat=>beat.id!=='b1')}))});};
  await processStudioBatch({...f,jobId:id});assert.equal(f.mock.graphs.length,2);assert.equal(new StudioStore(f.database).get(f.activity.id,id)!.status,'partially_succeeded');
  assert.equal(listStudioItems(f.database,f.activity.id,id).items[1].state,'skipped');
  f.mock.graphs.length=0;const locked=await approved(f,f.request(f.targets.slice(3,5),'history_only','locked'));
  f.mock.onOptimize=()=>{f.mock.onOptimize=undefined;const draft=f.activities.getDraft(f.activity.id)!;
    f.activities.updateDraft(f.activity.id,draft.draftVersion,{...draft.document,stages:draft.document.stages.map(stage=>({...stage,locked:true}))});};
  await processStudioBatch({...f,jobId:locked});assert.equal(f.mock.graphs.length,0);
  assert.ok(listStudioItems(f.database,f.activity.id,locked).items.every(item=>item.state==='skipped'));
  const draft=f.activities.getDraft(f.activity.id)!;f.activities.updateDraft(f.activity.id,draft.draftVersion,{...draft.document,stages:draft.document.stages.map(stage=>({...stage,locked:false}))});
  prepareStudioContext(f.database,f.activity.id,f.versions());
  const media=await approved(f,f.request([{kind:'media_slot',slotId:'m0'},{kind:'media_slot',slotId:'m1'}],'history_only','changed-material'));
  f.mock.onPrompt=()=>{f.mock.onPrompt=undefined;const draft=f.activities.getDraft(f.activity.id)!;
    f.activities.updateDraft(f.activity.id,draft.draftVersion,{...draft.document,mediaSlots:draft.document.mediaSlots.map(slot=>slot.id==='m1'?{...slot,shotDescription:'人工新场景'}:slot)});};
  await processStudioBatch({...f,jobId:media});assert.equal(f.mock.graphs.length,1);assert.equal(new StudioStore(f.database).get(f.activity.id,media)!.status,'paused');
  assert.equal(listStudioItems(f.database,f.activity.id,media).items[1].state,'waiting');
});

test('busy targets block review/start and text model configuration changes pause the frozen batch',async t=>{
  const f=await fixture(t),first=await approved(f,f.request([f.targets[0]],'history_only','busy-owner'));
  f.database.connection.prepare("UPDATE activity_studio_job_items SET state='unknown' WHERE job_id=?").run(first);
  const blocked=createStudioBatch(f.database,f.config,f.activity.id,f.request([f.targets[0]],'history_only','blocked-preview'));
  await prepareStudioBatch({...f,jobId:blocked.id});const store=new StudioStore(f.database),review=store.get(f.activity.id,blocked.id)!;
  assert.ok(review.result&&'plans' in review.result);assert.equal(review.result.plans[0].canSubmit,false);assert.ok(review.result.plans[0].issues.some(issue=>issue.includes('未完成')));
  assert.throws(()=>startStudioBatch(f.database,f.config,f.activity.id,blocked.id,{expectedJobRevision:review.revision,planHash:review.planHash!}),{code:'studio_workflow_incompatible'});
  const id=await approved(f,f.request([f.targets[1]],'history_only','changed-binding'));
  f.database.connection.prepare("UPDATE provider_profiles SET model='another-model' WHERE id='batch-text'").run();
  await processStudioBatch({...f,jobId:id});assert.equal(f.mock.graphs.length,0);assert.equal(store.get(f.activity.id,id)!.status,'paused');
});

test('optimizer failure sends no raw Chinese fallback and a missing upstream prompt ID is unknown, never retried',async t=>{
  const f=await fixture(t),id=await approved(f,f.request([f.targets[0]],'history_only','optimizer-failed'));
  f.mock.failOptimize=true;await processStudioBatch({...f,jobId:id});assert.equal(f.mock.graphs.length,0);
  assert.equal(new StudioStore(f.database).get(f.activity.id,id)!.status,'unknown','503 is not proof the optimizer request did not execute');
  const optimizerCall=f.database.connection.prepare("SELECT status,error_code FROM ai_call_records WHERE business_event='activity.image.prompt.optimize'").get()!;
  assert.equal(optimizerCall.status,'failed');assert.equal(optimizerCall.error_code,'http_503','preserve the received status instead of replacing it with a generic optimization error');
  assert.equal(listStudioItems(f.database,f.activity.id,id).items[0].generationTaskId,null);
  const unknown=await approved(f,f.request(f.targets.slice(1,3),'history_only','unknown-submission'));f.mock.unknownPrompt=1;
  await processStudioBatch({...f,jobId:unknown});const job=new StudioStore(f.database).get(f.activity.id,unknown)!;
  assert.equal(job.status,'unknown',JSON.stringify(job));assert.equal(f.mock.graphs.length,1);
  assert.equal(listStudioItems(f.database,f.activity.id,unknown).items[0].state,'unknown');
  assert.equal(listStudioItems(f.database,f.activity.id,unknown).items[1].state,'waiting');
  await processStudioBatch({...f,jobId:unknown});assert.equal(f.mock.graphs.length,1);
  assert.throws(()=>retryStudioBatch(f.database,f.config,f.activity.id,unknown,{expectedJobRevision:job.revision,itemIds:[listStudioItems(f.database,f.activity.id,unknown).items[0].id],idempotencyKey:'unknown-retry'}),{code:'studio_job_conflict'});
});
