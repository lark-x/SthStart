import type { ServiceConfig } from './config.js';
import type { NarrativeImportBundle, NarrativeSourceConnector } from './narrative-types.js';

export type AkashaWorld = 'gi' | 'hsr' | 'bh3';

export interface AkashaSearchResult {
  fileName: string; pathHash: string; totalLines: number;
  hits: Array<{ line: number; snippet: string }>;
  tags: Record<string, string>; sourceTier: 'primary' | 'secondary';
}

export interface AkashaDocument {
  fileName: string; pathHash: string; totalLines: number; tags: Record<string, string>;
  content: string; lineRange: string; remainingCharacters: number;
}

interface McpEnvelope {
  error?: { code: number; message: string };
  result?: { structuredContent?: unknown; tools?: Array<{ name: string }>; serverInfo?: { name?: string; version?: string } };
}

class McpHttpClient {
  constructor(private readonly url: string, private readonly timeoutMs: number, private readonly fetcher: typeof fetch) {}

  async request(method: string, params: Record<string, unknown>) {
    const response = await this.fetcher(this.url, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }), signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`mcp_http_${response.status}`);
    const text = await response.text();
    if (text.length > 4 * 1024 * 1024) throw new Error('mcp_response_too_large');
    const envelope = JSON.parse(text) as McpEnvelope;
    if (envelope.error) throw new Error(`mcp_${envelope.error.code}:${envelope.error.message}`);
    if (!envelope.result) throw new Error('mcp_invalid_response');
    return envelope.result;
  }

  async callTool(name: string, args: Record<string, unknown>) {
    const result = await this.request('tools/call', { name, arguments: args });
    if (!result.structuredContent || typeof result.structuredContent !== 'object') throw new Error('mcp_missing_structured_content');
    return result.structuredContent as Record<string, unknown>;
  }
}

function sourceTier(tags: Record<string, string>) {
  return (tags['文件目录'] ?? '').includes('百科学习笔记') ? 'secondary' as const : 'primary' as const;
}

export class JsonNarrativeConnector implements NarrativeSourceConnector {
  readonly id = 'json'; readonly name = '规范化 JSON'; readonly kind = 'json' as const;
  describe() { return { status: 'ready' as const, capabilities: ['enumerate', 'stableIds', 'locales', 'branching', 'entities'] as const, message: '可导入 schemaVersion 1 的本地 JSON 文件。' }; }
  async probe() { return this.describe(); }
  async normalize(input: unknown) { return input as NarrativeImportBundle; }
}

export class AkashaMcpConnector implements NarrativeSourceConnector {
  readonly id = 'akasha-mcp'; readonly name = '虚空终端 Story MCP'; readonly kind = 'mcp' as const;
  private readonly client: McpHttpClient | null;

  constructor(url: string | null, timeoutMs: number, fetcher: typeof fetch = fetch) {
    this.client = url ? new McpHttpClient(url, timeoutMs, fetcher) : null;
  }

  describe() {
    return this.client
      ? { status: 'ready' as const, capabilities: ['stableIds', 'entities'] as const, message: '已配置；仅在主动搜索、读取或收藏时访问远端。' }
      : { status: 'needs-configuration' as const, capabilities: [] as const, message: '请配置 STHSTART_AKASHA_MCP_URL。' };
  }

