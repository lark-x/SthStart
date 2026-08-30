import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function environmentValue(name) {
  if (process.env[name]?.trim()) return process.env[name].trim();
  const path = resolve(root, '.env');
  if (!existsSync(path)) return '';
  const line = readFileSync(path, 'utf8').split(/\r?\n/).find((item) => item.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '') ?? '';
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

const target = option('--target') || 'portal';
if (!['portal', 'linshe'].includes(target)) {
  console.error('--target 只支持 portal 或 linshe。');
  process.exit(1);
}
const localUrl = option('--local') || (target === 'linshe'
  ? 'http://127.0.0.1:3099/'
  : 'http://127.0.0.1:4173/apps/notebook');
const configuredRemote = target === 'linshe'
  ? environmentValue('LINSHE_APP_URL')
  : environmentValue('STHSTART_PUBLIC_ORIGINS').split(',')[0];
const remoteUrl = option('--url') || configuredRemote && `${configuredRemote.replace(/\/$/, '')}${target === 'linshe' ? '/' : '/apps/notebook'}`;
const samples = Math.max(3, Math.min(20, Number.parseInt(option('--samples') || '5', 10)));

if (!remoteUrl) {
  console.error(`未找到远程地址。请配置 ${target === 'linshe' ? 'LINSHE_APP_URL' : 'STHSTART_PUBLIC_ORIGINS'}，或传入 --url https://你的域名。`);
  process.exit(1);
}

function measure(url) {
  const format = ['%{http_code}', '%{remote_ip}', '%{http_version}', '%{num_redirects}', '%{url_effective}', '%{time_namelookup}', '%{time_connect}', '%{time_appconnect}', '%{time_starttransfer}', '%{time_total}'].join('\t');
  const output = execFileSync('curl', ['-sS', '-L', '-o', '/dev/null', '--max-time', '30', '-w', format, url], { encoding: 'utf8' }).trim();
  const [status, remoteIp, version, redirects, effectiveUrl, dns, connect, tls, ttfb, total] = output.split('\t');
  let effectiveHost = '';
  try { effectiveHost = new URL(effectiveUrl).hostname; } catch {}
  return { status: Number(status), remoteIp, version, redirects: Number(redirects), effectiveHost, dns: Number(dns), connect: Number(connect), tls: Number(tls), ttfb: Number(ttfb), total: Number(total) };
}

function percentile(values, position) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * position) - 1)];
}

function summarize(label, url) {
  const results = Array.from({ length: samples }, () => measure(url));
  const milliseconds = (field) => results.map((item) => item[field] * 1000);
  return {
    label,
    url,
    status: [...new Set(results.map((item) => item.status))].join('/'),
    endpoint: `${results.at(-1).remoteIp} · HTTP/${results.at(-1).version}`,
    redirects: Math.max(...results.map((item) => item.redirects)),
    effectiveHosts: [...new Set(results.map((item) => item.effectiveHost).filter(Boolean))],
    medianTtfbMs: Math.round(percentile(milliseconds('ttfb'), 0.5)),
    p95TtfbMs: Math.round(percentile(milliseconds('ttfb'), 0.95)),
    medianTotalMs: Math.round(percentile(milliseconds('total'), 0.5)),
    p95TotalMs: Math.round(percentile(milliseconds('total'), 0.95)),
  };
}

try {
  const rows = [summarize(target === 'linshe' ? '邻舍本机' : 'Portal 本机', localUrl), summarize('Cloudflare', remoteUrl)];
  console.table(rows.map(({ label, status, endpoint, redirects, medianTtfbMs, p95TtfbMs, medianTotalMs, p95TotalMs }) => ({
    入口: label,
    状态: status,
    连接: endpoint,
    重定向: redirects,
    'TTFB 中位数(ms)': medianTtfbMs,
    'TTFB P95(ms)': p95TtfbMs,
    '总耗时中位数(ms)': medianTotalMs,
    '总耗时 P95(ms)': p95TotalMs,
  })));
  const remote = rows[1];
  if (remote.redirects > 0 && remote.effectiveHosts.some((host) => host.endsWith('.cloudflareaccess.com'))) {
    console.warn('命令行被 Cloudflare Access 重定向到登录页；当前结果只代表 Access 边缘与登录页，不代表已登录后的邻舍源站。请同时以邻舍设置页的浏览器 P50/P95 为准。');
  }
  if (remote.endpoint.startsWith('127.') || remote.endpoint.startsWith('::1')) {
    console.warn('“Cloudflare”目标最终落到本机回环地址，本次结果不能代表公网性能。请用 --url 显式传入手机实际访问的公开域名后复测。');
  }
  if (remote.endpoint.startsWith('198.18.')) {
    console.warn('远程域名当前经过 198.18.0.0/15 虚拟地址，通常表示代理/TUN 接管。请将 Portal/邻舍域名、Cloudflare Access 域名和 cloudflared 进程设为 DIRECT 后复测。');
  }
  if (remote.status === '403') console.info('Cloudflare Access 返回 403 属于未携带浏览器登录会话的命令行预期结果；此处仍可比较 DNS/TLS/边缘响应耗时。');
  if (remote.p95TotalMs > 1_000) console.warn('远程 P95 超过 1 秒。应用会继续使用本地草稿避免阻塞，但应优先优化代理与 Tunnel 网络路径。');
} catch (error) {
  console.error(`远程性能检测失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
