import { randomUUID } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import { StudioBatchRequestSchema,StudioBatchStartSchema,StudioBatchRetrySchema,type StudioBatchRequest,type StudioBatchStart,type StudioBatchRetry,type StudioBatchPlan,
  type StudioJob,type StudioTarget,type StudioItemPage,type BeatRenderSubmitRequest } from '@sthstart/contracts';
import { nowIso,type ServiceDatabase } from '../database.js';
import type { ServiceConfig } from '../config.js';
import type { SecretStore } from '../security.js';
import { extractModelNames,redactAiValue } from '../ai-call-trace.js';
import { inspectWorkflowRuntime } from '../generation/runtime-preflight.js';
import { resolveWorkflowAndEngine } from '../generation/task-store.js';
import { ActivityStore } from './store.js';
import { ComicStore } from './comic-store.js';
import { StudioStore,studioHash,studioError } from './studio-store.js';
import { assertStudioVersions } from './studio-storyboard.js';
import { previewStudioBeatRender,createStudioBeatCandidate,selectCandidateImage,findBeatRenderTarget } from './beat-renders.js';
import { previewStudioComicRender,createStudioComicRenderJob,compileComicPanelSource } from './comic-renders.js';
import { compileBatchSlot } from './media-batches.js';
import { computeSlotFingerprint,saveRecipeAndCompilation } from './image-prompt-compiler.js';
import { getImageConfigRevision,getImageConfigDraft } from './image-configs.js';
import { buildActivityImageWorkflowSnapshot,resolveEffectiveActivityVisualPlan,promptInputKey,referenceInputKey,readActivityLoraPolicy,mergeActivityLoras } from './image-render-common.js';
import type { InputSchemaMap } from '../generation/configuration.js';
import { processStudioSingleRender,type FrozenSingle } from './studio-single-render.js';
import { syncAttemptOutputs } from './image-attempts.js';
import { selectMediaForSlots } from './media.js';
import { resolveArtifactStoragePath } from '../artifacts.js';
import { updateAiCallRecord } from '../ai-call-trace.js';
import { resolveAssignedLlmProfile } from '../providers.js';
import {getGenerationTask} from '../generation/task-store.js';
import {readStudioContext} from './studio-context.js';
import { resolveStudioTextProfile,studioTextProfileBinding } from './studio-model-binding.js';
import type { StudioOptimizerOverride } from './studio-render-context.js';

export type StudioPlannedItem={id:string;target:StudioTarget;candidateIndex:number;seed:number;submissionKey:string;sourceFingerprint:string;optimizerOverride?:StudioOptimizerOverride;
  presetOverride?:{presetId:string;presetRevision?:number};
  planHash:string;configurationHash:string;emptyAtSubmit:boolean;preview:StudioBatchPlan};
export type FrozenStudioBatch={batch:true;request:StudioBatchRequest;plans:StudioPlannedItem[];started:boolean;approved?:boolean;referenceArtifactIds:string[];optimizerOverride?:StudioOptimizerOverride};

/** A deleted object can be skipped; an existing object whose content changed must pause. */
export function studioTargetExists(database:ServiceDatabase,activityId:string,target:StudioTarget):boolean{
  if(target.kind==='comic_panel')return Boolean(new ComicStore(database).getComicDraft(activityId)?.document.panels.some(panel=>panel.id===target.panelId));
  const draft=new ActivityStore(database).getDraft(activityId);
  return Boolean(draft&&(target.kind==='beat'?findBeatRenderTarget(draft.document,target.stageId,target.sceneId,target.beatId):draft.document.mediaSlots.some(slot=>slot.id===target.slotId)));
}

function optimizerBinding(database:ServiceDatabase){
  const row=database.connection.prepare(`SELECT a.profile_id,p.model,p.base_url,p.enabled,p.credential_account,o.thinking_mode,o.headers_json,o.extra_body_json,
    mp.model_id,mp.enabled managed_enabled,mp.advanced_json,mp.default_params_json,mp.max_output_tokens,
    sc.base_url managed_url,sc.enabled connection_enabled,sc.credential_account managed_credential,sc.headers_json managed_headers,sc.options_json,sc.timeout_ms
    FROM app_llm_assignments a LEFT JOIN provider_profiles p ON p.id=a.profile_id LEFT JOIN provider_profile_options o ON o.profile_id=p.id
    LEFT JOIN model_profiles mp ON mp.id=a.profile_id LEFT JOIN service_connections sc ON sc.id=mp.connection_id
    WHERE a.app_id='activities' AND a.role='text'`).get();
  // Only the hash is frozen. Headers/credential references never become preview text.
  return {hash:studioHash(row??null),profileId:row?String(row.profile_id):null,model:row?(row.model_id??row.model)==null?null:String(row.model_id??row.model):null};
}

