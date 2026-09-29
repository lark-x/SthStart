import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptRoot = dirname(fileURLToPath(import.meta.url));

export function parseLaunchRequest(raw) {
  let request;
  try {
    request = new URL(raw);
  } catch {
    throw new Error('启动链接格式无效。');
  }
  if (request.protocol !== 'sthstart-dsh:' || request.hostname !== 'launch' || !['', '/'].includes(request.pathname)) {
    throw new Error('启动链接不是有效的 SthStart DSH 地址。');
  }
  const allowed = new Set(['projectId', 'portal']);
  for (const key of request.searchParams.keys()) {
    if (!allowed.has(key)) throw new Error('启动链接包含不支持的参数。');
  }
  const projectIds = request.searchParams.getAll('projectId');
  const portals = request.searchParams.getAll('portal');
  if (projectIds.length !== 1 || !/^[A-Za-z0-9-]{8,128}$/.test(projectIds[0] ?? '')) {
    throw new Error('项目 ID 无效。');
  }
  if (portals.length !== 1) throw new Error('缺少本机 SthStart 地址。');

  let portal;
  try {
    portal = new URL(portals[0]);
  } catch {
    throw new Error('本机 SthStart 地址无效。');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(portal.hostname);
  if (!['http:', 'https:'].includes(portal.protocol) || !loopback || portal.username || portal.password
    || portal.pathname !== '/' || portal.search || portal.hash) {
    throw new Error('只允许从本机回环地址启动 DSH。');
  }
  return { projectId: projectIds[0], portalUrl: portal.origin };
}

export function launch(request, spawnProcess = spawn) {
  const startScript = resolve(scriptRoot, 'start.ps1');
  const child = spawnProcess('powershell.exe', [
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', startScript,
    '-ProjectId', request.projectId, '-PortalUrl', request.portalUrl,
  ], { stdio: 'inherit', windowsHide: false, shell: false });
  child.once('error', (error) => {
    console.error(`无法启动剧情 DSH：${error.message}`);
    process.exitCode = 1;
  });
  child.once('close', (code) => { process.exitCode = code ?? 1; });
  return child;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    launch(parseLaunchRequest(process.argv[2] ?? ''));
  } catch (error) {
    console.error(error instanceof Error ? error.message : '剧情 DSH 启动失败。');
    process.exitCode = 1;
  }
}
