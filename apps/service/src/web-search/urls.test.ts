import assert from 'node:assert/strict';
import test from 'node:test';
import { isPublicHttpUrl, parsePublicHttpUrl, siteNameForUrl } from './urls.js';

test('public URL validation accepts ordinary HTTPS/HTTP pages', () => {
  assert.equal(isPublicHttpUrl('https://example.com/article'), true);
  assert.equal(isPublicHttpUrl('http://news.example.org/path?q=1#section'), true);
  assert.equal(isPublicHttpUrl('https://example.com:8443/article'), true);
  assert.equal(isPublicHttpUrl('https://123.com/article'), true);
  assert.equal(parsePublicHttpUrl('https://www.example.com/a')?.hostname, 'www.example.com');
  assert.equal(siteNameForUrl('https://www.example.com/a'), 'example.com');
});

test('public URL validation rejects local, private, literal-IP and malformed targets', () => {
  const rejected = [
    '',
    'not a url',
    'ftp://example.com/file',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:pass@example.com/',
    'https://localhost/',
    'https://LOCALHOST/',
    'https://api.localhost/',
    'https://printer.local/',
    'https://service.internal/',
    'https://router.home.arpa/',
    'https://intranet/',
    'http://127.0.0.1.nip.io/',
    'http://127.0.0.1.sslip.io/',
    'http://localhost.localtest.me/',
    'http://127.0.0.1.lvh.me/',
    'http://127.0.0.1.vcap.me/',
    'http://127.0.0.1.xip.io/',
    'http://127.0.0.1.traefik.me/',
    'http://127.0.0.1.local.gd/',
    'http://nip.io/',
    'http://sslip.io/',
    'http://localtest.me/',
    'http://lvh.me/',
    'http://vcap.me/',
    'http://xip.io/',
    'http://traefik.me/',
    'http://local.gd/',
    'http://0x7f000001.nip.io/',
    'http://2130706433.sslip.io/',
    'http://127.0.0.1.example.com/',
    'http://0x7f.0.0.1.example.com/',
    'http://0177.0.0.1/',
    'http://0x7f.0.0.1/',
    'http://0x7f000001/',
    'http://2130706433/',
    'http://127.0.0.1/',
    'http://127.1/',
    'http://10.0.0.1/',
    'http://192.168.1.10/',
    'http://172.16.0.5/',
    'http://169.254.169.254/latest/meta-data/',
    'http://0.0.0.0/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fe80::1]/',
    'https://example.com./',
  ];
  for (const value of rejected) assert.equal(isPublicHttpUrl(value), false, value);
});
