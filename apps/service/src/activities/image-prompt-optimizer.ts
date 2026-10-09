import { createHash, randomUUID } from 'node:crypto';
import type { ActivityImagePromptPolicy, KnowledgeHit, RemovedTagDiagnostic, StructuredVisualPrompt } from '@sthstart/contracts';
import { DEFAULT_ACTIVITY_IMAGE_STRUCTURED_INSTRUCTIONS } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import type { SecretStore } from '../security.js';
import { collectAiCallRedactionSecrets, createAiCallRecord, fetchAuditedAiResponse, updateAiCallRecord, redactAiValue } from '../ai-call-trace.js';
import { resolveAssignedLlmProfile, upstreamHeaders } from '../providers.js';
import { resolveStudioTextProfile } from './studio-model-binding.js';
import { workflowUsesServiceFinalizedAssembly } from './image-prompt-policies.js';
import {
  buildStructuredSystemPrompt, parseStructuredOptimization, StructuredOptimizationError,
  type OptimizerVisualBlocks,
} from './image-prompt-structured.js';
import { bindStudioOptimizerCall, studioRenderAudit, type StudioRenderContext } from './studio-render-context.js';

export type ActivityImagePromptOptimization = {
  traceId: string;
  optimizerCallId: string;
  originalPrompt: string;
  optimizedPrompt: string;
  negativePrompt: string | null;
  status: 'optimized' | 'skipped';
  policyRevision: number;
  /** tags 模式下的结构化结果；prose 模式与旧记录为 null。 */
  structuredPrompt: StructuredVisualPrompt | null;
  /** 交给最终组装的作用域块；prose 模式为 null。 */
  visualBlocks: OptimizerVisualBlocks | null;
  knowledgeHits: KnowledgeHit[];
  knowledgeVersion: string | null;
  removedTags: RemovedTagDiagnostic[];
  warnings: string[];
};

export class PromptOptimizationError extends Error {
  code: string;
  statusCode: number;
  optimizerCallId: string | null;
  traceId: string;

  constructor(message: string, options: { code: string; statusCode?: number; optimizerCallId?: string | null; traceId: string }) {
    super(message);
    this.name = 'PromptOptimizationError';
    this.code = options.code;
    this.statusCode = options.statusCode ?? 502;
    this.optimizerCallId = options.optimizerCallId ?? null;
    this.traceId = options.traceId;
  }
}

