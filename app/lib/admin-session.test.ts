import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { isTrustedLan, safeFetchContext, sessionCookie } from './admin-session';

test('trusted LAN mode accepts only explicitly enabled private hosts and origins', () => {
  const previousAccess = process.env.STHSTART_LAN_ACCESS;
  const previousOrigins = process.env.STHSTART_PUBLIC_ORIGINS;
  try {
    process.env.STHSTART_LAN_ACCESS = 'true';
    process.env.STHSTART_PUBLIC_ORIGINS = 'http://192.168.1.11:4173';
    const trusted = new NextRequest('http://192.168.1.11:4173/api/auth/admin-session', {
      headers: { origin: 'http://192.168.1.11:4173', 'sec-fetch-site': 'same-origin' },
    });
    const publicHost = new NextRequest('http://203.0.113.8:4173/api/auth/admin-session');
    assert.equal(isTrustedLan(trusted), true);
    assert.equal(safeFetchContext(trusted), true);
    assert.equal(sessionCookie('test', trusted).secure, false);
    assert.equal(isTrustedLan(publicHost), false);
  } finally {
    if (previousAccess === undefined) delete process.env.STHSTART_LAN_ACCESS; else process.env.STHSTART_LAN_ACCESS = previousAccess;
    if (previousOrigins === undefined) delete process.env.STHSTART_PUBLIC_ORIGINS; else process.env.STHSTART_PUBLIC_ORIGINS = previousOrigins;
  }
});
