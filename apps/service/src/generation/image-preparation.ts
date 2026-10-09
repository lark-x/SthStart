import { createHash } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import type { FastifyInstance } from 'fastify';
import { ImagePreparationRequestSchema, ImagePreparationResponseSchema, type ImagePreparationRequest, type ImagePreparationResponse } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import type { SecretStore } from '../security.js';
import { resolveAssignedLlmProfile, upstreamHeaders } from '../providers.js';
import { collectAiCallRedactionSecrets, createAiCallRecord, updateAiCallRecord } from '../ai-call-trace.js';
import { sanitizeErrorMessage } from './errors.js';
import { buildImagePurposeOptions, imageConfigurationError, mergeImageParameters, resolveImageConfiguration } from './image-configuration.js';

function assertPurpose(input: { appId: string; purpose: string }) {
  if (!(input.appId === 'creative-center' && ['text-to-image', 'image-to-image'].includes(input.purpose))
    && !(input.appId === 'characters' && input.purpose === 'character-avatar'))
    throw imageConfigurationError('invalid_image_purpose', '请选择有效的图片生成用途。', 400);
}

export async function prepareImageGeneration(database: ServiceDatabase, secrets: SecretStore, input: ImagePreparationRequest,
  fetcher: typeof fetch = fetch): Promise<ImagePreparationResponse> {
  assertPurpose(input);
  const resolved = resolveImageConfiguration(database, input);
  const { configuration } = resolved;
  if (!configuration.promptKey) throw imageConfigurationError('prompt_binding_required', '请先映射正面提示词字段。');
  const original = input.description;
  if (!original.trim()) throw imageConfigurationError('prompt_required', '请填写画面描述。', 400);
  // A blank seed requests a fresh deterministic draw for this attempt, so retrying stays stable.
  const requestParameters = { ...input.parameters };
  for (const field of configuration.fields) {
    if (field.type === 'seed' && requestParameters[field.key] === null) {
      requestParameters[field.key] = Number.parseInt(createHash('sha256').update(`${input.idempotencyKey}:${configuration.configurationHash}:${field.key}`).digest('hex').slice(0, 8), 16) & 0x7fffffff;
    }
  }
  // Reject invalid parameters before spending a model call.
  mergeImageParameters(resolved, { ...requestParameters, [configuration.promptKey]: original });
  let positivePrompt = original;
  let optimizerCallId: string | null = null;
  const requestHash = createHash('sha256').update(JSON.stringify({ ...input, configurationHash: configuration.configurationHash })).digest('hex');
  if (input.ai) {
    const objectId = `image-prompt:${input.idempotencyKey}`;
    const prior = database.connection.prepare(`SELECT id,status,parameters_json,response_text FROM ai_call_records
      WHERE application_id=? AND feature='image-prompt-preparation' AND object_id=? ORDER BY requested_at DESC LIMIT 1`)
      .get(input.appId, objectId) as { id: string; status: string; parameters_json: string; response_text: string | null } | undefined;
    if (prior) {
      if (JSON.parse(prior.parameters_json).requestHash !== requestHash)
        throw imageConfigurationError('idempotency_conflict', '同一请求键对应的描述或配置已变化，请重新准备提示词。');
      if (prior.status === 'succeeded' && prior.response_text) {
        positivePrompt = prior.response_text; optimizerCallId = prior.id;
      } else throw imageConfigurationError('prompt_preparation_pending_or_failed', '提示词请求尚未完成或已失败，请重新发起准备。');
    } else {
      // Claim synchronously before any await. Repeated HTTP requests cannot dispatch the same LLM call twice.
      optimizerCallId = createAiCallRecord(database, { applicationId: input.appId, feature: 'image-prompt-preparation',
        businessEvent: 'image.prompt.prepare', objectType: 'image-prompt', objectId, callType: 'llm',
        workflowId: resolved.workflow.id, workflowVersion: resolved.workflow.version,
        positivePrompt: original, parameters: { requestHash, configurationHash: configuration.configurationHash, temperature: 0.2, maxTokens: 1600, thinking: 'disabled' },
        requestSnapshot: { description: original, purpose: input.purpose } });
      let redactionSecrets: string[] = [];
      try {
        const profile = await resolveAssignedLlmProfile(database, secrets, input.appId, 'text');
        if (!profile?.model) throw imageConfigurationError('prompt_optimizer_not_configured', '当前应用未配置文本模型，请配置模型或关闭 AI 提示词后继续。');
        redactionSecrets = collectAiCallRedactionSecrets({ secret: profile.secret, headers: profile.headers, extraBody: profile.extraBody });
        updateAiCallRecord(database, optimizerCallId, { status: 'submitted', provider: profile.name, models: [profile.model], redactionSecrets });
        const extraBody = { ...profile.extraBody };
        delete extraBody.thinkingMode;
        const response = await fetcher(`${profile.baseUrl}/chat/completions`, { method: 'POST',
          headers: { ...upstreamHeaders(profile.secret), ...profile.headers }, signal: AbortSignal.timeout(60_000),
          body: JSON.stringify({ ...extraBody, thinking: { type: 'disabled' }, model: profile.model, temperature: 0.2, max_tokens: 1600,
            messages: [{ role: 'system', content: `You write image-generation prompts. Return only the English positive prompt, without markdown, JSON or explanation. Preserve the requested subject, identity, outfit, exact person count, actions and spatial relationships. Describe composition, environment and lighting concretely. Do not invent characters, add artists, LoRA tags, quality suffixes or negative prompts. ${resolved.promptPolicy.outputFormat === 'tags' ? 'Use comma-separated visual tags, preserving each character and their actions together.' : 'Use one natural English paragraph.'}\nConfigured writing rules (the plain-text output format above takes precedence):\n${resolved.promptPolicy.instructions}` },
              { role: 'user', content: original }] }) });
        if (!response.ok) throw imageConfigurationError('prompt_optimizer_upstream_error', `提示词模型返回 HTTP ${response.status}，未提交图片任务。`, 502);
        const body = await response.json() as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }> };
        const choice = body.choices?.[0];
        const content = choice?.message?.content;
        if (typeof content !== 'string' || !content.trim() || content.length > 10000 || choice?.finish_reason === 'length')
          throw imageConfigurationError('prompt_optimizer_invalid_response', '模型没有返回完整有效的提示词，未提交图片任务。', 502);
        positivePrompt = content.trim();
        updateAiCallRecord(database, optimizerCallId, { status: 'succeeded', responseText: positivePrompt,
          event: 'prompt_prepared', redactionSecrets });
      } catch (error) {
        updateAiCallRecord(database, optimizerCallId, { status: 'failed', event: 'prompt_preparation_failed',
          errorCode: (error as { code?: string }).code ?? 'prompt_optimizer_failed',
          errorMessage: error instanceof Error ? error.message : String(error), redactionSecrets });
        throw error;
      }
    }
  }
  // Policy suffixes are part of automatic preparation only. A manual prompt (ai=false) is exact.
  if (input.ai && resolved.promptPolicy.positiveSuffix.trim()) positivePrompt = [positivePrompt, resolved.promptPolicy.positiveSuffix.trim()].join(', ');
  const policyNegative = configuration.negativePromptKey && input.parameters[configuration.negativePromptKey] === undefined
    && resolved.promptPolicy.negativePrompt ? { [configuration.negativePromptKey]: resolved.promptPolicy.negativePrompt } : {};
  const parameters = mergeImageParameters(resolved, { ...policyNegative, ...requestParameters, [configuration.promptKey]: positivePrompt });
  const negative = configuration.negativePromptKey ? parameters[configuration.negativePromptKey] : null;
  return { originalDescription: original, positivePrompt, negativePrompt: typeof negative === 'string' ? negative : null,
    parameters, configurationHash: configuration.configurationHash, promptMode: configuration.promptMode,
    optimizerCallId, warnings: configuration.warnings };
}

