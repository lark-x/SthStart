import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('[1/5] 初始化邻舍 Submodule');
run('git', ['submodule', 'update', '--init', '--recursive']);

console.log('[2/5] 安装 SthStart 依赖');
run(npmCommand, ['ci']);

const linsheRoot = resolve(root, 'upstream/linshe');
for (const folder of ['agent-core', 'web-ui']) {
  const target = resolve(linsheRoot, folder);
  if (!existsSync(resolve(target, 'package.json'))) {
    console.error(`[SthStart] 缺少 ${folder}/package.json，请检查 Submodule。`);
    process.exit(1);
  }
  console.log(`[3/5] 安装邻舍 ${folder} 依赖`);
  run(npmCommand, ['ci'], target);
}

if (process.env.STHSTART_SKIP_VECTOR === '1') {
  console.log('[4/5] 已按 STHSTART_SKIP_VECTOR=1 跳过向量服务初始化');
} else {
  console.log('[4/5] 初始化邻舍向量服务');
  run(process.execPath, [resolve(root, 'scripts/setup-vector.mjs')]);
}

console.log('[5/5] 检查邻舍运行环境');
run(process.execPath, [resolve(root, 'scripts/linshe-doctor.mjs')]);
