import { randomUUID } from 'node:crypto';
import type { StudioJob, StudioRefineRequest, StudioTarget, BeatRenderSubmitRequest } from '@sthstart/contracts';
import { nowIso, type ServiceDatabase } from '../database.js';
import type { ServiceConfig } from '../config.js';
import type { SecretStore } from '../security.js';
import { getGenerationTask } from '../generation/task-store.js';
import { redactAiValue } from '../ai-call-trace.js';
import { createStudioBeatCandidate, dispatchBeatRender } from './beat-renders.js';
import { createStudioComicRenderJob, processComicRenderJob } from './comic-renders.js';
import { ActivityStore } from './store.js';
import { ComicStore } from './comic-store.js';
import { StudioStore, studioHash, studioError } from './studio-store.js';
import { createImageGenerationAttempt,type CreateImageAttemptParams } from './image-attempts.js';
import { collectStudioRenderResult } from './studio-render-results.js';
import type { StudioOptimizerOverride } from './studio-render-context.js';
import { promptOptimizationCallUncertain } from './image-prompt-optimizer.js';

export type FrozenSingle = { target: StudioTarget; nativeId: string; seed: number;
  sourceFingerprint: string; planHash: string; submissionKey: string; beatRequest: BeatRenderSubmitRequest | null;mediaParams?:CreateImageAttemptParams;
  optimizerOverride?: StudioOptimizerOverride };

/** Only called inside applyStudioRefine's transaction. All identifiers and seeds precede any model request. */
export function createStudioRefineRender(database: ServiceDatabase, config: ServiceConfig,
  target: StudioRefineRequest['input']['target'], parent: StudioJob): StudioJob {
  const store = new StudioStore(database), key = `refine-render:${parent.id}`;
  const request = { target,parentJobId: parent.id };
  const existing = store.findIdempotent(parent.activityId,key,studioHash(request));
  if (existing) return existing;
  const seed = Number.parseInt(studioHash({ key }).slice(0,8),16) % 2147483647;
  const beatRequest: BeatRenderSubmitRequest | null = target.kind === 'beat' ? {
    stageId:target.stageId,sceneId:target.sceneId,beatId:target.beatId,idempotencyKey:key,seed } : null;
  const native = beatRequest ? createStudioBeatCandidate(database,parent.activityId,beatRequest) :
    createStudioComicRenderJob(database,parent.activityId,(target as { panelId: string }).panelId,config.artifactDirectory,seed,key,parent.traceId);
  const nativeId = 'candidateId' in native ? native.candidateId : native.job.id;
  const input: FrozenSingle = { target,nativeId,seed:native.seed,sourceFingerprint:native.sourceFingerprint,planHash:native.planHash,
    submissionKey:key,beatRequest };
  const child = store.create({ activityId:parent.activityId,kind:'render_batch',parentJobId:parent.id,planHash:native.planHash,
    idempotencyKey:key,request,artifactIds:native.referenceArtifactIds,freeze: () => ({ ...input,
      configuration: 'snapshot' in native ? native.snapshot : native.job.input,referenceArtifactIds:native.referenceArtifactIds }) },{ skipTransaction:true }).job;
  database.connection.prepare('UPDATE activity_studio_jobs SET trace_id=? WHERE id=?').run(parent.traceId,child.id);
  database.connection.prepare(`INSERT INTO activity_studio_job_items
    (id,job_id,target_key,target_json,candidate_index,attempt_no,state,input_json,source_fingerprint,submission_key,native_job_id,candidate_id,created_at,updated_at)
    VALUES (?,?,?,?,0,0,'waiting',?,?,?,?,?,?,?)`).run(randomUUID(),child.id,studioHash(target),JSON.stringify(target),JSON.stringify(input),
      input.sourceFingerprint,key,target.kind==='comic_panel' ? nativeId:null,target.kind==='beat' ? nativeId:null,nowIso(),nowIso());
  return store.get(parent.activityId,child.id)!;
}

