import {Value} from '@sinclair/typebox/value';
import {StudioTextFallbackSelectionSchema,StudioTextFallbackRequestSchema,type StudioTextFallbackOptions,
  type StudioTextFallbackPreview,type StudioTextFallbackRequest,type StudioTextFallbackSelection,type StudioJob,
  type StudioStoryboardRequest,type StudioRefineRequest} from '@sthstart/contracts';
import type {ServiceDatabase} from '../database.js';
import type {SecretStore} from '../security.js';
import {redactAiValue} from '../ai-call-trace.js';
import {StudioStore,studioError,studioHash} from './studio-store.js';
import {freezeStudioStoryboard} from './studio-storyboard.js';
import {freezeStudioRefine} from './studio-refine.js';
import {resolveStudioTextProfile,studioTextProfileBinding} from './studio-model-binding.js';

export type FrozenTextFallback={kind:'text_model';fallbackOf:string;rootJobId:string;profileId:string;profileName:string;
  model:string;profileHash:string;sourceHash:string;priorCallId:string|null;reason:string;scope:string;maxAttempts:1};

function actualOriginalCall(database:ServiceDatabase,job:StudioJob){
  // Trace IDs can be shared by a whole chain. Never mistake another object's call
  // for this job's proof of dispatch or failure.
  return job.callId?database.connection.prepare("SELECT * FROM ai_call_records WHERE id=? AND application_id='activities' AND object_id=? AND object_type='activity-studio-job'").get(job.callId,job.id):null;
}
function originalModel(database:ServiceDatabase,job:StudioJob):string|null{
  const call=actualOriginalCall(database,job),models=call?JSON.parse(String(call.models_json)):[];
  return Array.isArray(models)&&models.length?models.map(String).join(', '):null;
}

export function studioFallbackRoot(database:ServiceDatabase,job:StudioJob){
  const store=new StudioStore(database),seen=new Set<string>();let root=job;
  while(root.parentJobId){if(seen.has(root.id))throw studioError('studio_fallback_unsafe','任务来源关系不完整，未执行备用请求。',409);
    seen.add(root.id);const parent=store.get(job.activityId,root.parentJobId);if(!parent)throw studioError('studio_fallback_unsafe','原任务关系缺失，请先核对记录。',409);root=parent;}
  return root.id;
}
function eligible(database:ServiceDatabase,job:StudioJob){
  if(job.readOnly)throw studioError('studio_job_read_only','导入历史只读，不能用原记录执行备用请求。',409);
  if(job.kind==='render_batch')throw studioError('studio_fallback_scope_unsupported','图片备用方案需要单独选择目标与图片预设，此入口只处理分镜或画面调整文本任务。',409);
  if(!['failed','interrupted','paused'].includes(job.status)||job.stopRequested||job.applyState!=='not_applied')
    throw studioError('studio_fallback_unsafe','任务仍在运行、已停止或没有明确失败；不能执行备用请求。',409);
  const root=studioFallbackRoot(database,job);
  const used=database.connection.prepare("SELECT id FROM activity_studio_jobs WHERE activity_id=? AND json_extract(input_json,'$.fallback.rootJobId')=? LIMIT 1").get(job.activityId,root);
  if(used)throw studioError('studio_fallback_limit','该任务链已经使用过一次备用方案。再次失败后保持暂停，请处理配置或明确新建任务。',409);
  const call=actualOriginalCall(database,job);
  const preNetwork=(job.input.recovery as {canResumeBeforeNetwork?:boolean}|undefined)?.canResumeBeforeNetwork;
  if(job.errorCode==='studio_model_timeout'||call&&(!['succeeded','not_dispatched','failed'].includes(String(call.status))
    ||call.status==='failed'&&(!/^http_4\d\d$/.test(String(call.error_code))||call.error_code==='http_408'))
    ||!call&&!(job.errorCode==='studio_profile_unavailable'||job.errorCode==='studio_process_interrupted'&&preNetwork))
    throw studioError('studio_fallback_unknown','原模型请求的结果尚未明确（超时、断流或网关错误）。不能直接备用重投，请核对原记录。',409);
  if(job.callId&&!call)throw studioError('studio_fallback_unknown','原调用记录缺失，不能据此认定请求没有发生。',409);
  return root;
}
function getParent(database:ServiceDatabase,activityId:string,jobId:string){
  const parent=new StudioStore(database).get(activityId,jobId);
  if(!parent)throw studioError('studio_job_not_found','任务不属于此活动。',404);
  return parent;
}

/** Recreate only to validate current ownership/CAS; execution uses the original
 * frozen payload, never fresh text or a new global profile assignment. */
export function validateStudioTextFallbackSource(database:ServiceDatabase,job:StudioJob){
  const request=job.input.request as StudioStoryboardRequest|StudioRefineRequest;
  const fresh=job.kind==='storyboard'?freezeStudioStoryboard(database,job.activityId,request as StudioStoryboardRequest):freezeStudioRefine(database,job.activityId,request as StudioRefineRequest);
  const original=Object.fromEntries(Object.entries(job.input).filter(([key])=>!['fallback','recovery','resumeFromRevision','resumeRequestHash','resumeItemIds'].includes(key)));
  if(studioHash(fresh)!==studioHash(original))throw studioError('studio_source_changed','原任务的正文、角色或目标已经变化，未执行备用请求。请明确新建并审阅。',409);
  return studioHash(fresh);
}

