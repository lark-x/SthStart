import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpSource } from '@sthstart/contracts';

export interface McpDiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpToolResult {
  ok: boolean;
  structuredContent?: Record<string, unknown>;
  text: string;
  isError?: boolean;
}

export interface McpConnectionTestResult {
  ok: boolean;
  message: string;
  tools: McpDiscoveredTool[];
  serverInfo?: { name?: string; version?: string };
  testedAt: string;
}

function sanitizeInputSchema(schema: unknown): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return undefined;
  const value = schema as Record<string, unknown>;
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

/**
 * 统一 MCP 客户端：优先使用官方 SDK 的 Streamable HTTP 传输（兼容 JSON 与
 * 请求内 SSE 响应）；虚空终端的兼容调用由其专用适配器负责。
 */
export class McpClient {
  private readonly sdkClient: Client | null = null;
  private readonly transport: StreamableHTTPClientTransport | null = null;
  private readonly url: string;
  private readonly authMode: McpSource['authMode'];
  private readonly authHeaderName: string | null;
  private readonly authHeaderValue: string | null;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;
  private connected = false;

  constructor(
    source: Pick<McpSource, 'url' | 'authMode' | 'authHeaderName'>,
    secret: string | null,
    options: { timeoutMs?: number; fetcher?: typeof fetch } = {},
  ) {
    this.url = source.url;
    this.authMode = source.authMode || 'none';
    this.authHeaderName = source.authHeaderName || null;
    this.authHeaderValue = secret;
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.fetcher = options.fetcher ?? fetch;
    this.sdkClient = new Client({ name: 'SthStart', version: '0.1.0' }, { capabilities: {} });
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (this.authMode === 'bearer' && this.authHeaderValue) {
      headers['authorization'] = `Bearer ${this.authHeaderValue}`;
    } else if (this.authMode === 'header' && this.authHeaderName && this.authHeaderValue) {
      headers[this.authHeaderName.toLowerCase()] = this.authHeaderValue;
    }
    this.transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: { headers },
      fetch: ((url, init) => this.fetcher(url, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(this.timeoutMs)]) })) as typeof fetch,
      reconnectionOptions: { maxReconnectionDelay: 5_000, initialReconnectionDelay: 250, reconnectionDelayGrowFactor: 1.5, maxRetries: 0 },
    });
  }

  private async ensureConnected() {
    if (this.connected) return;
    if (!this.sdkClient || !this.transport) throw new Error('mcp_client_unavailable');
    try {
      await this.sdkClient.connect(this.transport);
      this.connected = true;
    } catch (error) {
      this.connected = false;
      throw new Error(`mcp_connect_failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async testConnection(): Promise<McpConnectionTestResult> {
    const testedAt = new Date().toISOString();
    try {
      await this.ensureConnected();
      const tools = await this.sdkClient!.listTools();
      const discovered = (tools.tools || []).map((tool) => ({
        name: String(tool.name ?? ''),
        description: typeof tool.description === 'string' ? tool.description : undefined,
        inputSchema: sanitizeInputSchema(tool.inputSchema as unknown),
      })).filter((tool) => tool.name);
      const serverInfo = this.sdkClient!.getServerVersion();
      return {
        ok: true,
        message: `${serverInfo?.name ?? 'MCP 服务'}${serverInfo?.version ? ` ${serverInfo.version}` : ''} 已连接，发现 ${discovered.length} 个工具`,
        tools: discovered,
        serverInfo,
        testedAt,
      };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error), tools: [], testedAt };
    }
  }

  async listTools(): Promise<McpDiscoveredTool[]> {
    await this.ensureConnected();
    const tools = await this.sdkClient!.listTools();
    return (tools.tools || []).map((tool) => ({
      name: String(tool.name ?? ''),
      description: typeof tool.description === 'string' ? tool.description : undefined,
      inputSchema: sanitizeInputSchema(tool.inputSchema as unknown),
    })).filter((tool) => tool.name);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    await this.ensureConnected();
    try {
      const result = await this.sdkClient!.callTool({ name, arguments: args });
      const structured = result.structuredContent && typeof result.structuredContent === 'object'
        ? result.structuredContent as Record<string, unknown>
        : undefined;
      const content = Array.isArray(result.content) ? result.content : [];
      const text = content.map((block) => {
        const item = block && typeof block === 'object' ? block as Record<string, unknown> : {};
        if (item.type === 'text') return String(item.text ?? '');
        if (item.type === 'resource') {
          const resource = item.resource && typeof item.resource === 'object' ? item.resource as Record<string, unknown> : {};
          return String(resource.text ?? '');
        }
        return '';
      }).filter(Boolean).join('\n');
      const isError = result.isError === true;
      return { ok: !isError, structuredContent: structured, text, isError };
    } catch (error) {
      return { ok: false, text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async close() {
    if (this.connected && this.sdkClient && this.transport) {
      try { await this.sdkClient.close(); } catch { /* ignore */ }
      this.connected = false;
    }
  }
}

export const AKASHA_PRESET_TOOL_NAMES = ['akasha_search', 'akasha_read', 'akasha_catalog'];