export function assertStudioBatchLimits(request:StudioBatchRequest){
  if(!Value.Check(StudioBatchRequestSchema,request))throw studioError('studio_invalid_request','批次请求结构不合法。');
  if(new Set(request.input.targets.map(target=>target.kind)).size!==1)throw studioError('studio_invalid_request','一个批次只能包含一种目标。');
  if(new Set(request.input.targets.map(studioHash)).size!==request.input.targets.length)throw studioError('studio_invalid_request','批次目标不能重复。');
  if(request.input.targets.length*request.input.candidateCount>24)throw studioError('studio_batch_limit','一次最多 12 个目标、每目标 1–3 张，总计不超过 24 张。');
}
export function isStudioTargetBusy(database:ServiceDatabase,activityId:string,target:StudioTarget,excludeJobId?:string):boolean{
  const item=database.connection.prepare(`SELECT 1 FROM activity_studio_job_items i JOIN activity_studio_jobs j ON j.id=i.job_id
    WHERE j.activity_id=? AND i.target_key=? AND i.state IN ('preparing','submitted','unknown') AND j.id!=? LIMIT 1`).get(activityId,studioHash(target),excludeJobId ?? '');
  if(item)return true;
  if(target.kind==='beat')return Boolean(database.connection.prepare(`SELECT 1 FROM activity_beat_render_candidates c LEFT JOIN generation_tasks t ON t.id=c.task_id
    WHERE c.activity_id=? AND c.stage_id=? AND c.scene_id=? AND c.beat_id=? AND (c.status IN ('preparing','queued','running') OR t.upstream_may_continue=1) LIMIT 1`).get(activityId,target.stageId,target.sceneId,target.beatId));
  if(target.kind==='comic_panel')return Boolean(database.connection.prepare(`SELECT 1 FROM activity_comic_jobs c LEFT JOIN generation_tasks t ON t.id=c.generation_task_id
    WHERE c.activity_id=? AND c.panel_id=? AND c.kind='render' AND (c.status IN ('queued','preparing','running','unknown') OR t.upstream_may_continue=1) LIMIT 1`).get(activityId,target.panelId));
  return Boolean(database.connection.prepare(`SELECT 1 FROM activity_image_attempts a LEFT JOIN generation_tasks t ON t.id=a.task_id
    WHERE a.activity_id=? AND a.slot_id=? AND (COALESCE(t.status,a.status) IN ('queued','preparing','submitting','accepted','running') OR t.upstream_may_continue=1) LIMIT 1`).get(activityId,target.slotId));
}

