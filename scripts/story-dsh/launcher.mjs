import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
function argument(name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
const projectId = argument('--project') ?? process.env.STHSTART_STORY_PROJECT_ID;
const portalValue = argument('--portal') ?? process.env.STHSTART_STORY_PORTAL_URL;
const token = process.env.STHSTART_STORY_BRIDGE_TOKEN;
const localAppData = process.env.LOCALAPPDATA;
if (!projectId || !/^[A-Za-z0-9-]{8,128}$/.test(projectId) || !portalValue || !token || !localAppData) {
  console.error('剧情 DSH 启动参数不完整；请从 start.ps1 启动。');
  process.exit(2);
}

let portal;
try { portal = new URL(portalValue); } catch { throw new Error('Portal 地址格式无效。'); }
if (!['http:', 'https:'].includes(portal.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(portal.hostname)
  || portal.username || portal.password || portal.search || portal.hash || portal.pathname !== '/') {
  throw new Error('Portal 地址必须是本机回环地址，例如 http://127.0.0.1:9320。');
}
const origin = portal.origin;
const bridgeRoot = `${origin}/api/story-bridge/projects/${encodeURIComponent(projectId)}`;
const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };

async function checkBridge() {
  const response = await fetch(`${bridgeRoot}/entries`, { headers, cache: 'no-store', signal: AbortSignal.timeout(8_000) });
  if (!response.ok) {
    if (response.status === 401) throw new Error('项目桥接凭据无效或已撤销；请在 SthStart 重新配对。');
    if (response.status === 404) throw new Error('SthStart 中找不到此项目或桥接路由；请确认项目 ID 与 Portal 地址。');
    throw new Error(`SthStart 项目桥接当前不可用（HTTP ${response.status}）。`);
  }
}

function portIsOccupied(port) {
  return new Promise((resolveResult, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(800);
    socket.once('connect', () => { socket.destroy(); resolveResult(true); });
    socket.once('timeout', () => { socket.destroy(); resolveResult(true); });
    socket.once('error', (error) => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED' || error.code === 'EHOSTUNREACH') resolveResult(false);
      else reject(error);
    });
  });
}

await checkBridge();
if (await portIsOccupied(3081)) throw new Error('本机端口 3081 已被占用。请先退出现有 DSH Web，再启动剧情项目。未终止占用端口的进程。');

const projectRoot = join(localAppData, 'SthStart', 'StoryDsh', projectId);
const dshHome = join(projectRoot, 'home');
const workspace = join(projectRoot, 'workspace');
await mkdir(dshHome, { recursive: true });
await mkdir(workspace, { recursive: true });

