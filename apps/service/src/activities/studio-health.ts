import {Value} from '@sinclair/typebox/value';
import {StudioHealthRequestSchema,type StudioHealthRequest,type StudioHealthResult,type StudioHealthLayer} from '@sthstart/contracts';
import type {ServiceDatabase} from '../database.js';
import {nowIso} from '../database.js';
import type {ServiceConfig} from '../config.js';
import type {SecretStore} from '../security.js';
import {resolveAssignedLlmProfile} from '../providers.js';
import {resolveArtifactStoragePath} from '../artifacts.js';
import {inspectWorkflowRuntime} from '../generation/runtime-preflight.js';
import {workerHealth} from '../worker.js';
import {redactAiValue} from '../ai-call-trace.js';
import {resolveStudioBatchTarget,isStudioTargetBusy} from './studio-batches.js';
import {studioError} from './studio-store.js';

const generationUrl='/settings/generation',textUrl='/settings/public-services?section=routing&app=activities';
const titles={text:'提示词优化模型',connection:'生成实例连接',workflow:'工作流与输入输出',files:'模型与参考文件',queue:'生成队列'} as const;

/** Read-only diagnostic: no draft commit, task creation, model request, download,
 * queue mutation or fabricated AI call. Actual dispatch still runs its own live checks. */