/** Pure local preparation. Never sends an upstream request, writes a target, or inserts a native image task. */
export function resolveStudioBatchTarget(database:ServiceDatabase,config:ServiceConfig,activityId:string,target:StudioTarget,seed:number,submissionKey:string,
  optimizerOverride?:StudioOptimizerOverride,presetOverride?:{presetId:string;presetRevision?:number}){
  const activities=new ActivityStore(database),image=getImageConfigDraft(database,activityId);
  const selected=optimizerOverride?studioTextProfileBinding(database,optimizerOverride.profileId):null;
  if(selected&&(selected.hash!==optimizerOverride!.profileHash||!selected.enabled||!selected.model.trim()))
    throw studioError('studio_fallback_config_changed','备用提示词模型配置变化或已不可用，未提交图片任务。',409);
  const binding=selected?{hash:selected.hash,profileId:optimizerOverride!.profileId,model:selected.model}:optimizerBinding(database);
  const configurationHash=(enabled:boolean)=>studioHash({document:image.document,revisionId:image.baseRevisionId,optimizerBinding:enabled?binding.hash:null});
  if(target.kind==='beat'){
    const request:BeatRenderSubmitRequest={stageId:target.stageId,sceneId:target.sceneId,beatId:target.beatId,seed,idempotencyKey:submissionKey,
      ...(presetOverride?{presetId:presetOverride.presetId,...(presetOverride.presetRevision!=null?{presetRevision:presetOverride.presetRevision}:{})}:{})};
    const prepared=previewStudioBeatRender(database,activityId,request,optimizerOverride),s=prepared.snapshot;
    const preview:StudioBatchPlan={target,name:prepared.name,actorIds:prepared.actorIds,empty:prepared.empty,sourceFingerprint:prepared.sourceFingerprint,seed:s.seed,
      canSubmit:s.canSubmit,issues:s.warnings,workflowId:s.workflowId,workflowVersion:s.workflowVersion,presetId:s.selectedPresetId ?? null,presetRevision:s.selectedPresetRevision ?? null,
      model:s.model,parameters:s.parameters,referenceArtifactIds:prepared.referenceArtifactIds,
      promptPolicyRevision:s.promptOptimization.policyRevision,loraPolicyRevision:readActivityLoraPolicy(database,s.workflowId,s.workflowVersion).revision,
      loras:s.loras.map(({model,strength,triggerWord,enabled})=>({model,strength,triggerWord,enabled})),referenceSupported:s.referenceSupported,referenceSelected:s.referenceSelected};
    Object.assign(preview,{compiledPrompt:s.positivePrompt,negativePrompt:s.negativePrompt,optimizerEnabled:s.promptOptimization.enabled,optimizerProfileId:s.promptOptimization.enabled?binding.profileId:null,optimizerModel:s.promptOptimization.enabled?binding.model:null});
    return {preview,configurationHash:configurationHash(s.promptOptimization.enabled),planHash:prepared.planHash,graph:prepared.graph,engine:prepared.engine,optimizerEnabled:s.promptOptimization.enabled,beatRequest:request,media:null};
  }
  if(target.kind==='comic_panel'){
    const prepared=previewStudioComicRender(database,activityId,target.panelId,config.artifactDirectory,seed,
      presetOverride?{presetId:presetOverride.presetId,...(presetOverride.presetRevision!=null?{presetRevision:presetOverride.presetRevision}:{})}:undefined),p=prepared.plan;
    const preview:StudioBatchPlan={target,name:prepared.name,actorIds:prepared.actorIds,empty:prepared.empty,sourceFingerprint:p.sourceFingerprint,seed:p.seed,
      canSubmit:!p.warnings.some(warning=>warning.includes('已阻止提交')),issues:p.warnings,workflowId:p.workflow.workflow.id,workflowVersion:p.workflow.workflow.version,presetId:p.presetId ?? null,presetRevision:p.presetRevision ?? null,
      model:p.model,parameters:p.parameters,referenceArtifactIds:p.inputArtifacts.map(input=>input.artifactId),
      promptPolicyRevision:p.promptPolicy.revision,loraPolicyRevision:p.loraPolicyRevision,
      loras:p.loras.map(({model,strength,triggerWord,enabled})=>({model,strength,triggerWord,enabled})),referenceSupported:Boolean(p.referenceInputKey),referenceSelected:p.inputArtifacts.length>0};
    Object.assign(preview,{compiledPrompt:p.positivePrompt,negativePrompt:p.negativePrompt,optimizerEnabled:p.promptPolicy.enabled,optimizerProfileId:p.promptPolicy.enabled?binding.profileId:null,optimizerModel:p.promptPolicy.enabled?binding.model:null});
    return {preview,configurationHash:configurationHash(p.promptPolicy.enabled),planHash:p.planHash,graph:p.workflowSnapshot,engine:p.workflow.engine,optimizerEnabled:p.promptPolicy.enabled,beatRequest:null,media:null};
  }
  const activity=activities.getActivity(activityId)!,draft=activities.getDraft(activityId)!;
  if(!activity.currentContentRevisionId||!image.baseRevisionId)throw studioError('studio_source_changed','素材批次需要先提交内容和美术配置版本。',409);
  const published=getImageConfigRevision(database,activityId,image.baseRevisionId);
  if(!published||studioHash(published.document)!==studioHash(image.document))throw studioError('studio_version_conflict','素材美术草稿尚未提交，请先提交美术配置再预览。',409);
  const slot=draft.document.mediaSlots.find(slot=>slot.id===target.slotId),content=activities.getContentRevision(activityId,activity.currentContentRevisionId)!.document;
  const sourceSlot=content.mediaSlots.find(slot=>slot.id===target.slotId);
  if(!slot||!sourceSlot||slot.kind!=='image')throw studioError('studio_source_changed','素材槽位不存在或尚未提交内容版本。',409);
  if(draft.document.stages.find(stage=>stage.id===slot.stageId)?.locked||draft.document.editingPolicy?.lockedMediaSlotIds.includes(slot.id))throw studioError('studio_target_locked','素材槽位已锁定。',409);
  const media=compileBatchSlot(database,activities,activityId,{contentRevisionId:activity.currentContentRevisionId,imageConfigRevisionId:image.baseRevisionId,slotIds:[target.slotId]},target.slotId,presetOverride);
  if(computeSlotFingerprint(slot,draft.document)!==media.recipe.slotFingerprint)throw studioError('studio_source_changed','素材来源草稿尚未提交内容版本，请先保存活动新版本。',409);
  const plan=media.compilation.executionPlan!,resolved=resolveWorkflowAndEngine(database,'activities',{purpose:plan.purpose,workflowId:plan.workflowId,workflowVersion:plan.workflowVersion,engineId:plan.engineId,isInternal:true});
  const settings=image.document.slotConfigs.find(item=>item.slotId===slot.id),actors=content.actors.filter(actor=>slot.actorIds.includes(actor.id));
  const parameters={...media.compilation.effectiveParams,...media.compilation.channels},positiveKey=promptInputKey(resolved.workflow.inputSchema as InputSchemaMap);
  const effective=image.document.artDirection ? resolveEffectiveActivityVisualPlan(database,{imageConfig:image.document,imageConfigRevisionId:image.baseRevisionId,
    settings:{...settings,parameters:media.compilation.effectiveParams,
      ...(presetOverride?{presetId:presetOverride.presetId,...(presetOverride.presetRevision!=null?{presetRevision:presetOverride.presetRevision}:{})}:{})},
    actors,sourcePrompt:String(parameters[positiveKey ?? 'prompt'] ?? ''),seed}) : null;
  const loras=effective?.loras ?? mergeActivityLoras(readActivityLoraPolicy(database,plan.workflowId,plan.workflowVersion).entries,actors.flatMap(actor=>actor.visualLoras ?? []),[],{rejectActorConflicts:true});
  const graph=buildActivityImageWorkflowSnapshot(resolved,{...effective?.parameters,...parameters},seed,loras);
  const previous=activity.currentMediaRevisionId ? activities.getMediaRevision(activityId,activity.currentMediaRevisionId):null;
  const preview:StudioBatchPlan={target,name:slot.caption||slot.shotDescription||slot.id,actorIds:slot.actorIds,empty:!previous?.slotBindings.find(binding=>binding.slotId===slot.id)?.assets.length,
    sourceFingerprint:media.recipe.slotFingerprint,seed,canSubmit:true,issues:[],workflowId:plan.workflowId,workflowVersion:plan.workflowVersion,presetId:plan.presetId ?? null,presetRevision:plan.presetRevision ?? null,
    model:extractModelNames(graph).join(', ')||null,parameters,referenceArtifactIds:media.recipe.references.map(ref=>ref.artifactId),
    promptPolicyRevision:Number(plan.promptPolicySnapshot?.revision ?? 0),loraPolicyRevision:effective?.loraPolicy.revision ?? readActivityLoraPolicy(database,plan.workflowId,plan.workflowVersion).revision,
    loras:loras.map(({model,strength,triggerWord,enabled})=>({model,strength,triggerWord,enabled})),referenceSupported:Boolean(referenceInputKey(resolved)),referenceSelected:media.recipe.references.length>0};
  Object.assign(preview,{compiledPrompt:String(media.compilation.channels.prompt??''),negativePrompt:String(media.compilation.channels.negativePrompt??''),optimizerEnabled:plan.promptPolicySnapshot?.enabled===true,
    optimizerProfileId:plan.promptPolicySnapshot?.enabled===true?binding.profileId:null,optimizerModel:plan.promptPolicySnapshot?.enabled===true?binding.model:null});
  return {preview,configurationHash:configurationHash(plan.promptPolicySnapshot?.enabled===true),planHash:studioHash({executionPlanHash:media.compilation.executionPlanHash,graph,seed}),graph,engine:resolved.engine,
    optimizerEnabled:plan.promptPolicySnapshot?.enabled===true,beatRequest:null,media};
}

