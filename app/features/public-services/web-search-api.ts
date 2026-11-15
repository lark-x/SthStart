import { getJson, postJson, putJson } from '@/app/lib/api-client';
import {
  ExtractWebSearchResponseSchema,
  WebSearchResponseSchema,
  WebSearchSettingsSchema,
  WebSearchTestResultSchema,
} from '@sthstart/contracts';
import type {
  ExtractWebSearchResponse,
  WebSearchResponse,
  WebSearchResult,
  WebSearchSettings,
  WebSearchTestResult,
  SaveWebSearchSettings,
} from '@sthstart/contracts';

export function fetchWebSearchSettings(): Promise<WebSearchSettings> {
  return getJson<WebSearchSettings>(
    'web-search/settings',
    undefined,
    WebSearchSettingsSchema,
  );
}

export function saveWebSearchSettings(payload: SaveWebSearchSettings): Promise<WebSearchSettings> {
  return putJson<WebSearchSettings>(
    'web-search/settings',
    payload,
    undefined,
    WebSearchSettingsSchema,
  );
}

export function testWebSearch(): Promise<WebSearchTestResult> {
  return postJson<WebSearchTestResult>(
    'web-search/test',
    {},
    undefined,
    WebSearchTestResultSchema,
  );
}

export function searchWeb(
  query: string,
  maxResults?: number,
): Promise<WebSearchResponse> {
  return postJson<WebSearchResponse>(
    'web-search/search',
    { query, ...(maxResults === undefined ? {} : { maxResults }) },
    undefined,
    WebSearchResponseSchema,
  );
}

export function extractWebSearchItems(
  items: WebSearchResult[],
): Promise<ExtractWebSearchResponse> {
  return postJson<ExtractWebSearchResponse>(
    'web-search/extract',
    { items },
    undefined,
    ExtractWebSearchResponseSchema,
  );
}
