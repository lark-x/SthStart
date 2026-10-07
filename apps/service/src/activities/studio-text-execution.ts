import { randomUUID } from 'node:crypto';
import type { StudioJob } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import type { SecretStore } from '../security.js';
import { redactAiValue } from '../ai-call-trace.js';
import { resolveAssignedLlmProfile } from '../providers.js';
import { callLlm } from './text-jobs.js';
import { parseAiJsonOutput } from './prompts.js';
import { StudioStore, studioError } from './studio-store.js';
import {resolveStudioTextProfile} from './studio-model-binding.js';
import {validateStudioTextFallbackSource,type FrozenTextFallback} from './studio-text-fallback.js';

export type StudioTextExecutionOptions = { database: ServiceDatabase; secrets: SecretStore; activityId: string; jobId: string;
  fetcher?: typeof fetch; signal?: AbortSignal; timeoutMs?: number };

/** Shared transport/lease/audit only. Each feature must validate its own whitelisted result. */
export async function processStudioTextJob(options: StudioTextExecutionOptions, kind: 'storyboard' | 'refine',
  prepare: (job: StudioJob) => { prompt: string; validate(raw: unknown): NonNullable<StudioJob['result']> }) {
  const store = new StudioStore(options.database), initial = store.get(options.activityId, options.jobId), owner = randomUUID();
  if (!initial || initial.kind !== kind || !store.claim(options.activityId, options.jobId, owner)) return;
  let job = store.get(options.activityId, options.jobId)!;
  const controller = new AbortController(), abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const lease = setInterval(() => { if (!store.renew(options.activityId, job.id, owner)) controller.abort(); }, 30_000);
  let timeout: ReturnType<typeof setTimeout> | undefined, onAborted: (() => void) | undefined, timedOut = false;
  const latestCall = () => options.database.connection.prepare("SELECT id FROM ai_call_records WHERE trace_id=? AND application_id='activities' AND object_type='activity-studio-job' AND object_id=? ORDER BY requested_at DESC LIMIT 1").get(job.traceId,job.id);
  try {
    if (controller.signal.aborted) throw studioError('studio_process_interrupted', '服务关闭，智能制作任务已中断。');
    const { prompt, validate } = prepare(job);
    const fallback=job.input.fallback as FrozenTextFallback|undefined;
    if(fallback&&validateStudioTextFallbackSource(options.database,job)!==fallback.sourceHash)
      throw studioError('studio_source_changed','备用任务冻结的来源不完整，未发送请求。',409);
    let profile = fallback?await resolveStudioTextProfile(options.database,options.secrets,fallback.profileId,fallback.profileHash)
      :await resolveAssignedLlmProfile(options.database, options.secrets, 'activities', 'text');
    if (!profile) throw studioError('studio_profile_unavailable', '活动文本模型未配置。', 409);
    if(!fallback){try{profile=await resolveStudioTextProfile(options.database,options.secrets,profile.id);}
      catch{throw studioError('studio_profile_unavailable','活动文本模型未启用、缺少模型 ID 或已配置的凭据不可用；未发送模型请求。',409);}}
    // Awaiting a credential must not allow content edits or a stop to slip past
    // the last pre-network gate.
    if(fallback&&validateStudioTextFallbackSource(options.database,job)!==fallback.sourceHash)
      throw studioError('studio_source_changed','备用任务冻结的来源已变化，未发送请求。',409);
    const beforeNetwork=store.get(options.activityId,job.id)!;
    if(beforeNetwork.stopRequested||beforeNetwork.status!=='preparing'||controller.signal.aborted)return;
    job=beforeNetwork;
    job = store.transition(options.activityId, job.id, job.revision, 'running');
    const raw = await Promise.race([
      callLlm(profile, prompt, options.fetcher ?? fetch, controller.signal, { database: options.database, traceId: job.traceId,
        businessEvent: `activity.studio.${kind}`, feature: 'activity-studio', objectType: 'activity-studio-job', objectId: job.id,
        ...(fallback?{parentId:fallback.priorCallId,retryOf:fallback.priorCallId,parameters:{fallbackOf:fallback.fallbackOf,fallbackRootJobId:fallback.rootJobId,
          profileId:fallback.profileId,model:fallback.model,fallbackAttempt:1,scope:fallback.scope}}:{}) }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => { timedOut = true;
        reject(studioError('studio_model_timeout', '智能制作模型请求超时，未自动重试。', 504)); controller.abort(); }, options.timeoutMs ?? 120_000); }),
      new Promise<never>((_, reject) => { onAborted = () => reject(studioError('studio_process_interrupted', '模型请求已停止或服务中断，未自动重试。'));
        controller.signal.addEventListener('abort', onAborted, { once: true }); }),
    ]);
    const parsed: unknown = parseAiJsonOutput(raw);
    if (/(?:https?:\/\/|file:\/\/|[A-Za-z]:\\|<\/?[A-Za-z][^>]*>)/.test(JSON.stringify(parsed)))
      throw studioError('studio_invalid_model_output', '模型结果包含 URL、文件路径或 HTML，不接受这些内容。');
    const result = validate(parsed), current = store.get(options.activityId, job.id)!;
    if (current.status !== 'running' || current.stopRequested) return;
    const call = latestCall();
    store.transition(options.activityId, job.id, current.revision, 'awaiting_review', { result, callId: call ? String(call.id) : null });
  } catch (error) {
    const current = store.get(options.activityId, job.id);
    if (!current || !['preparing', 'running'].includes(current.status)) return;
    const call = latestCall(), value = error as { code?: string; message?: string };
    store.transition(options.activityId, job.id, current.revision, options.signal?.aborted ? 'interrupted' : current.input.fallback?'paused':'failed', {
      callId: call ? String(call.id) : null, errorCode: timedOut ? 'studio_model_timeout' : value.code ?? 'studio_invalid_model_output',
      errorMessage: timedOut ? '智能制作模型请求超时，未自动重试。' : String(redactAiValue(value.message ?? '任务失败，未自动修改内容。')),
    });
  } finally {
    clearInterval(lease); if (timeout) clearTimeout(timeout);
    if (onAborted) controller.signal.removeEventListener('abort', onAborted);
    options.signal?.removeEventListener('abort', abort);
    const call = latestCall();
    if (call) options.database.connection.prepare('UPDATE activity_studio_jobs SET call_id=?,revision=revision+1,updated_at=? WHERE activity_id=? AND id=? AND call_id IS NULL')
      .run(String(call.id), new Date().toISOString(), options.activityId, job.id);
  }
}