export async function listStudioTextFallbackOptions(database:ServiceDatabase,secrets:SecretStore,activityId:string,jobId:string):Promise<StudioTextFallbackOptions>{
  const job=getParent(database,activityId,jobId),model=originalModel(database,job);
  try{eligible(database,job);validateStudioTextFallbackSource(database,job);}catch(error){return {allowed:false,reason:(error as Error).message,originalModel:model,profiles:[]};}
  const ids=database.connection.prepare(`SELECT id FROM model_profiles UNION SELECT id FROM provider_profiles WHERE kind='llm'`).all();
  const profiles:StudioTextFallbackOptions['profiles']=[];
  for(const row of ids){try{const profile=await resolveStudioTextProfile(database,secrets,String(row.id));profiles.push({id:profile.id,name:profile.name,model:profile.model!});}catch{/* Disabled, invalid or missing credentials are not candidates. */}}
  return {allowed:profiles.length>0,reason:profiles.length?'原请求已明确结束；选择配置只影响这一次新尝试，不改活动默认模型。':'没有启用且凭据可用的文本模型，请先在公共服务中配置。',originalModel:model,profiles};
}

export async function previewStudioTextFallback(database:ServiceDatabase,secrets:SecretStore,activityId:string,jobId:string,request:StudioTextFallbackSelection):Promise<StudioTextFallbackPreview>{
  if(!Value.Check(StudioTextFallbackSelectionSchema,request))throw studioError('studio_invalid_request','备用文本预览只接受已有模型配置 ID。');
  const job=getParent(database,activityId,jobId),rootJobId=eligible(database,job),sourceHash=validateStudioTextFallbackSource(database,job);
  const profile=await resolveStudioTextProfile(database,secrets,request.profileId),profileHash=studioTextProfileBinding(database,profile.id).hash;
  const scope=job.kind==='storyboard'?`原分镜正文与角色，${(job.input.request as StudioStoryboardRequest).input.count} 镜待审提案`:
    '原画面调整对象，仅景别、角度、光影、构图与表情的待审提案';
  const preview={fallbackOf:job.id,rootJobId,expectedJobRevision:job.revision,profileId:profile.id,profileName:profile.name,model:profile.model!,
    originalModel:originalModel(database,job),reason:String(redactAiValue(job.errorMessage??'原任务未完成')),scope,modelRequestCount:1 as const,imageTaskCount:0 as const,maxAttempts:1 as const};
  return {...preview,planHash:studioHash({preview,sourceHash,profileHash})};
}

export async function createStudioTextFallback(database:ServiceDatabase,secrets:SecretStore,activityId:string,jobId:string,request:StudioTextFallbackRequest):Promise<StudioJob>{
  if(!Value.Check(StudioTextFallbackRequestSchema,request))throw studioError('studio_invalid_request','备用请求需要模型配置、原任务修订、已审阅计划和提交标识。');
  const store=new StudioStore(database),key=`fallback:${studioHash({jobId,key:request.idempotencyKey})}`,hash=studioHash({jobId,...request});
  getParent(database,activityId,jobId);const existing=store.findIdempotent(activityId,key,hash);if(existing)return existing;
  // Credentials may be asynchronous. Recheck every row/hash inside the TX below;
  // no asynchronous work or network is performed while holding SQLite's lock.
  const preview=await previewStudioTextFallback(database,secrets,activityId,jobId,{profileId:request.profileId});
  if(preview.expectedJobRevision!==request.expectedJobRevision||preview.planHash!==request.planHash)
    throw studioError('studio_plan_changed','原任务或备用配置已变化，请重新预览并确认；未发送请求。',409);
  const profileHash=studioTextProfileBinding(database,request.profileId).hash;
  return database.transaction(()=>{
    const same=store.findIdempotent(activityId,key,hash);if(same)return same;
    const parent=getParent(database,activityId,jobId),rootJobId=eligible(database,parent),sourceHash=validateStudioTextFallbackSource(database,parent);
    if(parent.revision!==request.expectedJobRevision||studioTextProfileBinding(database,request.profileId).hash!==profileHash)
      throw studioError('studio_plan_changed','确认期间任务或配置变化，未执行备用请求。',409);
    const fallback:FrozenTextFallback={kind:'text_model',fallbackOf:jobId,rootJobId,profileId:request.profileId,profileName:preview.profileName,model:preview.model,
      profileHash,sourceHash,priorCallId:parent.callId,reason:preview.reason,scope:preview.scope,maxAttempts:1};
    const created=store.create({activityId,kind:parent.kind,parentJobId:jobId,idempotencyKey:key,request:{jobId,...request},planHash:request.planHash,
      freeze:()=>({...parent.input,fallback})},{skipTransaction:true});
    database.connection.prepare('UPDATE activity_studio_jobs SET trace_id=? WHERE id=?').run(parent.traceId,created.job.id);
    return store.get(activityId,created.job.id)!;
  });
}
