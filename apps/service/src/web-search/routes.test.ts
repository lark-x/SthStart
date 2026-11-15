import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { Value } from '@sinclair/typebox/value';
import {
  ExtractWebSearchResponseSchema,
  WebSearchResponseSchema,
  WebSearchSettingsSchema,
  WebSearchTestResultSchema,
} from '@sthstart/contracts';
import { readConfig } from '../config.js';
import { ServiceDatabase } from '../database.js';
import { SecretStore } from '../security.js';
import { registerWebSearchRoutes } from './routes.js';

const ADMIN_TOKEN = 'web-search-isolated-admin-token-20261114';
const headers = { 'x-sthstart-admin-token': ADMIN_TOKEN };
const emptyCredentials = [
  { provider: 'anysearch', hasCredential: false },
  { provider: 'exa', hasCredential: false },
  { provider: 'tavily', hasCredential: false },
];

class MemorySecrets extends SecretStore {
  readonly values = new Map<string, string>();
  readonly environmentValues: Readonly<Record<string, string | undefined>>;
  setCalls = 0;

  override async status() {
    return { available: true, backend: 'memory', envFallback: true };
  }

  override async get(account: string, environmentName?: string) {
    const value = this.values.get(account) ?? (environmentName ? this.environmentValues[environmentName]?.trim() : undefined);
    if (!value) return { value: null, source: 'none' as const };
    return {
      value,
      source: this.values.has(account) ? 'keyring' as const : 'environment' as const,
    };
  }

  override async set(account: string, value: string) {
    this.setCalls += 1;
    this.values.set(account, value);
  }

  constructor(environment: Readonly<Record<string, string | undefined>> = {}) {
    super(environment);
    this.environmentValues = environment;
  }
}

async function harness(fetcher: typeof fetch, environment: Record<string, string | undefined> = {}) {
  const app = Fastify();
  const database = new ServiceDatabase();
  const secrets = new MemorySecrets(environment);
  registerWebSearchRoutes(app, {
    config: readConfig({ STHSTART_ADMIN_TOKEN: ADMIN_TOKEN }),
    database,
    secrets,
    fetcher,
  });
  return { app, database, secrets };
}

test('settings default disabled, store the key without returning it, and expose credential source', async (t) => {
  const { app, database, secrets } = await harness(async () => new Response('unexpected request', { status: 500 }));
  t.after(async () => { await app.close(); database.close(); });

  const initial = await app.inject({ url: '/api/v1/admin/web-search/settings', headers });
  assert.equal(initial.statusCode, 200, initial.body);
  assert.deepEqual(initial.json(), {
    enabled: false, provider: 'tavily', anonymous: false, providers: emptyCredentials,
    hasCredential: false, credentialSource: 'none',
  });
  assert.ok(Value.Check(WebSearchSettingsSchema, initial.json()));

  const saved = await app.inject({
    method: 'PUT',
    url: '/api/v1/admin/web-search/settings',
    headers,
    payload: { enabled: true, apiKey: 'tvly-secret-to-store' },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(saved.json(), {
    enabled: true, provider: 'tavily', anonymous: false,
    providers: emptyCredentials.map(item => ({ ...item, hasCredential: item.provider === 'tavily' })),
    hasCredential: true, credentialSource: 'keyring',
  });
  assert.equal(saved.body.includes('tvly-secret-to-store'), false, 'response must never echo the key');
  assert.equal(secrets.values.get('web-search-tavily'), 'tvly-secret-to-store');
  const row = database.connection.prepare('SELECT data_json FROM sw_authoring_settings WHERE id = ?').get('tavily') as { data_json: string };
  assert.deepEqual(JSON.parse(row.data_json), { enabled: true, provider: 'tavily', anonymous: false });
  assert.equal(row.data_json.includes('tvly-secret-to-store'), false, 'database must not persist the key');

  const envHarness = await harness(async () => new Response('unexpected request', { status: 500 }), {
    STHSTART_TAVILY_API_KEY: 'tvly-from-environment',
  });
  t.after(async () => { await envHarness.app.close(); envHarness.database.close(); });
  const environmentSettings = await envHarness.app.inject({ url: '/api/v1/admin/web-search/settings', headers });
  assert.deepEqual(environmentSettings.json(), {
    enabled: false,
    provider: 'tavily', anonymous: false,
    providers: emptyCredentials.map(item => ({ ...item, hasCredential: item.provider === 'tavily' })),
    hasCredential: true,
    credentialSource: 'environment',
  });
});

test('search is gated by enabled, missing secret and validated input', async (t) => {
  let calls = 0;
  const { app, database } = await harness(async () => { calls += 1; return Response.json({ results: [] }); });
  t.after(async () => { await app.close(); database.close(); });

  const disabled = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/search', headers, payload: { query: 'test' },
  });
  assert.equal(disabled.statusCode, 409);
  assert.equal(disabled.json().error, 'web_search_disabled');
  assert.equal(calls, 0, 'disabled search must not send a network request');
  const disabledTest = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/test', headers, payload: {},
  });
  assert.equal(disabledTest.statusCode, 409);
  assert.equal(disabledTest.json().error, 'web_search_disabled');
  assert.equal(calls, 0, 'disabled test must not send a network request');

  await app.inject({
    method: 'PUT', url: '/api/v1/admin/web-search/settings', headers, payload: { enabled: true },
  });
  const missing = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/search', headers, payload: { query: 'test' },
  });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().error, 'web_search_credential_missing');
  assert.equal(calls, 0);

  await app.inject({
    method: 'PUT', url: '/api/v1/admin/web-search/settings', headers,
    payload: { enabled: true, apiKey: 'tvly-secret' },
  });
  const invalid = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/search', headers, payload: { query: '', maxResults: 11 },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(calls, 0);
});