export function createStudioBatch(database:ServiceDatabase,config:ServiceConfig,activityId:string,request:StudioBatchRequest,
  options:{withinTransaction?:boolean;parent?:StudioJob;approved?:boolean;optimizerOverride?:StudioOptimizerOverride;presetOverride?:{presetId:string;presetRevision?:number}}={}):StudioJob{
  assertStudioBatchLimits(request);
  if(!options.withinTransaction)return database.transaction(()=>createStudioBatch(database,config,activityId,request,{...options,withinTransaction:true}));
  const store=new StudioStore(database),created=store.create({activityId,kind:'render_batch',idempotencyKey:request.idempotencyKey,
    request: options.optimizerOverride || options.presetOverride ? { ...request,optimizerOverride:options.optimizerOverride,presetOverride:options.presetOverride } : request,
    ...(options.parent?{parentJobId:options.parent.id}:{}),freeze:()=>{
      assertStudioVersions(database,activityId,request.versions);
      const plans:StudioPlannedItem[]=[];
      for(const target of request.input.targets)for(let index=0;index<request.input.candidateCount;index++){
        const submissionKey=`studio-${studioHash({activityId,key:request.idempotencyKey,target,index}).slice(0,40)}`,seed=Number.parseInt(studioHash(submissionKey).slice(0,8),16)%2147483647;
        const resolved=resolveStudioBatchTarget(database,config,activityId,target,seed,submissionKey,options.optimizerOverride,options.presetOverride);
        if(options.optimizerOverride&&!resolved.optimizerEnabled)throw studioError('studio_fallback_optimizer_disabled','所选目标未启用提示词优化，不能使用备用文本模型。',409);
        plans.push({id:randomUUID(),target,candidateIndex:index,seed:resolved.preview.seed,submissionKey,sourceFingerprint:resolved.preview.sourceFingerprint,
          planHash:resolved.planHash,configurationHash:resolved.configurationHash,emptyAtSubmit:resolved.preview.empty,preview:resolved.preview,
          ...(options.optimizerOverride?{optimizerOverride:options.optimizerOverride}:{}),
          ...(options.presetOverride?{presetOverride:options.presetOverride}:{})});
        if(options.presetOverride&&(resolved.preview.presetId!==options.presetOverride.presetId
          ||(options.presetOverride.presetRevision!=null&&resolved.preview.presetRevision!==options.presetOverride.presetRevision)))
          throw studioError('studio_fallback_preset_incompatible','所选图片预设与目标工作流或用途不兼容，未创建备用尝试。',409);
      }
      return {batch:true,request,plans,started:false,approved:Boolean(options.approved),referenceArtifactIds:[...new Set(plans.flatMap(item=>item.preview.referenceArtifactIds))],
          ...(options.optimizerOverride?{optimizerOverride:options.optimizerOverride}:{})} satisfies FrozenStudioBatch & {approved:boolean};
    }},{skipTransaction:options.withinTransaction});
  if(created.existing)return created.job;
  const frozen=created.job.input as unknown as FrozenStudioBatch,planHash=studioHash(frozen.plans);
  const insert=()=>{
    database.connection.prepare('UPDATE activity_studio_jobs SET plan_hash=?,trace_id=? WHERE id=?').run(planHash,options.parent?.traceId ?? created.job.traceId,created.job.id);
    for(const item of frozen.plans)database.connection.prepare(`INSERT INTO activity_studio_job_items
      (id,job_id,target_key,target_json,candidate_index,attempt_no,state,input_json,source_fingerprint,submission_key,placement_state,created_at,updated_at)
      VALUES (?,?,?,?,?,0,'waiting',?,?,?,?,?,?)`).run(item.id,created.job.id,studioHash(item.target),JSON.stringify(item.target),item.candidateIndex,JSON.stringify(item),item.sourceFingerprint,item.submissionKey,
        request.input.placement==='fill_empty'?(item.emptyAtSubmit?'pending':'ineligible'):'not_requested',nowIso(),nowIso());
  };
  if(options.withinTransaction)insert();else database.transaction(insert);
  return store.get(activityId,created.job.id)!;
}

export async function prepareStudioBatch(options:{database:ServiceDatabase;config:ServiceConfig;secrets:SecretStore;activityId:string;jobId:string;fetcher?:typeof fetch;signal?:AbortSignal}){
  const {database,activityId,jobId,config}=options,store=new StudioStore(database),owner=randomUUID();if(!store.claim(activityId,jobId,owner))return;
  let job=store.get(activityId,jobId)!;const frozen=job.input as unknown as FrozenStudioBatch;
  const timer=setInterval(()=>store.renew(activityId,jobId,owner),30000);timer.unref();
  try{
    job=store.transition(activityId,jobId,job.revision,'running');const plans:StudioBatchPlan[]=[];let modelRequestCount=0;
    for(const item of frozen.plans){
      if(options.signal?.aborted)throw studioError('studio_process_interrupted','服务停止，预览未完成；未发送图片任务。');
      if(store.get(activityId,jobId)!.stopRequested)return;
      const current=resolveStudioBatchTarget(database,config,activityId,item.target,item.seed,item.submissionKey,item.optimizerOverride,item.presetOverride);
      if(current.planHash!==item.planHash||current.configurationHash!==item.configurationHash)throw studioError('studio_plan_changed','预览准备期间来源或配置发生变化，请重新预览。',409);
      const inspection=await inspectWorkflowRuntime(current.engine,current.graph,options.secrets,options.fetcher ?? fetch,true);
      let optimizerMissing=false;
      if(current.optimizerEnabled){try{
        const profile=item.optimizerOverride?await resolveStudioTextProfile(database,options.secrets,item.optimizerOverride.profileId,item.optimizerOverride.profileHash):
          await resolveAssignedLlmProfile(database,options.secrets,'activities','text');
        optimizerMissing=!profile?.model;
        if(profile&&!item.optimizerOverride)await resolveStudioTextProfile(database,options.secrets,profile.id);
      }catch{optimizerMissing=true;}}
      const busy=isStudioTargetBusy(database,activityId,item.target,jobId),issues=[...current.preview.issues,...inspection.issues,
        ...(optimizerMissing?['提示词优化已启用，但活动文本模型未配置。']:[]),...(busy?['该目标已有未完成或结果未知的绘制，请稍后重新预览。']:[])];
      plans.push({...current.preview,canSubmit:current.preview.canSubmit&&inspection.ok&&!busy&&!optimizerMissing,issues});if(current.optimizerEnabled)modelRequestCount++;
    }
    const current=store.get(activityId,jobId)!;if(current.status!=='running'||current.stopRequested)return;
    const payload={plans,imageTaskCount:plans.length,modelRequestCount,placement:frozen.request.input.placement,planHash:job.planHash!,sourceFingerprint:studioHash(plans.map(plan=>plan.sourceFingerprint))};
    const review=store.transition(activityId,jobId,current.revision,'awaiting_review',{result:{...payload,resultHash:studioHash(payload)}});
    // Continuous apply explicitly authorized these exact new targets in the parent transaction.
    // Runtime failure keeps the preview visible and never silently sends a partial subset.
    if(frozen.approved&&plans.every(plan=>plan.canSubmit))startStudioBatch(database,config,activityId,jobId,{expectedJobRevision:review.revision,planHash:review.planHash!});
  }catch(error){const current=store.get(activityId,jobId)!,value=error as Error & {code?:string};if(['preparing','running'].includes(current.status))store.transition(activityId,jobId,current.revision,options.signal?.aborted?'interrupted':'failed',{errorCode:value.code ?? 'studio_batch_prepare_failed',errorMessage:String(redactAiValue(value.message))});}
  finally{clearInterval(timer);}
}