// A home created before the project-local workspace override may still point
// at the shared Documents workspace. Do not start DSH against that directory.
try {
  const registry = JSON.parse(await readFile(join(dshHome, 'storages', 'workspace.json'), 'utf8'));
  const defaultId = registry?.global?.defaultWorkspaceId;
  const defaultPath = defaultId && registry?.tables?.workspaces?.[defaultId]?.path;
  if (defaultId && typeof defaultPath !== 'string') throw new Error('DSH 默认工作区记录已损坏；请先检查项目 DSH 数据。');
  if (defaultPath) {
    const pathFromProject = relative(projectRoot, defaultPath);
    const directWorkspace = pathFromProject === 'workspace' || pathFromProject.startsWith(`workspace${sep}`);
    // Windows packaged hosts may virtualize LOCALAPPDATA into
    // Packages/<package>/LocalCache/Local. It is still project-scoped.
    const packageRelative = relative(join(localAppData, 'Packages'), defaultPath);
    const packageParts = packageRelative.split(sep);
    const packagedWorkspace = !isAbsolute(packageRelative) && packageParts.length >= 8
      && packageParts[0] !== '..' && packageParts[1]?.toLowerCase() === 'localcache'
      && packageParts[2]?.toLowerCase() === 'local'
      && packageParts[3]?.toLowerCase() === 'sthstart'
      && packageParts[4]?.toLowerCase() === 'storydsh'
      && packageParts[5]?.toLowerCase() === projectId.toLowerCase()
      && packageParts[6]?.toLowerCase() === 'workspace';
    if (!directWorkspace && !packagedWorkspace) {
      throw new Error('DSH 默认工作区位于当前剧情项目目录之外。为防止误读公共 Documents 工作区，启动已停止；请先迁移或重新建立该项目的 DSH 工作区。');
    }
  }
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const env = {
  ...process.env,
  DSH_HOME: dshHome,
  STHSTART_STORY_BRIDGE_TOKEN: token,
  STHSTART_STORY_PROJECT_ID: projectId,
  STHSTART_STORY_PORTAL_URL: origin,
  STHSTART_STORY_WORKSPACE: workspace,
  STHSTART_STORY_TSX_IMPORT_PATH: import.meta.resolve('tsx/esm'),
  STHSTART_STORY_MCP_SOURCE_PATH: resolve(repoRoot, 'apps/service/src/story/native-mcp-server.ts'),
};
const patchPath = join(dshHome, 'sthstart-story-web.patch.yml');
const generator = resolve(repoRoot, 'scripts/story-dsh/generate-web-patch.mjs');
const generated = spawn(process.execPath, [generator, patchPath], { cwd: repoRoot, env, stdio: 'inherit', windowsHide: true });
const generationCode = await new Promise((resolveCode, reject) => {
  generated.once('error', reject);
  generated.once('exit', (code) => resolveCode(code ?? 1));
});
if (generationCode !== 0) throw new Error('无法根据本机 DSH 标准 Web profile 生成 Story MCP 配置。');

const require = createRequire(import.meta.url);

// 注入 SthStart 剧情专属视觉主题样式到 DSH Web
try {
  const dshWebFrontendPkg = require.resolve('@deepseek-ai/dsh-web-frontend/package.json');
  const dshWebDist = resolve(dirname(dshWebFrontendPkg), 'dist');
  const dshWebAssets = resolve(dshWebDist, 'assets');
  const themeSrc = resolve(repoRoot, 'scripts/story-dsh/sthstart-theme.css');
  const themeDest = resolve(dshWebAssets, 'sthstart-theme.css');
  await cp(themeSrc, themeDest);

  const indexPath = resolve(dshWebDist, 'index.html');
  const indexHtml = await readFile(indexPath, 'utf8');
  if (!indexHtml.includes('sthstart-theme.css')) {
    const updatedHtml = indexHtml.replace('</head>', '    <link rel="stylesheet" crossorigin href="./assets/sthstart-theme.css">\n  </head>');
    await writeFile(indexPath, updatedHtml, 'utf8');
  }
} catch (e) {
  console.warn('注入 DSH 专属主题样式失败（非关键）：', e.message);
}

// 同步剧情专属 Skills 到 DSH 工作区与 home 目录
try {
  const skillsSrc = resolve(repoRoot, 'apps/service/src/story/skills');
  const dshWorkspaceSkills = join(workspace, '.dsh', 'skills');
  const dshHomeSkills = join(dshHome, 'skills');
  await cp(skillsSrc, dshWorkspaceSkills, { recursive: true, force: true });
  await cp(skillsSrc, dshHomeSkills, { recursive: true, force: true });
} catch (e) {
  console.warn('同步剧情 Skills 失败（非关键）：', e.message);
}

const dshPackage = require.resolve('@deepseek-ai/dsh/package.json');
const dshBin = resolve(dirname(dshPackage), 'lib/bin.js');
const child = spawn(process.execPath, [dshBin, '--profile', 'web', '--patch', patchPath,
  '--host', '127.0.0.1', '--port', '3081'], { cwd: workspace, env, stdio: ['inherit', 'pipe', 'pipe'], windowsHide: true });

// DSH prints its browser authentication URL on startup. Keep its automatic
// browser opening, but never echo that URL's bearer token into launcher logs.
function forwardRedacted(stream, destination) {
  const decoder = new TextDecoder();
  let pending = '';
  const writeLine = (line) => destination.write(line
    .replaceAll(token, '[story-bridge-token]')
    .replace(/([?&]token=)[^\s&]+/gi, '$1[redacted]'));
  stream.on('data', (chunk) => {
    pending += decoder.decode(chunk, { stream: true });
    let newline = pending.indexOf('\n');
    while (newline !== -1) {
      writeLine(pending.slice(0, newline + 1));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf('\n');
    }
    if (pending.length > 65_536) {
      destination.write('[DSH output line omitted: too long]\n');
      pending = '';
    }
  });
  stream.on('end', () => {
    pending += decoder.decode();
    if (pending) writeLine(pending);
  });
}
forwardRedacted(child.stdout, process.stdout);
forwardRedacted(child.stderr, process.stderr);

let stopping = false;
let lastHeartbeatFailure = '';
async function heartbeat() {
  if (stopping || child.exitCode !== null) return;
  try {
    const response = await fetch(`${bridgeRoot}/heartbeat`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: `${process.pid}-${projectId}`, port: 3081 }),
      cache: 'no-store', signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(response.status === 401 ? 'credentials' : `HTTP ${response.status}`);
    if (lastHeartbeatFailure) { console.log('SthStart 项目桥接已恢复。'); lastHeartbeatFailure = ''; }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unavailable';
    if (message !== lastHeartbeatFailure) {
      console.error(message === 'credentials' ? '剧情桥接凭据已失效；DSH 仍在运行，但 SthStart 会显示离线。' : '剧情桥接暂不可用；DSH 仍在运行，页面状态会在连接恢复后更新。');
      lastHeartbeatFailure = message;
    }
  }
}

child.once('error', (error) => {
  stopping = true;
  console.error(`无法启动 DSH：${error.message}`);
  process.exitCode = 1;
});
await heartbeat();
const heartbeatTimer = setInterval(() => { void heartbeat(); }, 30_000);
const childCode = await new Promise((resolveCode) => child.once('exit', (code, signal) => resolveCode(code ?? (signal ? 1 : 0))));
stopping = true;
clearInterval(heartbeatTimer);
process.exitCode = childCode;
