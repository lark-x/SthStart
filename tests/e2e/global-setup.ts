import { spawn } from 'node:child_process';
import { readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

export const E2E_DIRECTORY_PREFIX = 'sthstart-e2e-';
// 一轮全量约 1.5 分钟；超过一小时没动过的目录只可能是之前没删掉的残留。
const STALE_AFTER_MS = 60 * 60 * 1000;

/** 只处理系统临时目录下、带本套前缀的一级子目录，其他路径一律不碰。 */
export function isOwnedDirectory(path: string) {
  const child = relative(resolve(tmpdir()), resolve(path));
  return child.startsWith(E2E_DIRECTORY_PREFIX) && !/[\\/]/.test(child);
}

async function removeDirectory(path: string) {
  await rm(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}

async function sweepStaleDirectories(current: string | undefined) {
  const root = tmpdir();
  const names = await readdir(root).catch(() => [] as string[]);
  for (const name of names) {
    const path = join(root, name);
    if (!name.startsWith(E2E_DIRECTORY_PREFIX) || (current && resolve(path) === resolve(current))) continue;
    try {
      if (Date.now() - (await stat(path)).mtimeMs < STALE_AFTER_MS) continue;
      await removeDirectory(path);
    } catch {
      // 可能另一轮测试还在用，留给下一次再清。
    }
  }
}

/*
 * Playwright 先跑全局清理、后停 webServer。Windows 上 service 此时还握着 SQLite 句柄，
 * 当场删不掉；交给一个脱离测试进程的小进程，等服务退出后再删，最多等 60 秒。
 */
export function removeAfterServersExit(path: string) {
  const script = `
    const { rmSync } = require('node:fs');
    const target = process.argv[1];
    const deadline = Date.now() + 60000;
    const attempt = () => {
      try { rmSync(target, { recursive: true, force: true }); }
      catch { if (Date.now() < deadline) setTimeout(attempt, 500); }
    };
    attempt();`;
  spawn(process.execPath, ['-e', script, path], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

export default async function globalSetup() {
  const current = process.env.STHSTART_E2E_DIRECTORY;
  await sweepStaleDirectories(current);

  return async () => {
    if (!current || !isOwnedDirectory(current)) return;
    try {
      await removeDirectory(current);
    } catch {
      removeAfterServersExit(current);
    }
  };
}