test('search returns a schema-valid provider success and test endpoint maps failure without retry', async (t) => {
  let calls = 0;
  const { app, database } = await harness(async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as { query: string; max_results: number };
    if (body.query.includes('连接测试')) return Response.json({ error: 'invalid key' }, { status: 401 });
    return Response.json({
      results: [{ title: 'Result', url: 'https://example.com/result', content: 'Body text' }],
    });
  });
  t.after(async () => { await app.close(); database.close(); });

  await app.inject({
    method: 'PUT', url: '/api/v1/admin/web-search/settings', headers,
    payload: { enabled: true, apiKey: 'tvly-secret' },
  });

  const success = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/search', headers,
    payload: { query: 'public query', maxResults: 2 },
  });
  assert.equal(success.statusCode, 200, success.body);
  assert.ok(Value.Check(WebSearchResponseSchema, success.json()));
  assert.equal(success.json().items.length, 1);
  assert.equal(calls, 1);

  const failed = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/test', headers, payload: {},
  });
  assert.equal(failed.statusCode, 200);
  assert.ok(Value.Check(WebSearchTestResultSchema, failed.json()));
  assert.equal(failed.json().ok, false);
  assert.equal(calls, 2, 'test endpoint performs exactly one upstream attempt');
});

test('extract rejects private URLs before contacting Tavily and returns per-item failures', async (t) => {
  let calls = 0;
  const { app, database } = await harness(async () => {
    calls += 1;
    return Response.json({
      results: [{ url: 'https://example.com/ok', raw_content: 'Extracted body' }],
      failed_results: [{ url: 'https://example.com/bad', error: '403 from site' }],
    });
  });
  t.after(async () => { await app.close(); database.close(); });

  await app.inject({
    method: 'PUT', url: '/api/v1/admin/web-search/settings', headers,
    payload: { enabled: true, apiKey: 'tvly-secret' },
  });

  const item = {
    id: 'ws_1', title: 'Local', url: 'http://192.168.1.4/', siteName: '192.168.1.4',
    snippet: '', content: '', retrievedAt: '2026-11-14T00:00:00.000Z',
    contentHash: 'a'.repeat(64), status: 'snippet', truncated: false,
  };
  const rejected = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/extract', headers, payload: { items: [item] },
  });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.json().error, 'invalid_web_search_url');
  assert.equal(calls, 0, 'invalid URL must not reach the provider');

  const partial = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/extract', headers,
    payload: { items: [
      { ...item, url: 'https://example.com/ok', siteName: 'example.com' },
      { ...item, id: 'ws_2', url: 'https://example.com/bad', siteName: 'example.com' },
    ] },
  });
  assert.equal(partial.statusCode, 200, partial.body);
  assert.ok(Value.Check(ExtractWebSearchResponseSchema, partial.json()));
  assert.equal(partial.json().items[0].status, 'extracted');
  assert.equal(partial.json().items[1].status, 'failed');
  assert.equal(partial.json().items[1].error, '403 from site');
  assert.equal(calls, 1);
});

