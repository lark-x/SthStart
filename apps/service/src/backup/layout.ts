import { resolve, dirname } from 'node:path';
import type { ServiceConfig } from '../config.js';

/**
 * 备份本地目录布局。
 *
 * - staging：捕获阶段的明文暂存副本（数据库快照与待加密文件）。
 * - objects：加密后的密文对象缓存，上传与清理都从它出发。
 * - restore：恢复时的隔离暂存目录，下载与解密先落在这里。
 * 都在数据目录的 backups 下，并被备份范围自身排除，不会备份自己。
 */
export function backupPaths(config: ServiceConfig) {
  const base = resolve(dirname(config.databasePath), 'backups');
  return {
    base,
    stagingRoot: resolve(base, 'staging'),
    objectDirectory: resolve(base, 'objects'),
    restoreRoot: resolve(base, 'restore'),
    portableRoot: base,
  };
}
