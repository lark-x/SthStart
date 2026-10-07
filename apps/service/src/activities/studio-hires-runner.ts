import { randomUUID } from 'node:crypto';
import { nowIso, type ServiceDatabase } from '../database.js';
import type { ServiceConfig } from '../config.js';
import type { SecretStore } from '../security.js';
import { createArtifactReference } from '../artifacts.js';
import { redactAiValue } from '../ai-call-trace.js';
import { createGenerationTask } from '../generation/execution.js';
import { getGenerationTask, resolveWorkflowAndEngine } from '../generation/task-store.js';
import { inspectWorkflowRuntime } from '../generation/runtime-preflight.js';
import { injectActivityLoras, renderWorkflowSnapshot } from '../generation/workflows.js';
import { StudioStore, studioError, studioHash } from './studio-store.js';
import { collectStudioRenderResult } from './studio-render-results.js';
import { studioTargetExists } from './studio-batches.js';
import {
  HIRES_BUSINESS_EVENT, HIRES_PURPOSE, readFrozenHiresPlan, rebuildFrozenHiresPlan, type FrozenHiresPlan,
} from './studio-hires.js';

/**
 * 阶段 4B／4C：细化任务执行（计划 §12.5／§13）。
 *
 * - job/item 已由 createStudioHires 持久化；这里只认领既有 queued 任务。
 * - 派发前复查来源文件哈希、已发布细化版本与目标是否仍存在；停止即阻止后续发送。
 * - 原生历史（beat 候选／漫画 job／素材 attempt）在**同一事务**的 onInsertTask 回调里建立；
 *   任何关联失败都会让任务插入事务回滚。
 * - 后续只核对这一任务与产物，绝不靠轮询再次 createGenerationTask。
 */

export interface HiresNativeContext {
  activityId: string;
  studioJobId: string;
  studioItemId: string;
  plan: FrozenHiresPlan;
}

