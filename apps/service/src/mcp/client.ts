import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport, SseError } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpSource, McpTransport } from '@sthstart/contracts';

type EffectiveMcpTransport = Exclude<McpTransport, 'auto'>;
type McpHttpClientTransport = StreamableHTTPClientTransport | SSEClientTransport;
const MCP_TRANSPORTS = new Set<McpTransport>(['auto', 'streamable-http', 'sse']);
const MCP_AUTH_MODES = new Set<McpSource['authMode']>(['none', 'bearer', 'header']);
const PROTOCOL_MISMATCH_STATUSES = new Set([404, 405, 415]);

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
  transport?: McpTransport;
  testedAt: string;
}

function sanitizeInputSchema(schema: unknown): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return undefined;
  const value = schema as Record<string, unknown>;
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

/** Only an explicit /mcp endpoint may be retried once at its sibling /sse path. */
export function deriveLegacySseEndpoint(endpoint: string | URL): URL | null {
  const source = new URL(endpoint.toString());
  if (!/\/mcp\/?$/.test(source.pathname)) return null;
  source.pathname = source.pathname.replace(/mcp\/?$/, 'sse');
  source.hash = '';
  return source;
}

function isProtocolMismatch(error: unknown): boolean {
  if (error instanceof StreamableHTTPError) {
    if (error.code !== undefined && PROTOCOL_MISMATCH_STATUSES.has(error.code)) return true;
    return error.code === -1 && /unexpected content type/i.test(error.message);
  }
  if (error instanceof SseError) {
    if (error.code !== undefined && PROTOCOL_MISMATCH_STATUSES.has(error.code)) return true;
    return /\b(404|405|415)\b/.test(error.message);
  }
  return false;
}

/**
 * 统一 MCP 客户端：支持 Streamable HTTP 与传统 SSE。auto 只在确认传输协议
 * 不匹配时回退，鉴权、超时和网络错误不会被二次探测掩盖。
 */
export class McpClient {
  private sdkClient: Client | null = null;
  private transport: McpHttpClientTransport | null = null;
  private resolvedTransport: EffectiveMcpTransport | null = null;
  private attemptedTransport: EffectiveMcpTransport | null = null;
  private readonly sourceUrl: URL;
  private readonly configuredTransport: McpTransport;
  private readonly authMode: McpSource['authMode'];
  private readonly authHeaderName: string | null;
  private readonly authHeaderValue: string | null;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;
  private attemptedEndpoint: URL | null = null;

