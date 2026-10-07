import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildActivityDocument,type StudioRefineRequest } from '@sthstart/contracts';
import { ServiceDatabase,nowIso } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { createService } from './server.js';
import { ActivityStore } from './activities/store.js';
import { ComicStore } from './activities/comic-store.js';
import { materializeComicStoryboard } from './activities/comic-storyboard.js';
import { StudioStore } from './activities/studio-store.js';
import { getImageConfigDraft } from './activities/image-configs.js';
import { freezeStudioRefine,processStudioRefine,applyStudioRefine } from './activities/studio-refine.js';
import { createStudioRefineRender,processStudioSingleRender } from './activities/studio-single-render.js';
import { installVisualTestWorkflow } from './activities/test-support/visual-workflow.js';
import { setDefaultPreset } from './generation/configuration-store.js';

const token='isolated-studio-render-admin-token',headers={'x-sthstart-admin-token':token};
const patch={patch:{director:{lighting:'warm',shotSize:'wide'},expression:'眉眼放松'},explanation:'只调整光线、景别和表情。'};
function fixture(database:ServiceDatabase){
  const activities=new ActivityStore(database),now=nowIso(),content=buildActivityDocument({templateId:'blank',title:'单图关联测试',type:'测试',theme:'',location:'营地',rules:'',actors:[{id:'a',displayName:'研究员',persona:{appearance:{baseText:'银发'}},outfitDescription:'蓝衣',activityRole:''}]});
  const stageId=content.stages[0].id;content.scenes=[{id:'s',stageId,title:'原场次',timeText:'傍晚',locationText:'营地',beats:[{id:'b',characterId:'a',action:'观察结晶',dialogue:'稳定。',mediaUrl:'/kept.png'}]}];
  const activity=activities.createActivity({title:content.activity.title,type:'测试',initialDocument:content}).activity,image=getImageConfigDraft(database,activity.id);
  database.connection.prepare("INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('activities','活动','isolated-single-hash','[]',1,?,?)").run(now,now);
  const profiles=installVisualTestWorkflow(database);setDefaultPreset(database,profiles.draft.presetId);
  database.connection.prepare("INSERT INTO provider_profiles(id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at) VALUES ('single-text','测试模型','llm','http://test/v1','test',NULL,1,?,?)").run(now,now);
  database.connection.prepare("INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('activities','text','single-text',?)").run(now);
  const request:StudioRefineRequest={kind:'refine',idempotencyKey:'adjust',versions:{headVersion:activity.headVersion,contentDraftVersion:1,contentRevisionId:activity.currentContentRevisionId,imageConfigDraftVersion:image.draftVersion,imageConfigRevisionId:image.baseRevisionId},input:{target:{kind:'beat',stageId,sceneId:'s',beatId:'b'},instructions:'拉远一点，暖光，表情平静'}};
  return {activity,activities,request};
}
function upstream(){let calls=0;const graphs:Record<string,unknown>[]=[];
  const fetcher:typeof fetch=async(input,init)=>{
    const url=String(input);
    if(url.endsWith('/chat/completions')){const text=String(init?.body);return Response.json({choices:[{message:{content:text.includes('画面调整助手')?JSON.stringify(patch):'a calm silver haired scientist, wide shot, warm light'}}]});}
    if(url.endsWith('/object_info'))return Response.json({CLIPTextEncode:{input:{required:{text:['STRING',{}]}}},KSampler:{input:{required:{}}},CheckpointLoaderSimple:{input:{required:{ckpt_name:[['base.safetensors','turbo.safetensors'],{}]}}},SaveImage:{input:{required:{}}},EmptyLatentImage:{input:{required:{}}}});
    if(url.endsWith('/prompt')){calls++;graphs.push(JSON.parse(String(init?.body)).prompt);return Response.json({prompt_id:'single-prompt'});}
    if(url.includes('/history/'))return Response.json({'single-prompt':{status:{status_str:'success',completed:true},outputs:{'5':{images:[{filename:'one.png',subfolder:'',type:'output'},{filename:'two.png',subfolder:'',type:'output'}]}}}});
    if(url.includes('/view?'))return new Response(new Uint8Array([137,80,78,71,13,10,26,10]),{headers:{'content-type':'image/png'}});
    if(url.endsWith('/queue'))return Response.json({queue_running:[],queue_pending:[]});
    return new Response('not found',{status:404});
  };return {fetcher,graphs,get calls(){return calls;}};
}

