import {Value} from '@sinclair/typebox/value';
import {StudioJobResumeSchema,type StudioJobResume,type StudioJob} from '@sthstart/contracts';
import type {ServiceDatabase} from '../database.js';
import {nowIso} from '../database.js';
import type {ServiceConfig} from '../config.js';
import type {SecretStore} from '../security.js';
import {getGenerationTask} from '../generation/task-store.js';
import {pollAndCompleteTask} from '../generation/execution.js';
import {StudioStore,studioError,studioHash} from './studio-store.js';
import {collectStudioRenderResult} from './studio-render-results.js';
import {resolveStudioBatchTarget,type FrozenStudioBatch} from './studio-batches.js';
import {ComicStore} from './comic-store.js';
import {promptOptimizationCallUncertain} from './image-prompt-optimizer.js';

const activeStates=['queued','preparing','running'];
const resumableStates=['paused','interrupted','partially_succeeded','failed'];
const heldCode='studio_resume_required';

function interruptUnlinkedItem(database:ServiceDatabase,activityId:string,row:Record<string,unknown>){
  const unknown=Boolean(row.call_id&&promptOptimizationCallUncertain(database,String(row.call_id)));
  // There may have been an optimizer request. Do not turn preparing into waiting.
  if(row.candidate_id)database.connection.prepare("UPDATE activity_beat_render_candidates SET status='failed',error_message='服务中断，未关联图片任务；不会自动重试。' WHERE id=? AND activity_id=? AND task_id IS NULL AND status IN ('preparing','queued','running')")
    .run(String(row.candidate_id),activityId);
  else if(row.native_job_id){const store=new ComicStore(database),native=store.getComicJob(activityId,String(row.native_job_id));
    if(native&&!native.generationTaskId)store.updateComicJob(native.id,{status:'interrupted',errorCode:'studio_process_interrupted',errorMessage:'服务中断，未关联图片任务；不会自动重试。'});
  }
  database.connection.prepare("UPDATE activity_studio_job_items SET state=?,error_code=?,error_message=?,updated_at=? WHERE id=? AND generation_task_id IS NULL AND state='preparing'")
    .run(unknown?'unknown':'interrupted',unknown?'studio_optimizer_unknown':'studio_process_interrupted',
      unknown?'优化请求已关联但结果不确定；仅核对原记录，不自动重投。':'准备阶段中断，不自动再次调用优化模型。',nowIso(),String(row.id));
}

/** No outbound request. On startup protect queued generation snapshots BEFORE the unified scheduler starts.
 * A live lease owned by another instance is never stolen. Expiry is not permission to replay a request. */
