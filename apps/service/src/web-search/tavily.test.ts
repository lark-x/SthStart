import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  ExtractWebSearchResponseSchema,
  WebSearchResponseSchema,
  type WebSearchResult,
} from '@sthstart/contracts';
import {
  canonicalResultUrl,
  extractWithTavily,
  searchWithTavily,
  TavilyRequestError,
  TAVILY_EXTRACT_URL,
  TAVILY_SEARCH_URL,
  WEB_SEARCH_CONTENT_LIMIT,
} from './tavily.js';

const CREDENTIAL = 'tvly-test-secret-value';

function captureFetch(response: () => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return response();
  };
  return { calls, fetcher };
}

function snippetItem(url = 'https://example.com/a'): WebSearchResult {
  return {
    id: 'ws_1',
    title: 'Example',
    url,
    siteName: 'example.com',
    snippet: 'short',
    content: 'short',
    retrievedAt: '2026-11-14T00:00:00.000Z',
    contentHash: 'a'.repeat(64),
    status: 'snippet',
    truncated: false,
  };
}

test('search sends the fixed Tavily request shape and maps results', async () => {
  const { calls, fetcher } = captureFetch(() => Response.json({
    results: [
      { title: 'Public page', url: 'https://www.example.com/page', content: 'Public content' },
      { title: 'Local page', url: 'http://127.0.0.1/private', content: 'must not pass' },
    ],
  }));

  const result = await searchWithTavily({
    credential: CREDENTIAL,
    query: 'test query',
    maxResults: 10,
    fetcher,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, TAVILY_SEARCH_URL);
  assert.equal(calls[0].init?.method, 'POST');
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get('authorization'), `Bearer ${CREDENTIAL}`);
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    query: 'test query',
    search_depth: 'basic',
    max_results: 10,
    auto_parameters: false,
    include_answer: false,
    include_images: false,
    include_raw_content: false,
  });
  assert.equal(result.query, 'test query');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].url, 'https://www.example.com/page');
  assert.equal(result.items[0].siteName, 'example.com');
  assert.equal(result.items[0].status, 'snippet');
  assert.equal(result.items[0].contentHash.length, 64);
  assert.ok(Value.Check(WebSearchResponseSchema, result));
});

test('search deduplicates canonical URLs and keeps ids stable across order changes', async () => {
  const firstOrder = captureFetch(() => Response.json({
    results: [
      { title: 'First copy', url: 'https://Example.com:443/a#one', content: 'one' },
      { title: 'Second copy', url: 'https://example.com/a', content: 'two' },
      { title: 'Other page', url: 'https://example.com/b', content: 'three' },
    ],
  }));
  const secondOrder = captureFetch(() => Response.json({
    results: [
      { title: 'Other page', url: 'https://example.com/b', content: 'three' },
      { title: 'Second copy', url: 'https://example.com/a', content: 'two' },
      { title: 'First copy', url: 'https://Example.com:443/a#one', content: 'one' },
    ],
  }));

  const first = await searchWithTavily({
    credential: CREDENTIAL, query: 'same query', maxResults: 10, fetcher: firstOrder.fetcher,
  });
  const second = await searchWithTavily({
    credential: CREDENTIAL, query: 'same query', maxResults: 10, fetcher: secondOrder.fetcher,
  });

  assert.equal(first.items.length, 2);
  assert.equal(second.items.length, 2);
  const firstIds = Object.fromEntries(first.items.map((item) => [canonicalResultUrl(item.url), item.id]));
  const secondIds = Object.fromEntries(second.items.map((item) => [canonicalResultUrl(item.url), item.id]));
  assert.deepEqual(secondIds, firstIds);
  assert.equal(
    new Set(first.items.map((item) => item.id)).size,
    2,
    'canonical duplicates must not create duplicate result identities',
  );
  assert.equal(first.items.find((item) => item.url === 'https://example.com/a')?.title, 'First copy');
  assert.equal(canonicalResultUrl('https://Example.com:443/a#x'), 'https://example.com/a');
});

test('search maps provider statuses to friendly errors without echoing upstream bodies or the key', async () => {
  const cases: Array<[number, RegExp]> = [
    [401, /API Key 无效或无权访问/],
    [429, /请求过于频繁/],
    [432, /套餐额度已用尽/],
    [433, /按量付费额度已用尽/],
  ];
  for (const [status, expected] of cases) {
    const { calls, fetcher } = captureFetch(() => Response.json(
      { error: { message: `upstream says ${CREDENTIAL} is bad` } },
      { status },
    ));
    await assert.rejects(
      searchWithTavily({ credential: CREDENTIAL, query: 'q', maxResults: 3, fetcher }),
      (error: unknown) => error instanceof TavilyRequestError
        && expected.test(error.message)
        && !error.message.includes(CREDENTIAL)
        && !error.message.includes('upstream says'),
      String(status),
    );
    assert.equal(calls.length, 1, `HTTP ${status} must not be retried`);
  }
});