export async function inspectStudioHealth(options:{database:ServiceDatabase;config:ServiceConfig;secrets:SecretStore;
  activityId:string;request:StudioHealthRequest;fetcher?:typeof fetch}):Promise<StudioHealthResult>{
  const {database,config,secrets,activityId,request}=options,fetcher=options.fetcher??fetch;
  if(!Value.Check(StudioHealthRequestSchema,request))throw studioError('studio_invalid_request','健康检查只接受活动内的目标标识。');
  if(!database.connection.prepare('SELECT 1 FROM activities WHERE id=?').get(activityId))throw studioError('activity_not_found','活动不存在。',404);
  const layers:StudioHealthLayer[]=(['text','connection','workflow','files','queue'] as const).map(kind=>({kind,status:'unknown',summary:'尚未检查',issues:[],settingsUrl:kind==='text'?textUrl:generationUrl}));
  const set=(kind:StudioHealthLayer['kind'],status:StudioHealthLayer['status'],issues:string[]=[],summary?:string)=>{
    Object.assign(layers.find(layer=>layer.kind===kind)!,{status,issues:[...new Set(issues)],summary:summary??(status==='ok'?`${titles[kind]}可用`:status==='error'?`${titles[kind]}有缺项`:`${titles[kind]}尚无法确认`)});
  };
  const report:StudioHealthResult={target:request.target,checkedAt:nowIso(),canSubmit:false,layers,workflowId:null,workflowVersion:null,engineId:null,model:null,
    optimizerEnabled:null,queue:{running:null,pending:null,localUncertain:0}};
  let prepared:ReturnType<typeof resolveStudioBatchTarget>;
  try{prepared=resolveStudioBatchTarget(database,config,activityId,request.target,0,'studio-health-read-only');}
  catch(error){
    const value=error as Error&{code?:string;statusCode?:number};
    if(value.statusCode===404)throw error;
    const message=String(redactAiValue(value.message));
    set('workflow','error',[message]);
    if(value.code?.includes('reference')||value.code?.includes('lora')||value.code?.includes('artifact'))set('files','error',[message]);
    return report;
  }
  report.workflowId=prepared.preview.workflowId;report.workflowVersion=prepared.preview.workflowVersion;
  report.engineId=prepared.engine.id;report.model=prepared.preview.model;report.optimizerEnabled=prepared.optimizerEnabled;
  if(!prepared.optimizerEnabled)set('text','not_required',[],'提示词优化已关闭，不需要文本模型');
  else{
    try{const profile=await resolveAssignedLlmProfile(database,secrets,'activities','text');
      const credential=profile?database.connection.prepare(`SELECT CASE WHEN mp.id IS NOT NULL THEN sc.credential_account ELSE p.credential_account END account
        FROM app_llm_assignments a LEFT JOIN provider_profiles p ON p.id=a.profile_id LEFT JOIN model_profiles mp ON mp.id=a.profile_id
        LEFT JOIN service_connections sc ON sc.id=mp.connection_id WHERE a.app_id='activities' AND a.role='text' AND a.profile_id=?`).get(profile.id):null;
      const available=Boolean(profile&&(!credential?.account||profile.secret));
      set('text',available?'ok':'error',available?[]:['活动文本模型未绑定、未启用或已配置的凭据不可用。'],available?`已绑定：${profile!.model}`:undefined);
    }catch{set('text','error',['活动文本模型凭据不可用，请重新配置。']);}
  }
  const workflowIssues:string[]=[];
  const version=database.connection.prepare('SELECT is_published,node_bindings_json,output_declarations_json FROM generation_workflow_versions WHERE workflow_id=? AND version=?').get(report.workflowId,report.workflowVersion);
  if(!version?.is_published)workflowIssues.push('所选工作流版本尚未发布。');
  else{
    const outputs:unknown=JSON.parse(String(version.output_declarations_json)),bindings:Record<string,unknown>=JSON.parse(String(version.node_bindings_json));
    if(!Array.isArray(outputs)||outputs.length===0)workflowIssues.push('工作流未声明图片输出节点。');
    else for(const id of outputs)if(typeof id!=='string'||!prepared.graph[id])workflowIssues.push(`输出节点 ${String(id)} 不在实际工作流图中。`);
    for(const [field,path] of Object.entries(bindings)){
      let cursor:unknown=prepared.graph;
      if(!Array.isArray(path)||!path.length){workflowIssues.push(`输入 ${field} 没有有效节点绑定。`);continue;}
      for(const segment of path){if(typeof segment!=='string'||!cursor||typeof cursor!=='object'||!(segment in cursor)){cursor=undefined;break;}cursor=(cursor as Record<string,unknown>)[segment];}
      if(cursor===undefined)workflowIssues.push(`输入 ${field} 绑定的节点或字段不存在。`);
    }
  }
  const fileIssues:string[]=[];
  for(const id of prepared.preview.referenceArtifactIds){
    const row=database.connection.prepare("SELECT id FROM artifacts WHERE id=? AND app_id='activities' AND file_status='ready' AND (media_type='image' OR content_type LIKE 'image/%')").get(id);
    if(!row||!resolveArtifactStoragePath(database,id,config.artifactDirectory))fileIssues.push(`参考图片 ${id} 文件不可读取。`);
  }
  try{
    const runtime=await inspectWorkflowRuntime(prepared.engine,prepared.graph,secrets,fetcher,true);
    set('connection',runtime.reachable===true?'ok':runtime.reachable===false?'error':'unknown',runtime.checks.connection);
    workflowIssues.push(...runtime.checks.graph,...runtime.checks.nodes);fileIssues.push(...runtime.checks.models);
    set('workflow',workflowIssues.length?'error':runtime.reachable===true?'ok':'unknown',workflowIssues);
    set('files',fileIssues.length?'error':runtime.reachable===true?'ok':'unknown',fileIssues);
  }catch(error){set('connection','error',[`连接检查失败：${String(redactAiValue((error as Error).message))}`]);set('workflow',workflowIssues.length?'error':'unknown',workflowIssues);set('files',fileIssues.length?'error':'unknown',fileIssues);}
  report.queue.localUncertain=Number(database.connection.prepare('SELECT COUNT(*) n FROM generation_tasks WHERE engine_id=? AND upstream_may_continue=1').get(prepared.engine.id)!.n);
  if(layers.find(layer=>layer.kind==='connection')!.status==='ok'){
    try{
      const secret=prepared.engine.credentialAccount?(await secrets.get(prepared.engine.credentialAccount)).value:null;
      if(prepared.engine.kind==='worker'){
        if(!secret)throw new Error('Windows Worker 缺少访问凭据。');
        const health=await workerHealth(prepared.engine.baseUrl,secret,fetcher);
        if(health.ready===false||!Number.isInteger(health.queueDepth)||Number(health.queueDepth)<0)throw new Error('Worker 未就绪或未返回有效队列深度。');
        report.queue.pending=Number(health.queueDepth);
      }else{
        const response=await fetcher(`${prepared.engine.baseUrl.replace(/\/+$/,'')}/queue`,{headers:secret?{authorization:`Bearer ${secret}`}:{},signal:AbortSignal.timeout(8000)});
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const text=await response.text();if(text.length>2_000_000)throw new Error('队列响应过大。');
        const body=JSON.parse(text);
        if(!Array.isArray(body.queue_running)||!Array.isArray(body.queue_pending))throw new Error('未返回有效的运行和排队列表。');
        report.queue.running=body.queue_running.length;report.queue.pending=body.queue_pending.length;
      }
      const busy=isStudioTargetBusy(database,activityId,request.target);
      set('queue',busy?'error':'ok',busy?['此目标仍有运行、排队或结果未知的绘制，请先核对原任务。']:[],
        `运行 ${report.queue.running??'未单独报告'} · 排队 ${report.queue.pending} · 本机待核对 ${report.queue.localUncertain}`);
    }catch(error){set('queue','unknown',[`队列暂无法核对：${String(redactAiValue((error as Error).message))}`]);}
  }
  if(!prepared.preview.canSubmit){workflowIssues.push(...prepared.preview.issues);set('workflow','error',workflowIssues);}
  report.canSubmit=prepared.preview.canSubmit&&layers.every(layer=>layer.status==='ok'||layer.status==='not_required');
  return report;
}
