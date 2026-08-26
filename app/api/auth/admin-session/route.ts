import type { NextRequest } from 'next/server';
import { createSession, expiredSessionCookie, isLoopback, isSessionConfigured, isTrustedLan, readSession, safeFetchContext, sessionCookie, verifyCloudflareAccess } from '@/app/lib/admin-session';

export async function GET(request: NextRequest) {
  const session = await readSession(request);
  return session ? Response.json({ authenticated: true, csrfToken: session.csrf, source: session.source }) : Response.json({ authenticated: false }, { status: 401 });
}

export async function POST(request: NextRequest) {
  if (!safeFetchContext(request)) return Response.json({ error: 'untrusted_request' }, { status: 403 });
  if (!isSessionConfigured()) return Response.json({ error: 'session_not_configured' }, { status: 503 });
  const identity = isLoopback(request)
    ? { sub: 'local-admin', source: 'local' as const }
    : isTrustedLan(request)
      ? { sub: `lan-admin:${request.nextUrl.hostname}`, source: 'trusted-lan' as const }
      : await verifyCloudflareAccess(request).then((value) => value && ({ ...value, source: 'cloudflare-access' as const }));
  if (!identity) return Response.json({ error: 'cloudflare_access_required' }, { status: 401 });
  const token = await createSession(identity);
  const cookie = sessionCookie(token, request);
  const response = Response.json({ authenticated: true });
  response.headers.append('set-cookie', `${cookie.name}=${token}; Path=/; Max-Age=${8 * 60 * 60}; HttpOnly; SameSite=Strict${cookie.secure ? '; Secure' : ''}`);
  return response;
}

export async function DELETE(request: NextRequest) {
  const session = await readSession(request);
  if (!session || request.headers.get('x-sthstart-csrf') !== session.csrf || !safeFetchContext(request)) return Response.json({ error: 'forbidden' }, { status: 403 });
  const cookie = expiredSessionCookie(request);
  const response = Response.json({ ok: true });
  response.headers.append('set-cookie', `${cookie.name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${cookie.secure ? '; Secure' : ''}`);
  return response;
}
