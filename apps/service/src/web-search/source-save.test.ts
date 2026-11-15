import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { Value } from '@sinclair/typebox/value';
import {
  KnowledgePendingListResponseSchema,
  SaveWebSearchSourceResultSchema,
  type WebSearchResult,
} from '@sthstart/contracts';
import { readConfig } from '../config.js';
import { ServiceDatabase } from '../database.js';
import { registerKnowledgeRoutes } from '../knowledge/routes.js';
import { SecretStore } from '../security.js';
import { registerWebSearchRoutes } from './routes.js';

const ADMIN_TOKEN = 'web-search-source-admin-token-0123456789';
const headers = { 'x-sthstart-admin-token': ADMIN_TOKEN };

function item(overrides: Partial<WebSearchResult> = {}): WebSearchResult {
  return {
    id: 'ws_source_1',
    title: '雾港灯塔考据',
    url: 'https://example.com/lighthouse',
    siteName: 'example.com',
    snippet: '灯塔在旧航道北侧，每逢大雾会点亮三层铜灯。',
    content: '灯塔在旧航道北侧，每逢大雾会点亮三层铜灯。守塔人会在潮位最高时更换灯油。',
    retrievedAt: '2026-11-14T08:00:00.000Z',
    contentHash: 'a'.repeat(64),
    status: 'extracted',
    truncated: false,
    ...overrides,
  };
}

async function harness() {
  const app = Fastify();
  const database = new ServiceDatabase();
  const secrets = new SecretStore({});
  const config = readConfig({ STHSTART_ADMIN_TOKEN: ADMIN_TOKEN });
  registerWebSearchRoutes(app, {
    config,
    database,
    secrets,
    fetcher: async () => new Response('unexpected request', { status: 500 }),
  });
  registerKnowledgeRoutes(app, {
    config,
    database,
    narrativeDatabase: null,
    secrets,
    fetcher: async () => new Response('unexpected request', { status: 500 }),
  });
  return { app, database };
}

async function pendingItems(app: Awaited<ReturnType<typeof harness>>['app']) {
  const response = await app.inject({
    url: '/api/v1/admin/knowledge/pending?state=kept&limit=50',
    headers,
  });
  assert.equal(response.statusCode, 200, response.body);
  const payload = response.json();
  assert.ok(Value.Check(KnowledgePendingListResponseSchema, payload));
  return payload.items as Array<Record<string, unknown>>;
}

test('save-source records a kept knowledge pending item visible through the existing pending API', async (t) => {
  const { app, database } = await harness();
  t.after(async () => { await app.close(); database.close(); });

  const response = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/save-source', headers,
    payload: { item: item() },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.ok(Value.Check(SaveWebSearchSourceResultSchema, response.json()));
  const id = response.json().id as string;

  const items = await pendingItems(app);
  assert.equal(items.length, 1);
  const saved = items[0];
  assert.equal(saved.id, id);
  assert.equal(saved.state, 'kept');
  assert.equal(saved.sourceKind, 'web');
  assert.equal(saved.url, 'https://example.com/lighthouse');
  assert.equal(saved.sourceName, 'example.com');
  assert.equal(saved.title, '雾港灯塔考据');
  assert.match(String(saved.excerpt), /守塔人会在潮位最高时更换灯油/);
  assert.equal(saved.truncated, undefined);

  const source = database.connection.prepare(
    "SELECT kind,url,source_name,nature FROM knowledge_sources WHERE url=?",
  ).get('https://example.com/lighthouse') as Record<string, unknown>;
  assert.deepEqual({ ...source }, {
    kind: 'web',
    url: 'https://example.com/lighthouse',
    source_name: 'example.com',
    nature: 'unconfirmed',
  });
  const collection = database.connection.prepare(
    "SELECT frequency,enabled,next_run_at FROM knowledge_collections WHERE name='网页另存'",
  ).get() as Record<string, unknown>;
  assert.deepEqual({ ...collection }, { frequency: 'once', enabled: 0, next_run_at: null });
});

