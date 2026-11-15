import assert from 'node:assert/strict';
import test from 'node:test';

const originalFetch = globalThis.fetch;

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('fetchPending sends trimmed q with paging and keeps legacy callers unchanged', async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    urls.push(url);
    if (url === '/api/auth/admin-session') {
      return jsonResponse({ authenticated: true, csrfToken: 'token' });
    }
    return jsonResponse({ items: [], counts: {}, total: 0 });
  }) as typeof fetch;
  const client = await import('./api');

  await client.fetchPending({
    state: 'kept',
    q: '  雾港  ',
    limit: 20,
    offset: 40,
  });
  await client.fetchPending({ state: 'kept', limit: 20, offset: 0 });

  const requests = urls.filter((url) => url.startsWith('/api/admin/knowledge/pending?'));
  assert.equal(requests.length, 2);
  const searched = new URL(requests[0], 'http://localhost');
  assert.equal(searched.searchParams.get('q'), '雾港');
  assert.equal(searched.searchParams.get('state'), 'kept');
  assert.equal(searched.searchParams.get('limit'), '20');
  assert.equal(searched.searchParams.get('offset'), '40');
  const legacy = new URL(requests[1], 'http://localhost');
  assert.equal(legacy.searchParams.has('q'), false);
  assert.equal(legacy.searchParams.get('offset'), '0');
});
