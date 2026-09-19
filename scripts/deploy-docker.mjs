/**
 * 把本地构建产物同步进正在运行的 sthstart 容器，并验证健康状态。
 *
 * 为什么需要这个脚本：
 * 容器不是从镜像里的 dist 单独运行的。同一个进程里混着「已编译产物」和「运行时直接读的源码」：
 *   - Portal 与 Service 跑的是 dist；
 *   - 但 db:migrate 用 tsx 直接执行 scripts/database.ts，它 import 的是 apps/service/src/*；
 *   - 而 @sthstart/contracts 的 exports 指向 src/index.ts，运行时解析的就是源码。
 * 只复制 dist 会让新旧两部分对不上：新 service 引用了旧 contracts 里还不存在的导出，
 * 容器会反复重启、健康检查变成 unhealthy。
 * 所以这里一次性同步「运行时会读到的全部位置」，不做子集更新。
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const container = process.env.STHSTART_CONTAINER || 'sthstart';
const healthUrl = process.env.STHSTART_HEALTH_URL || 'http://localhost:9320/apps/activities';
const skipBuild = process.argv.includes('--skip-build');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/**
 * 运行时会读到的全部位置。每一项都必须存在，缺任何一项都说明构建不完整。
 * 顺序无关，但集合必须完整——这正是上次出问题的地方。
 */
const runtimePaths = [
  { from: 'dist', to: '/app/dist', label: 'Portal 构建产物' },
  { from: 'apps/service/dist', to: '/app/apps/service/dist', label: 'Service 编译产物' },
  { from: 'apps/service/src', to: '/app/apps/service/src', label: 'Service 源码（迁移脚本运行时读取）' },
  { from: 'packages/contracts/src', to: '/app/packages/contracts/src', label: '契约源码（运行时解析）' },
  { from: 'packages/activity-playback/dist', to: '/app/packages/activity-playback/dist', label: '回放编译产物' },
  { from: 'scripts', to: '/app/scripts', label: '脚本（db:migrate 等）' },
  { from: 'public', to: '/app/public', label: '静态资源' },
];

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
}

/*
 * Windows 上 Node 拒绝直接 spawn .cmd（CVE-2024-27980 的修复会抛 EINVAL），
 * npm 必须以 shell 调用，否则构建会以 status=null 静默失败。
 * docker 在 Windows 上是真实可执行文件，不加 shell，避免路径被再解释一次。
 */
function runNpm(args, options = {}) {
  // 用单个命令字符串而不是 args 数组：shell 模式下 Node 会把数组拼接，
  // 既不安全也会触发 DEP0190 警告。这里的参数都是本文件写死的常量。
  return run([npmCommand, ...args].join(' '), [], { shell: process.platform === 'win32', ...options });
}

function fail(message) {
  console.error(`[部署] ${message}`);
  process.exit(1);
}

function dockerAvailable() {
  const probe = run('docker', ['inspect', container, '--format', '{{.State.Status}}']);
  if (probe.status !== 0) {
    fail(`找不到容器 ${container}。请先按 docs/DOCKER_DEPLOYMENT.md 创建容器，或用 STHSTART_CONTAINER 指定名称。`);
  }
  return probe.stdout.trim();
}

// 1. 构建。默认每次都重新构建，避免部署到旧产物。
if (skipBuild) {
  console.log('[部署] 跳过构建（--skip-build），直接同步现有产物。');
} else {
  console.log('[部署] 正在构建 Portal 与 Service…');
  const build = runNpm(['run', 'build'], { stdio: 'inherit' });
  if (build.status !== 0) fail(`构建失败（退出码 ${build.status}）。`);
}

// 2. 同步前先确认产物齐全：不完整的构建比不部署更糟。
const missing = runtimePaths.filter((item) => !existsSync(resolve(root, item.from)));
if (missing.length) {
  fail(`以下目录不存在，构建可能不完整：${missing.map((item) => item.from).join('、')}`);
}
for (const probe of ['dist/server/index.js', 'apps/service/dist/start.js', 'packages/contracts/src/index.ts', 'scripts/database.ts']) {
  if (!existsSync(resolve(root, probe))) fail(`缺少关键文件 ${probe}，请先完整构建。`);
}

const status = dockerAvailable();
if (status !== 'running') {
  console.log(`[部署] 容器当前状态为 ${status}，先启动。`);
  const start = run('docker', ['start', container], { stdio: 'inherit' });
  if (start.status !== 0) fail('启动容器失败。');
}

// 3. 全量同步。不做子集更新——dist 与 src 必须同时换，否则运行时会对不上。
for (const item of runtimePaths) {
  console.log(`[部署] 同步 ${item.label}：${item.from} → ${item.to}`);
  const copy = run('docker', ['cp', `${resolve(root, item.from)}/.`, `${container}:${item.to}/`]);
  if (copy.status !== 0) {
    fail(`复制 ${item.from} 失败：${(copy.stderr || '').trim() || `退出码 ${copy.status}`}`);
  }
}

// 4. 重启并等待健康。容器每次重启都会重跑迁移，所以这里也是迁移是否兼容的检验点。
console.log('[部署] 重启容器…');
const restart = run('docker', ['restart', container]);
if (restart.status !== 0) fail('重启容器失败。');

function healthStatus() {
  const probe = run('docker', ['inspect', container, '--format', '{{.State.Health.Status}}']);
  return probe.status === 0 ? probe.stdout.trim() : 'unknown';
}

const deadline = Date.now() + 180_000;
let current = healthStatus();
while (Date.now() < deadline && current !== 'healthy' && current !== 'unhealthy') {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000));
  current = healthStatus();
}

if (current !== 'healthy') {
  console.error(`[部署] 容器健康状态为 ${current}，最近日志如下：`);
  run('docker', ['logs', container, '--tail', '40'], { stdio: 'inherit' });
  fail('部署未成功。容器仍保留已同步的文件，修好代码后重新运行本脚本即可。');
}

console.log(`[部署] 完成，容器健康。入口：${healthUrl}`);
