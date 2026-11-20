import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import test from 'node:test';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { McpClient } from './client.js';

function createMockMcpServer(): Server {
  const server = new Server(
    { name: 'SthStart transport mock', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [{
      name: 'echo',
      description: 'Echo text',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    }],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const text = String(request.params.arguments?.text ?? '');
    return {
      content: [{ type: 'text', text: `echo:${text}` }],
      structuredContent: { echo: text },
    };
  });
  return server;
}

interface RunningHttpServer {
  origin: string;
  close(): Promise<void>;
}

async function startHttpServer(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void,
): Promise<RunningHttpServer> {
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    void Promise.resolve(handler(req, res)).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      if (!res.writableEnded) res.end(error instanceof Error ? error.message : String(error));
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('mock_server_address_missing');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function authorized(req: IncomingMessage, name?: string, value?: string): boolean {
  return !name || !value || req.headers[name.toLowerCase()] === value;
}

async function startStreamableMock(options: {
  headerName?: string;
  headerValue?: string;
} = {}) {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
  });
  const server = createMockMcpServer();
  await server.connect(transport);
  let requests = 0;
  const http = await startHttpServer(async (req, res) => {
    requests += 1;
    if (!authorized(req, options.headerName, options.headerValue)) {
      res.writeHead(401).end('unauthorized');
      return;
    }
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/mcp') {
      res.writeHead(404).end('not found');
      return;
    }
    await transport.handleRequest(req, res);
  });
  return {
    ...http,
    get requests() { return requests; },
    close: async () => {
      await server.close();
      await http.close();
    },
  };
}

async function startSseMock(options: {
  headerName?: string;
  headerValue?: string;
  rejectMcp?: boolean;
  mcpDelayMs?: number;
  ssePath?: string;
  sseQuery?: string;
  sameAddressSse?: boolean;
} = {}) {
  const sessions = new Map<string, { transport: SSEServerTransport; server: Server }>();
  let mcpRequests = 0;
  let sseRequests = 0;
  let messageRequests = 0;
  let sseHeaderValue: string | undefined;
  let messageHeaderValue: string | undefined;
  let lastSseUrl: string | undefined;
  const requestPaths: string[] = [];
  const http = await startHttpServer(async (req, res) => {
    if (!authorized(req, options.headerName, options.headerValue)) {
      res.writeHead(401).end('unauthorized');
      return;
    }
    const requestUrl = new URL(req.url ?? '/', 'http://localhost');
    requestPaths.push(requestUrl.pathname);
    if (requestUrl.pathname === '/mcp') mcpRequests += 1;
    if (req.method === 'POST' && requestUrl.pathname === '/messages') {
      messageRequests += 1;
      if (options.headerName) {
        const value = req.headers[options.headerName.toLowerCase()];
        messageHeaderValue = typeof value === 'string' ? value : undefined;
      }
      const session = sessions.get(requestUrl.searchParams.get('sessionId') ?? '');
      if (!session) {
        res.writeHead(404).end('session not found');
        return;
      }
      await session.transport.handlePostMessage(req, res);
      return;
    }
    const expectedQuery = options.sseQuery ? `?${options.sseQuery}` : '';
    const exactSseRequest = requestUrl.pathname === (options.ssePath ?? '/sse') && requestUrl.search === expectedQuery;
    const sameAddressRequest = options.sameAddressSse && requestUrl.pathname === '/mcp';
    if (req.method === 'GET' && (exactSseRequest || sameAddressRequest)) {
      sseRequests += 1;
      lastSseUrl = requestUrl.pathname + requestUrl.search;
      if (options.headerName) {
        const value = req.headers[options.headerName.toLowerCase()];
        sseHeaderValue = typeof value === 'string' ? value : undefined;
      }
      const transport = new SSEServerTransport('/messages', res);
      const server = createMockMcpServer();
      sessions.set(transport.sessionId, { transport, server });
      await server.connect(transport);
      return;
    }
    if (options.mcpDelayMs) await new Promise((resolve) => setTimeout(resolve, options.mcpDelayMs));
    if (!res.destroyed) res.writeHead(options.rejectMcp ? 401 : 404).end('protocol mismatch');
  });
  return {
    ...http,
    get mcpRequests() { return mcpRequests; },
    get sseRequests() { return sseRequests; },
    get messageRequests() { return messageRequests; },
    get sseHeaderValue() { return sseHeaderValue; },
    get messageHeaderValue() { return messageHeaderValue; },
    get lastSseUrl() { return lastSseUrl; },
    get requestPaths() { return [...requestPaths]; },
    close: async () => {
      await Promise.all([...sessions.values()].map(({ server }) => server.close()));
      sessions.clear();
      await http.close();
    },
  };
}