export function recoverStudioJobs(database:ServiceDatabase,config:ServiceConfig,options:{startup?:boolean;activeJobIds?:ReadonlySet<string>;jobId?:string}={}){
  const now=nowIso(),store=new StudioStore(database);
  // Routine scans avoid re-reading immutable successful histories. An explicit query
  // revalidates that one job's files, including its previously successful items.
  const rows=options.jobId
    ?database.connection.prepare('SELECT * FROM activity_studio_jobs WHERE id=?').all(options.jobId)
    :database.connection.prepare(`SELECT * FROM activity_studio_jobs j WHERE
      status IN ('queued','preparing','running','paused','interrupted','unknown','partially_succeeded','failed')
      OR EXISTS(SELECT 1 FROM activity_studio_job_items i WHERE i.job_id=j.id
        AND i.generation_task_id IS NOT NULL AND i.state IN ('submitted','unknown','interrupted'))`).all();
  let changed=0;
  for(const row of rows){
    const activityId=String(row.activity_id),jobId=String(row.id),job=store.get(activityId,jobId)!;
    if(job.readOnly||options.activeJobIds?.has(jobId))continue;
    const alive=Boolean(row.lease_owner&&row.lease_expires_at&&String(row.lease_expires_at)>now);
    if(alive)continue;
    const expired=activeStates.includes(job.status)&&((job.status!=='queued')||Boolean(options.startup));
    const items=database.connection.prepare('SELECT * FROM activity_studio_job_items WHERE job_id=?').all(jobId);
    // 计划 §7.2 第 2 行：关联生成任务仍是 queued、provider_task_id 为空、upstream_may_continue=0 时，
    // 必须给它加上 studio_resume_required 暂停标记，等待用户明确恢复。
    //
    // 这一段必须排在下面的 operation 分派**之前**。细化（hires）走的是那个分支，
    // 而它原先在写完 job 状态后直接 `continue`，于是细化任务**永远拿不到暂停标记**：
    // 用户无法区分「等待确认」与「可继续提交」。（计划 §7.1 要求移除这种「跳入分支并 continue」的写法。）
    if(expired||options.startup)for(const item of items){
      if(item.generation_task_id){
        // queued proves no upstream submission: retain this exact task/seed/graph, only release on explicit resume.
        if(job.stopRequested)database.connection.prepare("UPDATE generation_tasks SET status='cancelled',upstream_may_continue=0,error_code='studio_stopped_before_submission',error_message='任务已停止，未提交上游。',updated_at=? WHERE id=? AND status='queued' AND provider_task_id IS NULL")
          .run(now,String(item.generation_task_id));
        else database.connection.prepare("UPDATE generation_tasks SET error_code=?,error_message='工作室恢复等待确认，未继续提交。',updated_at=? WHERE id=? AND status='queued' AND provider_task_id IS NULL")
          .run(heldCode,now,String(item.generation_task_id));
      }else if(item.state==='preparing')interruptUnlinkedItem(database,activityId,item);
    }
    // 细化是 render_batch，但不是批次：必须先按 operation 分派，否则会误用批次计划重算普通文生图。
    if(job.kind!=='render_batch'||job.input.operation==='hires'){
      if(!expired)continue;
      // 计划 §7.1：这里原先写 `job.status==='queued' && !job.callId`，同样是把 callId 当成
      // “请求已发给模型”的证据。callId 在统一生成任务落库时就可能存在，于是「已排队但尚未提交
      // 上游」的细化任务会被永久标成不可恢复。真正的安全判据在 resumeStudioJob() 里按
      // 关联生成任务的 providerTaskId／status／upstreamMayContinue 逐条核对，这里不再越权判定。
      const input={...job.input,recovery:{canResumeBeforeNetwork:job.status==='queued',recoveredAt:now}};
      database.connection.prepare("UPDATE activity_studio_jobs SET status='interrupted',revision=revision+1,input_json=?,lease_owner=NULL,lease_expires_at=NULL,error_code='studio_process_interrupted',error_message=?,updated_at=? WHERE id=? AND revision=?")
        .run(JSON.stringify(input),job.status==='queued'?'上次排队任务尚未开始，等待明确恢复。':'上次模型任务已中断。结果不确定，不能恢复重投；请查看日志后明确新建。',now,jobId,job.revision);changed++;continue;
    }
    // Late results also enter history for cancelled jobs. Reconciliation NEVER auto-selects.
    for(const item of items)if(item.generation_task_id&&(options.jobId||['submitted','unknown','interrupted','failed'].includes(String(item.state))))collectStudioRenderResult(database,config,activityId,jobId,String(item.id));
    const current=store.get(activityId,jobId)!;
    if(current.status==='cancelled'||current.status==='awaiting_review'||current.status==='succeeded'&&!expired&&!options.jobId)continue;
    const latest=database.connection.prepare('SELECT state,result_json,generation_task_id FROM activity_studio_job_items WHERE job_id=?').all(jobId);
    const hasUnknown=latest.some(item=>item.state==='unknown');
    const pending=latest.some(item=>['waiting','submitted','preparing'].includes(String(item.state)));
    const succeeded=latest.filter(item=>item.state==='succeeded').length,failed=latest.filter(item=>['failed','interrupted','skipped'].includes(String(item.state))).length;
    const preservePause=current.status==='paused'&&!expired&&!hasUnknown&&(pending||current.input.fallback!=null||current.input.optimizerOverride!=null);
    const status=preservePause?'paused':hasUnknown?'unknown':pending?'interrupted':succeeded?(failed?'partially_succeeded':'succeeded'):'failed';
    // A newly queued job is scheduled by its request handler, never by a periodic recovery scan.
    if(!expired&&!options.jobId&&!['unknown','interrupted','paused','partially_succeeded','failed'].includes(current.status))continue;
    const renderedImages=latest.flatMap(item=>{if(!item.result_json)return [];const result=JSON.parse(String(item.result_json));return (result.artifactIds??[]).filter((id:string)=>!result.unavailableArtifactIds?.includes(id));});
    // 细化任务没有批次计划：来源指纹取冻结的原图指纹，不用计划数组冒充。
    const payload={renderedImages,succeeded,failed,sourceFingerprint:studioHash(job.input.plans??job.input.sourceFingerprint??'' )};
    const input=expired?{...current.input,recovery:{canResumeBeforeNetwork:job.status==='queued',recoveredAt:now}}:current.input;
    const result=pending&&current.result?current.result:{...payload,resultHash:studioHash(payload)};
    const errorCode=preservePause?current.errorCode:status==='unknown'?'studio_upstream_unknown':pending?'studio_resume_required':null;
    const errorMessage=preservePause?current.errorMessage:status==='unknown'?'上游结果未确认；仅可核对原任务，不能重复提交。':pending?'已恢复历史进度，未自动提交剩余项。请先核对原任务，再明确恢复。':null;
    if(expired||current.status!==status||current.errorCode!==errorCode||studioHash(current.result)!==studioHash(result)){
      database.connection.prepare('UPDATE activity_studio_jobs SET status=?,input_json=?,result_json=?,revision=revision+1,lease_owner=NULL,lease_expires_at=NULL,error_code=?,error_message=?,updated_at=? WHERE id=? AND revision=?')
        .run(status,JSON.stringify(input),JSON.stringify(result),errorCode,errorMessage,now,jobId,current.revision);changed++;
    }
  }
  return {changed};
}

