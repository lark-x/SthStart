import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { resolveLinsheEnvironment } from './linshe-env.mjs';
import { createLinsheHostedEnvironment, hostedReadinessFailure, normalizeServiceUrl } from './linshe-hosted-config.mjs';

const root = resolve(import.meta.dirname, '..');
const rootEnvironmentPath = resolve(root, '.env');
if (existsSync(rootEnvironmentPath)) process.loadEnvFile(rootEnvironmentPath);
const environment = resolveLinsheEnvironment(root);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const appToken = process.env.STHSTART_APP_TOKEN?.trim() ?? '';
let hostedEnvironment;
let serviceUrl;
const children = new Set();
let shuttingDown = false;

if (!environment.agentReady || !environment.webReady) {
  console.error('[SthStart] 邻舍核心依赖未准备好，请先运行 npm run setup。');
  process.exit(1);
}

try {
  serviceUrl = normalizeServiceUrl(process.env.STHSTART_SERVICE_URL);
  hostedEnvironment = createLinsheHostedEnvironment(serviceUrl, appToken);
} catch (error) {
  console.error(`[SthStart] ${error instanceof Error && error.message === 'missing_STHSTART_APP_TOKEN'
    ? '缺少 STHSTART_APP_TOKEN。请在项目 .env 中配置与 SthStart 公共服务邻舍身份匹配的令牌。'
    : `托管服务地址配置无效：${error instanceof Error ? error.message : String(error)}`}`);
  process.exit(1);
}

function portAvailable(port) {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once('error', () => resolvePromise(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolvePromise(true)));
  });
}

async function requirePorts(ports) {
  for (const port of ports) {
    if (!(await portAvailable(port))) {
      console.error(`[SthStart] 端口 ${port} 已被占用。请停止对应服务后重试；不会自动结束其他进程。`);
      process.exit(1);
    }
  }
}

function start(name, command, args, cwd, extraEnvironment = {}) {
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnvironment },
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  children.add(child);
  child.once('exit', (code) => {
    children.delete(child);
    if (!shuttingDown) {
      console.error(`[SthStart] ${name} 意外退出（code ${code ?? 'unknown'}）。`);
      shutdown(1);
    }
  });
  return child;
}

function stopChild(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    child.kill('SIGTERM');
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) stopChild(child);
  setTimeout(() => process.exit(code), 250).unref();
}

async function waitFor(url, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return true;
    } catch {
      // Service is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  return false;
}

async function readHostedReadiness(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'SthStart 公共服务尚未就绪。';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${serviceUrl}/api/v1/app/hosted-readiness`, {
        headers: { authorization: `Bearer ${appToken}` },
        signal: AbortSignal.timeout(2_500),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) {
        return { ready: false, missing: ['STHSTART_APP_TOKEN 与公共服务中的邻舍身份不匹配；请同步项目 .env 后重启 SthStart。'] };
      }
      if (response.ok && payload && typeof payload === 'object') {
        const missing = hostedReadinessFailure(payload);
        if (!missing.length) return { ready: true, missing: [] };
        lastError = missing.join('\n  - ');
        return { ready: false, missing };
      }
      lastError = `托管配置检查返回 HTTP ${response.status}。`;
    } catch {
      lastError = '无法连接 SthStart 公共服务；请确认服务已启动且地址正确。';
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  return { ready: false, missing: [lastError] };
}

process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());

const ports = [3099, 5173, ...(environment.vectorReady ? [8765] : [])];
await requirePorts(ports);

const vector = environment.vectorReady
  ? start('邻舍向量服务', environment.python, ['-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', '8765'], environment.vectorRoot)
  : null;

if (vector && !(await waitFor('http://127.0.0.1:8765/health', vector))) {
  console.error('[SthStart] 项目向量服务未能启动；请检查向量服务日志或运行 npm run setup:vector。');
  shutdown(1);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  process.exit(1);
}

const hosted = await readHostedReadiness();
if (!hosted.ready) {
  console.error('[SthStart] 邻舍托管配置未就绪：');
  for (const item of hosted.missing) console.error(`  - ${item}`);
  shutdown(1);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  process.exit(1);
}

const agent = start('邻舍后端', npmCommand, ['run', 'dev'], environment.agentRoot, { ...hostedEnvironment, PORT: '3099' });
const web = start('邻舍前端', npmCommand, ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173'], environment.webRoot);

const readiness = await Promise.all([
  waitFor('http://127.0.0.1:3099/api/health', agent),
  waitFor('http://127.0.0.1:5173', web),
  ...(vector ? [waitFor('http://127.0.0.1:8765/health', vector)] : []),
]);

if (readiness.some((ready) => !ready)) {
  console.error('[SthStart] 邻舍服务未能在限定时间内就绪。');
  shutdown(1);
} else {
  console.log(`[SthStart] 邻舍${environment.version ? ` v${environment.version}` : ''} 已就绪：http://127.0.0.1:5173`);
}
