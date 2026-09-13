import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

import { reconcileArtifacts } from './artifacts.js';
import { ServiceDatabase, nowIso } from './database.js';
import { readConfig } from './config.js';

const ADMIN_TOKEN = 'artifact-reconcile-admin-token-1234567890';
const testConfig = (overrides: Record<string, string> = {}) => readConfig({ STHSTART_ADMIN_TOKEN: ADMIN_TOKEN, ...overrides });

const exists = (path: string) => stat(path).then(() => true).catch(() => false);

/**
 * 媒体巡检会删除「不在 artifacts 里」的文件。但角色来源快照与导入暂存区按设计就不登记在
 * artifacts：前者记在 character_source_snapshots.raw_file_path，后者是入库前的暂存文件。
 * 如果巡检不认这两类路径，每次服务启动都会删掉它们——「下载原始快照」会 404，
 * 正在整理中的导入会话也会在提交时 ENOENT。
 */
test('媒体巡检不会删掉角色来源快照与导入暂存文件', async () => {
  const artifactDir = await mkdtemp(resolve(tmpdir(), 'sthstart-reconcile-protect-'));
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const database = new ServiceDatabase();

  try {
    const snapshotId = 'snapshot-keep-me';
    const snapshotPath = resolve(artifactDir, 'characters', 'source-snapshots', `${snapshotId}.json`);
    await mkdir(dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, JSON.stringify({ identity: '原始卡片内容' }));

    // 导入会话的暂存文件：按设计不写 artifacts，只在会话提交时才成为快照或资产。
    const stagedPath = resolve(artifactDir, 'characters', 'import-sessions', 'session-staging.json');
    await mkdir(dirname(stagedPath), { recursive: true });
    await writeFile(stagedPath, JSON.stringify({ draft: '待确认的候选' }));

    const now = nowIso();
    database.connection.prepare(`INSERT INTO character_source_snapshots
      (id,provider_id,external_id,source_url,author,remote_version,remote_updated_at,fetched_at,payload_hash,format,parser_version,raw_file_path,raw_payload_json,created_at)
      VALUES (?,?,NULL,NULL,NULL,NULL,NULL,?,?,?,?,?,?,?)`)
      .run(snapshotId, 'test-provider', now, 'hash-1', 'v2-json', 'parser-1', snapshotPath, '{}', now);

    // 一个真正的孤儿文件仍应被清理，证明巡检本身没有失效。
    const orphanPath = resolve(artifactDir, 'characters', 'orphan.png');
    await writeFile(orphanPath, Buffer.from('orphan'));

    const result = await reconcileArtifacts(config, database);

    assert.equal(await exists(snapshotPath), true, '来源快照文件必须保留');
    assert.equal(await exists(stagedPath), true, '导入暂存文件必须保留');
    assert.equal(await exists(orphanPath), false, '真正的孤儿文件仍要被清理');
    assert.equal(result.orphansRemoved, 1, '只应清理那一个孤儿文件');
  } finally {
    database.close();
  }
});
