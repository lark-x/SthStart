import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema,ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { PublicationDocumentSchema, PublicationHarnessTools } from '@sthstart/contracts';
import { Value } from '@sinclair/typebox/value';
import { mcpJson, mcpError, toolSchema } from '../mcp-http.js';

const projectId=process.env.STHSTART_STORY_PROJECT_ID, token=process.env.STHSTART_PUBLICATION_BRIDGE_TOKEN,
  portal=process.env.STHSTART_STORY_PORTAL_URL;
if(!projectId||!token||!portal||!/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) throw new Error('缺少独立制作项目凭据或项目 ID。');
const url=new URL(portal);
if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash) throw new Error('制作 MCP 只连接本机 Portal。');
const root=`${portal.replace(/\/$/,'')}/api/publication-bridge/projects/${encodeURIComponent(projectId)}`;
const string={type:'string',minLength:1}, version={type:'integer',minimum:1}, key={type:'string',minLength:8,maxLength:128};
const schema=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const tools=[
  ...PublicationHarnessTools,
  {name:'get_source_bundle',description:'分段读取本制作冻结的正式章节。每次最多20,000字符，使用nextOffset继续；不可直接修改剧情。',inputSchema:schema({activityId:string,entryRevisionId:string,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:20000}},['activityId'])},
  {name:'get_publication',description:'读取独立制作草稿和最近人工批准记录。批准记录不等于所有当前编辑仍有效。',inputSchema:schema({activityId:string})},
  {name:'propose_publication_plan',description:'提交独立制作草稿；实际执行需6–12关键帧，每格多个对白，结构化英文生图提示词，不含图片文字。此操作不批准费用、不修改正式剧情。',inputSchema:schema({activityId:string,expectedDraftVersion:version,document:PublicationDocumentSchema})},
  {name:'start_approved_run',description:'只执行人工已确认且未改变的方案和额度。先读取get_publication中的approval，无法自行批准。重复使用原idempotencyKey。',inputSchema:schema({activityId:string,approvalId:string,idempotencyKey:key})},
  {name:'get_run_status',description:'查询持久任务、费用额度、产物和错误；不要凭模型上下文猜测完成。',inputSchema:schema({activityId:string,runId:string})},
  {name:'stop_run',description:'停止后续调用，尽力取消上游；已提交调用可能继续且不会退回预算。',inputSchema:schema({activityId:string,runId:string})},
  {name:'retry_shot',description:'在本轮剩余额度内复用批准提示词随机重绘；未知或处理中结果禁止重投。',inputSchema:schema({activityId:string,shotId:string,runId:string,idempotencyKey:key})},
  {name:'select_shot_image',description:'从该镜头历史选图，只改制作文档；来源变化需allowStaleSource明确确认。',inputSchema:schema({activityId:string,shotId:string,artifactId:string,expectedDraftVersion:version,allowStaleSource:{type:'boolean'}})},
];
const server=new Server({name:'sthstart-publication',version:'1.0.0'},{capabilities:{tools:{}},instructions:'制作模式与正式剧情分离。先读取冻结章节，为跨游戏角色填写universe和视觉快照。每格一个主要动作，多个对白可共享画面。填StructuredVisualPrompt英文标签；不得伪造完成、批准、产物或来源ID。提交方案后等待人类在SthStart确认方案与预算，才能开始付费制作。结果unknown时不自动重投。'});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools}));
server.setRequestHandler(CallToolRequestSchema,async({params})=>{
  try{
    const a=params.arguments??{},definition=tools.find(t=>t.name===params.name);
    if(!definition)throw new Error('不允许的制作工具。');
    if(!Value.Check(toolSchema(definition.inputSchema),a))throw new Error('工具参数不符合Schema。');
    const id=(name:string)=>{
      const value=a[name];if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new Error(`参数 ${name} 不是有效ID。`);return encodeURIComponent(value);
    };
    const base=params.name==='list_publications'?'/publications':`/publications/${id('activityId')}`;
    let path:string,method='GET',body:unknown;
    switch(params.name){
      case 'list_publications':case 'list_runs':case 'list_shot_images':case 'list_utterance_audio':case 'get_publication_media': {
        const q=new URLSearchParams();for(const k of ['cursor','limit','query','status'])if(a[k]!==undefined)q.set(k,String(a[k]));
        const suffix=params.name==='list_publications'?'':params.name==='list_runs'?'/runs':params.name==='list_shot_images'?`/shots/${id('shotId')}/history`:params.name==='list_utterance_audio'?`/utterances/${id('utteranceId')}/history`:'/media';
        path=`${base}${suffix}${q.size?`?${q}`:''}`;break;
      }
      case 'read_publication_artifact':path=`${base}/artifacts/${id('artifactId')}?mode=${a.mode??'metadata'}`;break;
      case 'get_publication_options':{const q=new URLSearchParams({category:String(a.category??'all')});for(const k of ['cursor','limit'])if(a[k]!==undefined)q.set(k,String(a[k]));path=`${base}/options?${q}`;break;}
      case 'validate_publication_plan':path=`${base}/validate`;method='POST';body={document:a.document};break;
      case 'preview_publication_run':path=`${base}/preview`;method='POST';body={expectedDraftVersion:a.expectedDraftVersion,speechProfileId:a.speechProfileId,makeVideo:a.makeVideo,...(a.checkUpstream===undefined?{}:{checkUpstream:a.checkUpstream})};break;
      case 'patch_publication_plan':path=`${base}/patch`;method='POST';body={expectedDraftVersion:a.expectedDraftVersion,operations:a.operations};break;
      case 'select_utterance_audio':path=`${base}/utterances/${id('utteranceId')}/select-audio`;method='POST';body={artifactId:a.artifactId,expectedDraftVersion:a.expectedDraftVersion,allowStaleSource:a.allowStaleSource};break;
      case 'retry_utterance_audio':path=`${base}/utterances/${id('utteranceId')}/retries`;method='POST';body={runId:a.runId,idempotencyKey:a.idempotencyKey};break;
      case 'export_publication':path=`${base}/exports`;method='POST';body={expectedDraftVersion:a.expectedDraftVersion,makeVideo:a.makeVideo,idempotencyKey:a.idempotencyKey};break;
      case 'get_publication_task':path=`${base}/tasks/${id('taskId')}`;break;
      case 'get_source_bundle': {const q=new URLSearchParams({activityId:String(a.activityId)});for(const k of ['entryRevisionId','offset','limit']) if(a[k]!==undefined) q.set(k,String(a[k]));path=`/sources?${q}`;break;}
      case 'get_publication':path=base;break;
      case 'propose_publication_plan':path='/plans';method='POST';body=a;break;
      case 'start_approved_run':path=`${base}/runs`;method='POST';body={approvalId:a.approvalId,idempotencyKey:a.idempotencyKey};break;
      case 'get_run_status':path=`${base}/runs/${id('runId')}`;break;
      case 'stop_run':path=`${base}/runs/${id('runId')}/stop`;method='POST';body={};break;
      case 'retry_shot':path=`${base}/shots/${id('shotId')}/retries`;method='POST';body={runId:a.runId,idempotencyKey:a.idempotencyKey};break;
      case 'select_shot_image':path=`${base}/shots/${id('shotId')}/select-image`;method='POST';body={artifactId:a.artifactId,expectedDraftVersion:a.expectedDraftVersion,allowStaleSource:a.allowStaleSource};break;
      default:throw new Error('不允许的制作工具。');
    }
    const result=await mcpJson(`${root}${path}`,{method,headers:{authorization:`Bearer ${token}`,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
    const {preview,...metadata}=result;
    const workspaceUrl=metadata.workspacePath?new URL(metadata.workspacePath,portal).href:undefined;
    const data=workspaceUrl?{...metadata,workspaceUrl}:metadata;
    const content:any[]=[{type:'text',text:JSON.stringify(data,null,2)}];
    if(preview)content.push({type:preview.type,mimeType:preview.mimeType,data:preview.data});
    return {content,structuredContent:preview?{...data,preview:{type:preview.type,mimeType:preview.mimeType,transformed:preview.transformed}}:result};
  }catch(error){return mcpError(error);}
});
await server.connect(new StdioServerTransport());
