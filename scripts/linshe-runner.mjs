import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { resolveLinsheEnvironment } from './linshe-env.mjs';

const root = resolve(import.meta.dirname, '..');
const environment = resolveLinsheEnvironment(root);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = new Set();
let shuttingDown = false;

if (!environment.agentReady || !environment.webReady) {
  console.error('[SthStart] 邻舍核心依赖未准备好，请先运行 npm run setup。');
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

process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());

const ports = [3099, 5173, ...(environment.vectorReady ? [8765] : [])];
await requirePorts(ports);

if (!environment.vectorReady) {
  console.warn('[SthStart] 向量服务依赖或模型未就绪，邻舍将以降级模式启动。运行 npm run setup:vector 可启用长期向量记忆。');
}

const agent = start('邻舍后端', npmCommand, ['run', 'dev'], environment.agentRoot, { PORT: '3099' });
const web = start('邻舍前端', npmCommand, ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173'], environment.webRoot);
const vector = environment.vectorReady
  ? start('邻舍向量服务', environment.python, ['-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', '8765'], environment.vectorRoot)
  : null;

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