test('search reports timeout and network failures distinctly without retrying', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    throw new DOMException('timed out', 'TimeoutError');
  };
  await assert.rejects(
    searchWithTavily({ credential: CREDENTIAL, query: 'q', maxResults: 2, fetcher }),
    /Tavily 请求超时/,
  );
  assert.equal(calls, 1);

  const network = captureFetch(() => { throw new TypeError('fetch failed'); });
  await assert.rejects(
    searchWithTavily({ credential: CREDENTIAL, query: 'q', maxResults: 2, fetcher: network.fetcher }),
    /无法连接 Tavily/,
  );
  assert.equal(network.calls.length, 1);
});

test('extract maps partial success, preserves failures per item and truncates content', async () => {
  const longContent = 'x'.repeat(WEB_SEARCH_CONTENT_LIMIT + 50);
  const { calls, fetcher } = captureFetch(() => Response.json({
    results: [
      { url: 'https://example.com/ok', raw_content: longContent },
      { url: 'https://example.com/empty', raw_content: '' },
    ],
    failed_results: [
      { url: 'https://example.com/failed', error: 'Blocked by site' },
    ],
  }));

  const result = await extractWithTavily({
    credential: CREDENTIAL,
    items: [
      snippetItem('https://example.com/ok'),
      snippetItem('https://example.com/empty'),
      snippetItem('https://example.com/failed'),
    ],
    fetcher,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, TAVILY_EXTRACT_URL);
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    urls: ['https://example.com/ok', 'https://example.com/empty', 'https://example.com/failed'],
    extract_depth: 'basic',
    format: 'text',
  });
  assert.ok(Value.Check(ExtractWebSearchResponseSchema, result));
  assert.equal(result.items[0].status, 'extracted');
  assert.equal(result.items[0].truncated, true);
  assert.equal(result.items[0].content.length, WEB_SEARCH_CONTENT_LIMIT);
  assert.equal(result.items[1].status, 'failed');
  assert.match(result.items[1].error ?? '', /未返回该网页正文/);
  assert.equal(result.items[1].content, 'short', 'failed extraction keeps a snippet snapshot');
  assert.equal(
    result.items[1].contentHash,
    createHash('sha256').update(result.items[1].content).digest('hex'),
  );
  assert.equal(result.items[1].truncated, false);
  assert.equal(result.items[2].status, 'failed');
  assert.equal(result.items[2].error, 'Blocked by site');
  assert.equal(result.items[2].content, 'short', 'failed items keep the original snippet content');
});

test('a previously extracted item that fails again cannot expose stale body as current content', async () => {
  const oldBody = 'old extracted body that must not masquerade as this extraction';
  const old = {
    ...snippetItem('https://example.com/changed'),
    snippet: 'fresh search snippet',
    content: oldBody,
    contentHash: 'b'.repeat(64),
    status: 'extracted' as const,
    truncated: true,
  };
  const { fetcher } = captureFetch(() => Response.json({
    failed_results: [{ url: 'https://example.com/changed', error: 'blocked now' }],
  }));

  const result = await extractWithTavily({
    credential: CREDENTIAL,
    items: [old],
    fetcher,
  });
  const failed = result.items[0];
  assert.equal(failed.status, 'failed');
  assert.equal(failed.content, 'fresh search snippet');
  assert.equal(failed.snippet, 'fresh search snippet');
  assert.notEqual(failed.content, oldBody);
  assert.notEqual(failed.contentHash, 'b'.repeat(64));
  assert.equal(failed.truncated, true);
  assert.equal(failed.error, 'blocked now');
  assert.ok(Value.Check(ExtractWebSearchResponseSchema, result));
});

test('a failed extraction stores the snippet verbatim and preserves its truncation flag', async () => {
  const longSnippet = 'y'.repeat(1_000);
  const { fetcher } = captureFetch(() => Response.json({
    failed_results: [{ url: 'https://example.com/long', error: 'timeout' }],
  }));
  const result = await extractWithTavily({
    credential: CREDENTIAL,
    items: [{ ...snippetItem('https://example.com/long'), snippet: longSnippet, truncated: true }],
    fetcher,
  });
  assert.equal(result.items[0].status, 'failed');
  assert.equal(result.items[0].truncated, true);
  assert.equal(result.items[0].content, longSnippet);
  assert.equal(result.items[0].snippet, longSnippet);
  assert.equal(
    result.items[0].contentHash,
    createHash('sha256').update(longSnippet).digest('hex'),
  );
});

test('extract marks URLs omitted by the provider as failed rather than claiming success', async () => {
  const { fetcher } = captureFetch(() => Response.json({ results: [] }));
  const result = await extractWithTavily({
    credential: CREDENTIAL,
    items: [snippetItem()],
    fetcher,
  });
  assert.equal(result.items[0].status, 'failed');
  assert.match(result.items[0].error ?? '', /未返回该网址的提取结果/);
});
