import {randomUUID} from 'node:crypto';
import {Value} from '@sinclair/typebox/value';
import {StudioImageFallbackSelectionSchema,StudioImageFallbackRequestSchema,type StudioImageFallbackOptions,
  type StudioImageFallbackPreview,type StudioImageFallbackRequest,type StudioImageFallbackSelection,type StudioJob,type StudioTarget} from '@sthstart/contracts';
import type {ServiceDatabase} from '../database.js';
import {nowIso} from '../database.js';
import type {ServiceConfig} from '../config.js';
import {getGenerationTask} from '../generation/task-store.js';
import {getPreset} from '../generation/configuration-store.js';
import {StudioStore,studioError,studioHash} from './studio-store.js';
import {resolveStudioBatchTarget,type FrozenStudioBatch,type StudioPlannedItem} from './studio-batches.js';

/** Image fallback is a new, reviewable batch over the failed items of one
 * existing batch, with only the frozen image preset replaced. It never mutates
 * the original task, activity defaults, drafts or dashboards. */
type FrozenImageFallback={kind:'image_preset';fallbackOf:string;rootJobId:string;presetId:string;presetRevision:number;
  workflowId:string;workflowVersion:number;itemIds:string[];reason:string;scope:string;maxAttempts:1};

function rootOf(database:ServiceDatabase,parent:StudioJob){
  const store=new StudioStore(database),seen=new Set<string>();let root=parent;
  while(root.parentJobId){if(seen.has(root.id))throw studioError('studio_fallback_unsafe','任务来源关系不完整，未执行备用绘制。',409);
    seen.add(root.id);const next=store.get(parent.activityId,root.parentJobId);if(!next)throw studioError('studio_fallback_unsafe','原任务关系缺失，请先核对记录。',409);root=next;}
  return root.id;
}

/** Only items whose upstream result is a known failure may be re-drawn. An
 * unknown submission is not proof of failure and must be reconciled instead. */
function eligibleItems(database:ServiceDatabase,activityId:string,jobId:string){
  const rows=database.connection.prepare('SELECT * FROM activity_studio_job_items WHERE job_id=? ORDER BY created_at,id').all(jobId);
  const failed=rows.filter(row=>String(row.state)==='failed');
  const unknown=rows.filter(row=>String(row.state)==='unknown');
  if(unknown.length)throw studioError('studio_fallback_unknown','批次含结果未知的条目。请先核对原任务，不能直接备用重绘。',409);
  for(const row of failed){
    const task=row.generation_task_id?getGenerationTask(database,String(row.generation_task_id),'activities'):null;
    if(task&&(task.upstreamMayContinue||['queued','preparing','submitting','accepted','running'].includes(task.status))
      ||row.generation_task_id&&(!task||!['failed','abandoned','cancelled'].includes(task?.status??'')))
      throw studioError('studio_fallback_unknown','失败条目仍有未确认或仍在上游执行的图片任务，不能直接备用重绘。',409);
  }
  return failed;
}

function eligible(database:ServiceDatabase,job:StudioJob){
  if(job.readOnly)throw studioError('studio_job_read_only','导入历史只读，不能执行备用绘制。',409);
  if(job.kind!=='render_batch'||job.input.batch!==true)throw studioError('studio_fallback_scope_unsupported','图片备用只适用于批量绘制任务。',409);
  if(job.stopRequested||!['paused','failed','partially_succeeded','interrupted'].includes(job.status))
    throw studioError('studio_fallback_unsafe','任务仍在运行、已停止或没有明确失败；不能执行备用绘制。',409);
  const rootJobId=rootOf(database,job);
  const used=database.connection.prepare("SELECT id FROM activity_studio_jobs WHERE activity_id=? AND json_extract(input_json,'$.fallback.rootJobId')=? LIMIT 1").get(job.activityId,rootJobId);
  if(used)throw studioError('studio_fallback_limit','该任务链已经使用过一次备用方案。再次失败后保持暂停，请处理配置或明确新建任务。',409);
  const failed=eligibleItems(database,job.activityId,job.id);
  if(!failed.length)throw studioError('studio_fallback_scope_unsupported','批次没有可重绘的明确失败条目。',409);
  return {rootJobId,itemIds:failed.map(row=>String(row.id))};
}

function presetSnapshot(database:ServiceDatabase,selection:StudioImageFallbackSelection){
  const preset=getPreset(database,selection.presetId);
  if(!preset)throw studioError('preset_not_found','未找到指定的图片预设。',409);
  if(!preset.enabled)throw studioError('studio_fallback_preset_disabled','所选图片预设已禁用。',409);
  if(selection.presetRevision!=null&&selection.presetRevision!==preset.revision)
    throw studioError('studio_fallback_preset_changed','所选图片预设已更新，请重新预览。',409);
  const model=typeof preset.values?.model==='string'?String(preset.values.model):null;
  return {presetId:preset.id,presetRevision:preset.revision,presetName:preset.name,workflowId:preset.workflowId,workflowVersion:preset.workflowVersion,model};
}