export function registerImagePreparationRoutes(app: FastifyInstance, database: ServiceDatabase, secrets: SecretStore, fetcher: typeof fetch) {
  app.get<{ Querystring: { appId: string; purpose: string } }>('/api/v1/admin/generation/image/options', async (request, reply) => {
    try {
      assertPurpose(request.query);
      return buildImagePurposeOptions(database, request.query.appId, request.query.purpose);
    } catch (error) { return reply.code(400).send({ error: 'invalid_image_purpose', message: error instanceof Error ? error.message : String(error) }); }
  });
  app.post<{ Body: ImagePreparationRequest }>('/api/v1/admin/generation/image/prepare', {
    preValidation: async (request, reply) => {
      if (!Value.Check(ImagePreparationRequestSchema, request.body)) return reply.code(400).send({ error: 'invalid_image_preparation', message: '图片准备请求包含无效字段或缺少必要参数。' });
    },
    schema: { body: ImagePreparationRequestSchema, response: { 200: ImagePreparationResponseSchema } },
  }, async (request, reply) => {
    try { return await prepareImageGeneration(database, secrets, request.body, fetcher); }
    catch (error) {
      const coded = error as { code?: string; statusCode?: number };
      return reply.code(coded.statusCode ?? 400).send({ error: coded.code ?? 'prompt_preparation_failed',
        message: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)) });
    }
  });
}
