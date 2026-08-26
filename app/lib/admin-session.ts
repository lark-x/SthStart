import type { NextRequest } from 'next/server';

const COOKIE = 'sthstart_admin_session';
const SESSION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();
let jwksCache: { expires: number; keys: JsonWebKey[] } | null = null;

type SessionPayload = { sub: string; exp: number; csrf: string; source: 'local' | 'trusted-lan' | 'cloudflare-access' };

function base64url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decode(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function sessionSecret() {
  const secret = process.env.STHSTART_SESSION_SECRET?.trim() || process.env.STHSTART_ADMIN_TOKEN?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

export function isSessionConfigured() { return Boolean(sessionSecret()); }

async function hmac(data: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}

function equal(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index++) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

function randomToken() { return base64url(crypto.getRandomValues(new Uint8Array(24))); }

export async function createSession(payload: Omit<SessionPayload, 'exp' | 'csrf'>) {
  const secret = sessionSecret();
  if (!secret) throw new Error('session_not_configured');
  const body = base64url(encoder.encode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS, csrf: randomToken() })));
  return `${body}.${base64url(await hmac(body, secret))}`;
}

export async function readSession(request: NextRequest): Promise<SessionPayload | null> {
  const secret = sessionSecret();
  const token = request.cookies.get(COOKIE)?.value;
  if (!secret || !token) return null;
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra) return null;
  try {
    if (!equal(decode(signature), await hmac(body, secret))) return null;
    const payload = JSON.parse(new TextDecoder().decode(decode(body))) as SessionPayload;
    return payload.exp > Math.floor(Date.now() / 1000) && payload.csrf ? payload : null;
  } catch { return null; }
}

export function sessionCookie(value: string, request: NextRequest) {
  return { name: COOKIE, value, httpOnly: true, sameSite: 'strict' as const, secure: request.nextUrl.protocol === 'https:' || (!isLoopback(request) && !isTrustedLan(request)), path: '/', maxAge: SESSION_SECONDS };
}

export function expiredSessionCookie(request: NextRequest) {
  return { name: COOKIE, value: '', httpOnly: true, sameSite: 'strict' as const, secure: request.nextUrl.protocol === 'https:' || (!isLoopback(request) && !isTrustedLan(request)), path: '/', maxAge: 0 };
}

export function isLoopback(request: NextRequest) {
  return ['127.0.0.1', 'localhost', '[::1]'].includes(request.nextUrl.hostname);
}

export function isTrustedLan(request: NextRequest) {
  if (process.env.STHSTART_LAN_ACCESS !== 'true') return false;
  const hostname = request.nextUrl.hostname;
  const parts = hostname.split('.').map(Number);
  return parts.length === 4 && (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168));
}

export function allowedOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  const allowed = new Set((process.env.STHSTART_PUBLIC_ORIGINS ?? '').split(',').map((item) => item.trim()).filter(Boolean));
  if (isLoopback(request)) allowed.add(request.nextUrl.origin);
  return !origin || allowed.has(origin);
}

function trustedHost(request: NextRequest) {
  if (isLoopback(request) || isTrustedLan(request)) return true;
  return (process.env.STHSTART_PUBLIC_ORIGINS ?? '').split(',').map((item) => item.trim()).filter(Boolean).some((origin) => {
    try { return new URL(origin).host === request.nextUrl.host; } catch { return false; }
  });
}

export function safeFetchContext(request: NextRequest) {
  const site = request.headers.get('sec-fetch-site');
  return trustedHost(request) && (!site || site === 'same-origin' || site === 'none') && allowedOrigin(request);
}

async function accessKeys(teamDomain: string) {
  if (jwksCache && jwksCache.expires > Date.now()) return jwksCache.keys;
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(8_000), cache: 'no-store' });
  if (!response.ok) throw new Error('access_jwks_unavailable');
  const payload = await response.json() as { keys?: JsonWebKey[]; public_certs?: JsonWebKey[] };
  const keys = payload.keys ?? payload.public_certs ?? [];
  jwksCache = { keys, expires: Date.now() + 60 * 60_000 };
  return keys;
}

export async function verifyCloudflareAccess(request: NextRequest) {
  const domain = process.env.CF_ACCESS_TEAM_DOMAIN?.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const audience = process.env.CF_ACCESS_AUD?.trim();
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!domain || !audience || !token) return null;
  try {
    const [encodedHeader, encodedPayload, encodedSignature, extra] = token.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSignature || extra) return null;
    const header = JSON.parse(new TextDecoder().decode(decode(encodedHeader))) as { alg?: string; kid?: string };
    const claims = JSON.parse(new TextDecoder().decode(decode(encodedPayload))) as { sub?: string; email?: string; aud?: string | string[]; exp?: number; iss?: string };
    if (header.alg !== 'RS256' || !header.kid || !claims.exp || claims.exp <= Date.now() / 1000) return null;
    if (!(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(audience)) return null;
    if (claims.iss !== `https://${domain}`) return null;
    const jwk = (await accessKeys(domain)).find((key) => (key as JsonWebKey & { kid?: string }).kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(encodedSignature), encoder.encode(`${encodedHeader}.${encodedPayload}`));
    return valid ? { sub: claims.email ?? claims.sub ?? 'cloudflare-user' } : null;
  } catch { return null; }
}

export const adminSessionCookieName = COOKIE;
