import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function readEnvironment() {
  const path = resolve(root, '.env');
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/)
    .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2].trim()]));
}

const environment = { ...readEnvironment(), ...process.env };

function privateIpv4(address) {
  const parts = address.split('.').map(Number);
  return parts.length === 4 && (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168));
}

function discoverAddress() {
  const configured = environment.STHSTART_LAN_HOST?.trim();
  if (configured) {
    if (!privateIpv4(configured)) throw new Error('STHSTART_LAN_HOST 必须是私有 IPv4 地址。');
    return configured;
  }
  const candidates = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (/^(lo|utun|awdl|llw|bridge|vmenet|docker)/i.test(name)) continue;
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || !privateIpv4(entry.address)) continue;
      const score = (/^en\d+$/i.test(name) ? 100 : 0) + (entry.address.startsWith('192.168.') ? 20 : 0);
      candidates.push({ address: entry.address, score });
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  if (!candidates[0]) throw new Error('没有检测到可用的局域网 IPv4 地址。可通过 STHSTART_LAN_HOST 手动指定。');
  return candidates[0].address;
}

const address = discoverAddress();
const portalPort = Number(environment.PORTAL_PORT || 4173);
const portalOrigin = `http://${address}:${portalPort}`;
const configuredOrigins = (environment.STHSTART_PUBLIC_ORIGINS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
const publicOrigins = [...new Set([portalOrigin, ...configuredOrigins])].join(',');
const portalOrigins = [...new Set([portalOrigin, 'http://127.0.0.1:4173', 'http://localhost:4173'])].join(',');

console.log(`[SthStart] 受信任局域网模式：http://${address}:${portalPort}`);
console.warn('[SthStart] 警告：同一局域网内的设备可管理 SthStart；不要在公共 Wi-Fi 使用此模式。');

const child = spawn(npmCommand, ['run', 'start:lan:processes'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
  env: {
    ...environment,
    STHSTART_LAN_ACCESS: 'true',
    STHSTART_PUBLIC_ORIGINS: publicOrigins,
    PORTAL_ORIGINS: portalOrigins,
    LINSHE_APP_URL: `http://${address}:5173`,
  },
});

child.once('exit', (code, signal) => process.exitCode = code ?? (signal ? 1 : 0));
process.once('SIGINT', () => child.kill('SIGINT'));
process.once('SIGTERM', () => child.kill('SIGTERM'));
