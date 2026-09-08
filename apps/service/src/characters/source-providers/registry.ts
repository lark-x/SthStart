import type { CharacterCardProvider, CardRemoteDetail, CardSearchPage, CardDownload } from './types.js';
import { CharacterTavernProvider } from './character-tavern.js';

type CacheEntry<T> = { value: T; expiresAt: number };

export class CharacterCardProviderRegistry {
  private readonly providers: Map<string, CharacterCardProvider>;
  private readonly searchCache = new Map<string, CacheEntry<CardSearchPage>>();
  private readonly detailCache = new Map<string, CacheEntry<CardRemoteDetail>>();

  constructor(fetcher: typeof fetch = fetch) {
    const provider = new CharacterTavernProvider(fetcher);
    this.providers = new Map([[provider.id, provider]]);
  }

  list() { return [...this.providers.values()]; }

  get(id: string) {
    const provider = this.providers.get(id);
    if (!provider) throw new Error('character_card_provider_not_found');
    return provider;
  }

  async search(providerId: string, query: string, cursor: string | undefined, limit: number, signal: AbortSignal) {
    const key = JSON.stringify([providerId, query.trim(), cursor || '', limit]);
    const cached = this.searchCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = await this.get(providerId).search({ query, cursor, limit, signal });
    this.searchCache.set(key, { value, expiresAt: Date.now() + 5 * 60_000 });
    return value;
  }

  async detail(providerId: string, externalId: string, signal: AbortSignal) {
    const key = `${providerId}:${externalId}`;
    const cached = this.detailCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = await this.get(providerId).getDetail(externalId, signal);
    this.detailCache.set(key, { value, expiresAt: Date.now() + 15 * 60_000 });
    return value;
  }

  download(providerId: string, externalId: string, signal: AbortSignal): Promise<CardDownload> {
    return this.get(providerId).download(externalId, signal);
  }
}
