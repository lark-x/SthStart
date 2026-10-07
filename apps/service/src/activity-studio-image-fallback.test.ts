import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildActivityDocument,type StudioBatchRequest,type StudioTarget} from '@sthstart/contracts';
import {ServiceDatabase,nowIso} from './database.js';
import {readConfig} from './config.js';
import {SecretStore} from './security.js';
import {createService} from './server.js';
import {ActivityStore} from './activities/store.js';
import {StudioStore} from './activities/studio-store.js';
import {getImageConfigDraft,saveImageConfigDraft} from './activities/image-configs.js';
import {prepareStudioContext,readStudioContext} from './activities/studio-context.js';
import {installVisualTestWorkflow} from './activities/test-support/visual-workflow.js';
import {setDefaultPreset,getPreset,createPreset} from './generation/configuration-store.js';
import {createStudioBatch,prepareStudioBatch,startStudioBatch,processStudioBatch,listStudioItems} from './activities/studio-batches.js';
import {retryStudioBatch} from './activities/studio-batches.js';
import {listStudioImageFallbackOptions,previewStudioImageFallback,createStudioImageFallback} from './activities/studio-image-fallback.js';

const token='isolated-image-fallback-admin-token';
function upstream(){
  const graphs:Record<string,unknown>[]=[],requests:string[]=[];let failPrompt=0;
  const fetcher:typeof fetch=async(input,init)=>{
    const url=String(input);requests.push(url);
    if(url.endsWith('/chat/completions'))return Response.json({choices:[{message:{content:'a silver haired scientist observing a crystal'}}]});
    if(url.endsWith('/object_info'))return Response.json({CLIPTextEncode:{input:{required:{text:['STRING',{}]}}},KSampler:{input:{required:{}}},CheckpointLoaderSimple:{input:{required:{ckpt_name:[['base.safetensors','turbo.safetensors'],{}]}}},SaveImage:{input:{required:{}}},EmptyLatentImage:{input:{required:{}}}});
    if(url.endsWith('/prompt')){graphs.push(JSON.parse(String(init?.body)).prompt);
      return graphs.length===failPrompt?Response.json({error:'synthetic failure'},{status:400}):Response.json({prompt_id:`image-fallback-${graphs.length}`});}
    if(url.includes('/history/')){const id=url.split('/history/')[1];return Response.json({[id]:{status:{status_str:'success',completed:true},outputs:{'5':{images:[{filename:`${id}.png`,type:'output'}]}}}});}
    if(url.includes('/view?'))return new Response(new Uint8Array([137,80,78,71,13,10,26,10]),{headers:{'content-type':'image/png'}});
    if(url.endsWith('/queue'))return Response.json({queue_running:[],queue_pending:[]});
    throw new Error(`Unexpected synthetic request: ${url}`);
  };
  return {graphs,requests,fetcher,set failPrompt(value:number){failPrompt=value;}};
}
async function fixture(t:test.TestContext){
  const database=new ServiceDatabase(),mock=upstream(),secrets=new SecretStore({}),config=readConfig({STHSTART_ADMIN_TOKEN:token,STHSTART_ARTIFACT_DIR:mkdtempSync(join(tmpdir(),'sthstart-image-fallback-'))});
  const {app}=await createService({database,config,secrets,fetcher:mock.fetcher});t.after(async()=>{await app.close();database.close();});
  const activities=new ActivityStore(database),now=nowIso(),profiles=installVisualTestWorkflow(database);setDefaultPreset(database,profiles.draft.presetId);
  database.connection.prepare("INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('activities','测试','hash','[]',1,?,?)").run(now,now);
  database.connection.prepare("INSERT INTO provider_profiles(id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at) VALUES ('fallback-text','测试','llm','http://text.test/v1','synthetic',NULL,1,?,?)").run(now,now);
  database.connection.prepare("INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('activities','text','fallback-text',?)").run(now);
  const content=buildActivityDocument({templateId:'blank',title:'隔离图片备用测试',type:'测试',theme:'',location:'营地',rules:'',actors:[{id:'a',displayName:'研究员',persona:{appearance:{baseText:'银发'}},outfitDescription:'蓝衣',activityRole:''}]});
  const stageId=content.stages[0].id;
  content.scenes=[{id:'s',stageId,title:'结晶',timeText:'傍晚',locationText:'营地',beats:[0,1].map(index=>({id:`b${index}`,characterId:'a',action:`观察结晶 ${index}`,dialogue:'稳定。'}))}];
  const activity=activities.createActivity({title:content.activity.title,type:'测试',initialDocument:content}).activity;
  const image=getImageConfigDraft(database,activity.id);
  saveImageConfigDraft(database,activity.id,image.draftVersion,{...image.document,artDirection:{selectedStyle:null,quality:'draft',canvas:{width:768,height:768},renderProfiles:profiles,parameterOverrides:{}}});
  prepareStudioContext(database,activity.id,readStudioContext(database,activity.id));
  const targets:StudioTarget[]=content.scenes[0].beats.map(beat=>({kind:'beat',stageId,sceneId:'s',beatId:beat.id}));
  const request=(key='image-fallback-parent'):StudioBatchRequest=>({kind:'render_batch',versions:readStudioContext(database,activity.id),input:{targets,candidateCount:1,placement:'history_only'},idempotencyKey:key});
  return {database,config,secrets,app,activities,activityId:activity.id,activity,fetcher:mock.fetcher,mock,profiles,stageId,targets,request};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function failedBatch(f:Fixture,key:string){
  const job=createStudioBatch(f.database,f.config,f.activity.id,f.request(key));await prepareStudioBatch({...f,jobId:job.id});
  const store=new StudioStore(f.database),review=store.get(f.activity.id,job.id)!;
  startStudioBatch(f.database,f.config,f.activity.id,job.id,{expectedJobRevision:review.revision,planHash:review.planHash!});
  f.mock.failPrompt=1;await processStudioBatch({...f,jobId:job.id});f.mock.failPrompt=0;
  assert.equal(store.get(f.activity.id,job.id)!.status,'partially_succeeded',JSON.stringify(store.get(f.activity.id,job.id)));
  return job.id;
}

test('image fallback only re-draws known failures, actually applies the chosen preset, and never mutates the original batch or defaults',async t=>{
  const f=await fixture(t),id=await failedBatch(f,'fallback-parent');
  const before=f.activities.getDraft(f.activity.id),defaults=getPreset(f.database,f.profiles.draft.presetId)!;
  const options=listStudioImageFallbackOptions(f.database,f.activity.id,id);
  assert.equal(options.allowed,true,options.reason);assert.ok(options.presets.some(preset=>preset.id===f.profiles.final.presetId));
  const preview=previewStudioImageFallback(f.database,f.config,f.activity.id,id,{presetId:f.profiles.final.presetId});
  assert.equal(preview.expectedJobRevision,new StudioStore(f.database).get(f.activity.id,id)!.revision);assert.equal(preview.itemIds.length,1);
  assert.equal(preview.imageTaskCount,1);assert.equal(preview.presetId,f.profiles.final.presetId);assert.notEqual(preview.presetId,preview.originalPresetId);
  const failedItem=listStudioItems(f.database,f.activity.id,id).items.find(item=>item.state==='failed')!;
  const child=createStudioImageFallback(f.database,f.config,f.activity.id,id,{presetId:f.profiles.final.presetId,expectedJobRevision:preview.expectedJobRevision,planHash:preview.planHash,idempotencyKey:'fallback-confirm'});
  const childItems=listStudioItems(f.database,f.activity.id,child.id).items;
  assert.deepEqual(preview.itemIds,[failedItem.id]);assert.equal(childItems.length,1);
  assert.equal(childItems[0].retryOfItemId,failedItem.id);assert.ok(childItems[0].attemptNo>failedItem.attemptNo);
  const item=childItems[0];
  await processStudioBatch({...f,jobId:child.id});const done=new StudioStore(f.database).get(f.activity.id,child.id)!;
  assert.equal(done.status,'succeeded',JSON.stringify(done));assert.equal(f.mock.graphs.length,3);
  const task=f.database.connection.prepare('SELECT workflow_snapshot_json,request_params_json FROM generation_tasks WHERE id=?').get(listStudioItems(f.database,f.activity.id,child.id).items[0].generationTaskId!)!;
  const selection=JSON.parse(String(task.request_params_json)).selection;
  assert.equal(selection.presetId,f.profiles.final.presetId);assert.equal(Number(selection.presetRevision),1);
  assert.notEqual(selection.presetId,f.profiles.draft.presetId);
  assert.deepEqual(JSON.parse(String(task.workflow_snapshot_json)),f.mock.graphs[2]);
  assert.deepEqual(f.activities.getDraft(f.activity.id),before);
  assert.equal(getPreset(f.database,f.profiles.draft.presetId)!.id,defaults.id);assert.equal(defaults.id,f.profiles.draft.presetId);
  const originalItems=listStudioItems(f.database,f.activity.id,id).items;
  assert.ok(originalItems.every(item=>item.state!=='waiting'&&item.state!=='preparing'));assert.equal(originalItems.filter(item=>item.state==='succeeded').length,1);
});

test('unknown items, a used chain, changed presets and second failures block image fallback before any request',async t=>{
  const f=await fixture(t),id=await failedBatch(f,'limits-parent');
  const store=new StudioStore(f.database),failed=listStudioItems(f.database,f.activity.id,id).items.find(item=>item.state==='failed')!;
  f.database.connection.prepare("UPDATE activity_studio_job_items SET state='unknown' WHERE id=?").run(failed.id);
  assert.equal(listStudioImageFallbackOptions(f.database,f.activity.id,id).allowed,false);
  assert.throws(()=>previewStudioImageFallback(f.database,f.config,f.activity.id,id,{presetId:f.profiles.final.presetId}),{code:'studio_fallback_unknown'});
  f.database.connection.prepare("UPDATE activity_studio_job_items SET state='failed' WHERE id=?").run(failed.id);
  const preview=previewStudioImageFallback(f.database,f.config,f.activity.id,id,{presetId:f.profiles.final.presetId});
  assert.throws(()=>createStudioImageFallback(f.database,f.config,f.activity.id,id,{presetId:f.profiles.final.presetId,expectedJobRevision:preview.expectedJobRevision,planHash:'wrong',idempotencyKey:'bad-hash'}),{code:'studio_plan_changed'});
  assert.throws(()=>previewStudioImageFallback(f.database,f.config,f.activity.id,id,{presetId:'missing-preset'}),{code:'preset_not_found'});
  const child=createStudioImageFallback(f.database,f.config,f.activity.id,id,{presetId:f.profiles.final.presetId,expectedJobRevision:preview.expectedJobRevision,planHash:preview.planHash,idempotencyKey:'fallback-once'});
  assert.equal(createStudioImageFallback(f.database,f.config,f.activity.id,id,{presetId:f.profiles.final.presetId,expectedJobRevision:preview.expectedJobRevision,planHash:preview.planHash,idempotencyKey:'fallback-once'}).id,child.id);
  // A second fallback over the same source root is refused even through the child.
  f.mock.failPrompt=f.mock.graphs.length+1;await processStudioBatch({...f,jobId:child.id});
  assert.equal(store.get(f.activity.id,child.id)!.status,'paused',JSON.stringify(store.get(f.activity.id,child.id)));
  const retryOptions=listStudioImageFallbackOptions(f.database,f.activity.id,child.id);
  assert.equal(retryOptions.allowed,false);assert.match(retryOptions.reason,/一次/);
  assert.throws(()=>previewStudioImageFallback(f.database,f.config,f.activity.id,child.id,{presetId:f.profiles.final.presetId}),{code:'studio_fallback_limit'});
  const failedChild=listStudioItems(f.database,f.activity.id,child.id).items.find(item=>item.state==='failed')!;
  assert.throws(()=>retryStudioBatch(f.database,f.config,f.activity.id,child.id,{expectedJobRevision:store.get(f.activity.id,child.id)!.revision,itemIds:[failedChild.id],idempotencyKey:'bypass-image-fallback'}),{code:'studio_fallback_limit'});
  const graphsBefore=f.mock.graphs.length;f.mock.failPrompt=0;
  await processStudioBatch({...f,jobId:child.id});assert.equal(f.mock.graphs.length,graphsBefore,'a paused fallback never auto-replays');
});

test('admin HTTP image fallback requires auth, accepts only reviewed plans, and repeated confirmation returns the same job',async t=>{
  const f=await fixture(t),id=await failedBatch(f,'http-fallback-parent'),base=`/api/v1/admin/activities/${f.activity.id}/studio-jobs`;
  const headers={'x-sthstart-admin-token':token};
  assert.equal((await f.app.inject({method:'GET',url:`${base}/${id}/image-fallback-options`})).statusCode,401);
  const options=await f.app.inject({method:'GET',url:`${base}/${id}/image-fallback-options`,headers});assert.equal(options.statusCode,200,options.body);
  assert.equal(options.json().allowed,true);assert.equal(options.headers['cache-control'],'no-store');
  assert.equal((await f.app.inject({method:'POST',url:`${base}/${id}/image-fallback-preview`,headers,payload:{presetId:f.profiles.final.presetId,extra:true}})).statusCode,400);
  const preview=await f.app.inject({method:'POST',url:`${base}/${id}/image-fallback-preview`,headers,payload:{presetId:f.profiles.final.presetId}});
  assert.equal(preview.statusCode,200,preview.body);const plan=preview.json();
  const payload={presetId:plan.presetId,presetRevision:plan.presetRevision,expectedJobRevision:plan.expectedJobRevision,planHash:plan.planHash,idempotencyKey:'http-confirm'};
  const first=await f.app.inject({method:'POST',url:`${base}/${id}/image-fallback`,headers,payload});assert.equal(first.statusCode,202,first.body);
  const second=await f.app.inject({method:'POST',url:`${base}/${id}/image-fallback`,headers,payload});assert.equal(second.statusCode,202);assert.equal(second.json().id,first.json().id);
  for(let i=0;i<1000&&['queued','preparing','running'].includes(new StudioStore(f.database).get(f.activity.id,first.json().id)!.status);i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(new StudioStore(f.database).get(f.activity.id,first.json().id)!.status,'succeeded');
});

test('image fallback rejects a preset from a different workflow and never silently falls back to the activity default',async t=>{
  const f=await fixture(t),id=await failedBatch(f,'incompatible-parent');
  // A preset bound to another purpose cannot be resolved for this target.
  const foreign=createPreset(f.database,{appId:'activities',purpose:'activity_media_slot',name:'外部用途',workflowId:'visual-flow',workflowVersion:1,engineId:'visual-engine',values:{latent_w:768,latent_h:768,steps:12,model:'turbo.safetensors'}});
  assert.throws(()=>previewStudioImageFallback(f.database,f.config,f.activity.id,id,{presetId:foreign.id}),/工作流|workflow|preset|用途/i);
  const graphsBefore=f.mock.graphs.length;assert.equal(graphsBefore,2);
});