test('all routes reject a missing or wrong admin token before touching settings or Tavily', async (t) => {
  let calls = 0;
  const { app, database } = await harness(async () => {
    calls += 1;
    return Response.json({ results: [] });
  });
  t.after(async () => { await app.close(); database.close(); });

  const requests = [
    { method: 'GET' as const, url: '/api/v1/admin/web-search/settings' },
    { method: 'PUT' as const, url: '/api/v1/admin/web-search/settings', payload: { enabled: true } },
    { method: 'POST' as const, url: '/api/v1/admin/web-search/test', payload: {} },
    { method: 'POST' as const, url: '/api/v1/admin/web-search/search', payload: { query: 'q' } },
    { method: 'POST' as const, url: '/api/v1/admin/web-search/extract', payload: { items: [] } },
  ];
  for (const request of requests) {
    const missing = await app.inject(request);
    assert.equal(missing.statusCode, 401, `${request.method} ${request.url} without token`);
    assert.equal(missing.json().error, 'unauthorized');
    const wrong = await app.inject({
      ...request,
      headers: { 'x-sthstart-admin-token': 'wrong-admin-token' },
    });
    assert.equal(wrong.statusCode, 401, `${request.method} ${request.url} with wrong token`);
    assert.equal(wrong.json().error, 'unauthorized');
  }
  assert.equal(calls, 0);
  const row = database.connection.prepare('SELECT data_json FROM sw_authoring_settings WHERE id=?').get('tavily');
  assert.equal(row, undefined, 'rejected settings writes must not persist');
});

test('routes reject when no admin token is configured', async (t) => {
  const app = Fastify();
  const database = new ServiceDatabase();
  registerWebSearchRoutes(app, {
    config: readConfig({}),
    database,
    secrets: new MemorySecrets(),
    fetcher: async () => new Response('unexpected request', { status: 500 }),
  });
  t.after(async () => { await app.close(); database.close(); });

  for (const url of ['/api/v1/admin/web-search/settings']) {
    const response = await app.inject({ url, headers: { 'x-sthstart-admin-token': ADMIN_TOKEN } });
    assert.equal(response.statusCode, 401, 'unconfigured admin must reject any token');
  }
});

