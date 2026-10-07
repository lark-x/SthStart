import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {PublicationHarnessTools} from '@sthstart/contracts';
import {publicationFixture} from './fixtures.js';

const legacy=['get_source_bundle','get_publication','propose_publication_plan','start_approved_run','get_run_status','stop_run','retry_shot','select_shot_image'];
test('Publication stdio exposes old/new tools, maps every new route, returns media blocks and safe conflicts',async()=>{
  const requests:Array<{url:string;method:string;body:any}>=[],token=`pub_${'a'.repeat(64)}`;
  const http=createServer(async(req,res)=>{
    assert.equal(req.headers.authorization,`Bearer ${token}`);const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));
    requests.push({url:req.url??'',method:req.method??'',body:chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null});res.setHeader('content-type','application/json');
    if(req.url?.includes('artifact-img'))return res.end(JSON.stringify({artifactId:'artifact-img',kind:'image',workspacePath:'/apps/activities/work',preview:{type:'image',mimeType:'image/png',data:'iVBORw0KGgo=',transformed:true}}));
    if(req.url?.endsWith('/patch')){res.statusCode=409;return res.end(JSON.stringify({error:'publication_draft_conflict',message:'请重新读取',currentVersion:7}));}
    if(req.url?.endsWith('/tasks/nonjson'))return res.end('not JSON');
    res.end(JSON.stringify({ok:true,items:[],nextCursor:null}));
  });http.listen(0,'127.0.0.1');await once(http,'listening');const address=http.address();assert.ok(address&&typeof address!=='string');
  const transport=new StdioClientTransport({command:process.execPath,args:['--import',import.meta.resolve('tsx/esm'),fileURLToPath(new URL('./mcp-server.ts',import.meta.url))],stderr:'pipe',env:{PATH:process.env.PATH??'',STHSTART_STORY_PROJECT_ID:'project',STHSTART_PUBLICATION_BRIDGE_TOKEN:token,STHSTART_STORY_PORTAL_URL:`http://127.0.0.1:${address.port}`}}),client=new Client({name:'publication-sdk-test',version:'1.0.0'});
  try{
    await client.connect(transport);const list=await client.listTools();assert.equal(list.tools.length,22);assert.deepEqual(list.tools.map(t=>t.name).sort(),[...legacy,...PublicationHarnessTools.map(t=>t.name)].sort());
    const fixture=publicationFixture('unused-stdio-media'),document=fixture.document;fixture.db.close();
    const calls:Array<[string,Record<string,unknown>,string,string]>= [
      ['get_source_bundle',{activityId:'work'},'/sources?activityId=work','GET'],
      ['get_publication',{activityId:'work'},'/publications/work','GET'],
      ['propose_publication_plan',{activityId:'work',expectedDraftVersion:2,document},'/plans','POST'],
      ['start_approved_run',{activityId:'work',approvalId:'approval',idempotencyKey:'start-key'},'/publications/work/runs','POST'],
      ['get_run_status',{activityId:'work',runId:'run'},'/publications/work/runs/run','GET'],
      ['stop_run',{activityId:'work',runId:'run'},'/publications/work/runs/run/stop','POST'],
      ['retry_shot',{activityId:'work',shotId:'shot',runId:'run',idempotencyKey:'image-key'},'/publications/work/shots/shot/retries','POST'],
      ['select_shot_image',{activityId:'work',shotId:'shot',artifactId:'image',expectedDraftVersion:2,allowStaleSource:false},'/publications/work/shots/shot/select-image','POST'],
      ['validate_publication_plan',{activityId:'work',document},'/publications/work/validate','POST'],
      ['list_publications',{limit:2},'/publications?limit=2','GET'],['list_runs',{activityId:'work'},'/publications/work/runs','GET'],
      ['list_shot_images',{activityId:'work',shotId:'shot'},'/publications/work/shots/shot/history','GET'],['list_utterance_audio',{activityId:'work',utteranceId:'line'},'/publications/work/utterances/line/history','GET'],
      ['get_publication_media',{activityId:'work'},'/publications/work/media','GET'],['get_publication_options',{activityId:'work',category:'speech'},'/publications/work/options?category=speech','GET'],
      ['preview_publication_run',{activityId:'work',expectedDraftVersion:2,speechProfileId:null,makeVideo:false},'/publications/work/preview','POST'],
      ['patch_publication_plan',{activityId:'work',expectedDraftVersion:2,operations:[{kind:'publication',changes:{title:'新标题'}}]},'/publications/work/patch','POST'],
      ['select_utterance_audio',{activityId:'work',utteranceId:'line',artifactId:'audio',expectedDraftVersion:2,allowStaleSource:false},'/publications/work/utterances/line/select-audio','POST'],
      ['retry_utterance_audio',{activityId:'work',utteranceId:'line',runId:'run',idempotencyKey:'retry-key'},'/publications/work/utterances/line/retries','POST'],
      ['export_publication',{activityId:'work',expectedDraftVersion:2,makeVideo:false,idempotencyKey:'export-key'},'/publications/work/exports','POST'],
      ['get_publication_task',{activityId:'work',taskId:'task'},'/publications/work/tasks/task','GET'],
    ];
    for(const [name,args,path,method] of calls){const result=await client.callTool({name,arguments:args});assert.equal(requests.at(-1)?.url,`/api/publication-bridge/projects/project${path}`);assert.equal(requests.at(-1)?.method,method);if(name==='patch_publication_plan'){assert.equal(result.isError,true);assert.equal((result.structuredContent as any)?.currentVersion,7);}else assert.ok(!result.isError,JSON.stringify(result));}
    const media=await client.callTool({name:'read_publication_artifact',arguments:{activityId:'work',artifactId:'artifact-img',mode:'preview'}});assert.ok((media.content as any[]).some(c=>c.type==='image'));assert.ok(!JSON.stringify(media.structuredContent).includes('iVBOR'));assert.match(JSON.stringify(media.content),/workspaceUrl/);
    const before=requests.length;assert.equal((await client.callTool({name:'list_publications',arguments:{limit:500}})).isError,true);assert.equal(requests.length,before);
    assert.equal((await client.callTool({name:'get_publication_task',arguments:{activityId:'work',taskId:'nonjson'}})).isError,true);
    assert.equal((await client.callTool({name:'approve',arguments:{}})).isError,true);
  }finally{await client.close();http.close();await once(http,'close');}
});
