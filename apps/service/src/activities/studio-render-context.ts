import { nowIso, type ServiceDatabase } from '../database.js';

/** Internal execution context, never accepted by public image request schemas.
 * The fallback service supplies IDs and a checked configuration digest, not
 * provider URLs, credentials, prompts or an arbitrary workflow. */
export type StudioOptimizerOverride = {
  profileId: string;
  profileHash: string;
  fallbackOf: string;
  rootJobId: string;
  priorCallId: string | null;
};

export type StudioRenderContext = {
  traceId: string;
  jobId?: string;
  itemId?: string;
  optimizerOverride?: StudioOptimizerOverride;
  /** Revalidate the frozen target after runtime/credential awaits, before LLM. */
  beforeOptimization?(): void;
  canContinue(): boolean;
};

/** Only public relationship information belongs in actual request logs. */
export function studioRenderAudit(context?: StudioRenderContext): Record<string, unknown> {
  if (!context) return {};
  return {
    ...(context.jobId ? { studioJobId: context.jobId } : {}),
    ...(context.itemId ? { studioItemId: context.itemId } : {}),
    ...(context.optimizerOverride ? {
      fallbackOf: context.optimizerOverride.fallbackOf,
      fallbackRootJobId: context.optimizerOverride.rootJobId,
      fallbackAttempt: 1,
      optimizerProfileId: context.optimizerOverride.profileId,
    } : {}),
  };
}

/** Recoverable association precedes the model request, not its response. */
export function bindStudioOptimizerCall(database:ServiceDatabase,context:StudioRenderContext|undefined,callId:string){
  if(!context?.jobId||!context.itemId)return;
  database.transaction(()=>{
    const item=database.connection.prepare(`UPDATE activity_studio_job_items SET call_id=?,updated_at=?
      WHERE job_id=? AND id=? AND state='preparing' AND generation_task_id IS NULL
      AND EXISTS(SELECT 1 FROM activity_studio_jobs j WHERE j.id=job_id AND j.status IN ('preparing','running') AND j.stop_requested=0)`).run(callId,nowIso(),context.jobId!,context.itemId!);
    if(item.changes!==1)throw Object.assign(new Error('绘制条目已停止或变化，未发送提示词优化请求。'),{code:'studio_process_interrupted'});
    database.connection.prepare('UPDATE activity_studio_jobs SET call_id=? WHERE id=?').run(callId,context.jobId!);
  });
}