  async probe() {
    if (!this.client) return this.describe();
    const initialized = await this.client.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'SthStart', version: '0.1.0' } });
    const listed = await this.client.request('tools/list', {});
    const names = new Set((listed.tools ?? []).map((tool) => tool.name));
    const ready = ['akasha_search', 'akasha_read', 'akasha_catalog'].every((name) => names.has(name));
    const server = initialized.serverInfo;
    return { status: ready ? 'ready' as const : 'unavailable' as const, capabilities: ready ? ['stableIds', 'entities'] as const : [], message: ready ? `${server?.name ?? 'Story MCP'} ${server?.version ?? ''} 已连接`.trim() : '缺少必要的只读工具。' };
  }

  async search(world: AkashaWorld, keyword: string, maxResults = 10): Promise<AkashaSearchResult[]> {
    if (!this.client) throw new Error('akasha_mcp_not_configured');
    const content = await this.client.callTool('akasha_search', { world, keyword, maxResults: Math.min(Math.max(maxResults, 1), 50) });
    const results = Array.isArray(content.results) ? content.results : [];
    return results.slice(0, maxResults).map((value) => {
      const row = value as Record<string, unknown>; const tags = row.tags && typeof row.tags === 'object' ? row.tags as Record<string, string> : {};
      return { fileName: String(row.fileName ?? ''), pathHash: String(row.pathHash ?? ''), totalLines: Number(row.totalLines ?? 0), hits: Array.isArray(row.hits) ? row.hits as AkashaSearchResult['hits'] : [], tags, sourceTier: sourceTier(tags) };
    }).filter((row) => row.pathHash);
  }

  async read(world: AkashaWorld, pathHash: string, offset = 1, limit = 200): Promise<AkashaDocument> {
    if (!this.client) throw new Error('akasha_mcp_not_configured');
    const content = await this.client.callTool('akasha_read', { world, pathHash, offset: Math.max(offset, 1), limit: Math.min(Math.max(limit, 1), 2_000) });
    return { fileName: String(content.fileName ?? ''), pathHash: String(content.pathHash ?? pathHash), totalLines: Number(content.totalLines ?? 0), tags: content.tags && typeof content.tags === 'object' ? content.tags as Record<string, string> : {}, content: String(content.content ?? ''), lineRange: String(content.lineRange ?? ''), remainingCharacters: Number(content.remainingCharacters ?? 0) };
  }

  async readAll(world: AkashaWorld, pathHash: string) {
    const parts: AkashaDocument[] = []; let offset = 1;
    for (let page = 0; page < 100; page += 1) {
      const document = await this.read(world, pathHash, offset, 500); parts.push(document);
      const end = Number(document.lineRange.split('-')[1] ?? document.totalLines);
      if (!document.remainingCharacters || end >= document.totalLines) break;
      offset = end + 1;
    }
    const first = parts[0]; if (!first) throw new Error('akasha_empty_document');
    return { ...first, content: parts.map((part) => part.content).join('\n'), lineRange: `1-${first.totalLines}`, remainingCharacters: 0 };
  }

  async normalize(input: unknown): Promise<NarrativeImportBundle> {
    const value = input as { world: AkashaWorld; document: AkashaDocument; title?: string };
    const worldNames = { gi: '原神', hsr: '崩坏：星穹铁道', bh3: '崩坏3' };
    const lines = value.document.content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return {
      schemaVersion: 1,
      source: { id: 'akasha-terminal', name: '虚空终端 Story MCP', kind: 'mcp', version: '1.27.1' },
      work: { externalId: value.world, title: worldNames[value.world], description: '从虚空终端按需收藏的本地剧情资料。', locale: 'zh-CN' },
      release: { externalId: 'akasha-current', label: '虚空终端当前文本' },
      nodes: [{ externalId: value.document.pathHash, kind: 'document', title: value.title || value.document.fileName, order: 0, metadata: { pathHash: value.document.pathHash, tags: value.document.tags, sourceTier: sourceTier(value.document.tags) } }],
      scenes: [{ externalId: `${value.document.pathHash}:content`, nodeExternalId: value.document.pathHash, title: value.document.fileName, order: 0 }],
      utterances: lines.map((line, index) => {
        const match = line.match(/^([^：]{1,40})：(.+)$/);
        return { externalId: `${value.document.pathHash}:line:${index + 1}`, sceneExternalId: `${value.document.pathHash}:content`, order: index + 1, kind: match ? 'dialogue' as const : 'narration' as const, speaker: match?.[1], text: match?.[2]?.trim() ?? line, metadata: { sourceLine: index + 1, pathHash: value.document.pathHash } };
      }),
    };
  }
}

export function createNarrativeConnectors(config: ServiceConfig, fetcher: typeof fetch = fetch) {
  return [new JsonNarrativeConnector(), new AkashaMcpConnector(config.akashaMcpUrl, config.mcpTimeoutMs, fetcher)] as const;
}
