import type { NextRequest } from 'next/server';

const serviceUrl = (process.env.STHSTART_SERVICE_URL ?? process.env.NEXT_PUBLIC_STHSTART_SERVICE_URL ?? 'http://127.0.0.1:4100').replace(/\/$/, '');
const segment = /^[A-Za-z0-9_-]{1,128}$/;
// 100,000 CJK characters can exceed 250 KB in UTF-8; leave headroom for JSON fields.
const MAX_BODY_BYTES = 512_000;

function allowed(method: string, path: string[]) {
  if (path[0] !== 'projects' || !path[1] || !segment.test(path[1])) return false;
  const tail = path.slice(2);
  if (method === 'GET' && tail.length === 0) return true;
  if (method === 'GET' && tail.length === 1 && tail[0] === 'entries') return true;
  if (method === 'GET' && tail.length === 3 && tail[0] === 'entries'
    && /^[a-z-]+$/.test(tail[1]!) && segment.test(tail[2]!)) return true;
  if (method === 'GET' && tail.length === 1 && tail[0] === 'search') return true;
  if (method === 'POST' && tail.length === 1 && tail[0] === 'proposals') return true;
  if (method === 'GET' && tail.length === 2 && tail[0] === 'proposals' && segment.test(tail[1]!)) return true;
  return method === 'POST' && tail.length === 1 && tail[0] === 'heartbeat';
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (!allowed(request.method, path)) return Response.json({ error: 'story_bridge_route_not_allowed' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  if (request.headers.has('origin')) return Response.json({ error: 'story_bridge_browser_request_denied' }, { status: 403, headers: { 'cache-control': 'no-store' } });
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer [A-Za-z0-9_-]{40,128}$/.test(authorization)) return Response.json({ error: 'story_bridge_unauthorized' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  let body: string | undefined;
  if (request.method === 'POST') {
    const declaredLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return Response.json({ error: 'story_bridge_body_too_large' }, { status: 413, headers: { 'cache-control': 'no-store' } });
    }
    try {
      const reader = request.body?.getReader();
      if (reader) {
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BODY_BYTES) {
            await reader.cancel();
            return Response.json({ error: 'story_bridge_body_too_large' }, { status: 413, headers: { 'cache-control': 'no-store' } });
          }
          chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        body = new TextDecoder().decode(bytes);
      } else body = '';
    } catch {
      return Response.json({ error: 'story_bridge_body_invalid', message: '提案请求内容无法读取。' }, { status: 400, headers: { 'cache-control': 'no-store' } });
    }
  }
  const targetPath = path.map((item) => encodeURIComponent(item)).join('/');
  try {
    const upstream = await fetch(`${serviceUrl}/api/v1/story-bridge/${targetPath}${request.nextUrl.search}`, {
      method: request.method,
      headers: {
        authorization,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': request.headers.get('content-type')?.includes('application/json') ? 'application/json' : 'text/plain' }),
      },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
    });
  } catch {
    return Response.json({ error: 'story_bridge_service_unavailable', message: '剧情桥接服务暂时不可用。' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}

export const GET = proxy;
export const POST = proxy;
