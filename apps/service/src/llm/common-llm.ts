import type { ServiceDatabase } from '../database.js';
import { upstreamHeaders } from '../providers.js';
import { collectAiCallRedactionSecrets, fetchAuditedAiResponse, updateAiCallRecord } from '../ai-call-trace.js';

export interface CommonLlmProfile {
  id?: string;
  name?: string;
  baseUrl: string;
  secret?: string | null;
  model?: string | null;
  headers?: Record<string, string> | null;
  timeoutMs?: number;
  thinkingMode?: 'enabled' | 'disabled' | 'omit';
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
export async function executeTextLlm(options: ExecuteTextLlmOptions): Promise<string> {
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
    : (typeof extraBody.temperature === 'number' ? (extraBody.temperature as number) : 0.7);

  const payload: Record<string, unknown> = {
    ...extraBody,
    model,
    messages: effectiveMessages,
    temperature: effectiveTemperature,
  };

  if (typeof maxTokens === 'number') {
    payload.max_tokens = maxTokens;
  }
  if (jsonMode) {
    payload.response_format = { type: 'json_object' };
  }

  delete payload.thinkingMode;
  if (profile.thinkingMode === 'enabled' || profile.thinkingMode === 'disabled') payload.thinking = { type: profile.thinkingMode };
  else if (profile.thinkingMode === 'omit') delete payload.thinking;
  const timeoutSignal = AbortSignal.timeout(profile.timeoutMs ?? 180000);
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
          callType: 'llm',
          provider: profile.name || profile.id || 'custom',
          models: [String(model)],
          parameters: { temperature: effectiveTemperature, ...(jsonMode ? { jsonMode: true } : {}) },
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
    throw new Error(`LLM 供应商响应错误 [${resp.status}]: ${text.slice(0, 300)}`);
  }

  const data = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: Record<string, unknown>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('LLM 供应商返回内容为空');
  }

  options.onResult?.({ text: content, model, profileId: profile.id, aiCallId: audited?.callId,
    tokenUsage: data.usage ? Object.fromEntries(Object.entries(data.usage).filter((entry): entry is [string, number] => typeof entry[1] === 'number')) : undefined });
  if (audited) {
    updateAiCallRecord(audit!.database, audited.callId, {
      responseText: content,
      event: 'content_parsed',
      detail: { model },
      redactionSecrets: audited.redactionSecrets,
    });
  }

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
