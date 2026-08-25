import type { NextRequest } from 'next/server';

const serviceUrl = (process.env.STHSTART_SERVICE_URL ?? process.env.NEXT_PUBLIC_STHSTART_SERVICE_URL ?? 'http://127.0.0.1:4100').replace(/\/$/, '');

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const adminToken = process.env.STHSTART_ADMIN_TOKEN;
  if (!adminToken) return Response.json({ error: 'admin_not_configured', message: '请在 .env 中设置 STHSTART_ADMIN_TOKEN。' }, { status: 503 });
  const { path } = await context.params;
  const target = `${serviceUrl}/api/v1/admin/${path.join('/')}${request.nextUrl.search}`;
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
  const headers: Record<string, string> = { 'x-sthstart-admin-token': adminToken };
  const contentType = request.headers.get('content-type');
  if (body && contentType) headers['content-type'] = contentType;
  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      body: body || undefined,
      cache: 'no-store',
    });
    const responseHeaders: Record<string, string> = { 'content-type': response.headers.get('content-type') ?? 'application/json' };
    const disposition = response.headers.get('content-disposition');
    if (disposition) responseHeaders['content-disposition'] = disposition;
    const cacheControl = response.headers.get('cache-control');
    if (cacheControl) responseHeaders['cache-control'] = cacheControl;
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch {
    return Response.json({ error: 'service_unavailable', message: '公共服务当前不可用。' }, { status: 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