test('refine HTTP applies and creates exactly one atomic history-only child; actual graph, seed, call and all readable outputs remain linked',async t=>{
  const database=new ServiceDatabase(),mock=upstream(),config=readConfig({STHSTART_ADMIN_TOKEN:token,STHSTART_ARTIFACT_DIR:mkdtempSync(join(tmpdir(),'sthstart-studio-single-'))});
  const {app}=await createService({config,database,secrets:new SecretStore({}),fetcher:mock.fetcher});
  t.after(async()=>{await app.close();database.close();});const {activity,activities,request}=fixture(database),url=`/api/v1/admin/activities/${activity.id}/studio-jobs`;
  const created=await app.inject({method:'POST',url,headers,payload:request});assert.equal(created.statusCode,202,created.body);
  const jobs=new StudioStore(database),id=created.json().id;
  for(let i=0;i<100&&jobs.get(activity.id,id)!.status!=='awaiting_review';i++)await new Promise(resolve=>setTimeout(resolve,5));
  const review=jobs.get(activity.id,id)!;assert.equal(review.status,'awaiting_review');
  const application={expectedJobRevision:review.revision,versions:request.versions,resultHash:review.result!.resultHash,renderAfterApply:true};
  const applied=await app.inject({method:'POST',url:`${url}/${id}/apply`,headers,payload:application});assert.equal(applied.statusCode,200,applied.body);
  const childId=applied.json().appliedResult.childJobId;assert.ok(childId);
  const duplicate=await app.inject({method:'POST',url:`${url}/${id}/apply`,headers,payload:application});assert.equal(duplicate.statusCode,200,duplicate.body);assert.equal(duplicate.json().appliedResult.childJobId,childId);
  for(let i=0;i<1000&&['queued','preparing','running'].includes(jobs.get(activity.id,childId)!.status);i++)await new Promise(resolve=>setTimeout(resolve,10));
  const child=jobs.get(activity.id,childId)!;assert.equal(child.status,'succeeded',JSON.stringify(child));assert.equal(child.traceId,review.traceId);assert.equal(mock.calls,1);
  const item=database.connection.prepare('SELECT * FROM activity_studio_job_items WHERE job_id=?').get(childId)!;
  assert.equal(item.state,'succeeded');assert.ok(item.generation_task_id);assert.ok(item.call_id);assert.ok(item.candidate_id);assert.equal(item.placement_state,'not_requested');
  const task=database.connection.prepare('SELECT workflow_snapshot_json,actual_seed FROM generation_tasks WHERE id=?').get(item.generation_task_id as string)!;
  assert.deepEqual(mock.graphs[0],JSON.parse(String(task.workflow_snapshot_json)));assert.equal(Number(task.actual_seed),Number(child.input.seed));
  const candidate=database.connection.prepare('SELECT auto_apply_state,task_id FROM activity_beat_render_candidates WHERE id=?').get(item.candidate_id as string)!;
  assert.equal(candidate.auto_apply_state,'ineligible');assert.equal(candidate.task_id,item.generation_task_id);
  assert.equal(activities.getDraft(activity.id)!.document.scenes![0].beats[0].mediaUrl,'/kept.png');
  assert.ok(child.result&&'renderedImages' in child.result);assert.equal(child.result.renderedImages.length,2);
  assert.equal(database.connection.prepare('SELECT COUNT(*) AS n FROM activity_studio_job_items WHERE job_id=?').get(childId)!.n,1);
});