export function startStudioBatch(database:ServiceDatabase,config:ServiceConfig,activityId:string,jobId:string,request:StudioBatchStart){
  if(!Value.Check(StudioBatchStartSchema,request))throw studioError('studio_invalid_request','批次确认请求结构不合法。');
  return database.transaction(()=>{
    const store=new StudioStore(database),job=store.get(activityId,jobId);
    if(!job||job.kind!=='render_batch'||job.input.batch!==true)throw studioError('studio_job_not_found','批次不属于此活动。',404);
    if(job.readOnly)throw studioError('studio_job_read_only','导入的历史批次只读，不会执行。',409);
    if(job.planHash!==request.planHash)throw studioError('studio_plan_changed','预览计划已改变，请重新审阅。',409);
    const frozen=job.input as unknown as FrozenStudioBatch;if(frozen.started)return job;
    if(job.status!=='awaiting_review'||job.revision!==request.expectedJobRevision||!job.result||!('plans' in job.result)||job.stopRequested)
      throw studioError('studio_job_conflict','批次尚未完成预览或状态已改变。',409);
    if(job.result.plans.some(plan=>!plan.canSubmit))throw studioError('studio_workflow_incompatible','预览中仍有不可提交目标，请处理具体缺项后重新预览。',409);
    assertStudioVersions(database,activityId,frozen.request.versions);
    for(const item of frozen.plans){const current=resolveStudioBatchTarget(database,config,activityId,item.target,item.seed,item.submissionKey,item.optimizerOverride,item.presetOverride);
      if(current.planHash!==item.planHash||current.configurationHash!==item.configurationHash)throw studioError('studio_plan_changed','来源或配置改变，请重新预览。',409);
      if(isStudioTargetBusy(database,activityId,item.target,jobId))throw studioError('studio_target_busy','该目标已有未完成绘制，请稍后重新预览。',409);
    }
    if(database.connection.prepare("UPDATE activity_studio_jobs SET status='queued',revision=revision+1,input_json=?,updated_at=? WHERE id=? AND revision=? AND status='awaiting_review' AND stop_requested=0")
      .run(JSON.stringify({...frozen,started:true}),nowIso(),jobId,request.expectedJobRevision).changes!==1)throw studioError('studio_job_conflict','批次状态已改变，未重复启动。',409);
    return store.get(activityId,jobId)!;
  });
}

/** Explicit retries are new, reviewable attempts. Never rewind or overwrite an old item/task. */
export function retryStudioBatch(database:ServiceDatabase,config:ServiceConfig,activityId:string,jobId:string,request:StudioBatchRetry):StudioJob{
  if(!Value.Check(StudioBatchRetrySchema,request))throw studioError('studio_invalid_request','请选择明确失败的条目，最多24项。');
  return database.transaction(()=>{
    const store=new StudioStore(database),parent=store.get(activityId,jobId);
    if(!parent||parent.kind!=='render_batch')throw studioError('studio_job_not_found','批次不属于此活动。',404);
    if(parent.readOnly)throw studioError('studio_job_read_only','导入的历史批次只读，不重试。',409);
    const key=`retry:${studioHash({jobId,key:request.idempotencyKey})}`,hash=studioHash({jobId,...request});
    const existing=store.findIdempotent(activityId,key,hash);if(existing)return existing;
    if(parent.input.fallback||parent.input.optimizerOverride)throw studioError('studio_fallback_limit','备用尝试失败后保持暂停；请处理配置或明确新建任务，不能经重试入口绕过一次上限。',409);
    if(parent.revision!==request.expectedJobRevision||!['paused','partially_succeeded','failed','interrupted'].includes(parent.status))
      throw studioError('studio_job_conflict','批次状态已改变或仍在运行；停止和未知任务不能直接重试。',409);
    const rows=request.itemIds.map(id=>database.connection.prepare('SELECT * FROM activity_studio_job_items WHERE job_id=? AND id=?').get(jobId,id));
    for(const row of rows){
      if(!row)throw studioError('studio_item_not_found','重试条目不属于此批次。',404);
      const task=row.generation_task_id?getGenerationTask(database,String(row.generation_task_id),'activities'):null;
      if(row.state!=='failed'||row.generation_task_id&&(!task||task.upstreamMayContinue||!['failed','abandoned','cancelled'].includes(task.status)))
        throw studioError('studio_retry_unsafe','仅可重试明确失败、且上游不会继续的条目；已成功或结果未知的图片不会重投。',409);
    }
    const targets=rows.map(row=>JSON.parse(String(row!.target_json)) as StudioTarget);
    if(new Set(targets.map(target=>target.kind)).size!==1)throw studioError('studio_invalid_request','重试批次只能有一种目标。');
    const created=store.create({activityId,kind:'render_batch',parentJobId:jobId,idempotencyKey:key,request:{jobId,...request},freeze:()=>{
      const plans=rows.map((row,index)=>{
        const target=targets[index],attemptNo=Number(row!.attempt_no)+1,submissionKey=`studio-retry-${studioHash({key,itemId:row!.id,attemptNo}).slice(0,40)}`;
        const seed=Number.parseInt(studioHash(submissionKey).slice(0,8),16)%2147483647,resolved=resolveStudioBatchTarget(database,config,activityId,target,seed,submissionKey);
        return {id:randomUUID(),target,candidateIndex:Number(row!.candidate_index),seed:resolved.preview.seed,submissionKey,sourceFingerprint:resolved.preview.sourceFingerprint,
          planHash:resolved.planHash,configurationHash:resolved.configurationHash,emptyAtSubmit:resolved.preview.empty,preview:resolved.preview,attemptNo,retryOfItemId:String(row!.id)};
      });
      const original=parent.input as unknown as FrozenStudioBatch;
      return {batch:true,request:{kind:'render_batch',idempotencyKey:key,versions:readStudioContext(database,activityId),input:{targets:[...new Map(targets.map(target=>[studioHash(target),target])).values()],candidateCount:1,
        placement:original.request?.input.placement??'history_only'}},plans,started:false,referenceArtifactIds:[...new Set(plans.flatMap(item=>item.preview.referenceArtifactIds))]} as unknown as Record<string,unknown>;
    }},{skipTransaction:true});
    const frozen=created.job.input as unknown as FrozenStudioBatch & {plans:Array<StudioPlannedItem & {attemptNo:number;retryOfItemId:string}>};
    database.connection.prepare('UPDATE activity_studio_jobs SET trace_id=?,plan_hash=? WHERE id=?').run(parent.traceId,studioHash(frozen.plans),created.job.id);
    for(const item of frozen.plans)database.connection.prepare(`INSERT INTO activity_studio_job_items
      (id,job_id,target_key,target_json,candidate_index,attempt_no,retry_of_item_id,state,input_json,source_fingerprint,submission_key,placement_state,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'waiting',?,?,?,?,?,?)`).run(item.id,created.job.id,studioHash(item.target),JSON.stringify(item.target),item.candidateIndex,item.attemptNo,item.retryOfItemId,
        JSON.stringify(item),item.sourceFingerprint,item.submissionKey,frozen.request.input.placement==='fill_empty'?(item.emptyAtSubmit?'pending':'ineligible'):'not_requested',nowIso(),nowIso());
    return store.get(activityId,created.job.id)!;
  });
}