  constructor(
    source: Pick<McpSource, 'url' | 'authMode' | 'authHeaderName' | 'transport'>,
    secret: string | null,
    options: { timeoutMs?: number; fetcher?: typeof fetch } = {},
  ) {
    this.sourceUrl = new URL(source.url);
    if (!['http:', 'https:'].includes(this.sourceUrl.protocol)) throw new Error('invalid_mcp_source_url');
    this.configuredTransport = source.transport ?? 'auto';
    if (!MCP_TRANSPORTS.has(this.configuredTransport)) throw new Error('invalid_mcp_transport');
    this.authMode = source.authMode || 'none';
    if (!MCP_AUTH_MODES.has(this.authMode)) throw new Error('invalid_mcp_auth_mode');
    this.authHeaderName = source.authHeaderName?.trim() || null;
    if (this.authMode === 'header') {
      if (!this.authHeaderName?.trim()) throw new Error('mcp_header_name_required');
      try {
        new Headers({ [this.authHeaderName.trim()]: 'value' });
      } catch {
        throw new Error('invalid_mcp_header_name');
      }
    }
    this.authHeaderValue = secret;
    this.timeoutMs = Math.min(Math.max(options.timeoutMs ?? 45_000, 1_000), 300_000);
    this.fetcher = options.fetcher ?? fetch;
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.authMode === 'bearer' && this.authHeaderValue) {
      headers['authorization'] = `Bearer ${this.authHeaderValue}`;
    } else if (this.authMode === 'header' && this.authHeaderName && this.authHeaderValue) {
      headers[this.authHeaderName.toLowerCase()] = this.authHeaderValue;
    }
    return headers;
  }

  private requestUrl(input: RequestInfo | URL): URL {
    const rawUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    const url = new URL(rawUrl);
    if (url.origin !== this.sourceUrl.origin) throw new Error('mcp_external_origin_blocked');
    return url;
  }

  private requestSignals(input: RequestInfo | URL, init?: RequestInit): AbortSignal[] {
    return [
      ...(input instanceof Request ? [input.signal] : []),
      ...(init?.signal ? [init.signal] : []),
    ];
  }

  private readonly sameOriginFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    this.requestUrl(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (method.toUpperCase() === 'GET' && headers.get('accept')?.includes('text/event-stream')) {
      return this.sseStreamFetch(input, init);
    }
    const signals = [
      AbortSignal.timeout(this.timeoutMs),
      ...this.requestSignals(input, init),
    ];
    return this.fetcher(input, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.any(signals),
    });
  };

  private readonly sseStreamFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    this.requestUrl(input);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('mcp_connect_timeout')), this.timeoutMs);
    try {
      return await this.fetcher(input, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.any([controller.signal, ...this.requestSignals(input, init)]),
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  private createTransport(kind: EffectiveMcpTransport, endpoint: URL): McpHttpClientTransport {
    if (kind === 'sse') {
      return new SSEClientTransport(endpoint, {
        requestInit: { headers: this.authHeaders() },
        eventSourceInit: { fetch: this.sseStreamFetch as typeof fetch },
        fetch: this.sameOriginFetch as typeof fetch,
      });
    }
    return new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: this.authHeaders() },
      fetch: this.sameOriginFetch as typeof fetch,
      reconnectionOptions: {
        maxReconnectionDelay: 5_000,
        initialReconnectionDelay: 250,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: 0,
      },
    });
  }

  private requestOptions() {
    return { timeout: this.timeoutMs, maxTotalTimeout: this.timeoutMs };
  }

  private async connectWith(kind: EffectiveMcpTransport, endpoint = this.sourceUrl): Promise<void> {
    this.attemptedTransport = kind;
    this.attemptedEndpoint = endpoint;
    const client = new Client({ name: 'SthStart', version: '0.1.0' }, { capabilities: {} });
    const transport = this.createTransport(kind, endpoint);
    let handshakeTimer: NodeJS.Timeout | undefined;
    try {
      const handshakeTimeout = new Promise<never>((_resolve, reject) => {
        handshakeTimer = setTimeout(() => reject(new Error('mcp_connect_timeout')), this.timeoutMs);
      });
      await Promise.race([
        client.connect(transport, this.requestOptions()),
        handshakeTimeout,
      ]);
      this.sdkClient = client;
      this.transport = transport;
      this.resolvedTransport = kind;
    } catch (error) {
      try { await client.close(); } catch { /* release a failed initialization */ }
      try { await transport.close(); } catch { /* release a failed initialization */ }
      throw error;
    } finally {
      if (handshakeTimer) clearTimeout(handshakeTimer);
    }
  }

  private errorMessage(error: unknown): string {
    let message = error instanceof Error ? error.message : String(error);
    message = message.split(this.sourceUrl.href).join('[source]');
    if (this.attemptedEndpoint) message = message.split(this.attemptedEndpoint.href).join('[source]');
    if (this.authHeaderValue) message = message.split(this.authHeaderValue).join('[redacted]');
    return message.slice(0, 1_000);
  }

  get transportMode(): McpTransport {
    return this.resolvedTransport ?? this.attemptedTransport ?? this.configuredTransport;
  }

  private async ensureConnected(): Promise<void> {
    if (this.sdkClient) return;
    try {
      if (this.configuredTransport !== 'auto') {
        await this.connectWith(this.configuredTransport);
        return;
      }
      try {
        await this.connectWith('streamable-http');
      } catch (streamableError) {
        if (!isProtocolMismatch(streamableError)) throw streamableError;
        try {
          await this.connectWith('sse', this.sourceUrl);
        } catch (sameAddressSseError) {
          const derived = deriveLegacySseEndpoint(this.sourceUrl);
          if (!isProtocolMismatch(sameAddressSseError) || !derived || derived.href === this.sourceUrl.href) {
            throw sameAddressSseError;
          }
          await this.connectWith('sse', derived);
        }
      }
    } catch (error) {
      throw new Error(`mcp_connect_failed: ${this.errorMessage(error)}`);
    }
  }

  async testConnection(): Promise<McpConnectionTestResult> {
    const testedAt = new Date().toISOString();
    try {
      await this.ensureConnected();
      const tools = await this.sdkClient!.listTools(undefined, this.requestOptions());
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
        transport: this.transportMode,
        testedAt,
      };
    } catch (error) {
      return { ok: false, message: this.errorMessage(error), tools: [], transport: this.transportMode, testedAt };
    }
  }

  async listTools(): Promise<McpDiscoveredTool[]> {
    try {
      await this.ensureConnected();
      const tools = await this.sdkClient!.listTools(undefined, this.requestOptions());
      return (tools.tools || []).map((tool) => ({
        name: String(tool.name ?? ''),
        description: typeof tool.description === 'string' ? tool.description : undefined,
        inputSchema: sanitizeInputSchema(tool.inputSchema as unknown),
      })).filter((tool) => tool.name);
    } catch (error) {
      throw new Error(this.errorMessage(error));
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    await this.ensureConnected();
    try {
      const result = await this.sdkClient!.callTool({ name, arguments: args }, undefined, this.requestOptions());
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
      return { ok: false, text: this.errorMessage(error), isError: true };
    }
  }

  async close() {
    const client = this.sdkClient;
    this.sdkClient = null;
    this.transport = null;
    this.resolvedTransport = null;
    this.attemptedTransport = null;
    this.attemptedEndpoint = null;
    if (client) try { await client.close(); } catch { /* ignore */ }
  }
}

export const AKASHA_PRESET_TOOL_NAMES = ['akasha_search', 'akasha_read', 'akasha_catalog'];
