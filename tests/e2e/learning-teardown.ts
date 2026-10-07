import { rm } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';

export default async function teardown() {
  const path = process.env.STHSTART_LEARNING_E2E_DIRECTORY;
  if (!path) return;
  const target = resolve(path), child = relative(resolve(tmpdir()), target);
  if (child.startsWith('..') || !child.startsWith('sthstart-browser-learning-')) throw new Error('拒绝清理测试临时目录之外的路径');
  // Playwright stops webServer processes after global teardown. Windows may still hold SQLite handles.
  try { await rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }); }
  catch { console.warn(`测试服务仍占用临时目录，保留供排查：${target}`); }
}
