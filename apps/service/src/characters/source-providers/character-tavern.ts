import { Buffer } from 'node:buffer';
import type { CardDownload, CardRemoteDetail, CardSearchPage, CharacterCardProvider } from './types.js';
import { CharacterCardProviderError } from './types.js';

const CATALOG_ORIGIN = 'https://character-tavern.com';
const CARD_STORAGE_ORIGIN = 'https://ct-cards.storage.character-tavern.com';

function externalPath(value: string) {
  const decoded = decodeURIComponent(value).replace(/^\/+|\/+$/g, '');
  if (!/^[A-Za-z0-9._~-]+\/[A-Za-z0-9._~-]+$/.test(decoded)) throw new CharacterCardProviderError('provider_bad_response', '角色卡来源 ID 无效。');
  return decoded;
}

function isoFromRemote(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value * 1000).toISOString();
  return null;
}

async function responseJson(response: Response, label: string): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new CharacterCardProviderError('provider_auth_required', `${label} 需要来源访问权限。`, { status: response.status });
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new CharacterCardProviderError('provider_rate_limited', `${label} 被来源限流。`, { status: response.status, retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : null });
    }
    if (response.status >= 500) throw new CharacterCardProviderError('provider_unavailable', `${label} 暂时不可用。`, { status: response.status });
    throw new CharacterCardProviderError('provider_bad_response', `${label} 返回 HTTP ${response.status}。`, { status: response.status });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new CharacterCardProviderError('provider_bad_response', `${label} 返回格式无效。`, { status: response.status });
  return payload as Record<string, unknown>;
}

export class CharacterTavernProvider implements CharacterCardProvider {
  readonly id = 'character-tavern';
  readonly name = 'Character Tavern';
  readonly capabilities = { search: true, detail: true, download: true, importUrl: true } as const;

  constructor(private readonly fetcher: typeof fetch = fetch, private readonly catalogOrigin = CATALOG_ORIGIN) {}

  private sourceUrl(path: string) { return `${this.catalogOrigin}/character/${path}`; }
  private thumbnailUrl(path: string) { return `${CARD_STORAGE_ORIGIN}/${path}.png`; }

