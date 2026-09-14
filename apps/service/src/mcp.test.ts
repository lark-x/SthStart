import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from './server.js';
import { ServiceDatabase } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';

const adminToken = 'admin-mcp-test-token-123456789012345';
const adminHeaders = { 'x-sthstart-admin-token': adminToken };

class MemorySecrets extends SecretStore {
  readonly values = new Map<string, string>();
  override async status() { return { available: true, backend: 'memory', envFallback: false }; }
  override async get(account: string) {
    const value = this.values.get(account);
    return value === undefined ? { value: null, source: 'none' as const } : { value, source: 'keyring' as const };
  }
  override async set(account: string, value: string) { this.values.set(account, value); }
  override async delete(account: string) { this.values.delete(account); }
}

function mcpFetch(tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>, expectedCredential?: string) {
  return (async (_input: unknown, init?: { method?: string; body?: string; headers?: Record<string, string> | Headers }) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') {
      // 服务器不支持 SSE 流时返回 405，SDK 会按规范跳过并继续 POST 请求。
      return new Response(null, { status: 405 });
    }
    const body = init?.body ? JSON.parse(String(init.body)) as { method?: string; params?: { name?: string } } : {};
    if (expectedCredential && (body.method === 'initialize' || body.method === 'tools/list')) assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + expectedCredential);
    if (body.method === 'initialize') {
      return Response.json({ jsonrpc: '2.0', id: (body as { id?: number }).id ?? 1, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'TestMcpServer', version: '1.0.0' } } });
    }
    if (body.method === 'tools/list') {
      return Response.json({ jsonrpc: '2.0', id: (body as { id?: number }).id ?? 1, result: { tools } });
    }
    return Response.json({ jsonrpc: '2.0', id: (body as { id?: number }).id ?? 1, result: {} });
  }) as unknown as typeof fetch;
}

test('mcp sources can be configured, tested, discovered, disabled, and deleted', async () => {
  const database = new ServiceDatabase();
  const secrets = new MemorySecrets();
  const fetcher = mcpFetch([
    { name: 'search_characters', description: 'Search character profiles', inputSchema: { type: 'object', additionalProperties: false, required: ['keyword'], properties: { keyword: { type: 'string' } } } },
    { name: 'read_document', description: 'Read a document', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
  ], 'top-secret');
  const { app } = await createService({ config: readConfig({ STHSTART_ADMIN_TOKEN: adminToken }), database, secrets, fetcher });

  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/mcp-sources', headers: adminHeaders, payload: {
    id: 'wiki-source',
    name: '角色百科',
    url: 'https://mcp.example.com/mcp',
    authMode: 'bearer',
    secret: 'top-secret',
    applicableWorks: ['原神'],
    universal: false,
    purpose: '角色资料',
    allowedTools: ['search_characters'],
    timeoutMs: 30_000,
  } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().source.name, '角色百科');
  assert.equal(secrets.values.get('mcp-source:wiki-source'), 'top-secret');
  assert.equal(created.json().source.hasCredential, true);
  assert.equal(created.json().source.url.includes('top-secret'), false);

  const listed = await app.inject({ url: '/api/v1/admin/mcp-sources', headers: adminHeaders });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().items.length, 1);
  assert.equal(listed.json().items[0].id, 'wiki-source');

  const tested = await app.inject({ method: 'POST', url: '/api/v1/admin/mcp-sources/wiki-source/test', headers: adminHeaders });
  assert.equal(tested.statusCode, 200);
  assert.equal(tested.json().ok, true);
  assert.equal(tested.json().tools.length, 2);

  const afterTest = await app.inject({ url: '/api/v1/admin/mcp-sources', headers: adminHeaders });
  assert.equal(afterTest.json().items[0].discoveredTools.length, 2);
  assert.equal(afterTest.json().items[0].lastTestResult.ok, true);

  const discovered = await app.inject({ method: 'POST', url: '/api/v1/admin/mcp-sources/discover', headers: adminHeaders,
    payload: { sourceId: 'wiki-source', url: 'https://mcp.example.com/mcp', authMode: 'bearer' } });
  assert.equal(discovered.json().ok, true, discovered.body);
  assert.equal(discovered.json().tools[0].inputSchema.additionalProperties, false);
  assert.deepEqual(discovered.json().tools[0].inputSchema.required, ['keyword']);

  const disabled = await app.inject({ method: 'PATCH', url: '/api/v1/admin/mcp-sources/wiki-source/status', headers: adminHeaders, payload: { status: 'disabled' } });
  assert.equal(disabled.statusCode, 200);
  assert.equal(disabled.json().status, 'disabled');

  const removed = await app.inject({ method: 'DELETE', url: '/api/v1/admin/mcp-sources/wiki-source', headers: adminHeaders });
  assert.equal(removed.statusCode, 200);
  assert.equal(secrets.values.has('mcp-source:wiki-source'), false);

  await app.close(); database.close();
});

test('akasha preset is registered from environment and keeps legacy connector working', async () => {
  const database = new ServiceDatabase();
  const secrets = new MemorySecrets();
  const fetcher = mcpFetch([
    { name: 'akasha_search', inputSchema: { type: 'object', properties: { keyword: { type: 'string' } } } },
    { name: 'akasha_read', inputSchema: { type: 'object', properties: { pathHash: { type: 'string' } } } },
    { name: 'akasha_catalog', inputSchema: { type: 'object', properties: {} } },
  ]);
  const { app } = await createService({
    config: readConfig({ STHSTART_ADMIN_TOKEN: adminToken, STHSTART_AKASHA_MCP_URL: 'https://akasha.example.com/mcp', STHSTART_AKASHA_MCP_KEY: 'akasha-key' }),
    database,
    secrets,
    fetcher,
  });

  const listed = await app.inject({ url: '/api/v1/admin/mcp-sources', headers: adminHeaders });
  assert.equal(listed.statusCode, 200);
  const akasha = listed.json().items.find((item: { id: string }) => item.id === 'akasha-terminal');
  assert.ok(akasha, 'akasha preset should be registered');
  assert.equal(akasha.name, '虚空终端 Story MCP');
  assert.deepEqual(akasha.allowedTools, ['akasha_search', 'akasha_read', 'akasha_catalog']);

  const tested = await app.inject({ method: 'POST', url: '/api/v1/admin/mcp-sources/akasha-terminal/test', headers: adminHeaders });
  assert.equal(tested.statusCode, 200);
  assert.equal(tested.json().ok, true);
  assert.equal(tested.json().tools.length, 3);

  await app.close(); database.close();
});
