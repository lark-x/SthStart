import type { ServiceDatabase } from '../database.js';
import { upstreamHeaders } from '../providers.js';
import { collectAiCallRedactionSecrets, fetchAuditedAiResponse, updateAiCallRecord } from '../ai-call-trace.js';
import type { ModelThinkingLevel } from '@sthstart/contracts';

export interface CommonLlmProfile {
  id?: string;
  name?: string;
  baseUrl: string;
  secret?: string | null;
  model?: string | null;
  headers?: Record<string, string> | null;
  timeoutMs?: number;
  thinkingMode?: 'enabled' | 'disabled' | 'omit';
  thinkingLevel?: ModelThinkingLevel;
  fallbacks?: CommonLlmProfile[];
  extraBody?: Record<string, unknown> | null;
}

export interface CommonLlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
}

export interface ExecuteTextLlmOptions {
  profile: CommonLlmProfile;
  prompt?: string;
  systemPrompt?: string | null;
  messages?: CommonLlmMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  abortSignal?: AbortSignal;
  fetchFn?: typeof fetch;
  onResult?: (result: CommonLlmResult) => void;
  audit?: {
    database: ServiceDatabase;
    traceId?: string;
    applicationId: string;
    feature: string;
    businessEvent: string;
    objectType?: string | null;
    objectId?: string | null;
    parentId?: string | null;
    retryOf?: string | null;
    parameters?: Record<string,unknown>;
  };
}

export interface CommonLlmResult {
  text: string;
  model: string;
  profileId?: string;
  aiCallId?: string;
  tokenUsage?: Record<string, number>;
}

/**
 * 通用文本大模型调用内核
 * 统一处理 OpenAI 兼容协议请求封装、凭据注入、脱敏审计日志与错误返回
 */
function fallbackStatus(error: unknown) {
  const failure = error as { statusCode?: unknown; name?: unknown; message?: unknown };
  const explicit = Number(failure?.statusCode);
  if (Number.isInteger(explicit) && explicit >= 100) return explicit;
  return Number(/\b(?:LLM 供应商响应错误|HTTP)\s*\[?(\d{3})\]?/i.exec(String(failure?.message ?? ''))?.[1] ?? 0);
}

function fallbackEligible(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  const failure = error as { name?: unknown; message?: unknown };
  const name = String(failure?.name ?? '');
  const message = String(failure?.message ?? '');
  if (name === 'AbortError' && !/timeout|timed out/i.test(message)) return false;
  if (name === 'TimeoutError' || /\b(?:timeout|timed out)\b/i.test(message)) return true;
  if (error instanceof TypeError) return true;
  const status = fallbackStatus(error);
  if (status === 400 || status === 409 || status === 422) return false;
  if (status === 401 || status === 403 || status === 404 || status === 408 || status === 429) return true;
  if (status >= 500 && status < 600) return true;
  // Plain-Error fetchers (including several local adapters) use standard
  // network codes without a status code. Content/parameter errors do not match.
  return /\b(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|fetch failed|socket hang up|connection reset)\b|网络错误|连接失败|连接被拒绝|连接重置/i.test(message);
}