  async search(input: { query: string; cursor?: string; limit: number; signal: AbortSignal }): Promise<CardSearchPage> {
    const page = Math.max(1, Number.parseInt(input.cursor || '1', 10) || 1);
    const limit = Math.min(30, Math.max(1, Math.floor(input.limit)));
    const url = new URL('/api/search/cards', this.catalogOrigin);
    url.searchParams.set('query', input.query.trim());
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('page', String(page));
    let response: Response;
    try {
      response = await this.fetcher(url, { headers: { accept: 'application/json' }, signal: input.signal });
    } catch (error) {
      if (input.signal.aborted) throw error;
      throw new CharacterCardProviderError('provider_unavailable', `Character Tavern 搜索暂时不可用：${error instanceof Error ? error.message : String(error)}`);
    }
    const payload = await responseJson(response, 'Character Tavern 搜索');
    const hits = Array.isArray(payload.hits) ? payload.hits : [];
    const totalPages = Number(payload.totalPages);
    const currentPage = Number(payload.page) || page;
    return {
      providerId: this.id,
      items: hits.flatMap((hit) => {
        if (!hit || typeof hit !== 'object') return [];
        const item = hit as Record<string, unknown>;
        const path = typeof item.path === 'string' ? item.path : '';
        if (!path) return [];
        return [{
          providerId: this.id,
          externalId: path,
          name: typeof item.name === 'string' ? item.name : '未命名角色卡',
          author: typeof item.author === 'string' ? item.author : item.author == null ? null : String(item.author),
          summary: typeof item.tagline === 'string' ? item.tagline : '',
          sourceUrl: this.sourceUrl(path),
          thumbnail: this.thumbnailUrl(path),
          tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 50) : [],
          language: null,
          remoteUpdatedAt: isoFromRemote(item.lastUpdateAt),
          formatHint: 'PNG / SillyTavern card',
        }];
      }),
      nextCursor: Number.isFinite(totalPages) && currentPage < totalPages ? String(currentPage + 1) : null,
      total: Number.isFinite(Number(payload.totalHits)) ? Number(payload.totalHits) : null,
    };
  }

  async getDetail(externalId: string, signal: AbortSignal): Promise<CardRemoteDetail> {
    const path = externalPath(externalId);
    let response: Response;
    try {
      response = await this.fetcher(new URL(`/api/character/${path.split('/').map(encodeURIComponent).join('/')}`, this.catalogOrigin), { headers: { accept: 'application/json' }, signal });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new CharacterCardProviderError('provider_unavailable', `Character Tavern 详情暂时不可用：${error instanceof Error ? error.message : String(error)}`);
    }
    const payload = await responseJson(response, 'Character Tavern 详情');
    const card = payload.card;
    if (!card || typeof card !== 'object' || Array.isArray(card)) throw new CharacterCardProviderError('provider_bad_response', 'Character Tavern 详情缺少卡片内容。');
    const value = card as Record<string, unknown>;
    return {
      providerId: this.id,
      externalId: path,
      name: typeof value.name === 'string' ? value.name : '未命名角色卡',
      author: value.author == null ? null : String(value.author),
      sourceUrl: this.sourceUrl(path),
      thumbnail: this.thumbnailUrl(path),
      remoteVersion: value.versionId == null ? null : String(value.versionId),
      remoteUpdatedAt: isoFromRemote(value.lastUpdatedAt),
      card: value,
    };
  }

  async download(externalId: string, signal: AbortSignal): Promise<CardDownload> {
    const path = externalPath(externalId);
    const sourceUrl = `${CARD_STORAGE_ORIGIN}/${path}.png?action=download`;
    let current = sourceUrl;
    let response: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        response = await this.fetcher(current, { headers: { accept: 'image/png' }, redirect: 'manual', signal });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new CharacterCardProviderError('provider_unavailable', `Character Tavern 卡片下载暂时不可用：${error instanceof Error ? error.message : String(error)}`);
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location || attempt === 3) throw new CharacterCardProviderError('provider_download_invalid', '角色卡下载重定向无效。');
      const next = new URL(location, current);
      if (next.origin !== CARD_STORAGE_ORIGIN) throw new CharacterCardProviderError('provider_download_invalid', '角色卡下载重定向到了未授权来源。');
      current = next.toString();
    }
    if (!response) throw new CharacterCardProviderError('provider_unavailable', '角色卡下载没有响应。');
    if (!response.ok) {
      if (response.status === 429) throw new CharacterCardProviderError('provider_rate_limited', 'Character Tavern 下载被限流。', { status: response.status });
      throw new CharacterCardProviderError(response.status >= 500 ? 'provider_unavailable' : 'provider_download_invalid', `角色卡下载返回 HTTP ${response.status}。`, { status: response.status });
    }
    const contentType = (response.headers.get('content-type') || 'image/png').split(';')[0].trim().toLowerCase();
    if (contentType !== 'image/png') throw new CharacterCardProviderError('provider_download_invalid', '角色卡下载不是 PNG。');
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > 20 * 1024 * 1024) throw new CharacterCardProviderError('provider_download_invalid', '角色卡下载超过大小限制。');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 20 * 1024 * 1024) throw new CharacterCardProviderError('provider_download_invalid', '角色卡下载超过大小限制。');
    return { providerId: this.id, externalId: path, sourceUrl, contentType, bytes, remoteVersion: null };
  }

  parseSupportedUrl(value: string): { externalId: string } | null {
    try {
      const url = new URL(value);
      if (url.origin === this.catalogOrigin && url.pathname.startsWith('/character/')) return { externalId: externalPath(url.pathname.slice('/character/'.length)) };
      if (url.origin === CARD_STORAGE_ORIGIN && url.pathname.endsWith('.png')) return { externalId: externalPath(url.pathname.slice(1, -4)) };
    } catch {
      return null;
    }
    return null;
  }
}
