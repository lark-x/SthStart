import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import Fastify from 'fastify';
import {createCanvas} from '@napi-rs/canvas';
import {DeepSeekHarness} from '@deepseek-ai/dsh-sdk-client';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {publicationFixture,addPublicationTestWorkflow} from './fixtures.js';
import {registerPublicationRoutes} from './routes.js';
import {readConfig} from '../config.js';
import {SecretStore} from '../security.js';
import {streamUploadArtifact} from '../artifacts.js';
import {shotFingerprint} from './store.js';

test('real DSH plugin and SDK client discover, validate, submit, recover and read images through scoped service',{timeout:90000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mcp-dsh-')),f=publicationFixture(dir),app=Fastify({logger:false});addPublicationTestWorkflow(f.db);
  const config={...readConfig({}),artifactDirectory:dir},secrets=new SecretStore({}),{worker}=registerPublicationRoutes(app,config,f.db,secrets);worker.wake=()=>{};
  const grant=f.store.grant(f.project.id),approval=f.store.approve(f.draft.activityId,{expectedDraftVersion:2,speechProfileId:null,makeVideo:false,imageBudget:6,speechCharacterBudget:0},{}),run=f.store.createRun(f.draft.activityId,approval.id,'dsh-test-run');
  const task=f.store.createTask(run.id,'image','shot-0',{sourceFingerprint:shotFingerprint(f.document,'shot-0')},'dsh-test-image');
  const image=await streamUploadArtifact(config,f.db,{appId:'activities',stream:Readable.from([createCanvas(32,32).toBuffer('image/png')]),contentType:'image/png',originalName:'test.png',refType:'publication_history',refId:`publication:${f.draft.activityId}:${task.id}`});f.store.taskHistory(task.id,[image.id]);f.store.updateRun(run.id,'succeeded');
  const actions:Array<[string,Record<string,unknown>]>=[
    ['list_publications',{}],['get_source_bundle',{activityId:f.draft.activityId}],['get_publication_options',{activityId:f.draft.activityId}],
    ['validate_publication_plan',{activityId:f.draft.activityId,document:f.document}],
    ['propose_publication_plan',{activityId:f.draft.activityId,expectedDraftVersion:2,document:{...f.document,title:'DSH实际工具提交'}}],
    ['list_runs',{activityId:f.draft.activityId}],['get_run_status',{activityId:f.draft.activityId,runId:run.id}],
    ['read_publication_artifact',{activityId:f.draft.activityId,artifactId:image.id,mode:'preview'}],
  ];
  const received:string[]=[],modelBodies:any[]=[];let step=0;
  const http=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const raw=Buffer.concat(chunks).toString();
    if(req.url==='/v1/chat/completions'){
      modelBodies.push(JSON.parse(raw));res.writeHead(200,{'content-type':'text/event-stream'});
      const action=actions[step++],name=action?`mcp__publication__${action[0]}`:'';
      const delta=action?{role:'assistant',tool_calls:[{index:0,id:`call-${step}`,type:'function',function:{name,arguments:JSON.stringify(action[1])}}]}:{role:'assistant',content:'集成调用完成'};
      for(const [d,finish] of [[delta,null],[{},action?'tool_calls':'stop']] as const)res.write(`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'poc-model',choices:[{index:0,delta:d,finish_reason:finish}]})}\n\n`);
      return res.end('data: [DONE]\n\n');
    }
    if(req.url?.startsWith('/api/publication-bridge/')){
      received.push(req.url);const result=await app.inject({method:(req.method??'GET') as 'GET'|'POST',url:req.url.replace('/api/publication-bridge/','/api/v1/publication-bridge/'),headers:{authorization:req.headers.authorization??'',...(raw?{'content-type':'application/json'}:{})},...(raw?{payload:raw}:{})});
      res.writeHead(result.statusCode,{'content-type':'application/json'});return res.end(result.body);
    }
    res.writeHead(404).end();
  });
  let harness:DeepSeekHarness|undefined;let sdk:Client|undefined;
  try{
    await app.ready();http.listen(0,'127.0.0.1');await once(http,'listening');const address=http.address();assert.ok(address&&typeof address!=='string');const portal=`http://127.0.0.1:${address.port}`;
    const source=await readFile(resolve('apps/service/src/story/profile.cordis.patch.yml'),'utf8');
    // Use the installed DSH MCP plugin in sdk-minimal, backed by a deterministic local model fixture.
    const patch=source.replace('__STHSTART_STORY_RESUME_SERVER_PATH__',resolve('apps/service/src/story/dsh-resume-server.mjs').replaceAll('\\','/'))
      .replaceAll('STHSTART_STORY_MCP_TOKEN','STHSTART_STORY_BRIDGE_TOKEN').replaceAll('STHSTART_STORY_INTERNAL_URL','STHSTART_STORY_PORTAL_URL')
      .replace('serverName: story','serverName: publication').replaceAll('STHSTART_STORY_BRIDGE_TOKEN','STHSTART_PUBLICATION_BRIDGE_TOKEN')
      .replace('api: openai-completions','api: openai-completions\n            defaultInput: [text, image]')
      +'\n- insert:\n    - id: test-local-attachments\n      name: "@deepseek-ai/dsh-attachment-local"\n';
    const patchPath=join(dir,'publication.patch.yml');await writeFile(patchPath,patch);
    harness=new DeepSeekHarness({profile:'sdk-minimal',patches:[patchPath],dshHome:join(dir,'home'),processCwd:dir,cwd:dir,provider:'sthstart',model:'poc-model',initializeTimeoutMs:45000,
      env:{NODE_ENV:process.env.NODE_ENV,PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,HOME:process.env.HOME,DSH_TELEMETRY_MODE:'OFF',STHSTART_STORY_APP_TOKEN:'test-model-fixture-token',
        STHSTART_STORY_LLM_BASE_URL:`${portal}/v1`,STHSTART_STORY_MODEL_ID:'poc-model',STHSTART_STORY_PROJECT_ID:f.project.id,STHSTART_PUBLICATION_BRIDGE_TOKEN:grant.token,STHSTART_STORY_PORTAL_URL:portal,
        STHSTART_STORY_MCP_SOURCE_PATH:resolve('apps/service/src/publication/mcp-server.ts'),STHSTART_STORY_TSX_IMPORT_PATH:import.meta.resolve('tsx/esm'),STHSTART_STORY_SKILLS_DIR:resolve('apps/service/src/story/skills'),STHSTART_STORY_RUNTIME_SESSION_ID:'dsh-mcp-test'}});
    const result=await harness.run('恢复作品、读取来源、核对制作方案并查看图片。');assert.match(result.finalResponse,/集成调用完成/);
    assert.equal(f.store.requireDraft(f.draft.activityId).document.title,'DSH实际工具提交',JSON.stringify({received,tools:modelBodies[0]?.tools?.map((t:any)=>t.function.name),results:modelBodies.at(-1)?.messages?.filter((m:any)=>m.role==='tool').map((m:any)=>String(m.content).slice(0,500))}));
    assert.equal(received.length,actions.length);assert.ok(received.some(p=>p.includes('/artifacts/')));
    assert.ok(modelBodies.every(b=>b.tools?.some((t:any)=>t.function?.name==='mcp__publication__patch_publication_plan')));
    assert.ok(modelBodies.some(b=>JSON.stringify(b.messages).includes('image_url')),'DSH admits the MCP image to model context');
    await harness.close();harness=undefined;
    sdk=new Client({name:'independent-sdk-client',version:'1.0.0'});
    await sdk.connect(new StdioClientTransport({command:process.execPath,args:['--import',import.meta.resolve('tsx/esm'),resolve('apps/service/src/publication/mcp-server.ts')],env:{PATH:process.env.PATH??'',STHSTART_STORY_PROJECT_ID:f.project.id,STHSTART_PUBLICATION_BRIDGE_TOKEN:grant.token,STHSTART_STORY_PORTAL_URL:portal},stderr:'pipe'}));
    const found=await sdk.callTool({name:'list_publications',arguments:{}});assert.match(JSON.stringify(found),/DSH实际工具提交/);
    const read=await sdk.callTool({name:'read_publication_artifact',arguments:{activityId:f.draft.activityId,artifactId:image.id,mode:'preview'}});assert.ok((read.content as any[]).some(c=>c.type==='image'));
    f.store.revoke(f.project.id);assert.equal((await sdk.callTool({name:'list_publications',arguments:{}})).isError,true);
    assert.equal(f.store.run(f.draft.activityId,run.id).imagesUsed,0);
  }finally{await sdk?.close();await harness?.close();http.close();await app.close();f.db.close();await rm(dir,{recursive:true,force:true});}
});
