import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const forkUrl = 'https://github.com/lark-x/galgame-with-comfyUI.git';
const forkBranch = 'lark';

const preflight = spawnSync('git', [
  'ls-remote',
  '--exit-code',
  forkUrl,
  `refs/heads/${forkBranch}`,
], { cwd: root, stdio: 'ignore' });

if (preflight.status !== 0) {
  console.error(`[SthStart] 无法读取 ${forkUrl} 的 ${forkBranch} 分支。`);
  console.error('请先创建 Fork 与 lark 分支，并确认当前 Git 凭据有读取权限；Submodule 配置尚未改动。');
  process.exit(1);
}

for (const args of [
  ['submodule', 'set-url', 'upstream/linshe', forkUrl],
  ['config', '-f', '.gitmodules', 'submodule.upstream/linshe.branch', forkBranch],
  ['submodule', 'sync', '--', 'upstream/linshe'],
]) {
  const result = spawnSync('git', args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`[SthStart] 邻舍 Submodule 已切换到 ${forkUrl} 的 ${forkBranch} 分支。`);