/** User confirmation only releases never-submitted waiting/held-queued work. It cannot replay models or successful items. */
export function resumeStudioJob(database:ServiceDatabase,config:ServiceConfig,activityId:string,jobId:string,request:StudioJobResume):StudioJob{
  if(!Value.Check(StudioJobResumeSchema,request))throw studioError('studio_invalid_request','恢复请求结构不合法。');
  return database.transaction(()=>{
    const store=new StudioStore(database),job=store.get(activityId,jobId);
    if(!job)throw studioError('studio_job_not_found','任务不属于此活动。',404);
    if(job.readOnly)throw studioError('studio_job_read_only','导入的历史任务只读，不会执行。',409);
    if(job.input.resumeFromRevision===request.expectedJobRevision){
      if(job.input.resumeRequestHash!==studioHash(request))throw studioError('idempotency_conflict','同一次恢复确认对应了不同条目，未执行。',409);
      return job;
    }
    if(job.revision!==request.expectedJobRevision||!resumableStates.includes(job.status)||job.stopRequested)
      throw studioError('studio_resume_unsafe','状态已改变，或任务已停止/仍未知；未恢复提交。',409);
    const recovery=job.input.recovery as {canResumeBeforeNetwork?:boolean}|undefined;
    // 细化必须先按 operation 分派：它没有批次计划，不能调用 resolveStudioBatchTarget 重算普通文生图计划。
    if(job.input.operation==='hires'){
      // 计划 §7.1：**不能再用 `job.callId` 判断“已经发给模型”**。
      // 统一生成任务落库时就可能已经带上 callId，用它拒绝会把「已排队但尚未提交上游」的
      // 细化任务误判成“请求已发生”。安全判据改为**关联生成任务的事实**：
      // providerTaskId 是否已写入、status 是否越过 queued、upstreamMayContinue。
      if(!recovery?.canResumeBeforeNetwork)throw studioError('studio_resume_unsafe','模型请求可能已经发生，请明确新建细化，不重放本任务。',409);
      if(job.planHash&&request.planHash!==job.planHash)throw studioError('studio_plan_changed','请确认原细化计划后再恢复。',409);
      const rows=database.connection.prepare('SELECT * FROM activity_studio_job_items WHERE job_id=?').all(jobId);
      if(!request.itemIds?.length)throw studioError('studio_invalid_request','请明确选择要恢复的待提交项。');
      if(request.itemIds.some(id=>!rows.some(row=>row.id===id)))throw studioError('studio_item_not_found','恢复条目不属于此细化任务。',404);
      let safe=0;
      for(const row of rows){
        const task=row.generation_task_id?getGenerationTask(database,String(row.generation_task_id),'activities'):null;
        // providerTaskId 一旦写入，就说明请求确实到达了上游；此时绝不重放（计划 §7.2 第 3 行）。
        const alreadySent=Boolean(task&&(task.providerTaskId||['submitting','accepted','running'].includes(task.status)));
        if(row.state==='unknown'||row.generation_task_id&&(!task||task.upstreamMayContinue||alreadySent))
          throw studioError('studio_resume_unsafe','原图片任务仍在运行或结果未知，请先核对；不会重复提交。',409);
        const held=task?.status==='queued'&&task.errorCode===heldCode;
        if(!request.itemIds.includes(String(row.id)))continue;
        if(row.state!=='waiting'&&!held)continue;
        if(held){
          // 计划 §7.3：带条件的 UPDATE 必须确认真的改到了那一行。
          // 若在检查与变更之间任务状态已改变，就拒绝恢复，不无条件把它改回可提交。
          const released=database.connection.prepare("UPDATE generation_tasks SET error_code=NULL,error_message=NULL,updated_at=? WHERE id=? AND status='queued' AND provider_task_id IS NULL AND error_code=?")
            .run(nowIso(),task.id,heldCode);
          if(released.changes!==1)throw studioError('studio_resume_unsafe','关联任务状态在确认期间已改变，未恢复。',409);
        }
        safe++;
      }
      if(safe!==request.itemIds.length)
        throw studioError('studio_resume_no_waiting','没有安全的待提交项。失败项请明确新建细化，成功图片不会重新绘制。',409);
    }else if(job.kind!=='render_batch'){
      if(!recovery?.canResumeBeforeNetwork||job.callId)throw studioError('studio_resume_unsafe','模型请求可能已经发生，请明确新建任务，不重放本任务。',409);
    }else{
      if(job.planHash&&request.planHash!==job.planHash)throw studioError('studio_plan_changed','请确认原计划后再恢复。',409);
      const rows=database.connection.prepare('SELECT * FROM activity_studio_job_items WHERE job_id=?').all(jobId);
      if(!request.itemIds?.length)throw studioError('studio_invalid_request','请明确选择要恢复的待提交项。');
      if(request.itemIds.some(id=>!rows.some(row=>row.id===id)))throw studioError('studio_item_not_found','恢复条目不属于此批次。',404);
      if(job.input.batch===true&&job.input.started!==true&&request.itemIds.length!==rows.length)
        throw studioError('studio_resume_unsafe','尚未审阅的旧预览须恢复完整范围；缩小范围请明确新建批次。',409);
      let safe=0;
      for(const row of rows){
        const task=row.generation_task_id?getGenerationTask(database,String(row.generation_task_id),'activities'):null;
        if(row.state==='unknown'||row.generation_task_id&&(!task||task.upstreamMayContinue||['submitting','accepted','running'].includes(task.status)))
          throw studioError('studio_resume_unsafe','原图片任务仍在运行或结果未知，请先核对；不会重复提交。',409);
        const held=task?.status==='queued'&&task.errorCode===heldCode;
        if(!request.itemIds.includes(String(row.id)))continue;
        if(row.state!=='waiting'&&!held)continue;
        if(job.input.batch===true){
          const frozen=job.input as unknown as FrozenStudioBatch,planned=frozen.plans.find(plan=>plan.id===row.id)!;
          const actual=resolveStudioBatchTarget(database,config,activityId,planned.target,planned.seed,planned.submissionKey,planned.optimizerOverride,planned.presetOverride);
          if(actual.planHash!==planned.planHash||actual.configurationHash!==planned.configurationHash)
            throw studioError('studio_plan_changed','未执行目标的来源或配置已改变，请新建并审阅新预览。',409);
        }
        if(held)database.connection.prepare("UPDATE generation_tasks SET error_code=NULL,error_message=NULL,updated_at=? WHERE id=? AND status='queued' AND error_code=?")
          .run(nowIso(),task.id,heldCode);
        safe++;
      }
      if(safe!==request.itemIds.length)
        throw studioError('studio_resume_no_waiting','没有安全的待提交项。失败项请用新尝试重试，成功图片不会重新绘制。',409);
    }
    const input={...job.input,resumeFromRevision:request.expectedJobRevision,resumeRequestHash:studioHash(request),resumeItemIds:request.itemIds??null,...(job.input.batch===true&&job.input.started!==true?{approved:false}:{})};
    if(database.connection.prepare("UPDATE activity_studio_jobs SET status='queued',input_json=?,revision=revision+1,error_code=NULL,error_message=NULL,updated_at=? WHERE id=? AND revision=? AND stop_requested=0")
      .run(JSON.stringify(input),nowIso(),jobId,request.expectedJobRevision).changes!==1)throw studioError('studio_job_conflict','任务已改变，未重复恢复。',409);
    return store.get(activityId,jobId)!;
  });
}

