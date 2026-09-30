import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceDatabase } from '../database.js';
import { ensureGenerationConsumerApps, ensureLocalComfyuiEngine } from './consumers.js';

test('ensureLocalComfyuiEngine preserves custom base_url and disabled status across restarts', () => {
  const db = new ServiceDatabase(':memory:');

  // 1. 首次启动时自动初始化本地 comfyui
  ensureLocalComfyuiEngine(db);
  const initialRow = db.connection.prepare('SELECT id, base_url, enabled FROM generation_engines WHERE id = ?').get('comfyui-local') as {
    id: string;
    base_url: string;
    enabled: number;
  };
  assert.ok(initialRow);
  assert.equal(initialRow.enabled, 1);

  // 2. 模拟用户自定义修改了地址并禁用了该引擎
  db.connection.prepare('UPDATE generation_engines SET base_url = ?, enabled = 0 WHERE id = ?')
    .run('http://192.168.1.50:9999', 'comfyui-local');

  const modifiedRow = db.connection.prepare('SELECT id, base_url, enabled FROM generation_engines WHERE id = ?').get('comfyui-local') as {
    id: string;
    base_url: string;
    enabled: number;
  };
  assert.equal(modifiedRow.base_url, 'http://192.168.1.50:9999');
  assert.equal(modifiedRow.enabled, 0);

  // 3. 模拟后端重启，再次调用 ensureLocalComfyuiEngine
  ensureLocalComfyuiEngine(db);

  const afterRestartRow = db.connection.prepare('SELECT id, base_url, enabled FROM generation_engines WHERE id = ?').get('comfyui-local') as {
    id: string;
    base_url: string;
    enabled: number;
  };
  assert.equal(afterRestartRow.base_url, 'http://192.168.1.50:9999', '用户自定义地址不应被覆盖');
  assert.equal(afterRestartRow.enabled, 0, '用户禁用状态不应被强行开启');
});

test('ensureGenerationConsumerApps registers topics and notebook consumers', () => {
  const db = new ServiceDatabase(':memory:');
  ensureGenerationConsumerApps(db);

  const topicsApp = db.connection.prepare('SELECT * FROM managed_apps WHERE id = ?').get('topics') as { id: string; name: string };
  assert.ok(topicsApp);
  assert.equal(topicsApp.name, '题材搜集');

  const notebookApp = db.connection.prepare('SELECT * FROM managed_apps WHERE id = ?').get('notebook') as { id: string; name: string };
  assert.ok(notebookApp);
  assert.equal(notebookApp.name, '灵感笔记');
});