test('test endpoint returns status-specific friendly messages and never the upstream body', async () => {
  const statuses = [
    { status: 401, pattern: /API Key 无效或无权访问/ },
    { status: 429, pattern: /请求过于频繁/ },
    { status: 432, pattern: /套餐额度已用尽/ },
    { status: 433, pattern: /按量付费额度已用尽/ },
  ];
  for (const { status, pattern } of statuses) {
    let calls = 0;
    const { app, database } = await harness(async () => {
      calls += 1;
      return Response.json(
        { error: `upstream echoed tvly-secret and raw details` },
        { status },
      );
    });
    try {
      await app.inject({
        method: 'PUT', url: '/api/v1/admin/web-search/settings', headers,
        payload: { enabled: true, apiKey: 'tvly-secret' },
      });
      const response = await app.inject({
        method: 'POST', url: '/api/v1/admin/web-search/test', headers, payload: {},
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.ok(Value.Check(WebSearchTestResultSchema, response.json()));
      assert.equal(response.json().ok, false);
      assert.match(response.json().message, pattern);
      assert.equal(response.body.includes('tvly-secret'), false);
      assert.equal(response.body.includes('raw details'), false);
      assert.equal(calls, 1);
    } finally {
      await app.close();
      database.close();
    }
  }
});

test('search and extract expose status-specific failures without upstream details', async () => {
  const cases: Array<{ status: number; pattern: RegExp }> = [
    { status: 401, pattern: /API Key 无效或无权访问/ },
    { status: 429, pattern: /请求过于频繁/ },
    { status: 432, pattern: /套餐额度已用尽/ },
    { status: 433, pattern: /按量付费额度已用尽/ },
  ];
  for (const { status, pattern } of cases) {
    let calls = 0;
    const { app, database } = await harness(async () => {
      calls += 1;
      return Response.json({ error: 'upstream-secret-body' }, { status });
    });
    try {
      await app.inject({
        method: 'PUT', url: '/api/v1/admin/web-search/settings', headers,
        payload: { enabled: true, apiKey: 'tvly-secret' },
      });
      const item = {
        id: 'ws_1', title: 'Result', url: 'https://example.com/a', siteName: 'example.com',
        snippet: 's', content: 's', retrievedAt: '2026-11-14T00:00:00.000Z',
        contentHash: 'a'.repeat(64), status: 'snippet', truncated: false,
      };
      for (const request of [
        { url: '/api/v1/admin/web-search/search', payload: { query: 'q' } },
        { url: '/api/v1/admin/web-search/extract', payload: { items: [item] } },
      ]) {
        const response = await app.inject({ method: 'POST', url: request.url, headers, payload: request.payload });
        assert.equal(response.statusCode, 502, response.body);
        assert.match(response.json().message, pattern);
        assert.equal(response.body.includes('upstream-secret-body'), false);
      }
      assert.equal(calls, 2, 'each route attempts once and never retries');
    } finally {
      await app.close();
      database.close();
    }
  }
});

test('legacy Tavily settings and requests remain valid without provider fields', async (t) => {
  let calls = 0;
  const { app, database } = await harness(async (url, init) => {
    calls += 1;
    assert.equal(String(url), 'https://api.tavily.com/search');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer legacy-environment-key');
    return Response.json({ results: [] });
  }, { STHSTART_TAVILY_API_KEY: 'legacy-environment-key' });
  t.after(async () => { await app.close(); database.close(); });
  database.connection.prepare('INSERT INTO sw_authoring_settings (id,data_json,updated_at) VALUES (?,?,?)')
    .run('tavily', '{"enabled":true}', '2026-11-14T00:00:00.000Z');
  const settings = await app.inject({ url: '/api/v1/admin/web-search/settings', headers });
  assert.equal(settings.json().provider, 'tavily');
  assert.equal(settings.json().anonymous, false);
  assert.equal(settings.json().enabled, true);
  const search = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/search', headers, payload: { query: 'legacy' },
  });
  assert.equal(search.statusCode, 200, search.body);
  assert.equal(calls, 1);
});

