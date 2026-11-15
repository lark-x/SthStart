import { createHash } from 'node:crypto';
import type {
  ExtractWebSearchResponse,
  WebSearchResponse,
  WebSearchResult,
} from '@sthstart/contracts';
import { nowIso } from '../database.js';
import { isPublicHttpUrl, siteNameForUrl } from './urls.js';

export const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
export const TAVILY_EXTRACT_URL = 'https://api.tavily.com/extract';
export const WEB_SEARCH_CONTENT_LIMIT = 20_000;
export const WEB_SEARCH_MAX_RESULTS = 10;

const SNIPPET_LIMIT = 600;
const REQUEST_TIMEOUT_MS = 20_000;

export class TavilyRequestError extends Error {
  readonly statusCode = 502;

  constructor(message: string) {
    super(message);
    this.name = 'TavilyRequestError';
  }
}

function providerStatusMessage(status: number) {
  if (status === 401 || status === 403) {
    return 'Tavily API Key 无效或无权访问，请检查密钥后重试。';
  }
  if (status === 429) {
    return 'Tavily 请求过于频繁，请稍后再试。';
  }
  if (status === 432) {
    return 'Tavily 套餐额度已用尽，请检查账户计划或额度。';
  }
  if (status === 433) {
    return 'Tavily 按量付费额度已用尽，请检查账户额度后重试。';
  }
  if (status >= 500) {
    return `Tavily 服务暂时不可用（HTTP ${status}），请稍后再试。`;
  }
  return `Tavily 请求未成功（HTTP ${status}），请检查请求或稍后重试。`;
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function truncateContent(value: string) {
  if (value.length <= WEB_SEARCH_CONTENT_LIMIT) return { text: value, truncated: false };
  return { text: value.slice(0, WEB_SEARCH_CONTENT_LIMIT), truncated: true };
}

function snippetFor(value: string) {
  return value.length <= SNIPPET_LIMIT ? value : value.slice(0, SNIPPET_LIMIT);
}

function failedSnapshot(item: WebSearchResult, retrievedAt: string, error: string): WebSearchResult {
  const snippet = item.snippet.trim() || '（无可用搜索摘要）';
  return {
    ...item,
    snippet,
    content: snippet,
    retrievedAt,
    contentHash: sha256(snippet),
    status: 'failed',
    truncated: item.truncated,
    error,
  };
}

async function readJson(response: Response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('json')) return null;
  return response.json().catch(() => null);
}

async function requestTavily(
  url: string,
  body: Record<string, unknown>,
  credential: string,
  fetcher: typeof fetch,
) {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${credential}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error
      && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new TavilyRequestError(timedOut
      ? 'Tavily 请求超时，请稍后重试。'
      : '无法连接 Tavily，请检查网络后重试。');
  }

  if (!response.ok) {
    throw new TavilyRequestError(providerStatusMessage(response.status));
  }
  const payload = await readJson(response);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TavilyRequestError('Tavily 返回了无法识别的响应。');
  }
  return payload as Record<string, unknown>;
}

export function canonicalResultUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = '';
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
      url.port = '';
    }
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.trim();
  }
}

function resultId(canonicalUrl: string) {
  return `ws_${sha256(canonicalUrl).slice(0, 20)}`;
}

export async function searchWithTavily(options: {
  credential: string;
  query: string;
  maxResults: number;
  fetcher: typeof fetch;
}): Promise<WebSearchResponse> {
  const { credential, query, maxResults, fetcher } = options;
  const payload = await requestTavily(TAVILY_SEARCH_URL, {
    query,
    search_depth: 'basic',
    max_results: maxResults,
    auto_parameters: false,
    include_answer: false,
    include_images: false,
    include_raw_content: false,
  }, credential, fetcher);

  const results = Array.isArray(payload.results) ? payload.results : [];
  const retrievedAt = nowIso();
  const byUrl = new Map<string, WebSearchResult>();
  for (const raw of results) {
    const result = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    const url = typeof result.url === 'string' ? result.url.trim() : '';
    if (!isPublicHttpUrl(url) || url.length > 4000) continue;
    const canonical = canonicalResultUrl(url);
    if (byUrl.has(canonical)) continue;
    const rawTitle = typeof result.title === 'string' && result.title.trim()
      ? result.title.trim()
      : url;
    const title = rawTitle.slice(0, 500);
    const rawContent = typeof result.content === 'string' ? result.content : '';
    const content = truncateContent(rawContent);
    byUrl.set(canonical, {
      id: resultId(canonical),
      title,
      url: canonical,
      siteName: siteNameForUrl(canonical),
      snippet: snippetFor(rawContent),
      content: content.text,
      retrievedAt,
      contentHash: sha256(content.text),
      status: 'snippet' as const,
      truncated: content.truncated,
    });
    if (byUrl.size >= maxResults) break;
  }
  const items = [...byUrl.values()];

  return { items, query };
}

function failedMessage(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 300);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const error = record.error;
    if (typeof error === 'string' && error.trim()) return error.trim().slice(0, 300);
    if (error && typeof error === 'object' && !Array.isArray(error)) {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 300);
    }
    if (typeof record.message === 'string' && record.message.trim()) return record.message.trim().slice(0, 300);
  }
  return 'Tavily 未能提取该网页正文。';
}

export async function extractWithTavily(options: {
  credential: string;
  items: WebSearchResult[];
  fetcher: typeof fetch;
}): Promise<ExtractWebSearchResponse> {
  const { credential, items, fetcher } = options;
  const payload = await requestTavily(TAVILY_EXTRACT_URL, {
    urls: items.map((item) => item.url),
    extract_depth: 'basic',
    format: 'text',
  }, credential, fetcher);

  const extracted = new Map<string, string>();
  for (const raw of Array.isArray(payload.results) ? payload.results : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    if (typeof record.url !== 'string') continue;
    extracted.set(canonicalResultUrl(record.url), typeof record.raw_content === 'string' ? record.raw_content : '');
  }

  const failed = new Map<string, string>();
  for (const raw of Array.isArray(payload.failed_results) ? payload.failed_results : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    if (typeof record.url !== 'string') continue;
    failed.set(canonicalResultUrl(record.url), failedMessage(record));
  }

  const retrievedAt = nowIso();
  const nextItems = items.map((item): WebSearchResult => {
    const key = canonicalResultUrl(item.url);
    if (extracted.has(key)) {
      const rawContent = extracted.get(key) ?? '';
      if (!rawContent.trim()) {
        return failedSnapshot(item, retrievedAt, 'Tavily 未返回该网页正文，仅保留搜索摘要。');
      }
      const content = truncateContent(rawContent);
      return {
        ...item,
        snippet: snippetFor(rawContent),
        content: content.text,
        retrievedAt,
        contentHash: sha256(content.text),
        status: 'extracted',
        truncated: content.truncated,
        error: undefined,
      };
    }
    return failedSnapshot(
      item,
      retrievedAt,
      failed.get(key) ?? 'Tavily 未返回该网址的提取结果，仅保留搜索摘要。',
    );
  });

  return { items: nextItems };
}