export async function executeTextLlm(options: ExecuteTextLlmOptions): Promise<string> {
  const fallbacks: CommonLlmProfile[] = [];
  const seen = new Set<string>([options.profile.id ?? `${options.profile.baseUrl}\u0000${options.profile.model ?? ''}`]);
  for (const profile of options.profile.fallbacks ?? []) {
    if (!profile?.baseUrl || !profile.model) continue;
    const key = profile.id ?? `${profile.baseUrl}\u0000${profile.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fallbacks.push(profile);
    if (fallbacks.length === 2) break;
  }
  const attempts = [options.profile, ...fallbacks];
  const primaryId = options.profile.id ?? null;
  let lastError: unknown;
  for (let index = 0; index < attempts.length; index += 1) {
    if (options.abortSignal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    const profile = attempts[index];
    try {
      return await executeTextLlmOnce({
        ...options,
        profile: { ...profile, fallbacks: undefined },
        audit: options.audit
          ? {
              ...options.audit,
              parameters: {
                ...options.audit.parameters,
                ...(Object.hasOwn(options.audit.parameters ?? {}, 'fallbackOf')
                  ? {}
                  : { fallbackOf: index > 0 ? primaryId : null }),
                index,
                fallbackIndex: index,
              },
            }
          : options.audit,
      });
    } catch (error) {
      lastError = error;
      if (index >= attempts.length - 1 || !fallbackEligible(error, options.abortSignal)) throw error;
    }
  }
  throw lastError;
}

async function executeTextLlmOnce(options: ExecuteTextLlmOptions): Promise<string> {
  const { profile, prompt, systemPrompt, messages, maxTokens, jsonMode, abortSignal, audit } = options;
  const fetchFn = options.fetchFn ?? fetch;

  const url = `${profile.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers = upstreamHeaders(profile.secret ?? null, true);
  if (profile.headers) {
    Object.assign(headers, profile.headers);
  }

  const model = profile.model?.trim();
  if (!model) throw Object.assign(new Error('model_id_required: 请配置实际模型 ID。'), { statusCode: 409 });
  const effectiveMessages: CommonLlmMessage[] = messages && messages.length > 0
    ? messages
    : [
        { role: 'system', content: systemPrompt ?? 'You are a helpful and precise assistant.' },
        { role: 'user', content: prompt ?? '' },
      ];

  const extraBody = { ...profile.extraBody };
  delete extraBody.stream; // 严格过滤 stream 参数，避免非流式请求下被 SSE 流格式破坏

  const effectiveTemperature = options.temperature !== undefined
    ? options.temperature
    : (typeof extraBody.temperature === 'number' ? extraBody.temperature : undefined);

  const payload: Record<string, unknown> = {
    ...extraBody,
    model,
    messages: effectiveMessages,
  };
  if (effectiveTemperature !== undefined) payload.temperature = effectiveTemperature;
  else delete payload.temperature;

  if (typeof maxTokens === 'number') {
    payload.max_tokens = maxTokens;
  }
  if (jsonMode) {
    payload.response_format = { type: 'json_object' };
  }

  delete payload.thinkingMode;
  const thinkingLevel = profile.thinkingLevel ?? 'auto';
  if (thinkingLevel === 'off') {
    delete payload.reasoning_effort;
    if (profile.thinkingMode === 'enabled' || profile.thinkingMode === 'disabled') {
      payload.thinking = { type: 'disabled' };
    } else {
      delete payload.thinking;
    }
  } else if (thinkingLevel === 'low' || thinkingLevel === 'medium' || thinkingLevel === 'high') {
    delete payload.thinking;
    payload.reasoning_effort = thinkingLevel;
  } else if (profile.thinkingMode === 'enabled' || profile.thinkingMode === 'disabled') {
    payload.thinking = { type: profile.thinkingMode };
    if (profile.thinkingMode === 'disabled') delete payload.reasoning_effort;
  } else if (profile.thinkingMode === 'omit') {
    delete payload.thinking;
  }
  const configuredTimeout = Number(profile.timeoutMs);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 180000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const init: RequestInit = {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: abortSignal ? AbortSignal.any([abortSignal, timeoutSignal]) : timeoutSignal,
  };

  const positivePrompt = prompt || effectiveMessages.map((m) => {
    const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return `${m.role}: ${c}`;
  }).join('\n\n');

  const audited = audit
    ? await fetchAuditedAiResponse(
        audit.database,
        {
          applicationId: audit.applicationId,
          traceId: audit.traceId,
          feature: audit.feature,
          businessEvent: audit.businessEvent,
          objectType: audit.objectType,
          objectId: audit.objectId,
          parentId: audit.parentId,
          retryOf: audit.retryOf,
          callType: 'llm',
          provider: profile.name || profile.id || 'custom',
          models: [String(model)],
          parameters: {
            ...audit.parameters,
            ...(effectiveTemperature !== undefined ? { temperature: effectiveTemperature } : {}),
            ...(jsonMode ? { jsonMode: true } : {}),
          },
          positivePrompt,
          redactionSecrets: collectAiCallRedactionSecrets({
            secret: profile.secret,
            headers: profile.headers,
            extraBody: profile.extraBody,
          }),
        },
        fetchFn,
        url,
        init
      )
    : null;

  const resp = audited?.response ?? (await fetchFn(url, init));

  if (!resp.ok) {
    const text = await resp.text();
    throw Object.assign(
      new Error(`LLM 供应商响应错误 [${resp.status}]: ${text.slice(0, 300)}`),
      { statusCode: resp.status, code: 'llm_upstream_http_error', responseStatus: resp.status },
    );
  }

  let data: {
    choices?: { message?: { content?: string } }[];
    usage?: Record<string, unknown>;
  };
  try {
    data = (await resp.json()) as typeof data;
  } catch {
    throw Object.assign(new Error('LLM 供应商返回内容不是有效 JSON'), { code: 'llm_invalid_response' });
  }

  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content) {
    throw Object.assign(new Error('LLM 供应商返回内容为空或格式无效'), { code: 'llm_empty_content' });
  }

  if (audited) {
    updateAiCallRecord(audit!.database, audited.callId, {
      responseText: content,
      event: 'content_parsed',
      detail: { model },
      redactionSecrets: audited.redactionSecrets,
    });
  }
  options.onResult?.({ text: content, model, profileId: profile.id, aiCallId: audited?.callId,
    tokenUsage: data.usage ? Object.fromEntries(Object.entries(data.usage).filter((entry): entry is [string, number] => typeof entry[1] === 'number')) : undefined });

  return content;
}

/**
 * 健壮的 JSON 解析工具，自动剥离 Markdown 代码块包裹
 */
export function parseCommonAiJson<T>(raw: string): T {
  const trimmed = raw.trim();
  const cleaned = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const firstBracket = cleaned.indexOf('[');

    if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
      const lastBracket = cleaned.lastIndexOf(']');
      if (lastBracket !== -1 && lastBracket > firstBracket) {
        try {
          return JSON.parse(cleaned.slice(firstBracket, lastBracket + 1)) as T;
        } catch {
          // fall through to object check
        }
      }
    }

    if (firstBrace !== -1) {
      const lastBrace = cleaned.lastIndexOf('}');
      if (lastBrace !== -1 && lastBrace > firstBrace) {
        try {
          return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
        } catch {
          // fall through to bracket check
        }
      }
    }

    if (firstBracket !== -1) {
      const lastBracket = cleaned.lastIndexOf(']');
      if (lastBracket !== -1 && lastBracket > firstBracket) {
        try {
          return JSON.parse(cleaned.slice(firstBracket, lastBracket + 1)) as T;
        } catch {
          // fall through
        }
      }
    }

    throw new Error(`模型返回内容不是有效 JSON 格式: ${trimmed.slice(0, 160)}`);
  }
}
