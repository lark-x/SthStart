import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function readEnvironment() {
  const path = resolve(root, '.env');
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/)
    .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((match) => [match[1], match[2].trim()]));
}

function projectPath(path) {
  const child = relative(root, path);
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

function unixListeners(port) {
  try {
    return execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' })
      .trim().split(/\s+/).filter(Boolean).map(Number).filter((pid) => Number.isInteger(pid) && pid > 1);
  } catch { return []; }
}

function unixWorkingDirectory(pid) {
  try {
    const output = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' });
    return output.split(/\r?\n/).find((line) => line.startsWith('n'))?.slice(1) ?? null;
  } catch { return null; }
}

function windowsListeners(port) {
  const command = `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess`;
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' })
      .trim().split(/\s+/).filter(Boolean).map(Number).filter((pid) => Number.isInteger(pid) && pid > 1);
  } catch { return []; }
}

function windowsBelongsToProject(pid) {
  const escapedRoot = root.replaceAll("'", "''");
  const command = `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if($p.CommandLine -like '*${escapedRoot}*'){exit 0}else{exit 1}`;
  try { execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]); return true; }
  catch { return false; }
}

const environment = readEnvironment();
const ports = [Number(process.env.SERVICE_PORT || environment.SERVICE_PORT || 4100), Number(process.env.PORTAL_PORT || environment.PORTAL_PORT || 4173)];
const targets = new Set();
const refused = [];

for (const port of ports) {
  const listeners = process.platform === 'win32' ? windowsListeners(port) : unixListeners(port);
  for (const pid of listeners) {
    const cwd = process.platform === 'win32' ? null : unixWorkingDirectory(pid);
    const belongs = process.platform === 'win32' ? windowsBelongsToProject(pid) : Boolean(cwd && projectPath(cwd));
    if (belongs) targets.add(pid); else refused.push({ port, pid });
  }
}

if (refused.length) {
  for (const item of refused) console.error(`拒绝停止端口 ${item.port} 的 PID ${item.pid}：它不属于当前 SthStart 工作区。`);
  process.exitCode = 1;
} else if (!targets.size) {
  console.log('SthStart Portal 和公共服务已经停止。');
} else {
  for (const pid of targets) {
    try {
      if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(pid, 'SIGTERM');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  console.log(`已向 ${targets.size} 个 SthStart 进程发送安全停止信号。`);
}