export function listStudioItems(database:ServiceDatabase,activityId:string,jobId:string,cursor?:string,limit=20):StudioItemPage{
  const job=new StudioStore(database).get(activityId,jobId);
  if(!job)throw studioError('studio_job_not_found','批次不属于此活动。',404);
  if(!Number.isInteger(limit)||limit<1||limit>20)throw studioError('studio_invalid_request','单页数量需为 1–20。');
  let after:{createdAt:string;id:string}|null=null;
  if(cursor){try{after=JSON.parse(Buffer.from(cursor,'base64url').toString());}catch{throw studioError('studio_invalid_cursor','分页游标不合法。');}if(!after||typeof after.createdAt!=='string'||typeof after.id!=='string')throw studioError('studio_invalid_cursor','分页游标不合法。');}
  // A batch is bounded to 24 attempts. Follow its frozen execution order, not random UUID order
  // when all items have the same creation timestamp. The cursor still points to an actual row.
  const order=Array.isArray(job.input.plans)?new Map((job.input.plans as StudioPlannedItem[]).map((plan,index)=>[plan.id,index])):new Map<string,number>();
  const all=database.connection.prepare('SELECT * FROM activity_studio_job_items WHERE job_id=? ORDER BY created_at,id').all(jobId)
    .sort((a,b)=>(order.get(String(a.id))??0)-(order.get(String(b.id))??0));
  const offset=after?all.findIndex(row=>row.id===after.id)+1:0;
  if(after&&offset===0)throw studioError('studio_invalid_cursor','分页游标不属于当前批次。');
  const rows=all.slice(offset,offset+limit+1);
  const items=rows.slice(0,limit).map(row=>{const input=JSON.parse(String(row.input_json)),result=row.result_json?JSON.parse(String(row.result_json)):{};
    return {id:String(row.id),jobId:String(row.job_id),target:JSON.parse(String(row.target_json)),candidateIndex:Number(row.candidate_index),attemptNo:Number(row.attempt_no),retryOfItemId:row.retry_of_item_id==null?null:String(row.retry_of_item_id),state:row.state,
      seed:Number(input.seed),sourceFingerprint:String(row.source_fingerprint),submissionKey:String(row.submission_key),nativeJobId:row.native_job_id==null?null:String(row.native_job_id),generationTaskId:row.generation_task_id==null?null:String(row.generation_task_id),candidateId:row.candidate_id==null?null:String(row.candidate_id),callId:row.call_id==null?null:String(row.call_id),
      artifactIds:result.artifactIds??[],unavailableArtifactIds:result.unavailableArtifactIds??[],selectedArtifactId:row.selected_artifact_id==null?null:String(row.selected_artifact_id),placementState:row.placement_state,placementReason:row.placement_reason==null?null:String(row.placement_reason),errorCode:row.error_code==null?null:String(row.error_code),errorMessage:row.error_message==null?null:String(row.error_message),createdAt:String(row.created_at),updatedAt:String(row.updated_at)} as StudioItemPage['items'][number];});
  const last=items.at(-1);return {items,nextCursor:rows.length>limit&&last?Buffer.from(JSON.stringify({createdAt:last.createdAt,id:last.id})).toString('base64url'):null};
}

