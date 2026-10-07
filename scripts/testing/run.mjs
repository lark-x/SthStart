import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inventory, projectRoot, selectFiles } from './catalog.mjs';

export function parseArgs(args) {
  const options = { files: [], timeout: 180000 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--list' || arg === '--reverse' || arg === '--help') options[arg.slice(2)] = true;
    else if (['--suite', '--file', '--output', '--timeout'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} 缺少参数`);
      if (arg === '--file') options.files.push(value);
      else options[arg.slice(2)] = arg === '--timeout' ? Number(value) : value;
    } else throw new Error(`未知参数：${arg}`);
  }
  if (!Number.isSafeInteger(options.timeout) || options.timeout < 1) throw new Error('timeout 必须为正整数毫秒');
  return options;
}

export function summarizeTap(output) {
  const summary = {};
  for (const name of ['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo']) {
    const match = output.match(new RegExp(`^# ${name} (\\d+)\\s*$`, 'm'));
    summary[name] = match ? Number(match[1]) : null;
  }
  return summary;
}

export function execute(command, args, { cwd = projectRoot, timeout = 180000, env = process.env } = {}) {
  return new Promise(resolveResult => {
    const start = Date.now();
    let output = '', unavailable = false, timedOut = false;
    const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true });
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => { unavailable = true; output += `\n${error.message}`; });
    const kill = () => {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill('SIGTERM');
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeout);
    const interrupt = () => { timedOut = true; kill(); };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    child.on('close', code => {
      clearTimeout(timer); process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
      resolveResult({ exitCode: code, durationMs: Date.now() - start, output, unavailable, timedOut });
    });
  });
}

export async function main(args = process.argv.slice(2)) {
  const startedAt = new Date().toISOString();
  let options, outputDirectory;
  const report = { schemaVersion: 1, startedAt, nodeVersion: process.version, results: [] };
  try {
    options = parseArgs(args);
    if (options.help) {
      console.log('用法：node scripts/testing/run.mjs [--suite quick|regression|portal|service|contracts|playback|windows-worker|tooling|system|learning|ai-offline] [--file 相对路径] [--list] [--reverse] [--output 目录] [--timeout 毫秒]');
      return 0;
    }
    outputDirectory = resolve(projectRoot, options.output ?? `artifacts/testing/${Date.now()}-${process.pid}`);
    await mkdir(outputDirectory, { recursive: true });
    const catalog = await inventory();
    if (options.list) {
      await writeFile(resolve(outputDirectory, 'inventory.json'), JSON.stringify(catalog, null, 2));
      console.log(Object.entries(catalog.files.reduce((counts, item) => ({ ...counts, [item.suite]: (counts[item.suite] ?? 0) + 1 }), {}))
        .map(([suite, count]) => `${suite}: ${count} 个文件`).join('\n'));
      console.log(`现场脚本（不自动执行）：${catalog.onsite.length}\n清单：${outputDirectory}/inventory.json`);
      return 0;
    }
    const selected = selectFiles(catalog, options);
    if (options.reverse) selected.reverse();
    const require = createRequire(import.meta.url);
    try { require.resolve('tsx/esm'); } catch { throw Object.assign(new Error('缺少 tsx，请先安装项目依赖。'), { unavailable: true }); }
    if (selected.some(item => ['service', 'playback', 'ai-offline'].includes(item.suite))) {
      const build = await execute(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'packages/activity-playback/tsconfig.json'], { timeout: options.timeout });
      await writeFile(resolve(outputDirectory, 'prepare.log'), build.output);
      if (build.exitCode !== 0) throw Object.assign(new Error('播放包准备失败，查看 prepare.log。'), { unavailable: build.unavailable });
    }
    for (const [index, item] of selected.entries()) {
      const result = await execute(process.execPath, ['--import', 'tsx/esm', '--test', '--test-concurrency=1', '--test-reporter=tap', item.file], { timeout: options.timeout });
      const counts = summarizeTap(result.output);
      const status = result.unavailable ? 'environment-unavailable' : result.exitCode !== 0 || result.timedOut || !counts.tests
        ? 'failed' : counts.pass === 0 && (counts.skipped || counts.todo) ? 'skipped' : 'passed';
      const log = `${String(index + 1).padStart(3, '0')}-${item.file.replace(/[^\w.-]/g, '_')}.log`;
      await writeFile(resolve(outputDirectory, log), result.output);
      report.results.push({ ...item, status, exitCode: result.exitCode, timedOut: result.timedOut, durationMs: result.durationMs, counts, log });
      console.log(`${status}: ${item.file} (${result.durationMs}ms)`);
    }
  } catch (error) {
    report.error = error.message;
    report.status = error.unavailable ? 'environment-unavailable' : 'failed';
    console.error(report.error);
  }
  report.finishedAt = new Date().toISOString();
  report.status ??= report.results.some(item => ['failed', 'environment-unavailable'].includes(item.status)) ? 'failed' : 'passed';
  if (outputDirectory) {
    await writeFile(resolve(outputDirectory, 'report.json'), JSON.stringify(report, null, 2));
    await writeFile(resolve(outputDirectory, 'report.md'), `# 测试运行报告\n\n${startedAt} · ${process.version} · ${report.status}\n\n${report.error ?? ''}\n\n| 文件 | 结果 | 耗时 ms | 日志 |\n|---|---|---:|---|\n` + report.results.map(item => `| ${item.file} | ${item.status} | ${item.durationMs} | [查看](${item.log}) |`).join('\n') + '\n');
    console.log(`报告：${outputDirectory}/report.md`);
  }
  return report.status === 'passed' ? 0 : report.status === 'environment-unavailable' ? 2 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main();