test('providers keep independent credentials, blank saves retain keys and anonymous use sends none', async (t) => {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const { app, database, secrets } = await harness(async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers) });
    const results = [{ url: 'https://example.com/a', title: 'Page', snippet: 'Summary' }];
    return Response.json(String(url).includes('anysearch') ? { code: 0, data: { results } } : { results });
  });
  t.after(async () => { await app.close(); database.close(); });
  const save = (payload: Record<string, unknown>) => app.inject({
    method: 'PUT', url: '/api/v1/admin/web-search/settings', headers, payload: { enabled: true, ...payload },
  });
  const search = () => app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/search', headers, payload: { query: 'query' },
  });

  const first = await save({ provider: 'tavily', apiKey: 'tavily-independent-key' });
  assert.equal(first.statusCode, 200, first.body);
  const anonymous = await save({ provider: 'anysearch' });
  assert.equal(anonymous.statusCode, 200, anonymous.body);
  assert.equal(anonymous.json().anonymous, true, 'entering AnySearch without an explicit mode selects anonymous');
  assert.equal(anonymous.json().hasCredential, false, 'anonymous access does not invent a stored credential');
  assert.equal((await search()).statusCode, 200);
  assert.equal(calls[0].headers.has('authorization'), false);
  assert.equal(calls[0].headers.has('x-api-key'), false);

  const keyed = await save({ provider: 'anysearch', anonymous: false, apiKey: 'anysearch-independent-key' });
  assert.equal(keyed.statusCode, 200, keyed.body);
  assert.equal((await search()).statusCode, 200);
  assert.equal(calls[1].headers.get('authorization'), 'Bearer anysearch-independent-key');
  const retained = await save({ apiKey: '  ' });
  assert.equal(retained.json().provider, 'anysearch');
  assert.equal(retained.json().anonymous, false, 'partial updates retain an explicit keyed mode');
  assert.equal(secrets.setCalls, 2);
  await save({ anonymous: true });
  assert.equal((await search()).statusCode, 200);
  assert.equal(calls[2].headers.has('authorization'), false, 'anonymous ignores a previously saved key');

  const exaMissing = await save({ provider: 'exa' });
  assert.equal(exaMissing.json().anonymous, false);
  assert.equal(exaMissing.json().hasCredential, false);
  const missing = await search();
  assert.equal(missing.statusCode, 400);
  assert.equal(calls.length, 3, 'Exa cannot reuse another provider key');
  const exa = await save({ provider: 'exa', apiKey: 'exa-independent-key' });
  assert.equal(exa.statusCode, 200, exa.body);
  assert.equal((await search()).statusCode, 200);
  assert.equal(calls[3].headers.get('x-api-key'), 'exa-independent-key');
  assert.equal(calls[3].headers.has('authorization'), false);

  const back = await save({ provider: 'tavily', apiKey: '' });
  assert.equal(back.statusCode, 200, back.body);
  assert.deepEqual(back.json().providers, emptyCredentials.map(row => ({ ...row, hasCredential: true })));
  assert.equal((await search()).statusCode, 200);
  assert.equal(calls[4].headers.get('authorization'), 'Bearer tavily-independent-key');
  assert.equal(secrets.setCalls, 3);
  for (const provider of ['tavily', 'anysearch', 'exa']) {
    assert.equal(secrets.values.get(`web-search-${provider}`), `${provider}-independent-key`);
    assert.equal(back.body.includes(`${provider}-independent-key`), false);
  }
  const stored = database.connection.prepare('SELECT data_json FROM sw_authoring_settings WHERE id=?').get('tavily') as { data_json: string };
  assert.deepEqual(JSON.parse(stored.data_json), { enabled: true, provider: 'tavily', anonymous: false });
});

test('disabled anonymous mode and unavailable selected-provider credentials do not make requests', async (t) => {
  let calls = 0;
  const { app, database } = await harness(async () => { calls += 1; return Response.json({}); });
  t.after(async () => { await app.close(); database.close(); });
  for (const [payload, status] of [
    [{ enabled: false, provider: 'anysearch', anonymous: true }, 409],
    [{ enabled: true, provider: 'anysearch', anonymous: false }, 400],
    [{ enabled: true, provider: 'exa', anonymous: true }, 400],
  ] as const) {
    const saved = await app.inject({ method: 'PUT', url: '/api/v1/admin/web-search/settings', headers, payload });
    assert.equal(saved.statusCode, 200, saved.body);
    for (const url of ['/api/v1/admin/web-search/search', '/api/v1/admin/web-search/test']) {
      const response = await app.inject({ method: 'POST', url, headers, payload: { query: 'query' } });
      assert.equal(response.statusCode, status, response.body);
    }
  }
  assert.equal(calls, 0);
});

