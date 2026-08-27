import type { NextRequest } from 'next/server';
import { allowedOrigin, readSession, safeFetchContext } from '@/app/lib/admin-session';

const serviceUrl = (process.env.STHSTART_SERVICE_URL ?? process.env.NEXT_PUBLIC_STHSTART_SERVICE_URL ?? 'http://127.0.0.1:4100').replace(/\/$/, '');

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const session = await readSession(request);
  if (!session) return Response.json({ error: 'admin_session_required' }, { status: 401 });
  if (!safeFetchContext(request)) return Response.json({ error: 'untrusted_request' }, { status: 403 });
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  if (mutation && request.headers.get('x-sthstart-csrf') !== session.csrf) return Response.json({ error: 'invalid_csrf' }, { status: 403 });
  if (!allowedOrigin(request)) return Response.json({ error: 'origin_not_allowed' }, { status: 403 });
  const adminToken = process.env.STHSTART_ADMIN_TOKEN;
  if (!adminToken) return Response.json({ error: 'admin_not_configured', message: '请在 .env 中设置 STHSTART_ADMIN_TOKEN。' }, { status: 503 });
  const { path } = await context.params;
  const target = `${serviceUrl}/api/v1/admin/${path.join('/')}${request.nextUrl.search}`;
  const contentType = request.headers.get('content-type') ?? '';
  const streamBody = request.method !== 'GET' && request.method !== 'HEAD' && Boolean(request.body) && /^(?:image\/|application\/octet-stream)/i.test(contentType);
  const body = request.method === 'GET' || request.method === 'HEAD'
    ? undefined
    : streamBody
      ? request.body
      : await request.text();
  const headers: Record<string, string> = { 'x-sthstart-admin-token': adminToken, 'x-request-id': request.headers.get('x-request-id') ?? crypto.randomUUID() };
  if (body && contentType) headers['content-type'] = contentType;
  for (const name of ['content-length', 'idempotency-key', 'x-artifact-original-name', 'x-original-filename', 'range', 'if-none-match', 'last-event-id', 'accept']) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  try {
    const fetchOptions: RequestInit & { duplex?: 'half' } = {
      method: request.method,
      headers,
      body: body || undefined,
      cache: 'no-store',
    };
    if (streamBody) fetchOptions.duplex = 'half';
    const response = await fetch(target, fetchOptions);
    const responseHeaders: Record<string, string> = { 'content-type': response.headers.get('content-type') ?? 'application/json' };
    const disposition = response.headers.get('content-disposition');
    if (disposition) responseHeaders['content-disposition'] = disposition;
    const cacheControl = response.headers.get('cache-control');
    if (cacheControl) responseHeaders['cache-control'] = cacheControl;
    for (const name of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'x-request-id', 'x-accel-buffering']) {
      const value = response.headers.get(name);
      if (value) responseHeaders[name] = value;
    }
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch {
    return Response.json({ error: 'service_unavailable', message: '公共服务当前不可用。' }, { status: 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