function clientFor(
  url: string,
  transport: 'auto' | 'streamable-http' | 'sse',
  options: { headerName?: string; secret?: string; timeoutMs?: number } = {},
) {
  return new McpClient({
    url,
    transport,
    authMode: options.headerName ? 'header' : 'none',
    authHeaderName: options.headerName,
  }, options.secret ?? null, { timeoutMs: options.timeoutMs });
}

test('streamable-http uses the MCP SDK for discovery and tool calls', async () => {
  const mock = await startStreamableMock({ headerName: 'x-test-key', headerValue: 'top-secret' });
  const client = clientFor(`${mock.origin}/mcp`, 'streamable-http', {
    headerName: 'x-test-key',
    secret: 'top-secret',
  });
  try {
    const result = await client.testConnection();
    assert.equal(result.ok, true, result.message);
    assert.equal(result.transport, 'streamable-http');
    assert.equal(result.tools[0]?.name, 'echo');
    const called = await client.callTool('echo', { text: 'streamable' });
    assert.equal(called.ok, true);
    assert.deepEqual(called.structuredContent, { echo: 'streamable' });
  } finally {
    await client.close();
    await mock.close();
  }
});

test('sse uses the exact custom path and query with auth for discovery and tool calls', async () => {
  const mock = await startSseMock({
    headerName: 'x-test-key',
    headerValue: 'top-secret',
    ssePath: '/custom/sse',
    sseQuery: 'tenant=blue&mode=raw',
  });
  const client = clientFor(`${mock.origin}/custom/sse?tenant=blue&mode=raw`, 'sse', {
    headerName: 'x-test-key',
    secret: 'top-secret',
  });
  try {
    const result = await client.testConnection();
    assert.equal(result.ok, true, result.message);
    assert.equal(result.transport, 'sse');
    assert.equal(mock.sseRequests, 1);
    assert.equal(mock.lastSseUrl, '/custom/sse?tenant=blue&mode=raw');
    assert.equal(mock.sseHeaderValue, 'top-secret');
    const called = await client.callTool('echo', { text: 'sse' });
    assert.equal(called.ok, true);
    assert.deepEqual(called.structuredContent, { echo: 'sse' });
    assert.ok(mock.messageRequests >= 3);
    assert.equal(mock.messageHeaderValue, 'top-secret');
  } finally {
    await client.close();
    await mock.close();
  }
});

test('auto tries same-address SSE before one explicit /mcp to /sse retry', async () => {
  const mock = await startSseMock({ headerName: 'x-test-key', headerValue: 'top-secret' });
  const client = clientFor(`${mock.origin}/mcp`, 'auto', {
    headerName: 'x-test-key',
    secret: 'top-secret',
  });
  try {
    const result = await client.testConnection();
    assert.equal(result.ok, true, result.message);
    assert.equal(result.transport, 'sse');
    assert.equal(mock.mcpRequests, 2);
    assert.equal(mock.sseRequests, 1);
    assert.equal(mock.lastSseUrl, '/sse');
    assert.deepEqual(mock.requestPaths.slice(0, 3), ['/mcp', '/mcp', '/sse']);
    const called = await client.callTool('echo', { text: 'fallback' });
    assert.deepEqual(called.structuredContent, { echo: 'fallback' });
  } finally {
    await client.close();
    await mock.close();
  }
});