test('extract rejects stale provider results before requests and accepts results tagged with the current provider', async (t) => {
  let calls = 0;
  const { app, database } = await harness(async (url, init) => {
    calls += 1;
    assert.equal(String(url), 'https://api.anysearch.com/v1/extract');
    const body = JSON.parse(String(init?.body));
    return Response.json({ code: 0, data: { url: body.url, content: 'extracted content' } });
  });
  t.after(async () => { await app.close(); database.close(); });
  const saved = await app.inject({
    method: 'PUT', url: '/api/v1/admin/web-search/settings', headers,
    payload: { provider: 'anysearch', enabled: true, anonymous: true },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const result = {
    id: 'ws_1', title: 'Page', url: 'https://example.com/a', siteName: 'example.com',
    snippet: 'summary', content: 'summary', retrievedAt: '2026-11-14T00:00:00.000Z',
    contentHash: 'a'.repeat(64), status: 'snippet', truncated: false,
  };
  for (const row of [result, { ...result, provider: 'tavily' }, { ...result, provider: 'exa' }]) {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/admin/web-search/extract', headers, payload: { items: [row] },
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, 'search_provider_changed');
  }
  assert.equal(calls, 0);
  const extracted = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/extract', headers,
    payload: { items: [{ ...result, provider: 'anysearch' }] },
  });
  assert.equal(extracted.statusCode, 200, extracted.body);
  assert.equal(extracted.json().items[0].content, 'extracted content');
  assert.ok(Value.Check(ExtractWebSearchResponseSchema, extracted.json()));
  assert.equal(calls, 1);
});

test('settings reject invalid provider/mode and retain old settings when credential storage fails', async (t) => {
  const { app, database, secrets } = await harness(async () => { throw new Error('must not fetch'); });
  t.after(async () => { await app.close(); database.close(); });
  const save = (payload: Record<string, unknown>) => app.inject({ method: 'PUT', url: '/api/v1/admin/web-search/settings', headers, payload });
  for (const payload of [
    { enabled: true, provider: 'unknown' }, { enabled: true, anonymous: 'true' },
    { enabled: true, providers: [] }, { enabled: true, apiKey: 'x'.repeat(1001) },
  ]) {
    assert.equal((await save(payload)).statusCode, 400);
  }
  const before = await app.inject({ url: '/api/v1/admin/web-search/settings', headers });
  secrets.status = async () => ({ available: false, backend: 'memory', envFallback: true });
  const unavailable = await save({ enabled: true, provider: 'exa', apiKey: 'new-key' });
  assert.equal(unavailable.statusCode, 503);
  assert.match(unavailable.json().message, /STHSTART_EXA_API_KEY/);
  assert.equal(secrets.setCalls, 0);
  secrets.status = async () => ({ available: true, backend: 'memory', envFallback: true });
  secrets.set = async () => { throw new Error('raw secret store error'); };
  const thrown = await save({ enabled: true, provider: 'anysearch', apiKey: 'new-key' });
  assert.equal(thrown.statusCode, 503);
  assert.equal(thrown.body.includes('raw secret'), false);
  secrets.set = async () => {};
  const silent = await save({ enabled: true, provider: 'exa', apiKey: 'new-key' });
  assert.equal(silent.statusCode, 503);
  assert.equal(silent.json().error, 'web_search_credential_not_stored');
  const after = await app.inject({ url: '/api/v1/admin/web-search/settings', headers });
  assert.deepEqual(after.json(), before.json());
  assert.equal(database.connection.prepare('SELECT data_json FROM sw_authoring_settings WHERE id=?').get('tavily'), undefined);
});

