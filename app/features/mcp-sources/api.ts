import { adminFetch, getJson, postJson, putJson, deleteJson } from '@/app/lib/api-client';
import { McpSourceListSchema } from '@sthstart/contracts';
import type { McpConnectionTest, McpSource, McpSourceSave } from '@sthstart/contracts';

export async function fetchMcpSources(): Promise<McpSource[]> {
  const data = await getJson<{ items: McpSource[] }>('mcp-sources', undefined, McpSourceListSchema);
  return data.items;
}

export async function createMcpSource(payload: McpSourceSave): Promise<{ source: McpSource; secretStored: boolean; warning: string | null }> {
  return postJson('mcp-sources', payload);
}

export async function updateMcpSource(id: string, payload: McpSourceSave): Promise<{ source: McpSource; secretStored: boolean; warning: string | null }> {
  return putJson(`mcp-sources/${id}`, payload);
}

export async function setMcpSourceStatus(id: string, status: 'enabled' | 'disabled'): Promise<McpSource> {
  const response = await adminFetch(`mcp-sources/${id}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  return (await response.json()) as McpSource;
}

export async function deleteMcpSource(id: string): Promise<{ ok: boolean }> {
  return deleteJson(`mcp-sources/${id}`);
}

export async function testMcpSource(id: string): Promise<McpConnectionTest> {
  return postJson(`mcp-sources/${id}/test`, {});
}

export async function discoverMcpTools(payload: {
  sourceId?: string;
  url: string;
  authMode?: McpSourceSave['authMode'];
  authHeaderName?: string;
  secret?: string;
  timeoutMs?: number;
}): Promise<McpConnectionTest> {
  return postJson('mcp-sources/discover', payload);
}
