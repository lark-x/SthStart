import { getJson, postJson } from '@/app/lib/api-client';
import {
  NarrativeHrefResponseSchema,
  NarrativeImportCommitSchema,
  NarrativeImportPreviewSchema,
  NarrativeConnectorsResponseSchema,
  NarrativeReadingSchema,
  NarrativeSearchResponseSchema,
  NarrativeTreeResponseSchema,
  NarrativeWorksResponseSchema,
} from '@sthstart/contracts';
import type {
  NarrativeConnector,
  NarrativeReading,
  NarrativeRemoteDocument,
  NarrativeRemoteResult,
  NarrativeSearchResult,
  NarrativeStoryNode,
  NarrativeWork,
} from '@sthstart/contracts';

export type ImportPreviewReport = {
  id: string;
  report: {
    incoming: Record<string, number>;
    existing: Record<string, number>;
    workExists: boolean;
    note: string;
  };
};

export async function fetchWorks(): Promise<{ items: NarrativeWork[] }> {
  return getJson<{ items: NarrativeWork[] }>('narrative/works', undefined, NarrativeWorksResponseSchema);
}

export async function fetchWorkTree(workId: string): Promise<{ items: NarrativeStoryNode[] }> {
  return getJson<{ items: NarrativeStoryNode[] }>(
    `narrative/works/${workId}/tree`,
    undefined,
    NarrativeTreeResponseSchema
  );
}

export async function fetchReadingNode(nodeId: string): Promise<NarrativeReading> {
  return getJson<NarrativeReading>(`narrative/nodes/${nodeId}/read`, undefined, NarrativeReadingSchema);
}

export async function searchNarrative(
  query: string,
  workId?: string
): Promise<{ items: NarrativeSearchResult[] }> {
  const params = new URLSearchParams({ q: query });
  if (workId) params.set('workId', workId);
  return getJson<{ items: NarrativeSearchResult[] }>(
    `narrative/search?${params.toString()}`,
    undefined,
    NarrativeSearchResponseSchema
  );
}

export async function fetchConnectors(): Promise<{ items: NarrativeConnector[] }> {
  return getJson<{ items: NarrativeConnector[] }>(
    'narrative/connectors',
    undefined,
    NarrativeConnectorsResponseSchema
  );
}

export async function previewNarrativeImport(payload: unknown): Promise<ImportPreviewReport> {
  return postJson<ImportPreviewReport>('narrative/imports/preview', payload, undefined, NarrativeImportPreviewSchema);
}

export async function commitNarrativeImport(previewId: string): Promise<{ workId: string }> {
  return postJson<{ workId: string }>(
    `narrative/imports/${previewId}/commit`,
    undefined,
    undefined,
    NarrativeImportCommitSchema
  );
}

export async function saveUtteranceToNotebook(utteranceId: string): Promise<{ href: string }> {
  return postJson<{ href: string }>(
    `narrative/utterances/${utteranceId}/to-note`,
    undefined,
    undefined,
    NarrativeHrefResponseSchema
  );
}

export async function searchRemoteMcp(params: {
  world: string;
  keyword: string;
  maxResults?: number;
}): Promise<{ items: NarrativeRemoteResult[] }> {
  return postJson<{ items: NarrativeRemoteResult[] }>(
    'narrative/connectors/akasha-mcp/search',
    params
  );
}

export async function readRemoteMcp(params: {
  world: string;
  pathHash: string;
  limit?: number;
}): Promise<NarrativeRemoteDocument> {
  return postJson<NarrativeRemoteDocument>('narrative/connectors/akasha-mcp/read', params);
}

export async function previewRemoteMcpImport(params: {
  world: string;
  pathHash: string;
  title: string;
}): Promise<ImportPreviewReport> {
  return postJson<ImportPreviewReport>(
    'narrative/connectors/akasha-mcp/imports/preview',
    params
  );
}