test('each provider resolves its own environment key and blank settings saves do not overwrite it', async (t) => {
  let calls = 0;
  const { app, database, secrets } = await harness(async (url, init) => {
    calls += 1;
    const provider = String(url).includes('anysearch') ? 'anysearch' : String(url).includes('exa.ai') ? 'exa' : 'tavily';
    const requestHeaders = new Headers(init?.headers);
    assert.equal(requestHeaders.get(provider === 'exa' ? 'x-api-key' : 'authorization'),
      provider === 'exa' ? 'exa-env' : `Bearer ${provider}-env`);
    return Response.json(provider === 'anysearch' ? { code: 0, data: { results: [] } } : { results: [] });
  }, {
    STHSTART_TAVILY_API_KEY: 'tavily-env', STHSTART_EXA_API_KEY: 'exa-env', STHSTART_ANYSEARCH_API_KEY: 'anysearch-env',
  });
  t.after(async () => { await app.close(); database.close(); });
  for (const provider of ['anysearch', 'exa', 'tavily']) {
    const saved = await app.inject({
      method: 'PUT', url: '/api/v1/admin/web-search/settings', headers,
      payload: { enabled: true, provider, anonymous: false, apiKey: '' },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().credentialSource, 'environment');
    assert.equal(saved.json().hasCredential, true);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/admin/web-search/test', headers })).json().ok, true);
  }
  assert.equal(calls, 3);
  assert.equal(secrets.setCalls, 0);
});

test('an in-flight search keeps its original provider and credential when settings change during key lookup', async (t) => {
  let calls = 0;
  const { app, database, secrets } = await harness(async (url, init) => {
    calls += 1;
    assert.equal(String(url), 'https://api.exa.ai/search');
    assert.equal(new Headers(init?.headers).get('x-api-key'), 'in-flight-exa-key');
    return Response.json({ results: [{ url: 'https://example.com/a', title: 'Page' }] });
  });
  t.after(async () => { await app.close(); database.close(); });
  const saved = await app.inject({
    method: 'PUT', url: '/api/v1/admin/web-search/settings', headers,
    payload: { enabled: true, provider: 'exa', apiKey: 'in-flight-exa-key' },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const originalGet = secrets.get.bind(secrets);
  secrets.get = async (account, environmentName) => {
    if (account === 'web-search-exa') {
      // Model a concurrent settings write while credential resolution is pending.
      database.connection.prepare('UPDATE sw_authoring_settings SET data_json=? WHERE id=?')
        .run('{"enabled":true,"provider":"anysearch","anonymous":true}', 'tavily');
    }
    return originalGet(account, environmentName);
  };
  const response = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/search', headers, payload: { query: 'query' },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().items[0].provider, 'exa');
  assert.equal(calls, 1);
  const current = await app.inject({ url: '/api/v1/admin/web-search/settings', headers });
  assert.equal(current.json().provider, 'anysearch');
});

test('anonymous quota failures are safe across test/search/extract without retries or fallback', async (t) => {
  let calls = 0;
  const { app, database, secrets } = await harness(async (url, init) => {
    calls += 1;
    assert.match(String(url), /^https:\/\/api.anysearch.com\/v1\//);
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return Response.json({ message: 'username=generated-user\npassword=generated-password\napi_key=generated-key' }, { status: 402 });
  });
  t.after(async () => { await app.close(); database.close(); });
  const saved = await app.inject({
    method: 'PUT', url: '/api/v1/admin/web-search/settings', headers,
    payload: { enabled: true, provider: 'anysearch', anonymous: true },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const testResponse = await app.inject({ method: 'POST', url: '/api/v1/admin/web-search/test', headers });
  assert.equal(testResponse.statusCode, 200, testResponse.body);
  assert.equal(testResponse.json().ok, false);
  assert.match(testResponse.json().message, /额度已用尽/);
  const search = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/search', headers, payload: { query: 'query' },
  });
  assert.equal(search.statusCode, 502);
  assert.match(search.json().message, /额度已用尽/);
  const extract = await app.inject({
    method: 'POST', url: '/api/v1/admin/web-search/extract', headers,
    payload: { items: [{
      id: 'ws_1', provider: 'anysearch', title: 'Page', url: 'https://example.com/a', siteName: 'example.com',
      snippet: 'summary', content: 'summary', retrievedAt: '2026-11-14T00:00:00.000Z',
      contentHash: 'a'.repeat(64), status: 'snippet', truncated: false,
    }] },
  });
  assert.equal(extract.statusCode, 200, extract.body);
  assert.equal(extract.json().items[0].status, 'failed');
  assert.equal(extract.json().items[0].content, 'summary');
  assert.match(extract.json().items[0].error, /额度已用尽/);
  for (const response of [testResponse, search, extract]) {
    assert.equal(response.body.includes('generated-'), false);
  }
  assert.equal(calls, 3, 'each action attempts AnySearch exactly once');
  assert.equal(secrets.setCalls, 0, 'generated credentials are never adopted');
});
