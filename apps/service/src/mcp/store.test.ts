import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { McpSourceSave } from '@sthstart/contracts';
import { ServiceDatabase } from '../database.js';
import { SecretStore } from '../security.js';
import { McpSourceStore } from './store.js';

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

function editableSource(url: string, authMode: McpSourceSave['authMode'] = 'bearer'): McpSourceSave {
  return {
    id: 'stable-source',
    name: 'stable',
    url,
    transport: 'streamable-http',
    authMode,
    authHeaderName: authMode === 'header' ? 'x-api-key' : undefined,
    applicableWorks: [],
    universal: true,
    purpose: '',
    allowedTools: [],
    timeoutMs: 45_000,
    status: 'enabled',
  };
}

test('McpSourceStore generates valid letter-prefixed IDs reliably when id is omitted', async () => {
  const database = new ServiceDatabase(':memory:');
  try {
    const store = new McpSourceStore(database, new SecretStore());
    for (let i = 0; i < 20; i += 1) {
      const saved = await store.save({
        name: `zlb-${i}`,
        url: `https://agent.zlb.ink/api/mcp/?n=${i}`,
        authMode: 'none',
        applicableWorks: ['原神'],
        universal: false,
        purpose: '测试新增 MCP',
        allowedTools: [],
        timeoutMs: 45_000,
        status: 'enabled',
      }, null);
      assert.match(saved.source.id, /^[a-z][a-z0-9-]{1,62}$/);
    }
    assert.equal(store.list().length, 20);
  } finally {
    database.close();
  }
});

test('McpSourceStore preserves path trailing slash when supplied in endpoint URL', async () => {
  const database = new ServiceDatabase(':memory:');
  try {
    const store = new McpSourceStore(database, new SecretStore());
    const saved = await store.save({
      name: 'zlb',
      url: 'https://agent.zlb.ink/api/mcp/',
      authMode: 'none',
      applicableWorks: [],
      universal: true,
      purpose: '剧情原文检索',
      allowedTools: [],
      timeoutMs: 45_000,
      status: 'enabled',
    }, null);
    assert.equal(saved.source.url, 'https://agent.zlb.ink/api/mcp/');
  } finally {
    database.close();
  }
});

test('McpSourceStore rejects invalid explicit IDs with clear error code', async () => {
  const database = new ServiceDatabase(':memory:');
  try {
    const store = new McpSourceStore(database, new SecretStore());
    await assert.rejects(
      () => store.save({
        id: '123_bad',
        name: 'bad',
        url: 'https://example.com/mcp',
        authMode: 'none',
        applicableWorks: [],
        universal: true,
        purpose: '',
        allowedTools: [],
        timeoutMs: 45_000,
        status: 'enabled',
      }, null),
      (error: Error & { code?: string }) => error.code === 'invalid_mcp_source_id',
    );
  } finally {
    database.close();
  }
});

test('McpSourceStore defaults legacy saves to auto and persists explicit transports', async () => {
  const database = new ServiceDatabase(':memory:');
  try {
    const store = new McpSourceStore(database, new SecretStore());
    const legacy = await store.save({
      id: 'legacy-source',
      name: 'legacy',
      url: 'https://example.com/mcp',
      authMode: 'none',
      applicableWorks: [],
      universal: true,
      purpose: '',
      allowedTools: [],
      timeoutMs: 45_000,
      status: 'enabled',
    }, null);
    assert.equal(legacy.source.transport, 'auto');

    const sse = await store.save({
      id: 'sse-source',
      name: 'legacy-sse',
      url: 'https://example.com/mcp',
      transport: 'sse',
      authMode: 'none',
      applicableWorks: [],
      universal: true,
      purpose: '',
      allowedTools: [],
      timeoutMs: 45_000,
      status: 'enabled',
    }, null);
    assert.equal(sse.source.transport, 'sse');
    assert.equal(store.get('sse-source')?.transport, 'sse');
  } finally {
    database.close();
  }
});

test('McpSourceStore clears stale connection state and only reuses credentials within the same auth scope', async () => {
  const database = new ServiceDatabase(':memory:');
  try {
    const secrets = new MemorySecrets();
    const store = new McpSourceStore(database, secrets);
    const initial = await store.save({
      ...editableSource('https://one.example.com/mcp'),
      secret: 'old-secret',
    }, null);
    await store.updateDiscoveredTools(initial.source.id, [{ name: 'old_tool' }]);
    await store.updateTestResult(initial.source.id, {
      ok: true,
      message: 'old endpoint connected',
      tools: [{ name: 'old_tool' }],
      testedAt: '2026-11-19T00:00:00.000Z',
    });

    const sameOrigin = await store.save(
      editableSource('https://one.example.com/v2/mcp'),
      store.get(initial.source.id),
    );
    assert.equal(sameOrigin.secretStored, true);
    assert.equal(sameOrigin.source.hasCredential, true);
    assert.equal(secrets.values.get('mcp-source:stable-source'), 'old-secret');
    assert.deepEqual(sameOrigin.source.discoveredTools, []);
    assert.equal(sameOrigin.source.lastTestResult, null);

    const authChanged = await store.save(
      editableSource('https://one.example.com/v2/mcp', 'header'),
      sameOrigin.source,
    );
    assert.equal(authChanged.secretStored, false);
    assert.equal(authChanged.source.hasCredential, false);
    assert.ok(authChanged.warning);
    assert.equal(secrets.values.has('mcp-source:stable-source'), false);

    const rebound = await store.save({
      ...editableSource('https://one.example.com/v2/mcp'),
      secret: 'new-secret',
    }, authChanged.source);
    assert.equal(rebound.source.hasCredential, true);
    const crossOrigin = await store.save(
      editableSource('https://two.example.com/mcp'),
      rebound.source,
    );
    assert.equal(crossOrigin.secretStored, false);
    assert.equal(crossOrigin.source.hasCredential, false);
    assert.equal(secrets.values.has('mcp-source:stable-source'), false);
    assert.deepEqual(crossOrigin.source.discoveredTools, []);
    assert.equal(crossOrigin.source.lastTestResult, null);
  } finally {
    database.close();
  }
});