/** Selection is a separately authorized operation. It patches the latest document inside a transaction, never an old full snapshot. */
export function placeStudioBatchImage(database:ServiceDatabase,config:ServiceConfig,activityId:string,jobId:string,itemId:string,artifactId:string){
  const row=database.connection.prepare('SELECT native_job_id FROM activity_studio_job_items WHERE job_id=? AND id=?').get(jobId,itemId);
  const target=database.connection.prepare('SELECT target_json FROM activity_studio_job_items WHERE job_id=? AND id=?').get(jobId,itemId);
  if(target&&JSON.parse(String(target.target_json)).kind==='media_slot'&&row?.native_job_id)syncAttemptOutputs(database,activityId,String(row.native_job_id));
  database.transaction(()=>{
    const item=database.connection.prepare('SELECT * FROM activity_studio_job_items WHERE job_id=? AND id=?').get(jobId,itemId);
    if(!item||item.placement_state!=='pending'||item.state!=='succeeded')return;
    const input=JSON.parse(String(item.input_json)) as StudioPlannedItem,activities=new ActivityStore(database),comics=new ComicStore(database);
    const outcome=(state:string,reason:string)=>database.connection.prepare('UPDATE activity_studio_job_items SET placement_state=?,placement_reason=?,updated_at=? WHERE id=? AND placement_state=\'pending\'').run(state,reason,nowIso(),itemId);
    const parent=new StudioStore(database).get(activityId,jobId);
    if(!parent||parent.stopRequested||parent.readOnly){outcome('ineligible','已停止或导入的任务结果仅入历史，不自动选图。');return;}
    if(!input.emptyAtSubmit){outcome('ineligible','提交时已有画面，图片只加入历史。');return;}
    if(!resolveArtifactStoragePath(database,artifactId,config.artifactDirectory)){outcome('artifact_unavailable','文件不可读取，未填入。');return;}
    let current:ReturnType<typeof resolveStudioBatchTarget>;
    try{current=resolveStudioBatchTarget(database,config,activityId,input.target,input.seed,input.submissionKey,input.optimizerOverride,input.presetOverride);}
    catch(error){const value=error as Error & {code?:string};outcome(value.code==='studio_target_locked'?'ineligible':value.code==='studio_version_conflict'?'conflict':'target_missing',value.message);return;}
    if(!current.preview.empty){outcome('ineligible','完成时已有画面，未覆盖人工选择或先前候选。');return;}
    if(current.preview.sourceFingerprint!==input.sourceFingerprint||current.configurationHash!==input.configurationHash){outcome('conflict','来源或配置发生变化，保留历史，未填入。');return;}
    if(input.target.kind==='beat')selectCandidateImage(database,activities,config.artifactDirectory,activityId,String(item.candidate_id),artifactId,false,true);
    else if(input.target.kind==='comic_panel'){
      const draft=comics.getComicDraft(activityId)!,panel=draft.document.panels.find(panel=>panel.id===(input.target as {panelId:string}).panelId)!;
      const content=activities.getContentRevision(activityId,draft.document.contentRevisionId)!.document;
      comics.selectComicPanelImage({activityId,panelId:panel.id,expectedDraftVersion:draft.draftVersion,artifactId,artifactDirectory:config.artifactDirectory,
        currentSourceFingerprint:compileComicPanelSource({content,panel}).sourceFingerprint,allowStaleSource:false,withinTransaction:true});
    }else{
      const activity=activities.getActivity(activityId)!,asset=database.connection.prepare('SELECT asset_key FROM activity_assets WHERE activity_id=? AND artifact_id=?').get(activityId,artifactId);
      if(!asset){outcome('artifact_unavailable','生成图片尚未登记为活动素材。');return;}
      selectMediaForSlots(database,activities,activityId,{expectedHeadVersion:activity.headVersion,contentRevisionId:activity.currentContentRevisionId!,
        slotBindings:[{slotId:input.target.slotId,slotFingerprint:input.sourceFingerprint,assets:[{assetKey:String(asset.asset_key),order:0}]}]},{withinTransaction:true});
    }
    database.connection.prepare("UPDATE activity_studio_job_items SET placement_state='applied',placement_reason='明确授权：仅填入空画面',selected_artifact_id=?,updated_at=? WHERE id=? AND placement_state='pending'").run(artifactId,nowIso(),itemId);
    if(item.call_id)updateAiCallRecord(database,String(item.call_id),{event:'studio_empty_image_selected',detail:{activityId,jobId,itemId,artifactId,target:input.target}});
  });
}

