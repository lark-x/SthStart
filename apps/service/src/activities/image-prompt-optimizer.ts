import { createHash, randomUUID } from 'node:crypto';
import type { ActivityImagePromptPolicy } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import type { SecretStore } from '../security.js';
import { collectAiCallRedactionSecrets, createAiCallRecord, fetchAuditedAiResponse, updateAiCallRecord } from '../ai-call-trace.js';
import { resolveAssignedLlmProfile, upstreamHeaders } from '../providers.js';

export type ActivityImagePromptOptimization = {
  traceId: string;
  optimizerCallId: string;
  originalPrompt: string;
  optimizedPrompt: string;
  negativePrompt: string | null;
  status: 'optimized' | 'skipped';
  policyRevision: number;
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

function requestHash(input: { sourcePrompt: string; existingNegativePrompt?: string | null; workflowId: string; workflowVersion: number; policy: ActivityImagePromptPolicy }) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function cleanPrompt(value: string): string {
  const cleaned = value.trim().replace(/^```(?:text|plaintext)?\s*/i, '').replace(/\s*```$/, '')
    .replace(/^['"“”]+|['"“”]+$/g, '').replace(/[\r\n]+/g, ', ').replace(/\s+/g, ' ').trim();
  return cleaned;
}

function makeCallRecord(database: ServiceDatabase, input: {
  traceId: string; activityId: string; workflowId: string; workflowVersion: number; policy: ActivityImagePromptPolicy;
  sourcePrompt: string; provider?: string | null; model?: string | null; status: 'requested' | 'not_dispatched';
  error?: { code: string; message: string };
}): string {
  const callId = createAiCallRecord(database, {
    applicationId: 'activities', traceId: input.traceId, feature: 'activity-image-prompt-optimization',
    businessEvent: 'activity.image.prompt.optimize', objectType: 'activity', objectId: input.activityId,
    callType: 'llm', provider: input.provider ?? null, models: input.model ? [input.model] : [],
    workflowId: input.workflowId, workflowVersion: input.workflowVersion,
    parameters: { policyRevision: input.policy.revision, enabled: input.policy.enabled },
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
  },
  fetcher: typeof fetch = fetch,
): Promise<ActivityImagePromptOptimization> {
  const traceId = input.traceId ?? randomUUID();
  const policySnapshot = input.policy;
  const hash = requestHash({ sourcePrompt: input.sourcePrompt, existingNegativePrompt: input.existingNegativePrompt, workflowId: input.workflowId,
    workflowVersion: input.workflowVersion, policy: policySnapshot });
  const now = nowIso();
  let row = database.transaction(() => {
    database.connection.prepare(`INSERT INTO activity_prompt_optimization_runs
      (id,activity_id,idempotency_key,request_hash,trace_id,workflow_id,workflow_version,policy_revision,policy_snapshot_json,
       source_prompt,optimized_prompt,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'preparing',?,?) ON CONFLICT(activity_id,idempotency_key) DO NOTHING`)
      .run(randomUUID(), input.activityId, input.idempotencyKey, hash, traceId, input.workflowId, input.workflowVersion,
        policySnapshot.revision, JSON.stringify(policySnapshot), input.sourcePrompt, '', now, now);
    return database.connection.prepare(`SELECT id,request_hash,trace_id,optimized_prompt,status,optimizer_call_id,error_code,error_message,policy_revision
      FROM activity_prompt_optimization_runs WHERE activity_id=? AND idempotency_key=?`)
      .get(input.activityId, input.idempotencyKey) as {
        id: string; request_hash: string; trace_id: string; optimized_prompt: string; status: string;
        optimizer_call_id: string | null; error_code: string | null; error_message: string | null; policy_revision: number | null;
      };
  });
  if (row.request_hash !== hash) throw new PromptOptimizationError('相同幂等键已用於不同提示词或策略版本。', { code: 'prompt_optimization_idempotency_conflict', statusCode: 409, traceId });
  if (row.status === 'succeeded' || row.status === 'skipped') {
    return { traceId: row.trace_id, optimizerCallId: String(row.optimizer_call_id), originalPrompt: input.sourcePrompt,
      optimizedPrompt: row.optimized_prompt, negativePrompt: input.existingNegativePrompt?.trim() || input.policy.negativePrompt || null,
        status: row.status as 'optimized' | 'skipped', policyRevision: Number(row.policy_revision ?? 0) };
  }
  if (row.status === 'failed') throw new PromptOptimizationError(row.error_message || '提示词优化失败，请重新发起生成。', {
    code: row.error_code || 'prompt_optimization_failed', optimizerCallId: row.optimizer_call_id, traceId: row.trace_id,
  });
  if (row.status !== 'preparing' || row.trace_id !== traceId) {
    throw new PromptOptimizationError('相同提示词优化请求仍在处理中，请稍后刷新候选列表。', { code: 'prompt_optimization_in_progress', statusCode: 409, traceId: row.trace_id });
  }

  let optimizerCallId: string | null = null;
  try {
    const existingNegative = input.existingNegativePrompt?.trim() || '';
    const policyNegative = input.policy.negativePrompt.trim();
    const negativePrompt = existingNegative || policyNegative || null;
    if (!input.policy.enabled) {
      const output = [input.sourcePrompt.trim(), input.policy.positiveSuffix.trim()].filter(Boolean).join(', ');
      optimizerCallId = makeCallRecord(database, { traceId, activityId: input.activityId, workflowId: input.workflowId,
        workflowVersion: input.workflowVersion, policy: input.policy, sourcePrompt: input.sourcePrompt, status: 'not_dispatched' });
      database.connection.prepare(`UPDATE activity_prompt_optimization_runs SET optimized_prompt=?,status='skipped',optimizer_call_id=?,updated_at=? WHERE id=?`)
        .run(output, optimizerCallId, nowIso(), row.id);
      return { traceId, optimizerCallId, originalPrompt: input.sourcePrompt, optimizedPrompt: output, negativePrompt, status: 'skipped', policyRevision: input.policy.revision };
    }

    let profile: Awaited<ReturnType<typeof resolveAssignedLlmProfile>>;
    try { profile = await resolveAssignedLlmProfile(database, secrets, 'activities', 'text'); }
    catch (error) {
      const message = error instanceof Error ? `活动文本模型配置读取失败：${error.message}` : '活动文本模型配置读取失败。';
      optimizerCallId = makeCallRecord(database, { traceId, activityId: input.activityId, workflowId: input.workflowId,
        workflowVersion: input.workflowVersion, policy: input.policy, sourcePrompt: input.sourcePrompt, status: 'not_dispatched',
        error: { code: 'prompt_optimizer_profile_unavailable', message } });
      throw new PromptOptimizationError(message, { code: 'prompt_optimizer_profile_unavailable', optimizerCallId, traceId });
    }
    if (!profile?.model) {
      const message = '活动尚未绑定可用的文本模型，已停止生图；请到生成配置的应用模型设置中绑定后重试。';
      optimizerCallId = makeCallRecord(database, { traceId, activityId: input.activityId, workflowId: input.workflowId,
        workflowVersion: input.workflowVersion, policy: input.policy, sourcePrompt: input.sourcePrompt, status: 'not_dispatched',
        error: { code: 'prompt_optimizer_not_configured', message } });
      throw new PromptOptimizationError(message, { code: 'prompt_optimizer_not_configured', optimizerCallId, traceId });
    }

    const url = `${profile.baseUrl}/chat/completions`;
    const messages = [
      { role: 'system', content: input.policy.instructions.trim() || 'Rewrite the source as one concise image-generation prompt. Preserve all facts and return one line only.' },
      { role: 'user', content: input.sourcePrompt },
    ];
    const payload: Record<string, unknown> = { ...profile.extraBody, model: profile.model, messages, temperature: 0.2, max_tokens: 900 };
    // A prompt rewrite only needs a concise final string. Inheriting an
    // application's long-thinking setting can spend the entire completion
    // budget on hidden reasoning and return no usable prompt, so keep this
    // narrowly-scoped call deterministic without changing the shared profile.
    payload.thinking = { type: 'disabled' };
    const audited = await fetchAuditedAiResponse(database, {
      applicationId: 'activities', traceId, feature: 'activity-image-prompt-optimization', businessEvent: 'activity.image.prompt.optimize',
      objectType: 'activity', objectId: input.activityId, callType: 'llm', provider: profile.name, models: [profile.model],
      workflowId: input.workflowId, workflowVersion: input.workflowVersion,
      parameters: { temperature: 0.2, maxTokens: 900, thinking: 'disabled', policyRevision: input.policy.revision }, positivePrompt: input.sourcePrompt,
      sourceUrl: `/apps/activities/${encodeURIComponent(input.activityId)}`,
      redactionSecrets: collectAiCallRedactionSecrets({ secret: profile.secret, headers: profile.headers, extraBody: profile.extraBody }),
    }, fetcher, url, { method: 'POST', headers: { ...upstreamHeaders(profile.secret), ...profile.headers }, body: JSON.stringify(payload), signal: AbortSignal.timeout(60_000) });
    optimizerCallId = audited.callId;
    if (!audited.response.ok) throw new PromptOptimizationError(`活动文本模型返回错误（HTTP ${audited.response.status}），未提交图片任务。`, {
      code: 'prompt_optimizer_upstream_error', optimizerCallId, traceId,
    });
    const body = await audited.response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !cleanPrompt(content)) throw new PromptOptimizationError('活动文本模型未返回有效的优化提示词，未提交图片任务。', {
      code: 'prompt_optimizer_empty_response', optimizerCallId, traceId,
    });
    const optimizedDescription = cleanPrompt(content);
    const optimizedPrompt = [optimizedDescription, input.policy.positiveSuffix.trim()].filter(Boolean).join(', ');
    updateAiCallRecord(database, optimizerCallId, { event: 'prompt_compiled', responseText: content,
      detail: { policyRevision: input.policy.revision, positiveSuffixApplied: Boolean(input.policy.positiveSuffix.trim()) },
      redactionSecrets: collectAiCallRedactionSecrets({ secret: profile.secret, headers: profile.headers, extraBody: profile.extraBody }) });
    database.connection.prepare(`UPDATE activity_prompt_optimization_runs SET optimized_prompt=?,status='succeeded',optimizer_call_id=?,updated_at=? WHERE id=?`)
      .run(optimizedPrompt, optimizerCallId, nowIso(), row.id);
    return { traceId, optimizerCallId, originalPrompt: input.sourcePrompt, optimizedPrompt, negativePrompt, status: 'optimized', policyRevision: input.policy.revision };
  } catch (error) {
    if (!optimizerCallId) {
      const latestCall = database.connection.prepare(`SELECT id FROM ai_call_records WHERE trace_id=? AND business_event='activity.image.prompt.optimize'
        ORDER BY requested_at DESC LIMIT 1`).get(traceId) as { id: string } | undefined;
      optimizerCallId = latestCall?.id ?? null;
    }
    const value = error instanceof PromptOptimizationError ? error : new PromptOptimizationError(
      error instanceof Error && error.name === 'TimeoutError' ? '提示词优化超时，未提交图片任务。' : `提示词优化失败，未提交图片任务：${error instanceof Error ? error.message : String(error)}`,
      { code: error instanceof Error && error.name === 'TimeoutError' ? 'prompt_optimizer_timeout' : 'prompt_optimizer_failed', optimizerCallId, traceId },
    );
    if (optimizerCallId) updateAiCallRecord(database, optimizerCallId, { status: 'failed', event: 'optimization_failed', errorCode: value.code, errorMessage: value.message });
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