export function listStudioImageFallbackOptions(database:ServiceDatabase,activityId:string,jobId:string):StudioImageFallbackOptions{
  const job=new StudioStore(database).get(activityId,jobId);
  try{eligible(database,job!);}catch(error){return {allowed:false,reason:(error as Error).message,originalPresetId:null,originalModel:null,presets:[]};}
  const frozen=job!.input as unknown as FrozenStudioBatch;
  const originalPresetId=frozen.plans[0]?.preview.presetId??null;
  const original=frozen.plans[0]?.preview.model??null;
  const seen=new Map<string,{id:string;name:string;revision:number;model:string|null}>();
  for(const plan of frozen.plans){
    const preset=plan.preview.presetId?getPreset(database,plan.preview.presetId):null;
    if(!preset?.enabled)continue;
    seen.set(preset.id,{id:preset.id,name:preset.name,revision:preset.revision,
      model:typeof preset.values?.model==='string'?String(preset.values.model):null});
  }
  // Any enabled activity preset for the same purpose is a candidate; exact
  // workflow/input compatibility is re-checked during preview.
  for(const preset of listActivityPresets(database))seen.set(preset.id,preset);
  return {allowed:seen.size>0,reason:seen.size?'原批次已明确暂停；选择图片预设只影响这一次新尝试，不改活动默认配置。':'没有启用且可用的图片预设，请先在生成配置中创建。',
    originalPresetId,originalModel:original,presets:[...seen.values()].sort((a,b)=>a.name.localeCompare(b.name))};
}

function listActivityPresets(database:ServiceDatabase){
  const rows=database.connection.prepare("SELECT id,name,revision,values_json FROM generation_presets WHERE app_id='activities' AND enabled=1").all() as Array<{id:string;name:string;revision:number;values_json:string}>;
  return rows.map(row=>{let values:Record<string,unknown>={};try{values=JSON.parse(row.values_json) as Record<string,unknown>;}catch{/* A malformed preset is not a selectable candidate. */}
    return {id:String(row.id),name:String(row.name),revision:Number(row.revision),model:typeof values.model==='string'?String(values.model):null};});
}

/** Pure. Re-resolves every failed item with the selected preset and requires a
 * matching workflow/input; nothing is created and no model request is made. */
export function previewStudioImageFallback(database:ServiceDatabase,config:ServiceConfig,activityId:string,jobId:string,
  selection:StudioImageFallbackSelection):StudioImageFallbackPreview{
  if(!Value.Check(StudioImageFallbackSelectionSchema,selection))throw studioError('studio_invalid_request','图片备用预览只接受已有图片预设 ID。');
  const job=new StudioStore(database).get(activityId,jobId);if(!job)throw studioError('studio_job_not_found','任务不属于此活动。',404);
  const {rootJobId,itemIds}=eligible(database,job);
  const preset=presetSnapshot(database,selection),frozen=job.input as unknown as FrozenStudioBatch;
  const rows=itemIds.map(id=>database.connection.prepare('SELECT * FROM activity_studio_job_items WHERE job_id=? AND id=?').get(jobId,id)!);
  let model:string|null=preset.model;
  for(const row of rows){
    const planned=frozen.plans.find(plan=>plan.id===String(row.id))??JSON.parse(String(row.input_json)) as StudioPlannedItem;
    const resolved=resolveStudioBatchTarget(database,config,activityId,planned.target,planned.seed,planned.submissionKey,planned.optimizerOverride,
      {presetId:selection.presetId,presetRevision:selection.presetRevision});
    if(resolved.preview.presetId!==selection.presetId||(selection.presetRevision!=null&&resolved.preview.presetRevision!==selection.presetRevision))
      throw studioError('studio_fallback_preset_incompatible','所选图片预设与目标工作流或用途不兼容，未创建备用尝试。',409);
    model=resolved.preview.model;
  }
  const original=frozen.plans[0]?.preview??null;
  const preview={fallbackOf:job.id,rootJobId,expectedJobRevision:job.revision,presetId:preset.presetId,presetRevision:preset.presetRevision,
    presetName:preset.presetName,model,originalPresetId:original?.presetId??null,originalPresetRevision:original?.presetRevision??null,
    originalModel:original?.model??null,workflowId:preset.workflowId,workflowVersion:preset.workflowVersion,itemIds,
    imageTaskCount:itemIds.length as number,modelRequestCount:rows.filter(row=>{const planned=frozen.plans.find(p=>p.id===String(row.id));return Boolean(planned?.optimizerOverride);}).length,
    reason:(job.errorMessage??'原批次未完成'),scope:`原批次 ${itemIds.length} 个明确失败条目，仅替换图片预设为新尝试`,
    maxAttempts:1 as const};
  const planHash=studioHash({fallbackOf:preview.fallbackOf,rootJobId,presetId:preset.presetId,presetRevision:preset.presetRevision,itemIds,snapshot:preset});
  return {...preview,planHash};
}

