import assert from 'node:assert/strict';
import test from 'node:test';

type FetchCall = { url: string; init?: RequestInit };
type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;

const originalFetch = globalThis.fetch;

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sessionResponse(token: string) {
  return jsonResponse({ authenticated: true, csrfToken: token });
}

function installFetch(handler: FetchHandler) {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return calls;
}

async function loadAdminFetch(label: string) {
  return import(`./admin-fetch.ts?${label}-${Date.now()}-${Math.random()}`) as Promise<{
    adminFetch(path: string, init?: RequestInit): Promise<Response>;
    ensureAdminSession(): Promise<void>;
  }>;
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('401 refreshes once and retries with the refreshed CSRF token', async () => {
  const calls = installFetch(async (url, init) => {
    if (url === '/api/auth/admin-session') {
      return init?.method === 'POST' ? sessionResponse('fresh-token') : jsonResponse({}, 401);
    }
    if (calls.filter((call) => call.url === '/api/admin/worlds').length === 1) {
      return jsonResponse({ error: 'admin_session_required' }, 401);
    }
    return jsonResponse({ ok: true });
  });
  const client = await loadAdminFetch('unauthorized');
  const response = await client.adminFetch('worlds', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '港口' }),
  });
  assert.equal(response.status, 200);
  const requests = calls.filter((call) => call.url === '/api/admin/worlds');
  assert.equal(requests.length, 2);
  assert.equal(new Headers(requests[0].init?.headers).get('x-sthstart-csrf'), 'fresh-token');
  assert.equal(new Headers(requests[1].init?.headers).get('x-sthstart-csrf'), 'fresh-token');
  assert.equal(requests[1].init?.body, requests[0].init?.body);
});

test('only a 403 invalid_csrf refreshes; other 403 responses are returned untouched', async () => {
  for (const [label, payload, expectedSessionCalls, expectedRetries] of [
    ['invalid-csrf', { error: 'invalid_csrf' }, 2, 1],
    ['origin', { error: 'origin_not_allowed' }, 1, 0],
    ['untrusted', { error: 'untrusted_request' }, 1, 0],
  ] as const) {
    const calls = installFetch(async (url) => {
      if (url === '/api/auth/admin-session') return sessionResponse('token-1');
      if (calls.filter((call) => call.url === '/api/admin/worlds').length === 1) return jsonResponse(payload, 403);
      return jsonResponse({ ok: true });
    });
    const client = await loadAdminFetch(label);
    const response = await client.adminFetch('worlds', { method: 'POST', body: '{}' });
    assert.equal(response.status, expectedRetries ? 200 : 403, label);
    assert.equal(calls.filter((call) => call.url === '/api/auth/admin-session').length, expectedSessionCalls, label);
    assert.equal(calls.filter((call) => call.url === '/api/admin/worlds').length, expectedRetries + 1, label);
  }
});

test('non-JSON and malformed 403 bodies never trigger a session refresh', async () => {
  for (const body of [new Response('forbidden', { status: 403 }), new Response('{', { status: 403 })]) {
    const calls = installFetch(async (url) => url === '/api/auth/admin-session'
      ? sessionResponse('token-1') : body.clone());
    const client = await loadAdminFetch('non-json');
    const response = await client.adminFetch('worlds', { method: 'POST', body: '{}' });
    assert.equal(response.status, 403);
    assert.equal(calls.filter((call) => call.url === '/api/auth/admin-session').length, 1);
  }
});

test('concurrent stale-token failures share one refresh and reuse the newest token', async () => {
  let releaseSession = () => {};
  const sessionGate = new Promise<void>((resolve) => { releaseSession = resolve; });
  let sessionCalls = 0;
  const calls = installFetch(async (url, init) => {
    if (url === '/api/auth/admin-session') {
      sessionCalls += 1;
      if (sessionCalls === 1) return sessionResponse('old-token');
      await sessionGate;
      return sessionResponse('new-token');
    }
    const headers = new Headers(init?.headers);
    if (headers.get('x-sthstart-csrf') !== 'new-token') return jsonResponse({ error: 'invalid_csrf' }, 403);
    return jsonResponse({ ok: true });
  });
  const client = await loadAdminFetch('concurrent');
  await client.ensureAdminSession();
  const first = client.adminFetch('first', { method: 'POST', body: '{}' });
  const second = client.adminFetch('second', { method: 'POST', body: '{}' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  releaseSession();
  const responses = await Promise.all([first, second]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  assert.equal(sessionCalls, 2);
  const retries = calls.filter((call) => call.url === '/api/admin/first' || call.url === '/api/admin/second');
  assert.deepEqual(retries.map((call) => new Headers(call.init?.headers).get('x-sthstart-csrf')),
    ['old-token', 'old-token', 'new-token', 'new-token']);
});

test('stream bodies are never replayed after a stale session', async () => {
  let uploadCalls = 0;
  const calls = installFetch(async (url) => {
    if (url === '/api/auth/admin-session') return sessionResponse('token-1');
    uploadCalls += 1;
    return jsonResponse({ error: 'invalid_csrf' }, 403);
  });
  const client = await loadAdminFetch('stream');
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('media'));
      controller.close();
    },
  });
  const response = await client.adminFetch('uploads', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body,
    duplex: 'half',
  } as RequestInit);
  assert.equal(response.status, 403);
  assert.equal(uploadCalls, 1);
  assert.equal(calls.filter((call) => call.url === '/api/auth/admin-session').length, 1);
});

test('a refresh already completed by another request is reused without a second session fetch', async () => {
  let refreshCount = 0;
  installFetch(async (url, init) => {
    if (url === '/api/auth/admin-session') {
      refreshCount += 1;
      return sessionResponse(refreshCount === 1 ? 'token-1' : 'token-2');
    }
    const headers = new Headers(init?.headers);
    return headers.get('x-sthstart-csrf') === 'token-2'
      ? jsonResponse({ ok: true })
      : jsonResponse({ error: 'invalid_csrf' }, 403);
  });
  const client = await loadAdminFetch('reuse');
  await client.ensureAdminSession();
  await client.adminFetch('first', { method: 'POST', body: '{}' });
  const second = await client.adminFetch('second', { method: 'POST', body: '{}' });
  assert.equal(second.status, 200);
  assert.equal(refreshCount, 2);
});
