/** Temporary native DSH Web + project-scoped MCP acceptance, never logs credentials. */
import { request } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { parse, stringify } from 'yaml';
import net from 'node:net';

const fixturePath = process.argv[2];
if (!fixturePath || !process.argv.includes('--confirm')) throw new Error('Pass a test fixture and --confirm.');
const portIndex = process.argv.indexOf('--port');
const port = portIndex < 0 ? 3081 : Number(process.argv[portIndex + 1]);
if (![3081, 3082].includes(port)) throw new Error('验收仅允许本机 3081 或隔离端口 3082。');
const fixture = JSON.parse(await readFile(resolve(fixturePath), 'utf8'));
const portal = 'http://localhost:9320';
const ctx = await request.newContext({ baseURL: portal, extraHTTPHeaders: { origin: portal } });
const auth = await ctx.post('/api/auth/admin-session');
if (!auth.ok()) throw new Error('管理会话不可用');
const { csrfToken } = await auth.json();
const api = async (method, path, data) => {
  const response = await ctx.fetch('/api/admin/' + path, { method, data, headers: { 'x-sthstart-csrf': csrfToken } });
  const body = await response.json();
  if (!response.ok()) throw new Error(body.message || '管理操作失败');
  return body;
};
const project = await api('GET', `story/projects/${fixture.projectId}`);
if (!project.title.includes('发布全链路验收')) throw new Error('仅允许新建验收项目');
const occupied = await new Promise(done => {
  const s = net.connect({ host: '127.0.0.1', port });
  s.once('connect', () => { s.destroy(); done(true); });
  s.once('error', () => { s.destroy(); done(false); });
});
if (occupied) throw new Error(`${port} 已被占用，未终止现有进程`);
// Reuse the already-configured provider in memory only, not another project's sessions/home.
const originalHome = join(process.env.LOCALAPPDATA, 'SthStart', 'StoryDsh', '72d80914-5759-4a0c-ba10-7c877beb44e9', 'home');
const credentials = parse(await readFile(join(originalHome, '.credentials.yaml'), 'utf8'));
const stepKey = credentials?.refs?.STEP_API_KEY;
if (typeof stepKey !== 'string' || !stepKey.trim()) throw new Error('已配置的 DSH Step 凭据不可用');
const home = join(process.env.LOCALAPPDATA, 'SthStart', 'StoryDsh', fixture.projectId, 'home');
const workspace = join(process.env.LOCALAPPDATA, 'SthStart', 'StoryDsh', fixture.projectId, 'workspace');
await mkdir(join(home, 'profiles', 'web'), { recursive: true });
await mkdir(workspace, { recursive: true });
const storyGrant = await api('POST', `story/projects/${fixture.projectId}/bridge-grant`, {});
const publicationGrant = await api('POST', `story/projects/${fixture.projectId}/publication-grant`, {});
const env = { ...process.env, DSH_HOME: home, STEP_API_KEY: stepKey,
  STHSTART_STORY_BRIDGE_TOKEN: storyGrant.token, STHSTART_PUBLICATION_BRIDGE_TOKEN: publicationGrant.token,
  STHSTART_STORY_PROJECT_ID: fixture.projectId, STHSTART_STORY_PORTAL_URL: portal,
  STHSTART_STORY_WORKSPACE: workspace, STHSTART_STORY_TSX_IMPORT_PATH: import.meta.resolve('tsx/esm'),
  STHSTART_STORY_MCP_SOURCE_PATH: resolve('apps/service/src/story/native-mcp-server.ts') };
const providerPatch = [{ id: 'llm-pi-ai', config: { providers: { step: { displayName: 'Step', apiKeyEnv: 'STEP_API_KEY',
  api: 'openai-completions', baseURL: 'https://api.stepfun.com/step_plan/v1',
  models: [{ id: 'step-5-preview', name: 'step-5-preview', contextWindow: 1024000, maxTokens: 10000 }] } } } },
  { id: 'agent-default-model', config: { provider: 'step', model: 'step-5-preview' } }];
await writeFile(join(home, 'profiles', 'web', 'cordis.patch.yml'), stringify(providerPatch));
const patch = join(home, 'sthstart-story-web.patch.yml');
execFileSync(process.execPath, [resolve('scripts/story-dsh/generate-web-patch.mjs'), patch], { env, windowsHide: true, stdio: 'pipe' });
const child = spawn(process.execPath, [resolve('node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'web', '--patch', patch,
  '--host', '127.0.0.1', '--port', String(port)], { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const secrets = [stepKey, storyGrant.token, publicationGrant.token];
for (const stream of [child.stdout, child.stderr]) {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    pending += chunk;
    let index;
    while ((index = pending.indexOf('\n')) >= 0) {
      let line = pending.slice(0, index + 1); pending = pending.slice(index + 1);
      for (const secret of secrets) line = line.replaceAll(secret, '[credential]');
      console.log(line.replace(/([?&]token=)[^\s&]+/gi, '$1[redacted]').trimEnd());
    }
  });
}
let stopping = false;
const heartbeat = async () => {
  // The production status/link is fixed to 3081. An isolated acceptance instance must not
  // advertise itself as that instance or redirect the user's existing session.
  if (stopping || port !== 3081) return;
  await fetch(`${portal}/api/story-bridge/projects/${fixture.projectId}/heartbeat`, { method: 'POST',
    headers: { authorization: `Bearer ${storyGrant.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ instanceId: `acceptance-${child.pid}`, port: 3081 }), signal: AbortSignal.timeout(5000) }).catch(() => {});
};
const timer = setInterval(heartbeat, 30000);
await heartbeat();
console.log(`DSH 原生 Web 验收已启动：http://127.0.0.1:${port}；测试项目 ${fixture.projectId}，作品 ${fixture.activityId}。退出后撤销临时桥接。`);
const close = async () => {
  if (stopping) return; stopping = true; clearInterval(timer);
  child.kill();
  await api('DELETE', `story/projects/${fixture.projectId}/publication-grant`).catch(() => {});
  await api('DELETE', `story/projects/${fixture.projectId}/bridge-grant`).catch(() => {});
  await ctx.dispose();
};
child.once('exit', async () => { await close(); });
process.once('SIGINT', async () => { await close(); process.exit(0); });
process.once('SIGTERM', async () => { await close(); process.exit(0); });