test('late child insertion failure rolls back visual edits and native candidate, and stopping during optimization prevents any ComfyUI submission',async t=>{
  const database=new ServiceDatabase(),{activity,activities,request}=fixture(database),mock=upstream(),secrets=new SecretStore({}),config=readConfig({STHSTART_ADMIN_TOKEN:token});
  t.after(()=>database.close());const jobs=new StudioStore(database),parent=jobs.create({activityId:activity.id,kind:'refine',idempotencyKey:request.idempotencyKey,request,freeze:()=>({...freezeStudioRefine(database,activity.id,request)})}).job;
  await processStudioRefine({database,secrets,activityId:activity.id,jobId:parent.id,fetcher:mock.fetcher});
  const review=jobs.get(activity.id,parent.id)!,before=activities.getDraft(activity.id),application={expectedJobRevision:review.revision,versions:request.versions,resultHash:review.result!.resultHash,renderAfterApply:true};
  database.connection.exec("CREATE TRIGGER reject_studio_item BEFORE INSERT ON activity_studio_job_items BEGIN SELECT RAISE(ABORT,'synthetic child rollback'); END");
  assert.throws(()=>applyStudioRefine(database,activity.id,parent.id,application,(target,parent)=>createStudioRefineRender(database,config,target,parent)),/synthetic child rollback/);
  assert.deepEqual(activities.getDraft(activity.id),before);assert.equal(database.connection.prepare('SELECT COUNT(*) AS n FROM activity_beat_render_candidates').get()!.n,0);
  assert.equal(jobs.list(activity.id).items.length,1);database.connection.exec('DROP TRIGGER reject_studio_item');
  const applied=applyStudioRefine(database,activity.id,parent.id,application,(target,parent)=>createStudioRefineRender(database,config,target,parent));const childId=applied.appliedResult!.childJobId!;
  const stopping:typeof fetch=async(input,init)=>{if(String(input).endsWith('/chat/completions')){const child=jobs.get(activity.id,childId)!;jobs.stop(activity.id,childId,child.revision);}return mock.fetcher(input,init);};
  await processStudioSingleRender({database,config,secrets,activityId:activity.id,jobId:childId,fetcher:stopping});
  assert.equal(mock.calls,0);assert.equal(jobs.get(activity.id,childId)!.status,'cancelled');
  assert.equal(database.connection.prepare('SELECT generation_task_id,state FROM activity_studio_job_items WHERE job_id=?').get(childId)!.generation_task_id,null);
});

test('comic apply-and-draw uses the native history, preserves crop and selected image, and never writes source beat media',async t=>{
  const database=new ServiceDatabase(),mock=upstream(),secrets=new SecretStore({}),config=readConfig({STHSTART_ADMIN_TOKEN:token,STHSTART_ARTIFACT_DIR:mkdtempSync(join(tmpdir(),'sthstart-studio-comic-'))});
  const {app}=await createService({config,database,secrets,fetcher:mock.fetcher});t.after(async()=>{await app.close();database.close();});
  const {activity,activities,request}=fixture(database),comics=new ComicStore(database),comic=comics.createComicDraft(activity.id,activity.currentContentRevisionId!);
  const panels=materializeComicStoryboard({panels:Array.from({length:4},()=>({sourceBeatIds:['b'],actorIds:['a'],shotSize:'medium',visualDescription:'观察结晶',composition:'实验台在前景',textSafeArea:'top_left',bubbles:[]}))},activities.getDraft(activity.id)!.document,{stageId:(request.input.target as {stageId:string}).stageId,sceneId:'s',panelCount:4});
  const saved=comics.saveComicDraft(activity.id,comic.draftVersion,{...comic.document,...panels});request.input.target={kind:'comic_panel',panelId:panels.panels[0].id};request.versions.comicDraftVersion=saved.draftVersion;
  const beforeContent=activities.getDraft(activity.id),jobs=new StudioStore(database),parent=jobs.create({activityId:activity.id,kind:'refine',idempotencyKey:request.idempotencyKey,request,freeze:()=>({...freezeStudioRefine(database,activity.id,request)})}).job;
  await processStudioRefine({database,secrets,activityId:activity.id,jobId:parent.id,fetcher:mock.fetcher});const review=jobs.get(activity.id,parent.id)!;
  const applied=applyStudioRefine(database,activity.id,parent.id,{expectedJobRevision:review.revision,versions:request.versions,resultHash:review.result!.resultHash,renderAfterApply:true},(target,parent)=>createStudioRefineRender(database,config,target,parent));
  const childId=applied.appliedResult!.childJobId!;await processStudioSingleRender({database,config,secrets,activityId:activity.id,jobId:childId,fetcher:mock.fetcher});
  assert.equal(jobs.get(activity.id,childId)!.status,'succeeded');assert.equal(mock.calls,1);assert.deepEqual(activities.getDraft(activity.id),beforeContent);
  const selected=comics.getComicDraft(activity.id)!.document.panels[0];assert.equal(selected.selectedImage,null);assert.deepEqual(selected.crop,saved.document.panels[0].crop);
  const item=database.connection.prepare('SELECT * FROM activity_studio_job_items WHERE job_id=?').get(childId)!;assert.ok(item.native_job_id);assert.equal(item.candidate_id,null);
  assert.equal(database.connection.prepare('SELECT COUNT(*) AS n FROM activity_comic_job_outputs WHERE job_id=?').get(item.native_job_id as string)!.n,2);
});
