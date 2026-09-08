export interface CardSearchResult {
  providerId: string;
  externalId: string;
  name: string;
  author: string | null;
  summary: string;
  sourceUrl: string;
  thumbnail: string | null;
  tags: string[];
  language: string | null;
  remoteUpdatedAt: string | null;
  formatHint: string | null;
}

export interface CardSearchPage {
  providerId: string;
  items: CardSearchResult[];
  nextCursor: string | null;
  total: number | null;
}

export interface CardRemoteDetail {
  providerId: string;
  externalId: string;
  name: string;
  author: string | null;
  sourceUrl: string;
  thumbnail: string | null;
  remoteVersion: string | null;
  remoteUpdatedAt: string | null;
  card: Record<string, unknown>;
}

export interface CardDownload {
  providerId: string;
  externalId: string;
  sourceUrl: string;
  contentType: string;
  bytes: Buffer;
  remoteVersion: string | null;
}

export interface CharacterCardProvider {
  id: string;
  name: string;
  capabilities: {
    search: boolean;
    detail: boolean;
    download: boolean;
    importUrl: boolean;
  };
  search(input: { query: string; cursor?: string; limit: number; signal: AbortSignal }): Promise<CardSearchPage>;
  getDetail(externalId: string, signal: AbortSignal): Promise<CardRemoteDetail>;
  download(externalId: string, signal: AbortSignal): Promise<CardDownload>;
  parseSupportedUrl(url: string): { externalId: string } | null;
}

export class CharacterCardProviderError extends Error {
  readonly code: 'provider_unavailable' | 'provider_rate_limited' | 'provider_auth_required' | 'provider_bad_response' | 'provider_download_invalid';
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(code: CharacterCardProviderError['code'], message: string, options: { status?: number | null; retryAfterSeconds?: number | null } = {}) {
    super(message);
    this.name = 'CharacterCardProviderError';
    this.code = code;
    this.status = options.status ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}