function requestHash(input: { sourcePrompt: string; existingNegativePrompt?: string | null; workflowId: string; workflowVersion: number; policy: ActivityImagePromptPolicy;
  optimizerProfile?: { id: string; hash: string } }) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function cleanPrompt(value: string): string {
  const cleaned = value.trim().replace(/^```(?:text|plaintext)?\s*/i, '').replace(/\s*```$/, '')
    .replace(/^['"“”]+|['"“”]+$/g, '').replace(/[\r\n]+/g, ', ').replace(/\s+/g, ' ').trim();
  return cleaned;
}

interface OptimizationDetails {
  structuredPrompt: StructuredVisualPrompt | null;
  visualBlocks: OptimizerVisualBlocks | null;
  knowledgeHits: KnowledgeHit[];
  knowledgeVersion: string | null;
  removedTags: RemovedTagDiagnostic[];
  warnings: string[];
}

const EMPTY_OPTIMIZATION_DETAILS: OptimizationDetails = {
  structuredPrompt: null, visualBlocks: null, knowledgeHits: [],
  knowledgeVersion: null, removedTags: [], warnings: [],
};

/** 读取结构化编译快照；旧行或不可解析时返回“无结构化记录”。 */
function readCompilationSnapshot(database: ServiceDatabase, runId: string): OptimizationDetails {
  const row = database.connection.prepare(
    'SELECT compilation_snapshot_json FROM activity_prompt_optimization_runs WHERE id=?',
  ).get(runId) as { compilation_snapshot_json: string | null } | undefined;
  if (!row?.compilation_snapshot_json) return { ...EMPTY_OPTIMIZATION_DETAILS };
  try {
    const parsed = JSON.parse(row.compilation_snapshot_json) as Record<string, unknown>;
    return {
      structuredPrompt: (parsed.structuredPrompt ?? null) as StructuredVisualPrompt | null,
      visualBlocks: (parsed.visualBlocks ?? null) as OptimizerVisualBlocks | null,
      knowledgeHits: Array.isArray(parsed.knowledgeHits) ? parsed.knowledgeHits as KnowledgeHit[] : [],
      knowledgeVersion: typeof parsed.knowledgeVersion === 'string' ? parsed.knowledgeVersion : null,
      removedTags: Array.isArray(parsed.removedTags) ? parsed.removedTags as RemovedTagDiagnostic[] : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
    };
  } catch {
    return { ...EMPTY_OPTIMIZATION_DETAILS };
  }
}

function makeCallRecord(database: ServiceDatabase, input: {
  traceId: string; activityId: string; workflowId: string; workflowVersion: number; policy: ActivityImagePromptPolicy;
  sourcePrompt: string; provider?: string | null; model?: string | null; status: 'requested' | 'not_dispatched';
  error?: { code: string; message: string };
  studioContext?: StudioRenderContext;
}): string {
  const callId = createAiCallRecord(database, {
    applicationId: 'activities', traceId: input.traceId, feature: 'activity-image-prompt-optimization',
    businessEvent: 'activity.image.prompt.optimize', objectType: input.studioContext?.jobId ? 'activity-studio-job' : 'activity',
    objectId: input.studioContext?.jobId ? `${input.activityId}:${input.studioContext.jobId}` : input.activityId,
    callType: 'llm', provider: input.provider ?? null, models: input.model ? [input.model] : [],
    workflowId: input.workflowId, workflowVersion: input.workflowVersion,
    parentId: input.studioContext?.optimizerOverride?.priorCallId,
    retryOf: input.studioContext?.optimizerOverride?.priorCallId,
    parameters: { ...studioRenderAudit(input.studioContext), policyRevision: input.policy.revision, enabled: input.policy.enabled },
    positivePrompt: input.sourcePrompt,
    requestSnapshot: { workflowId: input.workflowId, workflowVersion: input.workflowVersion, policy: input.policy, sourcePrompt: input.sourcePrompt },
    sourceUrl: `/apps/activities/${encodeURIComponent(input.activityId)}`,
  });
  updateAiCallRecord(database, callId, input.status === 'requested'
    ? { status: 'submitted', event: 'submitted', detail: { phase: 'prompt_optimization' } }
    : { status: 'not_dispatched', event: 'not_dispatched', errorCode: input.error?.code ?? 'prompt_optimization_skipped', errorMessage: input.error?.message ?? '提示词优化已关闭。' });
  return callId;
}

export async function optimizeActivityImagePrompt(
  database: ServiceDatabase,
  secrets: SecretStore,
  input: {
    activityId: string; workflowId: string; workflowVersion: number; policy: ActivityImagePromptPolicy;
    sourcePrompt: string; existingNegativePrompt?: string | null; idempotencyKey: string; traceId?: string;
    studioContext?: StudioRenderContext;
    /** tags 模式下的角色作用域；prose 模式可省略。 */
    actorScope?: Array<{ actorId: string; displayName?: string }>;
    /** 明确可见人数标签；无法确定时留空。 */
    personCount?: string | null;
  },
  fetcher: typeof fetch = fetch,
): Promise<ActivityImagePromptOptimization> {
  const traceId = input.traceId ?? input.studioContext?.traceId ?? randomUUID();
  const policySnapshot = input.policy;
  const override = input.studioContext?.optimizerOverride;
  if (override && !input.policy.enabled) throw new PromptOptimizationError('提示词优化已关闭，不能选择备用优化模型。', {
    code: 'studio_fallback_optimizer_disabled', statusCode: 409, traceId,
  });
  const hash = requestHash({ sourcePrompt: input.sourcePrompt, existingNegativePrompt: input.existingNegativePrompt, workflowId: input.workflowId,
    workflowVersion: input.workflowVersion, policy: policySnapshot,
    ...(override ? { optimizerProfile: { id: override.profileId, hash: override.profileHash } } : {}) });
  const now = nowIso();
  let inserted = false;
  let row = database.transaction(() => {
    const insertion = database.connection.prepare(`INSERT INTO activity_prompt_optimization_runs
      (id,activity_id,idempotency_key,request_hash,trace_id,workflow_id,workflow_version,policy_revision,policy_snapshot_json,
       source_prompt,optimized_prompt,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'preparing',?,?) ON CONFLICT(activity_id,idempotency_key) DO NOTHING`)
      .run(randomUUID(), input.activityId, input.idempotencyKey, hash, traceId, input.workflowId, input.workflowVersion,
        policySnapshot.revision, JSON.stringify(policySnapshot), input.sourcePrompt, '', now, now);
    inserted = insertion.changes === 1;
    return database.connection.prepare(`SELECT id,request_hash,trace_id,optimized_prompt,status,optimizer_call_id,error_code,error_message,policy_revision
      FROM activity_prompt_optimization_runs WHERE activity_id=? AND idempotency_key=?`)
      .get(input.activityId, input.idempotencyKey) as {
        id: string; request_hash: string; trace_id: string; optimized_prompt: string; status: string;
        optimizer_call_id: string | null; error_code: string | null; error_message: string | null; policy_revision: number | null;
      };
  });
  if (row.request_hash !== hash) throw new PromptOptimizationError('相同幂等键已用於不同提示词或策略版本。', { code: 'prompt_optimization_idempotency_conflict', statusCode: 409, traceId });
  if (row.status === 'succeeded' || row.status === 'skipped') {
    // 旧运行没有结构化快照：只按“旧模式，无结构化记录”返回，不冒充。
    const snapshot = readCompilationSnapshot(database, row.id);
    return { traceId: row.trace_id, optimizerCallId: String(row.optimizer_call_id), originalPrompt: input.sourcePrompt,
      optimizedPrompt: row.optimized_prompt, negativePrompt: input.existingNegativePrompt ?? (input.policy.negativePrompt || null),
        status: row.status === 'succeeded' ? 'optimized' : 'skipped', policyRevision: Number(row.policy_revision ?? 0),
      structuredPrompt: snapshot.structuredPrompt, visualBlocks: snapshot.visualBlocks,
      knowledgeHits: snapshot.knowledgeHits, knowledgeVersion: snapshot.knowledgeVersion,
      removedTags: snapshot.removedTags, warnings: snapshot.warnings };
  }
  if (row.status === 'failed') throw new PromptOptimizationError(row.error_message || '提示词优化失败，请重新发起生成。', {
    code: row.error_code || 'prompt_optimization_failed', optimizerCallId: row.optimizer_call_id, traceId: row.trace_id,
  });
  if (row.status !== 'preparing' || row.trace_id !== traceId || !inserted) {
    throw new PromptOptimizationError('相同提示词优化请求仍在处理中，请稍后刷新候选列表。', { code: 'prompt_optimization_in_progress', statusCode: 409, traceId: row.trace_id });
  }
  // Ownership is the unique insertion above, not a shared trace. Preserve the
  // existing table's status contract; never replay an old preparing row.

  let optimizerCallId: string | null = null;
  let redactionSecrets: string[] = [];
  try {
    if (input.studioContext && !input.studioContext.canContinue()) throw new PromptOptimizationError('已停止后续提交，未发送提示词优化请求。', {
      code: 'studio_process_interrupted', traceId,
    });
    const existingNegative = input.existingNegativePrompt?.trim() || '';
    const policyNegative = input.policy.negativePrompt.trim();
    const negativePrompt = input.existingNegativePrompt !== undefined && input.existingNegativePrompt !== null
      ? input.existingNegativePrompt : policyNegative || null;
    // 声明服务端组装方式的工作流由活动画风提供风格串，策略里的画风后缀不再参与组装，
    // 避免同一串在“策略后缀 + 活动画风”两处重复出现。
    const policySuffix = workflowUsesServiceFinalizedAssembly(database, input.workflowId, input.workflowVersion)
      ? '' : input.policy.positiveSuffix.trim();
    if (!input.policy.enabled) {
      const output = [input.sourcePrompt.trim(), policySuffix].filter(Boolean).join(', ');
      optimizerCallId = makeCallRecord(database, { traceId, activityId: input.activityId, workflowId: input.workflowId,
        workflowVersion: input.workflowVersion, policy: input.policy, sourcePrompt: input.sourcePrompt, status: 'not_dispatched', studioContext: input.studioContext });
      database.connection.prepare(`UPDATE activity_prompt_optimization_runs SET optimized_prompt=?,status='skipped',optimizer_call_id=?,updated_at=? WHERE id=?`)
        .run(output, optimizerCallId, nowIso(), row.id);
      return { traceId, optimizerCallId, originalPrompt: input.sourcePrompt, optimizedPrompt: output, negativePrompt,
        status: 'skipped', policyRevision: input.policy.revision, ...EMPTY_OPTIMIZATION_DETAILS };
    }

    let profile: Awaited<ReturnType<typeof resolveAssignedLlmProfile>>;
    try {
      if (override) profile = await resolveStudioTextProfile(database, secrets, override.profileId, override.profileHash);
      else {
        const assigned = await resolveAssignedLlmProfile(database, secrets, 'activities', 'text');
        profile = assigned ? await resolveStudioTextProfile(database, secrets, assigned.id) : null;
      }
    }
    catch (error) {
      const message = error instanceof Error ? `活动文本模型配置读取失败：${error.message}` : '活动文本模型配置读取失败。';
      optimizerCallId = makeCallRecord(database, { traceId, activityId: input.activityId, workflowId: input.workflowId,
        workflowVersion: input.workflowVersion, policy: input.policy, sourcePrompt: input.sourcePrompt, status: 'not_dispatched',
        error: { code: 'prompt_optimizer_profile_unavailable', message }, studioContext: input.studioContext });
      throw new PromptOptimizationError(message, { code: 'prompt_optimizer_profile_unavailable', optimizerCallId, traceId });
    }
    if (!profile?.model) {
      const message = '活动尚未绑定可用的文本模型，已停止生图；请到生成配置的应用模型设置中绑定后重试。';
      optimizerCallId = makeCallRecord(database, { traceId, activityId: input.activityId, workflowId: input.workflowId,
        workflowVersion: input.workflowVersion, policy: input.policy, sourcePrompt: input.sourcePrompt, status: 'not_dispatched',
        error: { code: 'prompt_optimizer_not_configured', message }, studioContext: input.studioContext });
      throw new PromptOptimizationError(message, { code: 'prompt_optimizer_not_configured', optimizerCallId, traceId });
    }

    const url = `${profile.baseUrl}/chat/completions`;
    const structuredMode = input.policy.outputFormat === 'tags';
    const actorScope = input.actorScope ?? [];
    const systemInstruction = structuredMode
      ? buildStructuredSystemPrompt({
        instructions: input.policy.instructions.trim() || DEFAULT_ACTIVITY_IMAGE_STRUCTURED_INSTRUCTIONS,
        actorScope,
      })
      : input.policy.instructions.trim() || 'Rewrite the source as one concise image-generation prompt. Preserve all facts and return one line only.';
    const messages = [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: input.sourcePrompt },
    ];
    // 结构化输出需要完整 JSON，预算按模式区分。
    const payload: Record<string, unknown> = { ...profile.extraBody, model: profile.model, messages, temperature: 0.2, max_tokens: structuredMode ? 1600 : 900 };
    delete payload.thinkingMode;
    // A prompt rewrite only needs a concise final string. Inheriting an
    // application's long-thinking setting can spend the entire completion
    // budget on hidden reasoning and return no usable prompt, so keep this
    // narrowly-scoped call deterministic without changing the shared profile.
    payload.thinking = { type: 'disabled' };
    redactionSecrets = collectAiCallRedactionSecrets({ secret: profile.secret, headers: profile.headers, extraBody: profile.extraBody });
    if (input.studioContext && !input.studioContext.canContinue()) throw new PromptOptimizationError('读取配置期间任务已停止，未发送提示词优化请求。', {
      code: 'studio_process_interrupted', traceId,
    });
    input.studioContext?.beforeOptimization?.();
    const audited = await fetchAuditedAiResponse(database, {
      applicationId: 'activities', traceId, feature: 'activity-image-prompt-optimization', businessEvent: 'activity.image.prompt.optimize',
      objectType: input.studioContext?.jobId ? 'activity-studio-job' : 'activity',
      objectId: input.studioContext?.jobId ? `${input.activityId}:${input.studioContext.jobId}` : input.activityId,
      parentId: override?.priorCallId, retryOf: override?.priorCallId, callType: 'llm', provider: profile.name, models: [profile.model],
      workflowId: input.workflowId, workflowVersion: input.workflowVersion,
      parameters: { ...studioRenderAudit(input.studioContext), optimizerProfileId: profile.id,
        temperature: 0.2, maxTokens: 900, thinking: 'disabled', policyRevision: input.policy.revision }, positivePrompt: input.sourcePrompt,
      sourceUrl: `/apps/activities/${encodeURIComponent(input.activityId)}${input.studioContext?.jobId ? `?tab=studio&studioJobId=${encodeURIComponent(input.studioContext.jobId)}` : ''}`,
      redactionSecrets,
    }, fetcher, url, { method: 'POST', headers: { ...upstreamHeaders(profile.secret), ...profile.headers }, body: JSON.stringify(payload), signal: AbortSignal.timeout(60_000) }, {
      onRecord(callId) {
        optimizerCallId = callId;
        database.connection.prepare('UPDATE activity_prompt_optimization_runs SET optimizer_call_id=?,updated_at=? WHERE id=? AND status=\'preparing\'')
          .run(callId, nowIso(), row.id);
        if (input.studioContext && !input.studioContext.canContinue()) throw new PromptOptimizationError('任务已停止，未发送提示词优化请求。', {
          code: 'studio_process_interrupted', optimizerCallId: callId, traceId,
        });
        bindStudioOptimizerCall(database,input.studioContext,callId);
      },
    });
    optimizerCallId = audited.callId;
    if (!audited.response.ok) throw new PromptOptimizationError(`活动文本模型返回错误（HTTP ${audited.response.status}），未提交图片任务。`, {
      code: 'prompt_optimizer_upstream_error', optimizerCallId, traceId,
    });
    const body = await audited.response.json() as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }> };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new PromptOptimizationError('活动文本模型未返回有效的优化提示词，未提交图片任务。', {
      code: 'prompt_optimizer_empty_response', optimizerCallId, traceId,
    });
    const finishReason = typeof body.choices?.[0]?.finish_reason === 'string' ? String(body.choices[0].finish_reason) : null;

    let structuredResult: ReturnType<typeof parseStructuredOptimization> | null = null;
    if (structuredMode) {
      try {
        structuredResult = parseStructuredOptimization({
          content,
          finishReason,
          actorScope,
          knowledgeMode: input.policy.knowledgeMode,
          sourcePrompt: input.sourcePrompt,
          personCount: input.personCount ?? null,
        });
      } catch (error) {
        // 结构化失败必须使用计划 §19 的精确错误码，绝不落成通用“候选未生成完成”。
        if (error instanceof StructuredOptimizationError) {
          throw new PromptOptimizationError(error.message, { code: error.code, optimizerCallId, traceId });
        }
        throw error;
      }
    }

    const optimizedDescription = structuredResult ? structuredResult.optimizedPrompt : cleanPrompt(content);
    const optimizedPrompt = structuredResult
      ? optimizedDescription
      : [optimizedDescription, policySuffix].filter(Boolean).join(', ');
    updateAiCallRecord(database, optimizerCallId, { event: 'prompt_compiled', responseText: content,
      detail: { policyRevision: input.policy.revision, positiveSuffixApplied: Boolean(policySuffix) },
      redactionSecrets: collectAiCallRedactionSecrets({ secret: profile.secret, headers: profile.headers, extraBody: profile.extraBody }) });
    // 结构化快照与运行记录同事务写入，历史读取时不需要重新调用模型。
    const snapshot = structuredResult ? JSON.stringify({
      structuredPrompt: structuredResult.structured,
      visualBlocks: structuredResult.blocks,
      knowledgeHits: structuredResult.knowledgeHits,
      knowledgeVersion: structuredResult.knowledgeVersion,
      removedTags: structuredResult.removedTags,
      warnings: structuredResult.warnings,
    }) : null;
    database.connection.prepare(`UPDATE activity_prompt_optimization_runs
      SET optimized_prompt=?,status='succeeded',optimizer_call_id=?,compilation_snapshot_json=?,slots_json=?,request_hash_version=2,updated_at=? WHERE id=?`)
      .run(optimizedPrompt, optimizerCallId, snapshot, structuredResult ? JSON.stringify(structuredResult.blocks.characters) : null, nowIso(), row.id);
    return {
      traceId, optimizerCallId, originalPrompt: input.sourcePrompt, optimizedPrompt, negativePrompt,
      status: 'optimized', policyRevision: input.policy.revision,
      structuredPrompt: structuredResult?.structured ?? null,
      visualBlocks: structuredResult?.blocks ?? null,
      knowledgeHits: structuredResult?.knowledgeHits ?? [],
      knowledgeVersion: structuredResult?.knowledgeVersion ?? null,
      removedTags: structuredResult?.removedTags ?? [],
      warnings: structuredResult?.warnings ?? [],
    };
  } catch (error) {
    const coded = error as { code?: string; statusCode?: number };
    const value = error instanceof PromptOptimizationError ? error : new PromptOptimizationError(
      error instanceof Error && error.name === 'TimeoutError' ? '提示词优化超时，未提交图片任务。' : `提示词优化失败，未提交图片任务：${String(redactAiValue(error instanceof Error ? error.message : String(error), '', redactionSecrets))}`,
      { code: error instanceof Error && error.name === 'TimeoutError' ? 'prompt_optimizer_timeout' : coded?.code ?? 'prompt_optimizer_failed',
        statusCode: coded?.statusCode, optimizerCallId, traceId },
    );
    // Transport uncertainty, received HTTP status, and semantic failure are
    // different evidence. Keep the actual request's terminal status/error:
    // abandoned/HTTP 408/5xx must not become permission for a fallback replay.
    if (optimizerCallId) updateAiCallRecord(database, optimizerCallId, { event: 'optimization_failed',
      detail: { code: value.code, message: value.message }, redactionSecrets });
    database.connection.prepare(`UPDATE activity_prompt_optimization_runs SET status='failed',optimizer_call_id=?,error_code=?,error_message=?,updated_at=? WHERE id=?`)
      .run(value.optimizerCallId, value.code, value.message, nowIso(), row.id);
    throw value;
  }
}

export function linkPromptOptimizationTask(database: ServiceDatabase, activityId: string, idempotencyKey: string, taskId: string) {
  database.connection.prepare(`UPDATE activity_prompt_optimization_runs SET generation_task_id=?,updated_at=?
    WHERE activity_id=? AND idempotency_key=? AND status IN ('succeeded','skipped')`)
    .run(taskId, nowIso(), activityId, idempotencyKey);
}

/** An image was not submitted, but the optimization request may still have run.
 * No missing record or gateway response is proof that a model call did not occur. */
export function promptOptimizationCallUncertain(database: ServiceDatabase, callId: string): boolean {
  const call = database.connection.prepare("SELECT status,error_code FROM ai_call_records WHERE id=? AND business_event='activity.image.prompt.optimize'").get(callId);
  if (!call) return true;
  if (['requested','submitted','running','abandoned'].includes(String(call.status))) return true;
  return call.status === 'failed' && (call.error_code === 'http_408' || /^http_5\d\d$/.test(String(call.error_code)));
}
