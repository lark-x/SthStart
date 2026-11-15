import { createHash } from 'node:crypto';
import type { WebSearchProvider, WebSearchResponse, WebSearchResult, ExtractWebSearchResponse } from '@sthstart/contracts';
import { canonicalResultUrl, searchWithTavily, extractWithTavily, WEB_SEARCH_CONTENT_LIMIT } from './tavily.js';
import { isPublicHttpUrl, siteNameForUrl } from './urls.js';

export class SearchProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchProviderError';
  }
}
const names = { anysearch: 'AnySearch', exa: 'Exa', tavily: 'Tavily' };
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
type Context = { provider: WebSearchProvider; credential: string | null; fetcher: typeof fetch };
type RecordValue = Record<string, unknown>;
const record = (v: unknown): RecordValue => v && typeof v === 'object' && !Array.isArray(v) ? v as RecordValue : {};
const text = (value: unknown) => typeof value === 'string' ? value : '';

function requireCredential(context: Context) {
  if (context.provider !== 'anysearch' && !context.credential?.trim()) {
    throw new SearchProviderError(`${names[context.provider]} 尚未配置 API Key。`);
  }
}

async function request(context: Context, path: string, body: RecordValue): Promise<RecordValue> {
  const { provider, credential, fetcher } = context;
  const root = provider === 'anysearch' ? 'https://api.anysearch.com/v1' : 'https://api.exa.ai';
  let response: Response;
  try {
    response = await fetcher(`${root}/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json',
        ...(credential ? provider === 'exa' ? { 'x-api-key': credential } : { authorization: `Bearer ${credential}` } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(path === 'extract' ? 60000 : 35000),
    });
  } catch { throw new SearchProviderError(`${names[provider]} 连接失败或超时，请稍后重试。`); }
  if (!response.ok) {
    // AnySearch quota responses can include credentials. Never forward or log their body.
    const detail = response.status === 402 ? '额度已用尽，请检查账户或手动切换服务。'
      : response.status === 429 ? '请求过于频繁，请稍后重试。'
      : response.status === 401 || response.status === 403 ? '密钥无效或无权访问，请检查配置。' : `服务请求失败（HTTP ${response.status}）。`;
    throw new SearchProviderError(`${names[provider]} ${detail}`);
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new SearchProviderError(`${names[provider]} 返回了无法识别的响应。`); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new SearchProviderError(`${names[provider]} 返回了无法识别的响应。`);
  const result = record(payload);
  if (provider === 'anysearch' && result.code !== 0) throw new SearchProviderError('AnySearch 请求未完成，请检查服务和额度。');
  return result;
}

export async function searchWithProvider(context: Context & { query: string; maxResults: number }): Promise<WebSearchResponse> {
  requireCredential(context);
  if (context.provider === 'tavily') {
    const response = await searchWithTavily({ ...context, credential: context.credential! });
    return { ...response, items: response.items.map(item => ({ ...item, provider: 'tavily' })) };
  }
  const payload = await request(context, 'search', context.provider === 'anysearch'
    ? { query: context.query, max_results: context.maxResults }
    : { query: context.query, numResults: context.maxResults, type: 'auto', contents: { highlights: true } });
  const rawResults = context.provider === 'anysearch' ? record(payload.data).results : payload.results;
  if (!Array.isArray(rawResults)) throw new SearchProviderError(`${names[context.provider]} 返回了无法识别的搜索结果。`);
  const items = new Map<string, WebSearchResult>();
  for (const raw of rawResults) {
    const row = record(raw);
    if (typeof row.url !== 'string' || row.url.length > 4000 || !isPublicHttpUrl(row.url)) continue;
    const url = canonicalResultUrl(row.url);
    if (items.has(url)) continue;
    const highlights = Array.isArray(row.highlights) ? row.highlights.map(text).filter(Boolean).join('\n') : '';
    const snippet = (text(row.snippet) || highlights || text(row.text) || text(row.content)).slice(0, 600);
    items.set(url, { id: `ws_${hash(url).slice(0,20)}`, provider: context.provider, title: (text(row.title).trim() || url).slice(0,500), url,
      siteName: siteNameForUrl(url), snippet, content: snippet, contentHash: hash(snippet), retrievedAt: new Date().toISOString(), status: 'snippet', truncated: false });
    if (items.size === context.maxResults) break;
  }
  return { items: [...items.values()], query: context.query };
}

export async function extractWithProvider(context: Context & { items: WebSearchResult[] }): Promise<ExtractWebSearchResponse> {
  requireCredential(context);
  if (context.items.some(item => !isPublicHttpUrl(item.url))) {
    throw new SearchProviderError('只能提取 http/https 公共网址。');
  }
  if (context.provider === 'tavily') return extractWithTavily({ ...context, credential: context.credential! });
  const items: WebSearchResult[] = [];
  // Bound concurrency and preserve successful pages when another page fails.
  for (let offset=0; offset<context.items.length; offset+=2) {
    items.push(...await Promise.all(context.items.slice(offset,offset+2).map(async item => {
      try {
        if (context.provider === 'exa' && item.url.length > 2048) {
          throw new SearchProviderError('该网址超出 Exa 可接受的 2,048 字符长度，仅保留搜索摘要。');
        }
        const payload = await request(context, context.provider === 'anysearch' ? 'extract' : 'contents',
          context.provider === 'anysearch' ? { url: item.url } : { urls: [item.url], text: true });
        const row = context.provider === 'anysearch' ? record(payload.data)
          : record(Array.isArray(payload.results) ? payload.results.find(raw => {
            const url = record(raw).url;
            return typeof url === 'string' && canonicalResultUrl(url) === canonicalResultUrl(item.url);
          }) : null);
        if (context.provider === 'anysearch' && (typeof row.url !== 'string' || canonicalResultUrl(row.url) !== canonicalResultUrl(item.url))) {
          throw new SearchProviderError('AnySearch 未返回该网址的正文，仅保留搜索摘要。');
        }
        const raw = row.content ?? row.text;
        if (typeof raw !== 'string' || !raw.trim()) throw new SearchProviderError('没有返回该网页正文，仅保留摘要。');
        const content = raw.slice(0,WEB_SEARCH_CONTENT_LIMIT);
        return { ...item, provider: context.provider, content, contentHash: hash(content), retrievedAt: new Date().toISOString(), status: 'extracted' as const, truncated: raw.length > WEB_SEARCH_CONTENT_LIMIT, error: undefined };
      } catch (error) {
        return { ...item, provider: context.provider, content: item.snippet, contentHash: hash(item.snippet), retrievedAt: new Date().toISOString(), status: 'failed' as const,
          error: error instanceof SearchProviderError ? error.message : '正文提取失败，仅保留搜索摘要。' };
      }
    })));
  }
  return { items };
}
