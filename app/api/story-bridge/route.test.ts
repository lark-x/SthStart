import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { NextRequest } from 'next/server';

test('Story bridge Portal proxy enforces allowlist, bounded bodies, and strips admin cookies', async () => {
  const received: Array<{ method: string; url: string; headers: Record<string, string | string[] | undefined>; body: string }> = [];
  const upstream = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    received.push({ method: request.method ?? '', url: request.url ?? '', headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const address = upstream.address();
  assert.ok(address && typeof address !== 'string');
  const previous = process.env.STHSTART_SERVICE_URL;
  process.env.STHSTART_SERVICE_URL = `http://127.0.0.1:${address.port}`;
  try {
    const routes = await import('./[...path]/route.js');
    const path = ['projects', 'project-123', 'entries'];
    const context = { params: Promise.resolve({ path }) };
    const headers = new Headers({ authorization: `Bearer ${'x'.repeat(48)}`, cookie: 'admin_session=must-not-forward', 'x-sthstart-admin-token': 'must-not-forward' });
    const valid = await routes.GET(new NextRequest('http://localhost/api/story-bridge/projects/project-123/entries?q=secret', { headers }), context);
    assert.equal(valid.status, 200);
    assert.equal(valid.headers.get('cache-control'), 'no-store');
    assert.equal(received.length, 1);
    assert.equal(received[0]?.url, '/api/v1/story-bridge/projects/project-123/entries?q=secret');
    assert.equal(received[0]?.headers.authorization, headers.get('authorization'));
    assert.equal(received[0]?.headers.cookie, undefined);
    assert.equal(received[0]?.headers['x-sthstart-admin-token'], undefined);

    const withOrigin = await routes.GET(new NextRequest('http://localhost/api/story-bridge/projects/project-123/entries', { headers: { authorization: headers.get('authorization')!, origin: 'http://localhost' } }), context);
    assert.equal(withOrigin.status, 403);
    const forbidden = await routes.POST(new NextRequest('http://localhost/api/story-bridge/projects/project-123/entries', { method: 'POST', headers: { authorization: headers.get('authorization')!, 'content-type': 'application/json' }, body: '{}' }), context);
    assert.equal(forbidden.status, 404);

    const cjkBody = JSON.stringify({ proposedBody: '汉'.repeat(100_000) });
    const validLargeProposal = await routes.POST(new NextRequest('http://localhost/api/story-bridge/projects/project-123/proposals', {
      method: 'POST', headers: { authorization: headers.get('authorization')!, 'content-type': 'application/json' }, body: cjkBody,
    }), { params: Promise.resolve({ path: ['projects', 'project-123', 'proposals'] }) });
    assert.equal(validLargeProposal.status, 200, 'the proxy must accommodate the contract maximum for CJK text');
    assert.equal(received[1]?.body, cjkBody);

    const tooLarge = await routes.POST(new NextRequest('http://localhost/api/story-bridge/projects/project-123/proposals', {
      method: 'POST', headers: { authorization: headers.get('authorization')!, 'content-length': '512001', 'content-type': 'application/json' }, body: '',
    }), { params: Promise.resolve({ path: ['projects', 'project-123', 'proposals'] }) });
    assert.equal(tooLarge.status, 413);
    assert.equal(received.length, 2, 'denied requests never reach Service');
  } finally {
    if (previous === undefined) delete process.env.STHSTART_SERVICE_URL;
    else process.env.STHSTART_SERVICE_URL = previous;
    upstream.close();
    await once(upstream, 'close');
  }
});