test('auto accepts a legacy SSE server exposed at the configured address', async () => {
  const mock = await startSseMock({
    sameAddressSse: true,
    headerName: 'x-test-key',
    headerValue: 'top-secret',
  });
  const client = clientFor(`${mock.origin}/mcp`, 'auto', {
    headerName: 'x-test-key',
    secret: 'top-secret',
  });
  try {
    const result = await client.testConnection();
    assert.equal(result.ok, true, result.message);
    assert.equal(result.transport, 'sse');
    assert.equal(mock.mcpRequests, 2);
    assert.equal(mock.sseRequests, 1);
    assert.equal(mock.lastSseUrl, '/mcp');
    assert.deepEqual(mock.requestPaths.slice(0, 2), ['/mcp', '/mcp']);
  } finally {
    await client.close();
    await mock.close();
  }
});

test('auto does not rewrite arbitrary custom paths to /sse', async () => {
  const mock = await startSseMock({ ssePath: '/only-this-path' });
  const client = clientFor(`${mock.origin}/custom-endpoint`, 'auto');
  try {
    const result = await client.testConnection();
    assert.equal(result.ok, false);
    assert.equal(mock.sseRequests, 0);
    assert.deepEqual(mock.requestPaths.slice(0, 2), ['/custom-endpoint', '/custom-endpoint']);
  } finally {
    await client.close();
    await mock.close();
  }
});

test('an established authenticated SSE session survives beyond the connect timeout', async () => {
  const mock = await startSseMock({ headerName: 'x-test-key', headerValue: 'top-secret' });
  const client = clientFor(`${mock.origin}/sse`, 'sse', {
    headerName: 'x-test-key',
    secret: 'top-secret',
    timeoutMs: 1_000,
  });
  try {
    const result = await client.testConnection();
    assert.equal(result.ok, true, result.message);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const called = await client.callTool('echo', { text: 'still-open' });
    assert.equal(called.ok, true, called.text);
    assert.deepEqual(called.structuredContent, { echo: 'still-open' });
    assert.equal(mock.sseRequests, 1);
  } finally {
    await client.close();
    await mock.close();
  }
});

test('auto does not hide authentication or transport timeout failures with an SSE probe', async () => {
  for (const mode of ['auth', 'timeout'] as const) {
    const mock = await startSseMock(mode === 'auth'
      ? { rejectMcp: true }
      : { mcpDelayMs: 1_500 });
    const client = clientFor(`${mock.origin}/mcp`, 'auto', {
      timeoutMs: mode === 'timeout' ? 1_000 : 5_000,
    });
    try {
      const result = await client.testConnection();
      assert.equal(result.ok, false);
      assert.equal(mock.mcpRequests, 1);
      assert.equal(mock.sseRequests, 0);
    } finally {
      await client.close();
      await mock.close();
    }
  }
});

test('cross-origin redirects are blocked before credentials leave the configured origin', async () => {
  let externalRequests = 0;
  let leakedAuthorization: string | undefined;
  const external = await startHttpServer((req, res) => {
    externalRequests += 1;
    const value = req.headers.authorization;
    leakedAuthorization = typeof value === 'string' ? value : undefined;
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
  const redirector = await startHttpServer((_req, res) => {
    res.writeHead(307, { location: `${external.origin}/mcp` }).end();
  });
  const client = new McpClient({
    url: `${redirector.origin}/mcp`,
    transport: 'streamable-http',
    authMode: 'bearer',
    authHeaderName: undefined,
  }, 'top-secret');
  try {
    const result = await client.testConnection();
    assert.equal(result.ok, false);
    assert.equal(externalRequests, 0);
    assert.equal(leakedAuthorization, undefined);
    assert.equal(result.message.includes('top-secret'), false);
  } finally {
    await client.close();
    await redirector.close();
    await external.close();
  }
});
