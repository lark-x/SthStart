import { isIP } from 'node:net';

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'nip.io',
  'sslip.io',
  'localtest.me',
  'lvh.me',
  'vcap.me',
  'xip.io',
  'traefik.me',
  'local.gd',
]);

const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.intranet',
  '.lan',
  '.home',
  '.home.arpa',
  '.test',
  '.example',
  '.invalid',
  '.onion',
  '.nip.io',
  '.sslip.io',
  '.localtest.me',
  '.lvh.me',
  '.vcap.me',
  '.xip.io',
  '.traefik.me',
  '.local.gd',
];

const IPV4_LABEL = /^(?:0x[0-9a-f]+|[0-9]+)$/i;

function parseIpv4Label(label: string) {
  if (/^0x[0-9a-f]+$/i.test(label)) return Number.parseInt(label.slice(2), 16);
  if (/^0[0-7]+$/.test(label)) return Number.parseInt(label, 8);
  if (/^[0-9]+$/.test(label)) return Number(label);
  return Number.NaN;
}

function hasIpv4Prefix(host: string) {
  const labels = host.split('.');
  if (labels.length < 5) return false;
  const prefix = labels.slice(0, 4);
  if (!prefix.every((label) => IPV4_LABEL.test(label))) return false;
  return prefix.every((label) => {
    const value = parseIpv4Label(label);
    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
}

export function parsePublicHttpUrl(value: string): URL | null {
  const candidate = value.trim();
  if (!candidate || candidate.length > 4000) return null;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;

  const rawHost = url.hostname.toLowerCase();
  if (!rawHost || rawHost.endsWith('.') || rawHost.includes('..')) return null;

  const host = rawHost.replace(/^\[|\]$/g, '');
  if (!host || BLOCKED_HOSTS.has(host)) return null;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;

  if (host.includes(':') || isIP(host) !== 0) return null;
  if (hasIpv4Prefix(host)) return null;

  if (!host.includes('.') || host.startsWith('.') || host.endsWith('.')) return null;

  return url;
}

export function isPublicHttpUrl(value: string) {
  return parsePublicHttpUrl(value) !== null;
}

export function siteNameForUrl(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}
