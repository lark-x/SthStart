import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  ExtractWebSearchResponseSchema,
  WebSearchResponseSchema,
  type WebSearchProvider,
  type WebSearchResult,
} from '@sthstart/contracts';
import { extractWithProvider, SearchProviderError, searchWithProvider } from './providers.js';
import { WEB_SEARCH_CONTENT_LIMIT } from './tavily.js';

function item(provider: WebSearchProvider, path = 'a'): WebSearchResult {
  return {
    id: `ws_${path}`, provider, title: 'Page', url: `https://example.com/${path}`,
    siteName: 'example.com', snippet: 'search summary', content: 'old body',
    retrievedAt: '2026-11-14T00:00:00.000Z', contentHash: 'a'.repeat(64),
    status: 'snippet', truncated: false,
  };
}

test('AnySearch sends the documented search body without Authorization for anonymous use', async () => {
  let calls = 0;
  const result = await searchWithProvider({
    provider: 'anysearch', credential: null, query: 'public query', maxResults: 2,
    fetcher: async (url, init) => {
      calls += 1;
      assert.equal(String(url), 'https://api.anysearch.com/v1/search');
      assert.equal(init?.method, 'POST');
      assert.equal(new Headers(init?.headers).has('authorization'), false);
      assert.deepEqual(JSON.parse(String(init?.body)), { query: 'public query', max_results: 2 });
      return Response.json({ code: 0, data: { results: [
        { title: 'First', url: 'https://EXAMPLE.com:443/a#one', snippet: 'summary' },
        { title: 'Duplicate', url: 'https://example.com/a', content: 'ignored' },
        { title: 'Local', url: 'http://localhost/private', content: 'ignored' },
        { title: '', url: 'https://example.com/b' },
        { title: 'Over limit', url: 'https://example.com/c' },
      ] } });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].url, 'https://example.com/a');
  assert.equal(result.items[0].provider, 'anysearch');
  assert.equal(result.items[0].content, 'summary');
  assert.equal(result.items[1].content, '', 'missing optional snippet/content is supported');
  assert.equal(result.items[1].title, 'https://example.com/b');
  assert.ok(Value.Check(WebSearchResponseSchema, result));
});

test('Exa uses x-api-key and documented search fields and maps highlights', async () => {
  const result = await searchWithProvider({
    provider: 'exa', credential: 'exa-test-key', query: 'query', maxResults: 3,
    fetcher: async (url, init) => {
      assert.equal(String(url), 'https://api.exa.ai/search');
      assert.equal(new Headers(init?.headers).get('x-api-key'), 'exa-test-key');
      assert.equal(new Headers(init?.headers).has('authorization'), false);
      assert.deepEqual(JSON.parse(String(init?.body)), {
        query: 'query', numResults: 3, type: 'auto', contents: { highlights: true },
      });
      return Response.json({ results: [{ url: 'https://example.com/a', title: 'Page', highlights: ['first', 'second'] }] });
    },
  });
  assert.equal(result.items[0].content, 'first\nsecond');
  assert.equal(result.items[0].provider, 'exa');
  assert.ok(Value.Check(WebSearchResponseSchema, result));
});

test('new providers expose bounded friendly errors, never read error bodies, retry or switch providers', async () => {
  for (const provider of ['anysearch', 'exa'] as const) {
    for (const [status, pattern] of [[401, /密钥无效/], [402, /额度已用尽/], [429, /请求过于频繁/], [502, /HTTP 502/]] as const) {
      let calls = 0;
      let readBody = false;
      const response = new Response('password=generated-secret\napi_key=generated-key', { status });
      response.json = async () => { readBody = true; throw new Error('error body must remain unread'); };
      await assert.rejects(searchWithProvider({
        provider, credential: 'configured-key', query: 'query', maxResults: 1,
        fetcher: async url => {
          calls += 1;
          assert.match(String(url), provider === 'anysearch' ? /^https:\/\/api.anysearch.com\// : /^https:\/\/api.exa.ai\//);
          return response;
        },
      }), (error: unknown) => error instanceof SearchProviderError
        && pattern.test(error.message) && !error.message.includes('secret') && !error.message.includes('generated'));
      assert.equal(readBody, false);
      assert.equal(calls, 1);
    }
  }
});

test('malformed, non-success envelope and network responses are rejected without raw details', async () => {
  for (const response of [
    new Response('not JSON'), Response.json([]), Response.json({}),
    Response.json({ code: -1, message: 'private-key', data: { results: [] } }),
    Response.json({ code: 0, data: {} }),
  ]) {
    await assert.rejects(searchWithProvider({
      provider: 'anysearch', credential: null, query: 'query', maxResults: 1,
      fetcher: async () => response,
    }), (error: unknown) => error instanceof SearchProviderError && !error.message.includes('private-key'));
  }
  let calls = 0;
  await assert.rejects(searchWithProvider({
    provider: 'exa', credential: 'key', query: 'query', maxResults: 1,
    fetcher: async () => { calls += 1; throw new Error('network with secret'); },
  }), /Exa 连接失败或超时/);
  assert.equal(calls, 1);
});

test('AnySearch extraction uses only url, Bearer auth, bounds concurrency and preserves partial snapshots', async () => {
  let active = 0;
  let maxActive = 0;
  const inputs = ['ok', 'failed', 'other'].map(path => ({ ...item('anysearch', path), status: 'extracted' as const }));
  const result = await extractWithProvider({
    provider: 'anysearch', credential: 'any-test-key', items: inputs,
    fetcher: async (url, init) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      assert.equal(String(url), 'https://api.anysearch.com/v1/extract');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer any-test-key');
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(Object.keys(body), ['url']);
      active -= 1;
      if (body.url.endsWith('/failed')) return Response.json({ message: 'password=secret' }, { status: 402 });
      return Response.json({ code: 0, data: { url: body.url, content: 'x'.repeat(WEB_SEARCH_CONTENT_LIMIT + 10) } });
    },
  });
  assert.equal(maxActive, 2);
  assert.ok(Value.Check(ExtractWebSearchResponseSchema, result));
  assert.deepEqual(result.items.map(row => row.id), inputs.map(row => row.id));
  assert.equal(result.items[0].status, 'extracted');
  assert.equal(result.items[0].content.length, WEB_SEARCH_CONTENT_LIMIT);
  assert.equal(result.items[0].truncated, true);
  assert.equal(result.items[1].status, 'failed');
  assert.equal(result.items[1].content, 'search summary', 'failed extraction must discard stale full body');
  assert.notEqual(result.items[1].retrievedAt, inputs[1].retrievedAt);
  assert.equal(result.items[1].contentHash, createHash('sha256').update('search summary').digest('hex'));
  assert.match(result.items[1].error!, /额度已用尽/);
  assert.equal(JSON.stringify(result).includes('password=secret'), false);
  assert.equal(result.items[2].status, 'extracted');
});

test('Exa extraction requests text and requires the matching result URL', async () => {
  for (const rows of [[], [{ url: 'https://example.com/other', text: 'wrong page' }], [{ url: 'https://example.com/a', text: '' }], [{ url: 'https://example.com/a', text: 'right page' }]]) {
    const result = await extractWithProvider({
      provider: 'exa', credential: 'exa-test-key', items: [item('exa')],
      fetcher: async (url, init) => {
        assert.equal(String(url), 'https://api.exa.ai/contents');
        assert.deepEqual(JSON.parse(String(init?.body)), { urls: ['https://example.com/a'], text: true });
        return Response.json({ results: rows });
      },
    });
    const succeeded = rows[0]?.text === 'right page';
    assert.equal(result.items[0].status, succeeded ? 'extracted' : 'failed');
    assert.equal(result.items[0].content, succeeded ? 'right page' : 'search summary');
    assert.ok(Value.Check(ExtractWebSearchResponseSchema, result));
  }
});

test('missing credentials and invalid extraction targets cannot reach a provider', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls += 1; return Response.json({}); };
  for (const provider of ['exa', 'tavily'] as const) {
    await assert.rejects(searchWithProvider({ provider, credential: null, query: 'query', maxResults: 1, fetcher }), /尚未配置 API Key/);
  }
  await assert.rejects(extractWithProvider({
    provider: 'anysearch', credential: null, items: [{ ...item('anysearch'), url: 'http://127.0.0.1/' }], fetcher,
  }), /只能提取/);
  const result = await extractWithProvider({
    provider: 'exa', credential: 'key', items: [{ ...item('exa'), url: `https://example.com/${'a'.repeat(2048)}` }], fetcher,
  });
  assert.equal(result.items[0].status, 'failed');
  assert.match(result.items[0].error!, /2,048/);
  assert.equal(calls, 0);
});
