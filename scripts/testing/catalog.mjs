import { readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const groups = {
  portal: ['app', '前端逻辑与 API 桥接', 'tsx；部分桥接测试使用临时服务'],
  service: ['apps/service/src', '后端单元与集成', 'SQLite；DSH/MCP 子进程；本地模拟服务'],
  contracts: ['packages/contracts/src', '共享数据契约', 'TypeBox'],
  playback: ['packages/activity-playback/src', '播放与渲染', '播放包构建；Canvas'],
  'windows-worker': ['workers/windows-worker', 'Windows Worker', '本地模拟引擎'],
  tooling: ['scripts', '项目工具', '临时目录；禁止现场脚本自动执行'],
  system: ['tests/system', '测试基础设施', '临时目录与模拟进程'],
  learning: ['tests/learning', '学习示例与参考答案', '不收集 *.exercise.ts'],
  'ai-offline': ['tests/ai', 'AI 评估器离线验证', '模拟模型；临时数据库与真实 MCP'],
  e2e: ['tests/e2e', '浏览器完整流程', 'Playwright Chromium；隔离门户与后端'],
};

export async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (['node_modules', 'dist', 'data', '.git'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

export async function inventory(root = projectRoot) {
  const files = [];
  for (const [suite, [directory, layer, dependencies]] of Object.entries(groups)) {
    for (const path of await walk(resolve(root, directory))) {
      if (!(suite === 'e2e' ? /\.spec\.[cm]?[jt]sx?$/ : /\.test\.[cm]?[jt]sx?$/).test(path)) continue;
      const file = relative(root, path).replaceAll('\\', '/');
      files.push({ file, suite, layer, dependencies, command: suite === 'e2e'
        ? `npm run test:e2e -- ${file}` : `node scripts/testing/run.mjs --file ${file}` });
    }
  }
  const onsite = (await walk(resolve(root, 'scripts'))).map(path => relative(root, path).replaceAll('\\', '/'))
    .filter(file => /\/(?:test[-_]|verify[-_]|e2e-test-|.*(?:browser|acceptance|real-sample))/.test(file) && !/\.test\./.test(file));
  return { files: files.sort((a, b) => a.file.localeCompare(b.file)), onsite };
}

export const quickFiles = new Set([
  'app/lib/theme-preference.test.ts', 'app/lib/draft-save-queue.test.ts',
  'packages/contracts/src/story.test.ts', 'apps/service/src/story/compiler.test.ts',
  'apps/service/src/llm/common-llm.test.ts', 'apps/service/src/mcp-http.test.ts',
]);

export function selectFiles(catalog, { suite, files = [] } = {}) {
  const known = new Set([...Object.keys(groups), 'quick', 'regression']);
  if (suite && !known.has(suite)) throw new Error(`未知测试层：${suite}`);
  const selected = catalog.files.filter(item => item.suite !== 'e2e' &&
    (!suite || suite === 'regression' || (suite === 'quick'
      ? quickFiles.has(item.file) || ['system', 'learning', 'ai-offline'].includes(item.suite)
      : item.suite === suite)));
  const requested = files.map(file => file.replaceAll('\\', '/').replace(/^\.\//, ''));
  for (const file of requested) {
    if (!selected.some(item => item.file === file)) throw new Error(`文件未收集或不属于所选层：${file}`);
  }
  const result = requested.length ? selected.filter(item => requested.includes(item.file)) : selected;
  if (!result.length) throw new Error('测试集合为空，拒绝报告成功。');
  return result;
}