function codedError(code: string, message: string, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

/**
 * 建立三类原生历史（计划 §13.1）。只落历史并关联任务：
 * 不调用完整生图执行函数、不重新优化、不自动选图，也不写回任何草稿。
 *
 * 漫画 job 以 `running` 落库（而不是 `queued`）：`listComicJobsForRecovery` 会挑选
 * `queued` 且已关联任务的行重新走完整漫画绘制，而细化历史只应由既有同步器收敛。
 * beat 候选以 `queued` 落库是安全的：孤儿恢复只处理 `status='preparing' AND task_id IS NULL`。
 */
export function insertHiresNativeHistory(
  database: ServiceDatabase,
  context: HiresNativeContext,
  task: { taskId: string; callId: string; actualSeed: number; workflowSnapshot: Record<string, unknown>; requestHash: string },
): { nativeJobId: string; candidateId: string | null; attemptId: string | null } {
  const { activityId, plan } = context, now = nowIso(), target = plan.targetContext;
  const scopedKey = `studio-hires:${context.studioJobId}:${context.studioItemId}`;
  if (target.kind === 'beat') {
    const candidateId = randomUUID();
    database.connection.prepare(`INSERT INTO activity_beat_render_candidates
      (id,activity_id,stage_id,scene_id,beat_id,idempotency_key,request_fingerprint,source_fingerprint,draft_version,status,
        positive_prompt,negative_prompt,created_at,original_prompt,prompt_optimization_status,auto_apply_state,auto_apply_reason,auto_apply_draft_version,
        task_id,call_id,artifact_id,artifact_sha256,media_url)
      VALUES (?,?,?,?,?,?,?,?,?,'queued',?,?,?,?,'skipped','ineligible','智能制作：放大细化仅加入历史',?,?,?,NULL,NULL,NULL)`)
      .run(candidateId, activityId, target.stageId, target.sceneId, target.beatId, scopedKey,
        studioHash({ planHash: plan.planHash, target: plan.target }), plan.sourceFingerprint || plan.sourceSha256,
        target.sourceDraftVersion, plan.finalPositive, plan.finalNegative, now, plan.finalPositive,
        target.sourceDraftVersion, task.taskId, task.callId);
    return { nativeJobId: candidateId, candidateId, attemptId: null };
  }
  if (target.kind === 'comic_panel') {
    const jobId = randomUUID();
    database.connection.prepare(`INSERT INTO activity_comic_jobs
      (id,activity_id,kind,panel_id,status,idempotency_key,request_hash,input_json,result_json,generation_task_id,trace_id,call_id,error_code,error_message,created_at,updated_at)
      VALUES (?,?,'render',?,'running',?,?,?,NULL,?,?,?,NULL,NULL,?,?)`).run(
      jobId, activityId, target.panelId, scopedKey,
      studioHash({ planHash: plan.planHash, panelId: target.panelId, requestHash: task.requestHash }),
      JSON.stringify({
        operation: 'hires', readOnly: true, panelId: target.panelId,
        sourceRevisionId: target.contentRevisionId, sourceArtifactId: plan.sourceArtifactId,
        sourceRenderJobId: target.sourceRenderJobId, sourceFingerprint: plan.sourceFingerprint,
        seed: plan.seed, maxSize: plan.maxSize, outputWidth: plan.outputWidth, outputHeight: plan.outputHeight,
        denoise: plan.denoise, planHash: plan.planHash, studioJobId: context.studioJobId,
        studioItemId: context.studioItemId, workflowId: plan.workflowId,
        workflowVersion: plan.workflowVersion, engineId: plan.engineId,
      }),
      task.taskId, context.studioJobId, task.callId, now, now);
    return { nativeJobId: jobId, candidateId: null, attemptId: null };
  }
  // media_slot：继承原 attempt 的配方与来源版本上下文，parent_attempt_ids 关联原 attempt。
  const attemptId = `attempt_${randomUUID().replace(/-/g, '')}`;
  database.connection.prepare(`INSERT INTO activity_image_attempts
    (id,activity_id,base_content_revision_id,image_config_revision_id,slot_id,slot_fingerprint,recipe_id,compilation_id,recipe_hash,
      execution_plan_hash,task_id,status,actual_seed,retry_of_attempt_id,parent_attempt_ids_json,idempotency_key,business_request_hash,
      error_code,error_message,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'queued',?,NULL,?,?,?,NULL,NULL,?,?)`).run(
    attemptId, activityId, target.baseContentRevisionId, target.imageConfigRevisionId, target.slotId,
    target.slotFingerprint, target.recipeId, target.compilationId, target.recipeHash, task.requestHash,
    task.taskId, task.actualSeed, JSON.stringify([target.sourceAttemptId]), scopedKey,
    studioHash({ planHash: plan.planHash, slotId: target.slotId, requestHash: task.requestHash }), now, now);
  database.connection.prepare(`INSERT INTO activity_image_execution_snapshots
    (attempt_id,phase,actual_inputs_json,uploaded_file_mappings_json,request_summary_json,created_at)
    VALUES (?,'prepared',?,'{}',?,?)`).run(
    attemptId, JSON.stringify(task.workflowSnapshot),
    JSON.stringify({ engineId: plan.engineId, workflowId: plan.workflowId, workflowVersion: plan.workflowVersion,
      operation: 'hires', sourceArtifactId: plan.sourceArtifactId, sourceAttemptId: target.sourceAttemptId }),
    now);
  database.connection.prepare(`INSERT INTO activity_media_job_links
    (task_id,activity_id,content_revision_id,slot_id,slot_fingerprint,attempt_id,created_at)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(task_id,slot_id) DO NOTHING`).run(
    task.taskId, activityId, target.baseContentRevisionId, target.slotId, target.slotFingerprint, attemptId, now);
  createArtifactReference(database, { artifactId: plan.sourceArtifactId, appId: 'activities', refType: 'activity_image_attempt', refId: attemptId });
  return { nativeJobId: attemptId, candidateId: null, attemptId };
}

/**
 * 模型字段的已授权基线：细化工作流的加载器取值来自来源任务的冻结快照，
 * 在预设锁定语义下它们等价于“预设提供的值”，而不是本次请求的临时替换。
 */
function modelInputBaseline(workflow: { inputSchema: Record<string, unknown>; editorConfig: { fields?: Record<string, { type?: string; modelCategory?: string }> } | null },
  inputs: Record<string, unknown>): Record<string, unknown> {
  const fields = workflow.editorConfig?.fields ?? {};
  const baseline: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) {
    if (field.type !== 'model' && !field.modelCategory) continue;
    if (key in inputs) baseline[key] = inputs[key];
  }
  return baseline;
}