test('repeated saves deduplicate the same content and reuse the pending id', async (t) => {
  const { app, database } = await harness();
  t.after(async () => { await app.close(); database.close(); });

  const first = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/save-source', headers, payload: { item: item() },
  });
  const second = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/save-source', headers, payload: { item: item() },
  });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(second.statusCode, 200, second.body);
  assert.equal(second.json().id, first.json().id);

  assert.equal((await pendingItems(app)).length, 1);
  assert.equal(
    (database.connection.prepare('SELECT COUNT(*) count FROM knowledge_source_versions').get() as { count: number }).count,
    1,
  );
  assert.equal(
    (database.connection.prepare('SELECT COUNT(*) count FROM knowledge_pending_items').get() as { count: number }).count,
    1,
  );
});

test('changed content creates a new version and pending item without duplicating unchanged saves', async (t) => {
  const { app, database } = await harness();
  t.after(async () => { await app.close(); database.close(); });

  const first = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/save-source', headers, payload: { item: item() },
  });
  const changed = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/save-source', headers,
    payload: { item: item({ content: '灯塔已经停用，铜灯被移入港务博物馆。', snippet: '灯塔已经停用。' }) },
  });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(changed.statusCode, 200, changed.body);
  assert.notEqual(changed.json().id, first.json().id);

  const items = await pendingItems(app);
  assert.equal(items.length, 2);
  assert.equal(
    (database.connection.prepare('SELECT COUNT(*) count FROM knowledge_sources').get() as { count: number }).count,
    1,
    'same URL reuses the source identity',
  );
  assert.equal(
    (database.connection.prepare('SELECT COUNT(*) count FROM knowledge_source_versions').get() as { count: number }).count,
    2,
  );

  const unchanged = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/save-source', headers,
    payload: { item: item({ content: '灯塔已经停用，铜灯被移入港务博物馆。', snippet: '灯塔已经停用。' }) },
  });
  assert.equal(unchanged.json().id, changed.json().id);
  assert.equal((await pendingItems(app)).length, 2);
});

test('failed extraction saves an explicitly labeled snippet and marks truncation', async (t) => {
  const { app, database } = await harness();
  t.after(async () => { await app.close(); database.close(); });

  const longSnippet = '摘要'.repeat(5_000);
  const response = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/save-source', headers,
    payload: {
      item: item({
        status: 'failed',
        content: '',
        snippet: longSnippet,
        truncated: true,
        error: 'Blocked by site',
      }),
    },
  });
  assert.equal(response.statusCode, 200, response.body);

  const saved = (await pendingItems(app))[0];
  assert.equal(saved.state, 'kept');
  assert.match(String(saved.excerpt), /^\[提取失败，仅保存搜索摘要\]/);
  assert.match(String(saved.excerpt), /内容已截断/);
  assert.equal(saved.truncated, true);
  assert.ok(String(saved.excerpt).length <= 8_000);
  assert.equal(saved.changeType, 'new');
});

test('saving an existing snapshot is not blocked when search settings are disabled', async (t) => {
  const { app, database } = await harness();
  t.after(async () => { await app.close(); database.close(); });

  const settings = await app.inject({
    method: 'PUT', url: '/api/v1/admin/web-search/settings', headers,
    payload: { enabled: false },
  });
  assert.equal(settings.statusCode, 200, settings.body);
  assert.equal(settings.json().enabled, false);

  const response = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/save-source', headers, payload: { item: item() },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal((await pendingItems(app)).length, 1);
});

test('save-source rejects private URLs and incomplete requests before writing', async (t) => {
  const { app, database } = await harness();
  t.after(async () => { await app.close(); database.close(); });

  const privateUrl = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/save-source', headers,
    payload: { item: item({ url: 'http://192.168.1.4/internal' }) },
  });
  assert.equal(privateUrl.statusCode, 400);
  assert.equal(privateUrl.json().error, 'invalid_web_search_url');

  const missing = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/save-source', headers, payload: {},
  });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().error, 'invalid_web_search_source');

  const unauthorized = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/save-source', payload: { item: item() },
  });
  assert.equal(unauthorized.statusCode, 401);

  assert.equal(
    (database.connection.prepare('SELECT COUNT(*) count FROM knowledge_pending_items').get() as { count: number }).count,
    0,
  );
});
