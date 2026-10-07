import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Value} from '@sinclair/typebox/value';
import {buildActivityDocument,StudioHealthResultSchema,type StudioHealthResult} from '@sthstart/contracts';
import {ServiceDatabase,nowIso} from './database.js';
import {SecretStore} from './security.js';
import {readConfig} from './config.js';
import {createService} from './server.js';
import {ActivityStore} from './activities/store.js';
import {getImageConfigDraft,saveImageConfigDraft,commitImageConfigRevision} from './activities/image-configs.js';
import {saveActivityImagePromptPolicy} from './activities/image-prompt-policies.js';
import {inspectStudioHealth} from './activities/studio-health.js';
import {resolveStudioBatchTarget} from './activities/studio-batches.js';
import {installVisualTestWorkflow} from './activities/test-support/visual-workflow.js';
import {setDefaultPreset} from './generation/configuration-store.js';

const token='isolated-studio-health-test-admin-token',headers={'x-sthstart-admin-token':token};
async function fixture(t:test.TestContext){
  const database=new ServiceDatabase(),secrets=new SecretStore({}),config=readConfig({STHSTART_ADMIN_TOKEN:token,STHSTART_ARTIFACT_DIR:mkdtempSync(join(tmpdir(),'sthstart-health-'))});
  const requests:string[]=[];let offline=false,missingNode='',missingModel='',badQueue=false;
  const definitions:Record<string,unknown>={CLIPTextEncode:{input:{required:{}}},KSampler:{input:{required:{}}},SaveImage:{input:{required:{}}},EmptyLatentImage:{input:{required:{}}},
    CheckpointLoaderSimple:{input:{required:{ckpt_name:[['base.safetensors','turbo.safetensors'],{}]}}},
    CLIPLoader:{input:{required:{clip_name:[['text.safetensors'],{}]}}},VAELoader:{input:{required:{vae_name:[['vae.safetensors'],{}]}}},
    LoraLoaderModelOnly:{input:{required:{lora_name:[['style.safetensors'],{}]}}}};
  const fetcher:typeof fetch=async(input,init)=>{const url=String(input);requests.push(url);assert.ok(!init?.method||init.method==='GET','diagnostics cannot send a model or image request');
    if(url.endsWith('/object_info')){if(offline)return new Response('',{status:503});const copy=structuredClone(definitions);delete copy[missingNode];
      if(missingModel)for(const node of Object.values(copy) as any[])for(const field of Object.values(node.input.required) as any[])if(Array.isArray(field[0]))field[0]=field[0].filter((name:string)=>name!==missingModel);
      return Response.json(copy);}
    if(url.endsWith('/queue'))return Response.json(badQueue?{error:'unavailable'}:{queue_running:[[1,'other']],queue_pending:[[2,'other'],[3,'other']]});
    return new Response('',{status:404});};
  const {app}=await createService({database,config,secrets,fetcher});t.after(async()=>{await app.close();database.close();});
  const now=nowIso(),profiles=installVisualTestWorkflow(database);setDefaultPreset(database,profiles.draft.presetId);
  database.connection.prepare("INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('activities','测试','health-hash','[]',1,?,?)").run(now,now);
  database.connection.prepare("INSERT INTO provider_profiles(id,name,kind,base_url,model,enabled,created_at,updated_at) VALUES ('health-text','测试','llm','http://text.test','test-text',1,?,?)").run(now,now);
  database.connection.prepare("INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('activities','text','health-text',?)").run(now);
  const activities=new ActivityStore(database),doc=buildActivityDocument({templateId:'blank',title:'健康检查测试',type:'测试',theme:'',location:'营地',rules:'',actors:[]});
  const stageId=doc.stages[0].id;doc.scenes=[{id:'scene',stageId,title:'实验',timeText:'',locationText:'营地',beats:[{id:'beat',characterId:'',action:'实验',dialogue:''}]}];
  const activity=activities.createActivity({title:doc.activity.title,type:'测试',initialDocument:doc}).activity;
  const image=getImageConfigDraft(database,activity.id),saved=saveImageConfigDraft(database,activity.id,image.draftVersion,{...image.document,artDirection:{selectedStyle:null,quality:'draft',canvas:{width:768,height:768},renderProfiles:profiles,parameterOverrides:{}}});
  commitImageConfigRevision(database,activities,activity.id,saved.draftVersion,activity.headVersion);
  const target={kind:'beat' as const,stageId,sceneId:'scene',beatId:'beat'},options={database,config,secrets,fetcher,activityId:activity.id,request:{target}};
  return {...options,app,activities,requests,target,url:`/api/v1/admin/activities/${activity.id}/studio-jobs/health`,
    get offline(){return offline;},set offline(value:boolean){offline=value;},get missingNode(){return missingNode;},set missingNode(value:string){missingNode=value;},
    get missingModel(){return missingModel;},set missingModel(value:string){missingModel=value;},get badQueue(){return badQueue;},set badQueue(value:boolean){badQueue=value;}};
}
const layer=(result:StudioHealthResult,kind:string)=>result.layers.find(item=>item.kind===kind)!;
test('health is five-layered, read-only, scoped admin API with normal queued work not a failure',async t=>{
  const f=await fixture(t),before=f.activities.getDraft(f.activityId),health=await inspectStudioHealth(f);
  assert.ok(Value.Check(StudioHealthResultSchema,health));assert.equal(health.canSubmit,true);assert.deepEqual(health.layers.map(item=>item.kind),['text','connection','workflow','files','queue']);
  assert.equal(layer(health,'text').status,'ok');assert.equal(layer(health,'queue').status,'ok');assert.deepEqual(health.queue,{running:1,pending:2,localUncertain:0});
  assert.deepEqual(f.activities.getDraft(f.activityId),before);
  for(const table of ['generation_tasks','ai_call_records','activity_studio_jobs','activity_prompt_optimization_runs'])assert.equal(f.database.connection.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n,0);
  assert.equal((await f.app.inject({method:'POST',url:f.url,payload:f.request})).statusCode,401);
  assert.equal((await f.app.inject({method:'POST',url:f.url,headers,payload:{...f.request,baseUrl:'http://private'}})).statusCode,400);
  assert.equal((await f.app.inject({method:'POST',url:f.url.replace(f.activityId,'other'),headers,payload:f.request})).statusCode,404);
  const response=await f.app.inject({method:'POST',url:f.url,headers,payload:f.request});assert.equal(response.statusCode,200,response.body);assert.equal(response.headers['cache-control'],'no-store');assert.ok(Value.Check(StudioHealthResultSchema,response.json()));
});
test('disabled optimization does not require text binding or freeze its changes; enabled strategy does',async t=>{
  const f=await fixture(t),before=resolveStudioBatchTarget(f.database,f.config,f.activityId,f.target,42,'health-hash');
  f.database.connection.prepare("UPDATE provider_profiles SET model='changed-text' WHERE id='health-text'").run();
  assert.notEqual(resolveStudioBatchTarget(f.database,f.config,f.activityId,f.target,42,'health-hash').configurationHash,before.configurationHash);
  saveActivityImagePromptPolicy(f.database,{workflowId:'visual-flow',workflowVersion:1,revision:0,enabled:false,instructions:'',positiveSuffix:'',negativePrompt:''});
  const disabled=resolveStudioBatchTarget(f.database,f.config,f.activityId,f.target,42,'health-hash');
  f.database.connection.prepare("DELETE FROM app_llm_assignments WHERE app_id='activities'").run();
  const after=resolveStudioBatchTarget(f.database,f.config,f.activityId,f.target,42,'health-hash');assert.equal(disabled.configurationHash,after.configurationHash);assert.equal(disabled.planHash,after.planHash);assert.equal(after.preview.optimizerProfileId,null);
  const health=await inspectStudioHealth(f);assert.equal(health.canSubmit,true);assert.equal(layer(health,'text').status,'not_required');
  saveActivityImagePromptPolicy(f.database,{workflowId:'visual-flow',workflowVersion:1,revision:1,enabled:true,instructions:'优化',positiveSuffix:'',negativePrompt:''});
  const missing=await inspectStudioHealth(f);assert.equal(missing.canSubmit,false);assert.equal(layer(missing,'text').status,'error');assert.equal(layer(missing,'connection').status,'ok');
});
test('unreachable instances, missing node and invalid queue remain separate diagnostics, never submit',async t=>{
  const f=await fixture(t);f.offline=true;let health=await inspectStudioHealth(f);
  assert.equal(layer(health,'connection').status,'error');assert.equal(layer(health,'files').status,'unknown');assert.equal(layer(health,'queue').status,'unknown');assert.equal(health.canSubmit,false);
  f.offline=false;f.missingNode='SaveImage';health=await inspectStudioHealth(f);assert.equal(layer(health,'connection').status,'ok');assert.equal(layer(health,'workflow').status,'error');assert.match(layer(health,'workflow').issues.join(' '),/SaveImage/);assert.equal(layer(health,'files').status,'ok');
  f.missingNode='';f.badQueue=true;health=await inspectStudioHealth(f);assert.equal(layer(health,'queue').status,'unknown');assert.equal(health.canSubmit,false);
  assert.ok(f.requests.every(url=>url.endsWith('/object_info')||url.endsWith('/queue')));
});
test('checkpoint, encoder, VAE and LoRA files report exact missing filenames, no missing nodes conflation',async t=>{
  const f=await fixture(t),row=f.database.connection.prepare("SELECT definition_json FROM generation_workflow_versions WHERE workflow_id='visual-flow'").get()!,graph=JSON.parse(String(row.definition_json));
  Object.assign(graph,{'7':{class_type:'CLIPLoader',inputs:{clip_name:'text.safetensors'}},'8':{class_type:'VAELoader',inputs:{vae_name:'vae.safetensors'}},'9':{class_type:'LoraLoaderModelOnly',inputs:{model:['4',0],lora_name:'style.safetensors',strength_model:0.7}}});
  f.database.connection.prepare("UPDATE generation_workflow_versions SET definition_json=? WHERE workflow_id='visual-flow'").run(JSON.stringify(graph));
  for(const name of ['turbo.safetensors','text.safetensors','vae.safetensors','style.safetensors']){
    f.missingModel=name;const health=await inspectStudioHealth(f);assert.equal(health.canSubmit,false);assert.equal(layer(health,'connection').status,'ok');assert.equal(layer(health,'workflow').status,'ok');assert.equal(layer(health,'files').status,'error');assert.ok(layer(health,'files').issues.some(issue=>issue.includes(name)));
  }
  f.missingModel='';assert.equal((await inspectStudioHealth(f)).canSubmit,true);
  f.database.connection.prepare("UPDATE generation_workflow_versions SET output_declarations_json='[\"missing-output\"]' WHERE workflow_id='visual-flow'").run();
  const missingOutput=await inspectStudioHealth(f);assert.equal(missingOutput.canSubmit,false);assert.match(layer(missingOutput,'workflow').issues.join(' '),/输出节点/);
});

test('explicitly configured but missing credentials do not silently probe or present a text binding as available',async t=>{
  const f=await fixture(t),missing=`isolated-missing-${randomUUID()}`;
  f.database.connection.prepare("UPDATE provider_profiles SET credential_account=? WHERE id='health-text'").run(missing);
  let health=await inspectStudioHealth(f);assert.equal(health.canSubmit,false);assert.equal(layer(health,'text').status,'error');assert.equal(layer(health,'connection').status,'ok');
  f.requests.length=0;f.database.connection.prepare("UPDATE generation_engines SET credential_account=? WHERE id='visual-engine'").run(missing);
  health=await inspectStudioHealth(f);assert.equal(layer(health,'connection').status,'error');assert.match(layer(health,'connection').issues.join(' '),/凭据不可用/);assert.equal(layer(health,'queue').status,'unknown');assert.deepEqual(f.requests,[]);
  assert.ok(!JSON.stringify(health).includes(missing),'credential account names are not diagnostic output');
});