/** Creates the child batch inside one transaction. No model or image request is
 * made here; execution reuses the existing frozen batch pipeline. */
export function createStudioImageFallback(database:ServiceDatabase,config:ServiceConfig,activityId:string,jobId:string,
  request:StudioImageFallbackRequest):StudioJob{
  if(!Value.Check(StudioImageFallbackRequestSchema,request))throw studioError('studio_invalid_request','图片备用确认需要已有预设、原任务修订和已审阅计划。');
  const store=new StudioStore(database),key=`image-fallback:${studioHash({jobId,key:request.idempotencyKey})}`,hash=studioHash({jobId,...request});
  const parent=store.get(activityId,jobId);if(!parent)throw studioError('studio_job_not_found','任务不属于此活动。',404);
  const existing=store.findIdempotent(activityId,key,hash);if(existing)return existing;
  return database.transaction(()=>{
    const same=store.findIdempotent(activityId,key,hash);if(same)return same;
    const current=store.get(activityId,jobId);if(!current)throw studioError('studio_job_not_found','任务不属于此活动。',404);
    const preview=previewStudioImageFallback(database,config,activityId,jobId,{presetId:request.presetId,presetRevision:request.presetRevision});
    if(preview.expectedJobRevision!==request.expectedJobRevision||preview.planHash!==request.planHash)
      throw studioError('studio_plan_changed','原任务或图片预设已变化，请重新预览并确认；未创建备用尝试。',409);
    const frozen=current.input as unknown as FrozenStudioBatch;
    const preset={presetId:preview.presetId,presetRevision:preview.presetRevision};
    const plans:StudioPlannedItem[]=preview.itemIds.map(id=>{
      const row=database.connection.prepare('SELECT * FROM activity_studio_job_items WHERE job_id=? AND id=?').get(jobId,id)!;
      const planned=frozen.plans.find(plan=>plan.id===String(row.id))??JSON.parse(String(row.input_json)) as StudioPlannedItem;
      const attemptNo=Number(row.attempt_no)+1;
      const submissionKey=`studio-image-fallback-${studioHash({key,itemId:row.id,attemptNo}).slice(0,32)}`;
      const seed=Number.parseInt(studioHash(submissionKey).slice(0,8),16)%2147483647;
      const resolved=resolveStudioBatchTarget(database,config,activityId,planned.target,seed,submissionKey,planned.optimizerOverride,preset);
      return {id:randomUUID(),target:planned.target,candidateIndex:Number(row.candidate_index),seed:resolved.preview.seed,submissionKey,
        sourceFingerprint:resolved.preview.sourceFingerprint,planHash:resolved.planHash,configurationHash:resolved.configurationHash,
        emptyAtSubmit:resolved.preview.empty,preview:resolved.preview,attemptNo,retryOfItemId:String(row.id),
        ...(planned.optimizerOverride?{optimizerOverride:planned.optimizerOverride}:{}),presetOverride:preset} as (StudioPlannedItem & {attemptNo:number;retryOfItemId:string});
    });
    const fallback:FrozenImageFallback={kind:'image_preset',fallbackOf:jobId,rootJobId:preview.rootJobId,presetId:preview.presetId,presetRevision:preview.presetRevision,
      workflowId:preview.workflowId,workflowVersion:preview.workflowVersion,itemIds:preview.itemIds,reason:preview.reason,scope:preview.scope,maxAttempts:1};
    const created=store.create({activityId,kind:'render_batch',parentJobId:jobId,idempotencyKey:key,request:{jobId,...request},planHash:studioHash(plans),
      freeze:()=>({batch:true,request:{kind:'render_batch',idempotencyKey:key,versions:frozen.request.versions,
        input:{targets:[...new Map(plans.map(plan=>[studioHash(plan.target),plan.target])).values()],candidateCount:1,placement:frozen.request.input.placement}},
        plans,started:true,approved:true,referenceArtifactIds:[...new Set(plans.flatMap(plan=>plan.preview.referenceArtifactIds))],fallback})},{skipTransaction:true});
    database.connection.prepare('UPDATE activity_studio_jobs SET trace_id=?,plan_hash=? WHERE id=?').run(parent.traceId,studioHash(plans),created.job.id);
    for(const plan of plans as Array<StudioPlannedItem & {attemptNo:number;retryOfItemId:string}>)database.connection.prepare(`INSERT INTO activity_studio_job_items
      (id,job_id,target_key,target_json,candidate_index,attempt_no,retry_of_item_id,state,input_json,source_fingerprint,submission_key,placement_state,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'waiting',?,?,?,?,?,?)`).run(plan.id,created.job.id,studioHash(plan.target),JSON.stringify(plan.target),plan.candidateIndex,
        plan.attemptNo,plan.retryOfItemId,JSON.stringify(plan),plan.sourceFingerprint,plan.submissionKey,frozen.request.input.placement==='fill_empty'?(plan.emptyAtSubmit?'pending':'ineligible'):'not_requested',nowIso(),nowIso());
    return store.get(activityId,created.job.id)!;
  });
}