/** 结果收集复用 collectStudioRenderResult 与对应原生同步器；这里只保证来源产物引用存在。 */function syncHiresNativeHistory(database: ServiceDatabase, context: HiresNativeContext) {
  createArtifactReference(database, {
    artifactId: context.plan.sourceArtifactId, appId: 'activities',
    refType: 'activity_studio_render', refId: `studio-render:${context.studioJobId}`,
  });
}

export async function processStudioHires(options: {
  database: ServiceDatabase; config: ServiceConfig; secrets: SecretStore;
  activityId: string; jobId: string; fetcher?: typeof fetch; signal?: AbortSignal;
}) {
  const { database, config, activityId, jobId } = options;
  const store = new StudioStore(database), owner = randomUUID();
  if (!store.claim(activityId, jobId, owner)) return;
  let job = store.get(activityId, jobId)!;
  const row = database.connection.prepare('SELECT id,generation_task_id FROM activity_studio_job_items WHERE job_id=?').get(jobId) as
    { id: string; generation_task_id: string | null } | undefined;
  if (!row) return;
  const itemId = String(row.id), plan = readFrozenHiresPlan(job);
  const context: HiresNativeContext = { activityId, studioJobId: jobId, studioItemId: itemId, plan };
  const continuing = () => {
    const current = store.get(activityId, jobId);
    return !options.signal?.aborted && Boolean(current) && ['preparing', 'running'].includes(current!.status) && !current!.stopRequested;
  };
  const lease = setInterval(() => store.renew(activityId, jobId, owner), 30_000);
  lease.unref();
  const fetcher = options.fetcher ?? fetch;
  try {
    if (job.status === 'preparing') job = store.transition(activityId, jobId, job.revision, 'running');
    if (!row.generation_task_id) {
      if (database.connection.prepare("UPDATE activity_studio_job_items SET state='preparing',updated_at=? WHERE job_id=? AND id=? AND state='waiting' AND generation_task_id IS NULL")
        .run(nowIso(), jobId, itemId).changes !== 1) return;
      if (!continuing()) throw codedError('studio_process_interrupted', '已停止后续提交，未发送上游任务。');
      // 派发前复查目标是否仍存在（计划 §11.2：目标确实被删除则不再发任务）。
      if (!studioTargetExists(database, activityId, plan.target)) {
        throw studioError('hires_target_missing', '目标已被删除，未提交细化任务。', 409);
      }
      // 复查来源文件哈希与已发布细化版本；来源被替换或版本变化都不静默沿用旧计划。
      const rebuilt = rebuildFrozenHiresPlan(database, config, activityId, plan);
      if (rebuilt.planHash !== plan.planHash) {
        throw studioError('hires_plan_changed', '细化计划已变化，请重新预览。', 409);
      }
      // 运行时预检：节点、模型、编码器、VAE、每个 LoRA 与实例连接；缺项明确阻止。
      const resolved = resolveWorkflowAndEngine(database, 'activities', {
        purpose: HIRES_PURPOSE, workflowId: plan.workflowId, workflowVersion: plan.workflowVersion,
        engineId: plan.engineId, isInternal: true,
      });
      const preflightSnapshot = injectActivityLoras(renderWorkflowSnapshot(
        resolved.workflow.definition, resolved.workflow.nodeBindings,
        Object.fromEntries(Object.entries(plan.inputs).filter(([key]) => key !== 'init_image')), plan.seed,
      ), resolved.workflow.editorConfig, plan.actualLoras);
      const inspection = await inspectWorkflowRuntime(resolved.engine, preflightSnapshot, options.secrets, fetcher, true);
      if (!inspection.ok) {
        throw codedError('workflow_runtime_requirements_missing', `当前 ComfyUI 实例无法满足细化工作流：${inspection.issues.join(' ')}`);
      }
      if (!continuing()) throw codedError('studio_process_interrupted', '已停止后续提交，未发送上游任务。');
      // 来源任务的冻结加载器取值作为“已授权参数基线”：细化工作流的模型字段是 preset-locked，
      // 必须让这些值通过预设锁定校验，同时仍受工作流声明的 allowedModels 白名单约束。
      const presetBaseline = modelInputBaseline(resolved.workflow, plan.inputs);
      await createGenerationTask(config, database, options.secrets, {
        appId: 'activities', purpose: HIRES_PURPOSE,
        workflowId: plan.workflowId, workflowVersion: plan.workflowVersion, engineId: plan.engineId,
        isInternal: true, validationMode: 'strict', inputs: plan.inputs, presetValues: presetBaseline,
        inputArtifacts: [{ artifactId: plan.sourceArtifactId, inputKey: 'init_image' }],
        activityLoras: plan.actualLoras,
        seed: plan.seed, idempotencyKey: `studio-hires:${jobId}:${itemId}`,
        audit: {
          feature: 'activity-image-hires', businessEvent: HIRES_BUSINESS_EVENT,
          objectType: 'activity-studio-job', objectId: jobId,
          // 业务返回链接指向工作室并带 studioJobId 与目标定位；上游 URL 不得覆盖它。
          sourceUrl: `/apps/activities/${encodeURIComponent(activityId)}?tab=studio&panel=smart-create&studioJobId=${encodeURIComponent(jobId)}`,
          traceId: job.traceId, parentId: plan.sourceCallId,
          positivePrompt: plan.finalPositive, negativePrompt: plan.finalNegative,
          visualConfiguration: {
            operation: 'hires', sourceArtifactId: plan.sourceArtifactId, sourceTaskId: plan.sourceGenerationTaskId,
            sourceFingerprint: plan.sourceFingerprint, maxSize: plan.maxSize,
            outputWidth: plan.outputWidth, outputHeight: plan.outputHeight, denoise: plan.denoise,
            target: plan.target, workflowId: plan.workflowId, workflowVersion: plan.workflowVersion,
            engineId: plan.engineId,
            inherited: {
              loaders: { unet: plan.inputs.unet_name ?? null, clip: plan.inputs.clip_name ?? null, vae: plan.inputs.vae_name ?? null },
              sampler: { steps: plan.inputs.steps, cfg: plan.inputs.cfg, samplerName: plan.inputs.sampler_name, scheduler: plan.inputs.scheduler },
              loras: plan.actualLoras.map(({ model, strength, triggerWord }) => ({ model, strength, triggerWord })),
            },
          },
        },
        onInsertTask: (task) => {
          if (!continuing()) throw codedError('studio_process_interrupted', '已停止后续提交，未发送上游任务。');
          const native = insertHiresNativeHistory(database, context, task);
          if (database.connection.prepare(`UPDATE activity_studio_job_items SET state='submitted',generation_task_id=?,call_id=?,native_job_id=?,candidate_id=?,updated_at=?
            WHERE job_id=? AND id=? AND state='preparing' AND generation_task_id IS NULL`)
            .run(task.taskId, task.callId, native.nativeJobId, native.candidateId, nowIso(), jobId, itemId).changes !== 1) {
            throw studioError('studio_job_conflict', '细化关联已改变，未提交重复任务。', 409);
          }
          database.connection.prepare('UPDATE activity_studio_jobs SET call_id=?,revision=revision+1,updated_at=? WHERE id=?')
            .run(task.callId, nowIso(), jobId);
        },
      }, fetcher);
    }
    for (;;) {
      const item = database.connection.prepare('SELECT generation_task_id FROM activity_studio_job_items WHERE job_id=? AND id=?').get(jobId, itemId) as { generation_task_id: string | null } | undefined;
      const task = item?.generation_task_id ? getGenerationTask(database, String(item.generation_task_id), 'activities') : null;
      if (!task) throw studioError('studio_generation_task_missing', '关联生成任务不存在；没有重新提交，请查看原日志。');
      if (['succeeded', 'completed'].includes(task.status)) {
        const collected = collectStudioRenderResult(database, config, activityId, jobId, itemId)!;
        if (!collected.readableIds.length) throw studioError('studio_artifact_unavailable', '任务已结束，但没有可读取的图片；没有覆盖当前画面。');
        syncHiresNativeHistory(database, context);
        const payload = { renderedImages: collected.readableIds, succeeded: 1, failed: 0, sourceFingerprint: plan.sourceFingerprint || plan.sourceSha256 };
        const current = store.get(activityId, jobId)!;
        if (current.status === 'running') {
          store.transition(activityId, jobId, current.revision, 'succeeded', { result: { ...payload, resultHash: studioHash(payload) } });
        }
        return;
      }
      if (task.upstreamMayContinue || options.signal?.aborted) {
        database.connection.prepare("UPDATE activity_studio_job_items SET state='unknown',error_code='studio_upstream_unknown',error_message='上游仍可能执行；请查看日志，不会自动重投。',updated_at=? WHERE job_id=? AND id=?")
          .run(nowIso(), jobId, itemId);
        const current = store.get(activityId, jobId)!;
        if (current.status === 'running') {
          store.transition(activityId, jobId, current.revision, 'unknown',
            { errorCode: 'studio_upstream_unknown', errorMessage: '上游仍可能执行，任务关联已保留；不会自动重投。' });
        }
        return;
      }
      if (['failed', 'abandoned', 'cancelled'].includes(task.status)) throw studioError(task.errorCode ?? 'studio_render_failed', task.errorMessage ?? '细化失败。');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, 500);
        function done() { clearTimeout(timer); options.signal?.removeEventListener('abort', done); resolve(); }
        options.signal?.addEventListener('abort', done, { once: true });
      });
    }
  } catch (error) {
    const value = error as Error & { code?: string }, current = store.get(activityId, jobId)!;
    const state = continuing() ? 'failed' : 'interrupted';
    database.connection.prepare('UPDATE activity_studio_job_items SET state=?,error_code=?,error_message=?,updated_at=? WHERE job_id=? AND id=? AND generation_task_id IS NULL')
      .run(state, value.code ?? 'studio_render_failed', String(redactAiValue(value.message)), nowIso(), jobId, itemId);
    database.connection.prepare("UPDATE activity_studio_job_items SET state='failed',error_code=?,error_message=?,updated_at=? WHERE job_id=? AND id=? AND state='submitted'")
      .run(value.code ?? 'studio_render_failed', String(redactAiValue(value.message)), nowIso(), jobId, itemId);
    if (['preparing', 'running'].includes(current.status)) {
      store.transition(activityId, jobId, current.revision, state,
        { errorCode: value.code ?? 'studio_render_failed', errorMessage: String(redactAiValue(value.message)) });
    }
  } finally { clearInterval(lease); }
}

/** 供测试与调用日志核对：细化调用的业务事件、返回链接与参数。 */
export function readHiresCallSummary(database: ServiceDatabase, taskId: string) {
  const row = database.connection.prepare('SELECT id,business_event,source_url,parent_id,parameters_json FROM ai_call_records WHERE generation_task_id=?')
    .get(taskId) as { id: string; business_event: string; source_url: string | null; parent_id: string | null; parameters_json: string } | undefined;
  if (!row) return null;
  let parameters: Record<string, unknown> = {};
  try { parameters = JSON.parse(row.parameters_json) as Record<string, unknown>; } catch { parameters = {}; }
  return { callId: String(row.id), businessEvent: String(row.business_event), sourceUrl: row.source_url, parentId: row.parent_id, parameters };
}