/** Query only known upstream IDs via the common poller; missing IDs remain unknown. No /prompt request. */
export async function reconcileStudioJob(options:{database:ServiceDatabase;config:ServiceConfig;secrets:SecretStore;activityId:string;jobId:string;fetcher?:typeof fetch;activeJobIds?:ReadonlySet<string>}){
  const store=new StudioStore(options.database),job=store.get(options.activityId,options.jobId);
  if(!job)throw studioError('studio_job_not_found','任务不属于此活动。',404);
  if(job.readOnly)throw studioError('studio_job_read_only','导入历史没有本机上游关联，不查询或重投。',409);
  for(const row of options.database.connection.prepare('SELECT generation_task_id FROM activity_studio_job_items WHERE job_id=? AND generation_task_id IS NOT NULL').all(job.id)){
    const task=getGenerationTask(options.database,String(row.generation_task_id),'activities');
    if(task?.providerTaskId&&(task.upstreamMayContinue||['accepted','running'].includes(task.status)))
      await pollAndCompleteTask(options.config,options.database,options.secrets,task.id,options.fetcher??fetch,{singleCheck:true,reconcileUnknown:true,joinExisting:false});
  }
  recoverStudioJobs(options.database,options.config,{activeJobIds:options.activeJobIds,jobId:job.id});
  return store.get(options.activityId,job.id)!;
}