/** No global interrupt, and no replay of an uncertain upstream submission. */
export async function processStudioSingleRender(options: { database:ServiceDatabase; config:ServiceConfig; secrets:SecretStore;
  activityId:string; jobId:string; fetcher?:typeof fetch; signal?:AbortSignal;itemId?:string;keepParentRunning?:boolean;
  beforeSubmission?():void;afterImages?(artifactIds:string[]):void }) {
  const { database,config,activityId,jobId } = options, store = new StudioStore(database), owner = randomUUID();
  if (!options.itemId&&!store.claim(activityId,jobId,owner)) return;
  let job = store.get(activityId,jobId)!;
  const row=database.connection.prepare(`SELECT id,input_json,generation_task_id FROM activity_studio_job_items WHERE job_id=? ${options.itemId?'AND id=?':''}`).get(jobId,...(options.itemId?[options.itemId]:[]));
  if(!row)return;
  const itemId=String(row.id),frozen = JSON.parse(String(row.input_json)) as FrozenSingle;
  const continuing = () => { const current=store.get(activityId,jobId);return !options.signal?.aborted && Boolean(current) && ['preparing','running'].includes(current!.status) && !current!.stopRequested; };
  const lease = !options.itemId ? setInterval(() => store.renew(activityId,jobId,owner),30_000):null;lease?.unref();
  const link = (taskId:string,callId:string) => {
    if (!continuing()) throw studioError('studio_process_interrupted','已停止后续提交。');
    options.beforeSubmission?.();
    if (database.connection.prepare(`UPDATE activity_studio_job_items SET state='submitted',generation_task_id=?,call_id=?,updated_at=?
      WHERE job_id=? AND id=? AND state='preparing' AND generation_task_id IS NULL`).run(taskId,callId,nowIso(),jobId,itemId).changes !== 1)
      throw studioError('studio_job_conflict','绘制关联已改变，未提交重复任务。',409);
    database.connection.prepare('UPDATE activity_studio_jobs SET call_id=?,revision=revision+1,updated_at=? WHERE id=?').run(callId,nowIso(),jobId);
  };
  try {
    if(job.status==='preparing')job = store.transition(activityId,jobId,job.revision,'running');
    if(!row.generation_task_id){
    if(database.connection.prepare("UPDATE activity_studio_job_items SET state='preparing',updated_at=? WHERE job_id=? AND id=? AND state='waiting' AND generation_task_id IS NULL").run(nowIso(),jobId,itemId).changes!==1)return;
    options.beforeSubmission?.();
    const context = { traceId: job.traceId, jobId, itemId, canContinue: continuing, optimizerOverride: frozen.optimizerOverride,
      beforeOptimization: options.beforeSubmission };
    if (frozen.target.kind === 'beat') await dispatchBeatRender(config,database,options.secrets,options.fetcher ?? fetch,new ActivityStore(database),
      activityId,frozen.nativeId,frozen.beatRequest!,frozen.planHash,frozen.sourceFingerprint,{ ...context,onInsertTask:link });
    else if(frozen.target.kind==='comic_panel')await processComicRenderJob({ ...options,jobId:frozen.nativeId,context:{ ...context,onInsertTask:link } });
    else await createImageGenerationAttempt(config,database,options.secrets,new ActivityStore(database),activityId,{...frozen.mediaParams!,studioContext:{...context,
      onInsertTask(taskId,callId,attemptId){link(taskId,callId);database.connection.prepare('UPDATE activity_studio_job_items SET native_job_id=? WHERE id=?').run(attemptId,itemId);}}},options.fetcher ?? fetch);
    }
    for (;;) {
      const item = database.connection.prepare('SELECT generation_task_id FROM activity_studio_job_items WHERE job_id=? AND id=?').get(jobId,itemId);
      const task = item?.generation_task_id ? getGenerationTask(database,String(item.generation_task_id),'activities') : null;
      if (!task) {
        const native = frozen.target.kind === 'beat' ? database.connection.prepare('SELECT error_message,call_id FROM activity_beat_render_candidates WHERE id=?').get(frozen.nativeId) :
          frozen.target.kind==='comic_panel'?new ComicStore(database).getComicJob(activityId,frozen.nativeId):null;
        const detail = native as { error_code?:string;errorCode?:string;error_message?:string;errorMessage?:string;call_id?:string;callId?:string } | null;
        database.connection.prepare('UPDATE activity_studio_jobs SET call_id=COALESCE(?,call_id) WHERE id=?').run(detail?.callId ?? detail?.call_id ?? null,jobId);
        throw Object.assign(studioError(detail?.errorCode ?? detail?.error_code ?? 'studio_render_preparation_failed',detail?.errorMessage ?? detail?.error_message ?? '绘制准备未完成，未提交图片任务。'),
          { optimizerCallId: detail?.callId ?? detail?.call_id ?? null });
      }
      if (['succeeded','completed'].includes(task.status)) {
        const collected=collectStudioRenderResult(database,config,activityId,jobId,itemId)!;
        if(!collected.readableIds.length)throw studioError('studio_artifact_unavailable','任务已结束，但没有可读取的图片；没有覆盖当前画面。');
        const payload={renderedImages:collected.readableIds,succeeded:1,failed:0,sourceFingerprint:frozen.sourceFingerprint},current=store.get(activityId,jobId)!;
        if(current.status==='running'&&!options.keepParentRunning)store.transition(activityId,jobId,current.revision,'succeeded',{result:{...payload,resultHash:studioHash(payload)}});
        options.afterImages?.(collected.readableIds);
        return;
      }
      if (task.upstreamMayContinue || options.signal?.aborted) {
        database.connection.prepare("UPDATE activity_studio_job_items SET state='unknown',error_code='studio_upstream_unknown',error_message='上游仍可能执行；请查看日志，不会自动重投。',updated_at=? WHERE job_id=? AND id=?").run(nowIso(),jobId,itemId);
        const current = store.get(activityId,jobId)!;
        if (current.status==='running') store.transition(activityId,jobId,current.revision,'unknown',{ errorCode:'studio_upstream_unknown',errorMessage:'上游仍可能执行，任务关联已保留；不会自动重投。' });
        return;
      }
      if (['failed','abandoned','cancelled'].includes(task.status)) throw studioError(task.errorCode ?? 'studio_render_failed',task.errorMessage ?? '绘制失败。');
      await new Promise<void>(resolve=>{ const timer=setTimeout(done,500); function done(){ clearTimeout(timer); options.signal?.removeEventListener('abort',done); resolve(); } options.signal?.addEventListener('abort',done,{ once:true }); });
    }
  } catch (error) {
    const value=error as Error & { code?:string;optimizerCallId?:string|null },current=store.get(activityId,jobId)!;
    if (value.optimizerCallId) {
      database.connection.prepare('UPDATE activity_studio_job_items SET call_id=COALESCE(call_id,?) WHERE id=? AND job_id=?')
        .run(value.optimizerCallId,itemId,jobId);
      database.connection.prepare('UPDATE activity_studio_jobs SET call_id=? WHERE id=?').run(value.optimizerCallId,jobId);
    }
    const uncertain=value.optimizerCallId&&promptOptimizationCallUncertain(database,value.optimizerCallId);
    const state=uncertain?'unknown':continuing() ? 'failed':'interrupted';
    database.connection.prepare('UPDATE activity_studio_job_items SET state=?,error_code=?,error_message=?,updated_at=? WHERE job_id=? AND id=? AND generation_task_id IS NULL')
      .run(state,value.code ?? 'studio_render_failed',String(redactAiValue(value.message)),nowIso(),jobId,itemId);
    // Linked failures must remain linked; recording them never resubmits to ComfyUI.
    database.connection.prepare("UPDATE activity_studio_job_items SET state='failed',error_code=?,error_message=?,updated_at=? WHERE job_id=? AND id=? AND state='submitted'")
      .run(value.code ?? 'studio_render_failed',String(redactAiValue(value.message)),nowIso(),jobId,itemId);
    if(options.keepParentRunning&&!uncertain)database.connection.prepare('UPDATE activity_studio_jobs SET revision=revision+1,updated_at=? WHERE id=?').run(nowIso(),jobId);
    if (['preparing','running'].includes(current.status)&&(!options.keepParentRunning||uncertain)) store.transition(activityId,jobId,current.revision,
      state==='failed'&&(current.input.fallback||frozen.optimizerOverride)?'paused':state,{ errorCode:uncertain?'studio_optimizer_unknown':value.code ?? 'studio_render_failed',
        errorMessage:uncertain?'提示词模型请求结果尚未明确；没有提交图片，不会自动重投。请先核对调用日志。':String(redactAiValue(value.message)) });
  } finally { if(lease)clearInterval(lease); }
}