export async function processStudioBatch(options:{database:ServiceDatabase;config:ServiceConfig;secrets:SecretStore;activityId:string;jobId:string;fetcher?:typeof fetch;signal?:AbortSignal}){
  const {database,config,activityId,jobId}=options,store=new StudioStore(database),owner=randomUUID();
  if(!store.claim(activityId,jobId,owner))return;
  let job=store.get(activityId,jobId)!;const frozen=job.input as unknown as FrozenStudioBatch;
  if(!frozen.started){store.transition(activityId,jobId,job.revision,'failed',{errorCode:'studio_not_approved',errorMessage:'批次尚未确认，未发送图片任务。'});return;}
  const lease=setInterval(()=>store.renew(activityId,jobId,owner),30000);lease.unref();
  try{
    job=store.transition(activityId,jobId,job.revision,'running');
    for(const planned of frozen.plans){
      const selected=job.input.resumeItemIds as string[]|undefined;
      if(selected&&!selected.includes(planned.id))continue;
      const parent=store.get(activityId,jobId)!;
      if(options.signal?.aborted||parent.stopRequested||parent.status!=='running')break;
      const item=database.connection.prepare('SELECT * FROM activity_studio_job_items WHERE job_id=? AND id=?').get(jobId,planned.id)!;
      if(item.generation_task_id&&item.state==='submitted'){
        await processStudioSingleRender({...options,itemId:planned.id,keepParentRunning:true});
        if(store.get(activityId,jobId)!.status!=='running')break;
        continue;
      }
      if(item.state!=='waiting')continue;
      const check=()=>{
        const actual=resolveStudioBatchTarget(database,config,activityId,planned.target,planned.seed,planned.submissionKey,planned.optimizerOverride,planned.presetOverride);
        if(actual.planHash!==planned.planHash||actual.configurationHash!==planned.configurationHash||actual.preview.sourceFingerprint!==planned.sourceFingerprint)
          throw studioError('studio_plan_changed','目标来源或配置发生变化，后续绘制已暂停。',409);
        return actual;
      };
      try{
        database.transaction(()=>{
          const actual=check();
          if(isStudioTargetBusy(database,activityId,planned.target,jobId))throw studioError('studio_target_busy','目标已被其他绘制占用，未抢占。',409);
          let input:FrozenSingle & StudioPlannedItem;
          if(planned.target.kind==='beat'){
            const native=createStudioBeatCandidate(database,activityId,actual.beatRequest!,planned.optimizerOverride);
            input={...planned,nativeId:native.candidateId,beatRequest:actual.beatRequest};
          }else if(planned.target.kind==='comic_panel'){
            const native=createStudioComicRenderJob(database,activityId,planned.target.panelId,config.artifactDirectory,planned.seed,planned.submissionKey,job.traceId,
              planned.presetOverride?{presetId:planned.presetOverride.presetId,...(planned.presetOverride.presetRevision!=null?{presetRevision:planned.presetOverride.presetRevision}:{})}:undefined);
            input={...planned,nativeId:native.job.id,beatRequest:null};
          }else{
            const media=actual.media!;saveRecipeAndCompilation(database,media.recipe,media.compilation,true);
            input={...planned,nativeId:'pending-attempt',beatRequest:null,mediaParams:{recipeId:media.recipe.id,compilationId:media.compilation.id,executionPlanHash:media.compilation.executionPlanHash,seed:planned.seed,idempotencyKey:planned.submissionKey}};
          }
          if(database.connection.prepare("UPDATE activity_studio_job_items SET input_json=?,candidate_id=?,native_job_id=?,updated_at=? WHERE id=? AND job_id=? AND state='waiting' AND generation_task_id IS NULL")
            .run(JSON.stringify(input),planned.target.kind==='beat'?input.nativeId:null,planned.target.kind==='comic_panel'?input.nativeId:null,nowIso(),planned.id,jobId).changes!==1)
            throw studioError('studio_job_conflict','条目状态已改变，未重复提交。',409);
        });
        await processStudioSingleRender({...options,itemId:planned.id,keepParentRunning:true,beforeSubmission:()=>{check();},afterImages:ids=>{
          try{placeStudioBatchImage(database,config,activityId,jobId,planned.id,ids[0]);}
          catch(error){database.connection.prepare("UPDATE activity_studio_job_items SET placement_state='conflict',placement_reason=?,updated_at=? WHERE id=? AND placement_state='pending'").run(String(redactAiValue((error as Error).message)),nowIso(),planned.id);}
        }});
        const processed=database.connection.prepare('SELECT state,error_code,error_message FROM activity_studio_job_items WHERE id=?').get(planned.id);
        if(processed&&['studio_plan_changed','studio_target_busy','studio_source_changed','studio_target_locked'].includes(String(processed.error_code)))
          throw studioError(String(processed.error_code),String(processed.error_message),409);
        if((planned.optimizerOverride||planned.presetOverride)&&processed?.state==='failed')
          throw studioError('studio_fallback_failed',String(processed.error_message??'备用绘制失败，后续提交已暂停。'),409);
      }catch(error){
        const value=error as Error & {code?:string};
        if(value.code==='studio_target_locked'||(value.code==='studio_source_changed'&&!studioTargetExists(database,activityId,planned.target))){
          database.connection.prepare("UPDATE activity_studio_job_items SET state='skipped',error_code=?,error_message=?,placement_state=CASE WHEN placement_state='pending' THEN ? ELSE placement_state END,updated_at=? WHERE id=? AND state IN ('waiting','failed') AND generation_task_id IS NULL")
            .run(value.code!,value.message,value.code==='studio_target_locked'?'ineligible':'target_missing',nowIso(),planned.id);
          database.connection.prepare('UPDATE activity_studio_jobs SET revision=revision+1,updated_at=? WHERE id=?').run(nowIso(),jobId);continue;
        }
        const current=store.get(activityId,jobId)!;
        store.transition(activityId,jobId,current.revision,'paused',{errorCode:value.code ?? 'studio_batch_paused',errorMessage:String(redactAiValue(value.message))});break;
      }
    }
    const current=store.get(activityId,jobId)!;
    if(current.status!=='running')return;
    if(options.signal?.aborted){store.transition(activityId,jobId,current.revision,'interrupted',{errorCode:'studio_process_interrupted',errorMessage:'服务已停止，未继续提交后续条目。'});return;}
    const rows=database.connection.prepare('SELECT state,result_json FROM activity_studio_job_items WHERE job_id=?').all(jobId);
    const succeeded=rows.filter(row=>row.state==='succeeded').length,failed=rows.filter(row=>row.state==='failed'||row.state==='skipped'||row.state==='interrupted').length;
    const renderedImages=rows.flatMap(row=>{if(!row.result_json)return [];const result=JSON.parse(String(row.result_json));return (result.artifactIds??[]).filter((id:string)=>!result.unavailableArtifactIds?.includes(id));}),payload={renderedImages,succeeded,failed,sourceFingerprint:studioHash(frozen.plans.map(plan=>plan.sourceFingerprint))};
    const status=rows.some(row=>row.state==='unknown')?'unknown':rows.some(row=>row.state==='waiting'||row.state==='preparing')?'paused':succeeded>0?(failed?'partially_succeeded':'succeeded'):'failed';
    store.transition(activityId,jobId,current.revision,status,{result:{...payload,resultHash:studioHash(payload)}});
  }catch(error){
    const current=store.get(activityId,jobId),value=error as Error & {code?:string};
    if(current&&['preparing','running'].includes(current.status))store.transition(activityId,jobId,current.revision,options.signal?.aborted?'interrupted':'paused',
      {errorCode:value.code ?? 'studio_batch_paused',errorMessage:String(redactAiValue(value.message))});
  }finally{clearInterval(lease);}
}
